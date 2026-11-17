begin;
-- Group-wide pins contain no copied text and remain subordinate to the room's
-- current membership, message deletion and each reader's own hiding preference.
create table private.chat_topic_message_pins (
 message_id uuid primary key references public.messages(id) on delete cascade,
 pinned_at timestamptz not null default clock_timestamp()
);
alter table private.chat_topic_message_pins enable row level security;
revoke all on private.chat_topic_message_pins from public,anon,authenticated,service_role;
alter table public.messages add column pin_generation bigint not null default 0;

create function private.chat_topic_pinned_messages(p_room_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare room public.chat_rooms;
begin
 if not private.can_access_chat_room(p_room_id) then raise exception 'Room access denied' using errcode='42501'; end if;
 select * into room from public.chat_rooms where id=p_room_id and kind='topic';
 if not found then raise exception 'Room access denied' using errcode='42501';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'sender_name',p.display_name,'body',m.body,'created_at',m.created_at) order by pin.pinned_at desc,m.id)
 from private.chat_topic_message_pins pin join public.messages m on m.id=pin.message_id join public.profiles p on p.id=m.sender_id
 where m.room_id=p_room_id and m.deleted_at is null and not private.chat_message_hidden(m.id)),'[]'::jsonb);
end;$$;
create function public.chat_topic_pinned_messages(p_room_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$select private.chat_topic_pinned_messages(p_room_id);$$;

create function private.set_chat_topic_message_pin(p_message_id uuid,p_pinned boolean) returns void
language plpgsql security definer set search_path='' as $$
declare message public.messages; room public.chat_rooms; changed int;
begin
 if p_pinned is null then raise exception 'Invalid pin' using errcode='22023';end if;
 select * into message from public.messages where id=p_message_id;
 if not found or not private.can_access_chat_room(message.room_id) then raise exception 'Message unavailable' using errcode='42501';end if;
 -- Same actor/profile/role/room/membership lock order as ordinary message sends.
 -- The room-specific advisory lock serializes pin count and simultaneous toggles.
 perform private.prepare_chat_mentions(message.room_id,'{}'::uuid[]);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('topic-message-pins:'||message.room_id::text,0));
 select * into message from public.messages where id=p_message_id for update;
 select * into room from public.chat_rooms where id=message.room_id;
 if not found or room.kind<>'topic' or not private.can_access_chat_room(room.id)
  or (room.owner_id is distinct from auth.uid() and not private.has_permission('chat.moderate'))
  or message.deleted_at is not null or private.chat_message_hidden(message.id)
 then raise exception 'Message unavailable' using errcode='42501';end if;
 if p_pinned then
  if (select count(*) from private.chat_topic_message_pins pin join public.messages m on m.id=pin.message_id where m.room_id=room.id)>=50
   and not exists(select 1 from private.chat_topic_message_pins where message_id=message.id)
  then raise exception 'Pin limit reached' using errcode='54000';end if;
  insert into private.chat_topic_message_pins(message_id) values(message.id) on conflict do nothing;
 else
  delete from private.chat_topic_message_pins where message_id=message.id;
 end if;
 get diagnostics changed=row_count;
 if changed>0 then
  -- Existing message UPDATE subscriptions are a signal only; readers refetch
  -- through the authorised RPC, never from the realtime payload.
  update public.messages set pin_generation=pin_generation+1 where id=message.id;
  insert into public.audit_events(actor_id,action,resource_id,details) values(auth.uid(),case when p_pinned then 'chat.message_pinned' else 'chat.message_unpinned' end,message.id,'{}'::jsonb);
 end if;
end;$$;
create function public.set_chat_topic_message_pin(p_message_id uuid,p_pinned boolean) returns void language sql security invoker set search_path='' as $$select private.set_chat_topic_message_pin(p_message_id,p_pinned);$$;

-- A tombstone cannot leave a stale group-wide pin even if no client is online.
create function private.remove_deleted_message_pin() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.deleted_at is not null and old.deleted_at is null then delete from private.chat_topic_message_pins where message_id=new.id;end if;
 return new;
end;$$;
create trigger remove_deleted_message_pin after update of deleted_at on public.messages for each row execute function private.remove_deleted_message_pin();
revoke all on function private.remove_deleted_message_pin() from public,anon,authenticated,service_role;

-- Physical deletion previews retain the exact new child rows and their hashes.
alter function private.deletion_scope(text,uuid) rename to deletion_scope_before_topic_message_pins;
create function private.deletion_scope(p_kind text,p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb:=private.deletion_scope_before_topic_message_pins(p_kind,p_id); predicate text;
begin
 if p_kind='message' then predicate=format('x.message_id=%L::uuid',p_id);
 elsif p_kind='chat_room' then predicate=format('x.message_id in(select id from public.messages where room_id=%L::uuid)',p_id);end if;
 if predicate is not null then result=private.deletion_add_scope(result,'private.chat_topic_message_pins',predicate);end if;
 return result;
end;$$;
revoke all on function private.deletion_scope_before_topic_message_pins(text,uuid),private.deletion_scope(text,uuid) from public,anon,authenticated,service_role;
revoke all on function private.chat_topic_pinned_messages(uuid),public.chat_topic_pinned_messages(uuid),private.set_chat_topic_message_pin(uuid,boolean),public.set_chat_topic_message_pin(uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function private.chat_topic_pinned_messages(uuid),public.chat_topic_pinned_messages(uuid),private.set_chat_topic_message_pin(uuid,boolean),public.set_chat_topic_message_pin(uuid,boolean) to authenticated;
commit;
