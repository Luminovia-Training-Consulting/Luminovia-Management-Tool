begin;

-- Move the privileged current-actor implementation out of PostgREST's public
-- schema. The wrapper retains the existing client signature and cannot elevate
-- a submitted user ID; the private implementation still reads auth.uid().
alter function public.import_my_calendar(jsonb) set schema private;

create function public.import_my_calendar(p_events jsonb) returns jsonb
language sql security invoker set search_path='' as $$
  select private.import_my_calendar(p_events);
$$;

revoke all on function private.import_my_calendar(jsonb) from public, anon;
grant execute on function private.import_my_calendar(jsonb) to authenticated;
revoke all on function public.import_my_calendar(jsonb) from public, anon;
grant execute on function public.import_my_calendar(jsonb) to authenticated;

notify pgrst, 'reload schema';
commit;
