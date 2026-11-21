begin;

-- Existing evidence belongs to its original interval and allocation. Only
-- the remaining schedule may move, even if a session starts during approval.
create function private.shared_schedule_touches_pinned_sessions(p_run uuid, p_targets jsonb, p_checked_at timestamptz)
returns boolean language sql stable security invoker set search_path = '' as $$
  with target as (
    select starts_at, ends_at
    from jsonb_to_recordset(p_targets) as slot(starts_at timestamptz, ends_at timestamptz)
  )
  select exists (
    select 1 from public.course_sessions session
    where session.course_run_id = p_run and session.starts_at <= p_checked_at
      and not exists (
        select 1 from target
        where (target.starts_at, target.ends_at) = (session.starts_at, session.ends_at)
      )
  ) or exists (
    select 1 from target
    where target.starts_at <= p_checked_at
      and not exists (
        select 1 from public.course_sessions session where session.course_run_id = p_run
          and (session.starts_at, session.ends_at) = (target.starts_at, target.ends_at)
      )
  ) or exists (
    select 1 from public.assignment_sessions allocation
    join public.job_claims claim on claim.id = allocation.claim_id
    join public.jobs job on job.id = claim.job_id
    where job.course_run_id = p_run and claim.status = 'confirmed'
      and allocation.released_at is null
      and (
        exists (select 1 from private.delivery_records report where report.session_id = allocation.id)
        or exists (select 1 from private.teaching_timesheets timesheet where timesheet.session_id = allocation.id)
      )
      and not exists (
        select 1 from target
        where (target.starts_at, target.ends_at) = (allocation.starts_at, allocation.ends_at)
      )
  );
$$;

revoke all on function private.shared_schedule_touches_pinned_sessions(uuid,jsonb,timestamptz)
from public, anon, authenticated, service_role;

-- Keep the original agreement, permission, invoice, enrolment and evidence
-- guards. Release just the specific global restrictions that used to prevent
-- edits of the future portion of a started shared schedule.
do $migration$
declare
  patch record;
  definition text;
begin
  for patch in select * from (values
    ('private.assignment_change_normalize(jsonb,jsonb)'::regprocedure,
      $old$or starts<=clock_timestamp() or ends<=starts$old$,
      $new$or (starts <= statement_timestamp() and not exists (
    select 1 from jsonb_to_recordset(p_original->'sessions') as original(starts_at timestamptz, ends_at timestamptz)
    where (original.starts_at, original.ends_at) = (starts, ends)
  )) or ends<=starts$new$),
    ('private.changeable_assignments()'::regprocedure,
      $old$and not exists(select 1 from public.assignment_sessions where claim_id=c.id and released_at is null and starts_at<=now())$old$,
      $new$and (private.course_schedule_requires_group(j.course_run_id)
      or not exists(select 1 from public.assignment_sessions where claim_id=c.id and released_at is null and starts_at<=now()))$new$),
    ('private.assignment_change_validate(uuid,jsonb)'::regprocedure,
      $old$or exists(select 1 from public.assignment_sessions where claim_id=c.id and released_at is null and starts_at<=clock_timestamp())$old$,
      $new$or (not private.course_schedule_requires_group(j.course_run_id) and
    exists(select 1 from public.assignment_sessions where claim_id=c.id and released_at is null and starts_at<=clock_timestamp()))$new$),
    ('private.assignment_change_validate(uuid,jsonb)'::regprocedure,
      $old$if submitted then raise exception 'Submitted delivery requires separate commercial review'$old$,
      $new$if submitted and not private.course_schedule_requires_group(j.course_run_id)
    then raise exception 'Submitted delivery requires separate commercial review'$new$),
    ('private.shared_linked_schedule_editable(uuid)'::regprocedure,
      $old$and exists (select 1 from public.course_sessions session where session.course_run_id = run.id)$old$,
      $new$and exists (
          select 1 from public.course_sessions session where session.course_run_id = run.id
            and session.starts_at > statement_timestamp()
        )$new$),
    ('private.shared_linked_schedule_editable(uuid)'::regprocedure,
      $old$and (session.starts_at <= statement_timestamp()
              or exists (
                select 1 from public.job_sessions offer join public.jobs job on job.id = offer.job_id
                where offer.course_session_id = session.id and job.course_run_id is distinct from run.id
              ))$old$,
      $new$and exists (
              select 1 from public.job_sessions offer join public.jobs job on job.id = offer.job_id
              where offer.course_session_id = session.id and job.course_run_id is distinct from run.id
            )$new$),
    ('private.shared_linked_schedule_editable(uuid)'::regprocedure,
      $old$or staffed.count > job.capacity$old$,
      $new$or staffed.count > job.capacity
              or (staffed.count < job.capacity and exists (
                select 1 from public.course_sessions session where session.course_run_id = run.id
                  and session.starts_at <= statement_timestamp()
              ))$new$),
    ('private.shared_linked_schedule_editable(uuid)'::regprocedure,
      $old$              or exists (
                select 1 from public.job_claims claim join public.assignment_sessions allocation on allocation.claim_id = claim.id
                where claim.job_id = job.id
                  and (exists (select 1 from private.delivery_records report where report.session_id = allocation.id)
                    or exists (select 1 from private.teaching_timesheets timesheet where timesheet.session_id = allocation.id))
              )$old$,
      '' ),
    ('private.validate_shared_schedule_only(uuid,jsonb)'::regprocedure,
      $old$if jsonb_array_length(target_schedule) <> jsonb_array_length(original_schedule) and exists ($old$,
      $new$if (jsonb_array_length(target_schedule) <> jsonb_array_length(original_schedule)
    or (original_schedule->0->>'starts_at')::timestamptz <= statement_timestamp()) and exists ($new$),
    ('private.validate_shared_schedule_only(uuid,jsonb)'::regprocedure,
      $old$Changing the session count changes the agreed billable quantity$old$,
      $new$Changing this schedule would change the agreed billable quantity$new$),
    ('private.validate_shared_schedule_only(uuid,jsonb)'::regprocedure,
      $old$if (target_schedule->0->>'starts_at')::timestamptz <= clock_timestamp() then
    raise exception 'The proposed shared schedule has already started' using errcode = 'PT409';
  end if;$old$,
      $new$if private.shared_schedule_touches_pinned_sessions(run_id, target_schedule, clock_timestamp()) then
    raise exception 'A session already started or carries retained delivery evidence' using errcode = 'PT409';
  end if;
  if not exists (
    select 1 from jsonb_to_recordset(target_schedule) as slot(starts_at timestamptz, ends_at timestamptz)
    where slot.starts_at > clock_timestamp()
  ) then
    raise exception 'A future shared session is required' using errcode = 'PT409';
  end if;$new$),
    ('private.apply_shared_schedule(private.assignment_change_requests,integer,text,uuid,jsonb)'::regprocedure,
      $old$  for current_request in
    select * from private.assignment_change_requests member
    where member.shared_schedule_group_id = group_id order by member.id
  loop
    if current_request.source_hash$old$,
      $new$  -- Evidence writers lock the claim before the allocation. Follow that
  -- order and take the same locks before rechecking retained evidence.
  perform 1 from public.job_claims claim where claim.id = any(affected_claims)
    order by claim.id for update;
  perform 1 from public.assignment_sessions session
    where session.claim_id = any(affected_claims) and session.released_at is null
    order by session.id for update;

  for current_request in
    select * from private.assignment_change_requests member
    where member.shared_schedule_group_id = group_id order by member.id
  loop
    if current_request.source_hash$new$),
    ('private.apply_shared_schedule(private.assignment_change_requests,integer,text,uuid,jsonb)'::regprocedure,
      $old$and (not count_changed or not exists (
          select 1 from jsonb_to_recordset(sessions) as target(starts_at timestamptz, ends_at timestamptz)
          where (target.starts_at, target.ends_at) = (session.starts_at, session.ends_at)
        ))$old$,
      $new$and not exists (
          select 1 from jsonb_to_recordset(sessions) as target(starts_at timestamptz, ends_at timestamptz)
          where (target.starts_at, target.ends_at) = (session.starts_at, session.ends_at)
        )$new$)
  ) patches(signature, previous, replacement)
  loop
    definition := pg_catalog.pg_get_functiondef(patch.signature);
    if cardinality(string_to_array(definition, patch.previous)) <> 2 then
      raise exception 'Unexpected shared course evidence boundary in %', patch.signature;
    end if;
    execute replace(definition, patch.previous, patch.replacement);
  end loop;
end;
$migration$;

notify pgrst, 'reload schema';
commit;
