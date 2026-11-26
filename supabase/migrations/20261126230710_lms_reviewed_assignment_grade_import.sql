-- Batch a reviewed rubric spreadsheet through the existing assignment draft writer.
begin;

create function private.import_course_assignment_reviews(
  p_run uuid, p_assignment uuid, p_payload jsonb
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  rows jsonb := p_payload->'rows';
  course_org uuid;
  entry jsonb;
  target uuid;
  attempt private.course_assignment_attempts%rowtype;
  draft private.course_assignment_reviews%rowtype;
  seen uuid[] := '{}';
begin
  if jsonb_typeof(rows) is distinct from 'array'
    or jsonb_array_length(rows) not between 1 and 25 then raise invalid_parameter_value; end if;
  select organisation_id into strict course_org from public.course_runs where id = p_run;

  -- The outer writer has acquired the course lock. Use each attempt's
  -- immutable rubric and verify the exact draft before saving.
  for entry in select value from jsonb_array_elements(rows) order by value->>'attempt_id' loop
    if jsonb_typeof(entry) is distinct from 'object'
      or not (entry ?& array['attempt_id','rubric_version','review_version','scores'])
      or entry - array['attempt_id','rubric_version','review_version','scores'] <> '{}'::jsonb
      or jsonb_typeof(entry->'attempt_id') is distinct from 'string'
      or entry->>'attempt_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or jsonb_typeof(entry->'rubric_version') is distinct from 'number'
      or entry->>'rubric_version' !~ '^[1-9][0-9]{0,8}$'
      or jsonb_typeof(entry->'review_version') is distinct from 'number'
      or entry->>'review_version' !~ '^(0|[1-9][0-9]{0,8})$'
      or jsonb_typeof(entry->'scores') is distinct from 'array'
      then raise invalid_parameter_value; end if;
    target := (entry->>'attempt_id')::uuid;
    if target = any(seen) then raise invalid_parameter_value; end if;
    seen := array_append(seen, target);

    select * into attempt from private.course_assignment_attempts
      where id = target and assignment_id = p_assignment
        and assignment_version = (entry->>'rubric_version')::integer
        and user_id <> auth.uid();
    if not found or exists (
      select 1 from private.course_assignment_team_members member
      where member.team_id = attempt.team_id and member.user_id = auth.uid()
    ) then raise exception 'Reviewed assignment attempt changed' using errcode = 'PT409'; end if;

    perform 1 from public.course_enrolments enrolment
      join public.profiles profile on profile.id = enrolment.user_id and profile.active
      join public.user_roles participant on participant.user_id = profile.id and participant.role = 'participant'
      join private.company_participant_memberships membership
        on membership.user_id = profile.id and membership.organisation_id = course_org and membership.status = 'active'
      where enrolment.course_run_id = p_run and enrolment.status in ('enrolled','completed')
        and ((attempt.team_id is null and profile.id = attempt.user_id) or exists (
          select 1 from private.course_assignment_team_members member
          where member.team_id = attempt.team_id and member.user_id = profile.id
        ))
      order by profile.id limit 1 for share of enrolment, profile, participant, membership;
    if not found then raise exception 'Reviewed assignment enrolment changed' using errcode = 'PT409'; end if;

    select * into draft from private.course_assignment_reviews
      where attempt_id = target order by version desc limit 1;
    if coalesce(draft.version, 0) <> (entry->>'review_version')::integer
      or (draft.state is not null and draft.state <> 'draft') then
      raise exception 'Reviewed assignment draft changed' using errcode = 'PT409';
    end if;
    if draft.scores = entry->'scores' then raise invalid_parameter_value; end if;
    perform private.course_assignment_action(p_run, p_assignment, 'review', jsonb_build_object(
      'attempt_id', target, 'state', 'draft', 'scores', entry->'scores',
      'feedback', coalesce(draft.feedback, ''), 'private_note', coalesce(draft.private_note, '')
    ), coalesce(draft.version, 0));
  end loop;
  return jsonb_build_object('id', p_assignment, 'imported', cardinality(seen));
end;
$$;

revoke all on function private.import_course_assignment_reviews(uuid,uuid,jsonb)
  from public, anon, authenticated, service_role;

do $migration$
declare
  reader text := pg_catalog.pg_get_functiondef('private.course_assignments(uuid,uuid,integer)'::regprocedure);
  action text := pg_catalog.pg_get_functiondef('private.course_assignment_action(uuid,uuid,text,jsonb,integer)'::regprocedure);
  projection constant text := 'attempt.file_version_id, attempt.file_name, attempt.submitted_at, team.title as team_title,';
  fields constant text := '    when ''review'' then array[''attempt_id'',''state'',''scores'',''feedback'',''private_note'']';
  branches constant text := '    elsif p_action = ''review'' then';
begin
  if cardinality(string_to_array(reader, projection)) <> 2
    or cardinality(string_to_array(action, fields)) <> 2
    or cardinality(string_to_array(action, branches)) <> 2 then
    raise exception 'Expected assignment attempt roster and draft review writer';
  end if;

  execute replace(reader, projection, projection || $source$
            attempt.assignment_version as rubric_version,
            case when staff then (
              attempt.user_id <> auth.uid()
              and not exists (
                select 1 from private.course_assignment_team_members self
                where self.team_id = attempt.team_id and self.user_id = auth.uid()
              )
              and exists (
                select 1 from public.course_enrolments enrolment
                join public.course_runs run on run.id = enrolment.course_run_id
                where enrolment.course_run_id = p_run_id and enrolment.status in ('enrolled','completed')
                  and ((attempt.team_id is null and enrolment.user_id = attempt.user_id) or exists (
                    select 1 from private.course_assignment_team_members member
                    where member.team_id = attempt.team_id and member.user_id = enrolment.user_id
                  ))
                  and private.active_company_participant(enrolment.user_id, run.organisation_id)
              )
            ) end as import_eligible,
$source$);
  action := replace(action, fields, fields || E'\n    when ''import_reviews'' then array[''rows'']');
  execute replace(action, branches, $batch$
    elsif p_action = 'import_reviews' then
      if p_expected_version <> 0 then raise invalid_parameter_value; end if;
      return private.import_course_assignment_reviews(p_run_id, p_assignment_id, p_payload);
$batch$ || branches);
end;
$migration$;

notify pgrst, 'reload schema';
commit;
