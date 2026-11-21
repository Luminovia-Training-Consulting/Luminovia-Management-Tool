begin;

-- Generate one session's report from the same authorised roster as its
-- register. Free-text notes, correction history and evidence stay in the register.
create function private.academy_attendance_report(p_session_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  course_id uuid;
  course_title text;
  register jsonb;
begin
  select session.course_run_id, template.title into course_id, course_title
  from public.course_sessions session
  join public.course_runs run on run.id = session.course_run_id
  join public.course_templates template on template.id = run.template_id
  where session.id = p_session_id;
  if not found then raise insufficient_privilege; end if;

  register := private.course_session_register(course_id, p_session_id);
  return jsonb_build_object(
    'report_scope', 'session',
    'id', course_id,
    'course', course_title,
    'time_zone', register->'time_zone',
    'sessions', jsonb_build_array(jsonb_build_object(
      'id', p_session_id, 'starts_at', register->'starts_at', 'ends_at', register->'ends_at'
    )),
    'roster', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', entry.value->'user_id', 'name', entry.value->'name',
        'sessions', jsonb_build_array(jsonb_build_object(
          'session_id', p_session_id, 'status', entry.value->'status',
          'arrival_at', entry.value->'arrival_at', 'departure_at', entry.value->'departure_at',
          'minutes', case when entry.value->>'status' is not null then attendance.minutes end
        ))
      ) order by entry.rank)
      from jsonb_array_elements(register->'rows') with ordinality entry(value, rank)
      left join private.course_attendance attendance on attendance.session_id = p_session_id
        and attendance.user_id = (entry.value->>'user_id')::uuid
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function private.academy_attendance_report(uuid) from public, anon, authenticated, service_role;

-- Keep internal course-wide attendance and every other installed document
-- kind unchanged. Dedicated attendance uses the selected register's session.
do $$
declare
  definition text := pg_catalog.pg_get_functiondef('private.course_document_access(text,uuid)'::regprocedure);
  kinds constant text := 'p_kind not in (''resource'', ''exam'', ''completion'')';
  branch constant text := 'elsif p_kind = ''attendance'' then';
begin
  if cardinality(string_to_array(definition, kinds)) <> 2
     or cardinality(string_to_array(definition, branch)) <> 2 then
    raise exception 'Expected one academy attendance document branch';
  end if;
  execute replace(replace(definition, kinds, 'p_kind not in (''resource'', ''exam'', ''completion'', ''attendance'')'),
    branch, branch || ' if dedicated then return private.academy_attendance_report(p_id); end if;');
end;
$$;

notify pgrst, 'reload schema';
commit;
