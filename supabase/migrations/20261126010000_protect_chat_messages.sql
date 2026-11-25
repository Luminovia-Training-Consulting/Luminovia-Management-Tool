begin;

-- Browser Postgres Changes subscriptions need the primary key for their RLS
-- check and the room ID for filtering. The existing per-message RLS policies
-- still enforce membership, personal hiding and the edition transport fence.
-- Realtime's WAL decoder filters the returned columns using role privileges;
-- a PostgreSQL publication column list alone is not that authorization check.
revoke select on table public.messages from public, anon, authenticated;
grant select (id, room_id) on table public.messages to authenticated;

-- Narrow native publication consumers too; keep the same source relation so
-- existing clients still receive INSERT/UPDATE invalidations. Plain SQL replay
-- without Realtime must neither create a publication nor opt in a missing table.
do $$
begin
  if exists (
    select 1 from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime drop table public.messages;
    alter publication supabase_realtime add table public.messages (id, room_id);
  end if;
end;
$$;

-- History, search and audited inspection still use their existing checked
-- projections. This changes neither stored text nor revision/retention policy.
notify pgrst, 'reload schema';
commit;