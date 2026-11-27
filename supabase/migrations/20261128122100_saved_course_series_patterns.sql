begin;

alter table private.course_series_requests
  add column organisation_id uuid,
  add column time_zone text,
  add column patterns jsonb not null default '{}'::jsonb;

-- Require every supplied instant to match the rule in the original IANA zone.
-- An explicit offset alone cannot make an ambiguous local teaching time valid.
create function private.validate_course_series_pattern(p_pattern jsonb, p_sessions jsonb, p_zone text)
returns void language plpgsql stable set search_path = '' as $$
declare
  first_day date;
  day_count integer;
  starts time;
  ends time;
  weekdays integer[];
  excluded date[];
  session_day date;
  local_start timestamp;
  local_end timestamp;
  submitted jsonb;
  actual_start timestamptz;
  actual_end timestamptz;
  position integer := 0;
begin
  if jsonb_typeof(p_pattern) is distinct from 'object'
    or not p_pattern ?& array['first_day','days','start','end','weekdays','excluded_dates']
    or p_pattern - array['first_day','days','start','end','weekdays','excluded_dates'] <> '{}'::jsonb
    or jsonb_typeof(p_pattern->'first_day') <> 'string'
    or p_pattern->>'first_day' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or jsonb_typeof(p_pattern->'days') <> 'number' or p_pattern->>'days' !~ '^[0-9]{1,2}$'
    or jsonb_typeof(p_pattern->'start') <> 'string'
    or p_pattern->>'start' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    or jsonb_typeof(p_pattern->'end') <> 'string'
    or p_pattern->>'end' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    or jsonb_typeof(p_pattern->'weekdays') <> 'array'
    or jsonb_typeof(p_pattern->'excluded_dates') <> 'string'
    or length(p_pattern->>'excluded_dates') > 1000
    or jsonb_typeof(p_sessions) is distinct from 'array' then
    raise invalid_parameter_value;
  end if;
  first_day := (p_pattern->>'first_day')::date;
  day_count := (p_pattern->>'days')::integer;
  starts := (p_pattern->>'start')::time;
  ends := (p_pattern->>'end')::time;
  if day_count not between 1 and 60 or jsonb_array_length(p_sessions) <> day_count or starts >= ends
    or jsonb_array_length(p_pattern->'weekdays') not between 1 and 7
    or exists (select 1 from jsonb_array_elements(p_pattern->'weekdays') d(value)
               where jsonb_typeof(d.value) <> 'number' or d.value::text !~ '^[1-7]$') then
    raise invalid_parameter_value;
  end if;
  select array_agg(distinct d.value::integer) into weekdays from jsonb_array_elements_text(p_pattern->'weekdays') d(value);
  if cardinality(weekdays) <> jsonb_array_length(p_pattern->'weekdays') then raise invalid_parameter_value; end if;
  if exists (select 1 from regexp_split_to_table(p_pattern->>'excluded_dates', '[[:space:],;]+') d(value)
             where d.value <> '' and d.value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') then raise invalid_parameter_value; end if;
  select coalesce(array_agg(distinct d.value::date), array[]::date[]) into excluded
    from regexp_split_to_table(p_pattern->>'excluded_dates', '[[:space:],;]+') d(value) where d.value <> '';
  if cardinality(excluded) > 60 then raise invalid_parameter_value; end if;

  for session_day in
    select first_day + n from generate_series(0,3659) n
    where extract(isodow from first_day + n)::integer = any(weekdays)
      and not ((first_day + n) = any(excluded))
    order by n limit day_count
  loop
    submitted := p_sessions->position;
    if jsonb_typeof(submitted) is distinct from 'object' or submitted - array['starts_at','ends_at'] <> '{}'::jsonb
      or coalesce(submitted->>'starts_at','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$'
      or coalesce(submitted->>'ends_at','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$' then
      raise invalid_parameter_value;
    end if;
    local_start := session_day + starts;
    local_end := session_day + ends;
    actual_start := (submitted->>'starts_at')::timestamptz;
    actual_end := (submitted->>'ends_at')::timestamptz;
    if actual_start <= statement_timestamp() or actual_start >= actual_end
      or actual_start at time zone p_zone <> local_start
      or actual_end at time zone p_zone <> local_end
      or exists (
        select 1 from (values (local_start,actual_start),(local_end,actual_end)) endpoint(wall_time, instant)
        cross join (values (interval '-24 hours'),(interval '24 hours')) nearby(delta)
        cross join lateral (select endpoint.instant + nearby.delta as instant) reference
        cross join lateral (
          select (endpoint.wall_time - (reference.instant at time zone p_zone - reference.instant at time zone 'UTC'))
            at time zone 'UTC' as instant
        ) alternate
        where alternate.instant <> endpoint.instant and alternate.instant at time zone p_zone = endpoint.wall_time
      ) then raise invalid_parameter_value; end if;
    position := position + 1;
  end loop;
  if position <> day_count then raise invalid_parameter_value; end if;
exception when data_exception then
  raise invalid_parameter_value using message = 'Invalid course series pattern or sessions';
end;
$$;

-- Share the existing conflict query, including structured operational rooms.
do $migration$
declare
  definition text := pg_get_functiondef('private.plan_course_series(uuid,uuid,text,jsonb,uuid)'::regprocedure);
  start_marker constant text := '  with requested as materialized (';
  end_marker constant text := '    into conflicts from problems where reason is not null;';
  conflict_body text;
  planner_query text;
  patch record;
begin
  if cardinality(string_to_array(definition,start_marker)) <> 2
    or cardinality(string_to_array(definition,end_marker)) <> 2 then
    raise exception 'Expected existing course series conflict query';
  end if;
  conflict_body := start_marker || split_part(split_part(definition,start_marker,2),end_marker,1);
  planner_query := conflict_body || end_marker;
  conflict_body := replace(conflict_body || ' from problems where reason is not null',
    'and session.ends_at > statement_timestamp()',
    'and not (run.id = any(p_replaced)) and session.ends_at > statement_timestamp()');
  conflict_body := replace(conflict_body,
    'case when (plan.value#>>''{operational_preset,apply_delivery}'')::boolean',
    'coalesce(plan.value->>''structured_room'', case when (plan.value#>>''{operational_preset,apply_delivery}'')::boolean');
  conflict_body := replace(conflict_body, 'end as structured_room,' || chr(10) || '      tstzrange((session.value',
    'end) as structured_room,' || chr(10) || '      tstzrange((session.value');
  execute 'create function private.course_series_conflicts(p_organisation_id uuid, p_runs jsonb, p_replaced uuid[]) '
    || 'returns jsonb language sql stable set search_path = '''' as ' || quote_literal(conflict_body);

  definition := replace(definition, planner_query,
    '  conflicts := private.course_series_conflicts(p_organisation_id, p_runs, array[]::uuid[]);');
  for patch in select * from (values
    ($old$  row_data jsonb;$old$, $new$  row_data jsonb;
  patterns jsonb := '{}'::jsonb;$new$),
    ($old$array['delivery_type','venue','class_id','sessions','operational_preset']$old$,
      $new$array['delivery_type','venue','class_id','sessions','operational_preset','pattern']$new$),
    ($old$    preset_config := private.review_training_operational_preset$old$,
      $new$    if row_data ? 'pattern' then
      perform private.validate_course_series_pattern(row_data->'pattern',row_data->'sessions',p_time_zone);
    end if;
    preset_config := private.review_training_operational_preset$new$),
    ($old$array['class_id','operational_preset']$old$, $new$array['class_id','operational_preset','pattern']$new$),
    ($old$    run_ids := array_append(run_ids, target);
  end loop;
  insert into private.course_series_requests(actor_id, request_id, request_digest, run_ids)
    values (actor, p_request_id, digest, run_ids);$old$, $new$    run_ids := array_append(run_ids, target);
    if row_data ? 'pattern' then patterns := patterns || jsonb_build_object(target::text,row_data->'pattern'); end if;
  end loop;
  insert into private.course_series_requests(actor_id,request_id,request_digest,run_ids,organisation_id,time_zone,patterns)
    values (actor,p_request_id,digest,run_ids,p_organisation_id,p_time_zone,patterns);$new$)
  ) changes(before_code,after_code) loop
    if cardinality(string_to_array(definition,patch.before_code)) <> 2 then
      raise exception 'Expected course series planner statement: %',patch.before_code;
    end if;
    definition := replace(definition,patch.before_code,patch.after_code);
  end loop;
  execute definition;
end;
$migration$;

create index course_series_request_runs on private.course_series_requests using gin (run_ids);

-- Require the full receipt to stay inside its original customer and zone.
-- For older receipts the creator and the current scope of every run are available.
create function private.course_series_scope(p_course_id uuid)
returns private.course_series_requests language plpgsql stable set search_path = '' as $$
declare
  saved private.course_series_requests%rowtype;
  org uuid;
  zone text;
  internal_edition boolean := (select edition = 'internal' from private.installation_identity);
  manager boolean := private.has_permission('courses.manage');
begin
  if not private.actor_active() or (not internal_edition and (
    not manager or coalesce(private.academy_course_access_status(),'') not in ('active','grace')
  )) then raise insufficient_privilege; end if;
  select run.organisation_id,run.time_zone into org,zone
    from public.course_runs run join public.organisations organisation on organisation.id = run.organisation_id
    where run.id = p_course_id and organisation.archived_at is null;
  if not found then
    if manager and exists (select 1 from public.course_runs where id = p_course_id and organisation_id is null) then return null; end if;
    raise insufficient_privilege;
  end if;
  if not manager and not (internal_edition and private.client_has_organisation(org)) then raise insufficient_privilege; end if;
  select * into saved from private.course_series_requests receipt where receipt.run_ids @> array[p_course_id];
  if not found then return null; end if;
  if not manager and saved.actor_id <> auth.uid() then raise insufficient_privilege; end if;
  if coalesce(saved.organisation_id,org) <> org or coalesce(saved.time_zone,zone) <> zone
    or (select count(*) from public.course_runs run
        where run.id = any(saved.run_ids) and run.organisation_id = org and run.time_zone = zone) <> cardinality(saved.run_ids)
  then raise insufficient_privilege; end if;
  saved.organisation_id := org;
  saved.time_zone := zone;
  return saved;
end;
$$;

create function private.course_series_for_run(p_course_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' set timezone = 'UTC' as $$
declare
  saved private.course_series_requests%rowtype := private.course_series_scope(p_course_id);
  series jsonb;
  changes_allowed boolean := (select edition = 'internal' from private.installation_identity)
    or private.academy_course_access_status() = 'active';
begin
  if saved.request_id is null then return null; end if;
  select jsonb_agg(jsonb_build_object(
    'id',run.id, 'pattern',saved.patterns->run.id::text, 'sessions',schedule.sessions,
    'editable',changes_allowed and not run.published and run.archived_at is null and schedule.safe
      and not exists (select 1 from public.jobs job where job.course_run_id = run.id)
      and not exists (select 1 from public.course_enrolments e where e.course_run_id = run.id)
      and (private.has_permission('courses.manage') or exists (
        select 1 from public.course_templates template where template.id = run.template_id
          and template.owner_organisation_id = saved.organisation_id and template.archived_at is null
      )),
    'class',class.class_id,'delivery',jsonb_build_array(run.delivery_type,run.venue,delivery.defaults),
    'session_ids',schedule.ids
  ) order by member.ordinality) into series
  from unnest(saved.run_ids) with ordinality member(id,ordinality)
  join public.course_runs run on run.id = member.id
  left join private.course_class_assignments class on class.course_id = run.id
  left join private.training_course_delivery delivery on delivery.course_run_id = run.id
  cross join lateral (
    select coalesce(jsonb_agg(jsonb_build_object('starts_at',s.starts_at,'ends_at',s.ends_at)
        order by s.starts_at,s.ends_at,s.id),'[]'::jsonb) as sessions,
      jsonb_agg(s.id order by s.starts_at,s.ends_at,s.id) as ids,
      coalesce(bool_and(s.starts_at > statement_timestamp()
        and not exists (select 1 from public.job_sessions linked where linked.course_session_id = s.id)
        and not exists (select 1 from private.course_attendance a where a.session_id = s.id)
        and not exists (select 1 from private.course_attendance_audit a where a.session_id = s.id)
        and not exists (select 1 from private.course_attendance_evidence a where a.session_id = s.id)
        and not exists (select 1 from private.training_session_delivery overrides where overrides.course_session_id = s.id)
      ),false) as safe
    from public.course_sessions s where s.course_run_id = run.id
  ) schedule;
  return jsonb_build_object(
    'revision',encode(sha256(convert_to(jsonb_build_array(saved.organisation_id,saved.time_zone,series)::text,'UTF8')),'hex'),
    'time_zone',saved.time_zone,
    'runs',(select jsonb_agg(run.value - array['class','delivery','session_ids'] order by run.ordinality)
      from jsonb_array_elements(series) with ordinality run)
  );
end;
$$;

create function private.revise_course_series(p_course_id uuid,p_revision text,p_changes jsonb,p_confirm boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  saved private.course_series_requests%rowtype;
  snapshot jsonb;
  selected jsonb;
  change jsonb;
  run_id uuid;
  run_ids uuid[] := array[]::uuid[];
  requested jsonb;
  conflicts jsonb;
  manager boolean;
begin
  if (select edition from private.installation_identity) <> 'internal' then perform private.lock_academy_course_access(); end if;
  perform 1 from public.profiles where id = auth.uid() and active for share;
  if not found then raise insufficient_privilege; end if;
  perform 1 from public.user_roles where user_id = auth.uid() order by role for share;
  manager := private.has_permission('courses.manage');
  saved := private.course_series_scope(p_course_id);
  if saved.request_id is null then raise insufficient_privilege; end if;
  if not manager then perform private.lock_company_course_author(saved.organisation_id); end if;
  perform 1 from public.organisations where id = saved.organisation_id and archived_at is null for share;
  if not found then raise insufficient_privilege; end if;
  if p_confirm is null or p_revision is null or p_revision !~ '^[0-9a-f]{64}$'
    or jsonb_typeof(p_changes) is distinct from 'array' then raise invalid_parameter_value; end if;
  if jsonb_array_length(p_changes) not between 1 and 12 then raise invalid_parameter_value; end if;

  if p_confirm then
    perform pg_advisory_xact_lock(hashtextextended('course-series-organisation:' || saved.organisation_id::text,0));
    perform 1 from private.course_series_requests receipt
      where receipt.actor_id = saved.actor_id and receipt.request_id = saved.request_id for update;
    perform 1 from public.course_runs where id = any(saved.run_ids) order by id for update;
    perform 1 from public.course_templates t join public.course_runs r on r.template_id = t.id
      where r.id = any(saved.run_ids) order by t.id for share of t;
    perform 1 from public.course_sessions where course_run_id = any(saved.run_ids) order by id for update;
  end if;
  snapshot := private.course_series_for_run(p_course_id);
  if snapshot->>'revision' is distinct from p_revision then
    raise exception 'Course series scheduling changed' using errcode = 'PT409';
  end if;
  for change in select value from jsonb_array_elements(p_changes) loop
    if jsonb_typeof(change) is distinct from 'object' or not change ?& array['id','pattern','sessions']
      or change - array['id','pattern','sessions'] <> '{}'::jsonb
      or jsonb_typeof(change->'id') <> 'string' then raise invalid_parameter_value; end if;
    begin
      run_id := (change->>'id')::uuid;
    exception when invalid_text_representation then raise invalid_parameter_value;
    end;
    if run_id = any(run_ids) then raise invalid_parameter_value; end if;
    select value into selected from jsonb_array_elements(snapshot->'runs') where value->>'id' = run_id::text;
    if not found then raise insufficient_privilege; end if;
    if not (selected->>'editable')::boolean then
      raise exception 'Published, allocated, or started courses retain their schedule' using errcode = 'PT409';
    end if;
    perform private.validate_course_series_pattern(change->'pattern',change->'sessions',saved.time_zone);
    run_ids := array_append(run_ids,run_id);
  end loop;

  select jsonb_agg(jsonb_build_object('class_id',assignment.class_id,'delivery_type',run.delivery_type,
    'venue',run.venue,'sessions',item.value->'sessions','structured_room',
    case when delivery.defaults->>'mode' in ('onsite','hybrid') then delivery.defaults->>'venue_id' end
  ) order by item.ordinality) into requested
    from jsonb_array_elements(p_changes) with ordinality item
    join public.course_runs run on run.id = (item.value->>'id')::uuid
    left join private.course_class_assignments assignment on assignment.course_id = run.id
    left join private.training_course_delivery delivery on delivery.course_run_id = run.id;
  conflicts := private.course_series_conflicts(saved.organisation_id,requested,run_ids);
  if not p_confirm or jsonb_array_length(conflicts) > 0 then
    return jsonb_build_object('run_ids','[]'::jsonb,'conflicts',conflicts);
  end if;

  for change in select value from jsonb_array_elements(p_changes) loop
    run_id := (change->>'id')::uuid;
    delete from public.course_sessions existing where existing.course_run_id = run_id
      and not exists (select 1 from jsonb_to_recordset(change->'sessions') desired(starts_at timestamptz,ends_at timestamptz)
        where (existing.starts_at,existing.ends_at) = (desired.starts_at,desired.ends_at));
    insert into public.course_sessions(course_run_id,starts_at,ends_at)
      select run_id,desired.starts_at,desired.ends_at
      from jsonb_to_recordset(change->'sessions') desired(starts_at timestamptz,ends_at timestamptz)
      where not exists (select 1 from public.course_sessions existing where existing.course_run_id = run_id
        and (existing.starts_at,existing.ends_at) = (desired.starts_at,desired.ends_at));
    insert into public.audit_events(actor_id,action,resource_id,details)
      values (auth.uid(),'course.series.pattern_changed',run_id,jsonb_build_object('session_count',jsonb_array_length(change->'sessions')));
  end loop;
  update private.course_series_requests receipt set patterns = receipt.patterns ||
    (select jsonb_object_agg(((item.value->>'id')::uuid)::text,item.value->'pattern') from jsonb_array_elements(p_changes) item)
    where receipt.actor_id = saved.actor_id and receipt.request_id = saved.request_id;
  return jsonb_build_object('run_ids',to_jsonb(run_ids),'conflicts',conflicts);
end;
$$;

create function public.course_series_for_run(p_course_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.course_series_for_run(p_course_id)
$$;
create function public.revise_course_series(p_course_id uuid,p_revision text,p_changes jsonb,p_confirm boolean)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.revise_course_series(p_course_id,p_revision,p_changes,p_confirm)
$$;
revoke all on function private.validate_course_series_pattern(jsonb,jsonb,text),
  private.course_series_conflicts(uuid,jsonb,uuid[]), private.course_series_scope(uuid),
  private.course_series_for_run(uuid), public.course_series_for_run(uuid),
  private.revise_course_series(uuid,text,jsonb,boolean), public.revise_course_series(uuid,text,jsonb,boolean)
  from public,anon,authenticated,service_role;
grant execute on function private.course_series_for_run(uuid), public.course_series_for_run(uuid),
  private.revise_course_series(uuid,text,jsonb,boolean), public.revise_course_series(uuid,text,jsonb,boolean) to authenticated;

do $migration$
declare
  definition text := pg_get_functiondef('private.require_academy_course_access()'::regprocedure);
  anchor constant text := '  licence_status := private.academy_course_access_status();';
begin
  if cardinality(string_to_array(definition,anchor)) <> 2 then raise exception 'Expected Academy licence check'; end if;
  execute replace(definition,anchor,anchor || chr(10) || $gate$
  if licence_status in ('active','grace') and request_method in ('GET','HEAD','POST')
    and request_path = '/rpc/course_series_for_run' then return; end if;
  if licence_status = 'active' and request_method = 'POST'
    and request_path = '/rpc/revise_course_series' then return; end if;
$gate$);
end;
$migration$;

notify pgrst, 'reload schema';
commit;
