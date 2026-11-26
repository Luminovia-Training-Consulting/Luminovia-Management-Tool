-- Version competency definitions and decisions independently of completion and grading.
begin;

create table private.lms_competency_frameworks (
  id uuid primary key,
  organisation_id uuid not null references public.organisations(id) on delete restrict,
  revision integer not null check (revision > 0)
);
create index lms_competency_framework_scope on private.lms_competency_frameworks(organisation_id, id);

create table private.lms_competency_framework_revisions (
  framework_id uuid not null references private.lms_competency_frameworks(id),
  revision integer not null check (revision > 0),
  content jsonb not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  primary key (framework_id, revision)
);
alter table private.lms_competency_frameworks add constraint lms_current_competency_revision
  foreign key (id, revision) references private.lms_competency_framework_revisions(framework_id, revision)
  deferrable initially deferred;

create table private.lms_course_competency_pins (
  run_id uuid not null references public.course_runs(id),
  revision integer not null check (revision > 0),
  framework_id uuid not null,
  framework_revision integer not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  primary key (run_id, revision),
  foreign key (framework_id, framework_revision)
    references private.lms_competency_framework_revisions(framework_id, revision)
);
create index lms_course_competency_framework on private.lms_course_competency_pins(framework_id, framework_revision);

create table private.lms_competency_decisions (
  run_id uuid not null,
  pin_revision integer not null,
  user_id uuid not null,
  competency_id uuid not null,
  revision integer not null check (revision > 0),
  level_id uuid not null,
  evidence_note text not null check (char_length(evidence_note) between 3 and 1500),
  quiz_attempt_id uuid,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  primary key (run_id, pin_revision, user_id, competency_id, revision),
  foreign key (run_id, pin_revision) references private.lms_course_competency_pins(run_id, revision),
  foreign key (quiz_attempt_id, run_id, user_id) references private.course_quiz_attempts(id, run_id, user_id)
);
create index lms_competency_decisions_subject on private.lms_competency_decisions(run_id, user_id, created_at desc);
create index lms_competency_decisions_evidence on private.lms_competency_decisions(quiz_attempt_id, run_id, user_id);

alter table private.lms_competency_frameworks enable row level security;
alter table private.lms_competency_framework_revisions enable row level security;
alter table private.lms_course_competency_pins enable row level security;
alter table private.lms_competency_decisions enable row level security;
revoke all on private.lms_competency_frameworks, private.lms_competency_framework_revisions,
  private.lms_course_competency_pins, private.lms_competency_decisions from public, anon, authenticated, service_role;

create function private.prevent_competency_history_changes()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Competency history is immutable' using errcode = '55000';
end;
$$;
create trigger lms_competency_framework_immutable before update or delete on private.lms_competency_framework_revisions
  for each row execute function private.prevent_competency_history_changes();
create trigger lms_course_competency_pin_immutable before update or delete on private.lms_course_competency_pins
  for each row execute function private.prevent_competency_history_changes();
create trigger lms_competency_decision_immutable before update or delete on private.lms_competency_decisions
  for each row execute function private.prevent_competency_history_changes();

-- Strictly validate the bounded JSON definition while keeping historical IDs
-- stable across revisions. No HTML or executable content belongs to a level.
create function private.validate_competency_framework(p_content jsonb)
returns void language plpgsql immutable set search_path = '' as $$
declare
  uuid_pattern constant text := '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$';
begin
  if jsonb_typeof(p_content) is distinct from 'object'
    or p_content - array['title','levels','competencies'] <> '{}'::jsonb
    or jsonb_typeof(p_content->'title') is distinct from 'string'
    or char_length(trim(p_content->>'title')) not between 1 and 150
    or jsonb_typeof(p_content->'levels') is distinct from 'array'
    or jsonb_typeof(p_content->'competencies') is distinct from 'array' then
    raise invalid_parameter_value;
  end if;

  if jsonb_array_length(p_content->'levels') not between 2 and 8
    or jsonb_array_length(p_content->'competencies') not between 1 and 30
    or exists (
      select 1 from jsonb_array_elements(p_content->'levels') level(value)
      where jsonb_typeof(value) is distinct from 'object'
        or jsonb_typeof(value->'id') is distinct from 'string'
        or (value->>'id') !~ uuid_pattern
        or jsonb_typeof(value->'title') is distinct from 'string'
        or char_length(trim(value->>'title')) not between 1 and 100
        or value - array['id','title'] <> '{}'::jsonb
    ) or exists (
      select 1 from jsonb_array_elements(p_content->'competencies') competency(value)
      where jsonb_typeof(value) is distinct from 'object'
        or jsonb_typeof(value->'id') is distinct from 'string'
        or (value->>'id') !~ uuid_pattern
        or jsonb_typeof(value->'code') is distinct from 'string'
        or char_length(trim(value->>'code')) not between 1 and 30
        or jsonb_typeof(value->'title') is distinct from 'string'
        or char_length(trim(value->>'title')) not between 1 and 140
        or value - array['id','code','title'] <> '{}'::jsonb
    ) or exists (
      select 1 from jsonb_array_elements(p_content->'competencies') competency(value)
      group by lower(trim(value->>'code')) having count(*) > 1
    ) or exists (
      select 1 from jsonb_array_elements(p_content->'competencies') competency(value)
      group by value->>'id' having count(*) > 1
    ) or exists (
      select 1 from jsonb_array_elements(p_content->'levels') level(value)
      group by value->>'id' having count(*) > 1
    ) then raise invalid_parameter_value; end if;
end;
$$;

-- Reads return immutable definitions and evidence anchored to one current
-- course. A participant receives only their own decisions and evidence.
create function private.course_competencies(p_run_id uuid, p_user_id uuid default null, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  context jsonb := private.course_workspace_context(p_run_id);
  course_org uuid;
  current_pin private.lms_course_competency_pins%rowtype;
  subject uuid := p_user_id;
  staff boolean := (context->>'staff')::boolean is true;
  manager boolean := (context->>'manager')::boolean is true;
  writable boolean;
  framework_options jsonb := '[]'::jsonb;
  decisions jsonb := '[]'::jsonb;
  current_decisions jsonb := '{}'::jsonb;
  pinned_framework jsonb;
begin
  if auth.uid() is null or (context->>'lms_enabled')::boolean is not true
    or not staff and (context->>'learner')::boolean is not true then raise insufficient_privilege; end if;
  select run.organisation_id into course_org from public.course_runs run
  join public.organisations company on company.id = run.organisation_id
  where run.id = p_run_id and company.archived_at is null;
  if not found then raise insufficient_privilege; end if;
  if p_offset is null or p_offset < 0 then raise invalid_parameter_value; end if;
  if not staff then
    if p_user_id is not null and p_user_id <> auth.uid() then raise insufficient_privilege; end if;
    subject := auth.uid();
  end if;
  if subject is not null and not (
    private.active_company_participant(subject, course_org) and exists (
      select 1 from public.course_enrolments enrolment
      where enrolment.course_run_id = p_run_id and enrolment.user_id = subject
        and enrolment.status in ('enrolled','completed')
    )
  ) then raise insufficient_privilege; end if;

  writable := (select edition from private.installation_identity) = 'internal'
    or private.academy_course_access_status() = 'active';
  select * into current_pin from private.lms_course_competency_pins
  where run_id = p_run_id order by revision desc limit 1;
  if current_pin.revision is not null then
    select jsonb_build_object('id', definition.framework_id, 'revision', definition.revision, 'content', definition.content)
    into pinned_framework from private.lms_competency_framework_revisions definition
    join private.lms_competency_frameworks head
      on head.id = definition.framework_id and head.organisation_id = course_org
    where definition.framework_id = current_pin.framework_id and definition.revision = current_pin.framework_revision;
  end if;
  if manager then
    select coalesce(jsonb_agg(jsonb_build_object('id', head.id, 'revision', head.revision, 'content', definition.content)
      order by definition.content->>'title', head.id), '[]'::jsonb)
    into framework_options from private.lms_competency_frameworks head
    join private.lms_competency_framework_revisions definition
      on definition.framework_id = head.id and definition.revision = head.revision
    where head.organisation_id = course_org;
  end if;
  if subject is not null then
    select coalesce(jsonb_object_agg(item.competency_id, item.revision), '{}'::jsonb) into current_decisions
    from (
      select decision.competency_id, max(decision.revision) as revision
      from private.lms_competency_decisions decision
      where pinned_framework is not null and decision.run_id = p_run_id
        and decision.pin_revision = current_pin.revision and decision.user_id = subject
      group by decision.competency_id
    ) item;
    select coalesce(jsonb_agg(to_jsonb(page) order by page.created_at desc, page.pin_revision desc,
      page.competency_id, page.revision desc), '[]'::jsonb)
    into decisions from (
      select decision.pin_revision, decision.revision, decision.competency_id, decision.level_id,
        competency.value->>'code' as code, competency.value->>'title' as competency_title,
        level.value->>'title' as level_title, definition.content->>'title' as framework_title,
        decision.evidence_note, decision.created_at,
        case when attempt.id is not null then jsonb_build_object(
          'id', attempt.id, 'quiz_version', attempt.quiz_version, 'score', attempt.score
        ) end as quiz_evidence
      from private.lms_competency_decisions decision
      join private.lms_course_competency_pins pin on pin.run_id = decision.run_id and pin.revision = decision.pin_revision
      join private.lms_competency_frameworks head on head.id = pin.framework_id and head.organisation_id = course_org
      join private.lms_competency_framework_revisions definition
        on definition.framework_id = pin.framework_id and definition.revision = pin.framework_revision
      join lateral jsonb_array_elements(definition.content->'competencies') competency(value)
        on competency.value->>'id' = decision.competency_id::text
      join lateral jsonb_array_elements(definition.content->'levels') level(value)
        on level.value->>'id' = decision.level_id::text
      left join private.course_quiz_attempts attempt on attempt.id = decision.quiz_attempt_id
      where decision.run_id = p_run_id and decision.user_id = subject
      order by decision.created_at desc, decision.pin_revision desc, decision.competency_id, decision.revision desc
      limit 51 offset p_offset
    ) page;
  end if;
  return jsonb_build_object('can_manage', manager and writable, 'can_assess', staff and writable,
    'pin_revision', coalesce(current_pin.revision, 0), 'pinned_framework', pinned_framework,
    'frameworks', framework_options, 'decisions', decisions - 50, 'current_revisions', current_decisions,
    'has_more', jsonb_array_length(decisions) > 50);
end;
$$;

-- Separate bounded framework authoring from mapping and assessment. The
-- caller's run context is locked and checked by the command before dispatch.
create function private.save_lms_competency_framework(p_org_id uuid, p_payload jsonb, expected integer)
returns jsonb language plpgsql volatile set search_path = '' as $$
declare
  target_id uuid;
  current_revision integer;
begin
  if p_payload - array['id','content'] <> '{}'::jsonb
    or jsonb_typeof(p_payload->'id') is distinct from 'string' then raise invalid_parameter_value; end if;
  target_id := (p_payload->>'id')::uuid;
  perform private.validate_competency_framework(p_payload->'content');
  if expected = 0 then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('competency-framework:' || p_org_id, 0));
    if (select count(*) from private.lms_competency_frameworks where organisation_id = p_org_id) >= 20
      and not exists (select 1 from private.lms_competency_frameworks where id = target_id and organisation_id = p_org_id)
      then raise exception 'Framework limit reached' using errcode = '22023';
    end if;
    insert into private.lms_competency_frameworks(id, organisation_id, revision)
      values (target_id, p_org_id, 1) on conflict (id) do nothing;
  end if;
  perform 1 from private.lms_competency_frameworks head where head.id = target_id
    and head.organisation_id = p_org_id for update;
  if not found then raise insufficient_privilege; end if;
  select max(revision) into current_revision from private.lms_competency_framework_revisions where framework_id = target_id;
  if current_revision = expected + 1 and exists (
    select 1 from private.lms_competency_framework_revisions definition
      where definition.framework_id = target_id and definition.revision = current_revision
        and definition.content = p_payload->'content'
  ) then return jsonb_build_object('id', target_id, 'revision', current_revision); end if;
  if coalesce(current_revision, 0) <> expected then
    raise exception 'Framework revision changed' using errcode = 'PT409';
  end if;
  insert into private.lms_competency_framework_revisions(framework_id, revision, content, created_by)
    values (target_id, expected + 1, p_payload->'content', auth.uid());
  update private.lms_competency_frameworks set revision = expected + 1 where id = target_id;
  return jsonb_build_object('id', target_id, 'revision', expected + 1);
end;
$$;

create function private.course_competency_action(p_run_id uuid, p_action text,
  p_payload jsonb, p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  company_id uuid;
  context jsonb;
  current_pin private.lms_course_competency_pins%rowtype;
  framework private.lms_competency_frameworks%rowtype;
  definition jsonb;
  subject uuid;
  target_competency_id uuid;
  target_level_id uuid;
  note text;
  evidence uuid;
  previous_decision private.lms_competency_decisions%rowtype;
  decision_revision integer;
begin
  if actor_id is null then raise insufficient_privilege; end if;
  if p_action is null or p_action not in ('save_framework','pin','assess')
    or jsonb_typeof(p_payload) is distinct from 'object'
    or p_expected_revision is null or p_expected_revision < 0 then raise invalid_parameter_value; end if;
  if (select edition from private.installation_identity) = 'internal' then
    perform private.lock_course_premium(p_run_id);
  else
    perform private.lock_academy_course_access();
  end if;
  perform 1 from public.profiles where id = actor_id and active for share;
  if not found then raise insufficient_privilege; end if;
  perform 1 from public.user_roles where user_id = actor_id order by role for share;
  select run.organisation_id into company_id from public.course_runs run
  join public.organisations company on company.id = run.organisation_id
  where run.id = p_run_id and run.archived_at is null and company.archived_at is null
  for no key update of run for share of company;
  if not found then raise insufficient_privilege; end if;
  perform 1 from public.job_claims claim join public.jobs job on job.id = claim.job_id
  where job.course_run_id = p_run_id and claim.lecturer_id = actor_id and claim.status = 'confirmed' for share of claim;
  context := private.course_workspace_context(p_run_id);
  if (context->>'lms_enabled')::boolean is not true or (context->>'staff')::boolean is not true
    or (p_action <> 'assess' and (context->>'manager')::boolean is not true) then raise insufficient_privilege; end if;

  if p_action = 'save_framework' then
    return private.save_lms_competency_framework(company_id, p_payload, p_expected_revision);
  end if;
  select * into current_pin from private.lms_course_competency_pins
    where run_id = p_run_id order by revision desc limit 1;
  if p_action = 'pin' then
    if p_payload - array['framework_id','framework_revision'] <> '{}'::jsonb
      or jsonb_typeof(p_payload->'framework_id') is distinct from 'string'
      or jsonb_typeof(p_payload->'framework_revision') is distinct from 'number'
      or (p_payload->>'framework_revision') !~ '^[1-9][0-9]{0,8}$'
      then raise invalid_parameter_value; end if;
    select * into framework from private.lms_competency_frameworks
      where id = (p_payload->>'framework_id')::uuid and organisation_id = company_id for share;
    if not found then raise insufficient_privilege; end if;
    if current_pin.framework_id = framework.id and current_pin.framework_revision = (p_payload->>'framework_revision')::integer
      and p_expected_revision between current_pin.revision - 1 and current_pin.revision then
      return jsonb_build_object('revision', current_pin.revision);
    end if;
    if coalesce(current_pin.revision, 0) <> p_expected_revision
      or framework.revision <> (p_payload->>'framework_revision')::integer then
      raise exception 'Course mapping or framework changed' using errcode = 'PT409';
    end if;
    insert into private.lms_course_competency_pins(run_id, revision, framework_id, framework_revision, created_by)
      values (p_run_id, p_expected_revision + 1, framework.id, framework.revision, actor_id);
    return jsonb_build_object('revision', p_expected_revision + 1);
  end if;

  if p_payload - array['pin_revision','user_id','competency_id','level_id','evidence_note','include_quiz'] <> '{}'::jsonb
    or jsonb_typeof(p_payload->'pin_revision') is distinct from 'number'
    or (p_payload->>'pin_revision') !~ '^[1-9][0-9]{0,8}$'
    or jsonb_typeof(p_payload->'user_id') is distinct from 'string'
    or jsonb_typeof(p_payload->'competency_id') is distinct from 'string'
    or jsonb_typeof(p_payload->'level_id') is distinct from 'string'
    or jsonb_typeof(p_payload->'evidence_note') is distinct from 'string'
    or jsonb_typeof(p_payload->'include_quiz') is distinct from 'boolean'
    then raise invalid_parameter_value; end if;
  if current_pin.revision is distinct from (p_payload->>'pin_revision')::integer then
    raise exception 'Course mapping changed' using errcode = 'PT409';
  end if;
  subject := (p_payload->>'user_id')::uuid;
  target_competency_id := (p_payload->>'competency_id')::uuid;
  target_level_id := (p_payload->>'level_id')::uuid;
  note := btrim(p_payload->>'evidence_note');
  perform 1 from public.profiles where id = subject and active for share;
  if not found then raise insufficient_privilege; end if;
  perform 1 from public.user_roles where user_id = subject and role = 'participant' for share;
  if not found then raise insufficient_privilege; end if;
  perform 1 from private.company_participant_memberships
    where organisation_id = company_id and user_id = subject and status = 'active' for share;
  if not found then raise insufficient_privilege; end if;
  perform 1 from public.course_enrolments
    where course_run_id = p_run_id and user_id = subject and status in ('enrolled','completed') for share;
  if not found then raise insufficient_privilege; end if;
  select item.content into definition from private.lms_competency_framework_revisions item
  join private.lms_competency_frameworks head on head.id = item.framework_id and head.organisation_id = company_id
  where item.framework_id = current_pin.framework_id and item.revision = current_pin.framework_revision;
  if not found then raise insufficient_privilege; end if;
  if char_length(note) not between 3 and 1500
    or not exists (select 1 from jsonb_array_elements(definition->'competencies') item where item->>'id' = target_competency_id::text)
    or not exists (select 1 from jsonb_array_elements(definition->'levels') item where item->>'id' = target_level_id::text)
    then raise invalid_parameter_value; end if;
  if (p_payload->>'include_quiz')::boolean then
    select attempt.id into evidence from private.course_quiz_attempts attempt
    join private.course_quizzes head on head.run_id = attempt.run_id and head.version = attempt.quiz_version
    join private.course_quiz_versions quiz on quiz.run_id = head.run_id and quiz.version = head.version and quiz.published
    where attempt.run_id = p_run_id and attempt.user_id = subject
    order by attempt.score desc, attempt.created_at desc, attempt.id limit 1;
    if not found then raise exception 'No current quiz evidence for this learner' using errcode = '22023'; end if;
  end if;
  select * into previous_decision from private.lms_competency_decisions decision
    where decision.run_id = p_run_id and decision.pin_revision = current_pin.revision and decision.user_id = subject
      and decision.competency_id = target_competency_id
    order by decision.revision desc limit 1;
  decision_revision := coalesce(previous_decision.revision, 0);
  if decision_revision = p_expected_revision + 1
    and (previous_decision.level_id, previous_decision.evidence_note, previous_decision.quiz_attempt_id)
      is not distinct from (target_level_id, note, evidence) then
    return jsonb_build_object('revision', decision_revision);
  end if;
  if decision_revision <> p_expected_revision then raise exception 'Decision changed' using errcode = 'PT409'; end if;
  insert into private.lms_competency_decisions(run_id, pin_revision, user_id, competency_id, revision, level_id,
    evidence_note, quiz_attempt_id, created_by)
    values (p_run_id, current_pin.revision, subject, target_competency_id, decision_revision + 1, target_level_id, note, evidence, actor_id);
  return jsonb_build_object('revision', decision_revision + 1);
end;
$$;

create function public.course_competencies(p_run_id uuid, p_user_id uuid default null, p_offset integer default 0)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.course_competencies(p_run_id, p_user_id, p_offset);
$$;
create function public.course_competency_action(p_run_id uuid, p_action text, p_payload jsonb, p_expected_revision integer)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.course_competency_action(p_run_id, p_action, p_payload, p_expected_revision);
$$;
revoke all on function private.prevent_competency_history_changes(),
  private.validate_competency_framework(jsonb), private.save_lms_competency_framework(uuid, jsonb, integer),
  private.course_competencies(uuid, uuid, integer), public.course_competencies(uuid, uuid, integer),
  private.course_competency_action(uuid, text, jsonb, integer), public.course_competency_action(uuid, text, jsonb, integer)
  from public, anon, authenticated, service_role;
grant execute on function private.course_competencies(uuid, uuid, integer), public.course_competencies(uuid, uuid, integer),
  private.course_competency_action(uuid, text, jsonb, integer), public.course_competency_action(uuid, text, jsonb, integer)
  to authenticated;

do $migration$
declare
  academy text := pg_catalog.pg_get_functiondef('private.require_academy_course_access()'::regprocedure);
  portal text := pg_catalog.pg_get_functiondef('private.require_portal_access()'::regprocedure);
  read_anchor constant text := '''/rpc/course_gradebook''';
  write_anchor constant text := '''/rpc/course_content_action''';
begin
  if cardinality(string_to_array(academy, read_anchor)) <> 2 or cardinality(string_to_array(portal, read_anchor)) <> 2
    or cardinality(string_to_array(academy, write_anchor)) <> 2 then raise exception 'Expected competency course gateway anchors'; end if;
  execute replace(replace(academy, read_anchor, read_anchor || ', ''/rpc/course_competencies'''),
    write_anchor, write_anchor || ', ''/rpc/course_competency_action''');
  execute replace(portal, read_anchor, read_anchor || ', ''/rpc/course_competencies''');
end;
$migration$;

notify pgrst, 'reload schema';
commit;
