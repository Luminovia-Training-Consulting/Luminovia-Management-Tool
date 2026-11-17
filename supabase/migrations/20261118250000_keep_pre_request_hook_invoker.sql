begin;

-- Keep every public function invoker-only. The private definer checks request
-- identity with pinned search_path while allowing non-authenticated API roles
-- to pass the pre-request boundary without calling authenticated-only helpers.
create function private.require_portal_access() returns void
language plpgsql stable security definer set search_path='' as $$
declare path text:=coalesce(current_setting('request.path',true),'');
begin
 if current_setting('role',true)='authenticated' then
  if not private.actor_active() then
   if not private.guest_actor() or path not in
     ('/profiles','/user_roles','/rpc/portal_access','/rpc/get_my_permissions',
      '/rpc/account_me','/rpc/save_account_profile','/rpc/ui_preferences','/rpc/save_ui_preferences') then
    raise exception 'Operational portal access required' using errcode='42501';
   end if;
  end if;
 end if;
end;$$;
revoke all on function private.require_portal_access() from public,anon,authenticated,service_role;
grant execute on function private.require_portal_access() to anon,authenticated,service_role;

create or replace function public.require_portal_access() returns void
language sql stable security invoker set search_path='' as $$
 select private.require_portal_access();
$$;

notify pgrst,'reload config';
notify pgrst,'reload schema';
commit;
