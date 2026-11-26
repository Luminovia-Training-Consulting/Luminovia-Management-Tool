-- Extend the existing xAPI profile with scores from immutable released assessments.
BEGIN;

create index course_weighted_releases_export
  on private.course_weighted_releases(run_id, released_at);
create index course_text_exam_reviews_export
  on private.course_text_exam_reviews(run_id, released_at) where released_at is not null;

create or replace function private.course_xapi_statements(p_run_id uuid, p_from timestamptz, p_until timestamptz)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  context jsonb := private.course_workspace_context(p_run_id);
  course_company uuid;
  export_key bytea;
  activity text;
  result jsonb;
begin
  if (context->>'manager')::boolean is not true or (context->>'lms_enabled')::boolean is not true then
    raise insufficient_privilege;
  end if;
  if p_from is null or p_until is null or not isfinite(p_from) or not isfinite(p_until)
    or p_until <= p_from or p_until - p_from > interval '366 days' then
    raise exception 'Invalid learning record export window' using errcode = '22023';
  end if;
  select organisation_id into course_company from public.course_runs where id = p_run_id;
  if course_company is null then raise insufficient_privilege; end if;
  select pseudonym_key into strict export_key from private.xapi_export_identity;
  activity := 'https://luminovia.org/xapi/activities/course/' ||
    encode(extensions.hmac(convert_to('course:' || p_run_id, 'UTF8'), export_key, 'sha256'), 'hex');

  with roster as materialized (
    select user_id from public.course_enrolments where course_run_id = p_run_id
      and status in ('enrolled','completed')
      and private.active_company_participant(user_id, course_company)
  ), facts as (
    select attempt.id, attempt.user_id, attempt.created_at as happened_at,
      'attempt'::text as kind, attempt.quiz_version, attempt.score, attempt.passed, ''::text as identity_suffix
    from private.course_quiz_attempts attempt join roster using(user_id)
    where attempt.run_id = p_run_id and attempt.created_at >= p_from and attempt.created_at < p_until
    union all
    select certificate.id, certificate.user_id, certificate.created_at,
      'completion', null, null, null, ''
    from private.course_completion_records certificate join roster using(user_id)
    where certificate.run_id = p_run_id and certificate.created_at >= p_from and certificate.created_at < p_until
    union all
    select certificate.id, certificate.user_id, certificate.revoked_at,
      'revocation', null, null, null, ''
    from private.course_completion_records certificate join roster using(user_id)
    where certificate.run_id = p_run_id and certificate.revoked_at >= p_from and certificate.revoked_at < p_until
    union all
    select grade.run_id, grade.user_id, grade.released_at, 'weighted-grade', null,
      (review.snapshot->>'percent')::numeric, (review.snapshot->>'passed')::boolean,
      ':' || grade.user_id || ':' || grade.revision
    from private.course_weighted_releases grade
    join roster on roster.user_id = grade.user_id
    join private.course_weighted_reviews review
      on (review.run_id, review.user_id, review.revision) = (grade.run_id, grade.user_id, grade.review_revision)
    where grade.run_id = p_run_id and grade.released_at >= p_from and grade.released_at < p_until
    union all
    select review.run_id, review.learner_id, review.released_at, 'text-exam', review.exam_revision,
      (result.score->>'score')::numeric * 100 / nullif((result.score->>'max_points')::numeric, 0),
      (result.score->>'passed')::boolean,
      ':' || review.learner_id || ':' || review.exam_revision || ':' || review.revision
    from private.course_text_exam_reviews review
    join roster on roster.user_id = review.learner_id
    join private.course_text_exam_versions exam
      on (exam.run_id, exam.revision) = (review.run_id, review.exam_revision)
    cross join lateral (select private.course_text_exam_review_payload(review, exam) score) result
    where review.run_id = p_run_id and review.released_at >= p_from and review.released_at < p_until
  ), bounded as (
    select * from facts order by happened_at, kind, id, identity_suffix limit 2001
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', private.xapi_statement_id(kind || identity_suffix, id, export_key),
    'timestamp', happened_at,
    'actor', jsonb_build_object('objectType', 'Agent', 'account', jsonb_build_object(
      'homePage','https://luminovia.org',
      'name', encode(extensions.hmac(convert_to(
        course_company::text || ':' || case when kind='revocation' then 'certificate-service' else user_id::text end,
        'UTF8'), export_key, 'sha256'), 'hex')
    )),
    'verb', jsonb_build_object('id', 'http://adlnet.gov/expapi/verbs/' ||
      case kind when 'revocation' then 'voided' when 'attempt' then 'attempted'
        when 'completion' then 'completed' else 'scored' end),
    'object', case when kind='revocation' then jsonb_build_object(
      'objectType', 'StatementRef', 'id', private.xapi_statement_id('completion', id, export_key)
    ) else jsonb_build_object('objectType','Activity', 'id',
      case kind when 'attempt' then activity || '/quiz/' || quiz_version
        when 'text-exam' then activity || '/text-exam/' || quiz_version
        when 'weighted-grade' then activity || '/weighted-grade' else activity end)
    end
  ) || case
    when kind in ('attempt','weighted-grade','text-exam') then jsonb_build_object('result', jsonb_build_object('score', jsonb_build_object(
      'scaled', score::numeric / 100, 'raw', score, 'min', 0, 'max', 100), 'success', passed))
    when kind = 'completion' then jsonb_build_object('result', jsonb_build_object('completion', true))
    else '{}'::jsonb end
  order by happened_at, kind, id, identity_suffix), '[]'::jsonb) into result from bounded;
  if jsonb_array_length(result) > 2000 then
    raise exception 'Learning record export exceeds 2000 statements; choose a shorter period' using errcode = '54000';
  end if;
  return jsonb_build_object('profile', 'luminovia-lms-1', 'xapi_version', '1.0.3', 'statements', result);
end;
$$;

COMMIT;
