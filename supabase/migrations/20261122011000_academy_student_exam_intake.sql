begin;

-- Bind a scanner reservation to the course, exact bytes and intended use.
-- Existing reservations keep their ordinary material permissions.
alter table private.academy_course_material_intake
  add column purpose text not null default 'material'
    check (purpose in ('material', 'student_exam'));

-- The worker revalidates the stored uploader, not its own service identity.
-- The actor projection matches the course workspace's three editor branches.
create function private.academy_student_exam_intake_allowed(
  p_run_id uuid, p_actor_id uuid
) returns boolean language sql stable security invoker set search_path = '' as $$
  select exists (
    select 1 from public.course_runs run
    join public.organisations organisation on organisation.id = run.organisation_id
    join private.course_exam_settings exam on exam.run_id = run.id and exam.required
    join public.profiles actor on actor.id = p_actor_id and actor.active
    where run.id = p_run_id and run.archived_at is null and organisation.archived_at is null
      and private.course_exam_editor(jsonb_build_object(
        'manager', exists (
          select 1 from public.user_roles role
          join public.role_permissions permission using (role)
          where role.user_id = actor.id and permission.permission = 'courses.manage'
            and role.role in ('owner', 'admin', 'management', 'lecturer', 'senior_lecturer', 'client')
        ),
        'teacher', private.lecturer_user(actor.id) and private.academy_course_teacher(run.id, actor.id),
        'client', exists (
          select 1 from public.client_organisation_memberships membership
          join public.user_roles role on role.user_id = membership.user_id and role.role = 'client'
          where membership.user_id = actor.id and membership.organisation_id = organisation.id
            and membership.removed_at is null
        ) and not exists (
          select 1 from public.user_roles role
          where role.user_id = actor.id and role.role in ('management', 'lecturer', 'senior_lecturer')
        )
      ))
  );
$$;
revoke all on function private.academy_student_exam_intake_allowed(uuid, uuid) from public, anon, authenticated, service_role;

create function private.lock_academy_file_intake(
  p_run_id uuid, p_actor_id uuid, p_purpose text
) returns text language plpgsql security invoker set search_path = '' as $$
declare
  company_id uuid;
begin
  if p_purpose = 'material' then
    return private.lock_academy_material_teacher(p_run_id, p_actor_id);
  end if;
  if p_purpose is distinct from 'student_exam' or
     not private.academy_student_exam_intake_allowed(p_run_id, p_actor_id) then
    raise insufficient_privilege;
  end if;
  perform private.lock_academy_course_access();
  perform 1 from public.profiles where id = p_actor_id and active for share;
  if not found then raise insufficient_privilege; end if;
  perform 1 from public.user_roles where user_id = p_actor_id order by role for share;
  select organisation.id into company_id
  from public.course_runs run join public.organisations organisation on organisation.id = run.organisation_id
  where run.id = p_run_id and run.archived_at is null and organisation.archived_at is null
  for no key update of run for share of organisation;
  if not found then raise insufficient_privilege; end if;
  perform 1 from public.client_organisation_memberships membership
  where membership.user_id = p_actor_id and membership.organisation_id = company_id for share;
  if not private.academy_student_exam_intake_allowed(p_run_id, p_actor_id) then
    raise insufficient_privilege;
  end if;
  return (select release_commit from private.academy_course_access);
end;
$$;
revoke all on function private.lock_academy_file_intake(uuid, uuid, text) from public, anon, authenticated, service_role;

create function private.reserve_academy_course_file(
  p_run_id uuid, p_name text, p_mime text, p_size bigint, p_client_id uuid, p_sha256 text, p_purpose text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  release text;
  existing_version uuid;
  result jsonb;
begin
  release := private.lock_academy_file_intake(p_run_id, actor_id, p_purpose);
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
          and release_commit = release and expected_sha256 = p_sha256 and purpose = p_purpose
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
      (version_id, run_id, release_commit, expected_sha256, purpose)
    values ((result->>'version_id')::uuid, p_run_id, release, p_sha256, p_purpose);
  end if;
  return result;
end;
$$;

revoke all on function private.reserve_academy_course_file(uuid, text, text, bigint, uuid, text, text)
  from public, anon, authenticated, service_role;

create or replace function private.reserve_academy_course_material(
  p_run_id uuid, p_name text, p_mime text, p_size bigint, p_client_id uuid, p_sha256 text
) returns jsonb language sql security definer set search_path = '' as $$
  select private.reserve_academy_course_file(p_run_id, p_name, p_mime, p_size, p_client_id, p_sha256, 'material');
$$;

create function private.reserve_academy_student_exam_pdf(
  p_run_id uuid, p_name text, p_size bigint, p_client_id uuid, p_sha256 text
) returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if p_name is null or right(lower(p_name), 4) <> '.pdf' then raise invalid_parameter_value; end if;
  return private.reserve_academy_course_file(
    p_run_id, p_name, 'application/pdf', p_size, p_client_id, p_sha256, 'student_exam');
end;
$$;

create function public.reserve_academy_student_exam_pdf(
  p_run_id uuid, p_name text, p_size bigint, p_client_id uuid, p_sha256 text
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.reserve_academy_student_exam_pdf(p_run_id, p_name, p_size, p_client_id, p_sha256);
$$;
revoke all on function private.reserve_academy_student_exam_pdf(uuid, text, bigint, uuid, text),
  public.reserve_academy_student_exam_pdf(uuid, text, bigint, uuid, text) from public, anon, authenticated, service_role;
grant execute on function private.reserve_academy_student_exam_pdf(uuid, text, bigint, uuid, text),
  public.reserve_academy_student_exam_pdf(uuid, text, bigint, uuid, text) to authenticated;

create or replace function private.academy_course_material_status(
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
    and case when intake.purpose = 'student_exam'
      then private.academy_student_exam_intake_allowed(p_run_id, auth.uid())
      else private.lecturer_actor() and private.academy_course_teacher(p_run_id, auth.uid())
    end
    and document.owner_id = auth.uid() and document.uploaded_by = auth.uid() and version.uploaded_by = auth.uid()
    and version.version = 1 and document.kind = 'material' and document.scope = 'personal'
    and document.deleted_at is null and not private.deletion_document_fenced(document.id);
$$;

-- Reuse the immutable scanner pipeline. Only the current scoped editor check
-- varies with the purpose; end can still settle a lease after revocation.
do $$
declare
  definition text := pg_catalog.pg_get_functiondef('private.academy_course_material_scan(uuid,uuid,text,uuid,text,text)'::regprocedure);
  anchor constant text := 'private.lock_academy_material_teacher(intake.run_id, version.uploaded_by)';
begin
  if cardinality(string_to_array(definition, anchor)) <> 2 then
    raise exception 'Expected exactly one scanner authority boundary';
  end if;
  execute replace(definition, anchor,
    'private.lock_academy_file_intake(intake.run_id, version.uploaded_by, intake.purpose)');
end;
$$;

-- Exam bytes cannot be published as a normal material even between the scan
-- and the explicit student-paper publication.
create or replace function private.course_document_is_dedicated(p_document uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.course_document_in_original_registry(p_document) or (
    (select edition from private.installation_identity) is distinct from 'internal'
    and exists (
      select 1 from private.course_exam_documents exam
      join public.document_versions version on version.id = exam.version_id
      where version.document_id = p_document
      union all
      select 1 from private.academy_course_material_intake intake
      join public.document_versions version on version.id = intake.version_id
      where intake.purpose = 'student_exam' and version.document_id = p_document
    )
  );
$$;
revoke all on function private.course_document_is_dedicated(uuid) from public, anon, authenticated, service_role;

do $$
declare
  definition text := pg_catalog.pg_get_functiondef('private.require_academy_course_access()'::regprocedure);
  anchor constant text := '''/rpc/reserve_academy_course_material''';
begin
  if cardinality(string_to_array(definition, anchor)) <> 2 then
    raise exception 'Expected exactly one academy reservation endpoint';
  end if;
  execute replace(definition, anchor, anchor || ', ''/rpc/reserve_academy_student_exam_pdf''');
end;
$$;

notify pgrst, 'reload schema';
commit;
