-- A learner's recoverable answers precede, but never replace, the accepted quiz attempt.
begin;

create table private.course_quiz_answer_drafts (
  run_id uuid not null,
  quiz_version integer not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  attempt_number integer not null check (attempt_number between 1 and 10),
  revision integer not null check (revision > 0),
  request_id uuid not null,
  answers jsonb not null check (jsonb_typeof(answers) = 'array'),
  primary key (run_id, quiz_version, user_id),
  foreign key (run_id, quiz_version) references private.course_quiz_versions(run_id, version) on delete cascade
);
create index course_quiz_answer_drafts_user on private.course_quiz_answer_drafts(user_id);
alter table private.course_quiz_answer_drafts enable row level security;
revoke all on private.course_quiz_answer_drafts from public, anon, authenticated, service_role;

-- Save only the caller's currently eligible and still-open attempt. Revisions
-- prevent a second tab from silently replacing an earlier answered draft.
create function private.save_course_quiz_draft(p_run_id uuid, p_quiz_version integer,
  p_attempt_number integer, p_request_id uuid, p_expected_revision integer, p_answers jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  edition text := (select identity.edition from private.installation_identity identity);
  company_id uuid;
  context jsonb;
  quiz private.course_quiz_versions%rowtype;
  current_draft private.course_quiz_answer_drafts%rowtype;
  previous_attempts integer;
begin
  if actor_id is null then raise insufficient_privilege; end if;
  if p_quiz_version is null or p_quiz_version < 1 or p_request_id is null
    or p_attempt_number is null or p_attempt_number not between 1 and 10
    or p_expected_revision is null or p_expected_revision < 0
    or jsonb_typeof(p_answers) is distinct from 'array' then raise invalid_parameter_value; end if;
  if edition = 'internal' then
    perform private.lock_course_premium(p_run_id);
  else
    perform private.lock_academy_course_access();
  end if;
  perform 1 from public.profiles where id = actor_id and active for share;
  if not found then raise insufficient_privilege; end if;
  perform 1 from public.user_roles where user_id = actor_id and role = 'participant' for share;
  if not found then raise insufficient_privilege; end if;
  select run.organisation_id into company_id
  from public.course_runs run join public.organisations organisation on organisation.id = run.organisation_id
  where run.id = p_run_id and run.archived_at is null and organisation.archived_at is null
  for no key update of run for share of organisation;
  if not found then raise insufficient_privilege; end if;
  perform 1 from private.company_participant_memberships
  where organisation_id = company_id and user_id = actor_id and status = 'active' for share;
  if not found then raise insufficient_privilege; end if;
  perform 1 from public.course_enrolments
  where course_run_id = p_run_id and user_id = actor_id and status in ('enrolled','completed') for share;
  if not found then raise insufficient_privilege; end if;
  context := private.course_workspace_context(p_run_id);
  if (context->>'learner')::boolean is not true then raise insufficient_privilege; end if;
  if not exists (
    select 1 from public.course_sessions where course_run_id = p_run_id and starts_at <= now()
  ) then raise exception 'Course must have started' using errcode = '22023'; end if;

  -- Same order and advisory key as the canonical attempt transaction, so
  -- submitting and deleting an attempt cannot race with a stale draft write.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'quiz-attempt:' || p_run_id || ':' || actor_id, 0
  ));
  select revision.* into quiz from private.course_quizzes head
  join private.course_quiz_versions revision on revision.run_id = head.run_id and revision.version = head.version
  where head.run_id = p_run_id and revision.version = p_quiz_version and revision.published;
  if not found then raise exception 'Quiz changed' using errcode = 'PT409'; end if;
  select count(*) into previous_attempts from private.course_quiz_attempts attempt
  where attempt.run_id = p_run_id and attempt.quiz_version = p_quiz_version and attempt.user_id = actor_id;
  if p_attempt_number <> previous_attempts + 1 or previous_attempts >= quiz.max_attempts or exists (
    select 1 from private.course_quiz_attempts attempt where attempt.run_id = p_run_id
      and attempt.quiz_version = p_quiz_version and attempt.user_id = actor_id and attempt.passed
  ) then raise exception 'Quiz attempt is closed' using errcode = 'PT409'; end if;

  if jsonb_array_length(p_answers) <> jsonb_array_length(quiz.questions) or exists (
    select 1 from jsonb_array_elements(p_answers) with ordinality answer(value, position)
    where case
      when answer.value = 'null'::jsonb then false
      when jsonb_typeof(answer.value) = 'number' and (answer.value #>> '{}') ~ '^[0-5]$' then
        (answer.value #>> '{}')::integer >= jsonb_array_length(quiz.questions->(answer.position::integer - 1)->'options')
      else true
    end
  ) then raise invalid_parameter_value; end if;

  select * into current_draft from private.course_quiz_answer_drafts draft
  where draft.run_id = p_run_id and draft.quiz_version = p_quiz_version and draft.user_id = actor_id
  for update;
  if found and (current_draft.attempt_number <> p_attempt_number or current_draft.request_id <> p_request_id) then
    raise exception 'Quiz draft changed' using errcode = 'PT409';
  end if;
  if current_draft.answers = p_answers
    and p_expected_revision between current_draft.revision - 1 and current_draft.revision then
    return current_draft.revision;
  end if;
  if coalesce(current_draft.revision, 0) <> p_expected_revision then
    raise exception 'Quiz draft changed' using errcode = 'PT409';
  end if;
  insert into private.course_quiz_answer_drafts(run_id, quiz_version, user_id, attempt_number, revision, request_id, answers)
  values (p_run_id, p_quiz_version, actor_id, p_attempt_number, p_expected_revision + 1, p_request_id, p_answers)
  on conflict (run_id, quiz_version, user_id) do update set
    revision = excluded.revision, answers = excluded.answers;
  return p_expected_revision + 1;
end;
$$;

-- A draft has no remaining purpose once consumed or superseded. The
-- canonical attempt keeps its own immutable answers and request receipt.
create function private.clear_accepted_quiz_answer_draft()
returns trigger language plpgsql set search_path = '' as $$
begin
  delete from private.course_quiz_answer_drafts
    where run_id = new.run_id and quiz_version = new.quiz_version and user_id = new.user_id;
  return null;
end;
$$;
create function private.clear_superseded_quiz_answer_drafts()
returns trigger language plpgsql set search_path = '' as $$
begin
  delete from private.course_quiz_answer_drafts where run_id = new.run_id and quiz_version < new.version;
  return null;
end;
$$;
create trigger course_quiz_answer_drafts_consumed after insert on private.course_quiz_attempts
  for each row execute function private.clear_accepted_quiz_answer_draft();
create trigger course_quiz_answer_drafts_superseded after insert on private.course_quiz_versions
  for each row execute function private.clear_superseded_quiz_answer_drafts();

-- Append the caller's own recoverable answers only to the eligible learner
-- view. Staff and company contact projections never include anyone's draft.
do $migration$
declare
  definition text := pg_catalog.pg_get_functiondef('private.course_workspace_before_premium(uuid)'::regprocedure);
  anchor constant text := $anchor$'attempts',(select count(*)$anchor$;
begin
  if cardinality(string_to_array(definition, anchor)) <> 2 then raise exception 'Expected quiz attempt projection'; end if;
  execute replace(definition, anchor, $addition$
     'draft',case when (c->>'learner')::boolean and not (c->>'staff')::boolean and quiz.published then (
       select jsonb_build_object('request_id', draft.request_id, 'revision', draft.revision, 'answers', draft.answers)
       from private.course_quiz_answer_drafts draft
       where draft.run_id = r.id and draft.quiz_version = quiz.version and draft.user_id = auth.uid()
     ) end,
  $addition$ || anchor);
end;
$migration$;

create function public.save_course_quiz_draft(p_run_id uuid, p_quiz_version integer,
  p_attempt_number integer, p_request_id uuid, p_expected_revision integer, p_answers jsonb)
returns integer language sql security invoker set search_path = '' as $$
  select private.save_course_quiz_draft(p_run_id, p_quiz_version, p_attempt_number,
    p_request_id, p_expected_revision, p_answers);
$$;
revoke all on function private.save_course_quiz_draft(uuid, integer, integer, uuid, integer, jsonb),
  public.save_course_quiz_draft(uuid, integer, integer, uuid, integer, jsonb),
  private.clear_accepted_quiz_answer_draft(), private.clear_superseded_quiz_answer_drafts()
  from public, anon, authenticated, service_role;
grant execute on function private.save_course_quiz_draft(uuid, integer, integer, uuid, integer, jsonb),
  public.save_course_quiz_draft(uuid, integer, integer, uuid, integer, jsonb) to authenticated;

-- Permit the write for participant sessions in the owning editions, with
-- the same active-only dedicated Academy licence gate as submitted attempts.
do $migration$
declare
  academy text := pg_catalog.pg_get_functiondef('private.require_academy_course_access()'::regprocedure);
  portal text := pg_catalog.pg_get_functiondef('private.require_portal_access()'::regprocedure);
  write_anchor constant text := '''/rpc/course_question_bank_action''';
  fallback_anchor constant text := '  perform private.require_portal_access_before_course_content();';
begin
  if cardinality(string_to_array(academy, write_anchor)) <> 2
    or cardinality(string_to_array(portal, fallback_anchor)) <> 2 then raise exception 'Expected quiz draft ingress'; end if;
  execute replace(academy, write_anchor, write_anchor || ', ''/rpc/save_course_quiz_draft''');
  execute replace(portal, fallback_anchor, $internal$
  if current_setting('request.path', true) = '/rpc/save_course_quiz_draft'
     and current_setting('request.method', true) = 'POST'
     and (select edition from private.installation_identity) = 'internal'
     and private.participant_actor() then
    return;
  end if;
$internal$ || fallback_anchor);
end;
$migration$;

notify pgrst, 'reload schema';
commit;
