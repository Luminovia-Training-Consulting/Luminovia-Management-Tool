begin;

-- Publication remains controlled by the individual course workflow. Use
-- its exact current state and reuse its archive checks and audit.
create or replace function private.archive_course_runs(p_items jsonb, p_archive boolean)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  item record;
  run public.course_runs%rowtype;
  academy boolean := (select edition from private.installation_identity) is distinct from 'internal';
begin
  if academy then perform private.lock_academy_course_access(); end if;
  perform 1 from public.profiles where id = auth.uid() and active for share;
  if not found then raise insufficient_privilege; end if;
  perform 1 from public.user_roles where user_id = auth.uid() order by role for share;
  if not private.has_permission('courses.manage') then
    raise insufficient_privilege;
  end if;
  if p_archive is null or jsonb_typeof(p_items) is distinct from 'array' then
    raise invalid_parameter_value;
  end if;
  if jsonb_array_length(p_items) not between 2 and 50 then
    raise invalid_parameter_value;
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_items) entry
    where not case when jsonb_typeof(entry) = 'object' then
      entry ?& array['id', 'published', 'archived_at', 'organisation_id']
      and entry - array['id', 'published', 'archived_at', 'organisation_id'] = '{}'::jsonb
      and jsonb_typeof(entry->'id') = 'string'
      and jsonb_typeof(entry->'published') = 'boolean'
      and jsonb_typeof(entry->'archived_at') in ('null', 'string')
      and jsonb_typeof(entry->'organisation_id') in ('null', 'string')
    else false end
  ) then
    raise invalid_parameter_value;
  end if;
  if (
    select count(distinct (entry->>'id')::uuid) from jsonb_array_elements(p_items) entry
  ) <> jsonb_array_length(p_items) then
    raise invalid_parameter_value;
  end if;
  for item in select * from jsonb_to_recordset(p_items)
    as expected(id uuid, published boolean, archived_at timestamptz, organisation_id uuid)
    order by id
  loop
    select * into run from public.course_runs where id = item.id for update;
    if academy then
      perform 1 from public.organisations organisation
      where organisation.id = run.organisation_id and organisation.archived_at is null
      for share;
      if not found then raise insufficient_privilege; end if;
    end if;
    if run.id is null or run.published is distinct from item.published
      or run.archived_at is distinct from item.archived_at
      or run.organisation_id is distinct from item.organisation_id
      or p_archive = (run.archived_at is not null) then
      raise sqlstate 'PT409' using message = 'Reviewed course state changed';
    end if;
    perform private.set_course_visibility(run.id, run.published, p_archive);
  end loop;
  return jsonb_array_length(p_items);
end;
$$;

-- The learning hub still projects current learner workspaces only. This
-- separate manager projection includes the archive, without learner records.
create function private.academy_course_archive_runs(p_archived boolean, p_offset integer)
returns jsonb language plpgsql stable security definer
set search_path = '' set timezone = 'UTC' as $$
declare
  page_size constant integer := 50;
  result jsonb;
begin
  if not coalesce(private.academy_course_access_status() in ('active','grace'),false)
    or not private.has_permission('courses.manage') then
    raise insufficient_privilege;
  end if;
  if p_archived is null or p_offset is null or p_offset < 0 then
    raise invalid_parameter_value;
  end if;
  with page as materialized (
    select run.id, run.published, run.archived_at, run.organisation_id,
      template.title, organisation.name as organisation_name, run.time_zone,
      (select min(session.starts_at) from public.course_sessions session where session.course_run_id = run.id) as starts_at
    from public.course_runs run
    join public.course_templates template on template.id = run.template_id
    join public.organisations organisation on organisation.id = run.organisation_id
      and organisation.archived_at is null
    where (run.archived_at is not null) = p_archived
    order by run.id
    limit page_size + 1 offset p_offset
  )
  select jsonb_build_object(
    'items',coalesce((select jsonb_agg(to_jsonb(run) order by run.id)
      from (select * from page order by id limit page_size) run),'[]'::jsonb),
    'has_more',(select count(*) > page_size from page)
  ) into result;
  return result;
end;
$$;

create function public.academy_course_archive_runs(p_archived boolean,p_offset integer)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.academy_course_archive_runs(p_archived,p_offset);
$$;

revoke all on function private.academy_course_archive_runs(boolean,integer),
  public.academy_course_archive_runs(boolean,integer) from public,anon,authenticated,service_role;
grant execute on function private.academy_course_archive_runs(boolean,integer),
  public.academy_course_archive_runs(boolean,integer) to authenticated;

do $migration$
declare
  definition text := pg_get_functiondef('private.require_academy_course_access()'::regprocedure);
  anchor constant text := '  licence_status := private.academy_course_access_status();';
begin
  if cardinality(string_to_array(definition,anchor)) <> 2 then
    raise exception 'Expected Academy licence check';
  end if;
  execute replace(definition,anchor,anchor || chr(10) || $gate$
  if licence_status in ('active','grace') and request_method in ('GET','HEAD','POST')
    and request_path = '/rpc/academy_course_archive_runs' then return; end if;
  if licence_status = 'active' and request_method = 'POST'
    and request_path = '/rpc/archive_course_runs' then return; end if;
$gate$);
end;
$migration$;

notify pgrst, 'reload schema';
commit;
