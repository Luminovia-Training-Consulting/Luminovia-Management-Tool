begin;

-- Exam documents in a dedicated installation cannot also be course resources,
-- including retained answer keys and withdrawn papers.
alter function private.course_document_is_dedicated(uuid) rename to course_document_in_original_registry;
revoke all on function private.course_document_in_original_registry(uuid) from public, anon, authenticated, service_role;
create index course_exam_documents_version_idx on private.course_exam_documents(version_id);
create function private.course_document_is_dedicated(p_document uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.course_document_in_original_registry(p_document) or (
    (select edition from private.installation_identity) is distinct from 'internal'
    and exists (
      select 1 from private.course_exam_documents exam
      join public.document_versions version on version.id = exam.version_id
      where version.document_id = p_document
    )
  );
$$;
revoke all on function private.course_document_is_dedicated(uuid) from public, anon, authenticated, service_role;

-- Also suppress stale workspace metadata if an older installation retained
-- a general share before an exam document acquired its dedicated scope.
do $$
declare
  definition text := pg_catalog.pg_get_functiondef('private.course_resource_allowed(uuid)'::regprocedure);
  anchor constant text := 'if not found then return false; end if;';
begin
  if cardinality(string_to_array(definition, anchor)) <> 2 then
    raise exception 'Expected one course-resource scope boundary';
  end if;
  execute replace(definition, anchor, anchor || $guard$
  if (select edition from private.installation_identity) is distinct from 'internal'
     and private.course_document_is_dedicated((
       select version.document_id from public.document_versions version where version.id = resource_row.version_id
     )) then return false; end if;$guard$);
end;
$$;

-- Use this exact filter for both the picker and the locked publication check.
create function private.academy_student_exam_source(
  p_run_id uuid, p_version_id uuid, p_document_id uuid
)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists (
    select 1 from public.document_versions version
    join public.documents document on document.id = version.document_id
    where version.id = p_version_id and document.id = p_document_id
      and version.status = 'clean' and version.sha256 ~ '^[0-9a-f]{64}$'
      and nullif(btrim(version.scanner_version), '') is not null
      and version.mime_type = 'application/pdf'
      and document.scope = 'personal' and document.kind = 'material'
      and document.deleted_at is null and not private.deletion_document_fenced(document.id)
      and document.owner_id = auth.uid() and document.uploaded_by = auth.uid() and version.uploaded_by = auth.uid()
      and not private.course_document_in_original_registry(document.id)
      and not exists (
        select 1 from private.academy_course_material_intake intake
        where intake.version_id = version.id and intake.run_id <> p_run_id
      )
      and not exists (
        select 1 from private.course_resources resource
        join public.document_versions shared on shared.id = resource.version_id
        where shared.document_id = document.id and resource.removed_at is null
      )
      and not exists (
        select 1 from private.course_exam_documents exam
        join public.document_versions attached on attached.id = exam.version_id
        where attached.document_id = document.id and (exam.run_id <> p_run_id or exam.audience <> 'students')
      )
  );
$$;
revoke all on function private.academy_student_exam_source(uuid, uuid, uuid) from public, anon, authenticated, service_role;

create function private.academy_student_exam_pdf_options(p_run_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  context jsonb;
begin
  if private.academy_course_access_status() is distinct from 'active' then raise insufficient_privilege; end if;
  context := private.course_workspace_context(p_run_id);
  if not private.course_exam_editor(context) or not exists (
    select 1 from private.course_exam_settings where run_id = p_run_id and required
  ) then raise insufficient_privilege; end if;
  return coalesce((
    select jsonb_agg(to_jsonb(candidate) order by candidate.created_at desc, candidate.id)
    from (
      select version.id, version.original_name as name, version.version, version.created_at
      from public.document_versions version
      where version.uploaded_by = auth.uid()
        and private.academy_student_exam_source(p_run_id, version.id, version.document_id)
        and not exists (
          select 1 from private.course_exam_documents exam
          where exam.run_id = p_run_id and exam.version_id = version.id and exam.removed_at is null
        )
      order by version.created_at desc, version.id
      limit 50
    ) candidate
  ), '[]'::jsonb);
end;
$$;
create function public.academy_student_exam_pdf_options(p_run_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.academy_student_exam_pdf_options(p_run_id);
$$;
revoke all on function private.academy_student_exam_pdf_options(uuid),
  public.academy_student_exam_pdf_options(uuid) from public, anon, authenticated, service_role;
grant execute on function private.academy_student_exam_pdf_options(uuid),
  public.academy_student_exam_pdf_options(uuid) to authenticated;

-- The resolver and the workspace share the same publication proof. Callers
-- still pass their native bearer token through both checks in the Edge handler.
create function private.academy_student_exam_document_access(p_exam_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  selected private.course_exam_documents%rowtype;
  context jsonb;
  result jsonb;
begin
  if not coalesce(private.academy_course_access_status() in ('active', 'grace'), false) then
    raise insufficient_privilege;
  end if;
  select exam.* into selected from private.course_exam_documents exam
  join private.course_exam_settings setting on setting.run_id = exam.run_id and setting.required
  where exam.id = p_exam_id and exam.removed_at is null and exam.audience = 'students';
  if not found then raise insufficient_privilege; end if;
  context := private.course_workspace_context(selected.run_id);
  if not ((context->>'lms_enabled')::boolean and
    (private.course_exam_editor(context) or (context->>'learner')::boolean)) then
    raise insufficient_privilege;
  end if;
  select jsonb_build_object(
    'id', version.id, 'document_id', document.id, 'object_path', version.object_path,
    'name', version.original_name, 'mime_type', version.mime_type, 'sha256', version.sha256
  ) into result
  from public.document_versions version
  join public.documents document on document.id = version.document_id
  where version.id = selected.version_id and version.status = 'clean'
    and version.sha256 ~ '^[0-9a-f]{64}$' and nullif(btrim(version.scanner_version), '') is not null
    and version.mime_type = 'application/pdf' and document.deleted_at is null
    and not private.deletion_document_fenced(document.id)
    and not private.course_document_in_original_registry(document.id)
    and not exists (
      select 1 from private.course_exam_documents other
      where other.version_id = version.id and other.audience = 'exam_staff'
    );
  if not found then raise insufficient_privilege; end if;
  return result;
end;
$$;
revoke all on function private.academy_student_exam_document_access(uuid) from public, anon, authenticated, service_role;

create or replace function private.share_course_exam_pdf(
  p_run_id uuid, p_version_id uuid, p_audience text
) returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  context jsonb;
  existing private.course_exam_documents%rowtype;
  exam_id uuid;
  document_id uuid;
  course_org_id uuid;
  acting_user uuid := auth.uid();
  dedicated boolean := (select edition from private.installation_identity) is distinct from 'internal';
begin
  if dedicated then
    if p_audience is distinct from 'students' or
       not private.course_exam_editor(private.course_workspace_context(p_run_id)) then
      raise insufficient_privilege;
    end if;
    perform private.lock_academy_course_access();
    perform 1 from public.profiles where id = acting_user and active for share;
    if not found then raise insufficient_privilege; end if;
    perform 1 from public.user_roles where user_id = acting_user order by role for share;
    select org.id into course_org_id
    from public.course_runs run join public.organisations org on org.id = run.organisation_id
    where run.id = p_run_id and run.archived_at is null and org.archived_at is null
    for no key update of run for share of org;
    if not found then raise insufficient_privilege; end if;
    perform 1 from public.client_organisation_memberships membership
    where membership.organisation_id = course_org_id and membership.user_id = acting_user
    for share;
    if not exists (select 1 from private.course_exam_settings where run_id = p_run_id and required) then
      raise insufficient_privilege;
    end if;
    -- Use the same document lock as the generic material registry trigger,
    -- then check for conflicting paths in a new statement after any wait.
    select document.id into document_id from public.document_versions version
    join public.documents document on document.id = version.document_id
    where version.id = p_version_id and document.owner_id = acting_user
    for update of document for share of version;
    if not found or not private.academy_student_exam_source(p_run_id, p_version_id, document_id) then
      raise insufficient_privilege;
    end if;
  else
    perform private.lock_course_premium(p_run_id);
  end if;
  context := private.course_workspace_context(p_run_id);
  if not private.course_exam_editor(context) or
     p_audience is null or p_audience not in ('students', 'exam_staff') then
    raise exception 'Course exam editor required' using errcode = '42501';
  end if;
  if p_audience = 'exam_staff' and
     not coalesce((context->>'staff')::boolean, false) then
    raise exception 'Course exam staff required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.document_versions version
    join public.documents document on document.id = version.document_id
    where version.id = p_version_id and version.status = 'clean'
      and version.sha256 is not null and version.mime_type = 'application/pdf'
      and document.deleted_at is null and document.kind = 'material'
      and (
        (document.scope = 'personal' and document.owner_id = auth.uid()) or
        (document.scope in ('job_before', 'job_after') and exists (
          select 1 from public.jobs job where job.id = document.job_id
            and job.course_run_id = p_run_id
        ))
      )
  ) then
    raise exception 'Own clean course PDF required' using errcode = '42501';
  end if;
  select * into existing from private.course_exam_documents
  where run_id = p_run_id and version_id = p_version_id for update;
  if found then
    if existing.audience <> p_audience then
      raise exception 'Exam PDF audience cannot change' using errcode = '42501';
    end if;
    if dedicated and existing.removed_at is null then return existing.id; end if;
    update private.course_exam_documents set removed_at = null
      where id = existing.id;
    exam_id := existing.id;
  else
    insert into private.course_exam_documents(run_id, version_id, audience, created_by)
      values (p_run_id, p_version_id, p_audience, auth.uid()) returning id into exam_id;
  end if;
  insert into public.audit_events(actor_id, action, resource_id, details)
  values (auth.uid(), 'course.exam_pdf_shared', exam_id,
    jsonb_build_object('course_run_id', p_run_id, 'version_id', p_version_id,
      'audience', p_audience));
  return exam_id;
end;
$$;

create or replace function private.course_exams(p_run_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  context jsonb;
  exam_required boolean;
  setting_version integer;
  editor boolean;
  dedicated boolean := (select edition from private.installation_identity) is distinct from 'internal';
begin
  context := private.course_workspace_context(p_run_id);
  if not coalesce((context->>'lms_enabled')::boolean, false) then
    raise exception 'company_premium_lms_off' using errcode = '42501';
  end if;
  editor := private.course_exam_editor(context);
  select setting.required, setting.version into exam_required, setting_version
  from private.course_exam_settings setting where setting.run_id = p_run_id;
  exam_required := coalesce(exam_required, false);
  setting_version := coalesce(setting_version, 0);
  return jsonb_build_object(
    'required', exam_required,
    'version', case when editor then setting_version else null end,
    'can_edit', editor and (not dedicated or coalesce(private.academy_course_access_status() = 'active', false)),
    'documents', case when (dedicated and not exam_required) or (not editor and not exam_required) then '[]'::jsonb else
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', exam.id,
          'name', version.original_name,
          'version_id', version.id,
          'version', version.version,
          'audience', exam.audience
        ) order by exam.created_at, exam.id)
        from private.course_exam_documents exam
        join public.document_versions version on version.id = exam.version_id
        join public.documents document on document.id = version.document_id
        where exam.run_id = p_run_id and exam.removed_at is null
          and (exam.audience = 'students' or
            (editor and coalesce((context->>'staff')::boolean, false)))
          and version.status = 'clean' and version.sha256 is not null
          and version.mime_type = 'application/pdf' and document.deleted_at is null
          and (not dedicated or (
            exam.audience = 'students' and version.sha256 ~ '^[0-9a-f]{64}$'
            and nullif(btrim(version.scanner_version), '') is not null
            and not private.deletion_document_fenced(document.id)
            and not private.course_document_in_original_registry(document.id)
            and not exists (
              select 1 from private.course_exam_documents other
              where other.version_id = version.id and other.audience = 'exam_staff'
            )
          ))
      ), '[]'::jsonb)
    end
  );
end;
$$;

create or replace function private.course_document_access(p_kind text, p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  run_id uuid;
  context jsonb;
  resolved jsonb;
  dedicated boolean := (select edition from private.installation_identity) is distinct from 'internal';
begin
  -- Keep direct SQL invocation subject to the same edition and release policy.
  if dedicated and (p_kind is null or p_kind not in ('resource', 'exam') or not coalesce(
    private.academy_course_access_status() in ('active', 'grace'), false
  )) then
    raise exception 'Academy course file unavailable' using errcode = '42501';
  end if;
  if p_kind = 'exam' then
    if dedicated then return private.academy_student_exam_document_access(p_id); end if;
    return private.course_exam_document_access(p_id);
  end if;
  if p_kind = 'resource' then
    select resource.run_id into run_id
    from private.course_resources resource where resource.id = p_id;
  elsif p_kind = 'completion' then
    select record.run_id into run_id
    from private.course_completion_records record
    where record.id = p_id and record.revoked_at is null;
  elsif p_kind = 'attendance' then
    run_id := p_id;
  end if;
  if run_id is not null then
    context := private.course_workspace_context(run_id);
    if not coalesce((context->>'lms_enabled')::boolean, false) then
      raise exception 'Company Premium LMS is OFF' using errcode = '42501';
    end if;
  end if;
  -- The existing resolver checks the current course audience and returns
  -- the exact clean, non-deleted, non-dedicated version pinned by the share.
  resolved := private.course_document_access_before_premium(p_kind, p_id);
  if dedicated and not coalesce((resolved->>'sha256') ~ '^[0-9a-f]{64}$', false) then
    raise exception 'Academy course file unavailable' using errcode = '42501';
  end if;
  return resolved;
end;
$$;

-- Keep all existing REST cases, including draft creation, and add only these
-- active POSTs. Exam bytes use the established active-or-grace download RPC.
do $$
declare
  definition text := pg_catalog.pg_get_functiondef('private.require_academy_course_access()'::regprocedure);
  endpoint constant text := '''/rpc/set_course_exam_required''';
begin
  if cardinality(string_to_array(definition, endpoint)) <> 2 then
    raise exception 'Expected exactly one academy exam decision endpoint';
  end if;
  execute replace(definition, endpoint, endpoint || ', ''/rpc/share_course_exam_pdf'', ''/rpc/academy_student_exam_pdf_options''');
end;
$$;

notify pgrst, 'reload schema';
commit;
