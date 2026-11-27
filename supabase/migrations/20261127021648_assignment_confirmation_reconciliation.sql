begin;

-- Keep the existing RPC and signature. Project accepted commercial facts
-- and the current approved assignment revision, without returning raw terms
-- snapshots, confidential customer amounts or online access URLs as locations.
create or replace function private.assignment_confirmation(p_claim_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  claim public.job_claims;
  data jsonb;
  effective jsonb;
  show_fee boolean;
begin
  if not private.actor_active() then raise insufficient_privilege; end if;
  select * into claim from public.job_claims where id = p_claim_id;
  if not found or not (claim.lecturer_id = auth.uid() or private.has_permission('jobs.manage')) then
    raise exception 'Assignment confirmation unavailable' using errcode = '42501';
  end if;
  show_fee := claim.lecturer_id = auth.uid() or private.has_permission('finance.manage');
  effective := private.effective_assignment(claim.id);
  select jsonb_build_object(
    'type', 'assignment_confirmation', 'claim_id', claim.id, 'status', claim.status,
    'accepted_at', claim.created_at, 'confirmed_at', coalesce(amendment.created_at, claim.created_at),
    'assignment_version', coalesce(amendment.version, 0) + 1,
    'lecturer_name', profile.display_name, 'title', coalesce(effective->>'title', job.title),
    'customer_name', job.customer_name, 'time_zone', coalesce(effective->>'time_zone', job.time_zone),
    'delivery_type', coalesce(effective->>'delivery_type', job.delivery_type),
    'physical_location', case when coalesce(effective->>'delivery_type', job.delivery_type) in ('onsite','hybrid')
      then nullif(coalesce(effective->>'location', job.location), '') end,
    'instructions', nullif(coalesce(effective->>'scope', job.description), ''),
    'contract_version', contract.version, 'terms_version', claim.terms_version,
    'amount', case when show_fee then effective->'amount' end,
    'total_amount', case when show_fee then effective->'total_amount' end,
    'currency', case when show_fee then claim.currency end,
    'rate_unit', case when show_fee then effective->>'rate_unit' end,
    'terms', case when show_fee then effective->>'terms' end,
    'planned_minutes', schedule.minutes, 'sessions', schedule.entries,
    'paid_teaching_minutes', case when show_fee and amendment.id is null then snapshot.detail->'paid_teaching_minutes' end,
    'teaching_unit_minutes', case when show_fee and amendment.id is null then snapshot.detail->'configuration'->'unit_minutes' end,
    'additional_compensation', case when show_fee and amendment.id is null then (
      select coalesce(jsonb_agg(jsonb_build_object('label', item->>'label', 'kind', item->>'kind',
        'amount', item->>'lecturer_amount') order by position), '[]'::jsonb)
      from jsonb_array_elements(coalesce(snapshot.detail->'components','[]'::jsonb)) with ordinality list(item, position)
      where item->>'lecturer_amount' is not null and (item->>'lecturer_amount')::numeric > 0
    ) end
  ) into data
  from public.jobs job
  join public.profiles profile on profile.id = claim.lecturer_id
  left join public.contracts contract on contract.id = claim.contract_id
  left join lateral (
    select a.id, a.created_at, a.version from private.assignment_amendments a
    where a.claim_id = claim.id order by a.version desc limit 1
  ) amendment on true
  left join private.claim_revenue_ledger ledger on ledger.claim_id = claim.id
  -- Earlier installations and older accepted claims have no component snapshot.
  left join lateral (select to_jsonb(ledger)->'training_snapshot' as detail) snapshot on true
  cross join lateral (
    select coalesce(jsonb_agg(jsonb_build_object('starts_at', s.starts_at, 'ends_at', s.ends_at,
      'released_at', s.released_at) order by s.starts_at, s.id), '[]'::jsonb) as entries,
      coalesce(sum(extract(epoch from (s.ends_at-s.starts_at))/60) filter (where s.released_at is null), 0) as minutes
    from public.assignment_sessions s where s.claim_id = claim.id
  ) schedule
  where job.id = claim.job_id;
  return jsonb_build_object('data', data, 'hash', encode(sha256(convert_to(data::text,'UTF8')),'hex'));
end;
$$;

-- Reconcile one assignment with the installed time, invoice, payment and expense
-- authorities. Global invoices remain separate evidence; only whole, single-
-- assignment customer invoices can contribute an exact assignment cash figure.
create function private.assignment_finance_reconciliation(p_claim_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  can_gross boolean;
  result jsonb;
begin
  if not coalesce(private.expense_access(true), false) then raise insufficient_privilege; end if;
  can_gross := private.has_permission('finance.gross.read');
  select jsonb_build_object(
    'claim_id', c.id, 'currency', c.currency, 'claim_status', c.status,
    'agreed_lecturer', totals.current_lecturer::text,
    'adjustment_lecturer', (totals.current_lecturer-c.total_amount)::text,
    'agreed_customer', case when can_gross then totals.current_gross::text end,
    'contract_margin', case when can_gross then (totals.current_gross-totals.current_lecturer)::text end,
    'approved_timesheet_minutes', hours.approved_minutes, 'recorded_teaching_minutes', hours.recorded_minutes,
    'delivered_minutes', delivery.minutes,
    'lecturer_invoices', lecturer_invoice.items,
    'lecturer_invoiced', lecturer_invoice.assignment_amount::text,
    'lecturer_paid', case when lecturer_invoice.assignment_amount is not null then payment.amount::text end,
    'lecturer_outstanding', case when lecturer_invoice.assignment_amount is not null
      then greatest(lecturer_invoice.assignment_amount-payment.amount, 0)::text end,
    'cancellation_compensation', case when c.status = 'cancelled' then exception_payment.amount::text end,
    'customer_invoice_id', customer_invoice.id,
    'customer_invoice_number', customer_invoice.number,
    'customer_invoice_grouped', customer_invoice.grouped,
    'customer_invoiced', case when customer_invoice.grouped is false then customer_invoice.total_amount::text end,
    'customer_net_invoiced', customer_payment.net_total::text,
    'customer_received', customer_payment.received_total::text,
    'customer_retained', customer_payment.retained_total::text,
    'customer_outstanding', customer_payment.outstanding_total::text,
    'expenses', coalesce((
      select jsonb_agg(jsonb_build_object(
        'currency', by_currency.currency, 'approved', by_currency.approved::text,
        'paid', by_currency.paid::text, 'outstanding', (by_currency.approved-by_currency.paid)::text
      ) order by by_currency.currency)
      from (
        select e.currency, sum(e.approved_amount) approved,
          coalesce(sum(e.approved_amount) filter (where e.state = 'reimbursed'), 0) paid
        from private.lecturer_expenses e where e.claim_id = c.id and e.state in ('approved','reimbursed')
        group by e.currency
      ) by_currency
    ), '[]'::jsonb)
  ) into result
  from public.job_claims c
  left join private.claim_revenue_ledger accepted on can_gross and accepted.claim_id = c.id
  left join lateral (
    select financial.gross_total_amount from private.assignment_financial_amendments financial
    where can_gross and financial.claim_id = c.id order by financial.created_at desc, financial.amendment_id limit 1
  ) amended on true
  cross join lateral (
    select (private.effective_assignment(c.id)->>'total_amount')::numeric as current_lecturer,
      coalesce(amended.gross_total_amount, accepted.gross_total_amount) as current_gross
  ) totals
  cross join lateral (
    select (sum(floor(extract(epoch from (t.ends_at-t.starts_at))/60)-t.break_minutes)
        filter (where t.state = 'approved'))::integer as approved_minutes,
      sum(floor(extract(epoch from (t.ends_at-t.starts_at))/60)-t.break_minutes)::integer as recorded_minutes
    from private.teaching_timesheets t
    join public.assignment_sessions s on s.id = t.session_id
    where s.claim_id = c.id and t.state in ('submitted','approved')
  ) hours
  cross join lateral (
    select sum(coalesce(floor(extract(epoch from (d.actual_end-d.actual_start))/60), 0))::integer as minutes
    from public.assignment_sessions s
    join private.delivery_records record on record.session_id = s.id
    join private.delivery_submissions d on d.id = record.latest_submission_id
    where s.claim_id = c.id and record.status = 'confirmed'
  ) delivery
  cross join lateral (
    select coalesce(jsonb_agg(jsonb_build_object('id', invoice.id, 'number', invoice.number, 'state', invoice.status,
      'amount', invoice.amount::text) order by invoice.created_at desc, invoice.id), '[]'::jsonb) as items,
      sum(invoice.amount) as assignment_amount
    from (
      select i.id, i.number, i.status, i.created_at,
        case when i.exception_approval_id is not null or i.series_approval_id is not null then i.total_amount
          else coalesce((amendment.accepted->>'total_amount')::numeric, c.total_amount) end as amount
      from public.invoice_items item
      join public.invoices i on i.id = item.invoice_id
      left join private.assignment_amendments amendment on amendment.id = item.amendment_id
      where item.claim_id = c.id and item.active and i.status not in ('rejected','cancelled')
        and i.currency = c.currency
    ) invoice
  ) lecturer_invoice
  cross join lateral (
    select private.claim_paid_amount(c.id) as amount
  ) payment
  left join lateral (
    select approval.amount from private.invoice_exception_approvals approval
    where approval.claim_id = c.id and approval.revoked_at is null and approval.currency = c.currency
  ) exception_payment on true
  left join lateral (
    select i.id, i.number, i.total_amount,
      exists (select 1 from private.accounting_customer_items grouped where grouped.invoice_id = i.id and grouped.claim_id <> c.id) as grouped
    from private.accounting_customer_items item
    join private.accounting_customer_invoices i on i.id = item.invoice_id
    where can_gross and item.claim_id = c.id and i.currency = c.currency
  ) customer_invoice on true
  left join lateral (
    select settled.net_total, settled.received_total, settled.retained_total, settled.outstanding_total
    from private.calculate_customer_settlement(customer_invoice.id) settled
    where customer_invoice.grouped is false
  ) customer_payment on true
  where c.id = p_claim_id;
  if result is null then raise insufficient_privilege; end if;
  return result;
end;
$$;

create function public.assignment_finance_reconciliation(p_claim_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.assignment_finance_reconciliation(p_claim_id);
$$;
revoke all on function private.assignment_finance_reconciliation(uuid),
  public.assignment_finance_reconciliation(uuid) from public, anon, authenticated, service_role;
grant execute on function private.assignment_finance_reconciliation(uuid),
  public.assignment_finance_reconciliation(uuid) to authenticated;
commit;
