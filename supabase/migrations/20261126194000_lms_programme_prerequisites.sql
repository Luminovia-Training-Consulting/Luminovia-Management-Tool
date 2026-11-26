begin;

-- Programme order is frozen once the first member enrols. Positional rules
-- continue to identify retired course steps even when their run is deleted.
alter table private.learning_programs
  add column path_rules jsonb not null default '{}'::jsonb
    check (jsonb_typeof(path_rules) = 'object');

create or replace function private.learning_program_progress(p_program uuid, p_user uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  with course_facts as materialized (
    select item.position, item.course_id, item.title, enrolment.status,
      receipt.id as receipt_id, receipt.created_at as completed_at,
      (run.id is not null and run.published and run.archived_at is null) as available,
      (run.id is not null and receipt.id is not null
        and enrolment.status in ('enrolled', 'completed')) as completed,
      program.sequential, program.archived_at, program.path_rules->item.position::text as rule
    from private.learning_programs program
    join private.learning_program_courses item on item.program_id = program.id
    left join public.course_runs run on run.id = item.course_id
      and run.organisation_id = program.organisation_id
    left join public.course_enrolments enrolment on enrolment.course_run_id = run.id
      and enrolment.user_id = p_user
    left join private.course_completion_records receipt on receipt.run_id = run.id
      and receipt.user_id = p_user and receipt.revoked_at is null
    where program.id = p_program
  ), steps as (
    select target.*, requirements.items, requirements.met
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
        (target.rule is null and target.sequential) or
        target.rule->'positions' @> jsonb_build_array(prior.position)
      )
    ) requirements
  )
  select jsonb_build_object(
    'completed', count(*) filter (where completed is true),
    'total', count(*),
    'completed_at', case when count(*) > 0 and bool_and(completed is true) then max(completed_at) end,
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
      'can_open', available and coalesce(status in ('enrolled', 'completed'), false)
        and (completed is true or met)
    ) || case when not met and available and status is distinct from 'removed' and completed is not true
      then jsonb_build_object('prerequisites', jsonb_build_object(
        'mode', coalesce(rule->>'mode', 'all'), 'items', items
      )) else '{}'::jsonb
      end order by position), '[]'::jsonb)
  ) from steps;
$$;

-- Edit one step against its reviewed programme revision. Each dependency must
-- point strictly backwards, making self-dependencies and cycles impossible.
create function private.set_learning_program_prerequisite(
  p_program_id uuid, p_position integer, p_mode text, p_requires integer[],
  p_expected_version integer
) returns void language plpgsql security definer set search_path = '' as $$
declare
  program private.learning_programs;
  prior_positions integer[];
  rules jsonb;
begin
  if p_program_id is null or p_position is null or p_position not between 2 and 30
     or p_mode is null or p_mode not in ('all', 'any') or p_requires is null
     or cardinality(p_requires) > 29 or array_position(p_requires, null) is not null
     or p_expected_version is null or p_expected_version < 1 then
    raise invalid_parameter_value;
  end if;
  select coalesce(array_agg(distinct position order by position), '{}'::integer[])
    into prior_positions from unnest(p_requires) position;
  if cardinality(prior_positions) <> cardinality(p_requires) or exists (
    select 1 from unnest(prior_positions) position where position < 1 or position >= p_position
  ) then raise invalid_parameter_value; end if;

  if (select edition from private.installation_identity) is distinct from 'internal' then
    perform private.lock_academy_course_access();
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('learning-program:' || p_program_id, 0));
  select * into program from private.learning_programs where id = p_program_id for update;
  if not found or not private.learning_program_manager(program.organisation_id) then
    raise insufficient_privilege;
  end if;
  perform private.lock_learning_program_scope(program.organisation_id, auth.uid(), null);
  if not private.learning_program_manager(program.organisation_id) then raise insufficient_privilege; end if;
  if not exists (
    select 1 from private.learning_program_courses where program_id = program.id and position = p_position
  ) or cardinality(prior_positions) <> (
    select count(*) from private.learning_program_courses
    where program_id = program.id and position = any(prior_positions) and course_id is not null
  ) then raise invalid_parameter_value; end if;

  rules := case when cardinality(prior_positions) = 0 then program.path_rules - p_position::text
    else jsonb_set(program.path_rules, array[p_position::text],
      jsonb_build_object('mode', p_mode, 'positions', prior_positions)) end;
  if program.path_rules = rules then return; end if;
  if program.version <> p_expected_version or program.archived_at is not null or exists (
    select 1 from private.learning_program_members where program_id = program.id
  ) then
    raise exception 'The programme revision changed or is locked' using errcode = 'PT409';
  end if;
  update private.learning_programs set path_rules = rules, version = program.version + 1 where id = program.id;
  insert into public.audit_events(actor_id, action, resource_id, details)
  values (auth.uid(), 'learning.program.prerequisite_changed', program.id,
    jsonb_build_object('position', p_position, 'mode', p_mode, 'requires', prior_positions,
      'version', program.version + 1));
end;
$$;
create function public.set_learning_program_prerequisite(
  p_program_id uuid, p_position integer, p_mode text, p_requires integer[], p_expected_version integer
) returns void language sql security invoker set search_path = '' as $$
  select private.set_learning_program_prerequisite(p_program_id, p_position, p_mode, p_requires, p_expected_version);
$$;
revoke all on function private.set_learning_program_prerequisite(uuid, integer, text, integer[], integer),
  public.set_learning_program_prerequisite(uuid, integer, text, integer[], integer)
  from public, anon, service_role;
grant execute on function private.set_learning_program_prerequisite(uuid, integer, text, integer[], integer),
  public.set_learning_program_prerequisite(uuid, integer, text, integer[], integer) to authenticated;

-- Preserve the manager projection and protect position meaning from old clients
-- that save the programme course list without knowing about explicit gates.
do $$
declare
  reader text := pg_catalog.pg_get_functiondef('private.learning_programs(uuid,uuid,text)'::regprocedure);
  writer text := pg_catalog.pg_get_functiondef(
    'private.save_learning_program(uuid,uuid,text,text,boolean,uuid[],boolean,integer)'::regprocedure
  );
  gate text := pg_catalog.pg_get_functiondef('private.require_academy_course_access()'::regprocedure);
  read_anchor constant text := '''progress'', case when learner';
  write_anchor constant text := '  same_content := previous.id is not null';
  gate_anchor constant text := '''/rpc/start_learning_program_course''';
begin
  if cardinality(string_to_array(reader, read_anchor)) <> 2
     or cardinality(string_to_array(writer, write_anchor)) <> 2
     or cardinality(string_to_array(gate, gate_anchor)) <> 2 then
    raise exception 'Expected learning programme read, write and licence boundaries';
  end if;
  execute replace(reader, read_anchor, '''path_rules'', case when manager then selected.path_rules end, ' || read_anchor);
  execute replace(writer, write_anchor, $guard$
  if previous.path_rules <> '{}'::jsonb and current_courses is distinct from p_course_ids then
    raise exception 'Clear explicit prerequisites before changing programme courses' using errcode = 'PT409';
  end if;
$guard$ || write_anchor);
  execute replace(gate, gate_anchor, gate_anchor || ', ''/rpc/set_learning_program_prerequisite''');
end;
$$;

notify pgrst, 'reload schema';
commit;
