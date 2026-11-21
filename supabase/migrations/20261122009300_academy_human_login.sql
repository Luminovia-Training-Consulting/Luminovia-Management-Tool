begin;

-- The credential handler reserves its shared budget during licence grace so
-- eligible users can obtain an Auth token for the read-only course profile.
create function private.require_academy_human_login_access()
returns void language plpgsql stable security definer set search_path = '' as $$
declare
  request_headers jsonb := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
begin
  if current_setting('role', true) is distinct from 'service_role'
     or current_setting('request.method', true) is distinct from 'POST'
     or coalesce(current_setting('request.path', true), '') not in (
       '/rpc/reserve_login_attempt', '/rpc/login_email_for_alias', '/rpc/human_login_profile_active'
     )
     or coalesce(request_headers->>'accept-profile', 'public') <> 'public'
     or coalesce(request_headers->>'content-profile', 'public') <> 'public'
     or not coalesce(private.academy_course_access_status() in ('active', 'grace'), false) then
    raise insufficient_privilege;
  end if;
end;
$$;
revoke all on function private.require_academy_human_login_access()
  from public, anon, authenticated, service_role;
grant execute on function private.require_academy_human_login_access() to service_role;

-- Called with the exact UUID from a fresh successful Auth password exchange.
-- The handler needs an eligibility bit, never a profile row or role metadata.
create function private.human_login_profile_active(p_user_id uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
begin
  if (select edition from private.installation_identity) = 'internal' then
    return exists (select 1 from public.profiles where id = p_user_id and active);
  end if;
  perform private.require_academy_human_login_access();
  return exists (
    select 1 from public.profiles profile
    join auth.users identity on identity.id = profile.id
    where profile.id = p_user_id and profile.active
      and identity.email_confirmed_at is not null and nullif(identity.email, '') is not null
  );
end;
$$;
create function public.human_login_profile_active(p_user_id uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select private.human_login_profile_active(p_user_id);
$$;
revoke all on function private.human_login_profile_active(uuid), public.human_login_profile_active(uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.human_login_profile_active(uuid), public.human_login_profile_active(uuid)
  to service_role;

create or replace function public.require_portal_access()
returns void language plpgsql stable security invoker set search_path = '' as $$
begin
  if (select edition from public.installation_capability_state) is distinct from 'internal' then
    if current_setting('request.path', true) = '/rpc/installation_capabilities'
       and current_setting('request.method', true) in ('GET', 'HEAD', 'POST') then
      return;
    end if;
    if current_setting('role', true) = 'authenticated' then
      perform private.require_academy_course_access();
      return;
    end if;
    if current_setting('role', true) = 'service_role' then
      perform private.require_academy_human_login_access();
      return;
    end if;
    raise exception 'Customer installation is not active' using errcode = '42501';
  end if;
  if current_setting('role', true) = 'authenticated' then
    perform private.require_portal_access();
  end if;
end;
$$;

notify pgrst, 'reload schema';
commit;
