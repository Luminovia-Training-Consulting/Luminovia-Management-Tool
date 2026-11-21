begin;

-- An outdated version requires a fresh register read, not a transaction
-- retry. Preserve all other serializer failures for their original callers.
do $$
declare
  definition text := pg_catalog.pg_get_functiondef(
    'private.save_course_session_attendance_before_premium_lock(uuid,uuid,uuid,text,timestamptz,timestamptz,text,text,integer)'::regprocedure);
  predecessor constant text := 'raise exception ''Attendance changed'' using errcode=''40001''';
begin
  if cardinality(string_to_array(definition, predecessor)) <> 2 then
    raise exception 'Expected exactly one attendance version conflict';
  end if;
  execute replace(definition, predecessor, 'raise exception ''Attendance changed'' using errcode=''PT409''');
end;
$$;

-- The academy register reads the same audited rows as the internal edition.
-- Files attached by other register workflows are outside this release profile.
do $$
declare
  definition text := pg_catalog.pg_get_functiondef('private.course_session_register(uuid,uuid)'::regprocedure);
  insertion constant text := '''evidence'',coalesce((select jsonb_agg(jsonb_build_object(';
  evidence_end constant text := 'where evidence.session_id=session_row.id),''[]''::jsonb),';
begin
  if cardinality(string_to_array(definition, insertion)) <> 2 or
     cardinality(string_to_array(definition, evidence_end)) <> 2 then
    raise exception 'Expected one register evidence projection';
  end if;
  execute replace(
    replace(definition, insertion, '''evidence'',case when (select edition from private.installation_identity) = ''internal''
      then coalesce((select jsonb_agg(jsonb_build_object('),
    evidence_end,
    'where evidence.session_id=session_row.id),''[]''::jsonb) else ''[]''::jsonb end,'
  );
end;
$$;

create or replace function private.save_course_session_attendance(
  p_run_id uuid,p_session_id uuid,p_user_id uuid,p_status text,
  p_arrival_at timestamptz,p_departure_at timestamptz,p_note text,
  p_reason text,p_expected_version integer
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  course_org_id uuid;
  actor_id uuid := auth.uid();
  context jsonb;
begin
  context := private.course_workspace_context(p_run_id);
  if (select edition from private.installation_identity) = 'internal' then
    perform private.lock_course_premium(p_run_id);
  else
    if not ((context->>'manager')::boolean or (context->>'teacher')::boolean or
            (context->>'client')::boolean) then raise insufficient_privilege; end if;
    perform private.lock_academy_course_access();
    perform 1 from public.profiles where id = actor_id and active for share;
    if not found then raise insufficient_privilege; end if;
    perform 1 from public.user_roles where user_id = actor_id order by role for share;
    -- Serialize with assignment, archive and enrolment changes before the
    -- canonical writer checks the caller's current role and exact session.
    select org.id into course_org_id
    from public.course_runs run join public.organisations org on org.id = run.organisation_id
    where run.id = p_run_id and run.archived_at is null and org.archived_at is null
    for no key update of run for share of org;
    if not found then raise insufficient_privilege; end if;
    perform 1 from public.client_organisation_memberships membership
    where membership.organisation_id = course_org_id and membership.user_id = actor_id
    for share;
    perform 1 from public.course_sessions session
    where session.course_run_id = p_run_id and session.id = p_session_id for share;
    if not found then raise insufficient_privilege; end if;
    perform 1 from public.course_enrolments enrolment
    where enrolment.course_run_id = p_run_id and enrolment.user_id = p_user_id
      and enrolment.status in ('enrolled', 'completed') for share;
    if not found then raise insufficient_privilege; end if;
  end if;
  return private.save_course_session_attendance_before_premium_lock(
    p_run_id,p_session_id,p_user_id,p_status,p_arrival_at,p_departure_at,
    p_note,p_reason,p_expected_version
  );
end;
$$;

create or replace function private.require_academy_course_access()
returns void language plpgsql stable security definer set search_path = '' as $$
declare
  request_path text := current_setting('request.path', true);
  request_method text := current_setting('request.method', true);
  request_headers jsonb := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
  licence_status text;
begin
  if current_setting('role', true) is distinct from 'authenticated'
     or coalesce(request_headers->>'accept-profile', 'public') <> 'public'
     or coalesce(request_headers->>'content-profile', 'public') <> 'public'
     or not private.learning_actor() then
    raise insufficient_privilege;
  end if;

  licence_status := private.academy_course_access_status();
  if licence_status in ('active', 'grace') and request_method in ('GET', 'HEAD', 'POST') and request_path in (
    '/rpc/portal_access', '/rpc/my_course_workspaces', '/rpc/course_workspace',
    '/rpc/course_workspace_entitlement', '/rpc/course_enrolments', '/rpc/course_welcome_content',
    '/rpc/course_chat_rooms', '/rpc/course_chat_messages', '/rpc/course_session_register'
  ) then
    return;
  end if;
  if licence_status in ('active', 'grace') and request_method = 'POST'
     and request_path = '/rpc/course_document_access' then
    return;
  end if;
  if licence_status = 'active' and (
    (request_method in ('GET', 'HEAD', 'POST') and request_path in (
      '/rpc/academy_course_instructor_candidates', '/rpc/course_enrolment_candidates'
    ))
    or (request_method = 'POST' and request_path in (
      '/rpc/academy_assign_course_instructor', '/rpc/academy_release_course_instructor',
      '/rpc/manage_course_enrolment', '/rpc/set_course_meeting_link', '/rpc/save_course_run',
      '/rpc/publish_course_welcome_content', '/rpc/academy_ensure_course_chat', '/rpc/send_course_chat_message',
      '/rpc/academy_course_material_action', '/rpc/reserve_academy_course_material',
      '/rpc/academy_course_material_status', '/rpc/save_course_session_attendance'
    ))
  ) then
    return;
  end if;

  raise exception 'Academy course operation unavailable' using errcode = '42501';
end;
$$;

notify pgrst, 'reload schema';
commit;
