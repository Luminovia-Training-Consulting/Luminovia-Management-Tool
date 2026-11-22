begin;

-- Use current membership and permission checks for the picker and for the
-- report itself. Do not derive authorisation from the selected organisation.
create function private.analytics_access() returns jsonb
language sql stable security definer set search_path='' as $$
  with capabilities as (
    select private.lecturer_actor() as personal,
      private.has_permission('jobs.manage') or private.has_permission('finance.manage') as staff
    where private.actor_active() and exists (
      select from private.installation_identity where singleton and edition='internal'
    )
  )
  select coalesce((
    select jsonb_build_object(
      'personal',capabilities.personal,
      'staff',capabilities.staff,
      'time_zone',(select p.time_zone from public.profiles p where p.id=auth.uid()),
      'organisations',(
        select coalesce(jsonb_agg(jsonb_build_object(
          'id',o.id,'name',o.name,'time_zone',o.time_zone,'company',private.client_has_organisation(o.id)
        ) order by o.name,o.id),'[]'::jsonb)
        from public.organisations o
        where capabilities.staff or private.client_has_organisation(o.id)
      )
    )
    from capabilities
  ),'{"personal":false,"staff":false,"time_zone":null,"organisations":[]}'::jsonb);
$$;

create function public.analytics_access() returns jsonb
language sql stable security invoker set search_path='' as $$
  select private.analytics_access();
$$;

create function private.analytics_report(
  p_scope text, p_from date, p_until date, p_organisation_id uuid default null
) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  zone text;
  begins timestamptz;
  ends timestamptz;
  as_of constant timestamptz := now();
  can_jobs boolean := p_scope='staff' and private.has_permission('jobs.manage');
  can_net boolean := p_scope='personal' or (
    p_scope='staff' and private.has_permission('finance.manage')
  );
  can_gross boolean := p_scope='company' or (
    p_scope='staff' and private.has_permission('finance.gross.read')
  );
  -- A lecturer invoice can span several companies. Its cash entries cannot
  -- be allocated to a company without a recorded payment breakdown.
  can_lecturer_cash boolean := can_net and p_organisation_id is null;
  result jsonb;
begin
  if not private.actor_active() or not exists (
    select from private.installation_identity where singleton and edition='internal'
  ) or (case p_scope
    when 'personal' then not private.lecturer_actor()
    when 'company' then p_organisation_id is null or not private.client_has_organisation(p_organisation_id)
    when 'staff' then not (can_jobs or can_net)
    else true
  end) then
    raise exception 'Current analytics scope required' using errcode='42501';
  end if;

  if p_from is null or p_until is null or not isfinite(p_from) or not isfinite(p_until)
    or p_from < date '1900-01-01' or p_until > date '2200-01-01'
    or p_until <= p_from or p_until - p_from > 731
    or (p_scope='personal' and p_organisation_id is not null) then
    raise exception 'A valid analytics period of up to 731 days is required' using errcode='22023';
  end if;

  select time_zone into zone from public.profiles where id=auth.uid();
  if p_scope='company' then
    select time_zone into zone from public.organisations where id=p_organisation_id;
  end if;
  begins := p_from::timestamp at time zone zone;
  ends := p_until::timestamp at time zone zone;

  with months as (
    select month::date,
      greatest(begins,month at time zone zone) as starts_at,
      least(ends,(month+interval '1 month') at time zone zone) as ends_at
    from generate_series(date_trunc('month',p_from::timestamp),
      date_trunc('month',(p_until-1)::timestamp),interval '1 month') as period(month)
  ), scoped_claims as materialized (
    select c.id,c.currency,ledger.gross_total_amount,first_session.starts_at
    from public.job_claims c
    join public.jobs job on job.id=c.job_id
    left join public.course_runs run on run.id=job.course_run_id
    left join private.claim_revenue_ledger ledger on ledger.claim_id=c.id
    left join private.job_commission_offers offer on offer.job_id=job.id
    left join private.client_course_requests request on request.job_id=job.id
    cross join lateral (
      select min(s.starts_at) as starts_at from public.assignment_sessions s
      where s.claim_id=c.id and s.released_at is null
    ) first_session
    where c.status='confirmed' and (p_scope<>'personal' or c.lecturer_id=auth.uid())
      and (p_organisation_id is null
        or p_organisation_id=coalesce(ledger.organisation_id,run.organisation_id,offer.organisation_id,request.organisation_id))
      and exists (
        select from public.assignment_sessions s where s.claim_id=c.id and s.released_at is null
          and s.starts_at<ends and s.ends_at>begins
      )
  ), scoped_sessions as (
    select s.starts_at,s.ends_at from public.assignment_sessions s
    join scoped_claims c on c.id=s.claim_id
    where s.released_at is null and s.starts_at<ends and s.ends_at>begins
  ), teaching as (
    select m.month,
      round(sum(greatest(0,extract(epoch from (
        least(m.ends_at,s.ends_at,as_of)-greatest(m.starts_at,s.starts_at)
      ))))/60,4) as past_minutes,
      round(sum(greatest(0,extract(epoch from (
        least(m.ends_at,s.ends_at)-greatest(m.starts_at,s.starts_at,as_of)
      ))))/60,4) as future_minutes
    from months m join scoped_sessions s on s.starts_at<m.ends_at and s.ends_at>m.starts_at
    group by m.month
  ), allocations as materialized (
    select m.month,c.currency,c.starts_at>=as_of as upcoming,
      case when can_net then private.forecast_assignment_total(c.id) end as net,
      case when can_gross then c.gross_total_amount end as gross
    from scoped_claims c join months m on c.starts_at>=m.starts_at and c.starts_at<m.ends_at
  ), first_starts as (
    select month,count(*) filter(where not upcoming) as past_assignments,
      count(*) filter(where upcoming) as future_assignments
    from allocations group by month
  ), open_positions as (
    select m.month,sum(greatest(0,j.capacity-occupied.slots)) as slots
    from public.jobs j
    left join public.course_runs run on run.id=j.course_run_id
    left join private.job_commission_offers offer on offer.job_id=j.id
    left join private.client_course_requests request on request.job_id=j.id
    cross join lateral (
      select min(s.starts_at) as starts_at from public.job_sessions s where s.job_id=j.id
    ) first_session
    join months m on first_session.starts_at>=m.starts_at and first_session.starts_at<m.ends_at
    cross join lateral (
      select count(*) as slots from public.job_claims c where c.job_id=j.id and c.status='confirmed'
    ) occupied
    where can_jobs and j.status='published' and (j.claim_deadline is null or j.claim_deadline>as_of)
      and first_session.starts_at>=as_of
      and (p_organisation_id is null
        or p_organisation_id=coalesce(run.organisation_id,offer.organisation_id,request.organisation_id))
    group by m.month
  ), commitments as (
    select month,currency,
      sum(net) filter(where not upcoming) as past_net,sum(net) filter(where upcoming) as future_net,
      sum(gross) filter(where not upcoming) as past_gross,sum(gross) filter(where upcoming) as future_gross,
      count(*) filter(where gross is null) as missing_gross
    from allocations group by month,currency
  ), lecturer_entries as (
    select p.paid_at as effective_at,p.currency,p.amount
    from public.payment_records p join public.invoices i on i.id=p.invoice_id
    where can_lecturer_cash and p.voided_at is null and p.paid_at>=begins and p.paid_at<ends
      and (p_scope<>'personal' or i.user_id=auth.uid())
    union all
    select r.received_on::timestamp at time zone zone,c.currency,-r.amount
    from private.invoice_series_repayments r
    join private.invoice_series_corrections c on c.id=r.correction_id
    join public.job_claims claim on claim.id=c.claim_id
    where can_lecturer_cash and r.voided_at is null and r.received_on>=p_from and r.received_on<p_until
      and (p_scope<>'personal' or claim.lecturer_id=auth.uid())
  ), lecturer_cash as (
    select m.month,e.currency,sum(e.amount) as amount
    from lecturer_entries e join months m on e.effective_at>=m.starts_at and e.effective_at<m.ends_at
    where e.effective_at<=as_of group by m.month,e.currency
  ), customer_entries as (
    select p.invoice_id,p.paid_at as effective_at,
      case when p.reverses_id is null then p.amount else -p.amount end as amount
    from private.accounting_customer_payments p
    where can_gross and p.paid_at>=begins and p.paid_at<ends
    union all
    select r.invoice_id,coalesce(r.refunded_at,r.created_at),
      case when r.reverses_id is null then -r.amount else r.amount end
    from private.accounting_customer_refunds r
    where can_gross and coalesce(r.refunded_at,r.created_at)>=begins
      and coalesce(r.refunded_at,r.created_at)<ends
  ), customer_cash as (
    select m.month,i.currency,sum(e.amount) as amount
    from customer_entries e join private.accounting_customer_invoices i on i.id=e.invoice_id
    join months m on e.effective_at>=m.starts_at and e.effective_at<m.ends_at
    where e.effective_at<=as_of
      and (p_organisation_id is null or p_organisation_id=i.organisation_id)
    group by m.month,i.currency
  ), money as (
    select m.month,jsonb_object_agg(currency.code,jsonb_build_object(
      'past_net',case when can_net then coalesce(c.past_net,0) end,
      'future_net',case when can_net then coalesce(c.future_net,0) end,
      'past_gross',case when can_gross then coalesce(c.past_gross,0) end,
      'future_gross',case when can_gross then coalesce(c.future_gross,0) end,
      'missing_gross',case when can_gross then coalesce(c.missing_gross,0) end,
      'lecturer_cash',case when can_lecturer_cash then coalesce(l.amount,0) end,
      'customer_cash',case when can_gross then coalesce(p.amount,0) end
    )) as currencies
    from months m cross join (values ('EUR'),('AUD')) currency(code)
    left join commitments c on c.month=m.month and c.currency=currency.code
    left join lecturer_cash l on l.month=m.month and l.currency=currency.code
    left join customer_cash p on p.month=m.month and p.currency=currency.code
    group by m.month
  )
  select jsonb_build_object('time_zone',zone,'can_model_pipeline',can_net and p_scope='staff',
    'months',jsonb_agg(jsonb_build_object(
      'month',m.month,'history',m.starts_at<as_of,'forecast',m.ends_at>as_of,
      'past_assignments',coalesce(a.past_assignments,0),
      'future_assignments',coalesce(a.future_assignments,0),
      'past_minutes',coalesce(t.past_minutes,0),
      'future_minutes',coalesce(t.future_minutes,0),
      'open_positions',case when can_jobs then coalesce(o.slots,0) end,
      'currencies',money.currencies
    ) order by m.month))
    into result from months m
    join money using(month)
    left join teaching t using(month)
    left join first_starts a using(month)
    left join open_positions o using(month);

  return result;
end;
$$;

create function public.analytics_report(
  p_scope text, p_from date, p_until date, p_organisation_id uuid default null
) returns jsonb
language sql stable security invoker set search_path='' as $$
  select private.analytics_report(p_scope,p_from,p_until,p_organisation_id);
$$;

revoke all on function private.analytics_access(),public.analytics_access(),
  private.analytics_report(text,date,date,uuid),public.analytics_report(text,date,date,uuid)
from public,anon,authenticated,service_role;
grant execute on function private.analytics_access(),public.analytics_access(),
  private.analytics_report(text,date,date,uuid),public.analytics_report(text,date,date,uuid)
to authenticated;

notify pgrst,'reload schema';
commit;
