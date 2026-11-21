begin;

-- Preserve the own-account endpoints when the scoped course-chat paths are added.
create or replace function private.require_portal_access()
returns void language plpgsql stable security definer set search_path = ''
as $$
declare path text := coalesce(current_setting('request.path', true), '');
begin
  if current_setting('role', true) is distinct from 'authenticated' then return; end if;
  if private.actor_active() then return; end if;
  if private.guest_actor() and path in (
    '/profiles', '/user_roles', '/rpc/portal_access', '/rpc/get_my_permissions',
    '/rpc/account_me', '/rpc/save_account_profile', '/rpc/ui_preferences', '/rpc/save_ui_preferences',
    '/rpc/account_username', '/rpc/save_account_username'
  ) then return; end if;
  if private.participant_actor() and path in (
    '/profiles', '/user_roles', '/rpc/portal_access', '/rpc/get_my_permissions',
    '/rpc/ui_preferences', '/rpc/save_ui_preferences', '/rpc/my_course_workspaces',
    '/rpc/course_workspace', '/rpc/course_workspace_action', '/rpc/course_document_access',
    '/rpc/cancel_own_course_enrolment', '/rpc/course_operation_destinations',
    '/rpc/my_company_participant_invitations', '/rpc/accept_company_participant_invitation',
    '/rpc/unified_search', '/rpc/course_welcome_content',
    '/rpc/account_username', '/rpc/save_account_username',
    '/rpc/course_chat_rooms', '/rpc/course_chat_messages', '/rpc/send_course_chat_message'
  ) then return; end if;
  raise exception 'Operational portal access required' using errcode = '42501';
end;
$$;

revoke all on function private.sync_legacy_attendance_register() from public, anon, authenticated, service_role;

-- Administrative inspection is an explicit, audited read of one company's
-- participant course discussion, even when the company's Premium is paused.
-- Personal conversations and other group types never enter this projection.
create function private.inspect_company_course_chat(
  p_organisation_id uuid, p_run_id uuid, p_reason text,
  p_before_at timestamptz, p_before_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  items jsonb;
begin
  if not private.is_company_premium_admin() or not exists (
    select 1 from public.course_runs r where r.id=p_run_id and r.organisation_id=p_organisation_id
  ) then raise insufficient_privilege; end if;
  if p_reason is null or char_length(btrim(p_reason)) not between 8 and 300
    or ((p_before_at is null) <> (p_before_id is null))
    or (p_before_at is not null and not isfinite(p_before_at))
  then raise exception 'Invalid inspection purpose or cursor' using errcode='22023'; end if;

  select coalesce(jsonb_agg(to_jsonb(page) order by page.created_at desc,page.id desc), '[]'::jsonb)
  into items
  from (
    select m.id, m.created_at, p.display_name as sender_name, r.title as room_title, m.body
    from public.messages m join public.profiles p on p.id=m.sender_id
    join public.chat_rooms r on r.id=m.room_id
    where r.course_run_id=p_run_id and r.kind='participant_course'
      and m.deleted_at is null and m.body <> ''
      and (p_before_at is null or (m.created_at,m.id)<(p_before_at,p_before_id))
    order by m.created_at desc,m.id desc
    limit 51
  ) page;

  insert into public.audit_events(actor_id,action,resource_id,details)
    values(auth.uid(),'course.chat_inspected',p_run_id,jsonb_build_object(
      'organisation_id',p_organisation_id,'purpose',btrim(p_reason),
      'premium_enabled',private.company_premium_enabled(p_organisation_id),
      'returned_count',least(jsonb_array_length(items),50)
    ));
  return jsonb_build_object(
    'items',case when jsonb_array_length(items)>50 then items-50 else items end,
    'next_cursor',case when jsonb_array_length(items)>50 then jsonb_build_object(
      'at',items->49->>'created_at','id',items->49->>'id'
    ) end
  );
end;
$$;

create function public.inspect_company_course_chat(
  p_organisation_id uuid, p_run_id uuid, p_reason text,
  p_before_at timestamptz, p_before_id uuid
)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.inspect_company_course_chat(
    p_organisation_id,p_run_id,p_reason,p_before_at,p_before_id
  );
$$;

revoke all on function private.inspect_company_course_chat(uuid,uuid,text,timestamptz,uuid),
  public.inspect_company_course_chat(uuid,uuid,text,timestamptz,uuid)
from public,anon,authenticated,service_role;
grant execute on function private.inspect_company_course_chat(uuid,uuid,text,timestamptz,uuid),
  public.inspect_company_course_chat(uuid,uuid,text,timestamptz,uuid) to authenticated;

alter function private.admin_audit_actions() rename to admin_audit_actions_before_premium;
create function private.admin_audit_actions() returns text[]
language sql immutable set search_path = '' as $$
  select private.admin_audit_actions_before_premium() || array[
    'course.chat_inspected','company.premium.updated','company.premium.unchanged','company.premium.conflict',
    'company.premium_retained_data_viewed','integration.created','integration.rotated','integration.revoked'
  ];
$$;
revoke all on function private.admin_audit_actions() from public,anon,authenticated,service_role;

commit;
