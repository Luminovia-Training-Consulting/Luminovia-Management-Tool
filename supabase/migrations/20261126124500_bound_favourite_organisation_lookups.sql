begin;

create or replace function private.my_favourites(p_search text default '') returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if not private.actor_active() then raise exception 'Active account required' using errcode='42501'; end if;
  if p_search is null or length(p_search)>100 then raise exception 'Invalid search' using errcode='22023'; end if;

  return jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('kind',f.kind,'id',f.resource_id,'label',x.label,'created_at',f.created_at)
        order by f.created_at desc,f.resource_id)
      from private.personal_favourites f
      cross join lateral (select private.favourite_resource(f.kind,f.resource_id) label) x
      where f.user_id=auth.uid() and x.label is not null
    ),'[]'::jsonb),
    'organisations', coalesce((
      select jsonb_agg(jsonb_build_object('id',o.id,'label',o.name) order by o.name,o.id)
      from (
        -- Use the same visibility checks as favourite_resource for a single item,
        -- but let the planner correlate course rows directly with candidate organisations.
        select candidate.id,candidate.name from public.organisations candidate
        where candidate.archived_at is null
          and position(lower(p_search) in lower(candidate.name))>0
          and (
            (select private.has_permission('organisations.manage'))
            or private.client_has_organisation(candidate.id)
            or exists (
              select from public.course_runs run
              where run.organisation_id=candidate.id and private.can_read_course_run(run.id)
            )
          )
        order by candidate.name,candidate.id limit 100
      ) o
    ),'[]'::jsonb)
  );
end;
$$;

commit;