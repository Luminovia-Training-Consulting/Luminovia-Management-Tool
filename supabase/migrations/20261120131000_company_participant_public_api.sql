begin;

-- Admit verified standalone participants to a closed set of learner endpoints
-- without making them operational actors or broadening the guest allowlist.
create or replace function public.portal_access()
returns boolean language sql stable security invoker set search_path = ''
as $$ select private.actor_active() or private.guest_actor() or private.participant_actor(); $$;

create or replace function private.require_portal_access()
returns void language plpgsql stable security definer set search_path = ''
as $$
declare path text := coalesce(current_setting('request.path', true), '');
begin
  if current_setting('role', true) is distinct from 'authenticated' then return; end if;
  if private.actor_active() then return; end if;
  if private.guest_actor() and path in (
    '/profiles', '/user_roles', '/rpc/portal_access', '/rpc/get_my_permissions',
    '/rpc/account_me', '/rpc/save_account_profile', '/rpc/ui_preferences', '/rpc/save_ui_preferences'
  ) then return; end if;
  if private.participant_actor() and path in (
    '/profiles', '/user_roles', '/rpc/portal_access', '/rpc/get_my_permissions',
    '/rpc/ui_preferences', '/rpc/save_ui_preferences', '/rpc/my_course_workspaces',
    '/rpc/course_workspace', '/rpc/course_workspace_action', '/rpc/course_document_access',
    '/rpc/cancel_own_course_enrolment', '/rpc/course_operation_destinations',
    '/rpc/my_company_participant_invitations', '/rpc/accept_company_participant_invitation'
  ) then return; end if;
  raise exception 'Operational portal access required' using errcode = '42501';
end;
$$;

-- Permit the Shell to read only the learner's own identity and role, not to
-- edit the row or query operational relations as a participant.
alter policy portal_members_only on public.profiles using (
  (select private.actor_active()) or
  (((select private.guest_actor()) or (select private.participant_actor())) and id = (select auth.uid()))
);
alter policy portal_members_only on public.user_roles using (
  (select private.actor_active()) or
  (((select private.guest_actor()) or (select private.participant_actor())) and user_id = (select auth.uid()))
);
create policy participant_own_profile_read on public.profiles for select to authenticated
  using ((select private.participant_actor()) and id = (select auth.uid()));
create policy participant_own_role_read on public.user_roles for select to authenticated
  using ((select private.participant_actor()) and user_id = (select auth.uid()));

-- Safe current entitlement projection for a staff actor or the company's own
-- contact; it contains no participant lookup or account-existence result.
create function private.company_participant_access(p_organisation_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.actor_active() or p_organisation_id is null or not (
    private.client_has_organisation(p_organisation_id) or
    private.has_permission('courses.manage')
  ) then
    raise exception 'Company participant management required' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'organisation_id', p_organisation_id,
    'premium_enabled', private.company_premium_enabled(p_organisation_id)
  );
end;
$$;

create function public.company_participant_access(p_organisation_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$ select private.company_participant_access(p_organisation_id); $$;

-- Selected course-run detail may reveal only whether its LMS link is usable;
-- the actor must already have base access to that course.
create function private.course_workspace_entitlement(p_run_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  context jsonb;
begin
  context := private.course_workspace_context(p_run_id);
  return jsonb_build_object(
    'lms_enabled', coalesce((context->>'lms_enabled')::boolean, false)
  );
end;
$$;
create function public.course_workspace_entitlement(p_run_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$ select private.course_workspace_entitlement(p_run_id); $$;

-- Expose only scoped participant association operations. Account invitation
-- payloads and the service-only Auth delivery claim remain separate contracts.
create function public.company_participants(p_organisation_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$ select private.company_participants(p_organisation_id); $$;

create function public.my_company_participant_invitations()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$ select private.my_company_participant_invitations(); $$;

create function public.request_company_participant_link(
  p_organisation_id uuid, p_luminovia_user_id text, p_request_id uuid
) returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.request_company_participant_link(p_organisation_id, p_luminovia_user_id, p_request_id); $$;

create function public.accept_company_participant_invitation(
  p_organisation_id uuid, p_expected_version integer, p_request_id uuid
) returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.accept_company_participant_invitation(p_organisation_id, p_expected_version, p_request_id); $$;

create function public.remove_company_participant(
  p_organisation_id uuid, p_user_id uuid,
  p_expected_version integer, p_request_id uuid
) returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.remove_company_participant(p_organisation_id, p_user_id, p_expected_version, p_request_id); $$;

create function public.reserve_company_participant_invitation(
  p_organisation_id uuid, p_email text, p_display_name text, p_request_id uuid
) returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.reserve_company_participant_invitation(
    p_organisation_id, p_email, p_display_name, p_request_id
  );
$$;

create function public.claim_company_participant_invitation(p_request_id uuid)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.claim_company_participant_invitation(p_request_id); $$;

create function public.finish_company_participant_invitation(
  p_request_id uuid, p_success boolean
) returns void
language sql
security invoker
set search_path = ''
as $$ select private.finish_company_participant_invitation(p_request_id, p_success); $$;

-- Rebind both existing service entry points to the role-preserving dispatcher.
create or replace function public.complete_account_invitation(
  p_invitation_id uuid, p_user_id uuid, p_display_name text, p_success boolean
) returns void language sql security invoker set search_path = ''
as $$ select private.complete_account_invitation(p_invitation_id, p_user_id, p_display_name, p_success); $$;

create or replace function private.complete_invitation(
  p_invitation_id uuid, p_user_id uuid, p_display_name text, p_success boolean
) returns void language sql security invoker set search_path = ''
as $$ select private.complete_account_invitation(p_invitation_id, p_user_id, p_display_name, p_success); $$;

revoke all on function private.company_participants(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.company_participant_access(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.course_workspace_entitlement(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.my_company_participant_invitations()
  from public, anon, authenticated, service_role;
revoke all on function private.request_company_participant_link(uuid, text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.accept_company_participant_invitation(uuid, integer, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.remove_company_participant(uuid, uuid, integer, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.reserve_company_participant_invitation(uuid, text, text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.claim_company_participant_invitation(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.finish_company_participant_invitation(uuid, boolean)
  from public, anon, authenticated, service_role;
revoke all on function private.complete_account_invitation(uuid, uuid, text, boolean)
  from public, anon, authenticated, service_role;

grant execute on function private.company_participants(uuid) to authenticated;
grant execute on function private.company_participant_access(uuid) to authenticated;
grant execute on function private.course_workspace_entitlement(uuid) to authenticated;
grant execute on function private.my_company_participant_invitations() to authenticated;
grant execute on function private.request_company_participant_link(uuid, text, uuid)
  to authenticated;
grant execute on function private.accept_company_participant_invitation(uuid, integer, uuid)
  to authenticated;
grant execute on function private.remove_company_participant(uuid, uuid, integer, uuid)
  to authenticated;
grant execute on function private.reserve_company_participant_invitation(uuid, text, text, uuid)
  to authenticated;
grant execute on function private.claim_company_participant_invitation(uuid) to service_role;
grant execute on function private.finish_company_participant_invitation(uuid, boolean)
  to service_role;
grant execute on function private.complete_account_invitation(uuid, uuid, text, boolean)
  to service_role;

revoke all on function public.company_participants(uuid) from public, anon;
revoke all on function public.company_participant_access(uuid) from public, anon;
revoke all on function public.course_workspace_entitlement(uuid) from public, anon;
revoke all on function public.my_company_participant_invitations() from public, anon;
revoke all on function public.request_company_participant_link(uuid, text, uuid)
  from public, anon;
revoke all on function public.accept_company_participant_invitation(uuid, integer, uuid)
  from public, anon;
revoke all on function public.remove_company_participant(uuid, uuid, integer, uuid)
  from public, anon;
revoke all on function public.reserve_company_participant_invitation(uuid, text, text, uuid)
  from public, anon;
revoke all on function public.claim_company_participant_invitation(uuid)
  from public, anon, authenticated;
revoke all on function public.finish_company_participant_invitation(uuid, boolean)
  from public, anon, authenticated;

grant execute on function public.company_participants(uuid) to authenticated;
grant execute on function public.company_participant_access(uuid) to authenticated;
grant execute on function public.course_workspace_entitlement(uuid) to authenticated;
grant execute on function public.my_company_participant_invitations() to authenticated;
grant execute on function public.request_company_participant_link(uuid, text, uuid)
  to authenticated;
grant execute on function public.accept_company_participant_invitation(uuid, integer, uuid)
  to authenticated;
grant execute on function public.remove_company_participant(uuid, uuid, integer, uuid)
  to authenticated;
grant execute on function public.reserve_company_participant_invitation(uuid, text, text, uuid)
  to authenticated;
grant execute on function public.claim_company_participant_invitation(uuid) to service_role;
grant execute on function public.finish_company_participant_invitation(uuid, boolean)
  to service_role;

notify pgrst, 'reload schema';
commit;