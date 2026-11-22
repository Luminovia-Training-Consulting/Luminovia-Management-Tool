begin;

alter table public.documents drop constraint documents_kind_check;
alter table public.documents add constraint documents_kind_check
  check (kind in ('material','chat','cv','certificate','contract','invoice','avatar','participant_submission'));

create table private.course_submission_settings (
  run_id uuid primary key references public.course_runs(id) on delete cascade,
  enabled boolean not null
);
create table private.course_submissions (
  version_id uuid primary key references public.document_versions(id) on delete cascade,
  run_id uuid not null references public.course_runs(id),
  expected_sha256 text not null check (expected_sha256 ~ '^[0-9a-f]{64}$'),
  withdrawn_at timestamptz
);
create index course_submissions_run_version on private.course_submissions(run_id, version_id);
alter table private.course_submission_settings enable row level security;
alter table private.course_submissions enable row level security;
revoke all on private.course_submission_settings, private.course_submissions from public, anon, authenticated, service_role;

-- Preserve the installed RLS function's identity and the rest of its policies.
-- No generic owner, support, or billing access should reach this document kind.
do $$
declare
  definition text := pg_get_functiondef('private.can_access_document(uuid)'::regprocedure);
  gate constant text := 'if not private.actor_active() or private.deletion_document_fenced(p_id) then';
begin
  if strpos(definition, gate) = 0 then raise exception 'Installed document access gate has changed'; end if;
  execute replace(definition, gate, $gate$if exists (
    select 1 from public.documents d where d.id = p_id and d.kind = 'participant_submission'
  ) or not private.actor_active() or private.deletion_document_fenced(p_id) then$gate$);
end;
$$;

-- Keep generic uploads closed to this kind. Only the private course allocator
-- may open a personal, first-version reservation for an enrolled participant.
do $$
declare
  allocator text := pg_get_functiondef('private.reserve_document_before_contract_owner(text,text,bigint,text,text,uuid,uuid,uuid,uuid,uuid)'::regprocedure);
  reservation text := pg_get_functiondef('private.reserve_document(text,text,bigint,text,text,uuid,uuid,uuid,uuid,uuid)'::regprocedure);
  learner_gate constant text := E'and private.can_access_chat_room(p_room_id)\n  ) then';
  public_gate constant text := 'if not private.actor_active() then';
begin
  if strpos(allocator, learner_gate) = 0 or strpos(reservation, public_gate) = 0 then
    raise exception 'Installed document reservation gates have changed';
  end if;
  execute replace(allocator, learner_gate, $gate$and private.can_access_chat_room(p_room_id)
  ) and not (
    private.participant_actor() and p_scope = 'personal' and p_kind = 'participant_submission'
    and p_replace_id is null and p_owner_id is null and p_job_id is null and p_room_id is null
  ) then$gate$);
  execute replace(reservation, public_gate, $gate$if not private.actor_active() or p_kind = 'participant_submission' then$gate$);
end;
$$;

create function private.course_submission_context(p_run_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  context jsonb;
begin
  if (select edition from private.installation_identity) is distinct from 'internal' then
    raise insufficient_privilege;
  end if;
  context := private.course_workspace_context(p_run_id);
  if (context->>'lms_enabled')::boolean is not true then raise insufficient_privilege; end if;
  return context;
end;
$$;

-- The course row serializes the per-course switch with reservation and scan
-- promotion. Lock the same participant records that grant upload access.
create function private.lock_course_submission_upload(p_run_id uuid, p_actor_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  company_id uuid;
begin
  if (select edition from private.installation_identity) is distinct from 'internal' then
    raise insufficient_privilege;
  end if;
  perform private.lock_course_premium(p_run_id);
  select organisation_id into company_id from public.course_runs where id = p_run_id and archived_at is null;
  perform 1 from public.profiles where id = p_actor_id and active for share;
  if not found then raise insufficient_privilege; end if;
  if not exists (select 1 from auth.users where id = p_actor_id and email_confirmed_at is not null) then
    raise insufficient_privilege;
  end if;
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

create function private.reserve_course_submission(
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
  result := private.reserve_document_before_contract_owner(p_name, p_mime, p_size, 'personal', 'participant_submission',
    null, null, p_client_id, null, null);
  insert into private.course_submissions(version_id, run_id, expected_sha256)
    values ((result->>'version_id')::uuid, p_run_id, p_sha256);
  return result;
end;
$$;

create function private.course_submission_status(p_run_id uuid, p_document_id uuid, p_version_id uuid)
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
    and (private.course_submission_context(p_run_id)->>'learner')::boolean
    and exists (select 1 from private.course_submission_settings where run_id = p_run_id and enabled)
    and document.owner_id = auth.uid() and version.uploaded_by = auth.uid()
    and version.version = 1 and document.kind = 'participant_submission'
    and document.deleted_at is null and not private.deletion_document_fenced(document.id);
$$;

create function private.course_submissions(p_run_id uuid, p_after uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  context jsonb := private.course_submission_context(p_run_id);
  can_manage boolean := (context->>'manager')::boolean or (context->>'client')::boolean;
  reviewer boolean := can_manage or (context->>'teacher')::boolean;
  intake_enabled boolean := exists (select 1 from private.course_submission_settings where run_id = p_run_id and enabled);
  can_upload boolean := intake_enabled and (context->>'learner')::boolean and exists (
    select 1 from public.course_enrolments where course_run_id = p_run_id and user_id = auth.uid() and status = 'enrolled'
  );
  entries jsonb;
  page_cursor uuid;
begin
  with page as (
    select version.id as version_id, version.original_name as name, version.size_bytes, version.created_at as submitted_at,
      case when reviewer then profile.display_name end as participant,
      can_manage or (can_upload and document.owner_id = auth.uid()) as can_withdraw
    from private.course_submissions submission
    join public.document_versions version on version.id = submission.version_id
    join public.documents document on document.id = version.document_id and document.current_version_id = version.id
    join public.profiles profile on profile.id = document.owner_id
    where submission.run_id = p_run_id and submission.withdrawn_at is null
      and (p_after is null or version.id > p_after)
      and (reviewer or document.owner_id = auth.uid())
      and version.status = 'clean' and document.status = 'clean' and document.deleted_at is null
      and not private.deletion_document_fenced(document.id)
    order by version.id limit 51
  ), visible_page as (select * from page order by version_id limit 50)
  select coalesce(jsonb_agg(to_jsonb(visible_page) order by version_id), '[]'::jsonb),
    case when (select count(*) from page) > 50 then
      (select version_id from visible_page order by version_id desc limit 1)
    end
  into entries, page_cursor from visible_page;
  return jsonb_build_object('enabled', intake_enabled, 'can_manage', can_manage,
    'can_upload', can_upload, 'entries', entries, 'next', page_cursor);
end;
$$;

create function private.set_course_submissions(p_run_id uuid, p_enabled boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  context jsonb;
begin
  if p_enabled is null then raise invalid_parameter_value; end if;
  perform private.lock_course_premium(p_run_id);
  context := private.course_submission_context(p_run_id);
  if not ((context->>'manager')::boolean or (context->>'client')::boolean) then raise insufficient_privilege; end if;
  insert into private.course_submission_settings(run_id, enabled) values (p_run_id, p_enabled)
    on conflict (run_id) do update set enabled = excluded.enabled;
  insert into public.audit_events(actor_id, action, resource_id)
    values (auth.uid(), case when p_enabled then 'course_submissions.enabled' else 'course_submissions.disabled' end, p_run_id);
  return p_enabled;
end;
$$;

create function private.course_submission_access(p_run_id uuid, p_version_id uuid, p_record boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  context jsonb := private.course_submission_context(p_run_id);
  result jsonb;
begin
  select jsonb_build_object('version_id', version.id, 'name', version.original_name,
    'mime_type', version.mime_type, 'size_bytes', version.size_bytes, 'sha256', version.sha256)
    into result
  from private.course_submissions submission
  join public.document_versions version on version.id = submission.version_id
  join public.documents document on document.id = version.document_id and document.current_version_id = version.id
  where submission.run_id = p_run_id and version.id = p_version_id and submission.withdrawn_at is null
    and (document.owner_id = auth.uid() or (context->>'staff')::boolean or (context->>'client')::boolean)
    and version.version = 1 and version.status = 'clean' and document.status = 'clean'
    and document.deleted_at is null and not private.deletion_document_fenced(document.id)
    and version.sha256 = submission.expected_sha256
    and version.object_path = document.owner_id::text || '/' || document.id::text || '/' || version.id::text;
  if not found then raise insufficient_privilege; end if;
  if p_record and ((context->>'staff')::boolean or (context->>'client')::boolean) then
    insert into public.audit_events(actor_id, action, resource_id)
      values (auth.uid(), 'course_submissions.review_accessed', p_version_id);
  end if;
  return result;
end;
$$;

create function private.withdraw_course_submission(p_run_id uuid, p_version_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  context jsonb;
begin
  perform private.lock_course_premium(p_run_id);
  context := private.course_submission_context(p_run_id);
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

-- The worker can apply only an exact reserved payload and only while its
-- deletion barrier is held. End can settle an old lease after revocation.
create function private.course_submission_scan(
  p_document_id uuid, p_version_id uuid, p_action text, p_lease_id uuid,
  p_sha256 text, p_scanner_version text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  intake private.course_submissions%rowtype;
  version public.document_versions%rowtype;
  lease_id uuid;
begin
  if current_setting('role', true) is distinct from 'service_role' then
    raise insufficient_privilege;
  end if;
  if p_action = 'end' then
    if p_lease_id is null or p_sha256 is not null or p_scanner_version is not null then
      raise invalid_parameter_value;
    end if;
    delete from private.deletion_upload_leases
    where id = p_lease_id and document_id = p_document_id and version_id = p_version_id
    returning id into lease_id;
    if not found then raise insufficient_privilege; end if;
    return lease_id;
  end if;

  -- Preserve the deletion layer's global-before-document lock order.
  if p_action = 'begin' then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('permanent-deletion', 0));
  end if;
  select * into intake from private.course_submissions where version_id = p_version_id and withdrawn_at is null;
  if not found then raise insufficient_privilege; end if;
  select * into version from public.document_versions stored
    where stored.id = p_version_id and stored.document_id = p_document_id and stored.version = 1;
  if not found then raise insufficient_privilege; end if;
  perform private.lock_course_submission_upload(intake.run_id, version.uploaded_by);
  if p_action = 'begin' then
    if p_lease_id is not null or p_scanner_version is not null or p_sha256 is distinct from intake.expected_sha256 then
      raise insufficient_privilege;
    end if;
    lease_id := private.deletion_upload_begin(p_document_id, p_version_id);
  else
    select id into lease_id from private.deletion_upload_leases
    where id = p_lease_id and document_id = p_document_id and version_id = p_version_id for update;
    if not found then raise insufficient_privilege; end if;
  end if;

  -- Match profile/course/read locks before taking the document pair. An
  -- operator release or course mutation either precedes or follows the verdict.
  perform 1 from public.documents document
  where document.id = p_document_id and document.current_version_id = p_version_id
    and document.scope = 'personal' and document.kind = 'participant_submission' and document.deleted_at is null
    and document.owner_id = version.uploaded_by and document.uploaded_by = version.uploaded_by
    and document.status in ('quarantined', 'scanning', 'scan_error') for update;
  if not found or private.deletion_document_fenced(p_document_id) then raise insufficient_privilege; end if;
  if p_action = 'begin' then
    update public.document_versions set status = 'scanning' where id = p_version_id;
    update public.documents set status = 'scanning' where id = p_document_id;
  elsif p_action = 'scan_error' then
    if p_sha256 is not null or p_scanner_version is not null then raise invalid_parameter_value; end if;
    update public.document_versions set status = 'scan_error' where id = p_version_id and status = 'scanning';
    if not found then raise insufficient_privilege; end if;
    update public.documents set status = 'scan_error' where id = p_document_id;
  elsif p_action in ('clean', 'rejected') then
    if p_sha256 is distinct from intake.expected_sha256 or p_scanner_version is null
       or length(p_scanner_version) > 1024 or p_scanner_version not like 'ClamAV %' then
      raise insufficient_privilege;
    end if;
    update public.document_versions
      set status = p_action, sha256 = p_sha256, scanner_version = p_scanner_version
      where id = p_version_id and status = 'scanning';
    if not found then raise insufficient_privilege; end if;
    update public.documents set status = p_action where id = p_document_id;
    insert into public.audit_events(actor_id, action, resource_id)
      values (version.uploaded_by, 'document.scan_' || p_action, p_document_id);
  else
    raise invalid_parameter_value;
  end if;
  return lease_id;
end;
$$;

create function public.reserve_course_submission(p_run_id uuid, p_name text, p_mime text, p_size bigint, p_client_id uuid, p_sha256 text)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.reserve_course_submission(p_run_id, p_name, p_mime, p_size, p_client_id, p_sha256);
$$;
create function public.course_submission_status(p_run_id uuid, p_document_id uuid, p_version_id uuid)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.course_submission_status(p_run_id, p_document_id, p_version_id);
$$;
create function public.course_submissions(p_run_id uuid, p_after uuid default null)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.course_submissions(p_run_id, p_after);
$$;
create function public.set_course_submissions(p_run_id uuid, p_enabled boolean)
returns boolean language sql security invoker set search_path = '' as $$
  select private.set_course_submissions(p_run_id, p_enabled);
$$;
create function public.course_submission_access(p_run_id uuid, p_version_id uuid, p_record boolean default false)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.course_submission_access(p_run_id, p_version_id, p_record);
$$;
create function public.withdraw_course_submission(p_run_id uuid, p_version_id uuid)
returns boolean language sql security invoker set search_path = '' as $$
  select private.withdraw_course_submission(p_run_id, p_version_id);
$$;
create function public.course_submission_scan(p_document_id uuid, p_version_id uuid, p_action text, p_lease_id uuid, p_sha256 text, p_scanner_version text)
returns uuid language sql security invoker set search_path = '' as $$
  select private.course_submission_scan(p_document_id, p_version_id, p_action, p_lease_id, p_sha256, p_scanner_version);
$$;

revoke all on function
  private.course_submission_context(uuid),
  private.lock_course_submission_upload(uuid, uuid),
  private.reserve_course_submission(uuid, text, text, bigint, uuid, text),
  public.reserve_course_submission(uuid, text, text, bigint, uuid, text),
  private.course_submission_status(uuid, uuid, uuid),
  public.course_submission_status(uuid, uuid, uuid),
  private.course_submissions(uuid, uuid),
  public.course_submissions(uuid, uuid),
  private.set_course_submissions(uuid, boolean),
  public.set_course_submissions(uuid, boolean),
  private.course_submission_access(uuid, uuid, boolean),
  public.course_submission_access(uuid, uuid, boolean),
  private.withdraw_course_submission(uuid, uuid),
  public.withdraw_course_submission(uuid, uuid),
  private.course_submission_scan(uuid, uuid, text, uuid, text, text),
  public.course_submission_scan(uuid, uuid, text, uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function
  private.reserve_course_submission(uuid, text, text, bigint, uuid, text),
  public.reserve_course_submission(uuid, text, text, bigint, uuid, text),
  private.course_submission_status(uuid, uuid, uuid),
  public.course_submission_status(uuid, uuid, uuid),
  private.course_submissions(uuid, uuid),
  public.course_submissions(uuid, uuid),
  private.set_course_submissions(uuid, boolean),
  public.set_course_submissions(uuid, boolean),
  private.course_submission_access(uuid, uuid, boolean),
  public.course_submission_access(uuid, uuid, boolean),
  private.withdraw_course_submission(uuid, uuid),
  public.withdraw_course_submission(uuid, uuid)
  to authenticated;
grant execute on function
  private.course_submission_scan(uuid, uuid, text, uuid, text, text),
  public.course_submission_scan(uuid, uuid, text, uuid, text, text)
  to service_role;

alter function private.require_portal_access() rename to require_portal_access_before_submissions;
revoke all on function private.require_portal_access_before_submissions() from public, anon, authenticated, service_role;
create function private.require_portal_access()
returns void language plpgsql stable security definer set search_path = '' as $$
declare
  request_headers jsonb := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
begin
  if private.participant_actor()
     and coalesce(request_headers->>'accept-profile', 'public') = 'public'
     and coalesce(request_headers->>'content-profile', 'public') = 'public'
     and current_setting('request.method', true) = 'POST'
     and current_setting('request.path', true) in (
       '/rpc/reserve_course_submission', '/rpc/course_submission_status', '/rpc/course_submissions',
       '/rpc/course_submission_access', '/rpc/withdraw_course_submission'
     ) then return; end if;
  perform private.require_portal_access_before_submissions();
end;
$$;
revoke all on function private.require_portal_access() from public, anon, authenticated, service_role;
grant execute on function private.require_portal_access() to authenticated;

-- Keep all prior audit actions, including the retained-course file reader.
alter function private.admin_audit_actions() rename to admin_audit_actions_before_submissions;
revoke all on function private.admin_audit_actions_before_submissions() from public, anon, authenticated, service_role;
create function private.admin_audit_actions() returns text[]
language sql immutable set search_path = '' as $$
  select private.admin_audit_actions_before_submissions() || array[
    'course_submissions.enabled', 'course_submissions.disabled',
    'course_submissions.withdrawn', 'course_submissions.review_accessed'
  ];
$$;
revoke all on function private.admin_audit_actions() from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';
commit;
