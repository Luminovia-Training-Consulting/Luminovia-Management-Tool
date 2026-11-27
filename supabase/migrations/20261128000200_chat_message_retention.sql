begin;

-- NULL inherits the installation default. Zero deliberately disables expiry.
alter table public.chat_rooms
  add column retention_hours integer check (retention_hours in (0, 8, 168, 336)),
  add column retention_version integer not null default 0;

create table private.chat_retention_default (
  singleton boolean primary key default true check (singleton),
  hours integer not null check (hours in (0, 8, 168, 336)),
  version integer not null default 0
);
alter table private.chat_retention_default enable row level security;
revoke all on private.chat_retention_default from public, anon, authenticated, service_role;
insert into private.chat_retention_default (hours) values (0);

create function private.can_set_chat_retention(p_room_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select case when p_room_id is null then private.deletion_admin(auth.uid())
    else exists (
      select 1 from public.chat_rooms room where room.id=p_room_id
        and private.can_access_chat_room(room.id)
        and (
          private.deletion_admin(auth.uid())
          or (room.kind <> 'dm' and (room.owner_id=auth.uid() or private.has_permission('chat.moderate')))
        )
    )
  end;
$$;

create function private.chat_retention_policy(p_room_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  default_policy private.chat_retention_default;
  room public.chat_rooms;
begin
  if not private.actor_active() or
    (p_room_id is null and not private.can_set_chat_retention(null)) or
    (p_room_id is not null and not private.can_access_chat_room(p_room_id)) then
    raise insufficient_privilege;
  end if;
  select * into strict default_policy from private.chat_retention_default;
  if p_room_id is not null then
    select * into strict room from public.chat_rooms where id=p_room_id;
  end if;
  return jsonb_build_object(
    'hours', case when p_room_id is null then default_policy.hours else room.retention_hours end,
    'default_hours', default_policy.hours,
    'version', case when p_room_id is null then default_policy.version else room.retention_version end,
    'can_edit', private.can_set_chat_retention(p_room_id)
  );
end;
$$;

create function private.set_chat_retention_policy(p_room_id uuid, p_hours integer, p_expected_version integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not private.actor_active() or not private.can_set_chat_retention(p_room_id) then
    raise insufficient_privilege;
  end if;
  if p_expected_version is null or p_expected_version < 0
    or (p_room_id is null and p_hours is null)
    or (p_hours is not null and p_hours not in (0, 8, 168, 336)) then
    raise invalid_parameter_value;
  end if;
  if (select edition from private.installation_identity) <> 'internal' then
    perform private.lock_academy_course_access();
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('chat-retention', 0));
  if p_room_id is not null then
    perform 1 from public.chat_rooms where id=p_room_id for update;
  end if;
  if not private.actor_active() or not private.can_set_chat_retention(p_room_id) then
    raise insufficient_privilege;
  end if;
  if p_room_id is null then
    update private.chat_retention_default
      set hours=p_hours, version=version+1 where version=p_expected_version;
  else
    update public.chat_rooms
      set retention_hours=p_hours, retention_version=retention_version+1
      where id=p_room_id and retention_version=p_expected_version;
  end if;
  if not found then raise exception 'Chat retention policy changed' using errcode='PT409'; end if;
  insert into public.audit_events(actor_id, action, resource_id, details)
    values (auth.uid(), 'chat.retention.updated', p_room_id, jsonb_build_object('hours', p_hours));
  return private.chat_retention_policy(p_room_id);
end;
$$;

create index messages_retention_age on public.messages(created_at, id);
create index chat_room_retention_enabled on public.chat_rooms(id) where retention_hours > 0;
create index chat_mentions_request_message on private.chat_mention_requests ((result->>'id'));
create index work_tasks_chat_source on private.work_tasks(source_message_id) where source_message_id is not null;
create index chat_notice_resource on public.notifications(resource_id) where kind='chat_message';

create function private.prune_chat_messages() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  global_hours integer;
  message_ids uuid[];
  current_timepoint timestamptz := statement_timestamp();
begin
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('chat-retention', 0)) then
    return 0;
  end if;
  select hours into strict global_hours from private.chat_retention_default;
  if global_hours=0 and not exists (select 1 from public.chat_rooms where retention_hours > 0) then
    return 0;
  end if;
  select array_agg(candidate.id) into message_ids from (
    select message.id
    from public.messages message
    join public.chat_rooms room on room.id=message.room_id
    where message.created_at <= current_timepoint - interval '8 hours'
      and coalesce(room.retention_hours, global_hours) > 0
      and message.created_at <= current_timepoint
        - pg_catalog.make_interval(hours => coalesce(room.retention_hours, global_hours))
      and not private.deletion_row_fenced('public.messages', to_jsonb(message))
    order by message.created_at, message.id
    limit 250
    for update of message skip locked
  ) candidate;
  if message_ids is null then return 0; end if;

  -- The task may have been authored and assigned independently. Detach the
  -- expired source instead of deleting the task or extending message storage.
  update private.work_tasks task
    set source_message_id=null, request_payload=task.request_payload || '{"source_message_id":null}'::jsonb,
      version=task.version+1, updated_at=current_timepoint
    where task.source_message_id=any(message_ids);
  delete from public.notifications where kind='chat_message' and resource_id=any(message_ids);
  delete from public.message_reactions where message_id=any(message_ids);
  delete from public.chat_message_revisions where message_id=any(message_ids);
  delete from private.chat_mention_requests request
    where request.result->>'id'=any(message_ids::text[]);
  -- Pins, replies, hidden markers and structured content versions cascade.
  -- Document records retain their own explicit access and deletion lifecycle.
  delete from public.messages where id=any(message_ids);
  return cardinality(message_ids);
end;
$$;

create function private.ensure_chat_retention_schedule() returns boolean
language plpgsql security invoker set search_path = '' as $$
declare
  job_number bigint;
  use_socket boolean := current_user='supabase_admin'
    and current_setting('cron.use_background_workers', true)='off';
begin
  if current_database() is distinct from current_setting('cron.database_name', true)
    or not exists (select 1 from pg_extension where extname='pg_cron')
    or not has_schema_privilege(current_user, 'cron', 'USAGE') then return false; end if;
  if exists (
    select 1 from cron.job where jobname='portal-chat-retention'
      and command='select private.prune_chat_messages()' and active
      and (not use_socket or nodename='')
  ) then return true; end if;
  job_number := cron.schedule('portal-chat-retention', '*/5 * * * *', 'select private.prune_chat_messages()');
  if use_socket then update cron.job set nodename='' where jobid=job_number; end if;
  return true;
end;
$$;

create function public.chat_retention_policy(p_room_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select private.chat_retention_policy(p_room_id);
$$;
create function public.set_chat_retention_policy(p_room_id uuid, p_hours integer, p_expected_version integer)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.set_chat_retention_policy(p_room_id, p_hours, p_expected_version);
$$;
revoke all on function private.can_set_chat_retention(uuid), private.prune_chat_messages(),
  private.ensure_chat_retention_schedule(), private.chat_retention_policy(uuid), public.chat_retention_policy(uuid),
  private.set_chat_retention_policy(uuid,integer,integer), public.set_chat_retention_policy(uuid,integer,integer)
  from public, anon, authenticated, service_role;
grant execute on function private.chat_retention_policy(uuid), public.chat_retention_policy(uuid),
  private.set_chat_retention_policy(uuid,integer,integer), public.set_chat_retention_policy(uuid,integer,integer)
  to authenticated;

select private.ensure_chat_retention_schedule();
notify pgrst, 'reload schema';
commit;
