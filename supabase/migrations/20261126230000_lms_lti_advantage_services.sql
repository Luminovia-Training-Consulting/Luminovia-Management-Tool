-- Course administrators pin tool verification keys and enable each LTI service.
-- Tokens are random capabilities bound to the exact deployment revision.
begin;
alter table private.lti_course_registrations
  add column tool_public_key jsonb,
  add column nrps_enabled boolean not null default false,
  add constraint lti_nrps_key_required check (not nrps_enabled or tool_public_key is not null);

create index lti_configured_clients on private.lti_course_registrations(client_id, id)
  where active and tool_public_key is not null;

create table private.lti_service_tokens (
  token_hash bytea primary key,
  registration_id uuid not null references private.lti_course_registrations(id) on delete cascade,
  registration_version integer not null,
  scopes text[] not null,
  expires_at timestamptz not null
);
create index lti_service_tokens_registration on private.lti_service_tokens(registration_id, expires_at);

create table private.lti_tool_assertions (
  registration_id uuid not null references private.lti_course_registrations(id) on delete cascade,
  assertion_id text not null,
  expires_at timestamptz not null,
  primary key (registration_id, assertion_id)
);
create index lti_tool_assertions_expiry on private.lti_tool_assertions(registration_id, expires_at);

alter table private.lti_service_tokens enable row level security;
alter table private.lti_tool_assertions enable row level security;
revoke all on private.lti_service_tokens, private.lti_tool_assertions from public, anon, authenticated, service_role;

create function private.configure_course_lti_advantage(
  p_registration_id uuid, p_expected_version integer, p_public_key jsonb, p_nrps boolean
) returns integer language plpgsql security definer set search_path = '' as $$
declare
  run uuid;
  next_version integer;
  context jsonb;
begin
  select run_id into run from private.lti_course_registrations where id = p_registration_id;
  if not found then raise insufficient_privilege; end if;
  context := private.lti_course_access(run);
  if (context->>'manager')::boolean is not true then raise insufficient_privilege; end if;
  if p_expected_version is null or p_expected_version < 1 or p_nrps is null
    or (p_nrps and p_public_key is null) then raise invalid_parameter_value; end if;
  -- Store only the exact public RSA fields. Never retain a pasted private JWK.
  if p_public_key is not null and (
    jsonb_typeof(p_public_key) <> 'object'
    or p_public_key - array['kty','kid','n','e','alg','use'] <> '{}'::jsonb
    or (p_public_key->>'kty') is distinct from 'RSA'
    or coalesce(p_public_key->>'kid','') !~ '^[A-Za-z0-9._-]{1,80}$'
    or length(coalesce(p_public_key->>'n','')) not between 342 and 683
    or coalesce(p_public_key->>'n','') !~ '^[A-Za-z0-9_-]+$'
    or coalesce(p_public_key->>'e','') !~ '^[A-Za-z0-9_-]{2,8}$'
    or coalesce(p_public_key->>'alg','RS256') <> 'RS256'
    or coalesce(p_public_key->>'use','sig') <> 'sig'
  ) then raise invalid_parameter_value; end if;

  update private.lti_course_registrations registration
  set tool_public_key = p_public_key, nrps_enabled = p_nrps, version = registration.version + 1
  where registration.id = p_registration_id and registration.run_id = run
    and registration.version = p_expected_version
  returning registration.version into next_version;
  if not found then raise exception 'LTI registration changed' using errcode = 'PT409'; end if;

  insert into public.audit_events(actor_id, action, resource_id, details)
  values (auth.uid(), 'course.lti_advantage_configured', run,
    jsonb_build_object('registration', p_registration_id, 'version', next_version, 'nrps', p_nrps));
  return next_version;
end;
$$;

create function private.lti_services_available(p_registration uuid)
returns boolean language sql stable set search_path = '' as $$
  select exists (
    select 1 from private.lti_course_registrations tool
    join public.course_runs run on run.id = tool.run_id and run.archived_at is null
    join public.organisations organisation on organisation.id = run.organisation_id and organisation.archived_at is null
    where tool.id = p_registration and tool.active and tool.tool_public_key is not null
      and case when (select edition from private.installation_identity) = 'internal'
        then private.company_premium_enabled(run.organisation_id)
        else private.academy_course_access_status() = 'active' end
  );
$$;

-- Load one registered key before signature validation. A missing deployment is
-- accepted only when the client uniquely identifies one active deployment.
create function private.lti_service_registration(p_client_id text, p_deployment uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when count(*) = 1 then (jsonb_agg(
    jsonb_build_object('id', tool.id, 'version', tool.version, 'key', tool.tool_public_key)
  )->0) end
  from private.lti_course_registrations tool
  where tool.client_id = p_client_id and (p_deployment is null or p_deployment = tool.id)
    and tool.active and tool.tool_public_key is not null
    and private.lti_services_available(tool.id);
$$;

create function private.lti_issue_service_token(
  p_deployment uuid, p_version integer, p_assertion_id text, p_assertion_expiry timestamptz, p_scopes text[]
) returns text language plpgsql security definer set search_path = '' as $$
declare
  tool private.lti_course_registrations;
  clock_value timestamptz := clock_timestamp();
  token text := encode(extensions.gen_random_bytes(32),'hex');
begin
  if p_assertion_id is null or length(p_assertion_id) not between 1 and 255 or p_assertion_expiry is null
    or p_assertion_expiry <= clock_value or p_assertion_expiry > clock_value + interval '6 minutes'
    or p_scopes is distinct from array['https://purl.imsglobal.org/spec/lti-nrps/scope/contextmembership.readonly']::text[]
    then raise invalid_parameter_value; end if;

  select * into tool from private.lti_course_registrations where id = p_deployment for update;
  if not found or tool.version is distinct from p_version or not tool.nrps_enabled
    or not private.lti_services_available(p_deployment) then raise insufficient_privilege; end if;

  delete from private.lti_tool_assertions where registration_id = tool.id and expires_at <= clock_value;
  delete from private.lti_service_tokens where registration_id = tool.id
    and (expires_at <= clock_value or registration_version <> tool.version);
  insert into private.lti_tool_assertions values (tool.id, p_assertion_id, p_assertion_expiry)
    on conflict do nothing;
  if not found then raise insufficient_privilege; end if;

  insert into private.lti_service_tokens(token_hash,registration_id,registration_version,scopes,expires_at)
    values (extensions.digest(token,'sha256'),tool.id,tool.version,p_scopes,clock_value + interval '5 minutes');
  return token;
end;
$$;

create function private.lti_service_token_allows(p_deployment uuid, p_token text, p_scope text)
returns boolean language sql stable set search_path = '' as $$
  select exists (
    select 1 from private.lti_course_registrations tool
    join private.lti_service_tokens token on token.registration_id = tool.id
      and token.registration_version = tool.version
    where tool.id = p_deployment and token.token_hash = extensions.digest(p_token,'sha256')
      and token.expires_at > statement_timestamp() and p_scope = any(token.scopes)
      and private.lti_services_available(tool.id)
  );
$$;

-- Use the same assignment predicate for launches and group membership.
create function private.course_has_current_teacher(p_course_id uuid, p_instructor uuid)
returns boolean language sql stable set search_path = '' as $$
  select exists (
    select 1 from public.job_claims claim
    join public.jobs job on job.id = claim.job_id
    where job.course_run_id = p_course_id and claim.lecturer_id = p_instructor
      and claim.status = 'confirmed'
      and (
        (select edition from private.installation_identity) = 'internal'
        or exists (
          select 1 from private.academy_course_instructors assignment
          where assignment.claim_id = claim.id and assignment.course_id = p_course_id
            and assignment.instructor_id = p_instructor and assignment.released_at is null
        )
      )
  );
$$;
create or replace function private.course_has_current_teacher(p_course_id uuid)
returns boolean language sql stable set search_path = '' as $$
  select private.course_has_current_teacher(p_course_id, auth.uid());
$$;

create function private.lti_roster(p_course uuid,p_organisation uuid)
returns table (user_id uuid,learner boolean,instructor boolean)
language sql stable set search_path = '' as $$
  select membership.user_id, bool_or(membership.learner), bool_or(membership.instructor)
  from (
    select enrolment.user_id, true as learner, false as instructor
    from public.course_enrolments enrolment
    where enrolment.course_run_id = p_course and enrolment.status in ('enrolled','completed')
      and private.active_company_participant(enrolment.user_id,p_organisation)
    union all
    select claim.lecturer_id, false, true
    from public.job_claims claim join public.jobs job on job.id = claim.job_id
    where job.course_run_id = p_course and claim.status = 'confirmed'
      and private.lecturer_user(claim.lecturer_id)
      and private.course_has_current_teacher(p_course,claim.lecturer_id)
  ) membership
  group by membership.user_id;
$$;

create function private.lti_course_memberships(
  p_deployment uuid, p_token text, p_role text, p_after uuid, p_limit integer
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  scope constant text := 'https://purl.imsglobal.org/spec/lti-nrps/scope/contextmembership.readonly';
  tool private.lti_course_registrations;
  org uuid;
  members jsonb;
begin
  if p_role is not null and p_role not in ('Learner','Instructor') then raise invalid_parameter_value; end if;
  if p_limit is null or p_limit not between 1 and 200 then raise invalid_parameter_value; end if;
  if not private.lti_service_token_allows(p_deployment,p_token,scope) then raise insufficient_privilege; end if;

  select * into tool from private.lti_course_registrations where id = p_deployment and nrps_enabled for share;
  if not found or not private.lti_service_token_allows(p_deployment,p_token,scope)
    then raise insufficient_privilege; end if;
  select organisation_id into strict org from public.course_runs where id = tool.run_id;
  -- Preserve the identifiers already created at launch. Course members receive
  -- a random identifier only for this deployment, without an account UUID.
  insert into private.lti_subjects(registration_id,user_id)
  select tool.id, member.user_id from private.lti_roster(tool.run_id,org) member
  where (member.learner and p_role is distinct from 'Instructor')
     or (member.instructor and p_role is distinct from 'Learner')
  on conflict (registration_id,user_id) do nothing;

  select coalesce(jsonb_agg(jsonb_build_object(
    'user_id', member.subject_id, 'status', 'Active',
    'roles', case when member.instructor then jsonb_build_array('http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor') else '[]'::jsonb end
      || case when member.learner then jsonb_build_array('http://purl.imsglobal.org/vocab/lis/v2/membership#Learner') else '[]'::jsonb end
  ) order by member.subject_id),'[]'::jsonb)
  into members
  from (
    select subject.subject_id, roster.learner, roster.instructor
    from private.lti_roster(tool.run_id,org) roster
    join private.lti_subjects subject on subject.user_id = roster.user_id
      and subject.registration_id = tool.id
    where (p_after is null or subject.subject_id > p_after)
      and ((roster.learner and p_role is distinct from 'Instructor')
        or (roster.instructor and p_role is distinct from 'Learner'))
    order by subject.subject_id limit p_limit + 1
  ) member;
  return jsonb_build_object('context_id',tool.context_id,'members',members);
end;
$$;

create function public.configure_course_lti_advantage(
  p_registration_id uuid,p_expected_version integer,p_public_key jsonb,p_nrps boolean
) returns integer language sql security invoker set search_path = '' as $$
  select private.configure_course_lti_advantage(p_registration_id,p_expected_version,p_public_key,p_nrps);
$$;
create function public.lti_service_registration(p_client_id text,p_deployment uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.lti_service_registration(p_client_id,p_deployment);
$$;
create function public.lti_issue_service_token(p_deployment uuid,p_version integer,p_assertion_id text,p_assertion_expiry timestamptz,p_scopes text[])
returns text language sql security invoker set search_path = '' as $$
  select private.lti_issue_service_token(p_deployment,p_version,p_assertion_id,p_assertion_expiry,p_scopes);
$$;
create function public.lti_course_memberships(p_deployment uuid,p_token text,p_role text,p_after uuid,p_limit integer)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.lti_course_memberships(p_deployment,p_token,p_role,p_after,p_limit);
$$;

revoke all on function private.lti_services_available(uuid), private.lti_service_token_allows(uuid,text,text),
  private.course_has_current_teacher(uuid,uuid), private.lti_roster(uuid,uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.configure_course_lti_advantage(uuid,integer,jsonb,boolean),
  public.configure_course_lti_advantage(uuid,integer,jsonb,boolean)
  from public, anon, service_role;
grant execute on function private.configure_course_lti_advantage(uuid,integer,jsonb,boolean),
  public.configure_course_lti_advantage(uuid,integer,jsonb,boolean) to authenticated;
revoke all on function private.lti_service_registration(text,uuid), public.lti_service_registration(text,uuid),
  private.lti_issue_service_token(uuid,integer,text,timestamptz,text[]), public.lti_issue_service_token(uuid,integer,text,timestamptz,text[]),
  private.lti_course_memberships(uuid,text,text,uuid,integer), public.lti_course_memberships(uuid,text,text,uuid,integer)
  from public, anon, authenticated;
grant execute on function private.lti_service_registration(text,uuid), public.lti_service_registration(text,uuid),
  private.lti_issue_service_token(uuid,integer,text,timestamptz,text[]), public.lti_issue_service_token(uuid,integer,text,timestamptz,text[]),
  private.lti_course_memberships(uuid,text,text,uuid,integer), public.lti_course_memberships(uuid,text,text,uuid,integer)
  to service_role;

create or replace function private.course_lti_tools(p_run_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  context jsonb := private.course_workspace_context(p_run_id);
  manager boolean := coalesce((context->>'manager')::boolean, false);
  writable boolean := (select installation.edition from private.installation_identity installation) = 'internal'
    or private.academy_course_access_status() = 'active';
  launchable boolean := coalesce((context->>'teacher')::boolean or (context->>'learner')::boolean, false) and writable;
  tools jsonb;
begin
  if not coalesce((context->>'lms_enabled')::boolean, false)
    or not coalesce((context->>'staff')::boolean or (context->>'learner')::boolean, false)
    or ((select installation.edition from private.installation_identity installation) is distinct from 'internal'
      and not coalesce(private.academy_course_access_status() in ('active', 'grace'), false)) then
    raise insufficient_privilege;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', registration.id, 'title', registration.title, 'active', registration.active,
    'version', registration.version
  ) || case when manager then jsonb_build_object('client_id', registration.client_id,
      'login_uri', registration.login_uri, 'redirect_uri', registration.redirect_uri,
      'target_uri', registration.target_uri, 'nrps_enabled', registration.nrps_enabled,
      'tool_public_key', registration.tool_public_key) else '{}'::jsonb end
  order by registration.title, registration.id), '[]'::jsonb) into tools
  from private.lti_course_registrations registration
  where registration.run_id = p_run_id and (registration.active or manager);
  return jsonb_build_object('can_manage', manager and writable, 'can_launch', launchable, 'tools', tools);
end;
$$;

create or replace function private.consume_lti_launch(
  p_login_hint text, p_message_hint text, p_browser_proof uuid, p_client_id text,
  p_redirect_uri text, p_nonce text, p_state text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  hint private.lti_launch_hints;
  tool private.lti_course_registrations;
  context jsonb;
  subject uuid;
  live_session uuid := nullif(auth.jwt()->>'session_id','')::uuid;
  role_name text;
begin
  if p_login_hint is null or p_login_hint !~ '^[a-f0-9]{64}$'
    or p_message_hint is null or p_message_hint !~ '^[a-f0-9]{64}$'
    or p_browser_proof is null or live_session is null or p_nonce is null
    or length(p_nonce) not between 1 and 255 or p_nonce ~ '[[:cntrl:]]'
    or p_state is null or length(p_state) not between 1 and 2048 or p_state ~ '[[:cntrl:]]' then
    raise invalid_parameter_value;
  end if;
  if not exists (select 1 from auth.sessions session
    where session.id = live_session and session.user_id = auth.uid()
      and (session.not_after is null or session.not_after > clock_timestamp())) then
    raise insufficient_privilege;
  end if;
  select * into hint from private.lti_launch_hints h where h.hint_hash = extensions.digest(p_login_hint, 'sha256')
    and h.message_hash = extensions.digest(p_message_hint, 'sha256')
    and h.browser_hash = extensions.digest(p_browser_proof::text, 'sha256')
    and h.actor = auth.uid() and h.session_id = live_session and h.expires_at > clock_timestamp();
  if not found then raise insufficient_privilege; end if;
  select * into tool from private.lti_course_registrations where id = hint.registration_id and active;
  if not found then raise insufficient_privilege; end if;
  context := private.lti_course_access(tool.run_id);
  -- Current role and revision are evaluated again after taking the course lock.
  select * into tool from private.lti_course_registrations where id = hint.registration_id and active for share;
  if not found or tool.version <> hint.registration_version or tool.client_id is distinct from p_client_id
    or tool.redirect_uri is distinct from p_redirect_uri then raise insufficient_privilege; end if;
  role_name := case when (context->>'teacher')::boolean then 'Instructor'
    when (context->>'learner')::boolean then 'Learner' end;
  if role_name is null then raise insufficient_privilege; end if;

  delete from private.lti_launch_hints where hint_hash = hint.hint_hash and expires_at > clock_timestamp();
  if not found then raise insufficient_privilege; end if;
  delete from private.lti_launch_replay where registration_id = tool.id and expires_at <= clock_timestamp();
  insert into private.lti_launch_replay(registration_id, nonce_hash, state_hash, expires_at)
  values (tool.id, extensions.digest(p_nonce, 'sha256'), extensions.digest(p_state, 'sha256'),
    clock_timestamp() + interval '30 minutes');
  insert into private.lti_subjects(registration_id, user_id) values (tool.id, auth.uid())
    on conflict (registration_id, user_id) do nothing;
  select subject_id into strict subject from private.lti_subjects subjects
    where subjects.registration_id = tool.id and subjects.user_id = auth.uid();
  return jsonb_build_object('id', tool.id, 'subject', subject, 'client_id', tool.client_id,
    'context_id', tool.context_id, 'target_uri', tool.target_uri, 'redirect_uri', tool.redirect_uri,
    'role', role_name) || case when tool.nrps_enabled then jsonb_build_object('nrps_enabled',true)
    else '{}'::jsonb end;
exception when unique_violation then
  raise exception 'LTI authorization already used' using errcode = 'PT409';
end;
$$;

do $$
declare
  gate text := pg_catalog.pg_get_functiondef('private.require_academy_course_access()'::regprocedure);
  anchor constant text := '''/rpc/save_course_lti_tool''';
begin
  if cardinality(string_to_array(gate,anchor)) <> 2 then raise exception 'Expected Academy LTI write gate'; end if;
  execute replace(gate,anchor,anchor || ', ''/rpc/configure_course_lti_advantage''');
end;
$$;
notify pgrst, 'reload schema';
commit;
