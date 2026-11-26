begin;

-- Existing (and future staff-filed) documents remain internal by default.
alter table private.organisation_contract_files
  add column shared_with_company boolean not null default false;

create or replace view private.ready_organisation_contracts as
  select f.organisation_id, d.id, v.id as version_id, d.original_name, d.created_at, v.sha256,
    f.shared_with_company
  from private.organisation_contract_files f
  join public.documents d on d.id = f.document_id and d.current_version_id = f.version_id
  join public.document_versions v on v.id = f.version_id and v.document_id = d.id
  where f.retained_at is not null and d.kind = 'organisation_contract'
    and d.deleted_at is null and d.status = 'clean' and v.status = 'clean'
    and v.mime_type = 'application/pdf' and v.version = 1
    and v.sha256 = f.expected_sha256 and v.scanner_version like 'ClamAV %';

-- Active company members may use the dedicated company-contract gateway for
-- their own organisation. Internal staff retain the original two-capability
-- requirement, and neither path grants generic document access.
create function private.require_organisation_contract_access(p_organisation_id uuid)
returns void language plpgsql stable set search_path = '' as $$
begin
  if (select edition from private.installation_identity) is distinct from 'internal'
     or not private.actor_active() or p_organisation_id is null then
    raise insufficient_privilege;
  end if;
  if private.has_role(array['client']) then
    if not private.client_has_organisation(p_organisation_id) then
      raise insufficient_privilege;
    end if;
  elsif not private.has_permission('organisations.manage')
     or not private.has_permission('contracts.manage') then
    raise insufficient_privilege;
  end if;
end;
$$;
revoke all on function private.require_organisation_contract_access(uuid)
from public, anon, authenticated, service_role;

-- Every public company-contract operation supplies the organisation it is
-- acting on; do not infer scope from a browser-selected identity.
do $migration$
declare
  rule record;
  definition text;
begin
  for rule in select * from (values
    ('private.reserve_organisation_contract(uuid,text,bigint,uuid,text)', 2,
      'or binding.expected_sha256 is distinct from p_sha256',
      $new$or binding.shared_with_company is distinct from private.has_role(array['client'])
       or binding.expected_sha256 is distinct from p_sha256$new$),
    ('private.reserve_organisation_contract(uuid,text,bigint,uuid,text)', 2,
      $old$organisation_id, expected_sha256)
    values ((reservation->>'document_id')::uuid, (reservation->>'version_id')::uuid, p_organisation_id, p_sha256);$old$,
      $new$organisation_id, expected_sha256, shared_with_company)
    values ((reservation->>'document_id')::uuid, (reservation->>'version_id')::uuid, p_organisation_id, p_sha256,
      private.has_role(array['client']));$new$),
    ('private.reserve_organisation_contract(uuid,text,bigint,uuid,text)', 2,
      $old$-- The allocator uses global -> actor -> owner,$old$,
      $new$if private.has_role(array['client']) then
    perform 1 from public.client_organisation_memberships
      where user_id = actor_id and organisation_id = p_organisation_id and removed_at is null for share;
    if not found then raise insufficient_privilege; end if;
  end if;

  -- The allocator uses global -> actor -> owner,$new$),
    ('private.organisation_contract_upload_status(uuid,uuid,uuid)', 1,
      'and f.version_id = p_version_id',
      $new$and (not private.has_role(array['client']) or (f.shared_with_company and v.uploaded_by = auth.uid()))
    and f.version_id = p_version_id$new$),
    ('private.organisation_contracts(uuid,timestamp with time zone,uuid)', 1,
      'where r.organisation_id = p_organisation_id and not',
      $new$where r.organisation_id = p_organisation_id
      and (r.shared_with_company or not private.has_role(array['client'])) and not$new$),
    ('private.organisation_contract_download(uuid,uuid)', 1,
      'and not private.deletion_document_fenced(r.id)',
      $new$and (r.shared_with_company or not private.has_role(array['client']))
    and not private.deletion_document_fenced(r.id)$new$)
  ) as rules(signature, expected_calls, old_text, new_text)
  loop
    definition := pg_get_functiondef(rule.signature::regprocedure);
    if cardinality(string_to_array(definition, 'private.require_organisation_contract_access();')) = rule.expected_calls + 1 then
      definition := replace(definition,
        'private.require_organisation_contract_access();',
        'private.require_organisation_contract_access(p_organisation_id);');
    end if;
    if cardinality(string_to_array(definition, 'private.require_organisation_contract_access(p_organisation_id);'))
       <> rule.expected_calls + 1 or cardinality(string_to_array(definition, rule.old_text)) <> 2 then
      raise exception 'Unexpected company contract definition: %', rule.signature;
    end if;
    execute replace(definition, rule.old_text, rule.new_text);
  end loop;
end;
$migration$;

drop function private.require_organisation_contract_access();

-- A scan can finish after its uploader loses access. Recheck the current
-- company membership for company accounts, or both staff capabilities for
-- internal staff, before the clean version becomes visible.
create or replace function private.check_organisation_contract_completion(
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
  if binding.shared_with_company then
    if not exists (select from public.user_roles where user_id = p_uploader_id and role = 'client') then
      raise insufficient_privilege;
    end if;
    perform 1 from public.client_organisation_memberships m
      where m.user_id = p_uploader_id and m.organisation_id = binding.organisation_id and m.removed_at is null
      for share;
    if not found then
      raise insufficient_privilege;
    end if;
  else
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
  end if;
  perform private.lock_organisation_contract_target(binding.organisation_id);
end;
$$;

commit;