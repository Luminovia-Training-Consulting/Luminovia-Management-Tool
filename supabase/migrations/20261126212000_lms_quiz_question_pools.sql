-- A quiz revision can opt into a pool of exact bank snapshots. The attempt
-- still belongs to the canonical scoring, completion and gradebook authorities.
BEGIN;

create table private.course_quiz_pool_blueprints (
  run_id uuid not null,
  quiz_version integer not null,
  draw_count smallint not null check (draw_count between 1 and 19),
  primary key (run_id, quiz_version),
  foreign key (run_id, quiz_version) references private.course_quiz_versions(run_id, version) on delete cascade
);
create table private.course_quiz_pool_draws (
  run_id uuid not null,
  quiz_version integer not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  attempt_number smallint not null check (attempt_number between 1 and 10),
  request_id uuid not null default gen_random_uuid(),
  positions integer[] not null check (cardinality(positions) between 1 and 19),
  created_at timestamptz not null default now(),
  primary key (run_id, quiz_version, user_id, attempt_number),
  unique (user_id, request_id),
  foreign key (run_id, quiz_version) references private.course_quiz_pool_blueprints(run_id, quiz_version) on delete cascade
);
alter table private.course_quiz_pool_blueprints enable row level security;
alter table private.course_quiz_pool_draws enable row level security;
revoke all on private.course_quiz_pool_blueprints, private.course_quiz_pool_draws from public, anon, authenticated, service_role;
create trigger course_quiz_pool_blueprint_immutable before update on private.course_quiz_pool_blueprints
  for each row execute function private.prevent_course_bank_revision_mutation();
create trigger course_quiz_pool_draw_immutable before update on private.course_quiz_pool_draws
  for each row execute function private.prevent_course_bank_revision_mutation();


-- A learner can retry or reload the current open draw. An accepted attempt
-- consumes the draw by matching the existing canonical request receipt.
create function private.current_quiz_pool_draw(p_run_id uuid, p_version integer)
returns private.course_quiz_pool_draws language sql stable set search_path = '' as $$
  select draw.* from private.course_quiz_pool_draws draw
  where draw.run_id = p_run_id and draw.quiz_version = p_version and draw.user_id = auth.uid()
    and not exists (
      select 1 from private.course_quiz_attempts attempt
      where attempt.user_id = draw.user_id and attempt.request_id = draw.request_id
    )
  order by draw.attempt_number desc limit 1;
$$;

-- Produce the same array order for partial draft validation and real scoring.
-- Existing fixed quizzes preserve their original visible and scoring order.
create function private.quiz_pool_attempt_questions(p_run_id uuid, p_version integer,
  p_request_id uuid, p_questions jsonb)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  chosen private.course_quiz_pool_draws;
begin
  if not exists (
    select 1 from private.course_quiz_pool_blueprints pool
    where pool.run_id = p_run_id and pool.quiz_version = p_version
  ) then return p_questions; end if;
  chosen := private.current_quiz_pool_draw(p_run_id, p_version);
  if chosen.request_id is null or chosen.request_id is distinct from p_request_id then
    raise exception 'Open the current quiz draw before saving or submitting answers' using errcode = 'PT409';
  end if;
  return (
    select jsonb_agg(p_questions->selection.position order by selection.ordinal)
    from unnest(chosen.positions) with ordinality selection(position, ordinal)
  );
end;
$$;

-- Keep lookup of source attribution in the canonical workspace projection.
-- This function only supplies visible positions, in their intended order.
create function private.quiz_pool_display_positions(p_run_id uuid, p_version integer,
  p_count integer, p_staff boolean, p_learner boolean)
returns table(question_index integer, sort_order bigint) language sql stable set search_path = '' as $$
  select item.position, (item.position + 1)::bigint
  from generate_series(0, p_count - 1) item(position)
  where p_staff or not exists (
    select 1 from private.course_quiz_pool_blueprints pool
    where pool.run_id = p_run_id and pool.quiz_version = p_version
  )
  union all
  select item.position, item.ordinal
  from unnest((private.current_quiz_pool_draw(p_run_id, p_version)).positions) with ordinality item(position, ordinal)
  where not p_staff and p_learner;
$$;

create function private.start_course_quiz_pool(p_run_id uuid, p_quiz_version integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  company_id uuid;
  context jsonb;
  quiz private.course_quiz_versions%rowtype;
  pool private.course_quiz_pool_blueprints%rowtype;
  chosen private.course_quiz_pool_draws%rowtype;
  accepted integer;
begin
  if actor_id is null then raise insufficient_privilege; end if;
  if p_quiz_version is null or p_quiz_version < 1 then raise invalid_parameter_value; end if;
  if (select edition from private.installation_identity) = 'internal' then
    perform private.lock_course_premium(p_run_id);
  else
    perform private.lock_academy_course_access();
  end if;
  perform 1 from public.profiles where id = actor_id and active for share;
  if not found then raise insufficient_privilege; end if;
  perform 1 from public.user_roles where user_id = actor_id and role = 'participant' for share;
  if not found then raise insufficient_privilege; end if;
  select run.organisation_id into company_id
  from public.course_runs run join public.organisations company on company.id = run.organisation_id
  where run.id = p_run_id and run.archived_at is null and company.archived_at is null
  for no key update of run for share of company;
  if not found then raise insufficient_privilege; end if;
  perform 1 from private.company_participant_memberships membership
    where membership.organisation_id = company_id and membership.user_id = actor_id and membership.status = 'active' for share;
  if not found then raise insufficient_privilege; end if;
  perform 1 from public.course_enrolments
    where course_run_id = p_run_id and user_id = actor_id and status in ('enrolled','completed') for share;
  if not found then raise insufficient_privilege; end if;
  context := private.course_workspace_context(p_run_id);
  if (context->>'learner')::boolean is not true then raise insufficient_privilege; end if;
  if not exists (select 1 from public.course_sessions where course_run_id = p_run_id and starts_at <= now())
    then raise exception 'Course must have started' using errcode = '22023'; end if;

  -- Serialize with drafts and accepted attempts before allocating the next slot.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('quiz-attempt:' || p_run_id || ':' || actor_id, 0));
  select revision.* into quiz from private.course_quizzes head
  join private.course_quiz_versions revision on revision.run_id = head.run_id and revision.version = head.version
  where head.run_id = p_run_id and revision.version = p_quiz_version and revision.published;
  if not found then raise exception 'Quiz changed' using errcode = 'PT409'; end if;
  select * into pool from private.course_quiz_pool_blueprints where run_id = p_run_id and quiz_version = p_quiz_version;
  if not found then raise invalid_parameter_value; end if;
  select count(*) into accepted from private.course_quiz_attempts attempt
  where attempt.run_id = p_run_id and attempt.quiz_version = p_quiz_version and attempt.user_id = actor_id;
  if accepted >= quiz.max_attempts or exists (
    select 1 from private.course_quiz_attempts attempt
    where attempt.run_id = p_run_id and attempt.quiz_version = p_quiz_version and attempt.user_id = actor_id and attempt.passed
  ) then raise exception 'Quiz attempt is closed' using errcode = 'PT409'; end if;

  select * into chosen from private.course_quiz_pool_draws draw
  where draw.run_id = p_run_id and draw.quiz_version = p_quiz_version and draw.user_id = actor_id
    and draw.attempt_number = accepted + 1;
  if not found then
    insert into private.course_quiz_pool_draws(run_id, quiz_version, user_id, attempt_number, positions)
    select p_run_id, p_quiz_version, actor_id, accepted + 1, array_agg(candidate.position order by candidate.ranking)
    from (
      select pool_item.position, random() as ranking
      from generate_series(0, jsonb_array_length(quiz.questions) - 1) pool_item(position)
      order by ranking limit pool.draw_count
    ) candidate
    returning * into chosen;
  end if;
  return jsonb_build_object('request_id', chosen.request_id, 'attempt_number', chosen.attempt_number);
end;
$$;

-- Own the configuration extension in the existing authoring transaction.
-- Only exact bank revisions may appear in an enabled pool.
do $migration$
declare
  definition text := pg_catalog.pg_get_functiondef('private.configure_bank_quiz(uuid,uuid,jsonb,integer,text)'::regprocedure);
  allowed_keys constant text := $keys$array['entries','published','pass_percent','max_attempts','shuffle']$keys$;
  loop_start constant text := '  for entry in';
  strip_keys constant text := $keys$array['entries','shuffle']$keys$;
  result constant text := $result$  return jsonb_build_object('version', p_expected_version + 1);$result$;
begin
  if cardinality(string_to_array(definition, allowed_keys)) <> 2 or cardinality(string_to_array(definition, loop_start)) <> 2
    or cardinality(string_to_array(definition, strip_keys)) <> 2 or cardinality(string_to_array(definition, result)) <> 2
    then raise exception 'Expected the existing quiz bank configuration boundaries'; end if;
  definition := replace(definition, allowed_keys, $keys$array['entries','published','pass_percent','max_attempts','shuffle','draw_count']$keys$);
  definition := replace(definition, loop_start, $validate$
  if p_payload ? 'draw_count' then
    if jsonb_typeof(p_payload->'draw_count') is distinct from 'number'
      or (p_payload->>'draw_count') !~ '^([1-9]|1[0-9])$' then raise invalid_parameter_value; end if;
    if (p_payload->>'draw_count')::integer >= jsonb_array_length(p_payload->'entries')
      or (p_payload->>'shuffle')::boolean or exists (
        select 1 from jsonb_array_elements(p_payload->'entries') candidate where not (candidate ? 'question_id')
      ) then raise invalid_parameter_value; end if;
  end if;
$validate$ || loop_start);
  definition := replace(definition, strip_keys, $keys$array['entries','shuffle','draw_count']$keys$);
  execute replace(definition, result, $persist$
  if p_payload ? 'draw_count' then
    insert into private.course_quiz_pool_blueprints(run_id, quiz_version, draw_count)
      values (p_run_id, p_expected_version + 1, (p_payload->>'draw_count')::smallint);
  end if;
$persist$ || result);
end;
$migration$;

-- A pooled draft and scored attempt both match the same immutable draw.
-- Accepted retries in the older attempt routine return before this check.
do $migration$
declare
  attempt text := pg_catalog.pg_get_functiondef('private.course_workspace_action_before_premium(uuid,text,jsonb,integer)'::regprocedure);
  draft text := pg_catalog.pg_get_functiondef('private.save_course_quiz_draft(uuid,integer,integer,uuid,integer,jsonb)'::regprocedure);
  attempt_anchor constant text := $anchor$  answers:=p_payload->'answers';$anchor$;
  draft_anchor constant text := '  if jsonb_array_length(p_answers) <> jsonb_array_length(quiz.questions)';
begin
  if cardinality(string_to_array(attempt, attempt_anchor)) <> 2 or cardinality(string_to_array(draft, draft_anchor)) <> 2
    then raise exception 'Expected quiz scoring and draft validation boundaries'; end if;
  execute replace(attempt, attempt_anchor, $draw$
  quiz.questions := private.quiz_pool_attempt_questions(p_run_id, quiz.version, (p_payload->>'request_id')::uuid, quiz.questions);
$draw$ || attempt_anchor);
  execute replace(draft, draft_anchor, $draw$
  quiz.questions := private.quiz_pool_attempt_questions(p_run_id, p_quiz_version, p_request_id, quiz.questions);
$draw$ || draft_anchor);
end;
$migration$;

-- Staff see the exact candidate snapshots. Other callers receive the
-- prompt/options for only their current draw. H5P credits use original positions.
do $migration$
declare
  workspace text := pg_catalog.pg_get_functiondef('private.course_workspace_before_premium(uuid)'::regprocedure);
  questions_start constant text := E'    select jsonb_agg(\n      case when (c->>''staff'')::boolean then';
  questions_end constant text := E'      order by item.position\n    )';
  questions_from constant text := '    from jsonb_array_elements(quiz.questions) with ordinality item(value, position)';
  attempts constant text := $anchor$'attempts',(select count(*)$anchor$;
begin
  if cardinality(string_to_array(workspace, questions_start)) <> 2 or cardinality(string_to_array(workspace, questions_end)) <> 2
    or cardinality(string_to_array(workspace, questions_from)) <> 2 or cardinality(string_to_array(workspace, attempts)) <> 2
    then raise exception 'Expected quiz workspace projection boundaries'; end if;
  workspace := replace(workspace, questions_start, replace(questions_start, 'select jsonb_agg', 'select coalesce(jsonb_agg'));
  workspace := replace(workspace, questions_end, $order$      order by selected.sort_order
    ), '[]'::jsonb)$order$);
  workspace := replace(workspace, questions_from, $pick$
    from private.quiz_pool_display_positions(
      p_run_id, quiz.version, jsonb_array_length(quiz.questions), (c->>'staff')::boolean, (c->>'learner')::boolean
    ) selected
    cross join lateral (select quiz.questions->selected.question_index as value, selected.question_index + 1 as position) item
$pick$);
  execute replace(workspace, attempts, $meta$
    'pool', (
      select jsonb_build_object('draw_count', pool.draw_count, 'request_id',
        case when (c->>'learner')::boolean and not (c->>'staff')::boolean
          then (private.current_quiz_pool_draw(p_run_id, quiz.version)).request_id end
      )
      from private.course_quiz_pool_blueprints pool where pool.run_id = p_run_id and pool.quiz_version = quiz.version
    ),
$meta$ || attempts);
end;
$migration$;

create function public.start_course_quiz_pool(p_run_id uuid, p_quiz_version integer)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.start_course_quiz_pool(p_run_id, p_quiz_version);
$$;
revoke all on function private.current_quiz_pool_draw(uuid,integer), private.quiz_pool_attempt_questions(uuid,integer,uuid,jsonb),
  private.quiz_pool_display_positions(uuid,integer,integer,boolean,boolean),
  private.start_course_quiz_pool(uuid,integer), public.start_course_quiz_pool(uuid,integer)
  from public, anon, authenticated, service_role;
grant execute on function private.start_course_quiz_pool(uuid,integer), public.start_course_quiz_pool(uuid,integer)
  to authenticated;

do $migration$
declare
  academy text := pg_catalog.pg_get_functiondef('private.require_academy_course_access()'::regprocedure);
  portal text := pg_catalog.pg_get_functiondef('private.require_portal_access()'::regprocedure);
  anchor constant text := '''/rpc/save_course_quiz_draft''';
begin
  if cardinality(string_to_array(academy, anchor)) <> 2 or cardinality(string_to_array(portal, anchor)) <> 2
    then raise exception 'Expected learner quiz draft gates'; end if;
  execute replace(academy, anchor, anchor || ', ''/rpc/start_course_quiz_pool''');
  execute replace(portal, '= ' || anchor, 'in (' || anchor || ', ''/rpc/start_course_quiz_pool'')');
end;
$migration$;

notify pgrst, 'reload schema';
COMMIT;
