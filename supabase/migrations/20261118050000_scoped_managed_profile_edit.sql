begin;

-- Basic account editing follows the same current subordinate-role boundary and
-- lifecycle lock as activation changes. Private contact fields are not exposed.
create function private.managed_profile(p_user_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not private.has_permission('users.manage') or not private.account_target_manageable(p_user_id) then
  raise exception 'Only subordinate profiles may be managed' using errcode='42501';
 end if;
 return (select jsonb_build_object('display_name',p.display_name,'locale',p.locale,'time_zone',p.time_zone) from public.profiles p where p.id=p_user_id);
end;$$;
create function public.managed_profile(p_user_id uuid) returns jsonb language sql security invoker set search_path='' as $$select private.managed_profile(p_user_id);$$;

create function private.save_managed_profile(p_user_id uuid,p_payload jsonb,p_expected jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare previous jsonb;
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('portal-user-activation',0));
 if not private.has_permission('users.manage') or not private.account_target_manageable(p_user_id) then
  raise exception 'Only subordinate profiles may be managed' using errcode='42501';
 end if;
 perform 1 from public.profiles where id=p_user_id for update;
 if not found then raise exception 'Profile not found' using errcode='22023';end if;
 previous=private.managed_profile(p_user_id);
 if previous is distinct from p_expected then raise exception 'Profile changed; reload before saving' using errcode='40001';end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or not (p_payload ?& array['display_name','locale','time_zone']) or exists(select 1 from jsonb_each(p_payload) e where e.key not in ('display_name','locale','time_zone') or jsonb_typeof(e.value)<>'string') or length(trim(p_payload->>'display_name')) not between 1 and 120 or p_payload->>'locale' not in ('de','en') or not exists(select 1 from pg_catalog.pg_timezone_names where name=p_payload->>'time_zone') then
  raise exception 'Invalid managed profile' using errcode='22023';
 end if;
 update public.profiles set display_name=trim(p_payload->>'display_name'),locale=p_payload->>'locale',time_zone=p_payload->>'time_zone' where id=p_user_id;
 insert into public.audit_events(actor_id,action,resource_id,details) values(auth.uid(),'account.profile_updated',p_user_id,jsonb_build_object('fields',jsonb_build_array('display_name','locale','time_zone')));
 return private.managed_profile(p_user_id);
end;$$;
create function public.save_managed_profile(p_user_id uuid,p_payload jsonb,p_expected jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.save_managed_profile(p_user_id,p_payload,p_expected);$$;
revoke all on function private.managed_profile(uuid),public.managed_profile(uuid),private.save_managed_profile(uuid,jsonb,jsonb),public.save_managed_profile(uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function private.managed_profile(uuid),public.managed_profile(uuid),private.save_managed_profile(uuid,jsonb,jsonb),public.save_managed_profile(uuid,jsonb,jsonb) to authenticated;

commit;
