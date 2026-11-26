begin;

-- Return an organisation-level forecast without exposing its opportunity rows.
create function private.get_crm_weighted_pipeline(p_organisation_id uuid)
returns table (
  currency text,
  weighted_value numeric,
  included_opportunity_count bigint,
  incomplete_opportunity_count bigint
)
language plpgsql security definer set search_path = '' as $$
begin
  if not private.has_permission('organisations.manage') then
    raise exception 'organisations.manage required' using errcode = '42501';
  end if;
  if p_organisation_id is null then
    raise exception 'Invalid CRM weighted pipeline request' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.organisations o where o.id = p_organisation_id
  ) then
    raise exception 'Organisation not found' using errcode = 'P0002';
  end if;

  return query
    select o.currency,
           case
             when count(*) filter (
               where o.estimated_value is not null
                 and o.close_probability is not null
             ) = 0 then null::numeric
             else sum(o.estimated_value * o.close_probability / 100) filter (
               where o.estimated_value is not null
                 and o.close_probability is not null
             )
           end,
           count(*) filter (
             where o.estimated_value is not null
               and o.close_probability is not null
           ),
           count(*) filter (
             where o.estimated_value is null
                or o.close_probability is null
           )
      from public.crm_opportunities o
     where o.organisation_id = p_organisation_id
       and o.stage not in ('contract_signed', 'active_customer', 'lost', 'dormant')
     group by o.currency
     order by o.currency;
end;
$$;

create function public.get_crm_weighted_pipeline(p_organisation_id uuid)
returns table (
  currency text,
  weighted_value numeric,
  included_opportunity_count bigint,
  incomplete_opportunity_count bigint
)
language sql security invoker set search_path = '' as $$
  select * from private.get_crm_weighted_pipeline(p_organisation_id);
$$;

revoke all on function private.get_crm_weighted_pipeline(uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.get_crm_weighted_pipeline(uuid) to authenticated;
revoke all on function public.get_crm_weighted_pipeline(uuid)
  from public, anon, service_role;
grant execute on function public.get_crm_weighted_pipeline(uuid) to authenticated;

comment on function public.get_crm_weighted_pipeline(uuid) is
  'Returns open organisation opportunities weighted by probability, separated by recorded currency; incomplete opportunities are counted but not valued, and signed, active, lost, and dormant stages are excluded.';

commit;