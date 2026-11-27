begin;

-- Optional commercial terms extend the existing role-split offer and revenue
-- ledger. Historical rows and offers without components preserve their prices.
alter table private.job_commission_offers
  add column training_components jsonb,
  add column training_creation_preset jsonb;
alter table private.claim_revenue_ledger
  add column training_snapshot jsonb;

create table private.training_commercial_presets (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  currency text not null check (currency in ('EUR','AUD','USD','CHF')),
  configuration jsonb not null check (jsonb_typeof(configuration) = 'object'),
  base_rate numeric(12,2) check (base_rate > 0),
  rate_unit text check (rate_unit in ('per_day','per_hour','per_teaching_unit','fixed_total')),
  check ((base_rate is null) = (rate_unit is null)),
  revision integer not null default 1 check (revision > 0),
  updated_at timestamptz not null default clock_timestamp(),
  archived_at timestamptz
);
create unique index training_commercial_presets_active_name
  on private.training_commercial_presets(organisation_id, lower(name))
  where archived_at is null;
create index training_commercial_presets_organisation
  on private.training_commercial_presets(organisation_id);
alter table private.training_commercial_presets enable row level security;
revoke all on private.training_commercial_presets from public, anon, authenticated, service_role;

-- Include active and archived presets in the exact organisation deletion plan.
do $migration$
declare
  definition text := pg_catalog.pg_get_functiondef('private.deletion_scope(text,uuid)'::regprocedure);
  anchor text := $anchor$  if p_kind <> 'job' then
    return scope;
  end if;$anchor$;
begin
  if strpos(definition, anchor) = 0 then
    raise exception 'Expected the owned-job deletion scope';
  end if;
  execute replace(definition, anchor, $replacement$
  if p_kind = 'organisation' then
    scope := private.deletion_add_scope(scope, 'private.training_commercial_presets',
      format('x.organisation_id=%L::uuid', p_id));
  end if;
$replacement$ || anchor);
end
$migration$;

-- Currency rates enter as decimal strings. Calculations use PostgreSQL numeric
-- and round at the component boundary; no browser-derived totals are accepted.
create function private.training_component_decimal(p_text text, p_places integer)
returns numeric language plpgsql immutable set search_path = '' as $$
begin
  if p_text is null or p_text !~ ('^[0-9]{1,10}(\.[0-9]{1,' || p_places || '})?$') then
    raise exception 'Invalid commercial decimal' using errcode = '22023';
  end if;
  return p_text::numeric;
end;
$$;

create function private.validate_training_components(p_configuration jsonb)
returns void language plpgsql immutable set search_path = '' as $$
declare
  component jsonb;
  customer_rate numeric;
  configured_rate numeric;
  basis text;
  treatment text;
  onsite_count integer := 0;
begin
  if jsonb_typeof(p_configuration) is distinct from 'object'
    or p_configuration - array['components','unit_minutes'] <> '{}'::jsonb
    or jsonb_typeof(p_configuration->'unit_minutes') is distinct from 'number'
    or coalesce(p_configuration->>'unit_minutes','') !~ '^[0-9]{1,4}$'
    or (p_configuration->>'unit_minutes')::integer not between 1 and 1440
    or jsonb_typeof(p_configuration->'components') is distinct from 'array'
    or jsonb_array_length(p_configuration->'components') > 24 then
    raise exception 'Invalid commercial configuration' using errcode = '22023';
  end if;
  for component in select value from jsonb_array_elements(p_configuration->'components') loop
    if jsonb_typeof(component) is distinct from 'object'
      or component - array['kind','label','basis','treatment','customer_rate','agreed_rate','quantity','reason','session_rates'] <> '{}'::jsonb
      or coalesce(component->>'kind','') not in (
        'on_site','travel','mileage','accommodation','preparation','examination',
        'assessment','materials','administration','paid_travel_time','cancellation','other'
      )
      or coalesce(component->>'basis','') not in (
        'course','assignment','session','teaching_day','teaching_hour','teaching_unit',
        'physical_day','physical_session','kilometre','night','fixed_total','agreed_quantity'
      )
      or coalesce(component->>'treatment','') not in ('commission','pass_through','custom','fixed_platform')
      or jsonb_typeof(component->'customer_rate') is distinct from 'string'
      or jsonb_typeof(component->'label') is distinct from 'string'
      or jsonb_typeof(component->'reason') is distinct from 'string'
      or length(coalesce(component->>'label','')) > 160
      or length(coalesce(component->>'reason','')) > 500
      or (component->>'kind' = 'other' and trim(coalesce(component->>'label','')) = '') then
      raise exception 'Invalid commercial component' using errcode = '22023';
    end if;
    basis := component->>'basis';
    treatment := component->>'treatment';
    customer_rate := private.training_component_decimal(component->>'customer_rate',2);
    if treatment in ('custom','fixed_platform') then
      if jsonb_typeof(component->'agreed_rate') is distinct from 'string'
        or trim(coalesce(component->>'reason','')) = '' then
        raise exception 'Agreed rate and reason are required' using errcode = '22023';
      end if;
      configured_rate := private.training_component_decimal(component->>'agreed_rate',2);
      if configured_rate > customer_rate then
        raise exception 'Allocation exceeds customer rate' using errcode = '22023';
      end if;
    elsif component ? 'agreed_rate' then
      raise exception 'Allocation has no configured rate' using errcode = '22023';
    end if;
    if basis in ('kilometre','night','agreed_quantity') then
      if jsonb_typeof(component->'quantity') is distinct from 'string'
        or trim(coalesce(component->>'reason','')) = ''
        or private.training_component_decimal(component->>'quantity',3) not between 0.001 and 100000 then
        raise exception 'Agreed quantity and reason are required' using errcode = '22023';
      end if;
      if basis = 'night' and (component->>'quantity')::numeric <> trunc((component->>'quantity')::numeric) then
        raise exception 'Accommodation requires whole nights' using errcode = '22023';
      end if;
    elsif component ? 'quantity' then
      raise exception 'Scheduled quantity is calculated from sessions' using errcode = '22023';
    end if;
    if component ? 'session_rates' then
      if jsonb_typeof(component->'session_rates') is distinct from 'object'
        or component->>'kind' <> 'on_site' or basis <> 'physical_session'
        or treatment not in ('commission','pass_through')
        or trim(component->>'reason') = '' then
        raise exception 'Session overrides require an on-site session allowance and a reason' using errcode = '22023';
      end if;
      if exists(select 1 from jsonb_each(component->'session_rates') item
        where jsonb_typeof(item.value) is distinct from 'string'
          or item.key !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
          or private.training_component_decimal(item.value #>> '{}',2) < 0) then
        raise exception 'Invalid on-site session override' using errcode = '22023';
      end if;
    end if;
    if component->>'kind' = 'on_site' then
      onsite_count := onsite_count + 1;
      if onsite_count > 1 or basis not in ('physical_day','physical_session','assignment','fixed_total') then
        raise exception 'One on-site allowance with a physical or assignment basis is permitted' using errcode = '22023';
      end if;
    end if;
  end loop;
end;
$$;

-- This hook resolves physical presence from existing operational delivery.
-- Installations with per-session delivery can replace this projection while
-- retaining the financial calculator and the accepted snapshot contract.
create function private.training_physical_job_session(p_job_id uuid,p_session_id uuid)
returns boolean language sql stable set search_path = '' as $$
  select exists(
    select 1 from public.job_sessions s join public.jobs j on j.id = s.job_id
    where s.job_id = p_job_id and s.id = p_session_id and j.delivery_type = 'onsite'
  );
$$;

create function private.calculate_training_components(
  p_job_id uuid,
  p_configuration jsonb,
  p_base_customer numeric,
  p_base_lecturer numeric,
  p_breaks jsonb default '{}'::jsonb
) returns jsonb language plpgsql stable set search_path = '' as $$
declare
  job public.jobs;
  component jsonb;
  session_count integer;
  physical_count integer;
  teaching_days integer;
  physical_days integer;
  teaching_minutes numeric;
  quantity numeric;
  customer_amount numeric;
  lecturer_amount numeric;
  customer_total numeric := 0;
  lecturer_total numeric := 0;
  rows jsonb := '[]'::jsonb;
  basis text;
begin
  select * into strict job from public.jobs where id = p_job_id;
  if jsonb_typeof(p_breaks) is distinct from 'object'
    or exists (
      select 1 from jsonb_each_text(p_breaks) item
      left join public.job_sessions slot on slot.job_id = job.id and slot.id::text = item.key
      where slot.id is null or case when coalesce(item.value,'') ~ '^[0-9]{1,6}$'
        then item.value::numeric > extract(epoch from slot.ends_at - slot.starts_at) / 60
        else true end
    ) then
    raise exception 'Invalid unpaid session break' using errcode = '22023';
  end if;
  select count(*), count(*) filter (where private.training_physical_job_session(job.id,s.id)),
    coalesce(sum(extract(epoch from s.ends_at - s.starts_at) / 60 - coalesce((p_breaks->>s.id::text)::numeric,0)),0)
    into session_count, physical_count, teaching_minutes
  from public.job_sessions s where s.job_id = job.id;

  -- Upper bounds keep unusual multi-day schedules from expanding an
  -- unbounded number of calendar days during a marketplace quote.
  if exists (
    select 1 from public.job_sessions s where s.job_id = job.id
    and (s.ends_at at time zone job.time_zone)::date - (s.starts_at at time zone job.time_zone)::date > 366
  ) then
    raise exception 'Commercial components require sessions shorter than one year' using errcode = '22023';
  end if;
  select count(distinct (d.day)::date),
    count(distinct (d.day)::date) filter (where private.training_physical_job_session(job.id,s.id))
    into teaching_days, physical_days
  from public.job_sessions s cross join lateral generate_series(
    (s.starts_at at time zone job.time_zone)::date,
    ((s.ends_at - interval '1 microsecond') at time zone job.time_zone)::date,
    interval '1 day'
  ) d(day) where s.job_id = job.id;

  for component in select value from jsonb_array_elements(p_configuration->'components') loop
    basis := component->>'basis';
    if basis = 'course' and job.capacity <> 1 then
      raise exception 'Per-course components require one assignment position' using errcode = '22023';
    end if;
    quantity := case basis
      when 'session' then session_count
      when 'teaching_day' then teaching_days
      when 'teaching_hour' then teaching_minutes / 60
      when 'teaching_unit' then teaching_minutes / (p_configuration->>'unit_minutes')::numeric
      when 'physical_day' then physical_days
      when 'physical_session' then physical_count
      when 'kilometre' then (component->>'quantity')::numeric
      when 'night' then (component->>'quantity')::numeric
      when 'agreed_quantity' then (component->>'quantity')::numeric
      else 1
    end;
    if component->>'kind' = 'on_site' and physical_count = 0 then
      quantity := 0;
    end if;
    customer_amount := round(quantity * (component->>'customer_rate')::numeric,2);
    if component ? 'session_rates' then
      if exists(select 1 from jsonb_each_text(component->'session_rates') item
        where not exists(select 1 from public.job_sessions s
          where s.id::text = item.key and s.job_id = job.id and private.training_physical_job_session(job.id,s.id))) then
        raise exception 'Only physical sessions of this offer can override the allowance' using errcode = '22023';
      end if;
      select coalesce(sum(coalesce((component->'session_rates'->>s.id::text)::numeric,
        (component->>'customer_rate')::numeric)),0) into customer_amount
      from public.job_sessions s where s.job_id = job.id and private.training_physical_job_session(job.id,s.id);
    end if;
    lecturer_amount := case component->>'treatment'
      when 'pass_through' then customer_amount
      when 'commission' then case when p_base_customer = 0 then 0
        else round(customer_amount * p_base_lecturer / p_base_customer,2) end
      when 'custom' then round(quantity * (component->>'agreed_rate')::numeric,2)
      when 'fixed_platform' then customer_amount - round(quantity * (component->>'agreed_rate')::numeric,2)
    end;
    customer_total := customer_total + customer_amount;
    lecturer_total := lecturer_total + lecturer_amount;
    rows := rows || jsonb_build_array(component || jsonb_build_object(
      'units', round(quantity,6), 'customer_amount',customer_amount,
      'lecturer_amount',lecturer_amount,'platform_amount',customer_amount-lecturer_amount
    ));
  end loop;
  if p_base_customer + customer_total > 9999999999.99
    or p_base_lecturer + lecturer_total > 9999999999.99 then
    raise exception 'Calculated compensation exceeds supported monetary precision' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'components',rows,'base_customer',p_base_customer,'base_lecturer',p_base_lecturer,
    'customer_total',p_base_customer + customer_total,'lecturer_total',p_base_lecturer + lecturer_total,
    'platform_total',p_base_customer + customer_total - p_base_lecturer - lecturer_total,
    'paid_teaching_minutes',teaching_minutes,'teaching_days',teaching_days,'physical_days',physical_days,
    'currency',job.currency
  );
end;
$$;

-- Copy the existing base calculation without moving its live signature or
-- changing historical overrides. All current consumers keep the same quote ABI.
do $migration$
declare
  definition text := pg_catalog.pg_get_functiondef('private.lecturer_job_quote(uuid,uuid)'::regprocedure);
begin
  execute replace(definition, 'FUNCTION private.lecturer_job_quote(', 'FUNCTION private.lecturer_job_quote_before_training_components(');
end
$migration$;

create or replace function private.lecturer_job_quote(p_user_id uuid,p_job_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  quote jsonb := private.lecturer_job_quote_before_training_components(p_user_id,p_job_id);
  offer private.job_commission_offers%rowtype;
  calculation jsonb;
begin
  if quote is null then return null; end if;
  select * into offer from private.job_commission_offers where job_id = p_job_id;
  if offer.training_components is null then return quote; end if;
  calculation := private.calculate_training_components(p_job_id,offer.training_components->'configuration',
    offer.gross_total_amount,(quote->>'total_amount')::numeric,offer.training_components->'unpaid_breaks');
  return quote || jsonb_build_object(
    'amount',case when quote->>'rate_unit' = 'fixed_total' then (calculation->>'lecturer_total')::numeric
      else (quote->>'amount')::numeric end,
    'total_amount',(calculation->>'lecturer_total')::numeric
  );
exception when invalid_parameter_value or no_data_found then
  -- A previously edited schedule must not offer an invalid or over-budget quote.
  return null;
end;
$$;

-- Use the same authoritative accepted-claim trigger for every claim path.
-- The existing ledger owns confidential amounts and its immutable history.
create or replace function private.capture_claim_revenue()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  offer private.job_commission_offers%rowtype;
  calculation jsonb;
  before_quote jsonb;
  gross_amount numeric;
  gross_total numeric;
  platform numeric;
begin
  select * into offer from private.job_commission_offers where job_id = new.job_id;
  if not found then return new; end if;
  gross_amount := offer.gross_amount;
  gross_total := offer.gross_total_amount;
  if offer.training_components is not null then
    before_quote := private.lecturer_job_quote_before_training_components(new.lecturer_id,new.job_id);
    calculation := private.calculate_training_components(new.job_id, offer.training_components->'configuration',
      gross_total,(before_quote->>'total_amount')::numeric,offer.training_components->'unpaid_breaks');
    gross_total := (calculation->>'customer_total')::numeric;
    if before_quote is null or (calculation->>'lecturer_total')::numeric is distinct from new.total_amount
      or offer.currency <> new.currency then
      raise exception 'Commercial terms changed; review the current quote' using errcode = '23514';
    end if;
    if new.rate_unit = 'fixed_total' then gross_amount := gross_total; end if;
  end if;
  platform := case when gross_total = 0 then 0
    else round((gross_total - new.total_amount) / gross_total * 100,2) end;
  insert into private.claim_revenue_ledger(
    claim_id,job_id,organisation_id,lecturer_id,gross_amount,gross_total_amount,
    platform_percent,platform_total_amount,lecturer_net_amount,lecturer_net_total_amount,currency,training_snapshot
  ) values (
    new.id,new.job_id,offer.organisation_id,new.lecturer_id,gross_amount,gross_total,
    platform,gross_total-new.total_amount,new.amount,new.total_amount,offer.currency,
    case when calculation is not null then calculation || offer.training_components
      || jsonb_build_object('creation_preset',offer.training_creation_preset) end
  );
  return new;
end;
$$;

-- Keep changes to gross settings and scheduled quantities independently
-- revisioned. Lock the same job row as acceptance before changing its quote.
create function private.training_offer_compensation(
  p_job_id uuid,p_action text,p_expected_version integer,p_payload jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  job public.jobs;
  offer private.job_commission_offers%rowtype;
  configuration jsonb;
  breaks jsonb;
  applied_json jsonb;
  preview jsonb;
  editable boolean;
  accepted jsonb;
begin
  if not private.has_permission('finance.gross.read') then
    raise exception 'Gross finance access required' using errcode = '42501';
  end if;
  if p_action not in ('read','preview','save') or p_action is null then
    raise exception 'Unsupported compensation action' using errcode = '22023';
  end if;
  if p_action = 'save' then
    select * into job from public.jobs where id = p_job_id for update;
  else
    select * into job from public.jobs where id = p_job_id;
  end if;
  select * into offer from private.job_commission_offers where job_id = p_job_id;
  if job.id is null or offer.job_id is null or offer.pricing_mode <> 'role_split' then return null; end if;
  editable := job.status in ('draft','published') and not exists(select 1 from public.job_claims c where c.job_id = job.id);
  applied_json := offer.training_components;
  if p_action <> 'read' then
    if not editable or p_expected_version is distinct from job.terms_version then
      raise exception 'Offer was changed; reload before configuring compensation' using errcode = '40001';
    end if;
    if jsonb_typeof(p_payload) is distinct from 'object' or p_payload - array['configuration','unpaid_breaks'] <> '{}'::jsonb then
      raise exception 'Invalid compensation payload' using errcode = '22023';
    end if;
    configuration := p_payload->'configuration';
    breaks := coalesce(p_payload->'unpaid_breaks','{}'::jsonb);
    perform private.validate_training_components(configuration);
    perform private.calculate_training_components(job.id,configuration,offer.gross_total_amount,
      offer.gross_total_amount,breaks);
    applied_json := jsonb_build_object('configuration',configuration,'unpaid_breaks',breaks);
    if jsonb_array_length(configuration->'components') = 0 then applied_json := null; end if;
    if p_action = 'save' and applied_json is distinct from offer.training_components then
      update private.job_commission_offers set training_components = applied_json,updated_at = clock_timestamp()
      where job_id = job.id;
      update public.jobs set terms_version = terms_version + 1 where id = job.id returning * into job;
      insert into public.audit_events(actor_id,action,resource_id,details)
      values(auth.uid(),'job.commercial_components_saved',job.id,jsonb_build_object('terms_version',job.terms_version));
    end if;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'claim_id',accepted_claim.claim_id,'snapshot',accepted_claim.training_snapshot
  ) order by accepted_claim.claim_id),'[]'::jsonb) into accepted
  from private.claim_revenue_ledger accepted_claim where accepted_claim.job_id = job.id and accepted_claim.training_snapshot is not null;
  if editable and applied_json is not null then
    begin
      preview := private.calculate_training_components(job.id,applied_json->'configuration',
        offer.gross_total_amount,round(offer.gross_total_amount*coalesce(offer.regular_percent,50)/100,2),
        applied_json->'unpaid_breaks');
    exception when invalid_parameter_value then
      if p_action <> 'read' then raise; end if;
      -- Keep stale configurations editable after authorised schedule changes.
      preview := null;
    end;
  end if;
  return jsonb_build_object(
    'job_id',job.id,'organisation_id',offer.organisation_id,'currency',offer.currency,
    'terms_version',job.terms_version,'editable',editable,'plan',applied_json,'preview',preview,
    'base_rate',offer.gross_amount::text,'rate_unit',job.rate_unit,
    'accepted',accepted,'sessions',(select coalesce(jsonb_agg(jsonb_build_object(
      'id',s.id,'starts_at',s.starts_at,'ends_at',s.ends_at,
      'physical',private.training_physical_job_session(job.id,s.id)
    ) order by s.starts_at,s.id),'[]'::jsonb) from public.job_sessions s where s.job_id = job.id)
  );
end;
$$;

create function public.training_offer_compensation(
  p_job_id uuid,p_action text,p_expected_version integer default null,p_payload jsonb default null
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.training_offer_compensation(p_job_id,p_action,p_expected_version,p_payload);
$$;

-- Customer presets are scoped even for internal administrators. An archived
-- preset never mutates the copied draft or its accepted claim.
create function private.training_commercial_presets(
  p_organisation_id uuid,p_action text,p_preset_id uuid,p_expected_revision integer,p_payload jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  preset private.training_commercial_presets%rowtype;
  preset_name text;
  preset_base_rate numeric;
  preset_rate_unit text;
begin
  if not private.has_permission('finance.gross.read') then
    raise exception 'Gross finance access required' using errcode = '42501';
  end if;
  if p_action not in ('list','save','archive') or p_action is null
    or not exists(select 1 from public.organisations where id = p_organisation_id and archived_at is null) then
    raise exception 'Active customer and valid preset action required' using errcode = '22023';
  end if;
  if p_action = 'list' then
    return coalesce((select jsonb_agg((to_jsonb(saved_preset) - 'organisation_id') || jsonb_build_object('base_rate',saved_preset.base_rate::text) order by lower(saved_preset.name),saved_preset.id)
      from private.training_commercial_presets saved_preset
      where saved_preset.organisation_id = p_organisation_id and saved_preset.archived_at is null),'[]'::jsonb);
  end if;
  perform 1 from public.organisations where id = p_organisation_id and archived_at is null for share;
  if not found then raise exception 'Active customer required' using errcode = '22023'; end if;
  if p_preset_id is not null then
    select * into preset from private.training_commercial_presets
    where id = p_preset_id and organisation_id = p_organisation_id and archived_at is null for update;
    if not found or p_expected_revision is distinct from preset.revision then
      raise exception 'Customer preset was changed or is unavailable' using errcode = '40001';
    end if;
  elsif p_expected_revision is distinct from 0 or p_action = 'archive' then
    raise exception 'Preset revision required' using errcode = '22023';
  end if;
  if p_action = 'save' then
    if jsonb_typeof(p_payload) is distinct from 'object'
      or p_payload - array['name','currency','configuration','base_rate','rate_unit'] <> '{}'::jsonb
      or coalesce(p_payload->>'currency','') not in ('EUR','AUD','USD','CHF') then
      raise exception 'Invalid customer preset' using errcode = '22023';
    end if;
    preset_name := trim(coalesce(p_payload->>'name',''));
    if length(preset_name) not between 1 and 120 then
      raise exception 'A preset name is required' using errcode = '22023';
    end if;
    perform private.validate_training_components(p_payload->'configuration');
    if exists(select 1 from jsonb_array_elements(p_payload->'configuration'->'components') line
      where line ? 'session_rates') then
      raise exception 'A customer preset cannot contain offer session IDs' using errcode = '22023';
    end if;
    preset_rate_unit := p_payload->>'rate_unit';
    if p_payload->>'base_rate' is not null or preset_rate_unit is not null then
      preset_base_rate := private.training_component_decimal(p_payload->>'base_rate',2);
      if preset_base_rate <= 0 or coalesce(preset_rate_unit,'') not in ('per_day','per_hour','per_teaching_unit','fixed_total') then
        raise exception 'Invalid preset base fee' using errcode = '22023';
      end if;
    end if;
    if p_preset_id is null then
      insert into private.training_commercial_presets(organisation_id,name,currency,configuration,base_rate,rate_unit)
      values(p_organisation_id,preset_name,p_payload->>'currency',p_payload->'configuration',preset_base_rate,preset_rate_unit)
      returning * into preset;
    else
      update private.training_commercial_presets update_target
        set name = preset_name,currency = p_payload->>'currency',configuration = p_payload->'configuration',
          base_rate = preset_base_rate,rate_unit = preset_rate_unit,
          revision = revision + 1,updated_at = clock_timestamp()
      where update_target.id = preset.id returning * into preset;
    end if;
  else
    update private.training_commercial_presets set archived_at = clock_timestamp(),
      revision = revision + 1,updated_at = clock_timestamp() where id = preset.id returning * into preset;
  end if;
  insert into public.audit_events(actor_id,action,resource_id,details)
  values(auth.uid(),case when p_action = 'archive' then 'organisation.commercial_preset_archived'
    else 'organisation.commercial_preset_saved' end,preset.id,
    jsonb_build_object('organisation_id',p_organisation_id,'revision',preset.revision));
  return (to_jsonb(preset) - 'organisation_id') || jsonb_build_object('base_rate',preset.base_rate::text);
end;
$$;
create function public.training_commercial_presets(
  p_organisation_id uuid,p_action text,p_preset_id uuid default null,
  p_expected_revision integer default null,p_payload jsonb default null
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.training_commercial_presets(p_organisation_id,p_action,p_preset_id,p_expected_revision,p_payload);
$$;

-- Publish or save the reviewed course offer and copied terms in one
-- transaction. Repeat requests use the same base command and preset revision.
create function private.create_training_offer_from_preset(
  p_course_run_id uuid,p_payload jsonb,p_platform_percent numeric,p_client_id uuid,
  p_preset_id uuid,p_preset_revision integer
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  prior private.course_run_job_requests%rowtype;
  preset private.training_commercial_presets%rowtype;
  created_job_id uuid;
  current_version integer;
  preset_source jsonb := jsonb_build_object('id',p_preset_id,'revision',p_preset_revision);
  receipt jsonb;
begin
  if not private.has_permission('finance.gross.read') or not private.has_permission('courses.manage')
    or not private.has_permission('jobs.manage') then
    raise exception 'Course, job and gross finance access required' using errcode = '42501';
  end if;
  if p_preset_id is null or p_preset_revision is null or p_client_id is null then
    raise exception 'Exact customer preset version and request key required' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('client-request:'||auth.uid()::text,0));
  select * into prior from private.course_run_job_requests
  where actor_id = auth.uid() and client_id = p_client_id;
  if prior.job_id is not null then
    if not exists(select 1 from private.job_commission_offers o
      where o.job_id = prior.job_id and o.training_creation_preset = preset_source) then
      raise exception 'Request preset does not match the committed offer' using errcode = '22023';
    end if;
    return private.create_course_run_job(p_course_run_id,p_payload,p_platform_percent,p_client_id);
  end if;
  select p.* into preset from private.training_commercial_presets p
  join public.course_runs r on r.id = p_course_run_id and r.organisation_id = p.organisation_id
  where p.id = p_preset_id and p.revision = p_preset_revision and p.archived_at is null
  for share of p;
  if not found or p_payload->>'currency' is distinct from preset.currency then
    raise exception 'Current matching customer preset required' using errcode = '40001';
  end if;
  created_job_id := private.create_course_run_job(p_course_run_id,p_payload,p_platform_percent,p_client_id);
  select terms_version into strict current_version from public.jobs where id = created_job_id;
  receipt := private.training_offer_compensation(created_job_id,'save',current_version,
    jsonb_build_object('configuration',preset.configuration,'unpaid_breaks','{}'::jsonb));
  if receipt is null then
    raise exception 'An authorised paid course offer is required' using errcode = '22023';
  end if;
  update private.job_commission_offers entry set training_creation_preset = preset_source
  where entry.job_id = created_job_id;
  return created_job_id;
end;
$$;

create function public.create_training_offer_from_preset(
  p_course_run_id uuid,p_payload jsonb,p_platform_percent numeric,p_client_id uuid,
  p_preset_id uuid,p_preset_revision integer
) returns uuid language sql security invoker set search_path = '' as $$
  select private.create_training_offer_from_preset(p_course_run_id,p_payload,p_platform_percent,p_client_id,
    p_preset_id,p_preset_revision);
$$;

-- Nothing in the lecturer-facing snapshot identifies customer amounts, rates,
-- or platform share. Recheck actor and owning claim on every read.
create function private.training_assignment_compensation(p_claim_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'currency',l.currency,'base_amount',(l.training_snapshot->>'base_lecturer')::numeric,
    'total_amount',l.lecturer_net_total_amount,'components',(select coalesce(
      jsonb_agg(jsonb_build_object('kind',line->>'kind','label',line->>'label',
        'basis',line->>'basis','units',(line->>'units')::numeric,'amount',(line->>'lecturer_amount')::numeric)),
      '[]'::jsonb) from jsonb_array_elements(l.training_snapshot->'components') line)
  )
  from private.claim_revenue_ledger l join public.job_claims c on c.id = l.claim_id
  where l.claim_id = p_claim_id and l.training_snapshot is not null
    and private.actor_active() and c.lecturer_id = auth.uid();
$$;
create function public.training_assignment_compensation(p_claim_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.training_assignment_compensation(p_claim_id);
$$;

revoke all on function private.training_component_decimal(text,integer),
  private.validate_training_components(jsonb),private.training_physical_job_session(uuid,uuid),
  private.calculate_training_components(uuid,jsonb,numeric,numeric,jsonb),
  private.lecturer_job_quote_before_training_components(uuid,uuid)
  from public,anon,authenticated,service_role;
revoke all on function private.training_offer_compensation(uuid,text,integer,jsonb),
  public.training_offer_compensation(uuid,text,integer,jsonb),
  private.create_training_offer_from_preset(uuid,jsonb,numeric,uuid,uuid,integer),
  public.create_training_offer_from_preset(uuid,jsonb,numeric,uuid,uuid,integer),
  private.training_commercial_presets(uuid,text,uuid,integer,jsonb),
  public.training_commercial_presets(uuid,text,uuid,integer,jsonb),
  private.training_assignment_compensation(uuid),public.training_assignment_compensation(uuid)
  from public,anon,authenticated,service_role;
grant execute on function private.training_offer_compensation(uuid,text,integer,jsonb),
  public.training_offer_compensation(uuid,text,integer,jsonb),
  private.create_training_offer_from_preset(uuid,jsonb,numeric,uuid,uuid,integer),
  public.create_training_offer_from_preset(uuid,jsonb,numeric,uuid,uuid,integer),
  private.training_commercial_presets(uuid,text,uuid,integer,jsonb),
  public.training_commercial_presets(uuid,text,uuid,integer,jsonb),
  private.training_assignment_compensation(uuid),public.training_assignment_compensation(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
