begin;
create table public.invitation_requests (
 id uuid primary key default gen_random_uuid(),
 actor_id uuid not null references public.profiles(id),
 idempotency_key uuid not null,
 email text not null unique check(email=lower(trim(email)) and length(email) between 3 and 254),
 status text not null default 'reserved' check(status in ('reserved','sent','failed')),
 auth_user_id uuid references public.profiles(id),
 created_at timestamptz not null default now(),
 completed_at timestamptz,
 unique(actor_id,idempotency_key)
);
create index invitation_requests_actor_created on public.invitation_requests(actor_id,created_at);
alter table public.invitation_requests enable row level security;
revoke all on public.invitation_requests from public,anon,authenticated;
grant select on public.invitation_requests to authenticated;
grant all on public.invitation_requests to service_role;
create policy invitation_admin_read on public.invitation_requests for select to authenticated using((select private.has_permission('users.manage')));
create function private.reserve_invitation(p_email text,p_idempotency_key uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.invitation_requests; actor uuid:=auth.uid(); normalized text:=lower(trim(p_email));
begin
 if not private.has_permission('users.manage') then raise exception 'users.manage and MFA required' using errcode='42501'; end if;
 if p_idempotency_key is null or normalized is null or length(normalized)>254 or normalized!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Valid email and idempotency key required' using errcode='22023'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('invite:'||actor::text,0));
 select * into r from public.invitation_requests where actor_id=actor and idempotency_key=p_idempotency_key;
 if found then
  if r.email<>normalized then return jsonb_build_object('status','idempotency_conflict'); end if;
  return jsonb_build_object('status',case r.status when 'sent' then 'already_sent' when 'reserved' then 'in_progress' else 'failed' end,'invitation_id',r.id);
 end if;
 -- Email is reserved once across all admins, including uncertain failures. A timeout after
 -- sending must be investigated, not blindly retried as an invitation spam loop.
 select * into r from public.invitation_requests where email=normalized;
 if found then return jsonb_build_object('status',case r.status when 'sent' then 'already_sent' when 'reserved' then 'in_progress' else 'failed' end,'invitation_id',r.id); end if;
 if (select count(*) from public.invitation_requests where actor_id=actor and created_at>now()-interval '15 minutes')>=5 then return jsonb_build_object('status','throttled'); end if;
 insert into public.invitation_requests(actor_id,idempotency_key,email) values(actor,p_idempotency_key,normalized) returning * into r;
 insert into public.audit_events(actor_id,action,resource_id) values(actor,'invitation.reserved',r.id);
 return jsonb_build_object('status','reserved','invitation_id',r.id);
exception when unique_violation then
 -- Concurrent distinct administrators cannot send two invites to one address.
 return jsonb_build_object('status','in_progress');
end;$$;
create function public.reserve_invitation(p_email text,p_idempotency_key uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.reserve_invitation(p_email,p_idempotency_key); $$;
create function private.complete_invitation(p_invitation_id uuid,p_user_id uuid,p_display_name text,p_success boolean) returns void language plpgsql security invoker set search_path='' as $$
declare r public.invitation_requests;
begin
 select * into r from public.invitation_requests where id=p_invitation_id for update;
 if not found or r.status<>'reserved' then raise exception 'Invitation reservation missing' using errcode='22023'; end if;
 if p_success then
  if p_user_id is null then raise exception 'Invited user required' using errcode='22023'; end if;
  update public.profiles set display_name=left(coalesce(p_display_name,''),120) where id=p_user_id;
  insert into public.user_roles(user_id,role) values(p_user_id,'lecturer') on conflict do nothing;
 end if;
 update public.invitation_requests set status=case when p_success then 'sent' else 'failed' end,auth_user_id=p_user_id,completed_at=now() where id=r.id;
 insert into public.audit_events(actor_id,action,resource_id) values(r.actor_id,case when p_success then 'invitation.sent' else 'invitation.failed' end,r.id);
end;$$;
create function public.complete_invitation(p_invitation_id uuid,p_user_id uuid,p_display_name text,p_success boolean) returns void language sql security invoker set search_path='' as $$ select private.complete_invitation(p_invitation_id,p_user_id,p_display_name,p_success); $$;
revoke execute on function private.reserve_invitation(text,uuid),private.complete_invitation(uuid,uuid,text,boolean),public.reserve_invitation(text,uuid),public.complete_invitation(uuid,uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.reserve_invitation(text,uuid),private.reserve_invitation(text,uuid) to authenticated;
grant execute on function public.complete_invitation(uuid,uuid,text,boolean),private.complete_invitation(uuid,uuid,text,boolean) to service_role;
commit;
