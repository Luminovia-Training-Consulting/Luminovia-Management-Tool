begin;

-- The Realtime marker exists only for its parent room. Review its current
-- revision alongside messages and membership before deleting that room.
alter function private.deletion_scope(text, uuid)
  rename to deletion_scope_before_course_chat_activity;

create function private.deletion_scope(p_kind text, p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  scope jsonb := private.deletion_scope_before_course_chat_activity(p_kind, p_id);
begin
  if p_kind = 'chat_room' then
    return private.deletion_add_scope(scope, 'public.course_chat_activity',
      format('x.room_id=%L::uuid', p_id));
  end if;
  return scope;
end;
$$;

revoke all on function private.deletion_scope_before_course_chat_activity(text, uuid),
  private.deletion_scope(text, uuid) from public, anon, authenticated, service_role;

commit;
