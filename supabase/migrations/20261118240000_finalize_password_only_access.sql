begin;

-- The pre-request hook runs under the request's database role. Give it a
-- narrowly scoped definer so its authenticated-only helper checks also work
-- for service requests, while retaining the explicit authenticated-role gate.
create or replace function public.require_portal_access() returns void
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

-- MFA gates are retired; denial messages should describe the permission that
-- remains authoritative and must not imply a missing second factor.
do $migration$
declare item record; source text;
begin
 for item in
  select p.oid::regprocedure signature
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','private') and p.prokind='f'
    and p.prosrc like '%MFA required%'
 loop
  select pg_catalog.pg_get_functiondef(item.signature) into source;
  execute replace(source,'MFA required','permission required');
 end loop;
end$migration$;

notify pgrst,'reload config';
notify pgrst,'reload schema';
commit;
