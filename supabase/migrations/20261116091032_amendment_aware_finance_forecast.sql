-- Forecast accepted work from its latest jointly accepted amendment, preserving
-- the immutable original claim/revenue ledger and the existing currency/ACL DTO.
-- Formal Amendments is independently installed: resolve its exact private helper
-- at read time so either installation order works without a captured predecessor.
BEGIN;

-- Internal-only adapter. An absent module means original accepted compensation;
-- an installed but invalid effective snapshot must fail rather than silently
-- resurrect a historical fee. No caller can use this as another user's net oracle.
create function private.forecast_assignment_total(p_claim uuid) returns numeric
language plpgsql stable security definer set search_path='' as $$
declare result numeric;effective_function regprocedure:=to_regprocedure('private.effective_assignment(uuid)');
begin
 if effective_function is null then
  select total_amount into result from public.job_claims where id=p_claim;
 else
  -- The only identifier comes from this exact private catalog identity, never
  -- a caller string. Keep absent optional SQL out of static body resolution.
  execute format('select (%s($1)->>''total_amount'')::numeric',effective_function::oid::regproc) into result using p_claim;
 end if;
 -- Accepted zero net is valid (including a captured regular role share of 0%).
 if result is null or result<0 or result::text in('NaN','Infinity','-Infinity') then
  raise exception 'Valid effective accepted compensation required' using errcode='55000';
 end if;
 return result;
end;$$;
revoke all on function private.forecast_assignment_total(uuid) from public,anon,authenticated,service_role;

create or replace function private.finance_forecast(p_from date,p_until date,p_pipeline_probability numeric default 0) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;can_gross boolean;zone text;begins timestamptz;ends timestamptz;
begin
 if not private.has_permission('finance.manage') then raise exception 'finance.manage and MFA required' using errcode='42501';end if;
 perform private.finance_period(p_from,p_until);
 if p_pipeline_probability is null or p_pipeline_probability<0 or p_pipeline_probability>1 or p_pipeline_probability::text in('NaN','Infinity','-Infinity') then raise exception 'Explicit pipeline probability from zero to one required' using errcode='22023';end if;
 can_gross=private.has_permission('finance.gross.read');select time_zone into zone from public.profiles where id=auth.uid();
 begins=p_from::timestamp at time zone zone;ends=p_until::timestamp at time zone zone;
 -- Commissioned financial amendments explicitly retain the original customer
 -- gross charge. Only the consented lecturer net/platform allocation changes;
 -- consequently current margin is immutable gross minus effective accepted net.
 -- Released allocations remain evidence and must never choose a forecast month.
 with accepted as(
  select date_trunc('month',sessions.starts_at at time zone zone)::date as month,c.currency,private.forecast_assignment_total(c.id) cost,
   case when can_gross then l.gross_total_amount end gross,
   case when can_gross and l.claim_id is not null then l.gross_total_amount-private.forecast_assignment_total(c.id) end margin,
   case when l.claim_id is null then 1 else 0 end unknown_gross
  from public.job_claims c cross join lateral(select min(starts_at) starts_at from public.assignment_sessions where claim_id=c.id and released_at is null)sessions
  left join private.claim_revenue_ledger l on l.claim_id=c.id where c.status='confirmed' and sessions.starts_at>=begins and sessions.starts_at<ends
 ), offers as(
  select date_trunc('month',sessions.starts_at at time zone zone)::date as month,j.currency,
   (j.capacity-(select count(*) from public.job_claims c where c.job_id=j.id and c.status='confirmed'))::numeric slots,case when fee.pricing_mode='role_split' then null else j.total_amount end cost,
   case when can_gross then fee.gross_total_amount end gross
  from public.jobs j cross join lateral(select min(starts_at) starts_at from public.job_sessions where job_id=j.id)sessions
  left join private.job_commission_offers fee on fee.job_id=j.id where j.status='published' and (j.claim_deadline is null or j.claim_deadline>now())
   and sessions.starts_at>now() and sessions.starts_at>=begins and sessions.starts_at<ends
 ), requests as(
  select date_trunc('month',(r.payload->'sessions'->0->>'starts_at')::timestamptz at time zone zone)::date as month,r.payload->>'currency' currency,
   case when can_gross then (r.payload->>'gross_total_amount')::numeric end gross
  from private.client_course_requests r where can_gross and r.job_id is null and r.status='submitted'
   and (r.payload->'sessions'->0->>'starts_at')::timestamptz>now() and (r.payload->'sessions'->0->>'starts_at')::timestamptz>=begins and (r.payload->'sessions'->0->>'starts_at')::timestamptz<ends
 ), payment_entries as(
  select date_trunc('month',p.paid_at at time zone zone)::date as month,p.currency,p.amount
  from public.payment_records p where p.voided_at is null and p.paid_at>=begins and p.paid_at<ends
 ), buckets as(select a.month,a.currency from accepted a union select o.month,o.currency from offers o union select r.month,r.currency from requests r union select p.month,p.currency from payment_entries p)
 select coalesce(jsonb_agg(jsonb_build_object('month',b.month,'currency',b.currency,
  'accepted_lecturer_cost',coalesce((select sum(cost) from accepted a where a.month=b.month and a.currency=b.currency),0),
  'accepted_gross_known',case when can_gross then coalesce((select sum(gross) from accepted a where a.month=b.month and a.currency=b.currency),0) end,
  'accepted_margin_known',case when can_gross then coalesce((select sum(margin) from accepted a where a.month=b.month and a.currency=b.currency),0) end,
  'unknown_gross_claims',case when can_gross then coalesce((select sum(unknown_gross) from accepted a where a.month=b.month and a.currency=b.currency),0) end,
  -- A public role-split zero is a privacy sentinel, not a free lecturer.
  -- Do not invent the future mix of regular/senior recipients or disclose
  -- alternate rates to finance operations lacking gross-finance authority.
  'pipeline_cost_unknown_positions',coalesce((select sum(slots) from offers o where o.month=b.month and o.currency=b.currency and o.cost is null),0),
  'pipeline_lecturer_cost_known',case when exists(select 1 from offers o where o.month=b.month and o.currency=b.currency and o.cost is null and o.slots>0) then null
   else coalesce((select round(sum(cost*slots)*p_pipeline_probability,2) from offers o where o.month=b.month and o.currency=b.currency),0) end,
  'pipeline_gross_known',case when can_gross then coalesce((select round(sum(gross*slots)*p_pipeline_probability,2) from offers o where o.month=b.month and o.currency=b.currency),0)+coalesce((select round(sum(gross)*p_pipeline_probability,2) from requests r where r.month=b.month and r.currency=b.currency),0) end,
  'lecturer_invoice_payments',coalesce((select sum(amount) from payment_entries p where p.month=b.month and p.currency=b.currency),0)) order by b.month,b.currency),'[]'::jsonb) into result from buckets b;
 return jsonb_build_object('from',p_from,'until',p_until,'time_zone',zone,'pipeline_probability',p_pipeline_probability,'gross_authorized',can_gross,
  'payment_basis','lecturer_invoice_payment_records','months',result);
end;$$;
COMMIT;
