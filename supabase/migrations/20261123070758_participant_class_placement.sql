begin;

-- A class describes one company membership. It grants no course enrolment.
alter table private.company_participant_memberships
  add column class_id uuid,
  add foreign key (class_id, organisation_id)
    references private.course_classes(id, organisation_id) on delete set null (class_id);
create index company_participant_memberships_class
  on private.company_participant_memberships(class_id, organisation_id) where class_id is not null;

alter table private.company_participant_invitation_dispatches
  add column class_id uuid,
  add foreign key (class_id, organisation_id)
    references private.course_classes(id, organisation_id) on delete set null (class_id);
create index company_participant_dispatch_class
  on private.company_participant_invitation_dispatches(class_id, organisation_id) where class_id is not null;
create index company_participant_dispatch_invitation
  on private.company_participant_invitation_dispatches(invitation_id) where invitation_id is not null;

alter table private.account_creation_requests
  add column participant_organisation_id uuid,
  add column participant_class_id uuid,
  add check (participant_class_id is null or participant_organisation_id is not null),
  add check (participant_organisation_id is null or requested_role = 'participant');

create function private.check_participant_class(p_organisation_id uuid, p_class_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if p_class_id is not null then
    perform 1 from private.course_classes
    where id = p_class_id and organisation_id = p_organisation_id for key share;
    if not found then raise insufficient_privilege; end if;
  end if;
end;
$$;

create function private.resolve_invited_participant_class()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.status = 'removed' then
    new.class_id := null;
  elsif new.status = 'pending' and new.invitation_id is not null then
    select dispatch.class_id into new.class_id
    from private.company_participant_invitation_dispatches dispatch
    where dispatch.invitation_id = new.invitation_id
      and dispatch.organisation_id = new.organisation_id;
  end if;
  return new;
end;
$$;

create trigger company_participant_class_origin
  before insert or update of status, invitation_id on private.company_participant_memberships
  for each row execute function private.resolve_invited_participant_class();

create function private.reserve_class_participant_invitation(
  p_organisation_id uuid, p_email text, p_display_name text, p_request_id uuid, p_class_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  result jsonb;
  previous private.company_participant_invitation_dispatches%rowtype;
begin
  perform private.require_internal_company_participant_manager(p_organisation_id);
  perform private.lock_company_premium(p_organisation_id);
  perform private.check_participant_class(p_organisation_id, p_class_id);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('company-participant-invite:' || auth.uid()::text, 0)
  );
  select * into previous from private.company_participant_invitation_dispatches
  where actor_id = auth.uid() and request_id = p_request_id;
  result := private.reserve_company_participant_invitation(
    p_organisation_id, p_email, p_display_name, p_request_id);
  if previous.id is null then
    update private.company_participant_invitation_dispatches set class_id = p_class_id
    where id = (result->>'request_id')::uuid;
  elsif previous.class_id is distinct from p_class_id then
    raise exception 'Participant invitation request ID conflict' using errcode = '40001';
  end if;
  return result;
end;
$$;

-- Account administration can select a placement in the same transaction as
-- assigning a role. The learner still accepts a new company relationship.
create function private.place_managed_participant(
  p_actor_id uuid, p_user_id uuid, p_organisation_id uuid, p_class_id uuid
) returns void language plpgsql security invoker set search_path = '' as $$
declare
  entry private.company_participant_memberships%rowtype;
  link_id uuid;
  learner_code text;
begin
  if p_actor_id = p_user_id
    or (select edition from private.installation_identity) is distinct from 'internal'
    or not exists (
      select 1 from public.profiles actor
      join public.user_roles roles on roles.user_id = actor.id
      join public.role_permissions permission on permission.role = roles.role
      where actor.id = p_actor_id and actor.active and permission.permission = 'courses.manage'
    ) then
    raise insufficient_privilege;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('participant-membership:' || p_user_id::text, 0)
  );
  perform private.lock_company_premium(p_organisation_id);
  perform private.check_participant_class(p_organisation_id, p_class_id);
  select profile.luminovia_user_id into learner_code from public.profiles profile
  join public.user_roles role on role.user_id = profile.id and role.role = 'participant'
  where profile.id = p_user_id and profile.active;
  if not found then raise insufficient_privilege; end if;

  select * into entry from private.company_participant_memberships
  where organisation_id = p_organisation_id and user_id = p_user_id for update;
  if entry.status = 'active'
    or (entry.status = 'pending' and (
      exists (
        select 1 from public.invitation_requests invitation
        where invitation.id = entry.invitation_id and invitation.requested_role = 'participant'
          and invitation.status = 'sent' and invitation.created_at > now() - interval '14 days'
      ) or exists (
        select 1 from private.company_participant_link_requests request
        where request.id = entry.link_request_id and request.status = 'pending' and request.expires_at > now()
      )
    )) then
    if entry.class_id is not distinct from p_class_id then return; end if;
    update private.company_participant_memberships set class_id = p_class_id, version = version + 1
    where organisation_id = p_organisation_id and user_id = p_user_id;
  else
    insert into private.company_participant_link_requests(
      organisation_id, requested_by, request_id, luminovia_user_id, target_user_id, status, expires_at
    ) values (
      p_organisation_id, p_actor_id, gen_random_uuid(), learner_code, p_user_id, 'pending', now() + interval '14 days'
    ) returning id into link_id;
    insert into private.company_participant_memberships(
      organisation_id, user_id, status, link_request_id, invited_by, class_id
    ) values (
      p_organisation_id, p_user_id, 'pending', link_id, p_actor_id, p_class_id
    ) on conflict (organisation_id, user_id) do update set
      status = 'pending', invitation_id = null, link_request_id = excluded.link_request_id,
      invited_by = excluded.invited_by, class_id = excluded.class_id, joined_at = null, removed_at = null,
      version = private.company_participant_memberships.version + 1;
  end if;
  insert into public.audit_events(actor_id, action, resource_id, details)
  values (p_actor_id, 'company.participant_placement_saved', p_organisation_id,
    jsonb_build_object('user_id', p_user_id, 'class_id', p_class_id));
end;
$$;

create function private.reserve_participant_account_creation(
  p_email text, p_display_name text, p_organisation_id uuid, p_class_id uuid, p_request_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  result jsonb;
  previous private.account_creation_requests%rowtype;
begin
  if not private.has_permission('courses.manage') then raise insufficient_privilege; end if;
  perform private.require_internal_company_participant_manager(p_organisation_id);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('portal-user-activation', 0));
  perform private.lock_company_premium(p_organisation_id);
  perform private.check_participant_class(p_organisation_id, p_class_id);
  select * into previous from private.account_creation_requests
  where actor_id = auth.uid() and request_id = p_request_id;
  result := private.reserve_account_creation(p_email, p_display_name, 'participant', null, p_request_id);
  if previous.id is null then
    update private.account_creation_requests
    set participant_organisation_id = p_organisation_id, participant_class_id = p_class_id
    where id = (result->>'creation_id')::uuid;
  elsif previous.participant_organisation_id is distinct from p_organisation_id
    or previous.participant_class_id is distinct from p_class_id then
    raise exception 'Creation request changed' using errcode = '40001';
  end if;
  return result;
end;
$$;

create function private.finalise_participant_placement()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  perform private.place_managed_participant(
    new.actor_id, new.auth_user_id, new.participant_organisation_id, new.participant_class_id);
  return new;
end;
$$;

create trigger account_creation_participant_placement
  after update of status on private.account_creation_requests
  for each row when (old.status = 'reserved' and new.status = 'created' and new.participant_organisation_id is not null)
  execute function private.finalise_participant_placement();

create function private.set_roles_with_participant_company(
  p_user_id uuid, p_roles text[], p_organisation_id uuid, p_class_id uuid, p_client_organisation_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  receipt jsonb;
begin
  if p_user_id = auth.uid() or not private.has_permission('courses.manage') then raise insufficient_privilege; end if;
  if not coalesce('participant' = any(p_roles), false) or p_organisation_id is null then raise invalid_parameter_value; end if;
  receipt := private.apply_account_roles(p_user_id, p_roles, p_client_organisation_id);
  perform private.place_managed_participant(auth.uid(), p_user_id, p_organisation_id, p_class_id);
  return receipt;
end;
$$;

create function private.set_company_participant_class(
  p_organisation_id uuid, p_user_id uuid, p_class_id uuid, p_expected_version integer
) returns void language plpgsql security definer set search_path = '' as $$
declare
  entry private.company_participant_memberships%rowtype;
begin
  perform private.require_internal_company_participant_manager(p_organisation_id);
  if p_user_id is null or p_expected_version is null or p_expected_version < 1 then raise invalid_parameter_value; end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('participant-membership:' || p_user_id::text, 0)
  );
  perform private.lock_company_premium(p_organisation_id);
  select * into entry from private.company_participant_memberships
  where organisation_id = p_organisation_id and user_id = p_user_id for update;
  perform private.require_internal_company_participant_manager(p_organisation_id);
  if not private.active_company_participant(p_user_id, p_organisation_id) then raise insufficient_privilege; end if;
  perform private.check_participant_class(p_organisation_id, p_class_id);
  if entry.version <> p_expected_version then
    raise exception 'Company participant membership changed' using errcode = 'PT409';
  end if;
  if entry.class_id is not distinct from p_class_id then return; end if;
  update private.company_participant_memberships set class_id = p_class_id, version = version + 1
  where organisation_id = p_organisation_id and user_id = p_user_id;
  insert into public.audit_events(actor_id, action, resource_id, details)
  values (auth.uid(), 'company.participant_class_changed', p_organisation_id,
    jsonb_build_object('user_id', p_user_id, 'class_id', p_class_id));
end;
$$;

-- Preserve the directory's existing projections and authority checks.
create or replace function private.company_participants(p_organisation_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare internal_edition boolean := (select edition = 'internal' from private.installation_identity);
begin
  if not private.actor_active() or not (
    private.client_has_organisation(p_organisation_id) or private.has_permission('courses.manage')
  ) then raise insufficient_privilege; end if;
  if not private.company_premium_enabled(p_organisation_id) then
    raise exception 'Company Premium LMS is OFF' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'user_id', profile.id, 'luminovia_user_id', profile.luminovia_user_id,
      'display_name', profile.display_name, 'joined_at', membership.joined_at, 'version', membership.version,
      'company_reference', case when internal_edition then membership.company_reference end,
      'class_id', case when internal_edition then class.id end,
      'class_name', case when internal_edition then class.name end
    ) order by profile.display_name, profile.luminovia_user_id)
    from private.company_participant_memberships membership
    join public.profiles profile on profile.id = membership.user_id
    left join private.course_classes class on (class.id, class.organisation_id) = (membership.class_id, membership.organisation_id)
    where membership.organisation_id = p_organisation_id
      and private.active_company_participant(profile.id, p_organisation_id)
  ), '[]'::jsonb);
end;
$$;

create function public.reserve_class_participant_invitation(
  p_organisation_id uuid, p_email text, p_display_name text, p_request_id uuid, p_class_id uuid
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.reserve_class_participant_invitation($1, $2, $3, $4, $5);
$$;
create function public.reserve_participant_account_creation(
  p_email text, p_display_name text, p_organisation_id uuid, p_class_id uuid, p_request_id uuid
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.reserve_participant_account_creation($1, $2, $3, $4, $5);
$$;
create function public.set_roles_with_participant_company(
  p_user_id uuid, p_roles text[], p_organisation_id uuid, p_class_id uuid, p_client_organisation_id uuid
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.set_roles_with_participant_company($1, $2, $3, $4, $5);
$$;
create function public.set_company_participant_class(
  p_organisation_id uuid, p_user_id uuid, p_class_id uuid, p_expected_version integer
) returns void language sql security invoker set search_path = '' as $$
  select private.set_company_participant_class($1, $2, $3, $4);
$$;

revoke all on function private.check_participant_class(uuid,uuid),
  private.resolve_invited_participant_class(), private.finalise_participant_placement(),
  private.place_managed_participant(uuid,uuid,uuid,uuid),
  private.reserve_class_participant_invitation(uuid,text,text,uuid,uuid),
  public.reserve_class_participant_invitation(uuid,text,text,uuid,uuid),
  private.reserve_participant_account_creation(text,text,uuid,uuid,uuid), public.reserve_participant_account_creation(text,text,uuid,uuid,uuid),
  private.set_roles_with_participant_company(uuid,text[],uuid,uuid,uuid), public.set_roles_with_participant_company(uuid,text[],uuid,uuid,uuid),
  private.set_company_participant_class(uuid,uuid,uuid,integer), public.set_company_participant_class(uuid,uuid,uuid,integer)
from public, anon, authenticated, service_role;
grant execute on function
  private.reserve_class_participant_invitation(uuid,text,text,uuid,uuid),
  public.reserve_class_participant_invitation(uuid,text,text,uuid,uuid),
  private.reserve_participant_account_creation(text,text,uuid,uuid,uuid), public.reserve_participant_account_creation(text,text,uuid,uuid,uuid),
  private.set_roles_with_participant_company(uuid,text[],uuid,uuid,uuid), public.set_roles_with_participant_company(uuid,text[],uuid,uuid,uuid),
  private.set_company_participant_class(uuid,uuid,uuid,integer), public.set_company_participant_class(uuid,uuid,uuid,integer)
to authenticated;
notify pgrst, 'reload schema';

commit;
