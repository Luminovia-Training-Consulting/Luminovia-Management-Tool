begin;

-- A published course can be previewed before anyone is assigned. Once a
-- lecturer takes it, the run follows assignment, membership or enrolment.
create or replace function private.can_read_course_run(p_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists (
    select from public.course_runs run where run.id=p_id and (
      private.has_permission('courses.manage')
      or private.client_has_organisation(run.organisation_id)
      or (
        private.lecturer_actor() and (
          private.course_has_current_teacher(run.id)
          or (
            run.published and run.archived_at is null
            and not private.course_lecturer_blocked(run.id,auth.uid())
            and not exists (
              select from public.jobs job join public.job_claims claim on claim.job_id=job.id
              where job.course_run_id=run.id and claim.status='confirmed'
            )
          )
        )
      )
      or (
        run.archived_at is null and private.participant_actor()
        and private.course_lms_read_enabled(run.organisation_id)
        and private.active_company_participant(auth.uid(),run.organisation_id)
        and exists (
          select from public.course_enrolments e
          where e.course_run_id=run.id and e.user_id=auth.uid()
            and e.status in ('enrolled','completed')
        )
      )
    )
  );
$$;

alter policy runs_read on public.course_runs using (private.can_read_course_run(id));
alter policy course_sessions_read on public.course_sessions using (private.can_read_course_run(course_run_id));

-- A former lecturer can still see their own unallocated historical offer, but
-- cannot read another lecturer's now-filled offer through their old claim.
create or replace function private.can_read_job(p_job_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select private.actor_active() and exists (
    select from public.jobs job where job.id=p_job_id and (
      private.has_permission('jobs.manage')
      or (
        private.lecturer_actor() and not private.job_lecturer_blocked(job.id,auth.uid())
        and (
          job.status='published'
          or exists (
            select from public.job_claims own
            where own.job_id=job.id and own.lecturer_id=auth.uid()
              and (own.status='confirmed' or not exists (
                select from public.job_claims active
                where active.job_id=job.id and active.status='confirmed'
              ))
          )
        )
      )
    )
  );
$$;

commit;
