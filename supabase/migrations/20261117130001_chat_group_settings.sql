begin;
-- Descriptions follow the existing member-only chat_rooms SELECT policy.
alter table public.chat_rooms add column description text not null default '' check (length(description) <= 2000);
alter table public.chat_rooms add column settings_version integer not null default 1 check (settings_version > 0);

create function private.chat_group_settings(p_room_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare r public.chat_rooms;
begin
 if not private.can_access_chat_room(p_room_id) then raise exception 'Room access denied' using errcode='42501'; end if;
 select * into r from public.chat_rooms where id=p_room_id and kind in ('topic','participant_course','lecturer_course');
 if not found then raise exception 'Group not available' using errcode='42501'; end if;
 return jsonb_build_object('title',r.title,'description',r.description,'version',r.settings_version);
end;$$;
create function public.chat_group_settings(p_room_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$select private.chat_group_settings(p_room_id);$$;

create function private.update_chat_group_settings(p_room_id uuid,p_title text,p_description text,p_expected_version integer) returns integer
language plpgsql security definer set search_path='' as $$
declare r public.chat_rooms; next_version integer;
begin
 -- Serialize with account suspension and then membership/ownership changes.
 perform 1 from public.profiles where id=auth.uid() and active for share;
 if not found then raise exception 'Room access denied' using errcode='42501'; end if;
 select * into r from public.chat_rooms where id=p_room_id for update;
 if not found or not private.can_access_chat_room(p_room_id) or r.kind not in ('topic','participant_course','lecturer_course') then
  raise exception 'Room access denied' using errcode='42501';
 end if;
 if r.owner_id is distinct from auth.uid() and not (r.kind in ('participant_course','lecturer_course') and private.has_permission('courses.manage')) then
  raise exception 'Group management denied' using errcode='42501';
 end if;
 if length(trim(coalesce(p_title,''))) not between 1 and 120 or p_description is null or length(p_description)>2000 or p_expected_version is null then
  raise exception 'Invalid group settings' using errcode='22023';
 end if;
 if r.settings_version <> p_expected_version then raise exception 'Group settings changed' using errcode='40001'; end if;
 update public.chat_rooms set title=trim(p_title),description=trim(p_description),settings_version=settings_version+1 where id=p_room_id returning settings_version into next_version;
 -- Avoid publishing private group text through administrator-wide audit access.
 insert into public.audit_events(actor_id,action,resource_id,details) values(auth.uid(),'chat.settings_updated',p_room_id,jsonb_build_object('version',next_version));
 return next_version;
end;$$;
create function public.update_chat_group_settings(p_room_id uuid,p_title text,p_description text,p_expected_version integer) returns integer language sql security invoker set search_path='' as $$select private.update_chat_group_settings(p_room_id,p_title,p_description,p_expected_version);$$;
revoke all on function private.chat_group_settings(uuid),public.chat_group_settings(uuid),private.update_chat_group_settings(uuid,text,text,integer),public.update_chat_group_settings(uuid,text,text,integer) from public,anon,authenticated;
grant execute on function private.chat_group_settings(uuid),public.chat_group_settings(uuid),private.update_chat_group_settings(uuid,text,text,integer),public.update_chat_group_settings(uuid,text,text,integer) to authenticated;
commit;
