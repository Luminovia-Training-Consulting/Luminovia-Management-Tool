begin;

-- Credit applications and recorded cash refunds are independent of issued
-- documents and the released invoice/payment export. Both journals append.
create table private.accounting_customer_credit_applications (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references private.accounting_customer_invoices(id),
  credit_note_id uuid not null references private.accounting_customer_credit_notes(id),
  reverses_id uuid unique references private.accounting_customer_credit_applications(id),
  reason text not null check (length(reason) between 5 and 1000),
  recorded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default clock_timestamp()
);
create table private.accounting_customer_refunds (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references private.accounting_customer_invoices(id),
  reverses_id uuid unique references private.accounting_customer_refunds(id),
  amount numeric(12,2) not null check (amount > 0),
  refunded_at timestamptz,
  reference text not null check (length(reference) between 1 and 1000),
  recorded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default clock_timestamp(),
  check ((reverses_id is null) = (refunded_at is not null))
);
create index accounting_credit_application_invoice on private.accounting_customer_credit_applications(invoice_id);
create index accounting_credit_application_note on private.accounting_customer_credit_applications(credit_note_id);
create index accounting_credit_application_recorder on private.accounting_customer_credit_applications(recorded_by);
create index accounting_customer_refund_invoice on private.accounting_customer_refunds(invoice_id);
create index accounting_customer_refund_recorder on private.accounting_customer_refunds(recorded_by);
alter table private.accounting_customer_credit_applications enable row level security;
alter table private.accounting_customer_refunds enable row level security;
revoke all on private.accounting_customer_credit_applications, private.accounting_customer_refunds
  from public, anon, authenticated, service_role;
create trigger immutable_customer_credit_application before update or delete
  on private.accounting_customer_credit_applications for each row execute function private.immutable_accounting_record();
create trigger immutable_customer_refund before update or delete
  on private.accounting_customer_refunds for each row execute function private.immutable_accounting_record();

create function private.calculate_customer_settlement(p_invoice_id uuid)
returns table(
  original_total numeric, credit_total numeric, net_total numeric,
  received_total numeric, refunded_total numeric, retained_total numeric,
  outstanding_total numeric, refund_due_total numeric
)
language sql stable security invoker set search_path = '' as $$
  select invoice.total_amount, credit.total, invoice.total_amount-credit.total,
    received.total, refund.total, received.total-refund.total,
    greatest(invoice.total_amount-credit.total-received.total+refund.total,0),
    greatest(received.total-refund.total-invoice.total_amount+credit.total,0)
  from private.accounting_customer_invoices invoice
  cross join lateral (
    select coalesce(sum(case when application.reverses_id is null then note.amount else -note.amount end),0) total
    from private.accounting_customer_credit_applications application
    join private.accounting_customer_credit_notes note on note.id=application.credit_note_id
    where application.invoice_id=invoice.id
  ) credit
  cross join lateral (
    select coalesce(sum(case when payment.reverses_id is null then payment.amount else -payment.amount end),0) total
    from private.accounting_customer_payments payment where payment.invoice_id=invoice.id
  ) received
  cross join lateral (
    select coalesce(sum(case when refund.reverses_id is null then refund.amount else -refund.amount end),0) total
    from private.accounting_customer_refunds refund where refund.invoice_id=invoice.id
  ) refund
  where invoice.id=p_invoice_id;
$$;

-- Reuse the existing accounting retry namespace. Callers first lock and
-- verify the current staff profile, then lock the invoice after retry lookup.
create function private.customer_settlement_retry(p_request_id uuid, p_operation jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare previous private.accounting_operations;
begin
  if p_request_id is null then raise exception 'Accounting request ID required' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('accounting-actor:'||auth.uid()::text,0));
  select * into previous from private.accounting_operations where actor_id=auth.uid() and request_id=p_request_id;
  if not found then return null; end if;
  if previous.payload is distinct from p_operation then
    raise exception 'Accounting request key conflict' using errcode='22023';
  end if;
  return previous.result;
end;
$$;
revoke all on function private.calculate_customer_settlement(uuid), private.customer_settlement_retry(uuid,jsonb)
  from public, anon, authenticated, service_role;

create function private.change_customer_credit_application(
  p_invoice_id uuid, p_credit_note_id uuid, p_application_id uuid, p_reason text, p_request_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  note private.accounting_customer_credit_notes;
  previous private.accounting_customer_credit_applications;
  position record;
  operation jsonb;
  result jsonb;
  service_action text;
  entry_id uuid;
begin
  perform 1 from public.profiles profile where profile.id=auth.uid() and profile.active for share;
  if not found or not private.can_manage_customer_credit_notes() then
    raise exception 'Customer finance permission required' using errcode='42501';
  end if;
  if p_invoice_id is null or (p_credit_note_id is null) = (p_application_id is null)
    or p_reason is null or length(btrim(p_reason)) not between 5 and 1000 then
    raise exception 'Invoice, credit note or application, and reason required' using errcode='22023';
  end if;
  service_action := case when p_application_id is null then 'customer_credit_note_applied' else 'customer_credit_application_reversed' end;
  operation := jsonb_build_object('action',service_action,'invoice_id',p_invoice_id,
    'credit_note_id',p_credit_note_id,'application_id',p_application_id,'reason',p_reason);
  result := private.customer_settlement_retry(p_request_id,operation);
  if result is not null then return result; end if;

  perform 1 from private.accounting_customer_invoices invoice where invoice.id=p_invoice_id for update;
  if not found then raise exception 'Customer invoice unavailable' using errcode='42501'; end if;
  select * into strict position from private.calculate_customer_settlement(p_invoice_id);
  if p_application_id is null then
    select * into note from private.accounting_customer_credit_notes
    where id=p_credit_note_id and invoice_id=p_invoice_id;
    if not found then raise exception 'Credit note unavailable for this invoice' using errcode='42501'; end if;
    if exists (
      select 1 from private.accounting_customer_credit_applications application
      where application.credit_note_id=note.id and application.reverses_id is null
        and not exists (select 1 from private.accounting_customer_credit_applications reversal where reversal.reverses_id=application.id)
    ) then
      raise exception 'Credit note is already applied' using errcode='PT409';
    end if;
    if note.amount>position.net_total then raise exception 'Credit exceeds remaining invoice face amount' using errcode='22023'; end if;
  else
    select * into previous from private.accounting_customer_credit_applications
    where id=p_application_id and invoice_id=p_invoice_id and reverses_id is null;
    if not found then raise exception 'Credit application unavailable for this invoice' using errcode='42501'; end if;
    if exists (select 1 from private.accounting_customer_credit_applications reversal where reversal.reverses_id=previous.id) then
      raise exception 'Credit application is already reversed' using errcode='PT409';
    end if;
    select * into strict note from private.accounting_customer_credit_notes where id=previous.credit_note_id;
    if position.refunded_total>greatest(position.received_total-(position.net_total+note.amount),0) then
      raise exception 'Credit reversal would invalidate a recorded refund' using errcode='PT409';
    end if;
  end if;

  insert into private.accounting_customer_credit_applications(invoice_id,credit_note_id,reverses_id,reason,recorded_by)
    values(p_invoice_id,note.id,p_application_id,btrim(p_reason),auth.uid()) returning id into entry_id;
  result := jsonb_build_object('id',entry_id);
  insert into private.accounting_operations(actor_id,request_id,payload,result)
    values(auth.uid(),p_request_id,operation,result);
  insert into public.audit_events(actor_id,action,resource_id)
    values(auth.uid(),'accounting.'||service_action,entry_id);
  return result;
end;
$$;

create function private.change_customer_invoice_refund(
  p_invoice_id uuid, p_amount text, p_refunded_at timestamptz, p_reference text,
  p_refund_id uuid, p_request_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  previous private.accounting_customer_refunds;
  position record;
  amount numeric;
  entry_id uuid;
  service_action text;
  operation jsonb;
  result jsonb;
begin
  perform 1 from public.profiles profile where profile.id=auth.uid() and profile.active for share;
  if not found or not private.can_manage_customer_credit_notes() then
    raise exception 'Customer finance permission required' using errcode='42501';
  end if;
  if p_invoice_id is null or p_reference is null then
    raise exception 'Invoice and refund reference or reversal reason required' using errcode='22023';
  end if;
  if p_refund_id is null then
    if p_amount is null or p_amount !~ '^(0|[1-9][0-9]{0,9})\.[0-9]{2}$'
      or p_refunded_at is null or not isfinite(p_refunded_at) or p_refunded_at>clock_timestamp()
      or length(btrim(p_reference)) not between 1 and 120 or p_reference~'[[:cntrl:]]' then
      raise exception 'Exact amount, historic refund instant and transaction reference required' using errcode='22023';
    end if;
    amount := p_amount::numeric;
    if amount<=0 then raise exception 'Positive refund amount required' using errcode='22023'; end if;
  elsif p_amount is not null or p_refunded_at is not null or length(btrim(p_reference)) not between 5 and 1000 then
    raise exception 'Exact refund and reversal reason required' using errcode='22023';
  end if;
  service_action := case when p_refund_id is null then 'customer_refund_recorded' else 'customer_refund_reversed' end;
  operation := jsonb_build_object('action',service_action,'invoice_id',p_invoice_id,'amount',p_amount,
    'refunded_at',p_refunded_at,'reference',p_reference,'refund_id',p_refund_id);
  result := private.customer_settlement_retry(p_request_id,operation);
  if result is not null then return result; end if;

  perform 1 from private.accounting_customer_invoices invoice where invoice.id=p_invoice_id for update;
  if not found then raise exception 'Customer invoice unavailable' using errcode='42501'; end if;
  if p_refund_id is null then
    select * into strict position from private.calculate_customer_settlement(p_invoice_id);
    if amount>position.refund_due_total then
      raise exception 'Recorded refund exceeds current refundable overpayment' using errcode='PT409';
    end if;
    if exists (
      select 1 from private.accounting_customer_refunds refund
      where refund.invoice_id=p_invoice_id and lower(refund.reference)=lower(btrim(p_reference)) and refund.reverses_id is null
        and not exists (select 1 from private.accounting_customer_refunds reversal where reversal.reverses_id=refund.id)
    ) then
      raise exception 'This refund transaction reference is already recorded' using errcode='PT409';
    end if;
  else
    select * into previous from private.accounting_customer_refunds
    where id=p_refund_id and invoice_id=p_invoice_id and reverses_id is null;
    if not found then raise exception 'Refund unavailable for this invoice' using errcode='42501'; end if;
    if exists (select 1 from private.accounting_customer_refunds reversal where reversal.reverses_id=previous.id) then
      raise exception 'Refund is already reversed' using errcode='PT409';
    end if;
    amount := previous.amount;
  end if;

  insert into private.accounting_customer_refunds(invoice_id,reverses_id,amount,refunded_at,reference,recorded_by)
    values(p_invoice_id,p_refund_id,amount,p_refunded_at,btrim(p_reference),auth.uid()) returning id into entry_id;
  result := jsonb_build_object('id',entry_id);
  insert into private.accounting_operations(actor_id,request_id,payload,result)
    values(auth.uid(),p_request_id,operation,result);
  insert into public.audit_events(actor_id,action,resource_id)
    values(auth.uid(),'accounting.'||service_action,entry_id);
  return result;
end;
$$;

create function private.accounting_customer_settlement(p_invoice_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb; finance boolean;
begin
  if not private.can_read_customer_invoice(p_invoice_id)
    or not exists (select 1 from private.installation_identity where edition='internal') then
    raise exception 'Current customer invoice access required' using errcode='42501';
  end if;
  finance := private.can_manage_customer_credit_notes();
  select jsonb_build_object(
    'invoice_id',invoice.id,'currency',invoice.currency,'can_manage',finance,
    'original_total',position.original_total::numeric(12,2)::text,
    'credit_total',position.credit_total::numeric(12,2)::text,'net_total',position.net_total::numeric(12,2)::text,
    'received_total',position.received_total::numeric(12,2)::text,'refunded_total',position.refunded_total::numeric(12,2)::text,
    'retained_total',position.retained_total::numeric(12,2)::text,
    'outstanding_total',position.outstanding_total::numeric(12,2)::text,'refund_due_total',position.refund_due_total::numeric(12,2)::text,
    'status',case
      when position.refund_due_total>0 then 'refund_due'
      when position.outstanding_total=0 and position.refunded_total>0 then 'refunded'
      when position.outstanding_total=0 and position.net_total=0 then 'fully_credited'
      when position.outstanding_total=0 then 'settled'
      when position.retained_total>0 then 'partially_paid'
      else 'open' end,
    'credit_applications',case when finance then (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id',entry.id,'credit_note_id',entry.credit_note_id,'reference',note.reference,'amount',note.amount::text,
        'reverses_id',entry.reverses_id,'reason',entry.reason,'created_at',entry.created_at
      ) order by entry.created_at,entry.id),'[]'::jsonb)
      from private.accounting_customer_credit_applications entry
      join private.accounting_customer_credit_notes note on note.id=entry.credit_note_id
      where entry.invoice_id=invoice.id
    ) end,
    'refunds',case when finance then (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id',entry.id,'amount',entry.amount::text,'reference',entry.reference,'reverses_id',entry.reverses_id,
        'refunded_at',entry.refunded_at,'created_at',entry.created_at
      ) order by entry.created_at,entry.id),'[]'::jsonb)
      from private.accounting_customer_refunds entry where entry.invoice_id=invoice.id
    ) end
  ) into strict result
  from private.accounting_customer_invoices invoice
  cross join lateral private.calculate_customer_settlement(invoice.id) position
  where invoice.id=p_invoice_id;
  return result;
end;
$$;

create function public.apply_customer_invoice_credit_note(
  p_invoice_id uuid, p_credit_note_id uuid, p_reason text, p_request_id uuid
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.change_customer_credit_application(p_invoice_id,p_credit_note_id,null,p_reason,p_request_id);
$$;
create function public.reverse_customer_invoice_credit_note(
  p_invoice_id uuid, p_application_id uuid, p_reason text, p_request_id uuid
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.change_customer_credit_application(p_invoice_id,null,p_application_id,p_reason,p_request_id);
$$;
create function public.record_customer_invoice_refund(
  p_invoice_id uuid, p_amount text, p_refunded_at timestamptz, p_reference text, p_request_id uuid
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.change_customer_invoice_refund(p_invoice_id,p_amount,p_refunded_at,p_reference,null,p_request_id);
$$;
create function public.reverse_customer_invoice_refund(
  p_invoice_id uuid, p_refund_id uuid, p_reason text, p_request_id uuid
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.change_customer_invoice_refund(p_invoice_id,null,null,p_reason,p_refund_id,p_request_id);
$$;
create function public.accounting_customer_settlement(p_invoice_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.accounting_customer_settlement(p_invoice_id);
$$;
revoke all on function private.change_customer_credit_application(uuid,uuid,uuid,text,uuid),
  private.change_customer_invoice_refund(uuid,text,timestamptz,text,uuid,uuid), private.accounting_customer_settlement(uuid),
  public.apply_customer_invoice_credit_note(uuid,uuid,text,uuid), public.reverse_customer_invoice_credit_note(uuid,uuid,text,uuid),
  public.record_customer_invoice_refund(uuid,text,timestamptz,text,uuid), public.reverse_customer_invoice_refund(uuid,uuid,text,uuid),
  public.accounting_customer_settlement(uuid)
from public, anon, authenticated, service_role;
grant execute on function private.change_customer_credit_application(uuid,uuid,uuid,text,uuid),
  private.change_customer_invoice_refund(uuid,text,timestamptz,text,uuid,uuid), private.accounting_customer_settlement(uuid),
  public.apply_customer_invoice_credit_note(uuid,uuid,text,uuid), public.reverse_customer_invoice_credit_note(uuid,uuid,text,uuid),
  public.record_customer_invoice_refund(uuid,text,timestamptz,text,uuid), public.reverse_customer_invoice_refund(uuid,uuid,text,uuid),
  public.accounting_customer_settlement(uuid)
to authenticated;

-- Keep actual received-payment evidence up to the original invoice amount.
-- A late transfer can create a refundable surplus after a credit application.
do $migration$
declare
  original text := pg_catalog.pg_get_functiondef('private.customer_invoice_payment(uuid,text,timestamptz,text,uuid,uuid)'::regprocedure);
  updated text;
begin
  updated := replace(original, 'amount numeric;paid numeric;payment uuid;', 'amount numeric;position record;payment uuid;');
  if updated=original then raise exception 'Customer payment declaration seam missing'; end if;
  original := updated;
  updated := replace(original, $old$ if not found then raise exception 'Customer invoice unavailable' using errcode='42501';end if;
 if p_reverses_id is not null then$old$, $new$ if not found then raise exception 'Customer invoice unavailable' using errcode='42501';end if;
 select * into strict position from private.calculate_customer_settlement(invoice.id);
 if p_reverses_id is not null then$new$);
  if updated=original then raise exception 'Customer payment lock seam missing'; end if;
  original := updated;
  updated := replace(original, $old$  amount:=previous.amount;
 else
  amount:=p_amount::numeric;
  select coalesce(sum(case when p.reverses_id is null then p.amount else -p.amount end),0) into paid from private.accounting_customer_payments p where p.invoice_id=invoice.id;
  if amount<=0 or paid+amount>invoice.total_amount then raise exception 'Payment exceeds the recorded invoice total' using errcode='22023';end if;$old$,
    $new$  amount:=previous.amount;
  if position.refunded_total>greatest(position.received_total-amount-position.net_total,0) then
   raise exception 'Payment reversal would invalidate a recorded refund' using errcode='PT409';
  end if;
 else
  amount:=p_amount::numeric;
  if amount<=0 or position.received_total+amount>invoice.total_amount then
   raise exception 'Payment exceeds the recorded invoice total' using errcode='22023';
  end if;$new$);
  if updated=original then raise exception 'Customer payment amount seam missing'; end if;
  execute updated;
end;
$migration$;

notify pgrst, 'reload schema';
commit;
