begin;

-- The shared search ACL already limits participant actors to current course
-- chat messages. Repoint only their permitted message links to the scoped
-- course-chat panel; operational actors keep the full chat route.
alter function private.unified_search(text, text, text, text, uuid, integer)
  rename to unified_search_before_course_chat_links;
revoke all on function private.unified_search_before_course_chat_links(
  text, text, text, text, uuid, integer
) from public, anon, authenticated, service_role;

create function private.unified_search(
  p_query text, p_kind text default '',
  p_after_kind text default null, p_after_title text default null,
  p_after_id uuid default null, p_limit integer default 40
) returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare result jsonb; mapped jsonb;
begin
  result := private.unified_search_before_course_chat_links(
    p_query, p_kind, p_after_kind, p_after_title, p_after_id, p_limit
  );
  if not private.participant_actor() or p_kind <> 'chats' then
    return result;
  end if;
  select coalesce(jsonb_agg(
    case when room.course_run_id is not null and
      private.can_access_chat_room(room.id)
    then item.value || jsonb_build_object(
      'url', '/courses/' || room.course_run_id || '/workspace#course-chat'
    ) else item.value - 'url' end
    order by item.ordinality
  ), '[]'::jsonb) into mapped
  from jsonb_array_elements(result->'items') with ordinality item(value, ordinality)
  left join public.messages message on message.id = (item.value->>'id')::uuid
  left join public.chat_rooms room on room.id = message.room_id
    and room.kind = 'participant_course';
  return jsonb_set(result, '{items}', mapped);
end;
$$;
revoke all on function private.unified_search(text, text, text, text, uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function private.unified_search(text, text, text, text, uuid, integer)
  to authenticated;

create or replace function public.unified_search(
  p_query text, p_kind text default '',
  p_after_kind text default null, p_after_title text default null,
  p_after_id uuid default null, p_limit integer default 40
) returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.unified_search(
  p_query, p_kind, p_after_kind, p_after_title, p_after_id, p_limit
); $$;

notify pgrst, 'reload schema';
commit;
