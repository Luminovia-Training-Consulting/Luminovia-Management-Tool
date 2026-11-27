begin;

-- Only the bounded scheduling and publication history is shown. Staff see
-- event category and time without an actor, a customer note or audit details.
create index course_timeline_audit_history on public.audit_events(resource_id, created_at desc, id desc)
where action in (
  'course.run.saved', 'course.run.duplicated', 'course.visibility.changed', 'course.class.changed',
  'academy.course.schedule_updated', 'academy.course.published', 'academy.course.capacity_updated'
);

create function private.course_timeline(p_run_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  access jsonb := private.course_workspace_context_for_package(p_run_id, false);
begin
  if (access->>'staff')::boolean is not true or (
    (access->>'standard_enabled')::boolean is not true
    and not exists (
      select 1 from public.course_runs run
      where run.id = p_run_id and run.organisation_id is null
        and (select edition from private.installation_identity) = 'internal'
    )
  ) then
    raise insufficient_privilege;
  end if;

  return (
    select coalesce(jsonb_agg(jsonb_build_object('id', event.id, 'kind', event.kind, 'at', event.created_at)
      order by event.created_at, event.id), '[]'::jsonb)
    from (
      select audit.id, audit.created_at, case audit.action
        when 'course.run.saved' then 'updated'
        when 'course.run.duplicated' then 'copied'
        when 'course.visibility.changed' then 'visibility'
        when 'course.class.changed' then 'class'
        when 'academy.course.schedule_updated' then 'schedule'
        when 'academy.course.published' then 'published'
        when 'academy.course.capacity_updated' then 'capacity'
      end as kind
      from public.audit_events audit
      where audit.resource_id = p_run_id
        and audit.action in (
          'course.run.saved', 'course.run.duplicated', 'course.visibility.changed', 'course.class.changed',
          'academy.course.schedule_updated', 'academy.course.published', 'academy.course.capacity_updated'
        )
        and (audit.action <> 'course.run.saved' or audit.details->'created' is distinct from 'true'::jsonb)
      order by audit.created_at desc, audit.id desc
      limit 100
    ) event
  );
end;
$$;

create function public.course_timeline(p_run_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.course_timeline(p_run_id);
$$;
revoke all on function private.course_timeline(uuid), public.course_timeline(uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.course_timeline(uuid), public.course_timeline(uuid)
  to authenticated;

do $migration$
declare
  definition text := pg_catalog.pg_get_functiondef('private.require_academy_course_access()'::regprocedure);
  anchor constant text := '''/rpc/course_content_studio''';
begin
  if cardinality(string_to_array(definition, anchor)) <> 2 then
    raise exception 'Expected one Academy course read gate';
  end if;
  execute replace(definition, anchor, anchor || ', ''/rpc/course_timeline''');
end;
$migration$;

notify pgrst, 'reload schema';
commit;
