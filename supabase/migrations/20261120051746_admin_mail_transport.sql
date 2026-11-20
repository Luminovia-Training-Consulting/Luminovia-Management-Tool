begin;

-- Mail credentials are encrypted by Supabase Vault and are never returned to
-- authenticated callers. Only the internal relay and notification worker may
-- read them through service-role-only RPCs.
create schema if not exists vault;
create extension if not exists supabase_vault with schema vault;

insert into public.role_permissions(role, permission)
values ('admin', 'mail.settings.manage'), ('owner', 'mail.settings.manage')
on conflict do nothing;

create table private.mail_transport_settings (
  singleton boolean primary key default true check (singleton),
  version integer not null default 0 check (version >= 0),
  smtp_enabled boolean not null default false,
  smtp_host text,
  smtp_port integer,
  smtp_security text,
  smtp_sender_email text,
  smtp_sender_name text,
  smtp_secret_id uuid,
  imap_enabled boolean not null default false,
  imap_host text,
  imap_port integer,
  imap_security text,
  imap_secret_id uuid,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  constraint mail_smtp_transport_valid check (
    (smtp_port is null and smtp_security is null) or
    (smtp_port = 465 and smtp_security = 'implicit_tls') or
    (smtp_port = 587 and smtp_security = 'starttls')
  ),
  constraint mail_imap_transport_valid check (
    (imap_port is null and imap_security is null) or
    (imap_port = 993 and imap_security = 'implicit_tls') or
    (imap_port = 143 and imap_security = 'starttls')
  )
);
insert into private.mail_transport_settings(singleton) values (true);
revoke all on private.mail_transport_settings from public, anon, authenticated, service_role;

-- Accept public DNS names only. The relay pins its socket to a resolved public
-- address and verifies TLS against this original DNS name to resist rebinding.
create function private.valid_mail_host(p_host text)
returns boolean
language plpgsql
immutable
security definer
set search_path = ''
as $$
declare
  label text;
begin
  if p_host is null or length(p_host) > 253 or p_host <> lower(p_host) or
     p_host !~ '^[a-z0-9.-]+$' or p_host ~ '^[0-9.]+$' or
     p_host like '%..%' or left(p_host, 1) in ('.', '-') or
     right(p_host, 1) in ('.', '-') or
     p_host ~ '(^|[.])(localhost|local|internal|test|invalid|onion)$' then
    return false;
  end if;
  if cardinality(string_to_array(p_host, '.')) < 2 then return false; end if;
  foreach label in array string_to_array(p_host, '.') loop
    if length(label) > 63 or label !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$' then
      return false;
    end if;
  end loop;
  return true;
end;
$$;
revoke all on function private.valid_mail_host(text)
  from public, anon, authenticated, service_role;

create table private.mail_connection_tests (
  id uuid primary key default gen_random_uuid(),
  protocol text not null check (protocol in ('smtp', 'imap')),
  settings_version integer not null,
  requested_by uuid not null references auth.users(id),
  status text not null default 'pending'
    check (status in ('pending', 'running', 'succeeded', 'failed')),
  error_code text check (
    error_code is null or error_code in (
      'configuration_changed', 'configuration_unavailable', 'connect_failed',
      'tls_failed', 'authentication_failed', 'protocol_failed', 'timeout'
    )
  ),
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  expires_at timestamptz not null default now() + interval '2 minutes'
);
create index mail_connection_tests_actor_time
  on private.mail_connection_tests(requested_by, created_at desc);
create index mail_connection_tests_pending
  on private.mail_connection_tests(expires_at)
  where status in ('pending', 'running');
revoke all on private.mail_connection_tests from public, anon, authenticated, service_role;

create table private.mail_configuration_audit (
  id bigint generated always as identity primary key,
  actor_id uuid not null references auth.users(id),
  settings_version integer not null,
  action text not null check (action in ('saved', 'smtp_tested', 'imap_tested')),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
revoke all on private.mail_configuration_audit from public, anon, authenticated, service_role;

-- Privileged configuration changes require a current admin/owner capability.
create function private.mail_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.actor_active() and private.has_permission('mail.settings.manage');
$$;
revoke all on function private.mail_admin() from public, anon, authenticated, service_role;

-- Service-only RPCs verify the original JWT role before exposing Vault values.
create function private.mail_service_caller()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true)::jsonb->>'role', '')
  ) = 'service_role';
$$;
revoke all on function private.mail_service_caller() from public, anon, authenticated, service_role;

-- Return status only; usernames and passwords never enter the admin UI payload.
create function private.get_mail_configuration()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  settings_row private.mail_transport_settings%rowtype;
begin
  if not private.mail_admin() then
    raise exception 'Mail configuration access denied' using errcode = '42501';
  end if;
  select * into settings_row
  from private.mail_transport_settings where singleton;
  return jsonb_build_object(
    'version', settings_row.version,
    'smtp', jsonb_build_object(
      'enabled', settings_row.smtp_enabled,
      'host', settings_row.smtp_host,
      'port', settings_row.smtp_port,
      'security', settings_row.smtp_security,
      'sender_email', settings_row.smtp_sender_email,
      'sender_name', settings_row.smtp_sender_name,
      'credentials_configured', settings_row.smtp_secret_id is not null,
      'last_test', (
        select jsonb_build_object(
          'status', test.status, 'error_code', test.error_code,
          'created_at', test.created_at, 'finished_at', test.finished_at
        )
        from private.mail_connection_tests test
        where test.protocol = 'smtp' and test.settings_version = settings_row.version
        order by test.created_at desc limit 1
      )
    ),
    'imap', jsonb_build_object(
      'enabled', settings_row.imap_enabled,
      'host', settings_row.imap_host,
      'port', settings_row.imap_port,
      'security', settings_row.imap_security,
      'credentials_configured', settings_row.imap_secret_id is not null,
      'last_test', (
        select jsonb_build_object(
          'status', test.status, 'error_code', test.error_code,
          'created_at', test.created_at, 'finished_at', test.finished_at
        )
        from private.mail_connection_tests test
        where test.protocol = 'imap' and test.settings_version = settings_row.version
        order by test.created_at desc limit 1
      )
    )
  );
end;
$$;

-- Save mutable transport metadata with compare-and-set versioning. Credentials
-- are replaced only when both write-only fields are supplied together.
create function private.save_mail_configuration(
  p_expected_version integer, p_smtp jsonb, p_imap jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  settings_row private.mail_transport_settings%rowtype;
  smtp_enabled_value boolean;
  smtp_host_value text;
  smtp_port_value integer;
  smtp_security_value text;
  smtp_sender_email_value text;
  smtp_sender_name_value text;
  smtp_username_value text;
  smtp_password_value text;
  smtp_secret_value jsonb;
  smtp_secret_id_value uuid;
  imap_enabled_value boolean;
  imap_host_value text;
  imap_port_value integer;
  imap_security_value text;
  imap_username_value text;
  imap_password_value text;
  imap_secret_value jsonb;
  imap_secret_id_value uuid;
begin
  if not private.mail_admin() then
    raise exception 'Mail configuration access denied' using errcode = '42501';
  end if;
  if p_expected_version is null or p_expected_version < 0 or
     p_smtp is null or p_imap is null or
     jsonb_typeof(p_smtp) <> 'object' or jsonb_typeof(p_imap) <> 'object' or
     jsonb_typeof(p_smtp->'enabled') <> 'boolean' or
     jsonb_typeof(p_imap->'enabled') <> 'boolean' then
    raise exception 'Invalid mail configuration' using errcode = '22023';
  end if;
  if (p_smtp - array['enabled','host','port','security','sender_email','sender_name','username','password']) <> '{}'::jsonb or
     (p_imap - array['enabled','host','port','security','username','password']) <> '{}'::jsonb then
    raise exception 'Unknown mail configuration field' using errcode = '22023';
  end if;

  select * into settings_row
  from private.mail_transport_settings where singleton for update;
  if not found or settings_row.version <> p_expected_version then
    raise exception 'Mail configuration version conflict' using errcode = '40001';
  end if;

  smtp_enabled_value := (p_smtp->>'enabled')::boolean;
  smtp_host_value := lower(trim(coalesce(p_smtp->>'host', '')));
  smtp_sender_email_value := lower(trim(coalesce(p_smtp->>'sender_email', '')));
  smtp_sender_name_value := trim(coalesce(p_smtp->>'sender_name', ''));
  smtp_username_value := nullif(trim(coalesce(p_smtp->>'username', '')), '');
  smtp_password_value := nullif(coalesce(p_smtp->>'password', ''), '');
  smtp_secret_id_value := settings_row.smtp_secret_id;

  if p_smtp ? 'port' and p_smtp->'port' <> 'null'::jsonb then
    if jsonb_typeof(p_smtp->'port') <> 'number' or
       p_smtp->>'port' !~ '^[0-9]+$' then
      raise exception 'Invalid SMTP port' using errcode = '22023';
    end if;
    smtp_port_value := (p_smtp->>'port')::integer;
  end if;
  smtp_security_value := coalesce(p_smtp->>'security', '');
  if smtp_enabled_value then
    if not private.valid_mail_host(smtp_host_value) or
       smtp_sender_email_value !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,63}$' or
       length(smtp_sender_email_value) > 254 or
       smtp_sender_name_value = '' or length(smtp_sender_name_value) > 120 or
       smtp_sender_name_value ~ '[[:cntrl:]]' or
       smtp_port_value is null or smtp_port_value not in (465, 587) or
       (smtp_port_value = 465 and smtp_security_value <> 'implicit_tls') or
       (smtp_port_value = 587 and smtp_security_value <> 'starttls') then
      raise exception 'Invalid SMTP transport' using errcode = '22023';
    end if;
    if (smtp_username_value is null) <> (smtp_password_value is null) then
      raise exception 'SMTP username and password must rotate together' using errcode = '22023';
    end if;
    if smtp_username_value is not null then
      if smtp_username_value !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,63}$' or
         length(smtp_username_value) > 254 or length(smtp_password_value) > 1024 or
         smtp_password_value ~ '[[:cntrl:]]' then
        raise exception 'Invalid SMTP credentials' using errcode = '22023';
      end if;
      smtp_secret_value := jsonb_build_object(
        'username', smtp_username_value, 'password', smtp_password_value
      );
      if smtp_secret_id_value is null then
        smtp_secret_id_value := vault.create_secret(
          smtp_secret_value::text, null, 'Luminovia SMTP transport credentials'
        );
      else
        perform vault.update_secret(smtp_secret_id_value, smtp_secret_value::text);
      end if;
    elsif smtp_secret_id_value is null then
      raise exception 'SMTP credentials are required' using errcode = '22023';
    end if;
  elsif smtp_port_value is null then
    smtp_host_value := settings_row.smtp_host;
    smtp_port_value := settings_row.smtp_port;
    smtp_security_value := settings_row.smtp_security;
    smtp_sender_email_value := settings_row.smtp_sender_email;
    smtp_sender_name_value := settings_row.smtp_sender_name;
  end if;

  imap_enabled_value := (p_imap->>'enabled')::boolean;
  imap_host_value := lower(trim(coalesce(p_imap->>'host', '')));
  imap_username_value := nullif(trim(coalesce(p_imap->>'username', '')), '');
  imap_password_value := nullif(coalesce(p_imap->>'password', ''), '');
  imap_secret_id_value := settings_row.imap_secret_id;
  if p_imap ? 'port' and p_imap->'port' <> 'null'::jsonb then
    if jsonb_typeof(p_imap->'port') <> 'number' or
       p_imap->>'port' !~ '^[0-9]+$' then
      raise exception 'Invalid IMAP port' using errcode = '22023';
    end if;
    imap_port_value := (p_imap->>'port')::integer;
  end if;
  imap_security_value := coalesce(p_imap->>'security', '');
  if imap_enabled_value then
    if not private.valid_mail_host(imap_host_value) or
       imap_port_value is null or imap_port_value not in (143, 993) or
       (imap_port_value = 993 and imap_security_value <> 'implicit_tls') or
       (imap_port_value = 143 and imap_security_value <> 'starttls') then
      raise exception 'Invalid IMAP transport' using errcode = '22023';
    end if;
    if (imap_username_value is null) <> (imap_password_value is null) then
      raise exception 'IMAP username and password must rotate together' using errcode = '22023';
    end if;
    if imap_username_value is not null then
      if imap_username_value !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,63}$' or
         length(imap_username_value) > 254 or length(imap_password_value) > 1024 or
         imap_password_value ~ '[[:cntrl:]]' then
        raise exception 'Invalid IMAP credentials' using errcode = '22023';
      end if;
      imap_secret_value := jsonb_build_object(
        'username', imap_username_value, 'password', imap_password_value
      );
      if imap_secret_id_value is null then
        imap_secret_id_value := vault.create_secret(
          imap_secret_value::text, null, 'Luminovia IMAP transport credentials'
        );
      else
        perform vault.update_secret(imap_secret_id_value, imap_secret_value::text);
      end if;
    elsif imap_secret_id_value is null then
      raise exception 'IMAP credentials are required' using errcode = '22023';
    end if;
  elsif imap_port_value is null then
    imap_host_value := settings_row.imap_host;
    imap_port_value := settings_row.imap_port;
    imap_security_value := settings_row.imap_security;
  end if;

  update private.mail_transport_settings set
    version = version + 1,
    smtp_enabled = smtp_enabled_value,
    smtp_host = smtp_host_value,
    smtp_port = smtp_port_value,
    smtp_security = smtp_security_value,
    smtp_sender_email = smtp_sender_email_value,
    smtp_sender_name = smtp_sender_name_value,
    smtp_secret_id = smtp_secret_id_value,
    imap_enabled = imap_enabled_value,
    imap_host = imap_host_value,
    imap_port = imap_port_value,
    imap_security = imap_security_value,
    imap_secret_id = imap_secret_id_value,
    updated_by = auth.uid(),
    updated_at = now()
  where singleton;
  insert into private.mail_configuration_audit(actor_id, settings_version, action, details)
  values (
    auth.uid(), settings_row.version + 1, 'saved',
    jsonb_build_object(
      'smtp_enabled', smtp_enabled_value,
      'smtp_host', smtp_host_value,
      'smtp_sender_email', smtp_sender_email_value,
      'imap_enabled', imap_enabled_value,
      'imap_host', imap_host_value
    )
  );
  return private.get_mail_configuration();
end;
$$;

-- Queue a short-lived, version-bound test request. The relay will consume it
-- exactly once and never receive credentials from the browser or Edge handler.
create function private.queue_mail_connection_test(p_protocol text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  settings_row private.mail_transport_settings%rowtype;
  test_id uuid;
begin
  if not private.mail_admin() then
    raise exception 'Mail configuration access denied' using errcode = '42501';
  end if;
  if p_protocol is null or p_protocol not in ('smtp', 'imap') then
    raise exception 'Invalid mail protocol' using errcode = '22023';
  end if;
  select * into settings_row
  from private.mail_transport_settings where singleton;
  if p_protocol = 'smtp' and
     (not settings_row.smtp_enabled or settings_row.smtp_secret_id is null) then
    raise exception 'SMTP configuration is incomplete' using errcode = '22023';
  end if;
  if p_protocol = 'imap' and
     (not settings_row.imap_enabled or settings_row.imap_secret_id is null) then
    raise exception 'IMAP configuration is incomplete' using errcode = '22023';
  end if;
  insert into private.mail_connection_tests(
    protocol, settings_version, requested_by
  ) values (p_protocol, settings_row.version, auth.uid())
  returning id into test_id;
  insert into private.mail_configuration_audit(actor_id, settings_version, action, details)
  values (
    auth.uid(), settings_row.version, p_protocol || '_tested',
    jsonb_build_object('status', 'requested')
  );
  return test_id;
end;
$$;

-- Relay-only claim returns exactly one protocol's decrypted credentials after
-- verifying the test is pending and still targets the current settings version.
create function private.claim_mail_connection_test(p_test_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  test_row private.mail_connection_tests%rowtype;
  settings_row private.mail_transport_settings%rowtype;
  secret_id_value uuid;
  secret_value jsonb;
begin
  if not private.mail_service_caller() then
    raise exception 'Mail relay required' using errcode = '42501';
  end if;
  select * into test_row
  from private.mail_connection_tests
  where id = p_test_id
  for update;
  if not found or test_row.status <> 'pending' or test_row.expires_at <= now() then
    return jsonb_build_object('status', 'failed', 'error_code', 'configuration_changed');
  end if;
  select * into settings_row
  from private.mail_transport_settings where singleton;
  if settings_row.version <> test_row.settings_version then
    update private.mail_connection_tests
    set status = 'failed', error_code = 'configuration_changed', finished_at = now()
    where id = p_test_id;
    return jsonb_build_object('status', 'failed', 'error_code', 'configuration_changed');
  end if;
  if test_row.protocol = 'smtp' then
    if not settings_row.smtp_enabled then
      update private.mail_connection_tests
      set status = 'failed', error_code = 'configuration_unavailable', finished_at = now()
      where id = p_test_id;
      return jsonb_build_object('status', 'failed', 'error_code', 'configuration_unavailable');
    end if;
    secret_id_value := settings_row.smtp_secret_id;
    select decrypted_secret::jsonb into secret_value
    from vault.decrypted_secrets where id = secret_id_value;
    update private.mail_connection_tests set status = 'running' where id = p_test_id;
    return jsonb_build_object(
      'status', 'running', 'protocol', 'smtp',
      'host', settings_row.smtp_host, 'port', settings_row.smtp_port,
      'security', settings_row.smtp_security,
      'sender_email', settings_row.smtp_sender_email,
      'username', secret_value->>'username', 'password', secret_value->>'password'
    );
  end if;
  if not settings_row.imap_enabled then
    update private.mail_connection_tests
    set status = 'failed', error_code = 'configuration_unavailable', finished_at = now()
    where id = p_test_id;
    return jsonb_build_object('status', 'failed', 'error_code', 'configuration_unavailable');
  end if;
  secret_id_value := settings_row.imap_secret_id;
  select decrypted_secret::jsonb into secret_value
  from vault.decrypted_secrets where id = secret_id_value;
  update private.mail_connection_tests set status = 'running' where id = p_test_id;
  return jsonb_build_object(
    'status', 'running', 'protocol', 'imap',
    'host', settings_row.imap_host, 'port', settings_row.imap_port,
    'security', settings_row.imap_security,
    'username', secret_value->>'username', 'password', secret_value->>'password'
  );
end;
$$;

-- Complete a running test with an allowlisted status code, never provider text.
create function private.complete_mail_connection_test(
  p_test_id uuid, p_success boolean, p_error_code text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  test_row private.mail_connection_tests%rowtype;
  settings_row private.mail_transport_settings%rowtype;
  final_error text;
begin
  if not private.mail_service_caller() then
    raise exception 'Mail relay required' using errcode = '42501';
  end if;
  if p_success is null or (p_success and p_error_code is not null) or
     (not p_success and (p_error_code is null or p_error_code not in (
       'connect_failed', 'tls_failed', 'authentication_failed',
       'protocol_failed', 'timeout', 'configuration_changed',
       'configuration_unavailable'
     ))) then
    raise exception 'Invalid mail test result' using errcode = '22023';
  end if;
  select * into test_row
  from private.mail_connection_tests where id = p_test_id for update;
  if not found or test_row.status <> 'running' then return false; end if;
  select * into settings_row
  from private.mail_transport_settings where singleton;
  final_error := case
    when settings_row.version <> test_row.settings_version then 'configuration_changed'
    when p_success then null
    else p_error_code
  end;
  update private.mail_connection_tests set
    status = case when final_error is null then 'succeeded' else 'failed' end,
    error_code = final_error,
    finished_at = now()
  where id = p_test_id;
  insert into private.mail_configuration_audit(actor_id, settings_version, action, details)
  values (
    test_row.requested_by, test_row.settings_version, test_row.protocol || '_tested',
    jsonb_build_object(
      'status', case when final_error is null then 'succeeded' else 'failed' end,
      'error_code', final_error
    )
  );
  return final_error is null;
end;
$$;

-- Fetch current active SMTP settings for the internal Auth relay and the finite
-- notification worker. This is the only general-purpose credential read path.
create function private.mail_delivery_transport()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  settings_row private.mail_transport_settings%rowtype;
  secret_value jsonb;
begin
  if not private.mail_service_caller() then
    raise exception 'Mail worker required' using errcode = '42501';
  end if;
  select * into settings_row
  from private.mail_transport_settings where singleton;
  if not settings_row.smtp_enabled or settings_row.smtp_secret_id is null then
    return jsonb_build_object('enabled', false, 'version', settings_row.version);
  end if;
  select decrypted_secret::jsonb into secret_value
  from vault.decrypted_secrets where id = settings_row.smtp_secret_id;
  if secret_value is null then
    return jsonb_build_object('enabled', false, 'version', settings_row.version);
  end if;
  return jsonb_build_object(
    'enabled', true, 'version', settings_row.version,
    'host', settings_row.smtp_host, 'port', settings_row.smtp_port,
    'security', settings_row.smtp_security,
    'sender_email', settings_row.smtp_sender_email,
    'sender_name', settings_row.smtp_sender_name,
    'username', secret_value->>'username',
    'password', secret_value->>'password'
  );
end;
$$;

-- Public entry points stay SECURITY INVOKER. Their explicitly narrow EXECUTE
-- grants delegate authorization to the private implementations above.
create function public.get_mail_configuration()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$ select private.get_mail_configuration(); $$;

create function public.save_mail_configuration(
  p_expected_version integer, p_smtp jsonb, p_imap jsonb
) returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.save_mail_configuration(p_expected_version, p_smtp, p_imap); $$;

create function public.queue_mail_connection_test(p_protocol text)
returns uuid
language sql
security invoker
set search_path = ''
as $$ select private.queue_mail_connection_test(p_protocol); $$;

create function public.claim_mail_connection_test(p_test_id uuid)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.claim_mail_connection_test(p_test_id); $$;

create function public.complete_mail_connection_test(
  p_test_id uuid, p_success boolean, p_error_code text
) returns boolean
language sql
security invoker
set search_path = ''
as $$ select private.complete_mail_connection_test(p_test_id, p_success, p_error_code); $$;

create function public.get_mail_delivery_transport()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$ select private.mail_delivery_transport(); $$;

revoke all on function private.get_mail_configuration() from public, anon, authenticated, service_role;
revoke all on function private.save_mail_configuration(integer, jsonb, jsonb) from public, anon, authenticated, service_role;
revoke all on function private.queue_mail_connection_test(text) from public, anon, authenticated, service_role;
revoke all on function private.claim_mail_connection_test(uuid) from public, anon, authenticated, service_role;
revoke all on function private.complete_mail_connection_test(uuid, boolean, text) from public, anon, authenticated, service_role;
revoke all on function private.mail_delivery_transport() from public, anon, authenticated, service_role;
grant execute on function private.get_mail_configuration() to authenticated;
grant execute on function private.save_mail_configuration(integer, jsonb, jsonb) to authenticated;
grant execute on function private.queue_mail_connection_test(text) to authenticated;
grant execute on function private.claim_mail_connection_test(uuid) to service_role;
grant execute on function private.complete_mail_connection_test(uuid, boolean, text) to service_role;
grant execute on function private.mail_delivery_transport() to service_role;

revoke all on function public.get_mail_configuration() from public, anon;
revoke all on function public.save_mail_configuration(integer, jsonb, jsonb) from public, anon;
revoke all on function public.queue_mail_connection_test(text) from public, anon;
revoke all on function public.claim_mail_connection_test(uuid) from public, anon, authenticated;
revoke all on function public.complete_mail_connection_test(uuid, boolean, text) from public, anon, authenticated;
revoke all on function public.get_mail_delivery_transport() from public, anon, authenticated;
grant execute on function public.get_mail_configuration() to authenticated;
grant execute on function public.save_mail_configuration(integer, jsonb, jsonb) to authenticated;
grant execute on function public.queue_mail_connection_test(text) to authenticated;
grant execute on function public.claim_mail_connection_test(uuid) to service_role;
grant execute on function public.complete_mail_connection_test(uuid, boolean, text) to service_role;
grant execute on function public.get_mail_delivery_transport() to service_role;

commit;
