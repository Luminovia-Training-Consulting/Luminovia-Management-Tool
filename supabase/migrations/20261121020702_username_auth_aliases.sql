begin;

-- Usernames are installation-local aliases of existing Auth UUIDs. Passwords remain in Auth.
create table private.user_login_aliases (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  username text unique,
  version integer not null default 0 check (version >= 0),
  changed_at timestamptz not null default now(),
  constraint username_shape check (
    username is null or username ~ '^[a-z][a-z0-9._-]{1,30}[a-z0-9]$'
  )
);
alter table private.user_login_aliases enable row level security;
revoke all on private.user_login_aliases from public, anon, authenticated, service_role;

create function private.account_username() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if not (private.actor_active() or private.guest_actor() or private.participant_actor()) then
    raise insufficient_privilege;
  end if;
  select jsonb_build_object('username',a.username,'version',coalesce(a.version,0))
    into result from public.profiles p
    left join private.user_login_aliases a on a.user_id=p.id
    where p.id=auth.uid() and p.active;
  return result;
end;$$;
create function public.account_username() returns jsonb
language sql stable security invoker set search_path='' as $$
  select private.account_username();
$$;

create function private.save_account_username(p_username text,p_expected_version integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare normalized text:=lower(btrim(p_username)); prior private.user_login_aliases;
begin
  if not (private.actor_active() or private.guest_actor() or private.participant_actor()) then raise insufficient_privilege; end if;
  if p_expected_version is null or p_expected_version < 0 or
    (p_username is not null and (
      length(p_username)>64 or normalized !~ '^[a-z][a-z0-9._-]{1,30}[a-z0-9]$' or
      normalized in ('admin','administrator','root','owner','support','system',
        'security','moderator','staff','guest','api','auth','login','mail',
        'luminovia','help','postmaster','webmaster')
    )) then raise exception 'Invalid username' using errcode='22023'; end if;
  perform 1 from public.profiles where id=auth.uid() and active for update;
  if not found then raise insufficient_privilege; end if;
  insert into private.user_login_aliases(user_id) values(auth.uid()) on conflict do nothing;
  select * into prior from private.user_login_aliases where user_id=auth.uid() for update;
  if prior.version<>p_expected_version then
    raise exception 'Username changed; reload' using errcode='40001';
  end if;
  begin
    update private.user_login_aliases set username=normalized,version=prior.version+1,
      changed_at=now() where user_id=auth.uid();
  exception when unique_violation then
    raise exception 'Username unavailable' using errcode='23505';
  end;
  insert into public.audit_events(actor_id,action,resource_id,details)
    values(auth.uid(),'account.username_changed',auth.uid(),
      jsonb_build_object('version',prior.version+1));
  return private.account_username();
end;$$;
create function public.save_account_username(p_username text,p_expected_version integer)
returns jsonb language sql security invoker set search_path='' as $$
  select private.save_account_username(p_username,p_expected_version);
$$;

-- Service-only credential flow. The public wrapper is not executable by clients.
create function private.login_email_for_alias(p_username text) returns text
language sql stable security definer set search_path='' as $$
  select u.email from private.user_login_aliases a
  join public.profiles p on p.id=a.user_id and p.active
  join auth.users u on u.id=a.user_id and u.email_confirmed_at is not null
  where a.username=lower(p_username) limit 1;
$$;
create function public.login_email_for_alias(p_username text) returns text
language sql stable security invoker set search_path='' as $$
  select private.login_email_for_alias(p_username);
$$;

create table private.login_attempt_budget (
  identifier_hash text primary key check(identifier_hash ~ '^[a-f0-9]{64}$'),
  window_start timestamptz not null,
  attempts integer not null check(attempts between 1 and 11)
);
alter table private.login_attempt_budget enable row level security;
revoke all on private.login_attempt_budget from public,anon,authenticated,service_role;
create function private.reserve_login_attempt(p_identifier_hash text) returns boolean
language plpgsql security definer set search_path='' as $$
declare allowed boolean;
begin
  if p_identifier_hash is null or p_identifier_hash !~ '^[a-f0-9]{64}$' then
    return false;
  end if;
  insert into private.login_attempt_budget(identifier_hash,window_start,attempts)
    values(p_identifier_hash,now(),1)
    on conflict(identifier_hash) do update set
      window_start=case when private.login_attempt_budget.window_start<now()-interval '10 minutes'
        then now() else private.login_attempt_budget.window_start end,
      attempts=case when private.login_attempt_budget.window_start<now()-interval '10 minutes'
        then 1 else least(11,private.login_attempt_budget.attempts+1) end
    returning attempts<=10 into allowed;
  -- The cap is inclusive; the eleventh attempt remains rejected until the window rolls.
  if not allowed then return false; end if;
  return true;
end;$$;
create function public.reserve_login_attempt(p_identifier_hash text) returns boolean
language sql security invoker set search_path='' as $$
  select private.reserve_login_attempt(p_identifier_hash);
$$;

revoke all on function private.account_username(),public.account_username(),
  private.save_account_username(text,integer),public.save_account_username(text,integer),
  private.login_email_for_alias(text),public.login_email_for_alias(text),
  private.reserve_login_attempt(text),public.reserve_login_attempt(text)
  from public,anon,authenticated,service_role;
grant execute on function private.account_username(),public.account_username(),
  private.save_account_username(text,integer),public.save_account_username(text,integer)
  to authenticated;
grant execute on function private.login_email_for_alias(text),public.login_email_for_alias(text),
  private.reserve_login_attempt(text),public.reserve_login_attempt(text)
  to service_role;

-- Preserve the existing participant allowlist while adding the two own-account paths.
create or replace function private.require_portal_access()
returns void language plpgsql stable security definer set search_path = '' as $$
declare path text := coalesce(current_setting('request.path', true), '');
begin
  if current_setting('role', true) is distinct from 'authenticated' then return; end if;
  if private.actor_active() then return; end if;
  if private.guest_actor() and path in (
    '/profiles', '/user_roles', '/rpc/portal_access', '/rpc/get_my_permissions',
    '/rpc/account_me', '/rpc/save_account_profile', '/rpc/ui_preferences', '/rpc/save_ui_preferences',
    '/rpc/account_username', '/rpc/save_account_username'
  ) then return; end if;
  if private.participant_actor() and path in (
    '/profiles', '/user_roles', '/rpc/portal_access', '/rpc/get_my_permissions',
    '/rpc/ui_preferences', '/rpc/save_ui_preferences', '/rpc/my_course_workspaces',
    '/rpc/course_workspace', '/rpc/course_workspace_action', '/rpc/course_document_access',
    '/rpc/cancel_own_course_enrolment', '/rpc/course_operation_destinations',
    '/rpc/my_company_participant_invitations', '/rpc/accept_company_participant_invitation',
    '/rpc/account_username', '/rpc/save_account_username'
  ) then return; end if;
  raise exception 'Operational portal access required' using errcode = '42501';
end;$$;

notify pgrst,'reload schema';
commit;
