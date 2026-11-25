begin;

-- Company PDFs are not lecturer contracts or generic personal files. Keep the
-- kind allowlist and the ordinary private Storage/quarantine lifecycle.
alter table public.documents drop constraint documents_kind_check;
alter table public.documents add constraint documents_kind_check
  check (kind in ('material','chat','cv','certificate','contract','invoice','avatar',
    'participant_submission','organisation_contract'));
alter table public.documents add constraint organisation_contract_pdf_check
  check (kind <> 'organisation_contract' or (scope = 'personal' and mime_type = 'application/pdf'));

-- Organisation deletion is never a cascade. The document and version can
-- release incomplete bindings during reviewed cleanup; retained bindings and
-- their exact PDF rows are protected independently of the original uploader.
create table private.organisation_contract_files (
  document_id uuid primary key references public.documents(id) on delete cascade,
  version_id uuid not null unique references public.document_versions(id) on delete cascade,
  organisation_id uuid not null references public.organisations(id) on delete restrict,
  expected_sha256 text not null check (expected_sha256 ~ '^[a-f0-9]{64}$'),
  retained_at timestamptz
);
create index organisation_contract_files_organisation
  on private.organisation_contract_files(organisation_id, document_id);
alter table private.organisation_contract_files enable row level security;
revoke all on private.organisation_contract_files from public, anon, authenticated, service_role;

-- Keep the identities and privileges of the installed policy functions. This
-- also closes the generic deletion picker, which can discover owned files
-- independently of document RLS, and prevents allocation of an unbound kind.
do $migration$
declare
  rule record;
  definition text;
begin
  for rule in select * from (values
    ('private.can_access_document(uuid)',
      $old$d.kind = 'participant_submission'$old$,
      $new$d.kind in ('participant_submission', 'organisation_contract')$new$),
    ('private.reserve_document_before_contract_owner(text,text,bigint,text,text,uuid,uuid,uuid,uuid,uuid)',
      $old$ if not private.actor_active()$old$,
      $new$ if p_kind = 'organisation_contract' then raise insufficient_privilege; end if;
 if not private.actor_active()$new$),
    ('private.deletion_authorized(text,uuid)',
      $old$ if p_kind='document' then$old$,
      $new$ if p_kind = 'document' and exists (
  select from public.documents where id = p_id and kind = 'organisation_contract'
 ) then return false; end if;
 if p_kind='document' then$new$)
  ) as rules(signature, old_text, new_text)
  loop
    definition := pg_get_functiondef(rule.signature::regprocedure);
    if cardinality(string_to_array(definition, rule.old_text)) <> 2 then
      raise exception 'Expected one organisation contract guard point in %', rule.signature;
    end if;
    execute replace(definition, rule.old_text, rule.new_text);
  end loop;
end;
$migration$;

-- All four caller RPCs deliberately confer the same rights on permitted staff
-- regardless of the uploader. A client role is expressly excluded.
create function private.require_organisation_contract_access()
returns void language plpgsql stable set search_path = '' as $$
begin
  if (select edition from private.installation_identity) is distinct from 'internal'
     or not private.actor_active()
     or not private.has_permission('organisations.manage')
     or not private.has_permission('contracts.manage')
     or private.has_role(array['client']) then
    raise insufficient_privilege;
  end if;
end;
$$;

-- Keep archive and the deletion fence stable through a reservation/promotion.
-- Writers take the shared deletion advisory lock before any row locks.
create function private.lock_organisation_contract_target(p_organisation_id uuid)
returns void language plpgsql set search_path = '' as $$
declare
  target public.organisations;
begin
  select * into target from public.organisations
    where id = p_organisation_id and archived_at is null for share;
  if not found or private.deletion_row_fenced('public.organisations', to_jsonb(target)) then
    raise insufficient_privilege;
  end if;
end;
$$;

create function private.reserve_organisation_contract(
  p_organisation_id uuid, p_name text, p_size bigint, p_client_id uuid, p_sha256 text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  prior_version public.document_versions;
  prior_document public.documents;
  binding private.organisation_contract_files;
  reservation jsonb;
begin
  perform private.require_organisation_contract_access();
  if p_organisation_id is null or p_client_id is null or p_size is null
     or p_size not between 1 and 104857600 or p_name is null
     or length(p_name) not between 1 and 200 or p_name ~ '[[:cntrl:]/\\]'
     or not coalesce(p_sha256 ~ '^[a-f0-9]{64}$', false) then
    raise exception 'Invalid PDF metadata' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock_shared(hashtextextended('permanent-deletion', 0));
  perform 1 from public.profiles where id = actor_id and active for share;
  perform 1 from public.user_roles where user_id = actor_id order by role for share;
  perform private.require_organisation_contract_access();

  -- The allocator uses global -> actor -> owner, including normal file requests.
  -- Take those same locks before looking up the actor/request pair, then let
  -- the existing allocator enforce rate, ownership and both storage quotas.
  perform pg_advisory_xact_lock(hashtextextended('documents-global-quota', 0));
  perform pg_advisory_xact_lock(hashtextextended('documents:' || actor_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('documents-quota:' || actor_id::text, 0));
  select * into prior_version from public.document_versions
    where uploaded_by = actor_id and client_id = p_client_id;
  if found then
    select * into binding from private.organisation_contract_files
      where version_id = prior_version.id and document_id = prior_version.document_id;
    if not found or binding.organisation_id is distinct from p_organisation_id
       or binding.expected_sha256 is distinct from p_sha256
       or prior_version.original_name is distinct from p_name
       or prior_version.size_bytes is distinct from p_size then
      raise exception 'Organisation contract reservation conflict' using errcode = 'PT409';
    end if;
    perform private.lock_organisation_contract_target(p_organisation_id);
    select * into prior_document from public.documents where id = binding.document_id;
    if not found or prior_document.kind <> 'organisation_contract'
       or prior_document.current_version_id is distinct from binding.version_id
       or prior_document.deleted_at is not null or private.deletion_document_fenced(binding.document_id) then
      raise exception 'Organisation contract reservation unavailable' using errcode = 'PT409';
    end if;
    return jsonb_build_object('document_id', binding.document_id, 'version_id', binding.version_id,
      'object_path', prior_version.object_path, 'status', prior_version.status);
  end if;

  perform private.lock_organisation_contract_target(p_organisation_id);
  reservation := private.reserve_document(p_name, 'application/pdf', p_size, 'personal',
    'contract', null, null, p_client_id);
  insert into private.organisation_contract_files(document_id, version_id, organisation_id, expected_sha256)
    values ((reservation->>'document_id')::uuid, (reservation->>'version_id')::uuid, p_organisation_id, p_sha256);
  update public.documents set kind = 'organisation_contract'
    where id = (reservation->>'document_id')::uuid;
  return reservation;
end;
$$;

-- Shared exact-ready predicate for both history readers. A marker is written
-- only by the ordinary service completion RPC in the same transaction as the
-- clean state and audit event. No unscanned status is a download grant.
create view private.ready_organisation_contracts as
  select f.organisation_id, d.id, v.id as version_id, d.original_name, d.created_at, v.sha256
    from private.organisation_contract_files f
    join public.documents d on d.id = f.document_id and d.current_version_id = f.version_id
    join public.document_versions v on v.id = f.version_id and v.document_id = d.id
    where f.retained_at is not null and d.kind = 'organisation_contract'
      and d.deleted_at is null and d.status = 'clean' and v.status = 'clean'
      and v.mime_type = 'application/pdf' and v.version = 1
      and v.sha256 = f.expected_sha256 and v.scanner_version like 'ClamAV %';
revoke all on private.ready_organisation_contracts from public, anon, authenticated, service_role;

create function private.organisation_contract_upload_status(
  p_organisation_id uuid, p_document_id uuid, p_version_id uuid
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  result jsonb;
begin
  perform private.require_organisation_contract_access();
  select jsonb_build_object('document', to_jsonb(d), 'sha256',
    case when v.status in ('clean', 'rejected') and v.scanner_version is not null then v.sha256 end)
  into result
  from private.organisation_contract_files f
  join public.organisations o on o.id = f.organisation_id
  join public.documents d on d.id = f.document_id and d.current_version_id = f.version_id
  join public.document_versions v on v.id = f.version_id and v.document_id = d.id
  where f.organisation_id = p_organisation_id and f.document_id = p_document_id
    and f.version_id = p_version_id and d.kind = 'organisation_contract'
    and d.deleted_at is null and not private.deletion_document_fenced(d.id)
    and ((d.status <> 'clean' and o.archived_at is null) or exists (
      select from private.ready_organisation_contracts r where r.id = d.id));
  return result;
end;
$$;

create function private.organisation_contracts(
  p_organisation_id uuid, p_before_at timestamptz, p_before_id uuid
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  page_size constant integer := 30;
  items jsonb;
begin
  perform private.require_organisation_contract_access();
  if (p_before_at is null) <> (p_before_id is null) then
    raise exception 'Invalid contract cursor' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', page.id, 'file_name', page.original_name,
    'created_at', page.created_at) order by page.created_at desc, page.id desc), '[]'::jsonb)
  into items
  from (
    select r.id, r.original_name, r.created_at from private.ready_organisation_contracts r
    where r.organisation_id = p_organisation_id and not private.deletion_document_fenced(r.id)
      and (p_before_at is null or (r.created_at, r.id) < (p_before_at, p_before_id))
    order by r.created_at desc, r.id desc limit page_size + 1
  ) page;
  return jsonb_build_object('items', case when jsonb_array_length(items) > page_size
    then items - page_size else items end, 'has_more', jsonb_array_length(items) > page_size);
end;
$$;

create function private.organisation_contract_download(p_organisation_id uuid, p_document_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  result jsonb;
begin
  perform private.require_organisation_contract_access();
  select jsonb_build_object('document_id', r.id, 'version_id', r.version_id,
    'sha256', r.sha256, 'file_name', r.original_name) into result
  from private.ready_organisation_contracts r
  where r.organisation_id = p_organisation_id and r.id = p_document_id
    and not private.deletion_document_fenced(r.id);
  return result;
end;
$$;

create function public.reserve_organisation_contract(
  p_organisation_id uuid, p_name text, p_size bigint, p_client_id uuid, p_sha256 text
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.reserve_organisation_contract(p_organisation_id, p_name, p_size, p_client_id, p_sha256);
$$;

create function public.organisation_contract_upload_status(
  p_organisation_id uuid, p_document_id uuid, p_version_id uuid
) returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.organisation_contract_upload_status(p_organisation_id, p_document_id, p_version_id);
$$;

create function public.organisation_contracts(
  p_organisation_id uuid, p_before_at timestamptz default null, p_before_id uuid default null
) returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.organisation_contracts(p_organisation_id, p_before_at, p_before_id);
$$;

create function public.organisation_contract_download(p_organisation_id uuid, p_document_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.organisation_contract_download(p_organisation_id, p_document_id);
$$;

revoke all on function private.require_organisation_contract_access(),
  private.lock_organisation_contract_target(uuid),
  private.reserve_organisation_contract(uuid, text, bigint, uuid, text),
  private.organisation_contract_upload_status(uuid, uuid, uuid),
  private.organisation_contracts(uuid, timestamptz, uuid),
  private.organisation_contract_download(uuid, uuid),
  public.reserve_organisation_contract(uuid, text, bigint, uuid, text),
  public.organisation_contract_upload_status(uuid, uuid, uuid),
  public.organisation_contracts(uuid, timestamptz, uuid),
  public.organisation_contract_download(uuid, uuid)
from public, anon, authenticated, service_role;
grant execute on function private.reserve_organisation_contract(uuid, text, bigint, uuid, text),
  private.organisation_contract_upload_status(uuid, uuid, uuid),
  private.organisation_contracts(uuid, timestamptz, uuid),
  private.organisation_contract_download(uuid, uuid),
  public.reserve_organisation_contract(uuid, text, bigint, uuid, text),
  public.organisation_contract_upload_status(uuid, uuid, uuid),
  public.organisation_contracts(uuid, timestamptz, uuid),
  public.organisation_contract_download(uuid, uuid) to authenticated;

-- The scanner runs as service_role, not as the uploader. Recheck the stored
-- uploader's live operational role and both grants before first promotion.
create function private.check_organisation_contract_completion(
  p_document_id uuid, p_version_id uuid, p_uploader_id uuid, p_sha256 text
) returns void language plpgsql set search_path = '' as $$
declare
  binding private.organisation_contract_files;
begin
  perform pg_advisory_xact_lock_shared(hashtextextended('permanent-deletion', 0));
  select * into binding from private.organisation_contract_files
    where document_id = p_document_id and version_id = p_version_id;
  if not found or binding.expected_sha256 is distinct from p_sha256 then
    raise exception 'Organisation contract scan does not match its reservation' using errcode = 'PT409';
  end if;
  if binding.retained_at is not null then return; end if;

  perform 1 from public.profiles where id = p_uploader_id and active for share;
  if not found or (select edition from private.installation_identity) is distinct from 'internal' then
    raise insufficient_privilege;
  end if;
  perform 1 from public.user_roles where user_id = p_uploader_id order by role for share;
  if exists (select from public.user_roles where user_id = p_uploader_id and role = 'client')
     or not exists (select from public.user_roles where user_id = p_uploader_id
       and role in ('owner','admin','management','lecturer','senior_lecturer')) then
    raise insufficient_privilege;
  end if;
  perform 1 from public.role_permissions p where p.permission in ('organisations.manage', 'contracts.manage')
    and exists (select from public.user_roles r where r.user_id = p_uploader_id and r.role = p.role)
    order by p.role, p.permission for share;
  if (select count(distinct p.permission) from public.user_roles r join public.role_permissions p using (role)
      where r.user_id = p_uploader_id and p.permission in ('organisations.manage', 'contracts.manage')) <> 2 then
    raise insufficient_privilege;
  end if;
  perform private.lock_organisation_contract_target(binding.organisation_id);
end;
$$;
revoke all on function private.check_organisation_contract_completion(uuid, uuid, uuid, text)
from public, anon, authenticated, service_role;

-- Keep the ordinary service-only lease, version/state locking and idempotent
-- audit path. Extend just its company-specific preflight and retention write.
do $migration$
declare
  definition text := pg_get_functiondef('private.complete_document_upload(uuid,uuid,uuid,text,text)'::regprocedure);
  preflight constant text := '  -- Follow the existing invoice completion order.';
  audit constant text := '  insert into public.audit_events(actor_id, action, resource_id)';
begin
  if cardinality(string_to_array(definition, preflight)) <> 2
     or cardinality(string_to_array(definition, audit)) <> 2 then
    raise exception 'Expected unique organisation contract scan hook points';
  end if;
  definition := replace(definition, preflight, $hook$  if exists (
    select from public.documents where id = p_document_id and kind = 'organisation_contract'
  ) then
    perform private.check_organisation_contract_completion(p_document_id, p_version_id, uploader_id, p_sha256);
  end if;

  -- Follow the existing invoice completion order.$hook$);
  execute replace(definition, audit, $hook$  if document_kind = 'organisation_contract' then
    update private.organisation_contract_files set retained_at = clock_timestamp()
      where document_id = p_document_id and version_id = p_version_id and retained_at is null;
    if not found then raise exception 'Contract retention failed' using errcode = '55000'; end if;
  end if;
  insert into public.audit_events(actor_id, action, resource_id)$hook$);
end;
$migration$;

-- Retain the clean snapshot even for privileged cleanup, including attempts
-- to drop the binding first. Prevent extra versions regardless of scan status.
create function private.guard_organisation_contract_file()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'organisation_contract_files' then
    if old.retained_at is not null then raise foreign_key_violation; end if;
  elsif tg_table_name = 'documents' then
    if old.kind = 'organisation_contract' and exists (
      select from private.organisation_contract_files f where f.document_id = old.id and f.retained_at is not null
    ) then raise foreign_key_violation; end if;
  elsif tg_op = 'INSERT' then
    if exists (select from private.organisation_contract_files f where f.document_id = new.document_id) then
      raise foreign_key_violation;
    end if;
  elsif exists (
    select from private.organisation_contract_files f where f.document_id = old.document_id and f.retained_at is not null
  ) then raise foreign_key_violation;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function private.guard_organisation_contract_file() from public, anon, authenticated, service_role;
create trigger retained_organisation_contract_binding before update or delete on private.organisation_contract_files
  for each row execute function private.guard_organisation_contract_file();
create trigger retained_organisation_contract_document before update or delete on public.documents
  for each row execute function private.guard_organisation_contract_file();
create trigger retained_organisation_contract_version before insert or update or delete on public.document_versions
  for each row execute function private.guard_organisation_contract_file();

alter function private.deletion_scope(text, uuid) rename to deletion_scope_before_organisation_contracts;

-- Explicitly review incomplete company uploads with their objects. Leave
-- retained bindings outside the scope so the existing FK impact scan reports
-- them as a blocker for both account and company deletion, before any fence.
create function private.deletion_scope(p_kind text, p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  scope jsonb := private.deletion_scope_before_organisation_contracts(p_kind, p_id);
  document_ids uuid[];
  version_ids uuid[];
begin
  if p_kind = 'organisation' then
    select array_agg(document_id order by document_id), array_agg(version_id order by version_id)
    into document_ids, version_ids from private.organisation_contract_files
    where organisation_id = p_id and retained_at is null;
    if document_ids is not null then
      scope := private.deletion_add_scope(scope, 'public.documents', format('x.id = any(%L::uuid[])', document_ids));
      scope := private.deletion_add_scope(scope, 'public.document_versions', format('x.id = any(%L::uuid[])', version_ids));
      scope := private.deletion_add_scope(scope, 'private.organisation_contract_files',
        format('x.document_id = any(%L::uuid[])', document_ids));
    end if;
  end if;
  if p_kind not in ('account', 'organisation') then return scope; end if;

  return (
    select jsonb_agg(jsonb_build_object('table', relation, 'predicate',
      case when relation = 'private.organisation_contract_files' then '(' || predicate || ') and x.retained_at is null'
        else predicate end) order by first_position)
    from (
      select entry->>'table' relation,
        string_agg('(' || (entry->>'predicate') || ')', ' or ' order by position) predicate,
        min(position) first_position
      from jsonb_array_elements(scope) with ordinality item(entry, position)
      group by entry->>'table'
    ) grouped
  );
end;
$$;
revoke all on function private.deletion_scope_before_organisation_contracts(text, uuid),
  private.deletion_scope(text, uuid) from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';
commit;