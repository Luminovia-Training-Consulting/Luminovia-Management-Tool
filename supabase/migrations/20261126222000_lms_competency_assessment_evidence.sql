-- Record the title and released grade of an exact assignment review with a competency decision.
BEGIN;

alter table private.lms_competency_decisions
  add column assignment_evidence jsonb check (assignment_evidence is null or jsonb_typeof(assignment_evidence) = 'object');

create function private.competency_assignment_evidence(p_run_id uuid, p_user_id uuid, p_assignment_id uuid)
returns jsonb language plpgsql stable strict set search_path = '' as $$
declare
  evidence jsonb := private.course_weighted_source(p_run_id, p_user_id, p_assignment_id::text);
begin
  if evidence->>'review_state' is distinct from 'released' or evidence->>'score' is null then
    return null;
  end if;
  return (
    select jsonb_build_object(
      'assignment_id', p_assignment_id, 'attempt_id', evidence->'attempt', 'review_version', evidence->'revision',
      'title', definition.title, 'score', round((evidence->>'score')::numeric,2))
    from private.course_assignment_definitions definition
    where definition.assignment_id = p_assignment_id and definition.version = (evidence->>'assignment_version')::integer
  );
end;
$$;

revoke all on function private.competency_assignment_evidence(uuid,uuid,uuid)
  from public, anon, authenticated, service_role;

create or replace function private.course_competencies(p_run_id uuid, p_user_id uuid default null, p_offset integer default 0)
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
  assignment_evidence jsonb := '[]'::jsonb;
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
        decision.evidence_note, decision.created_at, decision.assignment_evidence,
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
  if staff and writable and subject is not null and pinned_framework is not null then
    select coalesce(jsonb_agg(choice.evidence order by choice.evidence->>'title', assignment.id), '[]'::jsonb)
    into assignment_evidence
    from private.course_assignments assignment
    cross join lateral (select private.competency_assignment_evidence(p_run_id, subject, assignment.id) evidence
      offset 0) choice
    where assignment.run_id = p_run_id and assignment.published_version is not null
      and choice.evidence is not null;
  end if;
  return jsonb_build_object('can_manage', manager and writable, 'can_assess', staff and writable,
    'assignment_options', assignment_evidence,
    'pin_revision', coalesce(current_pin.revision, 0), 'pinned_framework', pinned_framework,
    'frameworks', framework_options, 'decisions', decisions - 50, 'current_revisions', current_decisions,
    'has_more', jsonb_array_length(decisions) > 50);
end;
$$;

create or replace function private.course_competency_action(p_run_id uuid, p_action text,
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
  requested_assignment jsonb := p_payload->'assignment_evidence';
  assignment_snapshot jsonb;
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

  if p_payload - array['pin_revision','user_id','competency_id','level_id','evidence_note','include_quiz','assignment_evidence'] <> '{}'::jsonb
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
  if requested_assignment is not null then
    if jsonb_typeof(requested_assignment) <> 'object'
      or requested_assignment - array['assignment_id','attempt_id','review_version'] <> '{}'::jsonb
      or jsonb_typeof(requested_assignment->'assignment_id') is distinct from 'string'
      or jsonb_typeof(requested_assignment->'attempt_id') is distinct from 'string'
      or jsonb_typeof(requested_assignment->'review_version') is distinct from 'number'
      then raise invalid_parameter_value; end if;
    assignment_snapshot := private.competency_assignment_evidence(
      p_run_id, subject, (requested_assignment->>'assignment_id')::uuid);
    if assignment_snapshot is null
      or (assignment_snapshot - array['title','score']) is distinct from requested_assignment then
      raise exception 'Released assignment evidence changed' using errcode = 'PT409';
    end if;
  end if;
  select * into previous_decision from private.lms_competency_decisions decision
    where decision.run_id = p_run_id and decision.pin_revision = current_pin.revision and decision.user_id = subject
      and decision.competency_id = target_competency_id
    order by decision.revision desc limit 1;
  decision_revision := coalesce(previous_decision.revision, 0);
  if decision_revision = p_expected_revision + 1
    and (previous_decision.level_id, previous_decision.evidence_note, previous_decision.quiz_attempt_id, previous_decision.assignment_evidence)
      is not distinct from (target_level_id, note, evidence, assignment_snapshot) then
    return jsonb_build_object('revision', decision_revision);
  end if;
  if decision_revision <> p_expected_revision then raise exception 'Decision changed' using errcode = 'PT409'; end if;
  insert into private.lms_competency_decisions(run_id, pin_revision, user_id, competency_id, revision, level_id,
    evidence_note, quiz_attempt_id, created_by, assignment_evidence)
    values (p_run_id, current_pin.revision, subject, target_competency_id, decision_revision + 1, target_level_id, note, evidence, actor_id, assignment_snapshot);
  return jsonb_build_object('revision', decision_revision + 1);
end;
$$;

COMMIT;
