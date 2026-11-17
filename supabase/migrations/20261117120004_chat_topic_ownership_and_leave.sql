begin;
-- Course/general/direct rooms have independent lifecycle rules; this facade is
-- deliberately limited to user-managed topic groups.
create function private.transfer_topic_group_owner(p_room_id uuid,p_new_owner_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare r public.chat_rooms;
begin
 if auth.uid() is null or p_new_owner_id is null or p_new_owner_id=auth.uid() then raise exception 'Invalid transfer' using errcode='22023'; end if;
 -- Lock both profiles before the group, in deterministic order, so a target
 -- suspension cannot interleave with the decision or deadlock another transfer.
 perform 1 from public.profiles where id in (auth.uid(),p_new_owner_id) order by id for share;
 select * into r from public.chat_rooms where id=p_room_id for update;
 if not found or r.kind <> 'topic' or r.owner_id is distinct from auth.uid() or not private.can_access_chat_room(p_room_id) then
  raise exception 'Transfer denied' using errcode='42501';
 end if;
 if not private.chat_staff(p_new_owner_id) or not exists(select 1 from public.chat_members where room_id=p_room_id and user_id=p_new_owner_id and removed_at is null) then
  raise exception 'New owner must be an active member' using errcode='22023';
 end if;
 update public.chat_rooms set owner_id=p_new_owner_id where id=p_room_id;
 insert into public.audit_events(actor_id,action,resource_id,details) values(auth.uid(),'chat.owner_transferred',p_room_id,jsonb_build_object('new_owner_id',p_new_owner_id));
end;$$;
create function public.transfer_topic_group_owner(p_room_id uuid,p_new_owner_id uuid) returns void language sql security invoker set search_path='' as $$select private.transfer_topic_group_owner(p_room_id,p_new_owner_id);$$;

create function private.leave_topic_group(p_room_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare r public.chat_rooms;
begin
 perform 1 from public.profiles where id=auth.uid() and active for share;
 if not found then raise exception 'Leave denied' using errcode='42501'; end if;
 select * into r from public.chat_rooms where id=p_room_id for update;
 if not found or r.kind <> 'topic' or not private.can_access_chat_room(p_room_id) then raise exception 'Leave denied' using errcode='42501'; end if;
 if r.owner_id=auth.uid() then raise exception 'Transfer ownership before leaving' using errcode='22023'; end if;
 update public.chat_members set removed_at=clock_timestamp() where room_id=p_room_id and user_id=auth.uid() and removed_at is null;
 insert into public.audit_events(actor_id,action,resource_id,details) values(auth.uid(),'chat.member_left',p_room_id,'{}'::jsonb);
end;$$;
create function public.leave_topic_group(p_room_id uuid) returns void language sql security invoker set search_path='' as $$select private.leave_topic_group(p_room_id);$$;
revoke all on function private.transfer_topic_group_owner(uuid,uuid),public.transfer_topic_group_owner(uuid,uuid),private.leave_topic_group(uuid),public.leave_topic_group(uuid) from public,anon,authenticated;
grant execute on function private.transfer_topic_group_owner(uuid,uuid),public.transfer_topic_group_owner(uuid,uuid),private.leave_topic_group(uuid),public.leave_topic_group(uuid) to authenticated;
commit;
