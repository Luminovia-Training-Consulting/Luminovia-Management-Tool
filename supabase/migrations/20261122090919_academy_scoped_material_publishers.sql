begin;

-- The scanner revalidates the recorded uploader, even when the worker itself
-- has no human session. Match the live workspace roles and exact company scope.
create function private.academy_material_publisher(p_run_id uuid, p_actor_id uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists (
    select 1 from public.course_runs run
    join public.organisations org on org.id = run.organisation_id and org.archived_at is null
    join public.profiles actor on actor.id = p_actor_id and actor.active
    where run.id = p_run_id and run.archived_at is null and (
      private.academy_course_teacher(run.id, actor.id)
      or exists (
        select 1 from public.user_roles role
        join public.role_permissions permission using (role)
        where role.user_id = actor.id and permission.permission = 'courses.manage'
      )
      or exists (
        select 1 from public.client_organisation_memberships membership
        join public.user_roles role on role.user_id = membership.user_id and role.role = 'client'
        where membership.user_id = actor.id and membership.organisation_id = org.id
          and membership.removed_at is null
      )
    )
  );
$$;
revoke all on function private.academy_material_publisher(uuid, uuid) from public, anon, authenticated, service_role;

create function private.lock_academy_material_publisher(p_run_id uuid, p_actor_id uuid)
returns text language plpgsql security invoker set search_path = '' as $$
declare company_id uuid;
begin
  perform private.lock_academy_course_access();
  perform 1 from public.profiles where id = p_actor_id and active for share;
  if not found then raise insufficient_privilege; end if;
  perform 1 from public.user_roles where user_id = p_actor_id order by role for share;
  select org.id into company_id
  from public.course_runs run join public.organisations org on org.id = run.organisation_id
  where run.id = p_run_id and run.archived_at is null and org.archived_at is null
  for no key update of run for share of org;
  if not found then raise insufficient_privilege; end if;
  perform 1 from public.client_organisation_memberships
    where user_id = p_actor_id and organisation_id = company_id for share;
  if not private.academy_material_publisher(p_run_id, p_actor_id) then
    raise insufficient_privilege;
  end if;
  return (select release_commit from private.academy_course_access);
end;
$$;
revoke all on function private.lock_academy_material_publisher(uuid, uuid) from public, anon, authenticated, service_role;

-- Replace just the material authority in the shared intake/status functions.
-- Preserve the independent exam and attendance purposes and scanner leases.
do $migration$
declare
  intake text := pg_catalog.pg_get_functiondef('private.lock_academy_file_intake(uuid,uuid,text)'::regprocedure);
  status text := pg_catalog.pg_get_functiondef('private.academy_course_material_status(uuid,uuid,uuid)'::regprocedure);
  workspace text := pg_catalog.pg_get_functiondef('private.course_workspace(uuid)'::regprocedure);
  intake_anchor constant text := 'return private.lock_academy_material_teacher(p_run_id, p_actor_id);';
  status_anchor constant text := 'else private.lecturer_actor() and private.academy_course_teacher(p_run_id, auth.uid())';
  workspace_anchor constant text := $existing$'can_remove', (context->>'manager')::boolean or
      ((context->>'client')::boolean and resource.ownership_kind = 'company') or
      ((context->>'teacher')::boolean and resource.ownership_kind = 'lecturer' and
       resource.created_by = auth.uid())$existing$;
begin
  if cardinality(string_to_array(intake, intake_anchor)) <> 2
    or cardinality(string_to_array(status, status_anchor)) <> 2
    or cardinality(string_to_array(workspace, workspace_anchor)) <> 2 then
    raise exception 'Expected exact current Academy material and workspace authorities';
  end if;
  execute replace(intake, intake_anchor, 'return private.lock_academy_material_publisher(p_run_id, p_actor_id);');
  execute replace(status, status_anchor, $replacement$else intake.purpose = 'material' and private.academy_material_publisher(p_run_id, auth.uid())$replacement$);
  execute replace(workspace, workspace_anchor, $replacement$'can_remove',
    ((select edition from private.installation_identity) = 'internal' or resource.created_by = auth.uid()) and (
      (context->>'manager')::boolean or
      ((context->>'client')::boolean and resource.ownership_kind = 'company') or
      ((context->>'teacher')::boolean and resource.ownership_kind = 'lecturer' and
       resource.created_by = auth.uid())
    )$replacement$);
end;
$migration$;

drop function private.lock_academy_material_teacher(uuid, uuid);

create or replace function private.academy_course_material_action(
  p_run_id uuid, p_action text, p_id uuid, p_audience text, p_category text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  current_release text;
  intake private.academy_course_material_intake%rowtype;
  document_id uuid;
begin
  current_release := private.lock_academy_material_publisher(p_run_id, actor_id);
  if p_action = 'resource_share' and p_id is not null then
    select * into intake from private.academy_course_material_intake where version_id = p_id;
    if found then
      if intake.run_id <> p_run_id or intake.purpose <> 'material' or
        intake.release_commit <> current_release then
        raise insufficient_privilege;
      end if;
    elsif not private.academy_course_teacher(p_run_id, actor_id) then
      -- Existing lecturer-owned, pre-intake versions remain compatible.
      raise insufficient_privilege;
    end if;

    select document.id into document_id
    from public.document_versions version join public.documents document on document.id = version.document_id
    where version.id = p_id and version.status = 'clean'
      and version.sha256 ~ '^[0-9a-f]{64}$'
      and nullif(btrim(version.scanner_version), '') is not null
      and (intake.version_id is null or version.sha256 = intake.expected_sha256)
      and document.owner_id = actor_id and document.uploaded_by = actor_id
      and version.uploaded_by = actor_id and document.scope = 'personal'
      and document.kind = 'material' and document.deleted_at is null
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

drop function private.academy_course_material_action_before_intake(uuid, text, uuid, text, text);

notify pgrst, 'reload schema';
commit;
