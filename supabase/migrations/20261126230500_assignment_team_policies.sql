begin;

alter table private.course_assignment_teams
  add column max_attempts integer check (max_attempts between 1 and 10),
  add column rubric jsonb check (rubric is null or private.valid_course_assignment_rubric(rubric));
alter table private.course_assignment_attempts
  add column team_rubric jsonb check (
    team_rubric is null or (team_id is not null and private.valid_course_assignment_rubric(team_rubric))
  );

do $migration$
declare
  correction record;
  definition text;
begin
  for correction in
    select * from (values
      (1, 'private.change_course_assignment_team(uuid,uuid,text,jsonb,integer)',
        '  deadline timestamptz;', '  deadline timestamptz;' || chr(10) ||
          '  attempt_limit integer;' || chr(10) || '  team_rubric jsonb;'),
      (2, 'private.change_course_assignment_team(uuid,uuid,text,jsonb,integer)',
        $old$  select array_agg(distinct value::uuid order by value::uuid) into members$old$,
        $new$  attempt_limit := current_team.max_attempts;
  team_rubric := current_team.rubric;
  if p_data ? 'max_attempts' then
    if jsonb_typeof(p_data->'max_attempts') <> 'null' and (
      jsonb_typeof(p_data->'max_attempts') <> 'number'
      or p_data->>'max_attempts' !~ '^([1-9]|10)$'
    ) then raise invalid_parameter_value; end if;
    attempt_limit := (p_data->>'max_attempts')::integer;
  end if;
  if p_data ? 'rubric' then
    team_rubric := nullif(p_data->'rubric','null'::jsonb);
    if team_rubric is not null and not private.valid_course_assignment_rubric(team_rubric)
      then raise invalid_parameter_value; end if;
  end if;

  select array_agg(distinct value::uuid order by value::uuid) into members$new$),
      (3, 'private.change_course_assignment_team(uuid,uuid,text,jsonb,integer)',
        $old$(id, assignment_id, title, due_at, version)
      values (target_team_id, p_assignment, team_title, deadline, 1)$old$,
        $new$(id, assignment_id, title, due_at, version, max_attempts, rubric)
      values (target_team_id, p_assignment, team_title, deadline, 1, attempt_limit, team_rubric)$new$),
      (4, 'private.change_course_assignment_team(uuid,uuid,text,jsonb,integer)',
        'due_at = deadline, version = current_team.version + 1',
        'due_at = deadline, max_attempts = attempt_limit, rubric = team_rubric, version = current_team.version + 1'),
      (5, 'private.can_submit_course_assignment(uuid,uuid,uuid,timestamptz)',
        '< definition.max_attempts', '< coalesce(team.max_attempts, definition.max_attempts)'),
      (6, 'private.course_assignments(uuid,uuid,integer)',
        $old$'id', team.id, 'title', team.title, 'due_at', team.due_at, 'version', team.version,$old$,
        $new$'id', team.id, 'title', team.title, 'due_at', team.due_at, 'version', team.version,
          'max_attempts', team.max_attempts, 'rubric', team.rubric,$new$),
      (7, 'private.course_assignments(uuid,uuid,integer)',
        'pinned.rubric, to_jsonb(review) as review',
        'coalesce(attempt.team_rubric, pinned.rubric) as rubric, to_jsonb(review) as review'),
      (8, 'private.course_assignment_action(uuid,uuid,text,jsonb,integer)',
        $old$array['team_id','title','member_ids','due_at']$old$,
        $new$array['team_id','title','member_ids','due_at','max_attempts','rubric']$new$),
      (9, 'private.course_assignment_action(uuid,uuid,text,jsonb,integer)',
        $old$file_version_id, file_name, team_id)
      values(p_assignment_id, assignment.published_version, auth.uid(), current_revision + 1, file_id, filename, submission_team)$old$,
        $new$file_version_id, file_name, team_id, team_rubric)
      values(p_assignment_id, assignment.published_version, auth.uid(), current_revision + 1, file_id, filename, submission_team,
        (select team.rubric from private.course_assignment_teams team where team.id = submission_team))$new$),
      (10, 'private.course_assignment_action(uuid,uuid,text,jsonb,integer)',
        'jsonb_array_length(definition.rubric)',
        'jsonb_array_length(coalesce(attempt.team_rubric, definition.rubric))'),
      (11, 'private.course_assignment_action(uuid,uuid,text,jsonb,integer)',
        'jsonb_array_elements(definition.rubric)',
        'jsonb_array_elements(coalesce(attempt.team_rubric, definition.rubric))'),
      (12, 'private.course_weighted_source(uuid,uuid,text)',
        'jsonb_array_elements(definition.rubric)',
        'jsonb_array_elements(coalesce(attempt.team_rubric, definition.rubric))')
    ) as changes(position, signature, previous, replacement)
    order by position
  loop
    definition := pg_catalog.pg_get_functiondef(correction.signature::regprocedure);
    if cardinality(string_to_array(definition, correction.previous)) <> 2 then
      raise exception 'Expected a single team policy change in % at %', correction.signature, correction.position;
    end if;
    execute replace(definition, correction.previous, correction.replacement);
  end loop;
end;
$migration$;

commit;
