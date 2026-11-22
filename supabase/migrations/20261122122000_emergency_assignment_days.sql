begin;

alter table public.jobs
  add column urgent_reopened_at timestamptz check (isfinite(urgent_reopened_at));

create table private.emergency_assignment_days (
  job_id uuid primary key references public.jobs(id) on delete cascade,
  source_claim_id uuid not null references public.job_claims(id) on delete cascade,
  teaching_date date not null,
  released_count integer not null check (released_count > 0),
  released_gross numeric(12,2) not null check (released_gross >= 0),
  unique (source_claim_id, teaching_date)
);
alter table private.emergency_assignment_days enable row level security;
revoke all on private.emergency_assignment_days from public, anon, authenticated, service_role;

create function private.report_assignment_sick_day(p_claim_id uuid, p_session_id uuid, p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  source public.job_claims;
  original public.jobs;
  original_offer private.job_commission_offers;
  prior private.job_lifecycle_requests;
  reopened private.emergency_assignment_days;
  input_day date;
  changed_at timestamptz;
  request jsonb;
  session_ids uuid[];
  total_duration numeric;
  released_duration numeric;
  fraction numeric;
  net_amount numeric;
  net_total numeric;
  gross_amount numeric;
  gross_total numeric := 0;
  available_gross numeric;
  room record;
begin
  if not private.lecturer_actor() or not exists (
    select 1 from private.installation_identity where singleton and edition = 'internal'
  ) then raise insufficient_privilege; end if;
  perform 1 from public.profiles where id = actor and active for share;
  if not found then raise insufficient_privilege; end if;
  if p_claim_id is null or p_session_id is null or p_request_id is null then
    raise exception 'Missing sick-day request data' using errcode = '22023';
  end if;
  select * into source from public.job_claims where id = p_claim_id and lecturer_id = actor;
  if not found then raise insufficient_privilege; end if;

  -- Use the same request, lecturer, job and claim lock order as assignment updates.
  perform pg_advisory_xact_lock(hashtextextended('job-request:' || actor::text || p_request_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended(actor::text, 0));
  select * into original from public.jobs where id = source.job_id for update;
  select * into source from public.job_claims where id = p_claim_id and lecturer_id = actor for update;
  if not found then raise insufficient_privilege; end if;
  select (starts_at at time zone original.time_zone)::date into input_day
  from public.assignment_sessions where id = p_session_id and claim_id = source.id;
  if not found then raise insufficient_privilege; end if;

  request := jsonb_build_object('action', 'emergency_day', 'claim_id', source.id, 'teaching_date', input_day);
  select * into prior from private.job_lifecycle_requests where actor_id = actor and request_id = p_request_id;
  if found and prior.payload <> request then
    raise exception 'Lifecycle idempotency conflict' using errcode = '22023';
  end if;
  select * into reopened from private.emergency_assignment_days
  where source_claim_id = source.id and teaching_date = input_day;
  if not found then
    changed_at := clock_timestamp();
    if source.status <> 'confirmed' or original.status not in ('published', 'filled') then
      raise exception 'Assignment is unavailable' using errcode = '22023';
    end if;
    if original.course_run_id is not null then
      perform 1 from public.course_runs where id = original.course_run_id and archived_at is null for no key update;
      if not found then raise exception 'Assignment is unavailable' using errcode = '22023'; end if;
    end if;

    if exists (select 1 from public.invoice_items where claim_id = source.id and active)
      or private.assignment_change_customer_invoiced(source.id)
      or private.invoice_series_reserved(source.id) then
      raise exception 'emergency_financial_review_required' using errcode = '22023';
    end if;

    select array_agg(id order by starts_at, id),
      sum(extract(epoch from ends_at - starts_at))
    into session_ids, released_duration
    from public.assignment_sessions
    where claim_id = source.id and released_at is null
      and starts_at > changed_at and (starts_at at time zone original.time_zone)::date = input_day;
    if session_ids is null then
      raise exception 'No future sessions on this teaching day' using errcode = '22023';
    end if;

    -- Allocate the new single-day offer from the source price without changing
    -- the previously accepted price, invoice, or revenue snapshots.
    if original.rate_unit = 'per_day' then
      select count(distinct (starts_at at time zone original.time_zone)::date) into total_duration
      from public.assignment_sessions where claim_id = source.id;
      select released_duration / (total_duration * sum(extract(epoch from ends_at - starts_at)))
      into fraction from public.assignment_sessions
      where claim_id = source.id and (starts_at at time zone original.time_zone)::date = input_day;
    else
      select sum(extract(epoch from ends_at - starts_at)) into total_duration
      from public.assignment_sessions where claim_id = source.id;
      fraction := released_duration / total_duration;
    end if;
    select * into original_offer from private.job_commission_offers where job_id = original.id;
    net_total := round(source.total_amount * fraction, 2);
    net_amount := case when original.rate_unit = 'fixed_total' then net_total else source.amount end;
    insert into public.jobs(
      course_run_id, title, description, customer_name, delivery_type, location, time_zone,
      status, capacity, capacity_basis, amount, total_amount, currency, rate_unit, terms,
      requires_contract, created_by, urgent_reopened_at
    ) values (
      original.course_run_id, original.title, original.description, original.customer_name,
      original.delivery_type, original.location, original.time_zone, 'published', 1,
      'single_position', net_amount, net_total, source.currency, source.rate_unit,
      source.terms, original.requires_contract, null, changed_at
    ) returning id into reopened.job_id;
    insert into public.job_sessions(job_id, course_session_id, starts_at, ends_at)
    select reopened.job_id, original_session.course_session_id, session.starts_at, session.ends_at
    from public.assignment_sessions session
    left join public.job_sessions original_session on original_session.job_id = original.id
      and original_session.starts_at = session.starts_at and original_session.ends_at = session.ends_at
    where session.id = any(session_ids);
    insert into public.job_requirements(job_id, topic_id)
    select reopened.job_id, topic_id from public.job_requirements where job_id = original.id;
    if original_offer.job_id is not null then
      select ledger.gross_total_amount - coalesce((
        select sum(entry.released_gross) from private.emergency_assignment_days entry
        where entry.source_claim_id = source.id
      ), 0) into available_gross
      from private.claim_revenue_ledger ledger where ledger.claim_id = source.id;
      gross_total := least(available_gross,
        greatest(0.01, round(original_offer.gross_total_amount * fraction, 2)));
      if available_gross is null or gross_total < 0.01 then
        raise exception 'emergency_financial_review_required' using errcode = '22023';
      end if;
      gross_amount := case when original.rate_unit = 'fixed_total' then gross_total else original_offer.gross_amount end;
      net_total := least(gross_total, round(original_offer.lecturer_net_total_amount * fraction, 2));
      insert into private.job_commission_offers(
        job_id, organisation_id, gross_amount, gross_total_amount, platform_percent,
        platform_total_amount, lecturer_net_amount, lecturer_net_total_amount, currency,
        pricing_mode, regular_percent, senior_percent, policy_version
      ) values (
        reopened.job_id, original_offer.organisation_id, gross_amount, gross_total,
        original_offer.platform_percent, gross_total - net_total,
        case when original.rate_unit = 'fixed_total' then net_total else original_offer.lecturer_net_amount end,
        net_total, original_offer.currency, original_offer.pricing_mode,
        original_offer.regular_percent, original_offer.senior_percent, original_offer.policy_version
      );
    end if;

    update public.assignment_sessions set released_at = changed_at where id = any(session_ids);
    if not exists (select 1 from public.assignment_sessions where claim_id = source.id and released_at is null) then
      update public.job_claims set status = 'cancelled' where id = source.id;
      -- The emergency job owns the removed position. Keep the original offer's
      -- genuinely unfilled positions available without advertising this one twice.
      update public.jobs set
        capacity = greatest(1, original.capacity - 1),
        status = case
          when original.capacity = 1 then 'archived'
          when (select count(*) from public.job_claims where job_id = original.id and status = 'confirmed')
            >= original.capacity - 1 then 'filled'
          else 'published'
        end where id = original.id;
      for room in select r.id, r.kind from public.chat_rooms r where
        (r.job_id = original.id and r.kind = 'lecturer_course')
        or (r.course_run_id = original.course_run_id and r.kind = 'participant_course')
        order by r.id for update
      loop
        if room.kind = 'participant_course' then
          perform private.participant_chat_assignment_release(room.id, actor, original.course_run_id);
        else
          update public.chat_members set removed_at = changed_at
          where room_id = room.id and user_id = actor and removed_at is null;
          update public.chat_rooms set owner_id = null where id = room.id and owner_id = actor;
        end if;
      end loop;
    end if;

    insert into private.emergency_assignment_days(job_id, source_claim_id, teaching_date, released_count, released_gross)
    values (reopened.job_id, source.id, input_day, cardinality(session_ids), gross_total)
    returning * into reopened;
    insert into public.claim_events(claim_id, actor_id, event_type)
    values (source.id, actor, 'emergency_day_released');
    insert into public.audit_events(actor_id, action, resource_id, details)
    values (actor, 'assignment.emergency_day_released', source.id,
      jsonb_build_object('job_id', reopened.job_id, 'teaching_date', input_day, 'released_sessions', reopened.released_count));
  end if;
  if prior.request_id is null then
    insert into private.job_lifecycle_requests(actor_id, request_id, payload, result)
    values (actor, p_request_id, request, reopened.job_id);
  end if;

  return jsonb_build_object('job_id', reopened.job_id,
    'released_sessions', reopened.released_count, 'teaching_date', reopened.teaching_date);
end;
$$;

create function public.report_assignment_sick_day(p_claim_id uuid, p_session_id uuid, p_request_id uuid)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.report_assignment_sick_day(p_claim_id, p_session_id, p_request_id);
$$;
revoke all on function private.report_assignment_sick_day(uuid,uuid,uuid),
  public.report_assignment_sick_day(uuid,uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function private.report_assignment_sick_day(uuid,uuid,uuid),
  public.report_assignment_sick_day(uuid,uuid,uuid) to authenticated;

create function private.emergency_source_lecturer(p_job uuid, p_user uuid)
returns boolean language sql stable set search_path = '' as $$
  select exists (
    select from private.emergency_assignment_days entry
    join public.job_claims claim on claim.id = entry.source_claim_id
    where entry.job_id = p_job and claim.lecturer_id = p_user
  );
$$;
revoke all on function private.emergency_source_lecturer(uuid,uuid) from public, anon, authenticated, service_role;

do $jobs$
declare
  gate text := pg_get_functiondef('private.claim_job(uuid,uuid,integer)'::regprocedure);
  read_gate text := pg_get_functiondef('private.can_read_job(uuid)'::regprocedure);
  base_gate text := pg_get_functiondef('private.claim_job_base(uuid,uuid,integer)'::regprocedure);
  item text := pg_get_functiondef('private.job_discovery_item(uuid)'::regprocedure);
  anchor constant text := 'if private.job_lecturer_blocked(p_job_id, actor) then';
  read_anchor constant text := 'and not private.job_lecturer_blocked(job.id,auth.uid())';
  item_anchor constant text := '''created_at'',j.created_at';
  topic_anchor constant text := 'if exists(select 1 from public.job_requirements r where r.job_id=j.id';
begin
  if cardinality(string_to_array(gate, anchor)) <> 2
    or cardinality(string_to_array(read_gate, read_anchor)) <> 2
    or cardinality(string_to_array(item, item_anchor)) <> 2
    or cardinality(string_to_array(base_gate, topic_anchor)) <> 2 then
    raise exception 'Expected current assignment authorization and offer projections';
  end if;
  execute replace(gate, anchor,
    'if private.job_lecturer_blocked(p_job_id, actor) or private.emergency_source_lecturer(p_job_id, actor) then');
  execute replace(read_gate, read_anchor, read_anchor
    || ' and not (job.urgent_reopened_at is not null and private.emergency_source_lecturer(job.id,auth.uid()))');
  execute replace(item, item_anchor, item_anchor || ',''urgent_reopened_at'',j.urgent_reopened_at');
  -- Anyone with a current lecturer role can cover an emergency, subject to the
  -- ordinary contract, schedule, pricing and company restriction checks.
  execute replace(base_gate, topic_anchor,
    'if j.urgent_reopened_at is null and exists(select 1 from public.job_requirements r where r.job_id=j.id');
end
$jobs$;

-- A released source is not eligible for a fresh invoice at its full accepted gross.
-- A partial source may be recorded with an explicit difference up to what remains.
do $customer_finance$
declare
  registration text := pg_get_functiondef('private.register_customer_invoice(jsonb,uuid)'::regprocedure);
  listing text := pg_get_functiondef('private.accounting_customer_claims()'::regprocedure);
  registration_anchor constant text := 'if total<>accepted and length(difference)<5 then';
  listing_anchor constant text := 'where not exists(select 1 from private.accounting_customer_items i where i.claim_id=l.claim_id)';
begin
  if cardinality(string_to_array(registration, registration_anchor)) <> 2
    or cardinality(string_to_array(listing, listing_anchor)) <> 2 then
    raise exception 'Expected the current customer invoice review checks';
  end if;
  execute replace(registration, registration_anchor, $check$
    if exists (select 1 from private.emergency_assignment_days where source_claim_id = any(ids))
      and (length(difference) < 5 or total > accepted - coalesce((
        select sum(released_gross) from private.emergency_assignment_days where source_claim_id = any(ids)
      ), 0)) then
      raise exception 'emergency_financial_review_required' using errcode = '22023';
    end if;
  $check$ || registration_anchor);
  execute replace(listing, listing_anchor, listing_anchor || $filter$
      and l.gross_total_amount > coalesce((
        select sum(entry.released_gross) from private.emergency_assignment_days entry where entry.source_claim_id = l.claim_id
      ), -1)
  $filter$);
end
$customer_finance$;

create or replace function private.job_discovery(
  p_filters jsonb default '{}'::jsonb, p_cursor jsonb default null, p_limit integer default 50
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  filters jsonb;
  descending boolean;
  text_sort boolean;
  fingerprint text;
  items jsonb;
  last_item jsonb;
  more boolean;
  cursor_number numeric;
  cursor_text text;
  cursor_id uuid;
  cursor_urgent boolean;
begin
  if not private.actor_active()
    or not (private.lecturer_actor() or private.has_permission('jobs.manage')) then
    raise exception 'Job discovery access denied' using errcode = '42501';
  end if;
  filters := private.job_discovery_filters(p_filters);
  descending := filters->>'sort' in ('newest', 'total_desc', 'rate_desc');
  text_sort := filters->>'sort' in ('title', 'customer_asc', 'topic_de_asc', 'topic_en_asc');
  fingerprint := md5(filters::text || ':' || private.job_discovery_quote_context());
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception 'Invalid page size' using errcode = '22023';
  end if;
  if p_cursor is not null then
    if jsonb_typeof(p_cursor) <> 'object'
      or (select count(*) from jsonb_object_keys(p_cursor - 'urgent')) <> 4
      or p_cursor->>'fingerprint' is distinct from fingerprint
      or jsonb_typeof(p_cursor->'id') is distinct from 'string'
      or jsonb_typeof(p_cursor->'number') is distinct from 'string'
      or jsonb_typeof(p_cursor->'text') is distinct from 'string'
      or (p_cursor ? 'urgent' and jsonb_typeof(p_cursor->'urgent') <> 'boolean') then
      raise exception 'Invalid discovery cursor' using errcode = '22023';
    end if;
    begin
      cursor_id := (p_cursor->>'id')::uuid;
      cursor_number := (p_cursor->>'number')::numeric;
      cursor_text := p_cursor->>'text';
      cursor_urgent := coalesce((p_cursor->>'urgent')::boolean, false);
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'Invalid discovery cursor' using errcode = '22023';
    end;
    if cursor_number is null or cursor_number::text in ('NaN','Infinity','-Infinity')
      or length(cursor_text) > 200 then
      raise exception 'Invalid discovery cursor' using errcode = '22023';
    end if;
  end if;

  with candidates as (
    select candidate.*, (job.urgent_reopened_at is not null and job.status = 'published') as urgent
    from private.job_discovery_candidates(filters) candidate
    join public.jobs job on job.id = candidate.job_id
  ), ranked as (
    select c.*, row_number() over (
      order by c.urgent desc, case when descending then c.sort_number end desc,
      case when not descending and not text_sort then c.sort_number end asc,
      case when text_sort then c.sort_text end collate "C" asc,
      case when descending then c.job_id end desc, case when not descending then c.job_id end asc
    ) rn
    from candidates c
    where p_cursor is null or c.urgent < cursor_urgent or (c.urgent = cursor_urgent and case
      when text_sort then (c.sort_text collate "C", c.job_id) > (cursor_text collate "C", cursor_id)
      when descending then (c.sort_number, c.job_id) < (cursor_number, cursor_id)
      else (c.sort_number, c.job_id) > (cursor_number, cursor_id)
    end)
  ), page as (select * from ranked order by rn limit p_limit + 1)
  select
    coalesce(jsonb_agg(private.job_discovery_item(job_id) order by rn) filter (where rn <= p_limit), '[]'::jsonb),
    coalesce(bool_or(rn > p_limit), false),
    (jsonb_agg(jsonb_build_object(
      'id', job_id, 'number', sort_number::text, 'text', sort_text, 'fingerprint', fingerprint, 'urgent', urgent
    ) order by rn) filter (where rn <= p_limit))->(least(p_limit, count(*) filter (where rn <= p_limit))::int - 1)
  into items, more, last_item from page;
  return jsonb_build_object('items', items, 'has_more', more,
    'next_cursor', case when more then last_item end, 'as_of', now(), 'filters', filters);
end;
$$;

notify pgrst, 'reload schema';
commit;
