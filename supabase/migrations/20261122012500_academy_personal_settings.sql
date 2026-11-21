begin;

-- The reviewed academy profile permits its confirmed current actors to read
-- their own settings during grace. Writes hold the live release lock.
create function private.require_academy_personal_actor(p_write boolean)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if p_write then
    perform private.lock_academy_course_access();
    perform 1 from public.profiles where id = auth.uid() and active for update;
    if not found then raise insufficient_privilege; end if;
    perform 1 from public.user_roles where user_id = auth.uid() order by role for share;
  elsif not coalesce(private.academy_course_access_status() in ('active', 'grace'), false) then
    raise insufficient_privilege;
  end if;
  if not private.learning_actor() or not exists (
    select 1 from auth.users
    where id = auth.uid() and email_confirmed_at is not null and nullif(email, '') is not null
  ) then raise insufficient_privilege; end if;
end;
$$;

create function private.academy_personal_settings()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_academy_personal_actor(false);
  return jsonb_build_object(
    'username', private.account_username(),
    'appearance', private.ui_preferences() - 'sidebar_collapsed'
  );
end;
$$;

create function private.academy_save_username(p_username text, p_expected_version integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare cause text;
begin
  perform private.require_academy_personal_actor(true);
  return private.save_account_username(p_username, p_expected_version);
exception when serialization_failure then
  get stacked diagnostics cause = message_text;
  if cause = 'Username changed; reload' then
    raise exception 'Username changed; reload' using errcode = 'PT409';
  end if;
  raise;
end;
$$;

create function private.academy_save_appearance(p_patch jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_academy_personal_actor(true);
  if jsonb_typeof(p_patch) is distinct from 'object' then raise invalid_parameter_value; end if;
  if p_patch - array['language','theme'] <> '{}'::jsonb then raise invalid_parameter_value; end if;
  return private.save_ui_preferences(p_patch) - 'sidebar_collapsed';
end;
$$;

create function public.academy_personal_settings()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.academy_personal_settings();
$$;
create function public.academy_save_username(p_username text, p_expected_version integer)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.academy_save_username(p_username, p_expected_version);
$$;
create function public.academy_save_appearance(p_patch jsonb)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.academy_save_appearance(p_patch);
$$;

revoke all on function private.require_academy_personal_actor(boolean)
  from public, anon, authenticated, service_role;
revoke all on function private.academy_personal_settings(), public.academy_personal_settings(),
  private.academy_save_username(text,integer), public.academy_save_username(text,integer),
  private.academy_save_appearance(jsonb), public.academy_save_appearance(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function private.academy_personal_settings(), public.academy_personal_settings(),
  private.academy_save_username(text,integer), public.academy_save_username(text,integer),
  private.academy_save_appearance(jsonb), public.academy_save_appearance(jsonb)
  to authenticated;

do $$
declare
  definition text := pg_catalog.pg_get_functiondef('private.require_academy_course_access()'::regprocedure);
  read_anchor constant text := '  licence_status := private.academy_course_access_status();';
  write_anchor constant text := '''/rpc/academy_create_organisation'', ''/rpc/reserve_academy_account'',';
begin
  if cardinality(string_to_array(definition,read_anchor)) <> 2
    or cardinality(string_to_array(definition,write_anchor)) <> 2 then
    raise exception 'Expected the reviewed academy request gate';
  end if;
  definition := replace(definition,read_anchor,read_anchor || chr(10) ||
    '  if licence_status in (''active'', ''grace'') and request_method = ''POST''' || chr(10) ||
    '     and request_path = ''/rpc/academy_personal_settings'' then return; end if;');
  execute replace(definition,write_anchor,write_anchor || chr(10) ||
    '      ''/rpc/academy_save_username'', ''/rpc/academy_save_appearance'',');
end;
$$;

notify pgrst, 'reload schema';
commit;
