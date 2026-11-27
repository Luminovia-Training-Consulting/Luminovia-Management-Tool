begin;

-- Metadata and reuse operate on the same approved ordinary material share in
-- either package. The public author, file-owner and exact-version checks stay.
do $migration$
declare
  patch record;
  definition text;
  guard constant text := $old$(context->>'lms_enabled')::boolean is not true$old$;
  standard_guard constant text := $new$not coalesce((context->>'lms_enabled')::boolean
    or ((context->>'standard_enabled')::boolean and private.standard_course_material(p_resource_id)), false)$new$;
begin
  for patch in select * from (values
    ('private.can_remove_course_resource(private.course_resources,jsonb)',
      $old$not coalesce((p_context->>'lms_enabled')::boolean, false)$old$,
      $new$not coalesce((p_context->>'lms_enabled')::boolean
        or ((p_context->>'standard_enabled')::boolean and private.standard_course_material(p_resource.id)), false)$new$, 1),
    ('private.course_resource_command(uuid,text,jsonb)',
      $old$and (select edition from private.installation_identity) = 'internal'
      and (p_action = 'resource_remove' or (p_action = 'resource_share' and p_payload->>'category' = 'material'))$old$,
      $new$and ((p_action = 'resource_remove' and private.standard_course_material((p_payload->>'id')::uuid))
        or (p_action = 'resource_share' and p_payload->>'category' = 'material'
          and private.standard_course_material_version((p_payload->>'version_id')::uuid)))$new$, 2),
    ('private.course_resource_command(uuid,text,jsonb)',
      'private.course_workspace_context_for_package(p_run_id, false)',
      'private.course_workspace_context_for_package(p_run_id, true)', 3),
    ('private.set_course_material_metadata(uuid,integer,jsonb)',
      'private.course_workspace_context(course_id)', 'private.course_workspace_context_for_package(course_id,true)', 2),
    ('private.set_course_material_metadata(uuid,integer,jsonb)',
      '    perform private.lock_course_premium(course_id);',
      $new$    if private.standard_course_material(p_resource_id) then
      perform private.lock_standard_lms_course(course_id);
    else
      perform private.lock_course_premium(course_id);
    end if;$new$, 1),
    ('private.set_course_material_metadata(uuid,integer,jsonb)',
      $old$  if p_metadata ? 'competencies' then$old$,
      $new$  if p_metadata ? 'competencies' then
    if (context->>'lms_enabled')::boolean is not true
      and p_metadata->'competencies' is distinct from coalesce(current_content->'competencies','[]'::jsonb) then
      raise insufficient_privilege;
    end if;$new$, 1),
    ('private.search_course_materials(uuid,text,text,integer)',
      'private.course_workspace_context(run.id)', 'private.course_workspace_context_for_package(run.id,true)', 3),
    ('private.course_material_metadata_history(uuid,integer)',
      'private.course_workspace_context(course_id)', 'private.course_workspace_context_for_package(course_id,true)', 1),
    ('private.course_material_metadata_history(uuid,integer)', guard, standard_guard, 1),
    ('private.course_material_usage(uuid,uuid)',
      'private.course_workspace_context(source.run_id)', 'private.course_workspace_context_for_package(source.run_id,true)', 1),
    ('private.course_material_usage(uuid,uuid)', guard, standard_guard, 1),
    ('private.course_material_reuse_source(uuid)',
      'private.course_workspace_context(source.run_id)', 'private.course_workspace_context_for_package(source.run_id,true)', 1),
    ('private.course_material_reuse_source(uuid)', guard, standard_guard, 1),
    ('private.course_material_reuse_targets(uuid,text)',
      'private.course_lms_read_enabled(run.organisation_id)', 'private.standard_lms_read_enabled(run.organisation_id)', 1),
    ('private.reuse_course_material(uuid,uuid,boolean)',
      'else perform private.lock_course_premium(locked_run_id);', 'else perform private.lock_standard_lms_course(locked_run_id);', 1),
    ('private.reuse_course_material(uuid,uuid,boolean)',
      'private.course_workspace_context(p_target_run_id)', 'private.course_workspace_context_for_package(p_target_run_id,true)', 1),
    ('private.reuse_course_material(uuid,uuid,boolean)',
      $old$(target_context->>'lms_enabled')::boolean is not true$old$,
      $new$(target_context->>'standard_enabled')::boolean is not true$new$, 1),
    ('private.reuse_course_material(uuid,uuid,boolean)',
      $old$      if source_revision ? 'competencies' then$old$,
      $new$      if (target_context->>'lms_enabled')::boolean is not true then
        source_revision := source_revision - 'competencies';
      end if;
      if source_revision ? 'competencies' then$new$, 1)
  ) patches(signature, old_code, new_code, expected_count) loop
    definition := pg_catalog.pg_get_functiondef(patch.signature::regprocedure);
    if cardinality(string_to_array(definition, patch.old_code)) <> patch.expected_count + 1 then
      raise exception 'Unexpected material package boundary in %', patch.signature;
    end if;
    execute replace(definition, patch.old_code, patch.new_code);
  end loop;
end;
$migration$;

notify pgrst,'reload schema';
commit;
