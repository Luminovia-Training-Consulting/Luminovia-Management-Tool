begin;

alter table private.assignment_change_requests
  add column shared_schedule_group_id uuid references private.assignment_change_requests(id);
create unique index shared_schedule_unique_assignment
  on private.assignment_change_requests(shared_schedule_group_id, claim_id)
  where shared_schedule_group_id is not null;
create index shared_schedule_roots
  on private.assignment_change_requests ((original->>'course_run_id'))
  where shared_schedule_group_id = id;

-- A shared move uses one complete same-count schedule and one confirmed
-- assignment per position. Every linked offer must be fully staffed.
create function private.course_schedule_requires_group(p_run uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select count(*) > 1 or coalesce(max(job.capacity), 0) > 1
  from public.jobs job where job.course_run_id = p_run;
$$;

create function private.shared_linked_schedule_editable(p_run uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select (select edition from private.installation_identity) = 'internal'
    and exists (
      select 1 from public.course_runs run where run.id = p_run and run.archived_at is null
        and (select sum(job.capacity) from public.jobs job where job.course_run_id = run.id) between 2 and 20
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
              or exists (select 1 from private.course_attendance a where a.session_id = session.id)
              or exists (select 1 from private.course_attendance_audit a where a.session_id = session.id)
              or exists (select 1 from private.course_attendance_evidence a where a.session_id = session.id)
              or exists (
                select 1 from public.job_sessions offer join public.jobs job on job.id = offer.job_id
                where offer.course_session_id = session.id and job.course_run_id is distinct from run.id
              ))
        )
        and not exists (
          select 1 from public.jobs job where job.course_run_id = run.id
            and (job.status <> 'filled'
              or (select count(*) from public.job_claims claim
                  where claim.job_id = job.id and claim.status = 'confirmed') <> job.capacity
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

-- This test rejects terms, price, cancellation or location changes mixed
-- with a shared schedule request. Each sibling keeps its own commercial record.
create function private.validate_shared_schedule_only(p_claim uuid, p_proposed jsonb)
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
  if jsonb_array_length(target_schedule) is distinct from jsonb_array_length(original_schedule) then
    raise exception 'Linked course schedule must keep its session count' using errcode = '22023';
  end if;
  if (target_schedule->0->>'starts_at')::timestamptz <= clock_timestamp() then
    raise exception 'The proposed shared schedule has already started' using errcode = 'PT409';
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

create function private.shared_schedule_progress(p_group uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select case when p_group is null then null else jsonb_build_object(
    'required', count(*),
    'accepted', count(*) filter (where status in ('accepted','applied')),
    'state', case
      when bool_and(status = 'applied') then 'applied'
      when bool_or(status in ('rejected','withdrawn')) then 'blocked'
      when bool_and(status = 'accepted') then 'ready'
      else 'awaiting_consent'
    end
  ) end
  from private.assignment_change_requests where shared_schedule_group_id = p_group;
$$;

-- Submission creates independent immutable proposals for the current
-- affected lecturers. It records no approvals on anyone's behalf.
create function private.submit_shared_schedule(p_root private.assignment_change_requests)
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
  perform private.validate_shared_schedule_only(p_root.claim_id, p_root.proposed);
  update private.assignment_change_requests set shared_schedule_group_id = p_root.id where id = p_root.id;
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
  if (private.shared_schedule_progress(p_root.id)->>'required')::integer < 2 then
    raise exception 'The affected assignments changed during submission' using errcode = 'PT409';
  end if;
end;
$$;

-- Each destination follows its chronological source. Move the unobstructed
-- pair first to keep the immediate per-offer exclusion constraint active.
create function private.move_shared_course_sessions(p_run uuid, p_targets jsonb)
returns void language plpgsql set search_path = '' as $$
declare
  targets jsonb;
  target jsonb;
  session_id uuid;
  starts timestamptz;
  ends timestamptz;
begin
  select jsonb_agg(jsonb_build_object('id', current_slot.id,
    'starts_at', proposed.value->>'starts_at', 'ends_at', proposed.value->>'ends_at')
    order by current_slot.position)
  into targets
  from (
    select session.id, row_number() over (order by session.starts_at, session.id) position
    from public.course_sessions session where session.course_run_id = p_run
  ) current_slot
  join jsonb_array_elements(p_targets) with ordinality proposed(value, position)
    using (position);

  while jsonb_array_length(targets) > 0 loop
    select item.value into target from jsonb_array_elements(targets) with ordinality item(value,position)
    where not exists (
      select 1 from public.course_sessions blocked where blocked.course_run_id = p_run
        and blocked.id <> (item.value->>'id')::uuid
        and tstzrange(blocked.starts_at, blocked.ends_at, '[)') &&
          tstzrange((item.value->>'starts_at')::timestamptz, (item.value->>'ends_at')::timestamptz, '[)')
    ) order by item.position limit 1;
    if not found then
      raise exception 'Shared schedule cannot be moved safely' using errcode = '23P01';
    end if;
    session_id := (target->>'id')::uuid;
    starts := (target->>'starts_at')::timestamptz;
    ends := (target->>'ends_at')::timestamptz;
    update public.course_sessions session set starts_at = starts, ends_at = ends
      where session.id = session_id and (session.starts_at, session.ends_at) is distinct from (starts, ends);
    update public.job_sessions offer set starts_at = starts, ends_at = ends
      where offer.course_session_id = session_id and (offer.starts_at, offer.ends_at) is distinct from (starts, ends);
    select coalesce(jsonb_agg(item.value order by item.position), '[]'::jsonb) into targets
      from jsonb_array_elements(targets) with ordinality item(value,position)
      where item.value->>'id' <> session_id::text;
  end loop;
end;
$$;

create function private.apply_shared_schedule(
  p_request private.assignment_change_requests, p_expected_version integer, p_note text,
  p_request_id uuid, p_receipt jsonb
) returns uuid language plpgsql set search_path = '' as $$
declare
  run_id uuid := (p_request.original->>'course_run_id')::uuid;
  group_id uuid := p_request.shared_schedule_group_id;
  sessions jsonb := p_request.proposed->'sessions';
  current_request private.assignment_change_requests;
  colleague uuid;
  affected_claims uuid[];
  agreed_claims uuid[];
  amendment uuid;
begin
  -- Existing calendar claim/release order uses the lecturer key before the
  -- job/course rows. Lock all affected profiles and lecturers by UUID.
  perform 1 from public.profiles profile
    where profile.id in (
      select member.lecturer_id from private.assignment_change_requests member
      where member.shared_schedule_group_id = group_id
    )
    order by profile.id for share;
  for colleague in
    select distinct member.lecturer_id from private.assignment_change_requests member
    where member.shared_schedule_group_id = group_id order by member.lecturer_id
  loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(colleague::text, 0));
  end loop;
  perform 1 from public.lecturer_topics topic
    where topic.user_id in (
      select member.lecturer_id from private.assignment_change_requests member
      where member.shared_schedule_group_id = group_id
    )
    order by topic.user_id, topic.topic_id for share;
  perform 1 from public.jobs job where job.course_run_id = run_id order by job.id for update;
  perform 1 from public.course_runs run where run.id = run_id for update;
  perform 1 from public.course_sessions session where session.course_run_id = run_id order by session.id for update;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('course-readiness:' || run_id::text, 0));
  if exists (select 1 from public.course_enrolments where course_run_id = run_id and status = 'enrolled') then
    perform private.lock_course_premium(run_id);
  end if;

  perform 1 from private.assignment_change_requests member
    where member.shared_schedule_group_id = group_id order by member.id for update;
  select * into strict current_request from private.assignment_change_requests where id = p_request.id;
  if current_request.version is distinct from p_expected_version then
    raise exception 'Change request changed; reload' using errcode = '40001';
  end if;

  select array_agg(claim.id order by claim.id) into affected_claims
    from public.job_claims claim join public.jobs job on job.id = claim.job_id
    where claim.status = 'confirmed' and job.course_run_id = run_id;
  select array_agg(member.claim_id order by member.claim_id) into agreed_claims
    from private.assignment_change_requests member where member.shared_schedule_group_id = group_id;
  if not private.shared_linked_schedule_editable(run_id) or affected_claims is distinct from agreed_claims then
    raise exception 'The shared schedule or its linked assignments changed' using errcode = 'PT409';
  end if;
  if exists (
    select 1 from private.assignment_change_requests member where member.shared_schedule_group_id = group_id
      and (member.status <> 'accepted' or member.manager_approved_by is null
        or member.manager_approved_by = member.lecturer_id or member.lecturer_approved_at is null
        or member.proposed->'sessions' is distinct from sessions)
  ) then
    raise exception 'Each assignment requires consent to the same shared schedule' using errcode = 'PT409';
  end if;

  for current_request in
    select * from private.assignment_change_requests member
    where member.shared_schedule_group_id = group_id order by member.id
  loop
    if current_request.source_hash <> md5(private.assignment_change_source(current_request.claim_id)::text) then
      raise exception 'An original assignment changed; recreate the shared request' using errcode = '40001';
    end if;
    perform private.assignment_change_validate(current_request.claim_id, current_request.proposed);
  end loop;

  perform private.move_shared_course_sessions(run_id, sessions);
  update public.jobs set lifecycle_version = lifecycle_version + 1 where course_run_id = run_id;
  for current_request in
    select * from private.assignment_change_requests member
    where member.shared_schedule_group_id = group_id order by member.id
  loop
    insert into private.assignment_amendments(claim_id, change_id, version, original, accepted, manager_id, lecturer_id)
      values (current_request.claim_id, current_request.id, (current_request.original->>'amendment_version')::integer + 1,
        current_request.original, current_request.proposed, current_request.manager_approved_by, current_request.lecturer_id)
      returning id into amendment;
    insert into private.assignment_session_supersessions(session_id, amendment_id)
      select session.id, amendment from public.assignment_sessions session
      where session.claim_id = current_request.claim_id and session.released_at is null;
    update public.assignment_sessions set released_at = clock_timestamp()
      where claim_id = current_request.claim_id and released_at is null;
    insert into public.assignment_sessions(claim_id, lecturer_id, starts_at, ends_at)
      select current_request.claim_id, current_request.lecturer_id,
        (item->>'starts_at')::timestamptz, (item->>'ends_at')::timestamptz
      from jsonb_array_elements(sessions) item;
    update private.assignment_change_requests set status = 'applied', applied_at = clock_timestamp(),
      version = version + 1, updated_at = clock_timestamp() where id = current_request.id;
    insert into private.assignment_change_events(change_id, actor_id, action, note, previous_version)
      values (current_request.id, auth.uid(), 'apply', p_note, current_request.version);
    insert into public.audit_events(actor_id, action, resource_id)
      values (auth.uid(), 'assignment.change.apply', current_request.id);
    insert into public.notifications(user_id, kind, resource_id)
      select recipient, 'assignment_change', current_request.id
      from (select current_request.lecturer_id recipient union select current_request.requester_id) people
      on conflict (user_id, kind, resource_id) do update set read_at = null, created_at = clock_timestamp();
  end loop;

  insert into public.notifications(user_id, kind, resource_id)
    select enrolment.user_id, 'course_schedule_changed', run_id
    from public.course_enrolments enrolment join public.course_runs run on run.id = enrolment.course_run_id
    where run.id = run_id and enrolment.status = 'enrolled'
      and private.active_company_participant(enrolment.user_id, run.organisation_id)
    on conflict (user_id, kind, resource_id) do update set read_at = null, created_at = clock_timestamp();
  insert into private.assignment_change_operations values (auth.uid(), p_request_id, p_receipt, p_request.id);
  return p_request.id;
end;
$$;

revoke all on function private.course_schedule_requires_group(uuid), private.shared_linked_schedule_editable(uuid),
  private.validate_shared_schedule_only(uuid,jsonb), private.shared_schedule_progress(uuid),
  private.submit_shared_schedule(private.assignment_change_requests), private.move_shared_course_sessions(uuid,jsonb),
  private.apply_shared_schedule(private.assignment_change_requests,integer,text,uuid,jsonb)
from public, anon, authenticated, service_role;

-- Compose the current individual workflow at its validation and transition
-- seams. Non-shared requests retain their existing write and authorization path.
do $migration$
declare
  definition text;
  edited text;
begin
  definition := pg_catalog.pg_get_functiondef('private.create_course_run_job(uuid,jsonb,numeric,uuid)'::regprocedure);
  edited := replace(definition, 'deadline timestamptz;sessions jsonb;topics jsonb;',
    'deadline timestamptz;sessions jsonb;topics jsonb;positions integer:=1;');
  if edited = definition then raise exception 'Course offer position seam missing'; end if;
  definition := edited;
  edited := replace(definition, '''claim_deadline'',''source_revision''', '''claim_deadline'',''source_revision'',''capacity''');
  if edited = definition then raise exception 'Course offer payload seam missing'; end if;
  definition := edited;
  edited := replace(definition, $old$ desired=coalesce(p_payload->>'status','draft');$old$,
    $new$ if p_payload?'capacity' then
  if jsonb_typeof(p_payload->'capacity') <> 'number' then
   raise exception 'Course offer needs 1 to 20 positions' using errcode='22023';
  end if;
  if (p_payload->>'capacity')::numeric not between 1 and 20
     or (p_payload->>'capacity')::numeric <> trunc((p_payload->>'capacity')::numeric) then
   raise exception 'Course offer needs 1 to 20 positions' using errcode='22023';
  end if;
  positions := (p_payload->>'capacity')::numeric::integer;
 end if;
 desired=coalesce(p_payload->>'status','draft');$new$);
  if edited = definition then raise exception 'Course offer position validation seam missing'; end if;
  definition := edited;
  edited := replace(definition, $old$claim_deadline,created_by)
 values(job$old$, $new$claim_deadline,created_by,capacity,capacity_basis)
 values(job$new$);
  if edited = definition then raise exception 'Course offer position insert seam missing'; end if;
  definition := edited;
  edited := replace(definition, 'deadline,auth.uid());',
    'deadline,auth.uid(),positions,case when positions>1 then ''per_position'' else ''single_position'' end);');
  if edited = definition then raise exception 'Course offer position value seam missing'; end if;
  execute edited;

  definition := pg_catalog.pg_get_functiondef('private.assignment_change_validate(uuid,jsonb)'::regprocedure);
  edited := replace(definition,
    $old$ or (j.course_run_id is not null and exists(select 1 from public.jobs where course_run_id=j.course_run_id and id<>j.id)) then$old$,
    ' then');
  if edited = definition then raise exception 'Shared eligibility seam missing'; end if;
  definition := edited;
  edited := replace(definition,
    $old$or j.capacity<>1 or (select count(*) from public.job_claims where job_id=j.id and status='confirmed')<>1$old$,
    $new$or (not private.course_schedule_requires_group(j.course_run_id) and
    (j.capacity<>1 or (select count(*) from public.job_claims where job_id=j.id and status='confirmed')<>1))$new$);
  if edited = definition then raise exception 'Shared position validation seam missing'; end if;
  definition := edited;
  edited := replace(definition,
    $old$ if (p_proposed->>'cancel')::boolean then return;end if;$old$,
    $new$ if private.course_schedule_requires_group(j.course_run_id) then
  perform private.validate_shared_schedule_only(c.id,p_proposed);
 end if;
 if (p_proposed->>'cancel')::boolean then return;end if;$new$);
  if edited = definition then raise exception 'Shared proposal validation seam missing'; end if;
  definition := edited;
  edited := replace(definition,
    'if not private.linked_assignment_schedule_editable(j.id,c.id) then',
    'if not (private.linked_assignment_schedule_editable(j.id,c.id) or private.shared_linked_schedule_editable(j.course_run_id)) then');
  if edited = definition then raise exception 'Linked eligibility seam missing'; end if;
  execute edited;

  definition := pg_catalog.pg_get_functiondef('private.save_assignment_change(uuid,uuid,jsonb,integer,uuid)'::regprocedure);
  edited := replace(definition,
    $old$ perform private.assignment_change_validate(p_claim_id,proposal);$old$,
    $new$ if private.course_schedule_requires_group((source->>'course_run_id')::uuid)
     and not private.has_permission('jobs.manage') then
  raise exception 'Management must propose a shared schedule' using errcode = '42501';
 end if;
 perform private.assignment_change_validate(p_claim_id,proposal);$new$);
  if edited = definition then raise exception 'Shared draft seam missing'; end if;
  execute edited;

  definition := pg_catalog.pg_get_functiondef('private.assignment_change_action(uuid,text,integer,text,uuid)'::regprocedure);
  edited := replace(definition,
    $old$ -- Every transition already holds profile/customer authority locks.$old$,
    $new$ if r.shared_schedule_group_id is not null or (p_action = 'submit' and
  private.course_schedule_requires_group((r.original->>'course_run_id')::uuid)) then
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('shared-schedule:' || (r.original->>'course_run_id'), 0));
  select * into strict r from private.assignment_change_requests where id = p_id;
  if r.shared_schedule_group_id is not null then
   if p_action = 'apply' then
    return private.apply_shared_schedule(r,p_expected_version,p_note,p_request_id,payload);
   end if;
   if p_action in ('accept','reject') and private.shared_schedule_progress(r.shared_schedule_group_id)->>'state' = 'blocked' then
    raise exception 'The shared schedule no longer awaits consent' using errcode = 'PT409';
   end if;
   if p_action = 'accept' and auth.uid() = r.lecturer_id and not private.lecturer_actor() then
    raise exception 'Current assigned lecturer required' using errcode = '42501';
   end if;
  end if;
 end if;
 -- Every transition already holds profile/customer authority locks.$new$);
  if edited = definition then raise exception 'Shared transition seam missing'; end if;
  definition := edited;
  edited := replace(definition,
    $old$  perform private.assignment_change_validate(r.claim_id,r.proposed);
  update private.assignment_change_requests set status='submitted' where id=r.id;$old$,
    $new$  perform private.assignment_change_validate(r.claim_id,r.proposed);
  if private.shared_linked_schedule_editable((r.original->>'course_run_id')::uuid) then
   perform private.submit_shared_schedule(r);
  end if;
  update private.assignment_change_requests set status='submitted' where id=r.id;$new$);
  if edited = definition then raise exception 'Shared submission seam missing'; end if;
  execute edited;

  definition := pg_catalog.pg_get_functiondef('private.changeable_assignments()'::regprocedure);
  edited := replace(definition,
    $old$   else private.linked_assignment_schedule_editable(j.id,c.id) end,$old$,
    $new$   else private.linked_assignment_schedule_editable(j.id,c.id) or private.shared_linked_schedule_editable(j.course_run_id) end,
 'shared_schedule_only',private.shared_linked_schedule_editable(j.course_run_id),$new$);
  if edited = definition then raise exception 'Shared picker capability seam missing'; end if;
  definition := edited;
  edited := replace(definition,
    'and not exists(select 1 from public.jobs other where other.course_run_id=j.course_run_id and other.id<>j.id)',
    'and (not private.course_schedule_requires_group(j.course_run_id)
      or (private.has_permission(''jobs.manage'') and private.shared_linked_schedule_editable(j.course_run_id)))');
  if edited = definition then raise exception 'Shared picker inclusion seam missing'; end if;
  definition := edited;
  edited := replace(definition, 'and j.capacity=1 and not exists',
    'and (j.capacity=1 or private.course_schedule_requires_group(j.course_run_id)) and not exists');
  if edited = definition then raise exception 'Shared picker position seam missing'; end if;
  execute edited;

  definition := pg_catalog.pg_get_functiondef('private.assignment_change_projection(uuid)'::regprocedure);
  edited := replace(definition,
    $old$   else private.linked_assignment_schedule_editable((r.original->>'job_id')::uuid,r.claim_id) end,$old$,
    $new$   else private.linked_assignment_schedule_editable((r.original->>'job_id')::uuid,r.claim_id)
     or private.shared_linked_schedule_editable((r.original->>'course_run_id')::uuid) end,
  'shared_schedule_only',r.shared_schedule_group_id is not null or private.shared_linked_schedule_editable((r.original->>'course_run_id')::uuid),
  'shared_schedule',private.shared_schedule_progress(r.shared_schedule_group_id),$new$);
  if edited = definition then raise exception 'Shared progress seam missing'; end if;
  definition := edited;
  edited := replace(definition,
    $old$'can_apply',not customer and r.status='accepted'and$old$,
    $new$'can_apply',not customer and r.status='accepted'and
   (r.shared_schedule_group_id is null or private.shared_schedule_progress(r.shared_schedule_group_id)->>'state'='ready')and$new$);
  if edited = definition then raise exception 'Shared apply authorization projection seam missing'; end if;
  definition := edited;
  edited := replace(definition,
    $old$   (auth.uid()=r.lecturer_id or(private.has_permission('jobs.manage')and(not money or private.assignment_change_money_authority(r.claim_id)))),$old$,
    $new$   (r.shared_schedule_group_id is null or private.shared_schedule_progress(r.shared_schedule_group_id)->>'state' <> 'blocked')and
   (auth.uid()=r.lecturer_id or(private.has_permission('jobs.manage')and(not money or private.assignment_change_money_authority(r.claim_id)))),$new$);
  if edited = definition then raise exception 'Shared response projection seam missing'; end if;
  execute edited;

  -- This notice is visible only while the recipient has the current course
  -- workspace entitlement. It never points a learner at a staff amendment.
  definition := pg_catalog.pg_get_functiondef('private.notification_target(text,uuid)'::regprocedure);
  edited := replace(definition,
    $old$ if p_kind='assignment_change' then$old$,
    $new$ if p_kind='course_schedule_changed' then
  select template.title into heading
  from public.course_runs run join public.course_templates template on template.id = run.template_id
  where run.id = p_resource and run.archived_at is null and private.learning_actor()
    and private.company_premium_enabled(run.organisation_id)
    and private.active_company_participant(auth.uid(),run.organisation_id)
    and exists (
      select 1 from public.course_enrolments enrolment
      where enrolment.course_run_id = run.id and enrolment.user_id = auth.uid()
        and enrolment.status in ('enrolled','completed')
    );
  return jsonb_build_object('href',case when heading is not null then '/courses/'||p_resource||'/workspace' end,
    'title',coalesce(heading,''));
 end if;
 if p_kind='assignment_change' then$new$);
  if edited = definition then raise exception 'Shared schedule notification seam missing'; end if;
  execute edited;
end;
$migration$;

notify pgrst, 'reload schema';
commit;
