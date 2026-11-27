begin;

-- The basic registration retains the same exact URIs, one-time browser proof
-- and course roles. Registrations with Advantage configuration or retained
-- grading or placement records stay on their current entitlement.
create function private.lti_basic_registration(p_registration_id uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists (
    select 1 from private.lti_course_registrations registration
    where registration.id = p_registration_id
      and not registration.nrps_enabled
      and not registration.ags_enabled
      and registration.tool_public_key is null
      and registration.deep_link_uri is null
      and not exists (
        select 1 from private.lti_ags_lineitems item where item.registration_id = registration.id
      )
      and not exists (
        select 1 from private.lti_resource_links link where link.registration_id = registration.id
      )
  );
$$;

create function private.lock_lti_basic_course_context(p_run_id uuid)
returns jsonb language sql security invoker set search_path = '' as $$
  select case when (select edition from private.installation_identity) = 'internal'
    then private.lock_course_package_actor(p_run_id, true)
    else private.lti_course_access(p_run_id) end;
$$;

revoke all on function private.lti_basic_registration(uuid),
  private.lock_lti_basic_course_context(uuid) from public, anon, authenticated, service_role;

do $migration$
declare
  item record;
  definition text;
  direct_lock constant text := 'context := private.lti_course_access(tool.run_id);';
  premium_scope constant text := $old$if not coalesce((context->>'lms_enabled')::boolean, false)$old$;
begin
  for item in select * from (values
    ('private.course_lti_tools(uuid)',
      'context jsonb := private.course_workspace_context(p_run_id);',
      $new$context jsonb := case when (select edition from private.installation_identity) = 'internal'
    then private.course_content_package_context(p_run_id) else private.course_workspace_context(p_run_id) end;$new$),
    ('private.course_lti_tools(uuid)',
      premium_scope,
      $new$if (not coalesce((context->>'lms_enabled')::boolean, false)
    and (select edition from private.installation_identity) is distinct from 'internal')$new$),
    ('private.course_lti_tools(uuid)',
      'where registration.run_id = p_run_id and (registration.active or manager);',
      $new$where registration.run_id = p_run_id and (registration.active or manager)
    and ((context->>'lms_enabled')::boolean or private.lti_basic_registration(registration.id));$new$),
    ('private.save_course_lti_tool(uuid,uuid,text,text,text,text,text,boolean,integer)',
      'context jsonb := private.lti_course_access(p_run_id);',
      'context jsonb := private.lock_lti_basic_course_context(p_run_id);'),
    ('private.save_course_lti_tool(uuid,uuid,text,text,text,text,text,boolean,integer)',
      '  -- Keep an issued binding stable.',
      $new$  if previous.id is not null and (context->>'lms_enabled')::boolean is not true
    and not private.lti_basic_registration(previous.id) then raise insufficient_privilege; end if;
  -- Keep an issued binding stable.$new$),
    ('private.prepare_lti_placement(uuid,uuid,uuid,text)',
      direct_lock, 'context := private.lock_lti_basic_course_context(tool.run_id);'),
    ('private.prepare_lti_placement(uuid,uuid,uuid,text)',
      '  if p_portal_origin is not null then',
      $new$  if (context->>'lms_enabled')::boolean is not true and (
    p_portal_origin is not null or p_resource_link_id is not null or not private.lti_basic_registration(tool.id)
  ) then raise insufficient_privilege; end if;
  if p_portal_origin is not null then$new$),
    ('private.consume_lti_launch(text,text,uuid,text,text,text,text)',
      direct_lock, 'context := private.lock_lti_basic_course_context(tool.run_id);'),
    ('private.consume_lti_launch(text,text,uuid,text,text,text,text)',
      '  role_name := case',
      $new$  if (context->>'lms_enabled')::boolean is not true and (
    hint.portal_origin is not null or hint.resource_link_id is not null or not private.lti_basic_registration(tool.id)
  ) then raise insufficient_privilege; end if;
  role_name := case$new$)
  ) as patches(signature, previous, replacement)
  loop
    definition := pg_catalog.pg_get_functiondef(item.signature::regprocedure);
    if cardinality(string_to_array(definition, item.previous)) <> 2 then
      raise exception 'Unexpected Standard LTI boundary in %', item.signature;
    end if;
    execute replace(definition, item.previous, item.replacement);
  end loop;
end;
$migration$;

commit;
