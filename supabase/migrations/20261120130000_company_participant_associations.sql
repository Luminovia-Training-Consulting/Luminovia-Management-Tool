begin;

-- Membership is organization-scoped and never changes a participant's global
-- Auth account, role, access to another company or retained course history.
create table private.company_participant_memberships (
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null check (status in ('pending', 'active', 'removed')),
  invitation_id uuid references public.invitation_requests(id),
  link_request_id uuid,
  invited_by uuid not null,
  joined_at timestamptz,
  removed_at timestamptz,
  version integer not null default 1 check (version > 0),
  primary key (organisation_id, user_id),
  check ((invitation_id is not null)::integer + (link_request_id is not null)::integer = 1),
  check (
    (status = 'pending' and joined_at is null and removed_at is null) or
    (status = 'active' and joined_at is not null and removed_at is null) or
    (status = 'removed' and removed_at is not null)
  )
);
create index company_participant_memberships_user
  on private.company_participant_memberships(user_id, status, organisation_id);
revoke all on private.company_participant_memberships
  from public, anon, authenticated, service_role;

create table private.company_participant_link_requests (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  requested_by uuid not null,
  request_id uuid not null,
  luminovia_user_id text not null check (length(luminovia_user_id) between 1 and 32),
  target_user_id uuid,
  status text not null check (status in ('pending', 'unmatched', 'already_member', 'accepted', 'declined', 'expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  unique (requested_by, request_id)
);
create index company_participant_link_target
  on private.company_participant_link_requests(target_user_id, status, expires_at);
revoke all on private.company_participant_link_requests
  from public, anon, authenticated, service_role;
alter table private.company_participant_memberships
  add constraint company_participant_link_request_fk
  foreign key (link_request_id) references private.company_participant_link_requests(id)
  on delete cascade;

create table private.company_participant_membership_commands (
  actor_id uuid not null,
  request_id uuid not null,
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  user_id uuid not null,
  command text not null check (command in ('accept', 'remove')),
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (actor_id, request_id)
);
revoke all on private.company_participant_membership_commands
  from public, anon, authenticated, service_role;

-- Service-only dispatch metadata lets the shared Accounts Edge sender reuse
-- Auth invitations without returning account-existence information to clients.
create table private.company_participant_invitation_dispatches (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null,
  request_id uuid not null,
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  email text not null,
  display_name text not null,
  invitation_id uuid references public.invitation_requests(id) on delete set null,
  status text not null check (status in ('pending', 'sending', 'sent', 'failed', 'duplicate')),
  created_at timestamptz not null default now(),
  unique (actor_id, request_id)
);
revoke all on private.company_participant_invitation_dispatches
  from public, anon, authenticated, service_role;

-- Keep the operational actor predicate unchanged: only paths that explicitly
-- opt into this narrower role may admit a standalone participant.
create function private.participant_actor()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    join auth.users identity on identity.id = p.id
    where p.id = auth.uid() and p.active and identity.email_confirmed_at is not null
      and exists (select 1 from public.user_roles r where r.user_id = p.id and r.role = 'participant')
      and not exists (select 1 from public.user_roles r where r.user_id = p.id and r.role <> 'participant')
  );
$$;
revoke all on function private.participant_actor() from public, anon, authenticated, service_role;
grant execute on function private.participant_actor() to authenticated;

create or replace function private.learning_actor()
returns boolean language sql stable security definer set search_path = ''
as $$ select private.actor_active() or private.participant_actor(); $$;

-- A company relationship requires both the participant-only global role and
-- an accepted membership for this exact organization.
create function private.active_company_participant(p_user_id uuid, p_organisation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles profile
    where profile.id = p_user_id and profile.active
      and exists (
        select 1 from public.user_roles role
        where role.user_id = profile.id and role.role = 'participant'
      )
      and not exists (
        select 1 from public.user_roles role
        where role.user_id = profile.id and role.role <> 'participant'
      )
      and exists (
        select 1 from private.company_participant_memberships membership
        where membership.user_id = p_user_id
          and membership.organisation_id = p_organisation_id
          and membership.status = 'active'
      )
  );
$$;
revoke all on function private.active_company_participant(uuid, uuid)
  from public, anon, authenticated, service_role;

-- Self-cancellation also requires an accepted participant membership for the
-- exact organization. It remains atomic with this user's full course block.
create or replace function private.cancel_own_course_enrolment(p_course_run_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  first_start timestamptz;
  room record;
  actor uuid := auth.uid();
  organisation_id uuid;
begin
  if not private.participant_actor() then
    raise exception 'Active participant required' using errcode = '42501';
  end if;
  perform private.lock_course_premium(p_course_run_id);
  select run.organisation_id into organisation_id
  from public.course_runs run where run.id = p_course_run_id for update;
  if not found or not private.active_company_participant(actor, organisation_id) then
    raise exception 'Active company participant required' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(actor::text, 0)
  );
  perform 1 from public.course_enrolments
  where course_run_id = p_course_run_id and user_id = actor and status = 'enrolled'
  for update;
  if not found then
    raise exception 'Active enrolment required' using errcode = '42501';
  end if;
  select min(starts_at) into first_start
  from public.course_sessions where course_run_id = p_course_run_id;
  if first_start is null or first_start < clock_timestamp() + interval '7 days' then
    raise exception 'Cancellation deadline passed' using errcode = '22023';
  end if;
  update public.course_enrolments set status = 'removed', updated_at = clock_timestamp()
  where course_run_id = p_course_run_id and user_id = actor;
  for room in
    select id from public.chat_rooms
    where course_run_id = p_course_run_id and kind = 'participant_course'
    order by id for update
  loop
    perform private.participant_chat_assignment_release(room.id, actor, p_course_run_id);
  end loop;
  insert into public.audit_events(actor_id, action, resource_id, details)
  values (
    actor, 'course.enrolment.changed', p_course_run_id,
    jsonb_build_object(
      'user_id', actor, 'previous', 'enrolled', 'status', 'removed',
      'self_cancelled', true
    )
  );
end;
$$;

-- Existing participant-course room membership is insufficient after company
-- removal; every message/Realtime read also rechecks active enrollment.
create or replace function private.can_access_chat_room(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.chat_members member
    join public.chat_rooms room on room.id = member.room_id
    left join public.course_runs run on run.id = room.course_run_id
    where member.room_id = p_room_id
      and member.user_id = auth.uid()
      and member.removed_at is null
      and case when room.kind = 'participant_course' then
        run.archived_at is null and private.company_premium_enabled(run.organisation_id)
        and (
          (private.participant_actor() and private.active_company_participant(auth.uid(), run.organisation_id) and exists (
            select 1 from public.course_enrolments enrolment
            where enrolment.course_run_id = run.id and enrolment.user_id = auth.uid()
              and enrolment.status in ('enrolled', 'completed')
          )) or (private.actor_active() and (
            private.has_permission('courses.manage') or
            private.client_has_organisation(run.organisation_id) or
            (private.lecturer_actor() and exists (
              select 1 from public.job_claims claim join public.jobs job on job.id = claim.job_id
              where job.course_run_id = run.id and claim.lecturer_id = auth.uid()
                and claim.status = 'confirmed'
            ))
          ))
        )
        else private.actor_active() end
      and (
        room.kind not in ('general', 'topic', 'lecturer_course') or
        (room.kind = 'general' and private.has_role(array['lecturer', 'senior_lecturer'])) or
        (room.kind in ('topic', 'lecturer_course') and private.chat_staff(auth.uid()))
      )
  );
$$;

-- Reserve only a participant role for a current organization member/admin with
-- Premium ON. The public result is identical for new, duplicate and existing emails.
create function private.reserve_company_participant_invitation(
  p_organisation_id uuid, p_email text, p_display_name text, p_request_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  requesting_actor uuid := auth.uid();
  normalized_email text := lower(trim(p_email));
  normalized_name text := trim(p_display_name);
  existing_dispatch private.company_participant_invitation_dispatches%rowtype;
  invitation_id uuid;
  dispatch_id uuid;
  dispatch_status text;
begin
  if not private.actor_active() or p_organisation_id is null or
     p_request_id is null or normalized_email is null or
     length(normalized_email) > 254 or
     normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or
     normalized_name is null or length(normalized_name) not between 1 and 120 then
    raise exception 'Invalid participant invitation' using errcode = '22023';
  end if;
  if not (private.client_has_organisation(p_organisation_id) or
      private.has_permission('courses.manage') or
      private.has_permission('organisations.manage')) then
    raise exception 'Company participant management required' using errcode = '42501';
  end if;
  perform private.lock_company_premium(p_organisation_id);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('company-participant-invite:' || requesting_actor::text, 0)
  );
  select * into existing_dispatch
  from private.company_participant_invitation_dispatches dispatch
  where dispatch.actor_id = requesting_actor and dispatch.request_id = p_request_id;
  if found then
    if existing_dispatch.organisation_id <> p_organisation_id or
       existing_dispatch.email <> normalized_email or
       existing_dispatch.display_name <> normalized_name then
      raise exception 'Participant invitation request ID conflict' using errcode = '40001';
    end if;
    return jsonb_build_object('status', 'requested', 'request_id', existing_dispatch.id);
  end if;
  if (select count(*) from private.company_participant_invitation_dispatches dispatch
      where dispatch.actor_id = requesting_actor
        and dispatch.created_at > now() - interval '15 minutes') >= 5 then
    insert into private.company_participant_invitation_dispatches(
      actor_id, request_id, organisation_id, email, display_name, status
    ) values (
      requesting_actor, p_request_id, p_organisation_id, normalized_email,
      normalized_name, 'duplicate'
    ) returning id into dispatch_id;
    return jsonb_build_object('status', 'requested', 'request_id', dispatch_id);
  end if;

  if exists (select 1 from auth.users where lower(email) = normalized_email) or
     exists (select 1 from public.invitation_requests where email = normalized_email) then
    dispatch_status := 'duplicate';
  else
    begin
      insert into public.invitation_requests(
        actor_id, idempotency_key, email, requested_role,
        organisation_id, display_name
      ) values (
        requesting_actor, p_request_id, normalized_email, 'participant',
        p_organisation_id, normalized_name
      ) returning id into invitation_id;
      dispatch_status := 'pending';
    exception when unique_violation then
      dispatch_status := 'duplicate';
    end;
  end if;
  insert into private.company_participant_invitation_dispatches(
    actor_id, request_id, organisation_id, email, display_name,
    invitation_id, status
  ) values (
    requesting_actor, p_request_id, p_organisation_id, normalized_email,
    normalized_name, invitation_id, dispatch_status
  ) returning id into dispatch_id;
  if dispatch_status = 'pending' then
    insert into public.audit_events(actor_id, action, resource_id, details)
    values (
      requesting_actor, 'company.participant_invitation_reserved', dispatch_id,
      jsonb_build_object('organisation_id', p_organisation_id)
    );
  end if;
  return jsonb_build_object('status', 'requested', 'request_id', dispatch_id);
end;
$$;


-- Company contacts may read only their own enrolled participant roster while
-- Premium is ON; management retains its already-authorized course scope.
create or replace function private.course_enrolments(p_course_run_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare context jsonb;
begin
  context := private.course_workspace_context(p_course_run_id);
  if not ((context->>'manager')::boolean or (context->>'client')::boolean) then
    raise exception 'Course enrolment roster access required' using errcode = '42501';
  end if;
  perform private.lock_course_premium(p_course_run_id);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'user_id', enrolment.user_id,
      'display_name', profile.display_name,
      'status', enrolment.status,
      'updated_at', enrolment.updated_at
    ) order by profile.display_name)
    from public.course_enrolments enrolment
    join public.profiles profile on profile.id = enrolment.user_id
    where enrolment.course_run_id = p_course_run_id
  ), '[]'::jsonb);
end;
$$;

-- Enrolment changes are authorized by company course ownership or course
-- management, and the target must be an active participant of that company.
create or replace function private.manage_course_enrolment(
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
begin
  context := private.course_workspace_context(p_course_run_id);
  if not ((context->>'manager')::boolean or (context->>'client')::boolean) then
    raise exception 'Course enrolment management required' using errcode = '42501';
  end if;
  perform private.lock_course_premium(p_course_run_id);
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

-- A participant's global role is not organization membership. This predicate
-- requires an active account with only the participant role and an accepted
-- membership for this exact company.
create or replace function private.active_company_participant(p_user_id uuid, p_organisation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles profile
    where profile.id = p_user_id and profile.active
      and exists (
        select 1 from public.user_roles role
        where role.user_id = profile.id and role.role = 'participant'
      )
      and not exists (
        select 1 from public.user_roles role
        where role.user_id = profile.id and role.role <> 'participant'
      )
      and exists (
        select 1 from private.company_participant_memberships membership
        where membership.user_id = p_user_id
          and membership.organisation_id = p_organisation_id
          and membership.status = 'active'
      )
  );
$$;
revoke all on function private.active_company_participant(uuid, uuid)
  from public, anon, authenticated, service_role;

-- Recheck accepted participant membership on every workspace read; a pending
-- invite or another company's membership is never sufficient authority.
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
  teacher := private.lecturer_actor() and exists (
    select 1 from public.job_claims claim
    join public.jobs job on job.id = claim.job_id
    where job.course_run_id = p_run_id
      and claim.lecturer_id = auth.uid()
      and claim.status = 'confirmed'
  );
  client := private.client_has_organisation(run_row.organisation_id);
  lms_enabled := private.company_premium_enabled(run_row.organisation_id);
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

-- The participant overview requires the same active per-company membership as
-- individual workspace reads. Removing A leaves an independent B enrolment intact.
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
        private.company_premium_enabled(run.organisation_id) lms_enabled,
        min(session.starts_at) starts_at, max(session.ends_at) ends_at,
        private.company_premium_enabled(run.organisation_id) and
          private.active_company_participant(auth.uid(), run.organisation_id) and exists (
            select 1 from public.course_enrolments enrolment
            where enrolment.course_run_id = run.id and enrolment.user_id = auth.uid()
              and enrolment.status in ('enrolled', 'completed')
          ) participant
      from public.course_runs run
      join public.course_templates template on template.id = run.template_id
      left join public.course_sessions session on session.course_run_id = run.id
      where run.archived_at is null and (
        private.has_permission('courses.manage') or
        private.client_has_organisation(run.organisation_id) or
        exists (
          select 1 from public.job_claims claim
          join public.jobs job on job.id = claim.job_id
          where job.course_run_id = run.id
            and claim.lecturer_id = auth.uid()
            and claim.status = 'confirmed'
        ) or (
          private.company_premium_enabled(run.organisation_id) and
          private.active_company_participant(auth.uid(), run.organisation_id) and exists (
            select 1 from public.course_enrolments enrolment
            where enrolment.course_run_id = run.id and enrolment.user_id = auth.uid()
              and enrolment.status in ('enrolled', 'completed')
          )
        )
      )
      group by run.id, template.title, template.description, template.syllabus,
        run.organisation_id
      order by min(session.starts_at) desc nulls last, run.id
      limit 200
    ) course
  );
end;
$$;

-- Return only the caller's own pending membership invitations while the
-- target company's Premium LMS is currently enabled.
create function private.my_company_participant_invitations()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.participant_actor() then
    raise exception 'Verified participant identity required' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(invite.data order by invite.created_at, invite.organisation_id)
    from (
      select jsonb_build_object(
        'organisation_id', organisation.id,
        'organisation_name', organisation.name,
        'version', membership.version,
        'expires_at', invitation.created_at + interval '14 days',
        'source', 'email'
      ) data, invitation.created_at, organisation.id organisation_id
      from private.company_participant_memberships membership
      join public.organisations organisation on organisation.id = membership.organisation_id
      join public.invitation_requests invitation on invitation.id = membership.invitation_id
      where membership.user_id = auth.uid() and membership.status = 'pending'
        and invitation.status = 'sent'
        and invitation.created_at > now() - interval '14 days'
        and private.company_premium_enabled(organisation.id)
      union all
      select jsonb_build_object(
        'organisation_id', organisation.id,
        'organisation_name', organisation.name,
        'version', membership.version,
        'expires_at', request.expires_at,
        'source', 'luminovia_user_id'
      ) data, request.created_at, organisation.id organisation_id
      from private.company_participant_memberships membership
      join public.organisations organisation on organisation.id = membership.organisation_id
      join private.company_participant_link_requests request
        on request.id = membership.link_request_id
      where membership.user_id = auth.uid() and membership.status = 'pending'
        and request.target_user_id = auth.uid() and request.status = 'pending'
        and request.expires_at > now()
        and private.company_premium_enabled(organisation.id)
    ) invite
  ), '[]'::jsonb);
end;
$$;

-- Company contacts see only their own active participant directory; staff may
-- inspect a specifically authorized company while Premium is ON.
create function private.company_participants(p_organisation_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.actor_active() or not (
    private.client_has_organisation(p_organisation_id) or
    private.has_permission('courses.manage')
  ) then
    raise exception 'Company participant management required' using errcode = '42501';
  end if;
  if not private.company_premium_enabled(p_organisation_id) then
    raise exception 'Company Premium LMS is OFF' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'user_id', profile.id,
      'luminovia_user_id', profile.luminovia_user_id,
      'display_name', profile.display_name,
      'joined_at', membership.joined_at,
      'version', membership.version
    ) order by profile.display_name, profile.luminovia_user_id)
    from private.company_participant_memberships membership
    join public.profiles profile on profile.id = membership.user_id
    where membership.organisation_id = p_organisation_id
      and private.active_company_participant(profile.id, p_organisation_id)
  ), '[]'::jsonb);
end;
$$;

-- Record an opaque User-ID association request. A nonmatch and an ineligible
-- account produce the same response and no target identity in the result.
create function private.request_company_participant_link(
  p_organisation_id uuid, p_luminovia_user_id text, p_request_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_user uuid;
  existing_request private.company_participant_link_requests%rowtype;
  request_id uuid;
  request_status text;
begin
  if not private.actor_active() or p_organisation_id is null or
     p_luminovia_user_id is null or length(btrim(p_luminovia_user_id)) not between 1 and 32 or
     p_request_id is null then
    raise exception 'Valid participant link request required' using errcode = '22023';
  end if;
  if not (private.client_has_organisation(p_organisation_id) or
      private.has_permission('courses.manage')) then
    raise exception 'Company participant management required' using errcode = '42501';
  end if;
  perform private.lock_company_premium(p_organisation_id);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('participant-link:' || auth.uid()::text || ':' || p_organisation_id::text, 0)
  );
  select * into existing_request from private.company_participant_link_requests
  where requested_by = auth.uid() and request_id = p_request_id;
  if found then
    if existing_request.organisation_id <> p_organisation_id or
       existing_request.luminovia_user_id <> upper(btrim(p_luminovia_user_id)) then
      raise exception 'Participant link request ID conflict' using errcode = '40001';
    end if;
    return jsonb_build_object('status', 'request_submitted');
  end if;
  if (select count(*) from private.company_participant_link_requests request
      where request.requested_by = auth.uid()
        and request.created_at > now() - interval '1 hour') >= 10 then
    return jsonb_build_object('status', 'request_submitted');
  end if;
  select profile.id into target_user
  from public.profiles profile
  where profile.luminovia_user_id = upper(btrim(p_luminovia_user_id))
    and profile.active
    and exists (
      select 1 from public.user_roles role
      where role.user_id = profile.id and role.role = 'participant'
    )
    and not exists (
      select 1 from public.user_roles role
      where role.user_id = profile.id and role.role <> 'participant'
    )
    and profile.id <> auth.uid();
  if target_user is null then
    request_status := 'unmatched';
  elsif private.active_company_participant(target_user, p_organisation_id) then
    request_status := 'already_member';
  else
    request_status := 'pending';
  end if;
  insert into private.company_participant_link_requests(
    organisation_id, requested_by, request_id, luminovia_user_id,
    target_user_id, status, expires_at
  ) values (
    p_organisation_id, auth.uid(), p_request_id, upper(btrim(p_luminovia_user_id)),
    case when request_status = 'pending' then target_user else null end,
    request_status, now() + interval '14 days'
  ) returning id into request_id;
  if request_status = 'pending' then
    insert into private.company_participant_memberships(
      organisation_id, user_id, status, link_request_id, invited_by, version
    ) values (
      p_organisation_id, target_user, 'pending', request_id, auth.uid(), 1
    ) on conflict (organisation_id, user_id) do update
      set status = 'pending', invitation_id = null, link_request_id = excluded.link_request_id,
        invited_by = excluded.invited_by, joined_at = null, removed_at = null,
        version = private.company_participant_memberships.version + 1
      where private.company_participant_memberships.status = 'removed';
  end if;
  return jsonb_build_object('status', 'request_submitted');
end;
$$;


-- Participant acceptance verifies the current Auth identity and organization
-- entitlement; the same user remains independent across other companies.
create function private.accept_company_participant_invitation(
  p_organisation_id uuid, p_expected_version integer, p_request_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  membership private.company_participant_memberships%rowtype;
  previous private.company_participant_membership_commands%rowtype;
  result jsonb;
begin
  if not private.participant_actor() then
    raise exception 'Verified participant identity required' using errcode = '42501';
  end if;
  if p_organisation_id is null or p_expected_version is null or p_request_id is null then
    raise exception 'Valid participant acceptance required' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('participant-membership:' || auth.uid()::text, 0)
  );
  select * into previous
  from private.company_participant_membership_commands
  where actor_id = auth.uid() and request_id = p_request_id;
  if found then
    if previous.organisation_id <> p_organisation_id or
       previous.user_id <> auth.uid() or previous.command <> 'accept' then
      raise exception 'Participant acceptance request ID conflict' using errcode = '22023';
    end if;
    return previous.result;
  end if;
  perform private.lock_company_premium(p_organisation_id);
  select * into membership
  from private.company_participant_memberships
  where organisation_id = p_organisation_id and user_id = auth.uid()
  for update;
  if not found or membership.status <> 'pending' then
    raise exception 'Participant invitation is unavailable' using errcode = '42501';
  end if;
  if membership.version <> p_expected_version then
    raise exception 'participant_membership_version_conflict' using errcode = '40001';
  end if;
  if membership.invitation_id is not null and not exists (
    select 1 from public.invitation_requests invitation
    where invitation.id = membership.invitation_id
      and invitation.requested_role = 'participant'
      and invitation.organisation_id = p_organisation_id
      and invitation.status = 'sent'
      and invitation.created_at > now() - interval '14 days'
  ) then
    raise exception 'Participant invitation is unavailable' using errcode = '42501';
  end if;
  if membership.link_request_id is not null and not exists (
    select 1 from private.company_participant_link_requests request
    where request.id = membership.link_request_id
      and request.target_user_id = auth.uid()
      and request.status = 'pending'
      and request.expires_at > now()
  ) then
    raise exception 'Participant invitation is unavailable' using errcode = '42501';
  end if;
  update private.company_participant_memberships set
    status = 'active', joined_at = clock_timestamp(), removed_at = null,
    version = version + 1
  where organisation_id = p_organisation_id and user_id = auth.uid()
  returning * into membership;
  if membership.link_request_id is not null then
    update private.company_participant_link_requests
      set status = 'accepted'
    where id = membership.link_request_id;
  end if;
  result := jsonb_build_object(
    'status', 'accepted', 'organisation_id', p_organisation_id,
    'version', membership.version
  );
  insert into private.company_participant_membership_commands(
    actor_id, request_id, organisation_id, user_id, command, result
  ) values (
    auth.uid(), p_request_id, p_organisation_id, auth.uid(), 'accept', result
  );
  insert into public.audit_events(actor_id, action, resource_id, details)
  values (
    auth.uid(), 'company.participant_link_accepted', p_organisation_id,
    jsonb_build_object('user_id', auth.uid(), 'version', membership.version)
  );
  return result;
end;
$$;

-- Removal changes only this organization's roster/enrolments. It never removes
-- the Auth account or any separate company membership.
create function private.remove_company_participant(
  p_organisation_id uuid, p_user_id uuid,
  p_expected_version integer, p_request_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  membership private.company_participant_memberships%rowtype;
  previous private.company_participant_membership_commands%rowtype;
  result jsonb;
begin
  if not private.actor_active() or not (
    private.client_has_organisation(p_organisation_id) or
    private.has_permission('courses.manage')
  ) then
    raise exception 'Company participant management required' using errcode = '42501';
  end if;
  if p_user_id is null or p_expected_version is null or p_request_id is null then
    raise exception 'Valid participant removal required' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('participant-membership:' || p_user_id::text, 0)
  );
  select * into previous
  from private.company_participant_membership_commands
  where actor_id = auth.uid() and request_id = p_request_id;
  if found then
    if previous.organisation_id <> p_organisation_id or
       previous.user_id <> p_user_id or previous.command <> 'remove' then
      raise exception 'Participant removal request ID conflict' using errcode = '22023';
    end if;
    return previous.result;
  end if;
  perform private.lock_company_premium(p_organisation_id);
  if not exists (
    select 1 from public.user_roles role
    where role.user_id = p_user_id and role.role = 'participant'
  ) or exists (
    select 1 from public.user_roles role
    where role.user_id = p_user_id and role.role <> 'participant'
  ) then
    raise exception 'Participant membership unavailable' using errcode = '42501';
  end if;
  select * into membership
  from private.company_participant_memberships
  where organisation_id = p_organisation_id and user_id = p_user_id
  for update;
  if not found then
    raise exception 'Participant membership unavailable' using errcode = '42501';
  end if;
  if membership.version <> p_expected_version then
    raise exception 'participant_membership_version_conflict' using errcode = '40001';
  end if;
  if membership.status <> 'removed' then
    update private.company_participant_memberships set
      status = 'removed', removed_at = clock_timestamp(), version = version + 1
    where organisation_id = p_organisation_id and user_id = p_user_id
    returning * into membership;
    update public.course_enrolments enrolment set
      status = 'removed', updated_at = clock_timestamp()
    from public.course_runs run
    where enrolment.course_run_id = run.id
      and run.organisation_id = p_organisation_id
      and enrolment.user_id = p_user_id and enrolment.status = 'enrolled';
  end if;
  result := jsonb_build_object(
    'status', 'removed', 'organisation_id', p_organisation_id,
    'user_id', p_user_id, 'version', membership.version
  );
  insert into private.company_participant_membership_commands(
    actor_id, request_id, organisation_id, user_id, command, result
  ) values (
    auth.uid(), p_request_id, p_organisation_id, p_user_id, 'remove', result
  );
  insert into public.audit_events(actor_id, action, resource_id, details)
  values (
    auth.uid(), 'company.participant_membership_removed', p_organisation_id,
    jsonb_build_object('user_id', p_user_id, 'version', membership.version)
  );
  return result;
end;
$$;

-- A participant accepts an invitation using their own active Auth session.
-- This grants one organization relationship, never a role or another company's access.
create or replace function private.accept_company_participant_invitation(
  p_organisation_id uuid, p_expected_version integer, p_request_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  membership private.company_participant_memberships%rowtype;
  previous private.company_participant_membership_commands%rowtype;
  result jsonb;
begin
  if not private.participant_actor() then
    raise exception 'Verified participant identity required' using errcode = '42501';
  end if;
  if p_organisation_id is null or p_expected_version is null or
     p_request_id is null then
    raise exception 'Valid participant acceptance required' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('participant-membership:' || auth.uid()::text, 0)
  );
  select * into previous
  from private.company_participant_membership_commands
  where actor_id = auth.uid() and request_id = p_request_id;
  if found then
    if previous.organisation_id <> p_organisation_id or
       previous.user_id <> auth.uid() or previous.command <> 'accept' then
      raise exception 'Participant acceptance request ID conflict' using errcode = '22023';
    end if;
    return previous.result;
  end if;
  perform private.lock_company_premium(p_organisation_id);
  select * into membership
  from private.company_participant_memberships
  where organisation_id = p_organisation_id and user_id = auth.uid()
  for update;
  if not found or membership.status <> 'pending' then
    raise exception 'Participant invitation is unavailable' using errcode = '42501';
  end if;
  if membership.version <> p_expected_version then
    raise exception 'participant_membership_version_conflict' using errcode = '40001';
  end if;
  if membership.invitation_id is not null and not exists (
    select 1 from public.invitation_requests invitation
    where invitation.id = membership.invitation_id
      and invitation.requested_role = 'participant'
      and invitation.organisation_id = p_organisation_id
      and invitation.status = 'sent'
      and invitation.created_at > now() - interval '14 days'
  ) then
    raise exception 'Participant invitation is unavailable' using errcode = '42501';
  end if;
  if membership.link_request_id is not null and not exists (
    select 1 from private.company_participant_link_requests request
    where request.id = membership.link_request_id
      and request.target_user_id = auth.uid()
      and request.status = 'pending'
      and request.expires_at > now()
  ) then
    raise exception 'Participant invitation is unavailable' using errcode = '42501';
  end if;
  update private.company_participant_memberships set
    status = 'active', joined_at = clock_timestamp(), removed_at = null,
    version = version + 1
  where organisation_id = p_organisation_id and user_id = auth.uid()
  returning * into membership;
  if membership.link_request_id is not null then
    update private.company_participant_link_requests
      set status = 'accepted'
    where id = membership.link_request_id;
  end if;
  result := jsonb_build_object(
    'status', 'accepted',
    'organisation_id', p_organisation_id,
    'version', membership.version
  );
  insert into private.company_participant_membership_commands(
    actor_id, request_id, organisation_id, user_id, command, result
  ) values (
    auth.uid(), p_request_id, p_organisation_id, auth.uid(), 'accept', result
  );
  insert into public.audit_events(actor_id, action, resource_id, details)
  values (
    auth.uid(), 'company.participant_link_accepted', p_organisation_id,
    jsonb_build_object('user_id', auth.uid(), 'version', membership.version)
  );
  return result;
end;
$$;

-- Removal ends this one company's course rights and preserves the global
-- participant account and all other company memberships/history.
create or replace function private.remove_company_participant(
  p_organisation_id uuid, p_user_id uuid,
  p_expected_version integer, p_request_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  membership private.company_participant_memberships%rowtype;
  previous private.company_participant_membership_commands%rowtype;
  result jsonb;
begin
  if not private.actor_active() or not (
    private.client_has_organisation(p_organisation_id) or
    private.has_permission('courses.manage')
  ) then
    raise exception 'Company participant management required' using errcode = '42501';
  end if;
  if p_user_id is null or p_expected_version is null or p_request_id is null then
    raise exception 'Valid participant removal required' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('participant-membership:' || p_user_id::text, 0)
  );
  select * into previous
  from private.company_participant_membership_commands
  where actor_id = auth.uid() and request_id = p_request_id;
  if found then
    if previous.organisation_id <> p_organisation_id or
       previous.user_id <> p_user_id or previous.command <> 'remove' then
      raise exception 'Participant removal request ID conflict' using errcode = '22023';
    end if;
    return previous.result;
  end if;
  perform private.lock_company_premium(p_organisation_id);
  if not exists (
    select 1 from public.user_roles role
    where role.user_id = p_user_id and role.role = 'participant'
  ) or exists (
    select 1 from public.user_roles role
    where role.user_id = p_user_id and role.role <> 'participant'
  ) then
    raise exception 'Participant membership unavailable' using errcode = '42501';
  end if;
  select * into membership
  from private.company_participant_memberships
  where organisation_id = p_organisation_id and user_id = p_user_id
  for update;
  if not found then
    raise exception 'Participant membership unavailable' using errcode = '42501';
  end if;
  if membership.version <> p_expected_version then
    raise exception 'participant_membership_version_conflict' using errcode = '40001';
  end if;
  if membership.status <> 'removed' then
    update private.company_participant_memberships set
      status = 'removed', removed_at = clock_timestamp(), version = version + 1
    where organisation_id = p_organisation_id and user_id = p_user_id
    returning * into membership;
    update public.course_enrolments enrolment set
      status = 'removed', updated_at = clock_timestamp()
    from public.course_runs run
    where enrolment.course_run_id = run.id and run.organisation_id = p_organisation_id
      and enrolment.user_id = p_user_id and enrolment.status = 'enrolled';
  end if;
  result := jsonb_build_object(
    'status', 'removed', 'organisation_id', p_organisation_id,
    'user_id', p_user_id, 'version', membership.version
  );
  insert into private.company_participant_membership_commands(
    actor_id, request_id, organisation_id, user_id, command, result
  ) values (
    auth.uid(), p_request_id, p_organisation_id, p_user_id, 'remove', result
  );
  insert into public.audit_events(actor_id, action, resource_id, details)
  values (
    auth.uid(), 'company.participant_membership_removed', p_organisation_id,
    jsonb_build_object('user_id', p_user_id, 'version', membership.version)
  );
  return result;
end;
$$;

-- Keep legacy completion and its role hierarchy intact. Only company learner
-- invites enter the new branch, and accepting the email grants no course access.
alter function private.complete_account_invitation(uuid, uuid, text, boolean)
  rename to complete_account_invitation_before_participants;
revoke all on function private.complete_account_invitation_before_participants(uuid, uuid, text, boolean)
  from public, anon, authenticated, service_role;
create function private.complete_account_invitation(
  p_invitation_id uuid, p_user_id uuid, p_display_name text, p_success boolean
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  request public.invitation_requests%rowtype;
  inviter_allowed boolean;
begin
  if coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true)::jsonb->>'role', '')
  ) is distinct from 'service_role' then
    raise exception 'Account invitation service required' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('portal-user-activation', 0)
  );
  select * into request
  from public.invitation_requests
  where id = p_invitation_id
  for update;
  if not found or request.status <> 'reserved' then
    raise exception 'Invitation reservation missing' using errcode = '22023';
  end if;
  if p_success is null then
    raise exception 'Invitation completion decision required' using errcode = '22023';
  end if;
  if request.requested_role <> 'participant' or request.organisation_id is null then
    perform private.complete_account_invitation_before_participants(
      p_invitation_id, p_user_id, p_display_name, p_success
    );
    return;
  end if;
  if p_success then
    if p_user_id is null or not exists (
      select 1 from auth.users where id = p_user_id and lower(email) = request.email
    ) or not exists (
      select 1 from public.profiles where id = p_user_id
    ) or exists (
      select 1 from public.user_roles where user_id = p_user_id and role <> 'participant'
    ) then
      raise exception 'Invited identity mismatch' using errcode = '22023';
    end if;
    perform private.lock_company_premium(request.organisation_id);
      select exists (
        select 1 from public.profiles profile
        where profile.id = request.actor_id and profile.active and (
          (exists (
            select 1 from public.user_roles role
            join public.client_organisation_memberships membership
              on membership.user_id = role.user_id
            where role.user_id = request.actor_id and role.role = 'client'
              and membership.organisation_id = request.organisation_id
              and membership.removed_at is null
          )) or exists (
            select 1 from public.user_roles role
            join public.role_permissions permission on permission.role = role.role
            where role.user_id = request.actor_id
              and permission.permission in ('courses.manage', 'organisations.manage')
          )
        )
      ) into inviter_allowed;
      if not inviter_allowed then
        raise exception 'Participant inviter authority revoked' using errcode = '42501';
      end if;

    update public.profiles set
      display_name = left(coalesce(nullif(request.display_name, ''), p_display_name, ''), 120)
    where id = p_user_id;
    insert into public.user_roles(user_id, role)
    values (p_user_id, request.requested_role)
    on conflict do nothing;
      insert into private.company_participant_memberships(
        organisation_id, user_id, status, invitation_id, invited_by, version
      ) values (
        request.organisation_id, p_user_id, 'pending', request.id,
        request.actor_id, 1
      ) on conflict (organisation_id, user_id) do update
        set status = 'pending', invitation_id = excluded.invitation_id,
          link_request_id = null, invited_by = excluded.invited_by,
          joined_at = null, removed_at = null,
          version = private.company_participant_memberships.version + 1
        where private.company_participant_memberships.status = 'removed';
  end if;
  update public.invitation_requests set
    status = case when p_success then 'sent' else 'failed' end,
    auth_user_id = p_user_id,
    completed_at = now()
  where id = request.id;
  insert into public.audit_events(actor_id, action, resource_id, details)
  values (
    request.actor_id,
    case when p_success then 'invitation.sent' else 'invitation.failed' end,
    request.id,
    jsonb_build_object('role', request.requested_role, 'organisation_id', request.organisation_id)
  );
end;
$$;



-- Only the authenticated Accounts Edge service may claim invitation content;
-- company callers never receive another account's email or Auth information.
create function private.company_participant_service_caller()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true)::jsonb->>'role', '')
  ) = 'service_role';
$$;
revoke all on function private.company_participant_service_caller()
  from public, anon, authenticated, service_role;

create function private.claim_company_participant_invitation(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  dispatch private.company_participant_invitation_dispatches%rowtype;
  invitation public.invitation_requests%rowtype;
begin
  if not private.company_participant_service_caller() then
    raise exception 'Invitation delivery service required' using errcode = '42501';
  end if;
  select * into dispatch
  from private.company_participant_invitation_dispatches
  where id = p_request_id
  for update;
  if not found or dispatch.status <> 'pending' or dispatch.invitation_id is null then
    return jsonb_build_object('deliver', false);
  end if;
  select * into invitation
  from public.invitation_requests
  where id = dispatch.invitation_id and status = 'reserved'
    and requested_role = 'participant'
    and organisation_id = dispatch.organisation_id
  for update;
  if not found then
    update private.company_participant_invitation_dispatches
      set status = 'failed' where id = dispatch.id;
    return jsonb_build_object('deliver', false);
  end if;
  update private.company_participant_invitation_dispatches
    set status = 'sending' where id = dispatch.id;
  return jsonb_build_object(
    'deliver', true,
    'request_id', dispatch.id,
    'invitation_id', invitation.id,
    'email', invitation.email,
    'display_name', invitation.display_name,
    'role', invitation.requested_role,
    'organisation_id', invitation.organisation_id,
    'idempotency_key', invitation.idempotency_key
  );
end;
$$;

create function private.finish_company_participant_invitation(
  p_request_id uuid, p_success boolean
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.company_participant_service_caller() then
    raise exception 'Invitation delivery service required' using errcode = '42501';
  end if;
  if p_success is null then
    raise exception 'Invitation delivery result required' using errcode = '22023';
  end if;
  update private.company_participant_invitation_dispatches
  set status = case when p_success then 'sent' else 'failed' end
  where id = p_request_id and status = 'sending';
  if not found then
    raise exception 'Invitation dispatch is not claimed' using errcode = '40001';
  end if;
end;
$$;


-- The public response always confirms receipt of the lookup request, never
-- whether a supplied User ID/email belongs to an account or has a privileged role.
create function private.reserve_company_participant_link(
  p_organisation_id uuid, p_luminovia_user_id text, p_request_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_user uuid;
  previous private.company_participant_link_requests%rowtype;
  request_id uuid;
  status_value text;
begin
  if not private.actor_active() or p_organisation_id is null or
     p_luminovia_user_id is null or length(trim(p_luminovia_user_id)) > 32 or
     p_request_id is null then
    raise exception 'Valid participant-link request required' using errcode = '22023';
  end if;
  if not (private.client_has_organisation(p_organisation_id) or
      private.has_permission('courses.manage')) then
    raise exception 'Company participant management required' using errcode = '42501';
  end if;
  perform private.lock_company_premium(p_organisation_id);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('participant-link:' || auth.uid()::text || ':' || p_organisation_id::text, 0)
  );
  select * into previous
  from private.company_participant_link_requests
  where requested_by = auth.uid() and request_id = p_request_id;
  if found then
    if previous.organisation_id <> p_organisation_id or
       previous.luminovia_user_id <> upper(trim(p_luminovia_user_id)) then
      raise exception 'Participant-link request ID conflict' using errcode = '40001';
    end if;
    return jsonb_build_object('status', 'request_submitted');
  end if;
  if (select count(*) from private.company_participant_link_requests request
      where request.requested_by = auth.uid()
        and request.created_at > now() - interval '1 hour') >= 10 then
    return jsonb_build_object('status', 'request_submitted');
  end if;
  select profile.id into target_user
  from public.profiles profile
  where profile.luminovia_user_id = upper(trim(p_luminovia_user_id))
    and profile.active
    and exists (
      select 1 from public.user_roles role
      where role.user_id = profile.id and role.role = 'participant'
    )
    and not exists (
      select 1 from public.user_roles role
      where role.user_id = profile.id and role.role <> 'participant'
    )
    and profile.id <> auth.uid();
  if target_user is null then
    status_value := 'unmatched';
  elsif exists (
    select 1 from private.company_participant_memberships membership
    where membership.organisation_id = p_organisation_id
      and membership.user_id = target_user and membership.status = 'active'
  ) then
    status_value := 'already_member';
  else
    status_value := 'pending';
  end if;
  insert into private.company_participant_link_requests(
    organisation_id, requested_by, request_id, luminovia_user_id,
    target_user_id, status, expires_at
  ) values (
    p_organisation_id, auth.uid(), p_request_id, upper(trim(p_luminovia_user_id)),
    case when status_value = 'pending' then target_user else null end,
    status_value, now() + interval '14 days'
  ) returning id into request_id;
  if status_value = 'pending' then
    insert into private.company_participant_memberships(
      organisation_id, user_id, status, link_request_id, invited_by,
      version
    ) values (
      p_organisation_id, target_user, 'pending', request_id, auth.uid(), 1
    ) on conflict (organisation_id, user_id) do update
      set status = 'pending', invitation_id = null, link_request_id = excluded.link_request_id,
        invited_by = excluded.invited_by, joined_at = null, removed_at = null,
        version = private.company_participant_memberships.version + 1
      where private.company_participant_memberships.status = 'removed';
  end if;
  return jsonb_build_object('status', 'request_submitted');
end;
$$;
-- The restrictive role fence allows only scoped course-chat rows for learners;
-- the underlying read policy still checks membership and personal hiding.
alter policy portal_members_only on public.chat_rooms
  using ((select private.actor_active()) or ((select private.participant_actor()) and private.can_access_chat_room(id)));
alter policy portal_members_only on public.messages
  using ((select private.actor_active()) or ((select private.participant_actor()) and private.can_access_chat_room(room_id)));

notify pgrst, 'reload schema';
commit;