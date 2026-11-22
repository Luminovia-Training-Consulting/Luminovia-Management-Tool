begin;

create function private.course_submission_write_enabled()
returns boolean language sql stable security invoker set search_path = '' as $$
  select (select edition from private.installation_identity) = 'internal'
    or private.academy_course_access_status() = 'active';
$$;

-- Serialize dedicated writes with licence/profile changes and internal writes
-- with the company entitlement. Both editions lock the owning course.
create function private.lock_course_submission_scope(p_run_id uuid)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  company_id uuid;
  internal_edition boolean := (select edition from private.installation_identity) = 'internal';
begin
  if not internal_edition then perform private.lock_academy_course_access(); end if;
  select run.organisation_id into company_id
  from public.course_runs run
  join public.organisations organisation on organisation.id = run.organisation_id
  where run.id = p_run_id and run.archived_at is null and organisation.archived_at is null
  for no key update of run for share of organisation;
  if not found then raise insufficient_privilege; end if;
  if internal_edition then perform private.lock_company_premium(company_id); end if;
  return company_id;
end;
$$;

create function private.lock_course_submission_settings_actor(p_run_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  company_id uuid := private.lock_course_submission_scope(p_run_id);
  actor_id uuid := auth.uid();
begin
  perform 1 from auth.users where id = actor_id for share;
  perform 1 from public.profiles where id = actor_id and active for share;
  if not found then raise insufficient_privilege; end if;
  perform 1 from public.user_roles where user_id = actor_id order by role for share;
  perform 1 from public.client_organisation_memberships
    where user_id = actor_id and organisation_id = company_id and removed_at is null for share;
  return private.course_submission_context(p_run_id);
end;
$$;

revoke all on function private.course_submission_write_enabled(), private.lock_course_submission_scope(uuid),
  private.lock_course_submission_settings_actor(uuid) from public, anon, authenticated, service_role;

create or replace function private.course_submission_context(p_run_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  context jsonb;
begin
  context := private.course_workspace_context(p_run_id);
  if (context->>'lms_enabled')::boolean is not true then raise insufficient_privilege; end if;
  return context;
end;
$$;

create or replace function private.lock_course_submission_upload(p_run_id uuid, p_actor_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  company_id uuid;
begin
  company_id := private.lock_course_submission_scope(p_run_id);
  perform 1 from auth.users where id = p_actor_id and email_confirmed_at is not null for share;
  if not found then raise insufficient_privilege; end if;
  perform 1 from public.profiles where id = p_actor_id and active for share;
  if not found then raise insufficient_privilege; end if;
  perform 1 from public.user_roles where user_id = p_actor_id order by role for share;
  perform 1 from private.company_participant_memberships
    where user_id = p_actor_id and organisation_id = company_id and status = 'active' for share;
  if not found then raise insufficient_privilege; end if;
  perform 1 from public.course_enrolments
    where user_id = p_actor_id and course_run_id = p_run_id and status = 'enrolled' for share;
  if not found or not private.active_company_participant(p_actor_id, company_id)
     or not exists (select 1 from private.course_submission_settings where run_id = p_run_id and enabled) then
    raise insufficient_privilege;
  end if;
end;
$$;

create or replace function private.reserve_course_submission(
  p_run_id uuid, p_name text, p_mime text, p_size bigint, p_client_id uuid, p_sha256 text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  existing_version public.document_versions%rowtype;
  result jsonb;
begin
  perform private.lock_course_submission_upload(p_run_id, actor_id);
  if p_client_id is null or p_size is null or p_size not between 1 and 10485760
     or not coalesce(p_sha256 ~ '^[0-9a-f]{64}$', false) then
    raise invalid_parameter_value;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('documents-global-quota', 0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('documents:' || actor_id::text, 0));
  select * into existing_version from public.document_versions where uploaded_by = actor_id and client_id = p_client_id;
  if found then
    if existing_version.original_name is distinct from p_name
       or existing_version.mime_type is distinct from p_mime or existing_version.size_bytes is distinct from p_size
       or existing_version.version <> 1 or not exists (
        select 1 from private.course_submissions submission
        join public.documents document on document.current_version_id = submission.version_id
        where submission.version_id = existing_version.id and submission.run_id = p_run_id
          and submission.expected_sha256 = p_sha256 and submission.withdrawn_at is null
          and document.id = existing_version.document_id and document.kind = 'participant_submission'
          and document.owner_id = actor_id and document.deleted_at is null
          and not private.deletion_document_fenced(document.id)
    ) then
      raise exception 'Submission reservation conflicts with this upload' using errcode = 'PT409';
    end if;
    return jsonb_build_object('document_id', existing_version.document_id, 'version_id', existing_version.id,
      'object_path', existing_version.object_path, 'status', existing_version.status);
  end if;
  if (select edition from private.installation_identity) is distinct from 'internal'
     and (select coalesce(sum(size_bytes), 0) from public.document_versions) + p_size >
         (select (terms #>> '{limits,storage_bytes}')::bigint from private.installation_verified_licence) then
    raise exception 'Academy storage quota reached' using errcode = '54000';
  end if;
  result := private.reserve_document_before_contract_owner(p_name, p_mime, p_size, 'personal', 'participant_submission',
    null, null, p_client_id, null, null);
  insert into private.course_submissions(version_id, run_id, expected_sha256)
    values ((result->>'version_id')::uuid, p_run_id, p_sha256);
  return result;
end;
$$;

create or replace function private.course_submission_status(p_run_id uuid, p_document_id uuid, p_version_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'document', jsonb_build_object(
      'id', document.id, 'owner_id', document.owner_id, 'uploaded_by', document.uploaded_by,
      'scope', document.scope, 'kind', document.kind, 'room_id', document.room_id, 'job_id', document.job_id,
      'original_name', document.original_name, 'mime_type', document.mime_type, 'size_bytes', document.size_bytes,
      'status', document.status, 'current_version_id', version.id, 'created_at', document.created_at, 'deleted_at', null
    ), 'sha256', version.sha256
  )
  from private.course_submissions submission
  join public.document_versions version on version.id = submission.version_id
  join public.documents document on document.id = version.document_id and document.current_version_id = version.id
  join public.course_enrolments enrolment on enrolment.course_run_id = submission.run_id and enrolment.user_id = auth.uid()
  where submission.run_id = p_run_id and document.id = p_document_id and version.id = p_version_id
    and submission.withdrawn_at is null and enrolment.status = 'enrolled'
    and private.course_submission_write_enabled()
    and (private.course_submission_context(p_run_id)->>'learner')::boolean
    and exists (select 1 from private.course_submission_settings where run_id = p_run_id and enabled)
    and document.owner_id = auth.uid() and version.uploaded_by = auth.uid()
    and version.version = 1 and document.kind = 'participant_submission'
    and document.deleted_at is null and not private.deletion_document_fenced(document.id);
$$;

create or replace function private.course_submissions(p_run_id uuid, p_after uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  context jsonb := private.course_submission_context(p_run_id);
  management_scope boolean := (context->>'manager')::boolean or (context->>'client')::boolean;
  reviewer boolean := management_scope or (context->>'teacher')::boolean;
  writable boolean := private.course_submission_write_enabled();
  can_manage boolean := writable and management_scope;
  intake_enabled boolean := exists (select 1 from private.course_submission_settings where run_id = p_run_id and enabled);
  can_upload boolean := writable and intake_enabled and (context->>'learner')::boolean and exists (
    select 1 from public.course_enrolments where course_run_id = p_run_id and user_id = auth.uid() and status = 'enrolled'
  );
  entries jsonb;
  page_cursor uuid;
  cursor_time timestamptz;
begin
  if p_after is not null then
    select version.created_at into cursor_time
    from private.course_submissions submission
    join public.document_versions version on version.id = submission.version_id
    where submission.run_id = p_run_id and version.id = p_after
      and (reviewer or version.uploaded_by = auth.uid());
    if not found then raise insufficient_privilege; end if;
  end if;
  with page as (
    select version.id as version_id, version.original_name as name, version.size_bytes, version.created_at as submitted_at,
      case when reviewer then profile.display_name end as participant,
      can_manage or (can_upload and document.owner_id = auth.uid()) as can_withdraw
    from private.course_submissions submission
    join public.document_versions version on version.id = submission.version_id
    join public.documents document on document.id = version.document_id and document.current_version_id = version.id
    join public.profiles profile on profile.id = document.owner_id
    where submission.run_id = p_run_id and submission.withdrawn_at is null
      and (p_after is null or (version.created_at, version.id) < (cursor_time, p_after))
      and (reviewer or document.owner_id = auth.uid())
      and version.status = 'clean' and document.status = 'clean' and document.deleted_at is null
      and not private.deletion_document_fenced(document.id)
    order by version.created_at desc, version.id desc limit 51
  ), visible_page as (select * from page order by submitted_at desc, version_id desc limit 50)
  select coalesce(jsonb_agg(to_jsonb(visible_page) order by submitted_at desc, version_id desc), '[]'::jsonb),
    case when (select count(*) from page) > 50 then
      (select version_id from visible_page order by submitted_at, version_id limit 1)
    end
  into entries, page_cursor from visible_page;
  return jsonb_build_object('enabled', writable and intake_enabled, 'can_manage', can_manage,
    'can_upload', can_upload, 'entries', entries, 'next', page_cursor);
end;
$$;

create or replace function private.set_course_submissions(p_run_id uuid, p_enabled boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  context jsonb;
begin
  if p_enabled is null then raise invalid_parameter_value; end if;
  context := private.lock_course_submission_settings_actor(p_run_id);
  if not ((context->>'manager')::boolean or (context->>'client')::boolean) then raise insufficient_privilege; end if;
  insert into private.course_submission_settings(run_id, enabled) values (p_run_id, p_enabled)
    on conflict (run_id) do update set enabled = excluded.enabled;
  insert into public.audit_events(actor_id, action, resource_id)
    values (auth.uid(), case when p_enabled then 'course_submissions.enabled' else 'course_submissions.disabled' end, p_run_id);
  return p_enabled;
end;
$$;

create or replace function private.withdraw_course_submission(p_run_id uuid, p_version_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  context jsonb;
begin
  context := private.lock_course_submission_settings_actor(p_run_id);
  if not ((context->>'manager')::boolean or (context->>'client')::boolean) then
    perform private.lock_course_submission_upload(p_run_id, auth.uid());
  end if;
  update private.course_submissions submission set withdrawn_at = now()
  from public.document_versions version, public.documents document
  where submission.run_id = p_run_id and submission.version_id = p_version_id and submission.withdrawn_at is null
    and version.id = submission.version_id and version.status = 'clean'
    and document.id = version.document_id and document.current_version_id = version.id
    and ((context->>'manager')::boolean or (context->>'client')::boolean or document.owner_id = auth.uid())
    and document.deleted_at is null and not private.deletion_document_fenced(document.id);
  if not found then raise insufficient_privilege; end if;
  insert into public.audit_events(actor_id, action, resource_id)
    values (auth.uid(), 'course_submissions.withdrawn', p_version_id);
  return true;
end;
$$;

-- The gateway uses this server-only lookup after the caller's scoped
-- authorization and checks the same caller again before delivering any bytes.
create function private.course_submission_storage_path(p_run_id uuid, p_version_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select version.object_path from private.course_submissions submission
  join public.document_versions version on version.id = submission.version_id
  join public.documents document on document.id = version.document_id and document.current_version_id = version.id
  where current_setting('role', true) = 'service_role'
    and submission.run_id = p_run_id and submission.version_id = p_version_id and submission.withdrawn_at is null
    and version.version = 1 and version.status = 'clean' and version.sha256 = submission.expected_sha256
    and document.kind = 'participant_submission' and document.status = 'clean' and document.deleted_at is null
    and version.object_path = document.owner_id::text || '/' || document.id::text || '/' || version.id::text
    and not private.deletion_document_fenced(document.id)
    and ((select edition from private.installation_identity) = 'internal'
      or private.academy_course_access_status() in ('active', 'grace'));
$$;
create function public.course_submission_storage_path(p_run_id uuid, p_version_id uuid)
returns text language sql stable security invoker set search_path = '' as $$
  select private.course_submission_storage_path(p_run_id, p_version_id);
$$;
revoke all on function private.course_submission_storage_path(uuid, uuid),
  public.course_submission_storage_path(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function private.course_submission_storage_path(uuid, uuid),
  public.course_submission_storage_path(uuid, uuid) to service_role;

do $$
declare
  caller_gate text := pg_get_functiondef('private.require_academy_course_access()'::regprocedure);
  service_gate text := pg_get_functiondef('public.require_portal_access()'::regprocedure);
  licence_anchor constant text := '  licence_status := private.academy_course_access_status();';
  scanner_anchor constant text := '''/rpc/academy_course_material_scan''';
begin
  if cardinality(string_to_array(caller_gate, licence_anchor)) <> 2
     or cardinality(string_to_array(service_gate, scanner_anchor)) <> 2 then
    raise exception 'Expected the dedicated course document and scanner gates';
  end if;
  execute replace(caller_gate, licence_anchor, licence_anchor || $gate$
  if request_method = 'POST' and (
    (licence_status in ('active', 'grace')
      and request_path in ('/rpc/course_submissions', '/rpc/course_submission_access'))
    or (licence_status = 'active' and request_path in (
      '/rpc/set_course_submissions', '/rpc/reserve_course_submission',
      '/rpc/course_submission_status', '/rpc/withdraw_course_submission'
    ))
  ) then
    return;
  end if;$gate$);
  execute replace(service_gate, scanner_anchor, scanner_anchor ||
    ', ''/rpc/course_submission_scan'', ''/rpc/course_submission_storage_path''');
end;
$$;

-- The customer-controlled database operator can export approved submissions
-- after expiry. This projection is never available to any web role.
create view private.course_submission_offboard with (security_invoker = true) as
select submission.run_id, document.owner_id, version.id as version_id, version.created_at as submitted_at
from private.course_submissions submission
join public.document_versions version on version.id = submission.version_id
join public.documents document on document.id = version.document_id and document.current_version_id = version.id
where submission.withdrawn_at is null and version.version = 1 and version.status = 'clean'
  and version.sha256 = submission.expected_sha256 and document.status = 'clean'
  and document.kind = 'participant_submission' and document.deleted_at is null
  and not private.deletion_document_fenced(document.id);
revoke all on private.course_submission_offboard from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';
commit;
