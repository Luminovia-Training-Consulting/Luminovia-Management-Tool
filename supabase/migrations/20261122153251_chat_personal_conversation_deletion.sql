begin;

alter table public.chat_members
  add column personal_history_cleared boolean not null default false;

-- Reuse personal message visibility across history, search, replies and course chat.
create function private.clear_personal_chat(p_room_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('chat-pins:'||auth.uid()::text,0));
  perform 1 from public.chat_members
    where room_id=p_room_id and user_id=auth.uid() and removed_at is null
    for update;
  if not found or not private.can_access_chat_room(p_room_id) then
    raise exception 'Room access denied' using errcode='42501';
  end if;

  insert into private.chat_hidden_messages(user_id,message_id)
    select auth.uid(),m.id from public.messages m where m.room_id=p_room_id
    on conflict do nothing;

  update public.chat_members
    set personal_history_cleared=true,
        personal_archived=false,
        pinned=false,
        pinned_rank=null,
        manual_unread_at=null,
        hidden_generation=hidden_generation+1
    where room_id=p_room_id and user_id=auth.uid();
end;
$$;
create function public.clear_personal_chat(p_room_id uuid) returns void
language sql security invoker set search_path='' as $$
  select private.clear_personal_chat(p_room_id);
$$;
revoke all on function private.clear_personal_chat(uuid),public.clear_personal_chat(uuid)
  from public,anon,authenticated,service_role;
grant execute on function private.clear_personal_chat(uuid),public.clear_personal_chat(uuid)
  to authenticated;

-- Keep explicitly opened rooms usable. The directory hides a cleared room until
-- it has a visible message, while memberships and shared history stay intact.
drop function public.chat_rooms_with_manual_unread();
drop function private.chat_rooms_with_manual_unread();

create function private.chat_rooms_with_manual_unread()
returns table(
 id uuid, kind text, title text, job_id uuid, owner_id uuid, unread_count bigint,
 last_message_at timestamptz, muted boolean, manual_unread boolean,
 last_message_preview text, personal_deleted boolean
)
language sql stable security definer set search_path='' as $$
 select rooms.id,rooms.kind,rooms.title,rooms.job_id,rooms.owner_id,
        rooms.unread_count,
        case when member.personal_history_cleared then latest.created_at else rooms.last_message_at end,
        rooms.muted,
        member.manual_unread_at is not null and not visibility.personal_deleted,
        case when latest.deleted_at is null
          then left(regexp_replace(latest.body, E'\\s+', ' ', 'g'),160)
        end,
        visibility.personal_deleted
 from private.chat_rooms_list() with ordinality rooms
 join public.chat_members member on member.room_id=rooms.id
   and member.user_id=auth.uid() and member.removed_at is null
 left join lateral (
   select message.id,message.body,message.created_at,message.deleted_at
   from public.messages message
   where message.room_id=rooms.id
     and not exists (
       select 1 from private.chat_hidden_messages hidden
       where hidden.user_id=auth.uid() and hidden.message_id=message.id
     )
   order by message.created_at desc,message.id desc limit 1
 ) latest on true
 cross join lateral (
   select member.personal_history_cleared and latest.id is null as personal_deleted
 ) visibility
 order by rooms.ordinality;
$$;

create function public.chat_rooms_with_manual_unread()
returns table(
 id uuid, kind text, title text, job_id uuid, owner_id uuid, unread_count bigint,
 last_message_at timestamptz, muted boolean, manual_unread boolean,
 last_message_preview text, personal_deleted boolean
)
language sql stable security invoker set search_path='' as $$
 select * from private.chat_rooms_with_manual_unread();
$$;
revoke all on function private.chat_rooms_with_manual_unread(),public.chat_rooms_with_manual_unread()
  from public,anon,authenticated,service_role;
grant execute on function private.chat_rooms_with_manual_unread(),public.chat_rooms_with_manual_unread()
  to authenticated;

commit;
