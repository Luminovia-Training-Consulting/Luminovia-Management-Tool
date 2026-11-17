begin;
-- Existing topic groups remain unchanged; strict mode is an explicit owner choice.
alter table public.chat_rooms add column invitation_only boolean not null default false;

create function private.topic_invitation_only(p_room_id uuid) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare r public.chat_rooms;
begin
 if not private.can_access_chat_room(p_room_id) then raise exception 'Room access denied' using errcode='42501'; end if;
 select * into r from public.chat_rooms where id=p_room_id and kind='topic';
 if not found then raise exception 'Topic group unavailable' using errcode='42501'; end if;
 return r.invitation_only;
end $$;
create function public.topic_invitation_only(p_room_id uuid) returns boolean language sql stable security invoker set search_path='' as $$select private.topic_invitation_only(p_room_id);$$;

create function private.set_topic_invitation_only(p_room_id uuid,p_expected boolean,p_enabled boolean) returns boolean
language plpgsql security definer set search_path='' as $$
declare r public.chat_rooms;
begin
 if p_expected is null or p_enabled is null then raise exception 'Explicit mode required' using errcode='22023'; end if;
 perform 1 from public.profiles where id=auth.uid() and active for share;
 if not found then raise exception 'Room access denied' using errcode='42501'; end if;
 perform 1 from public.user_roles where user_id=auth.uid() order by role for share;
 select * into r from public.chat_rooms where id=p_room_id for update;
 if not found or r.kind<>'topic' or r.owner_id is distinct from auth.uid() or not private.can_access_chat_room(p_room_id) then raise exception 'Group management denied' using errcode='42501'; end if;
 if r.invitation_only is distinct from p_expected then raise exception 'Group mode changed' using errcode='40001'; end if;
 update public.chat_rooms set invitation_only=p_enabled where id=p_room_id;
 insert into public.audit_events(actor_id,action,resource_id,details) values(auth.uid(),'chat.invitation_mode_changed',p_room_id,jsonb_build_object('invitation_only',p_enabled));
 return p_enabled;
end $$;
create function public.set_topic_invitation_only(p_room_id uuid,p_expected boolean,p_enabled boolean) returns boolean language sql security invoker set search_path='' as $$select private.set_topic_invitation_only(p_room_id,p_expected,p_enabled);$$;

-- Preserve participant-origin authority and locks while serializing direct
-- membership changes with mode edits. The accepted invitation path owns its
-- separately authenticated transaction and does not use this management RPC.
alter function private.manage_chat_member(uuid,uuid,boolean) rename to manage_chat_member_before_invitation_only;
revoke all on function private.manage_chat_member_before_invitation_only(uuid,uuid,boolean) from public,anon,authenticated,service_role;
create function private.manage_chat_member(p_room_id uuid,p_user_id uuid,p_remove boolean) returns void
language plpgsql security definer set search_path='' as $$
declare r public.chat_rooms;
begin
 select * into r from public.chat_rooms where id=p_room_id;
 if not found or not private.can_access_chat_room(p_room_id) or r.kind in ('dm','general')
 or not (r.owner_id=auth.uid() or (r.kind in ('participant_course','lecturer_course') and private.has_permission('courses.manage'))) then raise exception 'Membership management denied' using errcode='42501'; end if;
 perform 1 from public.profiles where id=p_user_id for share;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text,0));
 select * into r from public.chat_rooms where id=p_room_id for update;
 if r.kind='topic' and r.invitation_only and p_remove=false then raise exception 'Invitation acceptance required' using errcode='42501'; end if;
 perform private.manage_chat_member_before_invitation_only(p_room_id,p_user_id,p_remove);
end $$;
revoke all on function private.manage_chat_member(uuid,uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function private.manage_chat_member(uuid,uuid,boolean) to authenticated;

-- Creation and all invitations commit as one transaction. The selected people
-- do not become members until they accept the existing invitation workflow.
create function private.create_invitation_only_topic(p_title text,p_invitee_ids uuid[]) returns uuid
language plpgsql security definer set search_path='' as $$
declare ids uuid[]; person uuid; room uuid;
begin
 if p_invitee_ids is null or coalesce(array_ndims(p_invitee_ids),1)<>1 or cardinality(p_invitee_ids)>60 or array_position(p_invitee_ids,null) is not null or auth.uid()=any(p_invitee_ids) then raise exception 'Invalid invitees' using errcode='22023'; end if;
 select coalesce(array_agg(distinct x order by x),'{}'::uuid[]) into ids from unnest(p_invitee_ids) x;
 if cardinality(ids)<>cardinality(p_invitee_ids) then raise exception 'Duplicate invitees' using errcode='22023'; end if;
 perform 1 from public.profiles where id=any(ids||array[auth.uid()]) order by id for share;
 perform 1 from public.user_roles where user_id=any(ids||array[auth.uid()]) order by user_id,role for share;
 room=private.create_chat_group(p_title,'{}'::uuid[],'topic',null);
 update public.chat_rooms set invitation_only=true where id=room;
 foreach person in array ids loop perform private.invite_topic_member(room,person); end loop;
 return room;
end $$;
create function public.create_invitation_only_topic(p_title text,p_invitee_ids uuid[]) returns uuid language sql security invoker set search_path='' as $$select private.create_invitation_only_topic(p_title,p_invitee_ids);$$;
revoke all on function private.topic_invitation_only(uuid),public.topic_invitation_only(uuid),private.set_topic_invitation_only(uuid,boolean,boolean),public.set_topic_invitation_only(uuid,boolean,boolean),private.create_invitation_only_topic(text,uuid[]),public.create_invitation_only_topic(text,uuid[]) from public,anon,authenticated,service_role;
grant execute on function private.topic_invitation_only(uuid),public.topic_invitation_only(uuid),private.set_topic_invitation_only(uuid,boolean,boolean),public.set_topic_invitation_only(uuid,boolean,boolean),private.create_invitation_only_topic(text,uuid[]),public.create_invitation_only_topic(text,uuid[]) to authenticated;
commit;
