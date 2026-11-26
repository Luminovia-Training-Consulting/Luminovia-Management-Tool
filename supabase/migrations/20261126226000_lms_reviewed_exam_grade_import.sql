BEGIN;

-- Import into the same score drafts as the manual examiner. The reviewed
-- exam version and old scores bind the spreadsheet preview to this write.
create function private.import_course_exam_grades(p_run_id uuid, p_version integer, p_rows jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  context jsonb := private.lock_course_submission_settings_actor(p_run_id);
  exam private.course_timed_exams;
  company uuid;
  entry jsonb;
  candidate uuid;
  observed integer;
  proposed integer;
  current_score integer;
  scores jsonb := '{}'::jsonb;
begin
  if not coalesce(private.course_submission_write_enabled() and (
    (context->>'teacher')::boolean or (context->>'manager')::boolean
  ), false) then raise insufficient_privilege; end if;
  select timed.* into exam from private.course_timed_exams timed
    join private.course_exam_settings setting using(run_id)
    where timed.run_id = p_run_id and setting.required;
  if not found or clock_timestamp() < private.course_exam_grading_deadline(p_run_id, exam.ends_at) then
    raise insufficient_privilege;
  end if;
  if exam.published_at is not null or exam.version is distinct from p_version then
    raise exception 'Exam grades changed or already published' using errcode = 'PT409';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or length(p_rows::text) > 50000
    or jsonb_array_length(p_rows) not between 1 and 200 then raise invalid_parameter_value; end if;
  select organisation_id into strict company from public.course_runs where id = p_run_id;

  -- Lock current learner authority in a consistent order. Course locking
  -- already serializes the canonical score and schedule writers.
  for entry in select value from jsonb_array_elements(p_rows) order by value->>'participant_id' loop
    if jsonb_typeof(entry) is distinct from 'object'
      or not (entry ?& array['participant_id','expected_score','score'])
      or entry - array['participant_id','expected_score','score'] <> '{}'::jsonb
      or not coalesce(entry->>'participant_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', false)
      or jsonb_typeof(entry->'score') is distinct from 'number'
      or entry->>'score' !~ '^(100|[0-9]{1,2})$'
      or not (entry->'expected_score' = 'null'::jsonb or (
        jsonb_typeof(entry->'expected_score') = 'number'
        and entry->>'expected_score' ~ '^(100|[0-9]{1,2})$'
      )) then raise invalid_parameter_value; end if;
    candidate := (entry->>'participant_id')::uuid;
    observed := (entry->>'expected_score')::integer;
    proposed := (entry->>'score')::integer;
    if scores ? candidate::text or observed is not distinct from proposed then raise invalid_parameter_value; end if;

    perform 1 from public.course_enrolments enrolment
      join public.profiles profile on profile.id = enrolment.user_id and profile.active
      join public.user_roles participant on participant.user_id = profile.id and participant.role = 'participant'
      join private.company_participant_memberships membership
        on membership.user_id = profile.id and membership.organisation_id = company and membership.status = 'active'
      where enrolment.course_run_id = p_run_id and enrolment.user_id = candidate
        and enrolment.status in ('enrolled','completed')
      for share of enrolment, profile, participant, membership;
    if not found then raise exception 'Reviewed exam enrolment changed' using errcode = 'PT409'; end if;
    select score into current_score from private.course_exam_results where run_id = p_run_id and participant_id = candidate;
    if current_score is distinct from observed then
      raise exception 'Reviewed exam score changed' using errcode = 'PT409';
    end if;
    scores := scores || jsonb_build_object(candidate::text, proposed);
  end loop;

  perform private.save_course_exam_grades(p_run_id, scores, p_version, false);
  return jsonb_array_length(p_rows);
end;
$$;

create function public.import_course_exam_grades(p_run_id uuid, p_version integer, p_rows jsonb)
returns integer language sql security invoker set search_path = '' as $$
  select private.import_course_exam_grades(p_run_id, p_version, p_rows);
$$;

revoke all on function private.import_course_exam_grades(uuid,integer,jsonb),
  public.import_course_exam_grades(uuid,integer,jsonb) from public, anon, authenticated, service_role;
grant execute on function private.import_course_exam_grades(uuid,integer,jsonb),
  public.import_course_exam_grades(uuid,integer,jsonb) to authenticated;

-- Keep the existing roster projection. Only the grader sees whether each
-- current course enrolment also has active participant authority for import.
do $$
declare
  reader text := pg_get_functiondef('private.course_exam_state(uuid)'::regprocedure);
  gate text := pg_get_functiondef('private.require_academy_course_access()'::regprocedure);
  row_anchor constant text := '''score'', r.score,';
  gate_anchor constant text := '''/rpc/save_course_exam_grades''';
begin
  if cardinality(string_to_array(reader, row_anchor)) <> 2
    or cardinality(string_to_array(gate, gate_anchor)) <> 2 then
    raise exception 'Expected timed examination roster and Academy write gate';
  end if;
  execute replace(reader, row_anchor, row_anchor || $eligible$
      'grade_import_eligible', case when grader then private.active_company_participant(e.user_id,
        (select organisation_id from public.course_runs where id = p_run_id)) end,
$eligible$);
  execute replace(gate, gate_anchor, gate_anchor || ', ''/rpc/import_course_exam_grades''');
end;
$$;

notify pgrst, 'reload schema';
COMMIT;
