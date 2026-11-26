begin;

-- Describe the exact course share, not the underlying document or any of its other uses.
create table private.course_material_metadata_revisions (
  resource_id uuid not null references private.course_resources(id) on delete cascade,
  revision integer not null check (revision > 0),
  content jsonb not null check (jsonb_typeof(content) = 'object'),
  changed_by uuid references auth.users(id) on delete set null,
  changed_at timestamptz not null default now(),
  primary key (resource_id, revision)
);
alter table private.course_material_metadata_revisions enable row level security;
revoke all on private.course_material_metadata_revisions from public, anon, authenticated, service_role;

create function private.can_edit_course_material_metadata(
  p_resource private.course_resources, p_document public.documents,
  p_version public.document_versions, p_context jsonb, p_dedicated boolean
) returns boolean language sql stable security invoker set search_path = '' as $$
  select coalesce((p_context->>'staff')::boolean and not private.deletion_document_fenced(p_document.id)
    and private.can_remove_course_resource(p_resource, p_context)
    and (not p_dedicated or (
      private.academy_course_access_status() = 'active'
      and private.academy_material_publisher(p_resource.run_id, auth.uid())
      and p_document.scope = 'personal' and p_document.kind = 'material'
      and p_document.owner_id = auth.uid() and p_document.uploaded_by = auth.uid()
      and p_version.uploaded_by = auth.uid() and nullif(btrim(p_version.scanner_version), '') is not null
    )), false);
$$;

create function private.set_course_material_metadata(
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
     (p_metadata - array['title', 'description', 'subject', 'licence', 'language', 'tags']) <> '{}'::jsonb then
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

create function public.set_course_material_metadata(
  p_resource_id uuid, p_expected_revision integer, p_metadata jsonb
) returns integer language sql security invoker set search_path = '' as $$
  select private.set_course_material_metadata(p_resource_id, p_expected_revision, p_metadata);
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
        ) as can_upload
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
          or exists (select 1 from jsonb_array_elements_text(metadata.content->'tags') as tag(value)
            where strpos(lower(tag.value), needle) > 0))
        and private.course_resource_allowed(resource.id)
      order by file_version.original_name collate "C", resource.id
      limit 25 offset p_offset
    ) page
  );
end;
$$;

revoke all on function private.can_edit_course_material_metadata(
  private.course_resources, public.documents, public.document_versions, jsonb, boolean),
  private.set_course_material_metadata(uuid, integer, jsonb),
  public.set_course_material_metadata(uuid, integer, jsonb)
from public, anon, authenticated, service_role;
grant execute on function private.set_course_material_metadata(uuid, integer, jsonb),
  public.set_course_material_metadata(uuid, integer, jsonb) to authenticated;

do $$
declare
  definition text := pg_catalog.pg_get_functiondef('private.require_academy_course_access()'::regprocedure);
  write_path constant text := '''/rpc/course_content_action''';
begin
  if cardinality(string_to_array(definition, write_path)) <> 2 then
    raise exception 'Expected one Academy course write allowlist boundary';
  end if;
  execute replace(definition, write_path, write_path || ', ''/rpc/set_course_material_metadata''');
end;
$$;

notify pgrst, 'reload schema';
commit;