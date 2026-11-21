begin;

-- Existing local principals keep their Auth identity and course memberships.
-- Only a dedicated current administrator may add or withdraw management.
create function private.academy_local_admin(p_actor uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select private.academy_administration_actor(p_actor) and exists (
    select 1 from public.user_roles account_role
    join public.role_permissions permission on permission.role = account_role.role
    where account_role.user_id = p_actor and account_role.role = 'admin'
      and permission.permission = 'courses.manage'
  );
$$;

create table private.academy_management_delegations (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  enabled boolean not null,
  version integer not null check (version > 0),
  updated_by uuid not null,
  updated_at timestamptz not null default clock_timestamp()
);
alter table private.academy_management_delegations enable row level security;
revoke all on private.academy_management_delegations from public, anon, authenticated, service_role;

create function private.academy_managed_role(p_user uuid)
returns text language sql stable security invoker set search_path = '' as $$
  select case roles.role_list
    when array['lecturer'] then 'lecturer'
    when array['participant'] then 'participant'
    when array['management'] then 'management'
    when array['lecturer','management'] then case when exists (
      select 1 from private.academy_management_delegations delegation
      where delegation.user_id = p_user and delegation.enabled
    ) then 'management' end
  end
  from (select array_agg(role order by role collate "C") as role_list
    from public.user_roles where user_id = p_user) roles;
$$;

create function private.academy_managed_member(
  p_actor uuid, p_user uuid, p_admin boolean, p_can_write boolean
)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
      'id', profile.id, 'display_name', profile.display_name, 'active', profile.active,
      'role', item.role, 'confirmed', identity.email_confirmed_at is not null,
      'management_delegated', coalesce(delegation.enabled, false),
      'management_version', coalesce(delegation.version, 0),
      'can_set_active', p_can_write and profile.id <> p_actor,
      'can_set_management', p_can_write and p_admin and profile.id <> p_actor and
        (coalesce(delegation.enabled, false) or
          (item.role = 'lecturer' and profile.active and identity.email_confirmed_at is not null))
    )
  from public.profiles profile
  join auth.users identity on identity.id = profile.id
  cross join lateral (select private.academy_managed_role(profile.id) as role) item
  left join private.academy_management_delegations delegation on delegation.user_id = profile.id
  where profile.id = p_user and item.role is not null and (item.role <> 'management' or p_admin);
$$;

create or replace function private.academy_administration()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  licence text := private.academy_course_access_status();
  admin boolean := private.academy_local_admin(actor);
begin
  if not coalesce(licence in ('active', 'grace'), false) then raise insufficient_privilege; end if;
  if not private.academy_administration_actor(actor) then return null; end if;
  return jsonb_build_object(
    'can_write', licence = 'active',
    'can_create_management', licence = 'active' and admin,
    'organisations', coalesce((
      select jsonb_agg(to_jsonb(organisation) order by organisation.name, organisation.id)
      from (
        select id, name, time_zone from public.organisations
        where archived_at is null order by name, id limit 200
      ) organisation
    ), '[]'::jsonb),
    'accounts', coalesce((
      select jsonb_agg(person.result order by person.display_name, person.id)
      from (
        select profile.id, profile.display_name, member.result
        from public.profiles profile
        cross join lateral (
          select private.academy_managed_member(actor, profile.id, admin, licence = 'active') as result
        ) member
        where member.result is not null
        order by profile.display_name, profile.id limit 200
      ) person
    ), '[]'::jsonb)
  );
end;
$$;

create function private.academy_set_member_active(p_user_id uuid, p_active boolean, p_expected_active boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  admin boolean;
  previous boolean;
  managed_role text;
begin
  if p_active is null or p_expected_active is null or p_user_id is null then
    raise invalid_parameter_value;
  end if;
  perform private.lock_academy_administration(actor);
  admin := private.academy_local_admin(actor);
  managed_role := private.academy_managed_role(p_user_id);
  if p_user_id = actor or managed_role is null or (managed_role = 'management' and not admin) then
    raise insufficient_privilege;
  end if;
  select active into previous from public.profiles where id = p_user_id for update;
  if not found then raise insufficient_privilege; end if;
  perform 1 from public.user_roles where user_id = p_user_id order by role for share;
  managed_role := private.academy_managed_role(p_user_id);
  if managed_role is null or (managed_role = 'management' and not admin) then raise insufficient_privilege; end if;
  if previous is distinct from p_active then
    if previous is distinct from p_expected_active then
      raise exception 'Account state changed' using errcode = 'PT409';
    end if;
    update public.profiles set active = p_active where id = p_user_id;
    insert into public.audit_events(actor_id, action, resource_id, details)
      values (actor, case when p_active then 'academy.account.reactivated' else 'academy.account.suspended' end,
        p_user_id, jsonb_build_object('previous_active', previous, 'active', p_active));
  end if;
  return private.academy_managed_member(actor, p_user_id, admin, true);
end;
$$;

create function private.academy_set_management(p_user_id uuid, p_enabled boolean, p_expected_version integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  previous private.academy_management_delegations%rowtype;
  roles text[];
  profile_active boolean;
begin
  if p_user_id is null or p_enabled is null or p_expected_version is null or p_expected_version < 0 then
    raise invalid_parameter_value;
  end if;
  perform private.lock_academy_administration(actor);
  if actor = p_user_id or not private.academy_local_admin(actor) then raise insufficient_privilege; end if;

  select active into profile_active from public.profiles where id = p_user_id for update;
  if not found then raise insufficient_privilege; end if;
  perform 1 from public.user_roles where user_id = p_user_id order by role for share;
  select array_agg(role order by role collate "C") into roles from public.user_roles where user_id = p_user_id;
  select * into previous from private.academy_management_delegations where user_id = p_user_id for update;
  if roles is distinct from (case when coalesce(previous.enabled, false)
      then array['lecturer','management'] else array['lecturer'] end) then
    raise insufficient_privilege;
  end if;
  if p_enabled and (not profile_active or not exists (
    select 1 from auth.users where id = p_user_id and email_confirmed_at is not null
  )) then raise insufficient_privilege; end if;
  if p_expected_version <> coalesce(previous.version, 0) then
    raise exception 'Management delegation changed' using errcode = 'PT409';
  end if;
  if p_enabled is distinct from coalesce(previous.enabled, false) then
    if p_enabled then
      insert into public.user_roles(user_id, role) values (p_user_id, 'management');
    else
      delete from public.user_roles where user_id = p_user_id and role = 'management';
    end if;
    insert into private.academy_management_delegations(user_id, enabled, version, updated_by)
      values (p_user_id, p_enabled, 1, actor)
    on conflict (user_id) do update set enabled = excluded.enabled,
      version = academy_management_delegations.version + 1, updated_by = excluded.updated_by, updated_at = clock_timestamp();
    insert into public.audit_events(actor_id, action, resource_id, details)
      values (actor, case when p_enabled then 'academy.management.delegated' else 'academy.management.revoked' end,
        p_user_id, jsonb_build_object('enabled', p_enabled));
  end if;
  return private.academy_managed_member(actor, p_user_id, true, true);
end;
$$;

create function public.academy_set_member_active(p_user_id uuid, p_active boolean, p_expected_active boolean)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.academy_set_member_active(p_user_id, p_active, p_expected_active);
$$;
create function public.academy_set_management(p_user_id uuid, p_enabled boolean, p_expected_version integer)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.academy_set_management(p_user_id, p_enabled, p_expected_version);
$$;

revoke all on function private.academy_local_admin(uuid), private.academy_managed_role(uuid),
  private.academy_managed_member(uuid,uuid,boolean,boolean),
  private.academy_set_member_active(uuid,boolean,boolean), public.academy_set_member_active(uuid,boolean,boolean),
  private.academy_set_management(uuid,boolean,integer), public.academy_set_management(uuid,boolean,integer)
  from public, anon, authenticated, service_role;
grant execute on function private.academy_set_member_active(uuid,boolean,boolean), public.academy_set_member_active(uuid,boolean,boolean),
  private.academy_set_management(uuid,boolean,integer), public.academy_set_management(uuid,boolean,integer) to authenticated;

alter table private.academy_account_requests drop constraint academy_account_requests_role_check;
alter table private.academy_account_requests add constraint academy_account_requests_role_check
  check (role in ('lecturer','participant','management'));

-- Add the protected role to the existing durable creation saga. Both the
-- caller reservation and the service's final commit verify current admin.
do $$
declare
  reserve_definition text := pg_catalog.pg_get_functiondef('private.reserve_academy_account(uuid,text,text,text,uuid,text)'::regprocedure);
  finish_definition text := pg_catalog.pg_get_functiondef('private.finish_academy_account(uuid,uuid,text)'::regprocedure);
  gate_definition text := pg_catalog.pg_get_functiondef('private.require_academy_course_access()'::regprocedure);
  role_anchor constant text := 'p_role not in (''lecturer'', ''participant'')';
  reserve_anchor constant text := '  perform private.lock_academy_administration(actor);';
  finish_anchor constant text := '    perform private.lock_academy_administration(request.actor_id);';
  gate_anchor constant text := '''/rpc/academy_create_organisation'', ''/rpc/reserve_academy_account'',';
begin
  if cardinality(string_to_array(reserve_definition, role_anchor)) <> 2
     or cardinality(string_to_array(reserve_definition, reserve_anchor)) <> 2
     or cardinality(string_to_array(finish_definition, finish_anchor)) <> 2
     or cardinality(string_to_array(gate_definition, gate_anchor)) <> 2 then
    raise exception 'Expected one academy management policy anchor in each owning function';
  end if;
  reserve_definition := replace(reserve_definition, role_anchor, 'p_role not in (''lecturer'', ''participant'', ''management'')');
  execute replace(reserve_definition, reserve_anchor, reserve_anchor || chr(10) ||
    '  if p_role = ''management'' and not private.academy_local_admin(actor) then raise insufficient_privilege; end if;');
  execute replace(finish_definition, finish_anchor, finish_anchor || chr(10) ||
    '    if request.role = ''management'' and not private.academy_local_admin(request.actor_id) then raise insufficient_privilege; end if;');
  execute replace(gate_definition, gate_anchor, gate_anchor || chr(10) ||
    '      ''/rpc/academy_set_member_active'', ''/rpc/academy_set_management'',');
end;
$$;

notify pgrst, 'reload schema';
commit;
