begin;

-- Public-facing IDs are display references only. Auth UUIDs, foreign keys and
-- every existing account relationship remain unchanged; account access still
-- depends on the current actor and resource permissions.
alter table public.profiles add column luminovia_user_id text;

-- Generate an 80-bit random, grouped hexadecimal reference for each new profile.
-- Once assigned, the value is immutable; the unique index remains the final
-- concurrency guard if two random candidates were ever to collide.
create function private.assign_luminovia_user_id()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate text;
  uuid_hex text;
  random_hex text;
begin
  if tg_op = 'UPDATE' then
    if old.luminovia_user_id is not null then
      if new.luminovia_user_id is distinct from old.luminovia_user_id then
        raise exception 'Luminovia User ID is immutable' using errcode = '23514';
      end if;
      return new;
    end if;
  end if;

  if new.luminovia_user_id is null then
    loop
      uuid_hex := replace(pg_catalog.gen_random_uuid()::text, '-', '');
      -- Skip the UUID version and variant bits so all 20 ID digits are random.
      random_hex := substr(uuid_hex, 1, 12) || substr(uuid_hex, 14, 3) ||
        substr(uuid_hex, 18, 5);
      candidate := 'LV-' || upper(
        substr(random_hex, 1, 4) || '-' ||
        substr(random_hex, 5, 4) || '-' ||
        substr(random_hex, 9, 4) || '-' ||
        substr(random_hex, 13, 4) || '-' ||
        substr(random_hex, 17, 4)
      );
      exit when not exists (
        select 1 from public.profiles p
        where p.luminovia_user_id = candidate
      );
    end loop;
    new.luminovia_user_id := candidate;
  end if;
  return new;
end;
$$;
revoke all on function private.assign_luminovia_user_id()
  from public, anon, authenticated, service_role;

create trigger profiles_assign_luminovia_user_id
before insert or update of luminovia_user_id on public.profiles
for each row execute function private.assign_luminovia_user_id();

-- Backfill every retained profile under the same generator before requiring
-- the value. The migration's table lock serializes concurrent profile inserts.
update public.profiles
set luminovia_user_id = null
where luminovia_user_id is null;

alter table public.profiles
  alter column luminovia_user_id set not null,
  add constraint profiles_luminovia_user_id_format check (
    luminovia_user_id ~ '^LV-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$'
  );
create unique index profiles_luminovia_user_id_unique
  on public.profiles(luminovia_user_id);
comment on column public.profiles.luminovia_user_id is
  'Stable random display reference; not an Auth identity, credential, or authorization token.';

-- Extend only the existing MFA-protected account directory. Its bounded search,
-- permission check and pagination are unchanged; no public ID lookup is added.
create or replace function private.account_users(
  p_search text default '', p_limit integer default 50, p_offset integer default 0
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.has_permission('users.manage') then
    raise exception 'users.manage required' using errcode = '42501';
  end if;
  if p_search is null or length(p_search) > 120 or p_limit is null or
     p_offset is null or p_limit not between 1 and 100 or
     p_offset not between 0 and 100000 then
    raise exception 'Invalid pagination' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(to_jsonb(record_data))
      from (
        select p.id, p.luminovia_user_id, p.display_name, p.active,
          p.locale, p.time_zone, p.created_at, u.email,
          private.account_role_target_manageable(p.id) can_assign_roles,
          private.account_role_target_manageable(p.id) can_change_active,
          coalesce((
            select jsonb_agg(ur.role order by ur.role)
            from public.user_roles ur where ur.user_id = p.id
          ), '[]'::jsonb) roles
        from public.profiles p
        join auth.users u on u.id = p.id
        where position(lower(p_search) in lower(p.display_name)) > 0 or
          position(lower(p_search) in lower(coalesce(u.email, ''))) > 0
        order by p.display_name, p.id
        limit p_limit offset p_offset
      ) record_data
    ), '[]'::jsonb),
    'total', (
      select count(*)
      from public.profiles p
      join auth.users u on u.id = p.id
      where position(lower(p_search) in lower(p.display_name)) > 0 or
        position(lower(p_search) in lower(coalesce(u.email, ''))) > 0
    ),
    'limit', p_limit,
    'offset', p_offset
  );
end;
$$;

-- The ordinary people directory remains permission-filtered and returns the
-- human ID only alongside the profile data the current caller may already see.
create or replace function private.people_directory(
  p_search text default '', p_label text default '', p_topic_id uuid default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.actor_active() then
    raise exception 'Active account required' using errcode = '42501';
  end if;
  if length(coalesce(p_search, '')) > 100 or
     length(coalesce(p_label, '')) > 40 then
    raise exception 'Invalid directory request' using errcode = '22023';
  end if;
  return coalesce((
    select jsonb_agg(to_jsonb(x) order by x.display_name, x.id)
    from (
      select p.id, p.luminovia_user_id, p.display_name, p.bio_de, p.bio_en,
        p.time_zone, coalesce(d.country, '') country,
        coalesce(d.languages, '{}'::text[]) languages,
        coalesce(d.labels, '{}'::text[]) labels,
        case when private.profile_topics_visible(p.id) then coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id, 'label_de', t.label_de, 'label_en', t.label_en,
            'kind', t.kind,
            'verified', lt.verified and
              (lt.valid_until is null or lt.valid_until > now())
          ))
          from public.lecturer_topics lt
          join public.topics t on t.id = lt.topic_id
          where lt.user_id = p.id
        ), '[]'::jsonb) else '[]'::jsonb end topics,
        stats.rating_average, stats.review_count
      from public.profiles p
      left join public.profile_details d on d.user_id = p.id
      cross join lateral private.profile_rating_summary(p.id) stats
      where private.profile_staff(p.id) and private.can_read_person(p.id) and
        (coalesce(p_search, '') = '' or
          p.display_name ilike '%' || p_search || '%' or
          p.bio_de ilike '%' || p_search || '%' or
          p.bio_en ilike '%' || p_search || '%') and
        (coalesce(p_label, '') = '' or exists (
          select 1 from unnest(d.labels) l
          where lower(l) = lower(trim(p_label))
        )) and
        (p_topic_id is null or (
          private.profile_topics_visible(p.id) and exists (
            select 1 from public.lecturer_topics lt
            where lt.user_id = p.id and lt.topic_id = p_topic_id
          )
        ))
      order by p.display_name, p.id
      limit 200
    ) x
  ), '[]'::jsonb);
end;
$$;

-- A selected person's profile keeps the existing authorization gate; the
-- stable reference is not used to resolve or authorize the requested UUID.
create or replace function private.person_profile(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if not private.can_read_person(p_user_id) then
    raise exception 'Profile access denied' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'id', p.id,
    'luminovia_user_id', p.luminovia_user_id,
    'display_name', p.display_name,
    'bio_de', p.bio_de,
    'bio_en', p.bio_en,
    'time_zone', p.time_zone,
    'country', coalesce(d.country, ''),
    'languages', coalesce(d.languages, '{}'::text[]),
    'labels', coalesce(d.labels, '{}'::text[]),
    'teaching_experience', coalesce(d.teaching_experience, ''),
    'can_moderate', private.has_permission('reviews.manage'),
    'topics', case when private.profile_topics_visible(p.id) then coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'label_de', t.label_de, 'label_en', t.label_en,
        'kind', t.kind,
        'verified', lt.verified and
          (lt.valid_until is null or lt.valid_until > now())
      ))
      from public.lecturer_topics lt
      join public.topics t on t.id = lt.topic_id
      where lt.user_id = p.id
    ), '[]'::jsonb) else '[]'::jsonb end
  ) into result
  from public.profiles p
  left join public.profile_details d on d.user_id = p.id
  where p.id = p_user_id and p.active;
  if result is null then
    raise exception 'Profile access denied' using errcode = '42501';
  end if;
  return result;
end;
$$;

commit;