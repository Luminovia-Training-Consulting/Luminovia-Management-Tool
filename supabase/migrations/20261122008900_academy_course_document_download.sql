begin;

-- The existing authenticated Edge gateway uses this one POST RPC. Raw
-- Storage, other RPCs and course-document kinds remain edition fenced.
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
    '/rpc/course_workspace_entitlement', '/rpc/course_enrolments', '/rpc/course_welcome_content'
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
      '/rpc/publish_course_welcome_content'
    ))
  ) then
    return;
  end if;

  raise exception 'Academy course operation unavailable' using errcode = '42501';
end;
$$;

-- Reuse the exact-version resolver for checked course-resource downloads.
create or replace function private.course_document_access(p_kind text, p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  run_id uuid;
  context jsonb;
  resolved jsonb;
  dedicated boolean := (select edition from private.installation_identity) is distinct from 'internal';
begin
  -- Keep direct SQL invocation subject to the same edition and release policy.
  if dedicated and (p_kind is distinct from 'resource' or not coalesce(
    private.academy_course_access_status() in ('active', 'grace'), false
  )) then
    raise exception 'Academy course file unavailable' using errcode = '42501';
  end if;
  if p_kind = 'exam' then
    return private.course_exam_document_access(p_id);
  end if;
  if p_kind = 'resource' then
    select resource.run_id into run_id
    from private.course_resources resource where resource.id = p_id;
  elsif p_kind = 'completion' then
    select record.run_id into run_id
    from private.course_completion_records record
    where record.id = p_id and record.revoked_at is null;
  elsif p_kind = 'attendance' then
    run_id := p_id;
  end if;
  if run_id is not null then
    context := private.course_workspace_context(run_id);
    if not coalesce((context->>'lms_enabled')::boolean, false) then
      raise exception 'Company Premium LMS is OFF' using errcode = '42501';
    end if;
  end if;
  -- The existing resolver checks the current course audience and returns
  -- the exact clean, non-deleted, non-dedicated version pinned by the share.
  resolved := private.course_document_access_before_premium(p_kind, p_id);
  if dedicated and not coalesce((resolved->>'sha256') ~ '^[0-9a-f]{64}$', false) then
    raise exception 'Academy course file unavailable' using errcode = '42501';
  end if;
  return resolved;
end;
$$;

notify pgrst, 'reload schema';
commit;
