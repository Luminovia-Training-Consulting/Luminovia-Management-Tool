begin;

create table private.learning_programs (
  id uuid primary key,
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  title text not null check (length(title) between 1 and 140),
  description text not null check (length(description) <= 4000),
  sequential boolean not null,
  version integer not null default 1 check (version > 0),
  archived_at timestamptz
);
create index learning_programs_company on private.learning_programs(organisation_id, id);
create table private.learning_program_courses (
  program_id uuid not null references private.learning_programs(id) on delete cascade,
  position integer not null check (position between 1 and 30),
  course_id uuid references public.course_runs(id) on delete set null,
  title text not null,
  primary key (program_id, position),
  unique (program_id, course_id)
);
create index learning_program_courses_course on private.learning_program_courses(course_id);
create table private.learning_program_members (
  program_id uuid not null references private.learning_programs(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  enrolled_at timestamptz not null default statement_timestamp(),
  primary key (program_id, user_id)
);
create index learning_program_members_actor on private.learning_program_members(user_id, program_id);
alter table private.learning_programs enable row level security;
alter table private.learning_program_courses enable row level security;
alter table private.learning_program_members enable row level security;
revoke all on private.learning_programs, private.learning_program_courses, private.learning_program_members
  from public, anon, authenticated, service_role;

create function private.learning_program_manager(p_org uuid) returns boolean
language sql stable security invoker set search_path = '' as $$
  select private.actor_active() and
    (private.has_permission('courses.manage') or private.client_has_organisation(p_org));
$$;

-- Course enrolment and receipt state remains authoritative. A prior independent
-- enrolment can count toward the program, but subscribing to a program does not
-- grant enrolment in a locked module or restore an enrolment that was removed.
create function private.learning_program_progress(p_program uuid, p_user uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  with course_facts as (
    select item.position, item.course_id, item.title, enrolment.status,
      receipt.id as receipt_id, receipt.created_at as completed_at,
      (run.id is not null and run.published and run.archived_at is null) as available,
      (run.id is not null and receipt.id is not null
        and enrolment.status in ('enrolled', 'completed')) as completed,
      program.sequential, program.archived_at
    from private.learning_programs program
    join private.learning_program_courses item on item.program_id = program.id
    left join public.course_runs run on run.id = item.course_id
      and run.organisation_id = program.organisation_id
    left join public.course_enrolments enrolment on enrolment.course_run_id = run.id
      and enrolment.user_id = p_user
    left join private.course_completion_records receipt on receipt.run_id = run.id
      and receipt.user_id = p_user and receipt.revoked_at is null
    where program.id = p_program
  ), steps as (
    select *, coalesce(bool_and(completed is true) over
      (order by position rows between unbounded preceding and 1 preceding), true) as prior_complete
    from course_facts
  )
  select jsonb_build_object(
    'completed', count(*) filter (where completed is true),
    'total', count(*),
    'completed_at', case when count(*) > 0 and bool_and(completed is true) then max(completed_at) end,
    'steps', coalesce(jsonb_agg(jsonb_build_object(
      'course_id', course_id, 'title', title, 'receipt_id', case when completed then receipt_id end,
      'state', case
        when completed then 'completed'
        when not available or status = 'removed' then 'unavailable'
        when sequential and not prior_complete then 'locked'
        when status in ('enrolled', 'completed') then 'in_progress'
        when archived_at is null then 'ready'
        else 'unavailable'
      end,
      'can_open', available and coalesce(status in ('enrolled', 'completed'), false)
        and (completed is true or not sequential or prior_complete)
    ) order by position), '[]'::jsonb)
  ) from steps;
$$;

create function private.learning_programs(
  p_program_id uuid, p_organisation_id uuid, p_search text
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  internal boolean := (select edition = 'internal' from private.installation_identity);
  writable boolean := internal or private.academy_course_access_status() = 'active';
  search text := lower(btrim(coalesce(p_search, '')));
  selected private.learning_programs;
  company uuid := p_organisation_id;
  manager boolean := false;
  learner boolean := false;
  detail jsonb;
begin
  if not coalesce(private.learning_actor(), false) or (not internal
     and not coalesce(private.academy_course_access_status() in ('active','grace'), false)) then
    raise insufficient_privilege;
  end if;
  if length(search) > 120 then raise invalid_parameter_value; end if;
  if p_program_id is not null then
    select p.* into selected from private.learning_programs p where p.id = p_program_id;
    if not found or not private.course_lms_read_enabled(selected.organisation_id) then
      raise insufficient_privilege;
    end if;
    company := selected.organisation_id;
    manager := private.learning_program_manager(company);
    learner := private.active_company_participant(actor, company) and exists (
      select 1 from private.learning_program_members member
      where member.program_id = selected.id and member.user_id = actor
    );
    if not manager and not learner then raise insufficient_privilege; end if;

    detail := jsonb_build_object(
      'id', selected.id, 'organisation_id', company, 'title', selected.title,
      'description', selected.description, 'sequential', selected.sequential,
      'version', selected.version, 'archived', selected.archived_at is not null,
      'manage', manager, 'can_write', manager and writable,
      'can_edit', manager and writable and not exists (
        select 1 from private.learning_program_members where program_id = selected.id),
      'steps', case when manager then (
        select jsonb_agg(jsonb_build_object('course_id', s.course_id, 'title', s.title) order by s.position)
        from private.learning_program_courses s where s.program_id = selected.id) end,
      'progress', case when learner then private.learning_program_progress(selected.id, actor) end,
      'learner_name', case when learner then (select display_name from public.profiles where id = actor) end,
      'organisation_name', (select name from public.organisations where id = company),
      'roster', case when manager then coalesce((
        select jsonb_agg(r.entry order by r.name, r.id)
        from (
          select profile.display_name as name, profile.id,
            jsonb_build_object('name', profile.display_name, 'id', profile.id,
             'active', private.active_company_participant(profile.id, company),
             'progress', private.learning_program_progress(selected.id, profile.id)) as entry
          from private.learning_program_members member
          join public.profiles profile on profile.id = member.user_id
          where member.program_id = selected.id
            and (search = '' or strpos(lower(profile.display_name), search) > 0)
          order by profile.display_name, profile.id limit 100
        ) r), '[]'::jsonb) end
    );
  elsif company is not null then
    manager := private.course_lms_read_enabled(company) and private.learning_program_manager(company);
    if not manager then raise insufficient_privilege; end if;
  end if;

  return jsonb_build_object(
    'programs', coalesce((
      select jsonb_agg(to_jsonb(row_item) order by row_item.archived, row_item.title, row_item.id) from (
        select program.id, program.title, org.name as organisation_name,
          program.archived_at is not null as archived
        from private.learning_programs program
        join public.organisations org on org.id = program.organisation_id
        where private.course_lms_read_enabled(org.id) and (
          private.learning_program_manager(org.id) or (
            private.active_company_participant(actor, org.id) and exists (
              select 1 from private.learning_program_members member
              where member.program_id = program.id and member.user_id = actor
            )
          )
        )
        order by (program.archived_at is not null), program.title, program.id limit 100
      ) row_item
    ), '[]'::jsonb),
    'organisations', case when writable then coalesce((
      select jsonb_agg(to_jsonb(row_item) order by row_item.name, row_item.id)
      from (select org.id, org.name from public.organisations org
        where private.course_lms_read_enabled(org.id) and private.learning_program_manager(org.id)
        order by org.name, org.id limit 100) row_item
    ), '[]'::jsonb) else '[]'::jsonb end,
    'courses', case when manager and writable then coalesce((
      select jsonb_agg(to_jsonb(row_item) order by row_item.title, row_item.starts_at, row_item.id)
      from (
        select run.id, template.title,
          (select min(starts_at) from public.course_sessions where course_run_id = run.id) as starts_at
        from public.course_runs run
        join public.course_templates template on template.id = run.template_id
        where run.organisation_id = company and run.published and run.archived_at is null
          and (search = '' or strpos(lower(template.title), search) > 0)
        order by template.title, starts_at, run.id limit 100
      ) row_item
    ), '[]'::jsonb) else '[]'::jsonb end,
    'candidates', case when manager and writable and selected.id is not null and selected.archived_at is null then coalesce((
      select jsonb_agg(to_jsonb(row_item) order by row_item.name, row_item.id)
      from (
        select profile.id, profile.display_name as name, profile.luminovia_user_id as reference
        from private.company_participant_memberships membership
        join public.profiles profile on profile.id = membership.user_id
        where membership.organisation_id = company and membership.status = 'active'
          and private.active_company_participant(profile.id, company)
          and (search = '' or strpos(lower(profile.display_name), search) > 0
            or strpos(lower(profile.luminovia_user_id), search) > 0)
          and not exists (select 1 from private.learning_program_members member
            where member.program_id = selected.id and member.user_id = profile.id)
        order by profile.display_name, profile.id limit 100
      ) row_item
    ), '[]'::jsonb) else '[]'::jsonb end,
    'detail', detail, 'writable', writable
  );
end;
$$;

-- Share-lock the current authority and scope while the write is in flight.
-- Course rows are locked before the entitlement, like the owning enrolment writer.
create function private.lock_learning_program_scope(p_org uuid, p_actor uuid, p_participant uuid)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if (select edition = 'internal' from private.installation_identity) then
    perform private.lock_company_premium(p_org);
  else
    perform private.lock_academy_course_access();
    perform 1 from public.organisations where id = p_org and archived_at is null for share;
    if not found then raise insufficient_privilege; end if;
  end if;
  perform 1 from public.profiles where id in (p_actor, p_participant) order by id for share;
  perform 1 from public.user_roles where user_id in (p_actor, p_participant) order by user_id, role for share;
  if p_participant is not null then
    perform 1 from private.company_participant_memberships
      where organisation_id = p_org and user_id = p_participant for share;
    if not private.active_company_participant(p_participant, p_org) then raise insufficient_privilege; end if;
  end if;
  perform 1 from public.client_organisation_memberships
    where organisation_id = p_org and user_id = p_actor and removed_at is null for share;
end;
$$;

create function private.save_learning_program(
  p_program_id uuid, p_organisation_id uuid, p_title text, p_description text,
  p_sequential boolean, p_course_ids uuid[], p_archived boolean, p_expected_version integer
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  previous private.learning_programs;
  current_courses uuid[];
  title_text text := btrim(p_title);
  description_text text := btrim(p_description);
  same_content boolean;
begin
  if p_program_id is null or p_organisation_id is null or p_sequential is null or p_archived is null
    or p_expected_version is null or p_expected_version < 0
    or title_text is null or length(title_text) not between 1 and 140 or title_text ~ '[[:cntrl:]]'
    or description_text is null or length(description_text) > 4000
    or cardinality(p_course_ids) is null or cardinality(p_course_ids) not between 2 and 30 then
    raise invalid_parameter_value;
  end if;
  if not private.learning_program_manager(p_organisation_id) then raise insufficient_privilege; end if;
  if (select edition <> 'internal' from private.installation_identity) then
    perform private.lock_academy_course_access();
  end if;
  perform pg_advisory_xact_lock(hashtextextended('learning-program:' || p_program_id, 0));
  select * into previous from private.learning_programs where id = p_program_id for update;
  if found and previous.organisation_id <> p_organisation_id then raise insufficient_privilege; end if;
  select array_agg(course_id order by position) into current_courses
    from private.learning_program_courses where program_id = p_program_id;
  same_content := previous.id is not null and previous.title = title_text
    and previous.description = description_text and previous.sequential = p_sequential
    and current_courses is not distinct from p_course_ids;

  if not coalesce(same_content, false) or not p_archived then
    if cardinality(p_course_ids) <> (select count(distinct course_id) from unnest(p_course_ids) course_id) then
      raise invalid_parameter_value;
    end if;
    perform 1 from public.course_runs r where r.id = any(p_course_ids)
      and r.organisation_id = p_organisation_id and r.published and r.archived_at is null
      order by r.id for share;
    if (select count(*) from public.course_runs r where r.id = any(p_course_ids)
      and r.organisation_id = p_organisation_id and r.published and r.archived_at is null)
      <> cardinality(p_course_ids) then raise insufficient_privilege; end if;
  end if;
  perform private.lock_learning_program_scope(p_organisation_id, auth.uid(), null);
  if not private.learning_program_manager(p_organisation_id) then raise insufficient_privilege; end if;
  if same_content and p_archived = (previous.archived_at is not null) then return p_program_id; end if;
  if p_expected_version <> coalesce(previous.version, 0) then
    raise exception 'Learning program changed' using errcode = 'PT409';
  end if;
  if not coalesce(same_content, false) and exists (
    select 1 from private.learning_program_members where program_id = p_program_id
  ) then raise exception 'The subscribed learning program is locked' using errcode = 'PT409'; end if;

  insert into private.learning_programs(id, organisation_id, title, description, sequential, archived_at)
  values (p_program_id, p_organisation_id, title_text, description_text, p_sequential,
    case when p_archived then statement_timestamp() end)
  on conflict (id) do update set title = excluded.title, description = excluded.description,
    sequential = excluded.sequential, archived_at = excluded.archived_at,
    version = private.learning_programs.version + 1;

  if not coalesce(same_content, false) then
    delete from private.learning_program_courses where program_id = p_program_id;
    insert into private.learning_program_courses(program_id, position, course_id, title)
    select p_program_id, selected.position::integer, r.id, t.title
    from unnest(p_course_ids) with ordinality selected(id, position)
    join public.course_runs r on r.id = selected.id
    join public.course_templates t on t.id = r.template_id;
  end if;
  insert into public.audit_events(actor_id, action, resource_id, details)
    values (auth.uid(), 'learning.program.saved', p_program_id,
      jsonb_build_object('organisation_id', p_organisation_id, 'archived', p_archived));
  return p_program_id;
end;
$$;

-- All callers have locked and checked the program, scope, participant and
-- target run. Record assignment and synchronise access through the owning LMS.
create function private.activate_learning_program_course(p_course uuid, p_user uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare existing text;
begin
  select status into existing from public.course_enrolments
    where course_run_id = p_course and user_id = p_user for update;
  if existing in ('enrolled', 'completed') then return; end if;
  if existing = 'removed' then
    raise exception 'The course enrolment was removed' using errcode = 'PT409';
  end if;
  perform private.store_course_enrolment(p_course, p_user, 'enrolled', auth.uid(), null);
  perform private.sync_course_enrolment_chat(p_course, p_user, 'enrolled');
end;
$$;

create function private.enrol_learning_program(p_program_id uuid, p_user_id uuid, p_expected_version integer)
returns void language plpgsql security definer set search_path = '' as $$
declare
  program private.learning_programs;
  first_course uuid;
begin
  if p_program_id is null or p_user_id is null or p_expected_version is null then raise invalid_parameter_value; end if;
  if (select edition <> 'internal' from private.installation_identity) then
    perform private.lock_academy_course_access();
  end if;
  select * into program from private.learning_programs where id = p_program_id for update;
  if not found or not private.learning_program_manager(program.organisation_id) then raise insufficient_privilege; end if;
  if program.archived_at is not null then raise exception 'Learning program archived' using errcode = 'PT409'; end if;

  perform 1 from public.course_runs run
    join private.learning_program_courses item on item.course_id = run.id and item.program_id = program.id
    where run.organisation_id = program.organisation_id and run.published and run.archived_at is null
    order by run.id for no key update of run;
  if (select count(*) from public.course_runs run
    join private.learning_program_courses item on item.course_id = run.id and item.program_id = program.id
    where run.organisation_id = program.organisation_id and run.published and run.archived_at is null)
    <> (select count(*) from private.learning_program_courses where program_id = program.id) then
    raise exception 'A course in the learning program is unavailable' using errcode = 'PT409';
  end if;
  perform private.lock_learning_program_scope(program.organisation_id, auth.uid(), p_user_id);
  if not private.learning_program_manager(program.organisation_id) then raise insufficient_privilege; end if;
  if exists (select 1 from private.learning_program_members where program_id = program.id and user_id = p_user_id) then
    return;
  end if;
  if program.version <> p_expected_version then
    raise exception 'Learning program changed' using errcode = 'PT409';
  end if;
  select course_id into strict first_course from private.learning_program_courses
    where program_id = program.id and position = 1;
  perform private.activate_learning_program_course(first_course, p_user_id);
  insert into private.learning_program_members(program_id, user_id) values (program.id, p_user_id);
  insert into public.audit_events(actor_id, action, resource_id, details)
    values (auth.uid(), 'learning.program.enrolled', program.id, jsonb_build_object('user_id', p_user_id));
end;
$$;

create function private.start_learning_program_course(p_program_id uuid, p_course_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  program private.learning_programs;
  state text;
begin
  if p_program_id is null or p_course_id is null then raise invalid_parameter_value; end if;
  if not coalesce(private.learning_actor(), false) then raise insufficient_privilege; end if;
  if (select edition <> 'internal' from private.installation_identity) then
    perform private.lock_academy_course_access();
  end if;
  select * into program from private.learning_programs where id = p_program_id for share;
  if not found or program.archived_at is not null or not exists (
    select 1 from private.learning_program_members where program_id = program.id and user_id = actor
  ) then raise insufficient_privilege; end if;
  perform 1 from public.course_runs run
    join private.learning_program_courses item on item.course_id = run.id and item.program_id = program.id
    where run.id = p_course_id and run.organisation_id = program.organisation_id
      and run.published and run.archived_at is null for no key update of run;
  if not found then raise insufficient_privilege; end if;
  perform private.lock_learning_program_scope(program.organisation_id, actor, actor);

  -- A concurrent revocation must finish before we re-evaluate the prerequisites.
  perform 1 from private.course_completion_records receipt
    join private.learning_program_courses item on item.course_id = receipt.run_id and item.program_id = program.id
    where receipt.user_id = actor and receipt.revoked_at is null order by receipt.run_id for share of receipt;
  select step ->> 'state' into state
  from jsonb_array_elements(private.learning_program_progress(program.id, actor)->'steps') step
  where step ->> 'course_id' = p_course_id::text;
  if state in ('in_progress', 'completed') then return; end if;
  if state is distinct from 'ready' then
    raise exception 'Complete the prerequisites first' using errcode = 'PT409';
  end if;
  perform private.activate_learning_program_course(p_course_id, actor);
end;
$$;

create function public.learning_programs(p_program_id uuid default null, p_organisation_id uuid default null,
  p_search text default '')
returns jsonb language sql stable security invoker set search_path = ''
return private.learning_programs(p_program_id, p_organisation_id, p_search);
create function public.save_learning_program(p_program_id uuid, p_organisation_id uuid,
  p_title text, p_description text, p_sequential boolean, p_course_ids uuid[], p_archived boolean,
  p_expected_version integer)
returns uuid language sql security invoker set search_path = ''
return private.save_learning_program(p_program_id, p_organisation_id, p_title, p_description,
  p_sequential, p_course_ids, p_archived, p_expected_version);
create function public.enrol_learning_program(p_program_id uuid, p_user_id uuid, p_expected_version integer)
returns void language sql security invoker set search_path = '' as $$
select private.enrol_learning_program(p_program_id, p_user_id, p_expected_version);
$$;
create function public.start_learning_program_course(p_program_id uuid, p_course_id uuid)
returns void language sql security invoker set search_path = '' as $$
select private.start_learning_program_course(p_program_id, p_course_id);
$$;

revoke all on function private.learning_program_manager(uuid), private.learning_program_progress(uuid,uuid),
  private.activate_learning_program_course(uuid,uuid), private.lock_learning_program_scope(uuid,uuid,uuid),
  private.learning_programs(uuid,uuid,text), public.learning_programs(uuid,uuid,text),
  private.save_learning_program(uuid,uuid,text,text,boolean,uuid[],boolean,integer),
  public.save_learning_program(uuid,uuid,text,text,boolean,uuid[],boolean,integer),
  private.enrol_learning_program(uuid,uuid,integer), public.enrol_learning_program(uuid,uuid,integer),
  private.start_learning_program_course(uuid,uuid), public.start_learning_program_course(uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.learning_programs(uuid,uuid,text), public.learning_programs(uuid,uuid,text),
  private.save_learning_program(uuid,uuid,text,text,boolean,uuid[],boolean,integer),
  public.save_learning_program(uuid,uuid,text,text,boolean,uuid[],boolean,integer),
  private.enrol_learning_program(uuid,uuid,integer), public.enrol_learning_program(uuid,uuid,integer),
  private.start_learning_program_course(uuid,uuid), public.start_learning_program_course(uuid,uuid)
  to authenticated;

do $$
declare
  academy_gate text := pg_get_functiondef('private.require_academy_course_access()'::regprocedure);
  internal_gate text := pg_get_functiondef('private.require_portal_access()'::regprocedure);
  academy_anchor constant text := '  licence_status := private.academy_course_access_status();';
  internal_anchor constant text := '  perform private.require_portal_access_before_display_name();';
begin
  if cardinality(string_to_array(academy_gate, academy_anchor)) <> 2
     or cardinality(string_to_array(internal_gate, internal_anchor)) <> 2 then
    raise exception 'Expected one dedicated and internal course gate';
  end if;
  execute replace(academy_gate, academy_anchor, academy_anchor || chr(10) || $gate$
  if (licence_status in ('active','grace') and request_method in ('GET','HEAD','POST')
      and request_path = '/rpc/learning_programs')
    or (licence_status = 'active' and request_method = 'POST'
      and request_path in ('/rpc/save_learning_program','/rpc/enrol_learning_program','/rpc/start_learning_program_course'))
  then return; end if;
  $gate$);
  execute replace(internal_gate, internal_anchor, $gate$
  if current_setting('role',true) = 'authenticated' and private.participant_actor() and (
    (current_setting('request.method',true) in ('GET','HEAD','POST')
     and current_setting('request.path',true) = '/rpc/learning_programs')
    or (current_setting('request.method',true) = 'POST'
      and current_setting('request.path',true) = '/rpc/start_learning_program_course')
  ) then return; end if;
  $gate$ || internal_anchor);
end;
$$;

notify pgrst, 'reload schema';
commit;
