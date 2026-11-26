begin;

-- A programme draft writes a new curriculum revision. Its active roster makes
-- the curriculum and completion requirements read-only. Legacy programmes
-- without a curriculum revision retain the existing all-courses requirement.
create table private.learning_program_curriculum_revisions (
  program_id uuid not null references private.learning_programs(id) on delete cascade,
  revision integer not null check (revision > 0),
  curriculum jsonb check (curriculum is null or jsonb_typeof(curriculum) = 'object'),
  created_at timestamptz not null default clock_timestamp(),
  primary key (program_id, revision)
);
alter table private.learning_program_curriculum_revisions enable row level security;
revoke all on private.learning_program_curriculum_revisions from public, anon, authenticated, service_role;

-- Current programme readers own the scope check. Only their internal routines
-- can resolve the latest curriculum; a null revision restores legacy behaviour.
create function private.learning_program_curriculum(p_program_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select revision.curriculum || jsonb_build_object('revision', revision.revision)
  from private.learning_program_curriculum_revisions revision
  where revision.program_id = p_program_id
  order by revision.revision desc limit 1;
$$;

create function private.configure_learning_program_curriculum(
  p_program_id uuid, p_curriculum jsonb, p_expected_version integer
) returns integer language plpgsql security definer set search_path = '' as $$
declare
  program private.learning_programs;
  current_curriculum jsonb;
  courses text[];
  configured_steps integer;
  elective_count integer;
  elective_available integer;
begin
  if p_program_id is null or p_expected_version is null or p_expected_version < 1
    then raise invalid_parameter_value; end if;
  if (select edition <> 'internal' from private.installation_identity) then
    perform private.lock_academy_course_access();
  end if;
  -- Serialize this change with the existing editor and first enrolment.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('learning-program:' || p_program_id, 0));
  select * into program from private.learning_programs where id = p_program_id for update;
  if not found or not private.learning_program_manager(program.organisation_id) then raise insufficient_privilege; end if;
  perform private.lock_learning_program_scope(program.organisation_id, auth.uid(), null);
  if not private.learning_program_manager(program.organisation_id) then raise insufficient_privilege; end if;

  if p_curriculum is not null then
    if jsonb_typeof(p_curriculum) <> 'object'
      or not (p_curriculum ?& array['overview','steps','elective_count'])
      or p_curriculum - array['overview','steps','elective_count'] <> '{}'::jsonb
      or jsonb_typeof(p_curriculum->'overview') <> 'string'
      or char_length(p_curriculum->>'overview') > 4000
      or jsonb_typeof(p_curriculum->'elective_count') <> 'number'
      or p_curriculum->>'elective_count' !~ '^([0-9]|[12][0-9])$'
      or jsonb_typeof(p_curriculum->'steps') <> 'object'
      then raise invalid_parameter_value; end if;
    select array_agg(course_id::text order by position) into courses
    from private.learning_program_courses where program_id = program.id;
    if coalesce(cardinality(courses), 0) < 2 or array_position(courses, null) is not null
      then raise invalid_parameter_value; end if;

    select count(*), count(*) filter (where value->>'required' = 'false')
    into configured_steps, elective_available from jsonb_each(p_curriculum->'steps');
    elective_count := (p_curriculum->>'elective_count')::integer;
    if configured_steps <> cardinality(courses) or elective_count > elective_available
      or (p_curriculum->'steps'->(courses[1])->'required') is distinct from 'true'::jsonb
      or exists (
        select 1 from jsonb_each(p_curriculum->'steps') step
        where not step.key = any(courses)
          or jsonb_typeof(step.value) <> 'object'
          or not (step.value ?& array['objectives','remediation','required'])
          or step.value - array['objectives','remediation','required'] <> '{}'::jsonb
          or jsonb_typeof(step.value->'objectives') <> 'string'
          or char_length(step.value->>'objectives') > 1200
          or jsonb_typeof(step.value->'remediation') <> 'string'
          or char_length(step.value->>'remediation') > 1200
          or jsonb_typeof(step.value->'required') <> 'boolean'
      ) then raise invalid_parameter_value; end if;
  end if;

  current_curriculum := private.learning_program_curriculum(program.id);
  if (current_curriculum - 'revision') is not distinct from p_curriculum then return program.version; end if;
  if program.version <> p_expected_version or program.archived_at is not null or exists (
    select 1 from private.learning_program_members where program_id = program.id
  ) then raise exception 'The programme revision changed or is locked' using errcode = 'PT409'; end if;

  insert into private.learning_program_curriculum_revisions(program_id, revision, curriculum)
    values (program.id, program.version + 1, p_curriculum);
  update private.learning_programs set version = program.version + 1 where id = program.id;
  insert into public.audit_events(actor_id, action, resource_id, details)
    values (auth.uid(), 'learning.program.curriculum_changed', program.id,
      jsonb_build_object('version', program.version + 1, 'configured', p_curriculum is not null));
  return program.version + 1;
end;
$$;

-- Preserve the course's archival identity even when its live run is removed.
-- A removed elective can never turn into a new mandatory course.
alter table private.learning_program_courses add column curriculum_course_id uuid;
update private.learning_program_courses set curriculum_course_id = course_id where course_id is not null;
create function private.bind_learning_program_course_identity() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  new.curriculum_course_id := new.course_id;
  return new;
end;
$$;
create trigger bind_learning_program_course_identity before insert on private.learning_program_courses
for each row execute function private.bind_learning_program_course_identity();

-- Current programme access admits only enrolled learners in their own active
-- company and authorised staff. Receipts are the only completion evidence.
create or replace function private.learning_program_progress(p_program uuid, p_user uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  with curriculum as materialized (
    select private.learning_program_curriculum(p_program) as definition
  ), course_facts as materialized (
    select item.position, item.course_id, item.title, enrolment.status,
      receipt.id as receipt_id, receipt.created_at as completed_at,
      (run.id is not null and run.published and run.archived_at is null) as available,
      (run.id is not null and receipt.id is not null
        and enrolment.status in ('enrolled', 'completed')) as completed,
      program.sequential, program.archived_at, program.path_rules->item.position::text as rule,
      decision.active as exception_active, decision.revision as exception_revision,
      definition is not null as configured,
      coalesce((definition->'steps'->item.curriculum_course_id::text->>'required')::boolean, true) as required,
      coalesce((definition->>'elective_count')::integer, 0) as elective_count
    from private.learning_programs program
    join private.learning_program_courses item on item.program_id = program.id
    cross join curriculum
    left join public.course_runs run on run.id = item.course_id
      and run.organisation_id = program.organisation_id
    left join public.course_enrolments enrolment on enrolment.course_run_id = run.id
      and enrolment.user_id = p_user
    left join private.course_completion_records receipt on receipt.run_id = run.id
      and receipt.user_id = p_user and receipt.revoked_at is null
    left join lateral (
      select exception.active, exception.revision
      from private.learning_program_path_exceptions exception
      where exception.program_id = program.id and exception.user_id = p_user
        and exception.position = item.position
      order by exception.revision desc limit 1
    ) decision on true
    where program.id = p_program
  ), steps as (
    select target.*, requirements.items, (requirements.met or target.exception_active is true) as met,
      count(*) filter (where target.completed is true and not target.required) over
        (order by target.completed_at, target.position) as elective_rank
    from course_facts target
    cross join lateral (
      select coalesce(jsonb_agg(jsonb_build_object(
        'position', prior.position, 'title', prior.title, 'completed', prior.completed is true
      ) order by prior.position), '[]'::jsonb) as items,
      case when target.rule->>'mode' = 'any'
        then coalesce(bool_or(prior.completed is true), false)
        else coalesce(bool_and(prior.completed is true), true)
      end as met
      from course_facts prior
      where prior.position < target.position and (
        (target.rule is null and target.sequential and prior.required) or
        target.rule->'positions' @> jsonb_build_array(prior.position)
      )
    ) requirements
  ), evidence as (
    select *, completed is true and (required or elective_rank <= elective_count) as credited
    from steps
  )
  select jsonb_build_object(
    'completed', count(*) filter (where credited),
    'total', count(*) filter (where required) + coalesce(max(elective_count), 0),
    'completed_at', case when (count(*) filter (where credited)) > 0
      and (count(*) filter (where credited)) = (count(*) filter (where required)) + max(elective_count)
      then max(completed_at) filter (where credited) end,
    'steps', coalesce(jsonb_agg(jsonb_build_object(
      'course_id', course_id, 'title', title, 'receipt_id', case when completed then receipt_id end,
      'state', case
        when completed then 'completed'
        when not available or status = 'removed' then 'unavailable'
        when not met then 'locked'
        when status in ('enrolled', 'completed') then 'in_progress'
        when archived_at is null then 'ready'
        else 'unavailable'
      end,
      'prerequisite_exception', case when exception_revision is not null then
        jsonb_build_object('active', exception_active, 'revision', exception_revision) end,
      'can_open', available and coalesce(status in ('enrolled', 'completed'), false)
        and (completed is true or met)
    ) || case when configured then jsonb_build_object('completion_credited', credited) else '{}'::jsonb end
      || case when not met and available and status is distinct from 'removed' and completed is not true
      then jsonb_build_object('prerequisites', jsonb_build_object(
        'mode', coalesce(rule->>'mode', 'all'), 'items', items
      )) else '{}'::jsonb
      end order by position), '[]'::jsonb)
  ) from evidence;
$$;

create function public.configure_learning_program_curriculum(
  p_program_id uuid, p_curriculum jsonb, p_expected_version integer
) returns integer language sql security invoker set search_path = '' as $$
  select private.configure_learning_program_curriculum(p_program_id, p_curriculum, p_expected_version);
$$;
revoke all on function private.learning_program_curriculum(uuid),
  private.bind_learning_program_course_identity(),
  private.configure_learning_program_curriculum(uuid, jsonb, integer),
  public.configure_learning_program_curriculum(uuid, jsonb, integer)
  from public, anon, authenticated, service_role;
grant execute on function private.configure_learning_program_curriculum(uuid, jsonb, integer),
  public.configure_learning_program_curriculum(uuid, jsonb, integer) to authenticated;

do $migration$
declare
  reader text := pg_catalog.pg_get_functiondef('private.learning_programs(uuid,uuid,text)'::regprocedure);
  writer text := pg_catalog.pg_get_functiondef(
    'private.save_learning_program(uuid,uuid,text,text,boolean,uuid[],boolean,integer)'::regprocedure);
  gate text := pg_catalog.pg_get_functiondef('private.require_academy_course_access()'::regprocedure);
  reader_anchor constant text := '''path_rules'', case when manager then selected.path_rules end,';
  writer_anchor constant text := '  same_content := previous.id is not null';
  gate_anchor constant text := '''/rpc/set_learning_program_path_exception''';
begin
  if cardinality(string_to_array(reader, reader_anchor)) <> 2
    or cardinality(string_to_array(writer, writer_anchor)) <> 2
    or cardinality(string_to_array(gate, gate_anchor)) <> 2
    then raise exception 'Expected programme curriculum boundaries'; end if;
  execute replace(reader, reader_anchor, reader_anchor ||
    ' ''curriculum'', private.learning_program_curriculum(selected.id),');
  execute replace(writer, writer_anchor, $guard$
  if previous.id is not null and current_courses is distinct from p_course_ids
    and private.learning_program_curriculum(previous.id) is not null then
    raise exception 'Reset the curriculum before changing programme courses' using errcode = 'PT409';
  end if;
$guard$ || writer_anchor);
  execute replace(gate, gate_anchor, gate_anchor || ', ''/rpc/configure_learning_program_curriculum''');
end;
$migration$;

-- Class reports apply the same elective quota as learner certificates.
create or replace function private.learning_program_class_progress(p_program_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  company_id uuid;
  definition jsonb;
  elective_quota integer;
  result jsonb;
begin
  if p_program_id is null then raise invalid_parameter_value; end if;
  select organisation_id into company_id from private.learning_programs where id = p_program_id;
  if not found or not coalesce(
    private.learning_program_manager(company_id) and private.course_lms_read_enabled(company_id), false
  ) then raise insufficient_privilege; end if;

  definition := private.learning_program_curriculum(p_program_id);
  elective_quota := coalesce((definition->>'elective_count')::integer, 0);

  with receipt_status as (
    select membership.class_id, enrolled.user_id, module.position, receipt.id as receipt_id,
      coalesce((definition->'steps'->module.curriculum_course_id::text->>'required')::boolean, true) as required
    from private.learning_program_members enrolled
    join private.company_participant_memberships membership
      on membership.user_id = enrolled.user_id and membership.organisation_id = company_id
      and membership.status = 'active' and membership.class_id is not null
    left join private.learning_program_courses module on module.program_id = enrolled.program_id
    left join public.course_runs run on run.id = module.course_id and run.organisation_id = company_id
    left join public.course_enrolments enrolment on enrolment.course_run_id = run.id
      and enrolment.user_id = enrolled.user_id and enrolment.status in ('enrolled', 'completed')
    left join private.course_completion_records receipt on receipt.run_id = run.id
      and receipt.user_id = enrolment.user_id and receipt.revoked_at is null
    where enrolled.program_id = p_program_id and private.active_company_participant(enrolled.user_id, company_id)
  ), learner_progress as (
    select class_id, user_id,
      count(position) filter (where required) + elective_quota as module_slots,
      count(receipt_id) filter (where required)
        + least(elective_quota, count(receipt_id) filter (where not required)) as modules_completed
    from receipt_status
    group by class_id, user_id
  ), class_progress as (
    select class.id as class_id, class.name as class_name,
      count(*) as participants,
      count(*) filter (where progress.module_slots > 0
        and progress.modules_completed = progress.module_slots) as participants_completed,
      sum(progress.module_slots) as module_slots,
      sum(progress.modules_completed) as modules_completed
    from learner_progress progress
    join private.course_classes class on class.id = progress.class_id and class.organisation_id = company_id
    group by class.id, class.name
  )
  select coalesce(jsonb_agg(to_jsonb(class_progress) order by lower(class_name), class_id), '[]'::jsonb)
  into result
  from class_progress;
  return result;
end;
$$;

notify pgrst, 'reload schema';
commit;
