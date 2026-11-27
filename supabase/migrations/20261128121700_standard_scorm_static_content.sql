begin;

-- Keep historic statement eligibility and distinguish new ungraded progress.
alter table private.course_scorm_progress add column reportable boolean not null default true;

create function private.course_scorm_context(p_run_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  context jsonb := private.course_workspace_context_for_package(p_run_id, true);
begin
  if (context->>'standard_enabled')::boolean is not true then raise insufficient_privilege; end if;
  return context;
end;
$$;

do $migration$
declare
  item record;
  definition text;
  lock_definition text := pg_catalog.pg_get_functiondef('private.lock_course_submission_settings_actor(uuid)'::regprocedure);
  original_name constant text := 'private.lock_course_submission_settings_actor(p_run_id uuid)';
  original_scope constant text := 'company_id uuid := private.lock_course_submission_scope(p_run_id);';
  actor_lock_start constant text := '  perform 1 from auth.users';
  original_context constant text := 'private.course_submission_context(p_run_id)';
begin
  if cardinality(string_to_array(lock_definition, original_name)) <> 2
    or cardinality(string_to_array(lock_definition, original_scope)) <> 2
    or cardinality(string_to_array(lock_definition, actor_lock_start)) <> 2
    or cardinality(string_to_array(lock_definition, original_context)) <> 2 then
    raise exception 'Unexpected course package actor lock';
  end if;
  lock_definition := replace(replace(lock_definition, original_name,
    'private.lock_course_package_actor(p_run_id uuid, p_standard boolean)'),
    original_scope, 'company_id uuid;');
  lock_definition := replace(replace(lock_definition, actor_lock_start, $new$
  if p_standard and (select edition from private.installation_identity) = 'internal' then
    perform private.lock_standard_lms_course(p_run_id);
    select organisation_id into company_id from public.course_runs where id = p_run_id;
  else
    company_id := private.lock_course_submission_scope(p_run_id);
  end if;
$new$ || actor_lock_start), original_context,
    'case when p_standard then private.course_scorm_context(p_run_id)
      else private.course_submission_context(p_run_id) end');
  execute lock_definition;

  for item in select * from (values
    ('private.reserve_course_scorm_package(uuid,text,bigint,uuid,text)',
      'private.lock_course_submission_settings_actor(p_run_id)', 'private.lock_course_package_actor(p_run_id, true)'),
    ('private.course_scorm_upload_status(uuid,uuid,uuid)',
      original_context, 'private.course_scorm_context(p_run_id)'),
    ('private.course_scorm_packages(uuid)',
      original_context, 'private.course_scorm_context(p_run_id)'),
    ('private.course_scorm_download(uuid,uuid)',
      original_context, 'private.course_scorm_context(p_run_id)'),
    ('private.course_scorm_action(uuid,uuid,text,jsonb)',
      'private.lock_course_submission_settings_actor(p_run_id)', 'private.lock_course_package_actor(p_run_id, true)'),
    ('private.course_scorm_packages(uuid)',
      'where package.run_id = p_run_id and package.published_at is not null',
      $new$where package.run_id = p_run_id and package.published_at is not null
        and (package.playback = 'static' or (context->>'lms_enabled')::boolean)$new$),
    ('private.course_scorm_download(uuid,uuid)',
      'where run_id = p_run_id and version_id = p_version_id and published_at is not null;',
      $new$where run_id = p_run_id and version_id = p_version_id and published_at is not null
      and (playback = 'static' or (context->>'lms_enabled')::boolean);$new$),
    ('private.course_scorm_action(uuid,uuid,text,jsonb)',
      $old$  if p_action = 'withdraw' and p_payload = '{}'::jsonb$old$,
      $new$  if (context->>'lms_enabled')::boolean is not true and (
       package.playback = 'runtime' or p_payload->>'playback' = 'runtime'
     ) then raise insufficient_privilege; end if;
  if p_action = 'withdraw' and p_payload = '{}'::jsonb$new$),
    ('private.course_scorm_action(uuid,uuid,text,jsonb)',
      $old$insert into private.course_scorm_progress(version_id, user_id, item_id) values (package.version_id, auth.uid(), item)$old$,
      $new$insert into private.course_scorm_progress(version_id, user_id, item_id, reportable)
      values (package.version_id, auth.uid(), item, (context->>'lms_enabled')::boolean is true)$new$),
    ('private.course_xapi_statements(uuid,timestamptz,timestamptz)',
      $old$join private.course_scorm_packages package on package.version_id = completed.version_id$old$,
      $new$join private.course_scorm_packages package on package.version_id = completed.version_id and completed.reportable$new$)
  ) as patches(signature, previous, replacement)
  loop
    definition := pg_catalog.pg_get_functiondef(item.signature::regprocedure);
    if cardinality(string_to_array(definition, item.previous)) <> 2 then
      raise exception 'Unexpected Standard SCORM boundary in %', item.signature;
    end if;
    execute replace(definition, item.previous, item.replacement);
  end loop;
end;
$migration$;

create or replace function private.lock_course_submission_settings_actor(p_run_id uuid)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.lock_course_package_actor(p_run_id, false);
$$;

revoke all on function private.course_scorm_context(uuid),
  private.lock_course_package_actor(uuid,boolean) from public, anon, authenticated, service_role;

commit;
