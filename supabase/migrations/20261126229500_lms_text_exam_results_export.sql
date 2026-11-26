-- Export an authorised, versioned grade projection without answers or review text.
begin;

create function private.course_text_exam_grade_export(
  p_run_id uuid, p_revision integer, p_after uuid, p_as_of timestamptz
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  access jsonb := private.course_workspace_context(p_run_id);
  exam private.course_text_exam_versions;
  cutoff timestamptz := coalesce(p_as_of, statement_timestamp());
  result jsonb;
begin
  if auth.uid() is null or (access->>'lms_enabled')::boolean is not true
    or (access->>'staff')::boolean is not true then raise insufficient_privilege; end if;
  if p_revision is null or p_revision < 1 or not isfinite(cutoff)
    or cutoff > statement_timestamp() then raise invalid_parameter_value; end if;
  select * into exam from private.course_text_exam_versions
    where run_id = p_run_id and revision = p_revision and published_at is not null;
  if not found then raise insufficient_privilege; end if;

  with candidates as materialized (
    select enrolment.user_id, profile.display_name, attempt.submitted_at
    from private.course_text_exam_attempts attempt
    join public.course_runs run on run.id = attempt.run_id
    join public.course_enrolments enrolment
      on enrolment.course_run_id = run.id and enrolment.user_id = attempt.learner_id
    join public.profiles profile on profile.id = enrolment.user_id
    where attempt.run_id = p_run_id and attempt.exam_revision = p_revision
      and attempt.submitted_at is not null and attempt.learner_id <> auth.uid()
      and (p_after is null or enrolment.user_id > p_after)
      and enrolment.status in ('enrolled','completed')
      and private.active_company_participant(enrolment.user_id, run.organisation_id)
  ), page as materialized (
    select candidate.*, private.course_text_exam_review_payload(assessment.item, exam) as grade
    from candidates candidate
    join lateral (
      select assessment as item from private.course_text_exam_reviews assessment
      where assessment.run_id = p_run_id and assessment.exam_revision = p_revision
        and assessment.learner_id = candidate.user_id and assessment.released_at <= cutoff
      order by assessment.revision desc limit 1
    ) assessment on true
    order by candidate.user_id limit 101
  ), visible as (
    select * from page order by user_id limit 100
  )
  select jsonb_build_object(
    'as_of', cutoff,
    'next', case when (select count(*) from page) > 100 then
      (select user_id from visible order by user_id desc limit 1) end,
    'rows', coalesce(jsonb_agg(jsonb_build_object(
      'learner_id', user_id, 'name', display_name, 'submitted_at', submitted_at,
      'grade_revision', grade->'revision', 'score', grade->'score',
      'max_points', grade->'max_points', 'passed', grade->'passed', 'released_at', grade->'released_at'
    ) order by user_id), '[]'::jsonb)
  ) into result from visible;
  return result;
end;
$$;
create function public.course_text_exam_grade_export(
  p_run_id uuid, p_revision integer, p_after uuid default null, p_as_of timestamptz default null
) returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.course_text_exam_grade_export(p_run_id, p_revision, p_after, p_as_of);
$$;
revoke all on function private.course_text_exam_grade_export(uuid,integer,uuid,timestamptz),
  public.course_text_exam_grade_export(uuid,integer,uuid,timestamptz) from public, anon, authenticated, service_role;
grant execute on function private.course_text_exam_grade_export(uuid,integer,uuid,timestamptz),
  public.course_text_exam_grade_export(uuid,integer,uuid,timestamptz) to authenticated;

do $migration$
declare
  gate text := pg_catalog.pg_get_functiondef('private.require_academy_course_access()'::regprocedure);
  anchor constant text := '''/rpc/course_text_exam''';
begin
  if cardinality(string_to_array(gate, anchor)) <> 2 then
    raise exception 'Expected the native text exam licence gate';
  end if;
  execute replace(gate, anchor, anchor || ', ''/rpc/course_text_exam_grade_export''');
end;
$migration$;

notify pgrst, 'reload schema';
commit;
