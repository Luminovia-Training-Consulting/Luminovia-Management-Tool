begin;

create or replace function private.job_dashboard()
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  manager boolean;
  result jsonb;
begin
  if not private.actor_active() then
    raise exception 'Job dashboard access denied' using errcode = '42501';
  end if;
  manager := private.has_permission('jobs.manage');
  if not (private.lecturer_actor() or manager) then
    raise exception 'Job dashboard access denied' using errcode = '42501';
  end if;

  -- Archive and filled history do not contribute to these aggregates. Apply
  -- inexpensive status filters before invoking the current visibility policy.
  with candidates as materialized (
    select j.id, j.capacity, j.status, j.claim_deadline
    from public.jobs j
    where (j.status = 'published'
        and (manager or j.claim_deadline is null or j.claim_deadline > now()))
      or (manager and j.status = 'draft')
  ),
  visible as materialized (
    select * from candidates where private.can_read_job(candidates.id)
  ),
  offers as materialized (
    select j.id, first_session.starts_at
    from visible j
    cross join lateral (
      select s.starts_at
      from public.job_sessions s
      where s.job_id = j.id
      order by s.starts_at
      limit 1
    ) first_session
    where j.status = 'published'
      and (j.claim_deadline is null or j.claim_deadline > now())
      and first_session.starts_at > now()
      and (
        select count(*) from public.job_claims c
        where c.job_id = j.id and c.status = 'confirmed'
      ) < j.capacity
  ),
  chosen as materialized (
    select j.id, j.starts_at,
      exists (select 1 from public.job_requirements r where r.job_id = j.id)
        and private.job_subject_matches(j.id, auth.uid()) as matching
    from offers j
    order by matching desc, j.starts_at, j.id
    limit 2
  ),
  active_claims as materialized (
    select c.id, c.job_id from public.job_claims c
    where c.lecturer_id = auth.uid() and c.status = 'confirmed'
  ),
  upcoming_sessions as materialized (
    select s.id, s.starts_at, s.ends_at, c.job_id
    from active_claims c join public.assignment_sessions s on s.claim_id = c.id
    where s.released_at is null and s.ends_at > now()
  ),
  next_sessions as (
    select * from upcoming_sessions order by starts_at, id limit 5
  )
  select jsonb_build_object(
    'open_count', (select count(*) from offers),
    'assignment_count', (select count(*) from active_claims),
    'next_session_count', (select count(*) from upcoming_sessions),
    'matching', coalesce((select bool_or(matching) from chosen), false),
    'suggestions', coalesce((
      select jsonb_agg(private.job_discovery_item(id) order by matching desc, starts_at, id)
      from chosen
    ), '[]'::jsonb),
    'next_assignments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'starts_at', s.starts_at, 'ends_at', s.ends_at,
        'job', jsonb_build_object('id', j.id, 'title', j.title)
      ) order by s.starts_at, s.id)
      from next_sessions s join public.jobs j on j.id = s.job_id
    ), '[]'::jsonb),
    'management', case when manager then (
      select jsonb_build_object(
        'drafts', count(*) filter (where j.status = 'draft'),
        'expired', count(*) filter (where j.status = 'published' and j.claim_deadline <= now()),
        'upcoming', count(*) filter (where j.status = 'published' and exists (
          select 1 from public.job_sessions s where s.job_id = j.id
            and s.starts_at >= now() and s.starts_at < now() + interval '14 days'
        ))
      ) from visible j
    ) else null end,
    'as_of', now()
  ) into result;
  return result;
end;
$$;

commit;
