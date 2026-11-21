begin;

-- An approval resolves the incoming review. Keep outstanding approvals
-- discoverable after refreshing or changing to a different finance session.
create function private.finance_pending_invoice_exceptions()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.has_permission('finance.manage')
    or not exists (select 1 from private.installation_identity where edition = 'internal') then
    raise insufficient_privilege;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'request_id', approval.request_id, 'title', job.title, 'lecturer_name', profile.display_name
    ) order by approval.approved_at, approval.id)
    from private.invoice_exception_approvals approval
    join public.job_claims claim on claim.id = approval.claim_id
    join public.jobs job on job.id = claim.job_id
    join public.profiles profile on profile.id = claim.lecturer_id
    where approval.revoked_at is null
      and not exists (select 1 from public.invoice_items item where item.claim_id = claim.id and item.active)
  ), '[]'::jsonb);
end;
$$;

create function public.finance_pending_invoice_exceptions()
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.finance_pending_invoice_exceptions(); $$;

revoke all on function private.finance_pending_invoice_exceptions(), public.finance_pending_invoice_exceptions()
from public, anon, authenticated, service_role;
grant execute on function private.finance_pending_invoice_exceptions(), public.finance_pending_invoice_exceptions()
to authenticated;
notify pgrst, 'reload schema';

commit;
