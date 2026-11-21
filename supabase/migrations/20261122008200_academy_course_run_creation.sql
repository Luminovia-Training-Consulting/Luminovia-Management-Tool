begin;

-- Allow the existing run maker only through the scoped active-licence POST.
create or replace function private.require_academy_course_access()
returns void language plpgsql stable security definer set search_path = '' as $$
declare
  request_path text := current_setting('request.path', true);
  request_method text := current_setting('request.method', true);
  request_headers jsonb := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
  licence_status text;
begin
  if current_setting('role', true) is distinct from 'authenticated'
     or coalesce(request_headers->>'accept-profile', 'public') <> 'public'
     or coalesce(request_headers->>'content-profile', 'public') <> 'public'
     or not private.learning_actor() then
    raise insufficient_privilege;
  end if;

  licence_status := private.academy_course_access_status();
  if licence_status in ('active', 'grace') and request_method in ('GET', 'HEAD', 'POST') and request_path in (
    '/rpc/portal_access', '/rpc/my_course_workspaces', '/rpc/course_workspace',
    '/rpc/course_workspace_entitlement', '/rpc/course_enrolments'
  ) then
    return;
  end if;
  if licence_status = 'active' and (
    (request_method in ('GET', 'HEAD', 'POST') and request_path in (
      '/rpc/academy_course_instructor_candidates', '/rpc/course_enrolment_candidates'
    ))
    or (request_method = 'POST' and request_path in (
      '/rpc/academy_assign_course_instructor', '/rpc/academy_release_course_instructor',
      '/rpc/manage_course_enrolment', '/rpc/set_course_meeting_link', '/rpc/save_course_run'
    ))
  ) then
    return;
  end if;

  raise exception 'Academy course operation unavailable' using errcode = '42501';
end;
$$;

-- The public invoker wrapper and all internal course operations keep their existing behavior.
create or replace function private.save_course_run(p_id uuid, p_payload jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  target uuid := coalesce(p_id, gen_random_uuid());
  item jsonb;
  starts timestamptz;
  ends timestamptz;
  session_count integer := 0;
begin
  if not private.has_permission('courses.manage') then
    raise exception 'courses.manage and MFA required' using errcode = '42501';
  end if;
  if (select edition from private.installation_identity) is distinct from 'internal' then
    -- Serialize with licence renewal and closure of the exact-release profile.
    perform private.lock_academy_course_access();
    -- Keep account suspension from overtaking the confirmed creation.
    perform 1 from public.profiles where id = auth.uid() and active for share;
    if not found then raise insufficient_privilege; end if;
    if p_id is not null then
      raise exception 'Academy course profile allows creation only' using errcode = '42501';
    end if;
    if jsonb_typeof(p_payload) is distinct from 'object' or
       jsonb_typeof(p_payload->'sessions') is distinct from 'array' then
      raise exception 'One to sixty sessions required' using errcode = '22023';
    end if;
    if (p_payload - array[
      'template_id', 'organisation_id', 'time_zone', 'delivery_type', 'venue',
      'sessions', 'published', 'archived'
    ]) <> '{}'::jsonb or coalesce(p_payload->'published', 'false'::jsonb) <> 'false'::jsonb
       or coalesce(p_payload->'archived', 'false'::jsonb) <> 'false'::jsonb then
      raise exception 'Invalid academy course creation fields' using errcode = '22023';
    end if;
    -- Pin active local catalogue records until the run and its sessions commit.
    perform 1 from public.organisations org
    where org.id = nullif(p_payload->>'organisation_id', '')::uuid and org.archived_at is null
    for share;
    if not found then raise exception 'Academy organisation unavailable' using errcode = '22023'; end if;
    perform 1 from public.course_templates template
    where template.id = (p_payload->>'template_id')::uuid and template.archived_at is null
    for share;
    if not found then raise exception 'Academy course template unavailable' using errcode = '22023'; end if;
    if private.academy_course_access_status() is distinct from 'active' or
       not private.has_permission('courses.manage') then
      raise insufficient_privilege;
    end if;
  end if;
  if jsonb_typeof(p_payload) <> 'object' or jsonb_typeof(p_payload->'sessions') <> 'array'
     or jsonb_array_length(p_payload->'sessions') not between 1 and 60 then
    raise exception 'One to sixty sessions required' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.course_runs(
      id, template_id, organisation_id, time_zone, delivery_type, venue, published, archived_at
    ) values (
      target, (p_payload->>'template_id')::uuid, nullif(p_payload->>'organisation_id', '')::uuid,
      coalesce(p_payload->>'time_zone', 'Europe/Berlin'), coalesce(p_payload->>'delivery_type', 'online'),
      coalesce(p_payload->>'venue', ''), false,
      case when coalesce((p_payload->>'archived')::boolean, false) then now() end
    );
  else
    perform 1 from public.course_runs where id = target for update;
    if not found then raise exception 'Run not found' using errcode = '22023'; end if;
    if exists (select 1 from public.jobs where course_run_id = target) then
      raise exception 'course_locked' using errcode = '22023';
    end if;
    update public.course_runs run
    set template_id = (p_payload->>'template_id')::uuid,
        organisation_id = nullif(p_payload->>'organisation_id', '')::uuid,
        time_zone = coalesce(p_payload->>'time_zone', 'Europe/Berlin'),
        delivery_type = coalesce(p_payload->>'delivery_type', 'online'),
        venue = coalesce(p_payload->>'venue', ''),
        published = false,
        archived_at = case when coalesce((p_payload->>'archived')::boolean, false)
                      then coalesce(run.archived_at, now()) end
    where run.id = target;
    delete from public.course_sessions where course_run_id = target;
  end if;

  for item in select * from jsonb_array_elements(p_payload->'sessions') loop
    if item->>'starts_at' !~ '(Z|[+-][0-9]{2}:[0-9]{2})$'
       or item->>'ends_at' !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' then
      raise exception 'Explicit instants required' using errcode = '22023';
    end if;
    starts := (item->>'starts_at')::timestamptz;
    ends := (item->>'ends_at')::timestamptz;
    if starts is null or ends is null or ends <= starts or exists (
      select 1 from public.course_sessions where course_run_id = target
        and tstzrange(starts_at, ends_at, '[)') && tstzrange(starts, ends, '[)')
    ) then
      raise exception 'Invalid or overlapping sessions' using errcode = '22023';
    end if;
    insert into public.course_sessions(course_run_id, starts_at, ends_at)
    values (target, starts, ends);
    session_count := session_count + 1;
  end loop;

  update public.course_runs
  set published = coalesce((p_payload->>'published')::boolean, false)
  where id = target;
  insert into public.audit_events(actor_id, action, resource_id, details)
  values (auth.uid(), 'course.run.saved', target,
          jsonb_build_object('created', p_id is null, 'session_count', session_count));
  return target;
end;
$$;

notify pgrst, 'reload schema';
commit;
