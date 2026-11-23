begin;

-- The existing workspace context checks an active manager, confirmed teacher
-- or the current course company before this standard projection can be read.
-- Select base course data only, without querying retained LMS tables.
create function private.standard_course_workspace(p_run_id uuid, p_context jsonb)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', run.id, 'title', template.title, 'description', template.description,
    'syllabus', template.syllabus, 'time_zone', run.time_zone,
    'delivery_type', run.delivery_type,
    'venue', case when run.delivery_type = 'onsite' then run.venue else '' end,
    'access', p_context, 'lms_enabled', false, 'settings_version', 0,
    'ended', coalesce(schedule.last_end < now(), false),
    'sessions', schedule.sessions,
    'contact', null, 'contact_options', '[]'::jsonb,
    'preparation', '[]'::jsonb, 'resources', '[]'::jsonb, 'share_options', '[]'::jsonb,
    'questions', '[]'::jsonb, 'notebook', jsonb_build_object('body', '', 'version', 0),
    'feedback', null, 'feedback_summary', null, 'quiz', null, 'completion', null,
    'repeat_request', null, 'roster', '[]'::jsonb, 'attendance_history', '[]'::jsonb,
    'exams', jsonb_build_object('required', false, 'version', null, 'can_edit', false, 'documents', '[]'::jsonb)
  )
  from public.course_runs run
  join public.course_templates template on template.id = run.template_id
  cross join lateral (
    select max(session.ends_at) as last_end,
      coalesce(jsonb_agg(jsonb_build_object(
        'id', session.id, 'starts_at', session.starts_at, 'ends_at', session.ends_at,
        'attendance', null, 'minutes', null, 'version', 0,
        'can_check_in', false, 'can_verify', false
      ) order by session.starts_at, session.id), '[]'::jsonb) as sessions
    from public.course_sessions session where session.course_run_id = run.id
  ) schedule
  where run.id = p_run_id and run.archived_at is null;
$$;

revoke all on function private.standard_course_workspace(uuid, jsonb)
from public, anon, authenticated, service_role;

do $migration$
declare
  workspace text := pg_get_functiondef('private.course_workspace(uuid)'::regprocedure);
  meeting text := pg_get_functiondef('private.course_workspace_with_meeting_link(uuid)'::regprocedure);
  premium_guard constant text := $guard$raise exception 'company_premium_lms_off' using errcode = '42501';$guard$;
  meeting_guard constant text := $guard$if workspace->>'delivery_type' <> 'online' or (workspace->>'ended')::boolean then$guard$;
begin
  if cardinality(string_to_array(workspace, premium_guard)) <> 2
    or cardinality(string_to_array(meeting, meeting_guard)) <> 2 then
    raise exception 'Expected current course workspace and meeting link guards';
  end if;
  execute replace(workspace, premium_guard, $standard$
    if (select edition from private.installation_identity) = 'internal' then
      return private.standard_course_workspace(p_run_id, context);
    end if;
    raise exception 'company_premium_lms_off' using errcode = '42501';
  $standard$);
  execute replace(meeting, meeting_guard, $standard$
    if (workspace->>'lms_enabled')::boolean is not true
      or workspace->>'delivery_type' <> 'online' or (workspace->>'ended')::boolean then
  $standard$);
end;
$migration$;

commit;
