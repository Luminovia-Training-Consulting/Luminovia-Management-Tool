begin;

-- A confirmed spreadsheet uses the canonical session writer for every row.
-- A version or scope failure rolls back both the register and its audit entries.
create or replace function private.import_course_session_attendance(
  p_run_id uuid,p_session_id uuid,p_rows jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  context jsonb := private.course_workspace_context(p_run_id);
  item jsonb;
  seen integer;
begin
  if not ((context->>'manager')::boolean or (context->>'teacher')::boolean or
          (context->>'client')::boolean) then raise insufficient_privilege; end if;
  if (select edition from private.installation_identity) = 'internal' then
    perform private.lock_course_premium(p_run_id);
  else
    perform private.lock_academy_course_access();
  end if;
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
  insert into public.audit_events(actor_id, action, resource_id, details)
  values (auth.uid(), 'course.attendance_imported', p_session_id,
    jsonb_build_object('course_run_id', p_run_id, 'saved', seen));
  return jsonb_build_object('saved', seen);
end;
$$;

-- Admit only the authenticated POST through the active academy write branch.
do $$
declare
  definition text := pg_catalog.pg_get_functiondef('private.require_academy_course_access()'::regprocedure);
  endpoint constant text := '''/rpc/save_course_session_attendance''';
begin
  if cardinality(string_to_array(definition, endpoint)) <> 2 then
    raise exception 'Expected exactly one academy attendance write endpoint';
  end if;
  execute replace(definition, endpoint, endpoint || ', ''/rpc/import_course_session_attendance''');
end;
$$;

notify pgrst, 'reload schema';
commit;
