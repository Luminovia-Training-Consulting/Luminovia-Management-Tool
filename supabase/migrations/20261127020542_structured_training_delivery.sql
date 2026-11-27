-- Structured venue revisions and delivery overrides coexist with retained legacy course fields.
begin;

create table private.training_venues (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id),
  revision integer not null default 1,
  details jsonb not null,
  is_default boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index training_venue_name_room on private.training_venues(
  organisation_id,lower(btrim(details->>'name')),lower(btrim(coalesce(details->>'room','')))
) where archived_at is null;
create unique index training_venue_default on private.training_venues(organisation_id)
  where is_default and archived_at is null;

create table private.training_course_delivery (
  course_run_id uuid primary key references public.course_runs(id) on delete cascade,
  revision integer not null default 1,
  defaults jsonb not null,
  overrides_enabled boolean not null default false
);

create table private.training_session_delivery (
  course_session_id uuid primary key references public.course_sessions(id) on delete cascade,
  config jsonb not null
);

create table private.training_assignment_delivery (
  claim_id uuid primary key references public.job_claims(id) on delete cascade,
  sessions jsonb not null,
  captured_at timestamptz not null default now()
);
alter table private.training_venues enable row level security;
alter table private.training_course_delivery enable row level security;
alter table private.training_session_delivery enable row level security;
alter table private.training_assignment_delivery enable row level security;
revoke all on private.training_venues,private.training_course_delivery,
  private.training_session_delivery,private.training_assignment_delivery from public,anon,authenticated,service_role;

-- Keep one lock key for delivery updates and the assignment snapshot boundary.
create function private.lock_training_delivery(p_run uuid)
returns void language sql volatile security invoker set search_path = '' as $$
  select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('training-delivery:' || p_run::text,0))
$$;

create function private.training_venue_directory(p_organisation_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.actor_active() or not private.has_permission('courses.manage')
    or not exists(select from public.organisations where id=p_organisation_id and archived_at is null) then
    raise insufficient_privilege;
  end if;
  return (select coalesce(jsonb_agg(to_jsonb(venue) order by venue.archived_at nulls first,
    venue.details->>'name',venue.details->>'room',venue.id),'[]'::jsonb)
    from (select id,revision,details,is_default,archived_at
      from private.training_venues where organisation_id=p_organisation_id
      order by archived_at nulls first,details->>'name',id limit 500) venue);
end;
$$;

create function private.save_training_venue(p_organisation_id uuid,p_venue_id uuid,p_expected_revision integer,p_payload jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  location private.training_venues;
  properties jsonb := p_payload->'details';
  default_location boolean;
  archived boolean;
begin
  if not private.actor_active() or not private.has_permission('courses.manage') then
    raise insufficient_privilege;
  end if;
  if exists(select from private.installation_identity where edition<>'internal') then
    perform private.lock_academy_course_access();
  end if;
  perform 1 from public.organisations where id=p_organisation_id and archived_at is null for no key update;
  if not found then raise insufficient_privilege; end if;
  if p_expected_revision is null or p_expected_revision<0 or jsonb_typeof(p_payload) is distinct from 'object'
    or p_payload-array['details','is_default','archived']<>'{}'
    or jsonb_typeof(p_payload->'is_default') is distinct from 'boolean'
    or jsonb_typeof(p_payload->'archived') is distinct from 'boolean'
    or jsonb_typeof(properties) is distinct from 'object'
    or properties-array['name','street','house_number','address_line','postal_code','city','region','country',
      'building','floor','room','time_zone','contact_name','contact_phone','contact_email','reception','access',
      'parking','transport','accessibility','equipment','notes']<>'{}'
    or char_length(btrim(coalesce(properties->>'name',''))) not between 1 and 160
    or char_length(btrim(coalesce(properties->>'country',''))) not between 1 and 100
    or char_length(btrim(coalesce(properties->>'city',''))) not between 1 and 160
    or not exists (select from pg_catalog.pg_timezone_names zone where zone.name=properties->>'time_zone')
    or exists (select from jsonb_each(properties) entry where jsonb_typeof(entry.value)<>'string'
      or char_length(entry.value#>>'{}')>1000) then raise invalid_parameter_value; end if;
  default_location := (p_payload->>'is_default')::boolean;
  archived := (p_payload->>'archived')::boolean;
  if archived and default_location then raise invalid_parameter_value; end if;
  if p_venue_id is not null then
    select * into location from private.training_venues where id=p_venue_id
      and organisation_id=p_organisation_id for update;
    if not found then raise insufficient_privilege; end if;
    if location.revision<>p_expected_revision then
      raise exception 'Venue changed' using errcode='PT409';
    end if;
  elsif p_expected_revision<>0 or archived then
    raise invalid_parameter_value;
  end if;
  if default_location then
    update private.training_venues set is_default=false,revision=revision+1,updated_at=now()
    where organisation_id=p_organisation_id and is_default and id is distinct from p_venue_id;
  end if;
  if p_venue_id is null then
    insert into private.training_venues(organisation_id,details,is_default)
    values(p_organisation_id,properties,default_location)
    returning id into p_venue_id;
  else
    update private.training_venues set details=properties,is_default=default_location,
      archived_at=case when archived then coalesce(location.archived_at,now()) end,
      updated_at=now(),revision=revision+1 where id=p_venue_id;
  end if;
  return p_venue_id;
end;
$$;

-- Venue facts are copied at the time of selection. A directory edit never moves a course.
-- An override uses key absence to inherit and an explicit null to clear a nullable field.
create function private.validate_training_delivery_config(p_course public.course_runs,p_config jsonb,p_previous jsonb,p_is_default boolean)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  venue private.training_venues;
  selected_venue uuid;
  field text;
begin
  if jsonb_typeof(p_config) is distinct from 'object'
    or p_config-array['mode','venue_id','meeting_platform','meeting_url','meeting_id',
       'meeting_access','teaching_instructions']<>'{}'
    or ((p_is_default or p_config ? 'mode') and coalesce(p_config->>'mode','') not in ('online','onsite','hybrid')) then
    raise invalid_parameter_value;
  end if;
  foreach field in array array['meeting_platform','meeting_url','meeting_id','meeting_access','teaching_instructions']
  loop
    if p_config ? field and (jsonb_typeof(p_config->field) not in ('string','null')
        or char_length(p_config->>field)>2000) then raise invalid_parameter_value; end if;
  end loop;
  if p_config->>'meeting_platform' is not null and p_config->>'meeting_platform'
    not in ('teams','zoom','meet','webex','other') then raise invalid_parameter_value; end if;
  if nullif(p_config->>'meeting_url','') is not null and not private.readiness_https_url(p_config->>'meeting_url') then
    raise invalid_parameter_value;
  end if;
  selected_venue:=nullif(p_config->>'venue_id','')::uuid;
  if selected_venue is null then
    return case when p_config ? 'venue_id' then p_config || '{"venue":null}'::jsonb else p_config end;
  end if;
  if p_previous->>'venue_id'=selected_venue::text and jsonb_typeof(p_previous->'venue')='object' then
    return p_config || jsonb_build_object('venue',p_previous->'venue');
  end if;
  select * into venue from private.training_venues where id=selected_venue and organisation_id=p_course.organisation_id
    and archived_at is null;
  if not found then raise invalid_parameter_value; end if;
  return p_config || jsonb_build_object('venue',venue.details);
end;
$$;

create function private.training_effective_delivery(p_run uuid)
returns table(session_id uuid,starts_at timestamptz,ends_at timestamptz,config jsonb,overridden boolean)
language sql stable security invoker set search_path = '' as $$
  select session.id,session.starts_at,session.ends_at,
    delivery.defaults || case when delivery.overrides_enabled then coalesce(override.config,'{}'::jsonb)
      else '{}'::jsonb end,
    delivery.overrides_enabled and override.course_session_id is not null
  from public.course_sessions session
  join private.training_course_delivery delivery on delivery.course_run_id=session.course_run_id
  left join private.training_session_delivery override on override.course_session_id=session.id
  where session.course_run_id=p_run
$$;

create function private.training_delivery_complete(p_run uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select not exists (
    select 1 from private.training_effective_delivery(p_run) session
    where (session.config->>'mode' in ('onsite','hybrid') and
      jsonb_typeof(session.config->'venue') is distinct from 'object')
      or (session.config->>'mode' in ('online','hybrid') and
        not private.readiness_https_url(coalesce(session.config->>'meeting_url','')))
  )
$$;

create function private.training_delivery_locked(p_run uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists(select from public.jobs job where job.course_run_id=p_run and
    (job.status in ('published','filled') or exists(select from public.job_claims claim where claim.job_id=job.id)))
    or exists(select from public.course_enrolments where course_run_id=p_run)
    or exists(select from public.course_sessions where course_run_id=p_run and starts_at<=now())
$$;

create function private.training_delivery_view(p_course_run_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  access jsonb:=private.course_workspace_context(p_course_run_id);
  run public.course_runs;
  course private.training_course_delivery;
  manager boolean:=(access->>'manager')::boolean;
  full_access boolean:=manager or (access->>'learner')::boolean;
  mode text;
begin
  select * into strict run from public.course_runs where id=p_course_run_id;
  select * into course from private.training_course_delivery where course_run_id=p_course_run_id;
  if course.course_run_id is null and not manager then return null; end if;
  select case when count(distinct config->>'mode')>1 then 'mixed'
    else coalesce(min(config->>'mode'),course.defaults->>'mode',run.delivery_type) end
  into mode from private.training_effective_delivery(p_course_run_id);
  return jsonb_build_object('organisation_id',case when manager then run.organisation_id end,
    'revision',coalesce(course.revision,0),'mode',mode,'can_edit',manager and not private.training_delivery_locked(run.id),
    'overrides_enabled',coalesce(course.overrides_enabled,false),
    'defaults',case when manager then coalesce(course.defaults,jsonb_build_object('mode',run.delivery_type))
      else null end,
    'sessions',coalesce((
      select jsonb_agg(jsonb_build_object('id',session.id,'starts_at',session.starts_at,
        'ends_at',session.ends_at,
        'effective',case when details.config is null then null else
          jsonb_build_object('mode',details.config->>'mode',
            'venue',case when details.config->>'mode'<>'online' and sensitive.visible then
              case when manager then details.config->'venue' else
                (details.config->'venue')-array['notes','contact_name','contact_phone','contact_email'] end
            end,
            'meeting_platform',case when details.config->>'mode'<>'onsite' and sensitive.visible then details.config->'meeting_platform' end,
            'meeting_url',case when details.config->>'mode'<>'onsite' and sensitive.visible then details.config->'meeting_url' end,
            'meeting_id',case when details.config->>'mode'<>'onsite' and sensitive.visible then details.config->'meeting_id' end,
            'meeting_access',case when details.config->>'mode'<>'onsite' and sensitive.visible then details.config->'meeting_access' end,
            'teaching_instructions',case when sensitive.visible then details.config->'teaching_instructions' end)
        end,
        'override',case when manager then override.config end)
        order by session.starts_at,session.id)
      from public.course_sessions session left join private.training_effective_delivery(run.id) details on details.session_id=session.id
      left join private.training_session_delivery override on override.course_session_id=session.id
      cross join lateral (
        select full_access or ((access->>'teacher')::boolean and exists (
          select from public.assignment_sessions booking
          join public.job_claims claim on claim.id=booking.claim_id and claim.status='confirmed'
          join public.jobs job on job.id=claim.job_id and job.course_run_id=run.id
          where booking.lecturer_id=auth.uid() and booking.released_at is null
            and (booking.starts_at,booking.ends_at)=(session.starts_at,session.ends_at)
        )) as visible
      ) sensitive
      where session.course_run_id=run.id),'[]'::jsonb));
end;
$$;

create function private.save_training_delivery(p_course_run_id uuid,p_expected_revision integer,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  run public.course_runs;
  current_config private.training_course_delivery;
  defaults jsonb;
  override jsonb;
  slot uuid;
  prior_override jsonb;
begin
  if not private.actor_active() or not private.has_permission('courses.manage') then raise insufficient_privilege; end if;
  if exists(select from private.installation_identity where edition<>'internal') then
    perform private.lock_academy_course_access();
  end if;
  select * into run from public.course_runs where id=p_course_run_id and archived_at is null for no key update;
  if not found then raise insufficient_privilege; end if;
  perform private.lock_training_delivery(run.id);
  if private.training_delivery_locked(run.id) then raise exception 'Agreed or started delivery is retained' using errcode='PT409'; end if;
  select * into current_config from private.training_course_delivery where course_run_id=run.id;
  if p_expected_revision is distinct from coalesce(current_config.revision,0) then
    raise exception 'Delivery revision changed' using errcode='PT409';
  end if;
  if jsonb_typeof(p_payload) is distinct from 'object'
    or p_payload-array['defaults','overrides_enabled','overrides']<>'{}'
    or jsonb_typeof(p_payload->'overrides_enabled') is distinct from 'boolean'
    or jsonb_typeof(p_payload->'overrides') is distinct from 'object'
    or (select count(*) from jsonb_object_keys(p_payload->'overrides'))>60 then raise invalid_parameter_value; end if;
  defaults := private.validate_training_delivery_config(run,p_payload->'defaults',current_config.defaults,true);
  insert into private.training_course_delivery(course_run_id,defaults,overrides_enabled)
  values(run.id,defaults,(p_payload->>'overrides_enabled')::boolean)
  on conflict(course_run_id) do update set defaults=excluded.defaults,overrides_enabled=excluded.overrides_enabled,
    revision=training_course_delivery.revision+1;
  -- A patch touches only the explicitly supplied rows. Disabling inheritance
  -- overrides retains their configuration until the administrator resets a row.
  for slot,override in select key::uuid,value from jsonb_each(p_payload->'overrides') loop
    if not exists(select from public.course_sessions where id=slot and course_run_id=run.id) then
      raise insufficient_privilege;
    end if;
    if override='null'::jsonb or override='{}'::jsonb then
      delete from private.training_session_delivery where course_session_id=slot;
    else
      select config into prior_override from private.training_session_delivery where course_session_id=slot;
      override:=private.validate_training_delivery_config(run,override,prior_override,false);
      insert into private.training_session_delivery(course_session_id,config) values(slot,override)
      on conflict(course_session_id) do update set config=excluded.config;
    end if;
  end loop;
  if run.published and not private.training_delivery_complete(run.id) then
    raise exception 'Complete each effective delivery location and meeting URL first' using errcode='22023';
  end if;
  return private.training_delivery_view(run.id);
end;
$$;

-- Unconfigured courses keep their existing readiness and publication rules.
-- Publication evaluates the actual inherited settings, including Hybrid requirements.
create function private.guard_training_delivery_publication()
returns trigger language plpgsql security definer set search_path = '' as $$
declare course_id uuid;
begin
  if tg_table_name='jobs' then
    if new.status not in ('published','filled') then return new; end if;
    course_id:=new.course_run_id;
  else
    if not new.published then return new; end if;
    course_id:=new.id;
  end if;
  if course_id is not null then
    perform private.lock_training_delivery(course_id);
    if not private.training_delivery_complete(course_id) then
      raise exception 'Complete each effective delivery location and meeting URL first' using errcode='22023';
    end if;
  end if;
  return new;
end;
$$;
create trigger structured_course_publication before update of published on public.course_runs
  for each row when (new.published is distinct from old.published) execute function private.guard_training_delivery_publication();
create trigger structured_offer_publication before update of status on public.jobs
  for each row when (new.status is distinct from old.status) execute function private.guard_training_delivery_publication();

create function private.capture_training_assignment_delivery()
returns trigger language plpgsql security definer set search_path = '' as $$
declare course_id uuid; slots jsonb;
begin
  if new.status<>'confirmed' then return new; end if;
  select course_run_id into course_id from public.jobs where id=new.job_id;
  if course_id is null then return new; end if;
  perform private.lock_training_delivery(course_id);
  if not private.training_delivery_complete(course_id) then raise invalid_parameter_value; end if;
  select jsonb_agg(jsonb_build_object('id',effective.session_id,
    'starts_at',effective.starts_at,'ends_at',effective.ends_at,'config',effective.config)
    order by effective.starts_at,effective.session_id) into slots
  from private.training_effective_delivery(course_id) effective
  join public.job_sessions position on position.job_id=new.job_id and position.course_session_id=effective.session_id;
  if slots is not null then
    insert into private.training_assignment_delivery(claim_id,sessions) values(new.id,slots);
  end if;
  return new;
end;
$$;
create trigger training_assignment_delivery after insert on public.job_claims
  for each row execute function private.capture_training_assignment_delivery();

-- Public offer metadata contains the format and city/country only. No link,
-- access instructions or credentials are returned until workspace access exists.
create function private.training_offer_delivery(p_job_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare course_id uuid; agreement jsonb;
begin
  if not private.can_read_job(p_job_id) then raise insufficient_privilege; end if;
  select course_run_id into course_id from public.jobs where id=p_job_id;
  select capture.sessions into agreement from private.training_assignment_delivery capture
  join public.job_claims claim on claim.id=capture.claim_id
  where claim.job_id=p_job_id and claim.lecturer_id=auth.uid() and claim.status='confirmed';
  return (with effective as (
    select item.value->'config' as config from jsonb_array_elements(agreement) item
    union all
    select session.config from private.training_effective_delivery(course_id) session
    join public.job_sessions position on position.job_id=p_job_id and position.course_session_id=session.session_id
    where agreement is null
  )
  select jsonb_build_object(
    'mode',case when count(distinct effective.config->>'mode')>1 then 'mixed' else min(effective.config->>'mode') end,
    'locations',coalesce(jsonb_agg(distinct jsonb_build_object(
      'city',effective.config->'venue'->>'city','country',effective.config->'venue'->>'country'))
      filter(where effective.config->>'mode' in ('onsite','hybrid')),'[]'::jsonb))
    from effective having count(*)>0);
end;
$$;

create function public.training_venue_directory(p_organisation_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$ select private.training_venue_directory(p_organisation_id) $$;
create function public.save_training_venue(p_organisation_id uuid,p_venue_id uuid,p_expected_revision integer,p_payload jsonb) returns uuid
language sql security invoker set search_path='' as $$ select private.save_training_venue(p_organisation_id,p_venue_id,p_expected_revision,p_payload) $$;
create function public.training_delivery_view(p_course_run_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$ select private.training_delivery_view(p_course_run_id) $$;
create function public.save_training_delivery(p_course_run_id uuid,p_expected_revision integer,p_payload jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select private.save_training_delivery(p_course_run_id,p_expected_revision,p_payload) $$;
create function public.training_offer_delivery(p_job_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$ select private.training_offer_delivery(p_job_id) $$;

revoke all on function private.lock_training_delivery(uuid),private.validate_training_delivery_config(public.course_runs,jsonb,jsonb,boolean),
  private.training_effective_delivery(uuid),private.training_delivery_complete(uuid),private.training_delivery_locked(uuid),
  private.guard_training_delivery_publication(),private.capture_training_assignment_delivery()
  from public,anon,authenticated,service_role;
revoke all on function private.training_venue_directory(uuid),public.training_venue_directory(uuid),
  private.save_training_venue(uuid,uuid,integer,jsonb),public.save_training_venue(uuid,uuid,integer,jsonb),
  private.training_delivery_view(uuid),public.training_delivery_view(uuid),
  private.save_training_delivery(uuid,integer,jsonb),public.save_training_delivery(uuid,integer,jsonb),
  private.training_offer_delivery(uuid),public.training_offer_delivery(uuid)
  from public,anon,authenticated,service_role;
grant execute on function private.training_venue_directory(uuid),public.training_venue_directory(uuid),
  private.save_training_venue(uuid,uuid,integer,jsonb),public.save_training_venue(uuid,uuid,integer,jsonb),
  private.training_delivery_view(uuid),public.training_delivery_view(uuid),
  private.save_training_delivery(uuid,integer,jsonb),public.save_training_delivery(uuid,integer,jsonb),
  private.training_offer_delivery(uuid),public.training_offer_delivery(uuid)
  to authenticated;

-- Optional commercial integration follows the earlier remuneration migration.
-- Mode comes from the effective course schedule; standalone and legacy jobs
-- retain their existing on-site interpretation. Hybrid sessions require a venue.
do $migration$
begin
  if to_regprocedure('private.training_physical_job_session(uuid,uuid)') is not null then
    execute $function$
      create or replace function private.training_physical_job_session(p_job_id uuid,p_session_id uuid)
      returns boolean language sql stable security invoker set search_path = '' as $body$
        select coalesce(
          (select effective.config->>'mode' in ('onsite','hybrid')
             from private.training_effective_delivery(job.course_run_id) effective
             where effective.session_id=slot.course_session_id),
          job.delivery_type='onsite')
        from public.jobs job join public.job_sessions slot on slot.job_id=job.id
        where job.id=p_job_id and slot.id=p_session_id
      $body$
    $function$;
  end if;
end;
$migration$;

-- Preserve every previous readiness check while using the same structured
-- completeness rule for published courses, the workspace and Control Center.
do $migration$
declare
  definition text;
  legacy constant text := $legacy$delivery_ok=case r.delivery_type when 'online' then meeting<>'' else length(trim(r.venue))>0 end$legacy$;
begin
  definition:=pg_catalog.pg_get_functiondef('private.readiness_snapshot_for_start(uuid,boolean)'::regprocedure);
  if cardinality(string_to_array(definition,legacy))<>2 then
    raise exception 'Cannot extend the expected delivery readiness check';
  end if;
  definition:=replace(definition,legacy,
    'delivery_ok=case when exists(select from private.training_course_delivery where course_run_id=r.id)
      then private.training_delivery_complete(r.id) else '||substring(legacy from char_length('delivery_ok=')+1)||' end');
  execute definition;
end;
$migration$;

-- Dedicated Academy REST has a separate allowlist. Preserve every existing
-- rule and add delivery management to the same active-license boundary as draft scheduling.
do $migration$
declare definition text;
begin
  select pg_catalog.pg_get_functiondef('private.require_academy_course_access()'::regprocedure) into definition;
  if strpos(definition, '''/rpc/academy_draft_schedule''')=0
     or strpos(definition, '''/rpc/academy_save_draft_schedule''')=0 then
    raise exception 'Academy delivery baseline is missing';
  end if;
  definition:=replace(definition,'''/rpc/academy_draft_schedule''',
    '''/rpc/academy_draft_schedule'', ''/rpc/training_delivery_view'', ''/rpc/training_venue_directory''');
  definition:=replace(definition,'''/rpc/academy_save_draft_schedule''',
    '''/rpc/academy_save_draft_schedule'', ''/rpc/save_training_venue'', ''/rpc/save_training_delivery''');
  execute definition;
end;
$migration$;

commit;
