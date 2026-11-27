begin;

-- Only ordinary published material shares can move to Standard. Reports,
-- attendance evidence and examination files keep their existing gateways.
create function private.standard_course_material_version(p_version_id uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists (
    select 1 from public.document_versions version
    join public.documents document on document.id = version.document_id
    where version.id = p_version_id and document.kind = 'material'
      and version.status = 'clean' and document.deleted_at is null
      and not private.course_document_is_dedicated(document.id)
      and not exists (
        select 1 from private.course_attendance_evidence evidence
        where evidence.version_id = version.id
      )
      and not exists (
        select 1 from private.course_exam_documents exam where exam.version_id = version.id
      )
  );
$$;

create function private.standard_course_material(p_resource_id uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists (
    select 1 from private.course_resources resource
    where resource.id = p_resource_id and resource.removed_at is null
      and resource.category = 'material'
      and private.standard_course_material_version(resource.version_id)
      and not exists (
        select 1 from private.course_attendance_evidence evidence
        where evidence.resource_id = resource.id
      )
  );
$$;
revoke all on function private.standard_course_material_version(uuid),
  private.standard_course_material(uuid) from public, anon, authenticated, service_role;

do $migration$
declare
  allowed text := pg_catalog.pg_get_functiondef('private.course_resource_allowed(uuid)'::regprocedure);
  resolver text := pg_catalog.pg_get_functiondef('private.course_document_access(text,uuid)'::regprocedure);
  writer text := pg_catalog.pg_get_functiondef(
    'private.course_workspace_action_before_gradebook(uuid,text,jsonb,integer)'::regprocedure
  );
  command text := pg_catalog.pg_get_functiondef('private.course_resource_command(uuid,text,jsonb)'::regprocedure);
  workspace text := pg_catalog.pg_get_functiondef('private.standard_course_workspace(uuid,jsonb)'::regprocedure);
  allowed_context constant text := 'context := private.course_workspace_context(resource_row.run_id);';
  premium_guard constant text := $old$if not coalesce((context->>'lms_enabled')::boolean, false) then return false; end if;$old$;
  resolver_context constant text := 'context := private.course_workspace_context(run_id);';
  resolver_guard constant text := $old$if not coalesce((context->>'lms_enabled')::boolean, false) then$old$;
  write_lock constant text := '  perform private.lock_course_premium(p_run_id);';
  writer_begin constant text := $old$begin
  perform private.lock_course_premium(p_run_id);$old$;
  command_context constant text := 'context := private.course_workspace_context(p_run_id);';
  command_guard constant text := $old$not coalesce((context->>'lms_enabled')::boolean, false)$old$;
  recategorize constant text := '    if found then';
  resource_empty constant text := $old$'resources', '[]'::jsonb$old$;
  share_empty constant text := $old$'share_options', '[]'::jsonb$old$;
begin
  if cardinality(string_to_array(allowed, allowed_context)) <> 2
    or cardinality(string_to_array(allowed, premium_guard)) <> 2
    or cardinality(string_to_array(resolver, resolver_context)) <> 2
    or cardinality(string_to_array(resolver, resolver_guard)) <> 2
    or cardinality(string_to_array(workspace, resource_empty)) <> 2
    or cardinality(string_to_array(workspace, share_empty)) <> 2
    or cardinality(string_to_array(writer, writer_begin)) <> 2
    or cardinality(string_to_array(command, command_context)) <> 4
    or cardinality(string_to_array(command, command_guard)) <> 3
    or cardinality(string_to_array(command, recategorize)) <> 2 then
    raise exception 'Unexpected Standard materials integration point';
  end if;
  execute replace(replace(allowed, allowed_context, $new$
    context := private.course_workspace_context_for_package(
      resource_row.run_id, private.standard_course_material(resource_row.id)
    );
  $new$), premium_guard, $new$
    if not coalesce((context->>'lms_enabled')::boolean, false)
       and not ((context->>'standard_enabled')::boolean and private.standard_course_material(resource_row.id))
    then return false; end if;
  $new$);

  execute replace(replace(resolver, resolver_context, $new$
    context := private.course_workspace_context_for_package(
      run_id, p_kind = 'resource' and private.standard_course_material(p_id)
    );
  $new$), resolver_guard, $new$
    if not coalesce((context->>'lms_enabled')::boolean, false)
      and not (p_kind = 'resource' and (context->>'standard_enabled')::boolean
        and private.standard_course_material(p_id)) then
  $new$);

  execute replace(writer, writer_begin, $new$declare
  material_result jsonb;
begin
  if (select edition from private.installation_identity) = 'internal'
      and not coalesce(private.course_company_premium_enabled(p_run_id), false) then
    if (p_action = 'resource_share' and p_payload->>'category' = 'material')
      or (p_action = 'resource_remove' and private.standard_course_material((p_payload->>'id')::uuid)) then
      perform private.lock_standard_lms_course(p_run_id);
      material_result := private.course_resource_command(p_run_id, p_action, p_payload);
      if p_action = 'resource_share'
        and not private.standard_course_material((material_result->>'id')::uuid) then
        raise insufficient_privilege;
      end if;
      return material_result;
    end if;
  end if;
$new$ || write_lock);
  execute replace(replace(replace(command, command_context,
    'context := private.course_workspace_context_for_package(p_run_id, false);'),
    command_guard,
    $new$not coalesce((context->>'lms_enabled')::boolean, false) and not (
      (context->>'standard_enabled')::boolean
      and (select edition from private.installation_identity) = 'internal'
      and (p_action = 'resource_remove' or (p_action = 'resource_share' and p_payload->>'category' = 'material'))
    )$new$), recategorize, $new$    if found then
      if not (context->>'lms_enabled')::boolean and resource_row.category <> 'material' then
        raise insufficient_privilege;
      end if;$new$);

  execute replace(replace(workspace, resource_empty, $new$
    'resources', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', resource.id, 'name', version.original_name, 'version_id', version.id,
        'version', version.version, 'sha256', version.sha256, 'category', resource.category,
        'audience', resource.audience, 'acknowledged', exists (
          select 1 from private.course_resource_acknowledgements ack
          where ack.resource_id = resource.id and ack.user_id = auth.uid()
        ), 'ownership_kind', resource.ownership_kind,
        'can_remove', private.can_remove_course_resource(resource, p_context)
      ) order by resource.created_at, resource.id), '[]'::jsonb)
      from private.course_resources resource
      join public.document_versions version on version.id = resource.version_id
      where resource.run_id = run.id
        and private.standard_course_material(resource.id)
        and private.course_resource_allowed(resource.id)
    )
  $new$), share_empty, $new$
    'share_options', case when (p_context->>'manager')::boolean and run.archived_at is null then (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', version.id, 'name', version.original_name, 'version', version.version
      ) order by version.original_name, version.id), '[]'::jsonb)
      from public.document_versions version
      join public.documents document on document.id = version.document_id
      where (
        (document.scope = 'personal' and document.owner_id = auth.uid())
        or exists (
          select 1 from public.jobs job where job.id = document.job_id and job.course_run_id = run.id
        )
      )
        and private.standard_course_material_version(version.id)
        and not private.deletion_document_fenced(document.id)
    ) else '[]'::jsonb end
  $new$);
end;
$migration$;

commit;
