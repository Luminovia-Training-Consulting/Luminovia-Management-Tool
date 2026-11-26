-- Extend existing exact-share metadata and expose its immutable history only to staff.
begin;

create or replace function private.set_course_material_metadata(
  p_resource_id uuid, p_expected_revision integer, p_metadata jsonb
) returns integer language plpgsql security definer set search_path = '' as $$
declare
  course_id uuid;
  file_version_id uuid;
  resource private.course_resources;
  document_row public.documents;
  version_row public.document_versions;
  context jsonb;
  dedicated boolean := (select edition from private.installation_identity) is distinct from 'internal';
  current_revision integer;
  current_content jsonb;
  normalized jsonb := '{}'::jsonb;
  field text;
  value text;
  tag jsonb;
  tags text[] := array[]::text[];
  tag_keys text[] := array[]::text[];
begin
  select run_id, version_id into course_id, file_version_id
  from private.course_resources where id = p_resource_id and removed_at is null;
  if not found then raise insufficient_privilege; end if;
  context := private.course_workspace_context(course_id);
  if (context->>'staff')::boolean is not true then raise insufficient_privilege; end if;
  if dedicated then
    perform private.lock_academy_material_publisher(course_id, auth.uid());
  else
    perform private.lock_course_premium(course_id);
    perform 1 from public.profiles where id = auth.uid() and active for share;
    if not found then raise insufficient_privilege; end if;
  end if;

  select document.* into document_row from public.documents document
    join public.document_versions version on version.document_id = document.id
    where version.id = file_version_id and document.deleted_at is null for share of document;
  if not found then raise insufficient_privilege; end if;
  select * into version_row from public.document_versions
    where id = file_version_id and document_id = document_row.id and status = 'clean'
      and (not dedicated or sha256 ~ '^[0-9a-f]{64}$') for share;
  if not found then raise insufficient_privilege; end if;
  select * into resource from private.course_resources
    where id = p_resource_id and run_id = course_id and version_id = file_version_id
      and removed_at is null for update;
  if not found then raise insufficient_privilege; end if;
  context := private.course_workspace_context(course_id);
  if not private.course_resource_allowed(resource.id) or
     not private.can_edit_course_material_metadata(resource, document_row, version_row, context, dedicated) then
    raise insufficient_privilege;
  end if;

  if p_expected_revision is null or p_expected_revision < 0 or
     jsonb_typeof(p_metadata) is distinct from 'object' or octet_length(p_metadata::text) > 12000 or
     (p_metadata - array['title', 'description', 'subject', 'licence', 'language', 'tags', 'learning_objectives', 'review_on']) <> '{}'::jsonb then
    raise exception 'Invalid course material metadata' using errcode = '22023';
  end if;
  foreach field in array array['title', 'description', 'subject', 'licence', 'language'] loop
    value := btrim(p_metadata->>field);
    if jsonb_typeof(p_metadata->field) is distinct from 'string' or
       length(value) > (case field when 'description' then 2000 when 'title' then 160
                        when 'licence' then 160 when 'subject' then 120 else 5 end) or
       (field = 'language' and value not in ('', 'de', 'en', 'other')) then
      raise exception 'Invalid course material metadata field' using errcode = '22023';
    end if;
    normalized := normalized || jsonb_build_object(field, value);
  end loop;
  if jsonb_typeof(p_metadata->'tags') is distinct from 'array' then
    raise exception 'Invalid course material tags' using errcode = '22023';
  end if;
  if jsonb_array_length(p_metadata->'tags') > 10 then
    raise exception 'Too many course material tags' using errcode = '22023';
  end if;
  for tag in select jsonb_array_elements(p_metadata->'tags') loop
    value := btrim(tag #>> '{}');
    if jsonb_typeof(tag) is distinct from 'string' or length(value) not between 1 and 40
        or strpos(value, ',') > 0 or lower(value) = any(tag_keys) then
      raise exception 'Invalid course material tag' using errcode = '22023';
    end if;
    tags := array_append(tags, value);
    tag_keys := array_append(tag_keys, lower(value));
  end loop;
  normalized := normalized || jsonb_build_object('tags', tags);

  select revision, content into current_revision, current_content
  from private.course_material_metadata_revisions where resource_id = resource.id
  order by revision desc limit 1;
  current_revision := coalesce(current_revision, 0);
  -- Older clients omit these keys. Preserve the newer fields unless addressed
  -- explicitly; an empty string clears the optional field.
  if p_metadata ? 'learning_objectives' then
    value := btrim(p_metadata->>'learning_objectives');
    if jsonb_typeof(p_metadata->'learning_objectives') is distinct from 'string'
      or length(value) > 1000 then
      raise exception 'Invalid learning objectives' using errcode = '22023';
    end if;
    if value <> '' then normalized := normalized || jsonb_build_object('learning_objectives', value); end if;
  elsif current_content ? 'learning_objectives' then
    normalized := normalized || jsonb_build_object('learning_objectives', current_content->'learning_objectives');
  end if;
  if p_metadata ? 'review_on' then
    value := p_metadata->>'review_on';
    if jsonb_typeof(p_metadata->'review_on') is distinct from 'string' or (
      value <> '' and (value !~ '^[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}$'
        or not pg_input_is_valid(value, 'date'))
    ) then
      raise exception 'Invalid material review date' using errcode = '22023';
    end if;
    if value <> '' then normalized := normalized || jsonb_build_object('review_on', value); end if;
  elsif current_content ? 'review_on' then
    normalized := normalized || jsonb_build_object('review_on', current_content->'review_on');
  end if;

  if normalized = current_content then return current_revision; end if;
  if p_expected_revision <> current_revision then
    raise sqlstate 'PT409' using message = 'Stale course material metadata';
  end if;
  insert into private.course_material_metadata_revisions(resource_id, revision, content, changed_by)
    values (resource.id, current_revision + 1, normalized, auth.uid());
  insert into public.audit_events(actor_id, action, resource_id, details)
    values (auth.uid(), 'course.material_metadata_revised', resource.id,
      jsonb_build_object('run_id', course_id, 'version_id', file_version_id, 'revision', current_revision + 1));
  return current_revision + 1;
end;
$$;

create or replace function private.search_course_materials(p_course_id uuid, p_search text, p_category text, p_offset integer)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  dedicated boolean := (select edition from private.installation_identity) is distinct from 'internal';
  licence text;
  needle text := lower(trim(coalesce(p_search, '')));
begin
  if not (private.actor_active() or private.participant_actor()) then
    raise exception 'Active course account required' using errcode = '42501';
  end if;
  if length(needle) > 200 or p_offset is null or p_offset < 0
      or (p_category is not null and p_category not in ('material', 'report')) then
    raise exception 'Invalid material filters' using errcode = '22023';
  end if;
  if dedicated then
    licence := private.academy_course_access_status();
    if licence is null or licence not in ('active', 'grace') then return '[]'::jsonb; end if;
  end if;

  return (
    select coalesce(jsonb_agg(to_jsonb(page) order by page.name collate "C", page.id), '[]'::jsonb)
    from (
      select resource.id, run.id as course_id, template.title as course_title,
        organisation.name as organisation_name, file_version.original_name as name,
        file_version.version, resource.category, metadata.content as metadata,
        coalesce(metadata.revision, 0) as metadata_revision,
        case when metadata.revision is not null and (
          private.has_permission('courses.manage') or
          (private.lecturer_actor() and private.course_has_current_teacher(run.id))
        ) then (private.course_workspace_context(run.id)->>'staff')::boolean is true
          else false end as can_read_metadata_history,
        case when (not dedicated or licence = 'active') and (
          private.has_permission('courses.manage') or
          (private.lecturer_actor() and resource.created_by = auth.uid() and private.course_has_current_teacher(run.id))
        ) then private.can_edit_course_material_metadata(
          resource, document, file_version, private.course_workspace_context(run.id), dedicated
        ) else false end as can_edit_metadata,
        (not dedicated or licence = 'active') and (
          private.has_permission('courses.manage') or
          private.client_has_organisation(run.organisation_id) or
          (private.lecturer_actor() and private.course_has_current_teacher(run.id))
        ) as can_upload,
        (not dedicated or licence = 'active') and resource.category = 'material'
          and resource.created_by = auth.uid() and document.scope = 'personal'
          and document.owner_id = auth.uid() and document.uploaded_by = auth.uid()
          and file_version.uploaded_by = auth.uid() and document.kind = 'material'
          and coalesce(file_version.sha256 ~ '^[0-9a-f]{64}$', false)
          and (not dedicated or nullif(btrim(file_version.scanner_version), '') is not null)
          and not private.deletion_document_fenced(document.id)
          and not private.course_document_is_dedicated(document.id)
          and (private.has_permission('courses.manage') or
            (private.lecturer_actor() and private.course_has_current_teacher(run.id)))
          as can_reuse
      from private.course_resources resource
      join public.course_runs run on run.id = resource.run_id
      join public.course_templates template on template.id = run.template_id
      left join public.organisations organisation on organisation.id = run.organisation_id
      join public.document_versions file_version on file_version.id = resource.version_id
      join public.documents document on document.id = file_version.document_id
      left join lateral (
        select revision, content from private.course_material_metadata_revisions
        where resource_id = resource.id order by revision desc limit 1
      ) metadata on true
      where run.archived_at is null and resource.removed_at is null
        and document.deleted_at is null and file_version.status = 'clean'
        and (not dedicated or coalesce(file_version.sha256 ~ '^[0-9a-f]{64}$', false))
        and (p_course_id is null or run.id = p_course_id)
        and (p_category is null or resource.category = p_category)
        and (needle = '' or strpos(lower(file_version.original_name), needle) > 0
          or strpos(lower(metadata.content->>'title'), needle) > 0
          or strpos(lower(metadata.content->>'description'), needle) > 0
          or strpos(lower(metadata.content->>'subject'), needle) > 0
          or strpos(lower(metadata.content->>'learning_objectives'), needle) > 0
          or exists (select 1 from jsonb_array_elements_text(metadata.content->'tags') as tag(value)
            where strpos(lower(tag.value), needle) > 0))
        and private.course_resource_allowed(resource.id)
      order by file_version.original_name collate "C", resource.id
      limit 25 offset p_offset
    ) page
  );
end;
$$;


-- Recheck course, edition and file audience on every bounded history read.
create function private.course_material_metadata_history(p_resource_id uuid, p_before integer)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  course_id uuid;
  context jsonb;
begin
  if p_before is not null and p_before < 1 then
    raise exception 'Invalid material revision cursor' using errcode = '22023';
  end if;
  select run_id into course_id from private.course_resources
  where id = p_resource_id and removed_at is null;
  if not found then raise insufficient_privilege; end if;
  context := private.course_workspace_context(course_id);
  if (context->>'staff')::boolean is not true or (context->>'lms_enabled')::boolean is not true
    or not private.course_resource_allowed(p_resource_id) then raise insufficient_privilege; end if;
  return (
    select coalesce(jsonb_agg(to_jsonb(page) order by page.revision desc), '[]'::jsonb)
    from (
      select revision, content, changed_at
      from private.course_material_metadata_revisions
      where resource_id = p_resource_id and (p_before is null or revision < p_before)
      order by revision desc limit 21
    ) page
  );
end;
$$;

create function public.course_material_metadata_history(p_resource_id uuid, p_before integer)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.course_material_metadata_history(p_resource_id, p_before);
$$;

revoke all on function private.course_material_metadata_history(uuid, integer),
  public.course_material_metadata_history(uuid, integer) from public, anon, authenticated, service_role;
grant execute on function private.course_material_metadata_history(uuid, integer),
  public.course_material_metadata_history(uuid, integer) to authenticated;

-- Academy standard and premium use the same read allowlist, including grace.
do $$
declare
  definition text := pg_get_functiondef('private.require_academy_course_access()'::regprocedure);
  read_path constant text := '/rpc/course_content_studio';
begin
  if cardinality(string_to_array(definition, quote_literal(read_path))) <> 2 then
    raise exception 'Expected one Academy course read allowlist boundary';
  end if;
  execute replace(definition, quote_literal(read_path),
    quote_literal(read_path) || ', ''/rpc/course_material_metadata_history''');
end;
$$;

notify pgrst, 'reload schema';
commit;
