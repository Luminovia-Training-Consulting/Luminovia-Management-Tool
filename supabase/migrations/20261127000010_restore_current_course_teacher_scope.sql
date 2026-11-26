begin;

-- Keep the confirmed allocation as history when the instructor loses teaching
-- access. The workspace list and the LTI roster both use this current scope.
create or replace function private.course_has_current_teacher(p_course_id uuid, p_instructor uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select case
    when (select edition from private.installation_identity) = 'internal' then
      private.lecturer_user(p_instructor)
      and not private.course_lecturer_blocked(p_course_id, p_instructor)
      and exists (
        select 1 from public.job_claims claim
        join public.jobs job on job.id = claim.job_id
        where job.course_run_id = p_course_id and claim.lecturer_id = p_instructor
          and claim.status = 'confirmed'
      )
    else private.academy_course_teacher(p_course_id, p_instructor)
  end;
$$;

commit;
