-- Private availability is distinct from personal appointments. Sharing is opt-in.
begin;
create table public.lecturer_availability (
 id uuid primary key,
 user_id uuid not null references public.profiles(id),
 kind text not null check(kind in('available','unavailable')),
 starts_at timestamptz not null,
 ends_at timestamptz not null,
 time_zone text not null default 'Europe/Berlin',
 notes text not null default '' check(length(notes)<=2000),
 share_with_management boolean not null default false,
 version integer not null default 1 check(version>0),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check(isfinite(starts_at) and isfinite(ends_at) and ends_at>starts_at)
);
create index lecturer_availability_owner_start on public.lecturer_availability(user_id,starts_at);
create index lecturer_availability_shared_start on public.lecturer_availability(starts_at,user_id) where share_with_management;
alter table public.lecturer_availability enable row level security;
revoke all on public.lecturer_availability from public,anon,authenticated;
grant select on public.lecturer_availability to authenticated;
grant all on public.lecturer_availability to service_role;
create policy availability_own_read on public.lecturer_availability for select to authenticated using((select private.actor_active()) and user_id=(select auth.uid()));
insert into public.role_permissions(role,permission) select r,'availability.read_shared' from unnest(array['owner','admin','management'])r on conflict do nothing;
create trigger availability_valid_zone before insert or update of time_zone on public.lecturer_availability for each row execute function private.validate_time_zone();

create function private.check_availability_window() returns trigger language plpgsql security definer set search_path='' as $$
begin
 -- Same ordering as claim_job: profile SHARE, then the existing actor mutex.
 perform 1 from public.profiles where id=new.user_id and active for share;
 if not found then raise exception 'Active availability owner required' using errcode='42501';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.user_id::text,0));
 if new.kind='unavailable' and exists(select 1 from public.assignment_sessions a join public.job_claims c on c.id=a.claim_id where a.lecturer_id=new.user_id and a.released_at is null and c.status='confirmed' and tstzrange(a.starts_at,a.ends_at,'[)') && tstzrange(new.starts_at,new.ends_at,'[)')) then raise exception 'Availability conflicts with a confirmed assignment' using errcode='23P01';end if;
 return new;
end;$$;
create trigger availability_conflict_guard before insert or update of user_id,kind,starts_at,ends_at on public.lecturer_availability for each row execute function private.check_availability_window();
create function private.check_assignment_availability() returns trigger language plpgsql security definer set search_path='' as $$
begin
 -- Cancellation holds the actor mutex before updating releases. A release adds
 -- no occupied time and must never introduce a profile-lock upgrade/order cycle.
 if new.released_at is not null then return new;end if;
 perform 1 from public.profiles where id=new.lecturer_id and active for share;
 if not found then raise exception 'Active assignment owner required' using errcode='42501';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.lecturer_id::text,0));
 if exists(select 1 from public.lecturer_availability a where a.user_id=new.lecturer_id and a.kind='unavailable' and tstzrange(a.starts_at,a.ends_at,'[)') && tstzrange(new.starts_at,new.ends_at,'[)')) then raise exception 'Assignment conflicts with unavailable window' using errcode='23P01';end if;
 return new;
end;$$;
create trigger assignment_availability_guard before insert or update of lecturer_id,starts_at,ends_at,released_at on public.assignment_sessions for each row execute function private.check_assignment_availability();

create function private.validate_availability_range(p_from timestamptz,p_to timestamptz,p_days integer) returns void language plpgsql immutable set search_path='' as $$
begin
 if p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to) or p_to<=p_from or p_to-p_from>make_interval(days=>p_days)+interval '2 hours' then raise exception 'Invalid bounded availability range' using errcode='22023';end if;
end;$$;
create function private.my_availability(p_from timestamptz,p_to timestamptz) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.actor_active() then raise exception 'Active login required' using errcode='42501';end if;
 perform private.validate_availability_range(p_from,p_to,366);
 return coalesce((select jsonb_agg(to_jsonb(x) order by x.starts_at,x.id) from(select a.* from public.lecturer_availability a where a.user_id=auth.uid() and tstzrange(a.starts_at,a.ends_at,'[)') && tstzrange(p_from,p_to,'[)') order by a.starts_at,a.id limit 500)x),'[]'::jsonb);
end;$$;
create function public.my_availability(p_from timestamptz,p_to timestamptz) returns jsonb language sql security invoker set search_path='' as $$select private.my_availability(p_from,p_to);$$;
create function private.shared_availability(p_from timestamptz,p_to timestamptz) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.has_permission('availability.read_shared') then raise exception 'availability.read_shared and MFA required' using errcode='42501';end if;
 perform private.validate_availability_range(p_from,p_to,93);
 return coalesce((select jsonb_agg(to_jsonb(x) order by x.starts_at,x.user_id,x.id) from(select a.id,a.user_id,p.display_name,a.kind,a.starts_at,a.ends_at,a.time_zone from public.lecturer_availability a join public.profiles p on p.id=a.user_id where a.share_with_management and p.active and private.profile_staff(a.user_id) and tstzrange(a.starts_at,a.ends_at,'[)') && tstzrange(p_from,p_to,'[)') order by a.starts_at,a.user_id,a.id limit 1000)x),'[]'::jsonb);
end;$$;
create function public.shared_availability(p_from timestamptz,p_to timestamptz) returns jsonb language sql security invoker set search_path='' as $$select private.shared_availability(p_from,p_to);$$;

create function private.save_lecturer_availability(p_id uuid,p_payload jsonb,p_version integer default 0) returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();previous public.lecturer_availability;selected_kind text;starts timestamptz;ends timestamptz;zone text;note text;shared boolean;
begin
 if not private.profile_staff(actor) then raise exception 'Active lecturer account required' using errcode='42501';end if;
 if p_id is null or p_version is null or p_version<0 or p_payload is null or jsonb_typeof(p_payload)<>'object' or exists(select 1 from jsonb_object_keys(p_payload)k where k not in('kind','starts_at','ends_at','time_zone','notes','share_with_management')) then raise exception 'Invalid availability payload' using errcode='22023';end if;
 if jsonb_typeof(p_payload->'kind') is distinct from 'string' or jsonb_typeof(p_payload->'starts_at') is distinct from 'string' or jsonb_typeof(p_payload->'ends_at') is distinct from 'string' or jsonb_typeof(p_payload->'time_zone') is distinct from 'string' or (p_payload?'notes' and jsonb_typeof(p_payload->'notes')<>'string') or (p_payload?'share_with_management' and jsonb_typeof(p_payload->'share_with_management')<>'boolean') then raise exception 'Invalid availability fields' using errcode='22023';end if;
 if (p_payload->>'starts_at')!~'(Z|[+-][0-9]{2}:[0-9]{2})$' or (p_payload->>'ends_at')!~'(Z|[+-][0-9]{2}:[0-9]{2})$' then raise exception 'Explicit-offset availability instants required' using errcode='22023';end if;
 selected_kind:=p_payload->>'kind';starts:=(p_payload->>'starts_at')::timestamptz;ends:=(p_payload->>'ends_at')::timestamptz;zone:=p_payload->>'time_zone';note:=coalesce(p_payload->>'notes','');shared:=coalesce((p_payload->>'share_with_management')::boolean,false);
 if selected_kind not in('available','unavailable') or not isfinite(starts) or not isfinite(ends) or ends<=starts or length(note)>2000 then raise exception 'Invalid finite availability window' using errcode='22023';end if;
 if not exists(select 1 from pg_catalog.pg_timezone_names where name=zone) then raise exception 'Invalid IANA time zone' using errcode='22023';end if;
 perform 1 from public.profiles where id=actor and active for share;
 if not found then raise exception 'Active lecturer account required' using errcode='42501';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text,0));
 select * into previous from public.lecturer_availability where id=p_id for update;
 if found then
  if previous.user_id<>actor then raise exception 'Availability access denied' using errcode='42501';end if;
  -- A retained client-generated UUID makes an identical lost-response retry safe.
  if p_version=0 and previous.version=1 and previous.kind=selected_kind and previous.starts_at=starts and previous.ends_at=ends and previous.time_zone=zone and previous.notes=note and previous.share_with_management=shared then return p_id;end if;
  if previous.version<>p_version then raise exception 'Stale availability version' using errcode='40001';end if;
  update public.lecturer_availability set kind=selected_kind,starts_at=starts,ends_at=ends,time_zone=zone,notes=note,share_with_management=shared,version=version+1,updated_at=now() where id=p_id;
 else
  if p_version<>0 then raise exception 'Availability access denied' using errcode='42501';end if;
  insert into public.lecturer_availability(id,user_id,kind,starts_at,ends_at,time_zone,notes,share_with_management) values(p_id,actor,selected_kind,starts,ends,zone,note,shared);
 end if;
 insert into public.audit_events(actor_id,action,resource_id,details) values(actor,case when p_version=0 then 'availability.created' else 'availability.updated' end,p_id,jsonb_build_object('kind',selected_kind,'shared_with_management',shared,'previous_version',p_version));
 return p_id;
end;$$;
create function public.save_lecturer_availability(p_id uuid,p_payload jsonb,p_version integer default 0) returns uuid language sql security invoker set search_path='' as $$select private.save_lecturer_availability(p_id,p_payload,p_version);$$;
create function private.remove_lecturer_availability(p_id uuid,p_version integer) returns void language plpgsql security definer set search_path='' as $$
declare previous public.lecturer_availability;
begin
 if not private.actor_active() then raise exception 'Active login required' using errcode='42501';end if;
 perform 1 from public.profiles where id=auth.uid() and active for share;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text,0));
 select * into previous from public.lecturer_availability where id=p_id for update;
 if not found or previous.user_id<>auth.uid() then raise exception 'Availability access denied' using errcode='42501';end if;
 if p_version is null or previous.version<>p_version then raise exception 'Stale availability version' using errcode='40001';end if;
 delete from public.lecturer_availability where id=p_id;
 insert into public.audit_events(actor_id,action,resource_id) values(auth.uid(),'availability.removed',p_id);
end;$$;
create function public.remove_lecturer_availability(p_id uuid,p_version integer) returns void language sql security invoker set search_path='' as $$select private.remove_lecturer_availability(p_id,p_version);$$;
revoke all on function private.my_availability(timestamptz,timestamptz),public.my_availability(timestamptz,timestamptz),private.shared_availability(timestamptz,timestamptz),public.shared_availability(timestamptz,timestamptz),private.save_lecturer_availability(uuid,jsonb,integer),public.save_lecturer_availability(uuid,jsonb,integer),private.remove_lecturer_availability(uuid,integer),public.remove_lecturer_availability(uuid,integer) from public,anon,authenticated;
grant execute on function private.my_availability(timestamptz,timestamptz),public.my_availability(timestamptz,timestamptz),private.shared_availability(timestamptz,timestamptz),public.shared_availability(timestamptz,timestamptz),private.save_lecturer_availability(uuid,jsonb,integer),public.save_lecturer_availability(uuid,jsonb,integer),private.remove_lecturer_availability(uuid,integer),public.remove_lecturer_availability(uuid,integer) to authenticated;
commit;
