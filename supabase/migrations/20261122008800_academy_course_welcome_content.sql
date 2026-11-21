begin;

-- Welcome reads share the course scope; publication requires the active profile.
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

create or replace function private.publish_course_welcome_content(
  p_run_id uuid, p_description text, p_objectives text,
  p_joining_instructions text, p_expected_version integer
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  context jsonb;
  current_version integer;
begin
  -- Reject unrelated actors before attempting to lock the company and course.
  context := private.course_workspace_context(p_run_id);
  if not ((context->>'staff')::boolean or (context->>'client')::boolean) then
    raise exception 'Course welcome editor required' using errcode = '42501';
  end if;
  if (select edition from private.installation_identity) = 'internal' then
    perform private.lock_course_premium(p_run_id);
  else
    perform private.lock_academy_course_access();
    perform 1 from public.course_runs run
    join public.organisations org on org.id = run.organisation_id
    where run.id = p_run_id and run.archived_at is null and org.archived_at is null
    for no key update of run for share of org;
    if not found then raise insufficient_privilege; end if;
  end if;
  context := private.course_workspace_context(p_run_id);
  if not ((context->>'staff')::boolean or (context->>'client')::boolean) or
     (context->>'lms_enabled')::boolean is not true then
    raise exception 'Course welcome editor required' using errcode = '42501';
  end if;
  if p_expected_version is null or p_expected_version < 0 or
    p_description is null or char_length(p_description) > 4000 or
    p_objectives is null or char_length(p_objectives) > 4000 or
    p_joining_instructions is null or char_length(p_joining_instructions) > 4000
  then
    raise exception 'Invalid course welcome content' using errcode = '22023';
  end if;
  select coalesce(max(version), 0) into current_version
    from private.course_welcome_revisions where course_run_id = p_run_id;
  if current_version <> p_expected_version then
    -- A stale expected version is a business conflict and cannot succeed on retry.
    raise exception 'Course welcome changed' using errcode = 'PT409';
  end if;
  insert into private.course_welcome_revisions(
    course_run_id, version, description, objectives, joining_instructions, published_by
  ) values (
    p_run_id, current_version + 1, trim(p_description), trim(p_objectives),
    trim(p_joining_instructions), auth.uid()
  );
  return private.course_welcome_content(p_run_id);
end;
$$;

notify pgrst, 'reload schema';
commit;
