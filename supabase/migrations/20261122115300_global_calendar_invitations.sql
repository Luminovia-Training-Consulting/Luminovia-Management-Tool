begin;

create table private.global_event_invitations (
  event_id uuid not null references public.global_events(id) on delete cascade,
  event_version integer not null check (event_version > 0),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  invited_by uuid references public.profiles(id) on delete set null,
  revision integer not null default 1 check (revision > 0),
  response text not null default 'pending'
    check (response in ('pending', 'accepted', 'tentative', 'declined')),
  withdrawn boolean not null default false,
  primary key (event_id, event_version, recipient_id)
);
alter table private.global_event_invitations enable row level security;
revoke all on private.global_event_invitations from public, anon, authenticated, service_role;
create index global_event_invitations_recipient on private.global_event_invitations (recipient_id, event_id)
  where not withdrawn;

create function private.calendar_invitation_access()
returns boolean language sql stable security invoker set search_path = '' as $$
  select private.actor_active() and exists (
    select from private.installation_identity where singleton and edition = 'internal'
  );
$$;

create function private.calendar_invitations(
  p_event_id uuid default null, p_event_version integer default null,
  p_after_at timestamptz default null, p_after_id uuid default null
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if not private.calendar_invitation_access() then raise insufficient_privilege; end if;
  if (p_after_at is null) <> (p_after_id is null)
    or (p_after_at is not null and (not isfinite(p_after_at) or p_event_id is not null or p_event_version is not null)) then
    raise exception 'Invalid calendar invitation cursor' using errcode = '22023';
  end if;
  if p_event_id is null and p_event_version is null then
    with page as (
      select event.id as event_id, event.version as event_version, event.title,
        event.starts_at, event.ends_at, event.time_zone, receipt.revision, receipt.response,
        row_number() over (order by event.starts_at, event.id) as position
      from private.global_event_invitations receipt
      join public.global_events event on event.id = receipt.event_id and event.version = receipt.event_version
      where receipt.recipient_id = auth.uid() and not receipt.withdrawn
        and event.published and event.archived_at is null and event.ends_at > now()
        and (p_after_at is null or (event.starts_at, event.id) > (p_after_at, p_after_id))
      order by event.starts_at, event.id
      limit 51
    )
    select jsonb_build_object(
      'items', coalesce(jsonb_agg(to_jsonb(page) - 'position' order by position)
        filter (where position <= 50), '[]'::jsonb),
      'next_cursor', case when count(*) = 51 then (
        select jsonb_build_object('at', starts_at, 'id', event_id) from page where position = 50
      ) end
    ) into result from page;
    return result;
  end if;

  if not private.has_permission('courses.manage') then raise insufficient_privilege; end if;
  if not exists (
    select from public.global_events event where event.id = p_event_id and event.version = p_event_version
      and event.published and event.archived_at is null and event.ends_at > now()
  ) then raise exception 'Calendar publication no longer accepts invitations' using errcode = '40001'; end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'user_code', profile.luminovia_user_id, 'name', profile.display_name,
      'revision', receipt.revision, 'response', receipt.response, 'withdrawn', receipt.withdrawn
    ) order by profile.display_name, profile.luminovia_user_id)
    from private.global_event_invitations receipt
    join public.profiles profile on profile.id = receipt.recipient_id
    where receipt.event_id = p_event_id and receipt.event_version = p_event_version
  ), '[]'::jsonb);
end;
$$;

create function private.set_calendar_invitation(
  p_event_id uuid, p_event_version integer, p_user_code text, p_invited boolean, p_expected_revision integer
)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare
  recipient uuid;
  receipt private.global_event_invitations%rowtype;
  code text := upper(btrim(p_user_code));
begin
  perform 1 from public.profiles where id = auth.uid() for share;
  if not private.calendar_invitation_access() or not private.has_permission('courses.manage') then
    raise insufficient_privilege;
  end if;
  if code is null or code !~ '^LV(-[0-9A-F]{4}){5}$' or p_invited is null
    or p_expected_revision is null or p_expected_revision < 0 then
    raise exception 'Invalid calendar invitation' using errcode = '22023';
  end if;

  -- Serialize the roster cap and new invitations with editing or unpublishing the event.
  perform 1 from public.global_events
    where id = p_event_id and version = p_event_version
      and published and archived_at is null and ends_at > now()
    for update;
  if not found then raise exception 'Calendar publication changed' using errcode = '40001'; end if;

  select profile.id into recipient from public.profiles profile
  where profile.luminovia_user_id = code and (
    not p_invited or (profile.active and exists (
      select from public.user_roles role where role.user_id = profile.id
        and role.role in ('owner', 'admin', 'management', 'lecturer', 'senior_lecturer', 'client')
    ))
  );
  if recipient is null then raise exception 'Calendar recipient unavailable' using errcode = '22023'; end if;

  select * into receipt from private.global_event_invitations
    where event_id = p_event_id and event_version = p_event_version and recipient_id = recipient
    for update;
  if receipt.revision is not null and receipt.withdrawn is distinct from p_invited
    and receipt.revision::bigint in (p_expected_revision::bigint, p_expected_revision::bigint + 1) then
    return true;
  end if;
  if coalesce(receipt.revision, 0) <> p_expected_revision or (receipt.revision is null and not p_invited) then
    raise exception 'Calendar invitation changed' using errcode = '40001';
  end if;

  if receipt.revision is null then
    if (select count(*) from private.global_event_invitations
        where event_id = p_event_id and event_version = p_event_version) >= 100 then
      raise exception 'Calendar recipient limit reached' using errcode = '22023';
    end if;
    insert into private.global_event_invitations(event_id, event_version, recipient_id, invited_by)
    values (p_event_id, p_event_version, recipient, auth.uid());
  else
    update private.global_event_invitations
      set withdrawn = not p_invited,
          response = case when p_invited then 'pending' else response end,
          invited_by = case when p_invited then auth.uid() else invited_by end,
          revision = revision + 1
    where event_id = p_event_id and event_version = p_event_version and recipient_id = recipient;
  end if;

  if p_invited then
    insert into public.notifications(user_id, kind, resource_id)
    values (recipient, 'calendar_invitation', p_event_id)
    on conflict (user_id, kind, resource_id) do update
      set read_at = null, created_at = clock_timestamp();
  end if;
  return true;
end;
$$;

create function private.reply_calendar_invitation(
  p_event_id uuid, p_event_version integer, p_expected_revision integer, p_response text
)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare receipt private.global_event_invitations%rowtype;
begin
  perform 1 from public.profiles where id = auth.uid() for share;
  if not private.calendar_invitation_access() then raise insufficient_privilege; end if;
  if p_expected_revision is null or p_expected_revision < 1 or p_response is null
    or p_response not in ('accepted', 'tentative', 'declined') then
    raise exception 'Invalid calendar response' using errcode = '22023';
  end if;

  perform 1 from public.global_events where id = p_event_id and version = p_event_version
    and published and archived_at is null and ends_at > now() for share;
  if not found then raise insufficient_privilege; end if;
  select * into receipt from private.global_event_invitations
    where event_id = p_event_id and event_version = p_event_version
      and recipient_id = auth.uid() and not withdrawn for update;
  if not found then raise insufficient_privilege; end if;

  if receipt.response = p_response
    and receipt.revision::bigint in (p_expected_revision::bigint, p_expected_revision::bigint + 1) then
    return true;
  end if;
  if receipt.revision <> p_expected_revision then
    raise exception 'Calendar invitation changed' using errcode = '40001';
  end if;
  update private.global_event_invitations set response = p_response, revision = revision + 1
  where event_id = p_event_id and event_version = p_event_version and recipient_id = auth.uid();
  return true;
end;
$$;

create function public.calendar_invitations(
  p_event_id uuid default null, p_event_version integer default null,
  p_after_at timestamptz default null, p_after_id uuid default null
)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.calendar_invitations(p_event_id, p_event_version, p_after_at, p_after_id);
$$;
create function public.set_calendar_invitation(
  p_event_id uuid, p_event_version integer, p_user_code text, p_invited boolean, p_expected_revision integer
)
returns boolean language sql volatile security invoker set search_path = '' as $$
  select private.set_calendar_invitation(p_event_id, p_event_version, p_user_code, p_invited, p_expected_revision);
$$;
create function public.reply_calendar_invitation(
  p_event_id uuid, p_event_version integer, p_expected_revision integer, p_response text
)
returns boolean language sql volatile security invoker set search_path = '' as $$
  select private.reply_calendar_invitation(p_event_id, p_event_version, p_expected_revision, p_response);
$$;

revoke all on function private.calendar_invitation_access(), private.calendar_invitations(uuid,integer,timestamptz,uuid),
  private.set_calendar_invitation(uuid,integer,text,boolean,integer),
  private.reply_calendar_invitation(uuid,integer,integer,text), public.calendar_invitations(uuid,integer,timestamptz,uuid),
  public.set_calendar_invitation(uuid,integer,text,boolean,integer),
  public.reply_calendar_invitation(uuid,integer,integer,text) from public, anon, authenticated, service_role;
grant execute on function private.calendar_invitations(uuid,integer,timestamptz,uuid),
  private.set_calendar_invitation(uuid,integer,text,boolean,integer),
  private.reply_calendar_invitation(uuid,integer,integer,text), public.calendar_invitations(uuid,integer,timestamptz,uuid),
  public.set_calendar_invitation(uuid,integer,text,boolean,integer),
  public.reply_calendar_invitation(uuid,integer,integer,text) to authenticated;

create function private.calendar_invitation_available(p_event_id uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select private.calendar_invitation_access() and exists (
    select from private.global_event_invitations receipt
    join public.global_events event on event.id = receipt.event_id and event.version = receipt.event_version
    where event.id = p_event_id and event.published and event.archived_at is null and event.ends_at > now()
      and receipt.recipient_id = auth.uid() and not receipt.withdrawn
  );
$$;

alter function private.notification_target(text,uuid) rename to notification_target_before_calendar_invitation;
create function private.notification_target(p_kind text, p_resource uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when p_kind = 'calendar_invitation' then jsonb_build_object(
    'href', case when private.calendar_invitation_available(p_resource) then '/calendar#calendar-invitations' end,
    'title', ''
  ) else private.notification_target_before_calendar_invitation(p_kind, p_resource) end;
$$;

-- Keep the existing function OID referenced by the Realtime notification policy.
do $patch$
declare definition text := pg_catalog.pg_get_functiondef('private.notification_currently_visible(text,uuid)'::regprocedure);
begin
  if cardinality(string_to_array(definition, 'select case')) <> 2 then
    raise exception 'Expected one inbox visibility decision';
  end if;
  execute replace(definition, 'select case', $branch$select case
    when p_kind = 'calendar_invitation' then private.calendar_invitation_available(p_resource)$branch$);
end;
$patch$;

revoke all on function private.calendar_invitation_available(uuid), private.notification_target(text,uuid),
  private.notification_target_before_calendar_invitation(text,uuid) from public, anon, authenticated, service_role;
notify pgrst, 'reload schema';
commit;
