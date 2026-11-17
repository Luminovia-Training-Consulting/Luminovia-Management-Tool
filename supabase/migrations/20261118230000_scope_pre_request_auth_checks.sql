begin;

-- Avoid evaluating authenticated-only helpers for service_role/anon. SQL may
-- reorder boolean operands, so a combined role/helper expression is unsafe.
create or replace function public.require_portal_access() returns void
language plpgsql stable security invoker set search_path='' as $$
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

notify pgrst,'reload schema';
commit;
