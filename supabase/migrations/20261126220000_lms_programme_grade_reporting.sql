BEGIN;

-- A programme report reads the same frozen rounded grade as the course.
-- Programme membership alone never grants access to a course grade.
create function private.learning_program_grade_report(p_program_id uuid, p_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  learner uuid := coalesce(p_user_id, actor);
  company uuid;
  staff_report boolean := learner is distinct from actor;
  report jsonb;
begin
  if p_program_id is null then raise invalid_parameter_value; end if;
  select organisation_id into company from private.learning_programs where id = p_program_id;
  if not found or not coalesce(private.learning_actor() and private.course_lms_read_enabled(company), false) then
    raise insufficient_privilege;
  end if;
  if staff_report and not coalesce(private.actor_active() and private.has_permission('courses.manage'), false) then
    raise insufficient_privilege;
  end if;
  if not coalesce(private.active_company_participant(learner, company), false) or not exists (
    select 1 from private.learning_program_members member
    where member.program_id = p_program_id and member.user_id = learner
  ) then raise insufficient_privilege; end if;

  -- Filter before calling the ordinary course context, which rejects archived
  -- or inaccessible runs. A cancelled course enrolment hides retained facts.
  with enrolled as materialized (
    select module.position, module.title, run.id as course_id, enrolment.user_id
    from private.learning_program_courses module
    join public.course_runs run on run.id = module.course_id
      and run.organisation_id = company and run.published and run.archived_at is null
    join public.course_enrolments enrolment on enrolment.course_run_id = run.id
      and enrolment.user_id = learner and enrolment.status in ('enrolled','completed')
    where module.program_id = p_program_id
  ), scoped as materialized (
    select enrolled.*
    from enrolled
    cross join lateral (select private.course_gradebook_context(enrolled.course_id) as access offset 0) context
    where (context.access->>case when staff_report then 'staff' else 'learner' end)::boolean is true
  ), grades as (
    select scoped.position, scoped.title, scoped.course_id, grade.revision, grade.released_at,
      review.policy_version, (review.snapshot->>'percent')::numeric as percent,
      (review.snapshot->>'passed')::boolean as passed
    from scoped
    cross join lateral (
      select release.revision, release.released_at, release.review_revision
      from private.course_weighted_releases release
      where release.run_id = scoped.course_id and release.user_id = scoped.user_id
      order by release.revision desc limit 1
    ) grade
    join private.course_weighted_reviews review on review.run_id = scoped.course_id
      and review.user_id = scoped.user_id and review.revision = grade.review_revision
  )
  select jsonb_build_object(
    'grade_count', count(*),
    'mean_percent', round(avg(percent), 2),
    'grades', coalesce(jsonb_agg(to_jsonb(grades) order by position), '[]'::jsonb)
  ) into report from grades;
  return report;
end;
$$;

create function public.learning_program_grade_report(p_program_id uuid, p_user_id uuid default null)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.learning_program_grade_report(p_program_id, p_user_id);
$$;

revoke all on function private.learning_program_grade_report(uuid, uuid),
  public.learning_program_grade_report(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function private.learning_program_grade_report(uuid, uuid),
  public.learning_program_grade_report(uuid, uuid) to authenticated;

-- The same read gates admit currently licensed learners. The programme detail
-- exposes the staff button only to actors who can look up another learner.
do $$
declare
  reader text := pg_get_functiondef('private.learning_programs(uuid,uuid,text)'::regprocedure);
  internal_gate text := pg_get_functiondef('private.require_portal_access()'::regprocedure);
  academy_gate text := pg_get_functiondef('private.require_academy_course_access()'::regprocedure);
  reader_anchor constant text := '''manage'', manager,';
  internal_anchor constant text := '  perform private.require_portal_access_before_course_content();';
  academy_anchor constant text := '''/rpc/learning_program_class_progress''';
begin
  if cardinality(string_to_array(reader, reader_anchor)) <> 2
     or cardinality(string_to_array(internal_gate, internal_anchor)) <> 2
     or cardinality(string_to_array(academy_gate, academy_anchor)) <> 2 then
    raise exception 'Expected current programme projection and licence boundaries';
  end if;
  execute replace(reader, reader_anchor, reader_anchor ||
    ' ''can_read_grades'', manager and private.has_permission(''courses.manage''),');
  execute replace(internal_gate, internal_anchor, $gate$
  if (select installation.edition from private.installation_identity installation) = 'internal'
     and current_setting('role',true) = 'authenticated' and private.participant_actor()
     and current_setting('request.method',true) in ('GET','HEAD','POST')
     and current_setting('request.path',true) = '/rpc/learning_program_grade_report'
  then return; end if;
$gate$ || internal_anchor);
  execute replace(academy_gate, academy_anchor,
    academy_anchor || ', ''/rpc/learning_program_grade_report''');
end;
$$;

notify pgrst, 'reload schema';
COMMIT;
