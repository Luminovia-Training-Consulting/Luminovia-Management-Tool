begin;

-- Preserve the complete current file authorization chain before adding the
-- exact on-behalf exception for an authorized contracts.manage uploader.
do $$
declare
  predecessor text;
begin
  select prosrc into strict predecessor
  from pg_catalog.pg_proc
  where oid = 'private.can_access_document(uuid)'::regprocedure;
  execute format(
    'create function private.can_access_document_before_staff_contract(p_id uuid) returns boolean language plpgsql stable security definer set search_path = %L as %L',
    '', predecessor
  );
end;
$$;
revoke all on function private.can_access_document_before_staff_contract(uuid)
  from public, anon, authenticated, service_role;

-- A staff member can read only a personal contract PDF that they themselves
-- uploaded for another lecturer, while they retain contracts.manage. Other
-- staff and unrelated contracts preserve the existing owner-only behavior.
create or replace function private.can_access_document(p_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  document_row public.documents%rowtype;
begin
  if not private.actor_active() then return false; end if;
  select * into document_row
  from public.documents
  where id = p_id and deleted_at is null;
  if not found then return false; end if;
  if document_row.scope = 'personal' and
     document_row.kind = 'contract' and
     document_row.owner_id <> auth.uid() then
    return document_row.uploaded_by = auth.uid() and
      private.has_permission('contracts.manage') and
      private.can_access_document_before_contract_owner(document_row.id) and
      not private.deletion_document_fenced(document_row.id);
  end if;
  return private.can_access_document_before_staff_contract(p_id);
end;
$$;

-- Permit only the signed-contract on-behalf workflow. Keep the lecturer as
-- owner and the current staff member as uploader; delegate retries, quota,
-- quarantine and exact-version handling to the existing reservation function.
create or replace function private.reserve_document(
  p_name text, p_mime text, p_size bigint, p_scope text, p_kind text,
  p_room_id uuid, p_job_id uuid, p_client_id uuid,
  p_replace_id uuid default null, p_owner_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  subject_id uuid := coalesce(p_owner_id, auth.uid());
  existing_request boolean;
  result jsonb;
begin
  if p_kind = 'contract' and subject_id <> actor_id and
     not private.has_permission('contracts.manage') then
    raise exception 'Contract management required' using errcode = '42501';
  end if;
  select exists(
    select 1 from public.document_versions
    where uploaded_by = actor_id and client_id = p_client_id
  ) into existing_request;
  result := private.reserve_document_before_contract_owner(
    p_name, p_mime, p_size, p_scope, p_kind, p_room_id, p_job_id,
    p_client_id, p_replace_id, p_owner_id
  );
  if p_kind = 'contract' and subject_id <> actor_id and not existing_request and
     result->>'document_id' is not null and result->>'version_id' is not null then
    insert into public.audit_events(actor_id, action, resource_id, details)
    values (
      actor_id,
      'document.contract_uploaded_on_behalf',
      (result->>'document_id')::uuid,
      jsonb_build_object(
        'owner_id', subject_id,
        'version_id', result->>'version_id',
        'status', result->>'status'
      )
    );
  end if;
  return result;
end;
$$;

revoke all on function private.can_access_document_before_staff_contract(uuid)
  from public, anon, authenticated, service_role;

commit;