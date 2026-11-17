begin;
-- Only server workflows write these records. Missing records are legacy/unknown,
-- never evidence that a membership is exclusively assignment-derived.
create table private.participant_chat_origins (
 room_id uuid not null references public.chat_rooms(id),
 user_id uuid not null references public.profiles(id),
 manual boolean not null default false,
 assignment boolean not null default false,
 unknown boolean not null default false,
 primary key(room_id,user_id)
);
alter table private.participant_chat_origins enable row level security;
revoke all on private.participant_chat_origins from public,anon,authenticated,service_role;

-- Caller must already hold the room row lock, as do all handover paths.
create function private.participant_chat_assignment_grant(p_room uuid,p_user uuid) returns void
language plpgsql security definer set search_path='' as $$
declare active boolean;
begin
 select exists(select 1 from public.chat_members where room_id=p_room and user_id=p_user and removed_at is null) into active;
 insert into private.participant_chat_origins(room_id,user_id,assignment,unknown)
 values(p_room,p_user,true,active)
 on conflict(room_id,user_id) do update set assignment=true,
  manual=case when active then private.participant_chat_origins.manual else false end,
  unknown=case when active then private.participant_chat_origins.unknown else false end;
end;$$;

-- If no other source proves access, unknown historical memberships need an
-- explicit room-manager decision; all enclosing release writes roll back.
create function private.participant_chat_assignment_release(p_room uuid,p_user uuid,p_course uuid) returns void
language plpgsql security definer set search_path='' as $$
declare origin private.participant_chat_origins;owner uuid;active boolean;
begin
 select owner_id into owner from public.chat_rooms where id=p_room for update;
 select exists(select 1 from public.chat_members where room_id=p_room and user_id=p_user and removed_at is null) into active;
 if not active then return;end if;
 select * into origin from private.participant_chat_origins where room_id=p_room and user_id=p_user for update;
 if exists(select 1 from public.jobs j join public.job_claims c on c.job_id=j.id
   where j.course_run_id=p_course and c.lecturer_id=p_user and c.status='confirmed')
 or exists(select 1 from public.course_enrolments e where e.course_run_id=p_course and e.user_id=p_user and e.status in('enrolled','completed')) then return;end if;
 if origin.manual then return;end if;
 if origin.room_id is null or origin.unknown or not origin.assignment or owner=p_user then
  raise exception 'Participant chat membership needs an explicit room manager decision before assignment release' using errcode='PZ002';
 end if;
 update public.chat_members set removed_at=clock_timestamp() where room_id=p_room and user_id=p_user and removed_at is null;
 update private.participant_chat_origins set assignment=false where room_id=p_room and user_id=p_user;
end;$$;

-- Explicit room-manager adds settle unknown provenance as independent. An
-- explicit remove may settle it by revoking access, but cannot silently remove
-- access while an assignment or course enrolment still authorises the member.
alter function private.manage_chat_member(uuid,uuid,boolean) rename to manage_chat_member_before_origins;
revoke all on function private.manage_chat_member_before_origins(uuid,uuid,boolean) from public,anon,authenticated,service_role;
create function private.manage_chat_member(p_room_id uuid,p_user_id uuid,p_remove boolean) returns void
language plpgsql security definer set search_path='' as $$
declare room public.chat_rooms;
begin
 -- Verify authority before taking a target's cross-job lock, then recheck
 -- inside the original routine after the room lock has been acquired.
 select * into room from public.chat_rooms where id=p_room_id;
 if not found or not private.can_access_chat_room(p_room_id) or room.kind in ('dm','general')
 or not (room.owner_id=auth.uid() or (room.kind in ('participant_course','lecturer_course') and private.has_permission('courses.manage'))) then
  raise exception 'Membership management denied' using errcode='42501';end if;
 perform 1 from public.profiles where id=p_user_id for share;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text,0));
 select * into room from public.chat_rooms where id=p_room_id for update;
 perform private.manage_chat_member_before_origins(p_room_id,p_user_id,p_remove);
 if room.kind='participant_course' and p_remove and (
  exists(select 1 from public.jobs j join public.job_claims c on c.job_id=j.id where j.course_run_id=room.course_run_id and c.lecturer_id=p_user_id and c.status='confirmed')
  or exists(select 1 from public.course_enrolments e where e.course_run_id=room.course_run_id and e.user_id=p_user_id and e.status in('enrolled','completed'))) then
  raise exception 'An active assignment or enrolment still grants participant chat access' using errcode='22023';
 end if;
 if room.kind='participant_course' then
  insert into private.participant_chat_origins(room_id,user_id,manual,assignment,unknown)
  values(p_room_id,p_user_id,not p_remove,false,false)
  on conflict(room_id,user_id) do update set manual=not p_remove,unknown=false,
   assignment=case when p_remove then false else private.participant_chat_origins.assignment end;
 end if;
end;$$;
revoke all on function private.manage_chat_member(uuid,uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function private.manage_chat_member(uuid,uuid,boolean) to authenticated;

alter function private.create_chat_group(text,uuid[],text,uuid) rename to create_chat_group_before_origins;
revoke all on function private.create_chat_group_before_origins(text,uuid[],text,uuid) from public,anon,authenticated,service_role;
create function private.create_chat_group(p_title text,p_member_ids uuid[],p_kind text default 'topic',p_job_id uuid default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
 result=private.create_chat_group_before_origins(p_title,p_member_ids,p_kind,p_job_id);
 if p_kind='participant_course' then
  insert into private.participant_chat_origins(room_id,user_id,manual)
   select room_id,user_id,true from public.chat_members where room_id=result and removed_at is null;
 end if;
 return result;
end;$$;
revoke all on function private.create_chat_group(text,uuid[],text,uuid) from public,anon,authenticated,service_role;
grant execute on function private.create_chat_group(text,uuid[],text,uuid) to authenticated;

-- A room manager resolves a historical unknown with an explicit choice, not a
-- guess. When assignment-only is chosen, a current entitlement is mandatory.
create function private.resolve_participant_chat_origin(p_room uuid,p_user uuid,p_independent boolean) returns void
language plpgsql security definer set search_path='' as $$
declare room public.chat_rooms; assigned boolean; enrolled boolean;
begin
 if p_independent is null then raise exception 'Explicit membership decision required' using errcode='22023';end if;
 select * into room from public.chat_rooms where id=p_room for update;
 if not found or room.kind<>'participant_course' or not private.can_access_chat_room(p_room)
 or not (room.owner_id=auth.uid() or private.has_permission('courses.manage')) then
  raise exception 'Membership management denied' using errcode='42501';end if;
 if not exists(select 1 from public.chat_members where room_id=p_room and user_id=p_user and removed_at is null) then
  raise exception 'Active membership required' using errcode='22023';end if;
 select exists(select 1 from public.jobs j join public.job_claims c on c.job_id=j.id where j.course_run_id=room.course_run_id and c.lecturer_id=p_user and c.status='confirmed') into assigned;
 select exists(select 1 from public.course_enrolments e where e.course_run_id=room.course_run_id and e.user_id=p_user and e.status in('enrolled','completed')) into enrolled;
 if not p_independent and (room.owner_id=p_user or not (assigned or enrolled)) then
  raise exception 'A current assignment or enrolment is required for non-independent membership' using errcode='22023';end if;
 insert into private.participant_chat_origins(room_id,user_id,manual,assignment,unknown) values(p_room,p_user,p_independent,(assigned or enrolled),false)
 on conflict(room_id,user_id) do update set manual=excluded.manual,assignment=excluded.assignment,unknown=false;
 insert into public.audit_events(actor_id,action,resource_id,details) values(auth.uid(),'chat.membership_origin_resolved',p_room,jsonb_build_object('user_id',p_user,'independent',p_independent));
end;$$;
create function public.resolve_participant_chat_origin(p_room uuid,p_user uuid,p_independent boolean) returns void
language sql security invoker set search_path='' as $$select private.resolve_participant_chat_origin(p_room,p_user,p_independent);$$;
revoke all on function private.resolve_participant_chat_origin(uuid,uuid,boolean),public.resolve_participant_chat_origin(uuid,uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function private.resolve_participant_chat_origin(uuid,uuid,boolean),public.resolve_participant_chat_origin(uuid,uuid,boolean) to authenticated;

-- The last independent enrolment may end after the assignment. Serialize on
-- the same course row and re-evaluate membership in the enrolment transaction.
alter function private.manage_course_enrolment(uuid,uuid,text) rename to manage_course_enrolment_before_origins;
revoke all on function private.manage_course_enrolment_before_origins(uuid,uuid,text) from public,anon,authenticated,service_role;
create function private.manage_course_enrolment(p_course_run_id uuid,p_user_id uuid,p_status text) returns void
language plpgsql security definer set search_path='' as $$
declare room record;
begin
 if not private.has_permission('courses.manage') then raise exception 'courses.manage and MFA required' using errcode='42501';end if;
 -- Same person-first gate used by job claims, cancellations and handovers.
 perform 1 from public.profiles where id=p_user_id for share;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text,0));
 perform private.manage_course_enrolment_before_origins(p_course_run_id,p_user_id,p_status);
 if p_status='removed' then
  for room in select id from public.chat_rooms where course_run_id=p_course_run_id and kind='participant_course' order by id for update loop
   perform private.participant_chat_assignment_release(room.id,p_user_id,p_course_run_id);
  end loop;
 end if;
end;$$;
revoke all on function private.manage_course_enrolment(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function private.manage_course_enrolment(uuid,uuid,text) to authenticated;

-- Both direct withdrawal and approval call this wrapper. Release is in the
-- same transaction as the original cancellation, including all its guards.
alter function private.cancel_job_assignment_immediate(uuid,text,uuid) rename to cancel_job_assignment_before_chat_origins;
revoke all on function private.cancel_job_assignment_before_chat_origins(uuid,text,uuid) from public,anon,authenticated,service_role;
create function private.cancel_job_assignment_immediate(p_claim uuid,p_reason text,p_request uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare result uuid; c public.job_claims; room record;
begin
 select * into c from public.job_claims where id=p_claim;
 result=private.cancel_job_assignment_before_chat_origins(p_claim,p_reason,p_request);
 perform 1 from public.course_runs where id=(select course_run_id from public.jobs where id=c.job_id) for update;
 for room in select r.id,r.course_run_id from public.chat_rooms r join public.jobs j on j.course_run_id=r.course_run_id
  where j.id=c.job_id and r.kind='participant_course' order by r.id for update of r loop
  perform private.participant_chat_assignment_release(room.id,c.lecturer_id,room.course_run_id);
 end loop;
 return result;
end;$$;
revoke all on function private.participant_chat_assignment_grant(uuid,uuid),private.participant_chat_assignment_release(uuid,uuid,uuid),private.cancel_job_assignment_immediate(uuid,text,uuid) from public,anon,authenticated,service_role;
commit;
