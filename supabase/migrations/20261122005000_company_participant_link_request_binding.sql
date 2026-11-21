begin;

-- Distinguish the client request key from the internal company-link record ID.
-- Both the public RPC's implementation and the ungranted legacy helper retain
-- the same authority, retry, privacy and pending-membership rules.

create or replace function private.request_company_participant_link(
  p_organisation_id uuid, p_luminovia_user_id text, p_request_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_user uuid;
  existing_request private.company_participant_link_requests%rowtype;
  link_id uuid;
  request_status text;
begin
  if not private.actor_active() or p_organisation_id is null or
     p_luminovia_user_id is null or length(btrim(p_luminovia_user_id)) not between 1 and 32 or
     p_request_id is null then
    raise exception 'Valid participant link request required' using errcode = '22023';
  end if;
  if not (private.client_has_organisation(p_organisation_id) or
      private.has_permission('courses.manage')) then
    raise exception 'Company participant management required' using errcode = '42501';
  end if;
  perform private.lock_company_premium(p_organisation_id);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('participant-link:' || auth.uid()::text || ':' || p_organisation_id::text, 0)
  );
  select request.* into existing_request
  from private.company_participant_link_requests request
  where request.requested_by = auth.uid() and request.request_id = p_request_id;
  if found then
    if existing_request.organisation_id <> p_organisation_id or
       existing_request.luminovia_user_id <> upper(btrim(p_luminovia_user_id)) then
      raise exception 'Participant link request ID conflict' using errcode = '40001';
    end if;
    return jsonb_build_object('status', 'request_submitted');
  end if;
  if (select count(*) from private.company_participant_link_requests request
      where request.requested_by = auth.uid()
        and request.created_at > now() - interval '1 hour') >= 10 then
    return jsonb_build_object('status', 'request_submitted');
  end if;
  select profile.id into target_user
  from public.profiles profile
  where profile.luminovia_user_id = upper(btrim(p_luminovia_user_id))
    and profile.active
    and exists (
      select 1 from public.user_roles role
      where role.user_id = profile.id and role.role = 'participant'
    )
    and not exists (
      select 1 from public.user_roles role
      where role.user_id = profile.id and role.role <> 'participant'
    )
    and profile.id <> auth.uid();
  if target_user is null then
    request_status := 'unmatched';
  elsif private.active_company_participant(target_user, p_organisation_id) then
    request_status := 'already_member';
  else
    request_status := 'pending';
  end if;
  insert into private.company_participant_link_requests(
    organisation_id, requested_by, request_id, luminovia_user_id,
    target_user_id, status, expires_at
  ) values (
    p_organisation_id, auth.uid(), p_request_id, upper(btrim(p_luminovia_user_id)),
    case when request_status = 'pending' then target_user else null end,
    request_status, now() + interval '14 days'
  ) returning id into link_id;
  if request_status = 'pending' then
    insert into private.company_participant_memberships(
      organisation_id, user_id, status, link_request_id, invited_by, version
    ) values (
      p_organisation_id, target_user, 'pending', link_id, auth.uid(), 1
    ) on conflict (organisation_id, user_id) do update
      set status = 'pending', invitation_id = null, link_request_id = excluded.link_request_id,
        invited_by = excluded.invited_by, joined_at = null, removed_at = null,
        version = private.company_participant_memberships.version + 1
      where private.company_participant_memberships.status = 'removed';
  end if;
  return jsonb_build_object('status', 'request_submitted');
end;
$$;

create or replace function private.reserve_company_participant_link(
  p_organisation_id uuid, p_luminovia_user_id text, p_request_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_user uuid;
  previous private.company_participant_link_requests%rowtype;
  link_id uuid;
  status_value text;
begin
  if not private.actor_active() or p_organisation_id is null or
     p_luminovia_user_id is null or length(trim(p_luminovia_user_id)) > 32 or
     p_request_id is null then
    raise exception 'Valid participant-link request required' using errcode = '22023';
  end if;
  if not (private.client_has_organisation(p_organisation_id) or
      private.has_permission('courses.manage')) then
    raise exception 'Company participant management required' using errcode = '42501';
  end if;
  perform private.lock_company_premium(p_organisation_id);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('participant-link:' || auth.uid()::text || ':' || p_organisation_id::text, 0)
  );
  select request.* into previous
  from private.company_participant_link_requests request
  where request.requested_by = auth.uid() and request.request_id = p_request_id;
  if found then
    if previous.organisation_id <> p_organisation_id or
       previous.luminovia_user_id <> upper(trim(p_luminovia_user_id)) then
      raise exception 'Participant-link request ID conflict' using errcode = '40001';
    end if;
    return jsonb_build_object('status', 'request_submitted');
  end if;
  if (select count(*) from private.company_participant_link_requests request
      where request.requested_by = auth.uid()
        and request.created_at > now() - interval '1 hour') >= 10 then
    return jsonb_build_object('status', 'request_submitted');
  end if;
  select profile.id into target_user
  from public.profiles profile
  where profile.luminovia_user_id = upper(trim(p_luminovia_user_id))
    and profile.active
    and exists (
      select 1 from public.user_roles role
      where role.user_id = profile.id and role.role = 'participant'
    )
    and not exists (
      select 1 from public.user_roles role
      where role.user_id = profile.id and role.role <> 'participant'
    )
    and profile.id <> auth.uid();
  if target_user is null then
    status_value := 'unmatched';
  elsif exists (
    select 1 from private.company_participant_memberships membership
    where membership.organisation_id = p_organisation_id
      and membership.user_id = target_user and membership.status = 'active'
  ) then
    status_value := 'already_member';
  else
    status_value := 'pending';
  end if;
  insert into private.company_participant_link_requests(
    organisation_id, requested_by, request_id, luminovia_user_id,
    target_user_id, status, expires_at
  ) values (
    p_organisation_id, auth.uid(), p_request_id, upper(trim(p_luminovia_user_id)),
    case when status_value = 'pending' then target_user else null end,
    status_value, now() + interval '14 days'
  ) returning id into link_id;
  if status_value = 'pending' then
    insert into private.company_participant_memberships(
      organisation_id, user_id, status, link_request_id, invited_by,
      version
    ) values (
      p_organisation_id, target_user, 'pending', link_id, auth.uid(), 1
    ) on conflict (organisation_id, user_id) do update
      set status = 'pending', invitation_id = null, link_request_id = excluded.link_request_id,
        invited_by = excluded.invited_by, joined_at = null, removed_at = null,
        version = private.company_participant_memberships.version + 1
      where private.company_participant_memberships.status = 'removed';
  end if;
  return jsonb_build_object('status', 'request_submitted');
end;
$$;

commit;
