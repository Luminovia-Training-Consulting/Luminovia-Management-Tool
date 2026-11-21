begin;

-- One opaque version per participant room. The publication carries no message,
-- actor, document or business identifiers other than the room selector.
create table public.course_chat_activity (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null unique references public.chat_rooms(id) on delete cascade,
  revision uuid not null default gen_random_uuid()
);
alter table public.course_chat_activity enable row level security;

-- Keep the default replica identity. A physical cascade has only the opaque
-- primary key in WAL, never the room selector or previous revision.
alter table public.course_chat_activity replica identity default;
revoke all on public.course_chat_activity from public, anon, authenticated, service_role;
grant select on public.course_chat_activity to authenticated;

-- Postgres Changes evaluates this SELECT policy for each insert/update. Company
-- contacts may refresh their authorised read-only history without joining the
-- raw messages publication. Admin inspection does not grant this bypass.
create function private.can_read_course_chat_activity(p_room_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.chat_rooms room
    where room.id = p_room_id
      and room.kind = 'participant_course'
      and (private.can_access_chat_room(room.id) or private.company_course_chat_reader(room.id))
  );
$$;
revoke all on function private.can_read_course_chat_activity(uuid) from public, anon, authenticated, service_role;
grant execute on function private.can_read_course_chat_activity(uuid) to authenticated;
create policy course_chat_activity_read on public.course_chat_activity
for select to authenticated using (private.can_read_course_chat_activity(room_id));

-- The marker and accepted mutation are committed together. No routine may
-- request or synthesize a signal for a room through an application-role grant.
create function private.touch_course_chat_activity()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (
    select 1 from public.chat_rooms room
    where room.id = new.room_id and room.kind = 'participant_course'
  ) then
    insert into public.course_chat_activity (room_id) values (new.room_id)
    on conflict (room_id) do update set revision = excluded.revision;
  end if;
  return null;
end;
$$;
revoke all on function private.touch_course_chat_activity() from public, anon, authenticated, service_role;
create trigger touch_course_chat_activity
after insert or update of body, deleted_at, document_id on public.messages
for each row execute function private.touch_course_chat_activity();

-- Plain PostgreSQL replays omit the Realtime publication. Keep those databases
-- usable without enabling logical replication or creating a parallel service.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.course_chat_activity;
  end if;
end;
$$;

notify pgrst, 'reload schema';
commit;
