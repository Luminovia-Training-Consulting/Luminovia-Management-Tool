begin;

-- Explicit learner actions also work for a mixed-role account. The existing
-- participant-only predicate still selects the restricted entry and API lane.
create function private.current_learner_identity()
returns boolean language sql stable security definer set search_path = '' as $$
  select (private.actor_active() or private.participant_actor())
    and exists (select 1 from auth.users identity where identity.id = auth.uid() and identity.email_confirmed_at is not null)
    and exists (select 1 from public.user_roles role where role.user_id = auth.uid() and role.role = 'participant');
$$;
revoke all on function private.current_learner_identity() from public, anon, authenticated, service_role;

-- Company membership and participant consent are independent grants. Neither
-- follows from adding a role. Keep the current role management hierarchy.
do $migration$
declare
  patch record;
  source text;
  assignable_roles constant text := '''admin'',''management'',''senior_lecturer'',''lecturer'',''client'',''guest''';
  separate_accounts constant text := $before$ if p_roles&&array['client'] and p_roles&&array['management','lecturer','senior_lecturer'] and not p_roles&&array['admin','owner'] then raise exception 'Client and staff roles require separate accounts' using errcode='22023';end if;
$before$;
  participant_only_target constant text := $before$    and not exists (
      select 1 from public.user_roles role
      where role.user_id = profile.id and role.role <> 'participant'
    )
$before$;
  participant_only_remove constant text := $before$) or exists (
    select 1 from public.user_roles role
    where role.user_id = p_user_id and role.role <> 'participant'
  ) then$before$;
begin
  for patch in select * from (values
    ('private.account_assignable_role(text,uuid)'::regprocedure, assignable_roles, replace(assignable_roles, '''guest''', '''participant'',''guest''')),
    ('private.account_role_catalog()'::regprocedure, assignable_roles, replace(assignable_roles, '''guest''', '''participant'',''guest''')),
    ('private.set_account_roles(uuid,text[])'::regprocedure, separate_accounts, ''),
    ('private.reserve_company_participant_link(uuid,text,uuid)'::regprocedure, participant_only_target, ''),
    ('private.request_company_participant_link(uuid,text,uuid)'::regprocedure, participant_only_target, ''),
    ('private.remove_company_participant(uuid,uuid,integer,uuid)'::regprocedure, participant_only_remove, ') then'),
    ('private.my_company_participant_invitations()'::regprocedure, 'private.participant_actor()', 'private.current_learner_identity()'),
    ('private.accept_company_participant_invitation(uuid,integer,uuid)'::regprocedure, 'private.participant_actor()', 'private.current_learner_identity()'),
    ('private.cancel_own_course_enrolment(uuid)'::regprocedure, 'private.participant_actor()', 'private.current_learner_identity()'),
    ('private.course_withdrawal_window(uuid)'::regprocedure, 'private.participant_actor()', 'private.current_learner_identity()'),
    ('private.can_access_chat_room(uuid)'::regprocedure, 'private.participant_actor()', 'private.current_learner_identity()'),
    ('private.course_review_actor_allowed(uuid)'::regprocedure, 'private.participant_actor()', 'private.current_learner_identity()')
  ) as patches(routine, anchor, replacement) loop
    source := pg_get_functiondef(patch.routine);
    if cardinality(string_to_array(source, patch.anchor)) <> 2 then
      raise exception 'Expected exactly one role boundary in %', patch.routine;
    end if;
    execute replace(source, patch.anchor, patch.replacement);
  end loop;
end;
$migration$;

-- Keep historical assignments without projecting them as current teaching access.
create or replace function private.course_has_current_teacher(p_course_id uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select case when (select edition from private.installation_identity) = 'internal'
    then private.lecturer_user(auth.uid()) and exists (
      select 1 from public.job_claims claim
      join public.jobs job on job.id = claim.job_id
      where job.course_run_id = p_course_id and claim.lecturer_id = auth.uid() and claim.status = 'confirmed'
    )
    else private.academy_course_teacher(p_course_id, auth.uid())
  end;
$$;

-- Lock the records for either qualifying role before the current check.
create or replace function private.lock_course_reviewer(p_run_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare company_id uuid;
begin
  if not private.course_review_actor_allowed(p_run_id) then
    raise exception 'Company membership or completed enrolment required' using errcode = '42501';
  end if;
  perform private.lock_course_premium(p_run_id);
  select organisation_id into company_id from public.course_runs where id = p_run_id;
  perform 1 from public.profiles where id = auth.uid() and active for share;
  perform 1 from public.client_organisation_memberships
    where organisation_id = company_id and user_id = auth.uid() and removed_at is null for share;
  if private.current_learner_identity() then
    perform 1 from private.company_participant_memberships
      where organisation_id = company_id and user_id = auth.uid() and status = 'active' for share;
    perform 1 from public.course_enrolments
      where course_run_id = p_run_id and user_id = auth.uid() and status = 'completed' for share;
  end if;
  if not private.course_review_actor_allowed(p_run_id) then
    raise exception 'Company membership or completed enrolment required' using errcode = '42501';
  end if;
end;
$$;

create or replace function private.lock_course_chat_poster(p_room_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare run_id uuid; company_id uuid;
begin
  select course_run_id into run_id from public.chat_rooms where id = p_room_id and kind = 'participant_course';
  if run_id is null then raise insufficient_privilege; end if;
  perform private.lock_course_premium(run_id);
  if private.current_learner_identity() then
    select organisation_id into company_id from public.course_runs where id = run_id;
    perform 1 from private.company_participant_memberships
      where organisation_id = company_id and user_id = auth.uid() and status = 'active' for share;
    perform 1 from public.course_enrolments
      where course_run_id = run_id and user_id = auth.uid() and status in ('enrolled', 'completed') for share;
  end if;
  perform 1 from public.chat_rooms
    where id = p_room_id and course_run_id = run_id and kind = 'participant_course' for share;
  if not found then raise insufficient_privilege; end if;
  perform 1 from public.chat_members
    where room_id = p_room_id and user_id = auth.uid() and removed_at is null for share;
  if not found or not private.can_access_chat_room(p_room_id) then raise insufficient_privilege; end if;
end;
$$;

notify pgrst, 'reload schema';
commit;
