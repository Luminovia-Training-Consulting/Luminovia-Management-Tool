begin;

create table private.academy_course_material_intake (
  version_id uuid primary key references public.document_versions(id) on delete cascade,
  run_id uuid not null references public.course_runs(id),
  release_commit text not null check (release_commit ~ '^[0-9a-f]{40}$'),
  expected_sha256 text not null check (expected_sha256 ~ '^[0-9a-f]{64}$')
);
create index academy_course_material_intake_run on private.academy_course_material_intake(run_id);
alter table private.academy_course_material_intake enable row level security;
revoke all on private.academy_course_material_intake from public, anon, authenticated, service_role;

-- Match the existing current-instructor predicate for both caller and scanner.
create function private.academy_course_teacher(p_course_id uuid, p_teacher_id uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists (
    select 1 from private.academy_course_instructors assignment
    join public.job_claims claim on claim.id = assignment.claim_id
    join public.jobs job on job.id = claim.job_id
    where job.course_run_id = p_course_id and claim.lecturer_id = p_teacher_id
      and claim.status = 'confirmed' and assignment.course_id = p_course_id
      and assignment.instructor_id = p_teacher_id and assignment.released_at is null
  );
$$;
revoke all on function private.academy_course_teacher(uuid, uuid) from public, anon, authenticated, service_role;

create or replace function private.course_has_current_teacher(p_course_id uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select case when (select edition from private.installation_identity) = 'internal' then exists (
    select 1 from public.job_claims claim
    join public.jobs job on job.id = claim.job_id
    where job.course_run_id = p_course_id and claim.lecturer_id = auth.uid() and claim.status = 'confirmed'
  ) else private.academy_course_teacher(p_course_id, auth.uid()) end;
$$;

create function private.lock_academy_material_teacher(p_run_id uuid, p_actor_id uuid)
returns text language plpgsql security invoker set search_path = '' as $$
begin
  perform private.lock_academy_course_access();
  perform 1 from public.profiles where id = p_actor_id and active for share;
  if not found then raise insufficient_privilege; end if;
  perform 1 from public.user_roles where user_id = p_actor_id order by role for share;
  perform 1 from public.course_runs run
  join public.organisations organisation on run.organisation_id = organisation.id
  where run.id = p_run_id and run.archived_at is null and organisation.archived_at is null
  for no key update of run for share of organisation;
  if not found or not private.lecturer_user(p_actor_id) or
     not private.academy_course_teacher(p_run_id, p_actor_id) then
    raise insufficient_privilege;
  end if;
  return (select release_commit from private.academy_course_access);
end;
$$;
revoke all on function private.lock_academy_material_teacher(uuid, uuid) from public, anon, authenticated, service_role;

create function private.reserve_academy_course_material(
  p_run_id uuid, p_name text, p_mime text, p_size bigint, p_client_id uuid, p_sha256 text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  release text;
  existing_version uuid;
  result jsonb;
begin
  release := private.lock_academy_material_teacher(p_run_id, actor_id);
  if p_client_id is null or p_size is null or p_size not between 1 and 10485760
     or not coalesce(p_sha256 ~ '^[0-9a-f]{64}$', false) then
    raise invalid_parameter_value;
  end if;
  -- Match the allocator's lock order and count retained reservations before
  -- claiming new capacity. An exact retry has already consumed its quota.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('documents-global-quota', 0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('documents:' || actor_id::text, 0));
  select id into existing_version from public.document_versions
    where uploaded_by = actor_id and client_id = p_client_id;
  if found then
    if not exists (
      select 1 from private.academy_course_material_intake
        where version_id = existing_version and run_id = p_run_id
          and release_commit = release and expected_sha256 = p_sha256
    ) then
      raise exception 'Course material reservation conflicts with this upload' using errcode = 'PT409';
    end if;
  elsif (select coalesce(sum(size_bytes), 0) from public.document_versions) + p_size >
      (select (terms #>> '{limits,storage_bytes}')::bigint from private.installation_verified_licence) then
    raise exception 'Academy storage quota reached' using errcode = '54000';
  end if;
  result := private.reserve_document(p_name, p_mime, p_size, 'personal', 'material',
    null, null, p_client_id, null, null);
  if existing_version is null then
    insert into private.academy_course_material_intake
      (version_id, run_id, release_commit, expected_sha256)
    values ((result->>'version_id')::uuid, p_run_id, release, p_sha256);
  end if;
  return result;
end;
$$;

create function private.academy_course_material_status(
  p_run_id uuid, p_document_id uuid, p_version_id uuid
)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'document', jsonb_build_object(
      'id', document.id, 'owner_id', document.owner_id, 'uploaded_by', document.uploaded_by,
      'scope', document.scope, 'kind', document.kind, 'room_id', document.room_id, 'job_id', document.job_id,
      'original_name', document.original_name, 'mime_type', document.mime_type, 'size_bytes', document.size_bytes,
      'status', document.status, 'current_version_id', version.id, 'created_at', document.created_at, 'deleted_at', null
    ), 'sha256', version.sha256
  )
  from private.academy_course_material_intake intake
  join private.academy_course_access access on access.release_commit = intake.release_commit
  join public.course_runs run on run.id = intake.run_id and run.archived_at is null
  join public.organisations organisation on organisation.id = run.organisation_id and organisation.archived_at is null
  join public.document_versions version on version.id = intake.version_id
  join public.documents document on document.id = version.document_id and document.current_version_id = version.id
  where intake.run_id = p_run_id and document.id = p_document_id and version.id = p_version_id
    and private.academy_course_access_status() = 'active'
    and private.lecturer_actor() and private.academy_course_teacher(p_run_id, auth.uid())
    and document.owner_id = auth.uid() and document.uploaded_by = auth.uid() and version.uploaded_by = auth.uid()
    and version.version = 1 and document.kind = 'material' and document.scope = 'personal'
    and document.deleted_at is null and not private.deletion_document_fenced(document.id);
$$;

-- The worker can apply only an exact reserved payload and only while its
-- deletion barrier is held. End can settle an old lease after revocation.
create function private.academy_course_material_scan(
  p_document_id uuid, p_version_id uuid, p_action text, p_lease_id uuid,
  p_sha256 text, p_scanner_version text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  intake private.academy_course_material_intake%rowtype;
  version public.document_versions%rowtype;
  lease_id uuid;
begin
  if current_setting('role', true) is distinct from 'service_role' then
    raise insufficient_privilege;
  end if;
  select * into intake from private.academy_course_material_intake where version_id = p_version_id;
  if not found then raise insufficient_privilege; end if;
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
  select * into version from public.document_versions where id = p_version_id and document_id = p_document_id;
  if not found or private.lock_academy_material_teacher(intake.run_id, version.uploaded_by) is distinct from intake.release_commit then
    raise insufficient_privilege;
  end if;
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
    and document.scope = 'personal' and document.kind = 'material' and document.deleted_at is null
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

create function public.reserve_academy_course_material(
  p_run_id uuid, p_name text, p_mime text, p_size bigint, p_client_id uuid, p_sha256 text
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.reserve_academy_course_material(p_run_id, p_name, p_mime, p_size, p_client_id, p_sha256);
$$;

create function public.academy_course_material_status(
  p_run_id uuid, p_document_id uuid, p_version_id uuid
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.academy_course_material_status(p_run_id, p_document_id, p_version_id);
$$;

create function public.academy_course_material_scan(
  p_document_id uuid, p_version_id uuid, p_action text, p_lease_id uuid default null,
  p_sha256 text default null, p_scanner_version text default null
) returns uuid language sql security invoker set search_path = '' as $$
  select private.academy_course_material_scan(p_document_id, p_version_id, p_action, p_lease_id, p_sha256, p_scanner_version);
$$;

revoke all on function
  private.reserve_academy_course_material(uuid, text, text, bigint, uuid, text),
  public.reserve_academy_course_material(uuid, text, text, bigint, uuid, text),
  private.academy_course_material_status(uuid, uuid, uuid),
  public.academy_course_material_status(uuid, uuid, uuid),
  private.academy_course_material_scan(uuid, uuid, text, uuid, text, text),
  public.academy_course_material_scan(uuid, uuid, text, uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function
  private.reserve_academy_course_material(uuid, text, text, bigint, uuid, text),
  public.reserve_academy_course_material(uuid, text, text, bigint, uuid, text),
  private.academy_course_material_status(uuid, uuid, uuid),
  public.academy_course_material_status(uuid, uuid, uuid)
  to authenticated;
grant execute on function
  private.academy_course_material_scan(uuid, uuid, text, uuid, text, text),
  public.academy_course_material_scan(uuid, uuid, text, uuid, text, text)
  to service_role;

-- Preserve the audited retained-file command and stop cross-course publication
-- of an intake version even when the same lecturer teaches multiple courses.
alter function private.academy_course_material_action(uuid, text, uuid, text, text)
  rename to academy_course_material_action_before_intake;
revoke all on function private.academy_course_material_action_before_intake(uuid, text, uuid, text, text)
  from public, anon, authenticated, service_role;
create function private.academy_course_material_action(
  p_run_id uuid, p_action text, p_id uuid, p_audience text, p_category text
) returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if p_action = 'resource_share' and exists (
    select 1 from private.academy_course_material_intake
    where version_id = p_id and run_id is distinct from p_run_id
  ) then
    raise insufficient_privilege;
  end if;
  return private.academy_course_material_action_before_intake(p_run_id, p_action, p_id, p_audience, p_category);
end;
$$;
revoke all on function private.academy_course_material_action(uuid, text, uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function private.academy_course_material_action(uuid, text, uuid, text, text) to authenticated;

create or replace function public.academy_course_material_action(
  p_run_id uuid, p_action text, p_id uuid, p_audience text default null, p_category text default null
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.academy_course_material_action(p_run_id, p_action, p_id, p_audience, p_category);
$$;

create or replace function private.require_academy_course_access()
returns void language plpgsql stable security definer set search_path = '' as $$
declare
  request_path text := current_setting('request.path', true);
  request_method text := current_setting('request.method', true);
  request_headers jsonb := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
  licence_status text;
begin
  if current_setting('role', true) is distinct from 'authenticated'
     or coalesce(request_headers->>'accept-profile', 'public') <> 'public'
     or coalesce(request_headers->>'content-profile', 'public') <> 'public'
     or not private.learning_actor() then
    raise insufficient_privilege;
  end if;

  licence_status := private.academy_course_access_status();
  if licence_status in ('active', 'grace') and request_method in ('GET', 'HEAD', 'POST') and request_path in (
    '/rpc/portal_access', '/rpc/my_course_workspaces', '/rpc/course_workspace',
    '/rpc/course_workspace_entitlement', '/rpc/course_enrolments', '/rpc/course_welcome_content',
    '/rpc/course_chat_rooms', '/rpc/course_chat_messages'
  ) then
    return;
  end if;
  if licence_status in ('active', 'grace') and request_method = 'POST'
     and request_path = '/rpc/course_document_access' then
    return;
  end if;
  if licence_status = 'active' and (
    (request_method in ('GET', 'HEAD', 'POST') and request_path in (
      '/rpc/academy_course_instructor_candidates', '/rpc/course_enrolment_candidates'
    ))
    or (request_method = 'POST' and request_path in (
      '/rpc/academy_assign_course_instructor', '/rpc/academy_release_course_instructor',
      '/rpc/manage_course_enrolment', '/rpc/set_course_meeting_link', '/rpc/save_course_run',
      '/rpc/publish_course_welcome_content', '/rpc/academy_ensure_course_chat', '/rpc/send_course_chat_message',
      '/rpc/academy_course_material_action', '/rpc/reserve_academy_course_material',
      '/rpc/academy_course_material_status'
    ))
  ) then
    return;
  end if;

  raise exception 'Academy course operation unavailable' using errcode = '42501';
end;
$$;

create or replace function public.require_portal_access()
returns void language plpgsql stable security invoker set search_path = '' as $$
declare
  request_headers jsonb := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
begin
  if (select edition from public.installation_capability_state) is distinct from 'internal' then
    if current_setting('request.path', true) = '/rpc/installation_capabilities'
       and current_setting('request.method', true) in ('GET', 'HEAD', 'POST') then
      return;
    end if;
    if current_setting('role', true) = 'authenticated' then
      perform private.require_academy_course_access();
      return;
    end if;
    if current_setting('role', true) = 'service_role' then
      if current_setting('request.path', true) = '/rpc/academy_course_material_scan'
         and current_setting('request.method', true) = 'POST'
         and coalesce(request_headers->>'accept-profile', 'public') = 'public'
         and coalesce(request_headers->>'content-profile', 'public') = 'public' then
        return;
      end if;
      perform private.require_academy_human_login_access();
      return;
    end if;
    raise exception 'Customer installation is not active' using errcode = '42501';
  end if;
  if current_setting('role', true) = 'authenticated' then
    perform private.require_portal_access();
  end if;
end;
$$;

notify pgrst, 'reload schema';
commit;
