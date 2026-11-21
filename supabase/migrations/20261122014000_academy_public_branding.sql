begin;

-- These are public presentation overrides. Licence identity, signed assets and
-- the installation origin always come from the operator's verified release.
create table private.academy_public_branding (
  singleton boolean primary key default true check (singleton),
  version integer not null default 0 check (version >= 0),
  name text,
  short_name text,
  theme_color text,
  check (
    (name is null and short_name is null and theme_color is null)
    or (
      name is not null and char_length(name) between 1 and 72
      and name !~ U&'[[:cntrl:]<>\00AD\061C\200B-\200F\202A-\202E\2060-\206F\FEFF]'
      and short_name is not null and char_length(short_name) between 1 and 20
      and short_name !~ U&'[[:cntrl:]<>\00AD\061C\200B-\200F\202A-\202E\2060-\206F\FEFF]'
      and theme_color is not null and theme_color ~ '^#[0-9a-f]{6}$'
    )
  )
);
alter table private.academy_public_branding enable row level security;
revoke all on private.academy_public_branding from public, anon, authenticated, service_role;
insert into private.academy_public_branding default values;

create function private.academy_public_branding()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('installation_id', identity.installation_id,
    'version', brand.version, 'name', brand.name, 'short_name', brand.short_name,
    'theme_color', brand.theme_color)
  from private.academy_public_branding brand
  cross join private.installation_identity identity
  where brand.singleton and identity.singleton and identity.edition <> 'internal';
$$;

create function private.save_academy_public_branding(
  p_expected_version integer, p_name text, p_short_name text, p_theme_color text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid();
begin
  perform private.lock_academy_administration(actor);
  if not private.academy_local_admin(actor) or not private.actor_active() then
    raise insufficient_privilege;
  end if;
  if p_expected_version is null or p_expected_version < 0 then
    raise invalid_parameter_value;
  end if;
  update private.academy_public_branding
  set version = version + 1, name = btrim(p_name), short_name = btrim(p_short_name),
      theme_color = lower(p_theme_color)
  where singleton and version = p_expected_version;
  if not found then
    raise sqlstate 'PT409' using message = 'Branding changed. Reload the current settings.';
  end if;
  insert into public.audit_events(actor_id, action, details)
    values (actor, 'academy.branding.changed', jsonb_build_object(
      'version', p_expected_version + 1, 'using_release_defaults', p_name is null));
  return private.academy_public_branding();
end;
$$;

create function public.academy_public_branding()
returns jsonb language sql stable security invoker set search_path = ''
return private.academy_public_branding();
create function public.save_academy_public_branding(
  p_expected_version integer, p_name text, p_short_name text, p_theme_color text
)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.save_academy_public_branding(p_expected_version, p_name, p_short_name, p_theme_color);
$$;

revoke all on function private.academy_public_branding(), public.academy_public_branding(),
  private.save_academy_public_branding(integer,text,text,text),
  public.save_academy_public_branding(integer,text,text,text)
  from public, anon, authenticated, service_role;
grant execute on function private.academy_public_branding(), public.academy_public_branding()
  to anon, authenticated;
grant execute on function private.save_academy_public_branding(integer,text,text,text),
  public.save_academy_public_branding(integer,text,text,text) to authenticated;

do $migration$
declare
  public_gate text := pg_get_functiondef('public.require_portal_access()'::regprocedure);
  academy_gate text := pg_get_functiondef('private.require_academy_course_access()'::regprocedure);
  public_anchor constant text := '    if current_setting(''request.path'', true) = ''/rpc/installation_capabilities''';
  academy_anchor constant text := '  licence_status := private.academy_course_access_status();';
begin
  if cardinality(string_to_array(public_gate, public_anchor)) <> 2
    or cardinality(string_to_array(academy_gate, academy_anchor)) <> 2 then
    raise exception 'Expected exact public and authenticated academy branding gateways';
  end if;
  execute replace(public_gate, public_anchor, $access$    if current_setting('request.path', true) = '/rpc/academy_public_branding'
       and current_setting('role', true) in ('anon', 'authenticated')
       and current_setting('request.method', true) in ('GET', 'HEAD')
       and coalesce(coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb->>'accept-profile',
         'public') = 'public' then return; end if;
$access$ || public_anchor);
  execute replace(academy_gate, academy_anchor, academy_anchor || $access$
  if licence_status = 'active' and request_method = 'POST'
     and request_path = '/rpc/save_academy_public_branding' then return; end if;$access$);
end;
$migration$;

notify pgrst, 'reload schema';
commit;
