begin;

-- Keep snapshot reads separate from the mutation lock path so PostgREST and
-- database lint see the same stable, read-only contract.
create function private.require_current_academy_personal_actor()
returns void language plpgsql stable security invoker set search_path = '' as $$
begin
  if not coalesce(private.academy_course_access_status() in ('active', 'grace'), false)
     or not private.learning_actor()
     or not exists (
       select 1 from auth.users
       where id = auth.uid() and email_confirmed_at is not null and nullif(email, '') is not null
     ) then
    raise insufficient_privilege;
  end if;
end;
$$;
revoke all on function private.require_current_academy_personal_actor()
  from public, anon, authenticated, service_role;

create or replace function private.require_academy_personal_actor(p_write boolean)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if p_write then
    perform private.lock_academy_course_access();
    perform 1 from public.profiles where id = auth.uid() and active for update;
    if not found then raise insufficient_privilege; end if;
    perform 1 from public.user_roles where user_id = auth.uid() order by role for share;
  end if;
  perform private.require_current_academy_personal_actor();
end;
$$;

create or replace function private.academy_personal_settings()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_current_academy_personal_actor();
  return jsonb_build_object(
    'username', private.account_username(),
    'appearance', private.ui_preferences() - 'sidebar_collapsed'
  );
end;
$$;

commit;
