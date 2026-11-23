begin;

-- Internal account and company management does not require access to gross
-- compensation. Keep the existing authority in other editions.
create function private.can_manage_account_client_memberships()
returns boolean language sql stable security definer set search_path = '' as $$
  select private.has_permission('finance.gross.read') or (
    (select edition from private.installation_identity) = 'internal'
    and private.has_permission('users.roles.manage')
    and private.has_permission('organisations.manage')
  );
$$;
revoke all on function private.can_manage_account_client_memberships() from public, anon, authenticated, service_role;

-- Called only after the owning operation has checked actor and target
-- authority and acquired the shared account authority lock.
create function private.write_account_client_membership(p_user_id uuid, p_organisation_id uuid, p_remove boolean)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('client-membership:' || p_user_id::text, 0));
  perform 1 from public.organisations
    where id = p_organisation_id and (p_remove or archived_at is null)
    for share;
  if not found then raise exception 'Active client and valid organisation required' using errcode = '22023'; end if;
  insert into public.client_organisation_memberships(user_id, organisation_id, removed_at)
    values(p_user_id, p_organisation_id, case when p_remove then clock_timestamp() end)
    on conflict(user_id, organisation_id) do update set removed_at = excluded.removed_at;
  insert into public.audit_events(actor_id, action, resource_id, details)
    values(auth.uid(), case when p_remove then 'client.membership_removed' else 'client.membership_added' end,
      p_user_id, jsonb_build_object('organisation_id', p_organisation_id));
end;
$$;
revoke all on function private.write_account_client_membership(uuid,uuid,boolean) from public, anon, authenticated, service_role;

-- Check roles and optional company binding together before mutating either,
-- including when the actor is removing their own administrative authority.
create function private.apply_account_roles(p_user_id uuid, p_roles text[], p_organisation_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  before_roles text[];
  normalized text[];
  target_active boolean;
  own_account boolean := p_user_id = auth.uid();
  internal_portal boolean;
  own_editable constant text[] := array['admin','management','lecturer','participant','client'];
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('portal-user-activation', 0));
  if not private.has_permission('users.roles.manage') then
    raise exception 'Role assignment permission required' using errcode = '42501';
  end if;
  if p_roles is null or cardinality(p_roles) not between 1 and 8
     or array_position(p_roles, null) is not null
     or exists(select 1 from unnest(p_roles) as requested(role)
       where role not in ('owner','admin','management','senior_lecturer','lecturer','client','participant','guest')) then
    raise exception 'Invalid roles' using errcode = '22023';
  end if;
  if not own_account and (
    not private.account_role_target_manageable(p_user_id)
    or exists(select 1 from unnest(p_roles) as requested(role)
      where not private.account_assignable_role(role, auth.uid()))
  ) then
    raise exception 'Only subordinate accounts and roles may be assigned' using errcode = '42501';
  end if;
  select array_agg(distinct role order by role) into normalized from unnest(p_roles) as requested(role);
  select active into target_active from public.profiles where id = p_user_id for update;
  if not found then raise exception 'Account not found' using errcode = '22023'; end if;
  select coalesce(array_agg(role order by role), '{}'::text[]) into before_roles
    from public.user_roles where user_id = p_user_id;
  internal_portal := coalesce((select edition = 'internal' from private.installation_identity), false);
  if own_account then
    if not internal_portal or not (before_roles && array['admin','owner'])
       or (select array_agg(role order by role) from unnest(before_roles) as prior(role) where role <> all(own_editable))
          is distinct from
          (select array_agg(role order by role) from unnest(normalized) as proposed(role) where role <> all(own_editable)) then
      raise exception 'Self administrative role changes denied' using errcode = '42501';
    end if;
    if 'lecturer' = any(before_roles) and not (normalized && array['lecturer','senior_lecturer'])
       and exists (
         select 1 from public.job_claims claim
         join public.assignment_sessions slot on slot.claim_id = claim.id
         where claim.lecturer_id = p_user_id and claim.status = 'confirmed'
           and slot.released_at is null and slot.ends_at > clock_timestamp()
       ) then
      raise exception 'Complete or transfer active teaching assignments first' using errcode = '22023';
    end if;
  end if;
  if before_roles && array['admin','owner'] and not normalized && array['admin','owner']
     and not exists (
       select 1 from public.user_roles role
       join public.profiles profile on profile.id = role.user_id
       where role.role in ('admin','owner') and profile.active and profile.id <> p_user_id
     ) then
    raise exception 'Last active administrator protected' using errcode = '22023';
  end if;
  if p_organisation_id is not null then
    if not ('client' = any(normalized)) or not target_active then
      raise exception 'Active client and valid organisation required' using errcode = '22023';
    end if;
    if not private.can_manage_account_client_memberships()
       or (not own_account and not private.account_target_manageable(p_user_id)) then
      raise exception 'Client membership management required' using errcode = '42501';
    end if;
    perform private.write_account_client_membership(p_user_id, p_organisation_id, false);
  elsif internal_portal and 'client' = any(normalized) and not ('client' = any(before_roles)) then
    perform 1 from public.client_organisation_memberships membership
      join public.organisations organisation on organisation.id = membership.organisation_id
      where membership.user_id = p_user_id and membership.removed_at is null and organisation.archived_at is null
      for share of membership, organisation;
    if not found then raise exception 'Client organisation required' using errcode = '22023'; end if;
  end if;

  delete from public.user_roles where user_id = p_user_id and not role = any(normalized);
  insert into public.user_roles(user_id, role)
    select p_user_id, role from unnest(normalized) as requested(role) on conflict do nothing;
  if before_roles is distinct from normalized then
    insert into public.audit_events(actor_id, action, resource_id, details)
      values(auth.uid(), 'account.roles_changed', p_user_id, jsonb_build_object('before', before_roles, 'after', normalized));
  end if;
  return jsonb_build_object('id', p_user_id, 'roles', to_jsonb(normalized));
end;
$$;
revoke all on function private.apply_account_roles(uuid,text[],uuid) from public, anon, authenticated, service_role;

create or replace function private.set_account_roles(p_user_id uuid, p_roles text[])
returns jsonb language sql security definer set search_path = '' as $$
  select private.apply_account_roles(p_user_id, p_roles, null);
$$;

create or replace function private.set_account_roles_with_organisation(p_user_id uuid, p_roles text[], p_organisation_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_organisation_id is null then raise exception 'Client organisation required' using errcode = '22023'; end if;
  perform private.apply_account_roles(p_user_id, p_roles, p_organisation_id);
end;
$$;

create or replace function private.manage_client_organisation(p_user_id uuid, p_organisation_id uuid, p_remove boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('portal-user-activation', 0));
  if not private.can_manage_account_client_memberships() then
    raise exception 'Client membership management required' using errcode = '42501';
  end if;
  if not private.account_target_manageable(p_user_id) and not (
    p_user_id = auth.uid() and (select edition from private.installation_identity) = 'internal'
      and private.has_role(array['owner','admin'])
  ) then
    raise exception 'Only subordinate client memberships may be changed' using errcode = '42501';
  end if;
  if p_remove is null or (not p_remove and not exists(
    select 1 from public.profiles profile join public.user_roles role on role.user_id = profile.id
    where profile.id = p_user_id and profile.active and role.role = 'client'
  )) then
    raise exception 'Active client and valid organisation required' using errcode = '22023';
  end if;
  perform private.write_account_client_membership(p_user_id, p_organisation_id, p_remove);
end;
$$;

do $migration$
declare
  definition text := pg_get_functiondef('private.commission_access()'::regprocedure);
  anchor constant text := $old$'can_manage_client_memberships', private.has_permission('finance.gross.read')$old$;
begin
  if cardinality(string_to_array(definition, anchor)) <> 2 then
    raise exception 'Expected one account membership capability';
  end if;
  execute replace(definition, anchor, $new$'can_manage_client_memberships', private.can_manage_account_client_memberships()$new$);
end;
$migration$;

commit;
