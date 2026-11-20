begin;

-- Keep cancellation/partial-block questions separate from invoices and payment
-- records. A review outcome never changes accepted compensation automatically.
create table private.invoice_review_requests (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.job_claims(id),
  requested_by uuid not null references auth.users(id),
  request_id uuid not null,
  reason text not null check (
    reason in ('cancelled', 'partial_delivery', 'schedule_mismatch')
  ),
  status text not null default 'pending' check (status in ('pending', 'resolved')),
  requested_at timestamptz not null default now(),
  resolved_by uuid references auth.users(id),
  resolved_at timestamptz,
  resolution_note text,
  unique (requested_by, request_id),
  check (
    (status = 'pending' and resolved_by is null and resolved_at is null and resolution_note is null) or
    (status = 'resolved' and resolved_by is not null and resolved_at is not null and resolution_note is not null)
  )
);
create unique index invoice_review_one_pending_per_claim
  on private.invoice_review_requests(claim_id) where status = 'pending';
create index invoice_review_requested_by_time
  on private.invoice_review_requests(requested_by, requested_at desc);
create index invoice_review_pending_time
  on private.invoice_review_requests(requested_at desc) where status = 'pending';
revoke all on private.invoice_review_requests from public, anon, authenticated, service_role;

-- Return only the caller's own cancelled/partial blocks and their review state.
create function private.my_invoice_review_candidates()
returns table(
  claim_id uuid, job_id uuid, title text, claim_status text,
  reason text, review_status text, requested_at timestamptz,
  resolution_note text, scheduled_end timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.lecturer_actor() then
    raise exception 'Active lecturer required' using errcode = '42501';
  end if;
  return query
  select c.id, c.job_id, j.title, c.status,
    case
      when c.status = 'cancelled' then 'cancelled'
      when not exists (
        select 1 from public.assignment_sessions s where s.claim_id = c.id
      ) then 'schedule_mismatch'
      else 'partial_delivery'
    end,
    latest.status, latest.requested_at, latest.resolution_note,
    (select max(s.ends_at) from public.assignment_sessions s where s.claim_id = c.id)
  from public.job_claims c
  join public.jobs j on j.id = c.job_id
  left join lateral (
    select r.status, r.requested_at, r.resolution_note
    from private.invoice_review_requests r
    where r.claim_id = c.id and r.requested_by = auth.uid()
    order by r.requested_at desc, r.id desc limit 1
  ) latest on true
  where c.lecturer_id = auth.uid() and c.status in ('confirmed', 'cancelled')
    and not exists (
      select 1 from public.invoice_items item
      where item.claim_id = c.id and item.active
    )
    and (
      c.status = 'cancelled' or
      exists (
        select 1 from public.assignment_sessions s
        where s.claim_id = c.id and s.released_at is not null
      ) or
      (select count(*) from public.assignment_sessions s where s.claim_id = c.id) <>
      (select count(*) from public.job_sessions s where s.job_id = c.job_id)
    )
  order by c.created_at desc, c.id;
end;
$$;

-- The review request is a record, not an invoice, sale or payment.
create function private.request_invoice_review(p_claim_id uuid, p_request_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  claim_row public.job_claims%rowtype;
  existing_request private.invoice_review_requests%rowtype;
  reason_value text;
  result_id uuid;
begin
  if not private.lecturer_actor() then
    raise exception 'Active lecturer required' using errcode = '42501';
  end if;
  if p_claim_id is null or p_request_id is null then
    raise exception 'Invoice review request ID required' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('invoice:' || auth.uid()::text, 0)
  );
  select * into existing_request
  from private.invoice_review_requests
  where requested_by = auth.uid() and request_id = p_request_id;
  if found then
    if existing_request.claim_id <> p_claim_id then
      raise exception 'Invoice review idempotency conflict' using errcode = '22023';
    end if;
    return existing_request.id;
  end if;
  select * into claim_row
  from public.job_claims
  where id = p_claim_id and lecturer_id = auth.uid()
  for update;
  if not found then
    raise exception 'Own accepted claim required' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.invoice_items item
    where item.claim_id = p_claim_id and item.active
  ) then
    raise exception 'Use the existing invoice review workflow' using errcode = '22023';
  end if;
  if claim_row.status = 'cancelled' then
    reason_value := 'cancelled';
  elsif claim_row.status = 'confirmed' then
    if not exists (
      select 1 from public.assignment_sessions s where s.claim_id = p_claim_id
    ) or (select count(*) from public.assignment_sessions s where s.claim_id = p_claim_id) <>
       (select count(*) from public.job_sessions s where s.job_id = claim_row.job_id) then
      reason_value := 'schedule_mismatch';
    elsif exists (
      select 1 from public.assignment_sessions s
      where s.claim_id = p_claim_id and s.released_at is not null
    ) then
      reason_value := 'partial_delivery';
    else
      raise exception 'Invoice block does not require a cancellation/partial-delivery review' using errcode = '22023';
    end if;
  else
    raise exception 'Invoice review is unavailable for this claim' using errcode = '22023';
  end if;

  select id into result_id
  from private.invoice_review_requests
  where claim_id = p_claim_id and status = 'pending'
  for update;
  if found then return result_id; end if;
  insert into private.invoice_review_requests(
    claim_id, requested_by, request_id, reason
  ) values (p_claim_id, auth.uid(), p_request_id, reason_value)
  returning id into result_id;
  insert into public.audit_events(actor_id, action, resource_id, details)
  values (
    auth.uid(), 'invoice.review_requested', result_id,
    jsonb_build_object('claim_id', p_claim_id, 'job_id', claim_row.job_id, 'reason', reason_value)
  );
  return result_id;
end;
$$;

-- Finance managers see the minimum claim/job context required to resolve a
-- lecturer's cancellation or partial-block review; no private documents bypass.
create function private.invoice_review_cases()
returns table(
  id uuid, claim_id uuid, job_id uuid, title text, lecturer_id uuid,
  lecturer_name text, reason text, requested_at timestamptz,
  scheduled_end timestamptz, accepted_total numeric, currency text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.has_permission('finance.manage') then
    raise exception 'Finance management required' using errcode = '42501';
  end if;
  return query
  select request.id, claim.id, job.id, job.title, claim.lecturer_id,
    profile.display_name, request.reason, request.requested_at,
    (select max(session.ends_at) from public.assignment_sessions session
     where session.claim_id = claim.id),
    claim.total_amount, claim.currency
  from private.invoice_review_requests request
  join public.job_claims claim on claim.id = request.claim_id
  join public.jobs job on job.id = claim.job_id
  join public.profiles profile on profile.id = claim.lecturer_id
  where request.status = 'pending'
  order by request.requested_at, request.id;
end;
$$;

-- Close a review queue item with an audit note only; resolution never writes
-- an invoice, payment, accepted fee or assignment status.
create function private.resolve_invoice_review_request(
  p_request_id uuid, p_note text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row private.invoice_review_requests%rowtype;
begin
  if not private.has_permission('finance.manage') then
    raise exception 'Finance management required' using errcode = '42501';
  end if;
  if p_request_id is null or p_note is null or
     length(btrim(p_note)) not between 10 and 1000 then
    raise exception 'Review note required' using errcode = '22023';
  end if;
  select * into request_row
  from private.invoice_review_requests
  where id = p_request_id
  for update;
  if not found then
    raise exception 'Invoice review request not found' using errcode = '22023';
  end if;
  if request_row.status = 'resolved' then
    if request_row.resolved_by = auth.uid() and
       request_row.resolution_note = btrim(p_note) then
      return;
    end if;
    raise exception 'Invoice review request was already resolved' using errcode = '40001';
  end if;
  update private.invoice_review_requests set
    status = 'resolved', resolved_by = auth.uid(),
    resolved_at = clock_timestamp(), resolution_note = btrim(p_note)
  where id = p_request_id;
  insert into public.audit_events(actor_id, action, resource_id, details)
  values (
    auth.uid(), 'invoice.review_resolved', request_row.id,
    jsonb_build_object(
      'claim_id', request_row.claim_id,
      'reason', request_row.reason,
      'note', btrim(p_note)
    )
  );
end;
$$;

-- Extend the existing financial projection without changing its account scope.
-- The exact final assigned-session end is the only automatic eligibility clock.
drop function public.finance_earnings(boolean);
alter function private.finance_earnings(boolean)
  rename to finance_earnings_before_invoice_eligibility;
revoke all on function private.finance_earnings_before_invoice_eligibility(boolean)
  from public, anon, authenticated, service_role;

create function private.finance_earnings(p_all boolean default false)
returns table(
  claim_id uuid, job_id uuid, lecturer_id uuid, lecturer_name text,
  title text, customer_name text, starts_at timestamptz, ends_at timestamptz,
  amount numeric, rate_unit text, total_amount numeric, currency text,
  stage text, invoice_id uuid, invoice_eligible_at timestamptz,
  invoice_review_required boolean, invoice_review_reason text,
  invoice_review_status text, invoice_review_note text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.actor_active() or
     (coalesce(p_all, false) and not private.has_permission('finance.manage')) then
    raise exception 'Own earnings or finance management required' using errcode = '42501';
  end if;
  return query
  with earnings as (
    select base.*, claim.status claim_status,
      coalesce(session_data.session_count, 0) session_count,
      coalesce(session_data.has_released, false) has_released,
      session_data.last_end,
      coalesce(job_session_data.session_count, 0) job_session_count,
      review.status review_status, review.resolution_note review_note,
      claim.created_at
    from private.finance_earnings_before_invoice_eligibility(p_all) base
    join public.job_claims claim on claim.id = base.claim_id
    left join lateral (
      select count(*) session_count,
        coalesce(bool_or(s.released_at is not null), false) has_released,
        max(s.ends_at) last_end
      from public.assignment_sessions s where s.claim_id = claim.id
    ) session_data on true
    left join lateral (
      select count(*) session_count
      from public.job_sessions s where s.job_id = claim.job_id
    ) job_session_data on true
    left join lateral (
      select r.status, r.resolution_note
      from private.invoice_review_requests r
      where r.claim_id = claim.id and r.requested_by = claim.lecturer_id
      order by r.requested_at desc, r.id desc limit 1
    ) review on true
  ), rows as (
    select e.claim_id, e.job_id, e.lecturer_id, e.lecturer_name,
      e.title, e.customer_name, e.starts_at, e.ends_at,
      e.amount, e.rate_unit, e.total_amount, e.currency,
      case
        when e.stage in ('paid', 'invoiced') then e.stage
        when e.claim_status = 'cancelled' or e.session_count = 0 or
             e.session_count <> e.job_session_count or e.has_released then 'review'
        else e.stage
      end stage,
      e.invoice_id,
      case
        when e.claim_status = 'cancelled' or e.session_count = 0 or
             e.session_count <> e.job_session_count or e.has_released then null
        else e.last_end
      end invoice_eligible_at,
      (e.claim_status = 'cancelled' or e.session_count = 0 or
       e.session_count <> e.job_session_count or e.has_released) invoice_review_required,
      case
        when e.claim_status = 'cancelled' then 'cancelled'
        when e.session_count = 0 or e.session_count <> e.job_session_count then 'schedule_mismatch'
        when e.has_released then 'partial_delivery'
        else null
      end invoice_review_reason,
      e.review_status invoice_review_status,
      e.review_note invoice_review_note,
      e.created_at
    from earnings e
    union all
    select claim.id, claim.job_id, claim.lecturer_id, profile.display_name,
      job.title, job.customer_name,
      (select min(s.starts_at) from public.assignment_sessions s where s.claim_id = claim.id),
      (select max(s.ends_at) from public.assignment_sessions s where s.claim_id = claim.id),
      claim.amount, claim.rate_unit, claim.total_amount, claim.currency,
      'review', invoice.id,
      null::timestamptz, true, 'cancelled', review.status, review.resolution_note,
      claim.created_at
    from public.job_claims claim
    join public.jobs job on job.id = claim.job_id
    join public.profiles profile on profile.id = claim.lecturer_id
    left join public.invoice_items item on item.claim_id = claim.id and item.active
    left join public.invoices invoice on invoice.id = item.invoice_id
    left join lateral (
      select r.status, r.resolution_note
      from private.invoice_review_requests r
      where r.claim_id = claim.id and r.requested_by = claim.lecturer_id
      order by r.requested_at desc, r.id desc limit 1
    ) review on true
    where claim.status = 'cancelled' and
      (coalesce(p_all, false) or claim.lecturer_id = auth.uid())
  )
  select r.claim_id, r.job_id, r.lecturer_id, r.lecturer_name,
    r.title, r.customer_name, r.starts_at, r.ends_at,
    r.amount, r.rate_unit, r.total_amount, r.currency,
    r.stage, r.invoice_id, r.invoice_eligible_at, r.invoice_review_required,
    r.invoice_review_reason, r.invoice_review_status, r.invoice_review_note
  from rows r
  order by r.created_at desc, r.claim_id;
end;
$$;

-- Resolve a cancelled/partial block separately from invoices and payments.
alter function private.submit_invoice(
  text, uuid[], uuid, date, date, uuid
) rename to submit_invoice_before_session_eligibility;
revoke all on function private.submit_invoice_before_session_eligibility(
  text, uuid[], uuid, date, date, uuid
) from public, anon, authenticated, service_role;

-- Keep the original accepted snapshot, clean exact PDF and idempotency path,
-- adding only the session-end, review and 30-day due-date rules.
create function private.submit_invoice(
  p_number text, p_claim_ids uuid[], p_document_version_id uuid,
  p_issued_on date, p_due_on date default null,
  p_client_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized uuid[];
  effective_due date;
  prior_invoice public.invoices%rowtype;
  target_claim public.job_claims%rowtype;
  session_count bigint;
  job_session_count bigint;
  last_session_end timestamptz;
begin
  if not private.has_role(array['lecturer', 'senior_lecturer']) then
    raise exception 'Active lecturer required' using errcode = '42501';
  end if;
  effective_due := case
    when p_due_on is null and p_issued_on is not null then p_issued_on + 30
    else p_due_on
  end;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('invoice:' || auth.uid()::text, 0)
  );

  -- Preserve an already-confirmed retry even if claim scheduling metadata has
  -- changed since that exact invoice request committed.
  select * into prior_invoice
  from public.invoices
  where user_id = auth.uid() and client_id = p_client_id;
  if found then
    return private.submit_invoice_before_session_eligibility(
      p_number, p_claim_ids, p_document_version_id,
      p_issued_on, effective_due, p_client_id
    );
  end if;

  if p_claim_ids is not null then
    select array_agg(distinct selected.claim_id order by selected.claim_id)
    into normalized
    from unnest(p_claim_ids) as selected(claim_id);
    if normalized is not null and cardinality(normalized) = cardinality(p_claim_ids) then
      -- Validate ownership before returning any review/eligibility distinction.
      if exists (
        select 1 from unnest(normalized) as selected(claim_id)
        where not exists (
          select 1 from public.job_claims claim
          where claim.id = selected.claim_id and claim.lecturer_id = auth.uid()
        )
      ) then
        return private.submit_invoice_before_session_eligibility(
          p_number, p_claim_ids, p_document_version_id,
          p_issued_on, effective_due, p_client_id
        );
      end if;
      if exists (
        select 1 from public.job_claims claim
        where claim.id = any(normalized) and claim.status = 'cancelled'
      ) then
        raise exception 'invoice_review_required: cancelled assignment block' using errcode = '22023';
      end if;
      for target_claim in
        select claim.* from public.job_claims claim
        where claim.id = any(normalized) and claim.status = 'confirmed'
        order by claim.id for update
      loop
        select count(*), max(session.ends_at)
        into session_count, last_session_end
        from public.assignment_sessions session
        where session.claim_id = target_claim.id;
        select count(*) into job_session_count
        from public.job_sessions session
        where session.job_id = target_claim.job_id;
        if session_count = 0 or session_count <> job_session_count or exists (
          select 1 from public.assignment_sessions session
          where session.claim_id = target_claim.id and session.released_at is not null
        ) then
          raise exception 'invoice_review_required: partial or inconsistent assignment block' using errcode = '22023';
        end if;
        if last_session_end > clock_timestamp() then
          raise exception 'invoice_not_ready: final scheduled session has not ended' using errcode = '22023';
        end if;
      end loop;
    end if;
  end if;

  return private.submit_invoice_before_session_eligibility(
    p_number, p_claim_ids, p_document_version_id,
    p_issued_on, effective_due, p_client_id
  );
end;
$$;

-- Keep PostgREST wrappers SECURITY INVOKER and expose only the scoped results.
create function public.finance_earnings(p_all boolean default false)
returns table(
  claim_id uuid, job_id uuid, lecturer_id uuid, lecturer_name text,
  title text, customer_name text, starts_at timestamptz, ends_at timestamptz,
  amount numeric, rate_unit text, total_amount numeric, currency text,
  stage text, invoice_id uuid, invoice_eligible_at timestamptz,
  invoice_review_required boolean, invoice_review_reason text,
  invoice_review_status text, invoice_review_note text
)
language sql
stable
security invoker
set search_path = ''
as $$ select * from private.finance_earnings(p_all); $$;

create function public.my_invoice_review_candidates()
returns table(
  claim_id uuid, job_id uuid, title text, claim_status text,
  reason text, review_status text, requested_at timestamptz,
  resolution_note text, scheduled_end timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$ select * from private.my_invoice_review_candidates(); $$;

create function public.request_invoice_review(p_claim_id uuid, p_request_id uuid)
returns uuid
language sql
security invoker
set search_path = ''
as $$ select private.request_invoice_review(p_claim_id, p_request_id); $$;

create function public.invoice_review_cases()
returns table(
  id uuid, claim_id uuid, job_id uuid, title text, lecturer_id uuid,
  lecturer_name text, reason text, requested_at timestamptz,
  scheduled_end timestamptz, accepted_total numeric, currency text
)
language sql
stable
security invoker
set search_path = ''
as $$ select * from private.invoice_review_cases(); $$;

create function public.resolve_invoice_review_request(p_request_id uuid, p_note text)
returns void
language sql
security invoker
set search_path = ''
as $$ select private.resolve_invoice_review_request(p_request_id, p_note); $$;

create or replace function public.submit_invoice(
  p_number text, p_claim_ids uuid[], p_document_version_id uuid,
  p_issued_on date, p_due_on date default null,
  p_client_id uuid default null
) returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.submit_invoice(
    p_number, p_claim_ids, p_document_version_id, p_issued_on, p_due_on, p_client_id
  );
$$;

revoke all on function private.finance_earnings(boolean) from public, anon, authenticated, service_role;
revoke all on function private.my_invoice_review_candidates() from public, anon, authenticated, service_role;
revoke all on function private.request_invoice_review(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function private.invoice_review_cases() from public, anon, authenticated, service_role;
revoke all on function private.resolve_invoice_review_request(uuid, text) from public, anon, authenticated, service_role;
revoke all on function private.submit_invoice(text, uuid[], uuid, date, date, uuid) from public, anon, authenticated, service_role;
grant execute on function private.finance_earnings(boolean) to authenticated;
grant execute on function private.my_invoice_review_candidates() to authenticated;
grant execute on function private.request_invoice_review(uuid, uuid) to authenticated;
grant execute on function private.invoice_review_cases() to authenticated;
grant execute on function private.resolve_invoice_review_request(uuid, text) to authenticated;
grant execute on function private.submit_invoice(text, uuid[], uuid, date, date, uuid) to authenticated;

revoke all on function public.finance_earnings(boolean) from public, anon;
revoke all on function public.my_invoice_review_candidates() from public, anon;
revoke all on function public.request_invoice_review(uuid, uuid) from public, anon;
revoke all on function public.invoice_review_cases() from public, anon;
revoke all on function public.resolve_invoice_review_request(uuid, text) from public, anon;
revoke all on function public.submit_invoice(text, uuid[], uuid, date, date, uuid) from public, anon;
grant execute on function public.finance_earnings(boolean) to authenticated;
grant execute on function public.my_invoice_review_candidates() to authenticated;
grant execute on function public.request_invoice_review(uuid, uuid) to authenticated;
grant execute on function public.invoice_review_cases() to authenticated;
grant execute on function public.resolve_invoice_review_request(uuid, text) to authenticated;
grant execute on function public.submit_invoice(text, uuid[], uuid, date, date, uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
