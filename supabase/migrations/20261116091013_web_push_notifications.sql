begin;
create table private.push_configuration(singleton boolean primary key default true check(singleton),enabled boolean not null default false,public_key text);
insert into private.push_configuration default values;
alter table private.push_configuration enable row level security;
revoke all on private.push_configuration from public,anon,authenticated,service_role;
create table private.push_subscriptions(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles(id) on delete cascade,
 endpoint text not null unique, p256dh text not null,auth_secret text not null,device_token uuid not null,
 label text not null check(length(label) between 1 and 80),active boolean not null default true,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '90 days',
 last_reminder_scan_at timestamptz
);
alter table private.push_subscriptions enable row level security;
revoke all on private.push_subscriptions from public,anon,authenticated,service_role;
create index push_subscription_owner on private.push_subscriptions(user_id) where active;
create table private.notification_push_outbox(
 id uuid primary key default gen_random_uuid(),notification_id uuid not null references public.notifications(id) on delete cascade,
 subscription_id uuid not null references private.push_subscriptions(id) on delete cascade,occurrence_at timestamptz not null,
 state text not null default 'pending' check(state in('pending','leased','sending','accepted','suppressed','failed','uncertain')),
 attempts integer not null default 0 check(attempts between 0 and 5),available_at timestamptz not null default now(),
 lease_token uuid,lease_until timestamptz,last_outcome text,error_code text check(error_code is null or error_code~'^[a-z0-9_]{1,64}$'),finished_at timestamptz,
 unique(notification_id,occurrence_at,subscription_id)
);
alter table private.notification_push_outbox enable row level security;
revoke all on private.notification_push_outbox from public,anon,authenticated,service_role;
create index push_outbox_pending on private.notification_push_outbox(available_at,id) where state='pending';
create function private.valid_push_endpoint(p_endpoint text) returns boolean language sql immutable set search_path='' as $$
 select p_endpoint is not null and length(p_endpoint) between 20 and 2048
 and p_endpoint~'^https://(fcm[.]googleapis[.]com|updates[.]push[.]services[.]mozilla[.]com|web[.]push[.]apple[.]com)/[^[:space:]?#\\]+$';$$;
create function private.configure_web_push(p_public_key text,p_enabled boolean) returns void
language plpgsql security definer set search_path='' as $$begin
 perform private.require_email_worker();
 if p_enabled is null or p_public_key is null or p_public_key!~'^[A-Za-z0-9_-]{87}$' then raise exception 'Invalid public push key' using errcode='22023';end if;
 if get_byte(decode(translate(p_public_key,'-_','+/')||'=','base64'),0)<>4 then raise exception 'Invalid public push key' using errcode='22023';end if;
 if exists(select 1 from private.push_configuration where public_key is distinct from p_public_key) then update private.push_subscriptions set active=false,updated_at=now();end if;
 update private.push_configuration set public_key=p_public_key,enabled=p_enabled;
end;$$;
create function public.configure_web_push(p_public_key text,p_enabled boolean) returns void language sql security invoker set search_path='' as $$select private.configure_web_push(p_public_key,p_enabled);$$;
create function private.my_push_devices() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.actor_active() then raise exception 'Account inactive' using errcode='42501';end if;
 return jsonb_build_object('enabled',(select enabled from private.push_configuration),'public_key',(select public_key from private.push_configuration),
 'devices',coalesce((select jsonb_agg(jsonb_build_object('id',id,'label',label,'device_token',device_token,'created_at',created_at,'expires_at',expires_at) order by created_at,id)
 from private.push_subscriptions where user_id=auth.uid() and active and expires_at>now()),'[]'::jsonb));
end;$$;
create function public.my_push_devices() returns jsonb language sql stable security invoker set search_path='' as $$select private.my_push_devices();$$;
create function private.register_push_device(p_subscription jsonb,p_device_token uuid,p_label text) returns uuid
language plpgsql security definer set search_path='' as $$
declare existing private.push_subscriptions;target uuid; endpoint_value text;key_value text;auth_value text;
begin
 if not private.actor_active() then raise exception 'Account inactive' using errcode='42501';end if;
 if not (select enabled from private.push_configuration) then raise exception 'Push delivery unavailable' using errcode='55000';end if;
 if p_subscription is null or jsonb_typeof(p_subscription)<>'object' or jsonb_typeof(p_subscription->'keys')<>'object'
 or p_device_token is null or p_label is null or length(trim(p_label)) not between 1 and 80 then raise exception 'Invalid device subscription' using errcode='22023';end if;
 endpoint_value=p_subscription->>'endpoint';key_value=p_subscription->'keys'->>'p256dh';auth_value=p_subscription->'keys'->>'auth';
 if not private.valid_push_endpoint(endpoint_value) or key_value is null or key_value!~'^[A-Za-z0-9_-]{87}$'
 or auth_value is null or auth_value!~'^[A-Za-z0-9_-]{22}$' or get_byte(decode(translate(key_value,'-_','+/')||'=','base64'),0)<>4 then raise exception 'Invalid device endpoint or encryption keys' using errcode='22023';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('push-subscription:'||endpoint_value,0));
 select * into existing from private.push_subscriptions where endpoint=endpoint_value for update;
 if found and existing.user_id<>auth.uid() then raise exception 'Device belongs to another account' using errcode='42501';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('push-owner:'||auth.uid()::text,0));
 if (existing.id is null or not existing.active or existing.expires_at<=now()) and (select count(*) from private.push_subscriptions where user_id=auth.uid() and active and expires_at>now())>=5 then raise exception 'Five active devices maximum' using errcode='54000';end if;
 insert into private.push_subscriptions(user_id,endpoint,p256dh,auth_secret,device_token,label)
 values(auth.uid(),endpoint_value,key_value,auth_value,p_device_token,trim(p_label))
 on conflict(endpoint) do update set p256dh=excluded.p256dh,auth_secret=excluded.auth_secret,device_token=excluded.device_token,label=excluded.label,active=true,expires_at=now()+interval '90 days',updated_at=now()
 returning id into target;
 return target;
end;$$;
create function public.register_push_device(p_subscription jsonb,p_device_token uuid,p_label text) returns uuid language sql security invoker set search_path='' as $$select private.register_push_device(p_subscription,p_device_token,p_label);$$;
create function private.remove_push_device(p_device_id uuid) returns boolean language plpgsql security definer set search_path='' as $$
begin
 if not private.actor_active() then raise exception 'Account inactive' using errcode='42501';end if;
 update private.push_subscriptions set active=false,updated_at=now() where id=p_device_id and user_id=auth.uid();return found;
end;$$;
create function public.remove_push_device(p_device_id uuid) returns boolean language sql security invoker set search_path='' as $$select private.remove_push_device(p_device_id);$$;
create function private.queue_notification_push() returns trigger language plpgsql security definer set search_path='' as $$begin
 if tg_op='UPDATE' and new.created_at is not distinct from old.created_at then return new;end if;
 if (select enabled from private.push_configuration) and private.email_category_enabled(new.user_id,new.kind) then
 insert into private.notification_push_outbox(notification_id,subscription_id,occurrence_at)
 select new.id,s.id,new.created_at from private.push_subscriptions s join public.profiles p on p.id=s.user_id
 where s.user_id=new.user_id and s.active and s.expires_at>now() and p.active on conflict do nothing;
 end if;return new;
end;$$;
create trigger queue_notification_push after insert or update of created_at on public.notifications for each row execute function private.queue_notification_push();
create function private.lease_notification_push(p_limit integer default 20) returns jsonb language plpgsql security definer set search_path='' as $$declare result jsonb;begin
 perform private.require_email_worker();
 if p_limit is null or p_limit not between 1 and 100 then raise exception 'Invalid batch' using errcode='22023';end if;
 with expired as(select id from private.notification_push_outbox where state in('leased','sending') and lease_until<=now() for update skip locked limit 100)
 update private.notification_push_outbox o set state=case when state='sending' then 'uncertain' when attempts>=5 then 'failed' else 'pending' end,
 lease_until=null,error_code='lease_expired',finished_at=case when state='sending' or attempts>=5 then now() else null end from expired x where o.id=x.id;
 with candidates as(select id from private.notification_push_outbox where state='pending' and available_at<=now() and attempts<5 order by available_at,id for update skip locked limit p_limit),
 leased as(update private.notification_push_outbox o set state='leased',lease_token=gen_random_uuid(),lease_until=now()+interval '5 minutes',attempts=attempts+1,last_outcome=null from candidates c where o.id=c.id returning o.id,o.lease_token)
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'lease_token',lease_token)),'[]'::jsonb) into result from leased;return result;
end;$$;
create function public.lease_notification_push(p_limit integer default 20) returns jsonb language sql security invoker set search_path='' as $$select private.lease_notification_push(p_limit);$$;
create function private.prepare_notification_push(p_id uuid,p_lease_token uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare o private.notification_push_outbox;s private.push_subscriptions;n public.notifications;d private.delivery_preferences;lang text;defer_until timestamptz;
begin
 perform private.require_email_worker();select * into o from private.notification_push_outbox where id=p_id for update;
 if not found or o.state<>'leased' or o.lease_token is distinct from p_lease_token or o.lease_until<=now() then return null;end if;
 select * into s from private.push_subscriptions where id=o.subscription_id;select * into n from public.notifications where id=o.notification_id;
 select * into d from private.delivery_preferences where user_id=s.user_id;select locale into lang from public.profiles where id=s.user_id and active;
 if lang is null or not s.active or s.expires_at<=now() or not (select enabled from private.push_configuration)
 or not private.email_category_enabled(s.user_id,n.kind) or not private.valid_push_endpoint(s.endpoint)
 or (n.kind='session_reminder' and not exists(select 1 from public.assignment_sessions a join public.job_claims c on c.id=a.claim_id where a.id=n.resource_id and c.lecturer_id=n.user_id and c.status='confirmed' and a.released_at is null and a.starts_at>now()))
 or (n.kind='contract_expiring' and not exists(select 1 from public.contracts c where c.id=n.resource_id and c.user_id=n.user_id and c.status='active' and c.revoked_at is null and c.effective_from<=now() and c.expires_at>now() and c.expires_at<=now()+interval '30 days'))
 or (n.kind='chat_message' and not exists(select 1 from public.messages m join public.chat_members member on member.room_id=m.room_id and member.user_id=n.user_id where m.id=n.resource_id and m.deleted_at is null and member.removed_at is null and not member.muted))
 or (n.kind in('job_matching','job_reopened') and not exists(select 1 from public.jobs j where j.id=n.resource_id and j.status='published' and (j.claim_deadline is null or j.claim_deadline>now()))) then
 update private.notification_push_outbox set state='suppressed',finished_at=now(),lease_until=null where id=o.id;return null;end if;
 defer_until=private.email_quiet_until(d.time_zone,d.quiet_start,d.quiet_end,now());
 if defer_until is not null then update private.notification_push_outbox set state='pending',available_at=defer_until,lease_until=null,attempts=greatest(0,attempts-1) where id=o.id;return null;end if;
 update private.notification_push_outbox set state='sending',lease_until=now()+interval '5 minutes' where id=o.id;
 return jsonb_build_object('id',o.id,'lease_token',o.lease_token,'device_token',s.device_token,'locale',lang,
 'subscription',jsonb_build_object('endpoint',s.endpoint,'keys',jsonb_build_object('p256dh',s.p256dh,'auth',s.auth_secret)));
end;$$;
create function public.prepare_notification_push(p_id uuid,p_lease_token uuid) returns jsonb language sql security invoker set search_path='' as $$select private.prepare_notification_push(p_id,p_lease_token);$$;
create function private.finish_notification_push(p_id uuid,p_lease_token uuid,p_outcome text,p_error_code text default null,p_retry_after integer default null) returns boolean language plpgsql security definer set search_path='' as $$declare o private.notification_push_outbox;begin
 perform private.require_email_worker();
 if p_outcome is null or p_outcome not in('accepted','gone','retry','failed','uncertain') or (p_error_code is not null and p_error_code!~'^[a-z0-9_]{1,64}$') or (p_retry_after is not null and p_retry_after not between 0 and 86400) then raise exception 'Invalid outcome' using errcode='22023';end if;
 select * into o from private.notification_push_outbox where id=p_id for update;
 if not found or o.lease_token is distinct from p_lease_token then return false;end if;
 if o.last_outcome=p_outcome then return true;end if;
 if o.state<>'sending' or o.lease_until<=now() then return false;end if;
 if p_outcome='gone' then update private.push_subscriptions set active=false,updated_at=now() where id=o.subscription_id;end if;
 update private.notification_push_outbox set state=case when p_outcome='gone' then 'suppressed' when p_outcome='retry' and attempts<5 then 'pending' when p_outcome='retry' then 'failed' else p_outcome end,
 available_at=case when p_outcome='retry' then now()+make_interval(secs=>greatest(coalesce(p_retry_after,0),least(3600,30*(2^attempts)::integer))) else available_at end,
 lease_until=null,last_outcome=p_outcome,error_code=p_error_code,finished_at=case when p_outcome='retry' and attempts<5 then null else now() end where id=o.id;return true;
end;$$;
create function public.finish_notification_push(p_id uuid,p_lease_token uuid,p_outcome text,p_error_code text default null,p_retry_after integer default null) returns boolean language sql security invoker set search_path='' as $$select private.finish_notification_push(p_id,p_lease_token,p_outcome,p_error_code,p_retry_after);$$;
revoke all on function private.valid_push_endpoint(text),private.queue_notification_push() from public,anon,authenticated,service_role;
revoke all on function private.my_push_devices(),public.my_push_devices(),private.register_push_device(jsonb,uuid,text),public.register_push_device(jsonb,uuid,text),private.remove_push_device(uuid),public.remove_push_device(uuid) from public,anon,service_role;
grant execute on function private.my_push_devices(),public.my_push_devices(),private.register_push_device(jsonb,uuid,text),public.register_push_device(jsonb,uuid,text),private.remove_push_device(uuid),public.remove_push_device(uuid) to authenticated;
revoke all on function private.configure_web_push(text,boolean),public.configure_web_push(text,boolean),private.lease_notification_push(integer),public.lease_notification_push(integer),private.prepare_notification_push(uuid,uuid),public.prepare_notification_push(uuid,uuid),private.finish_notification_push(uuid,uuid,text,text,integer),public.finish_notification_push(uuid,uuid,text,text,integer) from public,anon,authenticated;
grant execute on function private.configure_web_push(text,boolean),public.configure_web_push(text,boolean),private.lease_notification_push(integer),public.lease_notification_push(integer),private.prepare_notification_push(uuid,uuid),public.prepare_notification_push(uuid,uuid),private.finish_notification_push(uuid,uuid,text,text,integer),public.finish_notification_push(uuid,uuid,text,text,integer) to service_role;

create function private.refresh_push_reminders(p_limit integer default 100) returns integer language plpgsql security definer set search_path='' as $$
declare account_id uuid;added integer;total integer:=0;
begin
 perform private.require_email_worker();
 if p_limit is null or p_limit not between 1 and 100 then raise exception 'Invalid reminder batch' using errcode='22023';end if;
 if not (select enabled from private.push_configuration) then return 0;end if;
 for account_id in select p.id from public.profiles p join private.notification_preferences n on n.user_id=p.id
 where p.active and n.reminders and exists(select 1 from private.push_subscriptions s where s.user_id=p.id and s.active and s.expires_at>now() and (s.last_reminder_scan_at is null or s.last_reminder_scan_at<=now()-interval '15 minutes')) order by p.id limit p_limit
 loop
  perform 1 from private.push_subscriptions s where s.user_id=account_id and s.active for update skip locked;
  insert into public.notifications(user_id,kind,resource_id)
  select account_id,'session_reminder',s.id from public.assignment_sessions s join public.job_claims c on c.id=s.claim_id
  where c.lecturer_id=account_id and c.status='confirmed' and s.released_at is null and s.starts_at>now() and s.starts_at<=now()+interval '24 hours'
  order by s.starts_at limit 500 on conflict do nothing;
  get diagnostics added=row_count;total=total+added;
  insert into public.notifications(user_id,kind,resource_id)
  select account_id,'contract_expiring',c.id from public.contracts c where c.user_id=account_id and c.status='active' and c.revoked_at is null and c.effective_from<=now() and c.expires_at>now() and c.expires_at<=now()+interval '30 days'
  order by c.expires_at limit 500 on conflict do nothing;
  get diagnostics added=row_count;total=total+added;
  update private.push_subscriptions set last_reminder_scan_at=now() where user_id=account_id;
 end loop;return total;
end;$$;
create function public.refresh_push_reminders(p_limit integer default 100) returns integer language sql security invoker set search_path='' as $$select private.refresh_push_reminders(p_limit);$$;
revoke all on function private.refresh_push_reminders(integer),public.refresh_push_reminders(integer) from public,anon,authenticated;
grant execute on function private.refresh_push_reminders(integer),public.refresh_push_reminders(integer) to service_role;

commit;
