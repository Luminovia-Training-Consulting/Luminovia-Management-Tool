begin;

create index company_lecturer_active_blocks_by_lecturer
  on private.company_lecturer_blocks (lecturer_id, organisation_id)
  where blocked;

-- Discovery and offer quotes can check many jobs for the same instructor.
-- Skip the job relationships when this instructor has no active restriction.
create or replace function private.job_lecturer_blocked(p_job_id uuid, p_lecturer_id uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select case when exists (
    select 1 from private.company_lecturer_blocks restriction
    where restriction.lecturer_id = p_lecturer_id and restriction.blocked
  ) then exists (
    select 1 from public.jobs job where job.id = p_job_id
      and private.course_lecturer_blocked(job.course_run_id, p_lecturer_id)
    union all
    select 1 from private.job_commission_offers offer where offer.job_id = p_job_id
      and private.company_lecturer_blocked(offer.organisation_id, p_lecturer_id)
    union all
    select 1 from private.client_course_requests request where request.job_id = p_job_id
      and private.company_lecturer_blocked(request.organisation_id, p_lecturer_id)
  ) else false end;
$$;

commit;
