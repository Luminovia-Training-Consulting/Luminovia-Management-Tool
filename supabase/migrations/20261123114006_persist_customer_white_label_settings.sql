begin;

create table private.academy_customer_settings (
  organisation_id uuid primary key references public.organisations(id) on delete restrict,
  revision integer not null check (revision > 0),
  settings jsonb not null
);

alter table private.academy_customer_settings enable row level security;
revoke all on private.academy_customer_settings from public, anon, authenticated, service_role;

-- Only these exact non-secret configuration fields may enter the private record.
create function private.validate_academy_customer_settings(p_settings jsonb)
returns boolean language plpgsql stable set search_path = '' as $$
declare
  node jsonb;
  field record;
begin
  for field in select * from (values
    ('{}'::text[], array['version','request_id','purpose','legal_customer_name','branding',
      'initial_administrator','target','preferences','smtp_mode','backup_retention_days','support','licence']),
    (array['branding'], array['name','short_name','theme','theme_color','approved_assets_reference']),
    (array['initial_administrator'], array['email','username']),
    (array['target'], array['edition','portal_origin','domain_status','runtime_directory','host_reference','data_region','tls']),
    (array['preferences'], array['locale','time_zone']),
    (array['support'], array['agreement_reference','contact_email']),
    (array['licence'], array['release_commit','limits']),
    (array['licence','limits'], array['seat_count','storage_bytes','api_requests_per_minute'])
  ) as schema(path, keys)
  loop
    node := p_settings #> field.path;
    if jsonb_typeof(node) is distinct from 'object' or not (node ?& field.keys) or
      exists (select 1 from jsonb_object_keys(node) key where key <> all(field.keys)) then
      return false;
    end if;
  end loop;

  for field in select * from (values
    (array['version'], 'number', '^1$'),
    (array['request_id'], 'string', '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'),
    (array['purpose'], 'string', '^customer$'),
    (array['legal_customer_name'], 'string', '^[^[:cntrl:]<>]{1,120}$'),
    (array['branding','name'], 'string', '^[^[:cntrl:]<>]{1,72}$'),
    (array['branding','short_name'], 'string', '^[^[:cntrl:]<>]{1,20}$'),
    (array['branding','theme'], 'string', '^(light|dark|system)$'),
    (array['branding','theme_color'], 'string', '^#[a-f0-9]{6}$'),
    (array['branding','approved_assets_reference'], 'string', '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$'),
    (array['initial_administrator','email'], 'string', '^[^[:space:]<>@]+@[^[:space:]<>@]+\.[^[:space:]<>@]+$'),
    (array['initial_administrator','username'], 'nullable', '^[a-z][a-z0-9._-]{1,30}[a-z0-9]$'),
    (array['target','edition'], 'string', '^customer-(self-hosted|managed)$'),
    (array['target','portal_origin'], 'string', '^https://([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$'),
    (array['target','domain_status'], 'string', '^(verified-by-operator|temporary-pending)$'),
    (array['target','runtime_directory'], 'string', '^(/[A-Za-z0-9_-]+){2,}$'),
    (array['target','host_reference'], 'string', '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$'),
    (array['target','data_region'], 'string', '^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$'),
    (array['target','tls'], 'string', '^(acme|operator-terminated)$'),
    (array['preferences','locale'], 'string', '^(de|en)$'),
    (array['preferences','time_zone'], 'string', '^[A-Za-z][A-Za-z0-9_+/-]{0,79}$'),
    (array['smtp_mode'], 'string', '^(capture|provider)$'),
    (array['backup_retention_days'], 'number', '^[1-9][0-9]{0,15}$'),
    (array['support','agreement_reference'], 'string', '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$'),
    (array['support','contact_email'], 'string', '^[^[:space:]<>@]+@[^[:space:]<>@]+\.[^[:space:]<>@]+$'),
    (array['licence','release_commit'], 'string', '^[0-9a-f]{40}$'),
    (array['licence','limits','seat_count'], 'number', '^[1-9][0-9]{0,15}$'),
    (array['licence','limits','storage_bytes'], 'number', '^[1-9][0-9]{0,15}$'),
    (array['licence','limits','api_requests_per_minute'], 'number', '^[1-9][0-9]{0,9}$')
  ) as schema(path, kind, pattern)
  loop
    node := p_settings #> field.path;
    if field.kind = 'nullable' and node = 'null'::jsonb then continue; end if;
    if jsonb_typeof(node) is distinct from (case when field.kind = 'nullable' then 'string' else field.kind end)
       or not coalesce((p_settings #>> field.path) ~ field.pattern, false) then
      return false;
    end if;
    if field.kind = 'number' and (node #>> '{}')::numeric > 9007199254740991 then return false; end if;
  end loop;

  return length(p_settings #>> '{target,portal_origin}') <= 261
    and length(p_settings #>> '{target,runtime_directory}') <= 240
    and length(p_settings #>> '{support,contact_email}') <= 254
    and length(p_settings #>> '{initial_administrator,email}') <= 254
    and (p_settings #>> '{licence,limits,api_requests_per_minute}')::numeric <= 4294967295
    and (p_settings #>> '{licence,release_commit}') <> repeat('0', 40)
    and (p_settings #>> '{target,portal_origin}') !~ '(//|\.)(luminovia\.org|example\.(com|org|net))$|\.(localhost|local|internal|test|invalid|example|onion)$'
    and not exists (select from unnest(array['/opt/luminovia-portal','/var/backups/luminovia-complete']) as reserved(path)
      where (p_settings #>> '{target,runtime_directory}') = path
         or starts_with(p_settings #>> '{target,runtime_directory}', path || '/')
         or starts_with(path, (p_settings #>> '{target,runtime_directory}') || '/'));
end;
$$;

create function private.academy_customer_setup(
  p_organisation_id uuid, p_expected_revision integer, p_settings jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  saved private.academy_customer_settings;
  current_revision integer;
begin
  if (select edition from private.installation_identity) is distinct from 'internal'
    or not private.has_role(array['admin','owner']) then
    raise exception 'White Label administration required' using errcode = '42501';
  end if;

  -- Serialize writes against this company and its deletion/archive operations.
  if p_settings is not null then
    perform 1 from public.organisations where id = p_organisation_id and archived_at is null for update;
  else
    perform 1 from public.organisations where id = p_organisation_id and archived_at is null;
  end if;
  if not found then raise exception 'Company unavailable' using errcode = '42501'; end if;

  select * into saved from private.academy_customer_settings where organisation_id = p_organisation_id;
  current_revision := coalesce(saved.revision, 0);
  if p_settings is null and p_expected_revision is null then
    return jsonb_build_object('revision', current_revision, 'settings', saved.settings);
  end if;
  if p_expected_revision is null or p_expected_revision < 0 or
    not coalesce(private.validate_academy_customer_settings(p_settings), false) then
    raise exception 'Invalid White Label settings' using errcode = '22023';
  end if;

  if not exists (
    select from public.client_organisation_memberships membership
    join public.profiles profile on profile.id = membership.user_id and profile.active
    join public.user_roles role on role.user_id = profile.id and role.role = 'client'
    join auth.users account on account.id = profile.id
    where membership.organisation_id = p_organisation_id and membership.removed_at is null
      and lower(account.email) = lower(p_settings #>> '{initial_administrator,email}')
  ) then
    raise exception 'company_administrator' using errcode = '22023';
  end if;

  if saved.settings = p_settings then
    return jsonb_build_object('revision', current_revision, 'settings', saved.settings);
  end if;
  if current_revision <> p_expected_revision then
    raise exception 'white_label_revision_changed' using errcode = 'PT409';
  end if;

  insert into private.academy_customer_settings(organisation_id, revision, settings)
    values (p_organisation_id, current_revision + 1, p_settings)
  on conflict (organisation_id) do update set revision = excluded.revision, settings = excluded.settings
  returning * into saved;
  insert into public.audit_events(actor_id, action, resource_id, details)
    values (auth.uid(), 'academy.white_label.changed', p_organisation_id, '{}'::jsonb);
  return jsonb_build_object('revision', saved.revision, 'settings', saved.settings);
end;
$$;

create function public.academy_customer_setup(
  p_organisation_id uuid, p_expected_revision integer default null, p_settings jsonb default null
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.academy_customer_setup(p_organisation_id, p_expected_revision, p_settings);
$$;

revoke all on function private.validate_academy_customer_settings(jsonb),
  private.academy_customer_setup(uuid, integer, jsonb),
  public.academy_customer_setup(uuid, integer, jsonb)
from public, anon, authenticated, service_role;
grant execute on function private.academy_customer_setup(uuid, integer, jsonb),
  public.academy_customer_setup(uuid, integer, jsonb) to authenticated;

-- Settings belong to the existing reviewed permanent organisation deletion.
alter function private.deletion_scope(text, uuid) rename to deletion_scope_before_customer_settings;
create function private.deletion_scope(p_kind text, p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  scope jsonb := private.deletion_scope_before_customer_settings(p_kind, p_id);
begin
  if p_kind = 'organisation' then
    return private.deletion_add_scope(scope, 'private.academy_customer_settings',
      format('x.organisation_id = %L::uuid', p_id));
  end if;
  return scope;
end;
$$;
revoke all on function private.deletion_scope_before_customer_settings(text, uuid),
  private.deletion_scope(text, uuid) from public, anon, authenticated, service_role;

commit;
