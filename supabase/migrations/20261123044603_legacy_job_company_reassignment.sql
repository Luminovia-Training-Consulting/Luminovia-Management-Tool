begin;

create or replace function private.job_company_reassignable(p_job_id uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists (
    select 1 from public.jobs job
    join public.course_runs run on run.id = job.course_run_id
    where job.id = p_job_id and job.status in ('draft', 'published')
      and not run.published and run.archived_at is null
      -- Legacy staff offers and the local sample use the same dedicated run
      -- relationship without the modern creation audit event.
      and not exists (select 1 from public.job_sessions where job_id = job.id and starts_at <= now())
      and not exists (select 1 from public.course_sessions where course_run_id = run.id and starts_at <= now())
      and not exists (select 1 from public.job_claims where job_id = job.id)
      and not exists (select 1 from private.job_commission_offers where job_id = job.id)
      and not exists (select 1 from private.client_course_requests where job_id = job.id)
      and not exists (select 1 from public.jobs sibling where sibling.course_run_id = run.id and sibling.id <> job.id)
      and not exists (select 1 from public.course_enrolments where course_run_id = run.id)
      and not exists (select 1 from public.chat_rooms where course_run_id = run.id or job_id = job.id)
      and not exists (select 1 from private.course_class_assignments where course_id = run.id)
      and not exists (select 1 from private.course_workspace_settings where run_id = run.id and contact_id is not null)
      and not exists (select 1 from private.course_resources where run_id = run.id and removed_at is null)
      and not exists (select 1 from private.course_readiness_settings where course_run_id = run.id and meeting_url <> '')
      and not exists (
        select 1 from private.job_briefings briefing where briefing.job_id = job.id
          and concat(briefing.contact_name, briefing.contact_email, briefing.contact_phone, briefing.contact_description) <> ''
      )
  );
$$;

commit;
