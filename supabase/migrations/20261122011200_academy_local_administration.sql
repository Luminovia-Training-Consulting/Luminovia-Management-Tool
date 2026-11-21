begin;

-- Only this installation's current course administrators operate the local directory.
create function private.academy_administration_actor(p_actor uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists (
    select 1 from public.profiles profile
    join auth.users identity on identity.id = profile.id
    join public.user_roles account_role on account_role.user_id = profile.id
    join public.role_permissions permission on permission.role = account_role.role
    where profile.id = p_actor and profile.active and identity.email_confirmed_at is not null
      and account_role.role in ('admin', 'management') and permission.permission = 'courses.manage'
  );
$$;

create function private.lock_academy_administration(p_actor uuid)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  perform private.lock_academy_course_access();
  perform 1 from public.profiles where id = p_actor and active for share;
  perform 1 from public.user_roles where user_id = p_actor order by role for share;
  if not private.academy_administration_actor(p_actor) then
    raise insufficient_privilege;
  end if;
end;
$$;

create table private.academy_organisation_requests (
  actor_id uuid not null references public.profiles(id) on delete cascade,
  request_id uuid not null,
  name text not null,
  time_zone text not null,
  organisation_id uuid references public.organisations(id) on delete set null,
  primary key (actor_id, request_id)
);
create index academy_organisation_request_target on private.academy_organisation_requests(organisation_id);
alter table private.academy_organisation_requests enable row level security;

create table private.academy_account_requests (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references private.installation_identity(installation_id),
  actor_id uuid not null,
  request_id uuid not null,
  email text not null,
  display_name text not null,
  role text not null check (role in ('lecturer', 'participant')),
  organisation_id uuid references public.organisations(id),
  mode text not null check (mode in ('password', 'invite')),
  status text not null default 'reserved' check (status in ('reserved', 'created', 'cleanup', 'failed')),
  user_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  unique (actor_id, request_id),
  check ((role = 'participant') = (organisation_id is not null))
);
create index academy_account_request_organisation on private.academy_account_requests(organisation_id);
create index academy_account_request_actor_time on private.academy_account_requests(actor_id, created_at desc);
create unique index academy_account_live_email on private.academy_account_requests(email)
  where status in ('reserved', 'cleanup');
alter table private.academy_account_requests enable row level security;
revoke all on private.academy_organisation_requests, private.academy_account_requests from public, anon, authenticated, service_role;

create function private.academy_administration()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare licence text := private.academy_course_access_status();
begin
  if not coalesce(licence in ('active', 'grace'), false) then raise insufficient_privilege; end if;
  if not private.academy_administration_actor(auth.uid()) then return null; end if;
  return jsonb_build_object(
    'can_write', licence = 'active',
    'organisations', coalesce((
      select jsonb_agg(to_jsonb(organisation) order by organisation.name, organisation.id)
      from (
        select id, name, time_zone from public.organisations
        where archived_at is null order by name, id limit 200
      ) organisation
    ), '[]'::jsonb),
    'accounts', coalesce((
      select jsonb_agg(to_jsonb(person) order by person.display_name, person.id)
      from (
        select profile.id, profile.display_name, profile.active, account_role.role,
          identity.email_confirmed_at is not null as confirmed
        from public.profiles profile
        join public.user_roles account_role on account_role.user_id = profile.id
        join auth.users identity on identity.id = profile.id
        where account_role.role in ('lecturer', 'participant') and not exists (
          select 1 from public.user_roles other
          where other.user_id = profile.id and other.role <> account_role.role
        )
        order by profile.display_name, profile.id limit 200
      ) person
    ), '[]'::jsonb)
  );
end;
$$;

create function private.academy_create_organisation(p_request_id uuid, p_name text, p_time_zone text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  name_value text := btrim(p_name);
  previous private.academy_organisation_requests%rowtype;
  item public.organisations%rowtype;
begin
  perform private.lock_academy_administration(actor);
  if p_request_id is null or name_value is null or length(name_value) not between 1 and 200
    or name_value ~ '[[:cntrl:]]'
    or not exists (select 1 from pg_timezone_names where name = p_time_zone) then
    raise invalid_parameter_value;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('academy-local-organisation', 0));
  select * into previous from private.academy_organisation_requests
    where actor_id = actor and request_id = p_request_id;
  if found then
    if (previous.name, previous.time_zone) is distinct from (name_value, p_time_zone) then
      raise exception 'Organisation request changed' using errcode = 'PT409';
    end if;
    select * into item from public.organisations where id = previous.organisation_id and archived_at is null;
    if not found then raise exception 'Organisation unavailable' using errcode = 'PT409'; end if;
  else
    if exists (select 1 from public.organisations where archived_at is null and lower(name) = lower(name_value)) then
      raise exception 'Organisation already exists' using errcode = 'PT409';
    end if;
    insert into public.organisations(name, time_zone) values (name_value, p_time_zone) returning * into item;
    insert into private.academy_organisation_requests(actor_id, request_id, name, time_zone, organisation_id)
      values (actor, p_request_id, name_value, p_time_zone, item.id);
    insert into public.audit_events(actor_id, action, resource_id, details)
      values (actor, 'academy.organisation.created', item.id, '{}'::jsonb);
  end if;
  return jsonb_build_object('id', item.id, 'name', item.name, 'time_zone', item.time_zone);
end;
$$;

create function private.reserve_academy_account(
  p_request_id uuid, p_email text, p_display_name text, p_role text, p_organisation_id uuid, p_mode text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  email_value text := lower(btrim(p_email));
  display_value text := btrim(p_display_name);
  previous private.academy_account_requests%rowtype;
begin
  perform private.lock_academy_administration(actor);
  if p_request_id is null or email_value is null or length(email_value) > 254
    or email_value !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    or display_value is null or length(display_value) not between 1 and 120 or display_value ~ '[[:cntrl:]]'
    or p_role is null or p_role not in ('lecturer', 'participant')
    or p_mode is null or p_mode not in ('password', 'invite')
    or (p_role = 'participant') is distinct from (p_organisation_id is not null) then
    raise invalid_parameter_value;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('academy-local-account:' || actor::text, 0));
  select * into previous from private.academy_account_requests
    where actor_id = actor and request_id = p_request_id for update;
  if found then
    if (previous.email, previous.display_name, previous.role, previous.organisation_id, previous.mode)
        is distinct from (email_value, display_value, p_role, p_organisation_id, p_mode) then
      raise exception 'Account request changed' using errcode = 'PT409';
    end if;
    return jsonb_build_object(
      'creation_id', previous.id, 'user_id', case when previous.status = 'created' then previous.user_id else null end,
      'status', case
        when previous.status <> 'reserved' then previous.status
        when previous.created_at < clock_timestamp() - interval '10 minutes' then 'cleanup'
        else 'in_progress'
      end
    );
  end if;
  if p_organisation_id is not null and not exists (
    select 1 from public.organisations where id = p_organisation_id and archived_at is null
  ) then raise insufficient_privilege; end if;
  if (select count(*) from private.academy_account_requests
    where actor_id = actor and created_at > clock_timestamp() - interval '1 hour') >= 30 then
    raise exception 'Account creation limit reached' using errcode = 'PT429';
  end if;
  if exists (select 1 from auth.users where lower(email) = email_value) then
    raise exception 'Account unavailable' using errcode = 'PT409';
  end if;
  insert into private.academy_account_requests(
    installation_id, actor_id, request_id, email, display_name, role, organisation_id, mode
  ) select installation_id, actor, p_request_id, email_value, display_value, p_role, p_organisation_id, p_mode
    from private.installation_identity where singleton
  on conflict (email) where status in ('reserved', 'cleanup') do nothing
  returning * into previous;
  if not found then raise exception 'Account unavailable' using errcode = 'PT409'; end if;
  return jsonb_build_object('status', 'reserved', 'creation_id', previous.id);
end;
$$;

-- Auth works in its native service. A trusted worker can finalize the bound
-- fresh identity or obtain the exact unfinished identity for compensating cleanup.
create function private.finish_academy_account(p_creation_id uuid, p_user_id uuid, p_decision text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  request private.academy_account_requests%rowtype;
  target auth.users%rowtype;
  link_id uuid;
begin
  if p_decision is null or p_decision not in ('complete', 'cleanup', 'discard') then
    raise invalid_parameter_value;
  end if;
  if p_decision = 'complete' then
    select * into request from private.academy_account_requests where id = p_creation_id;
    if not found then raise insufficient_privilege; end if;
    perform private.lock_academy_administration(request.actor_id);
  end if;
  select * into request from private.academy_account_requests where id = p_creation_id for update;
  if not found or not exists (
    select 1 from private.installation_identity
    where singleton and edition <> 'internal' and installation_id = request.installation_id
  ) then raise insufficient_privilege; end if;

  if request.status = 'created' then
    if p_decision = 'complete' and p_user_id is distinct from request.user_id then
      raise insufficient_privilege;
    end if;
    return jsonb_build_object('status', 'created', 'user_id', request.user_id);
  end if;
  if p_decision = 'discard' and request.status = 'cleanup'
      and request.user_id is not distinct from p_user_id
      and not exists (select 1 from auth.users where id = p_user_id) then
    update private.academy_account_requests set status = 'failed' where id = request.id;
    return jsonb_build_object('status', 'failed');
  end if;
  if request.status = 'failed' and p_decision = 'cleanup' then
    return jsonb_build_object('status', 'failed');
  end if;
  if p_decision = 'discard' or (p_decision = 'complete' and (p_user_id is null or request.status <> 'reserved')) then
    raise insufficient_privilege;
  end if;

  select * into target from auth.users
    where (p_user_id is null or id = p_user_id)
      and (request.user_id is null or id = request.user_id)
      and lower(email) = request.email and created_at >= request.created_at
    for update;
  if not found then
    if p_decision <> 'cleanup' or p_user_id is not null then raise insufficient_privilege; end if;
    if request.status = 'reserved' and request.created_at >= clock_timestamp() - interval '10 minutes' then
      return jsonb_build_object('status', 'in_progress');
    end if;
    update private.academy_account_requests set status = 'failed' where id = request.id;
    return jsonb_build_object('status', 'failed');
  end if;
  if exists (select 1 from public.user_roles where user_id = target.id) then
    raise insufficient_privilege;
  end if;
  if p_decision = 'cleanup' then
    update private.academy_account_requests set status = 'cleanup', user_id = target.id where id = request.id;
    return jsonb_build_object('status', 'cleanup', 'user_id', target.id);
  end if;
  if request.mode = 'password' and target.email_confirmed_at is null then raise insufficient_privilege; end if;

  update public.profiles set display_name = request.display_name where id = target.id and active;
  if not found then raise insufficient_privilege; end if;
  insert into public.user_roles(user_id, role) values (target.id, request.role);
  if request.role = 'participant' then
    perform 1 from public.organisations where id = request.organisation_id and archived_at is null for share;
    if not found then raise insufficient_privilege; end if;
    insert into private.company_participant_link_requests(
      organisation_id, requested_by, request_id, luminovia_user_id, target_user_id, status, expires_at
    ) select request.organisation_id, request.actor_id, request.id, luminovia_user_id, target.id,
      'accepted', now() + interval '7 days'
      from public.profiles where id = target.id returning id into link_id;
    insert into private.company_participant_memberships(organisation_id, user_id, status, link_request_id, invited_by, joined_at)
      values (request.organisation_id, target.id, 'active', link_id, request.actor_id, now());
  end if;
  update private.academy_account_requests set status = 'created', user_id = target.id where id = request.id;
  insert into public.audit_events(actor_id, action, resource_id, details)
    values (request.actor_id, 'academy.account.created', target.id,
      jsonb_build_object('role', request.role, 'mode', request.mode, 'organisation_id', request.organisation_id));
  return jsonb_build_object('status', 'created', 'user_id', target.id);
end;
$$;

create function public.academy_administration() returns jsonb
language sql stable security invoker set search_path = '' as $$ select private.academy_administration(); $$;
create function public.academy_create_organisation(p_request_id uuid, p_name text, p_time_zone text) returns jsonb
language sql security invoker set search_path = '' as $$ select private.academy_create_organisation(p_request_id, p_name, p_time_zone); $$;
create function public.reserve_academy_account(
  p_request_id uuid, p_email text, p_display_name text, p_role text, p_organisation_id uuid, p_mode text
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.reserve_academy_account(p_request_id, p_email, p_display_name, p_role, p_organisation_id, p_mode);
$$;
create function public.finish_academy_account(p_creation_id uuid, p_user_id uuid, p_decision text) returns jsonb
language sql security invoker set search_path = '' as $$ select private.finish_academy_account(p_creation_id, p_user_id, p_decision); $$;

revoke all on function private.academy_administration_actor(uuid), private.lock_academy_administration(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.academy_administration(), public.academy_administration(),
  private.academy_create_organisation(uuid,text,text), public.academy_create_organisation(uuid,text,text),
  private.reserve_academy_account(uuid,text,text,text,uuid,text), public.reserve_academy_account(uuid,text,text,text,uuid,text),
  private.finish_academy_account(uuid,uuid,text), public.finish_academy_account(uuid,uuid,text)
  from public, anon, authenticated, service_role;
grant execute on function private.academy_administration(), public.academy_administration(),
  private.academy_create_organisation(uuid,text,text), public.academy_create_organisation(uuid,text,text),
  private.reserve_academy_account(uuid,text,text,text,uuid,text), public.reserve_academy_account(uuid,text,text,text,uuid,text)
  to authenticated;
grant execute on function private.finish_academy_account(uuid,uuid,text), public.finish_academy_account(uuid,uuid,text)
  to service_role;

-- Extend existing exact method/profile gates without admitting the internal account facade.
do $$
declare
  definition text := pg_catalog.pg_get_functiondef('private.require_academy_course_access()'::regprocedure);
  read_anchor constant text := '''/rpc/my_course_workspaces'', ''/rpc/course_workspace'',';
  write_anchor constant text := '''/rpc/academy_assign_course_instructor'', ''/rpc/academy_release_course_instructor'',';
  service_definition text := pg_catalog.pg_get_functiondef('public.require_portal_access()'::regprocedure);
  service_anchor constant text := '      perform private.require_academy_human_login_access();';
begin
  if cardinality(string_to_array(definition, read_anchor)) <> 2
     or cardinality(string_to_array(definition, write_anchor)) <> 2
     or cardinality(string_to_array(service_definition, service_anchor)) <> 2 then
    raise exception 'Expected dedicated administration gate anchors';
  end if;
  definition := replace(definition, read_anchor, read_anchor || ' ''/rpc/academy_administration'',');
  definition := replace(definition, write_anchor, write_anchor || chr(10)
    || '      ''/rpc/academy_create_organisation'', ''/rpc/reserve_academy_account'',');
  execute definition;
  execute replace(service_definition, service_anchor, $branch$      if current_setting('request.path', true) = '/rpc/finish_academy_account'
         and current_setting('request.method', true) = 'POST'
         and coalesce(request_headers->>'accept-profile', 'public') = 'public'
         and coalesce(request_headers->>'content-profile', 'public') = 'public' then
        return;
      end if;
$branch$ || service_anchor);
end;
$$;

notify pgrst, 'reload schema';
commit;
