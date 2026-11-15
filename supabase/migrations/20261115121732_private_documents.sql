begin;
insert into public.role_permissions(role,permission) select r,p from unnest(array['admin','management']) r cross join unnest(array['contracts.manage','finance.manage']) p on conflict do nothing;
create table public.documents (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references public.profiles(id),
 uploaded_by uuid not null references public.profiles(id),
 scope text not null check(scope in ('personal','room','job_before','job_after')),
 kind text not null default 'material' check(kind in ('material','chat','cv','certificate','contract','invoice')),
 room_id uuid references public.chat_rooms(id),
 job_id uuid references public.jobs(id),
 original_name text not null check(length(original_name) between 1 and 200),
 mime_type text not null,
 size_bytes bigint not null check(size_bytes between 1 and 10485760),
 status text not null default 'quarantined' check(status in ('quarantined','scanning','clean','rejected','scan_error')),
 client_id uuid not null,
 current_version_id uuid,
 created_at timestamptz not null default now(),
 deleted_at timestamptz,
 unique(uploaded_by,client_id),
 check((scope='personal' and room_id is null and job_id is null) or (scope='room' and room_id is not null and job_id is null and kind='chat') or (scope in ('job_before','job_after') and job_id is not null and room_id is null and kind='material'))
);
create table public.document_versions (
 id uuid primary key default gen_random_uuid(),
 document_id uuid not null references public.documents(id),
 uploaded_by uuid not null references public.profiles(id),
 client_id uuid not null,
 version integer not null check(version>0),
 object_path text not null unique,
 original_name text not null,
 mime_type text not null,
 size_bytes bigint not null check(size_bytes between 1 and 10485760),
 sha256 text,
 scanner_version text,
 status text not null default 'quarantined' check(status in ('quarantined','scanning','clean','rejected','scan_error')),
 created_at timestamptz not null default now(),
 unique(uploaded_by,client_id),
 unique(document_id,version)
);
alter table public.documents add constraint documents_current_version_fk foreign key(current_version_id) references public.document_versions(id);
create index documents_owner_created on public.documents(owner_id,created_at desc);
create index documents_room on public.documents(room_id) where room_id is not null;
create index documents_job on public.documents(job_id) where job_id is not null;
create index document_versions_document on public.document_versions(document_id,version desc);
alter table public.documents enable row level security;
alter table public.document_versions enable row level security;
revoke all on public.documents,public.document_versions from anon,authenticated;
grant select on public.documents,public.document_versions to authenticated;
grant all on public.documents,public.document_versions to service_role;

-- PL/pgSQL resolves the chat helper after the following collaboration migration.
-- Personal files grant only specifically named management capabilities; no admin-wide bypass.
create function private.can_access_document(p_id uuid) returns boolean language plpgsql stable security definer set search_path='' as $$
declare d public.documents;
begin
 if not private.actor_active() then return false; end if;
 select * into d from public.documents where id=p_id and deleted_at is null;
 if not found then return false; end if;
 if d.scope='room' then return private.can_access_chat_room(d.room_id); end if;
 if d.scope='personal' then
  return d.owner_id=auth.uid()
   or (d.kind='certificate' and private.has_permission('qualifications.verify'))
   or (d.kind='cv' and private.has_permission('users.manage'))
   or (d.kind='contract' and private.has_permission('contracts.read'))
   or (d.kind='invoice' and private.has_permission('finance.manage'));
 end if;
 if private.has_permission('jobs.manage') then return true; end if;
 if exists(select 1 from public.job_claims c where c.job_id=d.job_id and c.lecturer_id=auth.uid() and c.status='confirmed') then return true; end if;
 return d.scope='job_before' and private.has_role(array['lecturer','senior_lecturer']) and exists(select 1 from public.jobs j where j.id=d.job_id and j.status='published');
end;$$;
create policy documents_read on public.documents for select to authenticated using(private.can_access_document(id));
create policy versions_read on public.document_versions for select to authenticated using(private.can_access_document(document_id));

create function private.reserve_document(p_name text,p_mime text,p_size bigint,p_scope text,p_kind text,p_room_id uuid,p_job_id uuid,p_client_id uuid,p_replace_id uuid default null,p_owner_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); subject uuid:=coalesce(p_owner_id,auth.uid()); d public.documents; existing_v public.document_versions; version_id uuid:=gen_random_uuid(); next_version integer; path text;
begin
 if not private.actor_active() then raise exception 'Active login required' using errcode='42501'; end if;
 if subject<>actor and (p_scope<>'personal' or not exists(select 1 from public.profiles where id=subject and active) or not ((p_kind='contract' and private.has_permission('contracts.manage')) or (p_kind='invoice' and private.has_permission('finance.manage')) or (p_kind='certificate' and private.has_permission('qualifications.verify')) or (p_kind='cv' and private.has_permission('users.manage')))) then raise exception 'Subject upload permission required' using errcode='42501'; end if;
 if p_client_id is null or p_size not between 1 and 10485760 or p_name is null or length(p_name) not between 1 and 200 or p_name~'[[:cntrl:]/\\]' then raise exception 'Invalid file metadata' using errcode='22023'; end if;
 if p_mime not in ('application/pdf','image/png','image/jpeg','image/webp','text/plain','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.openxmlformats-officedocument.presentationml.presentation') then raise exception 'Unsupported file type' using errcode='22023'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('documents:'||actor::text,0));
 select * into existing_v from public.document_versions where uploaded_by=actor and client_id=p_client_id;
 if found then
  select * into d from public.documents where id=existing_v.document_id;
  if not private.can_access_document(d.id) then raise exception 'Access revoked' using errcode='42501'; end if;
  if d.owner_id<>subject or d.kind<>p_kind or existing_v.mime_type<>p_mime or existing_v.original_name<>p_name or existing_v.size_bytes<>p_size or d.scope<>p_scope or d.room_id is distinct from p_room_id or d.job_id is distinct from p_job_id then raise exception 'Idempotency conflict' using errcode='22023'; end if;
  return jsonb_build_object('document_id',d.id,'version_id',existing_v.id,'object_path',existing_v.object_path,'status',existing_v.status);
 end if;
 if (select count(*) from public.document_versions v join public.documents doc on doc.id=v.document_id where v.uploaded_by=actor and v.created_at>now()-interval '1 minute')>=10 then raise exception 'Upload rate limit reached' using errcode='54000'; end if;
 if (select coalesce(sum(v.size_bytes),0) from public.document_versions v join public.documents doc on doc.id=v.document_id where doc.owner_id=subject)+p_size>104857600 then raise exception 'Upload quota reached' using errcode='54000'; end if;
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
create function public.reserve_document(p_name text,p_mime text,p_size bigint,p_scope text,p_kind text,p_room_id uuid,p_job_id uuid,p_client_id uuid,p_replace_id uuid default null,p_owner_id uuid default null)
returns jsonb language sql security invoker set search_path='' as $$ select private.reserve_document(p_name,p_mime,p_size,p_scope,p_kind,p_room_id,p_job_id,p_client_id,p_replace_id,p_owner_id); $$;

create function private.rename_document(p_id uuid,p_name text,p_delete boolean default false) returns void language plpgsql security definer set search_path='' as $$
declare d public.documents;
begin
 select * into d from public.documents where id=p_id for update;
 if not private.actor_active() or not found or d.owner_id<>auth.uid() or not private.can_access_document(p_id) then raise exception 'Owner required' using errcode='42501'; end if;
 if p_name is null or length(trim(p_name)) not between 1 and 200 or p_name~'[[:cntrl:]/\\]' then raise exception 'Invalid name' using errcode='22023'; end if;
 update public.documents set original_name=trim(p_name),deleted_at=case when p_delete then now() else deleted_at end where id=p_id;
 insert into public.audit_events(actor_id,action,resource_id) values(auth.uid(),case when p_delete then 'document.deleted' else 'document.renamed' end,p_id);
end;$$;
create function public.rename_document(p_id uuid,p_name text,p_delete boolean default false) returns void language sql security invoker set search_path='' as $$ select private.rename_document(p_id,p_name,p_delete); $$;

revoke execute on function private.can_access_document(uuid),private.reserve_document(text,text,bigint,text,text,uuid,uuid,uuid,uuid,uuid),public.reserve_document(text,text,bigint,text,text,uuid,uuid,uuid,uuid,uuid),private.rename_document(uuid,text,boolean),public.rename_document(uuid,text,boolean) from public,anon,authenticated;
grant execute on function private.can_access_document(uuid),private.reserve_document(text,text,bigint,text,text,uuid,uuid,uuid,uuid,uuid),public.reserve_document(text,text,bigint,text,text,uuid,uuid,uuid,uuid,uuid),private.rename_document(uuid,text,boolean),public.rename_document(uuid,text,boolean) to authenticated;

-- API clients cannot read/write storage.objects directly, even for clean files.
-- Authenticated download goes through the Edge boundary so every read rechecks live
-- ownership/membership; no irrevocable signed link survives room removal.
-- The standalone SQL harness omits the external Storage service and tests its own RLS
-- separately; full-stack tests exercise both actual buckets and binary object access.
do $$ begin
 if to_regclass('storage.buckets') is not null then
  insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
   ('portal-quarantine','portal-quarantine',false,10485760,null),
   ('portal-clean','portal-clean',false,10485760,null)
  on conflict(id) do nothing;
 end if;
 if to_regclass('storage.objects') is not null and not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='portal_files_no_direct_access') then
  execute $policy$create policy portal_files_no_direct_access on storage.objects as restrictive for all to anon,authenticated using(bucket_id not in ('portal-clean','portal-quarantine')) with check(bucket_id not in ('portal-clean','portal-quarantine'))$policy$;
 end if;
end;$$;
commit;
