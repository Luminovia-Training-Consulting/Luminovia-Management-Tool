begin;

-- The directory preview is computed server-side for the current actor. A
-- personal hide or tombstone never leaks body text to the room list.
drop function public.chat_rooms_with_manual_unread();
drop function private.chat_rooms_with_manual_unread();

create function private.chat_rooms_with_manual_unread()
returns table(
 id uuid,
 kind text,
 title text,
 job_id uuid,
 owner_id uuid,
 unread_count bigint,
 last_message_at timestamptz,
 muted boolean,
 manual_unread boolean,
 last_message_preview text
)
language sql stable security definer set search_path='' as $$
 select rooms.id,rooms.kind,rooms.title,rooms.job_id,rooms.owner_id,
        rooms.unread_count,rooms.last_message_at,rooms.muted,
        member.manual_unread_at is not null,
        (select case when latest.deleted_at is null
          then left(regexp_replace(coalesce(latest.body,''), E'\\s+', ' ', 'g'),160)
          else null end
         from (select message.body,message.deleted_at
               from public.messages message
               where message.room_id=rooms.id
                 and not exists(select 1 from private.chat_hidden_messages hidden
                                where hidden.user_id=auth.uid() and hidden.message_id=message.id)
               order by message.created_at desc,message.id desc limit 1) latest)
 from private.chat_rooms_list() with ordinality rooms
 join public.chat_members member on member.room_id=rooms.id
   and member.user_id=auth.uid() and member.removed_at is null
 order by rooms.ordinality;
$$;

create function public.chat_rooms_with_manual_unread()
returns table(
 id uuid,
 kind text,
 title text,
 job_id uuid,
 owner_id uuid,
 unread_count bigint,
 last_message_at timestamptz,
 muted boolean,
 manual_unread boolean,
 last_message_preview text
)
language sql stable security invoker set search_path='' as $$
 select * from private.chat_rooms_with_manual_unread();
$$;

revoke all on function private.chat_rooms_with_manual_unread(),public.chat_rooms_with_manual_unread()
 from public,anon,authenticated,service_role;
grant execute on function private.chat_rooms_with_manual_unread(),public.chat_rooms_with_manual_unread()
 to authenticated;
commit;
