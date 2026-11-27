begin;

-- Keep discovery's already-authorized quote projection aligned with job detail
-- and offer reads: a lecturer's saved personal compensation overrides the
-- role percentage captured on the offer.
create or replace function private.job_discovery_quote_authorized(
  p_job_id uuid,
  p_include_version boolean
)
returns table(amount numeric, total_amount numeric, terms_version integer)
language sql stable strict security invoker set search_path = '' as $$
  select
    case when job.company_internal then null
      when offer.pricing_mode = 'role_split'
      then case when private.lecturer_actor()
        then (private.lecturer_job_quote(auth.uid(), job.id)->>'amount')::numeric end
      else job.amount end,
    case when job.company_internal then null
      when offer.pricing_mode = 'role_split'
      then case when private.lecturer_actor()
        then (private.lecturer_job_quote(auth.uid(), job.id)->>'total_amount')::numeric end
      else job.total_amount end,
    case when not p_include_version then null
      when offer.pricing_mode = 'role_split' and private.lecturer_actor()
      then private.role_quote_version(job.terms_version, auth.uid())
      else job.terms_version end
  from public.jobs job
  left join private.job_commission_offers offer on offer.job_id = job.id
  where job.id = p_job_id;
$$;

commit;
