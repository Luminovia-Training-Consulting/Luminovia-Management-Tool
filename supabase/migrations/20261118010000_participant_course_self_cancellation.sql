begin;
-- A learner cancels only their own whole enrolment. Deadlines are based on
-- the first session's absolute instant; local time zones never change it.
create function private.cancel_own_course_enrolment(p_course_run_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare first_start timestamptz; room record; actor uuid:=auth.uid();
begin
 if not private.actor_active() then raise exception 'Active login required' using errcode='42501';end if;
 perform 1 from public.profiles where id=actor for share;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text,0));
 perform 1 from public.course_runs where id=p_course_run_id for update;
 if not found then raise exception 'Active enrolment required' using errcode='42501';end if;
 perform 1 from public.course_enrolments where course_run_id=p_course_run_id and user_id=actor and status='enrolled' for update;
 if not found then raise exception 'Active enrolment required' using errcode='42501';end if;
 select min(starts_at) into first_start from public.course_sessions where course_run_id=p_course_run_id;
 if first_start is null or first_start < clock_timestamp()+interval '7 days' then
  raise exception 'Cancellation deadline passed' using errcode='22023';end if;
 update public.course_enrolments set status='removed',updated_at=clock_timestamp()
  where course_run_id=p_course_run_id and user_id=actor;
 for room in select id from public.chat_rooms where course_run_id=p_course_run_id and kind='participant_course' order by id for update loop
  perform private.participant_chat_assignment_release(room.id,actor,p_course_run_id);
 end loop;
 insert into public.audit_events(actor_id,action,resource_id,details)
 values(actor,'course.enrolment.changed',p_course_run_id,jsonb_build_object('user_id',actor,'previous','enrolled','status','removed','self_cancelled',true));
end;$$;
create function public.cancel_own_course_enrolment(p_course_run_id uuid) returns void
language sql security invoker set search_path='' as $$select private.cancel_own_course_enrolment(p_course_run_id);$$;
revoke all on function private.cancel_own_course_enrolment(uuid),public.cancel_own_course_enrolment(uuid) from public,anon,authenticated,service_role;
grant execute on function private.cancel_own_course_enrolment(uuid),public.cancel_own_course_enrolment(uuid) to authenticated;
commit;
