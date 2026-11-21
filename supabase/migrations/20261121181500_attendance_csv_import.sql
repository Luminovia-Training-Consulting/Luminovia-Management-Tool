begin;

-- Apply a reviewed register import as one database operation. Each row goes
-- through the same role, session, timestamp and version checks as one-click marking.
create function private.import_course_session_attendance(
  p_run_id uuid,p_session_id uuid,p_rows jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  item jsonb;
  seen integer;
begin
  perform private.course_workspace_context(p_run_id);
  perform private.lock_course_premium(p_run_id);
  if jsonb_typeof(p_rows) is distinct from 'array' or pg_column_size(p_rows)>350000 then
    raise exception 'Invalid attendance import' using errcode='22023';
  end if;
  if jsonb_array_length(p_rows) not between 1 and 200 then
    raise exception 'Invalid attendance import size' using errcode='22023';
  end if;
  for item in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(item) <> 'object' or not (
      item ?& array['user_id','status','arrival_at','departure_at','note','reason','expected_version']
    ) or item - array['user_id','status','arrival_at','departure_at','note','reason','expected_version'] <> '{}'::jsonb
      or jsonb_typeof(item->'user_id') <> 'string'
      or jsonb_typeof(item->'status') <> 'string'
      or jsonb_typeof(item->'note') <> 'string'
      or jsonb_typeof(item->'reason') <> 'string'
      or jsonb_typeof(item->'expected_version') <> 'number'
      or jsonb_typeof(item->'arrival_at') not in ('string','null')
      or jsonb_typeof(item->'departure_at') not in ('string','null')
      or (item->>'arrival_at' is not null and item->>'arrival_at' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$')
      or (item->>'departure_at' is not null and item->>'departure_at' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$')
    then raise exception 'Invalid attendance import row' using errcode='22023'; end if;
  end loop;
  select count(distinct (value->>'user_id')::uuid) into seen from jsonb_array_elements(p_rows);
  if seen<>jsonb_array_length(p_rows) then
    raise exception 'Duplicate participant in attendance import' using errcode='22023';
  end if;
  for item in select value from jsonb_array_elements(p_rows) order by (value->>'user_id')::uuid loop
    perform private.save_course_session_attendance(
      p_run_id,p_session_id,(item->>'user_id')::uuid,item->>'status',
      (item->>'arrival_at')::timestamptz,(item->>'departure_at')::timestamptz,
      item->>'note',item->>'reason',(item->>'expected_version')::integer
    );
  end loop;
  return jsonb_build_object('saved', seen);
end;
$$;
create function public.import_course_session_attendance(p_run_id uuid,p_session_id uuid,p_rows jsonb)
returns jsonb language sql security invoker set search_path='' as $$
  select private.import_course_session_attendance(p_run_id,p_session_id,p_rows);
$$;
revoke all on function private.import_course_session_attendance(uuid,uuid,jsonb),
  public.import_course_session_attendance(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.import_course_session_attendance(uuid,uuid,jsonb),
  public.import_course_session_attendance(uuid,uuid,jsonb) to authenticated;
commit;
