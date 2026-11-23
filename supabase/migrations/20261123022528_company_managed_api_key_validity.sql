begin;

-- Webhook credentials retain their independent issuer rules. Only incoming
-- company API keys delegate authority to the owning company's current users.
create function private.company_integration_issuer_allowed(p_user_id uuid, p_organisation_id uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select private.course_index_integration_issuer(p_user_id) or (
    (select edition = 'internal' from private.installation_identity)
    and exists (
      select 1 from public.profiles profile
      join public.user_roles account_role on account_role.user_id = profile.id
      where profile.id = p_user_id and profile.active
        and (
          (account_role.role = 'management' and exists (
            select 1 from public.role_permissions permission
            where permission.role = account_role.role and permission.permission = 'organisations.manage'
          ))
          or (account_role.role = 'client' and exists (
            select 1 from public.client_organisation_memberships membership
            join public.organisations company on company.id = membership.organisation_id
            where membership.user_id = profile.id and membership.organisation_id = p_organisation_id
              and membership.removed_at is null and company.archived_at is null
          ))
        )
    )
  );
$$;

revoke all on function private.company_integration_issuer_allowed(uuid, uuid)
from public, anon, authenticated, service_role;

-- Infinity preserves the existing deadline checks, active-key quota and
-- attached webhook lifecycle. The public key list represents it as JSON null.
do $migration$
declare
  patch record;
  definition text;
begin
  for patch in select * from (values
    ('private.company_integration_keys(uuid)'::regprocedure,
      'if not private.company_integration_admin()',
      'if not (private.actor_active() and private.company_integration_issuer_allowed(auth.uid(),p_organisation_id))'),
    ('private.company_integration_keys(uuid)'::regprocedure,
      'select id,label,created_at,expires_at,revoked_at,version,last_used_at,',
      'select id,label,created_at,nullif(expires_at,''infinity''::timestamptz) as expires_at,revoked_at,version,last_used_at,'),
    ('private.company_integration_keys(uuid)'::regprocedure,
      'select jsonb_agg(to_jsonb(k) order by k.created_at desc,k.id)',
      $new$select jsonb_agg(case
      when (select edition = 'internal' from private.installation_identity) and private.company_integration_admin()
      then to_jsonb(k) else to_jsonb(k) - 'webhook_eligible' end order by k.created_at desc,k.id)$new$),
    ('private.company_integration_keys(uuid)'::regprocedure,
      'case purpose when ''course-enrolment''',
      '(purpose = ''course-index'' and private.course_index_integration_issuer(issued_by)) as webhook_eligible,
        case purpose when ''course-enrolment'''),
    ('private.issue_scoped_company_integration_key(uuid,text,timestamptz,uuid,integer,text)'::regprocedure,
      'if not private.company_integration_admin()',
      'if not (private.actor_active() and private.company_integration_issuer_allowed(auth.uid(),p_organisation_id))'),
    ('private.issue_scoped_company_integration_key(uuid,text,timestamptz,uuid,integer,text)'::regprocedure,
      $old$if key_purpose is null or p_expires_at is null or p_expires_at <= now()
    or p_expires_at > now()+interval '180 days' or p_label is null$old$,
      $new$if key_purpose is null
    or (p_expires_at is null and (select edition <> 'internal' from private.installation_identity))
    or (p_expires_at is not null and (
      not isfinite(p_expires_at) or p_expires_at <= now() or p_expires_at > now()+interval '180 days'
    )) or p_label is null$new$),
    ('private.issue_scoped_company_integration_key(uuid,text,timestamptz,uuid,integer,text)'::regprocedure,
      'auth.uid(),p_expires_at,key_purpose)',
      'auth.uid(),coalesce(p_expires_at,''infinity''::timestamptz),key_purpose)'),
    ('private.issue_scoped_company_integration_key(uuid,text,timestamptz,uuid,integer,text)'::regprocedure,
      'expires_at=p_expires_at,version=version+1',
      'expires_at=coalesce(p_expires_at,''infinity''::timestamptz),version=version+1'),
    ('private.issue_scoped_company_integration_key(uuid,text,timestamptz,uuid,integer,text)'::regprocedure,
      'jsonb_build_object(''organisation_id'',p_organisation_id,''scope'',p_scope)',
      'jsonb_build_object(''organisation_id'',p_organisation_id,''scope'',p_scope,''expires_at'',p_expires_at)'),
    ('private.revoke_company_integration_key(uuid,integer)'::regprocedure,
      $old$begin
  if not private.company_integration_admin() then raise insufficient_privilege; end if;$old$,
      $new$declare
  company uuid;
begin
  select organisation_id into company from private.company_integration_keys
  where id=p_id and purpose<>'academy-webhook';
  if not (private.actor_active() and private.company_integration_issuer_allowed(auth.uid(),company))
  then raise insufficient_privilege; end if;$new$),
    ('private.revoke_company_integration_key(uuid,integer)'::regprocedure,
      $old$values(auth.uid(),'integration.revoked',p_id,'{}'::jsonb);$old$,
      $new$values(auth.uid(),'integration.revoked',p_id,jsonb_build_object('organisation_id',company));$new$),
    ('private.use_company_integration_key(uuid,text,text)'::regprocedure,
      'not private.course_index_integration_issuer(key_row.issued_by)',
      'not private.company_integration_issuer_allowed(key_row.issued_by,company)')
  ) as patches(routine, before_text, after_text) loop
    definition := pg_catalog.pg_get_functiondef(patch.routine);
    if cardinality(string_to_array(definition,patch.before_text)) <> 2 then
      raise exception 'Expected one company integration validity seam in %', patch.routine;
    end if;
    execute replace(definition,patch.before_text,patch.after_text);
  end loop;
end;
$migration$;

notify pgrst, 'reload schema';
commit;
