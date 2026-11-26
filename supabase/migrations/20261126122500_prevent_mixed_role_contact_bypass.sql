begin;

-- Staff collaboration is not an alternate grant to company contacts or
-- profiles. A compound account must still use the company relationship.
create function private.is_company_account(p_user_id uuid)
returns boolean language sql stable set search_path = '' as $$
  select exists (select from public.user_roles where user_id = p_user_id and role = 'client');
$$;
revoke all on function private.is_company_account(uuid) from public, anon, authenticated, service_role;

create or replace function private.can_read_person(p_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.actor_active() and (
    p_user_id = auth.uid()
    or case when private.is_company_account(auth.uid()) or private.is_company_account(p_user_id)
      then not private.is_company_account(p_user_id)
        and private.client_lecturer_assignment_history(auth.uid(), p_user_id, true)
      else private.profile_staff(p_user_id) and private.profile_staff(auth.uid())
    end
  );
$$;

-- A retained membership row is not sufficient to start (or keep) a DM
-- based on a shared course. Both peers must still have that course context.
create function private.current_course_chat_peer(p_course_id uuid, p_user_id uuid)
returns boolean language sql stable set search_path = '' as $$
  select exists (
    select from public.course_runs run join public.profiles profile on profile.id = p_user_id and profile.active
    where run.id = p_course_id and run.archived_at is null
      and private.company_premium_enabled(run.organisation_id)
      and (
        (private.active_company_participant(p_user_id, run.organisation_id) and exists (
          select from public.course_enrolments e where e.course_run_id = run.id and e.user_id = p_user_id
            and e.status in ('enrolled','completed')
        )) or (
          private.lecturer_user(p_user_id) and not private.course_lecturer_blocked(run.id, p_user_id) and exists (
            select from public.job_claims claim join public.jobs job on job.id = claim.job_id
            where job.course_run_id = run.id and claim.lecturer_id = p_user_id and claim.status = 'confirmed'
          )
        )
      )
  );
$$;
revoke all on function private.current_course_chat_peer(uuid, uuid) from public, anon, authenticated, service_role;

create or replace function private.can_chat_contact(p_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.actor_active() and p_user_id <> auth.uid() and
    case
      when private.is_company_account(auth.uid()) then
        not private.is_company_account(p_user_id)
        and private.client_lecturer_assignment_history(auth.uid(), p_user_id)
      when private.is_company_account(p_user_id) then
        private.client_lecturer_assignment_history(p_user_id, auth.uid())
      else (private.chat_staff(auth.uid()) and private.chat_staff(p_user_id)) or exists (
        select from public.chat_members actor_member
        join public.chat_members peer_member on peer_member.room_id = actor_member.room_id
        join public.chat_rooms room on room.id = actor_member.room_id and room.kind = 'participant_course'
        where actor_member.user_id = auth.uid() and peer_member.user_id = p_user_id
          and actor_member.removed_at is null and peer_member.removed_at is null
          and private.current_course_chat_peer(room.course_run_id, actor_member.user_id)
          and private.current_course_chat_peer(room.course_run_id, peer_member.user_id)
      )
    end;
$$;

commit;