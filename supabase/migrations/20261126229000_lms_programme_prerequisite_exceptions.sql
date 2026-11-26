-- Scoped, versioned exceptions allow a learner to start one programme step.
begin;

create table private.learning_program_path_exceptions (
  program_id uuid not null,
  user_id uuid not null,
  position integer not null check (position between 2 and 30),
  revision integer not null check (revision > 0),
  active boolean not null,
  reason text not null check (char_length(reason) between 3 and 500),
  decided_at timestamptz not null default clock_timestamp(),
  decided_by uuid references public.profiles(id) on delete set null,
  primary key (program_id, user_id, position, revision),
  foreign key (program_id, user_id)
    references private.learning_program_members(program_id, user_id) on delete cascade,
  foreign key (program_id, position)
    references private.learning_program_courses(program_id, position) on delete cascade
);
alter table private.learning_program_path_exceptions enable row level security;
revoke all on private.learning_program_path_exceptions from public, anon, authenticated, service_role;

-- Keep certificate evidence and completion counts on the original receipt path.
-- Project the current decision without exposing the reason to the learner or company.
do $migration$
declare
  progress text := pg_catalog.pg_get_functiondef('private.learning_program_progress(uuid,uuid)'::regprocedure);
  detail text := pg_catalog.pg_get_functiondef('private.learning_programs(uuid,uuid,text)'::regprocedure);
  item_anchor constant text := 'as rule' || chr(10);
  source_anchor constant text := '    where program.id = p_program';
  met_anchor constant text := '    select target.*, requirements.items, requirements.met';
  projection_anchor constant text := '      ''can_open'', available';
  manager_anchor constant text := '''manage'', manager, ''can_write'', manager and writable,';
  ingress text := pg_catalog.pg_get_functiondef('private.require_academy_course_access()'::regprocedure);
  ingress_anchor constant text := '''/rpc/set_learning_program_prerequisite''';
begin
  if cardinality(string_to_array(progress, item_anchor)) <> 2
     or cardinality(string_to_array(progress, source_anchor)) <> 2
     or cardinality(string_to_array(progress, met_anchor)) <> 2
     or cardinality(string_to_array(progress, projection_anchor)) <> 2
     or cardinality(string_to_array(detail, manager_anchor)) <> 2
     or cardinality(string_to_array(ingress, ingress_anchor)) <> 2
     then raise exception 'Expected programme evaluator, manager and licence boundaries'; end if;

  progress := replace(progress, item_anchor,
    'as rule, decision.active as exception_active, decision.revision as exception_revision' || chr(10));
  progress := replace(progress, source_anchor, $join$
    left join lateral (
      select exception.active, exception.revision
      from private.learning_program_path_exceptions exception
      where exception.program_id = program.id and exception.user_id = p_user
        and exception.position = item.position
      order by exception.revision desc limit 1
    ) decision on true
$join$ || source_anchor);
  progress := replace(progress, met_anchor,
    '    select target.*, requirements.items, (requirements.met or target.exception_active is true) as met');
  execute replace(progress, projection_anchor, $projection$
      'prerequisite_exception', case when exception_revision is not null then
        jsonb_build_object('active', exception_active, 'revision', exception_revision) end,
$projection$ || projection_anchor);

  execute replace(detail, manager_anchor, manager_anchor ||
    ' ''can_manage_path_exceptions'', manager and writable and private.has_permission(''courses.manage''),');
  execute replace(ingress, ingress_anchor, ingress_anchor || ', ''/rpc/set_learning_program_path_exception''');
end;
$migration$;

create function private.set_learning_program_path_exception(
  p_program_id uuid, p_participant_id uuid, p_position integer,
  p_active boolean, p_reason text, p_expected_revision integer
) returns integer language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  program private.learning_programs;
  current private.learning_program_path_exceptions;
  reviewed_reason text := btrim(p_reason);
  target_course uuid;
  target_state text;
  next_revision integer;
begin
  if p_program_id is null or p_participant_id is null or p_active is null
    or p_position is null or p_position not between 2 and 30
    or p_expected_revision is null or p_expected_revision < 0
    or reviewed_reason is null or char_length(reviewed_reason) not between 3 and 500
    then raise invalid_parameter_value; end if;
  if actor is null or not private.has_permission('courses.manage') then raise insufficient_privilege; end if;
  if (select edition <> 'internal' from private.installation_identity) then
    perform private.lock_academy_course_access();
  end if;
  select * into program from private.learning_programs where id = p_program_id for update;
  if not found or program.archived_at is not null then raise insufficient_privilege; end if;
  select run.id into target_course from private.learning_program_courses step
    join public.course_runs run on run.id = step.course_id and run.organisation_id = program.organisation_id
    where step.program_id = program.id and step.position = p_position
      and run.archived_at is null and run.published for share of run;
  if not found then raise insufficient_privilege; end if;
  perform private.lock_learning_program_scope(program.organisation_id, actor, p_participant_id);
  if not private.has_permission('courses.manage') or not private.learning_program_manager(program.organisation_id) then
    raise insufficient_privilege; end if;
  perform 1 from private.learning_program_members
    where program_id = program.id and user_id = p_participant_id for share;
  if not found then raise insufficient_privilege; end if;

  select * into current from private.learning_program_path_exceptions
    where program_id = program.id and user_id = p_participant_id and position = p_position
    order by revision desc limit 1;
  if current.revision = p_expected_revision + 1 and current.active = p_active and current.reason = reviewed_reason then
    return current.revision;
  end if;
  if coalesce(current.revision, 0) <> p_expected_revision then
    raise exception 'Programme prerequisite exception changed' using errcode = 'PT409';
  end if;
  if coalesce(current.active, false) = p_active then raise invalid_parameter_value; end if;
  if p_active then
    select step->>'state' into target_state
    from jsonb_array_elements(private.learning_program_progress(program.id, p_participant_id)->'steps') step
    where step->>'course_id' = target_course::text;
    if target_state is distinct from 'locked' then
      raise exception 'The programme course is already available' using errcode = 'PT409';
    end if;
  end if;

  next_revision := coalesce(current.revision, 0) + 1;
  insert into private.learning_program_path_exceptions(program_id,user_id,position,revision,active,reason,decided_by)
    values (program.id,p_participant_id,p_position,next_revision,p_active,reviewed_reason,actor);
  insert into public.audit_events(actor_id,action,resource_id,details)
    values (actor,'learning.program.prerequisite_exception',program.id,
      jsonb_build_object('position',p_position,'revision',next_revision,'active',p_active));
  return next_revision;
end;
$$;
create function public.set_learning_program_path_exception(
  p_program_id uuid, p_participant_id uuid, p_position integer,
  p_active boolean, p_reason text, p_expected_revision integer
) returns integer language sql security invoker set search_path = '' as $$
  select private.set_learning_program_path_exception(
    p_program_id, p_participant_id, p_position, p_active, p_reason, p_expected_revision);
$$;
revoke all on function private.set_learning_program_path_exception(uuid,uuid,integer,boolean,text,integer),
  public.set_learning_program_path_exception(uuid,uuid,integer,boolean,text,integer)
  from public, anon, authenticated, service_role;
grant execute on function private.set_learning_program_path_exception(uuid,uuid,integer,boolean,text,integer),
  public.set_learning_program_path_exception(uuid,uuid,integer,boolean,text,integer) to authenticated;

notify pgrst, 'reload schema';
commit;
