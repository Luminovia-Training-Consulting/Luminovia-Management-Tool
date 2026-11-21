begin;

-- Administrative permissions do not establish a personal teaching role.
create or replace function private.lecturer_user(p_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles profile
    join public.user_roles role on role.user_id = profile.id
    where profile.id = p_user_id and profile.active
      and role.role in ('lecturer', 'senior_lecturer')
  );
$$;

create or replace function private.has_role(p_roles text[])
returns boolean language sql stable security definer set search_path = '' as $$
  select private.actor_active() and exists (
    select 1 from public.user_roles
    where user_id = auth.uid()
      and (role = any(p_roles) or (role in ('admin', 'owner')
        and p_roles && array['admin', 'owner', 'management', 'participant']))
  );
$$;

-- An instructor deposits a personal invoice. The existing on-behalf action
-- remains separate and requires the uploader's current finance permission.
create function private.can_upload_lecturer_invoice(p_actor uuid, p_owner uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select private.lecturer_user(p_owner) and (p_actor = p_owner or exists (
    select 1 from public.profiles profile
    join public.user_roles role on role.user_id = profile.id
    join public.role_permissions permission on permission.role = role.role
    where profile.id = p_actor and profile.active and permission.permission = 'finance.manage'
  ));
$$;

-- The existing wrapper owns contract on-behalf audit and delegates all paths
-- to the original reservation, quota and exact-retry checks.
do $migration$
declare
  source text := pg_catalog.pg_get_functiondef(
    'private.reserve_document(text,text,bigint,text,text,uuid,uuid,uuid,uuid,uuid)'::regprocedure
  );
  anchor constant text := E'\nbegin\n';
begin
  if cardinality(string_to_array(source, anchor)) <> 2 then
    raise exception 'Expected the current document reservation wrapper';
  end if;
  execute replace(source, anchor, anchor || $invoice$  if p_kind = 'invoice' then
    if not private.actor_active() then raise insufficient_privilege; end if;
    perform 1 from public.profiles where id in (actor_id, subject_id) order by id for share;
    if private.can_upload_lecturer_invoice(actor_id, subject_id) is not true then
      raise exception 'Current lecturer invoice upload authority required' using errcode = '42501';
    end if;
    if p_scope is distinct from 'personal' or p_mime is distinct from 'application/pdf' then
      raise exception 'Personal invoice PDF required' using errcode = '22023';
    end if;
  end if;
$invoice$);
end;
$migration$;

-- Recheck the actual caller after scanning and before copying bytes into
-- clean storage. An existing invoice stays readable after a role changes.
create function private.can_finalize_invoice_upload(p_document_id uuid, p_version_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.actor_active() and exists (
    select 1 from public.documents document
    join public.document_versions version on version.document_id = document.id
      and version.id = document.current_version_id
    where document.id = p_document_id and version.id = p_version_id
      and document.deleted_at is null and document.kind = 'invoice' and document.scope = 'personal'
      and version.uploaded_by = auth.uid() and version.mime_type = 'application/pdf'
      and not private.deletion_document_fenced(document.id)
      and private.can_upload_lecturer_invoice(version.uploaded_by, document.owner_id)
  );
$$;

create function public.can_finalize_invoice_upload(p_document_id uuid, p_version_id uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select private.can_finalize_invoice_upload(p_document_id, p_version_id);
$$;

-- Only the scanner's service caller can mark an exact leased version clean.
-- Hold the same profile locks as reservation so a role change cannot race
-- with recording a clean invoice or its audit event.
create function private.complete_invoice_upload(
  p_document_id uuid, p_version_id uuid, p_lease_id uuid,
  p_sha256 text, p_scanner_version text
) returns void language plpgsql security definer set search_path = '' as $$
declare
  uploader_id uuid;
  document_owner_id uuid;
begin
  if p_sha256 is null or p_sha256 !~ '^[a-f0-9]{64}$'
    or p_scanner_version is null or length(p_scanner_version) not between 1 and 200 then
    raise invalid_parameter_value;
  end if;

  select version.uploaded_by, document.owner_id into uploader_id, document_owner_id
  from public.documents document
  join public.document_versions version on version.document_id = document.id
  where document.id = p_document_id and version.id = p_version_id;
  if not found then raise insufficient_privilege; end if;

  perform 1 from public.profiles where id in (uploader_id, document_owner_id) order by id for share;
  if private.can_upload_lecturer_invoice(uploader_id, document_owner_id) is not true then
    raise insufficient_privilege;
  end if;
  perform 1 from private.deletion_upload_leases
  where id = p_lease_id and document_id = p_document_id and version_id = p_version_id for share;
  if not found then raise insufficient_privilege; end if;

  perform 1 from public.documents
  where id = p_document_id and owner_id = document_owner_id and kind = 'invoice' and scope = 'personal'
    and deleted_at is null and current_version_id = p_version_id for update;
  if not found or private.deletion_document_fenced(p_document_id) then
    raise exception 'Invoice upload version is no longer current' using errcode = 'PT409';
  end if;

  update public.document_versions set status = 'clean', sha256 = p_sha256, scanner_version = p_scanner_version
  where id = p_version_id and document_id = p_document_id and uploaded_by = uploader_id
    and status = 'scanning' and mime_type = 'application/pdf';
  if not found then raise insufficient_privilege; end if;
  update public.documents set status = 'clean' where id = p_document_id;
  insert into public.audit_events(actor_id, action, resource_id)
  values (uploader_id, 'document.scan_clean', p_document_id);
end;
$$;

create function public.complete_invoice_upload(
  p_document_id uuid, p_version_id uuid, p_lease_id uuid,
  p_sha256 text, p_scanner_version text
) returns void language sql security invoker set search_path = '' as $$
  select private.complete_invoice_upload(p_document_id, p_version_id, p_lease_id, p_sha256, p_scanner_version);
$$;

revoke all on function private.can_upload_lecturer_invoice(uuid, uuid),
  private.can_finalize_invoice_upload(uuid, uuid), public.can_finalize_invoice_upload(uuid, uuid),
  private.complete_invoice_upload(uuid, uuid, uuid, text, text),
  public.complete_invoice_upload(uuid, uuid, uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function private.can_finalize_invoice_upload(uuid, uuid),
  public.can_finalize_invoice_upload(uuid, uuid) to authenticated;
grant execute on function private.complete_invoice_upload(uuid, uuid, uuid, text, text),
  public.complete_invoice_upload(uuid, uuid, uuid, text, text) to service_role;

notify pgrst, 'reload schema';
commit;
