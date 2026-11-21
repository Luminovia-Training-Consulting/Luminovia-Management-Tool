begin;

-- Job/assignment mutations take the lecturer's actor lock before locking the
-- claim. Take that same lock before session eligibility inspects the claim,
-- then retain the existing invoice idempotency and exact PDF checks.
alter function private.submit_invoice(text,uuid[],uuid,date,date,uuid)
  rename to submit_invoice_with_session_eligibility;
revoke all on function private.submit_invoice_with_session_eligibility(text,uuid[],uuid,date,date,uuid)
  from public,anon,authenticated,service_role;
create function private.submit_invoice(
  p_number text,p_claim_ids uuid[],p_document_version_id uuid,p_issued_on date,
  p_due_on date default null,p_client_id uuid default null
) returns uuid language plpgsql security definer set search_path='' as $$
begin
  if not private.lecturer_actor() then raise insufficient_privilege; end if;
  perform 1 from public.profiles where id=auth.uid() and active for share;
  if not found then raise insufficient_privilege; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text,0));
  return private.submit_invoice_with_session_eligibility(
    p_number,p_claim_ids,p_document_version_id,p_issued_on,p_due_on,p_client_id
  );
end;
$$;
revoke all on function private.submit_invoice(text,uuid[],uuid,date,date,uuid)
  from public,anon,authenticated,service_role;
grant execute on function private.submit_invoice(text,uuid[],uuid,date,date,uuid) to authenticated;
commit;
