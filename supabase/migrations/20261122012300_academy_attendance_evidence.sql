begin;

alter table private.course_attendance_evidence
  alter column resource_id drop not null,
  add column source text not null default 'course_resource',
  add constraint course_attendance_evidence_source_check check (
    (source = 'course_resource' and resource_id is not null) or
    (source = 'academy_scan' and resource_id is null)
  );

alter table private.academy_course_material_intake
  add column session_id uuid references public.course_sessions(id) on delete set null,
  drop constraint academy_course_material_intake_purpose_check,
  add constraint academy_course_material_intake_purpose_check check (
    purpose in ('material', 'student_exam', 'exam_staff', 'course_chat', 'attendance_evidence')
    and ((purpose = 'course_chat') = (room_id is not null))
    and (purpose = 'attendance_evidence' or session_id is null)
  );

-- The course role is the same as for a student-paper editor, with no exam
-- decision dependency. Bind the write and scanner to the exact session too.
create function private.lock_academy_attendance_evidence(p_run_id uuid, p_session_id uuid, p_actor_id uuid)
returns text language plpgsql security invoker set search_path = '' as $$
declare release text;
begin
  release := private.lock_academy_exam_editor(p_run_id, p_actor_id, 'student_exam');
  perform 1 from public.course_sessions where course_run_id = p_run_id and id = p_session_id for share;
  if not found then raise insufficient_privilege; end if;
  return release;
end;
$$;
revoke all on function private.lock_academy_attendance_evidence(uuid, uuid, uuid) from public, anon, authenticated, service_role;

create function private.reserve_academy_personal_course_file(
  p_run_id uuid, p_name text, p_mime text, p_size bigint, p_client_id uuid, p_sha256 text, p_purpose text, p_session_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  release text;
  existing_version uuid;
  result jsonb;
begin
  release := case when p_purpose = 'attendance_evidence'
    then private.lock_academy_attendance_evidence(p_run_id, p_session_id, actor_id)
    else private.lock_academy_file_intake(p_run_id, actor_id, p_purpose)
  end;
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
          and session_id is not distinct from p_session_id
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
      (version_id, run_id, release_commit, expected_sha256, purpose, session_id)
    values ((result->>'version_id')::uuid, p_run_id, release, p_sha256, p_purpose, p_session_id);
  end if;
  return result;
end;
$$;

revoke all on function private.reserve_academy_personal_course_file(uuid, text, text, bigint, uuid, text, text, uuid)
  from public, anon, authenticated, service_role;

create or replace function private.reserve_academy_course_file(
  p_run_id uuid, p_name text, p_mime text, p_size bigint, p_client_id uuid, p_sha256 text, p_purpose text
) returns jsonb language sql security definer set search_path = '' as $$
  select private.reserve_academy_personal_course_file(
    p_run_id, p_name, p_mime, p_size, p_client_id, p_sha256, p_purpose, null
  );
$$;

create function private.reserve_academy_attendance_pdf(
  p_session_id uuid, p_name text, p_size bigint, p_client_id uuid, p_sha256 text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare course_id uuid;
begin
  if p_name is null or right(lower(p_name), 4) <> '.pdf' then raise invalid_parameter_value; end if;
  select course_run_id into course_id from public.course_sessions where id = p_session_id;
  if not found then raise insufficient_privilege; end if;
  return private.reserve_academy_personal_course_file(
    course_id, p_name, 'application/pdf', p_size, p_client_id, p_sha256, 'attendance_evidence', p_session_id
  );
end;
$$;
create function public.reserve_academy_attendance_pdf(
  p_session_id uuid, p_name text, p_size bigint, p_client_id uuid, p_sha256 text
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.reserve_academy_attendance_pdf(p_session_id, p_name, p_size, p_client_id, p_sha256);
$$;
revoke all on function private.reserve_academy_attendance_pdf(uuid, text, bigint, uuid, text),
  public.reserve_academy_attendance_pdf(uuid, text, bigint, uuid, text) from public, anon, authenticated, service_role;
grant execute on function private.reserve_academy_attendance_pdf(uuid, text, bigint, uuid, text),
  public.reserve_academy_attendance_pdf(uuid, text, bigint, uuid, text) to authenticated;

create function private.academy_attendance_upload_status(p_session_id uuid, p_document_id uuid, p_version_id uuid)
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
  join public.course_sessions session on session.id = intake.session_id and session.course_run_id = intake.run_id
  join public.document_versions version on version.id = intake.version_id
  join public.documents document on document.id = version.document_id and document.current_version_id = version.id
  where intake.session_id = p_session_id and document.id = p_document_id and version.id = p_version_id
    and intake.purpose = 'attendance_evidence' and private.academy_course_access_status() = 'active'
    and private.academy_exam_actor_allowed(intake.run_id, auth.uid(), 'student_exam')
    and document.owner_id = auth.uid() and document.uploaded_by = auth.uid() and version.uploaded_by = auth.uid()
    and version.version = 1 and document.kind = 'material' and document.scope = 'personal'
    and version.mime_type = 'application/pdf' and document.mime_type = 'application/pdf'
    and (version.status <> 'clean' or version.sha256 = intake.expected_sha256)
    and document.deleted_at is null and not private.deletion_document_fenced(document.id);
$$;
create function public.academy_attendance_upload_status(p_session_id uuid, p_document_id uuid, p_version_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.academy_attendance_upload_status(p_session_id, p_document_id, p_version_id);
$$;
revoke all on function private.academy_attendance_upload_status(uuid, uuid, uuid),
  public.academy_attendance_upload_status(uuid, uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function private.academy_attendance_upload_status(uuid, uuid, uuid),
  public.academy_attendance_upload_status(uuid, uuid, uuid) to authenticated;

-- Extend the worker's existing lease/hash/scan state machine with an exact
-- session role check. Existing material and participant-chat paths remain.
do $$
declare
  worker text := pg_catalog.pg_get_functiondef('private.academy_course_material_scan(uuid,uuid,text,uuid,text,text)'::regprocedure);
  registry text := pg_catalog.pg_get_functiondef('private.course_document_is_dedicated(uuid)'::regprocedure);
  student_source text := pg_catalog.pg_get_functiondef('private.academy_student_exam_source(uuid,uuid,uuid)'::regprocedure);
  material_status text := pg_catalog.pg_get_functiondef('private.academy_course_material_status(uuid,uuid,uuid)'::regprocedure);
  worker_anchor constant text := 'else private.lock_academy_file_intake(intake.run_id, version.uploaded_by, intake.purpose) = intake.release_commit';
  registry_anchor constant text := 'intake.purpose in (''student_exam'', ''exam_staff'')';
  exam_anchor constant text := 'intake.purpose = ''exam_staff''';
  status_anchor constant text := 'where intake.run_id = p_run_id and document.id = p_document_id and version.id = p_version_id';
begin
  if cardinality(string_to_array(worker, worker_anchor)) <> 2
    or cardinality(string_to_array(registry, registry_anchor)) <> 2
    or cardinality(string_to_array(student_source, exam_anchor)) <> 2
    or cardinality(string_to_array(material_status, status_anchor)) <> 2 then
    raise exception 'Expected exact academy attendance scan and cross-purpose barriers';
  end if;
  execute replace(worker, worker_anchor, $scope$when intake.purpose = 'attendance_evidence'
      then private.lock_academy_attendance_evidence(intake.run_id, intake.session_id, version.uploaded_by) = intake.release_commit
    $scope$ || worker_anchor);
  execute replace(registry, registry_anchor, 'intake.purpose in (''student_exam'', ''exam_staff'', ''attendance_evidence'')');
  execute replace(student_source, exam_anchor, 'intake.purpose in (''exam_staff'', ''attendance_evidence'')');
  execute replace(material_status, status_anchor, status_anchor || ' and intake.purpose <> ''attendance_evidence''');
end;
$$;

create function private.academy_attendance_evidence_version(p_run_id uuid, p_session_id uuid, p_version_id uuid)
returns table(document_id uuid, name text, object_path text, sha256 text, uploaded_by uuid)
language sql stable security invoker set search_path = '' as $$
  select document.id, version.original_name, version.object_path, version.sha256, version.uploaded_by
  from private.academy_course_material_intake intake
  join public.document_versions version on version.id = intake.version_id
  join public.documents document on document.id = version.document_id and document.current_version_id = version.id
  where intake.run_id = p_run_id and intake.session_id = p_session_id and intake.version_id = p_version_id
    and intake.purpose = 'attendance_evidence' and intake.expected_sha256 = version.sha256
    and version.status = 'clean' and document.status = 'clean' and version.version = 1
    and version.scanner_version like 'ClamAV %' and version.mime_type = 'application/pdf'
    and document.mime_type = 'application/pdf' and document.scope = 'personal' and document.kind = 'material'
    and document.owner_id = version.uploaded_by and document.uploaded_by = version.uploaded_by
    and document.deleted_at is null and not private.deletion_document_fenced(document.id);
$$;
revoke all on function private.academy_attendance_evidence_version(uuid, uuid, uuid) from public, anon, authenticated, service_role;

create function private.attach_academy_attendance_evidence(p_run_id uuid, p_session_id uuid, p_version_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare evidence_id uuid; release text;
begin
  release := private.lock_academy_attendance_evidence(p_run_id, p_session_id, auth.uid());
  perform 1 from public.documents document join public.document_versions version on version.document_id = document.id
  where version.id = p_version_id and document.owner_id = auth.uid() for share of document, version;
  if not found or not exists (
    select 1 from private.academy_attendance_evidence_version(p_run_id, p_session_id, p_version_id) version
    join private.academy_course_material_intake intake on intake.version_id = p_version_id
    where version.uploaded_by = auth.uid() and intake.release_commit = release
  ) then raise insufficient_privilege; end if;
  insert into private.course_attendance_evidence(session_id, version_id, attached_by, source)
  values (p_session_id, p_version_id, auth.uid(), 'academy_scan')
  on conflict (session_id, version_id) do nothing returning id into evidence_id;
  if evidence_id is null then
    select id into evidence_id from private.course_attendance_evidence
    where session_id = p_session_id and version_id = p_version_id and source = 'academy_scan';
    if not found then raise insufficient_privilege; end if;
  else
    insert into public.audit_events(actor_id, action, resource_id, details)
    values (auth.uid(), 'course.attendance_evidence_attached', p_session_id,
      jsonb_build_object('evidence_id', evidence_id, 'version_id', p_version_id));
  end if;
  return jsonb_build_object('id', evidence_id, 'resource_id', null, 'version_id', p_version_id);
end;
$$;
revoke all on function private.attach_academy_attendance_evidence(uuid, uuid, uuid) from public, anon, authenticated, service_role;

-- Apply the dedicated branch after the canonical register authority check.
create function private.academy_attendance_evidence_list(p_run_id uuid, p_session_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', evidence.id, 'resource_id', null, 'version_id', evidence.version_id,
    'name', version.name, 'attached_at', evidence.attached_at
  ) order by evidence.attached_at, evidence.id), '[]'::jsonb)
  from private.course_attendance_evidence evidence
  cross join lateral private.academy_attendance_evidence_version(p_run_id, evidence.session_id, evidence.version_id) version
  where evidence.session_id = p_session_id and evidence.source = 'academy_scan';
$$;
revoke all on function private.academy_attendance_evidence_list(uuid, uuid) from public, anon, authenticated, service_role;

create function private.academy_attendance_evidence_access(p_evidence_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare course_id uuid; session_id uuid; exact_version uuid; context jsonb; receipt jsonb;
begin
  if not coalesce(private.academy_course_access_status() in ('active', 'grace'), false) then
    raise insufficient_privilege;
  end if;
  select session.course_run_id, session.id, evidence.version_id into course_id, session_id, exact_version
  from private.course_attendance_evidence evidence
  join public.course_sessions session on session.id = evidence.session_id
  where evidence.id = p_evidence_id and evidence.source = 'academy_scan';
  if not found then raise insufficient_privilege; end if;
  context := private.course_workspace_context(course_id);
  if not coalesce((context->>'lms_enabled')::boolean and private.course_exam_editor(context), false) then
    raise insufficient_privilege;
  end if;
  select jsonb_build_object('id', exact_version, 'document_id', version.document_id, 'name', version.name,
    'mime_type', 'application/pdf', 'object_path', version.object_path, 'sha256', version.sha256)
  into receipt from private.academy_attendance_evidence_version(course_id, session_id, exact_version) version;
  if not found then raise insufficient_privilege; end if;
  return receipt;
end;
$$;
revoke all on function private.academy_attendance_evidence_access(uuid) from public, anon, authenticated, service_role;

do $$
declare
  attach text := pg_catalog.pg_get_functiondef('private.attach_course_session_evidence(uuid,uuid,uuid)'::regprocedure);
  register text := pg_catalog.pg_get_functiondef('private.course_session_register(uuid,uuid)'::regprocedure);
  resolver text := pg_catalog.pg_get_functiondef('private.course_document_access(text,uuid)'::regprocedure);
  gate text := pg_catalog.pg_get_functiondef('private.require_academy_course_access()'::regprocedure);
  attach_anchor constant text := '  perform private.lock_course_premium(p_run_id);';
  evidence_end constant text := 'where evidence.session_id=session_row.id),''[]''::jsonb) else ''[]''::jsonb end,';
  kinds constant text := 'p_kind not in (''resource'', ''exam'', ''completion'', ''attendance'')';
  resolver_anchor constant text := '  if p_kind = ''exam'' then';
  gate_anchor constant text := '''/rpc/save_course_session_attendance''';
begin
  if cardinality(string_to_array(attach, attach_anchor)) <> 2
    or cardinality(string_to_array(register, evidence_end)) <> 2
    or cardinality(string_to_array(resolver, kinds)) <> 2
    or cardinality(string_to_array(resolver, resolver_anchor)) <> 2
    or cardinality(string_to_array(gate, gate_anchor)) <> 2 then
    raise exception 'Expected exact academy attendance register, upload and download boundaries';
  end if;
  execute replace(attach, attach_anchor, $scope$  if (select edition from private.installation_identity) is distinct from 'internal' then
    return private.attach_academy_attendance_evidence(p_run_id, p_session_id, p_version_id);
  end if;
$scope$ || attach_anchor);
  execute replace(register, evidence_end,
    'where evidence.session_id=session_row.id),''[]''::jsonb) else private.academy_attendance_evidence_list(p_run_id, p_session_id) end,');
  resolver := replace(resolver, kinds, 'p_kind not in (''resource'', ''exam'', ''completion'', ''attendance'', ''attendance_evidence'')');
  execute replace(resolver, resolver_anchor, $scope$  if dedicated and p_kind = 'attendance_evidence' then
    return private.academy_attendance_evidence_access(p_id);
  end if;
$scope$ || resolver_anchor);
  execute replace(gate, gate_anchor, gate_anchor || ', ''/rpc/reserve_academy_attendance_pdf'', ''/rpc/academy_attendance_upload_status'', ''/rpc/attach_course_session_evidence''');
end;
$$;

notify pgrst, 'reload schema';
commit;
