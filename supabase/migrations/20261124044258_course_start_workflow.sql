begin;

create table private.course_start_policies (
  course_run_id uuid primary key references public.course_runs(id) on delete cascade,
  responsible_user_id uuid references public.profiles(id) on delete set null,
  backup_user_id uuid references public.profiles(id) on delete set null,
  version integer not null default 0 check (version >= 0),
  checked_at timestamptz,
  check (responsible_user_id is distinct from backup_user_id or backup_user_id is null)
);

create table private.course_start_alerts (
  id uuid primary key default gen_random_uuid(),
  course_run_id uuid not null references public.course_runs(id) on delete cascade,
  deadline timestamptz not null,
  stage text not null check (stage in ('course_start_due', 'course_start_escalated')),
  unique (course_run_id, deadline, stage)
);

alter table private.course_start_policies enable row level security;
alter table private.course_start_alerts enable row level security;
revoke all on private.course_start_policies, private.course_start_alerts from public, anon, authenticated, service_role;

-- Reuse the exact readiness calculation. The private worker projection bypasses
-- only the caller check; its output is never returned by an API or stored in alerts.
do $migration$
declare
  definition text := pg_get_functiondef('private.readiness_snapshot(uuid)'::regprocedure);
  signature constant text := 'private.readiness_snapshot(p_run uuid)';
  actor_gate constant text := 'if not private.readiness_access(p_run) then';
  agreement_gate constant text := $sql$agreement_required=cfg.agreement_required or exists(select 1 from public.jobs where course_run_id=r.id and status<>'archived' and requires_contract);$sql$;
  claim_agreement_gate constant text := $sql$and (cfg.agreement_required or j.requires_contract) and not exists($sql$;
  meeting_fallback constant text := $sql$when private.readiness_https_url(r.venue) then r.venue else '' end;$sql$;
begin
  if cardinality(string_to_array(definition, signature)) <> 2
    or cardinality(string_to_array(definition, actor_gate)) <> 2
    or cardinality(string_to_array(definition, agreement_gate)) <> 2
    or cardinality(string_to_array(definition, claim_agreement_gate)) <> 2
    or cardinality(string_to_array(definition, meeting_fallback)) <> 2 then
    raise exception 'Expected current readiness caller, agreement and meeting rules';
  end if;
  definition := replace(definition, signature,
    'private.readiness_snapshot_for_start(p_run uuid, p_background boolean)');
  definition := replace(definition, actor_gate,
    'if not p_background and not private.readiness_access(p_run) then');
  definition := replace(definition, agreement_gate, $sql$
    agreement_required=(cfg.agreement_required and not exists(select 1 from public.jobs
      where course_run_id=r.id and status<>'archived' and company_internal))
      or exists(select 1 from public.jobs where course_run_id=r.id and status<>'archived'
      and not company_internal and (cfg.agreement_required or requires_contract));$sql$);
  definition := replace(definition, claim_agreement_gate,
    'and not j.company_internal and (cfg.agreement_required or j.requires_contract) and not exists(');
  definition := replace(definition, meeting_fallback, $sql$
    when exists(select 1 from private.course_meeting_links link where link.course_run_id=r.id
      and private.readiness_https_url(link.url))
      then (select link.url from private.course_meeting_links link where link.course_run_id=r.id)
    when private.readiness_https_url(r.venue) then r.venue else '' end;$sql$);
  execute definition;
end;
$migration$;

create or replace function private.readiness_snapshot(p_run uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select private.readiness_snapshot_for_start(p_run, false)
$$;

create function private.course_start_staff() returns table(id uuid, name text)
language sql stable security invoker set search_path = '' as $$
  select profile.id, profile.display_name
  from public.profiles profile
  where profile.active and exists (
    select 1 from public.user_roles member
    join public.role_permissions permission using (role)
    where member.user_id = profile.id and permission.permission = 'courses.manage'
  )
$$;

create function private.course_start_planning(p_course_run_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  managing boolean := private.has_permission('courses.manage');
  courses jsonb;
begin
  if not private.actor_active()
     or (p_course_run_id is null and not managing)
     or (p_course_run_id is not null and not private.readiness_access(p_course_run_id)) then
    raise insufficient_privilege;
  end if;
  with candidates as materialized (
    select run.id, first_session.starts_at
    from public.course_runs run
    cross join lateral (
      select min(session.starts_at) as starts_at
      from public.course_sessions session where session.course_run_id = run.id
    ) first_session
    where run.archived_at is null and (
      run.id = p_course_run_id
      or (p_course_run_id is null and first_session.starts_at
        between now() - interval '1 day' and now() + interval '7 days'
        and (run.published or exists (
          select 1 from public.jobs job where job.course_run_id = run.id
          and job.status in ('published', 'filled')
        )))
    )
    order by first_session.starts_at nulls last, run.id
    limit 100
  ), snapshots as materialized (
    select candidate.id, candidate.starts_at,
      private.readiness_snapshot(candidate.id) as readiness
    from candidates candidate
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', item.id, 'title', item.readiness->>'title',
    'starts_at', item.starts_at, 'time_zone', item.readiness->>'time_zone',
    'deadline', due.deadline,
    'status', case when item.readiness->>'status' in ('ready','completed') then 'ready'
                   when due.deadline <= now() then 'overdue'
                   when item.starts_at is null then 'unscheduled' else 'pending' end,
    'missing', (select coalesce(jsonb_agg(requirement->>'code'), '[]'::jsonb)
      from jsonb_array_elements(item.readiness->'checks') requirement
      where (requirement->>'applicable')::boolean and not (requirement->>'complete')::boolean),
    'responsible', responsible.name,
    'backup', backup.name,
    'version', coalesce(policy.version, 0),
    'responsible_id', case when managing then responsible.id end,
    'backup_id', case when managing then backup.id end
  ) order by item.starts_at nulls last, item.id), '[]'::jsonb) into courses
  from snapshots item
  left join private.course_start_policies policy on policy.course_run_id = item.id
  left join private.course_readiness_settings prep on prep.course_run_id = item.id
  left join private.course_start_staff() responsible on responsible.id = policy.responsible_user_id
  left join private.course_start_staff() backup on backup.id = policy.backup_user_id
  cross join lateral (
    select least(prep.preparation_deadline, item.starts_at - interval '24 hours') as deadline
  ) due
  where p_course_run_id is not null or item.readiness->>'status' not in ('ready', 'completed');

  return jsonb_build_object('items', courses, 'can_manage', managing, 'staff',
    case when managing and p_course_run_id is not null then coalesce(
      (select jsonb_agg(to_jsonb(person) order by person.name, person.id)
       from private.course_start_staff() person), '[]'::jsonb) else '[]'::jsonb end);
end;
$$;

create function public.course_start_planning(p_course_run_id uuid default null) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select private.course_start_planning(p_course_run_id)
$$;

create function private.set_course_start_responsibility(
  p_course_run_id uuid, p_responsible uuid, p_backup uuid, p_version integer
) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  saved private.course_start_policies;
begin
  if not private.has_permission('courses.manage') then raise insufficient_privilege; end if;
  perform 1 from public.profiles
  where active and id in (auth.uid(), p_responsible, p_backup)
  order by id for share;
  if not private.has_permission('courses.manage') then raise insufficient_privilege; end if;
  perform 1 from public.course_runs where id = p_course_run_id and archived_at is null for update;
  if not found then raise insufficient_privilege; end if;

  if p_responsible is null or p_backup = p_responsible
    or not exists (select 1 from private.course_start_staff() where id = p_responsible)
    or (p_backup is not null and not exists (
      select 1 from private.course_start_staff() where id = p_backup
    )) then
    raise exception 'Current course staff and different responsible and backup accounts are required' using errcode = '22023';
  end if;

  select * into saved from private.course_start_policies where course_run_id = p_course_run_id;
  if saved.responsible_user_id = p_responsible and saved.backup_user_id is not distinct from p_backup
     and saved.version in (p_version, p_version + 1) then
    return saved.version;
  end if;
  if coalesce(saved.version, 0) is distinct from p_version then
    raise exception 'Course start responsibilities changed; reload' using errcode = '40001';
  end if;

  insert into private.course_start_policies as policy (course_run_id, responsible_user_id, backup_user_id, version)
    values (p_course_run_id, p_responsible, p_backup, 1)
    on conflict (course_run_id) do update set
      responsible_user_id = excluded.responsible_user_id, backup_user_id = excluded.backup_user_id,
      version = policy.version + 1, checked_at = null
    returning version into saved.version;
  return saved.version;
end;
$$;

create function public.set_course_start_responsibility(
  p_course_run_id uuid, p_responsible uuid, p_backup uuid, p_version integer
) returns integer language sql security invoker set search_path = '' as $$
  select private.set_course_start_responsibility(p_course_run_id, p_responsible, p_backup, p_version)
$$;

create function private.send_course_start_alerts() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  candidate record;
  recipient uuid;
  alert_id uuid;
  alert_stage text;
  sent integer := 0;
begin
  -- A course with no named owner still escalates to the management fallback.
  -- Take the run lock first, as the course deletion and writer paths do.
  insert into private.course_start_policies(course_run_id)
  select run.id
  from public.course_runs run
  left join private.course_readiness_settings prep on prep.course_run_id = run.id
  cross join lateral (
    select min(starts_at) as starts_at from public.course_sessions where course_run_id = run.id
  ) first_session
  where run.archived_at is null
    and first_session.starts_at between now() - interval '1 day' and now() + interval '7 days'
    and least(prep.preparation_deadline, first_session.starts_at - interval '24 hours')
      <= now() + interval '24 hours'
    and (run.published or exists (
      select 1 from public.jobs job where job.course_run_id = run.id and job.status in ('published', 'filled')
    ))
    and not exists (select 1 from private.course_start_policies policy where policy.course_run_id = run.id)
  order by first_session.starts_at, run.id
  limit 50 for share of run skip locked
  on conflict (course_run_id) do nothing;

  for candidate in
    select policy.*, due.deadline
    from private.course_start_policies policy
    join public.course_runs run on run.id = policy.course_run_id
    left join private.course_readiness_settings prep on prep.course_run_id = run.id
    cross join lateral (
      select min(starts_at) as starts_at from public.course_sessions where course_run_id = run.id
    ) first_session
    cross join lateral (
      select least(prep.preparation_deadline, first_session.starts_at - interval '24 hours') as deadline
    ) due
    where run.archived_at is null and first_session.starts_at
       between now() - interval '1 day' and now() + interval '7 days'
      and due.deadline <= now() + interval '24 hours'
      and (run.published or exists (
        select 1 from public.jobs job where job.course_run_id = run.id
          and job.status in ('published', 'filled')
      ))
    order by policy.checked_at nulls first, due.deadline, run.id
    limit 50
  loop
    -- Course removal and responsibility changes take the course row first.
    perform 1 from public.course_runs where id = candidate.course_run_id
      and archived_at is null for share skip locked;
    if not found then continue; end if;
    perform 1 from private.course_start_policies where course_run_id = candidate.course_run_id
      and version = candidate.version for update skip locked;
    if not found then continue; end if;
    update private.course_start_policies set checked_at = now()
      where course_run_id = candidate.course_run_id;
    alert_stage := case when candidate.deadline <= now()
      then 'course_start_escalated' else 'course_start_due' end;
    if exists (select 1 from private.course_start_alerts
          where course_run_id = candidate.course_run_id and deadline = candidate.deadline and stage = alert_stage)
       or private.readiness_snapshot_for_start(candidate.course_run_id, true)->>'status' in ('ready','completed') then
      continue;
    end if;
    select staff.id into recipient from private.course_start_staff() staff
    order by case
      when alert_stage = 'course_start_due' and staff.id = candidate.responsible_user_id then 0
      when alert_stage = 'course_start_escalated' and staff.id = candidate.backup_user_id then 0
      when staff.id = candidate.responsible_user_id then 2 else 1 end,
      staff.id
    limit 1;
    if recipient is null then continue; end if;
    insert into private.course_start_alerts(course_run_id, deadline, stage)
      values (candidate.course_run_id, candidate.deadline, alert_stage)
      on conflict do nothing returning id into alert_id;
    if alert_id is not null then
      insert into public.notifications(user_id, kind, resource_id)
        values (recipient, alert_stage, alert_id) on conflict do nothing;
      sent := sent + 1;
    end if;
  end loop;
  return sent;
end;
$$;

-- Preserve the existing target function OID and grant set.
do $migration$
declare
  definition text := pg_get_functiondef('private.notification_target(text,uuid)'::regprocedure);
  branch constant text := $sql$else private.notification_target_before_calendar_invitation(p_kind, p_resource) end$sql$;
begin
  if cardinality(string_to_array(definition, branch)) <> 2 then
    raise exception 'Expected current calendar notification dispatch';
  end if;
  execute replace(definition, branch, $sql$
    when p_kind in ('course_start_due', 'course_start_escalated') then coalesce((
      select jsonb_build_object('href', '/readiness/' || run.id, 'title', template.title)
      from private.course_start_alerts alert
      join public.course_runs run on run.id = alert.course_run_id
      join public.course_templates template on template.id = run.template_id
      where alert.id = p_resource and alert.stage = p_kind and run.archived_at is null
        and private.has_permission('courses.manage') and exists (
          select 1 from public.notifications notice where notice.user_id = auth.uid()
            and notice.resource_id = alert.id and notice.kind = alert.stage
        )
    ), jsonb_build_object('href', null, 'title', ''))
    else private.notification_target_before_calendar_invitation(p_kind, p_resource) end$sql$);
end;
$migration$;

revoke all on function private.readiness_snapshot_for_start(uuid, boolean),
  private.course_start_staff(), private.send_course_start_alerts() from public, anon, authenticated, service_role;
revoke all on function public.course_start_planning(uuid), private.course_start_planning(uuid),
  public.set_course_start_responsibility(uuid, uuid, uuid, integer),
  private.set_course_start_responsibility(uuid, uuid, uuid, integer) from public, anon;
grant execute on function public.course_start_planning(uuid), private.course_start_planning(uuid),
  public.set_course_start_responsibility(uuid, uuid, uuid, integer),
  private.set_course_start_responsibility(uuid, uuid, uuid, integer) to authenticated;

-- Use the same scheduler and socket convention as administration retention.
do $schedule$
declare
  job_id bigint;
begin
  if not private.ensure_administration_activity_schedule() then return; end if;
  job_id := cron.schedule('portal-course-start-alerts', '*/10 * * * *',
    'select private.send_course_start_alerts()');
  if current_user = 'supabase_admin' and current_setting('cron.use_background_workers', true) = 'off' then
    update cron.job set nodename = '' where jobid = job_id;
  end if;
end;
$schedule$;

notify pgrst, 'reload schema';
commit;
