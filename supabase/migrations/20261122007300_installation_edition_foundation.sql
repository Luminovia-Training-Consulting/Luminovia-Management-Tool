begin;

-- Existing Luminovia databases begin in the internal edition. Application
-- roles never get configuration writes, including when they administer an academy.
create table private.installation_identity (
  singleton boolean primary key default true check (singleton),
  installation_id uuid not null unique default gen_random_uuid(),
  edition text not null default 'internal' check (
    edition in ('internal', 'customer-self-hosted', 'customer-managed')
  ),
  pinned_at timestamptz not null default statement_timestamp()
);
alter table private.installation_identity enable row level security;
revoke all on private.installation_identity from public, anon, authenticated, service_role;
insert into private.installation_identity default values;

create table private.installation_verified_licence (
  installation_id uuid primary key references private.installation_identity(installation_id),
  terms jsonb not null,
  issued_at timestamptz not null,
  starts_at timestamptz not null,
  expires_at timestamptz not null,
  grace_until timestamptz not null,
  check (
    isfinite(issued_at) and isfinite(starts_at) and isfinite(expires_at) and isfinite(grace_until)
    and issued_at <= starts_at and starts_at < expires_at and expires_at <= grace_until
  )
);
alter table private.installation_verified_licence enable row level security;
revoke all on private.installation_verified_licence from public, anon, authenticated, service_role;

-- Dedicated installations may only pin their identity once. A restored
-- database therefore retains the original customer binding across upgrades.
create function private.retain_installation_identity()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op <> 'UPDATE' then
    raise exception 'Installation identity is immutable' using errcode = '55000';
  end if;
  if old.edition <> 'internal' or new.edition = 'internal' then
    raise exception 'Installation identity is immutable' using errcode = '55000';
  end if;
  return new;
end;
$$;
revoke all on function private.retain_installation_identity() from public, anon, authenticated, service_role;
create trigger retain_installation_identity
before update or delete on private.installation_identity
for each row execute function private.retain_installation_identity();
create trigger retain_installation_identity_on_truncate
before truncate on private.installation_identity
for each statement execute function private.retain_installation_identity();

-- Operator-only bootstrap, while the new dedicated database is offline.
-- Do not convert populated Luminovia databases into a customer installation.
create function private.provision_customer_installation(p_installation_id uuid, p_edition text)
returns void language plpgsql security invoker set search_path = '' set lock_timeout = '5s' as $$
declare
  pinned private.installation_identity%rowtype;
begin
  if p_installation_id is null or p_edition is null
     or p_edition not in ('customer-self-hosted', 'customer-managed') then
    raise exception 'Invalid customer installation identity' using errcode = '22023';
  end if;
  select * into strict pinned from private.installation_identity for update;
  if pinned.edition <> 'internal' then
    if (pinned.installation_id, pinned.edition) = (p_installation_id, p_edition) then
      return;
    end if;
    raise exception 'Installation identity is immutable' using errcode = '55000';
  end if;

  lock table auth.users, public.profiles, public.organisations, public.course_runs,
    public.jobs, public.contracts, public.invoices, public.documents, public.messages
    in share row exclusive mode;
  if exists (select 1 from auth.users) or exists (select 1 from public.profiles)
     or exists (select 1 from public.organisations) or exists (select 1 from public.course_runs)
     or exists (select 1 from public.jobs) or exists (select 1 from public.contracts)
     or exists (select 1 from public.invoices) or exists (select 1 from public.documents)
     or exists (select 1 from public.messages) then
    raise exception 'Customer provisioning requires an empty dedicated installation' using errcode = '55000';
  end if;
  update private.installation_identity
  set installation_id = p_installation_id, edition = p_edition, pinned_at = statement_timestamp()
  where singleton;
end;
$$;
revoke all on function private.provision_customer_installation(uuid, text) from public, anon, authenticated, service_role;

-- An offline verifier validates the vendor signature against the operator's
-- trusted public key and expected release before its normalized terms reach
-- this SQL-only ingestion path. The supplied JSON does not validate its own signature.
create function private.apply_verified_installation_licence(p_terms jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  pinned private.installation_identity%rowtype;
  stored private.installation_verified_licence%rowtype;
  required_terms constant text[] := array[
    'installation_id', 'edition', 'release_commit', 'issued_at', 'starts_at',
    'expires_at', 'grace_until', 'modules', 'limits'
  ];
  required_limits constant text[] := array['seat_count', 'storage_bytes', 'api_requests_per_minute'];
  terms_limit jsonb;
  field text;
  instant timestamptz;
  issued timestamptz;
  starts timestamptz;
  expires timestamptz;
  grace timestamptz;
begin
  if jsonb_typeof(p_terms) is distinct from 'object'
     or not (p_terms ?& required_terms) or p_terms - required_terms <> '{}'::jsonb
     or jsonb_typeof(p_terms->'limits') is distinct from 'object'
     or not ((p_terms->'limits') ?& required_limits)
     or (p_terms->'limits') - required_limits <> '{}'::jsonb
     or p_terms->'modules' is distinct from '["lms"]'::jsonb
     or coalesce(p_terms->>'release_commit', '') !~ '^[0-9a-f]{40}$' then
    raise exception 'Invalid verified licence terms' using errcode = '22023';
  end if;
  for terms_limit in select value from jsonb_each(p_terms->'limits') loop
    if jsonb_typeof(terms_limit) <> 'number'
       or terms_limit::text !~ '^[1-9][0-9]{0,15}$'
       or terms_limit::text::numeric > 9007199254740991 then
      raise exception 'Invalid verified licence limit' using errcode = '22023';
    end if;
  end loop;
  foreach field in array array['issued_at', 'starts_at', 'expires_at', 'grace_until'] loop
    if coalesce(p_terms->>field, '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$' then
      raise exception 'Invalid verified licence timestamp' using errcode = '22023';
    end if;
    instant := (p_terms->>field)::timestamptz;
    if to_char(instant at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') <> p_terms->>field then
      raise exception 'Invalid verified licence timestamp' using errcode = '22023';
    end if;
  end loop;

  issued := (p_terms->>'issued_at')::timestamptz;
  starts := (p_terms->>'starts_at')::timestamptz;
  expires := (p_terms->>'expires_at')::timestamptz;
  grace := (p_terms->>'grace_until')::timestamptz;
  if issued > starts or starts >= expires or expires > grace
     or grace - expires > interval '30 days' then
    raise exception 'Invalid verified licence validity window' using errcode = '22023';
  end if;

  -- Serialize renewals on the single identity. A captured older statement
  -- cannot subsequently replace the newest verified licence.
  select * into strict pinned from private.installation_identity for update;
  if pinned.edition = 'internal' or
     p_terms->>'installation_id' is distinct from pinned.installation_id::text or
     p_terms->>'edition' is distinct from pinned.edition then
    raise exception 'Verified licence installation mismatch' using errcode = '22023';
  end if;
  select * into stored from private.installation_verified_licence
  where installation_id = pinned.installation_id;
  if found and issued <= stored.issued_at then
    if stored.terms = p_terms then
      return;
    end if;
    raise exception 'Verified licence is stale or conflicts with the retained issue time' using errcode = '40001';
  end if;
  insert into private.installation_verified_licence(
    installation_id, terms, issued_at, starts_at, expires_at, grace_until
  ) values (
    pinned.installation_id, p_terms, issued, starts, expires, grace
  ) on conflict (installation_id) do update set
    terms = excluded.terms, issued_at = excluded.issued_at, starts_at = excluded.starts_at,
    expires_at = excluded.expires_at, grace_until = excluded.grace_until;
end;
$$;
revoke all on function private.apply_verified_installation_licence(jsonb) from public, anon, authenticated, service_role;

-- Intentional public projection for the login bootstrap. The barrier view
-- exposes no licence document, dates, limits, content or account identifiers.
-- A customer licence can be checked now, but the academy remains dormant
-- until its REST, Edge, Storage, Realtime and course-assignment paths are gated.
create view public.installation_capability_state with (security_barrier = true) as
select identity.installation_id, identity.edition,
  case
    when identity.edition = 'internal' then 'not-required'
    when licence.installation_id is null then 'unlicensed'
    when statement_timestamp() < licence.starts_at then 'scheduled'
    when statement_timestamp() < licence.expires_at then 'active'
    when statement_timestamp() < licence.grace_until then 'grace'
    else 'expired'
  end as licence_status,
  false as customer_ready,
  identity.edition = 'internal' as lms_available,
  identity.edition = 'internal' as marketplace_available,
  identity.edition = 'internal' as company_premium_switch_available
from private.installation_identity identity
left join private.installation_verified_licence licence using (installation_id);

revoke all on public.installation_capability_state from public, anon, authenticated, service_role;
grant select on public.installation_capability_state to anon, authenticated, service_role;

-- Private business routines can require a fresh entitlement, even while the
-- external Data API is dormant. Grace never satisfies a write gate.
create function private.customer_installation_has_active_licence()
returns boolean language sql stable security invoker set search_path = '' as $$
  select coalesce((
    select edition <> 'internal' and licence_status = 'active'
    from public.installation_capability_state
  ), false);
$$;
revoke all on function private.customer_installation_has_active_licence()
  from public, anon, authenticated, service_role;

create function public.installation_capabilities()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select to_jsonb(capability) from public.installation_capability_state capability;
$$;
revoke all on function public.installation_capabilities() from public, anon, authenticated, service_role;
grant execute on function public.installation_capabilities() to anon, authenticated, service_role;

-- Read only the safe projection, even for anon. Existing internal actor and
-- participant gates still run unchanged. Externally pinned deployments allow
-- exactly this bootstrap RPC at the PostgREST pre-request boundary.
create or replace function public.require_portal_access()
returns void language plpgsql stable security invoker set search_path = '' as $$
begin
  if (select edition from public.installation_capability_state) is distinct from 'internal' then
    if current_setting('request.path', true) = '/rpc/installation_capabilities'
       and current_setting('request.method', true) in ('GET', 'HEAD', 'POST') then
      return;
    end if;
    raise exception 'Customer installation is not active' using errcode = '42501';
  end if;
  if current_setting('role', true) = 'authenticated' then
    perform private.require_portal_access();
  end if;
end;
$$;
revoke all on function public.require_portal_access() from public, anon, authenticated, service_role;
grant execute on function public.require_portal_access() to anon, authenticated, service_role;

notify pgrst, 'reload schema';
commit;
