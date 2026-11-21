begin;

-- Add the existing versioned editor to the exact-licence academy profile.
-- Write access requires active status as well as the editor's current course scope.
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
    '/rpc/course_workspace_entitlement', '/rpc/course_enrolments'
  ) then
    return;
  end if;
  if licence_status = 'active' and (
    (request_method in ('GET', 'HEAD', 'POST') and request_path in (
      '/rpc/academy_course_instructor_candidates', '/rpc/course_enrolment_candidates'
    ))
    or (request_method = 'POST' and request_path in (
      '/rpc/academy_assign_course_instructor', '/rpc/academy_release_course_instructor',
      '/rpc/manage_course_enrolment', '/rpc/set_course_meeting_link'
    ))
  ) then
    return;
  end if;

  raise exception 'Academy course operation unavailable' using errcode = '42501';
end;
$$;

-- During licence grace, scoped course readers can open a saved link.
create or replace function private.course_workspace_with_meeting_link(p_run_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  workspace jsonb := private.course_workspace(p_run_id);
  link private.course_meeting_links%rowtype;
begin
  if workspace->>'delivery_type' <> 'online' or (workspace->>'ended')::boolean then
    return workspace || jsonb_build_object('meeting_link', null);
  end if;
  select * into link from private.course_meeting_links where course_run_id = p_run_id;
  return workspace || jsonb_build_object(
    'meeting_link', jsonb_build_object(
      'url', link.url, 'version', coalesce(link.version, 0),
      'can_edit', (workspace#>>'{access,staff}')::boolean and (
        (select edition from private.installation_identity) = 'internal'
        or coalesce(private.academy_course_access_status() = 'active', false)
      )
    )
  );
end;
$$;

create or replace function public.course_workspace(p_run_id uuid)
returns jsonb language sql stable security invoker set search_path = ''
as $$
  select case
    when (select edition from public.installation_capability_state) = 'internal' then workspace.data
    else workspace.data || jsonb_build_object('repeat_request', null)
  end
  from (select private.course_workspace_with_meeting_link(p_run_id) as data) workspace;
$$;

-- Apply the same HTTPS, optimistic version and audit rules in every edition.
create or replace function private.set_course_meeting_link(
  p_run_id uuid, p_url text, p_expected_version integer
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  context jsonb;
  authority text;
  port text;
  link private.course_meeting_links%rowtype;
  current_version integer;
begin
  context := private.course_workspace_context(p_run_id);
  if (context->>'staff')::boolean is not true then
    raise exception 'Course meeting link editor required' using errcode = '42501';
  end if;
  if (select edition from private.installation_identity) = 'internal' then
    perform private.lock_course_premium(p_run_id);
  else
    -- Take the same licence and course locks as instructor release. Recheck
    -- the actor below if the assignment or course changes while we wait.
    perform private.lock_academy_course_access();
    perform 1 from public.course_runs run
    join public.organisations org on org.id = run.organisation_id
    where run.id = p_run_id and run.archived_at is null and org.archived_at is null
    for no key update of run for share of org;
    if not found then raise insufficient_privilege; end if;
  end if;
  context := private.course_workspace_context(p_run_id);
  if (context->>'staff')::boolean is not true or
     (context->>'lms_enabled')::boolean is not true or not exists (
       select 1 from public.course_runs run
       where run.id = p_run_id and run.archived_at is null and run.delivery_type = 'online'
         and coalesce((
           select max(session.ends_at) >= now()
           from public.course_sessions session where session.course_run_id = run.id
         ), true)
     ) then
    raise exception 'Course meeting link unavailable' using errcode = '42501';
  end if;
  if p_expected_version is null or p_expected_version < 0 then
    raise exception 'Invalid course meeting link version' using errcode = '22023';
  end if;
  if p_url is not null then
    -- Use the same printable ASCII HTTPS DNS-host grammar as the browser editor.
    -- Matching the authority separately also excludes embedded credentials.
    if char_length(p_url) > 2048 or p_url collate "C" !~ '^[!-~]+$' or
       strpos(p_url, chr(92)) > 0 then
      raise exception 'Invalid HTTPS course meeting link' using errcode = '22023';
    end if;
    authority := substring(p_url from '^https://([^/?#]+)');
    if authority is null or authority collate "C" !~
      '^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?[.])+[a-zA-Z]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(:[0-9]{1,5})?$'
      or char_length(split_part(authority, ':', 1)) > 253 then
      raise exception 'Invalid HTTPS course meeting link' using errcode = '22023';
    end if;
    port := nullif(split_part(authority, ':', 2), '');
    if port is not null and port::integer not between 1 and 65535 then
      raise exception 'Invalid HTTPS course meeting link' using errcode = '22023';
    end if;
  end if;
  select * into link from private.course_meeting_links where course_run_id = p_run_id;
  current_version := coalesce(link.version, 0);
  if current_version <> p_expected_version then
    raise exception 'Course meeting link changed' using errcode = 'PT409';
  end if;
  if link.url is distinct from p_url then
    current_version := current_version + 1;
    insert into private.course_meeting_links(course_run_id, url, version)
      values (p_run_id, p_url, current_version)
      on conflict (course_run_id) do update set url = excluded.url, version = excluded.version;
    insert into public.audit_events(actor_id, action, resource_id, details)
      values (auth.uid(), 'course.meeting_link.updated', p_run_id,
              jsonb_build_object('version', current_version, 'configured', p_url is not null));
  end if;
  return jsonb_build_object('url', p_url, 'version', current_version, 'can_edit', true);
end;
$$;

notify pgrst, 'reload schema';
commit;
