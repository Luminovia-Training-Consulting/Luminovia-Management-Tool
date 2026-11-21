begin;

-- A null candidate never needs an authorized quote. STRICT lets PostgreSQL
-- skip executing the quote function when the catalogue only needs nonprice
-- keys. The selected page still projects real actor-specific prices.
alter function private.job_discovery_quote(uuid) strict;

create or replace function private.job_discovery_candidates_before_text_sort(f jsonb)
returns table(job_id uuid, sort_number numeric, sort_text text)
language sql
stable
security definer
set search_path = ''
as $$
  select
    job.id,
    case f->>'sort'
      when 'newest' then extract(epoch from job.created_at)
      when 'oldest' then extract(epoch from job.created_at)
      when 'soonest' then coalesce(schedule.first_start, 1e20)
      when 'total_asc' then coalesce(quote.total_amount, 1e20)
      when 'total_desc' then coalesce(quote.total_amount, -1e20)
      when 'rate_asc' then coalesce(quote.amount, 1e20)
      when 'rate_desc' then coalesce(quote.amount, -1e20)
      when 'duration_asc' then schedule.seconds
      else 0
    end,
    lower(job.title)
  from public.jobs job
  left join lateral private.job_discovery_quote(
    case
      when f->>'sort' in ('rate_asc', 'rate_desc', 'total_asc', 'total_desc')
        or f->>'min_rate' is not null or f->>'max_rate' is not null
        or f->>'min_total' is not null or f->>'max_total' is not null
      then job.id
    end
  ) quote on true
  cross join lateral (
    select
      min(extract(epoch from session.starts_at)) first_start,
      coalesce(sum(extract(epoch from session.ends_at - session.starts_at)), 0) seconds
    from public.job_sessions session
    where session.job_id = job.id
  ) schedule
  where private.can_read_job(job.id)
    and (
      f->>'q' = ''
      or strpos(lower(job.title || ' ' || job.description || ' ' || job.customer_name || ' ' || job.location), lower(f->>'q')) > 0
      or exists (
        select 1
        from public.job_requirements requirement
        join public.topics topic on topic.id = requirement.topic_id
        where requirement.job_id = job.id
          and strpos(lower(topic.label_de || ' ' || topic.label_en || ' ' || array_to_string(topic.aliases, ' ')), lower(f->>'q')) > 0
      )
    )
    and (f->>'customer' = '' or strpos(lower(job.customer_name), lower(f->>'customer')) > 0)
    and (f->>'delivery' = '' or job.delivery_type = f->>'delivery')
    and (f->>'status' = '' or job.status = f->>'status')
    and (f->>'currency' = '' or job.currency = f->>'currency')
    and (f->>'unit' = '' or job.rate_unit = f->>'unit')
    and not exists (
      select 1
      from jsonb_array_elements_text(f->'topic_ids') selected(topic_id)
      where not exists (
        select 1
        from public.job_requirements requirement
        where requirement.job_id = job.id and requirement.topic_id = selected.topic_id::uuid
      )
    )
    and (
      (f->>'from' = '' and f->>'to' = '') or exists (
        select 1
        from public.job_sessions session
        where session.job_id = job.id
          and (f->>'from' = '' or session.ends_at > (nullif(f->>'from', '')::date::timestamp at time zone (f->>'zone')))
          and (f->>'to' = '' or session.starts_at < ((nullif(f->>'to', '')::date + 1)::timestamp at time zone (f->>'zone')))
      )
    )
    and (f->>'min_total' is null or quote.total_amount >= (f->>'min_total')::numeric)
    and (f->>'max_total' is null or quote.total_amount <= (f->>'max_total')::numeric)
    and (f->>'min_rate' is null or quote.amount >= (f->>'min_rate')::numeric)
    and (f->>'max_rate' is null or quote.amount <= (f->>'max_rate')::numeric)
    and (f->>'min_hours' is null or schedule.seconds >= (f->>'min_hours')::numeric * 3600)
    and (f->>'max_hours' is null or schedule.seconds <= (f->>'max_hours')::numeric * 3600)
    and (
      not (f->>'available_only')::boolean
      or (
        job.status = 'published'
        and (job.claim_deadline is null or job.claim_deadline > now())
        and exists (select 1 from public.job_sessions where job_id = job.id)
        and not exists (select 1 from public.job_sessions where job_id = job.id and starts_at <= now())
        and (
          select count(*) from public.job_claims claim
          where claim.job_id = job.id and claim.status = 'confirmed'
        ) < job.capacity
        and not exists (
          select 1
          from public.job_sessions session
          where session.job_id = job.id and (
            exists (
              select 1 from public.personal_events event
              where event.user_id = auth.uid()
                and tstzrange(event.starts_at, event.ends_at, '[)') && tstzrange(session.starts_at, session.ends_at, '[)')
            ) or exists (
              select 1 from public.assignment_sessions assignment
              where assignment.lecturer_id = auth.uid() and assignment.released_at is null
                and tstzrange(assignment.starts_at, assignment.ends_at, '[)') && tstzrange(session.starts_at, session.ends_at, '[)')
            ) or exists (
              select 1 from public.lecturer_availability availability
              where availability.user_id = auth.uid() and availability.kind = 'unavailable'
                and tstzrange(availability.starts_at, availability.ends_at, '[)') && tstzrange(session.starts_at, session.ends_at, '[)')
            )
          )
        )
      )
    );
$$;

commit;
