begin;
-- Invitations are distinct from membership and do not grant access until accepted.
create table private.chat_topic_invitations (
 id uuid primary key default gen_random_uuid(),
 room_id uuid not null references public.chat_rooms(id) on delete cascade,
 inviter_id uuid not null references public.profiles(id) on delete cascade,
 invitee_id uuid not null references public.profiles(id) on delete cascade,
 status text not null default 'pending' check(status in('pending','accepted','rejected','revoked')),
 created_at timestamptz not null default clock_timestamp(),
 decided_at timestamptz,
 unique(room_id,invitee_id),
 check(inviter_id<>invitee_id)
);
alter table private.chat_topic_invitations enable row level security;
revoke all on private.chat_topic_invitations from public,anon,authenticated,service_role;

create function private.invite_topic_member(p_room_id uuid,p_invitee_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare r public.chat_rooms; result uuid;
begin
 if auth.uid() is null or p_invitee_id is null or p_invitee_id=auth.uid() then raise exception 'Invalid invite' using errcode='22023'; end if;
 perform 1 from public.profiles where id in(auth.uid(),p_invitee_id) order by id for share;
 perform 1 from public.user_roles where user_id in(auth.uid(),p_invitee_id) order by user_id,role for share;
 select * into r from public.chat_rooms where id=p_room_id for update;
 if not found or r.kind<>'topic' or r.owner_id is distinct from auth.uid() or not private.can_access_chat_room(p_room_id) or not private.chat_staff(p_invitee_id) then raise exception 'Invitation denied' using errcode='42501'; end if;
 if exists(select 1 from public.chat_members m where m.room_id=p_room_id and m.user_id=p_invitee_id and m.removed_at is null) then raise exception 'Already a member' using errcode='22023'; end if;
 if (select count(*) from private.chat_topic_invitations where room_id=p_room_id and status='pending' and inviter_id=auth.uid() and invitee_id<>p_invitee_id)>=60 then raise exception 'Invitation limit reached' using errcode='54000'; end if;
 insert into private.chat_topic_invitations(room_id,inviter_id,invitee_id,status,created_at,decided_at)
 values(p_room_id,auth.uid(),p_invitee_id,'pending',clock_timestamp(),null)
 on conflict(room_id,invitee_id) do update set id=case when private.chat_topic_invitations.status='pending' and private.chat_topic_invitations.inviter_id=excluded.inviter_id then private.chat_topic_invitations.id else gen_random_uuid() end,inviter_id=excluded.inviter_id,status='pending',created_at=case when private.chat_topic_invitations.status='pending' and private.chat_topic_invitations.inviter_id=excluded.inviter_id then private.chat_topic_invitations.created_at else excluded.created_at end,decided_at=null
 returning id into result;
 return result;
end $$;
create function public.invite_topic_member(p_room_id uuid,p_invitee_id uuid) returns uuid language sql security invoker set search_path='' as $$select private.invite_topic_member(p_room_id,p_invitee_id);$$;

-- Pending inbox contains only invitations still backed by an active current owner.
create function private.topic_invitation_inbox() returns table(id uuid,room_id uuid,title text,inviter_name text,created_at timestamptz)
language sql stable security definer set search_path='' as $$
 select i.id,r.id,r.title,p.display_name,i.created_at from private.chat_topic_invitations i
 join public.chat_rooms r on r.id=i.room_id join public.profiles p on p.id=i.inviter_id
 where i.invitee_id=auth.uid() and private.chat_staff(auth.uid()) and i.status='pending' and r.kind='topic'
 and r.owner_id=i.inviter_id and private.chat_staff(i.inviter_id)
 and exists(select 1 from public.chat_members m where m.room_id=r.id and m.user_id=i.inviter_id and m.removed_at is null)
 order by i.created_at desc,i.id;
$$;
create function public.topic_invitation_inbox() returns table(id uuid,room_id uuid,title text,inviter_name text,created_at timestamptz) language sql stable security invoker set search_path='' as $$select * from private.topic_invitation_inbox();$$;

create function private.topic_invitation_sent(p_room_id uuid) returns table(id uuid,invitee_id uuid,invitee_name text,created_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
begin
 if not exists(select 1 from public.chat_rooms r where r.id=p_room_id and r.kind='topic' and r.owner_id=auth.uid()) or not private.can_access_chat_room(p_room_id) then raise exception 'Invitation denied' using errcode='42501'; end if;
 return query select i.id,i.invitee_id,p.display_name,i.created_at from private.chat_topic_invitations i join public.profiles p on p.id=i.invitee_id where i.room_id=p_room_id and i.inviter_id=auth.uid() and i.status='pending' and private.chat_staff(i.invitee_id) order by i.created_at desc,i.id;
end $$;
create function public.topic_invitation_sent(p_room_id uuid) returns table(id uuid,invitee_id uuid,invitee_name text,created_at timestamptz) language sql stable security invoker set search_path='' as $$select * from private.topic_invitation_sent(p_room_id);$$;

create function private.respond_topic_invitation(p_id uuid,p_accept boolean) returns uuid
language plpgsql security definer set search_path='' as $$
declare initial private.chat_topic_invitations; invitation private.chat_topic_invitations; r public.chat_rooms;
begin
 if p_accept is null then raise exception 'Invalid response' using errcode='22023'; end if;
 select * into initial from private.chat_topic_invitations where id=p_id and invitee_id=auth.uid();
 if not found then raise exception 'Invitation unavailable' using errcode='42501'; end if;
 perform 1 from public.profiles where id in(auth.uid(),initial.inviter_id) order by id for share;
 perform 1 from public.user_roles where user_id in(auth.uid(),initial.inviter_id) order by user_id,role for share;
 select * into r from public.chat_rooms where id=initial.room_id for update;
 select * into invitation from private.chat_topic_invitations where id=p_id for update;
 if invitation.invitee_id is distinct from auth.uid() or invitation.inviter_id is distinct from initial.inviter_id or invitation.status not in ('pending','accepted','rejected') or r.kind<>'topic' or r.owner_id is distinct from invitation.inviter_id or not private.chat_staff(auth.uid()) or not private.chat_staff(invitation.inviter_id) or not exists(select 1 from public.chat_members m where m.room_id=r.id and m.user_id=invitation.inviter_id and m.removed_at is null) then raise exception 'Invitation unavailable' using errcode='42501'; end if;
 if invitation.status<>'pending' then
  if (invitation.status='accepted' and p_accept and exists(select 1 from public.chat_members m where m.room_id=r.id and m.user_id=auth.uid() and m.removed_at is null)) or (invitation.status='rejected' and not p_accept) then return r.id; end if;
  raise exception 'Invitation unavailable' using errcode='42501';
 end if;
 if p_accept then
  insert into public.chat_members(room_id,user_id) values(r.id,auth.uid()) on conflict(room_id,user_id) do update set removed_at=null,joined_at=clock_timestamp();
 end if;
 update private.chat_topic_invitations set status=case when p_accept then 'accepted' else 'rejected' end,decided_at=clock_timestamp() where id=p_id;
 return r.id;
end $$;
create function public.respond_topic_invitation(p_id uuid,p_accept boolean) returns uuid language sql security invoker set search_path='' as $$select private.respond_topic_invitation(p_id,p_accept);$$;
create function private.revoke_topic_invitation(p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare i private.chat_topic_invitations; r public.chat_rooms;
begin
 select * into i from private.chat_topic_invitations where id=p_id;
 if not found then raise exception 'Invitation unavailable' using errcode='42501';end if;
 select * into r from public.chat_rooms where id=i.room_id for update;
 if r.kind<>'topic' or r.owner_id is distinct from auth.uid() or not private.can_access_chat_room(r.id) then raise exception 'Invitation denied' using errcode='42501';end if;
 update private.chat_topic_invitations set status='revoked',decided_at=clock_timestamp() where id=p_id and room_id=r.id and status='pending';
 if not found and not exists(select 1 from private.chat_topic_invitations where id=p_id and room_id=r.id and status='revoked') then raise exception 'Invitation already decided' using errcode='40001'; end if;
end $$;
create function public.revoke_topic_invitation(p_id uuid) returns void language sql security invoker set search_path='' as $$select private.revoke_topic_invitation(p_id);$$;
revoke all on function private.invite_topic_member(uuid,uuid),public.invite_topic_member(uuid,uuid),private.topic_invitation_inbox(),public.topic_invitation_inbox(),private.topic_invitation_sent(uuid),public.topic_invitation_sent(uuid),private.respond_topic_invitation(uuid,boolean),public.respond_topic_invitation(uuid,boolean),private.revoke_topic_invitation(uuid),public.revoke_topic_invitation(uuid) from public,anon,authenticated,service_role;
grant execute on function private.invite_topic_member(uuid,uuid),public.invite_topic_member(uuid,uuid),private.topic_invitation_inbox(),public.topic_invitation_inbox(),private.topic_invitation_sent(uuid),public.topic_invitation_sent(uuid),private.respond_topic_invitation(uuid,boolean),public.respond_topic_invitation(uuid,boolean),private.revoke_topic_invitation(uuid),public.revoke_topic_invitation(uuid) to authenticated;

alter function private.deletion_scope(text,uuid) rename to deletion_scope_before_topic_invitations;
create function private.deletion_scope(p_kind text,p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb:=private.deletion_scope_before_topic_invitations(p_kind,p_id); pred text;
begin
 if p_kind='account' then pred=format('x.inviter_id=%L::uuid or x.invitee_id=%L::uuid',p_id,p_id);
 elsif p_kind='chat_room' then pred=format('x.room_id=%L::uuid',p_id); end if;
 if pred is not null then result=private.deletion_add_scope(result,'private.chat_topic_invitations',pred); end if;
 return result;
end $$;
revoke all on function private.deletion_scope_before_topic_invitations(text,uuid),private.deletion_scope(text,uuid) from public,anon,authenticated,service_role;
commit;
