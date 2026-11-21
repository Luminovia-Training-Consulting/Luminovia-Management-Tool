begin;

-- Additional roles do not replace an individually scoped company relationship.
-- Keep the live account role, own membership and current organisation checks.
create or replace function private.client_has_organisation(p_organisation_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.has_role(array['client']) and exists (
    select 1 from public.client_organisation_memberships membership
    join public.organisations org on org.id = membership.organisation_id
    where membership.user_id = auth.uid() and membership.organisation_id = p_organisation_id
      and membership.removed_at is null and org.archived_at is null
  );
$$;

create or replace function private.active_company_participant(p_user_id uuid, p_organisation_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles profile
    join public.user_roles account_role on account_role.user_id = profile.id and account_role.role = 'participant'
    join private.company_participant_memberships membership on membership.user_id = profile.id
    where profile.id = p_user_id and profile.active
      and membership.organisation_id = p_organisation_id and membership.status = 'active'
  );
$$;

-- An existing allocation is retained for history after role withdrawal. The
-- scanner and learner-facing resources still require the current teaching role.
create or replace function private.academy_course_teacher(p_course_id uuid, p_teacher_id uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select private.lecturer_user(p_teacher_id) and exists (
    select 1 from private.academy_course_instructors assignment
    join public.job_claims claim on claim.id = assignment.claim_id
    join public.jobs job on job.id = claim.job_id
    where job.course_run_id = p_course_id and claim.lecturer_id = p_teacher_id
      and claim.status = 'confirmed' and assignment.course_id = p_course_id
      and assignment.instructor_id = p_teacher_id and assignment.released_at is null
  );
$$;

-- Lock any matching learner membership before the owning authorization check.
-- A mixed account may instead qualify as the teacher or a course manager.
do $migration$
declare
  chat text := pg_get_functiondef('private.lock_academy_course_chat_actor(uuid,uuid)'::regprocedure);
  action text := pg_get_functiondef('private.academy_learning_action(uuid,text,jsonb,integer)'::regprocedure);
  chat_anchor constant text := $was$  if exists (select 1 from public.user_roles where user_id = p_actor_id and role = 'participant')
    and not exists (select 1 from public.user_roles where user_id = p_actor_id and role <> 'participant') then
    perform 1 from private.company_participant_memberships
    where organisation_id = company_id and user_id = p_actor_id and status = 'active' for share;
    if not found then raise insufficient_privilege; end if;
    perform 1 from public.course_enrolments
    where course_run_id = course_id and user_id = p_actor_id and status in ('enrolled', 'completed') for share;
    if not found then raise insufficient_privilege; end if;
  end if;$was$;
  action_anchor constant text := $was$  if private.participant_actor() then
    perform 1 from private.company_participant_memberships
    where organisation_id = company_id and user_id = actor_id and status = 'active' for share;
    if not found then raise insufficient_privilege; end if;
    perform 1 from public.course_enrolments
    where course_run_id = p_run_id and user_id = actor_id and status in ('enrolled','completed') for share;
    if not found then raise insufficient_privilege; end if;
  else
    perform 1 from public.client_organisation_memberships
    where organisation_id = company_id and user_id = actor_id for share;
  end if;$was$;
begin
  if cardinality(string_to_array(chat, chat_anchor)) <> 2
    or cardinality(string_to_array(action, action_anchor)) <> 2 then
    raise exception 'Expected dedicated classroom authority locks';
  end if;
  execute replace(chat, chat_anchor, $lock$  if exists (select 1 from public.user_roles where user_id = p_actor_id and role = 'participant') then
    perform 1 from private.company_participant_memberships
    where organisation_id = company_id and user_id = p_actor_id and status = 'active' for share;
    if found then
      perform 1 from public.course_enrolments
      where course_run_id = course_id and user_id = p_actor_id and status in ('enrolled', 'completed') for share;
    end if;
  end if;$lock$);
  execute replace(action, action_anchor, $lock$  if exists (select 1 from public.user_roles where user_id = actor_id and role = 'participant') then
    perform 1 from private.company_participant_memberships
    where organisation_id = company_id and user_id = actor_id and status = 'active' for share;
    if found then
      perform 1 from public.course_enrolments
      where course_run_id = p_run_id and user_id = actor_id and status in ('enrolled','completed') for share;
    end if;
  end if;
  perform 1 from public.client_organisation_memberships
  where organisation_id = company_id and user_id = actor_id and removed_at is null for share;$lock$);
end;
$migration$;

-- Retain the scalar role in the existing administration contract. A primary
-- client or management projection keeps these accounts admin-managed even
-- when they also carry ordinary roles. Other privileged roles remain outside
-- this directory. No change to the DTO or previous clients' action paths.
create or replace function private.academy_managed_role(p_user uuid)
returns text language sql stable security invoker set search_path = '' as $$
  select role
  from public.user_roles
  where user_id = p_user and not exists (
    select 1 from public.user_roles outside_directory
    where outside_directory.user_id = p_user
      and outside_directory.role not in ('management', 'client', 'lecturer', 'participant')
  )
  order by array_position(array['management', 'client', 'lecturer', 'participant'], role)
  limit 1;
$$;

-- The detailed editor reads one account by ID. Scoped relationships are
-- projected per company. Unscoped legacy rows remain visible for replacement.
create function private.academy_member_roles(p_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  assignments jsonb;
  can_grant boolean;
  licence text := private.academy_course_access_status();
begin
  if not coalesce(licence in ('active', 'grace'), false)
    or not private.actor_active() or not private.academy_local_admin(auth.uid())
    or p_user_id = auth.uid() or private.academy_managed_role(p_user_id) is null then
    raise insufficient_privilege;
  end if;

  select jsonb_agg(jsonb_build_object('role', account_role.role,
    'organisation_id', company.id, 'organisation_name', company.name)
    order by account_role.role, company.name, company.id) into assignments
  from public.user_roles account_role
  left join lateral (
    select org.id, org.name from public.client_organisation_memberships membership
    join public.organisations org on org.id = membership.organisation_id
    where account_role.role = 'client' and membership.user_id = p_user_id and membership.removed_at is null
    union all
    select org.id, org.name from private.company_participant_memberships membership
    join public.organisations org on org.id = membership.organisation_id
    where account_role.role = 'participant' and membership.user_id = p_user_id and membership.status = 'active'
  ) company on true
  where account_role.user_id = p_user_id;

  select profile.active and identity.email_confirmed_at is not null into strict can_grant
  from public.profiles profile join auth.users identity on identity.id = profile.id
  where profile.id = p_user_id;

  return jsonb_build_object('roles', assignments, 'revision', md5(assignments::text),
    'can_write', licence = 'active', 'can_grant', licence = 'active' and can_grant);
end;
$$;

-- Serialize account changes with activation and new seat reservations. Change
-- one reviewed assignment at a time so unrelated roles and scopes are retained.
create function private.academy_set_member_role(
  p_user_id uuid, p_role text, p_organisation_id uuid, p_enabled boolean, p_expected_revision text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  previous jsonb;
  existing boolean;
  link_id uuid;
  scope_remains boolean;
begin
  if p_user_id is null or p_role is null or p_role not in ('management', 'client', 'lecturer', 'participant')
    or p_enabled is null or p_expected_revision is null or p_expected_revision !~ '^[0-9a-f]{32}$'
    or (p_organisation_id is not null and p_role not in ('client', 'participant'))
    or (p_enabled and p_role in ('client', 'participant') and p_organisation_id is null) then
    raise invalid_parameter_value;
  end if;
  perform private.lock_academy_seat_administration(actor);
  if not private.actor_active() or not private.academy_local_admin(actor) or actor = p_user_id then
    raise insufficient_privilege;
  end if;
  -- Company invitations acquire the seat lock before the organisation lock.
  -- Use the same order and keep scope fixed until membership updates finish.
  if p_organisation_id is not null then
    perform 1 from public.organisations where id = p_organisation_id
      and (not p_enabled or archived_at is null) for share;
    if not found then raise insufficient_privilege; end if;
  end if;
  perform 1 from public.profiles where id = p_user_id for update;
  if not found then raise insufficient_privilege; end if;
  perform 1 from public.user_roles where user_id = p_user_id order by role for update;
  previous := private.academy_member_roles(p_user_id);
  if p_expected_revision is distinct from previous->>'revision' then
    raise exception 'Academy role assignments changed' using errcode = 'PT409';
  end if;
  select exists (select 1 from jsonb_array_elements(previous->'roles') assignment
    where assignment->>'role' = p_role
      and (assignment->>'organisation_id')::uuid is not distinct from p_organisation_id) into existing;
  if existing = p_enabled then return previous; end if;
  if p_enabled and (previous->>'can_grant')::boolean is not true then raise insufficient_privilege; end if;
  if not p_enabled and jsonb_array_length(previous->'roles') <= 1 then
    raise exception 'An academy account must retain a role' using errcode = 'PT409';
  end if;

  if p_enabled then
    insert into public.user_roles(user_id, role) values (p_user_id, p_role) on conflict do nothing;
    if p_role = 'client' then
      insert into public.client_organisation_memberships(user_id, organisation_id) values (p_user_id, p_organisation_id)
      on conflict (user_id, organisation_id) do update set removed_at = null;
    elsif p_role = 'participant' then
      -- Explicit local administration membership uses the established account
      -- provisioning provenance and leaves individual course enrolments empty.
      insert into private.company_participant_link_requests(
        organisation_id, requested_by, request_id, luminovia_user_id, target_user_id, status, expires_at
      ) select p_organisation_id, actor, gen_random_uuid(), luminovia_user_id, id, 'accepted', now() + interval '7 days'
        from public.profiles where id = p_user_id returning id into link_id;
      insert into private.company_participant_memberships(organisation_id, user_id, status, link_request_id, invited_by, joined_at)
      values (p_organisation_id, p_user_id, 'active', link_id, actor, now())
      on conflict (organisation_id, user_id) do update
        set status = 'active', invitation_id = null, link_request_id = excluded.link_request_id,
          invited_by = actor, joined_at = excluded.joined_at, removed_at = null,
          version = company_participant_memberships.version + 1;
    elsif p_role = 'management' and exists (
      select 1 from public.user_roles where user_id = p_user_id and role = 'lecturer'
    ) then
      insert into private.academy_management_delegations(user_id, enabled, version, updated_by)
      values (p_user_id, true, 1, actor)
      on conflict (user_id) do update set enabled = true, version = academy_management_delegations.version + 1,
        updated_by = actor, updated_at = clock_timestamp();
    end if;
  else
    if p_role = 'client' and p_organisation_id is not null then
      update public.client_organisation_memberships set removed_at = clock_timestamp()
      where user_id = p_user_id and organisation_id = p_organisation_id and removed_at is null;
    elsif p_role = 'participant' and p_organisation_id is not null then
      update private.company_participant_memberships
      set status = 'removed', removed_at = clock_timestamp(), version = version + 1
      where user_id = p_user_id and organisation_id = p_organisation_id and status = 'active';
      -- Match ordinary participant removal and retain completed-course history.
      update public.course_enrolments enrolment set status = 'removed', updated_at = clock_timestamp()
      from public.course_runs run where enrolment.course_run_id = run.id and run.organisation_id = p_organisation_id
        and enrolment.user_id = p_user_id and enrolment.status = 'enrolled';
    end if;
    select exists (select 1 from jsonb_array_elements(previous->'roles') assignment
      where assignment->>'role' = p_role
        and (assignment->>'organisation_id')::uuid is distinct from p_organisation_id) into scope_remains;
    if not scope_remains then
      delete from public.user_roles where user_id = p_user_id and role = p_role;
      if p_role in ('lecturer', 'management') then
        update private.academy_management_delegations set enabled = false, version = version + 1,
          updated_by = actor, updated_at = clock_timestamp() where user_id = p_user_id and enabled;
      end if;
    end if;
  end if;
  insert into public.audit_events(actor_id, action, resource_id, details)
  values (actor, 'academy.account.role_changed', p_user_id,
    jsonb_build_object('role', p_role, 'organisation_id', p_organisation_id, 'enabled', p_enabled));
  return private.academy_member_roles(p_user_id);
end;
$$;

create function public.academy_member_roles(p_user_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.academy_member_roles(p_user_id);
$$;

create function public.academy_set_member_role(
  p_user_id uuid, p_role text, p_organisation_id uuid, p_enabled boolean, p_expected_revision text
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.academy_set_member_role(p_user_id, p_role, p_organisation_id, p_enabled, p_expected_revision);
$$;

revoke all on function private.academy_member_roles(uuid), public.academy_member_roles(uuid),
  private.academy_set_member_role(uuid,text,uuid,boolean,text), public.academy_set_member_role(uuid,text,uuid,boolean,text)
from public, anon, authenticated, service_role;
grant execute on function private.academy_member_roles(uuid), public.academy_member_roles(uuid),
  private.academy_set_member_role(uuid,text,uuid,boolean,text), public.academy_set_member_role(uuid,text,uuid,boolean,text)
to authenticated;

do $migration$
declare
  source text := pg_get_functiondef('private.require_academy_course_access()'::regprocedure);
  read_anchor constant text := '''/rpc/academy_administration'',';
  write_anchor constant text := '''/rpc/academy_set_member_active'',';
  legacy_member text := pg_get_functiondef('private.academy_managed_member(uuid,uuid,boolean,boolean)'::regprocedure);
  legacy_anchor constant text := '''can_set_management'', p_can_write and p_admin and profile.id <> p_actor and';
begin
  if cardinality(string_to_array(source, read_anchor)) <> 2
    or cardinality(string_to_array(source, write_anchor)) <> 2
    or cardinality(string_to_array(legacy_member, legacy_anchor)) <> 2 then
    raise exception 'Expected academy directory API anchors';
  end if;
  source := replace(source, read_anchor, read_anchor || ' ''/rpc/academy_member_roles'',');
  execute replace(source, write_anchor, write_anchor || ' ''/rpc/academy_set_member_role'',');
  -- The old quick action calls the unchanged single-lecturer delegation RPC.
  -- Other combinations use the new editor instead of a failing legacy write.
  execute replace(legacy_member, legacy_anchor, legacy_anchor || $check$
        (select array_agg(account_role.role order by account_role.role collate "C")
          from public.user_roles account_role where account_role.user_id = profile.id)
          = case when coalesce(delegation.enabled, false) then array['lecturer', 'management'] else array['lecturer'] end and$check$);
end;
$migration$;

notify pgrst, 'reload schema';
commit;
