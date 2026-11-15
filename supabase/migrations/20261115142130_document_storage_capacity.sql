begin;
-- Fixed application file ceiling: 100 MiB. The shared allocation is configurable
-- only by a trusted server operator; browser roles cannot read or alter it.
create table private.document_storage_limits (
 singleton boolean primary key default true check(singleton),
 total_quota_bytes bigint not null default 107374182400 check(total_quota_bytes > 0),
 owner_quota_bytes bigint not null default 10737418240 check(owner_quota_bytes > 0 and owner_quota_bytes <= total_quota_bytes)
);
alter table private.document_storage_limits enable row level security;
revoke all on private.document_storage_limits from public,anon,authenticated,service_role;
grant select,update on private.document_storage_limits to service_role;
insert into private.document_storage_limits(singleton) values(true);
comment on table private.document_storage_limits is 'Operator-only logical allocation. Defaults: 100 GiB shared across all document versions, 10 GiB per owner. This does not allocate disk or configure object-store capacity; physical headroom/backups remain operational requirements.';
alter table public.documents drop constraint documents_size_bytes_check;
alter table public.documents add constraint documents_size_bytes_check check(size_bytes between 1 and 104857600);
alter table public.document_versions drop constraint document_versions_size_bytes_check;
alter table public.document_versions add constraint document_versions_size_bytes_check check(size_bytes between 1 and 104857600);
-- The disposable SQL harness has no external Storage schema. Actual environments
-- must admit the same file ceiling at both private object buckets.
do $$begin
 if to_regclass('storage.buckets') is not null then
  update storage.buckets set file_size_limit=104857600 where id in ('portal-quarantine','portal-clean');
 end if;
end;$$;

create or replace function private.reserve_document(p_name text,p_mime text,p_size bigint,p_scope text,p_kind text,p_room_id uuid,p_job_id uuid,p_client_id uuid,p_replace_id uuid default null,p_owner_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); subject uuid:=coalesce(p_owner_id,auth.uid()); d public.documents; existing_v public.document_versions; version_id uuid:=gen_random_uuid(); next_version integer; path text; limits private.document_storage_limits;
begin
 if not private.actor_active() then raise exception 'Active login required' using errcode='42501'; end if;
 if subject<>actor and (p_scope<>'personal' or not exists(select 1 from public.profiles where id=subject and active) or not ((p_kind='contract' and private.has_permission('contracts.manage')) or (p_kind='invoice' and private.has_permission('finance.manage')) or (p_kind='certificate' and private.has_permission('qualifications.verify')) or (p_kind='cv' and private.has_permission('users.manage')))) then raise exception 'Subject upload permission required' using errcode='42501'; end if;
 if p_client_id is null or p_size not between 1 and 104857600 or p_name is null or length(p_name) not between 1 and 200 or p_name~'[[:cntrl:]/\\]' then raise exception 'Invalid file metadata' using errcode='22023'; end if;
 if p_mime not in ('application/pdf','image/png','image/jpeg','image/webp','text/plain','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.openxmlformats-officedocument.presentationml.presentation') then raise exception 'Unsupported file type' using errcode='22023'; end if;
 -- Global -> actor -> owner is the consistent reservation lock order.
 -- Global locking also serializes different owners near the shared capacity.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('documents-global-quota',0));
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('documents:'||actor::text,0));
 -- The quota is per owner, including concurrent uploads on that owner's behalf.
 -- The distinct actor/owner namespaces preserve existing idempotency/rate safety.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('documents-quota:'||subject::text,0));
 select * into existing_v from public.document_versions where uploaded_by=actor and client_id=p_client_id;
 if found then
  select * into d from public.documents where id=existing_v.document_id;
  if not private.can_access_document(d.id) then raise exception 'Access revoked' using errcode='42501'; end if;
  -- Creation retries cannot be reinterpreted as a replacement, or vice versa.
  if (existing_v.version=1) is distinct from (p_replace_id is null)
   or (p_replace_id is not null and p_replace_id is distinct from existing_v.document_id) then raise exception 'Idempotency replacement target conflict' using errcode='22023'; end if;
  if d.owner_id<>subject or d.kind<>p_kind or existing_v.mime_type<>p_mime or existing_v.original_name<>p_name or existing_v.size_bytes<>p_size or d.scope<>p_scope or d.room_id is distinct from p_room_id or d.job_id is distinct from p_job_id then raise exception 'Idempotency conflict' using errcode='22023'; end if;
  return jsonb_build_object('document_id',d.id,'version_id',existing_v.id,'object_path',existing_v.object_path,'status',existing_v.status);
 end if;
 if (select count(*) from public.document_versions v join public.documents doc on doc.id=v.document_id where v.uploaded_by=actor and v.created_at>now()-interval '1 minute')>=10 then raise exception 'Upload rate limit reached' using errcode='54000'; end if;
 -- Count every reserved version, including quarantine, rejected and archived
 -- documents. Replacement/failed-upload history cannot silently free capacity.
 -- Matching retries above consume no second reservation even after a quota change.
 select * into strict limits from private.document_storage_limits where singleton for share;
 if (select coalesce(sum(v.size_bytes),0) from public.document_versions v join public.documents doc on doc.id=v.document_id where doc.owner_id=subject)+p_size>limits.owner_quota_bytes then raise exception 'Upload quota reached' using errcode='54000'; end if;
 if (select coalesce(sum(v.size_bytes),0) from public.document_versions v)+p_size>limits.total_quota_bytes then raise exception 'Global upload quota reached' using errcode='54000'; end if;
 if p_scope='room' then
  if p_kind<>'chat' or p_job_id is not null or not private.can_access_chat_room(p_room_id) then raise exception 'Room access required' using errcode='42501'; end if;
 elsif p_scope in ('job_before','job_after') then
  if p_kind<>'material' or p_room_id is not null or not private.has_permission('jobs.manage') or not exists(select 1 from public.jobs where id=p_job_id) then raise exception 'Job administration required' using errcode='42501'; end if;
 elsif p_scope<>'personal' or p_room_id is not null or p_job_id is not null then raise exception 'Invalid scope' using errcode='22023';
 end if;
 if p_replace_id is not null then
  select * into d from public.documents where id=p_replace_id for update;
  if not found or (d.owner_id<>actor and d.uploaded_by<>actor) or d.owner_id<>subject or not private.can_access_document(d.id) then raise exception 'Owner required' using errcode='42501'; end if;
  if d.scope<>p_scope or d.kind<>p_kind or d.room_id is distinct from p_room_id or d.job_id is distinct from p_job_id then raise exception 'Replacement cannot change access scope' using errcode='22023'; end if;
  next_version=(select max(version)+1 from public.document_versions where document_id=d.id);
  update public.documents set status='quarantined',original_name=p_name,mime_type=p_mime,size_bytes=p_size where id=d.id returning * into d;
 else
  insert into public.documents(owner_id,uploaded_by,scope,kind,room_id,job_id,original_name,mime_type,size_bytes,client_id)
  values(subject,actor,p_scope,p_kind,p_room_id,p_job_id,p_name,p_mime,p_size,p_client_id) returning * into d;
  next_version=1;
 end if;
 path=actor::text||'/'||d.id::text||'/'||version_id::text;
 insert into public.document_versions(id,document_id,version,object_path,original_name,mime_type,size_bytes,uploaded_by,client_id) values(version_id,d.id,next_version,path,p_name,p_mime,p_size,actor,p_client_id);
 update public.documents set current_version_id=version_id where id=d.id;
 insert into public.audit_events(actor_id,action,resource_id,details) values(actor,'document.quarantined',d.id,jsonb_build_object('version',next_version,'scope',p_scope));
 return jsonb_build_object('document_id',d.id,'version_id',version_id,'object_path',path,'status','quarantined');
end;$$;
commit;
