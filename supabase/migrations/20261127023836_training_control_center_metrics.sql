-- Provide period-scoped training metrics without exposing calendar titles, meeting links,
-- individual fee terms or customer billing information to operational-only staff.
begin;

create table private.training_control_acknowledgements (
  actor_id uuid not null references public.profiles(id) on delete cascade,
  run_id uuid not null references public.course_runs(id) on delete cascade,
  issue text not null check (issue in ('staffing','delivery','agreement','qualification','preparation')),
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{32}$'),
  acknowledged_at timestamptz not null default now(),
  primary key (actor_id, run_id, issue)
);
alter table private.training_control_acknowledgements enable row level security;
revoke all on private.training_control_acknowledgements from public, anon, authenticated, service_role;

-- Readiness is evaluated only for the small, imminent group of live courses.
-- Return issue codes and a revision fingerprint; no readiness documents or URLs.
create function private.training_control_issues(p_run_id uuid, p_start timestamptz, p_required_minutes numeric, p_missing_minutes numeric)
returns table(issue text, fingerprint text)
language sql stable security invoker set search_path = '' as $$
  with prep as materialized (
    select private.readiness_snapshot(p_run_id) as detail
  ), reasons as (
    select reason.issue,
      case when reason.issue = 'staffing' then p_required_minutes::text || '/' || p_missing_minutes::text
        else reason.revision end as revision
    from prep
    cross join lateral (
      select case requirement->>'code' when 'delivery' then 'delivery' when 'agreement' then 'agreement'
        when 'qualification' then 'qualification' else 'preparation' end as issue,
        requirement->>'code' as revision
      from jsonb_array_elements(prep.detail->'checks') requirement
      where (requirement->>'applicable')::boolean and not (requirement->>'complete')::boolean
        and requirement->>'code' <> 'lecturer'
        and (requirement->>'code' not in ('agreement','qualification') or p_missing_minutes = 0)
      union all select 'staffing', 'lecturer' where p_missing_minutes > 0
    ) reason
  )
  select issue, pg_catalog.md5(p_run_id::text || '/' || (extract(epoch from p_start))::text || '/'
    || issue || '/' || string_agg(revision, ',' order by revision))
  from reasons group by issue
$$;
revoke all on function private.training_control_issues(uuid,timestamptz,numeric,numeric)
  from public, anon, authenticated, service_role;

-- Report only voluntarily shared windows. Merge overlapping windows before
-- subtracting shared absences and confirmed allocations from declared capacity.
create function private.training_shared_capacity(p_begins timestamptz,p_ends timestamptz,p_zone text)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with weeks as (
    select day::date as week,
      tstzrange(greatest(day at time zone p_zone,p_begins),
        least((day+interval '7 days') at time zone p_zone,p_ends),'[)') as period_range
    from generate_series(date_trunc('week',p_begins at time zone p_zone),
      date_trunc('week',(p_ends-interval '1 microsecond') at time zone p_zone),interval '7 days') series(day)
  ), shares as materialized (
    select week.week,week.period_range,availability.user_id,
      coalesce(range_agg(tstzrange(availability.starts_at,availability.ends_at,'[)')*week.period_range)
        filter(where availability.kind='available'),'{}'::tstzmultirange) as available,
      coalesce(range_agg(tstzrange(availability.starts_at,availability.ends_at,'[)')*week.period_range)
        filter(where availability.kind='unavailable'),'{}'::tstzmultirange) as unavailable
    from weeks week join public.lecturer_availability availability
      on tstzrange(availability.starts_at,availability.ends_at,'[)') && week.period_range
    join public.profiles person on person.id=availability.user_id and person.active
    where availability.share_with_management and private.lecturer_user(person.id)
    group by week.week,week.period_range,availability.user_id
  ), summed as (
    select share.week,count(*) as people,
      round(sum(capacity.free_minutes),2) as free_minutes
    from shares share
    cross join lateral (
      select coalesce(range_agg(tstzrange(assignment.starts_at,assignment.ends_at,'[)')*share.period_range),
        '{}'::tstzmultirange) as occupied
      from public.assignment_sessions assignment join public.job_claims claim on claim.id=assignment.claim_id
      where claim.status='confirmed' and assignment.released_at is null and assignment.lecturer_id=share.user_id
        and tstzrange(assignment.starts_at,assignment.ends_at,'[)') && share.period_range
    ) bookings
    cross join lateral (
      select coalesce(sum(extract(epoch from upper(segment)-lower(segment))/60),0) as free_minutes
      from unnest(share.available-share.unavailable-bookings.occupied) segment
    ) capacity group by share.week
  ), upcoming_absences as (
    select availability.id,person.display_name as name,availability.starts_at,availability.ends_at
    from public.lecturer_availability availability join public.profiles person on person.id=availability.user_id
    where person.active and private.lecturer_user(person.id) and availability.share_with_management
      and availability.kind='unavailable' and availability.starts_at<p_ends
      and availability.ends_at>greatest(now(),p_begins)
    order by availability.starts_at,availability.id limit 100
  )
  select jsonb_build_object(
    'weeks',coalesce((select jsonb_agg(to_jsonb(item) order by item.week) from summed item),'[]'::jsonb),
    'absences',coalesce((select jsonb_agg(to_jsonb(item) order by item.starts_at,item.id) from upcoming_absences item),'[]'::jsonb))
$$;
revoke all on function private.training_shared_capacity(timestamptz,timestamptz,text)
  from public,anon,authenticated,service_role;

create function private.training_control_center(p_from date, p_until date, p_organisation_id uuid, p_topic_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  zone text;
  begins timestamptz;
  ends timestamptz;
  as_of constant timestamptz := now();
  operations jsonb := null;
  finance jsonb := null;
  organisations jsonb := '[]'::jsonb;
  topics jsonb := '[]'::jsonb;
  read_courses boolean := private.has_permission('courses.manage');
  read_receivables boolean := private.has_permission('finance.gross.read');
begin
  if not private.actor_active() or not private.has_permission('jobs.manage')
      or not exists (select 1 from private.installation_identity where singleton and edition = 'internal') then
    raise insufficient_privilege;
  end if;
  perform private.finance_period(p_from, p_until);
  if p_from is null or p_until is null or not isfinite(p_from) or not isfinite(p_until) then
    raise invalid_parameter_value;
  end if;
  select time_zone into strict zone from public.profiles where id = actor;
  begins := p_from::timestamp at time zone zone;
  ends := p_until::timestamp at time zone zone;

  -- Offer filter values only from sources the existing panel can read.
  with visible_companies as (
    select run.organisation_id from public.course_runs run
    where read_courses and run.archived_at is null
      and exists (select 1 from public.course_sessions session where session.course_run_id=run.id
        and session.starts_at<ends and session.ends_at>begins)
      and (run.published or exists (select 1 from public.jobs job where job.course_run_id=run.id
        and job.status in ('published','filled')))
    union
    select invoice.organisation_id from private.accounting_customer_invoices invoice
    where read_receivables and invoice.issued_on>=p_from and invoice.issued_on<p_until
  )
  select coalesce(jsonb_agg(jsonb_build_object('id',item.id,'name',item.name) order by item.name,item.id),'[]'::jsonb)
  into organisations from visible_companies visible join public.organisations item on item.id=visible.organisation_id;

  if read_courses then
    select coalesce(jsonb_agg(jsonb_build_object('id',item.id,'label_de',item.label_de,'label_en',item.label_en)
      order by item.label_de,item.id),'[]'::jsonb)
    into topics from public.topics item
    where exists (
      select 1 from public.course_template_topics link join public.course_runs run on run.template_id=link.template_id
      where link.topic_id=item.id and run.archived_at is null
        and exists (select 1 from public.course_sessions session where session.course_run_id=run.id
          and session.starts_at<ends and session.ends_at>begins)
        and (run.published or exists (select 1 from public.jobs job where job.course_run_id=run.id
          and job.status in ('published','filled')))
    );

    with window_sessions as materialized (
      select session.id,session.course_run_id,session.starts_at,session.ends_at,
        extract(epoch from least(session.ends_at, ends) - greatest(session.starts_at, begins)) / 60 as minutes
      from public.course_sessions session
      join public.course_runs run on run.id=session.course_run_id
      where session.starts_at < ends and session.ends_at > begins and run.archived_at is null
        and (p_organisation_id is null or run.organisation_id=p_organisation_id)
        and (p_topic_id is null or exists (select 1 from public.course_template_topics link
          where link.template_id=run.template_id and link.topic_id=p_topic_id))
        and (run.published or exists (select 1 from public.jobs job where job.course_run_id=run.id
          and job.status in ('published','filled')))
    ), positions as (
      select session.id, session.course_run_id, session.minutes,
        greatest(1, coalesce(sum(job.capacity) filter (where cover.is_cover is null), 0)) as required,
        coalesce(sum(least(job.capacity, assignment.count)), 0) as assigned
      from window_sessions session
      left join public.job_sessions slot on slot.course_session_id=session.id
        and (slot.starts_at,slot.ends_at)=(session.starts_at,session.ends_at)
        and exists (select 1 from public.jobs live where live.id=slot.job_id
          and live.course_run_id=session.course_run_id and live.status in ('published','filled'))
      left join public.jobs job on job.id=slot.job_id
      -- A cover order fills a released position on the original offer.
      left join lateral (
        select true as is_cover from public.job_claims claim
        join private.partial_teaching_replacements handover on handover.replacement_claim_id=claim.id
        where claim.job_id=job.id limit 1
      ) cover on job.id is not null
      left join lateral (
        select count(*) as count
        from public.job_claims claim
        join public.profiles person on person.id=claim.lecturer_id and person.active
        where claim.job_id=job.id and claim.status='confirmed' and private.lecturer_user(person.id)
          and exists (select 1 from public.assignment_sessions booked where booked.claim_id=claim.id
            and booked.released_at is null
            and (booked.starts_at,booked.ends_at)=(session.starts_at,session.ends_at))
      ) assignment on job.id is not null
      group by session.id,session.course_run_id,session.minutes
    ), runs as materialized (
      select position.course_run_id as id, sum(position.required*position.minutes) as required,
        sum(least(position.required, position.assigned)*position.minutes) as assigned
      from positions position group by position.course_run_id
    ), facts as materialized (
      select run.id, run.required, run.assigned, schedule.starts_at, schedule.ends_at
      from runs run cross join lateral (
        select min(session.starts_at) as starts_at, max(session.ends_at) as ends_at
        from public.course_sessions session where session.course_run_id=run.id
      ) schedule
    ), imminent as materialized (
      select facts.*, template.title
      from facts join public.course_runs run using (id)
      join public.course_templates template on template.id=run.template_id
      where facts.starts_at>=as_of and facts.starts_at<as_of+interval '3 days'
      order by facts.starts_at,facts.id limit 100
    ), issues as (
      select course.id,course.title,course.starts_at,issue.issue,issue.fingerprint,
        ack.fingerprint=issue.fingerprint as acknowledged
      from imminent course cross join lateral private.training_control_issues(
        course.id,course.starts_at,course.required,course.required-course.assigned) issue
      left join private.training_control_acknowledgements ack on ack.actor_id=actor
        and ack.run_id=course.id and ack.issue=issue.issue
    )
    select jsonb_build_object(
      'upcoming',count(*) filter(where starts_at>=as_of),
      'active',count(*) filter(where starts_at<as_of and ends_at>as_of),
      'assigned_minutes',round(coalesce(sum(assigned),0),2),
      'unassigned_minutes',round(coalesce(sum(required-assigned),0),2),
      'unstaffed',count(*) filter(where ends_at>as_of and assigned=0),
      'partly_staffed',count(*) filter(where ends_at>as_of and assigned>0 and assigned<required),
      'attention', (select count(distinct issue.id) from issues issue),
      'issues', (select coalesce(jsonb_agg(jsonb_build_object(
        'run_id',issue.id,'title',issue.title,'starts_at',issue.starts_at,
        'code',issue.issue,'fingerprint',issue.fingerprint,'acknowledged',coalesce(issue.acknowledged,false)
      ) order by issue.starts_at,issue.id,issue.issue),'[]'::jsonb) from issues issue)
    ) into operations from facts;
  end if;

  if read_receivables then
    with invoices as materialized (
      select invoice.id,invoice.number,invoice.due_on,invoice.currency,organisation.name as organisation,
        settlement.net_total,settlement.retained_total,settlement.outstanding_total
      from private.accounting_customer_invoices invoice
      join public.organisations organisation on organisation.id=invoice.organisation_id
      cross join lateral private.calculate_customer_settlement(invoice.id) settlement
      where invoice.issued_on>=p_from and invoice.issued_on<p_until
        and (p_organisation_id is null or invoice.organisation_id=p_organisation_id)
    ), overdue as (
      select id,number,due_on,currency,organisation,outstanding_total
      from invoices where due_on < (as_of at time zone zone)::date and outstanding_total>0
      order by due_on,id limit 100
    ), currencies as (
      select currency,sum(net_total) as invoiced,sum(retained_total) as received,sum(outstanding_total) as outstanding
      from invoices group by currency
    )
    select jsonb_build_object(
      'currencies',coalesce((select jsonb_agg(to_jsonb(item) order by item.currency) from currencies item),'[]'::jsonb),
      'overdue',coalesce((select jsonb_agg(to_jsonb(item) order by item.due_on,item.id) from overdue item),'[]'::jsonb)
    ) into finance;
  end if;
  return jsonb_build_object('time_zone',zone,'operations',operations,'receivables',finance,
    'filters',jsonb_build_object('organisations',organisations,'topics',topics),'capacity',case when private.has_permission('availability.read_shared')
      then private.training_shared_capacity(begins,ends,zone) end);
end;
$$;

-- Acknowledgements are private to the viewer. The live issue continues to be
-- calculated, and changing its underlying facts invalidates previous acknowledgement.
create function private.acknowledge_training_issue(p_run_id uuid,p_issue text,p_fingerprint text,p_acknowledged boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not private.actor_active() or not private.has_permission('jobs.manage')
    or not private.has_permission('courses.manage')
    or not exists (select 1 from private.installation_identity where singleton and edition = 'internal') then
    raise insufficient_privilege;
  end if;
  if p_run_id is null or p_issue is null or p_fingerprint is null or p_acknowledged is null
    or p_issue not in ('staffing','delivery','agreement','qualification','preparation')
    or p_fingerprint !~ '^[0-9a-f]{32}$' then raise invalid_parameter_value; end if;
  if not exists (select 1 from public.course_runs run where run.id=p_run_id and run.archived_at is null) then
    raise no_data_found;
  end if;
  if p_acknowledged then
    insert into private.training_control_acknowledgements(actor_id,run_id,issue,fingerprint)
    values (auth.uid(),p_run_id,p_issue,p_fingerprint)
    on conflict (actor_id,run_id,issue) do update set fingerprint=excluded.fingerprint, acknowledged_at=now()
    where training_control_acknowledgements.fingerprint is distinct from excluded.fingerprint;
  else
    delete from private.training_control_acknowledgements where actor_id=auth.uid()
      and run_id=p_run_id and issue=p_issue and fingerprint=p_fingerprint;
  end if;
  return true;
end;
$$;

create function public.training_control_center(p_from date,p_until date,p_organisation_id uuid default null,p_topic_id uuid default null)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.training_control_center(p_from,p_until,p_organisation_id,p_topic_id)
$$;

create function public.acknowledge_training_issue(p_run_id uuid,p_issue text,p_fingerprint text,p_acknowledged boolean)
returns boolean language sql security invoker set search_path = '' as $$
  select private.acknowledge_training_issue(p_run_id,p_issue,p_fingerprint,p_acknowledged)
$$;

revoke all on function private.training_control_center(date,date,uuid,uuid),public.training_control_center(date,date,uuid,uuid),
  private.acknowledge_training_issue(uuid,text,text,boolean),public.acknowledge_training_issue(uuid,text,text,boolean)
  from public, anon, authenticated, service_role;
grant execute on function private.training_control_center(date,date,uuid,uuid),public.training_control_center(date,date,uuid,uuid),
  private.acknowledge_training_issue(uuid,text,text,boolean),public.acknowledge_training_issue(uuid,text,text,boolean) to authenticated;
commit;
