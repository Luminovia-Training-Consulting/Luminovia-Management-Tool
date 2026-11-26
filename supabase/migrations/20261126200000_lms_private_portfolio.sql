begin;

-- Portfolio entries are owned by one profile. Sharing grants one immutable
-- revision to one currently assigned instructor, not access to the entry.
create table private.learning_portfolio_entries (
  id uuid primary key,
  owner_id uuid not null references public.profiles(id) on delete cascade
);
create index learning_portfolio_entries_owner on private.learning_portfolio_entries(owner_id, id);
create table private.learning_portfolio_revisions (
  entry_id uuid not null references private.learning_portfolio_entries(id) on delete cascade,
  revision integer not null check (revision between 1 and 30),
  title text not null check (length(title) between 1 and 140),
  body text not null check (length(body) between 1 and 4000),
  created_at timestamptz not null default clock_timestamp(),
  primary key (entry_id, revision)
);
create table private.learning_portfolio_shares (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null,
  revision integer not null,
  course_id uuid references public.course_runs(id) on delete set null,
  teacher_id uuid references public.profiles(id) on delete set null,
  shared_at timestamptz not null default clock_timestamp(),
  revoked_at timestamptz,
  foreign key (entry_id, revision)
    references private.learning_portfolio_revisions(entry_id, revision) on delete cascade
);
create index learning_portfolio_shares_entry on private.learning_portfolio_shares(entry_id, revision);
create index learning_portfolio_shares_teacher on private.learning_portfolio_shares(teacher_id, course_id, shared_at desc, id);
create index learning_portfolio_shares_course on private.learning_portfolio_shares(course_id);
create unique index learning_portfolio_active_share
  on private.learning_portfolio_shares(entry_id, revision, course_id, teacher_id)
  where revoked_at is null;
alter table private.learning_portfolio_entries enable row level security;
alter table private.learning_portfolio_revisions enable row level security;
alter table private.learning_portfolio_shares enable row level security;
revoke all on private.learning_portfolio_entries, private.learning_portfolio_revisions,
  private.learning_portfolio_shares from public, anon, authenticated, service_role;

-- A historical assignment, global management role or replacement teacher
-- grants no access to an instructor's named portfolio share.
create function private.learning_portfolio_current_teacher(p_course_id uuid, p_teacher_id uuid)
returns boolean language sql stable strict set search_path = '' as $$
  select exists (select 1 from public.profiles where id = p_teacher_id and active)
    and case when (select installation.edition from private.installation_identity installation) = 'internal'
    then private.lecturer_user(p_teacher_id) and exists (
      select 1 from public.job_claims claim
      join public.jobs job on job.id = claim.job_id
      where job.course_run_id = p_course_id and claim.lecturer_id = p_teacher_id
        and claim.status = 'confirmed'
    ) else private.academy_course_teacher(p_course_id, p_teacher_id) end;
$$;

-- Scope is evaluated against current course access for both read paths.
create function private.learning_portfolio_current_learner(p_course_id uuid, p_user_id uuid)
returns boolean language sql stable strict set search_path = '' as $$
  select exists (
    select 1
    from public.course_runs run
    join public.course_enrolments enrolment on enrolment.course_run_id = run.id
      and enrolment.user_id = p_user_id and enrolment.status in ('enrolled', 'completed')
    where run.id = p_course_id and run.archived_at is null
      and private.course_lms_read_enabled(run.organisation_id)
      and private.active_company_participant(p_user_id, run.organisation_id)
  );
$$;
revoke all on function private.learning_portfolio_current_teacher(uuid, uuid),
  private.learning_portfolio_current_learner(uuid, uuid) from public, anon, authenticated, service_role;

create function private.learning_portfolio(
  p_course_id uuid default null, p_entry_id uuid default null,
  p_export boolean default false, p_offset integer default 0
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  context jsonb;
  licence_status text;
  page jsonb;
  entries jsonb;
  targets jsonb := '[]'::jsonb;
begin
  if not coalesce(private.learning_actor(), false) then raise insufficient_privilege; end if;
  if (select installation.edition from private.installation_identity installation) is distinct from 'internal' then
    licence_status := private.academy_course_access_status();
    if licence_status is null or licence_status not in ('active', 'grace') then raise insufficient_privilege; end if;
  end if;
  if p_export is null or p_offset is null or p_offset < 0 or
     (p_course_id is not null and (p_entry_id is not null or p_export)) then
    raise invalid_parameter_value;
  end if;

  if p_course_id is not null then
    context := private.course_workspace_context(p_course_id);
    if not coalesce((context->>'lms_enabled')::boolean, false)
       or not coalesce((context->>'teacher')::boolean, false)
       or not private.learning_portfolio_current_teacher(p_course_id, actor) then
      raise insufficient_privilege;
    end if;
    select coalesce(jsonb_agg(to_jsonb(item) order by item.shared_at desc, item.id), '[]'::jsonb)
      into page
    from (
      select share.id, revision.title, revision.body, revision.revision, share.shared_at,
        profile.display_name as learner
      from private.learning_portfolio_shares share
      join private.learning_portfolio_revisions revision
        on revision.entry_id = share.entry_id and revision.revision = share.revision
      join private.learning_portfolio_entries entry on entry.id = share.entry_id
      join public.profiles profile on profile.id = entry.owner_id
      where share.course_id = p_course_id and share.teacher_id = actor and share.revoked_at is null
        and private.learning_portfolio_current_learner(p_course_id, entry.owner_id)
      order by share.shared_at desc, share.id offset p_offset limit 21
    ) item;
    return jsonb_build_object('shares', page - 20, 'has_more', jsonb_array_length(page) > 20);
  end if;

  if p_entry_id is not null and not exists (
    select 1 from private.learning_portfolio_entries where id = p_entry_id and owner_id = actor
  ) then raise insufficient_privilege; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', entry.id, 'current', to_jsonb(current_revision) - 'entry_id',
    'history', case when p_export or p_entry_id is not null then (
      select jsonb_agg(to_jsonb(history_row) - 'entry_id' order by history_row.revision desc)
      from private.learning_portfolio_revisions history_row where history_row.entry_id = entry.id
    ) end,
    'shares', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', share.id, 'revision', share.revision, 'shared_at', share.shared_at,
        'revoked_at', share.revoked_at, 'course', template.title, 'teacher', instructor.display_name
      ) order by share.shared_at desc, share.id)
      from private.learning_portfolio_shares share
      left join public.course_runs run on run.id = share.course_id
      left join public.course_templates template on template.id = run.template_id
      left join public.profiles instructor on instructor.id = share.teacher_id
      where share.entry_id = entry.id
    ), '[]'::jsonb)
  ) order by current_revision.created_at desc, entry.id), '[]'::jsonb) into entries
  from private.learning_portfolio_entries entry
  join lateral (
    select revision.* from private.learning_portfolio_revisions revision
    where revision.entry_id = entry.id order by revision.revision desc limit 1
  ) current_revision on true
  where entry.owner_id = actor and (p_entry_id is null or entry.id = p_entry_id);

  if not p_export and p_entry_id is null then
    select coalesce(jsonb_agg(to_jsonb(target) order by target.course, target.teacher, target.course_id), '[]'::jsonb)
      into targets
    from (
      select distinct run.id as course_id, template.title as course,
        instructor.id as teacher_id, instructor.display_name as teacher
      from public.course_enrolments enrolment
      join public.course_runs run on run.id = enrolment.course_run_id
      join public.course_templates template on template.id = run.template_id
      join public.jobs job on job.course_run_id = run.id
      join public.job_claims claim on claim.job_id = job.id and claim.status = 'confirmed'
      join public.profiles instructor on instructor.id = claim.lecturer_id
      where enrolment.user_id = actor and instructor.id <> actor
        and private.learning_portfolio_current_learner(run.id, actor)
        and private.learning_portfolio_current_teacher(run.id, instructor.id)
    ) target;
  end if;
  return jsonb_build_object('entries', entries, 'targets', targets);
end;
$$;

-- CAS preserves the version reviewed by the author. Revocation is scoped to
-- an owned receipt and remains available if the course or recipient changed.
create function private.learning_portfolio_command(
  p_entry_id uuid, p_action text, p_payload jsonb, p_expected_revision integer
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  entry private.learning_portfolio_entries;
  current_revision private.learning_portfolio_revisions;
  context jsonb;
  title_value text;
  body_value text;
  course_id_value uuid;
  teacher_id_value uuid;
  receipt uuid;
begin
  if p_entry_id is null or p_action is null or p_action not in ('save', 'share', 'revoke')
     or jsonb_typeof(p_payload) is distinct from 'object'
     or p_expected_revision is null or p_expected_revision < 0 then raise invalid_parameter_value; end if;
  if (select installation.edition from private.installation_identity installation) is distinct from 'internal' then
    perform private.lock_academy_course_access();
  end if;
  perform 1 from public.profiles where id = actor and active for share;
  if not found or not coalesce(private.learning_actor(), false) then raise insufficient_privilege; end if;
  -- Serialize the owner's list cap, revision changes and receipt mutations.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('learning-portfolio:' || actor::text, 0));
  select * into entry from private.learning_portfolio_entries where id = p_entry_id for update;
  if found and entry.owner_id is distinct from actor then raise insufficient_privilege; end if;
  select * into current_revision from private.learning_portfolio_revisions
  where entry_id = p_entry_id order by revision desc limit 1;

  if p_action = 'save' then
    if jsonb_typeof(p_payload->'title') is distinct from 'string'
       or jsonb_typeof(p_payload->'body') is distinct from 'string'
       or p_payload - array['title','body'] <> '{}'::jsonb then raise invalid_parameter_value; end if;
    title_value := btrim(p_payload->>'title');
    body_value := btrim(p_payload->>'body');
    if length(title_value) not between 1 and 140 or length(body_value) not between 1 and 4000
       then raise invalid_parameter_value; end if;
    if current_revision.title = title_value and current_revision.body = body_value then
      return jsonb_build_object('revision', current_revision.revision);
    end if;
    if coalesce(current_revision.revision, 0) <> p_expected_revision then
      raise exception 'Portfolio entry changed' using errcode = 'PT409';
    end if;
    if coalesce(current_revision.revision, 0) >= 30 or
       (entry.id is null and (select count(*) from private.learning_portfolio_entries where owner_id = actor) >= 40)
       then raise exception 'Portfolio limit reached' using errcode = '22023'; end if;
    if entry.id is null then insert into private.learning_portfolio_entries(id, owner_id) values (p_entry_id, actor); end if;
    insert into private.learning_portfolio_revisions(entry_id, revision, title, body)
    values (p_entry_id, p_expected_revision + 1, title_value, body_value);
    return jsonb_build_object('revision', p_expected_revision + 1);
  end if;

  if entry.id is null then raise insufficient_privilege; end if;
  if p_action = 'revoke' then
    if jsonb_typeof(p_payload->'share_id') is distinct from 'string'
       or p_payload - 'share_id' <> '{}'::jsonb then raise invalid_parameter_value; end if;
    update private.learning_portfolio_shares set revoked_at = coalesce(revoked_at, clock_timestamp())
    where id = (p_payload->>'share_id')::uuid and entry_id = p_entry_id returning id into receipt;
    if receipt is null then raise insufficient_privilege; end if;
    return jsonb_build_object('share_id', receipt);
  end if;

  if jsonb_typeof(p_payload->'course_id') is distinct from 'string'
     or jsonb_typeof(p_payload->'teacher_id') is distinct from 'string'
     or p_payload - array['course_id','teacher_id'] <> '{}'::jsonb then raise invalid_parameter_value; end if;
  course_id_value := (p_payload->>'course_id')::uuid;
  teacher_id_value := (p_payload->>'teacher_id')::uuid;
  context := private.course_workspace_context(course_id_value);
  if not coalesce((context->>'learner')::boolean,false) or actor = teacher_id_value
     or not private.learning_portfolio_current_teacher(course_id_value, teacher_id_value)
     then raise insufficient_privilege; end if;
  if current_revision.revision is distinct from p_expected_revision then
    raise exception 'Portfolio entry changed' using errcode = 'PT409';
  end if;
  select id into receipt from private.learning_portfolio_shares where entry_id = p_entry_id
    and revision = p_expected_revision and course_id = course_id_value and teacher_id = teacher_id_value
    and revoked_at is null;
  if receipt is null then
    if (select count(*) from private.learning_portfolio_shares where entry_id = p_entry_id) >= 40 then
      raise exception 'Portfolio sharing limit reached' using errcode = '22023';
    end if;
    insert into private.learning_portfolio_shares(entry_id, revision, course_id, teacher_id)
    values (p_entry_id, p_expected_revision, course_id_value, teacher_id_value) returning id into receipt;
  end if;
  return jsonb_build_object('share_id', receipt);
end;
$$;

create function public.learning_portfolio(
  p_course_id uuid default null, p_entry_id uuid default null,
  p_export boolean default false, p_offset integer default 0
) returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.learning_portfolio(p_course_id, p_entry_id, p_export, p_offset);
$$;
create function public.learning_portfolio_command(
  p_entry_id uuid, p_action text, p_payload jsonb, p_expected_revision integer
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.learning_portfolio_command(p_entry_id, p_action, p_payload, p_expected_revision);
$$;
revoke all on function private.learning_portfolio(uuid,uuid,boolean,integer),
  public.learning_portfolio(uuid,uuid,boolean,integer),
  private.learning_portfolio_command(uuid,text,jsonb,integer),
  public.learning_portfolio_command(uuid,text,jsonb,integer) from public, anon, service_role;
grant execute on function private.learning_portfolio(uuid,uuid,boolean,integer),
  public.learning_portfolio(uuid,uuid,boolean,integer),
  private.learning_portfolio_command(uuid,text,jsonb,integer),
  public.learning_portfolio_command(uuid,text,jsonb,integer) to authenticated;

-- Register the scoped routes after licence derivation and before the generic
-- restricted learner gate. The owning RPCs also repeat all licence checks.
do $$
declare
  academy_gate text := pg_catalog.pg_get_functiondef('private.require_academy_course_access()'::regprocedure);
  portal_gate text := pg_catalog.pg_get_functiondef('private.require_portal_access()'::regprocedure);
  academy_anchor constant text := '  licence_status := private.academy_course_access_status();';
  portal_anchor constant text := '  perform private.require_portal_access_before_course_content();';
begin
  if cardinality(string_to_array(academy_gate, academy_anchor)) <> 2 or
     cardinality(string_to_array(portal_gate, portal_anchor)) <> 2 then
    raise exception 'Expected learner and Academy course access boundaries';
  end if;
  execute replace(academy_gate, academy_anchor, academy_anchor || chr(10) || $gate$
  if (licence_status in ('active','grace') and request_method in ('GET','HEAD','POST')
       and request_path = '/rpc/learning_portfolio')
     or (licence_status = 'active' and request_method = 'POST'
       and request_path = '/rpc/learning_portfolio_command') then return; end if;
  $gate$);
  execute replace(portal_gate, portal_anchor, $gate$
  if (select installation.edition from private.installation_identity installation) = 'internal'
     and current_setting('role',true) = 'authenticated' and private.participant_actor() and (
       (current_setting('request.method',true) in ('GET','HEAD','POST')
         and current_setting('request.path',true) = '/rpc/learning_portfolio')
       or (current_setting('request.method',true) = 'POST'
         and current_setting('request.path',true) = '/rpc/learning_portfolio_command')
     ) then return; end if;
  $gate$ || portal_anchor);
end;
$$;

notify pgrst, 'reload schema';
commit;
