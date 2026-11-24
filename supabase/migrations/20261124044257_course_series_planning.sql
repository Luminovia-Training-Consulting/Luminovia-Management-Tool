begin;

create table private.course_series_requests (
  actor_id uuid not null references public.profiles(id) on delete cascade,
  request_id uuid not null,
  request_digest bytea not null check (octet_length(request_digest) = 32),
  run_ids uuid[] not null check (cardinality(run_ids) between 2 and 12),
  primary key (actor_id, request_id)
);
alter table private.course_series_requests enable row level security;
revoke all on private.course_series_requests from public, anon, authenticated, service_role;

-- A company sees its own available class names, including when Premium is off.
-- Academy planning uses the same local classes inside the licensed installation.
create function private.course_series_classes(p_organisation_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.actor_active() or not exists (
    select 1 from public.organisations where id = p_organisation_id and archived_at is null
  ) then raise insufficient_privilege; end if;
  if exists (select 1 from private.installation_identity where edition = 'internal') then
    if not (private.has_permission('courses.manage') or private.client_has_organisation(p_organisation_id)) then
      raise insufficient_privilege;
    end if;
  elsif not private.has_permission('courses.manage')
    or private.academy_course_access_status() is distinct from 'active' then
    raise insufficient_privilege;
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) order by lower(c.name), c.id)
    from private.course_classes c where c.organisation_id = p_organisation_id), '[]'::jsonb);
end;
$$;

create function private.plan_course_series(p_organisation_id uuid, p_template_id uuid,
  p_time_zone text, p_runs jsonb, p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  internal_edition boolean := (select edition = 'internal' from private.installation_identity);
  manages_courses boolean;
  saved private.course_series_requests%rowtype;
  digest bytea;
  row_data jsonb;
  appointment jsonb;
  begins_at timestamptz;
  ends_at timestamptz;
  class_id uuid;
  conflicts jsonb;
  target uuid;
  run_ids uuid[] := array[]::uuid[];
begin
  if not internal_edition then perform private.lock_academy_course_access(); end if;
  perform 1 from public.profiles where id = actor and active for share;
  if not found then raise insufficient_privilege; end if;
  perform 1 from public.user_roles where user_id = actor order by role for share;
  manages_courses := private.has_permission('courses.manage');
  if not manages_courses then perform private.lock_company_course_author(p_organisation_id); end if;
  if p_organisation_id is null or p_template_id is null or p_time_zone is null
    or not exists (select 1 from pg_timezone_names where name = p_time_zone)
    or jsonb_typeof(p_runs) is distinct from 'array' then raise invalid_parameter_value; end if;
  if jsonb_array_length(p_runs) not between 2 and 12 then raise invalid_parameter_value; end if;
  perform 1 from public.organisations where id = p_organisation_id and archived_at is null for share;
  if not found then raise insufficient_privilege; end if;

  if p_request_id is not null then
    perform pg_advisory_xact_lock(hashtextextended('course-series-request:' || actor::text || ':' || p_request_id::text, 0));
    digest := sha256(convert_to(jsonb_build_array(p_organisation_id, p_template_id, p_time_zone, p_runs)::text, 'UTF8'));
    select * into saved from private.course_series_requests where actor_id = actor and request_id = p_request_id;
    if found then
      if digest <> saved.request_digest then raise exception 'Course series request changed' using errcode = 'PT409'; end if;
      if (select count(*) from public.course_runs where organisation_id = p_organisation_id and id = any(saved.run_ids))
        <> cardinality(saved.run_ids) then raise exception 'Course series is no longer available' using errcode = 'PT409'; end if;
      return jsonb_build_object('run_ids', to_jsonb(saved.run_ids), 'conflicts', '[]'::jsonb);
    end if;
  end if;

  perform 1 from public.course_templates where id = p_template_id and archived_at is null
    and (owner_organisation_id = p_organisation_id or (manages_courses and owner_organisation_id is null)) for share;
  if not found then raise insufficient_privilege; end if;

  for row_data in select value from jsonb_array_elements(p_runs) loop
    if jsonb_typeof(row_data) is distinct from 'object'
      or row_data - array['delivery_type','venue','class_id','sessions'] <> '{}'::jsonb
      or coalesce(row_data->>'delivery_type', '') not in ('online', 'onsite')
      or jsonb_typeof(row_data->'venue') is distinct from 'string' or length(row_data->>'venue') > 500
      or row_data->>'venue' ~ '[[:cntrl:]]'
      or coalesce(jsonb_typeof(row_data->'class_id'), 'null') not in ('null','string')
      or jsonb_typeof(row_data->'sessions') is distinct from 'array' then raise invalid_parameter_value; end if;
    if jsonb_array_length(row_data->'sessions') not between 1 and 60 then raise invalid_parameter_value; end if;
    class_id := (row_data->>'class_id')::uuid;
    if class_id is not null then
      perform 1 from private.course_classes c where c.id = class_id and c.organisation_id = p_organisation_id for key share;
      if not found then raise insufficient_privilege; end if;
    end if;
    for appointment in select value from jsonb_array_elements(row_data->'sessions') loop
      if jsonb_typeof(appointment) is distinct from 'object' or appointment - array['starts_at','ends_at'] <> '{}'::jsonb
        or coalesce(appointment->>'starts_at', '') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$'
        or coalesce(appointment->>'ends_at', '') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$' then
        raise invalid_parameter_value;
      end if;
      begins_at := (appointment->>'starts_at')::timestamptz;
      ends_at := (appointment->>'ends_at')::timestamptz;
      if begins_at <= statement_timestamp() or begins_at >= ends_at then raise invalid_parameter_value; end if;
    end loop;
  end loop;

  -- Serialize series for an organisation before comparing them with recorded
  -- schedules. The same check runs for preview and immediately before writes.
  if p_request_id is not null then
    perform pg_advisory_xact_lock(hashtextextended('course-series-organisation:' || p_organisation_id::text, 0));
  end if;
  with requested as materialized (
    select plan.ordinality::integer as run_no, session.ordinality::integer as session_no,
      (plan.value->>'class_id')::uuid as requested_class,
      case when plan.value->>'delivery_type' = 'onsite' then nullif(lower(btrim(plan.value->>'venue')), '') end as room,
      tstzrange((session.value->>'starts_at')::timestamptz, (session.value->>'ends_at')::timestamptz, '[)') as slot
    from jsonb_array_elements(p_runs) with ordinality plan
    cross join lateral jsonb_array_elements(plan.value->'sessions') with ordinality session
  ), recorded as materialized (
    select assignment.class_id as recorded_class,
      case when run.delivery_type = 'onsite' then nullif(lower(btrim(run.venue)), '') end as room,
      tstzrange(session.starts_at, session.ends_at, '[)') as slot
    from public.course_runs run
    join public.course_sessions session on session.course_run_id = run.id
    left join private.course_class_assignments assignment on assignment.course_id = run.id
    where run.organisation_id = p_organisation_id and run.archived_at is null
      and session.ends_at > statement_timestamp()
      and (assignment.class_id in (select requested_class from requested where requested_class is not null)
        or (run.delivery_type = 'onsite' and nullif(lower(btrim(run.venue)), '') in (select room from requested where room is not null)))
  ), problems as (
    select r.run_no, r.session_no,
      case
        when exists(select 1 from requested peer where r.run_no = peer.run_no and r.session_no <> peer.session_no and r.slot && peer.slot)
          then 'session'
        when r.requested_class is not null and (
          exists(select 1 from requested peer where r.run_no <> peer.run_no and r.requested_class = peer.requested_class and r.slot && peer.slot)
          or exists(select 1 from recorded peer where r.requested_class = peer.recorded_class and r.slot && peer.slot)
        ) then 'class'
        when r.room is not null and (
          exists(select 1 from requested peer where r.run_no <> peer.run_no and r.room = peer.room and r.slot && peer.slot)
          or exists(select 1 from recorded peer where r.room = peer.room and r.slot && peer.slot)
        ) then 'room'
      end as reason from requested r
  )
  select coalesce(jsonb_agg(to_jsonb(problems) order by run_no, session_no), '[]'::jsonb)
    into conflicts from problems where reason is not null;
  if p_request_id is null or jsonb_array_length(conflicts) > 0 then
    return jsonb_build_object('run_ids', '[]'::jsonb, 'conflicts', conflicts);
  end if;

  for row_data in select value from jsonb_array_elements(p_runs) loop
    target := private.save_course_run(null, (row_data - 'class_id') || jsonb_build_object(
      'organisation_id', p_organisation_id, 'template_id', p_template_id, 'time_zone', p_time_zone
    ));
    class_id := (row_data->>'class_id')::uuid;
    if class_id is not null then
      insert into private.course_class_assignments(course_id, organisation_id, class_id, version)
      values (target, p_organisation_id, class_id, 1);
      insert into public.audit_events(actor_id, action, resource_id, details)
      values (actor, 'course.class.changed', target, jsonb_build_object('previous_class_id', null, 'class_id', class_id));
    end if;
    run_ids := array_append(run_ids, target);
  end loop;
  insert into private.course_series_requests(actor_id, request_id, request_digest, run_ids)
    values (actor, p_request_id, digest, run_ids);
  return jsonb_build_object('run_ids', to_jsonb(run_ids), 'conflicts', conflicts);
end;
$$;

create function public.course_series_classes(p_organisation_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select private.course_series_classes(p_organisation_id);
$$;
create function public.plan_course_series(p_organisation_id uuid, p_template_id uuid,
  p_time_zone text, p_runs jsonb, p_request_id uuid) returns jsonb
language sql security invoker set search_path = '' as $$
  select private.plan_course_series(p_organisation_id, p_template_id, p_time_zone, p_runs, p_request_id);
$$;
revoke all on function private.course_series_classes(uuid), public.course_series_classes(uuid),
  private.plan_course_series(uuid,uuid,text,jsonb,uuid), public.plan_course_series(uuid,uuid,text,jsonb,uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.course_series_classes(uuid), public.course_series_classes(uuid),
  private.plan_course_series(uuid,uuid,text,jsonb,uuid), public.plan_course_series(uuid,uuid,text,jsonb,uuid)
  to authenticated;

-- Grant only these transports within the existing active Academy profile.
do $$
declare
  definition text := pg_catalog.pg_get_functiondef('private.require_academy_course_access()'::regprocedure);
  anchor constant text := '  licence_status := private.academy_course_access_status();';
begin
  if cardinality(string_to_array(definition,anchor)) <> 2 then
    raise exception 'Expected one active Academy licence check';
  end if;
  execute replace(definition,anchor,anchor || chr(10) || $gate$
  if licence_status = 'active' and (
    (request_method in ('GET', 'HEAD', 'POST') and request_path = '/rpc/course_series_classes')
    or (request_method = 'POST' and request_path = '/rpc/plan_course_series')
  ) then return; end if;
$gate$);
end;
$$;

notify pgrst, 'reload schema';
commit;
