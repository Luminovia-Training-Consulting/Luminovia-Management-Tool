begin;

create table private.person_ratings (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  person_id uuid not null references public.profiles(id) on delete cascade,
  stars integer not null check (stars between 1 and 5),
  comment text not null default '' check (char_length(comment) <= 2000),
  updated_at timestamptz not null default clock_timestamp(),
  unique (author_id, person_id),
  check (author_id <> person_id)
);
alter table private.person_ratings enable row level security;
revoke all on private.person_ratings from public, anon, authenticated, service_role;
create index person_ratings_recipient on private.person_ratings(person_id, updated_at desc, id desc);

-- A rating is available only between accounts already discoverable through
-- a profile or authorised chat contact. This does not grant either visibility.
create function private.can_rate_person(p_person_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles person
    where person.id = p_person_id and person.active and person.id <> auth.uid()
      and (
        private.can_read_person(person.id) or private.can_chat_contact(person.id)
        or exists (
          select 1 from public.chat_members membership
          join public.chat_rooms room on room.id = membership.room_id
          where membership.user_id = person.id and membership.removed_at is null
            and room.kind = 'participant_course'
            and private.can_access_chat_room(room.id)
            and private.current_course_chat_peer(room.course_run_id, person.id)
        )
      )
  );
$$;

create function private.person_rating(p_person_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select edition from private.installation_identity) is distinct from 'internal'
    or not private.learning_actor() then raise insufficient_privilege; end if;
  if p_person_id = auth.uid() then
    -- The recipient sees their own feedback only. Omit author identifiers even
    -- for authorised staff rather than turning this into a rating directory.
    return jsonb_build_object('stars', null, 'comment', '', 'received', coalesce((
      select jsonb_agg(jsonb_build_object('id', item.id, 'stars', item.stars, 'comment', item.comment)
        order by item.updated_at desc, item.id desc)
      from (
        select id, stars, comment, updated_at from private.person_ratings
        where person_id = p_person_id order by updated_at desc, id desc limit 30
      ) item
    ), '[]'::jsonb));
  end if;
  if not private.can_rate_person(p_person_id) then return null; end if;
  return coalesce((
    select jsonb_build_object('stars', rating.stars, 'comment', rating.comment)
    from private.person_ratings rating
    where rating.author_id = auth.uid() and rating.person_id = p_person_id
  ), jsonb_build_object('stars', null, 'comment', ''));
end;
$$;

create function private.save_person_rating(p_person_id uuid, p_stars integer, p_comment text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  author uuid := auth.uid();
  feedback text := btrim(coalesce(p_comment, ''));
begin
  if (select edition from private.installation_identity) is distinct from 'internal'
    or not private.learning_actor() or not private.can_rate_person(p_person_id) then
    raise insufficient_privilege;
  end if;
  if p_stars is null or p_stars not between 1 and 5 or char_length(feedback) > 2000 then
    raise invalid_parameter_value;
  end if;

  insert into private.person_ratings(author_id, person_id, stars, comment)
    values (author, p_person_id, p_stars, feedback)
  on conflict (author_id, person_id) do update
    set stars = excluded.stars, comment = excluded.comment, updated_at = clock_timestamp()
    where (person_ratings.stars, person_ratings.comment) is distinct from (excluded.stars, excluded.comment);
  return jsonb_build_object('stars', p_stars, 'comment', feedback);
end;
$$;

create function public.person_rating(p_person_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select private.person_rating(p_person_id);
$$;
create function public.save_person_rating(p_person_id uuid, p_stars integer, p_comment text) returns jsonb
language sql security invoker set search_path = '' as $$
  select private.save_person_rating(p_person_id,p_stars,p_comment);
$$;
revoke all on function private.can_rate_person(uuid), private.person_rating(uuid), public.person_rating(uuid),
  private.save_person_rating(uuid,integer,text), public.save_person_rating(uuid,integer,text)
  from public, anon, authenticated, service_role;
grant execute on function private.person_rating(uuid), public.person_rating(uuid),
  private.save_person_rating(uuid,integer,text), public.save_person_rating(uuid,integer,text)
  to authenticated;

-- Participant-only sessions may reach the two exact JSON endpoints. The
-- individual RPCs still verify the active actor and current peer relationship.
alter function private.require_portal_access() rename to require_portal_access_before_person_ratings;
create function private.require_portal_access()
returns void language plpgsql stable security definer set search_path = '' as $$
declare
  headers jsonb := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
begin
  if current_setting('request.path', true) in ('/rpc/person_rating', '/rpc/save_person_rating')
     and current_setting('request.method', true) = 'POST'
     and coalesce(headers->>'accept-profile', 'public') = 'public'
     and coalesce(headers->>'content-profile', 'public') = 'public'
     and private.participant_actor() then return; end if;
  perform private.require_portal_access_before_person_ratings();
end;
$$;
revoke all on function private.require_portal_access_before_person_ratings(),
  private.require_portal_access() from public, anon, authenticated, service_role;
grant execute on function private.require_portal_access() to authenticated;

alter function private.deletion_scope(text,uuid) rename to deletion_scope_before_person_ratings;
create function private.deletion_scope(p_kind text, p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  scope jsonb := private.deletion_scope_before_person_ratings(p_kind,p_id);
begin
  if p_kind <> 'account' then return scope; end if;
  return private.deletion_add_scope(scope, 'private.person_ratings',
    format('x.author_id=%1$L::uuid or x.person_id=%1$L::uuid', p_id));
end;
$$;
revoke all on function private.deletion_scope(text,uuid),
  private.deletion_scope_before_person_ratings(text,uuid) from public, anon, authenticated, service_role;
create trigger permanent_deletion_fence before insert or update or delete on private.person_ratings
  for each row execute function private.guard_permanent_deletion();

notify pgrst, 'reload schema';
commit;
