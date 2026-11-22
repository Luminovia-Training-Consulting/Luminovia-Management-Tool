begin;

-- Future teaching access is independent of the accepted commercial snapshot.
-- Keep the revision even after a release, so an old request cannot re-block.
create table private.company_lecturer_blocks (
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  lecturer_id uuid not null references public.profiles(id) on delete cascade,
  blocked boolean not null,
  version integer not null check (version > 0),
  primary key (organisation_id, lecturer_id)
);
alter table private.company_lecturer_blocks enable row level security;
revoke all on private.company_lecturer_blocks from public, anon, authenticated, service_role;

create function private.company_lecturer_blocked(p_organisation_id uuid, p_lecturer_id uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists (
    select 1 from private.company_lecturer_blocks restriction
    where restriction.organisation_id = p_organisation_id and restriction.lecturer_id = p_lecturer_id
      and restriction.blocked
  );
$$;

create function private.course_lecturer_blocked(p_course_id uuid, p_lecturer_id uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists (
    select 1 from public.course_runs run where run.id = p_course_id
      and private.company_lecturer_blocked(run.organisation_id, p_lecturer_id)
  );
$$;

-- Only relational company associations count. A free-text customer name can
-- describe an unrelated employer with an identical name.
create function private.job_lecturer_blocked(p_job_id uuid, p_lecturer_id uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists (
    select 1 from public.jobs job where job.id = p_job_id
      and private.course_lecturer_blocked(job.course_run_id, p_lecturer_id)
    union all
    select 1 from private.job_commission_offers offer where offer.job_id = p_job_id
      and private.company_lecturer_blocked(offer.organisation_id, p_lecturer_id)
    union all
    select 1 from private.client_course_requests request where request.job_id = p_job_id
      and private.company_lecturer_blocked(request.organisation_id, p_lecturer_id)
  );
$$;

create function private.company_has_lecturer_history(p_organisation_id uuid, p_lecturer_id uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists (
    select 1 from public.job_claims claim
    join public.jobs job on job.id = claim.job_id
    left join public.course_runs run on run.id = job.course_run_id
    left join private.job_commission_offers offer on offer.job_id = job.id
    left join private.client_course_requests request on request.job_id = job.id
    where claim.lecturer_id = p_lecturer_id
      and p_organisation_id in (run.organisation_id, offer.organisation_id, request.organisation_id)
      and (run.organisation_id is null or run.organisation_id = p_organisation_id)
      and (offer.organisation_id is null or offer.organisation_id = p_organisation_id)
      and (request.organisation_id is null or request.organisation_id = p_organisation_id)
  );
$$;

create function private.company_lecturer_block_scope(p_organisation_id uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select private.actor_active() and exists (
    select 1 from public.organisations org where org.id = p_organisation_id and org.archived_at is null
  ) and (private.has_permission('organisations.manage') or private.client_has_organisation(p_organisation_id));
$$;

create function private.company_lecturer_blocks(p_organisation_id uuid, p_search text default '')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  internal_edition boolean := (select edition from private.installation_identity) = 'internal';
  licence text := private.academy_course_access_status();
  manager boolean := private.has_permission('organisations.manage');
  max_rows constant integer := 40;
begin
  if not private.company_lecturer_block_scope(p_organisation_id)
     or (not internal_edition and not coalesce(licence in ('active', 'grace'), false)) then
    raise insufficient_privilege;
  end if;
  if p_search is null or char_length(p_search) > 120 then raise invalid_parameter_value; end if;
  return (
    with matches as (
      select profile.id as lecturer_id, profile.display_name,
        coalesce(restriction.blocked, false) as blocked,
        coalesce(restriction.version, 0) as version
      from public.profiles profile
      left join private.company_lecturer_blocks restriction
        on restriction.organisation_id = p_organisation_id and restriction.lecturer_id = profile.id
      where (coalesce(restriction.blocked, false) or (
        private.lecturer_user(profile.id) and (
          manager or private.company_has_lecturer_history(p_organisation_id, profile.id)
        )
      )) and position(lower(btrim(p_search)) in lower(profile.display_name)) > 0
      order by blocked desc, profile.display_name, profile.id
      limit max_rows + 1
    ), visible as (
      select * from matches order by blocked desc, display_name, lecturer_id limit max_rows
    )
    select jsonb_build_object(
      'organisation_id', p_organisation_id,
      'can_write', internal_edition or licence = 'active',
      'rows', coalesce((
        select jsonb_agg(to_jsonb(visible) order by blocked desc, display_name, lecturer_id) from visible
      ), '[]'::jsonb),
      'more', (select count(*) from matches) > max_rows
    )
  );
end;
$$;

create function private.set_company_lecturer_block(
  p_organisation_id uuid, p_lecturer_id uuid, p_blocked boolean, p_expected_version integer
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  target_name text;
  prior private.company_lecturer_blocks%rowtype;
  current_version integer;
begin
  if p_organisation_id is null or p_lecturer_id is null or p_blocked is null
     or p_expected_version is null or p_expected_version < 0 then raise invalid_parameter_value; end if;
  if not private.company_lecturer_block_scope(p_organisation_id) then raise insufficient_privilege; end if;
  if (select edition from private.installation_identity) <> 'internal' then
    perform private.lock_academy_course_access();
  end if;

  perform 1 from public.profiles where id in (actor, p_lecturer_id) order by id for share;
  perform 1 from public.user_roles where user_id in (actor, p_lecturer_id) order by user_id, role for share;
  perform 1 from public.client_organisation_memberships
    where user_id = actor and organisation_id = p_organisation_id for share;
  perform 1 from public.organisations where id = p_organisation_id for share;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_lecturer_id::text, 0));
  if not private.company_lecturer_block_scope(p_organisation_id) then raise insufficient_privilege; end if;

  select * into prior from private.company_lecturer_blocks restriction
  where restriction.organisation_id = p_organisation_id and restriction.lecturer_id = p_lecturer_id;
  if not (coalesce(prior.blocked, false) or (prior.version is not null and not p_blocked)) and not (
    private.lecturer_user(p_lecturer_id) and (
      private.has_permission('organisations.manage') or
      private.company_has_lecturer_history(p_organisation_id, p_lecturer_id)
    )
  ) then raise insufficient_privilege; end if;
  select profile.display_name into strict target_name from public.profiles profile where profile.id = p_lecturer_id;
  current_version := coalesce(prior.version, 0);

  if current_version <> p_expected_version then
    if current_version::bigint <> p_expected_version::bigint + 1 or prior.blocked is distinct from p_blocked then
      raise exception 'The company lecturer block has changed' using errcode = 'PT409';
    end if;
  elsif coalesce(prior.blocked, false) <> p_blocked then
    current_version := current_version + 1;
    insert into private.company_lecturer_blocks(organisation_id, lecturer_id, blocked, version)
      values (p_organisation_id, p_lecturer_id, p_blocked, current_version)
    on conflict (organisation_id, lecturer_id) do update
      set blocked = excluded.blocked, version = excluded.version;
    insert into public.audit_events(actor_id, action, resource_id, details)
      values (actor, case when p_blocked then 'company.lecturer_blocked' else 'company.lecturer_unblocked' end,
        p_lecturer_id, jsonb_build_object('organisation_id', p_organisation_id, 'version', current_version));
  end if;
  return jsonb_build_object('lecturer_id', p_lecturer_id, 'display_name', target_name,
    'blocked', p_blocked, 'version', current_version);
end;
$$;

create function public.company_lecturer_blocks(p_organisation_id uuid, p_search text default '')
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.company_lecturer_blocks(p_organisation_id, p_search);
$$;
create function public.set_company_lecturer_block(
  p_organisation_id uuid, p_lecturer_id uuid, p_blocked boolean, p_expected_version integer
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.set_company_lecturer_block(p_organisation_id, p_lecturer_id, p_blocked, p_expected_version);
$$;

create function private.academy_lecturer_block_organisations()
returns table(id uuid, name text) language sql stable security definer set search_path = '' as $$
  select org.id, org.name from public.organisations org
  where private.academy_course_access_status() in ('active', 'grace')
    and private.company_lecturer_block_scope(org.id)
  order by org.name, org.id;
$$;
create function public.academy_lecturer_block_organisations()
returns table(id uuid, name text) language sql stable security invoker set search_path = '' as $$
  select * from private.academy_lecturer_block_organisations();
$$;

revoke all on function private.company_lecturer_blocked(uuid,uuid), private.course_lecturer_blocked(uuid,uuid),
  private.job_lecturer_blocked(uuid,uuid), private.company_has_lecturer_history(uuid,uuid),
  private.company_lecturer_block_scope(uuid), private.company_lecturer_blocks(uuid,text),
  private.set_company_lecturer_block(uuid,uuid,boolean,integer),
  public.company_lecturer_blocks(uuid,text), public.set_company_lecturer_block(uuid,uuid,boolean,integer),
  private.academy_lecturer_block_organisations(), public.academy_lecturer_block_organisations()
  from public, anon, authenticated, service_role;
grant execute on function private.company_lecturer_blocks(uuid,text), public.company_lecturer_blocks(uuid,text),
  private.set_company_lecturer_block(uuid,uuid,boolean,integer),
  public.set_company_lecturer_block(uuid,uuid,boolean,integer),
  private.academy_lecturer_block_organisations(), public.academy_lecturer_block_organisations() to authenticated;

-- Recheck in the write transaction, including new callers that use the same
-- allocation table. An existing claim can still be settled or cancelled.
create function private.guard_company_lecturer_block_on_claim()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status <> 'confirmed' then return new; end if;
  if tg_op = 'UPDATE' and (old.job_id, old.lecturer_id, old.status)
      is not distinct from (new.job_id, new.lecturer_id, new.status) then return new; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.lecturer_id::text, 0));
  if private.job_lecturer_blocked(new.job_id, new.lecturer_id) then raise insufficient_privilege; end if;
  return new;
end;
$$;
revoke all on function private.guard_company_lecturer_block_on_claim() from public, anon, authenticated, service_role;
create trigger company_lecturer_block_on_claim before insert or update of job_id, lecturer_id, status
  on public.job_claims for each row execute function private.guard_company_lecturer_block_on_claim();

-- Change the lecturer branches that already own these reads. Keep independent
-- company, learner and management rights on a multi-role account.
create or replace function private.can_read_job(p_job_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.actor_active() and exists (
    select 1 from public.jobs job where job.id = p_job_id and (
      private.has_permission('jobs.manage') or (
        private.lecturer_actor() and not private.job_lecturer_blocked(job.id, auth.uid()) and (
          job.status = 'published' or exists (
            select 1 from public.job_claims claim where claim.job_id = job.id and claim.lecturer_id = auth.uid()
          )
        )
      )
    )
  );
$$;

create or replace function private.can_read_course_run(p_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.actor_active() and (
    private.has_permission('courses.manage') or (
      private.lecturer_actor() and not private.course_lecturer_blocked(p_id, auth.uid()) and (
        exists (select 1 from public.course_runs run where run.id = p_id and run.published and run.archived_at is null)
        or private.course_has_current_teacher(p_id)
      )
    ) or exists (
      select 1 from public.chat_rooms room where room.kind = 'participant_course' and room.course_run_id = p_id
        and private.can_access_chat_room(room.id)
    )
  );
$$;

create function private.lecturer_calendar_claim_allowed(p_claim_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.lecturer_actor() and exists (
    select 1 from public.job_claims claim where claim.id = p_claim_id and claim.lecturer_id = auth.uid()
      and not private.job_lecturer_blocked(claim.job_id, auth.uid())
  );
$$;
revoke all on function private.lecturer_calendar_claim_allowed(uuid) from public, anon, authenticated, service_role;
grant execute on function private.lecturer_calendar_claim_allowed(uuid) to authenticated;
alter policy allocations_read on public.assignment_sessions using (
  lecturer_id = (select auth.uid()) and private.lecturer_calendar_claim_allowed(claim_id)
);

-- Use the current eligibility responses on requests that have not yet created a
-- receipt. These existing transactions already share the lecturer lock.
do $migration$
declare
  patch record;
  definition text;
begin
  for patch in select * from (values
    ('private.course_has_current_teacher(uuid)'::regprocedure,
      'then private.lecturer_user(auth.uid()) and exists (',
      'then private.lecturer_user(auth.uid()) and not private.course_lecturer_blocked(p_course_id, auth.uid()) and exists ('),
    ('private.academy_course_teacher(uuid,uuid)'::regprocedure,
      'select private.lecturer_user(p_teacher_id) and exists (',
      'select private.lecturer_user(p_teacher_id) and not private.course_lecturer_blocked(p_course_id, p_teacher_id) and exists ('),
    ('private.claim_job_before_personal_compensation(uuid,uuid,integer)'::regprocedure,
      'if private.company_rejected_lecturer(p_job_id,actor) then',
      'if private.job_lecturer_blocked(p_job_id,actor) or private.company_rejected_lecturer(p_job_id,actor) then'),
    ('private.assignment_replacement_eligibility(uuid,uuid,uuid)'::regprocedure,
      'if private.company_rejected_lecturer(p_job,p_user) then',
      'if private.job_lecturer_blocked(p_job,p_user) or private.company_rejected_lecturer(p_job,p_user) then'),
    ('private.replacement_eligible(uuid,uuid)'::regprocedure,
      'and private.company_rejected_lecturer(c.job_id,p_user)',
      'and (private.job_lecturer_blocked(c.job_id,p_user) or private.company_rejected_lecturer(c.job_id,p_user))'),
    ('private.academy_assign_course_instructor_before_access(uuid,uuid,uuid)'::regprocedure,
      '  course := private.academy_assignment_course(p_course_id);',
      '  course := private.academy_assignment_course(p_course_id);' || chr(10) ||
      '  if private.company_lecturer_blocked(course.organisation_id, p_instructor_id) and not exists (' ||
      'select 1 from private.academy_course_instructors previous where previous.assigned_by = actor_id and previous.request_id = p_request_id' ||
      ') then return jsonb_build_object(''status'', ''not_eligible''); end if;'),
    ('private.academy_course_instructor_candidates(uuid,text)'::regprocedure,
      'where p.active and private.lecturer_user(p.id) and strpos',
      'where p.active and private.lecturer_user(p.id) and not private.course_lecturer_blocked(p_course_id, p.id) and strpos'),
    ('private.can_access_chat_room(uuid)'::regprocedure,
      '(private.lecturer_actor() and exists (',
      '(private.lecturer_actor() and not private.course_lecturer_blocked(run.id, auth.uid()) and exists ('),
    ('private.can_access_chat_room(uuid)'::regprocedure,
      'else private.actor_active() end',
      'else private.actor_active() and (room.job_id is null or private.has_permission(''jobs.manage'') or' ||
      ' not private.job_lecturer_blocked(room.job_id, auth.uid())) end'),
    ('private.assignment_job_titles(uuid[])'::regprocedure,
      'where private.lecturer_actor()and j.id=any(p_job_ids)',
      'where private.lecturer_actor() and not private.job_lecturer_blocked(j.id,auth.uid()) and j.id=any(p_job_ids)'),
    ('private.assignment_calendar_metadata(uuid[])'::regprocedure,
      'where private.lecturer_actor() and j.id=any(p_job_ids)',
      'where private.lecturer_actor() and not private.job_lecturer_blocked(j.id,auth.uid()) and j.id=any(p_job_ids)'),
    ('private.calendar_subscription_snapshot(text)'::regprocedure,
      'where c.lecturer_id=s.user_id and a.lecturer_id=s.user_id',
      'where c.lecturer_id=s.user_id and a.lecturer_id=s.user_id and not private.job_lecturer_blocked(j.id,s.user_id)'),
    ('private.job_waitlist(uuid)'::regprocedure,
      'if j.id is null or (not joined',
      'if j.id is null or private.job_lecturer_blocked(p_job_id,auth.uid()) or (not joined'),
    ('private.matching_job_lecturers(uuid)'::regprocedure,
      'where j.first_start > clock_timestamp()',
      'where j.first_start > clock_timestamp() and not private.job_lecturer_blocked(j.id,p.id)'),
    ('private.notification_currently_visible(text,uuid)'::regprocedure,
      'when private.actor_active() then',
      'when p_kind in (''job_matching'', ''job_reopened'', ''job_waitlist_available'')' ||
      ' and private.job_lecturer_blocked(p_resource,auth.uid()) then false' || chr(10) ||
      '    when private.actor_active() then')
  ) as patches(routine, anchor, replacement) loop
    definition := pg_catalog.pg_get_functiondef(patch.routine);
    if cardinality(string_to_array(definition, patch.anchor)) <> 2 then
      raise exception 'Expected one company lecturer scope in %', patch.routine;
    end if;
    execute replace(definition, patch.anchor, patch.replacement);
  end loop;
end;
$migration$;

-- Keep the public path and request method exact on a dedicated Academy.
do $migration$
declare
  definition text := pg_catalog.pg_get_functiondef('private.require_academy_course_access()'::regprocedure);
  anchor constant text := '  licence_status := private.academy_course_access_status();';
begin
  if cardinality(string_to_array(definition, anchor)) <> 2 then
    raise exception 'Expected one Academy lecturer block gate';
  end if;
  execute replace(definition, anchor, anchor || $gate$
  if (licence_status in ('active', 'grace') and request_method in ('GET', 'HEAD')
      and request_path in ('/rpc/company_lecturer_blocks', '/rpc/academy_lecturer_block_organisations')) or
     (licence_status = 'active' and request_method = 'POST' and request_path = '/rpc/set_company_lecturer_block')
    then return; end if;$gate$);
end;
$migration$;

notify pgrst, 'reload schema';
commit;
