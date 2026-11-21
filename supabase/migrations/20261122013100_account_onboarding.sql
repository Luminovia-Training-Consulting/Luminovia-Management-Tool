begin;

create table private.account_password_setup (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table private.account_password_setup enable row level security;
revoke all on private.account_password_setup from public, anon, authenticated, service_role;

-- Auth owns the invitation timestamp, app metadata, and password hash.
-- An already authenticated actor editing user metadata cannot trigger onboarding.
create function private.track_auth_account_password_setup()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  current_user_row jsonb := to_jsonb(new);
  prior_user_row jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  initial_alias text;
  new_invite boolean;
begin
  new_invite := current_user_row->>'invited_at' is not null
    and prior_user_row->>'invited_at' is null;
  if new_invite then
    initial_alias := current_user_row#>>'{raw_user_meta_data,portal_invitation_username}';
    if initial_alias ~ '^member-[a-f0-9]{24}$' then
      insert into private.user_login_aliases(user_id, username, version)
      values(new.id, initial_alias, 1) on conflict (user_id) do nothing;
    end if;
  end if;

  if (new_invite and nullif(current_user_row->>'encrypted_password', '') is null)
     or (current_user_row#>'{raw_app_meta_data,portal_temporary_password}' = 'true'::jsonb
         and prior_user_row#>'{raw_app_meta_data,portal_temporary_password}' is distinct from 'true'::jsonb)
  then
    insert into private.account_password_setup(user_id) values (new.id) on conflict do nothing;
  elsif tg_op = 'UPDATE'
    -- GoTrue writes a random placeholder before it confirms an invitation.
    -- Only a password change after confirmation can complete this step.
    and prior_user_row->>'email_confirmed_at' is not null
    and nullif(current_user_row->>'encrypted_password', '') is not null
    and current_user_row->>'encrypted_password' is distinct from prior_user_row->>'encrypted_password'
  then
    delete from private.account_password_setup where user_id = new.id;
  end if;
  return new;
end;
$$;
revoke all on function private.track_auth_account_password_setup() from public, anon, authenticated, service_role;
-- Run after portal_profile_after_signup, which supplies the alias foreign key.
create trigger portal_z_password_setup_after_auth_change
after insert or update on auth.users for each row
execute function private.track_auth_account_password_setup();

create function private.own_password_setup_required()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.account_password_setup where user_id = auth.uid());
$$;
revoke all on function private.own_password_setup_required() from public, anon, authenticated, service_role;
grant execute on function private.own_password_setup_required() to authenticated;

-- Keep the existing predicates intact except for the additional personal fence.
-- Realtime and Storage also use these predicates outside the PostgREST hook.
do $$
declare
  role_check record;
  source text;
  anchor constant text := E'\nAS $function$\n';
begin
  for role_check in select routine from (values
    ('private.actor_active()'::regprocedure),
    ('private.participant_actor()'::regprocedure),
    ('private.guest_actor()'::regprocedure)
  ) as routines(routine)
  loop
    source := pg_get_functiondef(role_check.routine);
    if cardinality(string_to_array(source, anchor)) <> 2
       or cardinality(string_to_array(source, '$function$')) <> 3 then
      raise exception 'Expected SQL identity predicate %', role_check.routine;
    end if;
    execute split_part(source, anchor, 1) || anchor ||
      ' select not private.own_password_setup_required() and (' ||
      regexp_replace(split_part(split_part(source, anchor, 2), '$function$', 1), '^\s*select\s+|;\s*$', '', 'gi') ||
      '); $function$;';
  end loop;
end;
$$;

-- Preserve normal edition/resource enforcement. Return a password-specific
-- response to the owning browser before any protected endpoint can run.
do $$
declare
  source text := pg_get_functiondef('public.require_portal_access()'::regprocedure);
  anchor constant text := E'\nbegin\n';
begin
  if cardinality(string_to_array(source, anchor)) <> 2 then
    raise exception 'Expected the current REST pre-request gate';
  end if;
  execute replace(source, anchor, anchor ||
    E'  if current_setting(''role'', true) = ''authenticated'' then\n' ||
    E'    if private.own_password_setup_required() then\n' ||
    E'      raise exception ''Personal password setup required'' using errcode = ''PT428'';\n' ||
    E'    end if;\n  end if;\n');
end;
$$;

-- Bound sends across delegates and repeated addresses. The existing seat
-- revision lock serializes cross-admin reservations before this new check.
create index academy_account_invite_budget
  on private.academy_account_requests(installation_id, created_at desc)
  where mode = 'invite';

do $$
declare
  source text := pg_get_functiondef(
    'private.reserve_academy_account(uuid,text,text,text,uuid,text)'::regprocedure
  );
  anchor constant text := '  perform private.require_academy_seat();';
begin
  if cardinality(string_to_array(source, anchor)) <> 2 then
    raise exception 'Expected first-time academy reservation';
  end if;
  execute replace(source, anchor, $guard$  if p_mode = 'invite' and (
    (select count(*) from private.academy_account_requests
     where mode = 'invite' and created_at > statement_timestamp() - interval '15 minutes'
       and installation_id = (select installation_id from private.installation_identity where singleton)) >= 20
    or (select count(*) from private.academy_account_requests
     where mode = 'invite' and created_at > statement_timestamp() - interval '15 minutes'
       and actor_id = actor) >= 5
    or exists (select 1 from private.academy_account_requests
     where mode = 'invite' and created_at > statement_timestamp() - interval '15 minutes'
       and email = email_value)
  ) then
    raise exception 'Academy invitation limit reached' using errcode = 'PT429';
  end if;
$guard$ || anchor);
end;
$$;

notify pgrst, 'reload schema';
commit;
