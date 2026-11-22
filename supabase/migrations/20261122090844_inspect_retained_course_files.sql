begin;

-- The operational workspace and downloads still require Premium. The
-- separate archive authority uses the same actual-admin boundary as retained
-- attendance and serializes with the organisation's Premium toggle.
create function private.require_retained_course_file_authority(
  p_organisation_id uuid, p_run_id uuid, p_reason text
) returns void language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid();
begin
  if not exists (select 1 from private.installation_identity where edition = 'internal')
    or not private.is_company_premium_admin() then
    raise insufficient_privilege;
  end if;
  perform 1 from public.profiles where id = actor_id and active for share;
  if not found then raise insufficient_privilege; end if;
  perform 1 from public.user_roles where user_id = actor_id and role = 'admin' for share;
  if not found then raise insufficient_privilege; end if;
  perform 1 from public.organisations where id = p_organisation_id for share;
  if not found or private.company_premium_enabled(p_organisation_id) then
    raise insufficient_privilege;
  end if;
  perform 1 from public.course_runs
    where id = p_run_id and organisation_id = p_organisation_id for share;
  if not found then raise insufficient_privilege; end if;
  if p_reason is null or char_length(btrim(p_reason)) not between 8 and 300 then
    raise exception 'Invalid retained file inspection purpose' using errcode = '22023';
  end if;
end;
$$;
revoke all on function private.require_retained_course_file_authority(uuid, uuid, text)
  from public, anon, authenticated, service_role;

-- The private projection exposes only course-linked retained scanner
-- results. A soft-removed course link can still be inspected; a deleted
-- underlying document or one with an active deletion fence cannot. Object
-- paths remain on the Edge server. Historical clean versions are accepted
-- independently of the optional scanner label and still need an exact hash.
create function private.retained_course_file_rows(p_run_id uuid)
returns table(
  file_kind text, id uuid, version_id uuid, version integer, name text,
  audience text, withdrawn boolean, mime_type text, size_bytes bigint, sha256 text
) language sql stable set search_path = '' as $$
  select link.file_kind, link.id, version.id, version.version, version.original_name,
    link.audience, link.withdrawn, version.mime_type, version.size_bytes, version.sha256
  from (
    select 'material'::text as file_kind, resource.id, resource.version_id,
      resource.audience, resource.removed_at is not null as withdrawn
    from private.course_resources resource
    where resource.run_id = p_run_id and resource.category = 'material'
    union all
    select 'exam'::text, exam.id, exam.version_id, exam.audience, exam.removed_at is not null
    from private.course_exam_documents exam where exam.run_id = p_run_id
  ) link
  join public.document_versions version on version.id = link.version_id
  join public.documents document on document.id = version.document_id
  where document.deleted_at is null and not private.deletion_document_fenced(document.id)
    and version.status = 'clean'
    and version.sha256 ~ '^[0-9a-f]{64}$' and version.size_bytes between 1 and 104857600
    and (link.file_kind <> 'exam' or version.mime_type = 'application/pdf');
$$;
revoke all on function private.retained_course_file_rows(uuid)
  from public, anon, authenticated, service_role;

create function private.inspect_retained_course_files(
  p_organisation_id uuid, p_run_id uuid, p_reason text,
  p_after_kind text, p_after_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare items jsonb;
begin
  perform private.require_retained_course_file_authority(p_organisation_id, p_run_id, p_reason);
  if num_nonnulls(p_after_kind, p_after_id) not in (0, 2)
    or (p_after_kind is not null and p_after_kind not in ('exam', 'material')) then
    raise exception 'Invalid retained file cursor' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(to_jsonb(page) order by page.file_kind, page.id), '[]'::jsonb)
    into items
    from (
      select file_kind, id, version_id, version, name, audience, withdrawn
      from private.retained_course_file_rows(p_run_id)
      where p_after_id is null or (file_kind, id) > (p_after_kind, p_after_id)
      order by file_kind, id limit 51
    ) page;

  insert into public.audit_events(actor_id, action, resource_id, details)
    values (auth.uid(), 'course.retained_files_inspected', p_run_id,
      jsonb_build_object('organisation_id', p_organisation_id, 'purpose', btrim(p_reason),
        'returned_count', least(jsonb_array_length(items), 50)));

  return jsonb_build_object(
    'items', case when jsonb_array_length(items) > 50 then items - 50 else items end,
    'next_cursor', case when jsonb_array_length(items) > 50 then jsonb_build_object(
      'file_kind', items->49->>'file_kind', 'id', items->49->>'id'
    ) end
  );
end;
$$;

create function public.inspect_retained_course_files(
  p_organisation_id uuid, p_run_id uuid, p_reason text,
  p_after_kind text default null, p_after_id uuid default null
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.inspect_retained_course_files(p_organisation_id, p_run_id, p_reason, p_after_kind, p_after_id);
$$;

create function private.retained_course_file_access(
  p_organisation_id uuid, p_run_id uuid, p_file_kind text, p_file_id uuid,
  p_version_id uuid, p_reason text, p_record_access boolean
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare facts jsonb;
begin
  perform private.require_retained_course_file_authority(p_organisation_id, p_run_id, p_reason);
  if p_record_access is null then
    raise exception 'Invalid retained file inspection phase' using errcode = '22023';
  end if;

  select jsonb_build_object('version_id', file.version_id, 'name', file.name,
    'mime_type', file.mime_type, 'size_bytes', file.size_bytes, 'sha256', file.sha256)
  into facts
  from private.retained_course_file_rows(p_run_id) file
  where file.file_kind = p_file_kind and file.id = p_file_id and file.version_id = p_version_id;
  if not found then raise insufficient_privilege; end if;

  -- The Edge gateway records authorization only after hashing the retained
  -- bytes and repeating all current authority checks.
  if p_record_access then
    insert into public.audit_events(actor_id, action, resource_id, details)
      values (auth.uid(), 'course.retained_file_download_authorized', p_run_id,
        jsonb_build_object('organisation_id', p_organisation_id, 'purpose', btrim(p_reason),
          'file_kind', p_file_kind, 'file_id', p_file_id, 'version_id', p_version_id));
  end if;
  return facts;
end;
$$;

create function public.retained_course_file_access(
  p_organisation_id uuid, p_run_id uuid, p_file_kind text, p_file_id uuid,
  p_version_id uuid, p_reason text, p_record_access boolean
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.retained_course_file_access(
    p_organisation_id, p_run_id, p_file_kind, p_file_id, p_version_id, p_reason, p_record_access
  );
$$;

revoke all on function private.inspect_retained_course_files(uuid, uuid, text, text, uuid),
  public.inspect_retained_course_files(uuid, uuid, text, text, uuid),
  private.retained_course_file_access(uuid, uuid, text, uuid, uuid, text, boolean),
  public.retained_course_file_access(uuid, uuid, text, uuid, uuid, text, boolean)
  from public, anon, authenticated, service_role;
grant execute on function private.inspect_retained_course_files(uuid, uuid, text, text, uuid),
  public.inspect_retained_course_files(uuid, uuid, text, text, uuid),
  private.retained_course_file_access(uuid, uuid, text, uuid, uuid, text, boolean),
  public.retained_course_file_access(uuid, uuid, text, uuid, uuid, text, boolean) to authenticated;

alter function private.admin_audit_actions() rename to admin_audit_actions_before_retained_course_files;
create function private.admin_audit_actions() returns text[]
language sql immutable set search_path = '' as $$
  select private.admin_audit_actions_before_retained_course_files() || array[
    'course.retained_files_inspected', 'course.retained_file_download_authorized'
  ];
$$;
revoke all on function private.admin_audit_actions() from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';
commit;
