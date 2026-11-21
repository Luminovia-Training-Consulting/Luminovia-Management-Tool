begin;

-- Search already restricts participant actors to the `courses` and `chats`
-- filters and applies the current per-resource Premium entitlement. Admit that
-- single RPC through the REST pre-request boundary without admitting the other
-- search domains or the operational API.
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
    '/rpc/my_company_participant_invitations', '/rpc/accept_company_participant_invitation',
    '/rpc/unified_search', '/rpc/course_welcome_content'
  ) then return; end if;
  raise exception 'Operational portal access required' using errcode = '42501';
end;
$$;

-- A roster read is a snapshot query. Its old row-lock call attempted SELECT
-- FOR UPDATE from this STABLE function and failed for an authorized company
-- contact. The current company entitlement is checked in the same snapshot;
-- write paths retain the row lock that serializes them with the OFF switch.
create or replace function private.course_enrolments(p_course_run_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare context jsonb;
begin
  context := private.course_workspace_context(p_course_run_id);
  if not coalesce((context->>'lms_enabled')::boolean, false) or not (
    coalesce((context->>'manager')::boolean, false) or
    coalesce((context->>'client')::boolean, false)
  ) then
    raise exception 'Course enrolment roster access required' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'user_id', enrolment.user_id,
      'display_name', profile.display_name,
      'status', enrolment.status,
      'updated_at', enrolment.updated_at
    ) order by profile.display_name)
    from public.course_enrolments enrolment
    join public.profiles profile on profile.id = enrolment.user_id
    where enrolment.course_run_id = p_course_run_id
  ), '[]'::jsonb);
end;
$$;

notify pgrst, 'reload schema';
commit;
