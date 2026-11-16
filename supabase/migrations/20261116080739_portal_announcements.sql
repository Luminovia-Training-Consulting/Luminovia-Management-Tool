begin;
insert into public.role_permissions(role,permission) values('owner','announcements.manage'),('admin','announcements.manage'),('management','announcements.manage') on conflict do nothing;

-- Draft and current publication are independent pointers. Saving an immutable
-- draft revision cannot change the body/audience/time window currently visible.
create table private.portal_announcements(
 id uuid primary key default gen_random_uuid(),created_by uuid not null references public.profiles(id),
 version integer not null default 1 check(version>0),draft_revision_id uuid,published_revision_id uuid,
 archived_at timestamptz,updated_at timestamptz not null default clock_timestamp()
);
create index announcement_admin_cursor on private.portal_announcements(updated_at desc,id desc);
create index announcement_current_publication on private.portal_announcements(published_revision_id) where archived_at is null;
create table private.announcement_revisions(
 id uuid primary key default gen_random_uuid(),announcement_id uuid not null references private.portal_announcements(id) on delete cascade,
 revision integer not null check(revision>0),title_de text not null check(length(trim(title_de)) between 1 and 200),title_en text not null check(length(trim(title_en)) between 1 and 200),
 body_de text not null check(length(trim(body_de)) between 1 and 8000),body_en text not null check(length(trim(body_en)) between 1 and 8000),
 important boolean not null,audience_roles text[] not null default '{}',starts_at timestamptz not null,ends_at timestamptz not null,time_zone text not null,
 created_by uuid not null references public.profiles(id),created_at timestamptz not null default clock_timestamp(),
 unique(announcement_id,revision),unique(announcement_id,id),
 check(isfinite(starts_at) and isfinite(ends_at) and ends_at>starts_at)
);
alter table private.portal_announcements add foreign key(id,draft_revision_id) references private.announcement_revisions(announcement_id,id) deferrable initially deferred;
alter table private.portal_announcements add foreign key(id,published_revision_id) references private.announcement_revisions(announcement_id,id) deferrable initially deferred;
create table private.announcement_publications(
 revision_id uuid primary key references private.announcement_revisions(id) on delete cascade,
 published_by uuid not null references public.profiles(id),published_at timestamptz not null default clock_timestamp()
);
create index announcement_publication_cursor on private.announcement_publications(published_at desc,revision_id desc);
create table private.announcement_acknowledgements(
 user_id uuid not null references public.profiles(id) on delete cascade,revision_id uuid not null references private.announcement_revisions(id) on delete cascade,
 acknowledged_at timestamptz not null default clock_timestamp(),primary key(user_id,revision_id)
);
create table private.announcement_requests(
 actor_id uuid not null references public.profiles(id) on delete cascade,request_id uuid not null,payload jsonb not null,result jsonb not null,
 created_at timestamptz not null default clock_timestamp(),primary key(actor_id,request_id)
);
do $$declare t text;begin foreach t in array array['portal_announcements','announcement_revisions','announcement_publications','announcement_acknowledgements','announcement_requests'] loop
 execute format('alter table private.%I enable row level security',t);
 execute format('revoke all on private.%I from public,anon,authenticated',t);
end loop;end;$$;
create function private.immutable_announcement_snapshot() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Published and draft snapshots are immutable; save a new revision' using errcode='22023';end;$$;
create trigger immutable_announcement_revision before update on private.announcement_revisions for each row execute function private.immutable_announcement_snapshot();
create trigger immutable_announcement_publication before update on private.announcement_publications for each row execute function private.immutable_announcement_snapshot();

create function private.can_read_announcement_revision(p_revision_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.actor_active() and exists(select 1 from private.announcement_revisions r join private.portal_announcements a on a.published_revision_id=r.id
 join private.announcement_publications p on p.revision_id=r.id
 where r.id=p_revision_id and a.archived_at is null and r.starts_at<=now() and r.ends_at>now()
 and (cardinality(r.audience_roles)=0 or exists(select 1 from public.user_roles role where role.user_id=auth.uid() and role.role=any(r.audience_roles))));
$$;
create function private.announcement_admin_record(p_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',a.id,'version',a.version,'archived_at',a.archived_at,'updated_at',a.updated_at,
 'draft',(select to_jsonb(r) from private.announcement_revisions r where r.id=a.draft_revision_id),
 'published',(select to_jsonb(r)||jsonb_build_object('published_at',p.published_at) from private.announcement_revisions r join private.announcement_publications p on p.revision_id=r.id where r.id=a.published_revision_id))
 from private.portal_announcements a where a.id=p_id;
$$;
create function private.admin_announcement(p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not private.has_permission('announcements.manage') then raise exception 'Announcement management and MFA required' using errcode='42501';end if;
 result=private.announcement_admin_record(p_id);if result is null then raise exception 'Announcement unavailable' using errcode='42501';end if;return result;
end;$$;
create function public.admin_announcement(p_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$select private.admin_announcement(p_id);$$;

create function private.manage_announcement(p_id uuid,p_action text,p_expected_version integer,p_request_id uuid,p_payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare a private.portal_announcements;r private.announcement_revisions;prior private.announcement_requests;parameters jsonb;result jsonb;
 target uuid:=p_id;new_revision uuid;roles text[];starts timestamptz;ends timestamptz;k text;
begin
 perform 1 from public.profiles where id=auth.uid() and active for share;
 if not found then raise exception 'Account inactive' using errcode='42501';end if;
 perform 1 from public.user_roles where user_id=auth.uid() order by role for share;
 if not private.has_permission('announcements.manage') then raise exception 'Announcement management and MFA required' using errcode='42501';end if;
 if p_action is null or p_action not in('save','publish','archive','recover') or p_expected_version is null or p_expected_version<0 or p_request_id is null or jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Invalid announcement operation' using errcode='22023';end if;
 if p_action<>'save' and p_payload<>'{}'::jsonb then raise exception 'Unexpected operation payload' using errcode='22023';end if;
 parameters=jsonb_build_object('id',p_id,'action',p_action,'version',p_expected_version,'payload',p_payload);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('announcement-request:'||auth.uid()::text||p_request_id::text,0));
 select * into prior from private.announcement_requests where actor_id=auth.uid() and request_id=p_request_id;
 if found then if prior.payload<>parameters then raise exception 'Announcement request idempotency conflict' using errcode='22023';end if;return prior.result;end if;
 if target is null then
  if p_action<>'save' or p_expected_version<>0 then raise exception 'New announcement requires a draft' using errcode='22023';end if;
  insert into private.portal_announcements(created_by) values(auth.uid()) returning * into a;target=a.id;
 else
  select * into a from private.portal_announcements where id=target for update;
  if not found then raise exception 'Announcement unavailable' using errcode='42501';end if;
  if a.version<>p_expected_version then raise exception 'Announcement changed; reload before saving' using errcode='40001';end if;
 end if;
 if p_action='save' then
  if a.archived_at is not null then raise exception 'Recover before editing an archived announcement' using errcode='22023';end if;
  if (select count(*) from jsonb_object_keys(p_payload))<>9 or exists(select 1 from jsonb_object_keys(p_payload) key where key not in('title_de','title_en','body_de','body_en','important','audience_roles','starts_at','ends_at','time_zone')) then raise exception 'Invalid draft fields' using errcode='22023';end if;
  foreach k in array array['title_de','title_en','body_de','body_en','starts_at','ends_at','time_zone'] loop if jsonb_typeof(p_payload->k) is distinct from 'string' then raise exception 'Draft text and instants required' using errcode='22023';end if;end loop;
  if jsonb_typeof(p_payload->'important') is distinct from 'boolean' or jsonb_typeof(p_payload->'audience_roles') is distinct from 'array' or jsonb_array_length(p_payload->'audience_roles')>7
   or exists(select 1 from jsonb_array_elements(p_payload->'audience_roles') value where jsonb_typeof(value)<>'string' or value#>>'{}' not in('owner','admin','management','senior_lecturer','lecturer','participant','client'))
   or p_payload->>'starts_at' !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' or p_payload->>'ends_at' !~ '(Z|[+-][0-9]{2}:[0-9]{2})$'
   or not exists(select 1 from pg_catalog.pg_timezone_names where name=p_payload->>'time_zone') then raise exception 'Valid roles, finite instants and IANA time zone required' using errcode='22023';end if;
  starts=(p_payload->>'starts_at')::timestamptz;ends=(p_payload->>'ends_at')::timestamptz;
  select coalesce(array_agg(distinct value order by value),'{}') into roles from jsonb_array_elements_text(p_payload->'audience_roles') value;
  if cardinality(roles)<>jsonb_array_length(p_payload->'audience_roles') then raise exception 'Unique audience roles required' using errcode='22023';end if;
  insert into private.announcement_revisions(announcement_id,revision,title_de,title_en,body_de,body_en,important,audience_roles,starts_at,ends_at,time_zone,created_by)
  values(target,case when p_id is null then 1 else a.version+1 end,trim(p_payload->>'title_de'),trim(p_payload->>'title_en'),trim(p_payload->>'body_de'),trim(p_payload->>'body_en'),(p_payload->>'important')::boolean,roles,starts,ends,p_payload->>'time_zone',auth.uid()) returning id into new_revision;
  update private.portal_announcements set draft_revision_id=new_revision,version=case when p_id is null then 1 else version+1 end,updated_at=clock_timestamp() where id=target;
 elsif p_action='publish' then
  select * into r from private.announcement_revisions where id=a.draft_revision_id;
  if a.archived_at is not null or r.id is null or a.published_revision_id=r.id then raise exception 'A new unarchived draft is required' using errcode='22023';end if;
  if r.starts_at>clock_timestamp() then raise exception 'Future starts require manual publication when due; no scheduler is active' using errcode='22023';end if;
  if r.ends_at<=clock_timestamp() then raise exception 'The display window has expired' using errcode='22023';end if;
  insert into private.announcement_publications(revision_id,published_by) values(r.id,auth.uid());
  update private.portal_announcements set published_revision_id=r.id,version=version+1,updated_at=clock_timestamp() where id=target;
  if r.important then
   insert into public.notifications(user_id,kind,resource_id)
   select p.id,'portal_announcement',r.id from public.profiles p where p.active and (cardinality(r.audience_roles)=0 or exists(select 1 from public.user_roles role where role.user_id=p.id and role.role=any(r.audience_roles))) on conflict do nothing;
  end if;
 elsif p_action='archive' then
  if a.archived_at is not null then raise exception 'Announcement is already archived' using errcode='22023';end if;
  update private.portal_announcements set archived_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp() where id=target;
 else
  if a.archived_at is null then raise exception 'Announcement is not archived' using errcode='22023';end if;
  update private.portal_announcements set archived_at=null,version=version+1,updated_at=clock_timestamp() where id=target;
 end if;
 insert into public.audit_events(actor_id,action,resource_id) values(auth.uid(),case p_action when 'save' then 'announcement.draft_saved' when 'publish' then 'announcement.published' when 'archive' then 'announcement.archived' else 'announcement.recovered' end,target);
 result=private.announcement_admin_record(target);
 insert into private.announcement_requests(actor_id,request_id,payload,result) values(auth.uid(),p_request_id,parameters,result);
 return result;
end;$$;
create function public.manage_announcement(p_id uuid,p_action text,p_expected_version integer,p_request_id uuid,p_payload jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select private.manage_announcement(p_id,p_action,p_expected_version,p_request_id,p_payload);$$;

create function private.admin_announcements(p_search text default '',p_state text default '',p_before_at timestamptz default null,p_before_id uuid default null,p_limit integer default 20) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare items jsonb;more boolean;cursor jsonb;
begin
 if not private.has_permission('announcements.manage') then raise exception 'Announcement management and MFA required' using errcode='42501';end if;
 if p_search is null or length(p_search)>160 or p_state is null or p_state not in('','draft','published','archived') or p_limit is null or p_limit not between 1 and 50 or ((p_before_at is null)<>(p_before_id is null)) or (p_before_at is not null and not isfinite(p_before_at)) then raise exception 'Invalid announcement filter or cursor' using errcode='22023';end if;
 with page as materialized(
 select a.id,a.version,a.archived_at,a.updated_at,a.draft_revision_id,a.published_revision_id,d.title_de,d.title_en,
 a.draft_revision_id is distinct from a.published_revision_id has_draft,
 case when a.archived_at is not null then 'archived' when a.published_revision_id is not null then 'published' else 'draft' end state
 from private.portal_announcements a join private.announcement_revisions d on d.id=a.draft_revision_id left join private.announcement_revisions current on current.id=a.published_revision_id
 where (p_search='' or strpos(lower(d.title_de||' '||d.title_en||' '||d.body_de||' '||d.body_en||' '||coalesce(current.title_de,'')||' '||coalesce(current.title_en,'')||' '||coalesce(current.body_de,'')||' '||coalesce(current.body_en,'')),lower(p_search))>0)
 and (p_state='' or p_state=case when a.archived_at is not null then 'archived' when a.published_revision_id is not null then 'published' else 'draft' end)
 and (p_before_at is null or (a.updated_at,a.id)<(p_before_at,p_before_id)) order by a.updated_at desc,a.id desc limit p_limit+1
 ),visible as(select * from page order by updated_at desc,id desc limit p_limit)
 select coalesce((select jsonb_agg(to_jsonb(v) order by updated_at desc,id desc) from visible v),'[]'::jsonb),(select count(*)>p_limit from page),
 (select jsonb_build_object('at',updated_at,'id',id) from visible order by updated_at,id limit 1) into items,more,cursor;
 return jsonb_build_object('items',items,'has_more',more,'next_cursor',case when more then cursor else null end);
end;$$;
create function public.admin_announcements(p_search text default '',p_state text default '',p_before_at timestamptz default null,p_before_id uuid default null,p_limit integer default 20) returns jsonb language sql stable security invoker set search_path='' as $$select private.admin_announcements(p_search,p_state,p_before_at,p_before_id,p_limit);$$;

create function private.announcements(p_search text default '',p_unacknowledged boolean default false,p_before_at timestamptz default null,p_before_id uuid default null,p_limit integer default 20) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare items jsonb;more boolean;cursor jsonb;
begin
 if not private.actor_active() then raise exception 'Account inactive' using errcode='42501';end if;
 if p_search is null or length(p_search)>160 or p_unacknowledged is null or p_limit is null or p_limit not between 1 and 50 or ((p_before_at is null)<>(p_before_id is null)) or (p_before_at is not null and not isfinite(p_before_at)) then raise exception 'Invalid announcement filter or cursor' using errcode='22023';end if;
 with page as materialized(
 select r.id,r.announcement_id,r.revision,r.title_de,r.title_en,r.body_de,r.body_en,r.important,r.starts_at,r.ends_at,r.time_zone,p.published_at,ack.acknowledged_at
 from private.portal_announcements a join private.announcement_revisions r on r.id=a.published_revision_id join private.announcement_publications p on p.revision_id=r.id left join private.announcement_acknowledgements ack on ack.revision_id=r.id and ack.user_id=auth.uid()
 where a.archived_at is null and r.starts_at<=now() and r.ends_at>now() and private.can_read_announcement_revision(r.id) and (not p_unacknowledged or ack.user_id is null)
 and (p_search='' or strpos(lower(r.title_de||' '||r.title_en||' '||r.body_de||' '||r.body_en),lower(p_search))>0)
 and (p_before_at is null or (p.published_at,r.id)<(p_before_at,p_before_id)) order by p.published_at desc,r.id desc limit p_limit+1
 ),visible as(select * from page order by published_at desc,id desc limit p_limit)
 select coalesce((select jsonb_agg(to_jsonb(v) order by published_at desc,id desc) from visible v),'[]'::jsonb),(select count(*)>p_limit from page),
 (select jsonb_build_object('at',published_at,'id',id) from visible order by published_at,id limit 1) into items,more,cursor;
 return jsonb_build_object('items',items,'has_more',more,'next_cursor',case when more then cursor else null end,'as_of',now());
end;$$;
create function public.announcements(p_search text default '',p_unacknowledged boolean default false,p_before_at timestamptz default null,p_before_id uuid default null,p_limit integer default 20) returns jsonb language sql stable security invoker set search_path='' as $$select private.announcements(p_search,p_unacknowledged,p_before_at,p_before_id,p_limit);$$;
create function private.announcement(p_revision_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not private.can_read_announcement_revision(p_revision_id) then raise exception 'Announcement access denied' using errcode='42501';end if;
 select to_jsonb(current) into result from(select r.id,r.announcement_id,r.revision,r.title_de,r.title_en,r.body_de,r.body_en,r.important,r.starts_at,r.ends_at,r.time_zone,p.published_at,ack.acknowledged_at
 from private.announcement_revisions r join private.announcement_publications p on p.revision_id=r.id left join private.announcement_acknowledgements ack on ack.revision_id=r.id and ack.user_id=auth.uid() where r.id=p_revision_id) current;
 return result;
end;$$;
create function public.announcement(p_revision_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$select private.announcement(p_revision_id);$$;

create function private.acknowledge_announcement(p_revision_id uuid) returns timestamptz language plpgsql security definer set search_path='' as $$
declare stamp timestamptz;
begin
 perform 1 from public.profiles where id=auth.uid() and active for share;
 if not found then raise exception 'Account inactive' using errcode='42501';end if;
 perform 1 from public.user_roles where user_id=auth.uid() order by role for share;
 perform 1 from private.portal_announcements where published_revision_id=p_revision_id for share;
 if not private.can_read_announcement_revision(p_revision_id) then raise exception 'Announcement access denied' using errcode='42501';end if;
 insert into private.announcement_acknowledgements(user_id,revision_id) values(auth.uid(),p_revision_id) on conflict do nothing;
 select acknowledged_at into stamp from private.announcement_acknowledgements where user_id=auth.uid() and revision_id=p_revision_id;
 update public.notifications set read_at=coalesce(read_at,clock_timestamp()) where user_id=auth.uid() and kind='portal_announcement' and resource_id=p_revision_id;
 return stamp;
end;$$;
create function public.acknowledge_announcement(p_revision_id uuid) returns timestamptz language sql security invoker set search_path='' as $$select private.acknowledge_announcement(p_revision_id);$$;

-- Copy the accepted resolver verbatim, adding only the current, published
-- revision branch. Draft, superseded, archived or revoked IDs resolve redacted.
create or replace function private.notification_target(p_kind text,p_resource uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare target uuid;heading text;path text;
begin
 if p_kind in('claim_confirmed','claim_cancelled') then
  select j.id,j.title into target,heading from public.job_claims c join public.jobs j on j.id=c.job_id where c.id=p_resource and c.lecturer_id=auth.uid() and private.can_read_job(j.id);if found then path='/jobs/'||target;end if;
 elsif p_kind in('job_reopened','job_matching') then
  select j.id,j.title into target,heading from public.jobs j where j.id=p_resource and private.can_read_job(j.id);if found then path='/jobs/'||target;end if;
 elsif p_kind='chat_message' then
  select r.id,r.title into target,heading from public.messages m join public.chat_rooms r on r.id=m.room_id where m.id=p_resource and m.deleted_at is null and private.can_access_chat_room(r.id);if found then path='/chats?room='||target;end if;
 elsif p_kind='forum_reply' then
  select t.id,t.title into target,heading from public.forum_threads t where t.id=p_resource and private.can_read_forum(t.id);if found then path='/forum?thread='||target;end if;
 elsif p_kind='session_reminder' then
  select j.id,j.title into target,heading from public.assignment_sessions s join public.job_claims c on c.id=s.claim_id join public.jobs j on j.id=c.job_id where s.id=p_resource and c.lecturer_id=auth.uid() and c.status='confirmed' and s.released_at is null and private.can_read_job(j.id);if found then path='/jobs/'||target;end if;
 elsif p_kind in('contract_available','contract_expiring') then
  select c.id,c.title into target,heading from public.contracts c where c.id=p_resource and c.user_id=auth.uid();if found then path='/contracts';end if;
 elsif p_kind='portal_announcement' and private.can_read_announcement_revision(p_resource) then
  select r.id,case when (select locale from public.profiles where id=auth.uid())='en' then r.title_en else r.title_de end into target,heading from private.announcement_revisions r where r.id=p_resource;
  if found then path='/announcements?revision='||target;end if;
 end if;
 return jsonb_build_object('href',path,'title',coalesce(heading,''));
end;$$;
drop index public.notifications_critical_unread;
create index notifications_critical_unread on public.notifications(user_id,created_at desc,id desc) where read_at is null and kind in('claim_confirmed','claim_cancelled','contract_available','portal_announcement');
create or replace function private.notification_attention() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare p private.attention_preferences;total bigint;
begin
 if not private.actor_active() then raise exception 'Account inactive' using errcode='42501';end if;
 select * into p from private.attention_preferences where user_id=auth.uid();
 if not found or not p.enabled then return jsonb_build_object('quiet_active',false);end if;
 if not private.attention_is_quiet(now(),p.time_zone,p.starts_minute,p.ends_minute) then return jsonb_build_object('quiet_active',false);end if;
 select count(*) into total from public.notifications where user_id=auth.uid() and read_at is null
 and (kind in('claim_confirmed','claim_cancelled','contract_available') or (kind='portal_announcement' and private.can_read_announcement_revision(resource_id)));
 return jsonb_build_object('quiet_active',true,'attention_count',total);
end;$$;
create or replace function private.admin_audit_actions() returns text[] language sql immutable set search_path='' as $$
 select array[
 'account.roles_changed','user.activated','user.deactivated','invitation.reserved','invitation.sent','invitation.failed','qualification.attested',
 'client.membership_added','client.membership_removed','client.request_submitted','client.request_published','client.request_cancelled','organisation.saved','organisation.contact.saved',
 'course.template.saved','course.template.duplicated','course.run.saved','course.run.duplicated','course.visibility.changed','course.run_offer_created','course.enrolment.changed',
 'job.created.draft','job.created.published','job.created.archived','job.status.draft','job.status.published','job.status.archived','job.commission_configured',
 'job.lifecycle.draft','job.lifecycle.published','job.lifecycle.archived','job.lifecycle.reopen','job.lifecycle.edit','job.lifecycle.duplicate','job.capacity_created','job.capacity_changed','claim.cancelled',
 'taxonomy.created','taxonomy.updated','taxonomy.archived','taxonomy.restored','announcement.draft_saved','announcement.published','announcement.archived','announcement.recovered'
 ]::text[];
$$;

revoke all on function private.immutable_announcement_snapshot(),private.can_read_announcement_revision(uuid),private.announcement_admin_record(uuid),private.admin_audit_actions() from public,anon,authenticated;
revoke all on function private.manage_announcement(uuid,text,integer,uuid,jsonb),public.manage_announcement(uuid,text,integer,uuid,jsonb),private.admin_announcement(uuid),public.admin_announcement(uuid),private.admin_announcements(text,text,timestamptz,uuid,integer),public.admin_announcements(text,text,timestamptz,uuid,integer),private.announcements(text,boolean,timestamptz,uuid,integer),public.announcements(text,boolean,timestamptz,uuid,integer),private.acknowledge_announcement(uuid),public.acknowledge_announcement(uuid) from public,anon,authenticated;
grant execute on function private.manage_announcement(uuid,text,integer,uuid,jsonb),public.manage_announcement(uuid,text,integer,uuid,jsonb),private.admin_announcement(uuid),public.admin_announcement(uuid),private.admin_announcements(text,text,timestamptz,uuid,integer),public.admin_announcements(text,text,timestamptz,uuid,integer),private.announcements(text,boolean,timestamptz,uuid,integer),public.announcements(text,boolean,timestamptz,uuid,integer),private.acknowledge_announcement(uuid),public.acknowledge_announcement(uuid) to authenticated;
revoke all on function private.announcement(uuid),public.announcement(uuid) from public,anon,authenticated;
grant execute on function private.announcement(uuid),public.announcement(uuid) to authenticated;
commit;
