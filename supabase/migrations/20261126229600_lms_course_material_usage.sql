-- Show current uses of one clean version across courses the caller can teach or manage.
begin;

create function private.course_material_usage(p_resource_id uuid, p_after uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  source private.course_resources;
  source_company uuid;
  context jsonb;
  report jsonb;
begin
  select * into source from private.course_resources where id = p_resource_id and removed_at is null;
  if not found then raise insufficient_privilege; end if;
  context := private.course_workspace_context(source.run_id);
  if (context->>'staff')::boolean is not true or (context->>'lms_enabled')::boolean is not true
    or not coalesce(private.course_resource_allowed(p_resource_id), false) then raise insufficient_privilege; end if;
  select organisation_id into source_company from public.course_runs where id = source.run_id;

  with matches as materialized (
    select run.id, template.title, array_agg(distinct item.audience order by item.audience) as audiences
    from private.course_resources item
    join public.course_runs run on run.id = item.run_id and run.organisation_id = source_company
    join public.course_templates template on template.id = run.template_id
    where item.version_id = source.version_id and item.category = source.category
      and item.removed_at is null and run.archived_at is null
      and (p_after is null or run.id > p_after)
      and (private.has_permission('courses.manage')
        or (private.lecturer_actor() and private.course_has_current_teacher(run.id)))
      and private.course_resource_allowed(item.id)
    group by run.id, template.title
    order by run.id limit 26
  ), visible as (
    select * from matches order by id limit 25
  )
  select jsonb_build_object(
    'items', coalesce(jsonb_agg(to_jsonb(visible) order by id), '[]'::jsonb),
    'next', case when (select count(*) from matches) > 25 then
      (select id from visible order by id desc limit 1) end
  ) into report from visible;
  return report;
end;
$$;
create function public.course_material_usage(p_resource_id uuid, p_after uuid default null)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.course_material_usage(p_resource_id, p_after);
$$;
revoke all on function private.course_material_usage(uuid,uuid), public.course_material_usage(uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.course_material_usage(uuid,uuid), public.course_material_usage(uuid,uuid) to authenticated;

do $migration$
declare
  gate text := pg_catalog.pg_get_functiondef('private.require_academy_course_access()'::regprocedure);
  anchor constant text := '''/rpc/course_material_metadata_history''';
begin
  if cardinality(string_to_array(gate, anchor)) <> 2 then
    raise exception 'Expected the material metadata read boundary';
  end if;
  execute replace(gate, anchor, anchor || ', ''/rpc/course_material_usage''');
end;
$migration$;

notify pgrst, 'reload schema';
commit;
