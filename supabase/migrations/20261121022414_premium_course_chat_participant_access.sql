begin;

-- Restored participants enter only these course-specific endpoints. The
-- operational chat directory, private DMs, file uploads and group management
-- stay outside their REST pre-request allowlist.
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
    '/rpc/unified_search', '/rpc/course_welcome_content',
    '/rpc/course_chat_rooms', '/rpc/course_chat_messages', '/rpc/send_course_chat_message'
  ) then return; end if;
  raise exception 'Operational portal access required' using errcode = '42501';
end;
$$;

-- Creating a participant course room now grants all currently eligible
-- learners and confirmed lecturers. The existing room creator still validates
-- the course/job and manually selected members before this wrapper runs.
create or replace function private.create_chat_group(
  p_title text, p_member_ids uuid[], p_kind text default 'topic', p_job_id uuid default null
) returns uuid language plpgsql security definer set search_path = ''
as $$
declare result uuid; run_id uuid; member_id uuid;
begin
  if p_kind = 'participant_course' then
    select job.course_run_id into run_id
      from public.jobs job where job.id = p_job_id;
    perform private.lock_course_premium(run_id);
  end if;
  result := private.create_chat_group_before_origins(p_title, p_member_ids, p_kind, p_job_id);
  if p_kind = 'participant_course' then
    insert into private.participant_chat_origins(room_id, user_id, manual)
      select room_id, user_id, true from public.chat_members
      where room_id = result and removed_at is null;
    select course_run_id into run_id from public.chat_rooms where id = result for update;
    for member_id in
      select enrolment.user_id from public.course_enrolments enrolment
      join public.course_runs run on run.id = enrolment.course_run_id
      where enrolment.course_run_id = run_id and enrolment.status in ('enrolled', 'completed')
        and private.active_company_participant(enrolment.user_id, run.organisation_id)
      union
      select claim.lecturer_id from public.job_claims claim
      join public.jobs job on job.id = claim.job_id
      where job.course_run_id = run_id and claim.status = 'confirmed'
        and private.profile_staff(claim.lecturer_id)
      order by 1
    loop
      perform private.participant_chat_assignment_grant(result, member_id);
      insert into public.chat_members(room_id, user_id) values(result, member_id)
      on conflict(room_id, user_id) do update
        set removed_at = null, joined_at = clock_timestamp();
    end loop;
  end if;
  return result;
end;
$$;

-- The company enrolment implementation superseded the older origin wrapper.
-- Restore automatic member creation without bypassing its Premium, company or
-- target-role checks. Releasing a known assignment-origin row remains atomic;
-- historical/explicit memberships keep their provenance but lose access via
-- the current enrolment predicate immediately.
alter function private.manage_course_enrolment(uuid, uuid, text)
  rename to manage_course_enrolment_before_chat_autosync;
revoke all on function private.manage_course_enrolment_before_chat_autosync(uuid, uuid, text)
  from public, anon, authenticated, service_role;
create function private.manage_course_enrolment(
  p_course_run_id uuid, p_user_id uuid, p_status text
) returns void language plpgsql security definer set search_path = ''
as $$
declare room record; organisation_id uuid;
begin
  perform private.manage_course_enrolment_before_chat_autosync(
    p_course_run_id, p_user_id, p_status
  );
  select run.organisation_id into organisation_id
    from public.course_runs run where run.id = p_course_run_id;
  for room in
    select id from public.chat_rooms
    where course_run_id = p_course_run_id and kind = 'participant_course'
    order by id for update
  loop
    if p_status in ('enrolled', 'completed') and
       private.active_company_participant(p_user_id, organisation_id) then
      perform private.participant_chat_assignment_grant(room.id, p_user_id);
      insert into public.chat_members(room_id, user_id) values(room.id, p_user_id)
      on conflict(room_id, user_id) do update
        set removed_at = null, joined_at = clock_timestamp();
    elsif p_status = 'removed' and exists (
      select 1 from private.participant_chat_origins origin
      where origin.room_id = room.id and origin.user_id = p_user_id
        and origin.assignment and not origin.unknown
    ) then
      perform private.participant_chat_assignment_release(
        room.id, p_user_id, p_course_run_id
      );
    end if;
  end loop;
end;
$$;
revoke all on function private.manage_course_enrolment(uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function private.manage_course_enrolment(uuid, uuid, text)
  to authenticated;
create or replace function public.manage_course_enrolment(
  p_course_run_id uuid, p_user_id uuid, p_status text
) returns void language sql security invoker set search_path = ''
as $$ select private.manage_course_enrolment(p_course_run_id, p_user_id, p_status); $$;

-- One course's participant channels, with no DM/group directory metadata.
create function private.course_chat_rooms(p_run_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare context jsonb;
begin
  context := private.course_workspace_context(p_run_id);
  if not coalesce((context->>'lms_enabled')::boolean, false) then
    raise exception 'company_premium_lms_off' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', room.id, 'title', room.title)
      order by room.title, room.id)
    from public.chat_rooms room
    where room.course_run_id = p_run_id and room.kind = 'participant_course'
      and private.can_access_chat_room(room.id)
  ), '[]'::jsonb);
end;
$$;

-- Reuse the existing hidden-message aware history function, projecting text
-- only. Attachment IDs and private file metadata are deliberately omitted.
create function private.course_chat_messages(
  p_room_id uuid, p_before_at timestamptz default null,
  p_before_id uuid default null, p_limit integer default 50
) returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.chat_rooms room
    where room.id = p_room_id and room.kind = 'participant_course'
      and private.can_access_chat_room(room.id)
  ) then
    raise exception 'Course chat unavailable' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', message.id, 'sender_id', message.sender_id,
      'sender_name', message.sender_name,
      'body', case when message.deleted_at is null then message.body else null end,
      'created_at', message.created_at,
      'deleted_at', message.deleted_at
    ) order by message.created_at, message.id)
    from private.chat_messages(
      p_room_id, p_before_at, p_before_id, '', p_limit
    ) message
  ), '[]'::jsonb);
end;
$$;

-- Text-only course posting preserves the old idempotency/notification logic.
-- No participant file or mention path is opened by this operation.
create function private.send_course_chat_message(
  p_room_id uuid, p_body text, p_client_id uuid
) returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_run_id uuid; v_organisation_id uuid;
begin
  select room.course_run_id into v_run_id from public.chat_rooms room
    where room.id = p_room_id and room.kind = 'participant_course';
  if v_run_id is null then
    raise exception 'Course chat unavailable' using errcode = '42501';
  end if;
  perform private.lock_course_premium(v_run_id);
  select run.organisation_id into v_organisation_id
    from public.course_runs run where run.id = v_run_id;
  if private.participant_actor() then
    perform 1 from private.company_participant_memberships membership
      where membership.organisation_id = v_organisation_id
        and membership.user_id = auth.uid() and membership.status = 'active'
      for share;
    if not found then raise exception 'Course chat unavailable' using errcode = '42501'; end if;
    perform 1 from public.course_enrolments enrolment
      where enrolment.course_run_id = v_run_id and enrolment.user_id = auth.uid()
        and enrolment.status in ('enrolled', 'completed') for share;
    if not found then raise exception 'Course chat unavailable' using errcode = '42501'; end if;
  end if;
  perform 1 from public.chat_rooms where id = p_room_id for share;
  if not private.can_access_chat_room(p_room_id) then
    raise exception 'Course chat unavailable' using errcode = '42501';
  end if;
  return private.send_message(p_room_id, p_body, p_client_id, null);
end;
$$;

create function public.course_chat_rooms(p_run_id uuid)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.course_chat_rooms(p_run_id); $$;
create function public.course_chat_messages(
  p_room_id uuid, p_before_at timestamptz default null,
  p_before_id uuid default null, p_limit integer default 50
) returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.course_chat_messages(p_room_id, p_before_at, p_before_id, p_limit); $$;
create function public.send_course_chat_message(
  p_room_id uuid, p_body text, p_client_id uuid
) returns uuid language sql security invoker set search_path = ''
as $$ select private.send_course_chat_message(p_room_id, p_body, p_client_id); $$;

revoke all on function private.course_chat_rooms(uuid),
  private.course_chat_messages(uuid, timestamptz, uuid, integer),
  private.send_course_chat_message(uuid, text, uuid),
  public.course_chat_rooms(uuid),
  public.course_chat_messages(uuid, timestamptz, uuid, integer),
  public.send_course_chat_message(uuid, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.course_chat_rooms(uuid),
  private.course_chat_messages(uuid, timestamptz, uuid, integer),
  private.send_course_chat_message(uuid, text, uuid),
  public.course_chat_rooms(uuid),
  public.course_chat_messages(uuid, timestamptz, uuid, integer),
  public.send_course_chat_message(uuid, text, uuid)
  to authenticated;

notify pgrst, 'reload schema';
commit;
