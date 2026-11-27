begin;

-- Actual receipts are separate from accepted rates and invoice totals. The
-- existing assignment and finance permissions remain the authority.
alter table public.documents drop constraint documents_kind_check;
alter table public.documents add constraint documents_kind_check check (kind in (
  'material','chat','cv','certificate','contract','invoice','avatar','participant_submission',
  'organisation_contract','portfolio_evidence','scorm_package','h5p_package','expense_receipt'
));
alter table public.documents add constraint expense_receipt_document_check check (
  kind <> 'expense_receipt' or (scope = 'personal' and size_bytes between 1 and 10485760
    and mime_type in ('application/pdf','image/jpeg','image/png','image/webp'))
);

create table private.lecturer_expenses (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.job_claims(id),
  lecturer_id uuid not null references public.profiles(id),
  session_id uuid,
  session_starts_at timestamptz,
  category text not null check (category in ('travel','parking','accommodation','meals','materials','other')),
  spent_on date not null,
  description text not null check (char_length(description) between 1 and 1000),
  currency text not null check (currency in ('AUD','CHF','EUR','USD')),
  requested_amount numeric(12,2) not null check (requested_amount > 0),
  approved_amount numeric(12,2),
  receipt_version_id uuid not null references public.document_versions(id),
  state text not null check (state in ('submitted','correction','approved','rejected','reimbursed')),
  review_note text not null default '' check (char_length(review_note) <= 1000),
  invoice_id uuid references public.invoices(id),
  paid_on date,
  payment_reference text check (char_length(payment_reference) between 1 and 200),
  revision integer not null check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((session_id is null) = (session_starts_at is null)),
  check ((state in ('approved','reimbursed')) = (approved_amount is not null)),
  check (approved_amount is null or approved_amount between 0.01 and requested_amount),
  check (invoice_id is null or state in ('approved','reimbursed')),
  check ((state = 'reimbursed') = (paid_on is not null and payment_reference is not null))
);
create index lecturer_expenses_owner_period on private.lecturer_expenses(lecturer_id, spent_on desc, id);
create index lecturer_expenses_period on private.lecturer_expenses(spent_on desc, id);
create index lecturer_expenses_claim on private.lecturer_expenses(claim_id);
create index lecturer_expenses_payment_period on private.lecturer_expenses(paid_on, id) where state = 'reimbursed';
create index lecturer_expenses_invoice on private.lecturer_expenses(invoice_id) where invoice_id is not null;

create table private.expense_receipt_reservations (
  version_id uuid primary key references public.document_versions(id) on delete cascade,
  owner_id uuid not null references public.profiles(id),
  expected_sha256 text not null check (expected_sha256 ~ '^[a-f0-9]{64}$'),
  expense_id uuid references private.lecturer_expenses(id)
);
create unique index expense_receipt_one_reimbursement on private.expense_receipt_reservations(owner_id, expected_sha256)
  where expense_id is not null;
create index expense_receipt_expense on private.expense_receipt_reservations(expense_id) where expense_id is not null;

-- Exact commands and their response are stored in the same transaction as
-- the corresponding state change. A lost response can be replayed safely.
create table private.lecturer_expense_commands (
  actor_id uuid not null references public.profiles(id),
  request_id uuid not null,
  expense_id uuid not null references private.lecturer_expenses(id),
  revision integer not null,
  command jsonb not null,
  result jsonb not null,
  recorded_at timestamptz not null default clock_timestamp(),
  primary key (actor_id, request_id),
  unique (expense_id, revision)
);
alter table private.lecturer_expenses enable row level security;
alter table private.expense_receipt_reservations enable row level security;
alter table private.lecturer_expense_commands enable row level security;
revoke all on private.lecturer_expenses, private.expense_receipt_reservations, private.lecturer_expense_commands
  from public, anon, authenticated, service_role;

-- Dedicated receipts stay closed to the ordinary Files listing and generic
-- document actions. Reuse the reservation and scanner implementation.
do $migration$
declare
  item record;
  definition text;
begin
  for item in select * from (values
    ('private.can_access_document(uuid)',
      $old$d.kind in ('participant_submission', 'organisation_contract', 'portfolio_evidence', 'scorm_package', 'h5p_package')$old$,
      $new$d.kind in ('participant_submission', 'organisation_contract', 'portfolio_evidence', 'scorm_package', 'h5p_package', 'expense_receipt')$new$),
    ('private.deletion_authorized(text,uuid)',
      $old$kind in ('organisation_contract', 'portfolio_evidence')$old$,
      $new$kind in ('organisation_contract', 'portfolio_evidence', 'expense_receipt')$new$),
    ('private.reserve_document(text,text,bigint,text,text,uuid,uuid,uuid,uuid,uuid)',
      $old$p_kind in ('participant_submission','portfolio_evidence','scorm_package','h5p_package')$old$,
      $new$p_kind in ('participant_submission','portfolio_evidence','scorm_package','h5p_package','expense_receipt')$new$),
    ('private.reserve_document_before_contract_owner(text,text,bigint,text,text,uuid,uuid,uuid,uuid,uuid)',
      $old$p_kind in ('portfolio_evidence','scorm_package','h5p_package') and d.kind = p_kind$old$,
      $new$p_kind in ('portfolio_evidence','scorm_package','h5p_package','expense_receipt') and d.kind = p_kind$new$),
    ('private.complete_document_upload(uuid,uuid,uuid,text,text)',
      $old$  select uploaded_by into uploader_id from public.document_versions$old$,
      $new$  if exists (select 1 from private.expense_receipt_reservations where version_id = p_version_id)
    and not exists (select 1 from private.expense_receipt_reservations
      where version_id = p_version_id and expected_sha256 = p_sha256) then
    raise invalid_parameter_value;
  end if;
  select uploaded_by into uploader_id from public.document_versions$new$)
  ) as replacements(signature, old_text, new_text)
  loop
    definition := pg_get_functiondef(item.signature::regprocedure);
    if cardinality(string_to_array(definition, item.old_text)) <> 2 then
      raise exception 'Expected one expense receipt guard point in %', item.signature;
    end if;
    execute replace(definition, item.old_text, item.new_text);
  end loop;
end;
$migration$;

create function private.expense_access(p_staff boolean)
returns boolean language sql stable security invoker set search_path = '' as $$
  select (select edition from private.installation_identity) = 'internal'
    and private.actor_active()
    and case when p_staff then private.has_permission('finance.manage') else private.lecturer_actor() end;
$$;

create function private.reserve_expense_receipt(p_name text, p_mime text, p_size bigint, p_client_id uuid, p_sha256 text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  reservation jsonb;
  digest text;
begin
  if not coalesce(private.expense_access(false), false) then raise insufficient_privilege; end if;
  if p_size is null or p_size not between 1 and 10485760 or p_client_id is null
    or p_sha256 is null or p_sha256 !~ '^[a-f0-9]{64}$' or p_mime is null
    or p_mime not in ('application/pdf','image/png','image/jpeg','image/webp') then
    raise invalid_parameter_value;
  end if;
  reservation := private.reserve_document_before_contract_owner(
    p_name, p_mime, p_size, 'personal', 'expense_receipt', null, null, p_client_id, null, null
  );
  insert into private.expense_receipt_reservations(version_id, owner_id, expected_sha256)
    values ((reservation->>'version_id')::uuid, auth.uid(), p_sha256) on conflict (version_id) do nothing;
  select expected_sha256 into digest from private.expense_receipt_reservations
    where version_id = (reservation->>'version_id')::uuid and owner_id = auth.uid();
  if digest is distinct from p_sha256 then raise exception 'Expense receipt changed' using errcode = 'PT409'; end if;
  return reservation;
end;
$$;

create function private.expense_receipt_upload_status(p_document_id uuid, p_version_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('document', jsonb_build_object(
    'id', d.id, 'scope', d.scope, 'kind', d.kind, 'owner_id', d.owner_id, 'uploaded_by', d.uploaded_by,
    'room_id', d.room_id, 'job_id', d.job_id, 'original_name', d.original_name, 'mime_type', d.mime_type,
    'size_bytes', d.size_bytes, 'status', d.status, 'current_version_id', v.id, 'created_at', d.created_at,
    'deleted_at', null), 'sha256', r.expected_sha256)
  from private.expense_receipt_reservations r
  join public.document_versions v on v.id = r.version_id
  join public.documents d on d.id = v.document_id and d.current_version_id = v.id
  where private.expense_access(false) and r.owner_id = auth.uid()
    and d.owner_id = auth.uid() and v.uploaded_by = auth.uid()
    and v.id = p_version_id and d.id = p_document_id and d.kind = 'expense_receipt'
    and d.deleted_at is null and not private.deletion_document_fenced(d.id)
    and (d.status <> 'clean' or (v.status = 'clean' and v.sha256 = r.expected_sha256 and v.scanner_version is not null));
$$;

-- Download only the currently selected, exact receipt. Finance permission is
-- freshly checked by the file gateway before and after obtaining the bytes.
create function private.expense_receipt_download(p_expense_id uuid, p_version_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('version_id', v.id, 'name', v.original_name, 'mime_type', v.mime_type,
    'size_bytes', v.size_bytes, 'sha256', v.sha256)
  from private.lecturer_expenses e
  join private.expense_receipt_reservations r on r.expense_id = e.id and e.receipt_version_id = r.version_id
  join public.document_versions v on v.id = r.version_id
  join public.documents d on d.id = v.document_id
  where e.id = p_expense_id and r.version_id = p_version_id and d.kind = 'expense_receipt'
    and d.deleted_at is null and not private.deletion_document_fenced(d.id)
    and v.status = 'clean' and v.sha256 = r.expected_sha256 and v.scanner_version is not null
    and (private.expense_access(true) or (e.lecturer_id = auth.uid() and private.expense_access(false)));
$$;

create function private.lecturer_expense_options()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if not coalesce(private.expense_access(false), false) then raise insufficient_privilege; end if;
  select coalesce(jsonb_agg(jsonb_build_object('claim_id', c.id, 'title', c.title,
    'sessions', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'starts_at', s.starts_at) order by s.starts_at, s.id)
      from public.assignment_sessions s where s.claim_id = c.id and s.lecturer_id = auth.uid()
    ), '[]'::jsonb)) order by c.created_at desc, c.id), '[]'::jsonb) into result
  from (
    select claim.id, claim.created_at, job.title from public.job_claims claim
    join public.jobs job on job.id = claim.job_id
    where claim.lecturer_id = auth.uid() and claim.status = 'confirmed'
    order by claim.created_at desc, claim.id limit 200
  ) c;
  return result;
end;
$$;

-- This is a projection of actual expenses. Invoice numbers are association
-- evidence and never an implicit adjustment or change to payable amounts.
create function private.lecturer_expense_report(
  p_staff boolean, p_from date, p_through date, p_state text default null, p_currency text default null,
  p_assignment uuid default null, p_lecturer uuid default null, p_customer uuid default null, p_course uuid default null
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if p_staff is null or not coalesce(private.expense_access(p_staff), false) then raise insufficient_privilege; end if;
  if not p_staff and (p_lecturer is not null or p_customer is not null or p_course is not null) then
    raise insufficient_privilege;
  end if;
  if p_from is null or p_through is null or not isfinite(p_from) or not isfinite(p_through)
    or p_from > p_through or p_through - p_from >= 366
    or (p_state is not null and p_state not in ('submitted','correction','approved','rejected','reimbursed'))
    or (p_currency is not null and p_currency not in ('AUD','CHF','EUR','USD')) then raise invalid_parameter_value; end if;
  with selected as materialized (
    select e.*, job.title, v.original_name as receipt_name,
      case when p_staff then p.display_name end as lecturer_name,
      case when p_staff then coalesce(org.name, job.customer_name) end as customer_name,
      case when p_staff then org.id end as customer_id, job.course_run_id as course_id,
      i.number as invoice_number, i.status as invoice_state
    from private.lecturer_expenses e
    join public.job_claims c on c.id = e.claim_id
    join public.jobs job on job.id = c.job_id
    join public.profiles p on p.id = e.lecturer_id
    join public.document_versions v on v.id = e.receipt_version_id
    left join private.claim_revenue_ledger revenue on revenue.claim_id = e.claim_id
    left join public.course_runs run on run.id = job.course_run_id
    left join public.organisations org on org.id = coalesce(revenue.organisation_id, run.organisation_id)
    left join public.invoices i on i.id = e.invoice_id
    where (p_staff or e.lecturer_id = auth.uid()) and e.spent_on between p_from and p_through
      and (p_state is null or e.state = p_state) and (p_currency is null or e.currency = p_currency)
      and (p_assignment is null or e.claim_id = p_assignment) and (p_lecturer is null or e.lecturer_id = p_lecturer)
      and (p_customer is null or org.id = p_customer)
      and (p_course is null or job.course_run_id = p_course)
    order by e.spent_on desc, e.id limit 5001
  ), totals as (
    select currency, sum(requested_amount) as submitted, coalesce(sum(approved_amount), 0) as approved,
      coalesce(sum(approved_amount) filter (where state = 'reimbursed'), 0) as paid,
      coalesce(sum(approved_amount) filter (where state = 'approved'), 0) as outstanding
    from selected group by currency
  )
  select case when (select count(*) from selected) <= 5000 then jsonb_build_object(
    'items', coalesce((select jsonb_agg(
      (to_jsonb(s) - 'created_at' - 'updated_at') || jsonb_build_object(
        'requested_amount', s.requested_amount::text, 'approved_amount', s.approved_amount::text)
      order by s.spent_on desc, s.id) from selected s), '[]'::jsonb),
    'totals', coalesce((select jsonb_agg(jsonb_build_object('currency', t.currency,
      'submitted', t.submitted::text, 'approved', t.approved::text, 'paid', t.paid::text,
      'outstanding', t.outstanding::text) order by t.currency) from totals t), '[]'::jsonb)
  ) end into result;
  if result is null then raise exception 'Select a shorter expense period' using errcode = 'PT413'; end if;
  return result;
end;
$$;

-- A finance reviewer can associate only an existing invoice of the same
-- lecturer, assignment and currency. The invoice amount remains authoritative.
create function private.lecturer_expense_invoices(p_expense_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if not coalesce(private.expense_access(true), false) then raise insufficient_privilege; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'number', i.number) order by i.issued_on desc, i.id), '[]'::jsonb)
    into result
  from private.lecturer_expenses e
  join public.invoice_items item on item.claim_id = e.claim_id and item.active
  join public.invoices i on i.id = item.invoice_id and i.user_id = e.lecturer_id
  where e.id = p_expense_id and e.lecturer_id <> auth.uid()
    and i.currency = e.currency and i.status in ('approved','paid');
  return result;
end;
$$;

create function private.lecturer_expense_action(
  p_action text, p_expense_id uuid, p_expected_revision integer, p_payload jsonb, p_request_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  who uuid := auth.uid();
  current_expense private.lecturer_expenses;
  previous private.lecturer_expense_commands;
  binding private.expense_receipt_reservations;
  command jsonb;
  result jsonb;
  for_staff boolean := p_action not in ('submit','resubmit');
  claim uuid;
  session uuid;
  session_start timestamptz;
  receipt uuid;
  invoice uuid;
  amount numeric;
  spent date;
  paid date;
  note text;
  reference text;
begin
  if p_action is null or p_action not in ('submit','resubmit','correction','rejected','approve','link','reimburse')
    or p_request_id is null or p_expected_revision is null or p_expected_revision < 0
    or (p_action = 'submit') <> (p_expense_id is null)
    or p_payload is null or jsonb_typeof(p_payload) <> 'object' or pg_column_size(p_payload) > 8192 then
    raise invalid_parameter_value;
  end if;
  if not coalesce(private.expense_access(for_staff), false) then raise insufficient_privilege; end if;
  command := jsonb_build_array(p_action, p_expense_id, p_expected_revision, p_payload);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('expense-command:' || who::text || ':' || p_request_id::text, 0));
  select * into previous from private.lecturer_expense_commands where actor_id = who and request_id = p_request_id;
  if found then
    if previous.command <> command then raise exception 'Expense request changed' using errcode = 'PT409'; end if;
    return previous.result;
  end if;
  if p_expense_id is not null then
    select * into current_expense from private.lecturer_expenses where id = p_expense_id for update;
    if not found or (for_staff and current_expense.lecturer_id = who)
      or (not for_staff and current_expense.lecturer_id <> who) then raise insufficient_privilege; end if;
    if current_expense.revision <> p_expected_revision then
      raise exception 'Expense changed' using errcode = 'PT409';
    end if;
  elsif p_expected_revision <> 0 then raise invalid_parameter_value;
  end if;

  if not for_staff then
    if p_payload - array['claim_id','session_id','receipt_version_id','category','spent_on','description','amount','currency'] <> '{}'::jsonb
      or (p_action = 'resubmit' and current_expense.state <> 'correction')
      or coalesce(p_payload->>'amount','') !~ '^[0-9]{1,10}(\.[0-9]{1,2})?$'
      or coalesce(p_payload->>'spent_on','') !~ '^\d{4}-\d{2}-\d{2}$' then raise invalid_parameter_value; end if;
    claim := (p_payload->>'claim_id')::uuid;
    session := (p_payload->>'session_id')::uuid;
    receipt := (p_payload->>'receipt_version_id')::uuid;
    amount := (p_payload->>'amount')::numeric;
    spent := (p_payload->>'spent_on')::date;
    if spent > current_date or amount <= 0 or (p_action = 'resubmit' and claim is distinct from current_expense.claim_id) then
      raise invalid_parameter_value;
    end if;
    perform 1 from public.job_claims c where c.id = claim and c.lecturer_id = who
      and (c.status = 'confirmed' or p_action = 'resubmit') for share;
    if not found then raise insufficient_privilege; end if;
    if session is not null then
      select s.starts_at into session_start from public.assignment_sessions s
        where s.id = session and s.claim_id = claim and s.lecturer_id = who for share;
      if not found then
        if p_action = 'resubmit' and session = current_expense.session_id then session_start := current_expense.session_starts_at;
        else raise insufficient_privilege;
        end if;
      end if;
    end if;
    select r.* into binding from private.expense_receipt_reservations r
    join public.document_versions v on v.id = r.version_id
    join public.documents d on d.id = v.document_id
    where r.version_id = receipt and r.owner_id = who and d.owner_id = who and d.kind = 'expense_receipt'
      and d.deleted_at is null and not private.deletion_document_fenced(d.id)
      and v.status = 'clean' and v.sha256 = r.expected_sha256 and v.scanner_version is not null
    for update of r;
    if not found or (binding.expense_id is not null and binding.expense_id is distinct from p_expense_id) then
      raise insufficient_privilege;
    end if;
    if p_action = 'submit' then
      insert into private.lecturer_expenses(claim_id, lecturer_id, session_id, session_starts_at, category,
        spent_on, description, currency, requested_amount, receipt_version_id, state, revision)
      values (claim, who, session, session_start, p_payload->>'category', spent, btrim(p_payload->>'description'),
        p_payload->>'currency', amount, receipt, 'submitted', 1)
      returning * into current_expense;
    else
      update private.lecturer_expenses e set session_id = session, session_starts_at = session_start,
        category = p_payload->>'category', spent_on = spent, description = btrim(p_payload->>'description'),
        currency = p_payload->>'currency', requested_amount = amount, receipt_version_id = receipt,
        state = 'submitted', review_note = '', revision = e.revision + 1, updated_at = now()
      where e.id = p_expense_id returning * into current_expense;
    end if;
    update private.expense_receipt_reservations set expense_id = current_expense.id where version_id = receipt;
  else
    note := btrim(coalesce(p_payload->>'note',''));
    invoice := (p_payload->>'invoice_id')::uuid;
    if p_action in ('correction','rejected') then
      if current_expense.state <> 'submitted' or char_length(note) not between 1 and 1000
        or p_payload - 'note' <> '{}'::jsonb then raise invalid_parameter_value; end if;
    elsif p_action = 'approve' then
      if current_expense.state <> 'submitted' or p_payload - array['amount','note','invoice_id'] <> '{}'::jsonb
        or coalesce(p_payload->>'amount','') !~ '^[0-9]{1,10}(\.[0-9]{1,2})?$' or char_length(note) > 1000 then
        raise invalid_parameter_value;
      end if;
      amount := (p_payload->>'amount')::numeric;
      if amount <= 0 or amount > current_expense.requested_amount or (amount < current_expense.requested_amount and note = '') then
        raise invalid_parameter_value;
      end if;
    elsif p_action = 'link' then
      if current_expense.state not in ('approved','reimbursed') or p_payload - 'invoice_id' <> '{}'::jsonb then
        raise invalid_parameter_value;
      end if;
    elsif p_action = 'reimburse' then
      if current_expense.state <> 'approved' or p_payload - array['paid_on','reference'] <> '{}'::jsonb
        or coalesce(p_payload->>'paid_on','') !~ '^\d{4}-\d{2}-\d{2}$' then raise invalid_parameter_value; end if;
      paid := (p_payload->>'paid_on')::date;
      reference := btrim(p_payload->>'reference');
      if paid < current_expense.spent_on or paid > current_date or coalesce(char_length(reference),0) not between 1 and 200 then
        raise invalid_parameter_value;
      end if;
    end if;
    if invoice is not null then
      perform 1 from public.invoices i join public.invoice_items item on item.invoice_id = i.id
      where i.id = invoice and item.claim_id = current_expense.claim_id and item.active
        and i.user_id = current_expense.lecturer_id and i.status in ('approved','paid')
        and i.currency = current_expense.currency for share of i, item;
      if not found then raise insufficient_privilege; end if;
    end if;
    update private.lecturer_expenses e set
      state = case p_action when 'approve' then 'approved' when 'reimburse' then 'reimbursed'
        when 'link' then e.state else p_action end,
      approved_amount = coalesce(amount, e.approved_amount),
      review_note = case when p_action in ('approve','correction','rejected') then note else e.review_note end,
      invoice_id = case when p_action in ('approve','link') then invoice else e.invoice_id end,
      paid_on = coalesce(paid, e.paid_on), payment_reference = coalesce(reference, e.payment_reference),
      revision = e.revision + 1, updated_at = now()
    where e.id = p_expense_id returning * into current_expense;
  end if;

  result := jsonb_build_object('id', current_expense.id, 'revision', current_expense.revision, 'state', current_expense.state);
  insert into private.lecturer_expense_commands(actor_id, request_id, expense_id, revision, command, result)
    values (who, p_request_id, current_expense.id, current_expense.revision, command, result);
  insert into public.audit_events(actor_id, action, resource_id, details)
    values (who, 'expense.' || p_action, current_expense.id, jsonb_build_object('revision', current_expense.revision));
  return result;
end;
$$;

-- Keep the original settlement journal API stable. The portal opts into
-- an extended journal with reimbursements from the same expense authority.
create function private.accounting_settlement_with_expenses(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  base jsonb := private.accounting_settlement_journal(p_from, p_to);
  expense_items jsonb;
  expense_totals jsonb;
begin
  if not coalesce(private.expense_access(true), false) then return base; end if;
  with posted as materialized (
    select e.id, e.claim_id, e.paid_on, e.approved_amount, e.currency, e.payment_reference,
      command.recorded_at
    from private.lecturer_expenses e
    join private.lecturer_expense_commands command on command.expense_id = e.id and command.command->>0 = 'reimburse'
    where e.state = 'reimbursed' and e.paid_on between p_from and p_to
    order by e.paid_on desc, command.recorded_at desc, e.id
    limit 5001
  ), sums as (
    select currency, sum(approved_amount)::numeric(16,2)::text as amount from posted group by currency
  )
  select coalesce((select jsonb_agg(jsonb_build_object(
    'kind', 'expense_reimbursement', 'id', id, 'reverses_id', null, 'subject_id', claim_id,
    'effective_on', paid_on, 'recorded_at', recorded_at, 'currency', currency,
    'amount', approved_amount::text, 'reference', payment_reference
  ) order by paid_on desc, recorded_at desc, id) from posted), '[]'::jsonb),
  coalesce((select jsonb_agg(jsonb_build_object(
    'kind', 'expense_reimbursement', 'currency', currency, 'recorded', amount, 'reversed', '0.00', 'net', amount
  ) order by currency) from sums), '[]'::jsonb)
  into expense_items, expense_totals;
  if jsonb_array_length(base->'items') + jsonb_array_length(expense_items) > 5000 then
    raise exception 'More than 5000 entries in period. Select a shorter period' using errcode = 'PT413';
  end if;
  return base || jsonb_build_object('items', (
    select coalesce(jsonb_agg(value order by value->>'effective_on' desc, (value->>'recorded_at')::timestamptz desc,
      value->>'kind', value->>'id', value->>'reverses_id' nulls first), '[]'::jsonb)
    from jsonb_array_elements((base->'items') || expense_items)
  ), 'totals', (
    select coalesce(jsonb_agg(value order by value->>'currency', value->>'kind'), '[]'::jsonb)
    from jsonb_array_elements((base->'totals') || expense_totals)
  ));
end;
$$;

create function public.accounting_settlement_with_expenses(p_from date, p_to date)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.accounting_settlement_with_expenses(p_from, p_to);
$$;

create function public.reserve_expense_receipt(p_name text,p_mime text,p_size bigint,p_client_id uuid,p_sha256 text)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.reserve_expense_receipt(p_name,p_mime,p_size,p_client_id,p_sha256);
$$;
create function public.expense_receipt_upload_status(p_document_id uuid,p_version_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.expense_receipt_upload_status(p_document_id,p_version_id);
$$;
create function public.expense_receipt_download(p_expense_id uuid,p_version_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.expense_receipt_download(p_expense_id,p_version_id);
$$;
create function public.lecturer_expense_options()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.lecturer_expense_options();
$$;
create function public.lecturer_expense_report(
  p_staff boolean, p_from date, p_through date, p_state text default null, p_currency text default null,
  p_assignment uuid default null, p_lecturer uuid default null, p_customer uuid default null, p_course uuid default null
) returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.lecturer_expense_report(p_staff,p_from,p_through,p_state,p_currency,p_assignment,p_lecturer,p_customer,p_course);
$$;
create function public.lecturer_expense_invoices(p_expense_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.lecturer_expense_invoices(p_expense_id);
$$;
create function public.lecturer_expense_action(p_action text,p_expense_id uuid,p_expected_revision integer,p_payload jsonb,p_request_id uuid)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.lecturer_expense_action(p_action,p_expense_id,p_expected_revision,p_payload,p_request_id);
$$;

revoke all on function private.expense_access(boolean) from public, anon, authenticated, service_role;

do $grants$
declare signature text;
begin
  foreach signature in array array[
    'reserve_expense_receipt(text,text,bigint,uuid,text)', 'expense_receipt_upload_status(uuid,uuid)',
    'expense_receipt_download(uuid,uuid)', 'lecturer_expense_options()', 'lecturer_expense_invoices(uuid)',
    'lecturer_expense_report(boolean,date,date,text,text,uuid,uuid,uuid,uuid)',
    'lecturer_expense_action(text,uuid,integer,jsonb,uuid)', 'accounting_settlement_with_expenses(date,date)'
  ] loop
    execute 'revoke all on function private.' || signature || ', public.' || signature || ' from public, anon, authenticated, service_role';
    execute 'grant execute on function private.' || signature || ', public.' || signature || ' to authenticated';
  end loop;
end;
$grants$;

commit;
