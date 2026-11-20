begin;

-- Color choices are personal presentation data. They are private per Auth UUID
-- and cannot be read or changed by another account, including administrators.
create table private.calendar_color_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  personal_event_color text not null,
  assignment_event_color text not null,
  customer_event_color text not null,
  version integer not null check (version > 0),
  updated_at timestamptz not null default now(),
  constraint calendar_color_preferences_palette check (
    personal_event_color in (
      '#DCE9F8', '#E1EDDA', '#FFF0C5', '#F8E2D3',
      '#E6E0F0', '#F5DDE7', '#DFE6EA'
    ) and assignment_event_color in (
      '#DCE9F8', '#E1EDDA', '#FFF0C5', '#F8E2D3',
      '#E6E0F0', '#F5DDE7', '#DFE6EA'
    ) and customer_event_color in (
      '#DCE9F8', '#E1EDDA', '#FFF0C5', '#F8E2D3',
      '#E6E0F0', '#F5DDE7', '#DFE6EA'
    )
  )
);
revoke all on private.calendar_color_preferences
  from public, anon, authenticated, service_role;

-- The only default values live in this getter; returning version zero signals
-- that the actor has not yet saved a private preference row.
create function private.get_my_calendar_color_preferences()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  preferences private.calendar_color_preferences%rowtype;
begin
  if not private.actor_active() then
    raise exception 'Active account required' using errcode = '42501';
  end if;
  select * into preferences
  from private.calendar_color_preferences
  where user_id = auth.uid();
  if not found then
    return jsonb_build_object(
      'personal_event_color', '#E1EDDA',
      'assignment_event_color', '#DCE9F8',
      'customer_event_color', '#FFF0C5',
      'version', 0
    );
  end if;
  return jsonb_build_object(
    'personal_event_color', preferences.personal_event_color,
    'assignment_event_color', preferences.assignment_event_color,
    'customer_event_color', preferences.customer_event_color,
    'version', preferences.version
  );
end;
$$;

-- Compare-and-set the caller's own palette. Fixed light swatches keep event
-- text readable in both global themes and avoid arbitrary low-contrast colors.
create function private.save_my_calendar_color_preferences(
  p_expected_version integer,
  p_personal_event_color text,
  p_assignment_event_color text,
  p_customer_event_color text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  preferences private.calendar_color_preferences%rowtype;
  palette constant text[] := array[
    '#DCE9F8', '#E1EDDA', '#FFF0C5', '#F8E2D3',
    '#E6E0F0', '#F5DDE7', '#DFE6EA'
  ];
begin
  if not private.actor_active() then
    raise exception 'Active account required' using errcode = '42501';
  end if;
  if p_expected_version is null or p_expected_version < 0 or
     p_personal_event_color is null or p_assignment_event_color is null or
     p_customer_event_color is null or
     not (p_personal_event_color = any(palette)) or
     not (p_assignment_event_color = any(palette)) or
     not (p_customer_event_color = any(palette)) then
    raise exception 'Invalid calendar color preferences' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('calendar-colors:' || auth.uid()::text, 0)
  );
  select * into preferences
  from private.calendar_color_preferences
  where user_id = auth.uid()
  for update;
  if not found then
    if p_expected_version <> 0 then
      raise exception 'Calendar color preference version conflict' using errcode = '40001';
    end if;
    insert into private.calendar_color_preferences(
      user_id, personal_event_color, assignment_event_color,
      customer_event_color, version
    ) values (
      auth.uid(), p_personal_event_color, p_assignment_event_color,
      p_customer_event_color, 1
    );
  else
    if preferences.version <> p_expected_version then
      raise exception 'Calendar color preference version conflict' using errcode = '40001';
    end if;
    update private.calendar_color_preferences set
      personal_event_color = p_personal_event_color,
      assignment_event_color = p_assignment_event_color,
      customer_event_color = p_customer_event_color,
      version = version + 1,
      updated_at = now()
    where user_id = auth.uid();
  end if;
  return private.get_my_calendar_color_preferences();
end;
$$;

create function public.get_my_calendar_color_preferences()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$ select private.get_my_calendar_color_preferences(); $$;

create function public.save_my_calendar_color_preferences(
  p_expected_version integer,
  p_personal_event_color text,
  p_assignment_event_color text,
  p_customer_event_color text
) returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.save_my_calendar_color_preferences(
    p_expected_version, p_personal_event_color,
    p_assignment_event_color, p_customer_event_color
  );
$$;

revoke all on function private.get_my_calendar_color_preferences()
  from public, anon, authenticated, service_role;
revoke all on function private.save_my_calendar_color_preferences(integer, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function private.get_my_calendar_color_preferences() to authenticated;
grant execute on function private.save_my_calendar_color_preferences(integer, text, text, text)
  to authenticated;
revoke all on function public.get_my_calendar_color_preferences() from public, anon;
revoke all on function public.save_my_calendar_color_preferences(integer, text, text, text)
  from public, anon;
grant execute on function public.get_my_calendar_color_preferences() to authenticated;
grant execute on function public.save_my_calendar_color_preferences(integer, text, text, text)
  to authenticated;

notify pgrst, 'reload schema';
commit;