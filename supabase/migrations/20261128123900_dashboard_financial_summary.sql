-- The internal dashboard needs original-currency totals only. Compose the same
-- actor-scoped finance RPCs before PostgREST applies its response row limit.
begin;

create function public.dashboard_financial_summary()
returns table (
  kind text,
  currency text,
  amount numeric,
  accepted_gross numeric,
  organisation_id uuid,
  organisation_name text
)
language plpgsql stable security invoker set search_path = ''
as $$
declare
  access jsonb := public.commission_access();
begin
  if (access->>'can_manage_gross')::boolean then
    return query
    select 'platform'::text, report.currency,
      coalesce(sum(round(report.platform_total_amount, 2)) filter (where confirmed.has_known_fee), 0),
      coalesce(sum(round(report.gross_total_amount, 2)) filter (where confirmed.has_known_fee), 0),
      null::uuid, null::text
    from public.commission_report() report
    cross join lateral (select report.claim_id is not null
      and report.gross_total_amount is not null
      and report.platform_total_amount is not null as has_known_fee) confirmed
    group by report.currency
    order by report.currency;
  elsif (access->>'can_request')::boolean then
    return query
    select 'client'::text, spend.currency, spend.gross_assigned_amount,
      null::numeric, spend.organisation_id, spend.organisation_name
    from public.client_spend_summary() spend
    order by spend.organisation_name, spend.currency, spend.organisation_id;
  elsif (public.commercial_access()->>'can_submit_invoice')::boolean then
    return query
    select 'lecturer'::text, earnings.currency,
      coalesce(sum(round(earnings.total_amount, 2)) filter (
        where earnings.stage in ('expected', 'completed', 'invoiced', 'paid')
      ), 0), null::numeric, null::uuid, null::text
    from public.finance_earnings(false) earnings
    group by earnings.currency
    order by earnings.currency;
  end if;
end;
$$;

revoke all on function public.dashboard_financial_summary() from public, anon, authenticated, service_role;
grant execute on function public.dashboard_financial_summary() to authenticated;

notify pgrst, 'reload schema';
commit;
