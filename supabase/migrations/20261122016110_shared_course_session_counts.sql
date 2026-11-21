begin;

alter table private.assignment_change_requests add column shared_schedule_offer_hash text;

-- Removing an unused future session retires its original IDs and exact
-- versions. Live queries continue to see only the current course schedule.
create table private.shared_course_retired_sessions (
  course_session_id uuid primary key,
  group_id uuid not null references private.assignment_change_requests(id),
  course_session jsonb not null,
  offer_sessions jsonb not null,
  retired_at timestamptz not null default clock_timestamp()
);
create index shared_course_retirements_group on private.shared_course_retired_sessions(group_id);
alter table private.shared_course_retired_sessions enable row level security;
revoke all on private.shared_course_retired_sessions from public, anon, authenticated, service_role;
create trigger immutable_shared_course_session_retirement before update or delete
  on private.shared_course_retired_sessions for each row execute function private.immutable_assignment_amendment();

-- Count distinct calendar days touched in the course time zone, including a
-- class that crosses midnight. Hourly and unit-based terms keep exact seconds.
create function private.shared_schedule_quantity(p_sessions jsonb, p_zone text, p_unit text)
returns numeric language sql stable security invoker set search_path = '' as $$
  with slots as (
    select (slot->>'starts_at')::timestamptz starts_at, (slot->>'ends_at')::timestamptz ends_at
    from jsonb_array_elements(p_sessions) slot
  )
  select case p_unit
    when 'per_day' then (
      select sum(upper(day) - lower(day))
      from unnest((select range_agg(daterange(
        (starts_at at time zone p_zone)::date,
        ((ends_at - interval '1 microsecond') at time zone p_zone)::date + 1
      )) from slots)) day
    )
    when 'per_hour' then (select sum(extract(epoch from (ends_at - starts_at))) from slots)
    when 'per_teaching_unit' then (select sum(extract(epoch from (ends_at - starts_at))) from slots)
    else 0
  end;
$$;

create function private.shared_schedule_offer_hash(p_run uuid)
returns text language sql stable security invoker set search_path = '' as $$
  select md5(jsonb_agg(jsonb_build_array(
    job.id, job.capacity, job.status, job.lifecycle_version, job.terms_version
  ) order by job.id)::text)
  from public.jobs job where job.course_run_id = p_run;
$$;

create or replace function private.shared_schedule_progress(p_group uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select case when p_group is null then null else jsonb_build_object(
    'required', count(*),
    'accepted', count(*) filter (where member.status in ('accepted','applied')),
    'state', case
      when bool_and(member.status = 'applied') then 'applied'
      when bool_or(member.status in ('rejected','withdrawn')) or exists (
        select 1 from private.assignment_change_requests root
        where root.id = p_group and root.shared_schedule_offer_hash is not null
          and root.shared_schedule_offer_hash is distinct from
            private.shared_schedule_offer_hash((root.original->>'course_run_id')::uuid)
      ) then 'blocked'
      when bool_and(member.status = 'accepted') then 'ready'
      else 'awaiting_consent'
    end
  ) end
  from private.assignment_change_requests member where member.shared_schedule_group_id = p_group;
$$;

-- Attendance stays bound to the same course session and exact interval. A
-- same-count move keeps the historical chronological mapping of identities.
create function private.shared_schedule_touches_attendance(p_run uuid, p_targets jsonb)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists (
    select 1
    from (
      select session.id, session.starts_at, session.ends_at,
        row_number() over (order by session.starts_at, session.id) position,
        count(*) over () slot_count
      from public.course_sessions session where session.course_run_id = p_run
    ) original
    where (
      exists (select 1 from private.course_attendance a where a.session_id = original.id)
      or exists (select 1 from private.course_attendance_audit a where a.session_id = original.id)
      or exists (select 1 from private.course_attendance_evidence a where a.session_id = original.id)
    ) and not exists (
      select 1 from jsonb_array_elements(p_targets) with ordinality target(slot, position)
      where ((target.slot->>'starts_at')::timestamptz, (target.slot->>'ends_at')::timestamptz) =
        (original.starts_at, original.ends_at)
        and (original.slot_count <> jsonb_array_length(p_targets) or target.position = original.position)
    )
  );
$$;

create or replace function private.shared_linked_schedule_editable(p_run uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select (select edition from private.installation_identity) = 'internal'
    and exists (
      select 1 from public.course_runs run where run.id = p_run and run.archived_at is null
        and (select sum(job.capacity) from public.jobs job where job.course_run_id = run.id) between 2 and 20
        and exists (
          select 1 from public.job_claims claim join public.jobs job on job.id = claim.job_id
          where job.course_run_id = run.id and claim.status = 'confirmed'
        )
        and not exists (
          select 1 from public.course_enrolments enrolment where enrolment.course_run_id = run.id
            and (enrolment.status = 'completed' or
              (enrolment.status = 'enrolled' and not private.company_premium_enabled(run.organisation_id)))
        )
        and not exists (select 1 from private.course_completion_records completion where completion.run_id = run.id)
        and not exists (select 1 from private.course_quiz_attempts attempt where attempt.run_id = run.id)
        and not exists (select 1 from private.course_exam_documents document where document.run_id = run.id)
        and not exists (
          select 1 from private.course_exam_settings settings where settings.run_id = run.id and settings.required
        )
        and not exists (
          select 1 from private.course_readiness_settings readiness
          where readiness.course_run_id = run.id and readiness.confirmed_at is not null
        )
        and exists (select 1 from public.course_sessions session where session.course_run_id = run.id)
        and not exists (
          select 1 from public.course_sessions session where session.course_run_id = run.id
            and (session.starts_at <= statement_timestamp()
              or exists (
                select 1 from public.job_sessions offer join public.jobs job on job.id = offer.job_id
                where offer.course_session_id = session.id and job.course_run_id is distinct from run.id
              ))
        )
        and not exists (
          select 1 from public.jobs job
          cross join lateral (
            select count(*) count from public.job_claims claim
            where claim.job_id = job.id and claim.status = 'confirmed'
          ) staffed
          where job.course_run_id = run.id
            and (job.status <> case when staffed.count = job.capacity then 'filled' else 'published' end
              or staffed.count > job.capacity
              -- Original staff issuance and its retry receipt remain immutable.
              -- A genuine customer-origin request needs its own consent workflow.
              or exists (select 1 from private.client_course_requests request where request.job_id = job.id
                and (request.creation_options->>'kind' is distinct from 'course_run_job'
                  or request.creation_options->>'course_run_id' is distinct from run.id::text))
              or exists (
                select 1 from public.course_sessions session where session.course_run_id = run.id
                  and (select count(*) from public.job_sessions offer
                       where offer.job_id = job.id and offer.course_session_id = session.id
                         and (offer.starts_at, offer.ends_at) = (session.starts_at, session.ends_at)) <> 1
              )
              or (select count(*) from public.job_sessions offer where offer.job_id = job.id) <>
                 (select count(*) from public.course_sessions session where session.course_run_id = run.id)
              or exists (
                select 1 from public.job_claims claim join public.assignment_sessions allocation on allocation.claim_id = claim.id
                where claim.job_id = job.id
                  and (exists (select 1 from private.delivery_records report where report.session_id = allocation.id)
                    or exists (select 1 from private.teaching_timesheets timesheet where timesheet.session_id = allocation.id))
              )
            )
        )
    );
$$;

create or replace function private.validate_shared_schedule_only(p_claim uuid, p_proposed jsonb)
returns void language plpgsql set search_path = '' as $$
declare
  current_source jsonb := private.assignment_change_source(p_claim);
  original_schedule jsonb := current_source->'sessions';
  target_schedule jsonb := p_proposed->'sessions';
  run_id uuid := (current_source->>'course_run_id')::uuid;
begin
  if not private.shared_linked_schedule_editable(run_id) then
    raise exception 'Linked schedule has dependent records or another owner' using errcode = '22023';
  end if;
  if target_schedule is not distinct from original_schedule
    or p_proposed-'sessions' is distinct from private.assignment_change_normalize(current_source, '{}'::jsonb)-'sessions' then
    raise exception 'Shared amendments can only change the schedule' using errcode = '22023';
  end if;
  if jsonb_array_length(target_schedule) <> jsonb_array_length(original_schedule) and exists (
    select 1
    from (
      select current_source->>'rate_unit' as unit, current_source->>'time_zone' as zone
      union select job.rate_unit, job.time_zone from public.jobs job where job.course_run_id = run_id
    ) rate
    where private.shared_schedule_quantity(original_schedule, rate.zone, rate.unit)
      is distinct from private.shared_schedule_quantity(target_schedule, rate.zone, rate.unit)
  ) then
    raise exception 'Changing the session count changes the agreed billable quantity' using errcode = 'PT422';
  end if;
  if exists (
    select 1 from public.jobs job where job.course_run_id = run_id and job.status = 'published'
      and job.claim_deadline > (target_schedule->0->>'starts_at')::timestamptz
  ) then
    raise exception 'The proposed schedule starts before an open claim deadline' using errcode = 'PT423';
  end if;
  if (target_schedule->0->>'starts_at')::timestamptz <= clock_timestamp() then
    raise exception 'The proposed shared schedule has already started' using errcode = 'PT409';
  end if;
  if private.shared_schedule_touches_attendance(run_id, target_schedule) then
    raise exception 'A changed session has retained attendance evidence' using errcode = 'PT409';
  end if;
  -- Existing learner withdrawal eligibility is measured from the initial
  -- session. A revised course must not shorten that deadline.
  if exists (
    select 1 from public.course_enrolments enrolment where enrolment.course_run_id = run_id and enrolment.status = 'enrolled'
  ) and (target_schedule->0->>'starts_at')::timestamptz < (original_schedule->0->>'starts_at')::timestamptz then
    raise exception 'Shared schedule cannot shorten the learner withdrawal deadline' using errcode = 'PT409';
  end if;
end;
$$;

create or replace function private.submit_shared_schedule(p_root private.assignment_change_requests)
returns void language plpgsql set search_path = '' as $$
declare
  run_id uuid := (p_root.original->>'course_run_id')::uuid;
  sibling record;
  source jsonb;
  proposed jsonb;
  sibling_id uuid;
begin
  if not private.has_permission('jobs.manage') then
    raise exception 'Management must submit a shared schedule' using errcode = '42501';
  end if;
  if exists (
    select 1 from private.assignment_change_requests root
    where root.shared_schedule_group_id = root.id and root.original->>'course_run_id' = run_id::text
      and private.shared_schedule_progress(root.id)->>'state' in ('awaiting_consent','ready')
  ) then
    raise exception 'A shared schedule is already open for this course' using errcode = 'PT409';
  end if;
  -- Stabilise the submitted cohort against concurrent claims and offer changes.
  perform 1 from public.jobs job where job.course_run_id = run_id order by job.id for update;
  perform 1 from public.course_runs run where run.id = run_id for update;
  perform private.validate_shared_schedule_only(p_root.claim_id, p_root.proposed);
  update private.assignment_change_requests
  set shared_schedule_group_id = p_root.id,
      shared_schedule_offer_hash = private.shared_schedule_offer_hash(run_id)
  where id = p_root.id;
  for sibling in
    select claim.id, claim.lecturer_id
    from public.job_claims claim join public.jobs job on job.id = claim.job_id
    where job.course_run_id = run_id and claim.status = 'confirmed' and claim.id <> p_root.claim_id
    order by claim.id
  loop
    source := private.assignment_change_source(sibling.id);
    proposed := private.assignment_change_normalize(source, jsonb_build_object('sessions', p_root.proposed->'sessions'));
    perform private.assignment_change_validate(sibling.id, proposed);
    insert into private.assignment_change_requests
      (claim_id, requester_id, lecturer_id, reason, status, original, proposed, source_hash, shared_schedule_group_id)
    values
      (sibling.id, auth.uid(), sibling.lecturer_id, p_root.reason, 'submitted', source, proposed, md5(source::text), p_root.id)
    returning id into sibling_id;
    insert into private.assignment_change_events(change_id, actor_id, action, previous_version, snapshot)
      values (sibling_id, auth.uid(), 'submit', 0, jsonb_build_object('reason', p_root.reason, 'proposed', proposed));
    insert into public.notifications(user_id, kind, resource_id)
      values (sibling.lecturer_id, 'assignment_change', sibling_id)
      on conflict (user_id, kind, resource_id) do nothing;
  end loop;
end;
$$;

-- In a count-changing proposal only exact interval matches retain public
-- identities. Retired slots leave immutable historical receipts, while new
-- slots receive fresh identities and one linked row on every affected offer.
create function private.replace_shared_course_session_count(p_run uuid, p_group uuid, p_targets jsonb)
returns void language plpgsql set search_path = '' as $$
declare
  removed_ids uuid[];
begin
  select array_agg(session.id) into removed_ids
  from public.course_sessions session
  where session.course_run_id = p_run and not exists (
    select 1 from jsonb_to_recordset(p_targets) as target(starts_at timestamptz, ends_at timestamptz)
    where (target.starts_at, target.ends_at) = (session.starts_at, session.ends_at)
  );

  insert into private.shared_course_retired_sessions(course_session_id, group_id, course_session, offer_sessions)
  select session.id, p_group, to_jsonb(session), (
    select jsonb_agg(to_jsonb(offer) order by offer.id)
    from public.job_sessions offer where offer.course_session_id = session.id
  )
  from public.course_sessions session where session.id = any(removed_ids);

  delete from public.job_sessions where course_session_id = any(removed_ids);
  delete from public.course_sessions where id = any(removed_ids);

  with added as (
    insert into public.course_sessions(course_run_id, starts_at, ends_at)
    select p_run, target.starts_at, target.ends_at
    from jsonb_to_recordset(p_targets) as target(starts_at timestamptz, ends_at timestamptz)
    where not exists (
      select 1 from public.course_sessions session where session.course_run_id = p_run
        and (session.starts_at, session.ends_at) = (target.starts_at, target.ends_at)
    )
    returning id, starts_at, ends_at
  )
  insert into public.job_sessions(job_id, course_session_id, starts_at, ends_at)
  select job.id, added.id, added.starts_at, added.ends_at
  from public.jobs job cross join added where job.course_run_id = p_run;
end;
$$;
revoke all on function private.shared_schedule_quantity(jsonb,text,text), private.shared_schedule_offer_hash(uuid),
  private.shared_schedule_touches_attendance(uuid,jsonb),
  private.replace_shared_course_session_count(uuid,uuid,jsonb)
from public, anon, authenticated, service_role;

do $migration$
declare
  definition text;
  edited text;
begin
  definition := pg_catalog.pg_get_functiondef('private.assignment_change_validate(uuid,jsonb)'::regprocedure);
  edited := replace(definition,
    $old$if jsonb_array_length(p_proposed->'sessions')<>(select count(*) from public.job_sessions s where s.job_id=j.id) then$old$,
    $new$if not private.course_schedule_requires_group(j.course_run_id)
     and jsonb_array_length(p_proposed->'sessions')<>(select count(*) from public.job_sessions s where s.job_id=j.id) then$new$);
  if edited = definition then raise exception 'Shared amendment session count validation seam missing'; end if;
  execute edited;

  definition := pg_catalog.pg_get_functiondef(
    'private.apply_shared_schedule(private.assignment_change_requests,integer,text,uuid,jsonb)'::regprocedure
  );
  edited := replace(definition,
    $old$  if not private.shared_linked_schedule_editable(run_id) or affected_claims is distinct from agreed_claims then$old$,
    $new$  if exists (
    select 1 from private.assignment_change_requests root where root.id = group_id and
      case when root.shared_schedule_offer_hash is not null
        then root.shared_schedule_offer_hash is distinct from private.shared_schedule_offer_hash(run_id)
        else exists (select 1 from public.jobs job where job.course_run_id = run_id and job.status <> 'filled')
      end
  ) then
    raise exception 'The shared schedule or its linked offers changed' using errcode = 'PT409';
  end if;
  if not private.shared_linked_schedule_editable(run_id) or affected_claims is distinct from agreed_claims then$new$);
  if edited = definition then raise exception 'Shared amendment offer fingerprint seam missing'; end if;
  definition := edited;
  edited := replace(definition, $old$  amendment uuid;$old$,
    $new$  amendment uuid;
  count_changed boolean := jsonb_array_length(sessions) <> jsonb_array_length(p_request.original->'sessions');$new$);
  if edited = definition then raise exception 'Shared amendment session count flag seam missing'; end if;
  definition := edited;
  edited := replace(definition,
    $old$    insert into private.assignment_session_supersessions(session_id, amendment_id)
      select session.id, amendment from public.assignment_sessions session
      where session.claim_id = current_request.claim_id and session.released_at is null;
    update public.assignment_sessions set released_at = clock_timestamp()
      where claim_id = current_request.claim_id and released_at is null;
    insert into public.assignment_sessions(claim_id, lecturer_id, starts_at, ends_at)
      select current_request.claim_id, current_request.lecturer_id,
        (item->>'starts_at')::timestamptz, (item->>'ends_at')::timestamptz
      from jsonb_array_elements(sessions) item;$old$,
    $new$    with released as (
      update public.assignment_sessions session set released_at = clock_timestamp()
      where session.claim_id = current_request.claim_id and session.released_at is null
        and (not count_changed or not exists (
          select 1 from jsonb_to_recordset(sessions) as target(starts_at timestamptz, ends_at timestamptz)
          where (target.starts_at, target.ends_at) = (session.starts_at, session.ends_at)
        ))
      returning session.id
    )
    insert into private.assignment_session_supersessions(session_id, amendment_id)
      select released.id, amendment from released;
    insert into public.assignment_sessions(claim_id, lecturer_id, starts_at, ends_at)
      select current_request.claim_id, current_request.lecturer_id, target.starts_at, target.ends_at
      from jsonb_to_recordset(sessions) as target(starts_at timestamptz, ends_at timestamptz)
      where not exists (
        select 1 from public.assignment_sessions session
        where session.claim_id = current_request.claim_id and session.released_at is null
          and (session.starts_at, session.ends_at) = (target.starts_at, target.ends_at)
      );$new$);
  if edited = definition then raise exception 'Shared amendment allocation retention seam missing'; end if;
  definition := edited;
  edited := replace(definition,
    $old$  perform private.move_shared_course_sessions(run_id, sessions);
  update public.jobs set lifecycle_version = lifecycle_version + 1 where course_run_id = run_id;$old$,
    $new$  if count_changed then
    perform private.replace_shared_course_session_count(run_id, group_id, sessions);
  else
    perform private.move_shared_course_sessions(run_id, sessions);
  end if;
  -- A prospective claimant must see the new dates, even after reopening.
  update public.jobs set lifecycle_version = lifecycle_version + 1,
    terms_version = terms_version + 1
    where course_run_id = run_id;$new$);
  if edited = definition then raise exception 'Shared amendment application seam missing'; end if;
  execute edited;
end;
$migration$;

notify pgrst, 'reload schema';
commit;
