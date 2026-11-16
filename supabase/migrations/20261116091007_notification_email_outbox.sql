begin;

-- Email is an explicit per-account channel choice. Existing inbox history is
-- deliberately not replayed. SMTP credentials never belong in this database.
create table private.delivery_preferences (
 user_id uuid primary key references public.profiles(id) on delete cascade,
 email_enabled boolean not null default false,
 quiet_start time,
 quiet_end time,
 time_zone text not null,
 version integer not null default 1 check(version>0),
 updated_at timestamptz not null default now(),
 last_reminder_scan_at timestamptz,
 check((quiet_start is null and quiet_end is null) or
  (quiet_start is not null and quiet_end is not null and quiet_start<>quiet_end)),
 check(quiet_start is null or (quiet_start<'24:00'::time and extract(second from quiet_start)=0)),
 check(quiet_end is null or (quiet_end<'24:00'::time and extract(second from quiet_end)=0))
);
alter table private.delivery_preferences enable row level security;
revoke all on private.delivery_preferences from public,anon,authenticated,service_role;
insert into private.delivery_preferences(user_id,time_zone) select id,time_zone from public.profiles;

create function private.initialize_delivery_preferences() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 insert into private.delivery_preferences(user_id,time_zone) values(new.id,new.time_zone);
 return new;
end;$$;
create trigger initialize_delivery_preferences after insert on public.profiles
 for each row execute function private.initialize_delivery_preferences();

create function private.delivery_preferences() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare p private.delivery_preferences;
begin
 if not private.actor_active() then raise exception 'Account inactive' using errcode='42501'; end if;
 select * into p from private.delivery_preferences where user_id=auth.uid();
 return jsonb_build_object('email_enabled',p.email_enabled,'quiet_start',to_char(p.quiet_start,'HH24:MI'),
  'quiet_end',to_char(p.quiet_end,'HH24:MI'),'time_zone',p.time_zone,'version',p.version);
end;$$;
create function public.delivery_preferences() returns jsonb
language sql stable security invoker set search_path='' as $$select private.delivery_preferences();$$;

create function private.save_delivery_preferences(p_payload jsonb,p_expected_version integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p private.delivery_preferences; v_start text; v_end text; v_zone text;
begin
 if not private.actor_active() then raise exception 'Account inactive' using errcode='42501'; end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object'
 or (select count(*) from jsonb_object_keys(p_payload))<>4
 or not(p_payload ?& array['email_enabled','quiet_start','quiet_end','time_zone'])
 or jsonb_typeof(p_payload->'email_enabled')<>'boolean'
 or jsonb_typeof(p_payload->'time_zone')<>'string'
 or jsonb_typeof(p_payload->'quiet_start') not in ('string','null')
 or jsonb_typeof(p_payload->'quiet_end') not in ('string','null') then
  raise exception 'Invalid delivery preferences' using errcode='22023';
 end if;
 v_start=p_payload->>'quiet_start'; v_end=p_payload->>'quiet_end'; v_zone=p_payload->>'time_zone';
 if ((v_start is null)<>(v_end is null)) or v_start=v_end
 or (v_start is not null and (v_start!~'^([01][0-9]|2[0-3]):[0-5][0-9]$' or v_end!~'^([01][0-9]|2[0-3]):[0-5][0-9]$'))
 or not exists(select 1 from pg_catalog.pg_timezone_names where name=v_zone) then
  raise exception 'Invalid delivery quiet hours or time zone' using errcode='22023';
 end if;
 select * into p from private.delivery_preferences where user_id=auth.uid() for update;
 if not found or p_expected_version is distinct from p.version then
  raise exception 'Delivery preferences changed; reload before saving' using errcode='40001';
 end if;
 update private.delivery_preferences set email_enabled=(p_payload->>'email_enabled')::boolean,
  quiet_start=v_start::time,quiet_end=v_end::time,time_zone=v_zone,version=version+1,updated_at=now()
  where user_id=auth.uid();
 return private.delivery_preferences();
end;$$;
create function public.save_delivery_preferences(p_payload jsonb,p_expected_version integer) returns jsonb
language sql security invoker set search_path='' as $$select private.save_delivery_preferences(p_payload,p_expected_version);$$;

-- One durable row per committed notification occurrence (reopening can renew
-- created_at on an existing inbox row). No resource titles or body snapshots.
create table private.notification_email_outbox (
 id uuid primary key default gen_random_uuid(),
 notification_id uuid not null references public.notifications(id) on delete cascade,
 occurrence_at timestamptz not null,
 state text not null default 'pending' check(state in ('pending','leased','sending','accepted','suppressed','failed','uncertain')),
 attempts integer not null default 0 check(attempts between 0 and 5),
 available_at timestamptz not null default now(),
 lease_token uuid,
 lease_until timestamptz,
 last_outcome text,
 error_code text check(error_code is null or error_code~'^[a-z0-9_]{1,64}$'),
 created_at timestamptz not null default now(),
 finished_at timestamptz,
 unique(notification_id,occurrence_at)
);
alter table private.notification_email_outbox enable row level security;
revoke all on private.notification_email_outbox from public,anon,authenticated,service_role;
create index notification_email_pending on private.notification_email_outbox(available_at,id) where state='pending';
create index notification_email_expired on private.notification_email_outbox(lease_until,id) where state in ('leased','sending');

create function private.email_category_enabled(p_user uuid,p_kind text) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce((select case
  when p_kind='chat_message' then p.chat
  when p_kind='forum_reply' then p.forum
  when p_kind in ('job_reopened','job_matching') then p.job_updates
  when p_kind in ('session_reminder','contract_expiring') then p.reminders
  else p_kind in ('claim_confirmed','claim_cancelled','contract_available') end
 from private.notification_preferences p where p.user_id=p_user),false);
$$;
create function private.queue_notification_email() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' and new.created_at is not distinct from old.created_at then return new; end if;
 if exists(select 1 from private.delivery_preferences d join public.profiles p on p.id=d.user_id
  where d.user_id=new.user_id and d.email_enabled and p.active)
 and private.email_category_enabled(new.user_id,new.kind) then
  insert into private.notification_email_outbox(notification_id,occurrence_at)
   values(new.id,new.created_at) on conflict do nothing;
 end if;
 return new;
end;$$;
create trigger queue_notification_email after insert or update of created_at on public.notifications
 for each row execute function private.queue_notification_email();

-- Local wall-clock quiet intervals preserve the selected IANA zone and are
-- evaluated again immediately before sending, including across midnight/DST.
create function private.email_quiet_until(p_zone text,p_start time,p_end time,p_now timestamptz)
returns timestamptz language plpgsql stable set search_path='' as $$
declare local_now timestamp; quiet_end timestamp;
begin
 if p_start is null or p_end is null then return null; end if;
 local_now=p_now at time zone p_zone;
 if p_start<p_end then
  if local_now::time>=p_start and local_now::time<p_end then quiet_end=local_now::date+p_end; end if;
 elsif local_now::time>=p_start then quiet_end=(local_now::date+1)+p_end;
 elsif local_now::time<p_end then quiet_end=local_now::date+p_end;
 end if;
 if quiet_end is null then return null; end if;
 return greatest(quiet_end at time zone p_zone,p_now+interval '1 minute');
end;$$;

create function private.require_email_worker() returns void
language plpgsql stable set search_path='' as $$
begin
 -- The database role is authoritative, never a browser-controlled payload or
 -- user metadata field. Public wrappers additionally have service-only ACLs.
 if current_setting('role',true) is distinct from 'service_role' then
  raise exception 'Notification worker required' using errcode='42501';
 end if;
end;$$;

create function private.lease_notification_emails(p_limit integer default 20) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 perform private.require_email_worker();
 if p_limit is null or p_limit not between 1 and 100 then raise exception 'Invalid email batch size' using errcode='22023'; end if;
 -- A worker which may have transmitted SMTP DATA must never be blindly
 -- retried after a crash: SMTP itself has no exactly-once transaction.
 with expired as(select id from private.notification_email_outbox where state in ('leased','sending')
  and lease_until<=now() order by lease_until,id for update skip locked limit 100)
 update private.notification_email_outbox o set
  state=case when o.state='sending' then 'uncertain' when o.attempts>=5 then 'failed' else 'pending' end,
  error_code=case when o.state='sending' then 'send_lease_expired' else 'lease_expired' end,
  finished_at=case when o.state='sending' or o.attempts>=5 then now() else null end,
  lease_until=null,available_at=now() from expired e where o.id=e.id;
 with candidates as(select id from private.notification_email_outbox where state='pending' and available_at<=now()
  and attempts<5 order by available_at,id for update skip locked limit p_limit),
 leased as(update private.notification_email_outbox o set state='leased',attempts=o.attempts+1,
  lease_token=gen_random_uuid(),lease_until=now()+interval '5 minutes',last_outcome=null
  from candidates c where o.id=c.id returning o.id,o.lease_token)
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'lease_token',lease_token)),'[]'::jsonb) into result from leased;
 return result;
end;$$;
create function public.lease_notification_emails(p_limit integer default 20) returns jsonb
language sql security invoker set search_path='' as $$select private.lease_notification_emails(p_limit);$$;

-- The finite worker calls this on its scheduled run. Only explicitly opted-in
-- accounts are considered, in bounded batches, with no historical mail replay.
create function private.refresh_notification_reminders(p_limit integer default 100) returns integer
language plpgsql security definer set search_path='' as $$
declare account_id uuid; added integer; total integer:=0;
begin
 perform private.require_email_worker();
 if p_limit is null or p_limit not between 1 and 100 then raise exception 'Invalid reminder batch size' using errcode='22023'; end if;
 for account_id in select d.user_id from private.delivery_preferences d
  join public.profiles p on p.id=d.user_id join private.notification_preferences n on n.user_id=d.user_id
  where d.email_enabled and p.active and n.reminders
   and (d.last_reminder_scan_at is null or d.last_reminder_scan_at<=now()-interval '15 minutes')
  order by d.last_reminder_scan_at nulls first,d.user_id for update of d skip locked limit p_limit
 loop
  insert into public.notifications(user_id,kind,resource_id)
  select account_id,'session_reminder',s.id from public.assignment_sessions s join public.job_claims c on c.id=s.claim_id
   where c.lecturer_id=account_id and c.status='confirmed' and s.released_at is null
    and s.starts_at>now() and s.starts_at<=now()+interval '24 hours'
   order by s.starts_at limit 500 on conflict do nothing;
  get diagnostics added=row_count;total=total+added;
  insert into public.notifications(user_id,kind,resource_id)
  select account_id,'contract_expiring',c.id from public.contracts c
   where c.user_id=account_id and c.status='active' and c.revoked_at is null
    and c.effective_from<=now() and c.expires_at>now() and c.expires_at<=now()+interval '30 days'
   order by c.expires_at limit 500 on conflict do nothing;
  get diagnostics added=row_count;total=total+added;
  update private.delivery_preferences set last_reminder_scan_at=now() where user_id=account_id;
 end loop;
 return total;
end;$$;
create function public.refresh_notification_reminders(p_limit integer default 100) returns integer
language sql security invoker set search_path='' as $$select private.refresh_notification_reminders(p_limit);$$;

create function private.prepare_notification_email(p_id uuid,p_lease_token uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o private.notification_email_outbox; n public.notifications; d private.delivery_preferences;
 recipient text; lang text; active_account boolean; defer_until timestamptz;
begin
 perform private.require_email_worker();
 select * into o from private.notification_email_outbox where id=p_id for update;
 if not found or o.state<>'leased' or o.lease_token is distinct from p_lease_token or o.lease_until<=now() then return null; end if;
 select * into n from public.notifications where id=o.notification_id;
 select * into d from private.delivery_preferences where user_id=n.user_id;
 select u.email,p.locale,p.active into recipient,lang,active_account from public.profiles p
  join auth.users u on u.id=p.id where p.id=n.user_id;
 if not coalesce(active_account,false) or not coalesce(d.email_enabled,false)
 or not private.email_category_enabled(n.user_id,n.kind) or recipient is null
 or recipient!~'^[^[:space:]<>@,;]+@[^[:space:]<>@,;]+\.[^[:space:]<>@,;]+$'
 or length(recipient)>254
 or (n.kind='session_reminder' and not exists(select 1 from public.assignment_sessions s
  join public.job_claims c on c.id=s.claim_id where s.id=n.resource_id and c.lecturer_id=n.user_id
   and c.status='confirmed' and s.released_at is null and s.starts_at>now()))
 or (n.kind='contract_expiring' and not exists(select 1 from public.contracts c
  where c.id=n.resource_id and c.user_id=n.user_id and c.status='active' and c.revoked_at is null
   and c.effective_from<=now() and c.expires_at>now() and c.expires_at<=now()+interval '30 days'))
 or (n.kind='chat_message' and not exists(select 1 from public.messages m
  join public.chat_members member on member.room_id=m.room_id and member.user_id=n.user_id
  where m.id=n.resource_id and m.deleted_at is null and member.removed_at is null and not member.muted))
 or (n.kind in ('job_matching','job_reopened') and not exists(select 1 from public.jobs j
  where j.id=n.resource_id and j.status='published' and (j.claim_deadline is null or j.claim_deadline>now()))) then
  update private.notification_email_outbox set state='suppressed',finished_at=now(),lease_until=null,
   error_code='recipient_or_preferences_changed' where id=o.id;
  return null;
 end if;
 defer_until=private.email_quiet_until(d.time_zone,d.quiet_start,d.quiet_end,now());
 if defer_until is not null then
  update private.notification_email_outbox set state='pending',available_at=defer_until,lease_until=null,
   attempts=greatest(0,attempts-1),error_code='quiet_hours' where id=o.id;
  return null;
 end if;
 update private.notification_email_outbox set state='sending',lease_until=now()+interval '5 minutes',error_code=null where id=o.id;
 return jsonb_build_object('id',o.id,'lease_token',o.lease_token,'recipient',recipient,'locale',lang,'kind',n.kind,
  'message_id','<luminovia-notification.'||o.id||'@luminovia.org>');
end;$$;
create function public.prepare_notification_email(p_id uuid,p_lease_token uuid) returns jsonb
language sql security invoker set search_path='' as $$select private.prepare_notification_email(p_id,p_lease_token);$$;

create function private.finish_notification_email(p_id uuid,p_lease_token uuid,p_outcome text,p_error_code text default null) returns boolean
language plpgsql security definer set search_path='' as $$
declare o private.notification_email_outbox;
begin
 perform private.require_email_worker();
 if p_outcome is null or p_outcome not in ('accepted','retry','failed','uncertain')
 or (p_error_code is not null and p_error_code!~'^[a-z0-9_]{1,64}$') then
  raise exception 'Invalid delivery outcome' using errcode='22023';
 end if;
 select * into o from private.notification_email_outbox where id=p_id for update;
 if not found or o.lease_token is distinct from p_lease_token then return false; end if;
 if o.last_outcome=p_outcome then return true; end if;
 if o.state<>'sending' or o.lease_until<=now() then return false; end if;
 update private.notification_email_outbox set state=case when p_outcome='retry' and attempts<5 then 'pending'
  when p_outcome='retry' then 'failed' else p_outcome end,
  available_at=case when p_outcome='retry' then now()+make_interval(secs=>least(3600,30*(2^attempts)::integer)) else available_at end,
  lease_until=null,last_outcome=p_outcome,error_code=p_error_code,
  finished_at=case when p_outcome='retry' and attempts<5 then null else now() end where id=o.id;
 return true;
end;$$;
create function public.finish_notification_email(p_id uuid,p_lease_token uuid,p_outcome text,p_error_code text default null) returns boolean
language sql security invoker set search_path='' as $$select private.finish_notification_email(p_id,p_lease_token,p_outcome,p_error_code);$$;

revoke all on function private.initialize_delivery_preferences(),private.queue_notification_email(),
 private.email_category_enabled(uuid,text),private.email_quiet_until(text,time,time,timestamptz),private.require_email_worker()
 from public,anon,authenticated,service_role;
revoke all on function private.delivery_preferences(),public.delivery_preferences(),private.save_delivery_preferences(jsonb,integer),
 public.save_delivery_preferences(jsonb,integer) from public,anon,service_role;
grant execute on function private.delivery_preferences(),public.delivery_preferences(),private.save_delivery_preferences(jsonb,integer),
 public.save_delivery_preferences(jsonb,integer) to authenticated;
revoke all on function private.lease_notification_emails(integer),public.lease_notification_emails(integer),
 private.refresh_notification_reminders(integer),public.refresh_notification_reminders(integer),
 private.prepare_notification_email(uuid,uuid),public.prepare_notification_email(uuid,uuid),
 private.finish_notification_email(uuid,uuid,text,text),public.finish_notification_email(uuid,uuid,text,text)
 from public,anon,authenticated;
grant execute on function private.lease_notification_emails(integer),public.lease_notification_emails(integer),
 private.refresh_notification_reminders(integer),public.refresh_notification_reminders(integer),
 private.prepare_notification_email(uuid,uuid),public.prepare_notification_email(uuid,uuid),
 private.finish_notification_email(uuid,uuid,text,text),public.finish_notification_email(uuid,uuid,text,text)
 to service_role;

commit;
