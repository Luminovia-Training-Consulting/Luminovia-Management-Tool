begin;

-- Publication remains controlled by the individual course workflow. Use
-- its exact current state and reuse its archive checks and audit.
create function private.archive_course_runs(p_items jsonb, p_archive boolean)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  item record;
  run public.course_runs%rowtype;
begin
  if (select edition from private.installation_identity) is distinct from 'internal'
    or not private.has_permission('courses.manage') then
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
    if not found or run.published is distinct from item.published
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

create function public.archive_course_runs(p_items jsonb, p_archive boolean)
returns integer language sql security invoker set search_path = '' as $$
  select private.archive_course_runs(p_items, p_archive);
$$;

revoke all on function private.archive_course_runs(jsonb,boolean),
  public.archive_course_runs(jsonb,boolean) from public, anon, authenticated, service_role;
grant execute on function private.archive_course_runs(jsonb,boolean),
  public.archive_course_runs(jsonb,boolean) to authenticated;

commit;
