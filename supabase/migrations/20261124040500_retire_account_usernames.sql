begin;

-- Preserve retained alias rows for upgrades, but remove the public account
-- alias surface and the service lookup that powered alias recovery.
drop function public.academy_save_username(text, integer);
drop function public.save_account_username(text, integer);
drop function public.account_username();
drop function public.login_email_for_alias(text);
revoke execute on function private.academy_save_username(text,integer),
  private.save_account_username(text,integer), private.account_username(),
  private.login_email_for_alias(text) from public, anon, authenticated, service_role;

create or replace function private.academy_personal_settings()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_current_academy_personal_actor();
  return jsonb_build_object(
    'display_name', (select profile.display_name from public.profiles profile where profile.id = auth.uid()),
    'appearance', private.ui_preferences() - 'sidebar_collapsed'
  );
end;
$$;

create function private.save_profile_display_name(p_display_name text)
returns text language plpgsql security definer set search_path = ''
as $$
declare saved text;
begin
  if not (private.actor_active() or private.participant_actor() or private.guest_actor())
  then raise insufficient_privilege; end if;
  if p_display_name is null or length(btrim(p_display_name)) not between 1 and 120
  then raise invalid_parameter_value; end if;
  update public.profiles set display_name = btrim(p_display_name)
    where id = auth.uid() and active returning display_name into saved;
  if not found then raise insufficient_privilege; end if;
  return saved;
end;
$$;

create function public.save_profile_display_name(p_display_name text)
returns text language sql security invoker set search_path = ''
as $$ select private.save_profile_display_name(p_display_name); $$;

revoke all on function private.save_profile_display_name(text), public.save_profile_display_name(text)
  from public, anon, authenticated, service_role;
grant execute on function private.save_profile_display_name(text), public.save_profile_display_name(text)
  to authenticated;

-- Admit only this narrow self-service operation for internal participants.
alter function private.require_portal_access() rename to require_portal_access_before_display_name;
create function private.require_portal_access()
returns void language plpgsql stable security definer set search_path = ''
as $$
begin
  if current_setting('request.path', true) = '/rpc/save_profile_display_name'
     and private.participant_actor() then return; end if;
  perform private.require_portal_access_before_display_name();
end;
$$;
revoke all on function private.require_portal_access_before_display_name(), private.require_portal_access()
  from public, anon, authenticated, service_role;
grant execute on function private.require_portal_access() to authenticated;

create function private.academy_save_display_name(p_display_name text)
returns text language plpgsql security definer set search_path = ''
as $$
begin
  perform private.require_academy_personal_actor(true);
  return private.save_profile_display_name(p_display_name);
end;
$$;

create function public.academy_save_display_name(p_display_name text)
returns text language sql security invoker set search_path = ''
as $$ select private.academy_save_display_name(p_display_name); $$;

revoke all on function private.academy_save_display_name(text),
  public.academy_save_display_name(text) from public, anon, authenticated, service_role;
grant execute on function private.academy_save_display_name(text),
  public.academy_save_display_name(text) to authenticated;

do $migration$
declare definition text := pg_get_functiondef('private.require_academy_course_access()'::regprocedure);
begin
  if cardinality(string_to_array(definition, '/rpc/academy_save_username')) <> 2 then
    raise exception 'Expected one academy settings gate';
  end if;
  execute replace(definition, '/rpc/academy_save_username', '/rpc/academy_save_display_name');
end;
$migration$;

-- Old invitation metadata cannot recreate an account alias during onboarding.
do $migration$
declare
  definition text := pg_get_functiondef('private.track_auth_account_password_setup()'::regprocedure);
  alias_block constant text := $old$  if new_invite then
    initial_alias := current_user_row#>>'{raw_user_meta_data,portal_invitation_username}';
    if initial_alias ~ '^member-[a-f0-9]{24}$' then
      insert into private.user_login_aliases(user_id, username, version)
      values(new.id, initial_alias, 1) on conflict (user_id) do nothing;
    end if;
  end if;
$old$;
begin
  if cardinality(string_to_array(definition, alias_block)) <> 2 then
    raise exception 'Expected one invitation alias block';
  end if;
  execute replace(replace(definition, alias_block, ''), '  initial_alias text;', '');
end;
$migration$;

notify pgrst, 'reload schema';
commit;
