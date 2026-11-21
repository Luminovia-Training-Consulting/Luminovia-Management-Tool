begin;

alter table private.academy_course_material_intake
  drop constraint academy_course_material_intake_purpose_check,
  add constraint academy_course_material_intake_purpose_check
    check (purpose in ('material', 'student_exam', 'exam_staff'));

-- Workers authorize the exact uploader. Company membership applies only to
-- the student-paper branch, and all actors are rechecked under course locks.
create function private.academy_exam_actor_allowed(
  p_run_id uuid, p_actor_id uuid, p_purpose text
) returns boolean language sql stable security invoker set search_path = '' as $$
  select exists (
    select 1 from public.course_runs run
    join public.organisations organisation on organisation.id = run.organisation_id
    join public.profiles actor on actor.id = p_actor_id and actor.active
    where p_purpose in ('student_exam', 'exam_staff') and run.id = p_run_id and run.archived_at is null and organisation.archived_at is null
      and private.course_exam_editor(jsonb_build_object(
        'manager', exists (
          select 1 from public.user_roles role
          join public.role_permissions permission using (role)
          where role.user_id = actor.id and permission.permission = 'courses.manage'
            and role.role in ('owner', 'admin', 'management', 'lecturer', 'senior_lecturer', 'client')
        ),
        'teacher', private.lecturer_user(actor.id) and private.academy_course_teacher(run.id, actor.id),
        'client', p_purpose = 'student_exam' and exists (
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
revoke all on function private.academy_exam_actor_allowed(uuid, uuid, text) from public, anon, authenticated, service_role;

create function private.lock_academy_exam_editor(
  p_run_id uuid, p_actor_id uuid, p_purpose text
) returns text language plpgsql security invoker set search_path = '' as $$
declare
  company_id uuid;
begin
  if not private.academy_exam_actor_allowed(p_run_id, p_actor_id, p_purpose) then
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
  if not private.academy_exam_actor_allowed(p_run_id, p_actor_id, p_purpose) then
    raise insufficient_privilege;
  end if;
  return (select release_commit from private.academy_course_access);
end;
$$;
revoke all on function private.lock_academy_exam_editor(uuid, uuid, text) from public, anon, authenticated, service_role;

create or replace function private.lock_academy_file_intake(
  p_run_id uuid, p_actor_id uuid, p_purpose text
) returns text language plpgsql security invoker set search_path = '' as $$
declare release text;
begin
  if p_purpose = 'material' then
    return private.lock_academy_material_teacher(p_run_id, p_actor_id);
  end if;
  release := private.lock_academy_exam_editor(p_run_id, p_actor_id, p_purpose);
  if not exists (select 1 from private.course_exam_settings where run_id = p_run_id and required) then
    raise insufficient_privilege;
  end if;
  return release;
end;
$$;

create function private.reserve_academy_answer_key_pdf(
  p_run_id uuid, p_name text, p_size bigint, p_client_id uuid, p_sha256 text
) returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if p_name is null or right(lower(p_name), 4) <> '.pdf' then raise invalid_parameter_value; end if;
  return private.reserve_academy_course_file(
    p_run_id, p_name, 'application/pdf', p_size, p_client_id, p_sha256, 'exam_staff');
end;
$$;

create function public.reserve_academy_answer_key_pdf(
  p_run_id uuid, p_name text, p_size bigint, p_client_id uuid, p_sha256 text
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.reserve_academy_answer_key_pdf(p_run_id, p_name, p_size, p_client_id, p_sha256);
$$;
revoke all on function private.reserve_academy_answer_key_pdf(uuid, text, bigint, uuid, text),
  public.reserve_academy_answer_key_pdf(uuid, text, bigint, uuid, text) from public, anon, authenticated, service_role;
grant execute on function private.reserve_academy_answer_key_pdf(uuid, text, bigint, uuid, text),
  public.reserve_academy_answer_key_pdf(uuid, text, bigint, uuid, text) to authenticated;

-- Keep the existing status shape; require the current role, exam decision and
-- owner for the entire write/scan lifecycle. Staff reservations are fenced
-- before publication as well as after withdrawal.
do $$
declare
  status_definition text := pg_catalog.pg_get_functiondef('private.academy_course_material_status(uuid,uuid,uuid)'::regprocedure);
  registry_definition text := pg_catalog.pg_get_functiondef('private.course_document_is_dedicated(uuid)'::regprocedure);
  student_source_definition text := pg_catalog.pg_get_functiondef('private.academy_student_exam_source(uuid,uuid,uuid)'::regprocedure);
  status_anchor constant text := $fragment$case when intake.purpose = 'student_exam'
      then private.academy_student_exam_intake_allowed(p_run_id, auth.uid())$fragment$;
  registry_anchor constant text := 'intake.purpose = ''student_exam''';
  source_anchor constant text := 'intake.version_id = version.id and intake.run_id <> p_run_id';
begin
  if cardinality(string_to_array(status_definition, status_anchor)) <> 2
     or cardinality(string_to_array(registry_definition, registry_anchor)) <> 2
     or cardinality(string_to_array(student_source_definition, source_anchor)) <> 2 then
    raise exception 'Expected exact academy exam status, registry and source checks';
  end if;
  execute replace(status_definition, status_anchor, $fragment$case when intake.purpose in ('student_exam', 'exam_staff')
      then private.academy_exam_actor_allowed(p_run_id, auth.uid(), intake.purpose)
        and exists (select 1 from private.course_exam_settings where run_id = p_run_id and required)$fragment$);
  execute replace(registry_definition, registry_anchor, 'intake.purpose in (''student_exam'', ''exam_staff'')');
  execute replace(student_source_definition, source_anchor,
    'intake.version_id = version.id and (intake.run_id <> p_run_id or intake.purpose = ''exam_staff'')');
end;
$$;
drop function private.academy_student_exam_intake_allowed(uuid, uuid);

-- Staff PDF reads are based on the exact file, never a document's current
-- version. A historical staff share is eligible only when its file has no
-- conflicting publication. Fresh publications require a staff reservation.
create function private.academy_answer_key_version_safe(p_run_id uuid, p_version_id uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists (
    select 1 from public.document_versions version
    join public.documents document on document.id = version.document_id
    where version.id = p_version_id and version.status = 'clean'
      and version.sha256 ~ '^[0-9a-f]{64}$' and nullif(btrim(version.scanner_version), '') is not null
      and version.mime_type = 'application/pdf' and document.kind = 'material'
      and document.deleted_at is null and not private.deletion_document_fenced(document.id)
      and not private.course_document_in_original_registry(document.id)
      and not exists (
        select 1 from private.academy_course_material_intake intake
        join public.document_versions staged on staged.id = intake.version_id
        where staged.document_id = document.id and (intake.purpose <> 'exam_staff' or intake.run_id <> p_run_id)
      )
      and not exists (
        select 1 from private.course_resources resource
        join public.document_versions shared on shared.id = resource.version_id
        where shared.document_id = document.id and resource.removed_at is null
      )
      and not exists (
        select 1 from private.course_exam_documents exam
        join public.document_versions shared on shared.id = exam.version_id
        where shared.document_id = document.id and (exam.audience <> 'exam_staff' or exam.run_id <> p_run_id)
      )
  );
$$;
revoke all on function private.academy_answer_key_version_safe(uuid, uuid) from public, anon, authenticated, service_role;

create function private.academy_answer_key_source(p_run_id uuid, p_version_id uuid, p_document_id uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists (
    select 1 from private.academy_course_material_intake intake
    join public.document_versions version on version.id = intake.version_id
    join public.documents document on document.id = version.document_id
    where version.id = p_version_id and document.id = p_document_id
      and intake.run_id = p_run_id and intake.purpose = 'exam_staff'
      and document.scope = 'personal'
      and document.owner_id = auth.uid() and document.uploaded_by = auth.uid() and version.uploaded_by = auth.uid()
      and private.academy_answer_key_version_safe(p_run_id, p_version_id)
  );
$$;
revoke all on function private.academy_answer_key_source(uuid, uuid, uuid) from public, anon, authenticated, service_role;

create function private.academy_exam_document_access(p_exam_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  selected private.course_exam_documents%rowtype;
  context jsonb;
  result jsonb;
begin
  if not coalesce(private.academy_course_access_status() in ('active', 'grace'), false) then
    raise insufficient_privilege;
  end if;
  select * into selected from private.course_exam_documents exam
  where exam.id = p_exam_id and exam.removed_at is null;
  if not found then raise insufficient_privilege; end if;
  if selected.audience = 'students' then
    return private.academy_student_exam_document_access(p_exam_id);
  end if;
  context := private.course_workspace_context(selected.run_id);
  if not coalesce((context->>'staff')::boolean and (context->>'lms_enabled')::boolean, false)
     or not private.academy_answer_key_version_safe(selected.run_id, selected.version_id) then
    raise insufficient_privilege;
  end if;
  select jsonb_build_object(
    'id', version.id, 'document_id', version.document_id, 'object_path', version.object_path,
    'name', version.original_name, 'mime_type', version.mime_type, 'sha256', version.sha256
  ) into result from public.document_versions version where version.id = selected.version_id;
  if not found then raise insufficient_privilege; end if;
  return result;
end;
$$;
revoke all on function private.academy_exam_document_access(uuid) from public, anon, authenticated, service_role;

-- Add the staff-specific publication proof inside the existing locked write.
-- The canonical post-lock course authorization, exact version and audit paths
-- continue to enforce both audiences.
do $$
declare
  definition text := pg_catalog.pg_get_functiondef('private.share_course_exam_pdf(uuid,uuid,text)'::regprocedure);
  audience_anchor constant text := 'p_audience is distinct from ''students''';
  source_anchor constant text := 'not private.academy_student_exam_source(p_run_id, p_version_id, document_id)';
begin
  if cardinality(string_to_array(definition, audience_anchor)) <> 2
     or cardinality(string_to_array(definition, source_anchor)) <> 2 then
    raise exception 'Expected the exact academy exam publication guards';
  end if;
  execute replace(replace(definition, audience_anchor, '(p_audience is null or p_audience not in (''students'', ''exam_staff''))'),
    source_anchor, $fragment$not (case p_audience when 'exam_staff' then
        private.academy_answer_key_source(p_run_id, p_version_id, document_id)
      else private.academy_student_exam_source(p_run_id, p_version_id, document_id) end)$fragment$);
end;
$$;

-- The owner may withdraw either audience even if the exam has been switched
-- off. This changes publication only and never deletes the retained version.
do $$
declare
  definition text := pg_catalog.pg_get_functiondef('private.remove_course_exam_pdf(uuid,uuid)'::regprocedure);
  anchor constant text := '  perform private.lock_course_premium(p_run_id);';
begin
  if cardinality(string_to_array(definition, anchor)) <> 2 then
    raise exception 'Expected the exact exam withdrawal authority';
  end if;
  execute replace(definition, anchor, $fragment$  if (select edition from private.installation_identity) is distinct from 'internal' then
    select exam.audience into exam_audience from private.course_exam_documents exam
    join public.document_versions version on version.id = exam.version_id
    join public.documents document on document.id = version.document_id
    where exam.id = p_exam_id and exam.run_id = p_run_id and exam.removed_at is null
      and exam.created_by = auth.uid() and document.owner_id = auth.uid();
    if not found then raise insufficient_privilege; end if;
    perform private.lock_academy_exam_editor(p_run_id, auth.uid(),
      case exam_audience when 'exam_staff' then 'exam_staff' else 'student_exam' end);
    perform 1 from private.course_exam_documents exam
    join public.document_versions version on version.id = exam.version_id
    join public.documents document on document.id = version.document_id
    where exam.id = p_exam_id and exam.run_id = p_run_id and exam.removed_at is null
      and exam.created_by = auth.uid() and document.owner_id = auth.uid()
    for share of version, document;
    if not found then raise insufficient_privilege; end if;
  else
    perform private.lock_course_premium(p_run_id);
  end if;$fragment$);
end;
$$;

-- Keep the course resolver's other kinds (including generated completion
-- PDFs) and all other REST paths exactly as installed by earlier migrations.
do $$
declare
  resolver text := pg_catalog.pg_get_functiondef('private.course_document_access(text,uuid)'::regprocedure);
  resolver_anchor constant text := 'return private.academy_student_exam_document_access(p_id)';
  gate text := pg_catalog.pg_get_functiondef('private.require_academy_course_access()'::regprocedure);
  gate_anchor constant text := '''/rpc/share_course_exam_pdf''';
begin
  if cardinality(string_to_array(resolver, resolver_anchor)) <> 2
     or cardinality(string_to_array(gate, gate_anchor)) <> 2 then
    raise exception 'Expected exact academy exam document and REST dispatch';
  end if;
  execute replace(resolver, resolver_anchor, 'return private.academy_exam_document_access(p_id)');
  execute replace(gate, gate_anchor, gate_anchor || ', ''/rpc/reserve_academy_answer_key_pdf'', ''/rpc/remove_course_exam_pdf''');
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
    'documents', case when not editor and not exam_required then '[]'::jsonb else
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', exam.id,
          'name', version.original_name,
          'version_id', version.id,
          'version', version.version,
          'audience', exam.audience
        ) || case when dedicated then jsonb_build_object('can_remove',
          editor and private.academy_course_access_status() = 'active'
          and exam.created_by = auth.uid() and document.owner_id = auth.uid()
        ) else '{}'::jsonb end order by exam.created_at, exam.id)
        from private.course_exam_documents exam
        join public.document_versions version on version.id = exam.version_id
        join public.documents document on document.id = version.document_id
        where exam.run_id = p_run_id and exam.removed_at is null
          and (exam.audience = 'students' or
            (editor and coalesce((context->>'staff')::boolean, false)))
          and version.status = 'clean' and version.sha256 is not null
          and version.mime_type = 'application/pdf' and document.deleted_at is null
          and (not dedicated or case when exam.audience = 'exam_staff' then
            private.academy_answer_key_version_safe(p_run_id, version.id)
          else exam_required and version.sha256 ~ '^[0-9a-f]{64}$'
            and nullif(btrim(version.scanner_version), '') is not null
            and not private.deletion_document_fenced(document.id)
            and not private.course_document_in_original_registry(document.id)
            and not exists (
              select 1 from private.course_exam_documents other
              where other.version_id = version.id and other.audience = 'exam_staff'
            )
          end)
      ), '[]'::jsonb)
    end
  );
end;
$$;

notify pgrst, 'reload schema';
commit;
