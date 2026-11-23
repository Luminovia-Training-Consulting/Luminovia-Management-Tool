begin;

-- Local support authorisation is separate from Academy roles and course membership.
create table private.academy_support_grants (
  id uuid primary key,
  installation_id uuid not null references private.installation_identity(installation_id),
  grantee_id uuid not null,
  grantee_email text not null,
  granted_by uuid not null,
  scope text not null check (scope in ('installation', 'course')),
  course_id uuid,
  purpose text not null check (char_length(purpose) between 8 and 240),
  duration_minutes integer not null check (duration_minutes between 15 and 1440),
  granted_at timestamptz not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by uuid,
  check ((scope = 'course') = (course_id is not null)),
  check ((revoked_at is null) = (revoked_by is null)),
  check (expires_at = granted_at + make_interval(mins => duration_minutes))
);
create index academy_support_installation_grants
  on private.academy_support_grants(installation_id, granted_at desc, id);
create index academy_support_grantee_grants
  on private.academy_support_grants(installation_id, grantee_id, granted_at desc, id);
alter table private.academy_support_grants enable row level security;
revoke all on private.academy_support_grants from public, anon, authenticated, service_role;

-- Actor UUIDs and the consent details survive removal of an Auth account or course.
create table private.academy_support_reads (
  id bigint generated always as identity primary key,
  grant_id uuid not null references private.academy_support_grants(id),
  actor_id uuid not null,
  accessed_at timestamptz not null
);
create index academy_support_grant_reads on private.academy_support_reads(grant_id, accessed_at desc, id desc);
alter table private.academy_support_reads enable row level security;
revoke all on private.academy_support_reads from public, anon, authenticated, service_role;

create function private.academy_support_recipient(p_actor uuid, p_email text)
returns boolean language plpgsql stable security invoker set search_path = '' as $$
begin
  return exists (
    select 1 from public.profiles profile join auth.users identity on identity.id = profile.id
    where profile.id = p_actor and profile.active
      and identity.email_confirmed_at is not null and lower(identity.email) = p_email
      and (identity.banned_until is null or identity.banned_until <= statement_timestamp())
      and not exists (select 1 from public.user_roles where user_id = profile.id)
  );
end;
$$;

create function private.academy_support_access(p_action text, p_payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  installation private.installation_identity%rowtype;
  grant_row private.academy_support_grants%rowtype;
  licence text;
  administrator boolean;
  caller_email text;
  recipient uuid;
  recipient_email text;
  grant_id uuid;
  scope_value text;
  course_value uuid;
  purpose_value text;
  duration_value integer;
  moment timestamptz;
  diagnostic jsonb;
begin
  select * into strict installation from private.installation_identity where singleton;
  if installation.edition = 'internal' or caller is null or private.own_password_setup_required()
    or private.own_privileged_authenticator_required() then raise insufficient_privilege; end if;
  select lower(email) into caller_email from auth.users where id = caller and email_confirmed_at is not null;
  administrator := private.actor_active() and private.academy_local_admin(caller);
  if not administrator and not private.academy_support_recipient(caller, caller_email) then
    raise insufficient_privilege;
  end if;
  licence := private.academy_course_access_status();
  if p_action is null or jsonb_typeof(p_payload) is distinct from 'object' then raise invalid_parameter_value; end if;

  if p_action = 'list' then
    if p_payload <> '{}'::jsonb then raise invalid_parameter_value; end if;
    return jsonb_build_object('action', 'list', 'installation_id', installation.installation_id,
      'can_manage', administrator, 'can_issue', coalesce(administrator and licence = 'active', false),
      'can_read', coalesce(not administrator and licence = 'active', false),
      'grants', coalesce((
        select jsonb_agg(to_jsonb(g) - 'installation_id' - 'duration_minutes' || jsonb_build_object(
          'status', case when revoked_at is not null then 'revoked'
                         when expires_at <= statement_timestamp() then 'expired'
                         else 'active' end
        ) order by granted_at desc, id)
        from (
          select * from private.academy_support_grants
          where installation_id = installation.installation_id
            and (administrator or (grantee_id = caller and grantee_email = caller_email))
          order by granted_at desc,id limit 100
        ) g
      ), '[]'::jsonb));
  end if;

  if p_action not in ('grant', 'revoke', 'audit', 'read') then raise invalid_parameter_value; end if;
  if p_payload->>'id' is null then raise invalid_parameter_value; end if;
  grant_id := (p_payload->>'id')::uuid;

  if p_action = 'grant' then
    perform private.lock_academy_administration(caller);
    if not private.actor_active() or not private.academy_local_admin(caller) then
      raise insufficient_privilege;
    end if;
    if p_payload - array['id','recipient_email','scope','course_id','purpose','duration_minutes'] <> '{}'::jsonb then
      raise invalid_parameter_value;
    end if;
    scope_value := p_payload->>'scope';
    purpose_value := btrim(p_payload->>'purpose');
    recipient_email := lower(btrim(p_payload->>'recipient_email'));
    if coalesce(char_length(purpose_value) not between 8 and 240 or purpose_value ~ '[[:cntrl:]]', true)
      or scope_value is null or scope_value not in ('installation','course')
      or coalesce(p_payload->>'duration_minutes', '') !~ '^[0-9]{1,4}$'
      or coalesce(char_length(recipient_email) not between 3 and 254, true) then
      raise invalid_parameter_value;
    end if;
    duration_value := (p_payload->>'duration_minutes')::integer;
    course_value := (p_payload->>'course_id')::uuid;
    if duration_value not between 15 and 1440
      or (scope_value = 'course') <> (course_value is not null)
      or (course_value is not null and not exists (select 1 from public.course_runs where id = course_value)) then
      raise invalid_parameter_value;
    end if;

    select identity.id into recipient from auth.users identity
    where lower(identity.email) = recipient_email
      and private.academy_support_recipient(identity.id, recipient_email);
    if recipient is null or recipient = caller then raise invalid_parameter_value; end if;
    moment := clock_timestamp();
    insert into private.academy_support_grants
      (id, installation_id, grantee_id, grantee_email, granted_by, scope, course_id, purpose,
       duration_minutes, granted_at, expires_at)
      values (grant_id, installation.installation_id, recipient, recipient_email, caller,
        scope_value, course_value, purpose_value, duration_value, moment, moment + make_interval(mins => duration_value))
      on conflict (id) do nothing;
    select * into strict grant_row from private.academy_support_grants where id = grant_id;
    if (grant_row.installation_id, grant_row.grantee_id, grant_row.grantee_email, grant_row.granted_by,
        grant_row.scope, grant_row.course_id, grant_row.purpose, grant_row.duration_minutes)
      is distinct from (installation.installation_id, recipient, recipient_email, caller, scope_value,
        course_value, purpose_value, duration_value) then
      raise sqlstate 'PT409' using message = 'Support grant decision changed.';
    end if;
    return jsonb_build_object('action', 'grant', 'installation_id', installation.installation_id, 'id', grant_id);
  end if;

  if p_payload - 'id' <> '{}'::jsonb then raise invalid_parameter_value; end if;
  if p_action = 'revoke' then
    perform 1 from public.profiles where id = caller and active for share;
    perform 1 from public.user_roles where user_id = caller order by role for share;
    if not private.actor_active() or not private.academy_local_admin(caller) then
      raise insufficient_privilege;
    end if;
    select * into grant_row from private.academy_support_grants
      where id = grant_id and installation_id = installation.installation_id for update;
    if not found then raise insufficient_privilege; end if;
    if grant_row.revoked_at is null then
      update private.academy_support_grants set revoked_at = clock_timestamp(), revoked_by = caller
        where id = grant_id;
    end if;
    return jsonb_build_object('action', 'revoke', 'installation_id', installation.installation_id, 'id', grant_id);
  end if;

  if p_action = 'read' then
    perform private.lock_academy_course_access();
    licence := 'active';
  end if;
  select * into grant_row from private.academy_support_grants
    where id = grant_id and installation_id = installation.installation_id
      and ((administrator and p_action = 'audit') or (grantee_id = caller and grantee_email = caller_email))
    for share;
  if not found then raise insufficient_privilege; end if;
  moment := clock_timestamp();
  if p_action = 'audit' then
    return jsonb_build_object('action', 'audit', 'installation_id', installation.installation_id, 'id', grant_id,
      'events', (
        select jsonb_agg(jsonb_build_object('kind', kind, 'actor_id', actor_id, 'at', occurred_at)
          order by occurred_at desc, tie_breaker desc)
        from (
          select 'granted'::text as kind, grant_row.granted_by as actor_id, grant_row.granted_at as occurred_at, 0::bigint as tie_breaker
          union all select 'revoked', grant_row.revoked_by, grant_row.revoked_at, 0 where grant_row.revoked_at is not null
          union all select 'expired', null, grant_row.expires_at, 0
            where grant_row.expires_at <= moment and (grant_row.revoked_at is null or grant_row.expires_at <= grant_row.revoked_at)
          union all select 'read', recent.actor_id, recent.accessed_at, recent.id
            from (select id, actor_id, accessed_at from private.academy_support_reads audit_read where audit_read.grant_id = grant_row.id
                  order by accessed_at desc, id desc limit 100) recent
        ) events
      ));
  end if;

  if grant_row.revoked_at is not null or grant_row.expires_at <= moment
    or not private.academy_support_recipient(caller, grant_row.grantee_email) then
    raise insufficient_privilege;
  end if;
  if grant_row.scope = 'installation' then
    select jsonb_build_object('scope', 'installation', 'edition', installation.edition,
      'release', terms->>'release_commit', 'licence', licence)
    into diagnostic from private.installation_verified_licence
    where installation_id = installation.installation_id;
  else
    -- No names, course text, enrolments, grades, messages, file IDs or bytes.
    select jsonb_build_object('scope', 'course', 'course_id', run.id,
      'published', run.published, 'session_count', (select count(*) from public.course_sessions where course_run_id = run.id))
    into diagnostic from public.course_runs run where run.id = grant_row.course_id;
  end if;
  if diagnostic is null then raise insufficient_privilege; end if;
  insert into private.academy_support_reads(grant_id, actor_id, accessed_at) values (grant_id, caller, moment);
  return jsonb_build_object('action', 'read', 'installation_id', installation.installation_id, 'id', grant_id,
    'expires_at', grant_row.expires_at, 'diagnostic', diagnostic);
end;
$$;

create function public.academy_support_access(p_action text, p_payload jsonb default '{}'::jsonb)
returns jsonb language sql volatile security invoker set search_path = '' as $$
  select private.academy_support_access(p_action, p_payload);
$$;
revoke all on function private.academy_support_recipient(uuid, text),
  private.academy_support_access(text, jsonb), public.academy_support_access(text, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function private.academy_support_access(text, jsonb), public.academy_support_access(text, jsonb)
  to authenticated;

-- Only this exact RPC admits a role-free support identity. Existing course and
-- REST admission, password setup and privileged authenticator checks stay in force.
do $migration$
declare
  definition text := pg_get_functiondef('private.require_academy_course_access()'::regprocedure);
  marker constant text := '  if current_setting(''role'', true) is distinct from ''authenticated''';
begin
  if cardinality(string_to_array(definition, marker)) <> 2 then
    raise exception 'Expected exact Academy request admission hook';
  end if;
  execute replace(definition, marker, $gate$
  if request_path = '/rpc/academy_support_access'
    and request_method = 'POST'
    and current_setting('role', true) = 'authenticated'
    and coalesce(request_headers->>'accept-profile', 'public') = 'public'
    and coalesce(request_headers->>'content-profile', 'public') = 'public' then
    return;
  end if;
$gate$ || marker);
end;
$migration$;

notify pgrst, 'reload schema';
commit;
