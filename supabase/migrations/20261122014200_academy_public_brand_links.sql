begin;

-- Public presentation links are text only. They are never used as redirect
-- targets by Auth or fetched by the installation.
create function private.academy_public_https_link(p_url text)
returns boolean language sql immutable security invoker set search_path = '' as $$
  select p_url is null or (
    char_length(p_url) <= 500
    and p_url collate "C" ~ '^https://([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?([/?#][A-Za-z0-9._~:/?#\[\]@!$&()*+,;=%-]*)?$'
  );
$$;
revoke all on function private.academy_public_https_link(text)
  from public, anon, authenticated, service_role;

create table private.academy_public_brand_links (
  singleton boolean primary key default true check (singleton),
  version integer not null default 0 check (version >= 0),
  support_url text check (private.academy_public_https_link(support_url)),
  privacy_url text check (private.academy_public_https_link(privacy_url)),
  legal_url text check (private.academy_public_https_link(legal_url)),
  terms_url text check (private.academy_public_https_link(terms_url))
);
alter table private.academy_public_brand_links enable row level security;
revoke all on private.academy_public_brand_links from public, anon, authenticated, service_role;
insert into private.academy_public_brand_links default values;

create function private.academy_public_brand_links()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'installation_id', identity.installation_id, 'version', links.version,
    'support_url', links.support_url, 'privacy_url', links.privacy_url,
    'legal_url', links.legal_url, 'terms_url', links.terms_url
  )
  from private.academy_public_brand_links links
  cross join private.installation_identity identity
  where links.singleton and identity.singleton and identity.edition <> 'internal';
$$;

create function private.save_academy_public_brand_links(
  p_expected_version integer, p_support_url text, p_privacy_url text, p_legal_url text, p_terms_url text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
begin
  perform private.lock_academy_administration(actor);
  if not private.academy_local_admin(actor) or not private.actor_active() then
    raise insufficient_privilege;
  end if;
  if p_expected_version is null or p_expected_version < 0 then
    raise invalid_parameter_value;
  end if;
  update private.academy_public_brand_links
  set version = version + 1, support_url = p_support_url, privacy_url = p_privacy_url,
      legal_url = p_legal_url, terms_url = p_terms_url
  where singleton and version = p_expected_version;
  if not found then
    raise sqlstate 'PT409' using message = 'Public links changed. Reload the current settings.';
  end if;
  insert into public.audit_events(actor_id, action, details)
    values (actor, 'academy.brand_links.changed', jsonb_build_object('version', p_expected_version + 1));
  return private.academy_public_brand_links();
end;
$$;

create function public.academy_public_brand_links()
returns jsonb language sql stable security invoker set search_path = ''
return private.academy_public_brand_links();

create function public.save_academy_public_brand_links(
  p_expected_version integer, p_support_url text, p_privacy_url text, p_legal_url text, p_terms_url text
)
returns jsonb language sql security invoker set search_path = ''
return private.save_academy_public_brand_links(
  p_expected_version, p_support_url, p_privacy_url, p_legal_url, p_terms_url
);

revoke all on function private.academy_public_brand_links(), public.academy_public_brand_links(),
  private.save_academy_public_brand_links(integer,text,text,text,text),
  public.save_academy_public_brand_links(integer,text,text,text,text)
  from public, anon, authenticated, service_role;
grant execute on function private.academy_public_brand_links(), public.academy_public_brand_links()
  to anon, authenticated;
grant execute on function private.save_academy_public_brand_links(integer,text,text,text,text),
  public.save_academy_public_brand_links(integer,text,text,text,text) to authenticated;

do $migration$
declare
  public_gate text := pg_get_functiondef('public.require_portal_access()'::regprocedure);
  academy_gate text := pg_get_functiondef('private.require_academy_course_access()'::regprocedure);
  public_anchor constant text := 'current_setting(''request.path'', true) = ''/rpc/academy_public_branding''';
  write_anchor constant text := 'request_path = ''/rpc/save_academy_public_branding''';
begin
  if cardinality(string_to_array(public_gate, public_anchor)) <> 2
    or cardinality(string_to_array(academy_gate, write_anchor)) <> 2 then
    raise exception 'Expected exact public and authenticated academy branding gateways';
  end if;
  execute replace(public_gate, public_anchor,
    'current_setting(''request.path'', true) in (''/rpc/academy_public_branding'', ''/rpc/academy_public_brand_links'')');
  execute replace(academy_gate, write_anchor,
    'request_path in (''/rpc/save_academy_public_branding'', ''/rpc/save_academy_public_brand_links'')');
end;
$migration$;

notify pgrst, 'reload schema';
commit;
