begin;

-- The operator receives the tool's metadata out of band. Course managers may
-- register one placement per tool client and course, without storing tool secrets.
create table private.lti_course_registrations (
  id uuid primary key,
  run_id uuid not null references public.course_runs(id) on delete cascade,
  context_id uuid not null unique default gen_random_uuid(),
  title text not null check (length(title) between 1 and 140),
  client_id text not null check (length(client_id) between 1 and 255),
  login_uri text not null,
  redirect_uri text not null,
  target_uri text not null,
  active boolean not null,
  version integer not null default 1 check (version > 0),
  unique (run_id, client_id)
);
create table private.lti_subjects (
  registration_id uuid not null references private.lti_course_registrations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  subject_id uuid not null unique default gen_random_uuid(),
  primary key (registration_id, user_id)
);
create index lti_subjects_user_id on private.lti_subjects(user_id);
create table private.lti_launch_hints (
  hint_hash bytea primary key,
  message_hash bytea not null,
  browser_hash bytea not null,
  registration_id uuid not null references private.lti_course_registrations(id) on delete cascade,
  registration_version integer not null,
  actor uuid not null references public.profiles(id) on delete cascade,
  session_id uuid not null,
  expires_at timestamptz not null
);
create index lti_launch_hints_registration on private.lti_launch_hints(registration_id, expires_at);
create index lti_launch_hints_actor on private.lti_launch_hints(actor);
create table private.lti_launch_replay (
  registration_id uuid not null references private.lti_course_registrations(id) on delete cascade,
  nonce_hash bytea not null,
  state_hash bytea not null,
  expires_at timestamptz not null,
  primary key (registration_id, nonce_hash),
  unique (registration_id, state_hash)
);
create index lti_launch_replay_expiry on private.lti_launch_replay(registration_id, expires_at);
alter table private.lti_course_registrations enable row level security;
alter table private.lti_subjects enable row level security;
alter table private.lti_launch_hints enable row level security;
alter table private.lti_launch_replay enable row level security;
revoke all on private.lti_course_registrations, private.lti_subjects, private.lti_launch_hints,
  private.lti_launch_replay from public, anon, authenticated, service_role;

-- HTTPS, conventional hostnames and exact registered URI equality are checked
-- independently of the caller. The platform never fetches a submitted tool URL.
create function private.lti_https_uri(p_uri text)
returns boolean language sql immutable strict set search_path = '' as $$
  select length(p_uri) <= 1500 and
    p_uri ~ '^https://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{1,5})?/[^[:space:]#]*$'
    and strpos(p_uri, chr(92)) = 0 and p_uri !~ '[[:cntrl:]]';
$$;
revoke all on function private.lti_https_uri(text) from public, anon, authenticated, service_role;

-- Hold the existing installation/course write authority while evaluating the
-- launcher's current course role. Global registration permission is separate.
create function private.lti_course_access(p_run_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  context jsonb;
begin
  if (select installation.edition from private.installation_identity installation) = 'internal'
  then perform private.lock_course_premium(p_run_id);
  else
    perform private.lock_academy_course_access();
    perform 1 from public.course_runs where id = p_run_id and archived_at is null for no key update;
  end if;
  perform 1 from public.profiles where id = auth.uid() and active for share;
  if not found then raise insufficient_privilege; end if;
  perform 1 from public.user_roles where user_id = auth.uid() order by role for share;
  context := private.course_workspace_context(p_run_id);
  if not coalesce((context->>'lms_enabled')::boolean, false)
    or not coalesce((context->>'staff')::boolean or (context->>'learner')::boolean, false) then
    raise insufficient_privilege;
  end if;
  return context;
end;
$$;
revoke all on function private.lti_course_access(uuid)
  from public, anon, authenticated, service_role;

create function private.course_lti_tools(p_run_id uuid)
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
      'target_uri', registration.target_uri) else '{}'::jsonb end
  order by registration.title, registration.id), '[]'::jsonb) into tools
  from private.lti_course_registrations registration
  where registration.run_id = p_run_id and (registration.active or manager);
  return jsonb_build_object('can_manage', manager and writable, 'can_launch', launchable, 'tools', tools);
end;
$$;

create function private.save_course_lti_tool(
  p_id uuid, p_run_id uuid, p_title text, p_client_id text, p_login_uri text,
  p_redirect_uri text, p_target_uri text, p_active boolean, p_expected_version integer
) returns integer language plpgsql security definer set search_path = '' as $$
declare
  context jsonb := private.lti_course_access(p_run_id);
  previous private.lti_course_registrations;
  next_version integer;
begin
  if not coalesce((context->>'manager')::boolean, false) then raise insufficient_privilege; end if;
  if p_id is null or p_active is null or p_expected_version is null or p_expected_version < 0
    or p_title is null or length(btrim(p_title)) not between 1 and 140 or p_title ~ '[[:cntrl:]]'
    or p_client_id is null or p_client_id !~ '^[!-~]{1,255}$'
    or not coalesce(private.lti_https_uri(p_login_uri) and private.lti_https_uri(p_redirect_uri)
      and private.lti_https_uri(p_target_uri), false) then raise invalid_parameter_value;
  end if;
  select * into previous from private.lti_course_registrations where id = p_id for update;
  if previous.id is not null and previous.run_id is distinct from p_run_id then raise insufficient_privilege; end if;
  -- Keep an issued binding stable. A different external client needs its own deployment.
  if previous.id is not null and previous.client_id is distinct from p_client_id then raise invalid_parameter_value; end if;
  if coalesce(previous.version, 0) <> p_expected_version then
    raise exception 'LTI registration changed' using errcode = 'PT409';
  end if;
  if previous.id is null and (
    select count(*) from private.lti_course_registrations where run_id = p_run_id
  ) >= 20 then raise invalid_parameter_value; end if;
  insert into private.lti_course_registrations(id, run_id, title, client_id, login_uri, redirect_uri, target_uri, active)
  values (p_id, p_run_id, btrim(p_title), p_client_id, p_login_uri, p_redirect_uri, p_target_uri, p_active)
  on conflict (id) do update set title = excluded.title, login_uri = excluded.login_uri,
    redirect_uri = excluded.redirect_uri, target_uri = excluded.target_uri, active = excluded.active,
    version = private.lti_course_registrations.version + 1
  returning version into next_version;
  insert into public.audit_events(actor_id, action, resource_id, details)
    values (auth.uid(), 'course.lti_registration_saved', p_run_id,
      jsonb_build_object('registration', p_id, 'version', next_version, 'active', p_active));
  return next_version;
end;
$$;

-- The browser holds the private proof and the authenticated portal session.
-- Known public login and message hints alone can never authorize a launch.
create function private.prepare_lti_launch(p_registration_id uuid, p_browser_proof uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  tool private.lti_course_registrations;
  context jsonb;
  login_hint text := encode(extensions.gen_random_bytes(32),'hex');
  message_hint text := encode(extensions.gen_random_bytes(32),'hex');
  live_session uuid := nullif(auth.jwt()->>'session_id','')::uuid;
begin
  if p_registration_id is null or p_browser_proof is null or live_session is null
    or not exists (select 1 from auth.sessions session
      where session.id = live_session and session.user_id = auth.uid()
        and (session.not_after is null or session.not_after > clock_timestamp())) then
    raise insufficient_privilege;
  end if;
  select * into tool from private.lti_course_registrations where id = p_registration_id and active;
  if not found then raise insufficient_privilege; end if;
  context := private.lti_course_access(tool.run_id);
  if not coalesce((context->>'teacher')::boolean or (context->>'learner')::boolean,false) then
    raise insufficient_privilege;
  end if;
  select * into tool from private.lti_course_registrations where id = p_registration_id and active for share;
  if not found then raise insufficient_privilege; end if;
  delete from private.lti_launch_hints
    where registration_id = tool.id and (expires_at <= clock_timestamp() or actor = auth.uid());
  insert into private.lti_launch_hints(hint_hash, message_hash, browser_hash,
    registration_id, registration_version, actor, session_id, expires_at)
  values (extensions.digest(login_hint, 'sha256'), extensions.digest(message_hint, 'sha256'),
    extensions.digest(p_browser_proof::text, 'sha256'), tool.id, tool.version,
    auth.uid(), live_session, clock_timestamp() + interval '5 minutes');
  return jsonb_build_object('id', tool.id, 'client_id', tool.client_id, 'login_uri', tool.login_uri,
    'target_uri', tool.target_uri, 'login_hint', login_hint, 'message_hint', message_hint);
end;
$$;

create function private.consume_lti_launch(
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
    'role', role_name);
exception when unique_violation then
  raise exception 'LTI authorization already used' using errcode = 'PT409';
end;
$$;

create function public.course_lti_tools(p_run_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$ select private.course_lti_tools(p_run_id); $$;
create function public.save_course_lti_tool(
  p_id uuid, p_run_id uuid, p_title text, p_client_id text, p_login_uri text,
  p_redirect_uri text, p_target_uri text, p_active boolean, p_expected_version integer
) returns integer language sql security invoker set search_path = '' as $$
  select private.save_course_lti_tool(p_id,p_run_id,p_title,p_client_id,p_login_uri,p_redirect_uri,p_target_uri,p_active,p_expected_version);
$$;
create function public.prepare_lti_launch(p_registration_id uuid, p_browser_proof uuid) returns jsonb
language sql security invoker set search_path = '' as $$ select private.prepare_lti_launch(p_registration_id,p_browser_proof); $$;
create function public.consume_lti_launch(
  p_login_hint text, p_message_hint text, p_browser_proof uuid, p_client_id text,
  p_redirect_uri text, p_nonce text, p_state text
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.consume_lti_launch(p_login_hint,p_message_hint,p_browser_proof,p_client_id,p_redirect_uri,p_nonce,p_state);
$$;
revoke all on function private.course_lti_tools(uuid), public.course_lti_tools(uuid),
  private.save_course_lti_tool(uuid,uuid,text,text,text,text,text,boolean,integer),
  public.save_course_lti_tool(uuid,uuid,text,text,text,text,text,boolean,integer),
  private.prepare_lti_launch(uuid,uuid), public.prepare_lti_launch(uuid,uuid),
  private.consume_lti_launch(text,text,uuid,text,text,text,text), public.consume_lti_launch(text,text,uuid,text,text,text,text)
  from public, anon, service_role;
grant execute on function private.course_lti_tools(uuid), public.course_lti_tools(uuid),
  private.save_course_lti_tool(uuid,uuid,text,text,text,text,text,boolean,integer),
  public.save_course_lti_tool(uuid,uuid,text,text,text,text,text,boolean,integer),
  private.prepare_lti_launch(uuid,uuid), public.prepare_lti_launch(uuid,uuid),
  private.consume_lti_launch(text,text,uuid,text,text,text,text), public.consume_lti_launch(text,text,uuid,text,text,text,text)
  to authenticated;

do $$
declare
  academy_gate text := pg_catalog.pg_get_functiondef('private.require_academy_course_access()'::regprocedure);
  portal_gate text := pg_catalog.pg_get_functiondef('private.require_portal_access()'::regprocedure);
  academy_anchor constant text := '  licence_status := private.academy_course_access_status();';
  portal_anchor constant text := '  perform private.require_portal_access_before_course_content();';
begin
  if cardinality(string_to_array(academy_gate, academy_anchor)) <> 2 or
     cardinality(string_to_array(portal_gate, portal_anchor)) <> 2 then raise exception 'Expected course request gates'; end if;
  execute replace(academy_gate, academy_anchor, academy_anchor || chr(10) || $gate$
  if (licence_status in ('active','grace') and request_method in ('GET','HEAD','POST')
      and request_path = '/rpc/course_lti_tools')
     or (licence_status = 'active' and request_method = 'POST'
      and request_path in ('/rpc/save_course_lti_tool', '/rpc/prepare_lti_launch', '/rpc/consume_lti_launch'))
  then return; end if;
$gate$);
  execute replace(portal_gate, portal_anchor, $gate$
  if (select installation.edition from private.installation_identity installation) = 'internal'
     and current_setting('role',true) = 'authenticated' and private.participant_actor() and (
       (current_setting('request.method',true) in ('GET','HEAD','POST')
         and current_setting('request.path',true) = '/rpc/course_lti_tools')
       or (current_setting('request.method',true) = 'POST'
         and current_setting('request.path',true) in ('/rpc/prepare_lti_launch', '/rpc/consume_lti_launch'))
     ) then return; end if;
$gate$ || portal_anchor);
end;
$$;
notify pgrst, 'reload schema';
commit;
