begin;

-- Preferences affect future optional notifications. Accepted-work receipts stay
-- available independently of category preferences and are never rewritten.
create table private.notification_preferences (
 user_id uuid primary key references public.profiles(id) on delete cascade,
 chat boolean not null default true,
 forum boolean not null default true,
 job_updates boolean not null default true,
 reminders boolean not null default true,
 version integer not null default 1 check(version > 0),
 updated_at timestamptz not null default now(),
 last_refresh_at timestamptz
);
alter table private.notification_preferences enable row level security;
create policy notification_preferences_own on private.notification_preferences
 for select to authenticated using((select private.actor_active()) and user_id=(select auth.uid()));
revoke all on private.notification_preferences from public,anon,authenticated;
insert into private.notification_preferences(user_id) select id from public.profiles;

create function private.initialize_notification_preferences() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 insert into private.notification_preferences(user_id) values(new.id) on conflict do nothing;
 return new;
end;$$;
create trigger initialize_notification_preferences after insert on public.profiles
 for each row execute function private.initialize_notification_preferences();

create function private.filter_optional_notification() returns trigger
language plpgsql security definer set search_path='' as $$
declare p private.notification_preferences;
begin
 select * into p from private.notification_preferences where user_id=new.user_id;
 if (new.kind='chat_message' and not coalesce(p.chat,true))
 or (new.kind='forum_reply' and not coalesce(p.forum,true))
 or (new.kind in ('job_reopened','job_matching') and not coalesce(p.job_updates,true))
 or (new.kind in ('session_reminder','contract_expiring') and not coalesce(p.reminders,true)) then
  return null;
 end if;
 return new;
end;$$;
create trigger filter_optional_notification before insert on public.notifications
 for each row execute function private.filter_optional_notification();

create function private.notification_preferences() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not private.actor_active() then raise exception 'Account inactive' using errcode='42501'; end if;
 select jsonb_build_object('chat',p.chat,'forum',p.forum,'job_updates',p.job_updates,
  'reminders',p.reminders,'version',p.version) into result
 from private.notification_preferences p where p.user_id=auth.uid();
 return result;
end;$$;
create function public.notification_preferences() returns jsonb
language sql stable security invoker set search_path='' as $$select private.notification_preferences();$$;

create function private.save_notification_preferences(p_payload jsonb,p_expected_version integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p private.notification_preferences;
begin
 if not private.actor_active() then raise exception 'Account inactive' using errcode='42501'; end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object'
 or (select count(*) from jsonb_object_keys(p_payload))<>4
 or exists(select 1 from jsonb_each(p_payload) item where item.key not in ('chat','forum','job_updates','reminders') or jsonb_typeof(item.value)<>'boolean') then
  raise exception 'Invalid preferences' using errcode='22023';
 end if;
 select * into p from private.notification_preferences where user_id=auth.uid() for update;
 if not found or p_expected_version is distinct from p.version then
  raise exception 'Preferences changed; reload before saving' using errcode='40001';
 end if;
 update private.notification_preferences set chat=(p_payload->>'chat')::boolean,
  forum=(p_payload->>'forum')::boolean,job_updates=(p_payload->>'job_updates')::boolean,
  reminders=(p_payload->>'reminders')::boolean,version=version+1,updated_at=now(),last_refresh_at=null where user_id=auth.uid();
 return private.notification_preferences();
end;$$;
create function public.save_notification_preferences(p_payload jsonb,p_expected_version integer) returns jsonb
language sql security invoker set search_path='' as $$select private.save_notification_preferences(p_payload,p_expected_version);$$;

-- Resolve links on every read, using current resource permissions. An old
-- notification cannot reveal a removed chat's title or a private forum thread.
create function private.notification_target(p_kind text,p_resource uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare target uuid; heading text; path text;
begin
 if p_kind in ('claim_confirmed','claim_cancelled') then
  select j.id,j.title into target,heading from public.job_claims c join public.jobs j on j.id=c.job_id
   where c.id=p_resource and c.lecturer_id=auth.uid() and private.can_read_job(j.id);
  if found then path='/jobs/'||target; end if;
 elsif p_kind in ('job_reopened','job_matching') then
  select j.id,j.title into target,heading from public.jobs j where j.id=p_resource and private.can_read_job(j.id);
  if found then path='/jobs/'||target; end if;
 elsif p_kind='chat_message' then
  select r.id,r.title into target,heading from public.messages m join public.chat_rooms r on r.id=m.room_id
   where m.id=p_resource and m.deleted_at is null and private.can_access_chat_room(r.id);
  if found then path='/chats?room='||target; end if;
 elsif p_kind='forum_reply' then
  select t.id,t.title into target,heading from public.forum_threads t where t.id=p_resource and private.can_read_forum(t.id);
  if found then path='/forum?thread='||target; end if;
 elsif p_kind='session_reminder' then
  select j.id,j.title into target,heading from public.assignment_sessions s join public.job_claims c on c.id=s.claim_id
   join public.jobs j on j.id=c.job_id where s.id=p_resource and c.lecturer_id=auth.uid()
   and c.status='confirmed' and s.released_at is null and private.can_read_job(j.id);
  if found then path='/jobs/'||target; end if;
 elsif p_kind in ('contract_available','contract_expiring') then
  select c.id,c.title into target,heading from public.contracts c where c.id=p_resource and c.user_id=auth.uid();
  if found then path='/contracts'; end if;
 end if;
 return jsonb_build_object('href',path,'title',coalesce(heading,''));
end;$$;

create function private.notification_inbox(p_unread_only boolean default false,p_before_at timestamptz default null,
 p_before_id uuid default null,p_limit integer default 40) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb; total bigint;
begin
 if not private.actor_active() then raise exception 'Account inactive' using errcode='42501'; end if;
 if p_unread_only is null or p_limit is null or p_limit not between 1 and 100
 or ((p_before_at is null)<>(p_before_id is null)) or (p_before_at is not null and not isfinite(p_before_at)) then
  raise exception 'Invalid inbox cursor' using errcode='22023';
 end if;
 select count(*) into total from public.notifications n where n.user_id=auth.uid() and n.read_at is null;
 select coalesce(jsonb_agg(jsonb_build_object('id',n.id,'kind',n.kind,'read_at',n.read_at,
  'created_at',n.created_at)||private.notification_target(n.kind,n.resource_id) order by n.created_at desc,n.id desc),'[]'::jsonb)
 into result from (
  select * from public.notifications n where n.user_id=auth.uid() and (not p_unread_only or n.read_at is null)
   and (p_before_at is null or (n.created_at,n.id)<(p_before_at,p_before_id))
  order by n.created_at desc,n.id desc limit p_limit
 ) n;
 return jsonb_build_object('items',result,'unread_count',total,'as_of',now());
end;$$;
create function public.notification_inbox(p_unread_only boolean default false,p_before_at timestamptz default null,
 p_before_id uuid default null,p_limit integer default 40) returns jsonb
language sql stable security invoker set search_path='' as $$select private.notification_inbox(p_unread_only,p_before_at,p_before_id,p_limit);$$;

create function private.mark_notifications(p_ids uuid[] default null,p_all_before timestamptz default null,p_read boolean default true)
returns integer language plpgsql security definer set search_path='' as $$
declare result integer;
begin
 if not private.actor_active() then raise exception 'Account inactive' using errcode='42501'; end if;
 if p_read is null or ((p_ids is null)=(p_all_before is null))
 or (p_ids is not null and (cardinality(p_ids) not between 1 and 100
  or exists(select 1 from unnest(p_ids) v where v is null)
  or cardinality(p_ids)<>(select count(distinct v) from unnest(p_ids) v)))
 or (p_all_before is not null and (not isfinite(p_all_before) or p_all_before>clock_timestamp())) then
  raise exception 'Invalid read-state request' using errcode='22023';
 end if;
 if p_ids is not null and (select count(*) from public.notifications n where n.id=any(p_ids) and n.user_id=auth.uid())<>cardinality(p_ids) then
  raise exception 'Notification access denied' using errcode='42501';
 end if;
 update public.notifications n set read_at=case when p_read then coalesce(n.read_at,now()) else null end
 where n.user_id=auth.uid() and ((p_ids is not null and n.id=any(p_ids)) or (p_all_before is not null and n.created_at<=p_all_before));
 get diagnostics result=row_count;
 return result;
end;$$;
create function public.mark_notifications(p_ids uuid[] default null,p_all_before timestamptz default null,p_read boolean default true)
returns integer language sql security invoker set search_path='' as $$select private.mark_notifications(p_ids,p_all_before,p_read);$$;

-- Called explicitly by the user's refresh action. No fake email/scheduler is
-- implied: the inbox explains that due reminders are generated on this action.
create function private.refresh_my_notifications() returns integer
language plpgsql security definer set search_path='' as $$
declare p private.notification_preferences; added integer; total integer:=0;
begin
 if not private.actor_active() then raise exception 'Account inactive' using errcode='42501'; end if;
 select * into p from private.notification_preferences where user_id=auth.uid() for update;
 if p.last_refresh_at>now()-interval '1 minute' then return 0; end if;
 insert into public.notifications(user_id,kind,resource_id)
 select auth.uid(),'session_reminder',s.id from public.assignment_sessions s join public.job_claims c on c.id=s.claim_id
 where c.lecturer_id=auth.uid() and c.status='confirmed' and s.released_at is null and s.starts_at>now() and s.starts_at<=now()+interval '24 hours'
 order by s.starts_at limit 500 on conflict do nothing;
 get diagnostics added=row_count;total=total+added;
 insert into public.notifications(user_id,kind,resource_id)
 select auth.uid(),'contract_expiring',c.id from public.contracts c where c.user_id=auth.uid() and c.status='active'
  and c.revoked_at is null and c.effective_from<=now() and c.expires_at>now() and c.expires_at<=now()+interval '30 days'
 order by c.expires_at limit 500 on conflict do nothing;
 get diagnostics added=row_count;total=total+added;
 update private.notification_preferences set last_refresh_at=now() where user_id=auth.uid();
 return total;
end;$$;
create function public.refresh_my_notifications() returns integer
language sql security invoker set search_path='' as $$select private.refresh_my_notifications();$$;

-- Deferred publication observes the FINAL requirement set in the transaction,
-- rather than notifying everybody between job insert and requirement inserts.
create function private.notify_matching_job() returns trigger
language plpgsql security definer set search_path='' as $$
declare target uuid; j public.jobs;
begin
 if tg_table_name='jobs' then
  -- A partial claim writes published -> published and increments the lifecycle
  -- revision. It does not create a new matching offer: avoid another full fanout.
  if tg_op='UPDATE' and new.status is not distinct from old.status
   and new.claim_deadline is not distinct from old.claim_deadline
   and new.created_by is not distinct from old.created_by then return null;end if;
  target=coalesce(new.id,old.id);
 else
  if tg_op='UPDATE' and new.job_id is not distinct from old.job_id
   and new.topic_id is not distinct from old.topic_id then return null;end if;
  target=coalesce(new.job_id,old.job_id);
 end if;
 select * into j from public.jobs where id=target;
 if not found or j.status<>'published' or (j.claim_deadline is not null and j.claim_deadline<=now())
 or not exists(select 1 from public.job_sessions s where s.job_id=j.id)
 or exists(select 1 from public.job_sessions s where s.job_id=j.id and s.starts_at<=now()) then return null; end if;
 insert into public.notifications(user_id,kind,resource_id)
 select p.id,'job_matching',j.id from public.profiles p
 where p.active and p.id is distinct from j.created_by
  and exists(select 1 from public.user_roles r where r.user_id=p.id and r.role in ('owner','admin','lecturer','senior_lecturer'))
  and not exists(select 1 from public.job_requirements r where r.job_id=j.id and not exists(
   select 1 from public.lecturer_topics t where t.user_id=p.id and t.topic_id=r.topic_id
   and t.verified and (t.valid_until is null or t.valid_until>=(select max(s.ends_at) from public.job_sessions s where s.job_id=j.id))))
 on conflict do nothing;
 return null;
end;$$;
create constraint trigger notify_published_job after insert or update on public.jobs
 deferrable initially deferred for each row execute function private.notify_matching_job();
create constraint trigger notify_changed_job_requirements after insert or update or delete on public.job_requirements
 deferrable initially deferred for each row execute function private.notify_matching_job();

create function private.clean_deleted_job_notifications() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 delete from public.notifications where resource_id=old.id and kind in ('job_matching','job_reopened');
 return old;
end;$$;
create trigger clean_deleted_job_notifications after delete on public.jobs
 for each row execute function private.clean_deleted_job_notifications();

revoke all on function private.initialize_notification_preferences(),private.filter_optional_notification(),
 private.notify_matching_job(),private.clean_deleted_job_notifications(),
 private.notification_target(text,uuid) from public,anon,authenticated;
revoke all on function private.notification_preferences(),private.save_notification_preferences(jsonb,integer),
 private.notification_inbox(boolean,timestamptz,uuid,integer),private.mark_notifications(uuid[],timestamptz,boolean),
 private.refresh_my_notifications(),public.notification_preferences(),public.save_notification_preferences(jsonb,integer),
 public.notification_inbox(boolean,timestamptz,uuid,integer),public.mark_notifications(uuid[],timestamptz,boolean),public.refresh_my_notifications()
 from public,anon;
grant execute on function private.notification_preferences(),private.save_notification_preferences(jsonb,integer),
 private.notification_inbox(boolean,timestamptz,uuid,integer),private.mark_notifications(uuid[],timestamptz,boolean),
 private.refresh_my_notifications(),public.notification_preferences(),public.save_notification_preferences(jsonb,integer),
 public.notification_inbox(boolean,timestamptz,uuid,integer),public.mark_notifications(uuid[],timestamptz,boolean),public.refresh_my_notifications()
 to authenticated;

commit;
