begin;

create function private.client_lecturer_assignment_history(
  p_client_id uuid,
  p_lecturer_id uuid
) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles client
    join public.user_roles client_role
      on client_role.user_id = client.id and client_role.role = 'client'
    join public.client_organisation_memberships membership
      on membership.user_id = client.id and membership.removed_at is null
    join public.organisations organisation
      on organisation.id = membership.organisation_id and organisation.archived_at is null
    join public.course_runs run on run.organisation_id = organisation.id
    join public.jobs job on job.course_run_id = run.id
    join public.job_claims claim on claim.job_id = job.id
      and claim.lecturer_id = p_lecturer_id
      and claim.status in ('confirmed', 'cancelled')
    join public.profiles lecturer on lecturer.id = claim.lecturer_id and lecturer.active
    join public.user_roles lecturer_role on lecturer_role.user_id = lecturer.id
      and lecturer_role.role in ('lecturer', 'senior_lecturer')
    where client.id = p_client_id and client.active
  );
$$;

revoke all on function private.client_lecturer_assignment_history(uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function private.can_read_person(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.actor_active() and (
    p_user_id = auth.uid()
    or (
      private.profile_staff(p_user_id)
      and private.profile_staff(auth.uid())
    )
    or (
      private.has_role(array['client'])
      and private.client_lecturer_assignment_history(auth.uid(), p_user_id)
      and exists (
        select 1
        from public.job_claims claim
        join public.jobs job on job.id = claim.job_id
        join public.course_runs run on run.id = job.course_run_id
        where claim.lecturer_id = p_user_id
          and claim.status in ('confirmed', 'cancelled')
          and private.can_read_profile_course(p_user_id, run.id)
      )
    )
  );
$$;

create or replace function private.can_chat_contact(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.actor_active()
    and p_user_id <> auth.uid()
    and exists (
      select 1
      from public.profiles profile
      join public.user_roles role on role.user_id = profile.id
      where profile.id = p_user_id
        and profile.active
        and role.role in ('admin', 'owner', 'management', 'senior_lecturer', 'lecturer', 'participant', 'client')
    )
    and (
      (private.chat_staff(auth.uid()) and private.chat_staff(p_user_id))
      or (
        private.has_role(array['client'])
        and private.client_lecturer_assignment_history(auth.uid(), p_user_id)
      )
      or (
        private.has_role(array['lecturer', 'senior_lecturer'])
        and private.client_lecturer_assignment_history(p_user_id, auth.uid())
      )
      or (
        not private.has_role(array['client'])
        and not exists (
          select 1 from public.user_roles peer_role
          where peer_role.user_id = p_user_id and peer_role.role = 'client'
        )
        and exists (
          select 1
          from public.chat_members actor_member
          join public.chat_members peer_member on peer_member.room_id = actor_member.room_id
          join public.chat_rooms room on room.id = actor_member.room_id
          where actor_member.user_id = auth.uid()
            and peer_member.user_id = p_user_id
            and actor_member.removed_at is null
            and peer_member.removed_at is null
            and room.kind = 'participant_course'
        )
      )
    );
$$;

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
      and (
        room.kind <> 'dm' or exists (
          select 1
          from public.chat_members peer
          where peer.room_id = room.id
            and peer.user_id <> auth.uid()
            and peer.removed_at is null
            and private.can_chat_contact(peer.user_id)
        )
      )
  );
$$;

commit;