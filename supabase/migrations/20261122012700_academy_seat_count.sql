begin;

-- Serialize count-changing operations across all administrators. Updating an
-- actual row also rejects stale repeatable-read transactions with 40001.
create table private.academy_seat_revision (
  singleton boolean primary key default true check (singleton),
  revision bigint not null default 0
);
insert into private.academy_seat_revision default values;
alter table private.academy_seat_revision enable row level security;
revoke all on private.academy_seat_revision from public, anon, authenticated, service_role;

create function private.lock_academy_account_seats()
returns void language plpgsql security invoker set search_path = '' as $$
begin
  -- Acquire locks in this order even during compensation after expiry.
  perform 1 from private.installation_identity where singleton for share;
  update private.academy_seat_revision set revision = revision + 1 where singleton;
  if not found then raise insufficient_privilege; end if;
end;
$$;

create function private.lock_academy_seat_administration(p_actor uuid)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  perform private.lock_academy_course_access();
  if not private.academy_administration_actor(p_actor) then
    raise insufficient_privilege;
  end if;
  perform private.lock_academy_account_seats();
  perform private.lock_academy_administration(p_actor);
end;
$$;

create function private.academy_seat_request_matches(
  p_request private.academy_account_requests, p_user_id uuid, p_email text, p_created_at timestamptz
)
returns boolean language sql immutable security invoker set search_path = '' as $$
  select case when p_request.user_id is not null then p_request.user_id = p_user_id
    else coalesce(lower(p_email) = p_request.email and p_created_at >= p_request.created_at, false)
  end;
$$;

create function private.academy_seat_usage()
returns table (seat_limit bigint, occupied bigint)
language sql stable security invoker set search_path = '' as $$
  with role_holders as materialized (
    select identity.id, identity.email, identity.created_at
    from auth.users identity
    join public.profiles profile on profile.id = identity.id
    where profile.active and exists (select 1 from public.user_roles role where role.user_id = identity.id)
  )
  select (licence.terms->'limits'->>'seat_count')::bigint,
    (select count(*) from role_holders) +
    (select count(*) from private.academy_account_requests request
      where request.installation_id = pinned.installation_id
        and request.status in ('reserved', 'cleanup')
        and not exists (
          select 1 from role_holders account
          where private.academy_seat_request_matches(request, account.id, account.email, account.created_at)
        ))
  from private.installation_identity pinned
  join private.installation_verified_licence licence using (installation_id)
  where pinned.singleton and pinned.edition <> 'internal';
$$;

-- The caller already holds the seat revision lock. A pending exact-identity
-- hold still represents the same seat if that account becomes active.
create function private.require_academy_seat(p_reactivate_user_id uuid default null)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  usage record;
begin
  select * into usage from private.academy_seat_usage();
  if not found or usage.seat_limit is null then raise insufficient_privilege; end if;
  if usage.occupied >= usage.seat_limit and not (
    p_reactivate_user_id is not null and exists (
      select 1 from private.installation_identity pinned
      join private.academy_account_requests request using (installation_id)
      join auth.users identity on identity.id = p_reactivate_user_id
      where pinned.singleton and request.status in ('reserved', 'cleanup')
        and private.academy_seat_request_matches(request, identity.id, identity.email, identity.created_at)
    )
  ) then
    raise exception 'Licensed academy seats are occupied'
      using errcode = 'PT409', detail = 'academy_seat_limit';
  end if;
end;
$$;

revoke all on function private.lock_academy_account_seats(),
  private.lock_academy_seat_administration(uuid),
  private.academy_seat_request_matches(private.academy_account_requests, uuid, text, timestamptz),
  private.academy_seat_usage(),
  private.require_academy_seat(uuid)
from public, anon, authenticated, service_role;

-- Keep the existing security-definer bodies and their request, authority and
-- retry checks. Fail the migration if any expected insertion point has drifted.
do $migration$
declare
  patch record;
  source text;
begin
  for patch in
    select * from (values
      ('private.reserve_academy_account(uuid,text,text,text,uuid,text)'::regprocedure,
        '  perform private.lock_academy_administration(actor);',
        '  perform private.lock_academy_seat_administration(actor);'),
      ('private.reserve_academy_account(uuid,text,text,text,uuid,text)'::regprocedure,
        '  insert into private.academy_account_requests(',
        E'  perform private.require_academy_seat();\n  insert into private.academy_account_requests('),
      ('private.finish_academy_account(uuid,uuid,text)'::regprocedure,
        '    perform private.lock_academy_administration(request.actor_id);',
        '    perform private.lock_academy_seat_administration(request.actor_id);'),
      ('private.finish_academy_account(uuid,uuid,text)'::regprocedure,
        '  select * into request from private.academy_account_requests where id = p_creation_id for update;',
        E'  if p_decision <> ''complete'' then\n    perform private.lock_academy_account_seats();\n  end if;\n  select * into request from private.academy_account_requests where id = p_creation_id for update;'),
      ('private.academy_set_member_active(uuid,boolean,boolean)'::regprocedure,
        '  perform private.lock_academy_administration(actor);',
        '  perform private.lock_academy_seat_administration(actor);'),
      ('private.academy_set_member_active(uuid,boolean,boolean)'::regprocedure,
        '    update public.profiles set active = p_active where id = p_user_id;',
        E'    if p_active then\n      perform private.require_academy_seat(p_user_id);\n    end if;\n    update public.profiles set active = p_active where id = p_user_id;'),
      ('private.bootstrap_academy_first_administrator(uuid,text,uuid)'::regprocedure,
        '  lock table auth.users, public.profiles, public.user_roles in share row exclusive mode;',
        E'  perform private.lock_academy_account_seats();\n  lock table auth.users, public.profiles, public.user_roles in share row exclusive mode;'),
      ('private.bootstrap_academy_first_administrator(uuid,text,uuid)'::regprocedure,
        '  insert into public.user_roles(user_id, role) values (p_administrator_id, ''admin'');',
        E'  perform private.require_academy_seat();\n  insert into public.user_roles(user_id, role) values (p_administrator_id, ''admin'');')
    ) as changes(routine, anchor, replacement)
  loop
    source := pg_get_functiondef(patch.routine);
    if length(source) - length(replace(source, patch.anchor, '')) <> length(patch.anchor) then
      raise exception 'Could not apply academy seat protection to %', patch.routine;
    end if;
    execute replace(source, patch.anchor, patch.replacement);
  end loop;
end;
$migration$;

commit;
