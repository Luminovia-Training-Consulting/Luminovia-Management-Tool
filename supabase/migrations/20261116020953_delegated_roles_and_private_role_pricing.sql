begin;
-- Authority is always current database role membership, never browser metadata.
alter table public.user_roles drop constraint user_roles_role_check;
alter table public.user_roles add constraint user_roles_role_check check(role in ('owner','admin','management','senior_lecturer','lecturer','client','participant','guest'));
alter table public.invitation_requests drop constraint invitation_requests_requested_role_check;
alter table public.invitation_requests add constraint invitation_requests_requested_role_check check(requested_role in ('owner','admin','management','senior_lecturer','lecturer','client','participant','guest'));
insert into public.role_permissions(role,permission) values('management','users.roles.manage') on conflict do nothing;
create function private.account_role_rank(p_role text) returns integer language sql immutable set search_path='' as $$
 select case p_role when 'owner' then 4 when 'admin' then 3 when 'management' then 2 when 'senior_lecturer' then 1 when 'lecturer' then 1 when 'client' then 1 when 'participant' then 1 when 'guest' then 1 else 0 end;
$$;
create function private.account_authority(p_user_id uuid) returns integer language sql stable security definer set search_path='' as $$
 select coalesce(max(private.account_role_rank(r.role)),0) from public.user_roles r join public.profiles p on p.id=r.user_id where p.id=p_user_id and p.active;
$$;
create function private.account_target_manageable(p_user_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.has_permission('users.roles.manage') and p_user_id<>auth.uid() and private.account_authority(auth.uid())>coalesce((select max(private.account_role_rank(role)) from public.user_roles where user_id=p_user_id),0);
$$;
revoke execute on function private.account_role_rank(text),private.account_authority(uuid),private.account_target_manageable(uuid) from public,anon,authenticated;
grant execute on function private.account_role_rank(text),private.account_authority(uuid) to service_role;


create or replace function private.account_users(p_search text default '',p_limit integer default 50,p_offset integer default 0) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.has_permission('users.manage') then raise exception 'users.manage and MFA required' using errcode='42501'; end if;
 if p_search is null or length(p_search)>120 or p_limit is null or p_offset is null or p_limit not between 1 and 100 or p_offset not between 0 and 100000 then raise exception 'Invalid pagination' using errcode='22023'; end if;
 return jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(record_data)) from (select p.id,p.display_name,p.active,p.locale,p.time_zone,p.created_at,u.email,private.account_target_manageable(p.id) can_assign_roles,private.account_target_manageable(p.id) can_change_active,coalesce((select jsonb_agg(ur.role order by ur.role) from public.user_roles ur where ur.user_id=p.id),'[]'::jsonb) roles from public.profiles p join auth.users u on u.id=p.id where position(lower(p_search) in lower(p.display_name))>0 or position(lower(p_search) in lower(coalesce(u.email,'')))>0 order by p.display_name,p.id limit p_limit offset p_offset) record_data),'[]'::jsonb),'total',(select count(*) from public.profiles p join auth.users u on u.id=p.id where position(lower(p_search) in lower(p.display_name))>0 or position(lower(p_search) in lower(coalesce(u.email,'')))>0),'limit',p_limit,'offset',p_offset);
end;$$;

create or replace function private.account_role_catalog() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.has_permission('users.manage') then raise exception 'users.manage and MFA required' using errcode='42501'; end if;
 return (select jsonb_agg(jsonb_build_object('role',r,'assignable',private.account_authority(auth.uid())>private.account_role_rank(r),'permissions',coalesce((select jsonb_agg(permission order by permission) from public.role_permissions where role=r),'[]'::jsonb)) order by r) from unnest(array['owner','admin','management','senior_lecturer','lecturer','client','participant','guest']) r);
end;$$;

create or replace function private.set_account_roles(p_user_id uuid,p_roles text[]) returns jsonb language plpgsql security definer set search_path='' as $$
declare before_roles text[]; normalized text[];
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('portal-user-activation',0));
 if not private.has_permission('users.roles.manage') then raise exception 'users.roles.manage and MFA required' using errcode='42501'; end if;
 if p_roles is null or cardinality(p_roles) not between 1 and 8 or array_position(p_roles,null) is not null or exists(select 1 from unnest(p_roles) r where r not in ('owner','admin','management','senior_lecturer','lecturer','client','participant','guest')) then raise exception 'Invalid roles' using errcode='22023'; end if;
 if p_user_id=auth.uid() then raise exception 'Self administrative role changes denied' using errcode='42501';end if;
 if not private.account_target_manageable(p_user_id) or exists(select 1 from unnest(p_roles) r where private.account_role_rank(r)>=private.account_authority(auth.uid())) then raise exception 'Only subordinate accounts and roles may be assigned' using errcode='42501';end if;
 if p_roles&&array['client'] and p_roles&&array['management','lecturer','senior_lecturer'] and not p_roles&&array['admin','owner'] then raise exception 'Client and staff roles require separate accounts' using errcode='22023';end if;
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

create or replace function private.set_user_active(p_user_id uuid,p_active boolean) returns void language plpgsql security definer set search_path='' as $$
declare previous boolean;
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('portal-user-activation',0));
 if not private.has_permission('users.manage') then raise exception 'users.manage and MFA required' using errcode='42501'; end if;
 if p_active is null then raise exception 'Activation decision required' using errcode='22023'; end if;
 if p_user_id=auth.uid() then raise exception 'Self-deactivation is not permitted' using errcode='42501';end if;
 if not private.account_target_manageable(p_user_id) then raise exception 'Only subordinate account activation may be changed' using errcode='42501';end if;
 select active into previous from public.profiles where id=p_user_id for update;
 if not found then raise exception 'Profile not found' using errcode='22023'; end if;
 if previous and not p_active and exists(select 1 from public.user_roles where user_id=p_user_id and role in ('admin','owner')) and not exists(select 1 from public.user_roles ur join public.profiles p on p.id=ur.user_id where ur.role in ('admin','owner') and p.active and p.id<>p_user_id) then raise exception 'The last active administrator must remain active' using errcode='22023'; end if;
 if previous is distinct from p_active then
  update public.profiles set active=p_active where id=p_user_id;
  insert into public.audit_events(actor_id,action,resource_id,details) values(auth.uid(),case when p_active then 'user.activated' else 'user.deactivated' end,p_user_id,jsonb_build_object('previous_active',previous,'active',p_active));
 end if;
end;$$;

create or replace function private.reserve_account_invitation(p_email text,p_display_name text,p_role text,p_organisation_id uuid,p_idempotency_key uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.invitation_requests; actor uuid:=auth.uid(); normalized text:=lower(trim(p_email));
begin
 if not private.has_permission('users.manage') then raise exception 'users.manage and MFA required' using errcode='42501'; end if;
 if p_role not in ('owner','admin','management','senior_lecturer','lecturer','client','participant','guest') or p_role is null or p_display_name is null or length(trim(p_display_name))>120 or p_idempotency_key is null or normalized is null or length(normalized)>254 or normalized!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Invalid invitation' using errcode='22023'; end if;
 if not private.has_permission('users.roles.manage') or private.account_authority(auth.uid())<=private.account_role_rank(p_role) then raise exception 'Only subordinate invitation roles may be assigned' using errcode='42501';end if;
 if (p_role<>'client' and p_organisation_id is not null) or (p_organisation_id is not null and not exists(select 1 from public.organisations where id=p_organisation_id and archived_at is null)) then raise exception 'Valid client organisation required' using errcode='22023'; end if;
 if p_organisation_id is not null and not private.has_permission('finance.gross.read') then raise exception 'Client organisation administration and MFA required' using errcode='42501';end if;
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

create or replace function private.complete_account_invitation(p_invitation_id uuid,p_user_id uuid,p_display_name text,p_success boolean) returns void language plpgsql security invoker set search_path='' as $$
declare r public.invitation_requests; required_permission text;
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('portal-user-activation',0));
 select * into r from public.invitation_requests where id=p_invitation_id for update;
 if not found or r.status<>'reserved' then raise exception 'Invitation reservation missing' using errcode='22023'; end if;
 if p_success then
  required_permission=case when r.organisation_id is not null then 'finance.gross.read' else 'users.roles.manage' end;
  if p_user_id is null or not exists(select 1 from public.profiles p join public.user_roles ur on ur.user_id=p.id join public.role_permissions rp on rp.role=ur.role where p.id=r.actor_id and p.active and rp.permission=required_permission) then raise exception 'Inviter authority revoked' using errcode='42501'; end if;
  if private.account_authority(r.actor_id)<=private.account_role_rank(r.requested_role) or coalesce((select max(private.account_role_rank(role)) from public.user_roles where user_id=p_user_id),0)>=private.account_authority(r.actor_id) then raise exception 'Inviter authority revoked' using errcode='42501';end if;
  if r.requested_role='client' and exists(select 1 from public.user_roles where user_id=p_user_id and role in ('management','lecturer','senior_lecturer')) then raise exception 'Client and staff roles require separate accounts' using errcode='22023';end if;
  update public.profiles set display_name=left(coalesce(nullif(r.display_name,''),p_display_name,''),120) where id=p_user_id;
  insert into public.user_roles(user_id,role) values(p_user_id,r.requested_role) on conflict do nothing;
  if r.requested_role='client' and r.organisation_id is not null then insert into public.client_organisation_memberships(user_id,organisation_id) values(p_user_id,r.organisation_id) on conflict(user_id,organisation_id) do update set removed_at=null; end if;
 end if;
 update public.invitation_requests set status=case when p_success then 'sent' else 'failed' end,auth_user_id=p_user_id,completed_at=now() where id=r.id;
 insert into public.audit_events(actor_id,action,resource_id,details) values(r.actor_id,case when p_success then 'invitation.sent' else 'invitation.failed' end,r.id,jsonb_build_object('role',r.requested_role,'organisation_id',r.organisation_id));
end;$$;

create or replace function private.manage_client_organisation(p_user_id uuid,p_organisation_id uuid,p_remove boolean default false) returns void language plpgsql security definer set search_path='' as $$
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('portal-user-activation',0));
 if not private.has_permission('finance.gross.read') then raise exception 'Client membership management and MFA required' using errcode='42501';end if;
 if not private.account_target_manageable(p_user_id) then raise exception 'Only subordinate client memberships may be changed' using errcode='42501';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('client-membership:'||p_user_id::text,0));
 if p_remove is null or not exists(select 1 from public.organisations where id=p_organisation_id) or (not p_remove and not exists(select 1 from public.profiles p join public.user_roles r on r.user_id=p.id where p.id=p_user_id and p.active and r.role='client')) then raise exception 'Active client and valid organisation required' using errcode='22023';end if;
 insert into public.client_organisation_memberships(user_id,organisation_id,removed_at) values(p_user_id,p_organisation_id,case when p_remove then clock_timestamp() end) on conflict(user_id,organisation_id) do update set removed_at=excluded.removed_at;
 insert into public.audit_events(actor_id,action,resource_id,details) values(auth.uid(),case when p_remove then 'client.membership_removed' else 'client.membership_added' end,p_user_id,jsonb_build_object('organisation_id',p_organisation_id));
end;$$;

create or replace function private.client_has_organisation(p_organisation_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.has_role(array['client']) and not exists(select 1 from public.user_roles where user_id=auth.uid() and role in ('management','lecturer','senior_lecturer')) and exists(select 1 from public.client_organisation_memberships m join public.organisations o on o.id=m.organisation_id where m.user_id=auth.uid() and m.organisation_id=p_organisation_id and m.removed_at is null and o.archived_at is null);
$$;

-- All historical accepted deals remain byte-for-byte unchanged. Only offers with
-- no claim history can move to the new policy; their consent version advances.
alter table private.job_commission_offers add column pricing_mode text not null default 'legacy' check(pricing_mode in ('legacy','role_split'));
update private.job_commission_offers o set pricing_mode='role_split' where not exists(select 1 from public.job_claims c where c.job_id=o.job_id);
update public.jobs j set amount=0,total_amount=0,terms_version=terms_version+1 where exists(select 1 from private.job_commission_offers o where o.job_id=j.id and o.pricing_mode='role_split');
alter table private.job_commission_offers alter column pricing_mode set default 'role_split';
-- Commercial rates are private operational data, never seeded in public source.
create table private.compensation_policy (
 singleton boolean primary key default true check(singleton),version integer not null check(version>0),
 regular_percent numeric(5,2) not null check(regular_percent between 0 and 100),
 senior_percent numeric(5,2) not null check(senior_percent between 0 and 100 and senior_percent>regular_percent),
 updated_by uuid not null references public.profiles(id),updated_at timestamptz not null default clock_timestamp()
);
alter table private.compensation_policy enable row level security;
revoke all on private.compensation_policy from public,anon,authenticated;
alter table private.job_commission_offers add column regular_percent numeric(5,2),add column senior_percent numeric(5,2),add column policy_version integer;
alter table private.job_commission_offers add constraint valid_offer_policy check((regular_percent is null and senior_percent is null and policy_version is null) or (regular_percent is not null and senior_percent is not null and policy_version is not null and regular_percent between 0 and 100 and senior_percent>regular_percent and senior_percent<=100 and policy_version>0));

create function private.role_net(p_gross numeric,p_user_id uuid,p_job_id uuid) returns numeric language sql stable security definer set search_path='' as $$
 select round(p_gross*(case when exists(select 1 from public.user_roles where user_id=p_user_id and role='senior_lecturer') then o.senior_percent else o.regular_percent end)/100,2) from private.job_commission_offers o where o.job_id=p_job_id;
$$;
create function private.role_quote_version(p_base integer,p_user_id uuid) returns integer language plpgsql stable security definer set search_path='' as $$
begin
 if p_base>214748364 then raise exception 'Offer version requires administrative renewal' using errcode='22023';end if;
 return p_base*10+case when exists(select 1 from public.user_roles where user_id=p_user_id and role='senior_lecturer') then 2 else 1 end;
end;$$;
revoke execute on function private.role_net(numeric,uuid,uuid),private.role_quote_version(integer,uuid) from public,anon,authenticated;
create or replace function private.commission_access() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('can_manage_gross',private.has_permission('finance.gross.read'),'can_manage_client_memberships',private.has_permission('finance.gross.read'),'can_request',private.has_permission('finance.gross.read') or (private.has_role(array['client']) and exists(select 1 from public.client_organisation_memberships m where m.user_id=auth.uid() and private.client_has_organisation(m.organisation_id))),'policy_configured',exists(select 1 from private.compensation_policy)) || case when private.has_permission('finance.gross.read') then jsonb_build_object('regular_lecturer_percent',(select regular_percent from private.compensation_policy),'senior_lecturer_percent',(select senior_percent from private.compensation_policy),'policy_version',coalesce((select version from private.compensation_policy),0)) else '{}'::jsonb end;
$$;
create function private.job_offers() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not private.actor_active() then raise exception 'Active login required' using errcode='42501';end if;
 select coalesce(jsonb_agg(to_jsonb(j)||jsonb_build_object(
  'amount',case when o.pricing_mode='role_split' then case when private.lecturer_actor() then private.role_net(o.gross_amount,auth.uid(),j.id) end else j.amount end,
  'total_amount',case when o.pricing_mode='role_split' then case when private.lecturer_actor() then private.role_net(o.gross_total_amount,auth.uid(),j.id) end else j.total_amount end,
  'terms_version',case when o.pricing_mode='role_split' and private.lecturer_actor() then private.role_quote_version(j.terms_version,auth.uid()) else j.terms_version end,
  'job_sessions',coalesce((select jsonb_agg(s order by s.starts_at) from public.job_sessions s where s.job_id=j.id),'[]'::jsonb),
  'job_requirements',coalesce((select jsonb_agg(jsonb_build_object('topic_id',r.topic_id)) from public.job_requirements r where r.job_id=j.id),'[]'::jsonb)) order by j.created_at desc,j.id),'[]'::jsonb) into result
 from public.jobs j left join private.job_commission_offers o on o.job_id=j.id
 where private.has_permission('jobs.manage') or (j.status='published' and private.lecturer_actor()) or exists(select 1 from public.job_claims c where c.job_id=j.id and c.lecturer_id=auth.uid());
 return result;
end;$$;
create function public.job_offers() returns jsonb language sql stable security invoker set search_path='' as $$select private.job_offers();$$;
revoke execute on function private.job_offers(),public.job_offers() from public,anon;
grant execute on function private.job_offers(),public.job_offers() to authenticated;
-- No default/other lecturer rate is stored in publicly queryable job columns.
create function private.normalize_role_offer() returns trigger language plpgsql security definer set search_path='' as $$
declare policy private.compensation_policy;
begin
 if new.pricing_mode='role_split' then
  if new.policy_version is null then
   select * into policy from private.compensation_policy where singleton;
   if policy.version is null then raise exception 'Compensation policy has not been configured' using errcode='22023';end if;
   new.policy_version=policy.version;new.regular_percent=policy.regular_percent;new.senior_percent=policy.senior_percent;
  end if;
  new.platform_percent=100-new.regular_percent;new.lecturer_net_amount=round(new.gross_amount*new.regular_percent/100,2);new.lecturer_net_total_amount=round(new.gross_total_amount*new.regular_percent/100,2);new.platform_total_amount=new.gross_total_amount-new.lecturer_net_total_amount;
 end if;return new;
end;$$;
create function private.clear_role_offer_public_rate() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.pricing_mode='role_split' then update public.jobs set amount=0,total_amount=0 where id=new.job_id and (amount<>0 or total_amount<>0);end if;return new;
end;$$;
create trigger normalize_role_offer before insert or update on private.job_commission_offers for each row execute function private.normalize_role_offer();
create trigger clear_role_offer_public_rate after insert or update on private.job_commission_offers for each row execute function private.clear_role_offer_public_rate();
revoke execute on function private.normalize_role_offer(),private.clear_role_offer_public_rate() from public,anon,authenticated;


create or replace function private.set_job_commission(p_job_id uuid,p_gross_amount numeric,p_gross_total_amount numeric,p_platform_percent numeric default null) returns void language plpgsql security definer set search_path='' as $$
declare j public.jobs;org uuid;policy private.compensation_policy;net numeric;net_total numeric;
begin
 if not private.has_permission('finance.gross.read') then raise exception 'Gross finance permission and MFA required' using errcode='42501';end if;
 if p_platform_percent is not null then raise exception 'Compensation policy is configured separately' using errcode='22023';end if;
 select * into policy from private.compensation_policy where singleton;
 if policy.version is null then raise exception 'Compensation policy has not been configured' using errcode='22023';end if;
 if p_gross_amount is null or p_gross_total_amount is null or p_gross_amount not between 0.01 and 9999999999.99 or p_gross_total_amount not between 0.01 and 9999999999.99 or p_gross_amount<>round(p_gross_amount,2) or p_gross_total_amount<>round(p_gross_total_amount,2) then raise exception 'Invalid commission' using errcode='22023';end if;
 select * into j from public.jobs where id=p_job_id for update;
 if not found or j.status not in ('draft','published') or exists(select 1 from public.job_claims where job_id=p_job_id) then raise exception 'Only unaccepted offers can change commission' using errcode='22023';end if;
 select organisation_id into org from public.course_runs where id=j.course_run_id;
 if org is null then raise exception 'Offer requires an organisation' using errcode='22023';end if;
 if j.rate_unit='fixed_total' and p_gross_amount<>p_gross_total_amount then raise exception 'Fixed total fee must match' using errcode='22023';end if;
 if exists(select 1 from private.job_commission_offers o where o.job_id=p_job_id and o.gross_amount=p_gross_amount and o.gross_total_amount=p_gross_total_amount and o.policy_version=policy.version and o.currency=j.currency and o.pricing_mode='role_split') then return;end if;
 net=round(p_gross_amount*policy.regular_percent/100,2);net_total=round(p_gross_total_amount*policy.regular_percent/100,2);
 insert into private.job_commission_offers(job_id,organisation_id,gross_amount,gross_total_amount,platform_percent,platform_total_amount,lecturer_net_amount,lecturer_net_total_amount,currency,pricing_mode,regular_percent,senior_percent,policy_version)
 values(p_job_id,org,p_gross_amount,p_gross_total_amount,100-policy.regular_percent,p_gross_total_amount-net_total,net,net_total,j.currency,'role_split',policy.regular_percent,policy.senior_percent,policy.version)
 on conflict(job_id) do update set organisation_id=excluded.organisation_id,gross_amount=excluded.gross_amount,gross_total_amount=excluded.gross_total_amount,platform_percent=excluded.platform_percent,platform_total_amount=excluded.platform_total_amount,lecturer_net_amount=excluded.lecturer_net_amount,lecturer_net_total_amount=excluded.lecturer_net_total_amount,currency=excluded.currency,pricing_mode='role_split',regular_percent=excluded.regular_percent,senior_percent=excluded.senior_percent,policy_version=excluded.policy_version,updated_at=clock_timestamp();
 update public.jobs set amount=0,total_amount=0,terms_version=terms_version+1 where id=p_job_id;
 insert into public.audit_events(actor_id,action,resource_id) values(auth.uid(),'job.commission_configured',p_job_id);
end;$$;

create or replace function public.set_job_commission(p_job_id uuid,p_gross_amount numeric,p_gross_total_amount numeric,p_platform_percent numeric default null) returns void language sql security invoker set search_path='' as $$select private.set_job_commission(p_job_id,p_gross_amount,p_gross_total_amount,p_platform_percent);$$;

create or replace function private.publish_client_request(p_request_id uuid,p_platform_percent numeric default null,p_terms text default 'Accepted lecturer assignment terms.',p_requires_contract boolean default true,p_claim_deadline timestamptz default null) returns uuid language plpgsql security definer set search_path='' as $$
declare r private.client_course_requests; j public.jobs; org public.organisations; template uuid; run uuid; job uuid; session_id uuid; s jsonb;
begin
 if not private.has_permission('finance.gross.read') then raise exception 'Gross finance permission and MFA required' using errcode='42501';end if;
 if p_platform_percent is not null then raise exception 'Compensation policy is configured separately' using errcode='22023';end if;
 select * into r from private.client_course_requests where id=p_request_id for update;
 if not found or r.status='cancelled' then raise exception 'Request unavailable' using errcode='22023';end if;
 if p_terms is null or length(trim(p_terms)) not between 1 and 12000 or p_requires_contract is null or (p_claim_deadline is not null and (not isfinite(p_claim_deadline) or p_claim_deadline<=clock_timestamp())) then raise exception 'Valid lecturer terms required' using errcode='22023';end if;
 if r.job_id is not null then
  select * into j from public.jobs where id=r.job_id;
  if j.terms is distinct from p_terms or j.requires_contract is distinct from p_requires_contract or j.claim_deadline is distinct from p_claim_deadline or not exists(select 1 from private.job_commission_offers o where o.job_id=j.id and o.pricing_mode='role_split') then raise exception 'Publication idempotency conflict' using errcode='22023';end if;return r.job_id;
 end if;
 select * into org from public.organisations where id=r.organisation_id and archived_at is null for share;if not found then raise exception 'Organisation unavailable' using errcode='22023';end if;
 if exists(select 1 from jsonb_array_elements(r.payload->'sessions') x where (x->>'starts_at')::timestamptz<=clock_timestamp()) then raise exception 'Future sessions required' using errcode='22023';end if;
 insert into public.course_templates(title,description) values(r.payload->>'title',r.payload->>'description') returning id into template;
 insert into public.course_runs(template_id,organisation_id,time_zone,delivery_type,venue,published) values(template,org.id,r.payload->>'time_zone',r.payload->>'delivery_type',r.payload->>'location',true) returning id into run;
 -- Start at zero net in this transaction. set_job_commission derives the actual net
 -- before publication is visible; no gross amount ever enters a public job column.
 insert into public.jobs(course_run_id,title,description,customer_name,delivery_type,location,time_zone,status,amount,currency,rate_unit,total_amount,terms,requires_contract,claim_deadline,created_by)
 values(run,r.payload->>'title',r.payload->>'description',org.name,r.payload->>'delivery_type',r.payload->>'location',r.payload->>'time_zone','draft',0,r.payload->>'currency',r.payload->>'rate_unit',0,p_terms,p_requires_contract,p_claim_deadline,auth.uid()) returning id into job;
 for s in select value from jsonb_array_elements(r.payload->'sessions') loop
  insert into public.course_sessions(course_run_id,starts_at,ends_at) values(run,(s->>'starts_at')::timestamptz,(s->>'ends_at')::timestamptz) returning id into session_id;
  insert into public.job_sessions(job_id,course_session_id,starts_at,ends_at) values(job,session_id,(s->>'starts_at')::timestamptz,(s->>'ends_at')::timestamptz);
 end loop;
 insert into public.job_requirements(job_id,topic_id) select job,value::uuid from jsonb_array_elements_text(r.payload->'topic_ids');
 insert into public.course_template_topics(template_id,topic_id) select template,value::uuid from jsonb_array_elements_text(r.payload->'topic_ids');
 perform private.set_job_commission(job,(r.payload->>'gross_amount')::numeric,(r.payload->>'gross_total_amount')::numeric,p_platform_percent);
 update public.jobs set status='published' where id=job;update private.client_course_requests set status='published',job_id=job where id=r.id;
 insert into public.audit_events(actor_id,action,resource_id) values(auth.uid(),'client.request_published',r.id);
 return job;
end;$$;

create or replace function public.publish_client_request(p_request_id uuid,p_platform_percent numeric default null,p_terms text default 'Accepted lecturer assignment terms.',p_requires_contract boolean default true,p_claim_deadline timestamptz default null) returns uuid language sql security invoker set search_path='' as $$select private.publish_client_request(p_request_id,p_platform_percent,p_terms,p_requires_contract,p_claim_deadline);$$;

create or replace function private.create_commission_job(p_organisation_id uuid,p_payload jsonb,p_platform_percent numeric default null,p_client_id uuid default null) returns uuid language plpgsql security definer set search_path='' as $$
declare org uuid:=p_organisation_id; request_id uuid; job uuid; previous private.client_course_requests; customer text:=trim(coalesce(p_payload->>'customer_name','')); desired_status text:=coalesce(p_payload->>'status','published'); options jsonb:=jsonb_build_object('organisation_id',p_organisation_id,'payload',p_payload,'platform_percent',p_platform_percent);
begin
 if not private.has_permission('finance.gross.read') then raise exception 'Gross finance permission and MFA required' using errcode='42501';end if;
 if p_platform_percent is not null then raise exception 'Compensation policy is configured separately' using errcode='22023';end if;
 if p_client_id is null or desired_status not in ('draft','published') then raise exception 'Valid request ID and status required' using errcode='22023';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('client-request:'||auth.uid()::text,0));
 select * into previous from private.client_course_requests where requested_by=auth.uid() and client_id=p_client_id;
 if found and previous.creation_options is distinct from options then raise exception 'Request operation idempotency conflict' using errcode='22023';end if;
 if org is null then
  if length(customer) not between 1 and 200 then raise exception 'Customer name required' using errcode='22023';end if;
  if previous.id is not null then org=previous.organisation_id;if not exists(select 1 from public.organisations where id=org and name=customer) then raise exception 'Request idempotency conflict' using errcode='22023';end if;
  else insert into public.organisations(name,time_zone) values(customer,coalesce(p_payload->>'time_zone','Europe/Berlin')) returning id into org;end if;
 end if;
 request_id=private.create_client_request(org,p_payload-array['customer_name','status','terms','requires_contract','claim_deadline'],p_client_id);
 if previous.id is null then update private.client_course_requests set creation_options=options where id=request_id;end if;
 job=private.publish_client_request(request_id,p_platform_percent,coalesce(p_payload->>'terms','Accepted lecturer assignment terms.'),coalesce((p_payload->>'requires_contract')::boolean,true),(p_payload->>'claim_deadline')::timestamptz);
 if previous.job_id is not null and exists(select 1 from public.jobs where id=job and status<>desired_status) then raise exception 'Publication idempotency conflict' using errcode='22023';end if;
 if desired_status='draft' then update public.jobs set status='draft' where id=job;update public.course_runs set published=false where id=(select course_run_id from public.jobs where id=job);end if;
 return job;
end;$$;

create or replace function public.create_commission_job(p_organisation_id uuid,p_payload jsonb,p_platform_percent numeric default null,p_client_id uuid default null) returns uuid language sql security invoker set search_path='' as $$select private.create_commission_job(p_organisation_id,p_payload,p_platform_percent,p_client_id);$$;

create or replace function private.create_capacity_job(p_payload jsonb,p_capacity int,p_request_id uuid,p_organisation_id uuid default null,p_platform_percent numeric default null) returns uuid language plpgsql security definer set search_path='' as $$
declare prior private.job_lifecycle_requests;parameters jsonb;result uuid;
begin
 if not private.has_permission('jobs.manage') then raise exception 'jobs.manage and MFA required' using errcode='42501';end if;
 perform 1 from public.profiles where id=auth.uid() and active for share;
 if not found then raise exception 'Authentication required' using errcode='42501';end if;
 if p_capacity is null or p_capacity not between 1 and 20 or p_request_id is null or jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'One to twenty explicitly priced positions required' using errcode='22023';end if;
 parameters=jsonb_build_object('action','create_capacity_job','payload',p_payload,'capacity',p_capacity,'organisation_id',p_organisation_id,'platform_percent',p_platform_percent);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('job-request:'||auth.uid()::text||p_request_id::text,0));
 select * into prior from private.job_lifecycle_requests where actor_id=auth.uid() and request_id=p_request_id;
 if found then if prior.payload<>parameters then raise exception 'Lifecycle idempotency conflict' using errcode='22023';end if;return prior.result;end if;
 if p_payload?'gross_amount' or p_payload?'gross_total_amount' then
  result=private.create_commission_job(p_organisation_id,p_payload,p_platform_percent,p_request_id);
 else
  if p_organisation_id is not null then raise exception 'Organisation pricing requires the gross workflow' using errcode='22023';end if;
  result=private.create_job(p_payload);
 end if;
 update public.jobs set capacity=p_capacity,capacity_basis='per_position' where id=result;
 insert into private.job_lifecycle_requests(actor_id,request_id,payload,result) values(auth.uid(),p_request_id,parameters,result);
 insert into public.audit_events(actor_id,action,resource_id,details) values(auth.uid(),'job.capacity_created',result,jsonb_build_object('positions',p_capacity,'basis','per_position'));
 return result;
end;$$;

create or replace function public.create_capacity_job(p_payload jsonb,p_capacity int,p_request_id uuid,p_organisation_id uuid default null,p_platform_percent numeric default null) returns uuid language sql security invoker set search_path='' as $$select private.create_capacity_job(p_payload,p_capacity,p_request_id,p_organisation_id,p_platform_percent);$$;

create or replace function private.create_course_run_job(p_course_run_id uuid,p_payload jsonb,p_platform_percent numeric default null,p_client_id uuid default null) returns uuid language plpgsql security definer set search_path='' as $$
declare r public.course_runs;t public.course_templates;o public.organisations; prior private.course_run_job_requests; options jsonb;
 gross boolean:=private.has_permission('finance.gross.read');job uuid:=gen_random_uuid();request_id uuid;amount numeric;total numeric;desired text;deadline timestamptz;sessions jsonb;topics jsonb;
begin
 if not private.has_permission('jobs.manage') or not private.has_permission('courses.manage') then raise exception 'Course/job management and MFA required' using errcode='42501';end if;
 if p_course_run_id is null or p_client_id is null or p_payload is null or jsonb_typeof(p_payload)<>'object'
 or exists(select 1 from jsonb_object_keys(p_payload) k where k not in('amount','total_amount','gross_amount','gross_total_amount','currency','rate_unit','terms','requires_contract','status','claim_deadline','source_revision')) then raise exception 'Invalid course offer' using errcode='22023';end if;
 if jsonb_typeof(p_payload->'source_revision') is distinct from 'string' or p_payload->>'source_revision' !~ '^[a-f0-9]{64}$' then raise exception 'Source revision required' using errcode='22023';end if;
 if p_platform_percent is not null and (p_platform_percent not between 0 and 100 or p_platform_percent<>round(p_platform_percent,2)) then raise exception 'Invalid commission' using errcode='22023';end if;
 if not gross and (p_payload?'gross_amount' or p_payload?'gross_total_amount' or (p_platform_percent is not null and p_platform_percent<>50)) then raise exception 'Gross finance permission required' using errcode='42501';end if;
 if gross and p_platform_percent is not null then raise exception 'Compensation policy is configured separately' using errcode='22023';end if;
 if gross and (p_payload?'amount' or p_payload?'total_amount') then raise exception 'Use full customer fee for commission offers' using errcode='22023';end if;
 if jsonb_typeof(p_payload->case when gross then 'gross_amount' else 'amount' end) is distinct from 'number' or jsonb_typeof(p_payload->case when gross then 'gross_total_amount' else 'total_amount' end) is distinct from 'number' then raise exception 'Numeric fee required' using errcode='22023';end if;
 amount=(p_payload->>case when gross then 'gross_amount' else 'amount' end)::numeric;total=(p_payload->>case when gross then 'gross_total_amount' else 'total_amount' end)::numeric;
 desired=coalesce(p_payload->>'status','draft');
 if amount not between 0.01 and 9999999999.99 or total not between 0.01 and 9999999999.99 or amount<>round(amount,2) or total<>round(total,2)
 or p_payload->>'currency' is null or p_payload->>'currency' not in('EUR','AUD') or p_payload->>'rate_unit' is null or p_payload->>'rate_unit' not in('per_day','per_hour','per_teaching_unit','fixed_total') or (p_payload->>'rate_unit'='fixed_total' and amount<>total)
 or jsonb_typeof(p_payload->'terms') is distinct from 'string' or length(trim(p_payload->>'terms')) not between 1 and 10000 or desired not in('draft','published')
 or (p_payload?'requires_contract' and jsonb_typeof(p_payload->'requires_contract')<>'boolean')
 or (p_payload?'claim_deadline' and jsonb_typeof(p_payload->'claim_deadline') not in('string','null')) then raise exception 'Invalid financial terms' using errcode='22023';end if;
 if p_payload->>'claim_deadline' is not null then
  if p_payload->>'claim_deadline' !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' then raise exception 'Explicit deadline instant required' using errcode='22023';end if;
  deadline=(p_payload->>'claim_deadline')::timestamptz;
  if not isfinite(deadline) or deadline<=clock_timestamp() then raise exception 'Future deadline required' using errcode='22023';end if;
 end if;
 options=jsonb_build_object('course_run_id',p_course_run_id,'payload',p_payload,'platform_percent',p_platform_percent,'pricing_model',case when gross then 'commission' else 'legacy_net' end);
 -- Keep actor-before-run ordering shared with the existing client request API.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('client-request:'||auth.uid()::text,0));
 select * into prior from private.course_run_job_requests where actor_id=auth.uid() and client_id=p_client_id;
 if found then if prior.parameters is distinct from options then raise exception 'Request idempotency conflict' using errcode='22023';end if;return prior.job_id;end if;
 if exists(select 1 from private.client_course_requests where requested_by=auth.uid() and client_id=p_client_id) then raise exception 'Request idempotency conflict' using errcode='22023';end if;
 select * into r from public.course_runs where id=p_course_run_id and archived_at is null for update;
 if not found then raise exception 'Course run unavailable' using errcode='22023';end if;
 select * into t from public.course_templates where id=r.template_id and archived_at is null for share;
 if not found then raise exception 'Course template unavailable' using errcode='22023';end if;
 select * into o from public.organisations where id=r.organisation_id and archived_at is null for share;
 if not found then raise exception 'course_run_customer_required' using errcode='22023';end if;
 if (private.course_run_job_defaults(r.id)->>'source_revision') is distinct from p_payload->>'source_revision' then raise exception 'course_run_source_changed' using errcode='22023';end if;
 if exists(select 1 from public.jobs where course_run_id=r.id and status in('draft','published','filled')) then raise exception 'course_run_offer_exists' using errcode='22023';end if;
 if not exists(select 1 from public.course_sessions where course_run_id=r.id) or (select count(*) from public.course_sessions where course_run_id=r.id)>60
 or exists(select 1 from public.course_sessions where course_run_id=r.id and (starts_at<=clock_timestamp() or not isfinite(starts_at) or not isfinite(ends_at) or ends_at<=starts_at))
 or exists(select 1 from public.course_sessions a join public.course_sessions b on b.course_run_id=a.course_run_id and b.id>a.id and tstzrange(a.starts_at,a.ends_at,'[)')&&tstzrange(b.starts_at,b.ends_at,'[)') where a.course_run_id=r.id)
 or (deadline is not null and deadline>(select min(starts_at) from public.course_sessions where course_run_id=r.id)) then raise exception 'Future non-overlapping course sessions required' using errcode='22023';end if;
 select jsonb_agg(jsonb_build_object('starts_at',starts_at,'ends_at',ends_at) order by starts_at,id) into sessions from public.course_sessions where course_run_id=r.id;
 select coalesce(jsonb_agg(topic_id order by topic_id),'[]'::jsonb) into topics from public.course_template_topics where template_id=t.id;
 if gross then
  request_id=private.create_client_request(o.id,jsonb_build_object('title',t.title,'description',t.description,'delivery_type',r.delivery_type,'location',r.venue,'time_zone',r.time_zone,'sessions',sessions,'topic_ids',topics,'gross_amount',amount,'gross_total_amount',total,'currency',p_payload->>'currency','rate_unit',p_payload->>'rate_unit'),p_client_id);
 end if;
 insert into public.jobs(id,course_run_id,title,description,customer_name,delivery_type,location,time_zone,status,amount,currency,rate_unit,total_amount,terms,requires_contract,claim_deadline,created_by)
 values(job,r.id,t.title,t.description,o.name,r.delivery_type,r.venue,r.time_zone,'draft',case when gross then 0 else amount end,p_payload->>'currency',p_payload->>'rate_unit',case when gross then 0 else total end,p_payload->>'terms',coalesce((p_payload->>'requires_contract')::boolean,true),deadline,auth.uid());
 insert into public.job_sessions(job_id,course_session_id,starts_at,ends_at) select job,id,starts_at,ends_at from public.course_sessions where course_run_id=r.id;
 insert into public.job_requirements(job_id,topic_id) select job,topic_id from public.course_template_topics where template_id=t.id;
 if gross then
  perform private.set_job_commission(job,amount,total,p_platform_percent);
  update private.client_course_requests set job_id=job,status='published',creation_options=jsonb_build_object('kind','course_run_job','course_run_id',r.id) where id=request_id;
 end if;
 update public.jobs set status=desired where id=job;
 insert into private.course_run_job_requests(actor_id,client_id,course_run_id,parameters,job_id) values(auth.uid(),p_client_id,r.id,options,job);
 insert into public.audit_events(actor_id,action,resource_id,details) values(auth.uid(),'course.run_offer_created',job,jsonb_build_object('course_run_id',r.id,'template_id',t.id,'building_block_id',t.building_block_id,'source_id',t.building_block_source_id));
 return job;
end;$$;

create or replace function public.create_course_run_job(p_course_run_id uuid,p_payload jsonb,p_platform_percent numeric default null,p_client_id uuid default null) returns uuid language sql security invoker set search_path='' as $$select private.create_course_run_job(p_course_run_id,p_payload,p_platform_percent,p_client_id);$$;

create or replace function private.claim_job_base(p_job_id uuid,p_idempotency_key uuid,p_terms_version integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 actor uuid:=auth.uid(); j public.jobs; c public.job_claims; v_contract uuid; v_claim uuid; v_room uuid;
begin
 if not private.actor_active() then raise exception 'Authentication required' using errcode='42501'; end if;
 perform 1 from public.profiles where id=actor and active for share;
 if not found then raise exception 'Authentication required' using errcode='42501';end if;
 if p_idempotency_key is null or p_terms_version is null then raise exception 'Missing claim data' using errcode='22023'; end if;
 if not private.lecturer_actor() then return jsonb_build_object('status','not_eligible'); end if;
 -- Serialize requests per actor BEFORE per-job locking, protecting across distinct jobs and
 -- idempotency keys. Exclusion constraints provide a second independent conflict guard.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text,0));
 select * into c from public.job_claims where lecturer_id=actor and idempotency_key=p_idempotency_key;
 if found then
  if c.job_id<>p_job_id then return jsonb_build_object('status','idempotency_conflict'); end if;
  return jsonb_build_object('status',c.status,'claim_id',c.id);
 end if;
 select * into j from public.jobs where id=p_job_id for update;
 if not found then return jsonb_build_object('status','unavailable'); end if;
 if j.status='filled' or (select count(*) from public.job_claims where job_id=j.id and status='confirmed')>=j.capacity then return jsonb_build_object('status','filled'); end if;
 if exists(select 1 from public.job_claims where job_id=j.id and lecturer_id=actor and status='confirmed') then return jsonb_build_object('status','already_assigned');end if;
 if j.status<>'published' or (j.claim_deadline is not null and j.claim_deadline<=now()) then return jsonb_build_object('status','unavailable'); end if;
 if j.terms_version<>p_terms_version then return jsonb_build_object('status','terms_changed'); end if;
 if not exists(select 1 from public.job_sessions where job_id=j.id) or exists(select 1 from public.job_sessions where job_id=j.id and starts_at<=now()) then return jsonb_build_object('status','unavailable'); end if;
 if exists(select 1 from public.job_requirements r where r.job_id=j.id and not exists(select 1 from public.lecturer_topics lt where lt.user_id=actor and lt.topic_id=r.topic_id and lt.verified and (lt.valid_until is null or lt.valid_until>=(select max(ends_at) from public.job_sessions where job_id=j.id)))) then return jsonb_build_object('status','not_eligible'); end if;
 if j.requires_contract then
  v_contract=private.current_contract_for_interval(actor,(select min(starts_at) from public.job_sessions where job_id=j.id),(select max(ends_at) from public.job_sessions where job_id=j.id));
  if v_contract is null then return jsonb_build_object('status','prerequisite_missing'); end if;
 end if;
 if exists(select 1 from public.job_sessions js join public.assignment_sessions a on a.lecturer_id=actor and a.released_at is null and tstzrange(a.starts_at,a.ends_at,'[)') && tstzrange(js.starts_at,js.ends_at,'[)') where js.job_id=j.id)
 or exists(select 1 from public.job_sessions js join public.personal_events e on e.user_id=actor and tstzrange(e.starts_at,e.ends_at,'[)') && tstzrange(js.starts_at,js.ends_at,'[)') where js.job_id=j.id)
 then return jsonb_build_object('status','conflict'); end if;
 insert into public.job_claims(job_id,lecturer_id,idempotency_key,amount,currency,rate_unit,total_amount,terms,terms_version,contract_id)
 values(j.id,actor,p_idempotency_key,j.amount,j.currency,j.rate_unit,j.total_amount,j.terms,j.terms_version,v_contract) returning id into v_claim;
 insert into public.assignment_sessions(claim_id,lecturer_id,starts_at,ends_at) select v_claim,actor,starts_at,ends_at from public.job_sessions where job_id=j.id;
 update public.jobs set status=case when (select count(*) from public.job_claims where job_id=j.id and status='confirmed')>=j.capacity then 'filled' else 'published' end where id=j.id;
 insert into public.claim_events(claim_id,actor_id,event_type) values(v_claim,actor,'confirmed');
 insert into public.notifications(user_id,kind,resource_id) values(actor,'claim_confirmed',v_claim);
 insert into public.chat_rooms(job_id) values(j.id) on conflict(job_id) do update set job_id=excluded.job_id returning id into v_room;
 insert into public.chat_members(room_id,user_id) values(v_room,actor) on conflict(room_id,user_id) do update set removed_at=null,joined_at=clock_timestamp();
 update public.chat_rooms set owner_id=actor where id=v_room and owner_id is null;
 return jsonb_build_object('status','confirmed','claim_id',v_claim);
exception when exclusion_violation then
 -- PL/pgSQL exception subtransaction rolls back EVERY preceding write.
 return jsonb_build_object('status','conflict');
end;$$;

revoke execute on function private.claim_job_base(uuid,uuid,integer) from public,anon,authenticated;
create or replace function private.claim_job(p_job_id uuid,p_idempotency_key uuid,p_terms_version integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.jobs;expected integer;
begin
 if not private.actor_active() then raise exception 'Authentication required' using errcode='42501';end if;
 -- Same profile lock as account-role editing: a tier cannot change mid-claim.
 perform 1 from public.profiles where id=auth.uid() and active for share;
 if p_idempotency_key is null or p_terms_version is null or not private.lecturer_actor() then return private.claim_job_base(p_job_id,p_idempotency_key,p_terms_version);end if;
 if exists(select 1 from public.job_claims where lecturer_id=auth.uid() and idempotency_key=p_idempotency_key) then return private.claim_job_base(p_job_id,p_idempotency_key,p_terms_version);end if;
 select * into j from public.jobs where id=p_job_id;
 if exists(select 1 from private.job_commission_offers where job_id=p_job_id and pricing_mode='role_split') then
  expected=private.role_quote_version(j.terms_version,auth.uid());
  if p_terms_version is distinct from expected then return jsonb_build_object('status','terms_changed');end if;
  return private.claim_job_base(p_job_id,p_idempotency_key,j.terms_version);
 end if;
 return private.claim_job_base(p_job_id,p_idempotency_key,p_terms_version);
end;$$;
create function private.apply_role_claim_rate() returns trigger language plpgsql security definer set search_path='' as $$
declare o private.job_commission_offers;
begin
 select * into o from private.job_commission_offers where job_id=new.job_id;
 if o.pricing_mode='role_split' then if o.policy_version is null then raise exception 'Compensation policy has not been configured' using errcode='22023';end if;new.amount=private.role_net(o.gross_amount,new.lecturer_id,new.job_id);new.total_amount=private.role_net(o.gross_total_amount,new.lecturer_id,new.job_id);end if;
 return new;
end;$$;
create function private.lock_compensation_role() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.profiles where id=case when TG_OP='DELETE' then old.user_id else new.user_id end for update;
 if (TG_OP='DELETE' and old.role='client') or (TG_OP='UPDATE' and old.role='client' and (new.role<>'client' or new.user_id<>old.user_id)) then update public.client_organisation_memberships set removed_at=clock_timestamp() where user_id=old.user_id and removed_at is null;end if;
 return case when TG_OP='DELETE' then old else new end;
end;$$;
create trigger lock_compensation_role before insert or delete or update on public.user_roles for each row execute function private.lock_compensation_role();
revoke execute on function private.lock_compensation_role() from public,anon,authenticated;
create trigger apply_role_claim_rate before insert on public.job_claims for each row execute function private.apply_role_claim_rate();
revoke execute on function private.apply_role_claim_rate() from public,anon,authenticated;
create or replace function private.capture_claim_revenue() returns trigger language plpgsql security definer set search_path='' as $$
declare o private.job_commission_offers;net numeric;net_total numeric;platform numeric;
begin
 select * into o from private.job_commission_offers where job_id=new.job_id;
 if found then
  net=case when o.pricing_mode='role_split' then private.role_net(o.gross_amount,new.lecturer_id,new.job_id) else o.lecturer_net_amount end;
  net_total=case when o.pricing_mode='role_split' then private.role_net(o.gross_total_amount,new.lecturer_id,new.job_id) else o.lecturer_net_total_amount end;
  platform=case when o.pricing_mode='role_split' then case when exists(select 1 from public.user_roles where user_id=new.lecturer_id and role='senior_lecturer') then 100-o.senior_percent else 100-o.regular_percent end else o.platform_percent end;
  if new.amount<>net or new.total_amount<>net_total or new.currency<>o.currency then raise exception 'Offer changed; refresh before claiming' using errcode='23514';end if;
  insert into private.claim_revenue_ledger(claim_id,job_id,organisation_id,lecturer_id,gross_amount,gross_total_amount,platform_percent,platform_total_amount,lecturer_net_amount,lecturer_net_total_amount,currency)
  values(new.id,new.job_id,o.organisation_id,new.lecturer_id,o.gross_amount,o.gross_total_amount,platform,o.gross_total_amount-net_total,net,net_total,o.currency);
 end if;return new;
end;$$;
create function private.configure_compensation_policy(p_regular_percent numeric,p_senior_percent numeric,p_expected_version integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare current_version integer;next_version integer;
begin
 perform 1 from public.profiles where id=auth.uid() and active for share;
 if not private.has_permission('finance.gross.read') then raise exception 'Gross finance permission and MFA required' using errcode='42501';end if;
 if p_regular_percent is null or p_senior_percent is null or p_expected_version is null or p_regular_percent not between 0 and 100 or p_senior_percent not between 0 and 100 or p_senior_percent<=p_regular_percent or p_regular_percent<>round(p_regular_percent,2) or p_senior_percent<>round(p_senior_percent,2) then raise exception 'Invalid compensation policy' using errcode='22023';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('portal-compensation-policy',0));
 select coalesce((select version from private.compensation_policy where singleton),0) into current_version;
 if current_version<>p_expected_version then raise exception 'Compensation policy changed; refresh before saving' using errcode='40001';end if;
 next_version=current_version+1;
 insert into private.compensation_policy(singleton,version,regular_percent,senior_percent,updated_by) values(true,next_version,p_regular_percent,p_senior_percent,auth.uid())
 on conflict(singleton) do update set version=excluded.version,regular_percent=excluded.regular_percent,senior_percent=excluded.senior_percent,updated_by=excluded.updated_by,updated_at=clock_timestamp();
 -- First setup enables migrated offers which have never had accepted history.
 -- Later policy changes affect future offers; existing quotes/snapshots stay intact.
 with initialized as (
  update private.job_commission_offers o set regular_percent=p_regular_percent,senior_percent=p_senior_percent,policy_version=next_version
  where o.pricing_mode='role_split' and o.policy_version is null and not exists(select 1 from public.job_claims c where c.job_id=o.job_id) returning job_id
 ) update public.jobs j set terms_version=terms_version+1 where j.id in(select job_id from initialized);
 insert into public.audit_events(actor_id,action,details) values(auth.uid(),'compensation.policy_changed',jsonb_build_object('version',next_version));
 return private.commission_access();
end;$$;
create function public.configure_compensation_policy(p_regular_percent numeric,p_senior_percent numeric,p_expected_version integer) returns jsonb language sql security invoker set search_path='' as $$select private.configure_compensation_policy(p_regular_percent,p_senior_percent,p_expected_version);$$;
revoke execute on function private.configure_compensation_policy(numeric,numeric,integer),public.configure_compensation_policy(numeric,numeric,integer) from public,anon;
grant execute on function private.configure_compensation_policy(numeric,numeric,integer),public.configure_compensation_policy(numeric,numeric,integer) to authenticated;

create function private.commission_offer_policy(p_job_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not private.has_permission('finance.gross.read') then raise exception 'Gross finance permission and MFA required' using errcode='42501';end if;
 select jsonb_build_object('regular_lecturer_percent',regular_percent,'senior_lecturer_percent',senior_percent,'policy_version',policy_version) into result from private.job_commission_offers where job_id=p_job_id and pricing_mode='role_split' and policy_version is not null;
 return result;
end;$$;
create function public.commission_offer_policy(p_job_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$select private.commission_offer_policy(p_job_id);$$;
revoke execute on function private.commission_offer_policy(uuid),public.commission_offer_policy(uuid) from public,anon;
grant execute on function private.commission_offer_policy(uuid),public.commission_offer_policy(uuid) to authenticated;
commit;
