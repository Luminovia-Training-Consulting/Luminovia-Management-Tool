begin;

-- The released "lms" module keeps its full signed entitlement. A separately
-- approved "lms-standard" module can be issued without changing old envelopes.
create function private.academy_standard_lms_licence()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from private.installation_verified_licence licence
    join private.academy_course_access access using (installation_id)
    where access.release_commit = licence.terms->>'release_commit'
      and licence.terms->'modules' = '["lms-standard"]'::jsonb
  )
$$;

create function private.lock_academy_premium_access()
returns void language plpgsql set search_path = '' as $$
begin
  perform private.lock_academy_course_access();
  if private.academy_standard_lms_licence() then raise insufficient_privilege; end if;
end;
$$;

revoke all on function private.academy_standard_lms_licence(), private.lock_academy_premium_access()
  from public, anon, authenticated, service_role;
-- Keep the same single allowlisted private projection for anonymous users.
-- Its output grows by one public flag. The licence helper remains private.
alter function private.installation_capability_projection() rename to installation_capability_projection_legacy;
create function private.installation_capability_projection()
returns table(
  installation_id uuid,
  edition text,
  licence_status text,
  customer_ready boolean,
  lms_available boolean,
  marketplace_available boolean,
  company_premium_switch_available boolean,
  academy_standard_only boolean
)
language sql stable security definer set search_path = '' as $$
  select identity.installation_id, identity.edition,
    case
      when identity.edition = 'internal' then 'not-required'
      when licence.installation_id is null then 'unlicensed'
      when statement_timestamp() < licence.starts_at then 'scheduled'
      when statement_timestamp() < licence.expires_at then 'active'
      when statement_timestamp() < licence.grace_until then 'grace'
      else 'expired'
    end,
    false,
    identity.edition = 'internal',
    identity.edition = 'internal',
    identity.edition = 'internal',
    private.academy_standard_lms_licence()
  from private.installation_identity identity
  left join private.installation_verified_licence licence using (installation_id);
$$;
revoke all on function private.installation_capability_projection()
  from public, anon, authenticated, service_role;
grant execute on function private.installation_capability_projection() to anon, authenticated, service_role;

create or replace view public.installation_capability_state
with (security_barrier = true, security_invoker = true) as
select * from private.installation_capability_projection();

drop function private.installation_capability_projection_legacy();

create or replace function public.installation_capabilities()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select (to_jsonb(capability) - 'academy_standard_only') || case when capability.academy_standard_only
    then '{"academy_standard_only":true}'::jsonb else '{}'::jsonb end
  from public.installation_capability_state capability
$$;

create or replace function private.course_lms_read_enabled(p_organisation_id uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select case
    when (select edition from private.installation_identity) = 'internal'
      then private.company_premium_enabled(p_organisation_id)
    else private.standard_lms_read_enabled(p_organisation_id)
      and not private.academy_standard_lms_licence()
  end
$$;

-- Basic registrations share the same validated resource launch in each edition.
-- The original Advantage helpers still require the Premium course context.
create or replace function private.lock_lti_basic_course_context(p_run_id uuid)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.lock_course_package_actor(p_run_id, true)
$$;

create or replace function private.course_exam_editor(p_context jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select (p_context->>'lms_enabled')::boolean is distinct from false and (
    coalesce((p_context->>'manager')::boolean, false) or
    coalesce((p_context->>'teacher')::boolean, false) or
    coalesce((p_context->>'client')::boolean, false)
  )
$$;

-- Compatibility changes to the canonical feature implementations. Existing
-- actor, course, history, upload and installation checks remain in force.
do $migration$
declare
  patch record;
  definition text;
begin
  for patch in select * from (values
    ('private.apply_verified_installation_licence(jsonb)',
      $old$or p_terms->'modules' is distinct from '["lms"]'::jsonb$old$,
      $new$or coalesce(p_terms->'modules' not in ('["lms"]'::jsonb,'["lms-standard"]'::jsonb),true)$new$),
    ('private.course_workspace(uuid)',
      $old$if (select edition from private.installation_identity) = 'internal' then
      return private.standard_course_workspace(p_run_id, context);$old$,
      $new$if (select edition from private.installation_identity) = 'internal'
      or (context->>'standard_enabled')::boolean then
      return private.standard_course_workspace(p_run_id, context);$new$),
    ('private.course_lti_tools(uuid)',
      $old$context jsonb := case when (select edition from private.installation_identity) = 'internal'
    then private.course_content_package_context(p_run_id) else private.course_workspace_context(p_run_id) end;$old$,
      $new$context jsonb := private.course_content_package_context(p_run_id);$new$),
    ('private.course_lti_tools(uuid)',
      $old$if (not coalesce((context->>'lms_enabled')::boolean, false)
    and (select edition from private.installation_identity) is distinct from 'internal')$old$,
      $new$if (context->>'standard_enabled')::boolean is not true$new$),
    ('private.academy_learning_action(uuid,text,jsonb,integer)',
      $old$  perform private.lock_academy_course_access();$old$,
      $new$  if p_action in ('quiz_config','quiz_attempt','completion_issue','completion_revoke') then
    perform private.lock_academy_premium_access();
  else
    perform private.lock_academy_course_access();
  end if;$new$),
    ('private.lock_academy_exam_editor(uuid,uuid,text)', 'perform private.lock_academy_course_access();',
      'perform private.lock_academy_premium_access();'),
    ('private.set_course_exam_required(uuid,boolean,integer)', 'perform private.lock_academy_course_access();',
      'perform private.lock_academy_premium_access();'),
    ('private.academy_student_exam_document_access(uuid)',
      'context := private.course_workspace_context(selected.run_id);',
      $new$context := private.course_workspace_context(selected.run_id);
  if (context->>'lms_enabled')::boolean is not true then raise insufficient_privilege; end if;$new$),
    ('private.require_academy_course_access()',
      '  licence_status := private.academy_course_access_status();',
      $new$  licence_status := private.academy_course_access_status();
  if private.academy_standard_lms_licence() and (
    request_path ~ '^/rpc/(course_(quiz|text_exam|exam|question_bank|gradebook|weighted_gradebook|assignments|assignment_action|peer_feedback|competenc|completion|xapi)|learning_program_(grade_report|cohort_grades)|academy_(student_exam|staff_exam|exam)|set_course_exam|save_course_exam|submit_course_exam|published_course_exam|import_course_exam|share_course_exam|remove_course_exam|configure_course_lti|lti_ags|lti_deep_link|course_lti_ags|course_h5p_question|course_h5p_collection|read_course_scorm_runtime|save_course_scorm_runtime|start_course_quiz|save_course_quiz)'
    or request_path in ('/rpc/learning_portfolio_command','/rpc/learning_portfolio_evidence',
      '/rpc/reserve_academy_student_exam_pdf','/rpc/reserve_academy_staff_exam_pdf',
      '/rpc/set_course_submissions','/rpc/course_submissions','/rpc/withdraw_course_submission',
      '/rpc/report_course_xapi_delivery','/rpc/lti_resource_memberships')
  ) then raise insufficient_privilege; end if;$new$)
  ) patches(signature, old_code, new_code) loop
    definition := pg_catalog.pg_get_functiondef(patch.signature::regprocedure);
    if cardinality(string_to_array(definition, patch.old_code)) <> 2 then
      raise exception 'Unexpected Academy package boundary in %', patch.signature;
    end if;
    execute replace(definition, patch.old_code, patch.new_code);
  end loop;

  -- Portfolio writes (including attachments) may be course-independent.
  -- Resolve the guarded implementations that already take the active Academy lock.
  for patch in
    select proc.oid, proc.proname from pg_proc proc
    join pg_namespace ns on ns.oid=proc.pronamespace
    where ns.nspname='private' and proc.proname like 'learning_portfolio%'
      and proc.prosrc like '%perform private.lock_academy_course_access();%'
  loop
    execute replace(pg_catalog.pg_get_functiondef(patch.oid),
      'perform private.lock_academy_course_access();','perform private.lock_academy_premium_access();');
  end loop;
end;
$migration$;

notify pgrst,'reload schema';
commit;
