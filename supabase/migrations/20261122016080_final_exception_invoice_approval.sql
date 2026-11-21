begin;

-- Retain the agreed version and reviewed basis independently of both the
-- ordinary invoice gate and the worksheet's private calculation inputs.
create table private.invoice_exception_approvals (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references private.invoice_review_requests(id),
  claim_id uuid not null references public.job_claims(id),
  contract_id uuid not null references public.contracts(id),
  contract_version integer not null check (contract_version > 0),
  basis jsonb not null,
  amount numeric(12,2) not null check (amount > 0),
  currency text not null check (currency in ('EUR', 'AUD')),
  due_on date not null check (isfinite(due_on)),
  approved_by uuid not null references public.profiles(id),
  approved_at timestamptz not null default clock_timestamp(),
  approval_note text not null check (length(approval_note) between 10 and 1000),
  revoked_by uuid references public.profiles(id),
  revoked_at timestamptz,
  revocation_note text check (length(revocation_note) between 10 and 1000),
  check (
    (revoked_by is null and revoked_at is null and revocation_note is null) or
    (revoked_by is not null and revoked_at is not null and revocation_note is not null)
  )
);
alter table private.invoice_exception_approvals enable row level security;
revoke all on private.invoice_exception_approvals from public, anon, authenticated, service_role;
create unique index one_current_invoice_exception_per_claim
  on private.invoice_exception_approvals(claim_id) where revoked_at is null;
create index invoice_exception_request on private.invoice_exception_approvals(request_id);

alter table public.invoices add column exception_approval_id uuid
  references private.invoice_exception_approvals(id);
create index invoice_exception_approval on public.invoices(exception_approval_id)
  where exception_approval_id is not null;
-- Earlier agreed deadlines remain visible even if the invoice arrives late.
alter table public.invoices drop constraint invoices_check;
alter table public.invoices add constraint invoice_due_on_or_reviewed_exception
  check (exception_approval_id is not null or due_on >= issued_on);

create function private.invoice_exception_basis(p_claim uuid)
returns jsonb language sql stable security invoker set search_path = '' set timezone = 'UTC'
as $$
  select jsonb_build_object(
    'status', c.status,
    'contract_id', c.contract_id,
    'amendment', (select a.id from private.assignment_amendments a where a.claim_id = c.id order by a.version desc limit 1),
    'maximum_amount', (private.effective_assignment(c.id)->>'total_amount')::numeric,
    'currency', c.currency,
    'sessions', coalesce((
      select jsonb_agg(jsonb_build_array(s.id, s.starts_at, s.ends_at, s.released_at) order by s.id)
      from public.assignment_sessions s where s.claim_id = c.id
        and private.assignment_session_counts_for_invoice(s.id)
    ), '[]'::jsonb)
  )
  from public.job_claims c where c.id = p_claim;
$$;

create function private.invoice_exception_mature(p_claim uuid)
returns boolean language sql stable security invoker set search_path = ''
as $$
  select exists (
    select 1 from public.job_claims c where c.id = p_claim
      and (
        c.status = 'cancelled' or (
          c.status = 'confirmed' and exists (
            select 1 from public.assignment_sessions s where s.claim_id = c.id
              and s.released_at is not null and private.assignment_session_counts_for_invoice(s.id)
          )
        )
      )
      and not exists (
        select 1 from public.assignment_sessions s where s.claim_id = c.id
          and s.released_at is null and s.ends_at > statement_timestamp()
          and private.assignment_session_counts_for_invoice(s.id)
      )
  );
$$;

-- Use the assignment's linked version when present. Historical claims without
-- a link may use an explicitly selected executed version that covered acceptance.
create function private.invoice_exception_contracts(p_claim uuid)
returns table(id uuid, version integer, kind text, effective_from timestamptz)
language sql stable security invoker set search_path = ''
as $$
  select contract.id, contract.version, contract.kind, contract.effective_from
  from public.job_claims c
  join public.contracts contract on contract.user_id = c.lecturer_id
  where c.id = p_claim and contract.document_version_id is not null
    and contract.status <> 'draft'
    and (
      contract.id = c.contract_id or (
        c.contract_id is null and contract.effective_from <= c.created_at
        and (contract.expires_at is null or contract.expires_at > c.created_at)
        and (contract.revoked_at is null or contract.revoked_at > c.created_at)
      )
    )
  order by contract.version desc, contract.id
  limit 100;
$$;

create function private.invoice_exception_options(p_request_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  req private.invoice_review_requests%rowtype;
  claim public.job_claims%rowtype;
  active_approval jsonb;
  maximum numeric;
begin
  if not private.has_permission('finance.manage') or
     not exists (select 1 from private.installation_identity where edition = 'internal') then
    raise insufficient_privilege;
  end if;
  select * into req from private.invoice_review_requests where id = p_request_id;
  if not found then raise exception 'Review request unavailable' using errcode = '22023'; end if;
  select * into strict claim from public.job_claims where id = req.claim_id;
  maximum := (private.effective_assignment(claim.id)->>'total_amount')::numeric;
  select jsonb_build_object('id', a.id, 'amount', a.amount, 'due_on', a.due_on, 'contract_version', a.contract_version)
  into active_approval
  from private.invoice_exception_approvals a
  where a.claim_id = claim.id and a.revoked_at is null;
  return jsonb_build_object(
    'contracts', coalesce((select jsonb_agg(to_jsonb(c) order by c.version desc, c.id) from private.invoice_exception_contracts(claim.id) c), '[]'::jsonb),
    'maximum_amount', maximum,
    'currency', claim.currency,
    'active', active_approval,
    'can_approve', req.status = 'pending' and req.reason in ('cancelled', 'partial_delivery') and
      active_approval is null and maximum > 0 and private.invoice_exception_mature(claim.id) and not exists (
        select 1 from public.invoice_items i where i.claim_id = claim.id and i.active
      )
  );
end;
$$;

create function private.approve_invoice_exception(
  p_request_id uuid, p_contract_id uuid, p_amount numeric, p_due_on date, p_note text
)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  req private.invoice_review_requests%rowtype;
  claim public.job_claims%rowtype;
  active_approval private.invoice_exception_approvals%rowtype;
  result uuid;
  chosen_version integer;
  basis jsonb;
begin
  if not private.has_permission('finance.manage') or
     not exists (select 1 from private.installation_identity where edition = 'internal') then
    raise insufficient_privilege;
  end if;
  if p_request_id is null or p_contract_id is null or p_amount is null or
     p_amount <= 0 or p_amount > 9999999999.99 or p_amount <> round(p_amount, 2) or
     p_due_on is null or not isfinite(p_due_on) or p_note is null or
     length(btrim(p_note)) not between 10 and 1000 then
    raise exception 'Invalid exceptional invoice decision' using errcode = '22023';
  end if;
  select * into req from private.invoice_review_requests where id = p_request_id;
  if not found then raise exception 'Review request unavailable' using errcode = '22023'; end if;

  perform pg_advisory_xact_lock(hashtextextended(req.requested_by::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('invoice:' || req.requested_by::text, 0));
  select * into strict claim from public.job_claims where id = req.claim_id for update;
  select * into strict req from private.invoice_review_requests where id = p_request_id for update;
  select * into active_approval from private.invoice_exception_approvals
  where claim_id = claim.id and revoked_at is null;
  if found then
    if (active_approval.request_id, active_approval.contract_id, active_approval.amount,
        active_approval.due_on, active_approval.approved_by, active_approval.approval_note)
        is not distinct from (p_request_id, p_contract_id, p_amount, p_due_on, auth.uid(), btrim(p_note)) then
      return active_approval.id;
    end if;
    raise exception 'Active exceptional invoice approval exists' using errcode = 'PT409';
  end if;
  if req.status <> 'pending' or req.reason not in ('cancelled', 'partial_delivery')
     or not private.invoice_exception_mature(claim.id)
     or exists (select 1 from public.invoice_items i where i.claim_id = claim.id and i.active) then
    raise exception 'Invoice exception unavailable' using errcode = 'PT409';
  end if;

  select contract.version into chosen_version
  from private.invoice_exception_contracts(claim.id) contract where contract.id = p_contract_id;
  if not found then raise exception 'Contract version unavailable' using errcode = '22023'; end if;
  basis := private.invoice_exception_basis(claim.id);
  if p_amount > (basis->>'maximum_amount')::numeric then
    raise exception 'Amount exceeds accepted compensation' using errcode = '22023';
  end if;
  insert into private.invoice_exception_approvals (
    request_id, claim_id, contract_id, contract_version, basis, amount, currency, due_on, approved_by, approval_note
  ) values (
    req.id, claim.id, p_contract_id, chosen_version, basis, p_amount, claim.currency, p_due_on, auth.uid(), btrim(p_note)
  ) returning id into result;
  perform private.resolve_invoice_review_request(req.id, p_note);
  insert into public.audit_events(actor_id, action, resource_id, details)
  values (auth.uid(), 'invoice.exception_approved', result, jsonb_build_object(
    'claim_id', claim.id, 'review_id', req.id, 'contract_version', chosen_version,
    'amount', p_amount, 'currency', claim.currency, 'due_on', p_due_on
  ));
  return result;
end;
$$;

create function private.revoke_invoice_exception(p_exception_id uuid, p_note text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  approval private.invoice_exception_approvals%rowtype;
  lecturer uuid;
begin
  if not private.has_permission('finance.manage') or
     not exists (select 1 from private.installation_identity where edition = 'internal') then
    raise insufficient_privilege;
  end if;
  if p_exception_id is null or p_note is null or length(btrim(p_note)) not between 10 and 1000 then
    raise exception 'Revocation note required' using errcode = '22023';
  end if;
  select * into approval from private.invoice_exception_approvals where id = p_exception_id;
  if not found then raise exception 'Invoice exception unavailable' using errcode = '22023'; end if;
  select c.lecturer_id into strict lecturer from public.job_claims c where c.id = approval.claim_id;
  perform pg_advisory_xact_lock(hashtextextended(lecturer::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('invoice:' || lecturer::text, 0));
  perform 1 from public.job_claims c where c.id = approval.claim_id for update;
  select * into strict approval from private.invoice_exception_approvals where id = p_exception_id for update;
  if approval.revoked_at is not null then
    if approval.revoked_by = auth.uid() and approval.revocation_note = btrim(p_note) then return; end if;
    raise exception 'Invoice exception was already revoked' using errcode = 'PT409';
  end if;
  if exists (select 1 from public.invoice_items i where i.claim_id = approval.claim_id and i.active) then
    raise exception 'Invoice exception already has an active invoice' using errcode = 'PT409';
  end if;

  update private.invoice_exception_approvals
  set revoked_by = auth.uid(), revoked_at = clock_timestamp(), revocation_note = btrim(p_note)
  where id = approval.id;
  -- A newer finance review may already exist for this claim. Leave it pending
  -- rather than reopening a second queue item.
  if not exists (select 1 from private.invoice_review_requests r where r.claim_id = approval.claim_id and r.status = 'pending') then
    update private.invoice_review_requests
    set status = 'pending', resolved_by = null, resolved_at = null, resolution_note = null
    where id = approval.request_id;
  end if;
  insert into public.audit_events(actor_id, action, resource_id, details)
  values (auth.uid(), 'invoice.exception_revoked', approval.id, jsonb_build_object('claim_id', approval.claim_id, 'review_id', approval.request_id));
end;
$$;

create function private.my_invoice_exceptions()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.lecturer_actor() or
     not exists (select 1 from private.installation_identity where edition = 'internal') then
    raise insufficient_privilege;
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', a.id, 'claim_id', a.claim_id, 'title', j.title, 'contract_version', a.contract_version,
      'amount', a.amount, 'currency', a.currency, 'due_on', a.due_on, 'approved_at', a.approved_at
    ) order by a.due_on, a.id), '[]'::jsonb)
    from private.invoice_exception_approvals a
    join public.job_claims c on c.id = a.claim_id
    join public.jobs j on j.id = c.job_id
    where c.lecturer_id = auth.uid() and a.revoked_at is null and
      a.basis = private.invoice_exception_basis(c.id) and not exists (
        select 1 from public.invoice_items i where i.claim_id = c.id and i.active
      )
  );
end;
$$;

create function private.submit_exception_invoice(
  p_exception_id uuid, p_number text, p_document_version_id uuid, p_issued_on date, p_client_id uuid
)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  previous public.invoices%rowtype;
  approval private.invoice_exception_approvals%rowtype;
  result uuid;
begin
  if not private.lecturer_actor() or
     not exists (select 1 from private.installation_identity where edition = 'internal') then
    raise insufficient_privilege;
  end if;
  if p_exception_id is null or p_number is null or length(btrim(p_number)) not between 1 and 80 or
     p_document_version_id is null or p_issued_on is null or not isfinite(p_issued_on) or p_client_id is null then
    raise exception 'Invalid exceptional invoice metadata' using errcode = '22023';
  end if;
  perform 1 from public.profiles where id = auth.uid() and active for share;
  if not found then raise insufficient_privilege; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('invoice:' || auth.uid()::text, 0));

  select * into previous from public.invoices
  where user_id = auth.uid() and client_id = p_client_id;
  if found then
    if (previous.exception_approval_id, previous.number, previous.document_version_id, previous.issued_on)
      is distinct from (p_exception_id, btrim(p_number), p_document_version_id, p_issued_on) then
      raise exception 'Invoice idempotency conflict' using errcode = '22023';
    end if;
    return previous.id;
  end if;
  select a.* into approval from private.invoice_exception_approvals a
  join public.job_claims c on c.id = a.claim_id
  where a.id = p_exception_id and c.lecturer_id = auth.uid() for update of c, a;
  if not found then raise insufficient_privilege; end if;
  if approval.revoked_at is not null or
     approval.basis is distinct from private.invoice_exception_basis(approval.claim_id) or
     not private.invoice_exception_mature(approval.claim_id) or exists (
       select 1 from public.invoice_items item where item.claim_id = approval.claim_id and item.active
     ) then
    raise exception 'Invoice exception unavailable' using errcode = 'PT409';
  end if;

  perform 1 from public.document_versions v join public.documents d on d.id = v.document_id
  where v.id = p_document_version_id and d.owner_id = auth.uid() and d.deleted_at is null
    and d.kind = 'invoice' and d.scope = 'personal' and v.status = 'clean'
    and v.mime_type = 'application/pdf' and v.sha256 is not null for share of d, v;
  if not found then raise exception 'Own clean invoice PDF required' using errcode = '42501'; end if;
  insert into public.invoices (
    user_id, number, issued_on, due_on, currency, total_amount, document_version_id, client_id, exception_approval_id
  ) values (
    auth.uid(), btrim(p_number), p_issued_on, approval.due_on, approval.currency, approval.amount,
    p_document_version_id, p_client_id, approval.id
  ) returning id into result;
  insert into public.invoice_items(invoice_id, claim_id, amendment_id)
  values (result, approval.claim_id, (approval.basis->>'amendment')::uuid);
  insert into public.audit_events(actor_id, action, resource_id, details)
  values (auth.uid(), 'invoice.submitted', result, jsonb_build_object(
    'currency', approval.currency, 'accepted_compensation', approval.amount, 'exception_approval_id', approval.id
  ));
  return result;
end;
$$;

-- A rejected or cancelled invoice releases its claim. It can be corrected under
-- the same approval, but an invoice tied to a revoked decision cannot reactivate.
create or replace function private.invoice_item_requires_confirmed_claim()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  document_bill public.invoices%rowtype;
begin
  if not new.active then return new; end if;
  select * into document_bill from public.invoices where id = new.invoice_id;
  if document_bill.exception_approval_id is null then
    if not exists (select 1 from public.job_claims c where c.id = new.claim_id and c.status = 'confirmed') then
      raise exception 'Only confirmed assignments may have an active invoice' using errcode = '22023';
    end if;
  elsif not exists (
    select 1 from private.invoice_exception_approvals a
    join public.job_claims c on c.id = a.claim_id
    where a.id = document_bill.exception_approval_id and a.claim_id = new.claim_id
      and a.revoked_at is null and c.lecturer_id = document_bill.user_id
      and a.amount = document_bill.total_amount and a.currency = document_bill.currency
      and a.due_on = document_bill.due_on
  ) then
    raise exception 'Invoice exception unavailable' using errcode = 'PT409';
  end if;
  return new;
end;
$$;

-- Keep the existing review desk able to correct a live approval when there is
-- no active invoice, and attribute sole-claim payments to the agreed exception.
do $migration$
declare
  source text;
  old_fragment text;
begin
  source := pg_get_functiondef('private.invoice_review_cases()'::regprocedure);
  old_fragment := $old$where request.status = 'pending'$old$;
  if cardinality(string_to_array(source, old_fragment)) <> 2 then raise exception 'Unexpected review queue'; end if;
  execute replace(source, old_fragment, $new$where request.status = 'pending' or exists (
    select 1 from private.invoice_exception_approvals a where a.request_id = request.id and a.revoked_at is null
      and not exists (select 1 from public.invoice_items i where i.claim_id = a.claim_id and i.active)
  )$new$);

  source := pg_get_functiondef('private.claim_paid_amount(uuid)'::regprocedure);
  if cardinality(string_to_array(source, 'select i.id,i.total_amount,')) <> 2 or
     cardinality(string_to_array(source, $old$coalesce((amendment.accepted->>'total_amount')::numeric,c.total_amount)$old$)) <> 2 then
    raise exception 'Unexpected invoice payment allocation';
  end if;
  source := replace(source, 'select i.id,i.total_amount,', 'select i.id,i.total_amount,i.exception_approval_id,');
  execute replace(source, $old$coalesce((amendment.accepted->>'total_amount')::numeric,c.total_amount)$old$,
    $new$case when invoice.exception_approval_id is not null then invoice.total_amount
      else coalesce((amendment.accepted->>'total_amount')::numeric,c.total_amount) end$new$);

  source := pg_get_functiondef('private.finance_earnings_before_invoice_eligibility(boolean)'::regprocedure);
  old_fragment := $old$(effective.value->>'total_amount')::numeric,c.currency,$old$;
  if cardinality(string_to_array(source, old_fragment)) <> 2 then raise exception 'Unexpected confirmed earnings'; end if;
  execute replace(source, old_fragment, $new$case when i.exception_approval_id is not null then i.total_amount
    else (effective.value->>'total_amount')::numeric end,c.currency,$new$);

  source := pg_get_functiondef('private.finance_earnings(boolean)'::regprocedure);
  old_fragment := $old$claim.amount, claim.rate_unit, claim.total_amount, claim.currency,
      'review', invoice.id,$old$;
  if cardinality(string_to_array(source, old_fragment)) <> 2 then raise exception 'Unexpected cancelled earnings'; end if;
  execute replace(source, old_fragment, $new$claim.amount, claim.rate_unit,
      case when invoice.exception_approval_id is not null then invoice.total_amount else claim.total_amount end, claim.currency,
      case when invoice.exception_approval_id is null then 'review' when invoice.status = 'paid' then 'paid' else 'invoiced' end, invoice.id,$new$);
end;
$migration$;

create function public.invoice_exception_options(p_request_id uuid)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.invoice_exception_options(p_request_id); $$;

create function public.approve_invoice_exception(p_request_id uuid, p_contract_id uuid, p_amount numeric, p_due_on date, p_note text)
returns uuid language sql security invoker set search_path = ''
as $$ select private.approve_invoice_exception(p_request_id, p_contract_id, p_amount, p_due_on, p_note); $$;

create function public.revoke_invoice_exception(p_exception_id uuid, p_note text)
returns void language sql security invoker set search_path = ''
as $$ select private.revoke_invoice_exception(p_exception_id, p_note); $$;

create function public.my_invoice_exceptions()
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.my_invoice_exceptions(); $$;

create function public.submit_exception_invoice(p_exception_id uuid, p_number text, p_document_version_id uuid, p_issued_on date, p_client_id uuid)
returns uuid language sql security invoker set search_path = ''
as $$ select private.submit_exception_invoice(p_exception_id, p_number, p_document_version_id, p_issued_on, p_client_id); $$;

revoke all on function private.invoice_exception_basis(uuid), private.invoice_exception_mature(uuid),
  private.invoice_exception_contracts(uuid),
  private.invoice_exception_options(uuid), private.approve_invoice_exception(uuid, uuid, numeric, date, text),
  private.revoke_invoice_exception(uuid, text), private.my_invoice_exceptions(),
  private.submit_exception_invoice(uuid, text, uuid, date, uuid),
  public.invoice_exception_options(uuid), public.approve_invoice_exception(uuid, uuid, numeric, date, text),
  public.revoke_invoice_exception(uuid, text), public.my_invoice_exceptions(),
  public.submit_exception_invoice(uuid, text, uuid, date, uuid)
from public, anon, authenticated, service_role;

grant execute on function private.invoice_exception_options(uuid), private.approve_invoice_exception(uuid, uuid, numeric, date, text),
  private.revoke_invoice_exception(uuid, text), private.my_invoice_exceptions(),
  private.submit_exception_invoice(uuid, text, uuid, date, uuid),
  public.invoice_exception_options(uuid), public.approve_invoice_exception(uuid, uuid, numeric, date, text),
  public.revoke_invoice_exception(uuid, text), public.my_invoice_exceptions(),
  public.submit_exception_invoice(uuid, text, uuid, date, uuid)
to authenticated;

notify pgrst, 'reload schema';
commit;
