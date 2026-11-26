BEGIN;

-- Browse only current published lessons from courses this actor can teach or manage.
-- Requests for an exact lesson repeat both scope checks and reject stale publications.
create function private.course_curriculum_catalogue(
  p_run_id uuid,
  p_search text default '',
  p_offset integer default 0,
  p_source_run_id uuid default null,
  p_source_version integer default null,
  p_lesson_id uuid default null
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  destination_context jsonb := private.course_workspace_context(p_run_id);
  source_context jsonb;
  target_organisation uuid;
  source_version integer;
  selected_lesson jsonb;
  material_ids jsonb;
  result jsonb;
  search_term text := lower(btrim(coalesce(p_search, '')));
  page_size constant integer := 20;
  maximum_offset constant integer := 10000;
begin
  if (destination_context->>'staff')::boolean is not true or
     (destination_context->>'lms_enabled')::boolean is not true then
    raise insufficient_privilege;
  end if;
  select run.organisation_id into target_organisation
  from public.course_runs run
  join public.organisations organisation on organisation.id = run.organisation_id
  where run.id = p_run_id and organisation.archived_at is null;
  if not found then raise insufficient_privilege; end if;

  if char_length(search_term) > 150 or p_offset is null or p_offset not between 0 and maximum_offset
    or num_nonnulls(p_source_run_id, p_source_version, p_lesson_id) not in (0, 3)
    or (p_source_run_id is not null and (p_source_version < 1 or p_offset <> 0 or search_term <> '')) then
    raise invalid_parameter_value;
  end if;

  if p_source_run_id is null then
    -- Establish the permitted source set before unnesting any private content.
    with permitted_courses as materialized (
      select run.id, template.title
      from public.course_runs run
      join public.course_templates template on template.id = run.template_id
      where run.organisation_id = target_organisation and run.id <> p_run_id
        and run.archived_at is null and run.published
        and ((destination_context->>'manager')::boolean or
          ((destination_context->>'teacher')::boolean and private.course_has_current_teacher(run.id)))
    ), matches as (
      select course.id as source_run_id, course.title as course_title, revision.version as source_version,
        module.value->>'title' as module_title, lesson.value->>'title' as title, lesson.value->>'id' as lesson_id
      from permitted_courses course
      cross join lateral (
        select version, content from private.course_content_revisions where course_run_id = course.id
        order by version desc limit 1
      ) revision
      cross join lateral jsonb_array_elements(revision.content->'modules') module(value)
      cross join lateral jsonb_array_elements(module.value->'lessons') lesson(value)
      where module.value->'archived' is distinct from 'true'::jsonb
        and lesson.value->'archived' is distinct from 'true'::jsonb
        and (search_term = '' or strpos(lower(course.title), search_term) > 0
          or strpos(lower(module.value->>'title'), search_term) > 0
          or strpos(lower(lesson.value->>'title'), search_term) > 0)
      order by course_title, module_title, title, source_run_id, lesson_id
      limit (page_size + 1) offset p_offset
    ), ranked as (
      select matches.*, row_number() over(order by course_title, module_title, title, source_run_id, lesson_id) as position
      from matches
    )
    select jsonb_build_object('items', coalesce(jsonb_agg(to_jsonb(ranked) - 'position' order by position)
      filter(where position <= page_size), '[]'::jsonb), 'next_offset',
      case when count(*) > page_size and p_offset + page_size <= maximum_offset then p_offset + page_size end)
    into result from ranked;
    return result;
  end if;

  if p_source_run_id = p_run_id or not exists (
      select 1 from public.course_runs run where run.id = p_source_run_id and run.organisation_id = target_organisation
        and run.archived_at is null and run.published
    ) then
    raise insufficient_privilege;
  end if;
  source_context := private.course_workspace_context(p_source_run_id);
  if (source_context->>'staff')::boolean is not true or (source_context->>'lms_enabled')::boolean is not true then
    raise insufficient_privilege;
  end if;

  select max(version) into source_version from private.course_content_revisions where course_run_id = p_source_run_id;
  if source_version is distinct from p_source_version then
    raise exception 'Source curriculum publication has changed' using errcode = 'PT409';
  end if;
  select lesson.value into selected_lesson
  from private.course_content_revisions revision
  cross join lateral jsonb_array_elements(revision.content->'modules') module(value)
  cross join lateral jsonb_array_elements(module.value->'lessons') lesson(value)
  where revision.course_run_id = p_source_run_id and revision.version = p_source_version
    and module.value->'archived' is distinct from 'true'::jsonb
    and lesson.value->'archived' is distinct from 'true'::jsonb
    and (lesson.value->>'id')::uuid = p_lesson_id;
  if not found then raise insufficient_privilege; end if;

  -- A curriculum copy grants no new file access. Match the exact scanned version
  -- only when both source and destination shares remain eligible for their learners.
  select coalesce(jsonb_agg(matched.destination_id order by matched.position), '[]'::jsonb) into material_ids
  from (
    select destination.id as destination_id, min(reference.position) as position
    from jsonb_array_elements_text(coalesce(selected_lesson->'material_ids', '[]'::jsonb))
      with ordinality reference(id, position)
    join private.course_resources source on source.id = reference.id::uuid
    cross join lateral (
      select resource.id from private.course_resources resource
      where resource.run_id = p_run_id and resource.version_id = source.version_id
        and private.course_welcome_attachment_eligible(p_run_id, resource.id)
      order by resource.id limit 1
    ) destination
    where private.course_welcome_attachment_eligible(p_source_run_id, source.id)
    group by destination.id
  ) matched;
  return jsonb_build_object('lesson', (selected_lesson - 'archived' - 'material_ids') ||
    jsonb_build_object('material_ids', material_ids));
end;
$$;

create function public.course_curriculum_catalogue(
  p_run_id uuid,
  p_search text default '',
  p_offset integer default 0,
  p_source_run_id uuid default null,
  p_source_version integer default null,
  p_lesson_id uuid default null
) returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.course_curriculum_catalogue(p_run_id, p_search, p_offset, p_source_run_id, p_source_version, p_lesson_id);
$$;

revoke all on function private.course_curriculum_catalogue(uuid,text,integer,uuid,integer,uuid),
  public.course_curriculum_catalogue(uuid,text,integer,uuid,integer,uuid) from public, anon, authenticated, service_role;
grant execute on function private.course_curriculum_catalogue(uuid,text,integer,uuid,integer,uuid),
  public.course_curriculum_catalogue(uuid,text,integer,uuid,integer,uuid) to authenticated;

do $migration$
declare
  academy text := pg_get_functiondef('private.require_academy_course_access()'::regprocedure);
  portal text := pg_get_functiondef('private.require_portal_access()'::regprocedure);
  anchor constant text := '''/rpc/course_content_studio''';
begin
  if cardinality(string_to_array(academy, anchor)) <> 2 or cardinality(string_to_array(portal, anchor)) <> 2 then
    raise exception 'Expected course curriculum read allowlists';
  end if;
  execute replace(academy, anchor, anchor || ', ''/rpc/course_curriculum_catalogue''');
  execute replace(portal, anchor, anchor || ', ''/rpc/course_curriculum_catalogue''');
end;
$migration$;

notify pgrst, 'reload schema';
COMMIT;
