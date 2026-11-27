-- Keep the privacy policy responsive at the native REST statement timeout.
-- Offer discovery excludes the caller's confirmed assignments before paging.
-- Only management or own-company authority can reveal those candidates' labels.
begin;

create or replace function private.can_read_assignment_customer(p_job_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select private.has_permission('jobs.manage')
    or case when private.has_role(array['client']) then private.job_dispatch_company_actor(p_job_id) else false end
    or case when exists (
      select 1 from public.job_claims claim
      cross join private.assignment_customer_policy policy
      where claim.job_id=p_job_id and claim.lecturer_id=auth.uid() and claim.status='confirmed'
      and (policy.mode='on_confirmation' or (policy.mode='scheduled' and (
        select min(slot.starts_at)
        from public.assignment_sessions slot
        where slot.claim_id=claim.id and slot.released_at is null
      ) <= statement_timestamp() + make_interval(hours=>policy.lead_hours)))
    ) then private.lecturer_actor() and not private.job_lecturer_blocked(p_job_id,auth.uid())
    else false end
$$;

-- Confirm locale-neutral text and privacy-aware filters with one permission
-- snapshot for the whole page. Perform per-company checks only for real company
-- actors in a query that uses protected labels, and only once per item read.
do $migration$
declare
  definition text;
  roles constant text := 'private.lecturer_actor() as lecturer,';
  columns constant text := 'private.visible_job_customer(job.id,job.customer_name) as customer_name';
  join_point constant text := 'cross join public.jobs job';
  search_text constant text := $old$or strpos(lower(job.title || ' ' || job.description || ' ' || private.visible_job_customer(job.id,job.customer_name) || ' ' || private.visible_job_location(job.id,job.location)), lower(f->>'q')) > 0$old$;
  customer_filter constant text := $old$or strpos(lower(private.visible_job_customer(job.id,job.customer_name)), lower(f->>'customer')) > 0$old$;
  item_name constant text := 'private.visible_job_customer(j.id,j.customer_name)';
  item_location constant text := 'private.visible_job_location(j.id,j.location)';
  item_join constant text := 'from public.jobs j left join lateral';
begin
  definition := pg_get_functiondef('private.job_discovery_candidates(jsonb)'::regprocedure);
  if cardinality(string_to_array(definition,roles))<>2
    or cardinality(string_to_array(definition,columns))<>2
    or cardinality(string_to_array(definition,join_point))<>2
    or cardinality(string_to_array(definition,search_text))<>2
    or cardinality(string_to_array(definition,customer_filter))<>2 then
    raise exception 'Unexpected marketplace candidate filters';
  end if;
  definition := replace(definition,roles,roles || $code$
    private.has_permission('jobs.manage') as manager,
    private.has_role(array['client']) as company,
  $code$);
  definition := replace(definition,columns,$code$
    case when options.sort='customer_asc' and visibility.customer then job.customer_name else '' end as customer_name
  $code$);
  definition := replace(definition,join_point,join_point || $code$
    cross join lateral (
      select case
        when options.manager then true
        when options.company and (options.sort='customer_asc' or f->>'q'<>'' or f->>'customer'<>'')
          then private.job_dispatch_company_actor(job.id)
        else false end as customer
      offset 0
    ) visibility
  $code$);
  definition := replace(definition,search_text,$code$
    or strpos(lower(job.title || ' ' || job.description), lower(f->>'q')) > 0
    or (visibility.customer and strpos(
      lower(job.title || ' ' || job.description || ' ' || job.customer_name || ' ' || job.location),
      lower(f->>'q')
    ) > 0)
  $code$);
  execute replace(definition,customer_filter,$code$
    or (visibility.customer and strpos(lower(job.customer_name),lower(f->>'customer')) > 0)
  $code$);

  definition := pg_get_functiondef('private.job_discovery_item(uuid)'::regprocedure);
  if cardinality(string_to_array(definition,item_name))<>2
    or cardinality(string_to_array(definition,item_location))<>2
    or cardinality(string_to_array(definition,item_join))<>2
    or cardinality(string_to_array(definition,'not private.can_read_assignment_customer(j.id)'))<>3 then
    raise exception 'Unexpected marketplace item projection';
  end if;
  definition := replace(definition,item_name,
    'case when visibility.customer then j.customer_name else '''' end');
  definition := replace(definition,item_location,
    'case when visibility.customer then j.location else '''' end');
  definition := replace(definition,'not private.can_read_assignment_customer(j.id)','not visibility.customer');
  execute replace(definition,item_join,$code$
    from public.jobs j
    cross join lateral (select private.can_read_assignment_customer(j.id) as customer offset 0) visibility
    left join lateral
  $code$);
end;
$migration$;

commit;
