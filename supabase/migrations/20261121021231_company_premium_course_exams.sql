begin;

-- Exams are PDF documents, separate from the online quiz and from general
-- shared course resources. Retain exact scanned versions and every prior
-- setting/version when the course or company switch is turned off.
create table private.course_exam_settings (
  run_id uuid primary key references public.course_runs(id) on delete cascade,
  required boolean not null default false,
  version integer not null default 0 check (version >= 0),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);
create table private.course_exam_documents (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.course_runs(id) on delete cascade,
  version_id uuid not null references public.document_versions(id),
  audience text not null check (audience in ('students', 'exam_staff')),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  unique (run_id, version_id)
);
create index course_exam_documents_run on private.course_exam_documents(run_id, audience, created_at);
revoke all on private.course_exam_settings, private.course_exam_documents
  from public, anon, authenticated, service_role;

create function private.course_exam_editor(p_context jsonb)
returns boolean language sql immutable set search_path = ''
as $$
  select coalesce((p_context->>'manager')::boolean, false) or
    coalesce((p_context->>'teacher')::boolean, false) or
    coalesce((p_context->>'client')::boolean, false);
$$;
revoke all on function private.course_exam_editor(jsonb)
  from public, anon, authenticated, service_role;

create function private.course_exams(p_run_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  context jsonb;
  exam_required boolean;
  setting_version integer;
  editor boolean;
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
    'can_edit', editor,
    'documents', case when not editor and not exam_required then '[]'::jsonb else
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
      ), '[]'::jsonb)
    end
  );
end;
$$;

create function private.set_course_exam_required(
  p_run_id uuid, p_required boolean, p_expected_version integer
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare setting private.course_exam_settings%rowtype; context jsonb;
begin
  perform private.lock_course_premium(p_run_id);
  context := private.course_workspace_context(p_run_id);
  if not private.course_exam_editor(context) or p_required is null or
     p_expected_version is null or p_expected_version < 0 then
    raise exception 'Course exam editor required' using errcode = '42501';
  end if;
  insert into private.course_exam_settings(run_id) values (p_run_id)
    on conflict (run_id) do nothing;
  select * into setting from private.course_exam_settings
  where run_id = p_run_id for update;
  if setting.version <> p_expected_version then
    raise exception 'Course exam settings changed' using errcode = '40001';
  end if;
  update private.course_exam_settings
    set required = p_required, version = version + 1,
        updated_by = auth.uid(), updated_at = now()
  where run_id = p_run_id;
  insert into public.audit_events(actor_id, action, resource_id, details)
  values (auth.uid(), 'course.exam_requirement_changed', p_run_id,
    jsonb_build_object('required', p_required, 'version', p_expected_version + 1));
  return jsonb_build_object('required', p_required, 'version', p_expected_version + 1);
end;
$$;

create function private.share_course_exam_pdf(
  p_run_id uuid, p_version_id uuid, p_audience text
) returns uuid language plpgsql security definer set search_path = ''
as $$
declare context jsonb; existing private.course_exam_documents%rowtype; exam_id uuid;
begin
  perform private.lock_course_premium(p_run_id);
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

create function private.remove_course_exam_pdf(p_run_id uuid, p_exam_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare context jsonb; exam_audience text;
begin
  perform private.lock_course_premium(p_run_id);
  context := private.course_workspace_context(p_run_id);
  if not private.course_exam_editor(context) then
    raise exception 'Course exam editor required' using errcode = '42501';
  end if;
  select audience into exam_audience from private.course_exam_documents
  where id = p_exam_id and run_id = p_run_id and removed_at is null for update;
  if exam_audience = 'exam_staff' and
     not coalesce((context->>'staff')::boolean, false) then
    raise exception 'Course exam staff required' using errcode = '42501';
  end if;
  update private.course_exam_documents set removed_at = now()
  where id = p_exam_id and run_id = p_run_id and removed_at is null;
  if not found then raise exception 'Exam PDF unavailable' using errcode = '42501'; end if;
  insert into public.audit_events(actor_id, action, resource_id, details)
  values (auth.uid(), 'course.exam_pdf_removed', p_exam_id,
    jsonb_build_object('course_run_id', p_run_id));
end;
$$;

-- This projection is the only way to obtain exact private Storage metadata.
-- A learner needs both a current company enrolment and the live course exam
-- switch; editors may inspect retained keys while the exam switch is off.
create function private.course_exam_document_access(p_exam_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare exam private.course_exam_documents%rowtype; context jsonb;
begin
  select * into exam from private.course_exam_documents
  where id = p_exam_id and removed_at is null;
  if not found then raise exception 'Exam PDF unavailable' using errcode = '42501'; end if;
  context := private.course_workspace_context(exam.run_id);
  if not coalesce((context->>'lms_enabled')::boolean, false) or not (
    (exam.audience = 'exam_staff' and
      coalesce((context->>'staff')::boolean, false)) or
    (exam.audience = 'students' and (
      private.course_exam_editor(context) or
      (coalesce((context->>'learner')::boolean, false) and
        exists (select 1 from private.course_exam_settings setting
          where setting.run_id = exam.run_id and setting.required))))
  ) then
    raise exception 'Exam PDF unavailable' using errcode = '42501';
  end if;
  return (
    select jsonb_build_object(
      'id', version.id, 'document_id', document.id,
      'object_path', version.object_path, 'name', version.original_name,
      'mime_type', version.mime_type, 'sha256', version.sha256
    )
    from public.document_versions version
    join public.documents document on document.id = version.document_id
    where version.id = exam.version_id and version.status = 'clean'
      and version.sha256 is not null and version.mime_type = 'application/pdf'
      and document.deleted_at is null
  );
end;
$$;

-- The existing course-documents Edge gateway calls this same RPC twice around
-- the private byte fetch, so an OFF, removal or version change rejects bytes.
create or replace function private.course_document_access(p_kind text, p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare run_id uuid; context jsonb;
begin
  if p_kind = 'exam' then
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
  return private.course_document_access_before_premium(p_kind, p_id);
end;
$$;

-- Include only the caller's allowed exam projection in the existing workspace.
create or replace function private.course_workspace(p_run_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare context jsonb; result jsonb;
begin
  context := private.course_workspace_context(p_run_id);
  if not coalesce((context->>'lms_enabled')::boolean, false) then
    raise exception 'company_premium_lms_off' using errcode = '42501';
  end if;
  result := private.course_workspace_before_premium(p_run_id);
  return result || jsonb_build_object(
    'lms_enabled', true, 'exams', private.course_exams(p_run_id)
  );
end;
$$;

create function public.set_course_exam_required(
  p_run_id uuid, p_required boolean, p_expected_version integer
) returns jsonb language sql security invoker set search_path = ''
as $$ select private.set_course_exam_required(p_run_id, p_required, p_expected_version); $$;
create function public.share_course_exam_pdf(
  p_run_id uuid, p_version_id uuid, p_audience text
) returns uuid language sql security invoker set search_path = ''
as $$ select private.share_course_exam_pdf(p_run_id, p_version_id, p_audience); $$;
create function public.remove_course_exam_pdf(p_run_id uuid, p_exam_id uuid)
returns void language sql security invoker set search_path = ''
as $$ select private.remove_course_exam_pdf(p_run_id, p_exam_id); $$;

revoke all on function private.course_exams(uuid),
  private.set_course_exam_required(uuid, boolean, integer),
  private.share_course_exam_pdf(uuid, uuid, text),
  private.remove_course_exam_pdf(uuid, uuid),
  private.course_exam_document_access(uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.course_exams(uuid),
  private.set_course_exam_required(uuid, boolean, integer),
  private.share_course_exam_pdf(uuid, uuid, text),
  private.remove_course_exam_pdf(uuid, uuid)
  to authenticated;
-- Only the private course-document dispatcher calls the exact access helper.
revoke all on function public.set_course_exam_required(uuid, boolean, integer),
  public.share_course_exam_pdf(uuid, uuid, text),
  public.remove_course_exam_pdf(uuid, uuid)
  from public, anon, service_role;
grant execute on function public.set_course_exam_required(uuid, boolean, integer),
  public.share_course_exam_pdf(uuid, uuid, text),
  public.remove_course_exam_pdf(uuid, uuid)
  to authenticated;

notify pgrst, 'reload schema';
commit;
