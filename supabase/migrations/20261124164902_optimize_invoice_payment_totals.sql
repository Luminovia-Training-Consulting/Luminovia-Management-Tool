begin;

create or replace function private.invoice_records(p_all boolean default false)
returns table(
  id uuid, user_id uuid, user_name text, number text, issued_on date,
  due_on date, currency text, total_amount numeric, paid_amount numeric,
  status text, document_id uuid, document_version_id uuid, claim_ids uuid[],
  created_at timestamptz, note text, paid_at timestamptz, labels text[]
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.actor_active() or (p_all and not private.has_permission('finance.manage')) then
    raise exception 'Own invoices or finance management and MFA required' using errcode = '42501';
  end if;

  return query
  select i.id, i.user_id, p.display_name, i.number, i.issued_on, i.due_on,
    i.currency, i.total_amount, coalesce(payment.total, 0), i.status,
    v.document_id, i.document_version_id,
    coalesce((
      select array_agg(item.claim_id order by item.claim_id)
      from public.invoice_items item
      where item.invoice_id = i.id
    ), '{}'::uuid[]),
    i.created_at, i.note, payment.last_paid_at, i.labels
  from public.invoices i
  join public.profiles p on p.id = i.user_id
  join public.document_versions v on v.id = i.document_version_id
  cross join lateral (
    select sum(r.amount) as total, max(r.paid_at) as last_paid_at
    from public.payment_records r
    where r.invoice_id = i.id and r.voided_at is null
  ) payment
  where p_all or i.user_id = auth.uid()
  order by i.created_at desc, i.id;
end;
$$;

commit;
