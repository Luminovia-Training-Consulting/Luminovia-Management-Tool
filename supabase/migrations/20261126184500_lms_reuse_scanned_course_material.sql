-- Reuse a previously scanned exact version inside its owning organisation.
-- Each destination has its own share and may start with an independent copy
-- of the source metadata. Neither path copies bytes or creates a new upload.
begin;

-- The caller already has the active licence/read gate appropriate to the RPC.
-- Ownership checks keep another staff member's private file out of reuse.
create function private.course_material_reuse_source(p_resource_id uuid)
returns private.course_resources language plpgsql stable set search_path = '' as $$
declare
  source private.course_resources;
  context jsonb;
begin
  select resource.* into source
  from private.course_resources resource
  join public.document_versions version on version.id = resource.version_id
  join public.documents document on document.id = version.document_id
  where resource.id = p_resource_id and resource.removed_at is null
    and resource.category = 'material'
    and resource.created_by = auth.uid() and document.owner_id = auth.uid()
    and document.uploaded_by = auth.uid() and version.uploaded_by = auth.uid()
    and document.scope = 'personal' and document.kind = 'material'
    and document.deleted_at is null and not private.deletion_document_fenced(document.id)
    and not private.course_document_is_dedicated(document.id)
    and version.status = 'clean' and version.sha256 ~ '^[0-9a-f]{64}$'
    and ((select edition from private.installation_identity) = 'internal'
      or nullif(btrim(version.scanner_version), '') is not null);
  if not found then return null; end if;
  context := private.course_workspace_context(source.run_id);
  if (context->>'staff')::boolean is not true or (context->>'lms_enabled')::boolean is not true then
    return null;
  end if;
  return source;
end;
$$;

-- Offer only courses for which today's role would permit teaching-material publication.
-- Usage for the source's exact version remains bounded and staff-scoped.
create function private.course_material_reuse_targets(p_resource_id uuid, p_search text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  source private.course_resources;
  source_company uuid;
  needle text := lower(btrim(coalesce(p_search, '')));
begin
  if length(needle) > 150 then
    raise exception 'Invalid target course search' using errcode = '22023';
  end if;
  source := private.course_material_reuse_source(p_resource_id);
  if source.id is null then raise insufficient_privilege; end if;
  select organisation_id into source_company from public.course_runs where id = source.run_id;
  return (
    select coalesce(jsonb_agg(to_jsonb(page) order by page.title collate "C", page.id), '[]'::jsonb)
    from (
      select run.id, template.title, exists (
        select 1 from private.course_resources existing
        where existing.run_id = run.id and existing.version_id = source.version_id
          and existing.audience = source.audience and existing.category = 'material' and existing.removed_at is null
      ) as shared
      from public.course_runs run
      join public.course_templates template on template.id = run.template_id
      join public.organisations company on company.id = run.organisation_id and company.archived_at is null
      where run.organisation_id = source_company and run.id <> source.run_id and run.archived_at is null
        and private.course_lms_read_enabled(run.organisation_id)
        and (private.has_permission('courses.manage') or
          (private.lecturer_actor() and private.course_has_current_teacher(run.id)))
        and (needle = '' or strpos(lower(template.title), needle) > 0)
      order by template.title collate "C", run.id limit 51
    ) page
  );
end;
$$;

create function private.reuse_course_material(p_resource_id uuid, p_target_run_id uuid, p_copy_metadata boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  source private.course_resources;
  source_company uuid;
  target_company uuid;
  target_context jsonb;
  target_share private.course_resources;
  source_revision jsonb;
  target_id uuid;
  locked_run_id uuid;
  document_id uuid;
  dedicated boolean := (select edition from private.installation_identity) <> 'internal';
begin
  if p_target_run_id is null or p_copy_metadata is null then
    raise exception 'Choose a target course and metadata option' using errcode = '22023';
  end if;
  source := private.course_material_reuse_source(p_resource_id);
  if source.id is null then raise insufficient_privilege; end if;
  if source.run_id = p_target_run_id then
    raise exception 'Choose another course' using errcode = '22023';
  end if;

  -- Both directions lock courses in the same order before the shared document.
  -- The existing workspace command takes the document before the target share.
  for locked_run_id in select id from unnest(array[source.run_id, p_target_run_id]) selected(id) order by id loop
    if dedicated then perform private.lock_academy_material_publisher(locked_run_id, auth.uid());
    else perform private.lock_course_premium(locked_run_id);
    end if;
  end loop;
  perform 1 from public.profiles where id = auth.uid() and active for share;
  if not found then raise insufficient_privilege; end if;
  perform 1 from public.user_roles where user_id = auth.uid() order by role for share;
  perform 1 from public.job_claims claim join public.jobs job on job.id = claim.job_id
  where job.course_run_id in (source.run_id, p_target_run_id)
    and claim.lecturer_id = auth.uid() and claim.status = 'confirmed'
  order by claim.id for share of claim;

  select organisation_id into source_company from public.course_runs
  where id = source.run_id and archived_at is null;
  select organisation_id into target_company from public.course_runs
  where id = p_target_run_id and archived_at is null;
  if source_company is null or source_company is distinct from target_company then
    raise insufficient_privilege;
  end if;
  target_context := private.course_workspace_context(p_target_run_id);
  if (target_context->>'staff')::boolean is not true or
    (target_context->>'lms_enabled')::boolean is not true then raise insufficient_privilege; end if;

  select document.id into document_id from public.documents document
  join public.document_versions version on version.document_id = document.id
  where version.id = source.version_id for update of document for share of version;
  if not found then raise insufficient_privilege; end if;
  perform 1 from private.course_resources resource where resource.id = p_resource_id for share;
  source := private.course_material_reuse_source(p_resource_id);
  if source.id is null then raise insufficient_privilege; end if;

  select * into target_share from private.course_resources resource
  where resource.run_id = p_target_run_id and resource.version_id = source.version_id
    and resource.audience = source.audience for update;
  if found and target_share.category <> 'material' then
    raise sqlstate 'PT409' using message = 'This version is already shared as a course report';
  end if;
  if target_share.id is not null and target_share.removed_at is null then
    return target_share.id;
  end if;

  target_id := (private.course_resource_command(p_target_run_id, 'resource_share',
    jsonb_build_object('version_id', source.version_id, 'audience', source.audience,
      'category', 'material'))->>'id')::uuid;
  if p_copy_metadata then
    select content into source_revision from private.course_material_metadata_revisions
    where resource_id = source.id order by revision desc limit 1;
    if found and not exists (select 1 from private.course_material_metadata_revisions where resource_id = target_id) then
      perform private.set_course_material_metadata(target_id, 0, source_revision);
    end if;
  end if;
  return target_id;
end;
$$;

create function public.course_material_reuse_targets(p_resource_id uuid, p_search text)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.course_material_reuse_targets(p_resource_id, p_search);
$$;

create function public.reuse_course_material(p_resource_id uuid, p_target_run_id uuid, p_copy_metadata boolean)
returns uuid language sql security invoker set search_path = '' as $$
  select private.reuse_course_material(p_resource_id, p_target_run_id, p_copy_metadata);
$$;

revoke all on function private.course_material_reuse_source(uuid),
  private.course_material_reuse_targets(uuid, text), public.course_material_reuse_targets(uuid, text),
  private.reuse_course_material(uuid, uuid, boolean), public.reuse_course_material(uuid, uuid, boolean)
from public, anon, authenticated, service_role;
grant execute on function private.course_material_reuse_targets(uuid, text), public.course_material_reuse_targets(uuid, text),
  private.reuse_course_material(uuid, uuid, boolean), public.reuse_course_material(uuid, uuid, boolean) to authenticated;

do $$
declare
  definition text := pg_get_functiondef('private.require_academy_course_access()'::regprocedure);
  read_path constant text := '/rpc/course_material_metadata_history';
  write_path constant text := '/rpc/set_course_material_metadata';
begin
  if cardinality(string_to_array(definition, quote_literal(read_path))) <> 2
    or cardinality(string_to_array(definition, quote_literal(write_path))) <> 2 then
    raise exception 'Expected one Academy material read/write boundary';
  end if;
  execute replace(replace(definition, quote_literal(read_path),
    quote_literal(read_path) || ', ''/rpc/course_material_reuse_targets'''),
    quote_literal(write_path), quote_literal(write_path) || ', ''/rpc/reuse_course_material''');
end;
$$;

notify pgrst, 'reload schema';
commit;
