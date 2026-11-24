begin;

-- Existing commercial records keep their original classification and terms.
alter table public.jobs add column company_internal boolean not null default false;
alter table public.jobs add constraint company_internal_job_terms
  check (not company_internal or (course_run_id is not null
    and amount = 0 and total_amount = 0 and not requires_contract));

create function private.guard_company_internal_job() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and old.company_internal is distinct from new.company_internal then
    raise exception 'Cannot change internal staffing mode' using errcode = '22023';
  end if;
  if new.company_internal and not exists (
    select 1 from public.course_runs run where run.id = new.course_run_id
      and run.own_lecturers_only
  ) then
    raise exception 'Internal staffing requires a company-only course' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger company_internal_job_guard before insert or update of company_internal, course_run_id
on public.jobs for each row execute function private.guard_company_internal_job();

create function private.guard_company_internal_billing() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (
    select 1 from public.jobs job
    where job.company_internal and job.id = case
      when tg_table_name = 'job_commission_offers' then (to_jsonb(new)->>'job_id')::uuid
      else (select claim.job_id from public.job_claims claim where claim.id = (to_jsonb(new)->>'claim_id')::uuid)
    end
  ) then
    raise exception 'Internal company assignments are not billed in the portal' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger company_internal_billing_guard before insert or update of job_id
on private.job_commission_offers for each row execute function private.guard_company_internal_billing();
create trigger company_internal_billing_guard before insert or update of claim_id
on public.invoice_items for each row execute function private.guard_company_internal_billing();
create trigger company_internal_billing_guard before insert or update of claim_id
on private.invoice_review_requests for each row execute function private.guard_company_internal_billing();
create trigger company_internal_billing_guard before insert or update of claim_id
on private.invoice_series_approvals for each row execute function private.guard_company_internal_billing();
create trigger company_internal_billing_guard before insert or update of claim_id
on private.invoice_exception_approvals for each row execute function private.guard_company_internal_billing();
revoke all on function private.guard_company_internal_job(), private.guard_company_internal_billing()
from public, anon, authenticated, service_role;

-- Reuse request validation, locks, lifecycle transitions and receipt checks.
-- Use an explicit marker for new requests so paid historical requests remain
-- retryable and retain their originally recorded commercial terms.
do $staffing$
declare rule record; definition text;
begin
  for rule in select * from (values
    ('private.create_client_request_record(uuid,jsonb,uuid)',
      $old$gross=(p_payload->>'gross_amount')::numeric;total=(p_payload->>'gross_total_amount')::numeric;
 if gross is null$old$,
      $new$if p_payload->'own_lecturers_only' = 'true'::jsonb and not exists (
   select 1 from private.client_course_requests previous
   where previous.requested_by=auth.uid() and previous.client_id=p_client_id
     and previous.payload ? 'own_lecturers_only' and (previous.payload->>'gross_total_amount')::numeric > 0
 ) then
   p_payload := p_payload || '{"gross_amount":0,"gross_total_amount":0,"currency":"EUR","rate_unit":"fixed_total"}'::jsonb;
 end if;
 gross=(p_payload->>'gross_amount')::numeric;total=(p_payload->>'gross_total_amount')::numeric;
 if gross is null$new$),
    ('private.create_client_request_record(uuid,jsonb,uuid)',
      $old$gross not between 0.01 and 9999999999.99 or total not between 0.01 and 9999999999.99$old$,
      $new$gross not between (case when p_payload->'own_lecturers_only' = 'true'::jsonb then 0 else 0.01 end) and 9999999999.99
 or total not between (case when p_payload->'own_lecturers_only' = 'true'::jsonb then 0 else 0.01 end) and 9999999999.99$new$),
    ('private.publish_client_request(uuid,numeric,text,boolean,timestamptz)',
      $old$s jsonb;$old$, $new$s jsonb; company_internal boolean;$new$),
    ('private.publish_client_request(uuid,numeric,text,boolean,timestamptz)',
      $old$ if p_terms is null$old$,
      $new$ company_internal := r.payload ? 'own_lecturers_only' and (r.payload->>'gross_total_amount')::numeric = 0;
 if company_internal then
  p_platform_percent := null;
  p_requires_contract := false;
 end if;
 if p_terms is null$new$),
    ('private.publish_client_request(uuid,numeric,text,boolean,timestamptz)',
      $old$or not exists(select 1 from private.job_commission_offers o where o.job_id=j.id and o.pricing_mode='role_split')$old$,
      $new$or (not company_internal and not exists(select 1 from private.job_commission_offers o where o.job_id=j.id and o.pricing_mode='role_split'))$new$),
    ('private.publish_client_request(uuid,numeric,text,boolean,timestamptz)',
      $old$requires_contract,claim_deadline,created_by)$old$,
      $new$requires_contract,claim_deadline,created_by,company_internal)$new$),
    ('private.publish_client_request(uuid,numeric,text,boolean,timestamptz)',
      $old$p_terms,p_requires_contract,p_claim_deadline,auth.uid())$old$,
      $new$p_terms,p_requires_contract,p_claim_deadline,auth.uid(),company_internal)$new$),
    ('private.publish_client_request(uuid,numeric,text,boolean,timestamptz)',
      $old$ perform private.set_job_commission(job,(r.payload->>'gross_amount')::numeric,(r.payload->>'gross_total_amount')::numeric,p_platform_percent);$old$,
      $new$ if not company_internal then
  perform private.set_job_commission(job,(r.payload->>'gross_amount')::numeric,(r.payload->>'gross_total_amount')::numeric,p_platform_percent);
 end if;$new$),
    ('private.client_requests(uuid)',
      $old$coalesce(fee.gross_amount,(r.payload->>'gross_amount')::numeric),coalesce(fee.gross_total_amount,(r.payload->>'gross_total_amount')::numeric)*coalesce(j.capacity,1)$old$,
      $new$case when not (r.payload ? 'own_lecturers_only' and (r.payload->>'gross_total_amount')::numeric = 0) then coalesce(fee.gross_amount,(r.payload->>'gross_amount')::numeric) end,case when not (r.payload ? 'own_lecturers_only' and (r.payload->>'gross_total_amount')::numeric = 0) then coalesce(fee.gross_total_amount,(r.payload->>'gross_total_amount')::numeric)*coalesce(j.capacity,1) end$new$),
    ('private.manual_assignment_candidates(uuid,text)',
      $old$case when private.has_permission('finance.gross.read') then x.quote end$old$,
      $new$case when not j.company_internal and private.has_permission('finance.gross.read') then x.quote end$new$),
    ('private.manage_job_offer(uuid,text,integer,uuid,jsonb)',
      $old$run=private.duplicate_course_run(j.course_run_id);$old$,
      $new$run=private.duplicate_course_run(j.course_run_id);
  if j.company_internal then
   update public.course_runs set own_lecturers_only=true where id=run;
  end if;$new$),
    ('private.manage_job_offer(uuid,text,integer,uuid,jsonb)',
      $old$created_by,capacity,capacity_basis)$old$,
      $new$created_by,capacity,capacity_basis,company_internal)$new$),
    ('private.manage_job_offer(uuid,text,integer,uuid,jsonb)',
      $old$auth.uid(),j.capacity,j.capacity_basis) returning id into result$old$,
      $new$auth.uid(),j.capacity,j.capacity_basis,j.company_internal) returning id into result$new$),
    ('private.report_assignment_sick_day(uuid,uuid,uuid)',
      $old$requires_contract, created_by, urgent_reopened_at$old$,
      $new$requires_contract, created_by, urgent_reopened_at, company_internal$new$),
    ('private.report_assignment_sick_day(uuid,uuid,uuid)',
      $old$source.terms, original.requires_contract, null, changed_at$old$,
      $new$source.terms, original.requires_contract, null, changed_at, original.company_internal$new$),
    ('private.client_spend_summary()',
      $old$accepted on true where r.status<>'cancelled'$old$,
      $new$accepted on true where r.status<>'cancelled'
    and not (r.payload ? 'own_lecturers_only' and (r.payload->>'gross_total_amount')::numeric = 0)$new$),
    ('private.finance_statement(date,date,boolean)',
      $old$where (p_all or c.lecturer_id=auth.uid()) and sessions.starts_at$old$,
      $new$where not j.company_internal and (p_all or c.lecturer_id=auth.uid()) and sessions.starts_at$new$),
    ('private.job_discovery_item(uuid)',
      $old$'amount',quote.amount,'total_amount',quote.total_amount$old$,
      $new$'company_internal',j.company_internal,'amount',quote.amount,'total_amount',quote.total_amount$new$),
    ('private.job_discovery_quote(uuid)',
      $old$case when o.pricing_mode='role_split' then$old$,
      $new$case when j.company_internal then null when o.pricing_mode='role_split' then$new$),
    ('private.validate_commissioned_amendment(uuid,jsonb,jsonb)',
      $old$ select * into ledger$old$,
      $new$ if private.assignment_change_price_changed(p_original,p_proposed) and exists (
   select 1 from public.job_claims claim join public.jobs job on job.id=claim.job_id
   where claim.id=p_claim and job.company_internal
 ) then raise exception 'Internal company assignments cannot have compensation' using errcode='22023'; end if;
 select * into ledger$new$),
    ('private.my_invoice_review_candidates()',
      $old$where c.lecturer_id = auth.uid() and c.status$old$,
      $new$where not j.company_internal and c.lecturer_id = auth.uid() and c.status$new$),
    ('private.finance_earnings_before_invoice_eligibility(boolean)',
      $old$where c.status='confirmed' and$old$,
      $new$where not j.company_internal and c.status='confirmed' and$new$),
    ('private.finance_earnings(boolean)',
      $old$where claim.status = 'cancelled' and$old$,
      $new$where not job.company_internal and claim.status = 'cancelled' and$new$),
    ('private.commission_report(uuid)',
      $old$effective on b.claim_id is not null;$old$,
      $new$effective on b.claim_id is not null
 where not exists (select 1 from public.jobs job where job.id=b.job_id and job.company_internal);$new$)
  ) as changes(signature, before, after)
  loop
    definition := pg_get_functiondef(rule.signature::regprocedure);
    if cardinality(string_to_array(definition, rule.before)) <>
      (case when rule.signature = 'private.job_discovery_quote(uuid)' then 3 else 2 end) then
      raise exception 'Unexpected internal staffing migration source: %', rule.signature;
    end if;
    execute replace(definition, rule.before, rule.after);
  end loop;
end;
$staffing$;

commit;
