begin;

-- A correction is confirmation of a reviewed overpayment, separate from both
-- the original invoice and receipts and any later money received outside Portal.
create table private.invoice_series_corrections (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.job_claims(id),
  contract_id uuid not null references public.contracts(id),
  contract_version integer not null check (contract_version > 0),
  currency text not null check (currency in ('EUR', 'AUD')),
  reviewed_total numeric(12,2) not null check (reviewed_total >= 0),
  credited numeric(12,2) not null check (credited > reviewed_total),
  credited_payment_ids uuid[] not null check (cardinality(credited_payment_ids) > 0),
  basis jsonb not null,
  due_on date not null check (isfinite(due_on)),
  note text not null check (length(note) between 10 and 1000),
  proposed_by uuid not null references public.profiles(id),
  proposed_at timestamptz not null default clock_timestamp(),
  client_id uuid not null,
  responded_at timestamptz,
  accepted boolean,
  dispute_note text check (length(dispute_note) between 10 and 1000),
  withdrawn_at timestamptz,
  withdrawn_by uuid references public.profiles(id),
  withdrawal_note text check (length(withdrawal_note) between 10 and 1000),
  unique (proposed_by, client_id),
  check ((accepted is null) = (responded_at is null)),
  check ((accepted is false) = (dispute_note is not null)),
  check ((withdrawn_at is null and withdrawn_by is null and withdrawal_note is null)
      or (withdrawn_at is not null and withdrawn_by is not null and withdrawal_note is not null))
);
alter table private.invoice_series_corrections enable row level security;
revoke all on private.invoice_series_corrections from public, anon, authenticated, service_role;
create unique index open_invoice_series_correction on private.invoice_series_corrections(claim_id) where withdrawn_at is null;
create index invoice_series_corrections_claim on private.invoice_series_corrections(claim_id, proposed_at desc);
create index invoice_series_correction_credited_ids on private.invoice_series_corrections using gin(credited_payment_ids)
  where withdrawn_at is null;

create table private.invoice_series_repayments (
  id uuid primary key default gen_random_uuid(),
  correction_id uuid not null references private.invoice_series_corrections(id),
  amount numeric(12,2) not null check (amount > 0),
  received_on date not null check (isfinite(received_on)),
  reference text not null check (length(reference) between 3 and 200),
  recorded_by uuid not null references public.profiles(id),
  recorded_at timestamptz not null default clock_timestamp(),
  client_id uuid not null,
  voided_at timestamptz,
  voided_by uuid references public.profiles(id),
  void_note text check (length(void_note) between 10 and 1000),
  unique (recorded_by, client_id),
  check ((voided_at is null and voided_by is null and void_note is null)
      or (voided_at is not null and voided_by is not null and void_note is not null))
);
alter table private.invoice_series_repayments enable row level security;
revoke all on private.invoice_series_repayments from public, anon, authenticated, service_role;
create index invoice_series_repayments_correction on private.invoice_series_repayments(correction_id, received_on, id);
create unique index invoice_series_unique_repayment_reference
  on private.invoice_series_repayments(correction_id, reference) where voided_at is null;

alter function private.invoice_series_gate(uuid, text) rename to invoice_series_gate_without_correction;
create function private.invoice_series_gate(p_claim_id uuid, p_kind text)
returns boolean language sql stable set search_path = ''
as $$
  select private.invoice_series_gate_without_correction(p_claim_id, p_kind)
    and not exists (select 1 from private.invoice_series_corrections c
      where c.claim_id = p_claim_id and c.withdrawn_at is null);
$$;

-- The same owner lock serializes ordinary invoice and repayment mutations.
create function private.lock_invoice_series_correction(p_claim_id uuid)
returns void language plpgsql set search_path = ''
as $$
declare lecturer uuid;
begin
  select lecturer_id into strict lecturer from public.job_claims where id = p_claim_id;
  perform pg_advisory_xact_lock(hashtextextended(lecturer::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('invoice:' || lecturer::text, 0));
  perform 1 from public.job_claims where id = p_claim_id for update;
end;
$$;

create function private.invoice_series_repaid(p_correction_id uuid)
returns numeric language sql stable set search_path = ''
as $$
  select coalesce(sum(r.amount), 0) from private.invoice_series_repayments r
  where r.correction_id = p_correction_id and r.voided_at is null;
$$;

create function private.invoice_series_correction_current(p_id uuid)
returns boolean language sql stable set search_path = ''
as $$
  select exists (
    select 1 from private.invoice_series_corrections c
    where c.id = p_id and c.withdrawn_at is null
      and private.invoice_series_gate_without_correction(c.claim_id, 'final')
      and c.basis = private.invoice_exception_basis(c.claim_id)
      and c.credited_payment_ids = array(select p.id from private.invoice_series_paid(c.claim_id) p order by p.id)
  );
$$;

create function private.invoice_series_correction_record(p_id uuid)
returns jsonb language sql stable set search_path = ''
as $$
  select jsonb_build_object(
    'id', c.id, 'claim_id', c.claim_id, 'title', j.title, 'currency', c.currency,
    'contract_version', c.contract_version, 'reviewed_total', c.reviewed_total,
    'credited', c.credited, 'balance', c.reviewed_total-c.credited, 'repaid', paid.amount,
    'outstanding', c.credited-c.reviewed_total-paid.amount,
    'due_on', c.due_on, 'note', c.note, 'proposed_at', c.proposed_at,
    'responded_at', c.responded_at, 'dispute_note', c.dispute_note,
    'withdrawn_at', c.withdrawn_at, 'withdrawal_note', c.withdrawal_note,
    'state', case
      when c.withdrawn_at is not null then 'withdrawn'
      when c.accepted is false then 'disputed'
      when c.accepted and c.credited-c.reviewed_total = paid.amount then 'settled'
      when c.accepted then 'acknowledged'
      when private.invoice_series_correction_current(c.id) then 'proposed'
      else 'stale' end,
    'credits', coalesce((
      select jsonb_agg(jsonb_build_object(
        'payment_id', p.id, 'invoice_id', i.id, 'invoice_number', i.number,
        'amount', p.amount, 'paid_at', p.paid_at
      ) order by p.paid_at, p.id)
      from public.payment_records p join public.invoices i on i.id = p.invoice_id
      where p.id = any(c.credited_payment_ids)
    ), '[]'::jsonb),
    'repayments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'amount', r.amount, 'received_on', r.received_on, 'reference', r.reference,
        'recorded_at', r.recorded_at, 'voided_at', r.voided_at, 'void_note', r.void_note
      ) order by r.received_on, r.id)
      from private.invoice_series_repayments r where r.correction_id = c.id
    ), '[]'::jsonb)
  )
  from private.invoice_series_corrections c
  join public.job_claims claim on claim.id = c.claim_id
  join public.jobs j on j.id = claim.job_id
  cross join lateral (select private.invoice_series_repaid(c.id) amount) paid
  where c.id = p_id;
$$;

create function private.invoice_series_corrections(p_claim_id uuid, p_all boolean)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare options jsonb;
begin
  if p_all is null or (p_all and p_claim_id is null) then
    raise exception 'Explicit correction scope required' using errcode = '22023';
  end if;
  if not exists (select 1 from private.installation_identity where edition = 'internal') or
     (p_all and not private.has_permission('finance.manage')) or
     (not p_all and not private.lecturer_actor()) then
    raise insufficient_privilege;
  end if;
  if p_all then
    select private.invoice_series_options(p_claim_id) into options;
    options := (options - 'can_interim' - 'can_final' - 'approvals') || jsonb_build_object(
      'can_propose', (options->>'credited')::numeric > 0
        and exists (select 1 from public.job_claims c where c.id = p_claim_id and c.lecturer_id <> auth.uid())
        and private.invoice_series_gate(p_claim_id, 'final')
        and not private.invoice_series_reserved_entry(p_claim_id)
        and jsonb_array_length(options->'contracts') > 0
    );
  end if;
  return jsonb_build_object('options', options, 'entries', coalesce((
    select jsonb_agg(private.invoice_series_correction_record(c.id) order by c.proposed_at desc, c.id)
    from private.invoice_series_corrections c join public.job_claims claim on claim.id = c.claim_id
    where (p_claim_id is null or c.claim_id = p_claim_id) and (p_all or claim.lecturer_id = auth.uid())
  ), '[]'::jsonb));
end;
$$;

create function private.propose_invoice_series_correction(
  p_claim_id uuid, p_contract_id uuid, p_reviewed_total numeric, p_due_on date, p_note text, p_client_id uuid
)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  claim public.job_claims%rowtype;
  previous private.invoice_series_corrections%rowtype;
  version_number integer;
  reviewed_basis jsonb;
  paid_amount numeric;
  paid_ids uuid[];
  result uuid;
begin
  if not private.has_permission('finance.manage') or
     not exists (select 1 from private.installation_identity where edition = 'internal') then
    raise insufficient_privilege;
  end if;
  if p_claim_id is null or p_contract_id is null or p_reviewed_total is null or
     p_reviewed_total < 0 or p_reviewed_total > 9999999999.99 or p_reviewed_total <> round(p_reviewed_total, 2) or
     p_due_on is null or not isfinite(p_due_on) or p_note is null or
     length(btrim(p_note)) not between 10 and 1000 or p_client_id is null then
    raise exception 'Invalid correction details' using errcode = '22023';
  end if;
  select * into claim from public.job_claims where id = p_claim_id;
  if not found then raise exception 'Assignment unavailable' using errcode = '22023'; end if;
  if claim.lecturer_id = auth.uid() then raise insufficient_privilege; end if;
  perform pg_advisory_xact_lock(hashtextextended('invoice-correction-review:' || auth.uid()::text, 0));
  perform private.lock_invoice_series_correction(claim.id);
  select * into previous from private.invoice_series_corrections where proposed_by = auth.uid() and client_id = p_client_id;
  if found then
    if (previous.claim_id, previous.contract_id, previous.reviewed_total, previous.due_on, previous.note)
       is distinct from (p_claim_id, p_contract_id, p_reviewed_total, p_due_on, btrim(p_note)) then
      raise exception 'Correction idempotency conflict' using errcode = '22023';
    end if;
    return previous.id;
  end if;
  if not private.invoice_series_gate(claim.id, 'final') or private.invoice_series_reserved_entry(claim.id) then
    raise exception 'Correction unavailable' using errcode = 'PT409';
  end if;
  reviewed_basis := private.invoice_exception_basis(claim.id);
  select coalesce(sum(p.amount), 0), array_agg(p.id order by p.id)
    into paid_amount, paid_ids from private.invoice_series_paid(claim.id) p;
  select a.version into version_number from private.invoice_exception_contracts(claim.id) a where a.id = p_contract_id;
  if not found or p_reviewed_total > (reviewed_basis->>'maximum_amount')::numeric or p_reviewed_total >= paid_amount then
    raise exception 'Use reviewed contract terms and an actual overpayment' using errcode = '22023';
  end if;
  insert into private.invoice_series_corrections (
    claim_id, contract_id, contract_version, currency, reviewed_total, credited, credited_payment_ids,
    basis, due_on, note, proposed_by, client_id
  ) values (
    claim.id, p_contract_id, version_number, claim.currency, p_reviewed_total, paid_amount, paid_ids,
    reviewed_basis, p_due_on, btrim(p_note), auth.uid(), p_client_id
  ) returning id into result;
  insert into public.audit_events(actor_id, action, resource_id, details)
  values (auth.uid(), 'invoice.series_correction_proposed', result, jsonb_build_object(
    'claim_id', claim.id, 'balance', p_reviewed_total-paid_amount, 'currency', claim.currency,
    'contract_version', version_number, 'due_on', p_due_on
  ));
  return result;
end;
$$;

create function private.respond_invoice_series_correction(p_correction_id uuid, p_accept boolean, p_note text)
returns void language plpgsql security definer set search_path = ''
as $$
declare correction private.invoice_series_corrections%rowtype;
begin
  if not private.lecturer_actor() or
     not exists (select 1 from private.installation_identity where edition = 'internal') then
    raise insufficient_privilege;
  end if;
  if p_correction_id is null or p_accept is null or (p_accept and p_note is not null)
     or (not p_accept and (p_note is null or length(btrim(p_note)) not between 10 and 1000)) then
    raise exception 'Correction and response required' using errcode = '22023';
  end if;
  select c.* into correction from private.invoice_series_corrections c
  join public.job_claims claim on claim.id = c.claim_id
  where c.id = p_correction_id and claim.lecturer_id = auth.uid();
  if not found then raise insufficient_privilege; end if;
  perform 1 from public.profiles where id = auth.uid() and active for share;
  if not found then raise insufficient_privilege; end if;
  perform private.lock_invoice_series_correction(correction.claim_id);
  select * into strict correction from private.invoice_series_corrections where id = p_correction_id for update;
  if correction.withdrawn_at is not null then raise exception 'Correction was withdrawn' using errcode = 'PT409'; end if;
  if correction.accepted is not null then
    if (correction.accepted, correction.dispute_note) is not distinct from (p_accept, btrim(p_note)) then return; end if;
    raise exception 'Correction was already answered' using errcode = 'PT409';
  end if;
  if not private.invoice_series_correction_current(correction.id) then
    raise exception 'Correction basis changed' using errcode = 'PT409';
  end if;
  update private.invoice_series_corrections
  set responded_at = clock_timestamp(), accepted = p_accept, dispute_note = btrim(p_note)
  where id = correction.id;
  insert into public.audit_events(actor_id, action, resource_id, details)
  values (auth.uid(), case when p_accept then 'invoice.series_correction_acknowledged' else 'invoice.series_correction_disputed' end,
    correction.id, jsonb_build_object('claim_id', correction.claim_id));
end;
$$;

create function private.withdraw_invoice_series_correction(p_correction_id uuid, p_note text)
returns void language plpgsql security definer set search_path = ''
as $$
declare correction private.invoice_series_corrections%rowtype;
begin
  if not private.has_permission('finance.manage') or
     not exists (select 1 from private.installation_identity where edition = 'internal') then
    raise insufficient_privilege;
  end if;
  if p_correction_id is null or p_note is null or length(btrim(p_note)) not between 10 and 1000 then
    raise exception 'Withdrawal reason is required' using errcode = '22023';
  end if;
  select * into correction from private.invoice_series_corrections where id = p_correction_id;
  if not found then raise exception 'Correction unavailable' using errcode = '22023'; end if;
  if exists (select 1 from public.job_claims c where c.id = correction.claim_id and c.lecturer_id = auth.uid()) then
    raise insufficient_privilege;
  end if;
  perform private.lock_invoice_series_correction(correction.claim_id);
  select * into strict correction from private.invoice_series_corrections where id = p_correction_id for update;
  if correction.withdrawn_at is not null then
    if (correction.withdrawn_by, correction.withdrawal_note) is not distinct from (auth.uid(), btrim(p_note)) then return; end if;
    raise exception 'Correction was already withdrawn' using errcode = 'PT409';
  end if;
  if private.invoice_series_repaid(correction.id) > 0 then
    raise exception 'A correction with valid recorded repayments must remain active' using errcode = 'PT409';
  end if;
  update private.invoice_series_corrections
  set withdrawn_at = clock_timestamp(), withdrawn_by = auth.uid(), withdrawal_note = btrim(p_note)
  where id = correction.id;
  insert into public.audit_events(actor_id, action, resource_id, details)
  values (auth.uid(), 'invoice.series_correction_withdrawn', correction.id, jsonb_build_object('claim_id', correction.claim_id));
end;
$$;

create function private.record_invoice_series_repayment(
  p_correction_id uuid, p_amount numeric, p_received_on date, p_reference text, p_client_id uuid
)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  correction private.invoice_series_corrections%rowtype;
  previous private.invoice_series_repayments%rowtype;
  current_day date;
  result uuid;
begin
  if not private.has_permission('finance.manage') or
     not exists (select 1 from private.installation_identity where edition = 'internal') then
    raise insufficient_privilege;
  end if;
  select (statement_timestamp() at time zone time_zone)::date into current_day from public.profiles where id = auth.uid();
  if p_correction_id is null or p_amount is null or p_amount <= 0 or p_amount > 9999999999.99 or p_amount <> round(p_amount, 2) or
     p_received_on is null or not isfinite(p_received_on) or p_received_on > current_day or
     p_reference is null or length(btrim(p_reference)) not between 3 and 200 or p_client_id is null then
    raise exception 'Invalid recorded repayment details' using errcode = '22023';
  end if;
  select * into correction from private.invoice_series_corrections where id = p_correction_id;
  if not found then raise exception 'Correction unavailable' using errcode = '22023'; end if;
  if exists (select 1 from public.job_claims c where c.id = correction.claim_id and c.lecturer_id = auth.uid()) then
    raise insufficient_privilege;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('invoice-correction-receipt:' || auth.uid()::text, 0));
  perform private.lock_invoice_series_correction(correction.claim_id);
  select * into previous from private.invoice_series_repayments where recorded_by = auth.uid() and client_id = p_client_id;
  if found then
    if (previous.correction_id, previous.amount, previous.received_on, previous.reference)
       is distinct from (p_correction_id, p_amount, p_received_on, btrim(p_reference)) then
      raise exception 'Repayment idempotency conflict' using errcode = '22023';
    end if;
    return previous.id;
  end if;
  select * into strict correction from private.invoice_series_corrections where id = p_correction_id for update;
  if correction.withdrawn_at is not null or correction.accepted is distinct from true then
    raise exception 'An acknowledged correction is required before recording a repayment' using errcode = 'PT409';
  end if;
  if exists (
    select 1 from private.invoice_series_repayments r
    where r.correction_id = correction.id and r.reference = btrim(p_reference) and r.voided_at is null
  ) then
    raise exception 'Duplicate active repayment reference' using errcode = 'PT409';
  end if;
  if p_amount > correction.credited - correction.reviewed_total - private.invoice_series_repaid(correction.id) then
    raise exception 'Repayment exceeds the remaining amount' using errcode = 'PT409';
  end if;
  insert into private.invoice_series_repayments (correction_id, amount, received_on, reference, recorded_by, client_id)
  values (correction.id, p_amount, p_received_on, btrim(p_reference), auth.uid(), p_client_id) returning id into result;
  insert into public.audit_events(actor_id, action, resource_id, details)
  values (auth.uid(), 'invoice.series_repayment_recorded', result, jsonb_build_object(
    'correction_id', correction.id, 'amount', p_amount, 'received_on', p_received_on, 'currency', correction.currency
  ));
  return result;
end;
$$;

create function private.void_invoice_series_repayment(p_repayment_id uuid, p_note text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  repayment private.invoice_series_repayments%rowtype;
  target_claim uuid;
begin
  if not private.has_permission('finance.manage') or
     not exists (select 1 from private.installation_identity where edition = 'internal') then
    raise insufficient_privilege;
  end if;
  if p_repayment_id is null or p_note is null or length(btrim(p_note)) not between 10 and 1000 then
    raise exception 'Repayment and reason are required' using errcode = '22023';
  end if;
  select c.claim_id into target_claim from private.invoice_series_repayments r
  join private.invoice_series_corrections c on c.id = r.correction_id
  where r.id = p_repayment_id;
  if not found then raise exception 'Repayment unavailable' using errcode = '22023'; end if;
  if exists (select 1 from public.job_claims c where c.id = target_claim and c.lecturer_id = auth.uid()) then
    raise insufficient_privilege;
  end if;
  perform private.lock_invoice_series_correction(target_claim);
  select * into strict repayment from private.invoice_series_repayments where id = p_repayment_id for update;
  if repayment.voided_at is not null then
    if (repayment.voided_by, repayment.void_note) is not distinct from (auth.uid(), btrim(p_note)) then return; end if;
    raise exception 'Repayment was already voided' using errcode = 'PT409';
  end if;
  update private.invoice_series_repayments
  set voided_at = clock_timestamp(), voided_by = auth.uid(), void_note = btrim(p_note)
  where id = repayment.id;
  insert into public.audit_events(actor_id, action, resource_id, details)
  values (auth.uid(), 'invoice.series_repayment_voided', repayment.id, jsonb_build_object('correction_id', repayment.correction_id));
end;
$$;

do $migration$
declare
  source text := pg_get_functiondef('private.void_invoice_payment(uuid,text)'::regprocedure);
  anchor text := $anchor$perform pg_advisory_xact_lock(hashtextextended('invoice:' || lecturer::text, 0));$anchor$;
begin
  if cardinality(string_to_array(source, anchor)) <> 2 then raise exception 'Unexpected invoice receipt lock'; end if;
  execute replace(source, anchor, anchor || $addition$
    if exists (
      select 1 from private.invoice_series_corrections correction
      where correction.withdrawn_at is null and correction.credited_payment_ids @> array[p_payment_id]
    ) then
      raise exception 'Withdraw the overpayment correction before reversing a credited payment' using errcode = 'PT409';
    end if;$addition$);
end;
$migration$;

create function public.invoice_series_corrections(p_claim_id uuid, p_all boolean)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.invoice_series_corrections(p_claim_id, p_all); $$;
create function public.propose_invoice_series_correction(
  p_claim_id uuid, p_contract_id uuid, p_reviewed_total numeric, p_due_on date, p_note text, p_client_id uuid
) returns uuid language sql security invoker set search_path = ''
as $$ select private.propose_invoice_series_correction(p_claim_id, p_contract_id, p_reviewed_total, p_due_on, p_note, p_client_id); $$;
create function public.acknowledge_invoice_series_correction(p_correction_id uuid)
returns void language sql security invoker set search_path = ''
as $$ select private.respond_invoice_series_correction(p_correction_id, true, null); $$;
create function public.dispute_invoice_series_correction(p_correction_id uuid, p_note text)
returns void language sql security invoker set search_path = ''
as $$ select private.respond_invoice_series_correction(p_correction_id, false, p_note); $$;
create function public.withdraw_invoice_series_correction(p_correction_id uuid, p_note text)
returns void language sql security invoker set search_path = ''
as $$ select private.withdraw_invoice_series_correction(p_correction_id, p_note); $$;
create function public.record_invoice_series_repayment(
  p_correction_id uuid, p_amount numeric, p_received_on date, p_reference text, p_client_id uuid
) returns uuid language sql security invoker set search_path = ''
as $$ select private.record_invoice_series_repayment(p_correction_id, p_amount, p_received_on, p_reference, p_client_id); $$;
create function public.void_invoice_series_repayment(p_repayment_id uuid, p_note text)
returns void language sql security invoker set search_path = ''
as $$ select private.void_invoice_series_repayment(p_repayment_id, p_note); $$;

revoke all on function private.invoice_series_gate(uuid, text), private.lock_invoice_series_correction(uuid),
  private.invoice_series_repaid(uuid), private.invoice_series_correction_current(uuid), private.invoice_series_correction_record(uuid),
  private.invoice_series_corrections(uuid, boolean), private.propose_invoice_series_correction(uuid, uuid, numeric, date, text, uuid),
  private.respond_invoice_series_correction(uuid, boolean, text), private.withdraw_invoice_series_correction(uuid, text),
  private.record_invoice_series_repayment(uuid, numeric, date, text, uuid), private.void_invoice_series_repayment(uuid, text),
  public.invoice_series_corrections(uuid, boolean), public.propose_invoice_series_correction(uuid, uuid, numeric, date, text, uuid),
  public.acknowledge_invoice_series_correction(uuid), public.dispute_invoice_series_correction(uuid, text),
  public.withdraw_invoice_series_correction(uuid, text), public.record_invoice_series_repayment(uuid, numeric, date, text, uuid),
  public.void_invoice_series_repayment(uuid, text)
from public, anon, authenticated, service_role;

grant execute on function private.invoice_series_corrections(uuid, boolean),
  private.propose_invoice_series_correction(uuid, uuid, numeric, date, text, uuid),
  private.respond_invoice_series_correction(uuid, boolean, text), private.withdraw_invoice_series_correction(uuid, text),
  private.record_invoice_series_repayment(uuid, numeric, date, text, uuid), private.void_invoice_series_repayment(uuid, text),
  public.invoice_series_corrections(uuid, boolean), public.propose_invoice_series_correction(uuid, uuid, numeric, date, text, uuid),
  public.acknowledge_invoice_series_correction(uuid), public.dispute_invoice_series_correction(uuid, text),
  public.withdraw_invoice_series_correction(uuid, text), public.record_invoice_series_repayment(uuid, numeric, date, text, uuid),
  public.void_invoice_series_repayment(uuid, text)
to authenticated;

notify pgrst, 'reload schema';
commit;
