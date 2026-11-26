BEGIN;

-- A course has immutable published requirements. A null enrolment pin means
-- the existing certificate rules, including for data predating this migration.
create table private.course_completion_policies (
  run_id uuid not null references public.course_runs(id) on delete cascade,
  version integer not null check (version > 0),
  attendance_percent integer not null check (attendance_percent between 1 and 100),
  assignment_id uuid,
  competency_pin integer,
  competency_id uuid,
  minimum_level_id uuid,
  lecturer_verification boolean not null,
  target_at timestamptz check (target_at is null or isfinite(target_at)),
  created_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (run_id, version),
  check ((competency_pin is null and competency_id is null and minimum_level_id is null) or
         (competency_pin is not null and competency_id is not null and minimum_level_id is not null))
);
alter table public.course_enrolments
  add column course_completion_policy_version integer,
  add constraint course_enrolments_completion_policy
    foreign key (course_run_id, course_completion_policy_version)
    references private.course_completion_policies(run_id, version);
create index course_enrolments_completion_policy_lookup
  on public.course_enrolments(course_run_id, course_completion_policy_version)
  where course_completion_policy_version is not null;

create table private.course_completion_verifications (
  run_id uuid not null,
  user_id uuid not null,
  policy_version integer not null,
  requirement text not null check (requirement in ('verification','assignment','competency')),
  revision integer not null check (revision > 0),
  accepted boolean not null,
  reason text not null check (length(reason) between 3 and 500),
  actor_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (run_id, user_id, policy_version, requirement, revision),
  foreign key (run_id, user_id) references public.course_enrolments(course_run_id, user_id) on delete cascade,
  foreign key (run_id, policy_version) references private.course_completion_policies(run_id, version) on delete cascade,
  check (actor_id <> user_id)
);
create index course_completion_verification_policy
  on private.course_completion_verifications(run_id, policy_version);
alter table private.course_completion_policies enable row level security;
alter table private.course_completion_verifications enable row level security;
revoke all on private.course_completion_policies, private.course_completion_verifications
  from public, anon, authenticated, service_role;

-- Serialise initial pin selection with publishing. An existing enrolment,
-- including an idempotent enrolment upsert or a status transition, stays pinned.
create function private.pin_course_completion_policy()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status in ('enrolled', 'completed') then
    perform 1 from public.course_runs where id = new.course_run_id for no key update;
    select max(version) into new.course_completion_policy_version
    from private.course_completion_policies where run_id = new.course_run_id;
  end if;
  return new;
end;
$$;
create trigger course_enrolment_pin_completion_policy before insert on public.course_enrolments
  for each row execute function private.pin_course_completion_policy();

create function private.course_completion_policy_for(p_run_id uuid, p_user_id uuid)
returns private.course_completion_policies language sql stable set search_path = '' as $$
  select policy.* from public.course_enrolments enrolment
  join private.course_completion_policies policy on policy.run_id = enrolment.course_run_id
    and policy.version = enrolment.course_completion_policy_version
  where enrolment.course_run_id = p_run_id and enrolment.user_id = p_user_id;
$$;

-- The authoritative evaluation lives below both the status and issue routes.
-- Evidence projections select only a result and label; private notes stay in
-- their owning table and neither uploaded bytes nor file names are relevant.
create function private.course_completion_assignment_released(p_assignment_id uuid, p_user_id uuid)
returns boolean language sql stable set search_path = '' as $$
  select coalesce((
    select entry.state = 'released'
    from (
      select id from private.course_assignment_attempts
      where assignment_id = p_assignment_id and user_id = p_user_id
      order by attempt_no desc limit 1
    ) attempt
    join private.course_assignment_reviews entry on entry.attempt_id = attempt.id
    where entry.state <> 'draft'
    order by entry.version desc limit 1
  ), false);
$$;

create function private.course_completion_policy_check(p_run_id uuid, p_user_id uuid)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  policy private.course_completion_policies := private.course_completion_policy_for(p_run_id, p_user_id);
  assignment jsonb := 'null'::jsonb;
  competency jsonb := 'null'::jsonb;
  verification jsonb := 'null'::jsonb;
  required_title text;
  active_pin integer;
  pinned_framework jsonb;
  level_name text;
  level_ordinal bigint;
  passing_ordinal bigint;
  decisions jsonb;
begin
  if policy.version is null then return null; end if;
  select coalesce(jsonb_object_agg(latest.requirement,
    jsonb_build_object('accepted', latest.accepted, 'revision', latest.revision)), '{}'::jsonb)
  into decisions
  from (
    select distinct on (entry.requirement) entry.requirement, entry.accepted, entry.revision
    from private.course_completion_verifications entry
    where entry.run_id = p_run_id and entry.user_id = p_user_id and entry.policy_version = policy.version
    order by entry.requirement, entry.revision desc
  ) latest;
  if policy.assignment_id is not null then
    select definition.title into required_title
    from private.course_assignments work
    join private.course_assignment_definitions definition
      on (definition.assignment_id, definition.version) = (work.id, work.published_version)
    where work.run_id = p_run_id and work.id = policy.assignment_id;
    assignment := jsonb_build_object('title', coalesce(required_title, ''),
      'met', private.course_completion_assignment_released(policy.assignment_id, p_user_id),
      'exception', coalesce(decisions->'assignment', '{"accepted":false,"revision":0}'::jsonb));
  end if;

  if policy.competency_pin is not null then
    select definition.content into pinned_framework
    from private.lms_course_competency_pins pin
    join private.lms_competency_framework_revisions definition
      on (definition.framework_id, definition.revision) = (pin.framework_id, pin.framework_revision)
    join private.lms_competency_frameworks framework on framework.id = pin.framework_id
    join public.course_runs run on run.id = pin.run_id and run.organisation_id = framework.organisation_id
    where pin.run_id = p_run_id and pin.revision = policy.competency_pin;
    select value->>'title' into required_title from jsonb_array_elements(pinned_framework->'competencies')
      where value->>'id' = policy.competency_id::text;
    select value->>'title', ordinality into level_name, level_ordinal
    from jsonb_array_elements(pinned_framework->'levels') with ordinality
    where value->>'id' = policy.minimum_level_id::text;
    select max(revision) into active_pin from private.lms_course_competency_pins where run_id = p_run_id;
    select level.ordinality into passing_ordinal
    from (
      select level_id from private.lms_competency_decisions
      where run_id = p_run_id and pin_revision = policy.competency_pin
        and user_id = p_user_id and competency_id = policy.competency_id
      order by revision desc limit 1
    ) decision
    join lateral jsonb_array_elements(pinned_framework->'levels') with ordinality level(value, ordinality)
      on level.value->>'id' = decision.level_id::text;
    competency := jsonb_build_object('title', coalesce(required_title, ''), 'minimum_level', coalesce(level_name, ''),
      'met', coalesce(passing_ordinal >= level_ordinal, false),
      'exception', coalesce(decisions->'competency', '{"accepted":false,"revision":0}'::jsonb),
      'review_available', coalesce(active_pin = policy.competency_pin, false) and pinned_framework is not null);
  end if;

  if policy.lecturer_verification then
    verification := coalesce(decisions->'verification', '{"accepted":false,"revision":0}'::jsonb);
  end if;

  return jsonb_build_object(
    'version', policy.version, 'attendance_percent', policy.attendance_percent,
    'assignment', assignment, 'competency', competency, 'verification', verification,
    'target_at', policy.target_at
  );
end;
$$;

create function private.course_completion_decision(p_run_id uuid, p_user_id uuid)
returns table (
  enrolment_completed boolean, session_count integer, ended_count integer,
  verified_count integer, ends_at timestamptz, quiz_version integer,
  quiz_passed boolean, reverify_required boolean, policy jsonb, ready boolean
) language sql stable strict set search_path = '' as $$
  with requirements as (
    select base.*, private.course_completion_policy_check(p_run_id, p_user_id) as policy
    from private.course_completion_requirements(p_run_id, p_user_id) base
  )
  select requirements.*,
    requirements.enrolment_completed and requirements.session_count > 0
    and requirements.ended_count = requirements.session_count
    and requirements.verified_count = requirements.session_count
    and requirements.quiz_passed and not requirements.reverify_required
    and (coalesce((requirements.policy #>> '{assignment,met}')::boolean, true)
      or coalesce((requirements.policy #>> '{assignment,exception,accepted}')::boolean, false))
    and (coalesce((requirements.policy #>> '{competency,met}')::boolean, true)
      or coalesce((requirements.policy #>> '{competency,exception,accepted}')::boolean, false))
    and coalesce((requirements.policy #>> '{verification,accepted}')::boolean, true)
  from requirements;
$$;

-- Harden the existing evaluator and issuance path in place, preserving the
-- legacy public contract, receipt retries and course/licence authorisation.
do $migration$
declare
  base text := pg_get_functiondef('private.course_completion_requirements(uuid,uuid)'::regprocedure);
  issuer text := pg_get_functiondef('private.course_workspace_action_before_premium(uuid,text,jsonb,integer)'::regprocedure);
  status text := pg_get_functiondef('private.course_completion_status(uuid,uuid)'::regprocedure);
  old_requirement constant text := 'private.course_completion_requirements(p_run_id, auth.uid())';
  old_status constant text := 'private.course_completion_requirements(p_run_id, target_user)';
  old_threshold constant text := '/ 60 * 0.8';
  old_ready constant text := $old$when requirements.enrolment_completed and requirements.session_count > 0
        and requirements.verified_count = requirements.session_count
        and requirements.quiz_passed and not requirements.reverify_required then 'ready'$old$;
  save_snapshot constant text := '  insert into private.course_completion_records(run_id,user_id,snapshot) values(p_run_id,auth.uid(),facts)';
  quiz_guard constant text := $old$    raise exception 'Pass current published quiz first' using errcode='22023';
  end if;$old$;
  status_keys constant text := '''rule_version'', 1,';
begin
  if cardinality(string_to_array(base, old_threshold)) <> 2
    or cardinality(string_to_array(issuer, old_requirement)) <> 2
    or cardinality(string_to_array(issuer, save_snapshot)) <> 2
    or cardinality(string_to_array(issuer, quiz_guard)) <> 2
    or cardinality(string_to_array(status, old_status)) <> 2
    or cardinality(string_to_array(status, old_ready)) <> 2
    or cardinality(string_to_array(status, status_keys)) <> 2 then
    raise exception 'Unexpected completion policy integration boundary';
  end if;
  execute replace(base, old_threshold, $threshold$
    / 60 * coalesce((private.course_completion_policy_for(p_run_id, p_user_id)).attendance_percent, 80) / 100.0$threshold$);

  issuer := replace(issuer, old_requirement, 'private.course_completion_decision(p_run_id, auth.uid())');
  issuer := replace(issuer, quiz_guard, quiz_guard || $extra$
  if not completion_requirements.ready then
    raise exception 'Complete all published course requirements before requesting the certificate' using errcode = '22023';
  end if;$extra$);
  issuer := replace(issuer, save_snapshot, $snapshot$
  if completion_requirements.policy is not null then
    facts := facts || jsonb_build_object(
      'completion_policy_version', completion_requirements.policy->'version',
      'attendance_percent', completion_requirements.policy->'attendance_percent',
      'assignment_exception_revision', case when (completion_requirements.policy #>> '{assignment,exception,accepted}')::boolean
        then completion_requirements.policy #> '{assignment,exception,revision}' end,
      'competency_exception_revision', case when (completion_requirements.policy #>> '{competency,exception,accepted}')::boolean
        then completion_requirements.policy #> '{competency,exception,revision}' end
    );
  end if;
$snapshot$ || save_snapshot);
  issuer := replace(issuer,
    'raise exception ''Completed enrolment and verified 80 percent attendance in every ended session required''',
    $error$raise exception 'Completed enrolment and verified % percent attendance in every ended session required',
      coalesce((completion_requirements.policy->>'attendance_percent')::integer, 80)$error$);
  execute issuer;

  status := replace(status, old_status, 'private.course_completion_decision(p_run_id, target_user)');
  status := replace(status, old_ready, 'when requirements.ready then ''ready''');
  status := replace(status, status_keys, '''rule_version'', case when requirements.policy is null then 1 else 2 end,');
  status := replace(status, 'return to_jsonb(requirements) ||', $status$
  return (to_jsonb(requirements) - 'ready' - 'policy')
    || case when requirements.policy is null then '{}'::jsonb else jsonb_build_object('policy', requirements.policy) end
    ||$status$);
  execute status;
end;
$migration$;

-- Policy and editing options are limited to staff. Learners use the ordinary
-- completion status RPC and cannot list other enrolments or staff decisions.
create function private.course_completion_policy(p_run_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  context jsonb := private.course_submission_context(p_run_id);
  latest private.course_completion_policies%rowtype;
  framework jsonb;
  assignment_options jsonb;
begin
  if (context->>'staff')::boolean is not true then raise insufficient_privilege; end if;
  select * into latest from private.course_completion_policies where run_id = p_run_id order by version desc limit 1;
  select jsonb_build_object('pin_version', pin.revision,
      'title', definition.content->'title', 'competencies', (select jsonb_agg(value - 'description' order by ordinality)
        from jsonb_array_elements(definition.content->'competencies') with ordinality),
      'levels', (select jsonb_agg(value - 'description' order by ordinality)
        from jsonb_array_elements(definition.content->'levels') with ordinality))
  into framework
  from (
    select * from private.lms_course_competency_pins where run_id = p_run_id order by revision desc limit 1
  ) pin
  join private.lms_competency_framework_revisions definition on
    (definition.framework_id, definition.revision) = (pin.framework_id, pin.framework_revision)
  join private.lms_competency_frameworks head on head.id = pin.framework_id
  join public.course_runs run on run.id = pin.run_id and run.organisation_id = head.organisation_id;
  select coalesce(jsonb_agg(jsonb_build_object('id', work.id, 'title', definition.title)
    order by definition.title, work.id), '[]'::jsonb)
  into assignment_options from private.course_assignments work
  join private.course_assignment_definitions definition
    on (definition.assignment_id, definition.version) = (work.id, work.published_version)
  where work.run_id = p_run_id;
  return jsonb_build_object(
    'head', case when latest.version is not null then to_jsonb(latest) - array['run_id','created_by'] end,
    'assignments', assignment_options, 'framework', framework,
    'can_manage', coalesce((context->>'manager')::boolean, false) and private.course_submission_write_enabled()
  );
end;
$$;

create function private.course_completion_policy_action(
  p_run_id uuid, p_action text, p_payload jsonb, p_expected_version integer
) returns integer language plpgsql security definer set search_path = '' as $$
declare
  context jsonb := private.lock_course_submission_settings_actor(p_run_id);
  learner uuid;
  company_id uuid;
  head integer;
  current_version integer;
  revision integer;
  assignment uuid;
  pin integer;
  competency uuid;
  minimum_level uuid;
  deadline timestamptz;
  review_requirement text;
  expected text[];
begin
  if (context->>'staff')::boolean is not true or not private.course_submission_write_enabled() then raise insufficient_privilege; end if;
  if jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text) > 4096
    or p_expected_version is null or p_expected_version < 0 then raise invalid_parameter_value; end if;
  expected := case p_action
    when 'publish' then array['attendance_percent','assignment_id','competency_pin','competency_id','minimum_level_id','lecturer_verification','target_at']
    when 'pin' then array['user_id','policy_version']
    when 'verify' then array['user_id','policy_version','accepted','reason']
    when 'exception' then array['user_id','policy_version','accepted','reason','requirement']
  end;
  if expected is null or p_payload - expected <> '{}'::jsonb or not p_payload ?& expected then raise invalid_parameter_value; end if;
  select coalesce(max(version), 0) into head from private.course_completion_policies where run_id = p_run_id;
  if p_action in ('pin', 'publish', 'exception') and (context->>'manager')::boolean is not true then raise insufficient_privilege; end if;

  if p_action = 'publish' then
    if head <> p_expected_version then raise exception 'Course completion policy changed' using errcode = 'PT409'; end if;
    if jsonb_typeof(p_payload->'attendance_percent') is distinct from 'number'
      or (p_payload->>'attendance_percent') !~ '^([1-9][0-9]?|100)$'
      or jsonb_typeof(p_payload->'lecturer_verification') is distinct from 'boolean'
      or (p_payload->>'target_at' is not null and
        (p_payload->>'target_at') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$')
    then raise invalid_parameter_value; end if;
    deadline := (p_payload->>'target_at')::timestamptz;
    assignment := (p_payload->>'assignment_id')::uuid;
    pin := (p_payload->>'competency_pin')::integer;
    competency := (p_payload->>'competency_id')::uuid;
    minimum_level := (p_payload->>'minimum_level_id')::uuid;
    if assignment is not null and not exists (
      select 1 from private.course_assignments where run_id = p_run_id and id = assignment and published_version is not null
    ) then raise invalid_parameter_value; end if;
    if (pin is null) <> (competency is null) or (pin is null) <> (minimum_level is null) then raise invalid_parameter_value; end if;
    if pin is not null and not exists (
      select 1
      from private.lms_course_competency_pins current_pin
      join private.lms_competency_framework_revisions definition on
        (definition.framework_id, definition.revision) = (current_pin.framework_id, current_pin.framework_revision)
      join private.lms_competency_frameworks framework on framework.id = current_pin.framework_id
      join public.course_runs run on run.id = current_pin.run_id and run.organisation_id = framework.organisation_id
      where current_pin.run_id = p_run_id and current_pin.revision = pin
        and pin = (select max(candidate.revision) from private.lms_course_competency_pins candidate
          where candidate.run_id = p_run_id)
        and definition.content->'competencies' @> jsonb_build_array(jsonb_build_object('id', competency))
        and definition.content->'levels' @> jsonb_build_array(jsonb_build_object('id', minimum_level))
    ) then raise exception 'Course competency framework changed' using errcode = 'PT409'; end if;
    insert into private.course_completion_policies(run_id, version, attendance_percent, assignment_id,
      competency_pin, competency_id, minimum_level_id, lecturer_verification, target_at, created_by)
    values (p_run_id, head + 1, (p_payload->>'attendance_percent')::integer, assignment, pin, competency, minimum_level,
      (p_payload->>'lecturer_verification')::boolean, deadline, auth.uid());
    revision := head + 1;
  else
    learner := (p_payload->>'user_id')::uuid;
    select organisation_id into strict company_id from public.course_runs where id = p_run_id;
    perform 1 from private.company_participant_memberships where organisation_id = company_id
      and user_id = learner and status = 'active' for share;
    if not found or learner = auth.uid() or not private.active_company_participant(learner, company_id)
      then raise insufficient_privilege; end if;
    select coalesce(course_completion_policy_version, 0) into current_version
    from public.course_enrolments where course_run_id = p_run_id and user_id = learner
      and status in ('enrolled','completed') for update;
    if not found then raise insufficient_privilege; end if;
    if exists(select 1 from private.course_completion_records where run_id = p_run_id and user_id = learner and revoked_at is null)
      then raise exception 'A current certificate preserves its completion record' using errcode = 'PT409'; end if;
    if p_action = 'pin' then
      if head = 0 or current_version <> p_expected_version or (p_payload->>'policy_version')::integer is distinct from head
        then raise exception 'Course completion policy or enrolment changed' using errcode = 'PT409'; end if;
      if current_version = head then return head; end if;
      update public.course_enrolments set course_completion_policy_version = head
        where course_run_id = p_run_id and user_id = learner;
      revision := head;
    else
      review_requirement := case when p_action = 'verify' then 'verification' else p_payload->>'requirement' end;
      if review_requirement is null or (p_action = 'exception' and review_requirement not in ('assignment','competency'))
        then raise invalid_parameter_value; end if;
      if current_version = 0 or (p_payload->>'policy_version')::integer is distinct from current_version
        or not exists (select 1 from private.course_completion_policies where run_id = p_run_id
          and version = current_version and case review_requirement
            when 'verification' then lecturer_verification
            when 'assignment' then assignment_id is not null
            when 'competency' then competency_pin is not null
          end)
        then raise exception 'Learner completion policy changed' using errcode = 'PT409'; end if;
      if jsonb_typeof(p_payload->'accepted') is distinct from 'boolean'
        or jsonb_typeof(p_payload->'reason') is distinct from 'string'
        or length(trim(p_payload->>'reason')) not between 3 and 500
        then raise invalid_parameter_value; end if;
      select coalesce(max(entry.revision), 0) into revision from private.course_completion_verifications entry
        where entry.run_id = p_run_id and entry.user_id = learner and entry.policy_version = current_version
          and entry.requirement = review_requirement;
      if revision <> p_expected_version then raise exception 'Completion review changed' using errcode = 'PT409'; end if;
      revision := revision + 1;
      insert into private.course_completion_verifications(run_id,user_id,policy_version,requirement,revision,accepted,reason,actor_id)
        values (p_run_id,learner,current_version,review_requirement,revision,(p_payload->>'accepted')::boolean,
          trim(p_payload->>'reason'),auth.uid());
    end if;
  end if;
  insert into public.audit_events(actor_id,action,resource_id,details)
    values(auth.uid(),'course_completion_policy.' || p_action,p_run_id,
      jsonb_build_object('learner',learner,'revision',revision,'requirement',review_requirement));
  return revision;
end;
$$;

create function public.course_completion_policy(p_run_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.course_completion_policy(p_run_id);
$$;
create function public.course_completion_policy_action(p_run_id uuid, p_action text, p_payload jsonb, p_expected_version integer)
returns integer language sql security invoker set search_path = '' as $$
  select private.course_completion_policy_action(p_run_id, p_action, p_payload, p_expected_version);
$$;
revoke all on function private.pin_course_completion_policy(), private.course_completion_policy_for(uuid,uuid),
  private.course_completion_assignment_released(uuid,uuid),
  private.course_completion_policy_check(uuid,uuid), private.course_completion_decision(uuid,uuid),
  private.course_completion_policy(uuid), public.course_completion_policy(uuid),
  private.course_completion_policy_action(uuid,text,jsonb,integer), public.course_completion_policy_action(uuid,text,jsonb,integer)
  from public, anon, authenticated, service_role;
grant execute on function private.course_completion_policy(uuid), public.course_completion_policy(uuid),
  private.course_completion_policy_action(uuid,text,jsonb,integer), public.course_completion_policy_action(uuid,text,jsonb,integer)
  to authenticated;

-- Preserve the historic deletion plan while making the new private records
-- visible to course/account deletion and fencing concurrent changes.
alter function private.deletion_scope(text,uuid) rename to deletion_scope_before_completion_policies;
create function private.deletion_scope(p_kind text, p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  scope jsonb := private.deletion_scope_before_completion_policies(p_kind, p_id);
  course_filter text := private.deletion_selector(scope, 'public.course_runs');
  profile_filter text := private.deletion_selector(scope, 'public.profiles');
  verification_filters text[] := '{}';
  by_course text;
begin
  if course_filter is not null then
    by_course := format('x.run_id in (select scoped.id from public.course_runs scoped where %s)', replace(course_filter, 'x.', 'scoped.'));
    scope := private.deletion_add_scope(scope, 'private.course_completion_policies', by_course);
    verification_filters := array_append(verification_filters, by_course);
  end if;
  if profile_filter is not null then
    verification_filters := array_append(verification_filters,
      format('x.user_id in (select scoped.id from public.profiles scoped where %s)', replace(profile_filter, 'x.', 'scoped.')));
  end if;
  if cardinality(verification_filters) > 0 then
    scope := private.deletion_add_scope(scope, 'private.course_completion_verifications', array_to_string(verification_filters, ' or '));
  end if;
  return scope;
end;
$$;
revoke all on function private.deletion_scope_before_completion_policies(text,uuid), private.deletion_scope(text,uuid)
  from public, anon, authenticated, service_role;
create trigger permanent_deletion_fence before insert or update or delete on private.course_completion_policies
  for each row execute function private.guard_permanent_deletion();
create trigger permanent_deletion_fence before insert or update or delete on private.course_completion_verifications
  for each row execute function private.guard_permanent_deletion();

do $migration$
declare
  academy text := pg_get_functiondef('private.require_academy_course_access()'::regprocedure);
  portal text := pg_get_functiondef('private.require_portal_access()'::regprocedure);
  read_anchor constant text := '''/rpc/course_completion_status''';
  anchor constant text := '  licence_status := private.academy_course_access_status();';
begin
  if cardinality(string_to_array(academy, anchor)) <> 2
    or cardinality(string_to_array(portal, read_anchor)) <> 2 then
    raise exception 'Expected licence gates for completion policies';
  end if;
  execute replace(portal, read_anchor, read_anchor || ', ''/rpc/course_completion_policy''');
  execute replace(academy, anchor, anchor || $routes$
  if request_method in ('POST','GET','HEAD') and licence_status in ('active','grace')
    and request_path = '/rpc/course_completion_policy' then return; end if;
  if request_method = 'POST' and licence_status = 'active'
    and request_path = '/rpc/course_completion_policy_action' then return; end if;$routes$);
end;
$migration$;

notify pgrst, 'reload schema';
COMMIT;
