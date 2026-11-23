begin;

-- Shared account fields are deliberately distinct from credentials and private preferences.
create function private.basic_account_profile(p_user_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('display_name', display_name, 'locale', locale, 'time_zone', time_zone)
  from public.profiles where id = p_user_id;
$$;

create function private.write_basic_account_profile(
  p_user_id uuid, p_payload jsonb, p_expected jsonb, p_organisation_id uuid
) returns jsonb language plpgsql security invoker set search_path = '' as $$
begin
  if private.basic_account_profile(p_user_id) is distinct from p_expected then
    raise exception 'Profile changed; reload before saving' using errcode = '40001';
  end if;
  if jsonb_typeof(p_payload) is distinct from 'object'
    or not (p_payload ?& array['display_name','locale','time_zone'])
    or exists (
      select 1 from jsonb_each(p_payload) e
      where e.key not in ('display_name','locale','time_zone') or jsonb_typeof(e.value) <> 'string'
    )
    or length(trim(p_payload->>'display_name')) not between 1 and 120
    or p_payload->>'locale' not in ('de','en')
    or not exists (select 1 from pg_catalog.pg_timezone_names where name = p_payload->>'time_zone')
  then
    raise exception 'Invalid managed profile' using errcode = '22023';
  end if;
  update public.profiles
  set display_name = trim(p_payload->>'display_name'), locale = p_payload->>'locale', time_zone = p_payload->>'time_zone'
  where id = p_user_id;
  insert into public.audit_events(actor_id,action,resource_id,details)
  values (auth.uid(), 'account.profile_updated', p_user_id, jsonb_strip_nulls(jsonb_build_object(
    'fields', jsonb_build_array('display_name','locale','time_zone'), 'organisation_id', p_organisation_id
  )));
  return private.basic_account_profile(p_user_id);
end;
$$;

create or replace function private.managed_profile(p_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.has_permission('users.manage') or not private.account_target_manageable(p_user_id) then
    raise exception 'Only subordinate profiles may be managed' using errcode = '42501';
  end if;
  return private.basic_account_profile(p_user_id);
end;
$$;

create or replace function private.save_managed_profile(p_user_id uuid,p_payload jsonb,p_expected jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('portal-user-activation', 0));
  if not private.has_permission('users.manage') or not private.account_target_manageable(p_user_id) then
    raise exception 'Only subordinate profiles may be managed' using errcode = '42501';
  end if;
  perform 1 from public.profiles where id = p_user_id for update;
  if not found then raise exception 'Profile not found' using errcode = '22023'; end if;
  return private.write_basic_account_profile(p_user_id, p_payload, p_expected, null);
end;
$$;

create function private.company_participant_profile(p_user_id uuid, p_organisation_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_internal_company_participant_manager(p_organisation_id);
  if not private.company_premium_enabled(p_organisation_id)
    or not private.active_company_participant(p_user_id, p_organisation_id) then
    raise exception 'Participant membership unavailable' using errcode = '42501';
  end if;
  if private.has_permission('users.manage') and private.account_target_manageable(p_user_id) then
    return private.basic_account_profile(p_user_id);
  end if;
  -- A company cannot change the global identity of a multi-company or multi-role account.
  if p_user_id = auth.uid() or not private.client_has_organisation(p_organisation_id)
    or exists (
      select 1 from private.company_participant_memberships
      where user_id = p_user_id and organisation_id <> p_organisation_id and status = 'active'
    )
    or exists (select 1 from public.user_roles where user_id = p_user_id and role <> 'participant')
  then
    raise exception 'Shared participant profile requires staff management' using errcode = '42501';
  end if;
  return private.basic_account_profile(p_user_id);
end;
$$;

create function private.save_company_participant_profile(
  p_user_id uuid, p_organisation_id uuid, p_payload jsonb, p_expected jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform private.company_participant_profile(p_user_id, p_organisation_id);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('participant-membership:' || p_user_id::text, 0));
  perform private.lock_company_premium(p_organisation_id);
  perform 1 from public.profiles where id in (p_user_id, auth.uid()) order by id for no key update;
  perform 1 from public.client_organisation_memberships
  where user_id = auth.uid() and organisation_id = p_organisation_id and removed_at is null
  for share;
  perform private.company_participant_profile(p_user_id, p_organisation_id);
  return private.write_basic_account_profile(p_user_id, p_payload, p_expected, p_organisation_id);
end;
$$;

create function private.set_lecturer_expertise(p_user_id uuid, p_topic_id uuid, p_selected boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('portal-user-activation', 0));
  perform private.lock_qualification_actor(p_user_id, true);
  if not private.account_target_manageable(p_user_id) then
    raise exception 'Only subordinate lecturers may be managed' using errcode = '42501';
  end if;
  if p_selected is null or p_topic_id is null then
    raise exception 'Topic and selection required' using errcode = '22023';
  end if;
  if p_selected then
    perform 1 from public.topics where id = p_topic_id and archived_at is null for share;
    if not found then raise exception 'Active topic required' using errcode = '22023'; end if;
    insert into public.lecturer_topics(user_id, topic_id)
    values (p_user_id, p_topic_id)
    on conflict do nothing;
  else
    -- Keep the review history and the existing evidence withdrawal trigger.
    delete from public.lecturer_topics
    where user_id = p_user_id and topic_id = p_topic_id and not verified;
  end if;
  if found then
    insert into public.audit_events(actor_id, action, resource_id, details)
    values (auth.uid(), 'qualification.expertise_selection_changed', p_user_id,
      jsonb_build_object('topic_id', p_topic_id, 'selected', p_selected));
  elsif not p_selected and exists(
    select 1 from public.lecturer_topics where user_id = p_user_id and topic_id = p_topic_id
  ) then
    raise exception 'Revoke verification before removing this topic' using errcode = 'PT409';
  end if;
end;
$$;

create function public.company_participant_profile(p_user_id uuid, p_organisation_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.company_participant_profile(p_user_id, p_organisation_id);
$$;
create function public.save_company_participant_profile(
  p_user_id uuid, p_organisation_id uuid, p_payload jsonb, p_expected jsonb
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.save_company_participant_profile(p_user_id, p_organisation_id, p_payload, p_expected);
$$;
create function public.set_lecturer_expertise(p_user_id uuid, p_topic_id uuid, p_selected boolean)
returns void language sql security invoker set search_path = '' as $$
  select private.set_lecturer_expertise(p_user_id, p_topic_id, p_selected);
$$;

revoke all on function private.basic_account_profile(uuid),
  private.write_basic_account_profile(uuid,jsonb,jsonb,uuid) from public, anon, authenticated;
revoke all on function private.company_participant_profile(uuid,uuid),
  private.save_company_participant_profile(uuid,uuid,jsonb,jsonb),
  private.set_lecturer_expertise(uuid,uuid,boolean),
  public.company_participant_profile(uuid,uuid),
  public.save_company_participant_profile(uuid,uuid,jsonb,jsonb),
  public.set_lecturer_expertise(uuid,uuid,boolean) from public, anon, authenticated;
grant execute on function private.company_participant_profile(uuid,uuid),
  private.save_company_participant_profile(uuid,uuid,jsonb,jsonb),
  private.set_lecturer_expertise(uuid,uuid,boolean),
  public.company_participant_profile(uuid,uuid),
  public.save_company_participant_profile(uuid,uuid,jsonb,jsonb),
  public.set_lecturer_expertise(uuid,uuid,boolean) to authenticated;

commit;
