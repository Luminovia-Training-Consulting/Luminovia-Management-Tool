begin;
alter table public.audit_events add column details jsonb not null default '{}'::jsonb;

-- This is a management attestation of an existing self-declared skill. Evidence-file
-- upload, content scanning and certificate review remain a separate product workflow.
create function private.verify_lecturer_topic(p_user_id uuid,p_topic_id uuid,p_verified boolean,p_valid_until timestamptz default null)
returns void language plpgsql security definer set search_path='' as $$
declare previous public.lecturer_topics; expiry timestamptz;
begin
 if not private.has_permission('qualifications.verify') then raise exception 'qualifications.verify and MFA required' using errcode='42501'; end if;
 if p_verified is null then raise exception 'Verification decision required' using errcode='22023'; end if;
 if p_verified and p_valid_until is not null and p_valid_until<=now() then raise exception 'Verification expiry must be in the future' using errcode='22023'; end if;
 -- Do not attest an inactive or non-lecturer account. Locking the target profile also
 -- serializes this decision against suspension without widening profile visibility.
 perform 1 from public.profiles p where p.id=p_user_id and p.active for share;
 if not found or not exists(select 1 from public.user_roles where user_id=p_user_id and role in ('lecturer','senior_lecturer')) then raise exception 'An active lecturer is required' using errcode='22023'; end if;
 select * into previous from public.lecturer_topics where user_id=p_user_id and topic_id=p_topic_id for update;
 if not found then raise exception 'The lecturer must select this expertise first' using errcode='22023'; end if;
 expiry=case when p_verified then p_valid_until else null end;
 update public.lecturer_topics set verified=p_verified,valid_until=expiry where user_id=p_user_id and topic_id=p_topic_id;
 insert into public.audit_events(actor_id,action,resource_id,details)
 values(auth.uid(),'qualification.attested',p_user_id,jsonb_build_object('topic_id',p_topic_id,'previous_verified',previous.verified,'previous_valid_until',previous.valid_until,'verified',p_verified,'valid_until',expiry,'basis','management_attestation'));
end;$$;
create function public.verify_lecturer_topic(p_user_id uuid,p_topic_id uuid,p_verified boolean,p_valid_until timestamptz default null)
returns void language sql security invoker set search_path='' as $$ select private.verify_lecturer_topic(p_user_id,p_topic_id,p_verified,p_valid_until); $$;

create function private.set_user_active(p_user_id uuid,p_active boolean)
returns void language plpgsql security definer set search_path='' as $$
declare previous boolean;
begin
 -- All activation changes use the same transaction lock. Two admins cannot each
 -- deactivate the other and both conclude that an active administrator remains.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('portal-user-activation',0));
 if not private.has_permission('users.manage') then raise exception 'users.manage and MFA required' using errcode='42501'; end if;
 if p_active is null then raise exception 'Activation decision required' using errcode='22023'; end if;
 if p_user_id=auth.uid() and not p_active then raise exception 'Self-deactivation is not permitted' using errcode='22023'; end if;
 select active into previous from public.profiles where id=p_user_id for update;
 if not found then raise exception 'Profile not found' using errcode='22023'; end if;
 if previous and not p_active
 and exists(select 1 from public.user_roles where user_id=p_user_id and role='admin')
 and not exists(select 1 from public.user_roles ur join public.profiles p on p.id=ur.user_id where ur.role='admin' and p.active and p.id<>p_user_id)
 then raise exception 'The last active administrator must remain active' using errcode='22023'; end if;
 if previous is distinct from p_active then
  update public.profiles set active=p_active where id=p_user_id;
  insert into public.audit_events(actor_id,action,resource_id,details)
  values(auth.uid(),case when p_active then 'user.activated' else 'user.deactivated' end,p_user_id,jsonb_build_object('previous_active',previous,'active',p_active));
 end if;
end;$$;
create function public.set_user_active(p_user_id uuid,p_active boolean)
returns void language sql security invoker set search_path='' as $$ select private.set_user_active(p_user_id,p_active); $$;

revoke execute on function private.verify_lecturer_topic(uuid,uuid,boolean,timestamptz),public.verify_lecturer_topic(uuid,uuid,boolean,timestamptz),private.set_user_active(uuid,boolean),public.set_user_active(uuid,boolean) from public,anon,authenticated;
grant execute on function private.verify_lecturer_topic(uuid,uuid,boolean,timestamptz),public.verify_lecturer_topic(uuid,uuid,boolean,timestamptz),private.set_user_active(uuid,boolean),public.set_user_active(uuid,boolean) to authenticated;
commit;
