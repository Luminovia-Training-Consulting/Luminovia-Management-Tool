begin;

-- An explicit ungraded publication is immutable. Existing releases keep their
-- assessment mode and all recorded progress.
alter table private.course_h5p_packages add column practice boolean not null default false;
alter function private.course_scorm_context(uuid) rename to course_content_package_context;

do $migration$
declare
  item record;
  definition text;
  previous_context constant text := 'private.course_submission_context(p_run_id)';
  content_context constant text := 'private.course_content_package_context(p_run_id)';
  previous_lock constant text := 'private.lock_course_submission_settings_actor(p_run_id)';
  content_lock constant text := 'private.lock_course_package_actor(p_run_id, true)';
  package_context constant text := 'private.course_scorm_context(p_run_id)';
begin
  for item in select * from (values
    ('private.course_scorm_upload_status(uuid,uuid,uuid)', package_context, content_context),
    ('private.course_scorm_packages(uuid)', package_context, content_context),
    ('private.course_scorm_download(uuid,uuid)', package_context, content_context),
    ('private.lock_course_package_actor(uuid,boolean)', package_context, content_context),
    ('private.reserve_course_h5p_package(uuid,text,bigint,uuid,text)', previous_lock, content_lock),
    ('private.course_h5p_upload_status(uuid,uuid,uuid)', previous_context, content_context),
    ('private.course_h5p_packages(uuid)', previous_context, content_context),
    ('private.course_h5p_download(uuid,uuid)', previous_context, content_context),
    ('private.course_h5p_action(uuid,uuid,text,jsonb)', previous_lock, content_lock),
    ('private.course_h5p_packages(uuid)',
      $old$and progress.user_id = auth.uid())) order by package.published_at desc, package.version_id)$old$,
      $new$and progress.user_id = auth.uid()))
        || case when package.practice then '{"practice": true}'::jsonb else '{}'::jsonb end
        order by package.published_at desc, package.version_id)$new$),
    ('private.course_h5p_packages(uuid)',
      'where package.run_id = p_run_id and package.published_at is not null',
      $new$where package.run_id = p_run_id and package.published_at is not null
        and (package.practice or (context->>'lms_enabled')::boolean)$new$),
    ('private.course_h5p_download(uuid,uuid)',
      'where run_id = p_run_id and version_id = p_version_id and published_at is not null;',
      $new$where run_id = p_run_id and version_id = p_version_id and published_at is not null
      and (practice or (context->>'lms_enabled')::boolean);$new$),
    ('private.course_h5p_action(uuid,uuid,text,jsonb)',
      '  publication_title text;',
      $new$  publication_title text;
  ungraded boolean;$new$),
    ('private.course_h5p_action(uuid,uuid,text,jsonb)',
      $old$  if p_action = 'withdraw' and p_payload = '{}'::jsonb$old$,
      $new$  ungraded := case when p_action = 'publish'
    then coalesce(p_payload->'practice' = 'true'::jsonb, false) else package.practice end;
  if not ungraded and (context->>'lms_enabled')::boolean is not true then
    raise insufficient_privilege;
  end if;
  if p_action = 'withdraw' and p_payload = '{}'::jsonb$new$),
    ('private.course_h5p_action(uuid,uuid,text,jsonb)',
      $old$if p_payload - array['sha256','title'] <> '{}'::jsonb$old$,
      $new$if p_payload - array['sha256','title','practice'] <> '{}'::jsonb
      or (p_payload ? 'practice' and jsonb_typeof(p_payload->'practice') <> 'boolean')$new$),
    ('private.course_h5p_action(uuid,uuid,text,jsonb)',
      'if package.title is not distinct from publication_title then return true; end if;',
      'if package.title is not distinct from publication_title and package.practice = ungraded then return true; end if;'),
    ('private.course_h5p_action(uuid,uuid,text,jsonb)',
      'set title = publication_title, published_at = now()',
      'set title = publication_title, practice = ungraded, published_at = now()'),
    ('private.course_h5p_action(uuid,uuid,text,jsonb)',
      '    if score not between 0 and 1 then',
      $new$    if package.practice and score is not null then raise insufficient_privilege; end if;
    if score not between 0 and 1 then$new$),
    ('private.course_xapi_statements(uuid,timestamptz,timestamptz)',
      'join private.course_h5p_packages package on package.version_id = completed.version_id',
      'join private.course_h5p_packages package on package.version_id = completed.version_id and not package.practice')
  ) as patches(signature, previous, replacement)
  loop
    definition := pg_catalog.pg_get_functiondef(item.signature::regprocedure);
    if cardinality(string_to_array(definition, item.previous)) <> 2 then
      raise exception 'Unexpected H5P practice boundary in %', item.signature;
    end if;
    execute replace(definition, item.previous, item.replacement);
  end loop;
end;
$migration$;

commit;
