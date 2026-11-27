begin;

-- Replace the historical function forward. Earlier installations can have
-- already recorded migration 281235 while retaining its old function body.
create or replace function private.job_discovery_candidates(f jsonb)
returns table(job_id uuid, sort_number numeric, sort_text text)
language sql stable security definer set search_path = '' as $$
  with options as materialized (
    select f->>'sort' as sort,
      (f->>'available_only')::boolean as available_only,
      (f->>'available_only')::boolean or not (f->>'include_history')::boolean as open_only,
      f->>'sort' in ('rate_asc', 'rate_desc', 'total_asc', 'total_desc')
        or f->>'min_rate' is not null or f->>'max_rate' is not null
        or f->>'min_total' is not null or f->>'max_total' is not null as needs_quote,
      f->>'sort' = 'duration_asc' or f->>'min_hours' is not null
        or f->>'max_hours' is not null as needs_duration,
      f->>'sort' = 'customer_asc' or f->>'q' <> ''
        or f->>'customer' <> '' as needs_customer,
      (nullif(f->>'from', '')::date::timestamp at time zone (f->>'zone')) as range_start,
      ((nullif(f->>'to', '')::date + 1)::timestamp at time zone (f->>'zone')) as range_end,
      private.lecturer_actor() as lecturer,
      private.has_permission('jobs.manage') as manager,
      private.has_role(array['client']) as company,
      private.actor_active() as actor_active,
      auth.uid() as actor
  ), jobs_in_scope as materialized (
    select job.id, job.title, job.status, job.urgent_reopened_at, job.course_run_id,
      case when options.sort = 'customer_asc' and visibility.customer
        then job.customer_name else '' end as customer_name,
      job.created_at, job.capacity
    from options
    cross join public.jobs job
    -- Confirmed own allocations are excluded from discovery. Among the
    -- remaining offers, only management or the owning company can read labels.
    cross join lateral (
      select case
        when not options.needs_customer then false
        when options.manager then true
        when options.company then private.job_dispatch_company_actor(job.id)
        else false end as customer
      offset 0
    ) visibility
    where (
      not options.open_only or (
        job.status = 'published'
        and (job.claim_deadline is null or job.claim_deadline > now())
      )
    )
    and (f->>'status' = '' or job.status = f->>'status')
    and (f->>'delivery' = '' or
      coalesce(private.training_offered_mode(job.id, job.course_run_id), job.delivery_type) = f->>'delivery')
    and (f->>'currency' = '' or job.currency = f->>'currency')
    and (f->>'unit' = '' or job.rate_unit = f->>'unit')
    and (
      not options.lecturer or not exists (
        select 1 from public.job_claims claim
        where claim.job_id = job.id and claim.lecturer_id = options.actor
          and claim.status = 'confirmed'
      )
    )
    and (
      f->>'q' = ''
      or strpos(lower(job.title || ' ' || job.description), lower(f->>'q')) > 0
      or (visibility.customer and strpos(
        lower(job.title || ' ' || job.description || ' ' || job.customer_name || ' ' || job.location),
        lower(f->>'q')
      ) > 0)
      or exists (
        select 1
        from public.job_requirements requirement
        join public.topics topic on topic.id = requirement.topic_id
        where requirement.job_id = job.id
          and strpos(lower(topic.label_de || ' ' || topic.label_en || ' ' || array_to_string(topic.aliases, ' ')), lower(f->>'q')) > 0
      )
    )
    and (f->>'customer' = '' or
      (visibility.customer and strpos(lower(job.customer_name), lower(f->>'customer')) > 0))
    and (
      jsonb_array_length(f->'topic_ids') = 0 or exists (
        select 1
        from jsonb_array_elements_text(f->'topic_ids') selected(topic_id)
        join public.job_requirements requirement on requirement.topic_id = selected.topic_id::uuid
        where requirement.job_id = job.id
      )
    )
    and (
      (options.range_start is null and options.range_end is null) or exists (
        select 1 from public.job_sessions session
        where session.job_id = job.id
          and (options.range_start is null or session.ends_at > options.range_start)
          and (options.range_end is null or session.starts_at < options.range_end)
      )
    )
  ), candidates as materialized (
    select job.id, job.title, job.status, job.customer_name, job.created_at, first_session.starts_at
    from options
    cross join jobs_in_scope job
    left join lateral (
      select session.starts_at
      from public.job_sessions session
      where (options.open_only or options.sort = 'soonest') and session.job_id = job.id
      order by session.starts_at
      limit 1
    ) first_session on true
    -- Materialize only offers accepted by the current shared read policy.
    where (
      options.actor_active and (
        options.manager
        or (
          options.lecturer
          and not private.job_lecturer_blocked(job.id, options.actor)
          and not (job.urgent_reopened_at is not null
            and private.emergency_source_lecturer(job.id, options.actor))
          and (
            (job.status = 'published' and (
              (job.urgent_reopened_at is not null and private.teaching_language_matches((
                select run.teaching_language from public.course_runs run
                where run.id = job.course_run_id
              ), options.actor))
              or private.job_subject_matches(job.id, options.actor)
            ))
            or exists (
              select 1 from public.job_claims own
              where own.job_id = job.id and own.lecturer_id = options.actor
                and (own.status = 'confirmed' or not exists (
                  select 1 from public.job_claims active
                  where active.job_id = job.id and active.status = 'confirmed'
                ))
            )
          )
        )
      )
    )
      and (not options.open_only or (
        first_session.starts_at > now()
        and (
          select count(*) from public.job_claims claim
          where claim.job_id = job.id and claim.status = 'confirmed'
        ) < job.capacity
      ))
  )
  select
    candidate.id,
    case options.sort
      when 'newest' then extract(epoch from candidate.created_at)
      when 'oldest' then extract(epoch from candidate.created_at)
      when 'soonest' then coalesce(extract(epoch from candidate.starts_at), 1e20)
      when 'total_asc' then coalesce(quote.total_amount, 1e20)
      when 'total_desc' then coalesce(quote.total_amount, -1e20)
      when 'rate_asc' then coalesce(quote.amount, 1e20)
      when 'rate_desc' then coalesce(quote.amount, -1e20)
      when 'duration_asc' then duration.seconds
      else 0
    end,
    case
      when options.sort = 'customer_asc' then lower(candidate.customer_name)
      when options.sort in ('topic_de_asc', 'topic_en_asc') then coalesce((
        select min(lower(case when options.sort = 'topic_de_asc' then topic.label_de else topic.label_en end) collate "C")
        from public.job_requirements requirement
        join public.topics topic on topic.id = requirement.topic_id
        where requirement.job_id = candidate.id
      ), '')
      else lower(candidate.title)
    end
  from options
  cross join candidates candidate
  -- Sorting and filtering do not need role-dependent quote versions.
  left join lateral private.job_discovery_quote_authorized(
    case when options.needs_quote then candidate.id end,
    false
  ) quote on true
  cross join lateral (
    select coalesce(sum(extract(epoch from session.ends_at - session.starts_at)), 0) as seconds
    from public.job_sessions session
    where options.needs_duration and session.job_id = candidate.id
  ) duration
  where (f->>'min_total' is null or quote.total_amount >= (f->>'min_total')::numeric)
    and (f->>'max_total' is null or quote.total_amount <= (f->>'max_total')::numeric)
    and (f->>'min_rate' is null or quote.amount >= (f->>'min_rate')::numeric)
    and (f->>'max_rate' is null or quote.amount <= (f->>'max_rate')::numeric)
    and (f->>'min_hours' is null or duration.seconds >= (f->>'min_hours')::numeric * 3600)
    and (f->>'max_hours' is null or duration.seconds <= (f->>'max_hours')::numeric * 3600)
    and (
      not options.available_only or not exists (
        select 1
        from public.job_sessions session
        where session.job_id = candidate.id and (
          exists (
            select 1 from public.personal_events event
            where event.user_id = options.actor
              and tstzrange(event.starts_at, event.ends_at, '[)') && tstzrange(session.starts_at, session.ends_at, '[)')
          ) or exists (
            select 1 from public.assignment_sessions assignment
            where assignment.lecturer_id = options.actor and assignment.released_at is null
              and tstzrange(assignment.starts_at, assignment.ends_at, '[)') && tstzrange(session.starts_at, session.ends_at, '[)')
          ) or exists (
            select 1 from public.lecturer_availability availability
            where availability.user_id = options.actor and availability.kind = 'unavailable'
              and tstzrange(availability.starts_at, availability.ends_at, '[)') && tstzrange(session.starts_at, session.ends_at, '[)')
          )
        )
      )
    );
$$;

commit;
