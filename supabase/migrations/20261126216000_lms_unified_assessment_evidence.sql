-- Use current assessment, completion and membership authorities when selecting evidence.
BEGIN;

create function private.latest_course_assignment_attempt(p_assignment_id uuid, p_user_id uuid)
returns uuid language sql stable strict security invoker set search_path = '' as $$
  select attempt.id
  from private.course_assignment_attempts attempt
  where attempt.assignment_id = p_assignment_id
    and ((attempt.team_id is null and attempt.user_id = p_user_id)
      or private.course_assignment_team_access(attempt.team_id, attempt.assignment_id, p_user_id))
  order by attempt.attempt_no desc limit 1;
$$;
revoke all on function private.latest_course_assignment_attempt(uuid,uuid)
  from public, anon, authenticated, service_role;

create or replace function private.course_weighted_source(p_run_id uuid, p_user_id uuid, p_key text)
returns jsonb language plpgsql stable strict set search_path = '' as $$
declare
  evidence jsonb;
begin
  if p_key = 'quiz' then
    select jsonb_build_object(
      'score', case when grade.grade_percent is not null then grade.grade_percent
        when grade.grade_label = private.course_gradebook_mark(policy.scheme,policy.bands,grade.source_score)->>'grade_label'
          then grade.source_score end,
      'revision', grade.revision, 'attempt', grade.attempt_id, 'quiz_version', grade.quiz_version,
      'unscored', grade.grade_percent is null and grade.grade_label is distinct from
        private.course_gradebook_mark(policy.scheme,policy.bands,grade.source_score)->>'grade_label'
    ) into evidence
    from private.course_gradebook_revisions grade
    join private.course_gradebook_policies policy on policy.run_id = grade.run_id and policy.version = grade.policy_version
    where grade.run_id = p_run_id and grade.user_id = p_user_id order by grade.revision desc limit 1;
  elsif p_key = 'exam' then
    select jsonb_build_object('score', result.score, 'revision', scheduled.version)
    into evidence
    from private.course_timed_exams scheduled
    join private.course_exam_results result on result.run_id = scheduled.run_id
    where scheduled.run_id = p_run_id and result.participant_id = p_user_id
      and scheduled.published_at is not null and result.score is not null;
  elsif p_key = 'text_exam' then
    select jsonb_build_object(
      'score', (points.result->>'score')::numeric * 100 / nullif((points.result->>'max_points')::numeric, 0),
      'revision', review.revision, 'exam_revision', exam.revision
    ) into evidence
    from (
      select * from private.course_text_exam_versions exam
      where exam.run_id = p_run_id and exam.published_at is not null
      order by exam.revision desc limit 1
    ) exam
    cross join lateral (
      select * from private.course_text_exam_reviews review
      where (review.run_id, review.exam_revision, review.learner_id) = (exam.run_id, exam.revision, p_user_id)
        and review.released_at is not null
      order by review.revision desc limit 1
    ) review
    cross join lateral (select private.course_text_exam_review_payload(review, exam) result) points;
  else
    -- An older result cannot silently replace the review of the latest submission.
    -- A private draft never revokes an existing visible release on that attempt.
    select jsonb_build_object('score', case when review.state = 'released' then
      (select sum(score.value::numeric) from jsonb_array_elements(review.scores) score(value)) * 100
      / nullif((select sum(maximum.points) from jsonb_array_elements(definition.rubric) criterion(value)
        cross join lateral (
          select max((level.value->>'points')::numeric) points
          from jsonb_array_elements(criterion.value->'levels') level(value)
        ) maximum), 0) end,
      'attempt', attempt.id, 'revision', review.version, 'assignment_version', attempt.assignment_version,
      'review_state', review.state
    ) into evidence
    from private.course_assignment_attempts attempt
    join private.course_assignments assignment on assignment.id = attempt.assignment_id
    join private.course_assignment_definitions definition on definition.assignment_id = assignment.id
      and definition.version = attempt.assignment_version
    left join lateral (
      select reviewed.version, reviewed.state, reviewed.scores from private.course_assignment_reviews reviewed
      where reviewed.attempt_id = attempt.id and reviewed.state <> 'draft'
      order by reviewed.version desc limit 1
    ) review on true
    where assignment.run_id = p_run_id and assignment.id = p_key::uuid and attempt.id = private.latest_course_assignment_attempt(assignment.id, p_user_id);
  end if;
  return evidence;
end;
$$;

create or replace function private.course_completion_assignment_released(p_assignment_id uuid, p_user_id uuid)
returns boolean language sql stable set search_path = '' as $$
  select coalesce((
    select entry.state = 'released'
    from private.course_assignment_reviews entry
    where entry.attempt_id = private.latest_course_assignment_attempt(p_assignment_id, p_user_id)
      and entry.state <> 'draft'
    order by entry.version desc limit 1
  ), false);
$$;

COMMIT;
