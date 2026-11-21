begin;

-- PostgREST's pre-request hook does not run for Realtime or Storage. Keep
-- these explicitly supported data relations closed across those transports
-- on a dormant customer installation. The internal edition's existing RLS
-- policies still decide ownership and resource access.
do $$
declare
  relation text;
  filter constant text := '(select coalesce(
    (select edition = ''internal'' from public.installation_capability_state), false
  ))';
begin
  foreach relation in array array[
    'public.messages', 'public.message_reactions', 'public.chat_members',
    'public.course_chat_activity', 'realtime.messages',
    'storage.buckets', 'storage.objects'
  ] loop
    if to_regclass(relation) is null then
      continue;
    end if;
    begin
      execute format(
        'create policy portal_internal_transport on %s as restrictive for all to anon, authenticated using (%s) with check (%s)',
        to_regclass(relation), filter, filter
      );
    exception when insufficient_privilege then
      -- A provider-owned schema can require its own migration operator. Let
      -- the existing internal instance migrate while keeping external pinning
      -- fail-closed until every present relation has an active boundary.
      if relation like 'public.%' or
         (select edition from private.installation_identity) <> 'internal' then
        raise;
      end if;
      raise warning 'Dormant customer provisioning is blocked by provider policy ownership on %', relation;
    end;
  end loop;
end;
$$;

-- Stored public buckets bypass object RLS when content is served. A dedicated
-- customer instance may use private file gateways after rollout, with its
-- public brand assets served separately by its application build.
create function private.keep_installation_storage_private()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  edition text;
begin
  if new.public then
    select identity.edition into edition from private.installation_identity identity for key share;
    if edition is distinct from 'internal' then
      raise exception 'Customer installations require private Storage buckets' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.keep_installation_storage_private() from public, anon, authenticated, service_role;

-- Capture provider-owned gaps explicitly rather than granting a database
-- superuser exception to runtime accounts. This is also checked when a
-- previously pinned installation adopts the transport migration.
create function private.installation_transport_fences_present()
returns boolean language sql stable security invoker set search_path = '' as $$
  select not exists (
    select 1 from pg_class relation
    where relation.oid = any(array[
      to_regclass('public.messages'), to_regclass('public.message_reactions'),
      to_regclass('public.chat_members'), to_regclass('public.course_chat_activity'),
      to_regclass('realtime.messages'), to_regclass('storage.buckets'), to_regclass('storage.objects')
    ])
    and (
      not relation.relrowsecurity or not exists (
        select 1 from pg_policy policy where policy.polrelid = relation.oid
          and policy.polname = 'portal_internal_transport'
          and not policy.polpermissive and policy.polcmd = '*'
      )
    )
  ) and (
    to_regclass('storage.buckets') is null or exists(
      select 1 from pg_trigger trigger
      where trigger.tgrelid = to_regclass('storage.buckets')
        and trigger.tgname = 'keep_installation_storage_private'
        and trigger.tgenabled in ('O', 'A')
    )
  );
$$;
revoke all on function private.installation_transport_fences_present() from public, anon, authenticated, service_role;

-- Provisioning is a coordinated offline operator step. Guard Storage's
-- independent metadata as well as the application tables checked by 07300.
create function private.require_empty_installation_storage()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  populated boolean;
begin
  if old.edition = 'internal' and new.edition <> 'internal' then
    if not private.installation_transport_fences_present() then
      raise exception 'Dedicated customer provisioning requires every installed transport fence' using errcode = '55000';
    end if;
    if to_regclass('storage.buckets') is not null then
      lock table storage.buckets in share row exclusive mode nowait;
      select exists (select 1 from storage.buckets where public) into populated;
      if populated then
        raise exception 'Dedicated customer provisioning requires private Storage buckets' using errcode = '55000';
      end if;
    end if;
    if to_regclass('storage.objects') is not null then
      lock table storage.objects in share row exclusive mode nowait;
      select exists (select 1 from storage.objects) into populated;
      if populated then
        raise exception 'Dedicated customer provisioning requires empty Storage' using errcode = '55000';
      end if;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.require_empty_installation_storage() from public, anon, authenticated, service_role;
create trigger require_empty_installation_storage
before update on private.installation_identity
for each row execute function private.require_empty_installation_storage();

do $$
begin
  if to_regclass('storage.buckets') is not null then
    -- Abort rather than silently changing visibility if an operator has
    -- already pinned a database with exported public files.
    if (select edition from private.installation_identity) <> 'internal'
       and exists (select 1 from storage.buckets where public) then
      raise exception 'Review existing public Storage buckets before importing a customer installation' using errcode = '55000';
    end if;
    begin
      create trigger keep_installation_storage_private
      before insert or update of public on storage.buckets
      for each row execute function private.keep_installation_storage_private();
    exception when insufficient_privilege then
      if (select edition from private.installation_identity) <> 'internal' then
        raise;
      end if;
      raise warning 'Dormant customer provisioning is blocked by Storage trigger ownership';
    end;
  end if;
  if (select edition from private.installation_identity) <> 'internal'
     and not private.installation_transport_fences_present() then
    raise exception 'A pinned customer installation requires every installed transport fence' using errcode = '55000';
  end if;
end;
$$;

commit;
