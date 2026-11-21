begin;

-- Dedicated workspaces carry the exam decision without any PDF metadata.
-- Learners never get the setting revision. Grace stops editing in the projection.
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
    'documents', case when dedicated or (not editor and not exam_required) then '[]'::jsonb else
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

-- The canonical setting and audit transaction is shared by all editions.
-- Dedicated writes serialize with operator licence, course and actor changes.
create or replace function private.set_course_exam_required(
  p_run_id uuid, p_required boolean, p_expected_version integer
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  setting private.course_exam_settings%rowtype;
  context jsonb;
  acting_user uuid := auth.uid();
  course_org_id uuid;
begin
  if (select edition from private.installation_identity) = 'internal' then
    perform private.lock_course_premium(p_run_id);
  else
    if not private.course_exam_editor(private.course_workspace_context(p_run_id)) then
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
  end if;
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
    raise exception 'Course exam settings changed' using errcode = 'PT409';
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

-- Add only this new POST operation to the installed academy write branch.
do $$
declare
  definition text := pg_catalog.pg_get_functiondef('private.require_academy_course_access()'::regprocedure);
  endpoint constant text := '''/rpc/save_course_session_attendance''';
begin
  if cardinality(string_to_array(definition, endpoint)) <> 2 then
    raise exception 'Expected exactly one academy attendance write endpoint';
  end if;
  execute replace(definition, endpoint, endpoint || ', ''/rpc/set_course_exam_required''');
end;
$$;

notify pgrst, 'reload schema';
commit;
