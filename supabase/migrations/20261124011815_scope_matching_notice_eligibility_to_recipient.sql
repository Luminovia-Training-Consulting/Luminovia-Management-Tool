begin;

-- The bulk projection and per-notice validation share one eligibility rule.
-- Scope the candidate profiles before checking qualifications and private calendars.
create function private.matching_job_lecturers(p_job_id uuid, p_recipient_id uuid)
returns table(user_id uuid)
language sql stable security definer set search_path = '' as $$
  with candidates as materialized (
    select p.id from public.profiles p where p.active and p_recipient_id is null
    union all
    select p.id from public.profiles p where p.active and p.id = p_recipient_id
  ), target as (
    select j.id, j.created_by, j.capacity, j.claim_deadline, j.requires_contract,
      min(s.starts_at) first_start, max(s.ends_at) last_end
    from public.jobs j
    join public.job_sessions s on s.job_id = j.id
    where j.id = p_job_id
    group by j.id
  )
  select p.id
  from target j
  join candidates p on p.id is distinct from j.created_by
  where j.first_start > clock_timestamp()
    and not private.job_lecturer_blocked(j.id, p.id)
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
    and private.job_subject_matches(j.id, p.id)
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
revoke all on function private.matching_job_lecturers(uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function private.matching_job_lecturers(p_job_id uuid)
returns table(user_id uuid)
language sql stable security definer set search_path = '' as $$
  select recipient.user_id
  from private.matching_job_lecturers(p_job_id, null) recipient
  order by recipient.user_id;
$$;

create or replace function private.filter_ineligible_job_notice()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.kind in ('job_matching', 'job_reopened') and (
    new.resource_id is null or new.user_id is null or not exists (
      select 1 from public.jobs j
      where j.id = new.resource_id and j.status = 'published' and
        (j.claim_deadline is null or j.claim_deadline > clock_timestamp())
    ) or not exists (
      select 1 from private.matching_job_lecturers(new.resource_id, new.user_id)
    )
  ) then
    return null;
  end if;
  return new;
end;
$$;

commit;
