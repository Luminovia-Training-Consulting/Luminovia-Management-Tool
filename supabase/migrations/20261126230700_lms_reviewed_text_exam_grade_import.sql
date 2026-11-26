-- Save a reviewed spreadsheet into the canonical text exam review history.
begin;

create function private.import_course_text_exam_reviews(
  p_exam private.course_text_exam_versions, p_payload jsonb
) returns integer language plpgsql security invoker set search_path = '' as $$
declare
  rows jsonb := p_payload->'rows';
  course_org uuid;
  entry jsonb;
  target uuid;
  expected integer;
  head private.course_text_exam_reviews%rowtype;
  seen uuid[] := '{}';
begin
  if p_payload - 'rows' <> '{}'::jsonb
    or jsonb_typeof(rows) is distinct from 'array'
    or length(rows::text) > 50000 then raise invalid_parameter_value; end if;
  if jsonb_array_length(rows) not between 1 and 25 then raise invalid_parameter_value; end if;
  if clock_timestamp() < private.course_exam_grading_deadline(p_exam.run_id, p_exam.closes_at) then
    raise exception 'Text exam is still open' using errcode = 'PT409';
  end if;
  select organisation_id into strict course_org from public.course_runs where id = p_exam.run_id;

  -- The enclosing action holds the same course lock as ordinary review,
  -- release and learner submission. Recheck each candidate under row locks.
  for entry in select value from jsonb_array_elements(rows) order by value->>'learner_id' loop
    if jsonb_typeof(entry) is distinct from 'object'
      or not (entry ?& array['learner_id','expected_revision','points'])
      or entry - array['learner_id','expected_revision','points'] <> '{}'::jsonb
      or jsonb_typeof(entry->'learner_id') is distinct from 'string'
      or entry->>'learner_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or jsonb_typeof(entry->'expected_revision') is distinct from 'number'
      or entry->>'expected_revision' !~ '^(0|[1-9][0-9]{0,8})$'
      or jsonb_typeof(entry->'points') is distinct from 'array'
      then raise invalid_parameter_value; end if;
    target := (entry->>'learner_id')::uuid;
    expected := (entry->>'expected_revision')::integer;
    if target = any(seen) then raise invalid_parameter_value; end if;
    seen := array_append(seen, target);

    perform 1 from private.course_text_exam_attempts attempt
      join public.course_enrolments enrolment on enrolment.course_run_id = attempt.run_id
        and enrolment.user_id = attempt.learner_id
      join public.profiles profile on profile.id = attempt.learner_id and profile.active
      join public.user_roles participant on participant.user_id = profile.id and participant.role = 'participant'
      join private.company_participant_memberships membership
        on membership.user_id = profile.id and membership.organisation_id = course_org and membership.status = 'active'
      where attempt.run_id = p_exam.run_id and attempt.exam_revision = p_exam.revision
        and attempt.learner_id = target and target <> auth.uid() and attempt.submitted_at is not null
        and enrolment.status in ('enrolled','completed')
      for share of attempt, enrolment, profile, participant, membership;
    if not found then raise exception 'Reviewed exam enrolment changed' using errcode = 'PT409'; end if;

    select * into head from private.course_text_exam_reviews
      where run_id = p_exam.run_id and exam_revision = p_exam.revision and learner_id = target
      order by revision desc limit 1;
    if coalesce(head.revision, 0) <> expected or head.released_at is not null then
      raise exception 'Reviewed exam draft changed' using errcode = 'PT409';
    end if;
    if head.points = entry->'points' then raise invalid_parameter_value; end if;
    perform private.course_text_exam_grade(p_exam, 'save_review', expected, jsonb_build_object(
      'learner_id', target, 'points', entry->'points', 'feedback', coalesce(head.feedback, '')
    ));
  end loop;
  return cardinality(seen);
end;
$$;

revoke all on function private.import_course_text_exam_reviews(private.course_text_exam_versions,jsonb)
  from public, anon, authenticated, service_role;

do $migration$
declare
  reader text := pg_catalog.pg_get_functiondef('private.course_text_exam(uuid,integer,uuid,integer)'::regprocedure);
  action text := pg_catalog.pg_get_functiondef('private.course_text_exam_action(uuid,text,integer,integer,jsonb)'::regprocedure);
  roster_anchor constant text := '''review_state'', submission.review_state';
  draft_anchor constant text := 'end review_state,';
  projection_anchor constant text := 'select assessment.revision, assessment.released_at';
  actions_anchor constant text := '''submit'',''save_review'',''release'')';
  grade_anchor constant text := '    accepted := private.course_text_exam_grade(exam, p_action, p_expected, p_payload);';
begin
  if cardinality(string_to_array(reader, roster_anchor)) <> 2
    or cardinality(string_to_array(reader, draft_anchor)) <> 2
    or cardinality(string_to_array(reader, projection_anchor)) <> 2
    or cardinality(string_to_array(action, actions_anchor)) <> 2
    or cardinality(string_to_array(action, grade_anchor)) <> 2 then
    raise exception 'Expected native text examination roster and grading operations';
  end if;
  reader := replace(reader, roster_anchor, roster_anchor ||
    ', ''import_draft'', submission.import_draft');
  reader := replace(reader, draft_anchor, draft_anchor || $draft$
          case when writable and statement_timestamp() >= deadline
            and assessment.released_at is null and exists (
              select 1 from public.course_enrolments enrolment
              where enrolment.course_run_id = p_run_id and enrolment.user_id = candidate.learner_id
                and enrolment.status in ('enrolled','completed')
            ) and private.active_company_participant(candidate.learner_id,
              (select run.organisation_id from public.course_runs run where run.id = p_run_id))
          then jsonb_build_object(
            'revision', coalesce(assessment.revision, 0), 'points', assessment.points
          ) end as import_draft,
$draft$);
  execute replace(reader, projection_anchor, projection_anchor || ', assessment.points');
  action := replace(action, actions_anchor, '''submit'',''save_review'',''release'',''import_reviews'')');
  execute replace(action, grade_anchor, $grade$
    if p_action = 'import_reviews' then
      if p_expected <> 0 then raise invalid_parameter_value; end if;
      accepted := private.import_course_text_exam_reviews(exam, p_payload);
    else
      accepted := private.course_text_exam_grade(exam, p_action, p_expected, p_payload);
    end if;
$grade$);
end;
$migration$;

notify pgrst, 'reload schema';
commit;
