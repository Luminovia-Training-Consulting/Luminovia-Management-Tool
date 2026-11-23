begin;

-- Apply presentation overrides together without changing the installation identity,
-- licence, data location, public origin or operator-managed deployment settings.
create function private.save_academy_white_label(
  p_expected_brand_version integer, p_expected_links_version integer,
  p_name text, p_short_name text, p_theme_color text,
  p_support_url text, p_privacy_url text, p_legal_url text, p_terms_url text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  branding private.academy_public_branding%rowtype;
  links private.academy_public_brand_links%rowtype;
  changed_brand text[];
  changed_links text[];
begin
  perform private.lock_academy_administration(actor);
  if not private.academy_local_admin(actor) or not private.actor_active() then
    raise insufficient_privilege;
  end if;
  if p_expected_brand_version is null or p_expected_brand_version < 0
      or p_expected_links_version is null or p_expected_links_version < 0 then
    raise invalid_parameter_value;
  end if;

  select * into strict branding from private.academy_public_branding where singleton for update;
  select * into strict links from private.academy_public_brand_links where singleton for update;

  changed_brand := array_remove(array[
    case when branding.name is distinct from btrim(p_name) then 'name' end,
    case when branding.short_name is distinct from btrim(p_short_name) then 'short_name' end,
    case when branding.theme_color is distinct from lower(p_theme_color) then 'theme_color' end
  ], null);
  changed_links := array_remove(array[
    case when links.support_url is distinct from p_support_url then 'support_url' end,
    case when links.privacy_url is distinct from p_privacy_url then 'privacy_url' end,
    case when links.legal_url is distinct from p_legal_url then 'legal_url' end,
    case when links.terms_url is distinct from p_terms_url then 'terms_url' end
  ], null);

  -- If an immediately preceding identical save committed, return its values
  -- without another version increment or audit entry. Divergent stale data
  -- always conflicts before either writer can change state.
  if cardinality(changed_brand) = 0 and cardinality(changed_links) = 0
      and branding.version::bigint - p_expected_brand_version between 0 and 1
      and links.version::bigint - p_expected_links_version between 0 and 1 then
    return jsonb_build_object(
      'branding', private.academy_public_branding(),
      'links', private.academy_public_brand_links()
    );
  end if;
  if branding.version <> p_expected_brand_version or links.version <> p_expected_links_version then
    raise sqlstate 'PT409' using message = 'White Label settings changed. Reload the current settings.';
  end if;

  if cardinality(changed_brand) > 0 then
    perform private.save_academy_public_branding(
      p_expected_brand_version, p_name, p_short_name, p_theme_color
    );
  end if;
  if cardinality(changed_links) > 0 then
    perform private.save_academy_public_brand_links(
      p_expected_links_version, p_support_url, p_privacy_url, p_legal_url, p_terms_url
    );
  end if;

  insert into public.audit_events(actor_id, action, resource_id, details)
    select actor, 'academy.white_label.changed', installation_id,
      jsonb_build_object('fields', changed_brand || changed_links)
    from private.installation_identity where singleton;
  return jsonb_build_object(
    'branding', private.academy_public_branding(),
    'links', private.academy_public_brand_links()
  );
end;
$$;

create function public.save_academy_white_label(
  p_expected_brand_version integer, p_expected_links_version integer,
  p_name text, p_short_name text, p_theme_color text,
  p_support_url text, p_privacy_url text, p_legal_url text, p_terms_url text
)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.save_academy_white_label(
    p_expected_brand_version, p_expected_links_version, p_name, p_short_name,
    p_theme_color, p_support_url, p_privacy_url, p_legal_url, p_terms_url
  );
$$;

revoke all on function private.save_academy_white_label(integer,integer,text,text,text,text,text,text,text),
  public.save_academy_white_label(integer,integer,text,text,text,text,text,text,text)
  from public, anon, authenticated, service_role;
grant execute on function private.save_academy_white_label(integer,integer,text,text,text,text,text,text,text),
  public.save_academy_white_label(integer,integer,text,text,text,text,text,text,text)
  to authenticated;

do $migration$
declare
  academy_gate text := pg_get_functiondef('private.require_academy_course_access()'::regprocedure);
  branding_write constant text := '''/rpc/save_academy_public_branding''';
begin
  if cardinality(string_to_array(academy_gate, branding_write)) <> 2 then
    raise exception 'Expected the existing authenticated academy branding gateway';
  end if;
  execute replace(academy_gate, branding_write, branding_write || ', ''/rpc/save_academy_white_label''');
end;
$migration$;

notify pgrst, 'reload schema';
commit;
