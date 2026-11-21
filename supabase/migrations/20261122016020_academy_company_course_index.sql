begin;

-- Dedicated course-index credentials grant the same narrow published-course
-- projection as internal keys. Webhook-only authorisation records remain separate.
create function private.course_index_integration_issuer(p_user_id uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select case when (select edition from private.installation_identity) = 'internal'
    then exists (
      select 1 from public.profiles profile join public.user_roles role on role.user_id = profile.id
      where profile.id = p_user_id and profile.active and role.role in ('admin','owner')
    )
    else coalesce(private.academy_course_access_status() = 'active', false)
      and private.academy_local_admin(p_user_id)
  end;
$$;
revoke all on function private.course_index_integration_issuer(uuid) from public,anon,authenticated,service_role;

create or replace function private.company_integration_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select private.actor_active() and private.course_index_integration_issuer(auth.uid());
$$;

do $migration$
declare
  patch record;
  body text;
begin
  for patch in select * from (values
    ('private.company_integration_keys(uuid)'::regprocedure,
      'where organisation_id = p_organisation_id',
      'where organisation_id = p_organisation_id and purpose = ''course-index'''),
    ('private.issue_company_integration_key(uuid,text,timestamptz,uuid,integer)'::regprocedure,
      'where organisation_id=p_organisation_id and revoked_at is null and expires_at > now()',
      'where organisation_id=p_organisation_id and purpose=''course-index'' and revoked_at is null and expires_at > now()'),
    ('private.issue_company_integration_key(uuid,text,timestamptz,uuid,integer)'::regprocedure,
      'where id=p_rotate_id and organisation_id=p_organisation_id and revoked_at is null',
      'where id=p_rotate_id and organisation_id=p_organisation_id and purpose=''course-index'' and revoked_at is null'),
    ('private.revoke_company_integration_key(uuid,integer)'::regprocedure,
      'where id=p_id and version=p_expected_version and revoked_at is null',
      'where id=p_id and version=p_expected_version and purpose=''course-index'' and revoked_at is null'),
    ('private.integration_course_index(uuid,text,integer,uuid)'::regprocedure,
      'where id=p_id and purpose=''course-index'' and (select edition from private.installation_identity) = ''internal''',
      'where id=p_id and purpose=''course-index'''),
    ('private.integration_course_index(uuid,text,integer,uuid)'::regprocedure,
      $old$not exists(select 1 from public.user_roles r join public.profiles p on p.id=r.user_id
       where r.user_id=key_row.issued_by and p.active and r.role in ('admin','owner'))$old$,
      'not private.course_index_integration_issuer(key_row.issued_by)')
  ) as patches(routine, old_fragment, new_fragment) loop
    body := pg_get_functiondef(patch.routine);
    if cardinality(string_to_array(body,patch.old_fragment))<>2 then
      raise exception 'Expected exact scoped integration boundary in %', patch.routine;
    end if;
    execute replace(body,patch.old_fragment,patch.new_fragment);
  end loop;
end;
$migration$;

-- The only dedicated service-role entry is the existing dispatcher. The Edge
-- worker exchanges each opaque key for a hash, never for a Supabase JWT.
create function private.academy_course_index_service_allowed()
returns boolean language sql stable security definer set search_path = '' as $$
  select current_setting('role',true) = 'service_role'
    and current_setting('request.method',true) = 'POST'
    and current_setting('request.path',true) = '/rpc/integration_course_index'
    and coalesce(coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb->>'accept-profile','public') = 'public'
    and coalesce(coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb->>'content-profile','public') = 'public'
    and (select edition from private.installation_identity) <> 'internal';
$$;
revoke all on function private.academy_course_index_service_allowed() from public,anon,authenticated,service_role;
grant execute on function private.academy_course_index_service_allowed() to service_role;

do $migration$
declare
  public_gate text := pg_get_functiondef('public.require_portal_access()'::regprocedure);
  academy_gate text := pg_get_functiondef('private.require_academy_course_access()'::regprocedure);
  service_anchor constant text := '      perform private.require_academy_human_login_access();';
  admin_anchor constant text := '  licence_status := private.academy_course_access_status();';
begin
  if cardinality(string_to_array(public_gate,service_anchor))<>2
     or cardinality(string_to_array(academy_gate,admin_anchor))<>2 then
    raise exception 'Expected one current Academy integration gateway anchor';
  end if;
  execute replace(public_gate,service_anchor,$gate$      if private.academy_course_index_service_allowed() then return; end if;
$gate$ || service_anchor);
  execute replace(academy_gate,admin_anchor,admin_anchor || $gate$
  if licence_status = 'active' and request_method = 'POST' and request_path in (
    '/rpc/company_integration_keys','/rpc/issue_company_integration_key','/rpc/revoke_company_integration_key'
  ) then return; end if;$gate$);
end;
$migration$;

notify pgrst, 'reload schema';
commit;
