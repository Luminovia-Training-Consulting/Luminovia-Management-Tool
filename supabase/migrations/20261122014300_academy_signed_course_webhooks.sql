begin;

-- Dedicated subscriptions use the existing company scope and outbox. Their
-- internal authorisation record never becomes an inbound integration token.
alter table private.company_integration_keys add column purpose text not null default 'course-index'
  check (purpose in ('course-index', 'academy-webhook'));
alter table private.company_course_webhook_deliveries add column academy_release_commit text
  check (academy_release_commit ~ '^[0-9a-f]{40}$');

create or replace function private.company_integration_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select (select edition from private.installation_identity) = 'internal' and
    private.actor_active() and exists (
      select 1 from public.user_roles where user_id = auth.uid() and role in ('admin', 'owner')
    );
$$;

create function private.company_course_webhook_admin()
returns boolean language sql stable security invoker set search_path = '' as $$
  select case when (select edition from private.installation_identity) = 'internal'
    then private.company_integration_admin()
    else coalesce(private.academy_course_access_status() = 'active', false)
      and private.actor_active() and private.academy_local_admin(auth.uid())
  end;
$$;

create or replace function private.company_course_webhook_has_scope(
  p_key private.company_integration_keys, p_subscription private.company_course_webhooks
)
returns boolean language sql stable set search_path = '' as $$
  select p_subscription.revoked_at is null and p_subscription.integration_version = p_key.version
    and p_key.revoked_at is null and p_key.expires_at > statement_timestamp()
    and exists (select 1 from public.organisations o where o.id = p_key.organisation_id and o.archived_at is null)
    and case when (select edition from private.installation_identity) = 'internal' then
      p_key.purpose = 'course-index' and exists (
        select 1 from public.user_roles role join public.profiles profile on profile.id = role.user_id
        where role.user_id = p_key.issued_by and profile.active and role.role in ('admin', 'owner')
      )
    else p_key.purpose = 'academy-webhook' and coalesce(private.academy_course_access_status() = 'active', false)
      and private.academy_local_admin(p_key.issued_by)
    end;
$$;

create function private.company_course_webhook_learning_access(p_company uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select case when (select edition from private.installation_identity) = 'internal'
    then private.is_company_premium_admin() and private.company_premium_enabled(p_company)
    else private.company_course_webhook_admin()
  end;
$$;

create function private.company_course_webhook_delivery_current(
  p_company uuid, p_version integer, p_release text
)
returns boolean language sql stable security invoker set search_path = '' as $$
  select case when (select edition from private.installation_identity) = 'internal'
    then p_release is null and private.company_course_webhook_premium_current(p_company, p_version)
    else p_version is null and coalesce(private.academy_course_access_status() = 'active', false)
      and exists (select 1 from private.academy_course_access where release_commit = p_release)
  end;
$$;

create or replace function private.enqueue_company_course_webhook(
  p_course uuid, p_organisation uuid, p_event text, p_premium boolean default false
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  event_id uuid := gen_random_uuid();
  entitlement_version integer;
  active_release text;
begin
  if (select edition from private.installation_identity) <> 'internal' then
    if private.academy_course_access_status() is distinct from 'active' then return; end if;
    select release_commit into strict active_release from private.academy_course_access;
  elsif p_premium then
    select version into entitlement_version from private.company_premium_settings
    where organisation_id = p_organisation and enabled;
    if not found then return; end if;
  end if;
  insert into private.company_course_webhook_deliveries(
    event_id, subscription_id, course_id, event_type, premium_version, academy_release_commit
  )
    select event_id,s.id,p_course,p_event,entitlement_version,active_release
    from private.company_course_webhooks s join private.company_integration_keys k on k.id = s.integration_id
    where k.organisation_id = p_organisation and private.company_course_webhook_has_scope(k,s)
      and (not p_premium or s.premium_events)
    on conflict(subscription_id,course_id,event_type,source_transaction) do nothing;
end;
$$;

do $migration$
declare
  routine regprocedure;
  body text;
  patch record;
  old_scope constant text := 'private.company_course_webhook_premium_current(k.organisation_id,d.premium_version)';
  new_scope constant text := 'private.company_course_webhook_delivery_current(k.organisation_id,d.premium_version,d.academy_release_commit)';
begin
  foreach routine in array array[
    'private.company_course_webhook_subscribe(uuid,uuid,text,boolean)'::regprocedure,
    'private.company_course_webhook_revoke(uuid,uuid)'::regprocedure,
    'private.company_course_webhook_list(uuid)'::regprocedure
  ] loop
    body := pg_get_functiondef(routine);
    if strpos(body, 'private.company_integration_admin()') = 0 then
      raise exception 'Expected current webhook administrator checks in %', routine;
    end if;
    execute replace(body, 'private.company_integration_admin()', 'private.company_course_webhook_admin()');
  end loop;
  foreach routine in array array[
    'private.company_course_webhook_list(uuid)'::regprocedure,
    'private.lease_company_course_webhook(text[])'::regprocedure,
    'private.prepare_company_course_webhook(uuid,uuid)'::regprocedure
  ] loop
    body := pg_get_functiondef(routine);
    if cardinality(string_to_array(body, old_scope)) <> 2 then
      raise exception 'Expected one queued webhook entitlement check in %', routine;
    end if;
    execute replace(body, old_scope, new_scope);
  end loop;

  for patch in select * from (values
    ('private.company_course_webhook_subscribe(uuid,uuid,text,boolean)'::regprocedure,
      '  if p_premium_events and not private.is_company_premium_admin() then raise insufficient_privilege; end if;',
      '  if p_premium_events and not private.company_course_webhook_learning_access(p_organisation) then raise insufficient_privilege; end if;'),
    ('private.company_course_webhook_subscribe(uuid,uuid,text,boolean)'::regprocedure,
      $old$  if p_premium_events and (not private.is_company_premium_admin() or
    not private.company_premium_enabled(p_organisation)) then raise insufficient_privilege; end if;$old$,
      '  if p_premium_events and not private.company_course_webhook_learning_access(p_organisation) then raise insufficient_privilege; end if;'),
    ('private.company_course_webhook_milestone()'::regprocedure,
      $old$when 'course_resources' then
      if new.audience not in ('all','client') or new.removed_at is not null or$old$,
      $new$when 'course_resources' then
      if (new.audience not in ('all','client') and
        not (new.audience = 'participants' and (select edition from private.installation_identity) <> 'internal'))
        or new.removed_at is not null or$new$),
    ('private.integration_course_index(uuid,text,integer,uuid)'::regprocedure,
      'where id=p_id and secret_hash=decode(p_secret_hash,''hex'')',
      'where id=p_id and purpose=''course-index'' and (select edition from private.installation_identity) = ''internal''
      and secret_hash=decode(p_secret_hash,''hex'')')
  ) as patches(routine, existing, replacement) loop
    body := pg_get_functiondef(patch.routine);
    if cardinality(string_to_array(body, patch.existing)) <> 2 then
      raise exception 'Expected exact permission boundary in %', patch.routine;
    end if;
    execute replace(body, patch.existing, patch.replacement);
  end loop;
end;
$migration$;

-- A subscription is borne by a local administrator and assigned to one
-- existing company. The random hash never leaves the database and is unusable
-- for reads. Its retention and cascade rules match the shared outbox.
create function private.academy_subscribe_course_webhook(p_organisation uuid, p_destination text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  grant_id uuid;
begin
  perform private.lock_academy_administration(actor);
  if not private.company_course_webhook_admin() then raise insufficient_privilege; end if;
  perform 1 from public.organisations where id = p_organisation and archived_at is null for update;
  if not found then raise insufficient_privilege; end if;
  if p_destination is null or p_destination !~ '^[a-z][a-z0-9-]{0,39}$' then
    raise invalid_parameter_value;
  end if;
  if (select count(*) from private.company_integration_keys k
      join private.company_course_webhooks s on s.integration_id = k.id
      where k.organisation_id = p_organisation and private.company_course_webhook_has_scope(k,s)) >= 20 then
    raise program_limit_exceeded;
  end if;
  insert into private.company_integration_keys(organisation_id,label,secret_hash,issued_by,expires_at,purpose)
    values (p_organisation,p_destination,sha256(convert_to(gen_random_uuid()::text,'UTF8')),
      actor,statement_timestamp() + interval '180 days','academy-webhook')
    returning id into grant_id;
  return private.company_course_webhook_subscribe(p_organisation,grant_id,p_destination,true);
end;
$$;

create function private.academy_revoke_course_webhook(p_organisation uuid,p_subscription uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare grant_id uuid;
begin
  perform private.lock_academy_administration(auth.uid());
  if not private.company_course_webhook_admin() then raise insufficient_privilege; end if;
  perform 1 from public.organisations where id = p_organisation for update;
  if not found then raise insufficient_privilege; end if;
  select k.id into grant_id from private.company_integration_keys k
    join private.company_course_webhooks s on s.integration_id = k.id
    where k.organisation_id = p_organisation and k.purpose = 'academy-webhook' and s.id = p_subscription;
  if not found then raise insufficient_privilege; end if;
  perform private.company_course_webhook_revoke(p_organisation,p_subscription);
  update private.company_integration_keys set revoked_at = statement_timestamp(), version = version + 1
    where id = grant_id;
end;
$$;

create function public.academy_subscribe_course_webhook(p_organisation uuid,p_destination text)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.academy_subscribe_course_webhook(p_organisation,p_destination);
$$;

create function public.academy_revoke_course_webhook(p_organisation uuid,p_subscription uuid)
returns void language sql security invoker set search_path = '' as $$
  select private.academy_revoke_course_webhook(p_organisation,p_subscription);
$$;

revoke all on function private.company_course_webhook_admin(),
  private.company_course_webhook_learning_access(uuid),
  private.company_course_webhook_delivery_current(uuid,integer,text),
  private.academy_subscribe_course_webhook(uuid,text),public.academy_subscribe_course_webhook(uuid,text),
  private.academy_revoke_course_webhook(uuid,uuid),public.academy_revoke_course_webhook(uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.academy_subscribe_course_webhook(uuid,text),
  public.academy_subscribe_course_webhook(uuid,text),private.academy_revoke_course_webhook(uuid,uuid),
  public.academy_revoke_course_webhook(uuid,uuid) to authenticated;

create function private.academy_webhook_worker_request_allowed()
returns boolean language sql stable security definer set search_path = '' as $$
  select current_setting('role',true) = 'service_role'
    and current_setting('request.method',true) = 'POST'
    and current_setting('request.path',true) in (
      '/rpc/lease_company_course_webhook','/rpc/prepare_company_course_webhook','/rpc/finish_company_course_webhook'
    )
    and coalesce(coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb->>'accept-profile','public') = 'public'
    and coalesce(coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb->>'content-profile','public') = 'public'
    and coalesce(private.academy_course_access_status() = 'active', false);
$$;
revoke all on function private.academy_webhook_worker_request_allowed() from public,anon,authenticated,service_role;
grant execute on function private.academy_webhook_worker_request_allowed() to service_role;

do $migration$
declare
  public_gate text := pg_get_functiondef('public.require_portal_access()'::regprocedure);
  academy_gate text := pg_get_functiondef('private.require_academy_course_access()'::regprocedure);
  service_anchor constant text := '      perform private.require_academy_human_login_access();';
  admin_anchor constant text := '  licence_status := private.academy_course_access_status();';
begin
  if cardinality(string_to_array(public_gate, service_anchor)) <> 2
    or cardinality(string_to_array(academy_gate, admin_anchor)) <> 2 then
    raise exception 'Expected exact academy webhook gateway anchors';
  end if;
  execute replace(public_gate, service_anchor, $gate$      if private.academy_webhook_worker_request_allowed() then return; end if;
$gate$ || service_anchor);
  execute replace(academy_gate, admin_anchor, admin_anchor || $gate$
  if licence_status = 'active' and request_method = 'POST' and request_path in (
    '/rpc/company_course_webhook_list','/rpc/academy_subscribe_course_webhook','/rpc/academy_revoke_course_webhook'
  ) then return; end if;$gate$);
end;
$migration$;

notify pgrst, 'reload schema';
commit;
