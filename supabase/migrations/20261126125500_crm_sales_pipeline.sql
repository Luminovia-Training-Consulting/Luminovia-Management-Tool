begin;

-- Keep this first CRM increment attached to the authoritative organisation record.
create table public.crm_opportunities (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete restrict,
  title text not null check (length(btrim(title)) between 1 and 200),
  stage text not null default 'identified' check (stage in (
    'identified', 'outreach_qualified', 'contacted', 'response_received',
    'qualified_opportunity', 'meeting_scheduled', 'negotiation',
    'proposal_submitted', 'contract_pending', 'contract_signed',
    'active_customer', 'lost', 'dormant'
  )),
  estimated_value numeric(14, 2) check (estimated_value is null or estimated_value >= 0),
  currency text not null default 'EUR' check (currency in ('EUR', 'AUD', 'CHF', 'GBP', 'USD')),
  created_by uuid not null references auth.users(id) on delete restrict,
  creation_request_id uuid not null,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (created_by, creation_request_id),
  unique (id, organisation_id)
);

create index crm_opportunities_board_idx
  on public.crm_opportunities (organisation_id, stage, updated_at desc, id);

-- One immutable event per committed opportunity version; request IDs make retries safe.
create table public.crm_opportunity_events (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null,
  organisation_id uuid not null,
  version integer not null check (version > 0),
  event_type text not null check (event_type in ('created', 'stage_changed')),
  from_stage text,
  to_stage text not null check (to_stage in (
    'identified', 'outreach_qualified', 'contacted', 'response_received',
    'qualified_opportunity', 'meeting_scheduled', 'negotiation',
    'proposal_submitted', 'contract_pending', 'contract_signed',
    'active_customer', 'lost', 'dormant'
  )),
  actor_id uuid not null references auth.users(id) on delete restrict,
  request_id uuid not null,
  occurred_at timestamptz not null default clock_timestamp(),
  foreign key (opportunity_id, organisation_id)
    references public.crm_opportunities(id, organisation_id) on delete restrict,
  unique (opportunity_id, version),
  unique (actor_id, request_id),
  check (
    (event_type = 'created' and version = 1 and from_stage is null and to_stage = 'identified')
    or (event_type = 'stage_changed' and version > 1 and from_stage is not null and from_stage <> to_stage)
  )
);

create index crm_opportunity_events_history_idx
  on public.crm_opportunity_events (opportunity_id, version desc);

alter table public.crm_opportunities enable row level security;
alter table public.crm_opportunity_events enable row level security;

revoke all on public.crm_opportunities, public.crm_opportunity_events
  from public, anon, authenticated, service_role;
grant select on public.crm_opportunities, public.crm_opportunity_events to authenticated;

create policy crm_opportunities_staff_read on public.crm_opportunities
  for select to authenticated using ((select private.has_permission('organisations.manage')));
create policy crm_opportunity_events_staff_read on public.crm_opportunity_events
  for select to authenticated using ((select private.has_permission('organisations.manage')));

-- Even elevated application maintenance cannot rewrite or erase committed stage history.
create function private.prevent_crm_opportunity_event_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'crm_opportunity_history_immutable' using errcode = '42501';
end;
$$;

create trigger crm_opportunity_events_immutable
  before update or delete on public.crm_opportunity_events
  for each row execute function private.prevent_crm_opportunity_event_mutation();

create function private.list_crm_opportunities(p_organisation_id uuid, p_limit integer default 100)
returns table (
  id uuid,
  organisation_id uuid,
  title text,
  stage text,
  estimated_value numeric,
  currency text,
  version integer,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql security definer set search_path = '' as $$
begin
  if not private.has_permission('organisations.manage') then
    raise exception 'organisations.manage required' using errcode = '42501';
  end if;
  if p_organisation_id is null or p_limit not between 1 and 200 then
    raise exception 'Invalid CRM list request' using errcode = '22023';
  end if;
  if not exists (select 1 from public.organisations o where o.id = p_organisation_id) then
    raise exception 'Organisation not found' using errcode = 'P0002';
  end if;
  return query
    select o.id, o.organisation_id, o.title, o.stage, o.estimated_value,
           o.currency, o.version, o.created_at, o.updated_at
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
  version integer,
  created_at timestamptz,
  updated_at timestamptz
)
language sql security invoker set search_path = '' as $$
  select * from private.list_crm_opportunities(p_organisation_id, p_limit);
$$;

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
  actor_id uuid,
  request_id uuid,
  occurred_at timestamptz
)
language plpgsql security definer set search_path = '' as $$
begin
  if not private.has_permission('organisations.manage') then
    raise exception 'organisations.manage required' using errcode = '42501';
  end if;
  if p_organisation_id is null or p_opportunity_id is null or p_limit not between 1 and 100 then
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
           e.from_stage, e.to_stage, e.actor_id, e.request_id, e.occurred_at
      from (
        select event.id, event.opportunity_id, event.organisation_id, event.version,
               event.event_type, event.from_stage, event.to_stage, event.actor_id,
               event.request_id, event.occurred_at
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
  actor_id uuid,
  request_id uuid,
  occurred_at timestamptz
)
language sql security invoker set search_path = '' as $$
  select * from private.list_crm_opportunity_events(p_organisation_id, p_opportunity_id, p_limit);
$$;

create function private.create_crm_opportunity(
  p_organisation_id uuid,
  p_title text,
  p_estimated_value numeric,
  p_currency text,
  p_request_id uuid
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_existing public.crm_opportunities;
  v_event public.crm_opportunity_events;
  v_title text := btrim(coalesce(p_title, ''));
begin
  if not private.has_permission('organisations.manage') then
    raise exception 'organisations.manage required' using errcode = '42501';
  end if;
  if p_organisation_id is null or p_request_id is null
     or length(v_title) not between 1 and 200
     or (p_estimated_value is not null and (p_estimated_value < 0 or p_estimated_value >= 1000000000000))
     or p_currency is null or p_currency not in ('EUR', 'AUD', 'CHF', 'GBP', 'USD') then
    raise exception 'Invalid CRM opportunity' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(auth.uid()::text || ':' || p_request_id::text, 0)
  );
  select o.* into v_existing
    from public.crm_opportunities o
   where o.created_by = auth.uid() and o.creation_request_id = p_request_id
   for share;
  if found then
    if v_existing.organisation_id is distinct from p_organisation_id
       or v_existing.title is distinct from v_title
       or v_existing.estimated_value is distinct from p_estimated_value
       or v_existing.currency is distinct from p_currency then
      raise exception 'crm_idempotency_key_conflict' using errcode = '22023';
    end if;
    return v_existing.id;
  end if;
  select e.* into v_event
    from public.crm_opportunity_events e
   where e.actor_id = auth.uid() and e.request_id = p_request_id;
  if found then
    raise exception 'crm_idempotency_key_conflict' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.organisations o
     where o.id = p_organisation_id and o.archived_at is null
  ) then
    raise exception 'Active organisation not found' using errcode = 'P0002';
  end if;

  insert into public.crm_opportunities (
    organisation_id, title, stage, estimated_value, currency,
    created_by, creation_request_id
  ) values (
    p_organisation_id, v_title, 'identified', p_estimated_value, p_currency,
    auth.uid(), p_request_id
  ) on conflict (created_by, creation_request_id) do nothing
  returning id into v_id;

  if v_id is null then
    select o.* into v_existing
      from public.crm_opportunities o
     where o.created_by = auth.uid() and o.creation_request_id = p_request_id
     for share;
    if not found or v_existing.organisation_id is distinct from p_organisation_id
       or v_existing.title is distinct from v_title
       or v_existing.estimated_value is distinct from p_estimated_value
       or v_existing.currency is distinct from p_currency then
      raise exception 'crm_idempotency_key_conflict' using errcode = '22023';
    end if;
    return v_existing.id;
  end if;

  insert into public.crm_opportunity_events (
    opportunity_id, organisation_id, version, event_type, from_stage,
    to_stage, actor_id, request_id
  ) values (
    v_id, p_organisation_id, 1, 'created', null, 'identified', auth.uid(), p_request_id
  );
  insert into public.audit_events (actor_id, action, resource_id, details)
  values (auth.uid(), 'crm.opportunity.created', v_id,
          jsonb_build_object('organisation_id', p_organisation_id, 'version', 1));
  return v_id;
end;
$$;

create function public.create_crm_opportunity(
  p_organisation_id uuid,
  p_title text,
  p_estimated_value numeric,
  p_currency text,
  p_request_id uuid
)
returns uuid language sql security invoker set search_path = '' as $$
  select private.create_crm_opportunity(
    p_organisation_id, p_title, p_estimated_value, p_currency, p_request_id
  );
$$;

create function private.move_crm_opportunity(
  p_organisation_id uuid,
  p_opportunity_id uuid,
  p_stage text,
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
     or p_stage is null or p_stage not in (
       'identified', 'outreach_qualified', 'contacted', 'response_received',
       'qualified_opportunity', 'meeting_scheduled', 'negotiation',
       'proposal_submitted', 'contract_pending', 'contract_signed',
       'active_customer', 'lost', 'dormant'
     ) then
    raise exception 'Invalid CRM stage change' using errcode = '22023';
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
       and v_event.event_type = 'stage_changed'
       and v_event.version = p_expected_version + 1
       and v_event.to_stage = p_stage then
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
  if v_opportunity.stage = p_stage then
    raise exception 'CRM opportunity is already at this stage' using errcode = '22023';
  end if;

  update public.crm_opportunities
     set stage = p_stage, version = version + 1, updated_at = clock_timestamp()
   where id = p_opportunity_id and organisation_id = p_organisation_id;
  insert into public.crm_opportunity_events (
    opportunity_id, organisation_id, version, event_type, from_stage,
    to_stage, actor_id, request_id
  ) values (
    p_opportunity_id, p_organisation_id, p_expected_version + 1, 'stage_changed',
    v_opportunity.stage, p_stage, auth.uid(), p_request_id
  );
  insert into public.audit_events (actor_id, action, resource_id, details)
  values (auth.uid(), 'crm.opportunity.stage_changed', p_opportunity_id,
          jsonb_build_object('organisation_id', p_organisation_id,
                             'from_stage', v_opportunity.stage,
                             'to_stage', p_stage,
                             'version', p_expected_version + 1));
end;
$$;

create function public.move_crm_opportunity(
  p_organisation_id uuid,
  p_opportunity_id uuid,
  p_stage text,
  p_expected_version integer,
  p_request_id uuid
)
returns void language sql security invoker set search_path = '' as $$
  select private.move_crm_opportunity(
    p_organisation_id, p_opportunity_id, p_stage, p_expected_version, p_request_id
  );
$$;

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
           o.currency, o.version, o.created_at, o.updated_at
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
  version integer,
  created_at timestamptz,
  updated_at timestamptz
)
language sql security invoker set search_path = '' as $$
  select * from private.list_crm_opportunity_page(
    p_organisation_id, p_search, p_stage, p_limit, p_offset
  );
$$;

revoke execute on function private.prevent_crm_opportunity_event_mutation(),
  private.list_crm_opportunities(uuid, integer),
  private.list_crm_opportunity_page(uuid, text, text, integer, integer),
  private.list_crm_opportunity_events(uuid, uuid, integer),
  private.create_crm_opportunity(uuid, text, numeric, text, uuid),
  private.move_crm_opportunity(uuid, uuid, text, integer, uuid),
  public.list_crm_opportunities(uuid, integer),
  public.list_crm_opportunity_page(uuid, text, text, integer, integer),
  public.list_crm_opportunity_events(uuid, uuid, integer),
  public.create_crm_opportunity(uuid, text, numeric, text, uuid),
  public.move_crm_opportunity(uuid, uuid, text, integer, uuid)
  from public, anon;

grant execute on function private.list_crm_opportunities(uuid, integer),
  private.list_crm_opportunity_page(uuid, text, text, integer, integer),
  private.list_crm_opportunity_events(uuid, uuid, integer),
  private.create_crm_opportunity(uuid, text, numeric, text, uuid),
  private.move_crm_opportunity(uuid, uuid, text, integer, uuid),
  public.list_crm_opportunities(uuid, integer),
  public.list_crm_opportunity_page(uuid, text, text, integer, integer),
  public.list_crm_opportunity_events(uuid, uuid, integer),
  public.create_crm_opportunity(uuid, text, numeric, text, uuid),
  public.move_crm_opportunity(uuid, uuid, text, integer, uuid)
  to authenticated;

commit;