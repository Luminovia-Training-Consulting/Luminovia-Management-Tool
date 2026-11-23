begin;

-- The lounge update broadened the general room roles and replaced this
-- helper. Restore the existing lecturer restrictions for company rooms
-- while preserving the lounge, membership and independent-role checks.
create or replace function private.can_access_chat_room(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.chat_members member
    join public.chat_rooms room on room.id = member.room_id
    left join public.course_runs run on run.id = room.course_run_id
    where member.room_id = p_room_id
      and member.user_id = auth.uid()
      and member.removed_at is null
      and case when room.kind = 'participant_course' then
        run.archived_at is null and private.company_premium_enabled(run.organisation_id)
        and (
          (private.participant_actor() and private.active_company_participant(auth.uid(), run.organisation_id) and exists (
            select 1 from public.course_enrolments enrolment
            where enrolment.course_run_id = run.id and enrolment.user_id = auth.uid()
              and enrolment.status in ('enrolled', 'completed')
          )) or (private.actor_active() and (
            private.has_permission('courses.manage') or
            private.client_has_organisation(run.organisation_id) or
            (private.lecturer_actor() and not private.course_lecturer_blocked(run.id, auth.uid()) and exists (
              select 1 from public.job_claims claim join public.jobs job on job.id = claim.job_id
              where job.course_run_id = run.id and claim.lecturer_id = auth.uid()
                and claim.status = 'confirmed'
            ))
          ))
        )
        else private.actor_active() and (
          room.job_id is null or private.has_permission('jobs.manage')
          or not private.job_lecturer_blocked(room.job_id, auth.uid())
        ) end
      and (
        room.kind not in ('general', 'topic', 'lecturer_course') or
        (room.kind = 'general' and private.has_role(array['owner', 'admin', 'lecturer', 'senior_lecturer'])) or
        (room.kind in ('topic', 'lecturer_course') and private.chat_staff(auth.uid()))
      )
  );
$$;

commit;
