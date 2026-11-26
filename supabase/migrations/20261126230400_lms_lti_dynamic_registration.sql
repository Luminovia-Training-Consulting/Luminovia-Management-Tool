-- A course manager authorizes one registration attempt with an out-of-band tool key.
-- The provider creates an inactive placement that still needs a manager's review.
begin;

alter table private.lti_course_registrations add column registration_scopes text[];

create table private.lti_registration_grants (
  token_hash bytea primary key,
  run_id uuid not null references public.course_runs(id) on delete cascade,
  actor uuid not null references public.profiles(id) on delete cascade,
  session_id uuid not null,
  provider_origin text not null,
  jwks_uri text not null,
  verification_key jsonb not null,
  allow_roster boolean not null,
  allow_grades boolean not null,
  expires_at timestamptz not null
);
create index lti_registration_grants_course on private.lti_registration_grants(run_id,actor);
create index lti_registration_grants_actor on private.lti_registration_grants(actor);
alter table private.lti_registration_grants enable row level security;
revoke all on private.lti_registration_grants from public,anon,authenticated,service_role;

create function private.lti_begin_dynamic_registration(
  p_run_id uuid,p_initiation_uri text,p_jwks_uri text,p_tool_key jsonb,p_roster boolean,p_grades boolean
) returns text language plpgsql security definer set search_path = '' as $$
declare
  context jsonb := private.lti_course_access(p_run_id);
  provider text := private.lti_uri_origin(p_initiation_uri);
  live_session uuid := nullif(auth.jwt()->>'session_id','')::uuid;
  token text := encode(extensions.gen_random_bytes(32),'hex');
begin
  if (context->>'manager')::boolean is not true or live_session is null
    or not exists (select 1 from auth.sessions session where session.id = live_session and session.user_id = auth.uid()
      and (session.not_after is null or session.not_after > clock_timestamp()))
    then raise insufficient_privilege; end if;
  if provider is null or not coalesce(private.lti_https_uri(p_initiation_uri) and private.lti_https_uri(p_jwks_uri),false)
    or private.lti_uri_origin(p_jwks_uri) is distinct from provider or p_roster is null or p_grades is null
    or jsonb_typeof(p_tool_key) is distinct from 'object'
    or p_tool_key - array['kty','kid','n','e','alg','use'] <> '{}'
    or p_tool_key->>'kty' is distinct from 'RSA'
    or coalesce(p_tool_key->>'kid','') !~ '^[A-Za-z0-9._-]{1,80}$'
    or length(coalesce(p_tool_key->>'n','')) not between 342 and 683
    or coalesce(p_tool_key->>'n','') !~ '^[A-Za-z0-9_-]+$'
    or coalesce(p_tool_key->>'e','') !~ '^[A-Za-z0-9_-]{2,8}$'
    or coalesce(p_tool_key->>'alg','RS256') <> 'RS256'
    or coalesce(p_tool_key->>'use','sig') <> 'sig'
    then raise invalid_parameter_value; end if;
  delete from private.lti_registration_grants
  where run_id = p_run_id and (actor = auth.uid() or expires_at <= clock_timestamp());
  insert into private.lti_registration_grants(token_hash,run_id,actor,session_id,provider_origin,
    jwks_uri,verification_key,allow_roster,allow_grades,expires_at)
  values (extensions.digest(token,'sha256'),p_run_id,auth.uid(),live_session,provider,
    p_jwks_uri,p_tool_key,p_roster,p_grades,clock_timestamp() + interval '15 minutes');
  return token;
end;
$$;

create function private.lti_complete_dynamic_registration(p_token text,p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  grant_row private.lti_registration_grants;
  target_course public.course_runs;
  deployment uuid := gen_random_uuid();
  client_id text := gen_random_uuid()::text;
  academy boolean := (select edition from private.installation_identity) <> 'internal';
  granted_roster boolean;
  granted_grades boolean;
  title text := btrim(p_input->>'title');
  login_uri text := p_input->>'login';
  redirect_uri text := p_input->>'redirect';
  target_uri text := p_input->>'target';
  picker_uri text := p_input->>'picker';
  allowed_scopes jsonb;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' or jsonb_typeof(p_input) is distinct from 'object'
    or p_input - array['title','login','redirect','target','jwks','picker','scopes'] <> '{}'
    or octet_length(p_input::text) > 16384
    or jsonb_typeof(p_input->'title') is distinct from 'string'
    or coalesce(length(title),0) not between 1 and 140 or title ~ '[[:cntrl:]]'
    or jsonb_typeof(p_input->'scopes') is distinct from 'array'
    then raise invalid_parameter_value; end if;
  select * into grant_row from private.lti_registration_grants
    where token_hash = extensions.digest(p_token,'sha256') and expires_at > clock_timestamp();
  if not found then raise insufficient_privilege; end if;

  -- Keep the grant, course and current manager attached to the same authority
  -- until this transaction commits. The tool never supplies an owner or course.
  if academy then
    perform private.lock_academy_course_access();
  else
    perform private.lock_course_premium(grant_row.run_id);
  end if;
  select run.* into target_course from public.course_runs run join public.organisations org
    on org.id = run.organisation_id and org.archived_at is null
    where run.id = grant_row.run_id and run.archived_at is null
    for no key update of run for share of org;
  if not found then raise insufficient_privilege; end if;
  select * into grant_row from private.lti_registration_grants
    where token_hash = extensions.digest(p_token,'sha256') and expires_at > clock_timestamp() for update;
  if not found then raise insufficient_privilege; end if;

  perform 1 from auth.sessions session where session.id = grant_row.session_id and session.user_id = grant_row.actor
    and (session.not_after is null or session.not_after > clock_timestamp()) for share;
  if not found then raise insufficient_privilege; end if;
  perform 1 from public.profiles profile where profile.id = grant_row.actor and profile.active for share;
  if not found then raise insufficient_privilege; end if;
  perform 1 from public.user_roles role where role.user_id = grant_row.actor order by role.role for share;
  if not exists (select 1 from public.user_roles role join public.role_permissions permission on permission.role = role.role
    where role.user_id = grant_row.actor and permission.permission = 'courses.manage') then raise insufficient_privilege; end if;

  if p_input->>'jwks' is distinct from grant_row.jwks_uri
    or not coalesce(private.lti_https_uri(login_uri) and private.lti_https_uri(redirect_uri)
      and private.lti_https_uri(target_uri),false)
    or private.lti_uri_origin(login_uri) is distinct from grant_row.provider_origin
    or private.lti_uri_origin(redirect_uri) is distinct from grant_row.provider_origin
    or private.lti_uri_origin(target_uri) is distinct from grant_row.provider_origin
    or (picker_uri is not null and (not private.lti_https_uri(picker_uri)
      or private.lti_uri_origin(picker_uri) is distinct from grant_row.provider_origin))
    or (select count(*) from private.lti_course_registrations where run_id = target_course.id) >= 20
    then raise invalid_parameter_value; end if;

  select coalesce(jsonb_agg(scope order by scope), '[]') into allowed_scopes
  from (select distinct value as scope from jsonb_array_elements_text(p_input->'scopes')) requested
  where (grant_row.allow_roster and scope = 'https://purl.imsglobal.org/spec/lti-nrps/scope/contextmembership.readonly')
    or (grant_row.allow_grades and scope in (
      'https://purl.imsglobal.org/spec/lti-ags/scope/lineitem',
      'https://purl.imsglobal.org/spec/lti-ags/scope/lineitem.readonly',
      'https://purl.imsglobal.org/spec/lti-ags/scope/score',
      'https://purl.imsglobal.org/spec/lti-ags/scope/result.readonly'));
  granted_roster := allowed_scopes ? 'https://purl.imsglobal.org/spec/lti-nrps/scope/contextmembership.readonly';
  granted_grades := exists (select 1 from jsonb_array_elements_text(allowed_scopes) allowed where value like 'https://purl.imsglobal.org/spec/lti-ags/scope/%');

  insert into private.lti_course_registrations(id,run_id,title,client_id,login_uri,redirect_uri,target_uri,
    active,tool_public_key,nrps_enabled,ags_enabled,deep_link_uri,registration_scopes)
  values (deployment,target_course.id,title,client_id,login_uri,redirect_uri,target_uri,
    false,grant_row.verification_key,granted_roster,granted_grades,picker_uri,
    array(select jsonb_array_elements_text(allowed_scopes)));
  delete from private.lti_registration_grants where token_hash = grant_row.token_hash;
  insert into public.audit_events(actor_id,action,resource_id,details)
  values (grant_row.actor,'course.lti_dynamic_registration_staged',target_course.id,
    jsonb_build_object('registration',deployment,'active',false));
  return jsonb_build_object('id',deployment,'client_id',client_id,'scopes',allowed_scopes);
end;
$$;

create function public.lti_begin_dynamic_registration(
  p_run_id uuid,p_initiation_uri text,p_jwks_uri text,p_tool_key jsonb,p_roster boolean,p_grades boolean
) returns text language sql security invoker set search_path = '' as $$
  select private.lti_begin_dynamic_registration(p_run_id,p_initiation_uri,p_jwks_uri,p_tool_key,p_roster,p_grades);
$$;
create function public.lti_complete_dynamic_registration(p_token text,p_input jsonb)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.lti_complete_dynamic_registration(p_token,p_input);
$$;
revoke all on function private.lti_begin_dynamic_registration(uuid,text,text,jsonb,boolean,boolean),
  public.lti_begin_dynamic_registration(uuid,text,text,jsonb,boolean,boolean) from public,anon,service_role;
grant execute on function private.lti_begin_dynamic_registration(uuid,text,text,jsonb,boolean,boolean),
  public.lti_begin_dynamic_registration(uuid,text,text,jsonb,boolean,boolean) to authenticated;
revoke all on function private.lti_complete_dynamic_registration(text,jsonb),
  public.lti_complete_dynamic_registration(text,jsonb) from public,anon,authenticated;
grant execute on function private.lti_complete_dynamic_registration(text,jsonb),
  public.lti_complete_dynamic_registration(text,jsonb) to service_role;

do $$
declare
  token_function text := pg_catalog.pg_get_functiondef(
    'private.lti_issue_service_token(uuid,integer,text,timestamptz,text[])'::regprocedure);
  launch_function text := pg_catalog.pg_get_functiondef(
    'private.consume_lti_launch(text,text,uuid,text,text,text,text)'::regprocedure);
  token_anchor constant text := '  if not p_scopes <@ allowed then';
  launch_anchor constant text := ' || case when tool.nrps_enabled';
  gate text := pg_catalog.pg_get_functiondef('private.require_academy_course_access()'::regprocedure);
  anchor constant text := '''/rpc/lti_deep_link_review''';
begin
  if cardinality(string_to_array(gate,anchor)) <> 2
    or cardinality(string_to_array(token_function,token_anchor)) <> 2
    or cardinality(string_to_array(launch_function,launch_anchor)) <> 2
    then raise exception 'Expected LTI course registration boundaries'; end if;
  execute replace(token_function,token_anchor,
    '  if not p_scopes <@ allowed or (tool.registration_scopes is not null and not p_scopes <@ tool.registration_scopes) then');
  execute replace(launch_function,launch_anchor, $scope$
    || case when tool.registration_scopes is not null then jsonb_build_object('registration_scopes',tool.registration_scopes)
      else '{}'::jsonb end$scope$ || launch_anchor);
  execute replace(gate,anchor,anchor || ', ''/rpc/lti_begin_dynamic_registration''');
end;
$$;
notify pgrst, 'reload schema';
commit;
