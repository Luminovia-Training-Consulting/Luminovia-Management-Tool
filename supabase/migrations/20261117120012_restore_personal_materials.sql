begin;
-- This intentionally covers only the owner's own ordinary personal materials.
-- Dedicated registries, evidence, contracts, room files and job files retain
-- their existing independent permissions and are not discoverable via this API.
create index documents_archived_personal_owner on public.documents(owner_id,deleted_at desc,id desc)
 where deleted_at is not null and scope='personal' and kind='material';

create function private.archived_personal_materials(p_before_at timestamptz default null,p_before_id uuid default null,p_limit integer default 30)
returns table(id uuid,original_name text,archived_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
begin
 if not private.actor_active() then raise exception 'Active account required' using errcode='42501'; end if;
 if p_limit is null or p_limit not between 1 and 50 or (p_before_at is null)<>(p_before_id is null)
 or (p_before_at is not null and not isfinite(p_before_at)) then raise exception 'Invalid cursor' using errcode='22023';end if;
 return query select d.id,d.original_name,d.deleted_at from public.documents d
 join public.document_versions v on v.id=d.current_version_id and v.document_id=d.id
 where d.owner_id=auth.uid() and d.scope='personal' and d.kind='material' and d.deleted_at is not null
 and d.status='clean' and v.status='clean' and v.sha256 is not null
 and not private.course_document_is_dedicated(d.id) and not private.deletion_document_fenced(d.id)
 and (p_before_at is null or (d.deleted_at,d.id)<(p_before_at,p_before_id))
 order by d.deleted_at desc,d.id desc limit p_limit;
end;$$;
create function public.archived_personal_materials(p_before_at timestamptz default null,p_before_id uuid default null,p_limit integer default 30)
returns table(id uuid,original_name text,archived_at timestamptz)
language sql stable security invoker set search_path='' as $$select * from private.archived_personal_materials(p_before_at,p_before_id,p_limit);$$;

create function private.restore_personal_material(p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare d public.documents;
begin
 -- Match the permanent-deletion/account lifecycle lock order, then re-read all
 -- target and permission state. A waiting deletion cannot bypass its fence.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('permanent-deletion',0));
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('portal-user-activation',0));
 perform 1 from public.profiles where id=auth.uid() and active for share;
 if not found then raise exception 'Material unavailable' using errcode='42501';end if;
 select * into d from public.documents where id=p_id for update;
 if not found or d.owner_id is distinct from auth.uid() or d.scope<>'personal' or d.kind<>'material'
 or d.status<>'clean' or private.deletion_document_fenced(p_id) or private.course_document_is_dedicated(p_id)
 or not exists(select 1 from public.document_versions v where v.id=d.current_version_id and v.document_id=d.id and v.status='clean' and v.sha256 is not null)
 then raise exception 'Material unavailable' using errcode='42501';end if;
 if d.deleted_at is null then
  if not private.can_access_document(d.id) then raise exception 'Material unavailable' using errcode='42501';end if;
  return; -- Safe retry never duplicates the audit event.
 end if;
 update public.documents set deleted_at=null where id=d.id;
 -- Exercise the currently installed full ACL chain; errors roll back restoration.
 if not private.can_access_document(d.id) then raise exception 'Material unavailable' using errcode='42501';end if;
 insert into public.audit_events(actor_id,action,resource_id,details) values(auth.uid(),'document.restored',d.id,'{}'::jsonb);
end;$$;
create function public.restore_personal_material(p_id uuid) returns void language sql security invoker set search_path='' as $$select private.restore_personal_material(p_id);$$;
revoke all on function private.archived_personal_materials(timestamptz,uuid,integer),public.archived_personal_materials(timestamptz,uuid,integer),private.restore_personal_material(uuid),public.restore_personal_material(uuid) from public,anon,authenticated,service_role;
grant execute on function private.archived_personal_materials(timestamptz,uuid,integer),public.archived_personal_materials(timestamptz,uuid,integer),private.restore_personal_material(uuid),public.restore_personal_material(uuid) to authenticated;
commit;
