-- Extend the versioned curriculum format without rewriting old drafts or publications.
begin;

-- Attachment references name a share, never the underlying document or an external URL.
create function private.course_lesson_material_ids_valid(p_ids jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
begin
  if jsonb_typeof(p_ids) is distinct from 'array' then return false; end if;
  if jsonb_array_length(p_ids) > 12 then return false; end if;
  return (
    select count(*) = count(distinct lower(value #>> '{}'))
      and coalesce(bool_and(jsonb_typeof(value) = 'string'
        and (value #>> '{}') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'), true)
    from jsonb_array_elements(p_ids)
  );
end;
$$;

-- The existing CHECK constraints retain their function identity. Legacy JSON
-- omits these optional fields and is still valid under both constraints.
create or replace function private.course_authoring_content_valid(p_content jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  id_count integer;
  unique_id_count integer;
begin
  if p_content is null or jsonb_typeof(p_content) is distinct from 'object' then
    return false;
  end if;
  if jsonb_typeof(p_content->'modules') is distinct from 'array'
     or octet_length(p_content::text) > 500000 then
    return false;
  end if;
  if jsonb_array_length(p_content->'modules') > 40 or exists (
    select 1 from jsonb_object_keys(p_content) key where key <> 'modules'
  ) then
    return false;
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_content->'modules') item(value)
    where jsonb_typeof(value) is distinct from 'object'
      or jsonb_typeof(value->'id') is distinct from 'string'
      or (value->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or jsonb_typeof(value->'title') is distinct from 'string'
      or char_length(btrim(value->>'title')) not between 1 and 150
      or jsonb_typeof(value->'description') is distinct from 'string'
      or char_length(value->>'description') > 1000
      or jsonb_typeof(value->'lessons') is distinct from 'array'
      or case when jsonb_typeof(value->'lessons') = 'array'
        then jsonb_array_length(value->'lessons') > 100 else false end
      or (value ? 'archived' and jsonb_typeof(value->'archived') <> 'boolean')
      or exists (
        select 1 from jsonb_object_keys(case when jsonb_typeof(value) = 'object' then value else '{}'::jsonb end) key
        where key not in ('id', 'title', 'description', 'lessons', 'archived')
      )
  ) then
    return false;
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_content->'modules') module(value)
    cross join lateral jsonb_array_elements(module.value->'lessons') lesson(value)
    where jsonb_typeof(lesson.value) is distinct from 'object'
      or jsonb_typeof(lesson.value->'id') is distinct from 'string'
      or (lesson.value->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or jsonb_typeof(lesson.value->'title') is distinct from 'string'
      or char_length(btrim(lesson.value->>'title')) not between 1 and 150
      or jsonb_typeof(lesson.value->'objectives') is distinct from 'string'
      or char_length(lesson.value->>'objectives') > 1000
      or jsonb_typeof(lesson.value->'duration_minutes') is distinct from 'number'
      or (lesson.value->>'duration_minutes') !~ '^(0|[1-9][0-9]{0,3})$'
      or case when (lesson.value->>'duration_minutes') ~ '^(0|[1-9][0-9]{0,3})$'
        then (lesson.value->>'duration_minutes')::integer > 1440 else false end
      or (lesson.value ? 'archived' and jsonb_typeof(lesson.value->'archived') <> 'boolean')
      or (lesson.value ? 'material_ids'
        and not private.course_lesson_material_ids_valid(lesson.value->'material_ids'))
      or not private.course_authoring_document_valid(lesson.value->'body')
      or exists (
        select 1 from jsonb_object_keys(case when jsonb_typeof(lesson.value) = 'object' then lesson.value else '{}'::jsonb end) key
        where key not in ('id', 'title', 'objectives', 'duration_minutes', 'body', 'archived', 'material_ids')
      )
  ) then
    return false;
  end if;

  select count(*), count(distinct id) into id_count, unique_id_count
  from (
    select lower(value->>'id') id from jsonb_array_elements(p_content->'modules') module(value)
    union all
    select lower(lesson.value->>'id')
    from jsonb_array_elements(p_content->'modules') module(value)
    cross join lateral jsonb_array_elements(module.value->'lessons') lesson(value)
  ) all_ids;
  if id_count <> unique_id_count then return false; end if;

  return true;
end;
$$;

-- Filter the caller's pinned revision on every read. Withdrawal, a scan
-- status change or a scope change can never be bypassed with a historical ID.
create function private.learner_curriculum(p_run_id uuid, p_content jsonb)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('modules', coalesce(jsonb_agg(
    jsonb_set(module.value - 'archived', '{lessons}', coalesce((
      select jsonb_agg(
        (lesson.value - 'archived' - 'material_ids') ||
        case when lesson.value ? 'material_ids' then jsonb_build_object('material_ids', coalesce((
          select jsonb_agg(material.id order by material.position)
          from jsonb_array_elements_text(lesson.value->'material_ids') with ordinality material(id, position)
          where private.course_welcome_attachment_eligible(p_run_id, material.id::uuid)
            and private.course_resource_allowed(material.id::uuid)
        ), '[]'::jsonb)) else '{}'::jsonb end
        order by lesson.position
      ) from jsonb_array_elements(module.value->'lessons') with ordinality lesson(value, position)
      where lesson.value->'archived' is distinct from 'true'::jsonb
    ), '[]'::jsonb)) order by module.position
  ), '[]'::jsonb))
  from jsonb_array_elements(p_content->'modules') with ordinality module(value, position)
  where module.value->'archived' is distinct from 'true'::jsonb;
$$;

create or replace function private.course_content_studio(p_run_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  context jsonb;
  latest_version integer;
  visible_version integer;
  visible_content jsonb;
  visible_at timestamptz;
  draft private.course_content_drafts%rowtype;
  enrolment public.course_enrolments%rowtype;
begin
  context := private.course_workspace_context(p_run_id);
  if (context->>'lms_enabled')::boolean is not true or
     (context->>'staff')::boolean is not true and (context->>'learner')::boolean is not true then
    raise exception 'Course curriculum unavailable' using errcode = '42501';
  end if;
  select max(version) into latest_version
  from private.course_content_revisions where course_run_id = p_run_id;

  if (context->>'staff')::boolean then
    visible_version := coalesce(latest_version, 0);
  else
    select * into enrolment from public.course_enrolments
    where course_run_id = p_run_id and user_id = auth.uid()
      and status in ('enrolled', 'completed');
    if not found then raise insufficient_privilege; end if;
    visible_version := coalesce(enrolment.course_content_version, 0);
  end if;

  select revision.content, revision.published_at
  into visible_content, visible_at
  from private.course_content_revisions revision
  where revision.course_run_id = p_run_id and revision.version = visible_version;

  if (context->>'staff')::boolean then
    select * into draft from private.course_content_drafts
    where course_run_id = p_run_id;
    return jsonb_build_object(
      'can_edit', true,
      'published_version', coalesce(latest_version, 0),
      'published_content', coalesce(visible_content, jsonb_build_object('modules', '[]'::jsonb)),
      'published_at', visible_at,
      'draft_version', coalesce(draft.version, 0),
      'draft_base_version', coalesce(draft.base_version, coalesce(latest_version, 0)),
      'draft_content', draft.content,
      'versions', coalesce((
        select jsonb_agg(jsonb_build_object(
          'version', revision.version, 'published_at', revision.published_at,
          'module_count', jsonb_array_length(revision.content->'modules')
        ) order by revision.version desc)
        from private.course_content_revisions revision
        where revision.course_run_id = p_run_id
      ), '[]'::jsonb)
    );
  end if;

  return jsonb_build_object(
    'can_edit', false,
    'published_version', visible_version,
    'published_content', private.learner_curriculum(p_run_id, visible_content),
    'published_at', visible_at,
    'draft_version', 0,
    'draft_base_version', 0,
    'draft_content', null,
    'versions', '[]'::jsonb
  );
end;
$$;

revoke all on function private.course_lesson_material_ids_valid(jsonb),
  private.learner_curriculum(uuid, jsonb) from public, anon, authenticated, service_role;
-- The existing content validator is also called through constrained test/admin writes.
grant execute on function private.course_lesson_material_ids_valid(jsonb) to authenticated;

commit;
