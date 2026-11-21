begin;

alter table private.academy_course_draft_requests
  add column schedule_revision integer not null default 1 check (schedule_revision > 0),
  add column last_schedule_digest bytea check (octet_length(last_schedule_digest) = 32);

create function private.academy_draft_schedule_available(p_course_id uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists (
    select 1 from private.academy_course_draft_requests draft
    join public.course_runs run on run.id = draft.run_id
    join public.organisations org on org.id = run.organisation_id
    where run.id = p_course_id and not run.published and run.archived_at is null and org.archived_at is null
      and not exists (select 1 from public.jobs job where job.course_run_id = run.id)
      and not exists (select 1 from public.course_enrolments e where e.course_run_id = run.id)
      and not exists (
        select 1 from public.course_sessions session where session.course_run_id = run.id
        and (exists (select 1 from private.course_attendance a where a.session_id = session.id)
          or exists (select 1 from private.course_attendance_audit a where a.session_id = session.id)
          or exists (select 1 from private.course_attendance_evidence a where a.session_id = session.id))
      )
  );
$$;
revoke all on function private.academy_draft_schedule_available(uuid) from public, anon, authenticated, service_role;

create function private.academy_draft_schedule(p_course_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if private.academy_course_access_status() is distinct from 'active'
     or not private.has_permission('courses.manage') then raise insufficient_privilege; end if;
  if not private.academy_draft_schedule_available(p_course_id) then return null; end if;
  return (select jsonb_build_object('revision',draft.schedule_revision,'time_zone',run.time_zone,
           'delivery_type',run.delivery_type,'venue',run.venue,'sessions',
           (select jsonb_agg(jsonb_build_object('id',s.id,'starts_at',s.starts_at,'ends_at',s.ends_at) order by s.starts_at,s.id)
            from public.course_sessions s where s.course_run_id=run.id))
          from private.academy_course_draft_requests draft join public.course_runs run on run.id = draft.run_id
          where run.id = p_course_id);
end;
$$;

create function private.academy_save_draft_schedule(
  p_course_id uuid, p_expected_revision integer, p_payload jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  draft private.academy_course_draft_requests;
  digest bytea;
  desired_sessions jsonb;
begin
  perform private.lock_academy_course_access();
  perform 1 from public.profiles where id=actor_id and active for share;
  if not found then raise insufficient_privilege; end if;
  perform 1 from public.user_roles where user_id=actor_id order by role for share;
  if not private.has_permission('courses.manage') then raise insufficient_privilege; end if;
  perform 1 from public.course_runs run join public.organisations org on org.id=run.organisation_id
    where run.id=p_course_id and run.archived_at is null and org.archived_at is null
    for update of run for share of org;
  if not found then raise insufficient_privilege; end if;
  if not private.academy_draft_schedule_available(p_course_id) then
    raise exception 'Published or allocated courses retain their current schedule' using errcode='PT409';
  end if;
  if p_expected_revision is null or p_expected_revision < 1
     or jsonb_typeof(p_payload) is distinct from 'object'
     or p_payload - array['time_zone','delivery_type','venue','sessions'] <> '{}'::jsonb
     or jsonb_typeof(p_payload->'time_zone') is distinct from 'string'
     or not exists (select 1 from pg_timezone_names where name = p_payload->>'time_zone')
     or coalesce(p_payload->>'delivery_type','') not in ('online','onsite')
     or jsonb_typeof(p_payload->'venue') is distinct from 'string' or length(p_payload->>'venue')>500
     or jsonb_typeof(p_payload->'sessions') is distinct from 'array' then
    raise invalid_parameter_value;
  end if;
  desired_sessions := p_payload->'sessions';
  if jsonb_array_length(desired_sessions) not between 1 and 60 or exists (
    select 1 from jsonb_array_elements(desired_sessions) item
    where jsonb_typeof(item) is distinct from 'object' or not item ?& array['id','starts_at','ends_at']
      or item - array['id','starts_at','ends_at'] <> '{}'::jsonb
      or jsonb_typeof(item->'id') not in ('string','null')
      or jsonb_typeof(item->'starts_at') is distinct from 'string'
      or jsonb_typeof(item->'ends_at') is distinct from 'string'
      or item->>'starts_at' !~ '(Z|[+-][0-9]{2}:[0-9]{2})$'
      or item->>'ends_at' !~ '(Z|[+-][0-9]{2}:[0-9]{2})$'
  ) then raise invalid_parameter_value; end if;

  digest := sha256(convert_to(p_payload::text,'UTF8'));
  select * into strict draft from private.academy_course_draft_requests where run_id=p_course_id for update;
  if draft.schedule_revision <> p_expected_revision then
    if p_expected_revision = draft.schedule_revision - 1 and digest = draft.last_schedule_digest then
      return private.academy_draft_schedule(p_course_id);
    end if;
    raise exception 'Draft schedule changed' using errcode='PT409';
  end if;
  if exists (
    with proposed as (
      select item.*, row_number() over () as position from jsonb_to_recordset(desired_sessions)
        item(id uuid,starts_at timestamptz,ends_at timestamptz)
    )
    select 1 from proposed p where p.ends_at<=p.starts_at or not isfinite(p.starts_at) or not isfinite(p.ends_at)
      or (p.id is not null and not exists (
        select 1 from public.course_sessions current where current.id=p.id and current.course_run_id=p_course_id
      ))
      or exists (select 1 from proposed other where p.position<other.position
         and (other.id=p.id or (p.starts_at<other.ends_at and other.starts_at<p.ends_at)))
  ) then raise invalid_parameter_value; end if;

  delete from public.course_sessions s where s.course_run_id=p_course_id and not exists (
    select 1 from jsonb_to_recordset(desired_sessions) item(id uuid) where item.id=s.id
  );
  update public.course_sessions s set starts_at=item.starts_at,ends_at=item.ends_at
  from jsonb_to_recordset(desired_sessions) item(id uuid,starts_at timestamptz,ends_at timestamptz)
  where s.course_run_id=p_course_id and s.id=item.id;
  insert into public.course_sessions(course_run_id,starts_at,ends_at)
  select p_course_id,item.starts_at,item.ends_at
  from jsonb_to_recordset(desired_sessions) item(id uuid,starts_at timestamptz,ends_at timestamptz) where item.id is null;
  update public.course_runs set time_zone=p_payload->>'time_zone',delivery_type=p_payload->>'delivery_type',venue=p_payload->>'venue'
  where id=p_course_id;
  update private.academy_course_draft_requests set schedule_revision=schedule_revision+1,last_schedule_digest=digest
  where run_id=p_course_id;
  insert into public.audit_events(actor_id,action,resource_id,details)
  values (actor_id,'academy.course.schedule_updated',p_course_id,jsonb_build_object('revision',draft.schedule_revision+1));
  return private.academy_draft_schedule(p_course_id);
end;
$$;

create function public.academy_draft_schedule(p_course_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.academy_draft_schedule(p_course_id);
$$;
create function public.academy_save_draft_schedule(p_course_id uuid,p_expected_revision integer,p_payload jsonb)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.academy_save_draft_schedule(p_course_id,p_expected_revision,p_payload);
$$;
revoke all on function private.academy_draft_schedule(uuid),public.academy_draft_schedule(uuid),
  private.academy_save_draft_schedule(uuid,integer,jsonb),public.academy_save_draft_schedule(uuid,integer,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function private.academy_draft_schedule(uuid),public.academy_draft_schedule(uuid),
  private.academy_save_draft_schedule(uuid,integer,jsonb),public.academy_save_draft_schedule(uuid,integer,jsonb) to authenticated;

do $$
declare definition text := pg_catalog.pg_get_functiondef('private.require_academy_course_access()'::regprocedure);
  anchor constant text := '''/rpc/academy_create_course_draft'',';
begin
  if cardinality(string_to_array(definition,anchor)) <> 2 then raise exception 'Expected dedicated drafting gate'; end if;
  execute replace(definition,anchor,anchor || ' ''/rpc/academy_draft_schedule'', ''/rpc/academy_save_draft_schedule'',');
end;
$$;

notify pgrst, 'reload schema';
commit;
