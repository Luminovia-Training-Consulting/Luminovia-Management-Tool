begin;

-- Keep a receipt after occurrence edits/deletions so a delayed retry cannot
-- recreate cancelled appointments. Only the owner can access it through the RPCs.
create table private.personal_event_series (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  request_id uuid not null,
  payload_digest bytea not null,
  created_count integer not null check (created_count between 1 and 52),
  unique (user_id, request_id),
  unique (user_id, id)
);
alter table private.personal_event_series enable row level security;
revoke all on table private.personal_event_series from public, anon, authenticated, service_role;

alter table public.personal_events
  add column recurrence_series_id uuid,
  add constraint personal_event_series_owner foreign key (user_id, recurrence_series_id)
    references private.personal_event_series (user_id, id);

create index personal_events_by_series
  on public.personal_events (user_id, recurrence_series_id, starts_at)
  where recurrence_series_id is not null;

create function private.create_my_personal_event_series(
  p_request_id uuid,
  p_title text,
  p_description text,
  p_meeting_url text,
  p_time_zone text,
  p_occurrences jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  occurrence_count integer;
  digest bytea;
  saved_series uuid;
  saved_digest bytea;
  saved_count integer;
  iso_instant constant text := '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$';
begin
  if actor is null or not private.actor_active() then raise insufficient_privilege; end if;
  if p_request_id is null
     or length(coalesce(btrim(p_title), '')) not between 1 and 200
     or p_description is null or length(p_description) > 10000
     or p_meeting_url is null
     or (p_meeting_url <> '' and not private.personal_event_https_url(p_meeting_url))
     or length(coalesce(p_time_zone, '')) not between 1 and 100
     or jsonb_typeof(p_occurrences) is distinct from 'array' then
    raise invalid_parameter_value using message = 'Invalid personal calendar series';
  end if;

  occurrence_count := jsonb_array_length(p_occurrences);
  if occurrence_count not between 1 and 52 or exists (
    select 1 from jsonb_array_elements(p_occurrences) as input(item)
    where case when jsonb_typeof(item) = 'object' then
         item - 'starts_at' - 'ends_at' <> '{}'::jsonb
         or not coalesce(item->>'starts_at' ~ iso_instant, false)
         or not coalesce(item->>'ends_at' ~ iso_instant, false)
       else true end
  ) then
    raise invalid_parameter_value using message = 'Invalid personal calendar occurrences';
  end if;

  -- Timestamps are already explicit instants. Reject schedule overlaps within
  -- this series. Existing per-appointment checks still protect assignments.
  if exists (
    select 1
    from (
      select starts_at, ends_at, lag(ends_at) over (order by starts_at) as previous_end
      from jsonb_to_recordset(p_occurrences) as event(starts_at timestamptz, ends_at timestamptz)
    ) ordered
    where ends_at <= starts_at or previous_end > starts_at
  ) then
    raise invalid_parameter_value using message = 'Personal calendar occurrences overlap or end before they start';
  end if;

  digest := sha256(convert_to(jsonb_build_array(
    btrim(p_title), p_description, p_meeting_url, p_time_zone, p_occurrences
  )::text, 'UTF8'));

  insert into private.personal_event_series (user_id, request_id, payload_digest, created_count)
  values (actor, p_request_id, digest, occurrence_count)
  on conflict (user_id, request_id) do nothing
  returning id into saved_series;

  if saved_series is null then
    select prior.id, prior.payload_digest, prior.created_count
    into strict saved_series, saved_digest, saved_count
    from private.personal_event_series prior
    where prior.user_id = actor and prior.request_id = p_request_id;
    if saved_digest <> digest then
      raise exception 'Calendar series request already used with different input' using errcode = 'PT409';
    end if;
    return jsonb_build_object('series_id', saved_series, 'created', saved_count);
  end if;

  insert into public.personal_events (user_id, title, description, meeting_url, time_zone,
    starts_at, ends_at, recurrence_series_id)
  select actor, btrim(p_title), p_description, p_meeting_url, p_time_zone,
    event.starts_at, event.ends_at, saved_series
  from jsonb_to_recordset(p_occurrences) as event(starts_at timestamptz, ends_at timestamptz)
  order by event.starts_at;

  return jsonb_build_object('series_id', saved_series, 'created', occurrence_count);
end;
$$;

create function public.create_my_personal_event_series(
  p_request_id uuid,
  p_title text,
  p_description text,
  p_meeting_url text,
  p_time_zone text,
  p_occurrences jsonb
) returns jsonb
language sql security invoker set search_path = '' as $$
  select private.create_my_personal_event_series(
    p_request_id, p_title, p_description, p_meeting_url, p_time_zone, p_occurrences
  );
$$;

create function private.cancel_my_future_personal_events(p_series_id uuid)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  deleted integer;
begin
  if actor is null or not private.actor_active() then raise insufficient_privilege; end if;
  if not exists (
    select 1 from private.personal_event_series series
    where series.user_id = actor and series.id = p_series_id
  ) then
    raise insufficient_privilege;
  end if;

  delete from public.personal_events event
  where event.user_id = actor and event.recurrence_series_id = p_series_id
    and event.starts_at > statement_timestamp();

  get diagnostics deleted = row_count;
  return deleted;
end;
$$;

create function public.cancel_my_future_personal_events(p_series_id uuid)
returns integer
language sql security invoker set search_path = '' as $$
  select private.cancel_my_future_personal_events(p_series_id);
$$;

revoke all on function
  private.create_my_personal_event_series(uuid,text,text,text,text,jsonb),
  public.create_my_personal_event_series(uuid,text,text,text,text,jsonb),
  private.cancel_my_future_personal_events(uuid),
  public.cancel_my_future_personal_events(uuid)
  from public, anon, authenticated, service_role;
grant execute on function
  private.create_my_personal_event_series(uuid,text,text,text,text,jsonb),
  public.create_my_personal_event_series(uuid,text,text,text,text,jsonb),
  private.cancel_my_future_personal_events(uuid),
  public.cancel_my_future_personal_events(uuid)
  to authenticated;

-- Account deletion reviews only the count of these owned receipts and includes
-- them in the existing dependency-ordered deletion. Other resources retain
-- their original scope.
alter function private.deletion_scope(text, uuid)
  rename to deletion_scope_before_personal_series;

create function private.deletion_scope(p_kind text, p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  scope jsonb := private.deletion_scope_before_personal_series(p_kind, p_id);
begin
  if p_kind = 'account' and exists (
    select 1 from private.personal_event_series series where series.user_id = p_id
  ) then
    return private.deletion_add_scope(scope, 'private.personal_event_series',
      format('x.user_id=%L::uuid', p_id));
  end if;
  return scope;
end;
$$;

revoke all on function private.deletion_scope_before_personal_series(text, uuid),
  private.deletion_scope(text, uuid) from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';
commit;
