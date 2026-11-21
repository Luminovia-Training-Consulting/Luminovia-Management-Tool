begin;

-- A company contact can read its own current course group through the scoped
-- workspace. This grants neither general chat membership nor write/Realtime access.
create function private.company_course_chat_reader(p_room_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.actor_active() and exists (
    select 1 from public.chat_rooms room
    join public.course_runs run on run.id=room.course_run_id
    where room.id=p_room_id and room.kind='participant_course'
      and run.archived_at is null and private.company_premium_enabled(run.organisation_id)
      and private.client_has_organisation(run.organisation_id)
  );
$$;
revoke all on function private.company_course_chat_reader(uuid) from public,anon,authenticated,service_role;

create or replace function private.course_chat_rooms(p_run_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare context jsonb;
begin
  context := private.course_workspace_context(p_run_id);
  if not coalesce((context->>'lms_enabled')::boolean, false) then
    raise exception 'company_premium_lms_off' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', room.id, 'title', room.title, 'can_post', private.can_access_chat_room(room.id)
    ) order by room.title, room.id)
    from public.chat_rooms room
    where room.course_run_id=p_run_id and room.kind='participant_course'
      and (private.can_access_chat_room(room.id) or private.company_course_chat_reader(room.id))
  ), '[]'::jsonb);
end;
$$;

create or replace function private.course_chat_messages(
  p_room_id uuid, p_before_at timestamptz default null,
  p_before_id uuid default null, p_limit integer default 50
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare member_access boolean;
begin
  select private.can_access_chat_room(room.id) into member_access
  from public.chat_rooms room where room.id=p_room_id and room.kind='participant_course';
  if not found or not (member_access or private.company_course_chat_reader(p_room_id)) then
    raise exception 'Course chat unavailable' using errcode='42501';
  end if;
  if p_limit is null or p_limit not between 1 and 100
    or ((p_before_at is null) <> (p_before_id is null))
    or (p_before_at is not null and not isfinite(p_before_at)) then
    raise exception 'Invalid course chat page' using errcode='22023';
  end if;

  if member_access then
    return coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', message.id, 'sender_id', message.sender_id,
        'sender_name', message.sender_name,
        'body', case when message.deleted_at is null then message.body else null end,
        'created_at', message.created_at, 'deleted_at', message.deleted_at
      ) order by message.created_at, message.id)
      from private.chat_messages(p_room_id, p_before_at, p_before_id, '', p_limit) message
    ), '[]'::jsonb);
  end if;

  return coalesce((
    select jsonb_agg(to_jsonb(message) order by message.created_at, message.id)
    from (
      select m.id, m.sender_id, p.display_name as sender_name,
        case when m.deleted_at is null then m.body end as body, m.created_at, m.deleted_at
      from public.messages m join public.profiles p on p.id=m.sender_id
      where m.room_id=p_room_id
        and not exists(select 1 from private.chat_hidden_messages hidden
          where hidden.message_id=m.id and hidden.user_id=auth.uid())
        and (p_before_at is null or (m.created_at,m.id)<(p_before_at,p_before_id))
      order by m.created_at desc,m.id desc limit p_limit
    ) message
  ), '[]'::jsonb);
end;
$$;
commit;
