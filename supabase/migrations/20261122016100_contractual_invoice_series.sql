begin;

create table private.invoice_series_approvals (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.job_claims(id),
  contract_id uuid not null references public.contracts(id),
  contract_version integer not null check (contract_version > 0),
  kind text not null check (kind in ('interim', 'final')),
  currency text not null check (currency in ('EUR', 'AUD')),
  gross_amount numeric(12,2) not null check (gross_amount > 0),
  credit_amount numeric(12,2) not null check (credit_amount >= 0 and credit_amount <= gross_amount),
  credited_payment_ids uuid[] not null default '{}',
  due_on date not null check (isfinite(due_on)),
  basis jsonb not null,
  note text not null check (length(note) between 10 and 1000),
  approved_by uuid not null references public.profiles(id),
  approved_at timestamptz not null default clock_timestamp(),
  client_id uuid not null,
  revoked_at timestamptz,
  revoked_by uuid references public.profiles(id),
  revocation_note text check (length(revocation_note) between 10 and 1000),
  unique (approved_by, client_id),
  check (kind = 'final' or (credit_amount = 0 and cardinality(credited_payment_ids) = 0)),
  check (
    (revoked_at is null and revoked_by is null and revocation_note is null) or
    (revoked_at is not null and revoked_by is not null and revocation_note is not null)
  )
);
alter table private.invoice_series_approvals enable row level security;
revoke all on private.invoice_series_approvals from public, anon, authenticated, service_role;
create index invoice_series_approvals_claim on private.invoice_series_approvals(claim_id, approved_at desc);

alter table public.invoices
  add column series_approval_id uuid references private.invoice_series_approvals(id);
create index invoices_series_approval on public.invoices(series_approval_id) where series_approval_id is not null;
alter table public.invoices drop constraint invoices_total_amount_check;
alter table public.invoices drop constraint invoice_due_on_or_reviewed_exception;
alter table public.invoices add constraint invoice_payable_or_reviewed_balance
  check (total_amount > 0 or (series_approval_id is not null and total_amount = 0));
alter table public.invoices add constraint invoice_due_on_or_reviewed_exception
  check (exception_approval_id is not null or series_approval_id is not null or due_on >= issued_on);
alter table public.invoices add constraint invoice_one_review_system
  check (exception_approval_id is null or series_approval_id is null);

alter table public.invoice_items add column interim boolean not null default false;
drop index public.one_active_invoice_per_claim;
create unique index one_active_invoice_per_claim on public.invoice_items(claim_id) where active and not interim;
create index active_interim_invoice_claim on public.invoice_items(claim_id, invoice_id) where active and interim;

create table private.invoice_series_credits (
  invoice_id uuid not null references public.invoices(id),
  payment_id uuid not null references public.payment_records(id),
  primary key (invoice_id, payment_id)
);
alter table private.invoice_series_credits enable row level security;
revoke all on private.invoice_series_credits from public, anon, authenticated, service_role;
create index invoice_series_credited_payment on private.invoice_series_credits(payment_id, invoice_id);

create function private.invoice_series_reserved(p_claim_id uuid)
returns boolean language sql stable set search_path = ''
as $$
  select exists (
    select 1 from private.invoice_series_approvals a where a.claim_id = p_claim_id and a.revoked_at is null
  );
$$;

create function private.invoice_series_paid(p_claim_id uuid)
returns table(id uuid, amount numeric, invoice_id uuid, invoice_number text, paid_at timestamptz)
language sql stable set search_path = ''
as $$
  select p.id, p.amount, p.invoice_id, i.number, p.paid_at
  from public.invoice_items item
  join public.invoices i on i.id = item.invoice_id
  join public.payment_records p on p.invoice_id = i.id and p.voided_at is null
  where item.claim_id = p_claim_id and item.active and item.interim;
$$;

-- Use the exact reviewed settlement basis again at upload. Finance chooses
-- the actual agreement-specific amount and deadline after checking receipts.
create function private.invoice_series_gate(p_claim_id uuid, p_kind text)
returns boolean language sql stable set search_path = ''
as $$
  select exists (
    select 1 from public.job_claims c where c.id = p_claim_id
      and not exists (select 1 from public.invoice_items item where item.claim_id = c.id and item.active and not item.interim)
      and not exists (
        select 1 from public.invoice_items item join public.invoices i on i.id = item.invoice_id
        where item.claim_id = c.id and item.active and item.interim and i.status <> 'paid'
      )
      and not exists (
        select 1 from private.invoice_exception_approvals e where e.claim_id = c.id and e.revoked_at is null
      )
      and (
        (p_kind = 'interim' and c.status = 'confirmed'
          and exists (
            select 1 from public.assignment_sessions s where s.claim_id = c.id and s.released_at is null
              and s.ends_at <= statement_timestamp() and private.assignment_session_counts_for_invoice(s.id)
          )
          and exists (
            select 1 from public.assignment_sessions s where s.claim_id = c.id and s.released_at is null
              and s.ends_at > statement_timestamp() and private.assignment_session_counts_for_invoice(s.id)
          )
        )
        or
        (p_kind = 'final' and c.status in ('confirmed', 'cancelled')
          and exists (select 1 from private.invoice_series_paid(c.id))
          and not exists (
            select 1 from public.assignment_sessions s where s.claim_id = c.id and s.released_at is null
              and s.ends_at > statement_timestamp() and private.assignment_session_counts_for_invoice(s.id)
          )
        )
      )
  );
$$;

create function private.invoice_series_reserved_entry(p_claim_id uuid)
returns boolean language sql stable set search_path = ''
as $$
  select exists (
    select 1 from private.invoice_series_approvals a
    where a.claim_id = p_claim_id and a.revoked_at is null
      and not exists (
        select 1 from public.invoices i join public.invoice_items item on item.invoice_id = i.id and item.active
        where i.series_approval_id = a.id and i.status = 'paid'
      )
  );
$$;

create function private.invoice_series_usable(p_id uuid)
returns boolean language sql stable set search_path = ''
as $$
  select exists (
    select 1 from private.invoice_series_approvals a
    where a.id = p_id and a.revoked_at is null
      and a.basis = private.invoice_exception_basis(a.claim_id)
      and private.invoice_series_gate(a.claim_id, a.kind)
      and not exists (
        select 1 from public.invoices i join public.invoice_items item on item.invoice_id = i.id and item.active
        where i.series_approval_id = a.id
      )
      and case when a.kind = 'final' then
        a.credited_payment_ids = array(select p.id from private.invoice_series_paid(a.claim_id) p order by p.id)
      else a.gross_amount + (
        select coalesce(sum(p.amount), 0) from private.invoice_series_paid(a.claim_id) p
      ) <= (a.basis->>'maximum_amount')::numeric end
  );
$$;

create function private.invoice_series_record(p_id uuid)
returns jsonb language sql stable set search_path = ''
as $$
  select jsonb_build_object(
    'id', a.id, 'claim_id', a.claim_id, 'title', j.title, 'currency', a.currency,
    'kind', a.kind, 'contract_version', a.contract_version, 'gross_amount', a.gross_amount,
    'credit_amount', a.credit_amount, 'amount', a.gross_amount - a.credit_amount,
    'due_on', a.due_on, 'approved_at', a.approved_at, 'note', a.note,
    'state', case
      when a.revoked_at is not null then 'revoked'
      when invoice.id is not null then invoice.status
      when private.invoice_series_usable(a.id) then 'ready'
      else 'stale' end,
    'invoice_id', invoice.id, 'invoice_number', invoice.number,
    'credits', coalesce((
      select jsonb_agg(jsonb_build_object(
        'payment_id', p.id, 'invoice_id', credited.id, 'invoice_number', credited.number,
        'amount', p.amount, 'paid_at', p.paid_at
      ) order by p.paid_at, p.id)
      from public.payment_records p join public.invoices credited on credited.id = p.invoice_id
      where p.id = any(a.credited_payment_ids)
    ), '[]'::jsonb)
  )
  from private.invoice_series_approvals a
  join public.job_claims c on c.id = a.claim_id
  join public.jobs j on j.id = c.job_id
  left join lateral (
    select i.id, i.number, i.status
    from public.invoices i join public.invoice_items item on item.invoice_id = i.id and item.active
    where i.series_approval_id = a.id
    limit 1
  ) invoice on true
  where a.id = p_id;
$$;

create function private.invoice_series_options(p_claim_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  claim public.job_claims%rowtype;
  ceiling numeric;
  credited numeric;
  pending boolean;
  agreements jsonb;
begin
  if not private.has_permission('finance.manage') or
     not exists (select 1 from private.installation_identity where edition = 'internal') then
    raise insufficient_privilege;
  end if;
  select * into claim from public.job_claims where id = p_claim_id;
  if not found then raise exception 'Assignment unavailable' using errcode = '22023'; end if;
  ceiling := (private.effective_assignment(claim.id)->>'total_amount')::numeric;
  select coalesce(sum(p.amount), 0) into credited from private.invoice_series_paid(claim.id) p;
  pending := private.invoice_series_reserved_entry(claim.id);
  select coalesce(jsonb_agg(to_jsonb(contract) order by contract.version desc, contract.id), '[]'::jsonb)
    into agreements from private.invoice_exception_contracts(claim.id) contract;
  return jsonb_build_object(
    'claim_id', claim.id, 'currency', claim.currency, 'ceiling', ceiling, 'credited', credited,
    'contracts', agreements,
    'can_interim', not pending and ceiling > credited and private.invoice_series_gate(claim.id, 'interim'),
    'can_final', not pending and ceiling >= credited and private.invoice_series_gate(claim.id, 'final'),
    'approvals', coalesce((
      select jsonb_agg(private.invoice_series_record(a.id) order by a.approved_at desc, a.id)
      from private.invoice_series_approvals a where a.claim_id = claim.id
    ), '[]'::jsonb)
  );
end;
$$;

create function private.approve_invoice_series_entry(
  p_claim_id uuid, p_contract_id uuid, p_kind text, p_amount numeric, p_due_on date, p_note text, p_client_id uuid
)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  claim public.job_claims%rowtype;
  existing private.invoice_series_approvals%rowtype;
  reviewed_basis jsonb;
  contract_version integer;
  paid_amount numeric;
  payment_ids uuid[];
  result uuid;
begin
  if not private.has_permission('finance.manage') or
     not exists (select 1 from private.installation_identity where edition = 'internal') then
    raise insufficient_privilege;
  end if;
  if p_claim_id is null or p_contract_id is null or p_kind is null or p_kind not in ('interim', 'final') or
     p_amount is null or p_amount <= 0 or p_amount > 9999999999.99 or p_amount <> round(p_amount, 2) or
     p_due_on is null or not isfinite(p_due_on) or p_note is null or
     length(btrim(p_note)) not between 10 and 1000 or p_client_id is null then
    raise exception 'Invalid invoice series decision' using errcode = '22023';
  end if;
  select * into claim from public.job_claims where id = p_claim_id;
  if not found then raise exception 'Assignment unavailable' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('invoice-series-review:' || auth.uid()::text, 0));
  perform pg_advisory_xact_lock(hashtextextended(claim.lecturer_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('invoice:' || claim.lecturer_id::text, 0));
  perform 1 from public.job_claims where id = claim.id for update;
  select * into existing from private.invoice_series_approvals where approved_by = auth.uid() and client_id = p_client_id;
  if found then
    if (existing.claim_id, existing.contract_id, existing.kind, existing.gross_amount, existing.due_on, existing.note)
       is distinct from (p_claim_id, p_contract_id, p_kind, p_amount, p_due_on, btrim(p_note)) then
      raise exception 'Invoice series decision idempotency conflict' using errcode = '22023';
    end if;
    return existing.id;
  end if;
  if private.invoice_series_reserved_entry(claim.id) or not private.invoice_series_gate(claim.id, p_kind) then
    raise exception 'Invoice series entry unavailable' using errcode = 'PT409';
  end if;
  select agreement.version into contract_version
  from private.invoice_exception_contracts(claim.id) agreement where agreement.id = p_contract_id;
  if not found then raise exception 'Contract version unavailable' using errcode = '22023'; end if;
  reviewed_basis := private.invoice_exception_basis(claim.id);
  select coalesce(sum(p.amount), 0), coalesce(array_agg(p.id order by p.id), '{}')
    into paid_amount, payment_ids from private.invoice_series_paid(claim.id) p;
  if (case when p_kind = 'interim' then paid_amount + p_amount else p_amount end) >
     (reviewed_basis->>'maximum_amount')::numeric or (p_kind = 'final' and p_amount < paid_amount) then
    raise exception 'Reviewed amount is outside the accepted balance' using errcode = '22023';
  end if;
  insert into private.invoice_series_approvals (
    claim_id, contract_id, contract_version, kind, currency, gross_amount, credit_amount,
    credited_payment_ids, due_on, basis, note, approved_by, client_id
  ) values (
    claim.id, p_contract_id, contract_version, p_kind, claim.currency, p_amount,
    case when p_kind = 'final' then paid_amount else 0 end,
    case when p_kind = 'final' then payment_ids else '{}' end,
    p_due_on, reviewed_basis, btrim(p_note), auth.uid(), p_client_id
  ) returning id into result;
  insert into public.audit_events(actor_id, action, resource_id, details)
  values (auth.uid(), 'invoice.series_approved', result, jsonb_build_object(
    'claim_id', claim.id, 'kind', p_kind, 'contract_version', contract_version, 'gross_amount', p_amount,
    'currency', claim.currency, 'due_on', p_due_on
  ));
  return result;
end;
$$;

create function private.revoke_invoice_series_entry(p_approval_id uuid, p_note text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  approval private.invoice_series_approvals%rowtype;
  lecturer uuid;
begin
  if not private.has_permission('finance.manage') or
     not exists (select 1 from private.installation_identity where edition = 'internal') then
    raise insufficient_privilege;
  end if;
  if p_approval_id is null or p_note is null or length(btrim(p_note)) not between 10 and 1000 then
    raise exception 'Revocation reason is required' using errcode = '22023';
  end if;
  select * into approval from private.invoice_series_approvals where id = p_approval_id;
  if not found then raise exception 'Invoice series entry unavailable' using errcode = '22023'; end if;
  select lecturer_id into strict lecturer from public.job_claims where id = approval.claim_id;
  perform pg_advisory_xact_lock(hashtextextended(lecturer::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('invoice:' || lecturer::text, 0));
  select * into strict approval from private.invoice_series_approvals where id = p_approval_id for update;
  if approval.revoked_at is not null then
    if approval.revoked_by = auth.uid() and approval.revocation_note = btrim(p_note) then return; end if;
    raise exception 'Invoice series entry was already revoked' using errcode = 'PT409';
  end if;
  if exists (
    select 1 from public.invoices i join public.invoice_items item on item.invoice_id = i.id and item.active
    where i.series_approval_id = approval.id
  ) then
    raise exception 'The series entry has an active invoice' using errcode = 'PT409';
  end if;
  update private.invoice_series_approvals set revoked_at = clock_timestamp(), revoked_by = auth.uid(), revocation_note = btrim(p_note)
  where id = approval.id;
  insert into public.audit_events(actor_id, action, resource_id, details)
  values (auth.uid(), 'invoice.series_revoked', approval.id, jsonb_build_object('claim_id', approval.claim_id));
end;
$$;

create function private.invoice_series_records(p_all boolean)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  if p_all is null then raise exception 'Explicit scope is required' using errcode = '22023'; end if;
  if not exists (select 1 from private.installation_identity where edition = 'internal')
     or (p_all and not private.has_permission('finance.manage'))
     or (not p_all and not private.lecturer_actor()) then
    raise insufficient_privilege;
  end if;
  return coalesce((
    select jsonb_agg(private.invoice_series_record(entry.id) order by entry.approved_at desc, entry.id)
    from (
      select a.id, a.approved_at from private.invoice_series_approvals a
      join public.job_claims c on c.id = a.claim_id
      where a.revoked_at is null and (p_all or c.lecturer_id = auth.uid())
    ) entry
  ), '[]'::jsonb);
end;
$$;

create function private.submit_invoice_series_entry(
  p_approval_id uuid, p_number text, p_document_version_id uuid, p_issued_on date, p_client_id uuid
)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  previous public.invoices%rowtype;
  approval private.invoice_series_approvals%rowtype;
  result uuid;
begin
  if not private.lecturer_actor() or
     not exists (select 1 from private.installation_identity where edition = 'internal') then
    raise insufficient_privilege;
  end if;
  if p_approval_id is null or p_number is null or length(btrim(p_number)) not between 1 and 80 or
     p_document_version_id is null or p_issued_on is null or not isfinite(p_issued_on) or p_client_id is null then
    raise exception 'Invalid invoice series metadata' using errcode = '22023';
  end if;
  perform 1 from public.profiles where id = auth.uid() and active for share;
  if not found then raise insufficient_privilege; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('invoice:' || auth.uid()::text, 0));
  select * into previous from public.invoices where user_id = auth.uid() and client_id = p_client_id;
  if found then
    if (previous.series_approval_id, previous.number, previous.document_version_id, previous.issued_on)
        is distinct from (p_approval_id, btrim(p_number), p_document_version_id, p_issued_on) then
      raise exception 'Invoice series submission idempotency conflict' using errcode = '22023';
    end if;
    return previous.id;
  end if;
  select a.* into approval from private.invoice_series_approvals a
  join public.job_claims c on c.id = a.claim_id
  where a.id = p_approval_id and c.lecturer_id = auth.uid() for update of c, a;
  if not found then raise insufficient_privilege; end if;
  if not private.invoice_series_usable(approval.id) then
    raise exception 'Invoice series entry unavailable' using errcode = 'PT409';
  end if;
  perform 1 from public.document_versions v join public.documents d on d.id = v.document_id
  where v.id = p_document_version_id and d.owner_id = auth.uid() and d.deleted_at is null
    and d.kind = 'invoice' and d.scope = 'personal' and v.status = 'clean'
    and v.mime_type = 'application/pdf' and v.sha256 is not null for share of d, v;
  if not found then raise exception 'Own clean invoice PDF required' using errcode = '42501'; end if;
  insert into public.invoices(user_id, number, issued_on, due_on, currency, total_amount, document_version_id, client_id, series_approval_id)
  values(auth.uid(), btrim(p_number), p_issued_on, approval.due_on, approval.currency,
    approval.gross_amount - approval.credit_amount, p_document_version_id, p_client_id, approval.id)
  returning id into result;
  insert into public.invoice_items(invoice_id, claim_id, amendment_id, interim)
  values(result, approval.claim_id, (approval.basis->>'amendment')::uuid, approval.kind = 'interim');
  insert into private.invoice_series_credits(invoice_id, payment_id)
  select result, payment from unnest(approval.credited_payment_ids) payment;
  insert into public.audit_events(actor_id, action, resource_id, details)
  values (auth.uid(), 'invoice.submitted', result, jsonb_build_object(
    'currency', approval.currency, 'accepted_compensation', approval.gross_amount - approval.credit_amount,
    'series_approval_id', approval.id, 'kind', approval.kind, 'credit_amount', approval.credit_amount
  ));
  return result;
end;
$$;

create or replace function private.invoice_item_requires_confirmed_claim()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  bill public.invoices%rowtype;
begin
  if tg_op = 'UPDATE' and old.interim is distinct from new.interim then
    raise exception 'The invoice kind is immutable' using errcode = '23514';
  end if;
  if not new.active then return new; end if;
  select * into strict bill from public.invoices where id = new.invoice_id;
  if bill.series_approval_id is not null then
    if tg_op = 'UPDATE' and not old.active then
      raise exception 'A rejected series invoice needs a new submission' using errcode = 'PT409';
    end if;
    if not exists (
      select 1 from private.invoice_series_approvals a
      join public.job_claims c on c.id = a.claim_id
      where a.id = bill.series_approval_id and a.claim_id = new.claim_id and a.revoked_at is null
        and (a.kind = 'interim') = new.interim and c.lecturer_id = bill.user_id
        and a.gross_amount - a.credit_amount = bill.total_amount
        and a.currency = bill.currency and a.due_on = bill.due_on
    ) then
      raise exception 'Invoice series entry unavailable' using errcode = 'PT409';
    end if;
    return new;
  end if;
  if new.interim then raise exception 'Review a series before invoicing an interim amount' using errcode = '22023'; end if;
  if private.invoice_series_reserved(new.claim_id) then
    raise exception 'Use the reviewed invoice series to settle this assignment' using errcode = 'PT409';
  end if;
  if bill.exception_approval_id is null then
    if not exists (select 1 from public.job_claims c where c.id = new.claim_id and c.status = 'confirmed') then
      raise exception 'Only confirmed assignments may have an active invoice' using errcode = '22023';
    end if;
  elsif not exists (
    select 1 from private.invoice_exception_approvals a
    join public.job_claims c on c.id = a.claim_id
    where a.id = bill.exception_approval_id and a.claim_id = new.claim_id
      and a.revoked_at is null and c.lecturer_id = bill.user_id
      and a.amount = bill.total_amount and a.currency = bill.currency and a.due_on = bill.due_on
  ) then
    raise exception 'Invoice exception unavailable' using errcode = 'PT409';
  end if;
  return new;
end;
$$;

drop trigger invoice_item_active_claim on public.invoice_items;
create trigger invoice_item_active_claim before insert or update of active, claim_id, interim on public.invoice_items
for each row execute function private.invoice_item_requires_confirmed_claim();

-- Use the same lecturer invoice lock before taking the invoice row lock.
-- Approving an already credited zero balance closes it without a payment.
create or replace function private.review_invoice(p_invoice_id uuid, p_status text, p_note text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  invoice public.invoices%rowtype;
  recorded_status text;
begin
  if not private.has_permission('finance.manage') then raise insufficient_privilege; end if;
  if p_status is null or p_status not in ('approved', 'rejected', 'cancelled') or p_note is null or length(p_note) > 2000 then
    raise exception 'Invalid invoice decision' using errcode = '22023';
  end if;
  select * into invoice from public.invoices where id = p_invoice_id;
  if not found then raise exception 'Invoice unavailable' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('invoice:' || invoice.user_id::text, 0));
  select * into strict invoice from public.invoices where id = p_invoice_id for update;
  if invoice.series_approval_id is not null and invoice.total_amount = 0 and p_status = 'approved' then
    recorded_status := 'paid';
    if invoice.status = 'paid' and invoice.note = p_note and invoice.reviewed_by = auth.uid() then return; end if;
  else recorded_status := p_status;
  end if;
  if (
    invoice.status = 'paid' and not (
      invoice.series_approval_id is not null and invoice.total_amount = 0 and p_status in ('cancelled', 'rejected')
    )
  ) or exists (select 1 from public.payment_records where invoice_id = p_invoice_id and voided_at is null) then
    raise exception 'Paid or partially paid invoices cannot be reclassified' using errcode = '22023';
  end if;
  update public.invoice_items set active = p_status = 'approved' where invoice_id = p_invoice_id;
  update public.invoices set status = recorded_status, note = p_note, reviewed_by = auth.uid(), reviewed_at = clock_timestamp()
  where id = p_invoice_id;
  insert into public.audit_events(actor_id, action, resource_id, details)
  values (auth.uid(), 'invoice.reviewed', p_invoice_id, jsonb_build_object('status', recorded_status));
end;
$$;

alter function private.void_invoice_payment(uuid, text) rename to void_invoice_payment_before_series;
revoke all on function private.void_invoice_payment_before_series(uuid, text) from public, anon, authenticated, service_role;
create function private.void_invoice_payment(p_payment_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  lecturer uuid;
begin
  if not private.has_permission('finance.manage') then raise insufficient_privilege; end if;
  select i.user_id into lecturer from public.payment_records p join public.invoices i on i.id = p.invoice_id where p.id = p_payment_id;
  if lecturer is not null then
    perform pg_advisory_xact_lock(hashtextextended('invoice:' || lecturer::text, 0));
    if exists (
      select 1 from private.invoice_series_credits credited join public.invoice_items item on item.invoice_id = credited.invoice_id
      where credited.payment_id = p_payment_id and item.active
    ) then
      raise exception 'Cancel the closing invoice before reversing a credited payment' using errcode = 'PT409';
    end if;
  end if;
  perform private.void_invoice_payment_before_series(p_payment_id, p_reason);
end;
$$;
revoke all on function private.void_invoice_payment(uuid, text) from public, anon, authenticated, service_role;
grant execute on function private.void_invoice_payment(uuid, text) to authenticated;

-- Keep one earnings row per claim. The statement's paid total still includes
-- all actual payments, with full weight for single-claim series entries.
do $migration$
declare
  source text;
  fragment text;
begin
  source := pg_get_functiondef('private.finance_earnings_before_invoice_eligibility(boolean)'::regprocedure);
  fragment := 'item.claim_id=c.id and item.active';
  if cardinality(string_to_array(source, fragment)) <> 2 then raise exception 'Unexpected earnings join'; end if;
  source := replace(source, fragment, fragment || ' and not item.interim');
  fragment := 'case when i.exception_approval_id is not null then i.total_amount';
  if cardinality(string_to_array(source, fragment)) <> 2 then raise exception 'Unexpected earnings amount'; end if;
  execute replace(source, fragment, 'case when i.series_approval_id is not null then (select a.gross_amount from private.invoice_series_approvals a where a.id = i.series_approval_id) when i.exception_approval_id is not null then i.total_amount');

  source := pg_get_functiondef('private.finance_earnings(boolean)'::regprocedure);
  fragment := 'item.claim_id = claim.id and item.active';
  if cardinality(string_to_array(source, fragment)) <> 2 then raise exception 'Unexpected cancelled earnings join'; end if;
  source := replace(source, fragment, fragment || ' and not item.interim');
  fragment := 'case when invoice.exception_approval_id is not null then invoice.total_amount else claim.total_amount end';
  if cardinality(string_to_array(source, fragment)) <> 2 then raise exception 'Unexpected cancelled earnings amount'; end if;
  source := replace(source, fragment, 'case when invoice.series_approval_id is not null then (select a.gross_amount from private.invoice_series_approvals a where a.id = invoice.series_approval_id) when invoice.exception_approval_id is not null then invoice.total_amount else claim.total_amount end');
  fragment := 'when invoice.exception_approval_id is null then';
  if cardinality(string_to_array(source, fragment)) <> 2 then raise exception 'Unexpected cancelled earnings stage'; end if;
  execute replace(source, fragment, 'when invoice.exception_approval_id is null and invoice.series_approval_id is null then');

  source := pg_get_functiondef('private.claim_paid_amount(uuid)'::regprocedure);
  fragment := 'i.total_amount,i.exception_approval_id,';
  if cardinality(string_to_array(source, fragment)) <> 2 then raise exception 'Unexpected payment allocation columns'; end if;
  source := replace(source, fragment, fragment || 'i.series_approval_id,');
  fragment := 'invoice.exception_approval_id is not null';
  if cardinality(string_to_array(source, fragment)) <> 2 then raise exception 'Unexpected payment allocation weight'; end if;
  source := replace(source, fragment, fragment || ' or invoice.series_approval_id is not null');
  fragment := '/invoice.total_amount';
  if cardinality(string_to_array(source, fragment)) <> 2 then raise exception 'Unexpected payment allocation denominator'; end if;
  execute replace(source, fragment, '/nullif(invoice.total_amount, 0)');

  source := pg_get_functiondef('private.finance_statement(date,date,boolean)'::regprocedure);
  fragment := 'order by i.created_at desc,i.id limit 1';
  if cardinality(string_to_array(source, fragment)) <> 2 then raise exception 'Unexpected billing statement invoice'; end if;
  source := replace(source, fragment, 'order by item.interim asc,i.created_at desc,i.id limit 1');
  fragment := $old$(effective.value->>'total_amount')::numeric total_amount$old$;
  if cardinality(string_to_array(source, fragment)) <> 2 then raise exception 'Unexpected billing statement entitlement'; end if;
  source := replace(source, fragment, $new$coalesce((
    select a.gross_amount from private.invoice_series_approvals a where a.id = bill.series_approval_id and a.kind = 'final'
  ), (effective.value->>'total_amount')::numeric) total_amount$new$);
  fragment := $old$coalesce(sum((x->>'total_amount')::numeric) filter(where x->>'status'='confirmed' and x->>'invoice_id' is not null),0) invoiced$old$;
  if cardinality(string_to_array(source, fragment)) <> 2 then raise exception 'Unexpected billing statement billed amount'; end if;
  execute replace(source, fragment, $new$coalesce(sum(case
    when private.invoice_series_reserved((x->>'claim_id')::uuid) then (
      select coalesce(sum(invoice.total_amount),0) from public.invoice_items item
      join public.invoices invoice on invoice.id = item.invoice_id
      where item.claim_id = (x->>'claim_id')::uuid and item.active and invoice.series_approval_id is not null
    )
    when x->>'status' = 'confirmed' and x->>'invoice_id' is not null then (x->>'total_amount')::numeric
    else 0 end),0) invoiced$new$);

  source := pg_get_functiondef('private.delivery_projection(uuid)'::regprocedure);
  fragment := 'i.claim_id=c.id and i.active limit 1';
  if cardinality(string_to_array(source, fragment)) <> 2 then raise exception 'Unexpected course delivery invoice link'; end if;
  execute replace(source, fragment,
    'i.claim_id=c.id and i.active order by i.interim asc,(select b.created_at from public.invoices b where b.id = i.invoice_id) desc,i.invoice_id limit 1');

  source := pg_get_functiondef('private.invoice_exception_options(uuid)'::regprocedure);
  fragment := 'active_approval is null and maximum';
  if cardinality(string_to_array(source, fragment)) <> 2 then raise exception 'Unexpected exception options'; end if;
  execute replace(source, fragment, 'active_approval is null and not private.invoice_series_reserved(claim.id) and maximum');

  source := pg_get_functiondef('private.approve_invoice_exception(uuid,uuid,numeric,date,text)'::regprocedure);
  fragment := 'or not private.invoice_exception_mature(claim.id)';
  if cardinality(string_to_array(source, fragment)) <> 2 then raise exception 'Unexpected exception approval guard'; end if;
  execute replace(source, fragment, fragment || ' or private.invoice_series_reserved(claim.id)');

  source := pg_get_functiondef('private.submit_invoice_before_session_eligibility(text,uuid[],uuid,date,date,uuid)'::regprocedure);
  fragment := 'if previous.number<>trim(p_number)';
  if cardinality(string_to_array(source, fragment)) <> 2 then raise exception 'Unexpected existing invoice receipt check'; end if;
  execute replace(source, fragment, 'if previous.series_approval_id is not null or previous.number<>trim(p_number)');
end;
$migration$;

create function public.invoice_series_options(p_claim_id uuid)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.invoice_series_options(p_claim_id); $$;
create function public.approve_invoice_series_entry(
  p_claim_id uuid, p_contract_id uuid, p_kind text, p_amount numeric, p_due_on date, p_note text, p_client_id uuid
) returns uuid language sql security invoker set search_path = ''
as $$ select private.approve_invoice_series_entry(p_claim_id, p_contract_id, p_kind, p_amount, p_due_on, p_note, p_client_id); $$;
create function public.revoke_invoice_series_entry(p_approval_id uuid, p_note text)
returns void language sql security invoker set search_path = ''
as $$ select private.revoke_invoice_series_entry(p_approval_id, p_note); $$;
create function public.invoice_series_records(p_all boolean)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.invoice_series_records(p_all); $$;
create function public.submit_invoice_series_entry(
  p_approval_id uuid, p_number text, p_document_version_id uuid, p_issued_on date, p_client_id uuid
) returns uuid language sql security invoker set search_path = ''
as $$ select private.submit_invoice_series_entry(p_approval_id, p_number, p_document_version_id, p_issued_on, p_client_id); $$;

revoke all on function private.invoice_series_reserved(uuid), private.invoice_series_paid(uuid),
  private.invoice_series_gate(uuid, text), private.invoice_series_reserved_entry(uuid),
  private.invoice_series_usable(uuid), private.invoice_series_record(uuid),
  private.invoice_series_options(uuid), private.approve_invoice_series_entry(uuid, uuid, text, numeric, date, text, uuid),
  private.revoke_invoice_series_entry(uuid, text), private.invoice_series_records(boolean),
  private.submit_invoice_series_entry(uuid, text, uuid, date, uuid),
  public.invoice_series_options(uuid), public.approve_invoice_series_entry(uuid, uuid, text, numeric, date, text, uuid),
  public.revoke_invoice_series_entry(uuid, text), public.invoice_series_records(boolean),
  public.submit_invoice_series_entry(uuid, text, uuid, date, uuid)
from public, anon, authenticated, service_role;

grant execute on function private.invoice_series_options(uuid),
  private.approve_invoice_series_entry(uuid, uuid, text, numeric, date, text, uuid),
  private.revoke_invoice_series_entry(uuid, text), private.invoice_series_records(boolean),
  private.submit_invoice_series_entry(uuid, text, uuid, date, uuid),
  public.invoice_series_options(uuid), public.approve_invoice_series_entry(uuid, uuid, text, numeric, date, text, uuid),
  public.revoke_invoice_series_entry(uuid, text), public.invoice_series_records(boolean),
  public.submit_invoice_series_entry(uuid, text, uuid, date, uuid)
to authenticated;
notify pgrst, 'reload schema';
commit;
