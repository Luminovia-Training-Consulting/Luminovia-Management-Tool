begin;

create table private.privileged_authenticator_policy (
  singleton boolean primary key default true check (singleton),
  mode text not null default 'disabled' check (mode in ('disabled', 'enrolment', 'required'))
);
alter table private.privileged_authenticator_policy enable row level security;
revoke all on private.privileged_authenticator_policy from public, anon, authenticated, service_role;
insert into private.privileged_authenticator_policy default values;

create function private.has_verified_portal_authenticator(p_actor uuid)
returns boolean language plpgsql stable security invoker set search_path = '' as $$
begin
  -- Some isolated SQL fixtures run without the native Auth schema.
  if to_regclass('auth.mfa_factors') is null then return false; end if;
  return exists (
    select 1 from auth.mfa_factors
    where user_id = p_actor and factor_type = 'totp' and status = 'verified'
  );
end;
$$;

create function private.own_privileged_authenticator_required()
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  policy_mode text;
  claims jsonb;
  session_claim text;
begin
  select mode into strict policy_mode from private.privileged_authenticator_policy where singleton;
  if policy_mode = 'disabled' or not exists (
    select 1 from public.profiles profile join public.user_roles membership on membership.user_id = profile.id
    where profile.id = actor_id and profile.active and membership.role in ('admin', 'owner')
  ) then
    return false;
  end if;
  if policy_mode = 'enrolment' and not private.has_verified_portal_authenticator(actor_id) then
    return false;
  end if;

  claims := auth.jwt();
  session_claim := claims->>'session_id';
  if claims->>'aal' is distinct from 'aal2' or session_claim is null
    or session_claim !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    or to_regclass('auth.sessions') is null or to_regclass('auth.mfa_factors') is null then
    return true;
  end if;

  -- Supabase Auth binds the TOTP proof to this precise native session. Check
  -- current state as well as the JWT so an old token cannot outlive revocation.
  return not exists (
    select 1 from auth.sessions session
    join auth.mfa_factors factor on factor.id = session.factor_id and factor.user_id = session.user_id
    where session.id = session_claim::uuid and session.user_id = actor_id and session.aal = 'aal2'
      and (session.not_after is null or session.not_after > statement_timestamp())
      and factor.factor_type = 'totp' and factor.status = 'verified'
  );
end;
$$;

create function private.own_authenticator_settings_available()
returns boolean language sql stable security definer set search_path = '' as $$
  select (select mode from private.privileged_authenticator_policy where singleton) in ('enrolment', 'required')
    and private.actor_active()
    and exists (select 1 from public.user_roles where user_id = auth.uid() and role in ('owner', 'admin'))
    and case when (select edition from private.installation_identity where singleton) = 'internal' then true
      else coalesce(private.academy_course_access_status() = 'active', false) end;
$$;

create function public.authenticator_settings_available()
returns boolean language sql stable security invoker set search_path = '' as $$
  select private.own_authenticator_settings_available();
$$;

-- Only the installation's PostgreSQL operator can change this policy. Stage
-- pairing first, then require it when each active privileged user is ready.
create function private.set_authenticator_policy(p_mode text)
returns text language plpgsql security invoker set search_path = '' as $$
begin
  if p_mode is null or p_mode not in ('disabled', 'enrolment', 'required') then
    raise invalid_parameter_value;
  end if;

  lock table public.user_roles in share row exclusive mode;
  if p_mode = 'required' and (
    not exists (
      select 1 from public.user_roles role join public.profiles profile on profile.id = role.user_id
      where role.role in ('owner', 'admin') and profile.active
    ) or exists (
      select 1 from public.user_roles role join public.profiles profile on profile.id = role.user_id
      where role.role in ('owner', 'admin') and profile.active
        and not private.has_verified_portal_authenticator(role.user_id)
    )
  ) then
    raise exception 'All active administrators and owners must pair an authenticator before enforcement'
      using errcode = '55000';
  end if;

  update private.privileged_authenticator_policy set mode = p_mode where singleton;
  return p_mode;
end;
$$;

-- A later role grant must not create a new unpaired privileged account while
-- enforcement is required. The operator can reopen staged enrolment for grants.
create function private.check_privileged_authenticator_role_grant()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  policy_mode text;
begin
  if tg_op = 'UPDATE' then
    if (old.user_id, old.role) is not distinct from (new.user_id, new.role) then return new; end if;
  end if;
  -- Recheck the policy row under a lock so a transaction using a stale
  -- repeatable-read snapshot cannot grant a role just after activation.
  select mode into strict policy_mode from private.privileged_authenticator_policy where singleton for share;
  if policy_mode = 'required' and not private.has_verified_portal_authenticator(new.user_id) then
    raise exception 'Pair an authenticator before granting administrative access' using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger portal_check_privileged_authenticator_role_grant
before insert or update of user_id, role on public.user_roles
for each row when (new.role in ('owner', 'admin'))
execute function private.check_privileged_authenticator_role_grant();

revoke all on function private.has_verified_portal_authenticator(uuid),
  private.own_privileged_authenticator_required(), private.own_authenticator_settings_available(),
  public.authenticator_settings_available(), private.set_authenticator_policy(text),
  private.check_privileged_authenticator_role_grant()
  from public, anon, authenticated, service_role;
grant execute on function private.own_privileged_authenticator_required(), private.own_authenticator_settings_available(),
  public.authenticator_settings_available() to authenticated;

do $migration$
declare
  routine regprocedure;
  source text;
  anchor constant text := ' select not private.own_password_setup_required() and (';
  password_branch constant text := $before$    if private.own_password_setup_required() then
      raise exception 'Personal password setup required' using errcode = 'PT428';
    end if;$before$;
  dedicated_read_anchor constant text := '''/rpc/course_workspace'', ''/rpc/academy_administration'',';
begin
  foreach routine in array array['private.actor_active()'::regprocedure,
    'private.guest_actor()'::regprocedure, 'private.participant_actor()'::regprocedure]
  loop
    source := pg_get_functiondef(routine);
    if cardinality(string_to_array(source, anchor)) <> 2 then
      raise exception 'Expected current identity predicate %', routine;
    end if;
    execute replace(source, anchor, ' select not private.own_password_setup_required() and not private.own_privileged_authenticator_required() and (');
  end loop;

  source := pg_get_functiondef('public.require_portal_access()'::regprocedure);
  if cardinality(string_to_array(source, password_branch)) <> 2 then
    raise exception 'Expected first password gate before authenticator enforcement';
  end if;
  execute replace(source, password_branch, password_branch || $extra$
    if private.own_privileged_authenticator_required() then
      raise exception 'Authenticator verification required' using errcode = 'PT412';
    end if;$extra$);

  source := pg_get_functiondef('private.require_academy_course_access()'::regprocedure);
  if cardinality(string_to_array(source, dedicated_read_anchor)) <> 2 then
    raise exception 'Expected dedicated settings read gate';
  end if;
  execute replace(source, dedicated_read_anchor,
    dedicated_read_anchor || ' ''/rpc/authenticator_settings_available'',');
end;
$migration$;

notify pgrst, 'reload schema';
commit;
