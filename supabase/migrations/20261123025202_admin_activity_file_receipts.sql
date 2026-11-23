begin;

-- Record the clean transition in the same transaction as publication. A
-- quarantined file, rejected scan or retry of an already clean version does not
-- count as another completed upload. Keep private communications and personal
-- records outside the administrative file journal.
create function private.admin_activity_record_upload() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (
    select 1 from public.documents d
    where d.id = new.document_id and d.current_version_id = new.id
      and d.deleted_at is null and d.scope in ('personal','job_before','job_after')
      and d.kind in ('material','invoice','participant_submission')
  ) then
    perform private.write_admin_activity(new.uploaded_by, 'document.uploaded', new.document_id, '{}'::jsonb);
  end if;
  return null;
end;
$$;
revoke all on function private.admin_activity_record_upload() from public, anon, authenticated, service_role;
create trigger admin_activity_clean_upload
after update of status on public.document_versions
for each row
when (old.status is distinct from new.status and new.status = 'clean'
  and new.sha256 ~ '^[0-9a-f]{64}$' and new.scanner_version is not null)
execute function private.admin_activity_record_upload();

-- The external source does not have an actor account. Receipt insertion follows
-- the validated enquiry commit, rather than the HTTP attempt or retried submission.
create function private.admin_activity_record_enquiry() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.write_admin_activity(null, 'enquiry.received', new.id, '{}'::jsonb);
  return null;
end;
$$;
revoke all on function private.admin_activity_record_enquiry() from public, anon, authenticated, service_role;
create trigger admin_activity_received_enquiry
after insert on private.website_enquiries
for each row execute function private.admin_activity_record_enquiry();

-- Called exclusively by the serving worker, after the exact bytes were obtained
-- and the current caller was reauthorised. Clients cannot invent transfer logs.
create function private.record_admin_file_download(p_actor_id uuid, p_resource_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if current_setting('role', true) is distinct from 'service_role'
     or p_actor_id is null or p_resource_id is null
     or not exists (select 1 from public.profiles p where p.id = p_actor_id and p.active) then
    raise insufficient_privilege;
  end if;
  perform private.write_admin_activity(p_actor_id, 'document.file_downloaded', p_resource_id, '{}'::jsonb);
end;
$$;
create function public.record_admin_file_download(p_actor_id uuid, p_resource_id uuid) returns void
language sql security invoker set search_path = '' as $$
  select private.record_admin_file_download(p_actor_id, p_resource_id);
$$;
revoke all on function private.record_admin_file_download(uuid, uuid),
  public.record_admin_file_download(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function private.record_admin_file_download(uuid, uuid),
  public.record_admin_file_download(uuid, uuid) to service_role;

-- Match the existing worker-only Academy pre-request branch. Authenticated and
-- anonymous requests cannot reach this RPC, even inside an active edition.
do $$
declare
  definition text := pg_get_functiondef('public.require_portal_access()'::regprocedure);
  anchor constant text := '''/rpc/course_submission_storage_path''';
begin
  if cardinality(string_to_array(definition, anchor)) <> 2 then
    raise exception 'Expected the dedicated document worker gate';
  end if;
  execute replace(definition, anchor, anchor || ', ''/rpc/record_admin_file_download''');
end;
$$;

-- The journal never copies bank references or invoice snapshots. An authorised
-- finance viewer may resolve the exact amount and original currency of an already
-- scoped audit row from the corresponding immutable ledger.
create function private.admin_audit_payment_facts(p_action text, p_resource_id uuid) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  amount text;
  currency text;
begin
  if p_action in ('accounting.customer_payment_recorded', 'accounting.customer_payment_reversed') then
    if not private.has_permission('finance.gross.read') then return null; end if;
    select p.amount::text, i.currency into amount, currency
    from private.accounting_customer_payments p
    join private.accounting_customer_invoices i on i.id = p.invoice_id
    where p.id = p_resource_id;
  elsif p_action in ('accounting.customer_refund_recorded', 'accounting.customer_refund_reversed') then
    if not private.has_permission('finance.gross.read') then return null; end if;
    select r.amount::text, i.currency into amount, currency
    from private.accounting_customer_refunds r
    join private.accounting_customer_invoices i on i.id = r.invoice_id
    where r.id = p_resource_id;
  elsif p_action in ('invoice.payment_recorded', 'invoice.payment_voided') then
    if not private.has_permission('finance.manage') then return null; end if;
    select p.amount::text, p.currency into amount, currency
    from public.payment_records p where p.id = p_resource_id;
  elsif p_action in ('invoice.series_repayment_recorded', 'invoice.series_repayment_voided') then
    if not private.has_permission('finance.manage') then return null; end if;
    select r.amount::text, c.currency into amount, currency
    from private.invoice_series_repayments r
    join private.invoice_series_corrections c on c.id = r.correction_id
    where r.id = p_resource_id;
  end if;
  if amount is null or currency is null then return null; end if;
  return jsonb_build_object('amount', amount, 'currency', currency);
end;
$$;
revoke all on function private.admin_audit_payment_facts(text, uuid)
  from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';
commit;
