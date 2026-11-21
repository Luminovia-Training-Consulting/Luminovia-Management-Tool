begin;

-- Historical accepted gross snapshots only. The caller receives no lecturer
-- compensation, platform share, offers, or another company's records.
create function private.company_monthly_accepted_spending(p_organisation_id uuid default null)
returns table(organisation_id uuid,organisation_name text,time_zone text,
  currency text,month_start date,gross_amount numeric,claim_count bigint)
language plpgsql stable security definer set search_path='' as $$
begin
  if not private.actor_active() or not exists(
    select 1 from public.client_organisation_memberships membership
      where membership.user_id=auth.uid() and membership.removed_at is null
        and private.client_has_organisation(membership.organisation_id)
  ) then
    raise exception 'Current company membership required' using errcode='42501';
  end if;
  if p_organisation_id is not null and
     not private.client_has_organisation(p_organisation_id) then
    raise exception 'Current company membership required' using errcode='42501';
  end if;
  return query
    select organisation.id,organisation.name,organisation.time_zone,
      ledger.currency,
      date_trunc('month',ledger.accepted_at at time zone organisation.time_zone)::date,
      sum(ledger.gross_total_amount),count(*)
    from private.claim_revenue_ledger ledger
    join public.organisations organisation on organisation.id=ledger.organisation_id
    where (p_organisation_id is null or organisation.id=p_organisation_id)
      and private.client_has_organisation(organisation.id)
    group by organisation.id,organisation.name,organisation.time_zone,
      ledger.currency,
      date_trunc('month',ledger.accepted_at at time zone organisation.time_zone)::date
    order by organisation.name,organisation.id,ledger.currency,
      date_trunc('month',ledger.accepted_at at time zone organisation.time_zone)::date;
end;$$;
create function public.company_monthly_accepted_spending(p_organisation_id uuid default null)
returns table(organisation_id uuid,organisation_name text,time_zone text,
  currency text,month_start date,gross_amount numeric,claim_count bigint)
language sql stable security invoker set search_path='' as $$
  select * from private.company_monthly_accepted_spending(p_organisation_id);
$$;
revoke all on function private.company_monthly_accepted_spending(uuid),
  public.company_monthly_accepted_spending(uuid) from public,anon,authenticated,service_role;
grant execute on function private.company_monthly_accepted_spending(uuid),
  public.company_monthly_accepted_spending(uuid) to authenticated;

notify pgrst,'reload schema';
commit;
