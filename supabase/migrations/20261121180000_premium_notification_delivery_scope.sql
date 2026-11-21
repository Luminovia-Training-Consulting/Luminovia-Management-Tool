begin;

-- Reuse the existing course notification's resource-specific checks while
-- admitting verified participant-only learners. The course context and live
-- company Premium flag still decide each individual target.
do $$
declare body text;
begin
  select prosrc into strict body from pg_catalog.pg_proc
  where oid = 'private.course_notification_target(text,uuid)'::regprocedure;
  if strpos(body, 'if not private.actor_active() then') = 0 then
    raise exception 'Unexpected course notification actor guard';
  end if;
  body := replace(body, 'if not private.actor_active() then',
    'if not private.learning_actor() then');
  execute format(
    'create or replace function private.course_notification_target(p_kind text,p_resource uuid) returns jsonb language plpgsql stable security definer set search_path = %L as %L',
    '', body
  );
end;
$$;

-- The operational notification chain remains intact. A participant identity
-- receives only its current course event or participant-course chat target;
-- private DMs and unrelated business notices have no participant destination.
alter function private.notification_target(text, uuid)
  rename to notification_target_before_premium_participant;
revoke all on function private.notification_target_before_premium_participant(text, uuid)
  from public, anon, authenticated, service_role;
create function private.notification_target(p_kind text, p_resource uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare run_id uuid; heading text;
begin
  if private.participant_actor() then
    if left(coalesce(p_kind, ''), 7) = 'course_' then
      return private.course_notification_target(p_kind, p_resource);
    elsif p_kind = 'chat_message' then
      select room.course_run_id, room.title into run_id, heading
      from public.messages message
      join public.chat_rooms room on room.id = message.room_id
      where message.id = p_resource and message.deleted_at is null
        and room.kind = 'participant_course'
        and private.can_access_chat_room(room.id);
      if run_id is not null then
        return jsonb_build_object(
          'href', '/courses/' || run_id || '/workspace#course-chat',
          'title', coalesce(heading, '')
        );
      end if;
    end if;
    return jsonb_build_object('href', null, 'title', '');
  end if;
  return private.notification_target_before_premium_participant(p_kind, p_resource);
end;
$$;
revoke all on function private.notification_target(text, uuid)
  from public, anon, authenticated, service_role;

-- Every delivery path calls this helper at dispatch. Previously the three
-- unconditional operational kinds returned true even for participant-only
-- identities. Only a current course/chat target may leave the system for one.
create or replace function private.notification_delivery_allowed(
  p_user uuid, p_kind text, p_resource uuid
) returns boolean language plpgsql volatile security definer set search_path = ''
as $$
declare
  previous_claims text := current_setting('request.jwt.claims', true);
  previous_sub text := current_setting('request.jwt.claim.sub', true);
  participant_only boolean;
  result boolean := false;
begin
  if not exists (select 1 from public.profiles where id = p_user and active) then
    return false;
  end if;
  participant_only := exists (
    select 1 from public.user_roles role
    where role.user_id = p_user and role.role = 'participant'
  ) and not exists (
    select 1 from public.user_roles role
    where role.user_id = p_user and role.role <> 'participant'
  );
  if participant_only and p_kind <> 'chat_message' and
     left(coalesce(p_kind, ''), 7) <> 'course_' then return false; end if;
  if not participant_only and
     p_kind in ('claim_confirmed', 'claim_cancelled', 'contract_available') then
    return true;
  end if;
  if p_kind = 'substitution_closed' then
    return exists (
      select 1 from private.job_substitutions substitution
      join public.job_claims claim on claim.id = substitution.original_claim_id
      where substitution.id = p_resource and
        p_user in (substitution.target_user_id, substitution.proposed_by, claim.lecturer_id)
    );
  end if;
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  begin
    result := (private.notification_target(p_kind, p_resource)->>'href') is not null;
  exception when insufficient_privilege then
    result := false;
  end;
  perform set_config('request.jwt.claim.sub', coalesce(previous_sub, ''), true);
  perform set_config('request.jwt.claims', coalesce(previous_claims, ''), true);
  return result;
exception when others then
  perform set_config('request.jwt.claim.sub', coalesce(previous_sub, ''), true);
  perform set_config('request.jwt.claims', coalesce(previous_claims, ''), true);
  raise;
end;
$$;

create or replace function private.notification_currently_visible(
  p_kind text, p_resource uuid
) returns boolean language sql stable security definer set search_path = ''
as $$
  select case
    when private.participant_actor() then
      (p_kind = 'chat_message' or left(coalesce(p_kind, ''), 7) = 'course_') and
      coalesce((private.notification_target(p_kind, p_resource)->>'href') is not null, false)
    when private.actor_active() then
      case when left(coalesce(p_kind, ''), 7) = 'course_' or p_kind = 'chat_message'
        then coalesce((private.notification_target(p_kind, p_resource)->>'href') is not null, false)
        else true end
    else false
  end;
$$;

-- The existing in-app inbox keeps its paging/DTO, but participant accounts
-- see only currently authorised Premium course/chat receipts.
create or replace function private.notification_inbox(
  p_unread_only boolean default false, p_before_at timestamptz default null,
  p_before_id uuid default null, p_limit integer default 40
) returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare result jsonb; total bigint;
begin
  if not private.learning_actor() then
    raise exception 'Account inactive' using errcode = '42501';
  end if;
  if p_unread_only is null or p_limit is null or p_limit not between 1 and 100 or
     ((p_before_at is null) <> (p_before_id is null)) or
     (p_before_at is not null and not isfinite(p_before_at)) then
    raise exception 'Invalid inbox cursor' using errcode = '22023';
  end if;
  select count(*) into total from public.notifications notification
  where notification.user_id = auth.uid() and notification.read_at is null
    and private.notification_currently_visible(notification.kind, notification.resource_id);
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', notification.id, 'kind', notification.kind,
      'read_at', notification.read_at, 'created_at', notification.created_at
    ) || private.notification_target(notification.kind, notification.resource_id)
    order by notification.created_at desc, notification.id desc
  ), '[]'::jsonb) into result
  from (
    select * from public.notifications notification
    where notification.user_id = auth.uid()
      and (not p_unread_only or notification.read_at is null)
      and (p_before_at is null or
        (notification.created_at, notification.id) < (p_before_at, p_before_id))
      and private.notification_currently_visible(notification.kind, notification.resource_id)
    order by notification.created_at desc, notification.id desc
    limit p_limit
  ) notification;
  return jsonb_build_object('items', result, 'unread_count', total, 'as_of', now());
end;
$$;

-- The public inbox composes its result with attention state. That helper must
-- accept the same learner identity and already counts only visible receipts.
do $$
declare body text;
begin
  select prosrc into strict body from pg_catalog.pg_proc
  where oid = 'private.notification_attention()'::regprocedure;
  if strpos(body, 'if not private.actor_active() then') = 0 then
    raise exception 'Unexpected notification attention actor guard';
  end if;
  body := replace(body, 'if not private.actor_active() then',
    'if not private.learning_actor() then');
  execute format(
    'create or replace function private.notification_attention() returns jsonb language plpgsql stable security definer set search_path = %L as %L',
    '', body
  );
end;
$$;

-- A learner may mark only currently visible receipts. A stale UUID never
-- changes an unrelated or revoked company notification.
create or replace function private.mark_notifications(
  p_ids uuid[] default null, p_all_before timestamptz default null,
  p_read boolean default true
) returns integer language plpgsql security definer set search_path = ''
as $$
declare result integer; participant_only boolean;
begin
  if not private.learning_actor() then
    raise exception 'Account inactive' using errcode = '42501';
  end if;
  participant_only := private.participant_actor();
  if p_read is null or ((p_ids is null) = (p_all_before is null)) or
     (p_ids is not null and (
       cardinality(p_ids) not between 1 and 100 or
       exists (select 1 from unnest(p_ids) value where value is null) or
       cardinality(p_ids) <> (select count(distinct value) from unnest(p_ids) value)
     )) or
     (p_all_before is not null and
       (not isfinite(p_all_before) or p_all_before > clock_timestamp())) then
    raise exception 'Invalid read-state request' using errcode = '22023';
  end if;
  if p_ids is not null and (
    select count(*) from public.notifications notification
    where notification.id = any(p_ids) and notification.user_id = auth.uid()
      and (not participant_only or private.notification_currently_visible(
        notification.kind, notification.resource_id))
  ) <> cardinality(p_ids) then
    raise exception 'Notification access denied' using errcode = '42501';
  end if;
  update public.notifications notification
  set read_at = case when p_read then coalesce(notification.read_at, now()) else null end
  where notification.user_id = auth.uid() and
    ((p_ids is not null and notification.id = any(p_ids)) or
      (p_all_before is not null and notification.created_at <= p_all_before))
    and (not participant_only or private.notification_currently_visible(
      notification.kind, notification.resource_id));
  get diagnostics result = row_count;
  return result;
end;
$$;

-- Direct REST/Realtime reads use the same exact recipient/current-target gate.
alter policy notification_read on public.notifications using (
  ((select private.actor_active()) or (select private.participant_actor())) and
  user_id = (select auth.uid()) and
  private.notification_currently_visible(kind, resource_id)
);
alter policy notification_edit on public.notifications using (
  ((select private.actor_active()) or (select private.participant_actor())) and
  user_id = (select auth.uid()) and
  private.notification_currently_visible(kind, resource_id)
) with check (
  ((select private.actor_active()) or (select private.participant_actor())) and
  user_id = (select auth.uid()) and
  private.notification_currently_visible(kind, resource_id)
);
alter policy portal_members_only on public.notifications
  using ((select private.actor_active()) or
    ((select private.participant_actor()) and user_id = (select auth.uid()) and
      private.notification_currently_visible(kind, resource_id)))
  with check ((select private.actor_active()) or
    ((select private.participant_actor()) and user_id = (select auth.uid()) and
      private.notification_currently_visible(kind, resource_id)));

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
    '/rpc/course_chat_rooms', '/rpc/course_chat_messages', '/rpc/send_course_chat_message',
    '/rpc/notification_inbox', '/rpc/mark_notifications', '/notifications'
  ) then return; end if;
  raise exception 'Operational portal access required' using errcode = '42501';
end;
$$;

notify pgrst, 'reload schema';
commit;
