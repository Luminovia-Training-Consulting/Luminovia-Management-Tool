begin;

-- Add metric definitions to the existing reporting authority. Use its exact
-- course page and current learner roster before aggregating any assessment
-- data. Company callers retain the original report shape.
do $migration$
declare
  source text := pg_get_functiondef('private.learning_analytics_report(text,date,date,uuid,text,text,integer)'::regprocedure);
  page_anchor constant text := '    ), monthly as (';
  output_anchor constant text := $old$
      'courses', (select coalesce(jsonb_agg(to_jsonb(pages) order by cohort_date desc, id desc), '[]'::jsonb) from pages)
    )
$old$;
begin
  if cardinality(string_to_array(source, page_anchor)) <> 2
     or cardinality(string_to_array(source, output_anchor)) <> 2 then
    raise exception 'Unexpected learning analytics assessment projection anchor';
  end if;
  source := replace(source, page_anchor, $aggregate$
    ), assessed_roster as materialized (
      select roster.course_run_id as run_id, roster.user_id
      from roster join pages course on course.id = roster.course_run_id
      where p_scope in ('staff', 'personal')
    ), quiz_learner as (
      select attempt.run_id, attempt.user_id, count(*) as attempts, max(attempt.score) as best,
        bool_or(attempt.passed) as passed
      from assessed_roster learner
      join private.course_quiz_attempts attempt on attempt.run_id = learner.run_id and attempt.user_id = learner.user_id
      group by attempt.run_id, attempt.user_id
    ), quiz_totals as (
      select run_id, count(*) as learners, sum(attempts) as attempts,
        count(*) filter (where passed) as passes, round(avg(best), 2) as average
      from quiz_learner group by run_id
    ), latest_grades as (
      select learner.run_id, grade.grade_percent
      from assessed_roster learner
      cross join lateral (
        select revision.grade_percent from private.course_gradebook_revisions revision
        where revision.run_id = learner.run_id and revision.user_id = learner.user_id
        order by revision.revision desc limit 1
      ) grade
    ), grade_totals as (
      select run_id, count(*) as grades, count(grade_percent) as numeric_grades,
        round(avg(grade_percent), 2) as average
      from latest_grades group by run_id
    ), assignment_totals as (
      select learner.run_id, count(*) as attempts, count(distinct learner.user_id) as learners,
        count(*) filter (where review.state = 'released') as released,
        count(distinct learner.user_id) filter (where review.state = 'released') as released_learners
      from assessed_roster learner
      join private.course_assignments assignment on assignment.run_id = learner.run_id
      join private.course_assignment_attempts attempt on attempt.assignment_id = assignment.id and attempt.user_id = learner.user_id
      left join lateral (
        select latest.state from private.course_assignment_reviews latest
        where latest.attempt_id = attempt.id and latest.state <> 'draft'
        order by latest.version desc limit 1
      ) review on true
      group by learner.run_id
    ), competency_totals as (
      select learner.run_id, count(distinct learner.user_id) as learners,
        count(distinct (learner.user_id, decision.competency_id)) as decisions
      from pages course
      join public.course_runs run on run.id = course.id
      cross join lateral (
        select revision, framework_id from private.lms_course_competency_pins
        where run_id = course.id order by revision desc limit 1
      ) pin
      join private.lms_competency_frameworks framework
        on framework.id = pin.framework_id and framework.organisation_id = run.organisation_id
      join assessed_roster learner on learner.run_id = course.id
      join private.lms_competency_decisions decision on decision.run_id = learner.run_id
        and decision.user_id = learner.user_id and decision.pin_revision = pin.revision
      group by learner.run_id
    ), assessment as (
      -- Privacy thresholds apply separately to each contributing population.
      -- Percent grades never include values from labelled scales.
      select course.id as course_id, course.cohort_date,
        case when quiz.learners >= 3 then quiz.learners end as quiz_learners,
        case when quiz.learners >= 3 then quiz.attempts end as quiz_attempts,
        case when quiz.learners >= 3 then quiz.passes end as quiz_passes,
        case when quiz.learners >= 3 then quiz.average end as quiz_best_average,
        case when grade.grades >= 3 then grade.grades end as published_grades,
        case when grade.numeric_grades >= 3 then grade.average end as published_grade_average,
        case when assignment.learners >= 3 then assignment.learners end as submission_learners,
        case when assignment.learners >= 3 then assignment.attempts end as submission_attempts,
        case when assignment.released_learners >= 3 then assignment.released end as released_reviews,
        case when competency.learners >= 3 then competency.learners end as competency_learners,
        case when competency.learners >= 3 then competency.decisions end as competency_decisions
      from pages course
      left join quiz_totals quiz on quiz.run_id = course.id
      left join grade_totals grade on grade.run_id = course.id
      left join assignment_totals assignment on assignment.run_id = course.id
      left join competency_totals competency on competency.run_id = course.id
      where p_scope in ('staff', 'personal')
    ), monthly as (
$aggregate$);
  source := replace(source, output_anchor, $output$
      'courses', (select coalesce(jsonb_agg(to_jsonb(pages) order by cohort_date desc, id desc), '[]'::jsonb) from pages)
    ) || case when p_scope in ('staff', 'personal') then jsonb_build_object('assessment', jsonb_build_object(
      'metric_version', 1,
      'minimum_learner_count', 3,
      'courses', (
        select coalesce(jsonb_agg(to_jsonb(assessment) - 'cohort_date' order by cohort_date desc, course_id desc), '[]'::jsonb)
        from assessment
      )
    )) else '{}'::jsonb end
$output$);
  execute source;
end;
$migration$;

notify pgrst, 'reload schema';
commit;
