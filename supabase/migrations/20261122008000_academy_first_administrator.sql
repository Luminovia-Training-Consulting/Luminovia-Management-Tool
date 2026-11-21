begin;

-- Retain one bootstrap receipt per dedicated installation, even if the
-- original administrator later leaves or is removed from the directory.
create table private.academy_first_administrator (
  installation_id uuid primary key references private.installation_identity(installation_id),
  administrator_id uuid not null,
  release_commit text not null check (release_commit ~ '^[0-9a-f]{40}$'),
  created_at timestamptz not null default statement_timestamp()
);
alter table private.academy_first_administrator enable row level security;
revoke all on private.academy_first_administrator from public, anon, authenticated, service_role;

-- The offline operator promotes an exact existing Auth identity after
-- trusted signature verification. Auth owns account creation and password
-- management. Neither app admins nor a service JWT may call this function.
create function private.bootstrap_academy_first_administrator(
  p_installation_id uuid, p_release_commit text, p_administrator_id uuid
)
returns uuid
language plpgsql security invoker set search_path = '' set lock_timeout = '5s'
as $$
declare
  pinned private.installation_identity%rowtype;
  previous_id uuid;
begin
  if p_installation_id is null or p_administrator_id is null or
     coalesce(p_release_commit, '') !~ '^[0-9a-f]{40}$' then
    raise exception 'Invalid first administrator binding' using errcode = '22023';
  end if;

  -- Identity, verified terms and the receipt serialize under the same lock.
  -- Check the target before acquiring any account-table locks.
  select * into strict pinned from private.installation_identity where singleton for update;
  if pinned.edition = 'internal' or pinned.installation_id <> p_installation_id or not exists (
    select 1 from private.installation_verified_licence licence
    where licence.installation_id = p_installation_id
      and licence.terms->>'release_commit' = p_release_commit
      and licence.starts_at <= statement_timestamp()
      and licence.expires_at > statement_timestamp()
  ) then
    raise exception 'First administrator requires the dedicated active release' using errcode = '55000';
  end if;

  -- Serialize against account deletion, suspension and ordinary role grants.
  -- Bootstrap is offline and bounded. A lock timeout leaves all state intact.
  lock table auth.users, public.profiles, public.user_roles in share row exclusive mode;
  select administrator_id into previous_id from private.academy_first_administrator
  where installation_id = p_installation_id;
  if found then
    if previous_id = p_administrator_id and exists (
      select 1 from public.profiles profile join public.user_roles role on role.user_id = profile.id
      where profile.id = p_administrator_id and profile.active and role.role = 'admin'
    ) then
      return previous_id;
    end if;
    raise exception 'First administrator bootstrap has already completed' using errcode = '55000';
  end if;

  if exists (select 1 from public.user_roles where role in ('owner', 'admin')) then
    raise exception 'The installation already has an administrator' using errcode = '55000';
  end if;
  if not exists (
    select 1 from auth.users identity join public.profiles profile on profile.id = identity.id
    where identity.id = p_administrator_id and identity.email_confirmed_at is not null
      and nullif(identity.email, '') is not null and profile.active
  ) or exists (select 1 from public.user_roles where user_id = p_administrator_id) then
    raise exception 'First administrator must be an active confirmed Auth account without portal roles'
      using errcode = '55000';
  end if;

  insert into public.user_roles(user_id, role) values (p_administrator_id, 'admin');
  insert into private.academy_first_administrator(installation_id, administrator_id, release_commit)
    values (p_installation_id, p_administrator_id, p_release_commit);
  return p_administrator_id;
end;
$$;
revoke all on function private.bootstrap_academy_first_administrator(uuid, text, uuid)
  from public, anon, authenticated, service_role;

commit;
