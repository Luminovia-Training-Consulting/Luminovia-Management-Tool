begin;
-- Keep the PostgREST-facing API invoker-only; the reviewed implementation
-- continues to bind every imported row to auth.uid() inside the private schema.
alter function public.import_my_calendar(jsonb) set schema private;
revoke all on function private.import_my_calendar(jsonb)
  from public,anon,authenticated,service_role;

create function public.import_my_calendar(p_events jsonb)
returns jsonb language sql security invoker set search_path=''
as $$select private.import_my_calendar(p_events);$$;

revoke all on function public.import_my_calendar(jsonb)
  from public,anon,service_role;
grant execute on function private.import_my_calendar(jsonb),public.import_my_calendar(jsonb)
  to authenticated;
notify pgrst,'reload schema';
commit;
