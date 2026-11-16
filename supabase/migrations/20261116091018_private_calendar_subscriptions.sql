begin;
create table private.calendar_subscriptions (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.profiles(id) on delete cascade,
 label text not null check(length(trim(label)) between 1 and 80),
 token_hash text not null unique check(token_hash~'^[a-f0-9]{64}$'),
 include_private boolean not null default false,
 expires_at timestamptz not null default now()+interval '90 days',
 revoked_at timestamptz,
 version integer not null default 1 check(version>0),
 client_id uuid not null,
 rotation_client_id uuid,
 rotation_expected_version integer,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(user_id,client_id)
);
alter table private.calendar_subscriptions enable row level security;
revoke all on private.calendar_subscriptions from public,anon,authenticated,service_role;
create function private.my_calendar_subscriptions() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.actor_active() then raise exception 'Active account required' using errcode='42501';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'label',s.label,'include_private',s.include_private,'expires_at',s.expires_at,'revoked_at',s.revoked_at,'version',s.version,'created_at',s.created_at) order by s.created_at desc,s.id) from private.calendar_subscriptions s where s.user_id=auth.uid()),'[]'::jsonb);
end;$$;
create function public.my_calendar_subscriptions() returns jsonb language sql stable security invoker set search_path='' as $$select private.my_calendar_subscriptions();$$;
create function private.save_calendar_subscription(p_id uuid,p_label text,p_include_private boolean,p_token text,p_expected_version integer,p_client_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s private.calendar_subscriptions; hashed text;
begin
 if not private.actor_active() then raise exception 'Active account required' using errcode='42501';end if;
 if p_label is null or length(trim(p_label)) not between 1 and 80 or p_include_private is null or p_token is null or p_token!~'^[a-f0-9]{64}$' or p_client_id is null then raise exception 'Invalid calendar subscription' using errcode='22023';end if;
 perform 1 from public.profiles where id=auth.uid() and active for share;
 if not found then raise exception 'Active account required' using errcode='42501';end if;
 hashed=encode(sha256(convert_to(p_token,'UTF8')),'hex');
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('calendar-subscriptions:'||auth.uid()::text,0));
 if p_id is null then
  if p_expected_version is distinct from 0 then raise exception 'Invalid new subscription version' using errcode='40001';end if;
  select * into s from private.calendar_subscriptions where user_id=auth.uid() and client_id=p_client_id;
  if found then
   if s.token_hash<>hashed or s.label<>trim(p_label) or s.include_private<>p_include_private then raise exception 'Subscription retry changed' using errcode='22023';end if;
   if s.revoked_at is not null or s.expires_at<=now() then raise exception 'Subscription revoked or expired' using errcode='42501';end if;
  else
   if p_expected_version is distinct from 0 then raise exception 'Invalid new subscription version' using errcode='40001';end if;
   if (select count(*) from private.calendar_subscriptions where user_id=auth.uid())>=20 then raise exception 'Subscription limit reached' using errcode='54000';end if;
   insert into private.calendar_subscriptions(user_id,label,token_hash,include_private,client_id) values(auth.uid(),trim(p_label),hashed,p_include_private,p_client_id) returning * into s;
  end if;
 else
  select * into s from private.calendar_subscriptions where id=p_id for update;
  if not found or s.user_id<>auth.uid() then raise exception 'Own subscription required' using errcode='42501';end if;
  if s.rotation_client_id=p_client_id then
   if s.rotation_expected_version is distinct from p_expected_version or s.token_hash<>hashed or s.label<>trim(p_label) or s.include_private<>p_include_private then raise exception 'Subscription retry changed' using errcode='22023';end if;
   if s.version is distinct from p_expected_version+1 or s.revoked_at is not null or s.expires_at<=now() then raise exception 'Subscription changed' using errcode='40001';end if;
   return jsonb_build_object('id',s.id,'label',s.label,'include_private',s.include_private,'expires_at',s.expires_at,'revoked_at',s.revoked_at,'version',s.version,'created_at',s.created_at);
  end if;
  if s.version is distinct from p_expected_version then raise exception 'Subscription changed' using errcode='40001';end if;
  update private.calendar_subscriptions set rotation_client_id=p_client_id,rotation_expected_version=p_expected_version,label=trim(p_label),token_hash=hashed,include_private=p_include_private,expires_at=now()+interval '90 days',revoked_at=null,version=version+1,updated_at=now() where id=p_id returning * into s;
 end if;
 return jsonb_build_object('id',s.id,'label',s.label,'include_private',s.include_private,'expires_at',s.expires_at,'revoked_at',s.revoked_at,'version',s.version,'created_at',s.created_at);
end;$$;
create function public.save_calendar_subscription(p_id uuid,p_label text,p_include_private boolean,p_token text,p_expected_version integer,p_client_id uuid) returns jsonb language sql security invoker set search_path='' as $$select private.save_calendar_subscription(p_id,p_label,p_include_private,p_token,p_expected_version,p_client_id);$$;
create function private.revoke_calendar_subscription(p_id uuid,p_expected_version integer) returns boolean language plpgsql security definer set search_path='' as $$
declare s private.calendar_subscriptions;
begin
 if not private.actor_active() then raise exception 'Active account required' using errcode='42501';end if;
 select * into s from private.calendar_subscriptions where id=p_id for update;
 if not found or s.user_id<>auth.uid() then raise exception 'Own subscription required' using errcode='42501';end if;
 if s.version is distinct from p_expected_version then raise exception 'Subscription changed' using errcode='40001';end if;
 update private.calendar_subscriptions set revoked_at=now(),version=version+1,updated_at=now() where id=p_id;
 return true;
end;$$;
create function public.revoke_calendar_subscription(p_id uuid,p_expected_version integer) returns boolean language sql security invoker set search_path='' as $$select private.revoke_calendar_subscription(p_id,p_expected_version);$$;
create function private.recheck_calendar_subscription(p_token_hash text) returns boolean language plpgsql stable security definer set search_path='' as $$
begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'Calendar reader required' using errcode='42501';end if;
 if p_token_hash is null or p_token_hash!~'^[a-f0-9]{64}$' then return false;end if;
 return exists(select 1 from private.calendar_subscriptions s join public.profiles p on p.id=s.user_id where s.token_hash=p_token_hash and s.revoked_at is null and s.expires_at>now() and p.active);
end;$$;
create function public.recheck_calendar_subscription(p_token_hash text) returns boolean language sql stable security invoker set search_path='' as $$select private.recheck_calendar_subscription(p_token_hash);$$;
create function private.calendar_subscription_snapshot(p_token_hash text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s private.calendar_subscriptions;items jsonb;
begin
 if not private.recheck_calendar_subscription(p_token_hash) then return null;end if;
 select * into s from private.calendar_subscriptions where token_hash=p_token_hash;
 select coalesce(jsonb_agg(to_jsonb(item) order by item.starts_at,item.id),'[]'::jsonb) into items from
 (select * from (
   select a.id,'assignment'::text kind,j.title,a.starts_at,a.ends_at,j.time_zone from public.assignment_sessions a join public.job_claims c on c.id=a.claim_id join public.jobs j on j.id=c.job_id
    where c.lecturer_id=s.user_id and a.lecturer_id=s.user_id and c.status='confirmed' and a.released_at is null and a.starts_at<now()+interval '365 days' and a.ends_at>now()-interval '30 days'
   union all select e.id,'private'::text,e.title,e.starts_at,e.ends_at,e.time_zone from public.personal_events e where s.include_private and e.user_id=s.user_id and e.starts_at<now()+interval '365 days' and e.ends_at>now()-interval '30 days'
  ) available order by starts_at,id limit 2001) item;
 if jsonb_array_length(items)>2000 then raise exception 'Calendar feed size limit reached' using errcode='54000';end if;
 return jsonb_build_object('label',s.label,'items',items);
end;$$;
create function public.calendar_subscription_snapshot(p_token_hash text) returns jsonb language sql stable security invoker set search_path='' as $$select private.calendar_subscription_snapshot(p_token_hash);$$;
revoke all on function private.my_calendar_subscriptions(),public.my_calendar_subscriptions(),private.save_calendar_subscription(uuid,text,boolean,text,integer,uuid),public.save_calendar_subscription(uuid,text,boolean,text,integer,uuid),private.revoke_calendar_subscription(uuid,integer),public.revoke_calendar_subscription(uuid,integer) from public,anon,authenticated,service_role;
grant execute on function private.my_calendar_subscriptions(),public.my_calendar_subscriptions(),private.save_calendar_subscription(uuid,text,boolean,text,integer,uuid),public.save_calendar_subscription(uuid,text,boolean,text,integer,uuid),private.revoke_calendar_subscription(uuid,integer),public.revoke_calendar_subscription(uuid,integer) to authenticated;
revoke all on function private.recheck_calendar_subscription(text),public.recheck_calendar_subscription(text),private.calendar_subscription_snapshot(text),public.calendar_subscription_snapshot(text) from public,anon,authenticated,service_role;
grant execute on function private.recheck_calendar_subscription(text),public.recheck_calendar_subscription(text),private.calendar_subscription_snapshot(text),public.calendar_subscription_snapshot(text) to service_role;
commit;
