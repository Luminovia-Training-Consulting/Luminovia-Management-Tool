-- Deep Linking stages the provider's signed selection for the current course author.
-- Published placements have a separate resource ID and always retain their deployment.
begin;

alter table private.lti_course_registrations add column deep_link_uri text;

create table private.lti_resource_links (
  id uuid primary key,
  registration_id uuid not null references private.lti_course_registrations(id) on delete cascade,
  title text not null check (length(title) between 1 and 160),
  target_uri text not null,
  custom jsonb not null default '{}',
  active boolean not null default true,
  unique (registration_id, id)
);
create index lti_active_resource_links on private.lti_resource_links(registration_id, title, id) where active;

alter table private.lti_launch_hints
  add column resource_link_id uuid,
  add column portal_origin text,
  add foreign key (registration_id, resource_link_id)
    references private.lti_resource_links(registration_id,id) on delete cascade,
  add constraint lti_single_launch_purpose check (resource_link_id is null or portal_origin is null);
create index lti_launch_hint_resource on private.lti_launch_hints(registration_id,resource_link_id) where resource_link_id is not null;

create table private.lti_deep_link_selections (
  id uuid primary key default gen_random_uuid(),
  data_hash bytea not null unique,
  registration_id uuid not null references private.lti_course_registrations(id) on delete cascade,
  registration_version integer not null,
  actor uuid not null references public.profiles(id) on delete cascade,
  session_id uuid not null,
  portal_origin text not null,
  expires_at timestamptz not null,
  responded boolean not null default false,
  selection jsonb
);
create index lti_deep_link_selection_deployment on private.lti_deep_link_selections(registration_id,expires_at);
create index lti_deep_link_selection_actor on private.lti_deep_link_selections(actor);
alter table private.lti_resource_links enable row level security;
alter table private.lti_deep_link_selections enable row level security;
revoke all on private.lti_resource_links, private.lti_deep_link_selections from public, anon, authenticated, service_role;

-- Registration defines the destination trust boundary. Tool JWTs cannot broaden it.
create function private.lti_uri_origin(p_uri text)
returns text language sql immutable strict set search_path = '' as $$
  select lower((regexp_match(p_uri,'^(https://[A-Za-z0-9.-]+(?::[0-9]{1,5})?)(?:/|$)'))[1])
$$;

create function private.configure_course_lti_deep_link(
  p_registration_id uuid,p_expected_version integer,p_selector_uri text
) returns integer language plpgsql security definer set search_path = '' as $$
declare
  tool private.lti_course_registrations;
  context jsonb;
  next_version integer;
begin
  select * into tool from private.lti_course_registrations where id = p_registration_id;
  if not found then raise insufficient_privilege; end if;
  context := private.lti_course_access(tool.run_id);
  if (context->>'manager')::boolean is not true then raise insufficient_privilege; end if;
  if p_expected_version is null or p_expected_version < 1
    or (p_selector_uri is not null and not private.lti_https_uri(p_selector_uri))
    then raise invalid_parameter_value; end if;
  update private.lti_course_registrations registration
    set deep_link_uri = p_selector_uri, version = registration.version + 1
  where registration.id = tool.id and registration.version = p_expected_version
    and (p_selector_uri is null or registration.tool_public_key is not null)
  returning registration.version into next_version;
  if not found then
    raise exception 'LTI registration changed or has no verification key' using errcode = 'PT409';
  end if;
  insert into public.audit_events(actor_id,action,resource_id,details)
  values (auth.uid(),'course.lti_deep_link_configured',tool.run_id,
    jsonb_build_object('registration',tool.id,'version',next_version,'enabled',p_selector_uri is not null));
  return next_version;
end;
$$;

create function private.prepare_lti_placement(
  p_registration_id uuid,p_browser_proof uuid,p_resource_link_id uuid,p_portal_origin text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  tool private.lti_course_registrations;
  context jsonb;
  selected_target text;
  login_hint text := encode(extensions.gen_random_bytes(32),'hex');
  message_hint text := encode(extensions.gen_random_bytes(32),'hex');
  live_session uuid := nullif(auth.jwt()->>'session_id','')::uuid;
begin
  if p_portal_origin is not null and (
    p_resource_link_id is not null or length(p_portal_origin) > 255
    or private.lti_uri_origin(p_portal_origin) is distinct from lower(p_portal_origin)
  ) then raise invalid_parameter_value; end if;
  if p_registration_id is null or p_browser_proof is null or live_session is null
    or not exists (select 1 from auth.sessions session
      where session.id = live_session and session.user_id = auth.uid()
        and (session.not_after is null or session.not_after > clock_timestamp())) then
    raise insufficient_privilege;
  end if;
  select * into tool from private.lti_course_registrations where id = p_registration_id and active;
  if not found then raise insufficient_privilege; end if;
  context := private.lti_course_access(tool.run_id);
  select * into tool from private.lti_course_registrations where id = p_registration_id and active for share;
  if not found then raise insufficient_privilege; end if;
  if p_portal_origin is not null then
    if (context->>'staff')::boolean is not true or tool.deep_link_uri is null or tool.tool_public_key is null
      then raise insufficient_privilege; end if;
    selected_target := tool.deep_link_uri;
  else
    if not coalesce((context->>'teacher')::boolean or (context->>'learner')::boolean,false)
      then raise insufficient_privilege; end if;
    if p_resource_link_id is null then
      selected_target := tool.target_uri;
    else
      select link.target_uri into selected_target from private.lti_resource_links link
      where link.id = p_resource_link_id and link.registration_id = tool.id and link.active
        and private.lti_uri_origin(link.target_uri) = private.lti_uri_origin(tool.target_uri);
      if not found then raise insufficient_privilege; end if;
    end if;
  end if;
  delete from private.lti_launch_hints
    where registration_id = tool.id and (expires_at <= clock_timestamp() or actor = auth.uid());
  insert into private.lti_launch_hints(hint_hash,message_hash,browser_hash,registration_id,
    registration_version,actor,session_id,expires_at,resource_link_id,portal_origin)
  values (extensions.digest(login_hint,'sha256'),extensions.digest(message_hint,'sha256'),
    extensions.digest(p_browser_proof::text,'sha256'),tool.id,tool.version,
    auth.uid(),live_session,clock_timestamp() + interval '5 minutes',p_resource_link_id,p_portal_origin);
  return jsonb_build_object('id',tool.id,'client_id',tool.client_id,'login_uri',tool.login_uri,
    'target_uri',selected_target,'login_hint',login_hint,'message_hint',message_hint);
end;
$$;

create or replace function private.prepare_lti_launch(p_registration_id uuid,p_browser_proof uuid)
returns jsonb language sql security definer set search_path = '' as $$
  select private.prepare_lti_placement(p_registration_id,p_browser_proof,null,null)
$$;

-- The signed provider response stages a single card; only the originally
-- authenticated instructor can publish it to class after reviewing.
create function private.receive_lti_deep_link(p_deployment uuid,p_version integer,p_data text,p_item jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  stage private.lti_deep_link_selections;
  tool private.lti_course_registrations;
  custom_args jsonb;
begin
  if p_data is null or p_data !~ '^[0-9a-f]{64}$' then raise invalid_parameter_value; end if;
  select * into tool from private.lti_course_registrations
  where id = p_deployment and version = p_version and active and deep_link_uri is not null for share;
  if not found or not private.lti_services_available(p_deployment) then raise insufficient_privilege; end if;

  if p_item is not null then
    if jsonb_typeof(p_item) is distinct from 'object'
      or p_item - array['title','url','custom'] <> '{}'
      or jsonb_typeof(p_item->'title') is distinct from 'string'
      or length(btrim(p_item->>'title')) not between 1 and 160 or p_item->>'title' ~ '[[:cntrl:]]'
      or jsonb_typeof(p_item->'url') is distinct from 'string' or not private.lti_https_uri(p_item->>'url')
      or private.lti_uri_origin(p_item->>'url') is distinct from private.lti_uri_origin(tool.target_uri)
      then raise invalid_parameter_value; end if;
    custom_args := coalesce(p_item->'custom','{}');
    if jsonb_typeof(custom_args) is distinct from 'object' or octet_length(custom_args::text) > 4096
      then raise invalid_parameter_value; end if;
    if exists (select 1 from jsonb_each(custom_args) argument
      where argument.key !~ '^[A-Za-z0-9_]{1,80}$' or jsonb_typeof(argument.value) <> 'string'
        or length(argument.value #>> '{}') > 512 or argument.value #>> '{}' ~ '[[:cntrl:]]')
      then raise invalid_parameter_value; end if;
  end if;

  update private.lti_deep_link_selections
  set responded = true, selection = p_item
  where registration_id = tool.id and registration_version = tool.version
    and data_hash = extensions.digest(p_data,'sha256') and expires_at > clock_timestamp()
    and not responded
  returning * into stage;
  if not found then raise insufficient_privilege; end if;
  return jsonb_build_object('id',stage.id,'origin',stage.portal_origin);
end;
$$;

create function private.lti_deep_link_review(p_id uuid,p_action text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  stage private.lti_deep_link_selections;
  tool private.lti_course_registrations;
  context jsonb;
  live_session uuid := nullif(auth.jwt()->>'session_id','')::uuid;
begin
  if p_action is null or p_action not in ('read','publish','withdraw') then raise invalid_parameter_value; end if;
  if p_action = 'withdraw' then
    select registration.* into tool
    from private.lti_resource_links link join private.lti_course_registrations registration on registration.id = link.registration_id
    where link.id = p_id;
    if not found then raise insufficient_privilege; end if;
    context := private.lti_course_access(tool.run_id);
    if (context->>'staff')::boolean is not true then raise insufficient_privilege; end if;
    update private.lti_resource_links set active = false where id = p_id and active;
    if found then
      insert into public.audit_events(actor_id,action,resource_id,details)
      values (auth.uid(),'course.lti_resource_withdrawn',tool.run_id,jsonb_build_object('link',p_id));
    end if;
    return jsonb_build_object('run_id',tool.run_id);
  end if;

  if live_session is null or not exists (select 1 from auth.sessions session
    where session.id = live_session and session.user_id = auth.uid()
      and (session.not_after is null or session.not_after > clock_timestamp()))
    then raise insufficient_privilege; end if;
  select * into stage from private.lti_deep_link_selections where id = p_id
    and actor = auth.uid() and session_id = live_session and responded and expires_at > clock_timestamp();
  if not found then raise insufficient_privilege; end if;
  select * into tool from private.lti_course_registrations where id = stage.registration_id and active;
  if not found then raise insufficient_privilege; end if;
  context := private.lti_course_access(tool.run_id);
  if (context->>'staff')::boolean is not true then raise insufficient_privilege; end if;
  select * into tool from private.lti_course_registrations where id = stage.registration_id and active for share;
  if not found or tool.version <> stage.registration_version or tool.deep_link_uri is null or tool.tool_public_key is null
    then raise insufficient_privilege; end if;

  if p_action = 'publish' then
    if stage.selection is null then raise invalid_parameter_value; end if;
    insert into private.lti_resource_links(id,registration_id,title,target_uri,custom)
    values (stage.id,tool.id,btrim(stage.selection->>'title'),stage.selection->>'url',coalesce(stage.selection->'custom','{}'))
    on conflict (id) do nothing;
    if found then
      insert into public.audit_events(actor_id,action,resource_id,details)
      values (auth.uid(),'course.lti_resource_published',tool.run_id,jsonb_build_object('link',stage.id));
    end if;
  end if;
  return jsonb_build_object('run_id',tool.run_id,'title',stage.selection->>'title',
    'target_uri',stage.selection->>'url','published',
    exists (select 1 from private.lti_resource_links where id = stage.id and active));
end;
$$;

create function public.configure_course_lti_deep_link(p_registration_id uuid,p_expected_version integer,p_selector_uri text)
returns integer language sql security invoker set search_path = '' as $$
  select private.configure_course_lti_deep_link(p_registration_id,p_expected_version,p_selector_uri)
$$;
create function public.prepare_lti_placement(p_registration_id uuid,p_browser_proof uuid,p_resource_link_id uuid,p_portal_origin text)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.prepare_lti_placement(p_registration_id,p_browser_proof,p_resource_link_id,p_portal_origin)
$$;
create function public.receive_lti_deep_link(p_deployment uuid,p_version integer,p_data text,p_item jsonb)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.receive_lti_deep_link(p_deployment,p_version,p_data,p_item)
$$;
create function public.lti_deep_link_review(p_id uuid,p_action text)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.lti_deep_link_review(p_id,p_action)
$$;
revoke all on function private.lti_uri_origin(text) from public,anon,authenticated,service_role;
revoke all on function private.receive_lti_deep_link(uuid,integer,text,jsonb),
  public.receive_lti_deep_link(uuid,integer,text,jsonb) from public,anon,authenticated;
grant execute on function private.receive_lti_deep_link(uuid,integer,text,jsonb),
  public.receive_lti_deep_link(uuid,integer,text,jsonb) to service_role;
revoke all on function private.configure_course_lti_deep_link(uuid,integer,text),
  public.configure_course_lti_deep_link(uuid,integer,text),private.prepare_lti_placement(uuid,uuid,uuid,text),
  public.prepare_lti_placement(uuid,uuid,uuid,text),private.lti_deep_link_review(uuid,text),
  public.lti_deep_link_review(uuid,text) from public,anon,service_role;
grant execute on function private.configure_course_lti_deep_link(uuid,integer,text),
  public.configure_course_lti_deep_link(uuid,integer,text),private.prepare_lti_placement(uuid,uuid,uuid,text),
  public.prepare_lti_placement(uuid,uuid,uuid,text),private.lti_deep_link_review(uuid,text),
  public.lti_deep_link_review(uuid,text) to authenticated;

create or replace function private.course_lti_tools(p_run_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  context jsonb := private.course_workspace_context(p_run_id);
  staff boolean := coalesce((context->>'staff')::boolean, false);
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
     'version', registration.version,
    'can_select', staff and writable and registration.active and registration.deep_link_uri is not null
      and registration.tool_public_key is not null,
    'can_withdraw', staff and writable,
    'links', coalesce((select jsonb_agg(jsonb_build_object('id',link.id,'title',link.title)
      order by link.title,link.id) from private.lti_resource_links link
      where link.registration_id = registration.id and link.active
        and private.lti_uri_origin(link.target_uri) = private.lti_uri_origin(registration.target_uri)),'[]')
  ) || case when manager then jsonb_build_object('client_id', registration.client_id,
      'login_uri', registration.login_uri, 'redirect_uri', registration.redirect_uri,
      'target_uri', registration.target_uri, 'nrps_enabled', registration.nrps_enabled,
      'tool_public_key', registration.tool_public_key, 'deep_link_uri', registration.deep_link_uri) else '{}'::jsonb end
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
  selected private.lti_resource_links;
  data text;
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
  role_name := case
    when hint.portal_origin is not null and (context->>'staff')::boolean
      and tool.deep_link_uri is not null and tool.tool_public_key is not null then 'Instructor'
    when hint.portal_origin is not null then null
    when (context->>'teacher')::boolean then 'Instructor'
    when (context->>'learner')::boolean then 'Learner' end;
  if role_name is null then raise insufficient_privilege; end if;

  delete from private.lti_launch_hints where hint_hash = hint.hint_hash and expires_at > clock_timestamp();
  if not found then raise insufficient_privilege; end if;
  delete from private.lti_launch_replay where registration_id = tool.id and expires_at <= clock_timestamp();
  insert into private.lti_launch_replay(registration_id, nonce_hash, state_hash, expires_at)
  values (tool.id, extensions.digest(p_nonce, 'sha256'), extensions.digest(p_state, 'sha256'),
    clock_timestamp() + interval '30 minutes');
  if hint.portal_origin is not null then
    delete from private.lti_deep_link_selections
      where registration_id = tool.id and expires_at <= clock_timestamp();
    data := encode(extensions.gen_random_bytes(32),'hex');
    insert into private.lti_deep_link_selections(data_hash,registration_id,registration_version,actor,
      session_id,portal_origin,expires_at)
    values (extensions.digest(data,'sha256'),tool.id,tool.version,auth.uid(),live_session,hint.portal_origin,
      clock_timestamp() + interval '15 minutes');
  elsif hint.resource_link_id is not null then
    select * into selected from private.lti_resource_links where id = hint.resource_link_id
      and registration_id = tool.id and active
      and private.lti_uri_origin(target_uri) = private.lti_uri_origin(tool.target_uri) for share;
    if not found then raise insufficient_privilege; end if;
  end if;
  insert into private.lti_subjects(registration_id, user_id) values (tool.id, auth.uid())
    on conflict (registration_id, user_id) do nothing;
  select subject_id into strict subject from private.lti_subjects subjects
    where subjects.registration_id = tool.id and subjects.user_id = auth.uid();
  return jsonb_build_object('id', tool.id, 'subject', subject, 'client_id', tool.client_id,
    'context_id', tool.context_id, 'target_uri',case when data is not null then tool.deep_link_uri else coalesce(selected.target_uri,tool.target_uri) end,
    'redirect_uri',tool.redirect_uri,
    'role', role_name) || case when data is not null then jsonb_build_object('deep_link_data',data)
    when selected.id is not null then jsonb_build_object('resource_link_id',selected.id,'resource_custom',selected.custom)
    else '{}'::jsonb end || case when tool.nrps_enabled then jsonb_build_object('nrps_enabled',true)
    else '{}'::jsonb end;
exception when unique_violation then
  raise exception 'LTI authorization already used' using errcode = 'PT409';
end;
$$;

-- Protect resource-specific roster requests with both the course token and the exact launch link.
create function private.lti_resource_memberships(
  p_deployment uuid,p_token text,p_role text,p_after uuid,p_limit integer,p_link uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  roster jsonb;
  custom_args jsonb;
begin
  roster := private.lti_course_memberships(p_deployment,p_token,p_role,p_after,p_limit);
  if p_link is null or p_link = p_deployment then return roster; end if;
  select link.custom into custom_args
  from private.lti_resource_links link
  join private.lti_course_registrations tool on tool.id = link.registration_id
  where link.registration_id = p_deployment and link.id = p_link and link.active
    and private.lti_uri_origin(link.target_uri) = private.lti_uri_origin(tool.target_uri)
  for share of link;
  if not found then return null; end if;
  return roster || jsonb_build_object('resource_custom',custom_args);
end;
$$;
create function public.lti_resource_memberships(
  p_deployment uuid,p_token text,p_role text,p_after uuid,p_limit integer,p_link uuid
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.lti_resource_memberships(p_deployment,p_token,p_role,p_after,p_limit,p_link)
$$;
revoke all on function private.lti_resource_memberships(uuid,text,text,uuid,integer,uuid),
  public.lti_resource_memberships(uuid,text,text,uuid,integer,uuid) from public,anon,authenticated;
grant execute on function private.lti_resource_memberships(uuid,text,text,uuid,integer,uuid),
  public.lti_resource_memberships(uuid,text,text,uuid,integer,uuid) to service_role;

do $$
declare
  academy text := pg_catalog.pg_get_functiondef('private.require_academy_course_access()'::regprocedure);
  portal text := pg_catalog.pg_get_functiondef('private.require_portal_access()'::regprocedure);
  academy_anchor constant text := '''/rpc/configure_course_lti_advantage''';
  portal_anchor constant text := '''/rpc/prepare_lti_launch'', ''/rpc/consume_lti_launch''';
begin
  if cardinality(string_to_array(academy,academy_anchor)) <> 2
    or cardinality(string_to_array(portal,portal_anchor)) <> 2
    then raise exception 'Expected LTI Deep Linking request boundaries'; end if;
  execute replace(academy,academy_anchor,academy_anchor ||
    ', ''/rpc/configure_course_lti_deep_link'', ''/rpc/prepare_lti_placement'', ''/rpc/lti_deep_link_review''');
  execute replace(portal,portal_anchor,portal_anchor || ', ''/rpc/prepare_lti_placement''');
end;
$$;
notify pgrst, 'reload schema';
commit;
