begin;

-- Preserve original-currency rows, defaults, and amount constraints while
-- widening the existing accepted codes for commercial records.
do $migration$
declare
  target record;
begin
  for target in select * from (values
    ('public.jobs', 'jobs_currency_check'),
    ('public.invoices', 'invoices_currency_check'),
    ('public.payment_records', 'payment_records_currency_check'),
    ('private.job_commission_offers', 'job_commission_offers_currency_check'),
    ('private.claim_revenue_ledger', 'claim_revenue_ledger_currency_check'),
    ('private.lecturer_compensation', 'lecturer_compensation_currency_check'),
    ('private.accounting_customer_invoices', 'accounting_customer_invoices_currency_check'),
    ('private.assignment_financial_amendments', 'assignment_financial_amendments_currency_check'),
    ('private.invoice_exception_approvals', 'invoice_exception_approvals_currency_check'),
    ('private.invoice_series_approvals', 'invoice_series_approvals_currency_check'),
    ('private.accounting_customer_credit_notes', 'accounting_customer_credit_notes_currency_check'),
    ('private.invoice_series_corrections', 'invoice_series_corrections_currency_check')
  ) as checks(relation, constraint_name)
  loop
    execute format(
      'alter table %s drop constraint %I, add constraint %I check (currency in (%L, %L, %L, %L))',
      target.relation::regclass, target.constraint_name, target.constraint_name,
      'EUR', 'AUD', 'USD', 'CHF'
    );
  end loop;
end;
$migration$;

-- Extend only the reviewed currency lists in the current RPC implementations.
-- This preserves access checks, privileges, fee math, and existing signatures.
do $migration$
declare
  target record;
  definition text;
begin
  for target in select * from (values
    ('private.create_course_run_job(uuid,jsonb,numeric,uuid)',
      $old$p_payload->>'currency' not in('EUR','AUD','USD')$old$,
      $new$p_payload->>'currency' not in('EUR','AUD','USD','CHF')$new$),
    ('private.job_discovery_filters_before_text_sort(jsonb)',
      $old$f->>'currency' not in('','EUR','AUD','USD')$old$,
      $new$f->>'currency' not in('','EUR','AUD','USD','CHF')$new$),
    ('private.save_lecturer_compensation(uuid,text,numeric,numeric,text,integer)',
      $old$p_currency not in ('EUR','AUD','USD')$old$,
      $new$p_currency not in ('EUR','AUD','USD','CHF')$new$),
    ('private.register_customer_invoice(jsonb,uuid)',
      $old$v_currency not in('EUR','AUD','USD')$old$,
      $new$v_currency not in('EUR','AUD','USD','CHF')$new$),
    ('private.register_customer_credit_note(uuid,jsonb,uuid)',
      $old$note_currency not in ('EUR','AUD','USD')$old$,
      $new$note_currency not in ('EUR','AUD','USD','CHF')$new$),
    ('private.analytics_report(text,date,date,uuid)',
      $old$cross join (values ('EUR'),('AUD'),('USD')) currency(code)$old$,
      $new$cross join (values ('EUR'),('AUD'),('USD'),('CHF')) currency(code)$new$),
    ('private.create_client_request_record(uuid,jsonb,uuid)',
      $old$p_payload->>'currency' not in ('EUR','AUD','USD')$old$,
      $new$p_payload->>'currency' not in ('EUR','AUD','USD','CHF')$new$)
  ) as functions(signature, before, after)
  loop
    definition := pg_get_functiondef(target.signature::regprocedure);
    if cardinality(string_to_array(definition, target.before)) <> 2 then
      raise exception 'Expected one currency list in %', target.signature;
    end if;
    execute replace(definition, target.before, target.after);
  end loop;
end;
$migration$;

commit;
