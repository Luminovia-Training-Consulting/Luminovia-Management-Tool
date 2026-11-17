begin;

-- Pins and their order belong to the individual membership, not the shared room.
alter table public.chat_members add column pinned boolean not null default false;
alter table public.chat_members add column pinned_rank bigint;

create function private.chat_pinned_rooms() returns uuid[]
language sql stable security definer set search_path='' as $$
 select coalesce(array_agg(m.room_id order by m.pinned_rank,m.room_id),'{}'::uuid[])
 from public.chat_members m
 where m.user_id=auth.uid() and m.removed_at is null and m.pinned
   and private.can_access_chat_room(m.room_id);
$$;
create function public.chat_pinned_rooms() returns uuid[]
language sql stable security invoker set search_path='' as $$
 select private.chat_pinned_rooms();
$$;

create function private.set_chat_pin(p_room_id uuid,p_pinned boolean) returns void
language plpgsql security definer set search_path='' as $$
declare was_pinned boolean;
begin
 if p_pinned is null then raise exception 'Invalid pin' using errcode='22023'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('chat-pins:'||auth.uid()::text,0));
 -- Recheck server authority after taking the caller's membership lock.
 select m.pinned into was_pinned from public.chat_members m
  where m.room_id=p_room_id and m.user_id=auth.uid() for update;
 if not found or not private.can_access_chat_room(p_room_id) then
  raise exception 'Room access denied' using errcode='42501';
 end if;
 if p_pinned and not was_pinned then
  update public.chat_members set pinned=true,pinned_rank=(
   select coalesce(max(m.pinned_rank),0)+1 from public.chat_members m where m.user_id=auth.uid() and m.pinned
  ) where room_id=p_room_id and user_id=auth.uid();
 elsif not p_pinned then
  update public.chat_members set pinned=false,pinned_rank=null where room_id=p_room_id and user_id=auth.uid();
 end if;
end;$$;
create function public.set_chat_pin(p_room_id uuid,p_pinned boolean) returns void
language sql security invoker set search_path='' as $$
 select private.set_chat_pin(p_room_id,p_pinned);
$$;

-- Require the exact reviewed order: stale clients may refresh and retry, never
-- silently move a different neighbor or replay the same reorder twice.
create function private.move_chat_pin(p_room_id uuid,p_direction text,p_expected_order uuid[]) returns void
language plpgsql security definer set search_path='' as $$
declare current_order uuid[]; position int; neighbor uuid; own_rank bigint; neighbor_rank bigint;
begin
 if p_direction is null or p_direction not in ('up','down') or p_expected_order is null then
  raise exception 'Invalid pin move' using errcode='22023';
 end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('chat-pins:'||auth.uid()::text,0));
 current_order := private.chat_pinned_rooms();
 if current_order is distinct from p_expected_order then
  raise exception 'Pin order changed; reload' using errcode='40001';
 end if;
 position := array_position(current_order,p_room_id);
 if position is null or not private.can_access_chat_room(p_room_id) then
  raise exception 'Room access denied' using errcode='42501';
 end if;
 neighbor := current_order[position + case when p_direction='up' then -1 else 1 end];
 if neighbor is null then raise exception 'Pin is already at the edge' using errcode='22023'; end if;
 -- Membership revocation takes the same row locks; recheck both once locked.
 perform 1 from public.chat_members m where m.user_id=auth.uid() and m.room_id in (p_room_id,neighbor) order by m.room_id for update;
 if not private.can_access_chat_room(p_room_id) or not private.can_access_chat_room(neighbor) then
  raise exception 'Room access denied' using errcode='42501';
 end if;
 select m.pinned_rank into own_rank from public.chat_members m where m.user_id=auth.uid() and m.room_id=p_room_id and m.pinned;
 select m.pinned_rank into neighbor_rank from public.chat_members m where m.user_id=auth.uid() and m.room_id=neighbor and m.pinned;
 if own_rank is null or neighbor_rank is null then raise exception 'Pin order changed; reload' using errcode='40001'; end if;
 update public.chat_members set pinned_rank=case when room_id=p_room_id then neighbor_rank else own_rank end
  where user_id=auth.uid() and room_id in (p_room_id,neighbor);
end;$$;
create function public.move_chat_pin(p_room_id uuid,p_direction text,p_expected_order uuid[]) returns void
language sql security invoker set search_path='' as $$
 select private.move_chat_pin(p_room_id,p_direction,p_expected_order);
$$;
revoke all on function private.chat_pinned_rooms(), public.chat_pinned_rooms(), private.set_chat_pin(uuid,boolean), public.set_chat_pin(uuid,boolean), private.move_chat_pin(uuid,text,uuid[]), public.move_chat_pin(uuid,text,uuid[]) from public,anon;
grant execute on function private.chat_pinned_rooms(), public.chat_pinned_rooms(), private.set_chat_pin(uuid,boolean), public.set_chat_pin(uuid,boolean), private.move_chat_pin(uuid,text,uuid[]), public.move_chat_pin(uuid,text,uuid[]) to authenticated;
commit;
