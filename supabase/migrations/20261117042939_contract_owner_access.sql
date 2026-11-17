begin;
-- Contracts are personal evidence, including documents uploaded under older rules.
-- Preserve the support attachment restrictions and all non-contract policies.
create or replace function private.can_access_document(p_id uuid) returns boolean language plpgsql stable security definer set search_path='' as $$
begin
 if not private.actor_active() or not exists(select 1 from public.documents where id=p_id and deleted_at is null) then return false;end if;
 if exists(select 1 from public.documents where id=p_id and scope='personal' and kind='contract' and owner_id<>auth.uid()) then return false;end if;
 if exists(select 1 from private.support_attachments where document_id=p_id) then
  return exists(select 1 from private.support_attachments a where a.document_id=p_id and private.can_read_support(a.ticket_id)
   and (not a.internal or private.has_permission('support.manage')));
 end if;
 return private.can_access_document_before_support(p_id);
end;$$;

-- Only the owner may create or replace their personal contract evidence.
-- Existing reservations are retained; this applies to retries as well.
alter function private.reserve_document(text,text,bigint,text,text,uuid,uuid,uuid,uuid,uuid) rename to reserve_document_before_contract_owner;
revoke all on function private.reserve_document_before_contract_owner(text,text,bigint,text,text,uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
create function private.reserve_document(p_name text,p_mime text,p_size bigint,p_scope text,p_kind text,p_room_id uuid,p_job_id uuid,p_client_id uuid,p_replace_id uuid default null,p_owner_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if p_kind='contract' and coalesce(p_owner_id,auth.uid()) is distinct from auth.uid() then
  raise exception 'Only the owner may upload a contract' using errcode='42501';
 end if;
 return private.reserve_document_before_contract_owner(p_name,p_mime,p_size,p_scope,p_kind,p_room_id,p_job_id,p_client_id,p_replace_id,p_owner_id);
end;$$;
revoke all on function private.reserve_document(text,text,bigint,text,text,uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function private.reserve_document(text,text,bigint,text,text,uuid,uuid,uuid,uuid,uuid) to authenticated;
create or replace function public.reserve_document(p_name text,p_mime text,p_size bigint,p_scope text,p_kind text,p_room_id uuid,p_job_id uuid,p_client_id uuid,p_replace_id uuid default null,p_owner_id uuid default null)
returns jsonb language sql security invoker set search_path='' as $$ select private.reserve_document(p_name,p_mime,p_size,p_scope,p_kind,p_room_id,p_job_id,p_client_id,p_replace_id,p_owner_id); $$;

-- Registration reveals only the label and identifier of the current clean PDF;
-- it does not grant access to document records, storage paths, or bytes.
create function private.contract_registration_candidates(p_user_id uuid)
returns table(version_id uuid, file_name text) language plpgsql stable security definer set search_path='' as $$
begin
 if not private.has_permission('contracts.manage') then raise exception 'Contract management and MFA required' using errcode='42501'; end if;
 return query select v.id,v.original_name from public.documents d
 join public.document_versions v on v.id=d.current_version_id and v.document_id=d.id
 where d.owner_id=p_user_id and d.scope='personal' and d.kind='contract' and d.deleted_at is null
 and d.status='clean' and v.status='clean' and v.mime_type='application/pdf' and v.sha256 is not null
 order by d.created_at desc,d.id;
end;$$;
create function public.contract_registration_candidates(p_user_id uuid)
returns table(version_id uuid,file_name text) language sql stable security invoker set search_path='' as $$
 select * from private.contract_registration_candidates(p_user_id);
$$;
revoke all on function private.contract_registration_candidates(uuid),public.contract_registration_candidates(uuid) from public,anon,authenticated;
grant execute on function private.contract_registration_candidates(uuid),public.contract_registration_candidates(uuid) to authenticated;
commit;
