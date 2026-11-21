begin;

-- Shared scheduler rows retain legacy non-null fields. Commercial claim
-- triggers are internal-edition operations, including on retained job records.
do $migration$
declare
  routine regprocedure;
  definition text;
  anchor constant text := E'\nbegin\n';
  guarded constant text := $guard$
begin
  if (select edition from private.installation_identity) is distinct from 'internal' then
    return new;
  end if;
$guard$;
begin
  foreach routine in array array[
    'private.apply_role_claim_rate()'::regprocedure,
    'private.capture_claim_revenue()'::regprocedure,
    'private.enforce_company_rejection_on_claim()'::regprocedure,
    'private.supersede_assignment_withdrawals()'::regprocedure,
    'private.close_cancelled_substitutions()'::regprocedure
  ] loop
    definition := pg_catalog.pg_get_functiondef(routine);
    if cardinality(string_to_array(definition, anchor)) <> 2 then
      raise exception 'Expected one edition boundary in %', routine;
    end if;
    execute replace(definition, anchor, guarded);
  end loop;
end;
$migration$;

create table private.academy_instructor_release_requests (
  actor_id uuid not null references public.profiles(id),
  request_id uuid not null,
  claim_id uuid not null references private.academy_course_instructors(claim_id),
  reason text not null check (char_length(reason) between 5 and 1000),
  created_at timestamptz not null default clock_timestamp(),
  primary key(actor_id, request_id)
);
alter table private.academy_instructor_release_requests enable row level security;
revoke all on private.academy_instructor_release_requests
  from public, anon, authenticated, service_role;

-- Preserve retry identity for confirmed Academy releases made before this migration.
insert into private.academy_instructor_release_requests(actor_id, request_id, claim_id, reason, created_at)
select receipt.actor_id, receipt.request_id, allocation.claim_id, receipt.payload->>'reason', receipt.created_at
from private.job_lifecycle_requests receipt
join private.academy_course_instructors allocation on allocation.claim_id = receipt.result
where allocation.released_at is not null
  and receipt.payload->>'action' = 'cancel'
  and receipt.payload->>'claim_id' = allocation.claim_id::text
  and jsonb_typeof(receipt.payload->'reason') = 'string'
  and char_length(receipt.payload->>'reason') between 5 and 1000;

create or replace function private.academy_assign_course_instructor_before_access(
  p_course_id uuid, p_instructor_id uuid, p_request_id uuid
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  course public.course_runs;
  receipt private.academy_course_instructors;
  position_id uuid;
  claim_id uuid;
  channel_id uuid;
begin
  if p_course_id is null or p_instructor_id is null or p_request_id is null then
    raise invalid_parameter_value;
  end if;
  perform private.academy_assignment_course(p_course_id);
  perform 1 from public.profiles where id = actor_id and active for share;
  if not found then raise insufficient_privilege; end if;
  perform 1 from public.profiles where id = p_instructor_id and active for share;
  if not found or not private.lecturer_user(p_instructor_id) then
    return jsonb_build_object('status', 'not_eligible');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_instructor_id::text, 0));
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('academy-assignment:' || actor_id::text || ':' || p_request_id::text, 0)
  );
  perform 1 from public.course_runs run where run.id = p_course_id for no key update;
  course := private.academy_assignment_course(p_course_id);

  select * into receipt from private.academy_course_instructors allocation
  where allocation.assigned_by = actor_id and allocation.request_id = p_request_id;
  if found then
    if (receipt.course_id, receipt.instructor_id) is distinct from (p_course_id, p_instructor_id) then
      return jsonb_build_object('status', 'idempotency_conflict');
    end if;
    return (
      select jsonb_build_object('status', claim.status, 'claim_id', claim.id)
      from public.job_claims claim where claim.id = receipt.claim_id
    );
  end if;

  if exists (
    select 1 from private.academy_course_instructors allocation
    where allocation.course_id = p_course_id and allocation.instructor_id = p_instructor_id
      and allocation.released_at is null
  ) then
    return jsonb_build_object('status', 'already_assigned');
  end if;

  if not exists (select 1 from public.course_sessions session where session.course_run_id = p_course_id)
    or exists (
      select 1 from public.course_sessions session
      where session.course_run_id = p_course_id and session.starts_at <= clock_timestamp()
    ) then
    return jsonb_build_object('status', 'schedule_required');
  end if;

  if exists (
    select 1 from public.job_claims claim
    where claim.lecturer_id = p_instructor_id and claim.idempotency_key = p_request_id
  ) then
    return jsonb_build_object('status', 'idempotency_conflict');
  end if;

  -- Match the scheduler's half-open ranges while holding the lecturer lock.
  -- Assignment sessions also retain the database's overlap constraint.
  if exists (
    select 1 from public.course_sessions session where session.course_run_id = p_course_id and (
      exists (
        select 1 from public.assignment_sessions allocation
        where allocation.lecturer_id = p_instructor_id and allocation.released_at is null
          and tstzrange(allocation.starts_at, allocation.ends_at, '[)') &&
            tstzrange(session.starts_at, session.ends_at, '[)')
      ) or exists (
        select 1 from public.personal_events event
        where event.user_id = p_instructor_id and tstzrange(event.starts_at, event.ends_at, '[)') &&
          tstzrange(session.starts_at, session.ends_at, '[)')
      ) or exists (
        select 1 from public.lecturer_availability availability
        where availability.user_id = p_instructor_id and availability.kind = 'unavailable'
          and tstzrange(availability.starts_at, availability.ends_at, '[)') &&
            tstzrange(session.starts_at, session.ends_at, '[)')
      )
    )
  ) then
    return jsonb_build_object('status', 'conflict');
  end if;

  begin
    -- A filled scheduling position is never eligible for offer publication.
    insert into public.jobs(
      course_run_id, title, customer_name, delivery_type, location, time_zone, status, capacity,
      amount, currency, rate_unit, total_amount, terms, requires_contract, created_by
    )
    select course.id, template.title, organisation.name, course.delivery_type, course.venue, course.time_zone,
      'filled', 1, 0, 'EUR', 'fixed_total', 0, 'Academy course allocation', false, actor_id
    from public.course_templates template
    join public.organisations organisation on organisation.id = course.organisation_id
    where template.id = course.template_id
    returning id into strict position_id;

    insert into public.job_sessions(job_id, starts_at, ends_at)
    select position_id, session.starts_at, session.ends_at
    from public.course_sessions session where session.course_run_id = p_course_id
    order by session.starts_at, session.id;

    insert into public.job_claims(
      job_id, lecturer_id, idempotency_key, amount, total_amount, currency, rate_unit, terms, terms_version
    )
    values (position_id, p_instructor_id, p_request_id, 0, 0, 'EUR', 'fixed_total', 'Academy course allocation', 1)
    returning id into claim_id;

    insert into public.assignment_sessions(claim_id, lecturer_id, starts_at, ends_at)
    select claim_id, p_instructor_id, session.starts_at, session.ends_at
    from public.job_sessions session where session.job_id = position_id
    order by session.starts_at, session.id;
  exception when exclusion_violation then
    return jsonb_build_object('status', 'conflict');
  end;

  insert into private.academy_course_instructors(course_id, instructor_id, claim_id, assigned_by, request_id)
  values (p_course_id, p_instructor_id, claim_id, actor_id, p_request_id);

  select room.id into channel_id from public.chat_rooms room
  where room.course_run_id = p_course_id and room.kind = 'participant_course' for update;
  if found then
    perform private.participant_chat_assignment_grant(channel_id, p_instructor_id);
    insert into public.chat_members(room_id, user_id) values (channel_id, p_instructor_id)
    on conflict (room_id, user_id) do update
    set removed_at = null, joined_at = clock_timestamp()
    where public.chat_members.removed_at is not null;
  end if;

  insert into public.audit_events(actor_id, action, resource_id, details)
  values (actor_id, 'academy.instructor.assigned', claim_id,
    jsonb_build_object('course_id', p_course_id, 'instructor_id', p_instructor_id));
  return jsonb_build_object('status', 'confirmed', 'claim_id', claim_id);
end;
$$;

create or replace function private.academy_release_course_instructor_before_access(
  p_course_id uuid, p_claim_id uuid, p_reason text, p_request_id uuid
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  release_actor uuid := auth.uid();
  instructor_id uuid;
  position_id uuid;
  claim public.job_claims;
  previous private.academy_instructor_release_requests;
  release_at timestamptz;
  first_start timestamptz;
  channel_id uuid;
  normalized_reason text := btrim(coalesce(p_reason, ''));
begin
  if p_claim_id is null or p_request_id is null then raise invalid_parameter_value; end if;
  perform private.academy_assignment_course(p_course_id);
  select allocation.instructor_id into instructor_id
  from private.academy_course_instructors allocation
  where allocation.course_id = p_course_id and allocation.claim_id = p_claim_id;
  if not found then raise insufficient_privilege; end if;

  perform 1 from public.profiles where id = release_actor and active for share;
  if not found then raise insufficient_privilege; end if;
  perform 1 from public.profiles where id = instructor_id for share;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('academy-release:' || release_actor::text || ':' || p_request_id::text, 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(instructor_id::text, 0));
  perform 1 from public.course_runs run where run.id = p_course_id for no key update;
  perform private.academy_assignment_course(p_course_id);
  if char_length(normalized_reason) not between 5 and 1000 then
    raise exception 'A release reason is required' using errcode = '22023';
  end if;

  select * into previous from private.academy_instructor_release_requests request
  where request.actor_id = release_actor and request.request_id = p_request_id;
  if found then
    if previous.claim_id <> p_claim_id or previous.reason <> normalized_reason then
      raise exception 'Instructor release request conflicts with an earlier request' using errcode = '22023';
    end if;
    return jsonb_build_object('status', 'cancelled', 'claim_id', p_claim_id);
  end if;

  select position_claim.job_id into position_id from public.job_claims position_claim
  where position_claim.id = p_claim_id and position_claim.lecturer_id = instructor_id;
  perform 1 from public.jobs position
  where position.id = position_id and position.course_run_id = p_course_id for update;
  if not found then raise insufficient_privilege; end if;
  select * into claim from public.job_claims position_claim
  where position_claim.id = p_claim_id and position_claim.job_id = position_id
    and position_claim.lecturer_id = instructor_id for update;
  if not found then raise insufficient_privilege; end if;
  if claim.status <> 'confirmed' then
    raise exception 'Instructor assignment is already released' using errcode = '22023';
  end if;
  release_at := clock_timestamp();
  select min(session.starts_at) into first_start
  from public.assignment_sessions session where session.claim_id = p_claim_id;
  if first_start is null or first_start <= release_at then
    raise exception 'Started instructor assignments require separate review' using errcode = '22023';
  end if;

  update public.job_claims set status = 'cancelled' where id = p_claim_id;
  update public.assignment_sessions set released_at = release_at
  where claim_id = p_claim_id and released_at is null;
  update public.jobs set status = 'archived' where id = claim.job_id;
  update private.academy_course_instructors set released_at = release_at
  where claim_id = p_claim_id and released_at is null;

  -- Retire legacy staff-room membership if an older allocation created it.
  select room.id into channel_id from public.chat_rooms room
  where room.job_id = claim.job_id and room.kind = 'lecturer_course' for update;
  if found then
    update public.chat_members set removed_at = release_at
    where room_id = channel_id and user_id = instructor_id and removed_at is null;
    update public.chat_rooms set owner_id = null where id = channel_id and owner_id = instructor_id;
  end if;
  select room.id into channel_id from public.chat_rooms room
  where room.course_run_id = p_course_id and room.kind = 'participant_course' for update;
  if found then
    perform private.participant_chat_assignment_release(channel_id, instructor_id, p_course_id);
  end if;

  insert into private.academy_instructor_release_requests(actor_id, request_id, claim_id, reason)
  values (release_actor, p_request_id, p_claim_id, normalized_reason);
  insert into public.audit_events(actor_id, action, resource_id, details)
  values (release_actor, 'academy.instructor.released', p_claim_id,
    jsonb_build_object('course_id', p_course_id, 'instructor_id', instructor_id));
  return jsonb_build_object('status', 'cancelled', 'claim_id', p_claim_id);
end;
$$;

revoke all on function private.academy_assign_course_instructor_before_access(uuid, uuid, uuid),
  private.academy_release_course_instructor_before_access(uuid, uuid, text, uuid)
from public, anon, authenticated, service_role;

commit;
