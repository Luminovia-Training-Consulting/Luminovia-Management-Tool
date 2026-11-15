begin;

-- All account lifecycle actions share the existing activation lock. User metadata
-- never supplies authority; the actor and target roles come from these tables.
create function private.account_me() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not private.actor_active() then raise exception 'Active login required' using errcode='42501'; end if;
 select to_jsonb(p)||jsonb_build_object('email',(select u.email from auth.users u where u.id=auth.uid())) into result from public.profiles p where p.id=auth.uid();
 return jsonb_build_object('profile',result,'roles',coalesce((select jsonb_agg(role order by role) from public.user_roles where user_id=auth.uid()),'[]'::jsonb),'permissions',coalesce((select jsonb_agg(rp.permission order by rp.permission) from (select distinct permission from public.role_permissions rp join public.user_roles ur on ur.role=rp.role where ur.user_id=auth.uid() and coalesce(auth.jwt()->>'aal','')='aal2') rp),'[]'::jsonb),'assurance_level',auth.jwt()->>'aal');
end;$$;
create function public.account_me() returns jsonb language sql security invoker set search_path='' as $$select private.account_me();$$;

create function private.save_account_profile(p_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.profiles; v_name text; v_de text; v_en text; v_phone text; v_zone text; v_locale text;
begin
 if not private.actor_active() then raise exception 'Active login required' using errcode='42501'; end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or exists(select 1 from jsonb_each(p_payload) e where e.key not in ('display_name','bio_de','bio_en','phone','time_zone','locale') or (jsonb_typeof(e.value)<>'string' and not(e.key='phone' and jsonb_typeof(e.value)='null'))) then raise exception 'Unknown profile field' using errcode='22023'; end if;
 select * into p from public.profiles where id=auth.uid() for update;
 v_name=coalesce(p_payload->>'display_name',p.display_name); v_de=coalesce(p_payload->>'bio_de',p.bio_de); v_en=coalesce(p_payload->>'bio_en',p.bio_en); v_phone=case when p_payload?'phone' then p_payload->>'phone' else p.phone end; v_zone=coalesce(p_payload->>'time_zone',p.time_zone); v_locale=coalesce(p_payload->>'locale',p.locale);
 if length(trim(v_name)) not between 1 and 120 or length(v_de)>4000 or length(v_en)>4000 or length(coalesce(v_phone,''))>50 or v_locale not in ('de','en') or not exists(select 1 from pg_catalog.pg_timezone_names where name=v_zone) then raise exception 'Invalid profile' using errcode='22023'; end if;
 update public.profiles set display_name=trim(v_name),bio_de=v_de,bio_en=v_en,phone=v_phone,time_zone=v_zone,locale=v_locale where id=auth.uid();
 return private.account_me();
end;$$;
create function public.save_account_profile(p_payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.save_account_profile(p_payload);$$;

create function private.account_users(p_search text default '',p_limit integer default 50,p_offset integer default 0) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.has_permission('users.manage') then raise exception 'users.manage and MFA required' using errcode='42501'; end if;
 if p_search is null or length(p_search)>120 or p_limit is null or p_offset is null or p_limit not between 1 and 100 or p_offset not between 0 and 100000 then raise exception 'Invalid pagination' using errcode='22023'; end if;
 return jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(record_data)) from (select p.id,p.display_name,p.active,p.locale,p.time_zone,p.created_at,u.email,coalesce((select jsonb_agg(ur.role order by ur.role) from public.user_roles ur where ur.user_id=p.id),'[]'::jsonb) roles from public.profiles p join auth.users u on u.id=p.id where position(lower(p_search) in lower(p.display_name))>0 or position(lower(p_search) in lower(coalesce(u.email,'')))>0 order by p.display_name,p.id limit p_limit offset p_offset) record_data),'[]'::jsonb),'total',(select count(*) from public.profiles p join auth.users u on u.id=p.id where position(lower(p_search) in lower(p.display_name))>0 or position(lower(p_search) in lower(coalesce(u.email,'')))>0),'limit',p_limit,'offset',p_offset);
end;$$;
create function public.account_users(p_search text default '',p_limit integer default 50,p_offset integer default 0) returns jsonb language sql security invoker set search_path='' as $$select private.account_users(p_search,p_limit,p_offset);$$;

create function private.account_role_catalog() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.has_permission('users.manage') then raise exception 'users.manage and MFA required' using errcode='42501'; end if;
 return (select jsonb_agg(jsonb_build_object('role',r,'permissions',coalesce((select jsonb_agg(permission order by permission) from public.role_permissions where role=r),'[]'::jsonb)) order by r) from unnest(array['owner','admin','management','senior_lecturer','lecturer','client','participant']) r);
end;$$;
create function public.account_role_catalog() returns jsonb language sql security invoker set search_path='' as $$select private.account_role_catalog();$$;

create function private.set_account_roles(p_user_id uuid,p_roles text[]) returns jsonb language plpgsql security definer set search_path='' as $$
declare before_roles text[]; normalized text[];
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('portal-user-activation',0));
 if not private.has_permission('users.roles.manage') then raise exception 'users.roles.manage and MFA required' using errcode='42501'; end if;
 if p_roles is null or cardinality(p_roles) not between 1 and 7 or array_position(p_roles,null) is not null or exists(select 1 from unnest(p_roles) r where r not in ('owner','admin','management','senior_lecturer','lecturer','client','participant')) then raise exception 'Invalid roles' using errcode='22023'; end if;
 select array_agg(distinct r order by r) into normalized from unnest(p_roles) r;
 perform 1 from public.profiles where id=p_user_id for update;
 if not found then raise exception 'Account not found' using errcode='22023'; end if;
 select coalesce(array_agg(role order by role),'{}'::text[]) into before_roles from public.user_roles where user_id=p_user_id;
 if before_roles&&array['admin','owner'] and not normalized&&array['admin','owner'] then
  if p_user_id=auth.uid() then raise exception 'Self administrative removal denied' using errcode='22023'; end if;
  if not exists(select 1 from public.user_roles ur join public.profiles p on p.id=ur.user_id where ur.role in ('admin','owner') and p.active and p.id<>p_user_id) then raise exception 'Last active administrator protected' using errcode='22023'; end if;
 end if;
 delete from public.user_roles where user_id=p_user_id and not role=any(normalized);
 insert into public.user_roles(user_id,role) select p_user_id,r from unnest(normalized) r on conflict do nothing;
 if before_roles is distinct from normalized then insert into public.audit_events(actor_id,action,resource_id,details) values(auth.uid(),'account.roles_changed',p_user_id,jsonb_build_object('before',before_roles,'after',normalized)); end if;
 return jsonb_build_object('id',p_user_id,'roles',to_jsonb(normalized));
end;$$;
create function public.set_account_roles(p_user_id uuid,p_roles text[]) returns jsonb language sql security invoker set search_path='' as $$select private.set_account_roles(p_user_id,p_roles);$$;

create or replace function private.set_user_active(p_user_id uuid,p_active boolean) returns void language plpgsql security definer set search_path='' as $$
declare previous boolean;
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('portal-user-activation',0));
 if not private.has_permission('users.manage') then raise exception 'users.manage and MFA required' using errcode='42501'; end if;
 if p_active is null then raise exception 'Activation decision required' using errcode='22023'; end if;
 if p_user_id=auth.uid() and not p_active then raise exception 'Self-deactivation is not permitted' using errcode='22023'; end if;
 select active into previous from public.profiles where id=p_user_id for update;
 if not found then raise exception 'Profile not found' using errcode='22023'; end if;
 if previous and not p_active and exists(select 1 from public.user_roles where user_id=p_user_id and role in ('admin','owner')) and not exists(select 1 from public.user_roles ur join public.profiles p on p.id=ur.user_id where ur.role in ('admin','owner') and p.active and p.id<>p_user_id) then raise exception 'The last active administrator must remain active' using errcode='22023'; end if;
 if previous is distinct from p_active then
  update public.profiles set active=p_active where id=p_user_id;
  insert into public.audit_events(actor_id,action,resource_id,details) values(auth.uid(),case when p_active then 'user.activated' else 'user.deactivated' end,p_user_id,jsonb_build_object('previous_active',previous,'active',p_active));
 end if;
end;$$;

alter table public.invitation_requests add column requested_role text not null default 'lecturer' check(requested_role in ('owner','admin','management','senior_lecturer','lecturer','client','participant'));
alter table public.invitation_requests add column organisation_id uuid references public.organisations(id);
alter table public.invitation_requests add column display_name text not null default '' check(length(display_name)<=120);
create function private.reserve_account_invitation(p_email text,p_display_name text,p_role text,p_organisation_id uuid,p_idempotency_key uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.invitation_requests; actor uuid:=auth.uid(); normalized text:=lower(trim(p_email));
begin
 if not private.has_permission('users.manage') then raise exception 'users.manage and MFA required' using errcode='42501'; end if;
 if p_role not in ('owner','admin','management','senior_lecturer','lecturer','client','participant') or p_role is null or p_display_name is null or length(trim(p_display_name))>120 or p_idempotency_key is null or normalized is null or length(normalized)>254 or normalized!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Invalid invitation' using errcode='22023'; end if;
 if p_role in ('owner','admin','management','senior_lecturer','client') and not private.has_permission('users.roles.manage') then raise exception 'Role assignment permission required' using errcode='42501'; end if;
 if (p_role='client')<>(p_organisation_id is not null) or (p_organisation_id is not null and not exists(select 1 from public.organisations where id=p_organisation_id and archived_at is null)) then raise exception 'Valid client organisation required' using errcode='22023'; end if;
 p_display_name=trim(p_display_name);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('invite:'||actor::text,0));
 select * into r from public.invitation_requests where actor_id=actor and idempotency_key=p_idempotency_key;
 if found then
  if r.email<>normalized or r.requested_role<>p_role or r.organisation_id is distinct from p_organisation_id or (p_display_name<>'' and r.display_name<>p_display_name) then return jsonb_build_object('status','idempotency_conflict'); end if;
  return jsonb_build_object('status',case r.status when 'sent' then 'already_sent' when 'reserved' then 'in_progress' else 'failed' end,'invitation_id',r.id);
 end if;
 select * into r from public.invitation_requests where email=normalized;
 if found then return jsonb_build_object('status',case when r.requested_role<>p_role or r.organisation_id is distinct from p_organisation_id then 'idempotency_conflict' when r.status='sent' then 'already_sent' when r.status='reserved' then 'in_progress' else 'failed' end,'invitation_id',r.id); end if;
 if (select count(*) from public.invitation_requests where actor_id=actor and created_at>now()-interval '15 minutes')>=5 then return jsonb_build_object('status','throttled'); end if;
 insert into public.invitation_requests(actor_id,idempotency_key,email,requested_role,organisation_id,display_name) values(actor,p_idempotency_key,normalized,p_role,p_organisation_id,trim(p_display_name)) returning * into r;
 insert into public.audit_events(actor_id,action,resource_id,details) values(actor,'invitation.reserved',r.id,jsonb_build_object('role',p_role,'organisation_id',p_organisation_id));
 return jsonb_build_object('status','reserved','invitation_id',r.id);
exception when unique_violation then return jsonb_build_object('status','in_progress');
end;$$;
create function public.reserve_account_invitation(p_email text,p_display_name text,p_role text,p_organisation_id uuid,p_idempotency_key uuid) returns jsonb language sql security invoker set search_path='' as $$select private.reserve_account_invitation(p_email,p_display_name,p_role,p_organisation_id,p_idempotency_key);$$;
create or replace function private.reserve_invitation(p_email text,p_idempotency_key uuid) returns jsonb language sql security definer set search_path='' as $$select private.reserve_account_invitation(p_email,'','lecturer',null,p_idempotency_key);$$;

create function private.complete_account_invitation(p_invitation_id uuid,p_user_id uuid,p_display_name text,p_success boolean) returns void language plpgsql security invoker set search_path='' as $$
declare r public.invitation_requests; required_permission text;
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('portal-user-activation',0));
 select * into r from public.invitation_requests where id=p_invitation_id for update;
 if not found or r.status<>'reserved' then raise exception 'Invitation reservation missing' using errcode='22023'; end if;
 if p_success then
  required_permission=case when r.requested_role in ('owner','admin','management','senior_lecturer','client') then 'users.roles.manage' else 'users.manage' end;
  if p_user_id is null or not exists(select 1 from public.profiles p join public.user_roles ur on ur.user_id=p.id join public.role_permissions rp on rp.role=ur.role where p.id=r.actor_id and p.active and rp.permission=required_permission) then raise exception 'Inviter authority revoked' using errcode='42501'; end if;
  update public.profiles set display_name=left(coalesce(nullif(r.display_name,''),p_display_name,''),120) where id=p_user_id;
  insert into public.user_roles(user_id,role) values(p_user_id,r.requested_role) on conflict do nothing;
  if r.requested_role='client' then insert into public.client_organisation_memberships(user_id,organisation_id) values(p_user_id,r.organisation_id) on conflict(user_id,organisation_id) do update set removed_at=null; end if;
 end if;
 update public.invitation_requests set status=case when p_success then 'sent' else 'failed' end,auth_user_id=p_user_id,completed_at=now() where id=r.id;
 insert into public.audit_events(actor_id,action,resource_id,details) values(r.actor_id,case when p_success then 'invitation.sent' else 'invitation.failed' end,r.id,jsonb_build_object('role',r.requested_role,'organisation_id',r.organisation_id));
end;$$;
create function public.complete_account_invitation(p_invitation_id uuid,p_user_id uuid,p_display_name text,p_success boolean) returns void language sql security invoker set search_path='' as $$select private.complete_account_invitation(p_invitation_id,p_user_id,p_display_name,p_success);$$;
create or replace function private.complete_invitation(p_invitation_id uuid,p_user_id uuid,p_display_name text,p_success boolean) returns void language sql security invoker set search_path='' as $$select private.complete_account_invitation(p_invitation_id,p_user_id,p_display_name,p_success);$$;

revoke all on function private.account_me(),public.account_me(),private.save_account_profile(jsonb),public.save_account_profile(jsonb),private.account_users(text,integer,integer),public.account_users(text,integer,integer),private.account_role_catalog(),public.account_role_catalog(),private.set_account_roles(uuid,text[]),public.set_account_roles(uuid,text[]),private.reserve_account_invitation(text,text,text,uuid,uuid),public.reserve_account_invitation(text,text,text,uuid,uuid) from public,anon,authenticated;
grant execute on function private.account_me(),public.account_me(),private.save_account_profile(jsonb),public.save_account_profile(jsonb),private.account_users(text,integer,integer),public.account_users(text,integer,integer),private.account_role_catalog(),public.account_role_catalog(),private.set_account_roles(uuid,text[]),public.set_account_roles(uuid,text[]),private.reserve_account_invitation(text,text,text,uuid,uuid),public.reserve_account_invitation(text,text,text,uuid,uuid) to authenticated;
revoke all on function private.complete_account_invitation(uuid,uuid,text,boolean),public.complete_account_invitation(uuid,uuid,text,boolean) from public,anon,authenticated;
grant execute on function private.complete_account_invitation(uuid,uuid,text,boolean),public.complete_account_invitation(uuid,uuid,text,boolean) to service_role;
commit;
