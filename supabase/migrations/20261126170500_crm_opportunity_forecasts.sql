begin;

alter table public.crm_opportunities
  add column close_probability numeric(5, 2),
  add column expected_close_date date,
  add constraint crm_opportunities_close_probability_range
    check (close_probability is null or close_probability between 0 and 100),
  add constraint crm_opportunities_expected_close_date_range
    check (expected_close_date between date '0001-01-01' and date '9999-12-31');

alter table public.crm_opportunity_events
  add column from_close_probability numeric(5, 2),
  add column to_close_probability numeric(5, 2),
  add column from_expected_close_date date,
  add column to_expected_close_date date;

alter table public.crm_opportunity_events
  drop constraint crm_opportunity_events_event_type_check,
  drop constraint crm_opportunity_events_check;

alter table public.crm_opportunity_events
  add constraint crm_opportunity_events_event_type_check
    check (event_type in ('created', 'stage_changed', 'forecast_updated')),
  add constraint crm_opportunity_events_forecast_values
    check (
      (from_close_probability is null or from_close_probability between 0 and 100)
      and (to_close_probability is null or to_close_probability between 0 and 100)
      and (
        (event_type = 'created'
          and version = 1
          and from_stage is null
          and to_stage = 'identified'
          and from_close_probability is null
          and to_close_probability is null
          and from_expected_close_date is null
          and to_expected_close_date is null)
        or (event_type = 'stage_changed'
          and version > 1
          and from_stage is not null
          and from_stage <> to_stage
          and from_close_probability is null
          and to_close_probability is null
          and from_expected_close_date is null
          and to_expected_close_date is null)
        or (event_type = 'forecast_updated'
          and version > 1
          and from_stage is not null
          and from_stage = to_stage
          and (from_close_probability is distinct from to_close_probability
            or from_expected_close_date is distinct from to_expected_close_date))
      )
    );

create function private.update_crm_opportunity_forecast(
  p_organisation_id uuid,
  p_opportunity_id uuid,
  p_close_probability numeric,
  p_expected_close_date date,
  p_expected_version integer,
  p_request_id uuid
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_opportunity public.crm_opportunities;
  v_event public.crm_opportunity_events;
begin
  if not private.has_permission('organisations.manage') then
    raise exception 'organisations.manage required' using errcode = '42501';
  end if;
  if p_organisation_id is null or p_opportunity_id is null or p_request_id is null
     or p_expected_version is null or p_expected_version < 1
     or (p_expected_close_date not between date '0001-01-01' and date '9999-12-31')
     or (p_close_probability is not null and (
       p_close_probability < 0 or p_close_probability > 100
       or p_close_probability <> round(p_close_probability, 2)
     )) then
    raise exception 'Invalid CRM opportunity forecast' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(auth.uid()::text || ':' || p_request_id::text, 0)
  );
  select o.* into v_opportunity
    from public.crm_opportunities o
   where o.id = p_opportunity_id and o.organisation_id = p_organisation_id
   for update;
  if not found then
    raise exception 'CRM opportunity not found' using errcode = 'P0002';
  end if;

  select e.* into v_event
    from public.crm_opportunity_events e
   where e.actor_id = auth.uid() and e.request_id = p_request_id;
  if found then
    if v_event.opportunity_id = p_opportunity_id
       and v_event.organisation_id = p_organisation_id
       and v_event.event_type = 'forecast_updated'
       and v_event.version - 1 = p_expected_version
       and v_event.to_close_probability is not distinct from p_close_probability
       and v_event.to_expected_close_date is not distinct from p_expected_close_date then
      return;
    end if;
    raise exception 'crm_idempotency_key_conflict' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.organisations o
     where o.id = p_organisation_id and o.archived_at is null
  ) then
    raise exception 'Archived organisations are read only' using errcode = '42501';
  end if;
  if v_opportunity.version <> p_expected_version then
    raise exception 'crm_opportunity_version_conflict' using errcode = '40001';
  end if;
  if v_opportunity.close_probability is not distinct from p_close_probability
     and v_opportunity.expected_close_date is not distinct from p_expected_close_date then
    raise exception 'CRM opportunity forecast is unchanged' using errcode = '22023';
  end if;

  update public.crm_opportunities
     set close_probability = p_close_probability,
         expected_close_date = p_expected_close_date,
         version = version + 1,
         updated_at = clock_timestamp()
   where id = p_opportunity_id and organisation_id = p_organisation_id;
  insert into public.crm_opportunity_events (
    opportunity_id, organisation_id, version, event_type, from_stage, to_stage,
    from_close_probability, to_close_probability,
    from_expected_close_date, to_expected_close_date, actor_id, request_id
  ) values (
    p_opportunity_id, p_organisation_id, p_expected_version + 1, 'forecast_updated',
    v_opportunity.stage, v_opportunity.stage,
    v_opportunity.close_probability, p_close_probability,
    v_opportunity.expected_close_date, p_expected_close_date, auth.uid(), p_request_id
  );
  insert into public.audit_events (actor_id, action, resource_id, details)
  values (auth.uid(), 'crm.opportunity.forecast_updated', p_opportunity_id,
          jsonb_build_object('organisation_id', p_organisation_id,
                             'close_probability', p_close_probability,
                             'expected_close_date', p_expected_close_date,
                             'version', p_expected_version + 1));
end;
$$;

create function public.update_crm_opportunity_forecast(
  p_organisation_id uuid,
  p_opportunity_id uuid,
  p_close_probability numeric,
  p_expected_close_date date,
  p_expected_version integer,
  p_request_id uuid
)
returns void language sql security invoker set search_path = '' as $$
  select private.update_crm_opportunity_forecast(
    p_organisation_id, p_opportunity_id, p_close_probability,
    p_expected_close_date, p_expected_version, p_request_id
  );
$$;

-- Return types change when the persisted forecast fields are added, so replace
-- the API read wrappers rather than mutating the original migration contract.
drop function public.list_crm_opportunities(uuid, integer);
drop function private.list_crm_opportunities(uuid, integer);

create function private.list_crm_opportunities(p_organisation_id uuid, p_limit integer default 100)
returns table (
  id uuid,
  organisation_id uuid,
  title text,
  stage text,
  estimated_value numeric,
  currency text,
  close_probability numeric,
  expected_close_date date,
  version integer,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql security definer set search_path = '' as $$
begin
  if not private.has_permission('organisations.manage') then
    raise exception 'organisations.manage required' using errcode = '42501';
  end if;
  if p_organisation_id is null or p_limit is null or p_limit not between 1 and 200 then
    raise exception 'Invalid CRM list request' using errcode = '22023';
  end if;
  if not exists (select 1 from public.organisations o where o.id = p_organisation_id) then
    raise exception 'Organisation not found' using errcode = 'P0002';
  end if;
  return query
    select o.id, o.organisation_id, o.title, o.stage, o.estimated_value,
           o.currency, o.close_probability, o.expected_close_date,
           o.version, o.created_at, o.updated_at
      from public.crm_opportunities o
     where o.organisation_id = p_organisation_id
     order by o.updated_at desc, o.id
     limit p_limit;
end;
$$;

create function public.list_crm_opportunities(p_organisation_id uuid, p_limit integer default 100)
returns table (
  id uuid,
  organisation_id uuid,
  title text,
  stage text,
  estimated_value numeric,
  currency text,
  close_probability numeric,
  expected_close_date date,
  version integer,
  created_at timestamptz,
  updated_at timestamptz
)
language sql security invoker set search_path = '' as $$
  select * from private.list_crm_opportunities(p_organisation_id, p_limit);
$$;

drop function public.list_crm_opportunity_page(uuid, text, text, integer, integer);
drop function private.list_crm_opportunity_page(uuid, text, text, integer, integer);

create function private.list_crm_opportunity_page(
  p_organisation_id uuid,
  p_search text default null,
  p_stage text default null,
  p_limit integer default 26,
  p_offset integer default 0
)
returns table (
  id uuid,
  organisation_id uuid,
  title text,
  stage text,
  estimated_value numeric,
  currency text,
  close_probability numeric,
  expected_close_date date,
  version integer,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql security definer set search_path = '' as $$
declare
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
begin
  if not private.has_permission('organisations.manage') then
    raise exception 'organisations.manage required' using errcode = '42501';
  end if;
  if p_organisation_id is null
     or p_limit is null or p_limit not between 1 and 51
     or p_offset is null or p_offset not between 0 and 10000
     or (p_search is not null and length(p_search) > 200)
     or (p_stage is not null and p_stage not in (
       'identified', 'outreach_qualified', 'contacted', 'response_received',
       'qualified_opportunity', 'meeting_scheduled', 'negotiation',
       'proposal_submitted', 'contract_pending', 'contract_signed',
       'active_customer', 'lost', 'dormant'
     )) then
    raise exception 'Invalid CRM page request' using errcode = '22023';
  end if;
  if not exists (select 1 from public.organisations o where o.id = p_organisation_id) then
    raise exception 'Organisation not found' using errcode = 'P0002';
  end if;
  return query
    select o.id, o.organisation_id, o.title, o.stage, o.estimated_value,
           o.currency, o.close_probability, o.expected_close_date,
           o.version, o.created_at, o.updated_at
      from public.crm_opportunities o
     where o.organisation_id = p_organisation_id
       and (p_stage is null or o.stage = p_stage)
       and (v_search is null or pg_catalog.strpos(pg_catalog.lower(o.title), pg_catalog.lower(v_search)) > 0)
     order by o.updated_at desc, o.id asc
     limit p_limit offset p_offset;
end;
$$;

create function public.list_crm_opportunity_page(
  p_organisation_id uuid,
  p_search text default null,
  p_stage text default null,
  p_limit integer default 26,
  p_offset integer default 0
)
returns table (
  id uuid,
  organisation_id uuid,
  title text,
  stage text,
  estimated_value numeric,
  currency text,
  close_probability numeric,
  expected_close_date date,
  version integer,
  created_at timestamptz,
  updated_at timestamptz
)
language sql security invoker set search_path = '' as $$
  select * from private.list_crm_opportunity_page(
    p_organisation_id, p_search, p_stage, p_limit, p_offset
  );
$$;

drop function public.list_crm_opportunity_events(uuid, uuid, integer);
drop function private.list_crm_opportunity_events(uuid, uuid, integer);

create function private.list_crm_opportunity_events(
  p_organisation_id uuid,
  p_opportunity_id uuid,
  p_limit integer default 50
)
returns table (
  id uuid,
  opportunity_id uuid,
  organisation_id uuid,
  version integer,
  event_type text,
  from_stage text,
  to_stage text,
  from_close_probability numeric,
  to_close_probability numeric,
  from_expected_close_date date,
  to_expected_close_date date,
  actor_id uuid,
  request_id uuid,
  occurred_at timestamptz
)
language plpgsql security definer set search_path = '' as $$
begin
  if not private.has_permission('organisations.manage') then
    raise exception 'organisations.manage required' using errcode = '42501';
  end if;
  if p_organisation_id is null or p_opportunity_id is null
     or p_limit is null or p_limit not between 1 and 100 then
    raise exception 'Invalid CRM history request' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.crm_opportunities o
     where o.id = p_opportunity_id and o.organisation_id = p_organisation_id
  ) then
    raise exception 'CRM opportunity not found' using errcode = 'P0002';
  end if;
  return query
    select e.id, e.opportunity_id, e.organisation_id, e.version, e.event_type,
           e.from_stage, e.to_stage, e.from_close_probability, e.to_close_probability,
           e.from_expected_close_date, e.to_expected_close_date,
           e.actor_id, e.request_id, e.occurred_at
      from (
        select event.id, event.opportunity_id, event.organisation_id, event.version,
               event.event_type, event.from_stage, event.to_stage,
               event.from_close_probability, event.to_close_probability,
               event.from_expected_close_date, event.to_expected_close_date,
               event.actor_id, event.request_id, event.occurred_at
          from public.crm_opportunity_events event
         where event.opportunity_id = p_opportunity_id
         order by event.version desc
         limit p_limit
      ) e
     order by e.version;
end;
$$;

create function public.list_crm_opportunity_events(
  p_organisation_id uuid,
  p_opportunity_id uuid,
  p_limit integer default 50
)
returns table (
  id uuid,
  opportunity_id uuid,
  organisation_id uuid,
  version integer,
  event_type text,
  from_stage text,
  to_stage text,
  from_close_probability numeric,
  to_close_probability numeric,
  from_expected_close_date date,
  to_expected_close_date date,
  actor_id uuid,
  request_id uuid,
  occurred_at timestamptz
)
language sql security invoker set search_path = '' as $$
  select * from private.list_crm_opportunity_events(
    p_organisation_id, p_opportunity_id, p_limit
  );
$$;

revoke execute on function private.update_crm_opportunity_forecast(uuid, uuid, numeric, date, integer, uuid),
  public.update_crm_opportunity_forecast(uuid, uuid, numeric, date, integer, uuid),
  private.list_crm_opportunities(uuid, integer),
  private.list_crm_opportunity_page(uuid, text, text, integer, integer),
  private.list_crm_opportunity_events(uuid, uuid, integer),
  public.list_crm_opportunities(uuid, integer),
  public.list_crm_opportunity_page(uuid, text, text, integer, integer),
  public.list_crm_opportunity_events(uuid, uuid, integer)
  from public, anon;

grant execute on function private.update_crm_opportunity_forecast(uuid, uuid, numeric, date, integer, uuid),
  public.update_crm_opportunity_forecast(uuid, uuid, numeric, date, integer, uuid),
  private.list_crm_opportunities(uuid, integer),
  private.list_crm_opportunity_page(uuid, text, text, integer, integer),
  private.list_crm_opportunity_events(uuid, uuid, integer),
  public.list_crm_opportunities(uuid, integer),
  public.list_crm_opportunity_page(uuid, text, text, integer, integer),
  public.list_crm_opportunity_events(uuid, uuid, integer)
  to authenticated;

commit;