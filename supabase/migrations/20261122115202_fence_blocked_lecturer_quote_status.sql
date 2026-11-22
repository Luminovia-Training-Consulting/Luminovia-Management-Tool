begin;

-- Check the current lecturer restriction before returning a personalised
-- pricing status. Existing idempotent receipts still use the original path.
create or replace function private.claim_job(p_job_id uuid, p_idempotency_key uuid, p_terms_version integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
begin
  if not private.actor_active() then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  perform 1 from public.profiles where id = actor and active for share;
  if private.lecturer_actor() and not exists (
    select 1 from public.job_claims claim
    where claim.lecturer_id = actor and claim.idempotency_key = p_idempotency_key
  ) then
    if private.job_lecturer_blocked(p_job_id, actor) then
      return jsonb_build_object('status', 'not_eligible');
    end if;
    if exists (
      select 1 from private.job_commission_offers offer
      where offer.job_id = p_job_id and offer.pricing_mode = 'role_split'
    ) and private.lecturer_job_quote(actor, p_job_id) is null then
      return jsonb_build_object('status', 'quote_unavailable');
    end if;
  end if;
  return private.claim_job_before_personal_compensation(p_job_id, p_idempotency_key, p_terms_version);
end;
$$;

commit;
