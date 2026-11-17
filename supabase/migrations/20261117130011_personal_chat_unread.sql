begin;
-- Independent per-member attention flag; the read cursor remains authoritative
-- for real incoming counts and is never rewound to forge message receipts.
alter table public.chat_members add column manual_unread_at timestamptz;

create function private.chat_rooms_with_manual_unread()
returns table(id uuid,kind text,title text,job_id uuid,owner_id uuid,unread_count bigint,last_message_at timestamptz,muted boolean,manual_unread boolean)
language sql stable security definer set search_path='' as $$
 select rooms.id,rooms.kind,rooms.title,rooms.job_id,rooms.owner_id,rooms.unread_count,rooms.last_message_at,rooms.muted,m.manual_unread_at is not null
 from private.chat_rooms_list() with ordinality rooms join public.chat_members m on m.room_id=rooms.id and m.user_id=auth.uid() and m.removed_at is null order by rooms.ordinality;
$$;
create function public.chat_rooms_with_manual_unread()
returns table(id uuid,kind text,title text,job_id uuid,owner_id uuid,unread_count bigint,last_message_at timestamptz,muted boolean,manual_unread boolean)
language sql stable security invoker set search_path='' as $$select * from private.chat_rooms_with_manual_unread();$$;

create function private.mark_chat_unread(p_room_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.chat_members m where m.room_id=p_room_id and m.user_id=auth.uid() for update;
 if not found or not private.can_access_chat_room(p_room_id) then raise exception 'Room access denied' using errcode='42501'; end if;
 update public.chat_members set manual_unread_at=clock_timestamp() where room_id=p_room_id and user_id=auth.uid();
end;$$;
create function public.mark_chat_unread(p_room_id uuid) returns void language sql security invoker set search_path='' as $$select private.mark_chat_unread(p_room_id);$$;

-- Opening a known-empty room clears only its personal attention flag. Never
-- advance the message cursor: a message may have arrived since the empty read.
create function private.clear_chat_manual_unread(p_room_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare started timestamptz:=statement_timestamp();
begin
 perform 1 from public.chat_members m where m.room_id=p_room_id and m.user_id=auth.uid() for update;
 if not found or not private.can_access_chat_room(p_room_id) then raise exception 'Room access denied' using errcode='42501'; end if;
 update public.chat_members set manual_unread_at=null where room_id=p_room_id and user_id=auth.uid() and manual_unread_at<=started;
end;$$;
create function public.clear_chat_manual_unread(p_room_id uuid) returns void language sql security invoker set search_path='' as $$select private.clear_chat_manual_unread(p_room_id);$$;
revoke all on function private.clear_chat_manual_unread(uuid),public.clear_chat_manual_unread(uuid) from public,anon,authenticated,service_role;
grant execute on function private.clear_chat_manual_unread(uuid),public.clear_chat_manual_unread(uuid) to authenticated;

-- Retain monotonic server read cursors and mute-only behavior. A read statement
-- initiated before a later explicit unread mark cannot erase it after waiting.
create or replace function private.mark_chat_read(p_room_id uuid,p_message_id uuid default null,p_muted boolean default null) returns void
language plpgsql security definer set search_path='' as $$
declare stamp timestamptz; message_id uuid; started timestamptz:=statement_timestamp();
begin
 perform 1 from public.chat_members m where m.room_id=p_room_id and m.user_id=auth.uid() for update;
 if not found or not private.can_access_chat_room(p_room_id) then raise exception 'Room access denied' using errcode='42501'; end if;
 if p_muted is not null then update public.chat_members set muted=p_muted where room_id=p_room_id and user_id=auth.uid(); end if;
 if p_message_id is null and p_muted is not null then return; end if;
 if p_message_id is null then select m.created_at,m.id into stamp,message_id from public.messages m where m.room_id=p_room_id order by m.created_at desc,m.id desc limit 1;
 else select m.created_at,m.id into stamp,message_id from public.messages m where m.id=p_message_id and m.room_id=p_room_id; if stamp is null then raise exception 'Message is not in this room' using errcode='22023'; end if; end if;
 if stamp is not null then update public.chat_members set last_read_at=stamp,last_read_message_id=message_id where room_id=p_room_id and user_id=auth.uid() and (last_read_at,last_read_message_id)<(stamp,message_id); end if;
 update public.chat_members set manual_unread_at=null where room_id=p_room_id and user_id=auth.uid() and manual_unread_at<=started;
end;$$;
revoke all on function private.chat_rooms_with_manual_unread(),public.chat_rooms_with_manual_unread(),private.mark_chat_unread(uuid),public.mark_chat_unread(uuid) from public,anon,authenticated,service_role;
grant execute on function private.chat_rooms_with_manual_unread(),public.chat_rooms_with_manual_unread(),private.mark_chat_unread(uuid),public.mark_chat_unread(uuid) to authenticated;
commit;
