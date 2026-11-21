begin;

-- A null organisation is the installation-wide switch. The organisation
-- switch can add protection, never override the installation's protection.
create table private.course_chat_protection_settings (
  id bigint generated always as identity primary key,
  organisation_id uuid references public.organisations(id) on delete cascade,
  enabled boolean not null default false,
  version integer not null default 0 check (version >= 0),
  unique nulls not distinct (organisation_id)
);
alter table private.course_chat_protection_settings enable row level security;
revoke all on private.course_chat_protection_settings from public, anon, authenticated, service_role;
insert into private.course_chat_protection_settings(organisation_id) values (null);

create function private.course_chat_protection_admin()
returns boolean language sql stable security invoker set search_path = '' as $$
  select case when (select edition from private.installation_identity) = 'internal'
    then private.is_company_premium_admin()
    else private.academy_local_admin(auth.uid())
  end;
$$;

create function private.course_chat_protection(p_run_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  internal_edition boolean := (select edition from private.installation_identity) = 'internal';
  can_manage_global boolean := private.course_chat_protection_admin();
  company_id uuid;
  global_setting private.course_chat_protection_settings%rowtype;
  company_setting private.course_chat_protection_settings%rowtype;
begin
  if not private.actor_active() or (not internal_edition and
     not coalesce(private.academy_course_access_status() in ('active', 'grace'), false)) then
    raise insufficient_privilege;
  end if;
  if p_run_id is not null then
    select run.organisation_id into company_id
    from public.course_runs run join public.organisations organisation on organisation.id = run.organisation_id
    where run.id = p_run_id and run.archived_at is null and organisation.archived_at is null;
    if company_id is null or not private.course_lms_read_enabled(company_id) or
      not (can_manage_global or private.client_has_organisation(company_id)) then
      raise insufficient_privilege;
    end if;
  elsif not can_manage_global then
    raise insufficient_privilege;
  end if;

  select * into strict global_setting from private.course_chat_protection_settings where organisation_id is null;
  select * into company_setting from private.course_chat_protection_settings where organisation_id = company_id;
  return jsonb_build_object(
    'global', case when can_manage_global then jsonb_build_object(
      'enabled', global_setting.enabled, 'version', global_setting.version) end,
    'company', case when company_id is not null then jsonb_build_object(
      'enabled', coalesce(company_setting.enabled, false), 'version', coalesce(company_setting.version, 0)) end,
    'global_enforced', global_setting.enabled,
    'can_write', internal_edition or private.academy_course_access_status() = 'active'
  );
end;
$$;

create function private.set_course_chat_protection(
  p_run_id uuid, p_global boolean, p_enabled boolean, p_expected_version integer
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  internal_edition boolean := (select edition from private.installation_identity) = 'internal';
  actor uuid := auth.uid();
  company_id uuid;
  scope_id uuid;
  prior private.course_chat_protection_settings%rowtype;
begin
  if p_global is null or p_enabled is null or p_expected_version is null or p_expected_version < 0
    or (not p_global and p_run_id is null) then
    raise invalid_parameter_value;
  end if;
  if not internal_edition then perform private.lock_academy_course_access(); end if;
  if p_run_id is not null then
    select organisation_id into company_id from public.course_runs
    where id = p_run_id and archived_at is null for share;
    if company_id is null then raise insufficient_privilege; end if;
    if internal_edition then
      perform private.lock_company_premium(company_id);
    else
      perform 1 from public.organisations where id = company_id and archived_at is null for share;
      if not found then raise insufficient_privilege; end if;
    end if;
  end if;

  perform 1 from public.profiles where id = actor and active for share;
  if not found then raise insufficient_privilege; end if;
  perform 1 from public.user_roles where user_id = actor order by role for share;
  if p_global then
    if not private.course_chat_protection_admin() then raise insufficient_privilege; end if;
  elsif not private.course_chat_protection_admin() then
    perform 1 from public.client_organisation_memberships
    where organisation_id = company_id and user_id = actor and removed_at is null for share;
    if not found or not private.client_has_organisation(company_id) then raise insufficient_privilege; end if;
  end if;

  scope_id := case when not p_global then company_id end;
  insert into private.course_chat_protection_settings(organisation_id) values (scope_id)
    on conflict (organisation_id) do nothing;
  -- Use distinct lookups to keep the primary access paths indexable.
  if p_global then
    select * into strict prior from private.course_chat_protection_settings where organisation_id is null for update;
  else
    select * into strict prior from private.course_chat_protection_settings where organisation_id = scope_id for update;
  end if;
  if prior.version <> p_expected_version then
    if prior.version::bigint = p_expected_version::bigint + 1 and prior.enabled = p_enabled then
      return private.course_chat_protection(p_run_id);
    end if;
    raise exception 'Course chat protection has changed' using errcode = 'PT409';
  end if;
  if prior.enabled is distinct from p_enabled then
    update private.course_chat_protection_settings settings
    set enabled = p_enabled, version = prior.version + 1
    where settings.organisation_id is not distinct from scope_id;
    insert into public.audit_events(actor_id, action, resource_id, details)
    values (actor, 'course_chat.protection_changed', scope_id, jsonb_build_object(
      'scope', case when p_global then 'global' else 'company' end, 'enabled', p_enabled));
  end if;
  return private.course_chat_protection(p_run_id);
end;
$$;

-- New messages share the existing per-sender lock and one authoritative path
-- for scanned attachments, draft validation, idempotency and notifications.
create function private.guard_course_chat_send(p_room_id uuid, p_actor uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  company_id uuid;
  window_start timestamptz := clock_timestamp() - interval '1 minute';
begin
  select run.organisation_id into company_id
  from public.chat_rooms room join public.course_runs run on run.id = room.course_run_id
  where room.id = p_room_id and room.kind = 'participant_course';
  if company_id is null or not exists (
    select 1 from private.course_chat_protection_settings settings
    where (settings.organisation_id is null or settings.organisation_id = company_id) and settings.enabled
  ) then return; end if;

  if exists (
    select 1 from public.messages message
    join public.chat_rooms room on room.id = message.room_id and room.kind = 'participant_course'
    join public.course_runs run on run.id = room.course_run_id and run.organisation_id = company_id
    where message.sender_id = p_actor and message.created_at > window_start
    offset 7 limit 1
  ) then
    raise exception 'Course chat protection limit reached' using errcode = 'PT429';
  end if;
end;
$$;

create function public.course_chat_protection(p_run_id uuid default null)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.course_chat_protection(p_run_id);
$$;
create function public.set_course_chat_protection(
  p_run_id uuid, p_global boolean, p_enabled boolean, p_expected_version integer
)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.set_course_chat_protection(p_run_id, p_global, p_enabled, p_expected_version);
$$;

revoke all on function private.guard_course_chat_send(uuid, uuid),
  private.course_chat_protection_admin(), private.course_chat_protection(uuid),
  public.course_chat_protection(uuid), private.set_course_chat_protection(uuid, boolean, boolean, integer),
  public.set_course_chat_protection(uuid, boolean, boolean, integer)
from public, anon, authenticated, service_role;
grant execute on function private.course_chat_protection(uuid), public.course_chat_protection(uuid),
  private.set_course_chat_protection(uuid, boolean, boolean, integer),
  public.set_course_chat_protection(uuid, boolean, boolean, integer) to authenticated;

do $$
declare
  definition text := pg_catalog.pg_get_functiondef('private.send_message(uuid,text,uuid,uuid)'::regprocedure);
  anchor constant text := ' insert into public.messages(room_id,sender_id,client_id,request_hash,body,document_id)';
begin
  if cardinality(string_to_array(definition, anchor)) <> 2 then
    raise exception 'Expected one confirmed chat message insertion';
  end if;
  execute replace(definition, anchor, ' perform private.guard_course_chat_send(p_room_id, actor);' || chr(10) || anchor);
end;
$$;

do $$
declare
  definition text := pg_catalog.pg_get_functiondef('private.require_academy_course_access()'::regprocedure);
  anchor constant text := '  licence_status := private.academy_course_access_status();';
begin
  if cardinality(string_to_array(definition, anchor)) <> 2 then
    raise exception 'Expected one dedicated chat protection gate';
  end if;
  execute replace(definition, anchor, anchor || $gate$
  if request_method = 'POST' and (
    (licence_status in ('active', 'grace') and request_path = '/rpc/course_chat_protection') or
    (licence_status = 'active' and request_path = '/rpc/set_course_chat_protection')
  ) then return; end if;$gate$);
end;
$$;

notify pgrst, 'reload schema';
commit;
