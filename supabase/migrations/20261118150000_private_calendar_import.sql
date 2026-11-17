begin;
-- Import identifiers are written only through the current-actor batch RPC.
alter table public.personal_events add column import_key text;
create unique index personal_calendar_import_identity on public.personal_events(user_id,import_key) where import_key is not null;
create function public.import_my_calendar(p_events jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); item jsonb; inserted integer:=0; affected integer; import_id text;
begin
 if actor is null or not private.actor_active() then raise insufficient_privilege;end if;
 if p_events is null or jsonb_typeof(p_events)<>'array' then raise exception 'Invalid calendar batch' using errcode='22023';end if;
 if jsonb_array_length(p_events) not between 1 and 500 then raise exception 'Invalid calendar batch' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text||':calendar-import',0));
 for item in select value from jsonb_array_elements(p_events) loop
  if jsonb_typeof(item)<>'object' or length(coalesce(item->>'uid','')) not between 1 and 1024
   or length(trim(coalesce(item->>'title',''))) not between 1 and 200
   or length(coalesce(item->>'description',''))>10000
   or (item->>'starts_at') is null or (item->>'ends_at') is null
   or not isfinite((item->>'starts_at')::timestamptz) or not isfinite((item->>'ends_at')::timestamptz)
   or (item->>'ends_at')::timestamptz<=(item->>'starts_at')::timestamptz
   or not exists(select 1 from pg_timezone_names where name=item->>'time_zone')
  then raise exception 'Invalid imported appointment' using errcode='22023';end if;
  import_id=encode(sha256(convert_to(item->>'uid','UTF8')),'hex');
  -- Skip before INSERT: ordinary overlap triggers still reject new conflicting events.
  if exists(select 1 from public.personal_events where user_id=actor and import_key=import_id) then continue;end if;
  insert into public.personal_events(user_id,title,description,starts_at,ends_at,time_zone,import_key)
   values(actor,item->>'title',coalesce(item->>'description',''),(item->>'starts_at')::timestamptz,(item->>'ends_at')::timestamptz,item->>'time_zone',import_id);
  get diagnostics affected=row_count;inserted=inserted+affected;
 end loop;
 return jsonb_build_object('created',inserted,'skipped',jsonb_array_length(p_events)-inserted);
end;$$;
revoke all on function public.import_my_calendar(jsonb) from public,anon;
grant execute on function public.import_my_calendar(jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
