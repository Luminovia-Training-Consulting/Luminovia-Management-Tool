begin;

-- Use the same qualification, quote, contract and calendar rules as claims
-- before advertising a released position to a prospective lecturer.
create function private.matching_job_lecturers(p_job_id uuid)
returns table(user_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  with target as (
    select j.id, j.created_by, j.capacity, j.claim_deadline,
      j.requires_contract, j.time_zone,
      min(s.starts_at) first_start, max(s.ends_at) last_end
    from public.jobs j
    join public.job_sessions s on s.job_id = j.id
    where j.id = p_job_id
    group by j.id
  )
  select p.id
  from target j
  join public.profiles p on p.active and p.id is distinct from j.created_by
  where j.first_start > clock_timestamp()
    and (j.claim_deadline is null or j.claim_deadline > clock_timestamp())
    and (select count(*) from public.job_claims c
      where c.job_id = j.id and c.status = 'confirmed') < j.capacity
    and exists (
      select 1 from public.user_roles r
      where r.user_id = p.id and r.role in ('lecturer', 'senior_lecturer')
    )
    and not exists (
      select 1 from public.job_claims c
      where c.job_id = j.id and c.lecturer_id = p.id and c.status = 'confirmed'
    )
    and not exists (
      select 1 from public.job_requirements requirement
      where requirement.job_id = j.id and not exists (
        select 1 from public.lecturer_topics topic
        where topic.user_id = p.id and topic.topic_id = requirement.topic_id
      )
    )
    and (
      not j.requires_contract or
      private.current_contract_for_interval(p.id, j.first_start, j.last_end) is not null
    )
    and private.lecturer_job_quote(p.id, j.id) is not null
    and not exists (
      select 1 from public.job_sessions session
      where session.job_id = j.id and (
        exists (
          select 1 from public.personal_events event
          where event.user_id = p.id and
            tstzrange(event.starts_at, event.ends_at, '[)') &&
            tstzrange(session.starts_at, session.ends_at, '[)')
        ) or exists (
          select 1 from public.assignment_sessions assigned
          where assigned.lecturer_id = p.id and assigned.released_at is null and
            tstzrange(assigned.starts_at, assigned.ends_at, '[)') &&
            tstzrange(session.starts_at, session.ends_at, '[)')
        ) or exists (
          select 1 from public.lecturer_availability unavailable
          where unavailable.user_id = p.id and unavailable.kind = 'unavailable' and
            tstzrange(unavailable.starts_at, unavailable.ends_at, '[)') &&
            tstzrange(session.starts_at, session.ends_at, '[)')
        )
      )
    )
  order by p.id;
$$;
revoke all on function private.matching_job_lecturers(uuid)
  from public, anon, authenticated, service_role;

-- Deferred matching notices share one eligibility projection for initial
-- publication, requirement changes, and newly released capacity.
create or replace function private.notify_matching_job()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_id uuid;
  job_row public.jobs%rowtype;
  notice_kind text;
begin
  if tg_table_name = 'jobs' then
    if tg_op = 'UPDATE' and
       new.status is not distinct from old.status and
       new.claim_deadline is not distinct from old.claim_deadline and
       new.created_by is not distinct from old.created_by then
      return null;
    end if;
    target_id := coalesce(new.id, old.id);
  else
    if tg_op = 'UPDATE' and
       new.job_id is not distinct from old.job_id and
       new.topic_id is not distinct from old.topic_id then
      return null;
    end if;
    target_id := coalesce(new.job_id, old.job_id);
  end if;

  select * into job_row from public.jobs where id = target_id;
  if not found or job_row.status <> 'published' or
     (job_row.claim_deadline is not null and job_row.claim_deadline <= clock_timestamp()) or
     not exists (select 1 from public.job_sessions s where s.job_id = job_row.id) or
     exists (
       select 1 from public.job_sessions s
       where s.job_id = job_row.id and s.starts_at <= clock_timestamp()
     ) then
    return null;
  end if;
  notice_kind := case when exists (
    select 1 from public.job_claims c
    where c.job_id = job_row.id and c.status = 'cancelled'
  ) then 'job_reopened' else 'job_matching' end;
  insert into public.notifications as current_notice(user_id, kind, resource_id)
  select eligible.user_id, notice_kind, job_row.id
  from private.matching_job_lecturers(job_row.id) eligible
  on conflict (user_id, kind, resource_id) do update
    set read_at = null, created_at = clock_timestamp()
    where current_notice.created_at < transaction_timestamp();
  return null;
end;
$$;
revoke all on function private.notify_matching_job()
  from public, anon, authenticated, service_role;

-- Do not accept stale or manually injected matching notices for people who no
-- longer hold current eligibility, contract, capacity or schedule rights.
create function private.filter_ineligible_job_notice()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kind in ('job_matching', 'job_reopened') and (
    new.resource_id is null or not exists (
      select 1 from public.jobs j
      where j.id = new.resource_id and j.status = 'published' and
        (j.claim_deadline is null or j.claim_deadline > clock_timestamp())
    ) or not exists (
      select 1 from private.matching_job_lecturers(new.resource_id) eligible
      where eligible.user_id = new.user_id
    )
  ) then
    return null;
  end if;
  return new;
end;
$$;
revoke all on function private.filter_ineligible_job_notice()
  from public, anon, authenticated, service_role;
create trigger notifications_filter_ineligible_job_notice
before insert on public.notifications
for each row execute function private.filter_ineligible_job_notice();

-- Wrap the shared immediate-release helper so direct cancellation, approved
-- withdrawal, and company rejection all reopen only an eligible free position.
-- Replayed lifecycle request IDs never reopen or re-notify a second time.
alter function private.cancel_job_assignment_immediate(uuid, text, uuid)
  rename to cancel_job_assignment_before_marketplace_reopen;
revoke all on function private.cancel_job_assignment_before_marketplace_reopen(uuid, text, uuid)
  from public, anon, authenticated, service_role;

create function private.cancel_job_assignment_immediate(
  p_claim_id uuid, p_reason text, p_request_id uuid
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  result_id uuid;
  claim_row public.job_claims%rowtype;
  job_row public.jobs%rowtype;
  replay boolean;
begin
  select exists (
    select 1 from private.job_lifecycle_requests request
    where request.actor_id = auth.uid() and request.request_id = p_request_id
  ) into replay;
  result_id := private.cancel_job_assignment_before_marketplace_reopen(
    p_claim_id, p_reason, p_request_id
  );
  if replay then return result_id; end if;

  select * into claim_row from public.job_claims where id = p_claim_id;
  if not found or claim_row.status <> 'cancelled' then return result_id; end if;
  select * into job_row from public.jobs where id = claim_row.job_id for update;
  if not found or job_row.status not in ('draft', 'published') or
     (job_row.claim_deadline is not null and job_row.claim_deadline <= clock_timestamp()) or
     (select count(*) from public.job_claims c
      where c.job_id = job_row.id and c.status = 'confirmed') >= job_row.capacity or
     not exists (
       select 1 from public.job_sessions s
       where s.job_id = job_row.id and s.starts_at > clock_timestamp()
     ) or exists (
       select 1 from public.job_sessions s
       where s.job_id = job_row.id and s.starts_at <= clock_timestamp()
     ) then
    return result_id;
  end if;
  if not exists (
    select 1 from private.matching_job_lecturers(job_row.id)
  ) then
    return result_id;
  end if;
  if job_row.status = 'draft' then
    update public.jobs set status = 'published' where id = job_row.id;
  end if;
  insert into public.notifications as current_notice(user_id, kind, resource_id)
  select eligible.user_id, 'job_reopened', job_row.id
  from private.matching_job_lecturers(job_row.id) eligible
  on conflict (user_id, kind, resource_id) do update
    set read_at = null, created_at = clock_timestamp()
    where current_notice.created_at < transaction_timestamp();
  insert into public.audit_events(actor_id, action, resource_id, details)
  values (
    auth.uid(), 'job.reopened_after_assignment_release', job_row.id,
    jsonb_build_object(
      'claim_id', claim_row.id,
      'available_positions', job_row.capacity - (
        select count(*) from public.job_claims c
        where c.job_id = job_row.id and c.status = 'confirmed'
      )
    )
  );
  return result_id;
end;
$$;
revoke all on function private.cancel_job_assignment_immediate(uuid, text, uuid)
  from public, anon, authenticated, service_role;

commit;