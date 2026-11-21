begin;

-- A database operator can opt an exact licensed release into the bounded
-- course workflow for integration acceptance. This never enables the
-- complete customer browser or other transports.
create table private.academy_course_access (
  installation_id uuid primary key references private.installation_identity(installation_id),
  release_commit text not null check (release_commit ~ '^[0-9a-f]{40}$')
);
alter table private.academy_course_access enable row level security;
revoke all on private.academy_course_access from public, anon, authenticated, service_role;

create function private.configure_academy_course_access(
  p_installation_id uuid, p_release_commit text, p_enabled boolean
)
returns void language plpgsql security invoker set search_path = '' set lock_timeout = '5s' as $$
declare
  pinned private.installation_identity%rowtype;
begin
  if p_installation_id is null or p_enabled is null
     or coalesce(p_release_commit, '') !~ '^[0-9a-f]{40}$' then
    raise exception 'Invalid academy course access configuration' using errcode = '22023';
  end if;

  select * into strict pinned from private.installation_identity for update;
  if pinned.edition = 'internal' or pinned.installation_id <> p_installation_id then
    raise exception 'Academy course access requires the pinned customer installation' using errcode = '55000';
  end if;

  if not p_enabled then
    delete from private.academy_course_access
    where installation_id = p_installation_id and release_commit = p_release_commit;
    return;
  end if;

  if not private.installation_transport_fences_present() or not exists (
    select 1 from private.installation_verified_licence licence
    where licence.installation_id = p_installation_id
      and licence.terms->>'release_commit' = p_release_commit
      and licence.starts_at <= statement_timestamp() and licence.expires_at > statement_timestamp()
  ) then
    raise exception 'Academy course access requires the active release licence and transport fences' using errcode = '55000';
  end if;

  insert into private.academy_course_access(installation_id, release_commit)
  values (p_installation_id, p_release_commit)
  on conflict (installation_id) do update set release_commit = excluded.release_commit;
end;
$$;
revoke all on function private.configure_academy_course_access(uuid, text, boolean)
  from public, anon, authenticated, service_role;

create function private.academy_course_access_status()
returns text language sql stable security invoker set search_path = '' as $$
  select capability.licence_status
  from public.installation_capability_state capability
  join private.academy_course_access access using (installation_id)
  join private.installation_verified_licence licence using (installation_id)
  where capability.edition <> 'internal'
    and licence.terms->>'release_commit' = access.release_commit;
$$;
revoke all on function private.academy_course_access_status()
  from public, anon, authenticated, service_role;

-- Public entry points keep the existing authentication/access check inside
-- their own scoped RPCs. Only these named endpoints and methods participate
-- in course acceptance, including authenticated reads during licence grace.
create function private.require_academy_course_access()
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
      '/rpc/manage_course_enrolment'
    ))
  ) then
    return;
  end if;

  raise exception 'Academy course operation unavailable' using errcode = '42501';
end;
$$;
revoke all on function private.require_academy_course_access() from public, anon, authenticated, service_role;
grant execute on function private.require_academy_course_access() to authenticated;

create or replace function public.require_portal_access()
returns void language plpgsql stable security invoker set search_path = '' as $$
begin
  if (select edition from public.installation_capability_state) is distinct from 'internal' then
    if current_setting('request.path', true) = '/rpc/installation_capabilities'
       and current_setting('request.method', true) in ('GET', 'HEAD', 'POST') then
      return;
    end if;
    if current_setting('role', true) = 'authenticated' then
      perform private.require_academy_course_access();
      return;
    end if;
    raise exception 'Customer installation is not active' using errcode = '42501';
  end if;
  if current_setting('role', true) = 'authenticated' then
    perform private.require_portal_access();
  end if;
end;
$$;

-- The dedicated licence backs this course read path independently of the
-- internal company switch. Leave all other internal Premium consumers alone.
create function private.course_lms_read_enabled(p_organisation_id uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select case
    when (select edition from private.installation_identity) = 'internal'
      then private.company_premium_enabled(p_organisation_id)
    else coalesce(private.academy_course_access_status() in ('active', 'grace'), false)
      and exists (
        select 1 from public.organisations org
        where org.id = p_organisation_id and org.archived_at is null
      )
  end;
$$;
revoke all on function private.course_lms_read_enabled(uuid) from public, anon, authenticated, service_role;

-- Dedicated candidates and their existing instructor assignment must use
-- the same active, operator-approved release. Internal course access is
-- unchanged; the two customer editions use only direct teaching allocations.
create or replace function private.academy_assignment_course(p_course_id uuid)
returns public.course_runs language plpgsql stable security definer set search_path = '' as $$
declare
  v_run public.course_runs;
begin
  if private.academy_course_access_status() is distinct from 'active'
     or not private.has_permission('courses.manage') or not private.has_permission('jobs.manage') then
    raise insufficient_privilege;
  end if;
  select run.* into v_run
  from public.course_runs run join public.organisations org on org.id = run.organisation_id
  where run.id = p_course_id and run.archived_at is null and org.archived_at is null;
  if not found then raise insufficient_privilege; end if;
  return v_run;
end;
$$;

create function private.course_has_current_teacher(p_course_id uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists (
    select 1 from public.job_claims claim
    join public.jobs job on job.id = claim.job_id
    where job.course_run_id = p_course_id and claim.lecturer_id = auth.uid()
      and claim.status = 'confirmed'
      and (
        (select edition from private.installation_identity) = 'internal'
        or exists (
          select 1 from private.academy_course_instructors assignment
          where assignment.claim_id = claim.id and assignment.course_id = p_course_id
            and assignment.instructor_id = auth.uid() and assignment.released_at is null
        )
      )
  );
$$;
revoke all on function private.course_has_current_teacher(uuid) from public, anon, authenticated, service_role;

create or replace function private.course_workspace_context(p_run_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  run_row public.course_runs%rowtype;
  manager boolean;
  teacher boolean;
  learner boolean;
  client boolean;
  lms_enabled boolean;
begin
  if not (private.actor_active() or private.participant_actor()) then
    raise exception 'Active course account required' using errcode = '42501';
  end if;
  select * into run_row
  from public.course_runs where id = p_run_id and archived_at is null;
  if not found then
    raise exception 'Course unavailable' using errcode = '42501';
  end if;
  manager := private.has_permission('courses.manage');
  teacher := private.lecturer_actor() and private.course_has_current_teacher(p_run_id);
  client := private.client_has_organisation(run_row.organisation_id);
  lms_enabled := private.course_lms_read_enabled(run_row.organisation_id);
  learner := lms_enabled and
    private.active_company_participant(auth.uid(), run_row.organisation_id) and
    exists (
      select 1 from public.course_enrolments enrolment
      where enrolment.course_run_id = p_run_id
        and enrolment.user_id = auth.uid()
        and enrolment.status in ('enrolled', 'completed')
    );
  if not (manager or teacher or client or learner) then
    raise exception 'Course unavailable' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'manager', manager,
    'teacher', teacher,
    'learner', learner,
    'client', client,
    'staff', manager or teacher,
    'lms_enabled', lms_enabled
  );
end;
$$;

create or replace function private.my_course_workspaces()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (private.actor_active() or private.participant_actor()) then
    raise exception 'Active account required' using errcode = '42501';
  end if;
  return (
    select coalesce(jsonb_agg(to_jsonb(course) order by course.starts_at desc nulls last, course.id), '[]'::jsonb)
    from (
      select run.id, template.title, template.description, template.syllabus,
        run.time_zone, run.venue, run.delivery_type,
        organisation.name as organisation_name,
        min(session.starts_at) filter (where session.starts_at > statement_timestamp()) as next_start_at,
        private.course_lms_read_enabled(run.organisation_id) lms_enabled,
        min(session.starts_at) starts_at, max(session.ends_at) ends_at,
        private.course_lms_read_enabled(run.organisation_id) and
          private.active_company_participant(auth.uid(), run.organisation_id) and exists (
            select 1 from public.course_enrolments enrolment
            where enrolment.course_run_id = run.id and enrolment.user_id = auth.uid()
              and enrolment.status in ('enrolled', 'completed')
          ) participant
      from public.course_runs run
      join public.course_templates template on template.id = run.template_id
      left join public.organisations organisation on organisation.id = run.organisation_id
      left join public.course_sessions session on session.course_run_id = run.id
      where run.archived_at is null and (
        (select edition from private.installation_identity) = 'internal'
        or private.course_lms_read_enabled(run.organisation_id)
      ) and (
        private.has_permission('courses.manage') or
        private.client_has_organisation(run.organisation_id) or
        private.course_has_current_teacher(run.id) or (
          private.course_lms_read_enabled(run.organisation_id) and
          private.active_company_participant(auth.uid(), run.organisation_id) and exists (
            select 1 from public.course_enrolments enrolment
            where enrolment.course_run_id = run.id and enrolment.user_id = auth.uid()
              and enrolment.status in ('enrolled', 'completed')
          )
        )
      )
      group by run.id, template.title, template.description, template.syllabus,
        run.organisation_id, organisation.name
      order by min(session.starts_at) desc nulls last, run.id
      limit 200
    ) course
  );
end;
$$;

-- Serialize course writes with operator licence changes and profile closure.
create function private.lock_academy_course_access()
returns void language plpgsql security invoker set search_path = '' as $$
begin
  perform 1 from private.installation_identity where singleton for share;
  if private.academy_course_access_status() is distinct from 'active' then
    raise insufficient_privilege;
  end if;
end;
$$;
revoke all on function private.lock_academy_course_access() from public, anon, authenticated, service_role;

alter function private.academy_assign_course_instructor(uuid, uuid, uuid)
  rename to academy_assign_course_instructor_before_access;
alter function private.academy_release_course_instructor(uuid, uuid, text, uuid)
  rename to academy_release_course_instructor_before_access;
revoke all on function private.academy_assign_course_instructor_before_access(uuid, uuid, uuid),
  private.academy_release_course_instructor_before_access(uuid, uuid, text, uuid)
  from public, anon, authenticated, service_role;

create function private.academy_assign_course_instructor(p_course_id uuid, p_instructor_id uuid, p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform private.lock_academy_course_access();
  return private.academy_assign_course_instructor_before_access(p_course_id, p_instructor_id, p_request_id);
end;
$$;

create function private.academy_release_course_instructor(
  p_course_id uuid, p_claim_id uuid, p_reason text, p_request_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform private.lock_academy_course_access();
  return private.academy_release_course_instructor_before_access(p_course_id, p_claim_id, p_reason, p_request_id);
end;
$$;
revoke all on function private.academy_assign_course_instructor(uuid, uuid, uuid),
  private.academy_release_course_instructor(uuid, uuid, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.academy_assign_course_instructor(uuid, uuid, uuid),
  private.academy_release_course_instructor(uuid, uuid, text, uuid) to authenticated;

-- Reuse the existing scoped and audited enrolment transaction, including its
-- membership synchronisation. Customer writes use the active release licence.
create or replace function private.manage_course_enrolment_before_chat_autosync(
  p_course_run_id uuid, p_user_id uuid, p_status text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous text;
  course_end timestamptz;
  context jsonb;
  organisation_id uuid;
  is_internal boolean := (select edition = 'internal' from private.installation_identity);
begin
  if not is_internal then
    perform private.lock_academy_course_access();
    perform 1 from public.course_runs run
    join public.organisations org on org.id = run.organisation_id
    where run.id = p_course_run_id and run.archived_at is null and org.archived_at is null
    for update of run for share of org;
    if not found then raise insufficient_privilege; end if;
  end if;
  context := private.course_workspace_context(p_course_run_id);
  if not ((context->>'manager')::boolean or (context->>'client')::boolean) then
    raise exception 'Course enrolment management required' using errcode = '42501';
  end if;
  if is_internal then
    perform private.lock_course_premium(p_course_run_id);
  end if;
  select run.organisation_id into organisation_id
  from public.course_runs run where run.id = p_course_run_id for update;
  if not found then raise exception 'Invalid course' using errcode = '22023'; end if;
  if not private.active_company_participant(p_user_id, organisation_id) or
     p_status is null or p_status not in ('enrolled', 'completed', 'removed') then
    raise exception 'Active company participant required' using errcode = '42501';
  end if;
  select max(ends_at) into course_end
  from public.course_sessions where course_run_id = p_course_run_id;
  if p_status = 'completed' and
     (course_end is null or course_end > now()) then
    raise exception 'Course has not completed' using errcode = '22023';
  end if;
  select status into previous from public.course_enrolments
  where course_run_id = p_course_run_id and user_id = p_user_id
  for update;
  insert into public.course_enrolments(course_run_id, user_id, status, enrolled_by)
  values (p_course_run_id, p_user_id, p_status, auth.uid())
  on conflict (course_run_id, user_id) do update
    set status = excluded.status, updated_at = now();
  insert into public.audit_events(actor_id, action, resource_id, details)
  values (
    auth.uid(), 'course.enrolment.changed', p_course_run_id,
    jsonb_build_object('user_id', p_user_id, 'previous', previous, 'status', p_status)
  );
end;
$$;
-- The existing private reader is stable and rechecks course/actor scope.
alter function public.course_enrolments(uuid) stable;

create or replace function public.course_workspace(p_run_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select case
    when (select edition from public.installation_capability_state) = 'internal' then workspace.data
    when jsonb_typeof(workspace.data->'meeting_link') = 'object' then
      jsonb_set(workspace.data, '{meeting_link,can_edit}', 'false'::jsonb)
        || jsonb_build_object('repeat_request', null)
    else workspace.data || jsonb_build_object('repeat_request', null)
  end
  from (select private.course_workspace_with_meeting_link(p_run_id) as data) workspace;
$$;

notify pgrst, 'reload schema';
commit;
