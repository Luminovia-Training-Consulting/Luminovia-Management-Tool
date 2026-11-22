begin;

create index accounting_credit_application_report_date
  on private.accounting_customer_credit_applications(created_at);
create index accounting_customer_refund_report_date
  on private.accounting_customer_refunds(refunded_at) where reverses_id is null;
create index accounting_customer_refund_reversal_report_date
  on private.accounting_customer_refunds(created_at) where reverses_id is not null;
create index invoice_series_repayment_report_date
  on private.invoice_series_repayments(received_on);
create index invoice_series_repayment_void_report_date
  on private.invoice_series_repayments(voided_at) where voided_at is not null;

-- Read a consistent projection of the source journals. Corrections post on
-- their own date, including when the original entry predates the report.
create function private.accounting_settlement_journal(p_from date, p_to date)
returns jsonb language plpgsql stable security definer
set search_path = ''
set timezone = 'UTC'
as $$
declare
  customer_finance boolean := private.can_manage_customer_credit_notes();
  lecturer_finance boolean := private.has_permission('finance.manage');
  lower_bound timestamptz;
  upper_bound timestamptz;
  result jsonb;
begin
  if not private.actor_active()
    or not exists (select 1 from private.installation_identity where edition = 'internal')
    or not (customer_finance or lecturer_finance) then
    raise exception 'Current finance reporting permission required' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to)
    or p_from < date '0001-01-01' or p_to > date '9999-12-31' or p_from > p_to then
    raise exception 'A valid inclusive reporting period is required' using errcode = '22023';
  end if;
  if p_to - p_from >= 366 then
    raise exception 'Reporting period exceeds 366 days' using errcode = '22023';
  end if;

  lower_bound := p_from::timestamp at time zone 'UTC';
  upper_bound := (p_to + 1)::timestamp at time zone 'UTC';

  with ledger(kind, id, reverses_id, subject_id, effective_on, recorded_at, currency, amount, reference) as (
    select 'customer_credit'::text, entry.id, entry.reverses_id, entry.invoice_id,
      entry.created_at::date, entry.created_at, note.currency, note.amount, note.reference
    from private.accounting_customer_credit_applications entry
    join private.accounting_customer_credit_notes note on note.id = entry.credit_note_id
    where customer_finance and entry.created_at >= lower_bound and entry.created_at < upper_bound

    union all
    select 'customer_refund', entry.id, null, entry.invoice_id,
      entry.refunded_at::date, entry.created_at, invoice.currency, entry.amount, entry.reference
    from private.accounting_customer_refunds entry
    join private.accounting_customer_invoices invoice on invoice.id = entry.invoice_id
    where customer_finance and entry.reverses_id is null
      and entry.refunded_at >= lower_bound and entry.refunded_at < upper_bound

    union all
    select 'customer_refund', entry.id, entry.reverses_id, entry.invoice_id,
      entry.created_at::date, entry.created_at, invoice.currency, entry.amount, original.reference
    from private.accounting_customer_refunds entry
    join private.accounting_customer_refunds original on original.id = entry.reverses_id
    join private.accounting_customer_invoices invoice on invoice.id = entry.invoice_id
    where customer_finance and entry.reverses_id is not null
      and entry.created_at >= lower_bound and entry.created_at < upper_bound

    union all
    select 'lecturer_repayment', entry.id, null, entry.correction_id,
      entry.received_on, entry.recorded_at, correction.currency, entry.amount, entry.reference
    from private.invoice_series_repayments entry
    join private.invoice_series_corrections correction on correction.id = entry.correction_id
    where lecturer_finance and entry.received_on between p_from and p_to

    union all
    select 'lecturer_repayment', entry.id, entry.id, entry.correction_id,
      entry.voided_at::date, entry.voided_at, correction.currency, entry.amount, entry.reference
    from private.invoice_series_repayments entry
    join private.invoice_series_corrections correction on correction.id = entry.correction_id
    where lecturer_finance and entry.voided_at >= lower_bound and entry.voided_at < upper_bound

    -- Reject oversized results rather than serving an incomplete journal.
    limit 5001
  ), grouped as (
    select kind, currency,
      coalesce(sum(amount) filter (where reverses_id is null), 0) as recorded,
      coalesce(sum(amount) filter (where reverses_id is not null), 0) as reversed
    from ledger
    group by kind, currency
  )
  select case when (select count(*) from ledger) <= 5000 then jsonb_build_object(
    'schema_version', 'luminovia.settlement-journal/1',
    'from', p_from, 'to', p_to, 'generated_at', statement_timestamp(),
    'scopes', to_jsonb(array_remove(array[
      case when customer_finance then 'customer' end,
      case when lecturer_finance then 'lecturer' end
    ], null)),
    'items', coalesce((
      select jsonb_agg(
        to_jsonb(ledger) || jsonb_build_object('amount', amount::text)
        order by effective_on desc, recorded_at desc, kind, id, reverses_id nulls first
      ) from ledger
    ), '[]'::jsonb),
    'totals', coalesce((
      select jsonb_agg(jsonb_build_object(
        'kind', kind, 'currency', currency, 'recorded', recorded::numeric(16,2)::text,
        'reversed', reversed::numeric(16,2)::text, 'net', (recorded-reversed)::numeric(16,2)::text
      ) order by currency, kind)
      from grouped
    ), '[]'::jsonb)
  ) end into result;
  if result is null then
    raise exception 'More than 5000 entries in period. Select a shorter period' using errcode = 'PT413';
  end if;
  return result;
end;
$$;

create function public.accounting_settlement_journal(p_from date, p_to date)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.accounting_settlement_journal(p_from, p_to); $$;

revoke all on function private.accounting_settlement_journal(date, date),
  public.accounting_settlement_journal(date, date) from public, anon, authenticated, service_role;
grant execute on function private.accounting_settlement_journal(date, date),
  public.accounting_settlement_journal(date, date) to authenticated;

commit;
