begin;
-- Guests have a separate minimal entrance. They do not satisfy operational
-- actor_active(), so existing business policies gain no additional audience.
create function private.guest_actor() returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.profiles p join public.user_roles r on r.user_id=p.id where p.id=auth.uid() and p.active and r.role='guest');
$$;
revoke all on function private.guest_actor() from public,anon,authenticated,service_role;
grant execute on function private.guest_actor() to authenticated;
create or replace function public.portal_access() returns boolean language sql stable security invoker set search_path='' as $$select private.actor_active() or private.guest_actor();$$;
create or replace function public.require_portal_access() returns void language plpgsql stable security invoker set search_path='' as $$
declare path text:=coalesce(current_setting('request.path',true),'');
begin
 if current_setting('role',true)='authenticated' then
  if not private.actor_active() then
  if not private.guest_actor() or path not in('/profiles','/user_roles','/rpc/portal_access','/rpc/get_my_permissions','/rpc/account_me','/rpc/save_account_profile') then
   raise exception 'Operational portal access required' using errcode='42501';
  end if;
  end if;
 end if;
end;$$;
alter policy portal_members_only on public.profiles using(private.actor_active() or (private.guest_actor() and id=auth.uid())) with check(private.actor_active() or (private.guest_actor() and id=auth.uid()));
alter policy portal_members_only on public.user_roles using(private.actor_active() or (private.guest_actor() and user_id=auth.uid())) with check(private.actor_active() or (private.guest_actor() and user_id=auth.uid()));
create policy guest_own_profile_read on public.profiles for select to authenticated using(private.guest_actor() and id=auth.uid());
create policy guest_own_profile_edit on public.profiles for update to authenticated using(private.guest_actor() and id=auth.uid()) with check(private.guest_actor() and id=auth.uid());
create policy guest_own_roles on public.user_roles for select to authenticated using(private.guest_actor() and user_id=auth.uid());
alter function private.account_me() rename to account_me_before_guest_access;
create function private.account_me() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if private.actor_active() then return private.account_me_before_guest_access();end if;
 if not private.guest_actor() then raise exception 'Active login required' using errcode='42501';end if;
 return jsonb_build_object('profile',(select to_jsonb(p)||jsonb_build_object('email',(select email from auth.users where id=auth.uid())) from public.profiles p where id=auth.uid()),'roles',jsonb_build_array('guest'),'permissions','[]'::jsonb);
end;$$;
revoke all on function private.account_me_before_guest_access(),private.account_me() from public,anon,authenticated,service_role;
grant execute on function private.account_me() to authenticated;
do $migration$declare source text;begin
 select pg_get_functiondef('private.save_account_profile(jsonb)'::regprocedure) into source;
 if position('if not private.actor_active() then' in source)=0 then raise exception 'Unexpected profile implementation';end if;
 execute replace(source,'if not private.actor_active() then','if not private.actor_active() and not private.guest_actor() then');
end;$migration$;

-- Admins may create/promote other admins. Platform owner remains internal;
-- activation/permanent-deletion hierarchy retains its existing stricter rules.
create function private.account_assignable_role(p_role text,p_actor uuid) returns boolean language sql stable security definer set search_path='' as $$
 select p_role in('admin','management','senior_lecturer','lecturer','client','guest')
 and exists(select 1 from public.profiles p join public.user_roles r on r.user_id=p.id join public.role_permissions rp on rp.role=r.role where p.id=p_actor and p.active and rp.permission='users.roles.manage')
 and (private.account_authority(p_actor)>private.account_role_rank(p_role) or (p_role='admin' and private.account_authority(p_actor)>=3));
$$;
create function private.account_role_target_manageable(p_user_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select p_user_id<>auth.uid() and private.has_permission('users.roles.manage') and coalesce((select max(private.account_role_rank(role)) from public.user_roles where user_id=p_user_id),0)<4
 and (private.account_authority(auth.uid())>coalesce((select max(private.account_role_rank(role)) from public.user_roles where user_id=p_user_id),0) or private.account_authority(auth.uid())>=3);
$$;
revoke all on function private.account_assignable_role(text,uuid),private.account_role_target_manageable(uuid) from public,anon,authenticated,service_role;
grant execute on function private.account_assignable_role(text,uuid) to service_role;
create or replace function private.account_role_catalog() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.has_permission('users.manage') then raise exception 'Account management required' using errcode='42501';end if;
 return (select jsonb_agg(jsonb_build_object('role',r,'assignable',private.account_assignable_role(r,auth.uid()),'permissions',coalesce((select jsonb_agg(permission order by permission) from public.role_permissions where role=r),'[]'::jsonb)) order by r) from unnest(array['admin','management','senior_lecturer','lecturer','client','guest']) r);
end;$$;
do $migration$declare source text;begin
 select pg_get_functiondef('private.account_users(text,integer,integer)'::regprocedure) into source;
 if strpos(source,'private.account_target_manageable(p.id) can_assign_roles')=0 then raise exception 'Unexpected account list implementation';end if;
 execute replace(source,'private.account_target_manageable(p.id) can_assign_roles','private.account_role_target_manageable(p.id) can_assign_roles');
 select pg_get_functiondef('private.set_account_roles(uuid,text[])'::regprocedure) into source;
 if strpos(source,'private.account_target_manageable(p_user_id)')=0 or strpos(source,'private.account_role_rank(r)>=private.account_authority(auth.uid())')=0 then raise exception 'Unexpected role implementation';end if;
 source=replace(source,'private.account_target_manageable(p_user_id)','private.account_role_target_manageable(p_user_id)');
 source=replace(source,'private.account_role_rank(r)>=private.account_authority(auth.uid())','not private.account_assignable_role(r,auth.uid())');
 execute source;
 select pg_get_functiondef('private.reserve_account_invitation(text,text,text,uuid,uuid)'::regprocedure) into source;
 source=replace(source,'private.account_authority(auth.uid())<=private.account_role_rank(p_role)','not private.account_assignable_role(p_role,auth.uid())');execute source;
 select pg_get_functiondef('private.complete_account_invitation(uuid,uuid,text,boolean)'::regprocedure) into source;
 source=replace(source,'private.account_authority(r.actor_id)<=private.account_role_rank(r.requested_role)','not private.account_assignable_role(r.requested_role,r.actor_id)');execute source;
end;$migration$;

-- Creation reserves a durable request before touching Auth. Passwords are
-- transient Edge inputs; neither passwords nor password hashes are persisted.
create table private.account_creation_requests(
 id uuid primary key default gen_random_uuid(),actor_id uuid not null,request_id uuid not null,
 email text not null,display_name text not null,requested_role text not null,organisation_id uuid,
 status text not null default 'reserved' check(status in('reserved','created','failed')),
 auth_user_id uuid references public.profiles(id) on delete cascade,created_at timestamptz not null default clock_timestamp(),unique(actor_id,request_id)
);
alter table private.account_creation_requests enable row level security;
create trigger permanent_deletion_fence before insert or update or delete on private.account_creation_requests for each row execute function private.guard_permanent_deletion();
revoke all on private.account_creation_requests from public,anon,authenticated,service_role;
create function private.reserve_account_creation(p_email text,p_display_name text,p_role text,p_organisation_id uuid,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare request private.account_creation_requests;normalized text:=lower(trim(p_email));
begin
 perform pg_advisory_xact_lock(hashtextextended('portal-user-activation',0));
 if not private.has_permission('users.manage') or not private.account_assignable_role(p_role,auth.uid()) then raise exception 'Role assignment permission required' using errcode='42501';end if;
 if p_request_id is null or normalized is null or length(normalized)>254 or normalized!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or p_display_name is null or length(trim(p_display_name)) not between 1 and 120 or (p_role='client')<>(p_organisation_id is not null) then raise exception 'Invalid account request' using errcode='22023';end if;
 if p_organisation_id is not null and (not private.has_permission('finance.gross.read') or not exists(select 1 from public.organisations where id=p_organisation_id and archived_at is null)) then raise exception 'Organisation administration required' using errcode='42501';end if;
 select * into request from private.account_creation_requests where actor_id=auth.uid() and request_id=p_request_id for update;
 if found then
  if request.email<>normalized or request.display_name<>trim(p_display_name) or request.requested_role<>p_role or request.organisation_id is distinct from p_organisation_id then raise exception 'Creation request changed' using errcode='40001';end if;
  return jsonb_build_object('status',case request.status when 'created' then 'created' when 'reserved' then 'in_progress' else 'failed' end,'creation_id',request.id,'user_id',request.auth_user_id);
 end if;
 if (select count(*) from private.account_creation_requests where actor_id=auth.uid() and created_at>clock_timestamp()-interval '1 hour')>=30 then raise exception 'Account creation limit reached' using errcode='54000';end if;
 insert into private.account_creation_requests(actor_id,request_id,email,display_name,requested_role,organisation_id) values(auth.uid(),p_request_id,normalized,trim(p_display_name),p_role,p_organisation_id) returning * into request;
 return jsonb_build_object('status','reserved','creation_id',request.id);
end;$$;
create function public.reserve_account_creation(p_email text,p_display_name text,p_role text,p_organisation_id uuid,p_request_id uuid) returns jsonb language sql security invoker set search_path='' as $$select private.reserve_account_creation(p_email,p_display_name,p_role,p_organisation_id,p_request_id);$$;
create function private.complete_account_creation(p_creation_id uuid,p_user_id uuid,p_success boolean) returns void language plpgsql security definer set search_path='' as $$
declare request private.account_creation_requests;
begin
 perform pg_advisory_xact_lock(hashtextextended('portal-user-activation',0));
 select * into request from private.account_creation_requests where id=p_creation_id for update;
 if p_success is null then raise exception 'Creation decision required' using errcode='22023';end if;
 if not found or request.status<>'reserved' then raise exception 'Creation reservation missing' using errcode='22023';end if;
 if not p_success then update private.account_creation_requests set status='failed' where id=request.id;return;end if;
 if p_user_id is null or not private.account_assignable_role(request.requested_role,request.actor_id) or not exists(select 1 from public.profiles where id=request.actor_id and active) then raise exception 'Creator authority revoked' using errcode='42501';end if;
 if not exists(select 1 from auth.users where id=p_user_id and lower(email)=request.email) then raise exception 'Created identity mismatch' using errcode='22023';end if;
 if request.organisation_id is not null and (not exists(select 1 from public.user_roles r join public.role_permissions rp on rp.role=r.role where r.user_id=request.actor_id and rp.permission='finance.gross.read') or not exists(select 1 from public.organisations where id=request.organisation_id and archived_at is null)) then raise exception 'Organisation authority revoked' using errcode='42501';end if;
 perform 1 from public.profiles where id=p_user_id for update;
 if not found or exists(select 1 from public.user_roles where user_id=p_user_id) then raise exception 'Only newly created accounts may be finalised' using errcode='22023';end if;
 update public.profiles set display_name=request.display_name where id=p_user_id;
 insert into public.user_roles(user_id,role) values(p_user_id,request.requested_role);
 if request.organisation_id is not null then insert into public.client_organisation_memberships(user_id,organisation_id) values(p_user_id,request.organisation_id);end if;
 update private.account_creation_requests set status='created',auth_user_id=p_user_id where id=request.id;
 insert into public.audit_events(actor_id,action,resource_id,details) values(request.actor_id,'account.created',p_user_id,jsonb_build_object('role',request.requested_role,'organisation_id',request.organisation_id));
end;$$;
create function public.complete_account_creation(p_creation_id uuid,p_user_id uuid,p_success boolean) returns void language sql security invoker set search_path='' as $$select private.complete_account_creation(p_creation_id,p_user_id,p_success);$$;
revoke all on function private.reserve_account_creation(text,text,text,uuid,uuid),public.reserve_account_creation(text,text,text,uuid,uuid),private.complete_account_creation(uuid,uuid,boolean),public.complete_account_creation(uuid,uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function private.reserve_account_creation(text,text,text,uuid,uuid),public.reserve_account_creation(text,text,text,uuid,uuid) to authenticated;
grant execute on function private.complete_account_creation(uuid,uuid,boolean),public.complete_account_creation(uuid,uuid,boolean) to service_role;
-- Role conversion and company binding form one transaction. A failed
-- membership check rolls back the rank change as well.
create function private.set_account_roles_with_organisation(p_user_id uuid,p_roles text[],p_organisation_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if p_organisation_id is null or not ('client'=any(p_roles)) then raise exception 'Client organisation required' using errcode='22023';end if;
 perform private.set_account_roles(p_user_id,p_roles);
 perform private.manage_client_organisation(p_user_id,p_organisation_id,false);
end;$$;
create function public.set_account_roles_with_organisation(p_user_id uuid,p_roles text[],p_organisation_id uuid) returns void language sql security invoker set search_path='' as $$select private.set_account_roles_with_organisation(p_user_id,p_roles,p_organisation_id);$$;
revoke all on function private.set_account_roles_with_organisation(uuid,text[],uuid),public.set_account_roles_with_organisation(uuid,text[],uuid) from public,anon,authenticated,service_role;
grant execute on function private.set_account_roles_with_organisation(uuid,text[],uuid),public.set_account_roles_with_organisation(uuid,text[],uuid) to authenticated;
notify pgrst,'reload schema';notify pgrst,'reload config';
commit;
