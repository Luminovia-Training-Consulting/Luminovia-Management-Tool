begin;

-- One bounded, current public asset is replaced atomically. Keeping these bytes
-- with the brand settings also puts them in the installation's database backup.
create table private.academy_public_logo (
  singleton boolean primary key default true check (singleton),
  version integer not null default 0 check (version >= 0),
  png bytea,
  scanner text,
  check ((png is null and scanner is null) or (
    png is not null and octet_length(png) between 57 and 262144
    and substring(png from 1 for 8) = decode('89504e470d0a1a0a', 'hex')
    and scanner is not null and char_length(scanner) between 1 and 160 and scanner !~ '[[:cntrl:]]'
  ))
);
alter table private.academy_public_logo enable row level security;
revoke all on private.academy_public_logo from public, anon, authenticated, service_role;
insert into private.academy_public_logo default values;

create function private.academy_public_logo()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('installation_id', identity.installation_id, 'version', logo.version,
    'png_base64', pg_catalog.replace(pg_catalog.encode(logo.png, 'base64'), E'\n', ''))
  from private.academy_public_logo logo cross join private.installation_identity identity
  where logo.singleton and identity.singleton and identity.edition in ('customer-managed', 'customer-self-hosted');
$$;

create function private.check_academy_logo_write(p_expected_version integer)
returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid();
begin
  perform private.lock_academy_administration(actor);
  if not private.academy_local_admin(actor) or not private.actor_active() then
    raise insufficient_privilege;
  end if;
  if p_expected_version is null or p_expected_version < 0 then
    raise invalid_parameter_value;
  end if;
  if not exists (select 1 from private.academy_public_logo where singleton and version = p_expected_version) then
    raise sqlstate 'PT409' using message = 'Logo changed. Reload the current settings.';
  end if;
end;
$$;

create function private.replace_academy_public_logo(p_actor uuid, p_expected_version integer, p_png bytea, p_scanner text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
begin
  -- The caller obtains this lock after scanning as well as before upload. A
  -- role/edition/licence change never makes a pending upload public.
  perform private.lock_academy_administration(p_actor);
  if not private.academy_local_admin(p_actor) then raise insufficient_privilege; end if;
  update private.academy_public_logo
  set version = version + 1, png = p_png, scanner = p_scanner
  where singleton and version = p_expected_version;
  if not found then raise sqlstate 'PT409' using message = 'Logo changed. Reload the current settings.'; end if;
  insert into public.audit_events(actor_id, action, details)
  values (p_actor, 'academy.logo.changed',
    jsonb_build_object('version', p_expected_version + 1, 'using_release_default', p_png is null));
  return private.academy_public_logo();
end;
$$;

create function private.publish_academy_scanned_logo(
  p_actor uuid, p_expected_version integer, p_png_hex text, p_scanner text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if current_setting('role', true) is distinct from 'service_role' then raise insufficient_privilege; end if;
  if p_expected_version is null or p_expected_version < 0 or p_png_hex is null or p_scanner is null
    or char_length(p_png_hex) not between 114 and 524288 or mod(char_length(p_png_hex), 2) <> 0
    or p_png_hex collate "C" ~ '[^0-9a-f]' then
    raise invalid_parameter_value;
  end if;
  return private.replace_academy_public_logo(p_actor, p_expected_version, decode(p_png_hex, 'hex'), p_scanner);
end;
$$;

create function private.clear_academy_public_logo(p_expected_version integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform private.check_academy_logo_write(p_expected_version);
  return private.replace_academy_public_logo(auth.uid(), p_expected_version, null, null);
end;
$$;

create function public.academy_public_logo()
returns jsonb language sql stable security invoker set search_path = ''
return private.academy_public_logo();

create function public.check_academy_logo_write(p_expected_version integer)
returns void language sql security invoker set search_path = ''
return private.check_academy_logo_write(p_expected_version);

create function public.clear_academy_public_logo(p_expected_version integer)
returns jsonb language sql security invoker set search_path = ''
return private.clear_academy_public_logo(p_expected_version);

create function public.publish_academy_scanned_logo(
  p_actor uuid, p_expected_version integer, p_png_hex text, p_scanner text
)
returns jsonb language sql security invoker set search_path = ''
return private.publish_academy_scanned_logo(p_actor, p_expected_version, p_png_hex, p_scanner);

revoke all on function private.replace_academy_public_logo(uuid,integer,bytea,text),
  private.academy_public_logo(), public.academy_public_logo(),
  private.check_academy_logo_write(integer), public.check_academy_logo_write(integer),
  private.clear_academy_public_logo(integer), public.clear_academy_public_logo(integer),
  private.publish_academy_scanned_logo(uuid,integer,text,text), public.publish_academy_scanned_logo(uuid,integer,text,text)
  from public, anon, authenticated, service_role;
grant execute on function private.academy_public_logo(), public.academy_public_logo() to anon, authenticated;
grant execute on function private.check_academy_logo_write(integer), public.check_academy_logo_write(integer),
  private.clear_academy_public_logo(integer), public.clear_academy_public_logo(integer) to authenticated;
grant execute on function private.publish_academy_scanned_logo(uuid,integer,text,text),
  public.publish_academy_scanned_logo(uuid,integer,text,text) to service_role;

do $migration$
declare
  public_gate text := pg_get_functiondef('public.require_portal_access()'::regprocedure);
  academy_gate text := pg_get_functiondef('private.require_academy_course_access()'::regprocedure);
  read_anchor constant text := '''/rpc/academy_public_branding'', ''/rpc/academy_public_brand_links''';
  write_anchor constant text := '''/rpc/save_academy_public_branding'', ''/rpc/save_academy_public_brand_links''';
  service_anchor constant text := 'current_setting(''request.path'', true) = ''/rpc/academy_course_material_scan''';
begin
  if cardinality(string_to_array(public_gate, read_anchor)) <> 2
    or cardinality(string_to_array(academy_gate, write_anchor)) <> 2
    or cardinality(string_to_array(public_gate, service_anchor)) <> 2 then
    raise exception 'Expected exact academy branding permissions';
  end if;
  execute replace(replace(public_gate,
    read_anchor, read_anchor || ', ''/rpc/academy_public_logo'''),
    service_anchor, 'current_setting(''request.path'', true) in (''/rpc/academy_course_material_scan'', ''/rpc/publish_academy_scanned_logo'')');
  execute replace(academy_gate, write_anchor,
    write_anchor || ', ''/rpc/check_academy_logo_write'', ''/rpc/clear_academy_public_logo''');
end;
$migration$;

notify pgrst, 'reload schema';
commit;
