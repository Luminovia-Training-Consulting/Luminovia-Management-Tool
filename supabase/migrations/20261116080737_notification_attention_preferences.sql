begin;

-- Attention controls never delete, postpone or acknowledge inbox events. The
-- existing four-category preference contract remains independently compatible.
create table private.attention_preferences (
 user_id uuid primary key references public.profiles(id) on delete cascade,
 enabled boolean not null,
 starts_minute integer not null check(starts_minute between 0 and 1439),
 ends_minute integer not null check(ends_minute between 0 and 1439),
 time_zone text not null,
 version integer not null default 1 check(version>0),
 updated_at timestamptz not null default now(),
 check(starts_minute<>ends_minute)
);
alter table private.attention_preferences enable row level security;
create policy attention_preferences_own on private.attention_preferences for select to authenticated
 using((select private.actor_active()) and user_id=(select auth.uid()));
revoke all on private.attention_preferences from public,anon,authenticated;

create function private.attention_is_quiet(p_at timestamptz,p_zone text,p_start integer,p_end integer)
returns boolean language plpgsql stable set search_path='' as $$
declare minute integer;
begin
 if p_at is null or not isfinite(p_at) or p_zone is null
 or not exists(select 1 from pg_catalog.pg_timezone_names where name=p_zone)
 or p_start is null or p_end is null or p_start not between 0 and 1439
 or p_end not between 0 and 1439 or p_start=p_end then
  raise exception 'Invalid attention interval' using errcode='22023';
 end if;
 minute=extract(hour from p_at at time zone p_zone)::integer*60
  +extract(minute from p_at at time zone p_zone)::integer;
 -- Compare actual local wall-clock minutes. Missing DST minutes never occur;
 -- both occurrences of a repeated minute obey the same chosen quiet window.
 return case when p_start<p_end then minute>=p_start and minute<p_end
  else minute>=p_start or minute<p_end end;
end;$$;

create function private.attention_preferences() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare p private.attention_preferences; zone text;
begin
 if not private.actor_active() then raise exception 'Account inactive' using errcode='42501';end if;
 select * into p from private.attention_preferences where user_id=auth.uid();
 if not found then
  select time_zone into zone from public.profiles where id=auth.uid();
  return jsonb_build_object('enabled',false,'start_time','22:00','end_time','07:00','time_zone',zone,'version',0);
 end if;
 return jsonb_build_object('enabled',p.enabled,
  'start_time',lpad((p.starts_minute/60)::text,2,'0')||':'||lpad((p.starts_minute%60)::text,2,'0'),
  'end_time',lpad((p.ends_minute/60)::text,2,'0')||':'||lpad((p.ends_minute%60)::text,2,'0'),
  'time_zone',p.time_zone,'version',p.version);
end;$$;
create function public.attention_preferences() returns jsonb
language sql stable security invoker set search_path='' as $$select private.attention_preferences();$$;

create function private.save_attention_preferences(p_payload jsonb,p_expected_version integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); p private.attention_preferences;
 start_text text; end_text text; zone text; starts integer; ends integer;
begin
 perform 1 from public.profiles where id=actor and active for share;
 if not found then raise exception 'Account inactive' using errcode='42501';end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object'
 or (select count(*) from jsonb_object_keys(p_payload))<>4
 or exists(select 1 from jsonb_object_keys(p_payload) k where k not in('enabled','start_time','end_time','time_zone'))
 or jsonb_typeof(p_payload->'enabled')<>'boolean'
 or jsonb_typeof(p_payload->'start_time')<>'string'
 or jsonb_typeof(p_payload->'end_time')<>'string'
 or jsonb_typeof(p_payload->'time_zone')<>'string'
 or p_expected_version is null or p_expected_version<0 then
  raise exception 'Invalid attention preferences' using errcode='22023';
 end if;
 start_text=p_payload->>'start_time';end_text=p_payload->>'end_time';zone=p_payload->>'time_zone';
 if start_text !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
 or end_text !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
 or not exists(select 1 from pg_catalog.pg_timezone_names where name=zone) then
  raise exception 'Valid times and IANA time zone required' using errcode='22023';
 end if;
 starts=split_part(start_text,':',1)::integer*60+split_part(start_text,':',2)::integer;
 ends=split_part(end_text,':',1)::integer*60+split_part(end_text,':',2)::integer;
 if starts=ends then raise exception 'Quiet start and end must differ' using errcode='22023';end if;
 -- The actor-scoped mutex also serialises concurrent first saves where a row
 -- does not yet exist. No lock upgrade on profiles is required.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('attention:'||actor::text,0));
 select * into p from private.attention_preferences where user_id=actor for update;
 if coalesce(p.version,0)<>p_expected_version then raise exception 'Preferences changed; reload before saving' using errcode='40001';end if;
 insert into private.attention_preferences(user_id,enabled,starts_minute,ends_minute,time_zone)
 values(actor,(p_payload->>'enabled')::boolean,starts,ends,zone)
 on conflict(user_id) do update set enabled=excluded.enabled,starts_minute=excluded.starts_minute,
  ends_minute=excluded.ends_minute,time_zone=excluded.time_zone,version=private.attention_preferences.version+1,updated_at=now();
 return private.attention_preferences();
end;$$;
create function public.save_attention_preferences(p_payload jsonb,p_expected_version integer) returns jsonb
language sql security invoker set search_path='' as $$select private.save_attention_preferences(p_payload,p_expected_version);$$;

create index notifications_critical_unread on public.notifications(user_id,created_at desc,id desc)
 where read_at is null and kind in('claim_confirmed','claim_cancelled','contract_available');
create function private.notification_attention() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare p private.attention_preferences; total bigint;
begin
 if not private.actor_active() then raise exception 'Account inactive' using errcode='42501';end if;
 select * into p from private.attention_preferences where user_id=auth.uid();
 if not found or not p.enabled then return jsonb_build_object('quiet_active',false);end if;
 if not private.attention_is_quiet(now(),p.time_zone,p.starts_minute,p.ends_minute)
 then return jsonb_build_object('quiet_active',false);end if;
 select count(*) into total from public.notifications where user_id=auth.uid() and read_at is null
  and kind in('claim_confirmed','claim_cancelled','contract_available');
 return jsonb_build_object('quiet_active',true,'attention_count',total);
end;$$;
create or replace function public.notification_inbox(p_unread_only boolean default false,
 p_before_at timestamptz default null,p_before_id uuid default null,p_limit integer default 40)
returns jsonb language sql stable security invoker set search_path='' as $$
 select private.notification_inbox(p_unread_only,p_before_at,p_before_id,p_limit)||private.notification_attention();
$$;

revoke all on function private.attention_is_quiet(timestamptz,text,integer,integer) from public,anon,authenticated;
revoke all on function private.attention_preferences(),public.attention_preferences(),
 private.save_attention_preferences(jsonb,integer),public.save_attention_preferences(jsonb,integer),
 private.notification_attention(),public.notification_inbox(boolean,timestamptz,uuid,integer) from public,anon,authenticated;
grant execute on function private.attention_preferences(),public.attention_preferences(),
 private.save_attention_preferences(jsonb,integer),public.save_attention_preferences(jsonb,integer),
 private.notification_attention(),public.notification_inbox(boolean,timestamptz,uuid,integer) to authenticated;
commit;
