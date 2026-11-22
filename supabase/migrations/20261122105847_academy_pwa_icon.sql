begin;

-- Keep one bounded and atomic three-image revision in the Academy database.
-- The Edge gateway validates and scans the full images. The receipt function
-- additionally checks their byte bounds and immutable IHDR facts.
create function private.academy_pwa_icon_png(p_png bytea, p_edge integer, p_limit integer)
returns boolean language sql immutable strict security invoker set search_path = '' as $$
  select octet_length(p_png) between 57 and p_limit
    and substring(p_png from 1 for 24) =
      decode('89504e470d0a1a0a0000000d49484452', 'hex') || int4send(p_edge) || int4send(p_edge)
    and substring(p_png from 25 for 5) in (decode('0802000000', 'hex'), decode('0806000000', 'hex'));
$$;

create table private.academy_pwa_icon (
  singleton boolean primary key default true check (singleton),
  version integer not null default 0 check (version >= 0),
  icon_192 bytea,
  icon_512 bytea,
  maskable_512 bytea,
  scanners text[],
  check (
    (icon_192 is null and icon_512 is null and maskable_512 is null and scanners is null)
    or (icon_192 is not null and icon_512 is not null and maskable_512 is not null
      and scanners is not null and cardinality(scanners) = 3
      and private.academy_pwa_icon_png(icon_192, 192, 262144)
      and private.academy_pwa_icon_png(icon_512, 512, 1000000)
      and private.academy_pwa_icon_png(maskable_512, 512, 1000000))
  )
);
alter table private.academy_pwa_icon enable row level security;
revoke all on private.academy_pwa_icon from public, anon, authenticated, service_role;
insert into private.academy_pwa_icon default values;

create function private.academy_pwa_icon()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'installation_id', identity.installation_id, 'version', icon.version, 'custom', icon.icon_192 is not null
  )
  from private.academy_pwa_icon icon cross join private.installation_identity identity
  where icon.singleton and identity.singleton and identity.edition in ('customer-managed', 'customer-self-hosted');
$$;

create function private.academy_pwa_manifest()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('version', icon.version, 'name', brand.data->>'name',
    'short_name', brand.data->>'short_name', 'theme_color', brand.data->>'theme_color')
  from private.academy_pwa_icon icon
  cross join lateral (select private.academy_pdf_brand() as data) brand
  where current_setting('role', true) = 'service_role'
    and icon.singleton and icon.icon_192 is not null and brand.data is not null;
$$;

create function private.read_academy_pwa_icon(p_variant text, p_version integer)
returns text language sql stable security definer set search_path = '' as $$
  select replace(encode(case p_variant
    when 'icon_192' then icon.icon_192
    when 'icon_512' then icon.icon_512
    when 'maskable_512' then icon.maskable_512
  end, 'base64'), E'\n', '')
  from private.academy_pwa_icon icon cross join private.installation_identity identity
  where current_setting('role', true) = 'service_role'
    and icon.singleton and identity.singleton and identity.edition in ('customer-managed', 'customer-self-hosted')
    and (p_version is null or icon.version = p_version);
$$;

create function private.check_academy_pwa_icon_write(p_expected_version integer)
returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid();
begin
  perform private.lock_academy_administration(actor);
  if not private.academy_local_admin(actor) or not private.actor_active() then
    raise insufficient_privilege;
  end if;
  if p_expected_version is null or p_expected_version < 0 then raise invalid_parameter_value; end if;
  if not exists (select 1 from private.academy_pwa_icon where singleton and version = p_expected_version) then
    raise sqlstate 'PT409' using message = 'App icon changed. Reload the current settings.';
  end if;
end;
$$;

create function private.replace_academy_pwa_icon(
  p_actor uuid, p_expected_version integer, p_icon_192 bytea, p_icon_512 bytea,
  p_maskable_512 bytea, p_scanners text[]
) returns jsonb language plpgsql security invoker set search_path = '' as $$
begin
  -- Confirm current course profile, licence, active account and exact local
  -- administrator after scanning. A version changes only for a full set.
  perform private.lock_academy_administration(p_actor);
  if not private.academy_local_admin(p_actor) then raise insufficient_privilege; end if;
  update private.academy_pwa_icon
  set version = version + 1, icon_192 = p_icon_192, icon_512 = p_icon_512,
    maskable_512 = p_maskable_512, scanners = p_scanners
  where singleton and version = p_expected_version;
  if not found then raise sqlstate 'PT409' using message = 'App icon changed. Reload the current settings.'; end if;
  insert into public.audit_events(actor_id, action, details)
  values (p_actor, 'academy.pwa_icon.changed',
    jsonb_build_object('version', p_expected_version + 1, 'using_release_default', p_icon_192 is null));
  return private.academy_pwa_icon();
end;
$$;

create function private.decode_academy_pwa_icon(p_encoded text, p_limit integer)
returns bytea language plpgsql immutable security invoker set search_path = '' as $$
declare png bytea;
begin
  if p_encoded is null or char_length(p_encoded) not between 76 and 4 * ((p_limit + 2) / 3)
    or mod(char_length(p_encoded), 4) <> 0 or p_encoded collate "C" !~ '^[A-Za-z0-9+/]+={0,2}$' then
    raise invalid_parameter_value;
  end if;
  png := decode(p_encoded, 'base64');
  if octet_length(png) > p_limit then raise invalid_parameter_value; end if;
  return png;
end;
$$;

create function private.publish_academy_scanned_pwa_icon(
  p_actor uuid, p_expected_version integer, p_icon_192_base64 text, p_icon_512_base64 text,
  p_maskable_512_base64 text, p_scanners text[]
) returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if current_setting('role', true) is distinct from 'service_role' then raise insufficient_privilege; end if;
  if p_expected_version is null or p_expected_version < 0 or p_scanners is null
    or array_ndims(p_scanners) is distinct from 1 or cardinality(p_scanners) <> 3
    or array_lower(p_scanners, 1) <> 1 or exists (
      select 1 from unnest(p_scanners) receipt
      where receipt is null or char_length(receipt) not between 1 and 160 or receipt ~ '[[:cntrl:]]'
    ) then raise invalid_parameter_value; end if;
  return private.replace_academy_pwa_icon(
    p_actor, p_expected_version, private.decode_academy_pwa_icon(p_icon_192_base64, 262144),
    private.decode_academy_pwa_icon(p_icon_512_base64, 1000000),
    private.decode_academy_pwa_icon(p_maskable_512_base64, 1000000), p_scanners
  );
end;
$$;

create function private.clear_academy_pwa_icon(p_expected_version integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform private.check_academy_pwa_icon_write(p_expected_version);
  return private.replace_academy_pwa_icon(auth.uid(), p_expected_version, null, null, null, null);
end;
$$;

create function public.academy_pwa_icon()
returns jsonb language sql stable security invoker set search_path = ''
return private.academy_pwa_icon();

create function public.academy_pwa_manifest()
returns jsonb language sql stable security invoker set search_path = ''
return private.academy_pwa_manifest();

create function public.read_academy_pwa_icon(p_variant text, p_version integer default null)
returns text language sql stable security invoker set search_path = ''
return private.read_academy_pwa_icon(p_variant, p_version);

create function public.check_academy_pwa_icon_write(p_expected_version integer)
returns void language sql security invoker set search_path = ''
return private.check_academy_pwa_icon_write(p_expected_version);

create function public.clear_academy_pwa_icon(p_expected_version integer)
returns jsonb language sql security invoker set search_path = ''
return private.clear_academy_pwa_icon(p_expected_version);

create function public.publish_academy_scanned_pwa_icon(
  p_actor uuid, p_expected_version integer, p_icon_192_base64 text, p_icon_512_base64 text,
  p_maskable_512_base64 text, p_scanners text[]
) returns jsonb language sql security invoker set search_path = ''
return private.publish_academy_scanned_pwa_icon(
  p_actor, p_expected_version, p_icon_192_base64, p_icon_512_base64, p_maskable_512_base64, p_scanners
);

revoke all on function private.academy_pwa_icon_png(bytea,integer,integer),
  private.decode_academy_pwa_icon(text,integer),
  private.replace_academy_pwa_icon(uuid,integer,bytea,bytea,bytea,text[]),
  private.academy_pwa_icon(), public.academy_pwa_icon(),
  private.academy_pwa_manifest(), public.academy_pwa_manifest(),
  private.read_academy_pwa_icon(text,integer), public.read_academy_pwa_icon(text,integer),
  private.check_academy_pwa_icon_write(integer), public.check_academy_pwa_icon_write(integer),
  private.clear_academy_pwa_icon(integer), public.clear_academy_pwa_icon(integer),
  private.publish_academy_scanned_pwa_icon(uuid,integer,text,text,text,text[]),
  public.publish_academy_scanned_pwa_icon(uuid,integer,text,text,text,text[])
  from public, anon, authenticated, service_role;
grant execute on function private.academy_pwa_icon(), public.academy_pwa_icon() to anon, authenticated;
grant execute on function private.check_academy_pwa_icon_write(integer), public.check_academy_pwa_icon_write(integer),
  private.clear_academy_pwa_icon(integer), public.clear_academy_pwa_icon(integer) to authenticated;
grant execute on function private.academy_pwa_manifest(), public.academy_pwa_manifest(),
  private.read_academy_pwa_icon(text,integer), public.read_academy_pwa_icon(text,integer),
  private.publish_academy_scanned_pwa_icon(uuid,integer,text,text,text,text[]),
  public.publish_academy_scanned_pwa_icon(uuid,integer,text,text,text,text[]) to service_role;

do $migration$
declare
  public_gate text := pg_get_functiondef('public.require_portal_access()'::regprocedure);
  academy_gate text := pg_get_functiondef('private.require_academy_course_access()'::regprocedure);
  read_anchor constant text := '''/rpc/academy_public_logo''';
  write_anchor constant text := '''/rpc/clear_academy_public_logo''';
  service_anchor constant text := '''/rpc/publish_academy_scanned_logo''';
  service_branch constant text := '    if current_setting(''role'', true) = ''service_role'' then';
begin
  if cardinality(string_to_array(public_gate, read_anchor)) <> 2
    or cardinality(string_to_array(academy_gate, write_anchor)) <> 2
    or cardinality(string_to_array(public_gate, service_anchor)) <> 2
    or cardinality(string_to_array(public_gate, service_branch)) <> 2 then
    raise exception 'Expected exact academy image gateways';
  end if;
  public_gate := replace(public_gate, read_anchor, read_anchor || ', ''/rpc/academy_pwa_icon''');
  public_gate := replace(public_gate, service_anchor,
    service_anchor || ', ''/rpc/read_academy_pwa_icon'', ''/rpc/publish_academy_scanned_pwa_icon''');
  execute replace(public_gate, service_branch, service_branch || $access$
      if current_setting('request.path', true) = '/rpc/academy_pwa_manifest'
         and current_setting('request.method', true) = 'GET'
         and coalesce(request_headers->>'accept-profile', 'public') = 'public'
         and coalesce(request_headers->>'content-profile', 'public') = 'public' then
        return;
      end if;$access$);
  execute replace(academy_gate, write_anchor,
    write_anchor || ', ''/rpc/check_academy_pwa_icon_write'', ''/rpc/clear_academy_pwa_icon''');
end;
$migration$;

notify pgrst, 'reload schema';
commit;
