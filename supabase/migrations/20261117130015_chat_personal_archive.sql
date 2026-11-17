begin;
-- A personal directory preference, never an archive of the shared room itself.
alter table public.chat_members add column personal_archived boolean not null default false;
create function private.chat_personal_archives() returns uuid[]
language sql stable security definer set search_path='' as $$
 select coalesce(array_agg(m.room_id order by m.room_id),'{}'::uuid[])
 from public.chat_members m join public.chat_rooms r on r.id=m.room_id
 where m.user_id=auth.uid() and m.removed_at is null and m.personal_archived
   and r.kind in ('dm','topic') and private.can_access_chat_room(m.room_id);
$$;
create function public.chat_personal_archives() returns uuid[]
language sql stable security invoker set search_path='' as $$select private.chat_personal_archives();$$;
create function private.set_chat_personal_archive(p_room_id uuid,p_archived boolean) returns void
language plpgsql security definer set search_path='' as $$
declare room_kind text;
begin
 if p_archived is null then raise exception 'Invalid archive value' using errcode='22023'; end if;
 perform 1 from public.profiles where id=auth.uid() and active for share;
 if not found then raise exception 'Room access denied' using errcode='42501'; end if;
 -- Lock the caller's row and then recheck current membership and room type.
 perform 1 from public.chat_members m where m.room_id=p_room_id and m.user_id=auth.uid() for update;
 if not found or not private.can_access_chat_room(p_room_id) then raise exception 'Room access denied' using errcode='42501'; end if;
 select r.kind into room_kind from public.chat_rooms r where r.id=p_room_id;
 if room_kind not in ('dm','topic') then raise exception 'Room cannot be personally archived' using errcode='22023'; end if;
 update public.chat_members set personal_archived=p_archived where room_id=p_room_id and user_id=auth.uid();
end;$$;
create function public.set_chat_personal_archive(p_room_id uuid,p_archived boolean) returns void
language sql security invoker set search_path='' as $$select private.set_chat_personal_archive(p_room_id,p_archived);$$;
revoke all on function private.chat_personal_archives(),public.chat_personal_archives(),private.set_chat_personal_archive(uuid,boolean),public.set_chat_personal_archive(uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function private.chat_personal_archives(),public.chat_personal_archives(),private.set_chat_personal_archive(uuid,boolean),public.set_chat_personal_archive(uuid,boolean) to authenticated;
commit;
