begin;

create function private.academy_mail_installation()
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists (select 1 from private.installation_identity where singleton and edition <> 'internal');
$$;

create function private.academy_mail_admin(p_actor uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select private.academy_local_admin(p_actor) and exists (
    select 1 from public.role_permissions where role = 'admin' and permission = 'mail.settings.manage'
  );
$$;

create or replace function private.mail_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select case when private.academy_mail_installation() then
    coalesce(private.academy_course_access_status() in ('active', 'grace'), false)
      and private.academy_mail_admin(auth.uid())
  else private.actor_active() and private.has_permission('mail.settings.manage')
  end;
$$;

create function private.require_mail_admin_write()
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if not private.mail_admin() then raise insufficient_privilege; end if;
  if private.academy_mail_installation() then
    perform private.lock_academy_administration(auth.uid());
    if not private.academy_mail_admin(auth.uid()) then raise insufficient_privilege; end if;
  end if;
end;
$$;

revoke all on function private.academy_mail_installation(),
  private.academy_mail_admin(uuid), private.require_mail_admin_write()
  from public, anon, authenticated, service_role;

-- Reuse the existing Vault, compare-and-set settings and single-use relay test.
-- Assert that each substitution still targets exactly one current function.
do $$
declare
  source text;
  patch record;
  admin_check constant text := $guard$  if not private.mail_admin() then
    raise exception 'Mail configuration access denied' using errcode = '42501';
  end if;$guard$;
begin
  for patch in select * from (values
    ('private.save_mail_configuration(integer,jsonb,jsonb)'::regprocedure,
      admin_check,
      $change$  perform private.require_mail_admin_write();
  if private.academy_mail_installation() and p_imap is distinct from '{"enabled":false}'::jsonb then
    raise insufficient_privilege;
  end if;$change$),
    ('private.save_mail_configuration(integer,jsonb,jsonb)'::regprocedure,
      'Mail configuration version conflict'' using errcode = ''40001',
      'Mail configuration version conflict'' using errcode = ''PT409'),
    ('private.queue_mail_connection_test(text)'::regprocedure,
      admin_check,
      $change$  perform private.require_mail_admin_write();
  if private.academy_mail_installation() and p_protocol is distinct from 'smtp' then
    raise insufficient_privilege;
  end if;$change$),
    ('private.claim_mail_connection_test(uuid)'::regprocedure,
      $anchor$  select * into test_row
  from private.mail_connection_tests
  where id = p_test_id
  for update;$anchor$,
      $change$  if private.academy_mail_installation() then
    perform 1 from private.installation_identity where singleton for share;
  end if;
  select * into test_row
  from private.mail_connection_tests
  where id = p_test_id
  for update;$change$),
    ('private.claim_mail_connection_test(uuid)'::regprocedure,
      $anchor$  if settings_row.version <> test_row.settings_version then$anchor$,
      $change$  if private.academy_mail_installation() then
    perform 1 from public.profiles where id = test_row.requested_by and active for share;
    perform 1 from public.user_roles where user_id = test_row.requested_by order by role for share;
    if private.academy_course_access_status() is distinct from 'active'
       or test_row.protocol <> 'smtp' or not private.academy_mail_admin(test_row.requested_by) then
      update private.mail_connection_tests
      set status = 'failed', error_code = 'configuration_changed', finished_at = now()
      where id = p_test_id;
      return jsonb_build_object('status', 'failed', 'error_code', 'configuration_changed');
    end if;
  end if;
  if settings_row.version <> test_row.settings_version then$change$),
    ('private.mail_delivery_transport()'::regprocedure,
      $anchor$  if not settings_row.smtp_enabled or settings_row.smtp_secret_id is null then$anchor$,
      $change$  if (private.academy_mail_installation() and
      not coalesce(private.academy_course_access_status() in ('active', 'grace'), false))
     or not settings_row.smtp_enabled or settings_row.smtp_secret_id is null then$change$),
    ('private.require_academy_course_access()'::regprocedure,
      $anchor$  licence_status := private.academy_course_access_status();$anchor$,
      $change$  licence_status := private.academy_course_access_status();
  if request_method = 'POST' and private.academy_mail_admin(auth.uid()) and (
    (licence_status in ('active', 'grace') and request_path = '/rpc/get_mail_configuration')
    or (licence_status = 'active' and request_path in (
      '/rpc/save_mail_configuration', '/rpc/queue_mail_connection_test'
    ))
  ) then
    return;
  end if;$change$),
    ('public.require_portal_access()'::regprocedure,
      $anchor$      perform private.require_academy_human_login_access();$anchor$,
      $change$      if current_setting('request.method', true) = 'POST'
         and current_setting('request.path', true) in (
           '/rpc/claim_mail_connection_test', '/rpc/complete_mail_connection_test',
           '/rpc/get_mail_delivery_transport'
         )
         and coalesce(request_headers->>'accept-profile', 'public') = 'public'
         and coalesce(request_headers->>'content-profile', 'public') = 'public' then
        return;
      end if;
      perform private.require_academy_human_login_access();$change$)
  ) as patches(routine, anchor, replacement)
  loop
    source := pg_get_functiondef(patch.routine);
    if cardinality(string_to_array(source, patch.anchor)) <> 2 then
      raise exception 'Could not apply academy mail transport boundary to %', patch.routine;
    end if;
    execute replace(source, patch.anchor, patch.replacement);
  end loop;
end;
$$;

notify pgrst, 'reload schema';
commit;
