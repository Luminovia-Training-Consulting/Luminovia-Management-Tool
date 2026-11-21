begin;

-- A linked move is possible only with one complete one-to-one schedule and
-- before any dependent activity relies on those dated records. The acceptance
-- path already holds the lecturer, job, course and preparation locks.
create function private.linked_assignment_schedule_editable(p_job uuid,p_claim uuid)
returns boolean language sql stable security invoker set search_path='' as $$
 select exists(
  select 1 from public.jobs j
  join public.course_runs r on r.id=j.course_run_id and r.archived_at is null
  where j.id=p_job and j.capacity=1
   and not exists(select 1 from public.jobs other where other.course_run_id=r.id and other.id<>j.id)
   and not exists(select 1 from private.client_course_requests cr where cr.job_id=j.id)
   and not exists(select 1 from private.course_run_job_requests request where request.job_id=j.id)
   and not exists(select 1 from public.course_enrolments enrolment where enrolment.course_run_id=r.id)
   and not exists(select 1 from private.course_completion_records completion where completion.run_id=r.id)
   and not exists(select 1 from private.course_readiness_settings readiness where readiness.course_run_id=r.id and readiness.confirmed_at is not null)
   and not exists(select 1 from public.course_sessions s where s.course_run_id=r.id and
    (s.starts_at<=statement_timestamp() or
     exists(select 1 from private.course_attendance a where a.session_id=s.id) or
     exists(select 1 from private.course_attendance_audit a where a.session_id=s.id) or
     exists(select 1 from private.course_attendance_evidence a where a.session_id=s.id) or
     (select count(*) from public.job_sessions offer where offer.course_session_id=s.id)<>1))
   and exists(select 1 from public.course_sessions s where s.course_run_id=r.id)
   and (select count(*) from public.course_sessions s where s.course_run_id=r.id)=
       (select count(*) from public.job_sessions offer where offer.job_id=j.id)
   and not exists(
    select 1 from public.job_sessions offer
    where offer.job_id=j.id and not exists(
     select 1 from public.course_sessions s where s.id=offer.course_session_id and s.course_run_id=r.id
      and s.starts_at=offer.starts_at and s.ends_at=offer.ends_at))
   and not exists(
    select 1 from public.assignment_sessions s where s.claim_id=p_claim and
     (exists(select 1 from private.delivery_records d where d.session_id=s.id) or
      exists(select 1 from private.teaching_timesheets t where t.session_id=s.id)))
 );
$$;

-- Preserve both linked primary keys. Pair old and proposed intervals by
-- chronological order, then move an interval once its target is clear.
-- This keeps the existing immediate exclusion constraint intact even if,
-- for example, each new slot starts where the next old slot used to be.
create function private.move_linked_assignment_schedule(p_job uuid,p_claim uuid,p_sessions jsonb)
returns void language plpgsql security invoker set search_path='' as $$
declare
 targets jsonb;
 target jsonb;
begin
 if not private.linked_assignment_schedule_editable(p_job,p_claim) then
  raise exception 'Linked schedule has dependent records or another owner' using errcode='22023';
 end if;
 select jsonb_agg(jsonb_build_object('offer_id',offer.id,'course_id',offer.course_session_id,
  'starts_at',desired.value->>'starts_at','ends_at',desired.value->>'ends_at') order by offer.position)
 into targets
 from (
  select s.*,row_number() over(order by s.starts_at,s.id) position
  from public.job_sessions s where s.job_id=p_job
 ) offer
 join jsonb_array_elements(p_sessions) with ordinality desired(value,position)
  on desired.position=offer.position;
 if jsonb_array_length(targets) is distinct from jsonb_array_length(p_sessions)
  or jsonb_array_length(targets)<>(select count(*) from public.job_sessions s where s.job_id=p_job) then
  raise exception 'Linked course schedule must keep its session count' using errcode='22023';
 end if;
 while jsonb_array_length(targets)>0 loop
  select item.value into target from jsonb_array_elements(targets) with ordinality item(value,position)
  where not exists(
   select 1 from public.job_sessions blocked where blocked.job_id=p_job
    and blocked.id<>(item.value->>'offer_id')::uuid
    and tstzrange(blocked.starts_at,blocked.ends_at,'[)') &&
        tstzrange((item.value->>'starts_at')::timestamptz,(item.value->>'ends_at')::timestamptz,'[)'))
  order by item.position limit 1;
  if not found then
   raise exception 'Current linked schedule cannot be moved safely' using errcode='23P01';
  end if;
  update public.course_sessions as course
   set starts_at=(target->>'starts_at')::timestamptz,ends_at=(target->>'ends_at')::timestamptz
   where course.id=(target->>'course_id')::uuid
    and (course.starts_at,course.ends_at) is distinct from
        ((target->>'starts_at')::timestamptz,(target->>'ends_at')::timestamptz);
  update public.job_sessions as offer
   set starts_at=(target->>'starts_at')::timestamptz,ends_at=(target->>'ends_at')::timestamptz
   where offer.id=(target->>'offer_id')::uuid
    and (offer.starts_at,offer.ends_at) is distinct from
        ((target->>'starts_at')::timestamptz,(target->>'ends_at')::timestamptz);
  select coalesce(jsonb_agg(item.value order by item.position),'[]'::jsonb) into targets
   from jsonb_array_elements(targets) with ordinality item(value,position)
   where item.value->>'offer_id'<>target->>'offer_id';
 end loop;
end;
$$;
revoke all on function private.linked_assignment_schedule_editable(uuid,uuid),
 private.move_linked_assignment_schedule(uuid,uuid,jsonb)
 from public,anon,authenticated,service_role;

-- Compose the shipped amendment functions at precisely their validation and
-- write seams. Keep persisted requests, permissions and prior migration bytes.
do $migration$
declare definition text; edited text;
begin
 definition=pg_get_functiondef('private.assignment_change_validate(uuid,jsonb)'::regprocedure);
 edited=replace(definition,
 $old$ if (j.course_run_id is not null or exists(
     select 1 from public.job_sessions s where s.job_id=j.id and s.course_session_id is not null
    )) and p_proposed->'sessions' is distinct from private.assignment_change_source(c.id)->'sessions' then
  raise exception 'Linked course sessions retain their learning and attendance evidence' using errcode='22023';
 end if;$old$,
 $new$ if (j.course_run_id is not null or exists(
     select 1 from public.job_sessions s where s.job_id=j.id and s.course_session_id is not null
    )) and p_proposed->'sessions' is distinct from private.assignment_change_source(c.id)->'sessions' then
  if not private.linked_assignment_schedule_editable(j.id,c.id) then
   raise exception 'Linked schedule has dependent records or another owner' using errcode='22023';
  end if;
  if jsonb_array_length(p_proposed->'sessions')<>(select count(*) from public.job_sessions s where s.job_id=j.id) then
   raise exception 'Linked course schedule must keep its session count' using errcode='22023';
  end if;
 end if;$new$);
 if edited=definition then raise exception 'Assignment validation composition seam missing'; end if;
 definition=edited;
 edited=replace(definition,'and q.topic_id=r.topic_id and q.verified and (q.valid_until is null or q.valid_until>=ends)',
  'and q.topic_id=r.topic_id');
 if definition=edited then raise exception 'Assignment expertise composition seam missing'; end if;
 execute edited;

 definition=pg_get_functiondef('private.assignment_change_action(uuid,text,integer,text,uuid)'::regprocedure);
 edited=replace(definition,
 $old$    delete from public.job_sessions where job_id=j.id;
    for item in select value from jsonb_array_elements(proposal->'sessions') loop
     insert into public.job_sessions(job_id,starts_at,ends_at) values(j.id,(item->>'starts_at')::timestamptz,(item->>'ends_at')::timestamptz);
     insert into public.assignment_sessions(claim_id,lecturer_id,starts_at,ends_at) values(c.id,c.lecturer_id,(item->>'starts_at')::timestamptz,(item->>'ends_at')::timestamptz);
    end loop;$old$,
 $new$    if j.course_run_id is not null then
     perform private.move_linked_assignment_schedule(j.id,c.id,proposal->'sessions');
    else
     delete from public.job_sessions where job_id=j.id;
     insert into public.job_sessions(job_id,starts_at,ends_at)
      select j.id,(value->>'starts_at')::timestamptz,(value->>'ends_at')::timestamptz
      from jsonb_array_elements(proposal->'sessions');
    end if;
    insert into public.assignment_sessions(claim_id,lecturer_id,starts_at,ends_at)
     select c.id,c.lecturer_id,(value->>'starts_at')::timestamptz,(value->>'ends_at')::timestamptz
     from jsonb_array_elements(proposal->'sessions');$new$);
 if edited=definition then raise exception 'Assignment schedule write composition seam missing'; end if;
 execute edited;

 definition=pg_get_functiondef('private.changeable_assignments()'::regprocedure);
 edited=replace(definition,$old$'current',private.assignment_change_visible_snapshot$old$,
  $new$'schedule_editable',case when j.course_run_id is null then true
   else private.linked_assignment_schedule_editable(j.id,c.id) end,
 'current',private.assignment_change_visible_snapshot$new$);
 if edited=definition then raise exception 'Assignment discovery composition seam missing'; end if;
 execute edited;

 definition=pg_get_functiondef('private.assignment_change_projection(uuid)'::regprocedure);
 edited=replace(definition,$old$'reason',r.reason,'status',r.status$old$,
  $new$'schedule_editable',case when r.original->>'course_run_id' is null then true
   else private.linked_assignment_schedule_editable((r.original->>'job_id')::uuid,r.claim_id) end,
  'reason',r.reason,'status',r.status$new$);
 if edited=definition then raise exception 'Assignment projection composition seam missing'; end if;
 execute edited;

 -- Accept the same terms bound as the existing job schema, and permit an
 -- operation that leaves a valid historical zero-net role quote unchanged.
 definition=pg_get_functiondef('private.assignment_change_normalize(jsonb,jsonb)'::regprocedure);
 edited=replace(definition,'length(trim(result->>''terms'')) not between 1 and 8000',
  'length(trim(result->>''terms'')) not between 1 and 12000');
 if edited=definition then raise exception 'Assignment terms composition seam missing'; end if;
 definition=edited;
 edited=replace(definition,
 $old$or amount not between 0.01 and 9999999999.99 or total not between 0.01 and 9999999999.99$old$,
 $new$or amount not between 0 and 9999999999.99 or total not between 0 and 9999999999.99
 or ((amount=0 or total=0) and (amount,total,result->>'rate_unit') is distinct from
   ((p_original->>'amount')::numeric,(p_original->>'total_amount')::numeric,p_original->>'rate_unit'))$new$);
 if edited=definition then raise exception 'Assignment compensation composition seam missing'; end if;
 execute edited;
end;
$migration$;

notify pgrst, 'reload schema';
commit;
