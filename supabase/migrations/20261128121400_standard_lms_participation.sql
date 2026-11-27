begin;

-- Availability is separate from actor and course authority. The calling
-- routines retain their existing identity, membership and resource checks.
create function private.standard_lms_read_enabled(p_organisation_id uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists (
    select 1 from public.organisations
    where id = p_organisation_id and archived_at is null
  ) and (
    (select edition from private.installation_identity) = 'internal'
    or coalesce(private.academy_course_access_status() in ('active', 'grace'), false)
  );
$$;

create function private.lock_standard_lms_company(p_organisation_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if (select edition from private.installation_identity) is distinct from 'internal' then
    perform private.lock_academy_course_access();
  end if;
  perform 1 from public.organisations
  where id = p_organisation_id and archived_at is null for share;
  if not found then raise insufficient_privilege; end if;
end;
$$;

create function private.lock_standard_lms_course(p_run_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  company_id uuid;
begin
  select organisation_id into company_id from public.course_runs
  where id = p_run_id and archived_at is null for no key update;
  perform private.lock_standard_lms_company(company_id);
end;
$$;

revoke all on function private.standard_lms_read_enabled(uuid),
  private.lock_standard_lms_company(uuid), private.lock_standard_lms_course(uuid)
from public, anon, authenticated, service_role;

-- Keep the released definitions, grants and security modes. Only replace the
-- named entitlement checks. A changed upstream definition fails migration.
create function pg_temp.standard_lms_replace(target regprocedure, old_text text, new_text text, expected integer)
returns void language plpgsql set search_path = '' as $$
declare
  source text := pg_catalog.pg_get_functiondef(target);
begin
  if cardinality(string_to_array(source, old_text)) <> expected + 1 then
    raise exception 'Unexpected Standard LMS integration point in %', target;
  end if;
  execute replace(source, old_text, new_text);
end;
$$;

select pg_temp.standard_lms_replace('private.accept_company_participant_invitation(uuid,integer,uuid)',
  $old$private.lock_company_premium($old$, $new$private.lock_standard_lms_company($new$, 1);
select pg_temp.standard_lms_replace('private.assign_company_participant_courses(uuid,uuid,uuid[])',
  $old$private.lock_company_premium($old$, $new$private.lock_standard_lms_company($new$, 1);
select pg_temp.standard_lms_replace('private.lock_learning_program_scope(uuid,uuid,uuid)',
  $old$private.lock_company_premium($old$, $new$private.lock_standard_lms_company($new$, 1);
select pg_temp.standard_lms_replace('private.place_managed_participant(uuid,uuid,uuid,uuid)',
  $old$private.lock_company_premium($old$, $new$private.lock_standard_lms_company($new$, 1);
select pg_temp.standard_lms_replace('private.remove_company_participant(uuid,uuid,integer,uuid)',
  $old$private.lock_company_premium($old$, $new$private.lock_standard_lms_company($new$, 1);
select pg_temp.standard_lms_replace('private.request_company_participant_link(uuid,text,uuid)',
  $old$private.lock_company_premium($old$, $new$private.lock_standard_lms_company($new$, 1);
select pg_temp.standard_lms_replace('private.reserve_class_participant_invitation(uuid,text,text,uuid,uuid)',
  $old$private.lock_company_premium($old$, $new$private.lock_standard_lms_company($new$, 1);
select pg_temp.standard_lms_replace('private.reserve_company_participant_invitation(uuid,text,text,uuid)',
  $old$private.lock_company_premium($old$, $new$private.lock_standard_lms_company($new$, 1);
select pg_temp.standard_lms_replace('private.reserve_company_participant_link(uuid,text,uuid)',
  $old$private.lock_company_premium($old$, $new$private.lock_standard_lms_company($new$, 1);
select pg_temp.standard_lms_replace('private.reserve_participant_account_creation(text,text,uuid,uuid,uuid)',
  $old$private.lock_company_premium($old$, $new$private.lock_standard_lms_company($new$, 1);
select pg_temp.standard_lms_replace('private.save_company_participant_profile(uuid,uuid,jsonb,jsonb)',
  $old$private.lock_company_premium($old$, $new$private.lock_standard_lms_company($new$, 1);
select pg_temp.standard_lms_replace('private.set_company_participant_class(uuid,uuid,uuid,integer)',
  $old$private.lock_company_premium($old$, $new$private.lock_standard_lms_company($new$, 1);
select pg_temp.standard_lms_replace('private.set_company_participant_reference(uuid,uuid,text,integer)',
  $old$private.lock_company_premium($old$, $new$private.lock_standard_lms_company($new$, 1);
select pg_temp.standard_lms_replace('private.set_course_class(uuid,uuid,text,integer)',
  $old$private.lock_company_premium($old$, $new$private.lock_standard_lms_company($new$, 1);
select pg_temp.standard_lms_replace('private.assign_company_participant_courses(uuid,uuid,uuid[])',
  $old$private.company_premium_enabled($old$, $new$private.standard_lms_read_enabled($new$, 1);
select pg_temp.standard_lms_replace('private.company_participant_assignable_courses(uuid,uuid,text,integer,integer)',
  $old$private.company_premium_enabled($old$, $new$private.standard_lms_read_enabled($new$, 1);
select pg_temp.standard_lms_replace('private.company_participant_history(uuid,timestamp with time zone,uuid,integer)',
  $old$private.company_premium_enabled($old$, $new$private.standard_lms_read_enabled($new$, 1);
select pg_temp.standard_lms_replace('private.company_participant_overview(uuid,uuid,integer,integer)',
  $old$private.company_premium_enabled($old$, $new$private.standard_lms_read_enabled($new$, 1);
select pg_temp.standard_lms_replace('private.company_participant_profile(uuid,uuid)',
  $old$private.company_premium_enabled($old$, $new$private.standard_lms_read_enabled($new$, 1);
select pg_temp.standard_lms_replace('private.company_participants(uuid)',
  $old$private.company_premium_enabled($old$, $new$private.standard_lms_read_enabled($new$, 1);
select pg_temp.standard_lms_replace('private.my_company_participant_invitations()',
  $old$private.company_premium_enabled($old$, $new$private.standard_lms_read_enabled($new$, 2);
select pg_temp.standard_lms_replace('private.learning_programs(uuid,uuid,text)',
  $old$private.course_lms_read_enabled($old$, $new$private.standard_lms_read_enabled($new$, 4);
select pg_temp.standard_lms_replace('private.learning_program_class_progress(uuid)',
  $old$private.course_lms_read_enabled($old$, $new$private.standard_lms_read_enabled($new$, 1);
select pg_temp.standard_lms_replace('private.cancel_own_course_enrolment(uuid)',
  $old$private.lock_course_premium($old$, $new$private.lock_standard_lms_course($new$, 1);
select pg_temp.standard_lms_replace('private.manage_course_enrolment_before_chat_autosync(uuid,uuid,text)',
  $old$private.lock_course_premium($old$, $new$private.lock_standard_lms_course($new$, 1);
select pg_temp.standard_lms_replace('private.course_content_action(uuid,text,jsonb)',
  $old$private.lock_course_premium($old$, $new$private.lock_standard_lms_course($new$, 1);
select pg_temp.standard_lms_replace('private.complete_account_invitation(uuid,uuid,text,boolean)',
  $old$private.lock_company_premium(request.organisation_id)$old$, $new$private.lock_standard_lms_company(request.organisation_id)$new$, 1);
select pg_temp.standard_lms_replace('private.company_participant_access(uuid)',
  $old$'premium_enabled', private.company_premium_enabled(p_organisation_id)$old$, $new$'premium_enabled', private.company_premium_enabled(p_organisation_id),
    'standard_enabled', private.standard_lms_read_enabled(p_organisation_id)$new$, 1);
select pg_temp.standard_lms_replace('private.course_enrolments(uuid)',
  $old$context->>'lms_enabled'$old$, $new$context->>'standard_enabled'$new$, 1);
select pg_temp.standard_lms_replace('private.course_enrolment_candidates(uuid,text)',
  $old$context->>'lms_enabled'$old$, $new$context->>'standard_enabled'$new$, 1);
select pg_temp.standard_lms_replace('private.course_class_options(uuid)',
  $old$context->>'lms_enabled'$old$, $new$context->>'standard_enabled'$new$, 1);
select pg_temp.standard_lms_replace('private.course_content_studio(uuid)',
  $old$context->>'lms_enabled'$old$, $new$context->>'standard_enabled'$new$, 1);
select pg_temp.standard_lms_replace('private.course_content_action(uuid,text,jsonb)',
  $old$context->>'lms_enabled'$old$, $new$context->>'standard_enabled'$new$, 1);
-- Share the actor and resource checks while keeping the original Premium
-- context for all callers outside the explicit Standard allowlist below.
do $migration$
declare
  source text := pg_catalog.pg_get_functiondef('private.course_workspace_context(uuid)'::regprocedure);
begin
  if cardinality(string_to_array(source, 'private.course_workspace_context(p_run_id uuid)')) <> 2
     or cardinality(string_to_array(source, 'learner := lms_enabled and')) <> 2
     or cardinality(string_to_array(source, '''lms_enabled'', lms_enabled')) <> 2 then
    raise exception 'Unexpected course workspace context';
  end if;

  execute replace(replace(replace(source,
    'private.course_workspace_context(p_run_id uuid)',
    'private.course_workspace_context_for_package(p_run_id uuid, p_standard boolean)'),
    'learner := lms_enabled and',
    'learner := (lms_enabled or (p_standard and private.standard_lms_read_enabled(run_row.organisation_id))) and'),
    '''lms_enabled'', lms_enabled',
    '''lms_enabled'', lms_enabled, ''standard_enabled'', private.standard_lms_read_enabled(run_row.organisation_id)');
end;
$migration$;

revoke all on function private.course_workspace_context_for_package(uuid,boolean)
from public, anon, authenticated, service_role;

create or replace function private.course_workspace_context(p_run_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select private.course_workspace_context_for_package(p_run_id, false) - 'standard_enabled';
$$;

select pg_temp.standard_lms_replace('private.course_enrolments(uuid)',
  'private.course_workspace_context(p_course_run_id)', 'private.course_workspace_context_for_package(p_course_run_id, true)', 1);
select pg_temp.standard_lms_replace('private.course_enrolment_candidates(uuid,text)',
  'private.course_workspace_context(p_course_run_id)', 'private.course_workspace_context_for_package(p_course_run_id, true)', 1);
select pg_temp.standard_lms_replace('private.course_class_options(uuid)',
  'private.course_workspace_context(p_course_id)', 'private.course_workspace_context_for_package(p_course_id, true)', 1);
select pg_temp.standard_lms_replace('private.course_content_action(uuid,text,jsonb)',
  'private.course_workspace_context(p_run_id)', 'private.course_workspace_context_for_package(p_run_id, true)', 2);
select pg_temp.standard_lms_replace('private.course_session_register(uuid,uuid)',
  'private.course_workspace_context(p_run_id)', 'private.course_workspace_context_for_package(p_run_id, true)', 1);
select pg_temp.standard_lms_replace('private.course_workspace(uuid)',
  'private.course_workspace_context(p_run_id)', 'private.course_workspace_context_for_package(p_run_id, true)', 1);
select pg_temp.standard_lms_replace('private.course_content_studio(uuid)',
  'private.course_workspace_context(p_run_id)', 'private.course_workspace_context_for_package(p_run_id, true)', 1);
select pg_temp.standard_lms_replace('private.my_course_workspaces()',
  $old$private.course_lms_read_enabled(run.organisation_id) and$old$, $new$private.standard_lms_read_enabled(run.organisation_id) and$new$, 2);

select pg_temp.standard_lms_replace('private.standard_course_workspace(uuid,jsonb)',
  $old$'access', p_context,$old$, $new$'access', p_context - 'standard_enabled',$new$, 1);

select pg_temp.standard_lms_replace('private.course_withdrawal_window(uuid)',
  'private.course_workspace_context(p_course_run_id)', 'private.course_workspace_context_for_package(p_course_run_id, true)', 1);
select pg_temp.standard_lms_replace('private.course_withdrawal_window(uuid)',
  $old$context->>'lms_enabled'$old$, $new$context->>'standard_enabled'$new$, 1);

select pg_temp.standard_lms_replace('private.standard_course_workspace(uuid,jsonb)',
  $old$'settings_version', 0,$old$,
  $new$'settings_version', 0,
    'learner_status', case when (p_context->>'learner')::boolean then (
      select enrolment.status from public.course_enrolments enrolment
      where enrolment.course_run_id = run.id and enrolment.user_id = auth.uid()
        and enrolment.status in ('enrolled', 'completed')
    ) end,$new$, 1);

-- A completed enrolment provides basic programme progress. An existing formal
-- receipt remains authoritative for courses with a receipt history, including
-- revocation. No receipt is created or returned for a basic completion.
select pg_temp.standard_lms_replace('private.learning_program_progress(uuid,uuid)',
  $old$receipt.id as receipt_id, receipt.created_at as completed_at,$old$,
  $new$receipt.id as receipt_id,
      coalesce(receipt.created_at, enrolment.updated_at) as completed_at,$new$, 1);
select pg_temp.standard_lms_replace('private.learning_program_progress(uuid,uuid)',
  $old$(run.id is not null and receipt.id is not null
        and enrolment.status in ('enrolled', 'completed')) as completed,$old$,
  $new$(run.id is not null and enrolment.status in ('enrolled', 'completed') and (
        receipt.id is not null or (
          enrolment.status = 'completed' and not exists (
            select 1 from private.course_completion_records history
            where history.run_id = run.id and history.user_id = p_user
          )
        )
      )) as completed,$new$, 1);

-- The register shares basic attendance, while retained evidence metadata
-- continues to require its previous access.
select pg_temp.standard_lms_replace('private.course_session_register(uuid,uuid)',
  $old$context->>'lms_enabled'$old$, $new$context->>'standard_enabled'$new$, 1);
select pg_temp.standard_lms_replace('private.course_session_register(uuid,uuid)',
  $old$'evidence',case when (select edition from private.installation_identity) = 'internal'$old$,
  $new$'evidence',case when (select edition from private.installation_identity) = 'internal'
      and (context->>'lms_enabled')::boolean$new$, 1);
select pg_temp.standard_lms_replace(
  'private.save_course_session_attendance(uuid,uuid,uuid,text,timestamptz,timestamptz,text,text,integer)',
  'private.lock_course_premium(p_run_id)', 'private.lock_standard_lms_course(p_run_id)', 1);
select pg_temp.standard_lms_replace(
  'private.save_course_session_attendance_before_premium_lock(uuid,uuid,uuid,text,timestamptz,timestamptz,text,text,integer)',
  'private.course_workspace_context(p_run_id)', 'private.course_workspace_context_for_package(p_run_id, true)', 1);
select pg_temp.standard_lms_replace(
  'private.save_course_session_attendance_before_premium_lock(uuid,uuid,uuid,text,timestamptz,timestamptz,text,text,integer)',
  $old$context->>'lms_enabled'$old$, $new$context->>'standard_enabled'$new$, 1);
select pg_temp.standard_lms_replace('private.import_course_session_attendance(uuid,uuid,jsonb)',
  'private.lock_course_premium(p_run_id)', 'private.lock_standard_lms_course(p_run_id)', 1);

commit;
