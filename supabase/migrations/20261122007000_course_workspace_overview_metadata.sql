begin;

-- Add presentation facts to the existing per-actor course projection.
-- The organisation name and next start derive only from authorised course rows.
create or replace function private.my_course_workspaces()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (private.actor_active() or private.participant_actor()) then
    raise exception 'Active account required' using errcode = '42501';
  end if;
  return (
    select coalesce(jsonb_agg(to_jsonb(course) order by course.starts_at desc nulls last, course.id), '[]'::jsonb)
    from (
      select run.id, template.title, template.description, template.syllabus,
        run.time_zone, run.venue, run.delivery_type,
        organisation.name as organisation_name,
        min(session.starts_at) filter (where session.starts_at > statement_timestamp()) as next_start_at,
        private.company_premium_enabled(run.organisation_id) lms_enabled,
        min(session.starts_at) starts_at, max(session.ends_at) ends_at,
        private.company_premium_enabled(run.organisation_id) and
          private.active_company_participant(auth.uid(), run.organisation_id) and exists (
            select 1 from public.course_enrolments enrolment
            where enrolment.course_run_id = run.id and enrolment.user_id = auth.uid()
              and enrolment.status in ('enrolled', 'completed')
          ) participant
      from public.course_runs run
      join public.course_templates template on template.id = run.template_id
      left join public.organisations organisation on organisation.id = run.organisation_id
      left join public.course_sessions session on session.course_run_id = run.id
      where run.archived_at is null and (
        private.has_permission('courses.manage') or
        private.client_has_organisation(run.organisation_id) or
        exists (
          select 1 from public.job_claims claim
          join public.jobs job on job.id = claim.job_id
          where job.course_run_id = run.id
            and claim.lecturer_id = auth.uid()
            and claim.status = 'confirmed'
        ) or (
          private.company_premium_enabled(run.organisation_id) and
          private.active_company_participant(auth.uid(), run.organisation_id) and exists (
            select 1 from public.course_enrolments enrolment
            where enrolment.course_run_id = run.id and enrolment.user_id = auth.uid()
              and enrolment.status in ('enrolled', 'completed')
          )
        )
      )
      group by run.id, template.title, template.description, template.syllabus,
        run.organisation_id, organisation.name
      order by min(session.starts_at) desc nulls last, run.id
      limit 200
    ) course
  );
end;
$$;

commit;
