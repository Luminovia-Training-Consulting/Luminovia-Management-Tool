begin;

-- Publish or remove pre-existing, checked material without opening file intake.
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
    '/rpc/course_chat_rooms', '/rpc/course_chat_messages'
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
      '/rpc/academy_course_material_action'
    ))
  ) then
    return;
  end if;

  raise exception 'Academy course operation unavailable' using errcode = '42501';
end;
$$;

create function private.academy_course_material_action(
  p_run_id uuid, p_action text, p_id uuid, p_audience text, p_category text
)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  document_id uuid;
begin
  perform private.lock_academy_course_access();
  perform 1 from public.profiles where id = actor_id and active for share;
  if not found then raise insufficient_privilege; end if;
  perform 1 from public.user_roles where user_id = actor_id order by role for share;
  -- Instructor release serializes on this same course row. Recheck the
  -- assignment after waiting for any earlier course or identity change.
  perform 1 from public.course_runs run
  join public.organisations org on org.id = run.organisation_id
  where run.id = p_run_id and run.archived_at is null and org.archived_at is null
  for no key update of run for share of org;
  if not found or not private.lecturer_actor() or
     not private.course_has_current_teacher(p_run_id) then
    raise insufficient_privilege;
  end if;

  if p_action = 'resource_share' and p_id is not null then
    select document.id into document_id
    from public.document_versions version
    join public.documents document on document.id = version.document_id
    where version.id = p_id and version.status = 'clean'
      and version.sha256 ~ '^[0-9a-f]{64}$'
      and nullif(btrim(version.scanner_version), '') is not null
      and document.owner_id = actor_id and document.uploaded_by = actor_id
      and version.uploaded_by = actor_id
      and document.scope = 'personal' and document.kind = 'material'
      and document.deleted_at is null
    for update of document for share of version;
    if not found or private.deletion_document_fenced(document_id) then
      raise insufficient_privilege;
    end if;
    return private.course_resource_command(p_run_id, p_action,
      jsonb_build_object('version_id', p_id, 'audience', p_audience, 'category', p_category));
  elsif p_action = 'resource_remove' and p_id is not null
     and p_audience is null and p_category is null then
    perform 1 from private.course_resources resource
    join public.document_versions version on version.id = resource.version_id
    join public.documents document on document.id = version.document_id
    where resource.id = p_id and resource.run_id = p_run_id and resource.removed_at is null
      and resource.created_by = actor_id and document.owner_id = actor_id
      and document.uploaded_by = actor_id and version.uploaded_by = actor_id
      and document.scope = 'personal' and document.kind = 'material'
    for update of resource;
    if not found then raise insufficient_privilege; end if;
    return private.course_resource_command(p_run_id, p_action, jsonb_build_object('id', p_id));
  end if;

  raise exception 'Invalid course material command' using errcode = '22023';
end;
$$;

create function public.academy_course_material_action(
  p_run_id uuid, p_action text, p_id uuid, p_audience text default null, p_category text default null
)
returns jsonb
language sql security invoker set search_path = '' as $$
  select private.academy_course_material_action(p_run_id, p_action, p_id, p_audience, p_category);
$$;

revoke all on function private.academy_course_material_action(uuid, text, uuid, text, text),
  public.academy_course_material_action(uuid, text, uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function private.academy_course_material_action(uuid, text, uuid, text, text),
  public.academy_course_material_action(uuid, text, uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
commit;
