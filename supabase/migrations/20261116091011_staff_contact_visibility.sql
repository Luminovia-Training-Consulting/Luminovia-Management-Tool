begin;

-- An explicit staff-directory opt-in. Existing minimal profile projections and
-- separately authorised account-administration APIs remain unchanged.
create table private.staff_contact_visibility (
 user_id uuid primary key references public.profiles(id) on delete cascade,
 email_visible boolean not null default false,
 phone_visible boolean not null default false,
 version integer not null default 0 check(version>=0),
 updated_at timestamptz not null default now()
);
alter table private.staff_contact_visibility enable row level security;
revoke all on private.staff_contact_visibility from public,anon,authenticated;

create function private.contact_visibility_preferences() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not private.actor_active() then raise exception 'Active account required' using errcode='42501';end if;
 select jsonb_build_object('email_visible',coalesce(v.email_visible,false),'phone_visible',coalesce(v.phone_visible,false),
 'version',coalesce(v.version,0),'can_share',private.profile_staff(auth.uid()),'email_address',nullif(u.email,''),'phone_number',nullif(p.phone,''))
 into result from public.profiles p join auth.users u on u.id=p.id left join private.staff_contact_visibility v on v.user_id=p.id where p.id=auth.uid();
 return result;
end;$$;
create function public.contact_visibility_preferences() returns jsonb language sql stable security invoker set search_path='' as $$select private.contact_visibility_preferences();$$;

create function private.save_contact_visibility_preferences(p_payload jsonb,p_expected_version integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v private.staff_contact_visibility;
begin
 if not private.actor_active() then raise exception 'Active account required' using errcode='42501';end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or (select count(*) from jsonb_object_keys(p_payload))<>2
 or exists(select 1 from jsonb_each(p_payload) item where item.key not in('email_visible','phone_visible') or jsonb_typeof(item.value)<>'boolean') then
  raise exception 'Invalid contact visibility' using errcode='22023';end if;
 if not private.profile_staff(auth.uid()) and ((p_payload->>'email_visible')::boolean or (p_payload->>'phone_visible')::boolean) then
  raise exception 'Active staff role required to share contacts' using errcode='42501';end if;
 insert into private.staff_contact_visibility(user_id) values(auth.uid()) on conflict do nothing;
 select * into v from private.staff_contact_visibility where user_id=auth.uid() for update;
 if p_expected_version is distinct from v.version then raise exception 'Contact visibility changed; reload' using errcode='40001';end if;
 update private.staff_contact_visibility set email_visible=(p_payload->>'email_visible')::boolean,phone_visible=(p_payload->>'phone_visible')::boolean,
  version=version+1,updated_at=now() where user_id=auth.uid();
 return private.contact_visibility_preferences();
end;$$;
create function public.save_contact_visibility_preferences(p_payload jsonb,p_expected_version integer) returns jsonb language sql security invoker set search_path='' as $$select private.save_contact_visibility_preferences(p_payload,p_expected_version);$$;

create function private.person_contact(p_user_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not private.actor_active() then raise exception 'Active account required' using errcode='42501';end if;
 -- Even an administrator receives no private-by-default directory contact.
 -- Linked clients/learners may read a safe course profile, never this sharing.
 if not private.profile_staff(auth.uid()) or not private.profile_staff(p_user_id) or not private.can_read_person(p_user_id) then
  return jsonb_build_object('email',null,'phone',null);end if;
 select jsonb_build_object('email',case when v.email_visible then nullif(u.email,'') end,
  'phone',case when v.phone_visible then nullif(p.phone,'') end) into result
 from public.profiles p join auth.users u on u.id=p.id left join private.staff_contact_visibility v on v.user_id=p.id where p.id=p_user_id;
 return coalesce(result,jsonb_build_object('email',null,'phone',null));
end;$$;
create function public.person_contact(p_user_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$select private.person_contact(p_user_id);$$;

revoke execute on function private.contact_visibility_preferences(),public.contact_visibility_preferences(),private.save_contact_visibility_preferences(jsonb,integer),public.save_contact_visibility_preferences(jsonb,integer),private.person_contact(uuid),public.person_contact(uuid) from public,anon,authenticated;
grant execute on function private.contact_visibility_preferences(),public.contact_visibility_preferences(),private.save_contact_visibility_preferences(jsonb,integer),public.save_contact_visibility_preferences(jsonb,integer),private.person_contact(uuid),public.person_contact(uuid) to authenticated;
commit;
