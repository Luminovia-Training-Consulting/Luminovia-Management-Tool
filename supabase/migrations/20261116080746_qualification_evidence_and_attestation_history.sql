begin;
-- A topic grant pins one clean certificate VERSION. It never widens document RLS.
create table private.qualification_states(
 user_id uuid not null references public.profiles(id) on delete cascade, topic_id uuid not null references public.topics(id),
 version integer not null default 0 check(version>=0), evidence_id uuid,
 primary key(user_id,topic_id)
);
create table private.qualification_evidence(
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade,
 topic_id uuid not null references public.topics(id), document_version_id uuid not null references public.document_versions(id) on delete cascade,
 sha256 text not null check(sha256~'^[0-9a-f]{64}$'), created_at timestamptz not null default clock_timestamp(), withdrawn_at timestamptz
);
alter table private.qualification_states add foreign key(evidence_id) references private.qualification_evidence(id) on delete set null;
create index qualification_states_topic on private.qualification_states(topic_id);
create index qualification_states_evidence on private.qualification_states(evidence_id);
create index qualification_evidence_topic on private.qualification_evidence(topic_id);
create index qualification_evidence_version on private.qualification_evidence(document_version_id);
create index qualification_evidence_owner on private.qualification_evidence(user_id,topic_id) where withdrawn_at is null;
create table private.qualification_events(
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade,
 topic_id uuid not null references public.topics(id), actor_id uuid references public.profiles(id) on delete set null,
 action text not null check(action in('bind','withdraw','deselect','attest')), version integer not null,
 evidence_id uuid references private.qualification_evidence(id) on delete cascade,
 verified boolean, valid_until timestamptz, basis text check(basis in('management_attestation','document_evidence')),
 created_at timestamptz not null default clock_timestamp(), unique(user_id,topic_id,version)
);
create index qualification_events_cursor on private.qualification_events(user_id,topic_id,created_at desc,id desc);
create index qualification_events_topic on private.qualification_events(topic_id);
create index qualification_events_evidence on private.qualification_events(evidence_id);
create index qualification_events_actor_rate on private.qualification_events(actor_id,created_at desc);
create table private.qualification_requests(
 actor_id uuid not null references public.profiles(id) on delete cascade,request_id uuid not null,request_hash text not null,
 primary key(actor_id,request_id)
);
alter table private.qualification_states enable row level security;
alter table private.qualification_evidence enable row level security;
alter table private.qualification_events enable row level security;
alter table private.qualification_requests enable row level security;
revoke all on private.qualification_states,private.qualification_evidence,private.qualification_events,private.qualification_requests from public,anon,authenticated;
grant all on private.qualification_states,private.qualification_evidence,private.qualification_events,private.qualification_requests to service_role;

-- CV/users.manage, contract and finance policies deliberately retain their
-- independent pre-existing meaning. Qualification review grants no document row.
create or replace function private.can_access_document(p_id uuid) returns boolean language plpgsql stable security definer set search_path='' as $$
declare d public.documents;
begin
 if not private.actor_active() then return false;end if;
 select * into d from public.documents where id=p_id and deleted_at is null;if not found then return false;end if;
 if d.scope='room' then return private.can_access_chat_room(d.room_id);end if;
 if d.scope='personal' then return d.owner_id=auth.uid()
  or(d.kind='cv' and private.has_permission('users.manage'))
  or(d.kind='contract' and private.has_permission('contracts.read'))
  or(d.kind='invoice' and private.has_permission('finance.manage'));end if;
 if private.has_permission('jobs.manage') then return true;end if;
 if exists(select 1 from public.job_claims c where c.job_id=d.job_id and c.lecturer_id=auth.uid() and c.status='confirmed') then return true;end if;
 return d.scope='job_before' and private.lecturer_actor() and exists(select 1 from public.jobs j where j.id=d.job_id and j.status='published');
end;$$;

create function private.qualification_reader(p_user uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.actor_active() and exists(select 1 from public.profiles where id=p_user and active) and private.lecturer_user(p_user)
 and(p_user=auth.uid() or private.has_permission('qualifications.verify'));
$$;
create function private.lock_qualification_actor(p_user uuid,p_manager boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 -- This statement must finish BEFORE the fresh permission lookup: role changes
 -- lock this same profile FOR UPDATE. An old JWT never supplies role authority.
 perform 1 from public.profiles where id=auth.uid() and active for share;
 if not found then raise exception 'Active account required' using errcode='42501';end if;
 if p_manager then
  if not private.has_permission('qualifications.verify') then raise exception 'Qualification permission and MFA required' using errcode='42501';end if;
 elsif auth.uid() is distinct from p_user or not private.lecturer_actor() then raise exception 'Own lecturer account required' using errcode='42501';end if;
 perform 1 from public.profiles where id=p_user and active for share;
 if not found or not private.lecturer_user(p_user) then raise exception 'An active lecturer is required' using errcode='22023';end if;
end;$$;
create function private.qualification_record(p_user uuid,p_topic uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare evidence jsonb; result jsonb;
begin
 if not private.qualification_reader(p_user) then raise exception 'Qualification access denied' using errcode='42501';end if;
 select jsonb_build_object('id',e.id,'version_id',v.id,'document_id',v.document_id,'name',v.original_name,'sha256',e.sha256,'created_at',e.created_at)
 into evidence from private.qualification_states s join private.qualification_evidence e on e.id=s.evidence_id
 join public.document_versions v on v.id=e.document_version_id join public.documents d on d.id=v.document_id
 where s.user_id=p_user and s.topic_id=p_topic and e.withdrawn_at is null and d.deleted_at is null
 and d.owner_id=p_user and d.kind='certificate' and d.scope='personal' and v.status='clean' and v.sha256=e.sha256;
 select jsonb_build_object('user_id',t.user_id,'topic_id',t.topic_id,'version',coalesce(s.version,0),
 'verified',t.verified,'valid_until',t.valid_until,'evidence',evidence)
 into result from public.lecturer_topics t left join private.qualification_states s using(user_id,topic_id) where t.user_id=p_user and t.topic_id=p_topic;
 if result is null then raise exception 'Selected topic required' using errcode='22023';end if;return result;
end;$$;
create function public.qualification_review(p_user_id uuid,p_topic_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$select private.qualification_record(p_user_id,p_topic_id);$$;

create function private.own_qualification_certificates(p_search text default '',p_before_at timestamptz default null,p_before_id uuid default null,p_limit integer default 20)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare rows jsonb;more boolean;cursor jsonb;
begin
 if not private.actor_active() or not private.lecturer_actor() then raise exception 'Lecturer account required' using errcode='42501';end if;
 if p_search is null or length(p_search)>160 or p_limit is null or p_limit not between 1 and 50
 or((p_before_at is null)<>(p_before_id is null)) or(p_before_at is not null and not isfinite(p_before_at)) then raise exception 'Invalid certificate cursor' using errcode='22023';end if;
 with page as materialized(select v.id version_id,v.document_id,v.original_name name,v.sha256,v.version,v.created_at
 from public.documents d join public.document_versions v on v.document_id=d.id
 where d.owner_id=auth.uid() and d.scope='personal' and d.kind='certificate' and d.deleted_at is null and v.status='clean' and v.sha256~'^[0-9a-f]{64}$'
 and(p_search='' or strpos(lower(v.original_name),lower(p_search))>0) and(p_before_at is null or(v.created_at,v.id)<(p_before_at,p_before_id))
 order by v.created_at desc,v.id desc limit p_limit+1),visible as(select * from page order by created_at desc,version_id desc limit p_limit)
 select coalesce((select jsonb_agg(to_jsonb(v) order by v.created_at desc,v.version_id desc) from visible v),'[]'::jsonb),
 (select count(*)>p_limit from page),(select jsonb_build_object('at',created_at,'id',version_id) from visible order by created_at,version_id limit 1) into rows,more,cursor;
 return jsonb_build_object('items',rows,'has_more',more,'next_cursor',case when more then cursor end);
end;$$;
create function public.own_qualification_certificates(p_search text default '',p_before_at timestamptz default null,p_before_id uuid default null,p_limit integer default 20)
returns jsonb language sql stable security invoker set search_path='' as $$select private.own_qualification_certificates(p_search,p_before_at,p_before_id,p_limit);$$;

create function private.save_qualification_evidence(p_topic_id uuid,p_version_id uuid,p_expected_version integer,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();s private.qualification_states;v public.document_versions;d public.documents;e uuid;result jsonb;fingerprint text;previous private.qualification_requests;
begin
 perform private.lock_qualification_actor(actor,false);
 if p_request_id is null or p_topic_id is null or p_expected_version is null or p_expected_version<0 then raise exception 'Version and request required' using errcode='22023';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('qualification-request:'||actor::text,0));
 fingerprint:=md5(jsonb_build_array('evidence',p_topic_id,p_version_id,p_expected_version)::text);
 select * into previous from private.qualification_requests where actor_id=actor and request_id=p_request_id;
 if found then if previous.request_hash<>fingerprint then raise exception 'Idempotency conflict' using errcode='22023';end if;return private.qualification_record(actor,p_topic_id);end if;
 perform 1 from public.lecturer_topics where user_id=actor and topic_id=p_topic_id for update;
 if not found then raise exception 'Selected topic required' using errcode='22023';end if;
 insert into private.qualification_states(user_id,topic_id) values(actor,p_topic_id) on conflict do nothing;
 select * into s from private.qualification_states where user_id=actor and topic_id=p_topic_id for update;
 if (select count(*) from private.qualification_events where actor_id=actor and created_at>clock_timestamp()-interval '1 minute')>=30 then raise exception 'Qualification rate limit' using errcode='54000';end if;
 if s.version<>p_expected_version then raise exception 'Qualification version conflict' using errcode='40001';end if;
 if p_version_id is not null then
  select doc.* into d from public.documents doc join public.document_versions ver on ver.document_id=doc.id where ver.id=p_version_id for share of doc;
  if not found or d.owner_id<>actor or d.scope<>'personal' or d.kind<>'certificate' or d.deleted_at is not null then raise exception 'Own certificate required' using errcode='42501';end if;
  select * into v from public.document_versions where id=p_version_id for share;
  if v.status<>'clean' or v.sha256 is null or v.sha256!~'^[0-9a-f]{64}$' then raise exception 'Clean certificate version required' using errcode='22023';end if;
 end if;
 if s.evidence_id is not null then update private.qualification_evidence set withdrawn_at=clock_timestamp() where id=s.evidence_id;end if;
 if p_version_id is not null then insert into private.qualification_evidence(user_id,topic_id,document_version_id,sha256) values(actor,p_topic_id,v.id,v.sha256) returning id into e;end if;
 update private.qualification_states set version=version+1,evidence_id=e where user_id=actor and topic_id=p_topic_id;
 insert into private.qualification_events(user_id,topic_id,actor_id,action,version,evidence_id) values(actor,p_topic_id,actor,case when e is null then 'withdraw' else 'bind' end,s.version+1,coalesce(e,s.evidence_id));
 result:=private.qualification_record(actor,p_topic_id);
 insert into private.qualification_requests values(actor,p_request_id,fingerprint);return result;
end;$$;
create function public.save_qualification_evidence(p_topic_id uuid,p_version_id uuid,p_expected_version integer,p_request_id uuid) returns jsonb language sql security invoker set search_path='' as $$select private.save_qualification_evidence(p_topic_id,p_version_id,p_expected_version,p_request_id);$$;

create function private.attest_qualification(p_user_id uuid,p_topic_id uuid,p_verified boolean,p_valid_until timestamptz,p_evidence_id uuid,p_expected_version integer,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.qualification_states;t public.lecturer_topics;result jsonb;fingerprint text;previous private.qualification_requests;proof jsonb;expiry timestamptz;
begin
 perform private.lock_qualification_actor(p_user_id,true);
 if p_verified is null then raise exception 'Verification decision required' using errcode='22023';end if;
 if p_verified and p_valid_until is not null and p_valid_until<=now() then raise exception 'Verification expiry must be in the future' using errcode='22023';end if;
 if p_topic_id is null or(p_valid_until is not null and not isfinite(p_valid_until)) or(p_evidence_id is not null and not p_verified) then raise exception 'Invalid verification decision' using errcode='22023';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('qualification-request:'||auth.uid()::text,0));
 fingerprint:=md5(jsonb_build_array('attest',p_user_id,p_topic_id,p_verified,p_valid_until,p_evidence_id,p_expected_version)::text);
 if p_request_id is not null then
  select * into previous from private.qualification_requests where actor_id=auth.uid() and request_id=p_request_id;
  if found then if previous.request_hash<>fingerprint then raise exception 'Idempotency conflict' using errcode='22023';end if;return private.qualification_record(p_user_id,p_topic_id);end if;
 end if;
 if (select count(*) from private.qualification_events where actor_id=auth.uid() and created_at>clock_timestamp()-interval '1 minute')>=30 then raise exception 'Qualification rate limit' using errcode='54000';end if;
 select * into t from public.lecturer_topics where user_id=p_user_id and topic_id=p_topic_id for update;
 if not found then raise exception 'The lecturer must select this expertise first' using errcode='22023';end if;
 insert into private.qualification_states(user_id,topic_id) values(p_user_id,p_topic_id) on conflict do nothing;
 select * into s from private.qualification_states where user_id=p_user_id and topic_id=p_topic_id for update;
 if p_expected_version is not null and(p_expected_version<0 or s.version<>p_expected_version) then raise exception 'Qualification version conflict' using errcode='40001';end if;
 if p_evidence_id is not null then
  proof:=private.qualification_record(p_user_id,p_topic_id)->'evidence';
  if proof is null or proof='null'::jsonb or(proof->>'id')::uuid<>p_evidence_id then raise exception 'Current shared certificate required' using errcode='42501';end if;
  perform 1 from public.documents where id=(proof->>'document_id')::uuid and deleted_at is null for share;
  if not found then raise exception 'Certificate unavailable' using errcode='42501';end if;
 end if;
 expiry:=case when p_verified then p_valid_until end;
 update public.lecturer_topics set verified=p_verified,valid_until=expiry where user_id=p_user_id and topic_id=p_topic_id;
 update private.qualification_states set version=version+1 where user_id=p_user_id and topic_id=p_topic_id;
 insert into private.qualification_events(user_id,topic_id,actor_id,action,version,evidence_id,verified,valid_until,basis)
 values(p_user_id,p_topic_id,auth.uid(),'attest',s.version+1,p_evidence_id,p_verified,expiry,case when p_evidence_id is null then 'management_attestation' else 'document_evidence' end);
 insert into public.audit_events(actor_id,action,resource_id,details) values(auth.uid(),'qualification.attested',p_user_id,jsonb_build_object('topic_id',p_topic_id,'previous_verified',t.verified,'previous_valid_until',t.valid_until,'verified',p_verified,'valid_until',expiry,'basis',case when p_evidence_id is null then 'management_attestation' else 'document_evidence' end));
 result:=private.qualification_record(p_user_id,p_topic_id);
 if p_request_id is not null then insert into private.qualification_requests values(auth.uid(),p_request_id,fingerprint);end if;return result;
end;$$;
create function public.attest_qualification(p_user_id uuid,p_topic_id uuid,p_verified boolean,p_valid_until timestamptz,p_evidence_id uuid,p_expected_version integer,p_request_id uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 if p_request_id is null or p_expected_version is null then raise exception 'Version and request required' using errcode='22023';end if;
 return private.attest_qualification(p_user_id,p_topic_id,p_verified,p_valid_until,p_evidence_id,p_expected_version,p_request_id);
end;$$;
create or replace function private.verify_lecturer_topic(p_user_id uuid,p_topic_id uuid,p_verified boolean,p_valid_until timestamptz default null)
returns void language plpgsql security definer set search_path='' as $$
begin perform private.attest_qualification(p_user_id,p_topic_id,p_verified,p_valid_until,null,null,null);end;$$;

create function private.qualification_evidence_access(p_evidence_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare e private.qualification_evidence;record jsonb;
begin
 select * into e from private.qualification_evidence where id=p_evidence_id and withdrawn_at is null;
 if not found then raise exception 'Evidence access denied' using errcode='42501';end if;
 record:=private.qualification_record(e.user_id,e.topic_id)->'evidence';
 if record is null or record='null'::jsonb or(record->>'id')::uuid<>p_evidence_id then raise exception 'Evidence access denied' using errcode='42501';end if;
 return record||jsonb_build_object('user_id',e.user_id);
end;$$;
create function public.qualification_evidence_access(p_evidence_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$select private.qualification_evidence_access(p_evidence_id);$$;
create function private.qualification_history(p_user_id uuid,p_topic_id uuid,p_before_at timestamptz default null,p_before_id uuid default null,p_limit integer default 20) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare rows jsonb;more boolean;cursor jsonb;
begin
 if not private.qualification_reader(p_user_id) then raise exception 'Qualification access denied' using errcode='42501';end if;
 if p_limit is null or p_limit not between 1 and 50 or((p_before_at is null)<>(p_before_id is null)) or(p_before_at is not null and not isfinite(p_before_at)) then raise exception 'Invalid history cursor' using errcode='22023';end if;
 with page as materialized(select e.id,e.action,e.version,e.evidence_id,e.verified,e.valid_until,e.basis,e.created_at,p.display_name actor_name
 from private.qualification_events e left join public.profiles p on p.id=e.actor_id where e.user_id=p_user_id and e.topic_id=p_topic_id
 and(p_before_at is null or(e.created_at,e.id)<(p_before_at,p_before_id)) order by e.created_at desc,e.id desc limit p_limit+1),visible as(select * from page order by created_at desc,id desc limit p_limit)
 select coalesce((select jsonb_agg(to_jsonb(v) order by v.created_at desc,v.id desc) from visible v),'[]'::jsonb),(select count(*)>p_limit from page),
 (select jsonb_build_object('at',created_at,'id',id) from visible order by created_at,id limit 1) into rows,more,cursor;
 return jsonb_build_object('items',rows,'has_more',more,'next_cursor',case when more then cursor end);
end;$$;
create function public.qualification_history(p_user_id uuid,p_topic_id uuid,p_before_at timestamptz default null,p_before_id uuid default null,p_limit integer default 20) returns jsonb language sql stable security invoker set search_path='' as $$select private.qualification_history(p_user_id,p_topic_id,p_before_at,p_before_id,p_limit);$$;

-- A removed expertise must not resurrect a historic certificate grant on re-add.
create function private.withdraw_deselected_qualification() returns trigger language plpgsql security definer set search_path='' as $$
declare s private.qualification_states;
begin
 -- Auth/profile purge is server-only; do not recreate history during its cascade.
 if not exists(select 1 from public.profiles where id=old.user_id) then return old;end if;
 select * into s from private.qualification_states where user_id=old.user_id and topic_id=old.topic_id for update;
 if found then
  update private.qualification_evidence set withdrawn_at=clock_timestamp() where id=s.evidence_id and withdrawn_at is null;
  update private.qualification_states set version=version+1,evidence_id=null where user_id=old.user_id and topic_id=old.topic_id;
  insert into private.qualification_events(user_id,topic_id,actor_id,action,version,evidence_id) values(old.user_id,old.topic_id,auth.uid(),'deselect',s.version+1,s.evidence_id);
 end if;return old;
end;$$;
create trigger qualification_deselected after delete on public.lecturer_topics for each row execute function private.withdraw_deselected_qualification();

revoke all on function private.qualification_reader(uuid),private.lock_qualification_actor(uuid,boolean),private.withdraw_deselected_qualification() from public,anon,authenticated;
revoke all on function private.qualification_record(uuid,uuid),private.own_qualification_certificates(text,timestamptz,uuid,integer),private.save_qualification_evidence(uuid,uuid,integer,uuid),private.attest_qualification(uuid,uuid,boolean,timestamptz,uuid,integer,uuid),private.qualification_evidence_access(uuid),private.qualification_history(uuid,uuid,timestamptz,uuid,integer) from public,anon,authenticated;
grant execute on function private.qualification_record(uuid,uuid),private.own_qualification_certificates(text,timestamptz,uuid,integer),private.save_qualification_evidence(uuid,uuid,integer,uuid),private.attest_qualification(uuid,uuid,boolean,timestamptz,uuid,integer,uuid),private.qualification_evidence_access(uuid),private.qualification_history(uuid,uuid,timestamptz,uuid,integer) to authenticated;
revoke all on function public.qualification_review(uuid,uuid),public.own_qualification_certificates(text,timestamptz,uuid,integer),public.save_qualification_evidence(uuid,uuid,integer,uuid),public.attest_qualification(uuid,uuid,boolean,timestamptz,uuid,integer,uuid),public.qualification_evidence_access(uuid),public.qualification_history(uuid,uuid,timestamptz,uuid,integer) from public,anon;
grant execute on function public.qualification_review(uuid,uuid),public.own_qualification_certificates(text,timestamptz,uuid,integer),public.save_qualification_evidence(uuid,uuid,integer,uuid),public.attest_qualification(uuid,uuid,boolean,timestamptz,uuid,integer,uuid),public.qualification_evidence_access(uuid),public.qualification_history(uuid,uuid,timestamptz,uuid,integer) to authenticated;
-- Foreign certificate uploads cannot create a reservation the stricter caller
-- can no longer read. All other upload scopes, quotas and retries are unchanged.
create or replace function private.reserve_document(p_name text,p_mime text,p_size bigint,p_scope text,p_kind text,p_room_id uuid,p_job_id uuid,p_client_id uuid,p_replace_id uuid default null,p_owner_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); subject uuid:=coalesce(p_owner_id,auth.uid()); d public.documents; existing_v public.document_versions; version_id uuid:=gen_random_uuid(); next_version integer; path text; limits private.document_storage_limits;
begin
 if not private.actor_active() then raise exception 'Active login required' using errcode='42501'; end if;
 if subject<>actor and (p_scope<>'personal' or not exists(select 1 from public.profiles where id=subject and active) or not ((p_kind='contract' and private.has_permission('contracts.manage')) or (p_kind='invoice' and private.has_permission('finance.manage')) or (p_kind='cv' and private.has_permission('users.manage')))) then raise exception 'Subject upload permission required' using errcode='42501'; end if;
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
