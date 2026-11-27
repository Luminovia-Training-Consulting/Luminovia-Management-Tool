begin;

-- Reconcile the selected assignments in one MVCC snapshot. Reports are limited
-- before the per-assignment queries, and incomplete files are never returned.
create function private.assignment_finance_export(p_from date, p_through date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  tz text;
  begins timestamptz;
  ends timestamptz;
  claims uuid[];
  report jsonb;
begin
  if not coalesce(private.expense_access(true), false) then raise insufficient_privilege; end if;
  if p_from is null or p_through is null or not isfinite(p_from) or not isfinite(p_through)
    or p_from > p_through or p_through - p_from >= 93
    then raise exception 'Choose a period of up to 93 days' using errcode = '22023'; end if;

  select time_zone into strict tz from public.profiles where id = auth.uid();
  begins := p_from::timestamp at time zone tz;
  ends := (p_through + 1)::timestamp at time zone tz;

  -- Include a released slot in the historical selection. Legacy claims with no
  -- recorded slots are assigned to their acceptance date instead.
  with overlapping as materialized (
    select session.claim_id
    from public.assignment_sessions session
    where session.starts_at < ends and session.ends_at > begins
    group by session.claim_id
    limit 1001
  ), selected as (
    select claim_id from overlapping
    union all
    select claim.id from public.job_claims claim
    where claim.created_at >= begins and claim.created_at < ends
      and not exists (select 1 from public.assignment_sessions slot where slot.claim_id = claim.id)
    limit 1001
  )
  select coalesce(array_agg(claim_id), '{}') into claims from selected;

  if cardinality(claims) > 1000
    then raise exception 'More than 1000 assignments match; shorten the date range' using errcode = '54000'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'claim_id', claim.id,
    'job_id', job.id,
    'title', job.title,
    'lecturer_name', lecturer.display_name,
    'customer_name', job.customer_name,
    'finance', private.assignment_finance_reconciliation(claim.id)
  ) order by job.title, claim.id), '[]'::jsonb) into report
  from public.job_claims claim
  join public.jobs job on job.id = claim.job_id
  join public.profiles lecturer on lecturer.id = claim.lecturer_id
  where claim.id = any(claims);
  return jsonb_build_object('schema_version', 1, 'from', p_from, 'through', p_through,
    'time_zone', tz, 'generated_at', statement_timestamp(), 'assignments', report);
end;
$$;

create function public.assignment_finance_export(p_from date, p_through date)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.assignment_finance_export(p_from, p_through);
$$;
revoke all on function private.assignment_finance_export(date, date),
  public.assignment_finance_export(date, date) from public, anon, authenticated, service_role;
grant execute on function private.assignment_finance_export(date, date),
  public.assignment_finance_export(date, date) to authenticated;

notify pgrst, 'reload schema';
commit;
