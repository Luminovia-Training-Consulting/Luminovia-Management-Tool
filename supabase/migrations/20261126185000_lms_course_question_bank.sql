-- Keep reusable questions private and pin their exact revisions to canonical quizzes.
begin;

create table private.course_bank_questions (
  id uuid primary key,
  organisation_id uuid not null references public.organisations(id) on delete restrict,
  author_id uuid references public.profiles(id) on delete set null,
  revision integer not null check (revision > 0)
);
create index course_bank_questions_organisation on private.course_bank_questions(organisation_id, id);
create table private.course_bank_question_revisions (
  question_id uuid not null references private.course_bank_questions(id) on delete restrict,
  revision integer not null check (revision > 0),
  content jsonb not null,
  topic text not null check (length(topic) between 1 and 120),
  difficulty text not null check (difficulty in ('introductory', 'intermediate', 'advanced')),
  archived boolean not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  primary key (question_id, revision)
);
alter table private.course_bank_questions add constraint course_bank_current_revision
  foreign key (id, revision) references private.course_bank_question_revisions(question_id, revision)
  deferrable initially deferred;

create table private.course_quiz_bank_sources (
  run_id uuid not null,
  quiz_version integer not null,
  position integer not null check (position between 0 and 19),
  question_id uuid not null,
  question_revision integer not null,
  primary key (run_id, quiz_version, position),
  unique (run_id, quiz_version, question_id),
  foreign key (run_id, quiz_version) references private.course_quiz_versions(run_id, version) on delete cascade,
  foreign key (question_id, question_revision)
    references private.course_bank_question_revisions(question_id, revision) on delete restrict
);
create index course_quiz_bank_source_revision
  on private.course_quiz_bank_sources(question_id, question_revision);
alter table private.course_bank_questions enable row level security;
alter table private.course_bank_question_revisions enable row level security;
alter table private.course_quiz_bank_sources enable row level security;
revoke all on private.course_bank_questions, private.course_bank_question_revisions,
  private.course_quiz_bank_sources from public, anon, authenticated, service_role;

-- History is append-only, even if a future privileged handler reaches a retained row.
create function private.prevent_course_bank_revision_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Question bank revisions are immutable' using errcode = '55000';
end;
$$;
create trigger course_bank_question_revisions_immutable
before update or delete on private.course_bank_question_revisions
for each row execute function private.prevent_course_bank_revision_mutation();

-- Untrusted prompt and answer JSON is normalized before it reaches the owned
-- quiz transaction. The answer key is an index into the confirmed options.
create function private.validated_bank_quiz_item(p_item jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  options jsonb;
begin
  if jsonb_typeof(p_item) is distinct from 'object'
     or p_item - array['prompt','options','correct'] <> '{}'::jsonb
     or jsonb_typeof(p_item->'prompt') is distinct from 'string'
     or char_length(btrim(p_item->>'prompt')) not between 1 and 500
     or jsonb_typeof(p_item->'options') is distinct from 'array'
     or jsonb_typeof(p_item->'correct') is distinct from 'number'
     or (p_item->>'correct') !~ '^[0-5]$' then
    raise exception 'Invalid quiz question' using errcode = '22023';
  end if;
  if jsonb_array_length(p_item->'options') not between 2 and 6
    or (p_item->>'correct')::integer >= jsonb_array_length(p_item->'options')
    or exists (
      select 1 from jsonb_array_elements(p_item->'options') option_value
      where jsonb_typeof(option_value) is distinct from 'string'
        or char_length(btrim(option_value #>> '{}')) not between 1 and 300
    ) then
    raise exception 'Invalid quiz options' using errcode = '22023';
  end if;
  select jsonb_agg(btrim(value) order by position)
  into options from jsonb_array_elements_text(p_item->'options') with ordinality option_value(value, position);
  return jsonb_build_object('prompt', btrim(p_item->>'prompt'), 'options', options, 'correct', p_item->'correct');
end;
$$;

-- Use the current course entitlement and teaching assignment as the access
-- anchor, then scope the reusable pool to that course's organisation.
create function private.course_question_bank(p_run_id uuid, p_search text default '',
  p_include_archived boolean default false, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  context jsonb := private.course_workspace_context(p_run_id);
  company_id uuid;
  needle text := lower(btrim(p_search));
  items jsonb;
  writable boolean;
begin
  if auth.uid() is null or (context->>'staff')::boolean is not true
      or (context->>'lms_enabled')::boolean is not true then
    raise insufficient_privilege;
  end if;
  if needle is null or length(needle) > 120 or p_include_archived is null
      or p_offset is null or p_offset < 0 then raise invalid_parameter_value; end if;
  select run.organisation_id into company_id
  from public.course_runs run join public.organisations organisation on organisation.id = run.organisation_id
  where run.id = p_run_id and organisation.archived_at is null;
  if not found then raise insufficient_privilege; end if;
  writable := (select edition from private.installation_identity) = 'internal'
    or private.academy_course_access_status() = 'active';
  select coalesce(jsonb_agg(to_jsonb(page) order by page.id), '[]'::jsonb) into items
  from (
    select head.id, item.revision, item.content, item.topic, item.difficulty, item.archived,
      (writable and ((context->>'manager')::boolean or coalesce(head.author_id = auth.uid(), false))) as can_edit
    from private.course_bank_questions head
    join private.course_bank_question_revisions item
      on item.question_id = head.id and item.revision = head.revision
    where head.organisation_id = company_id and (p_include_archived or not item.archived)
      and (needle = '' or strpos(lower(item.topic), needle) > 0
        or strpos(lower(item.content->>'prompt'), needle) > 0)
    order by head.id
    limit 21 offset p_offset
  ) page;
  return jsonb_build_object('items', items - 20, 'has_more', jsonb_array_length(items) > 20);
end;
$$;

-- Resolve quiz sources and persist the snapshot in one transaction. Existing
-- quiz settings, scoring, attempt idempotency and notifications stay authoritative.
create function private.configure_bank_quiz(p_run_id uuid, p_company_id uuid,
  p_payload jsonb, p_expected_version integer, p_edition text)
returns jsonb language plpgsql volatile set search_path = '' as $$
declare
  entry jsonb;
  question private.course_bank_question_revisions%rowtype;
  questions jsonb := '[]'::jsonb;
  source_positions jsonb := '[]'::jsonb;
  seen uuid[] := '{}'::uuid[];
  position integer := 0;
  command jsonb;
begin
  if p_payload - array['entries','published','pass_percent','max_attempts','shuffle'] <> '{}'::jsonb
    or jsonb_typeof(p_payload->'entries') is distinct from 'array'
    or jsonb_typeof(p_payload->'published') is distinct from 'boolean'
    or jsonb_typeof(p_payload->'shuffle') is distinct from 'boolean'
    or jsonb_typeof(p_payload->'pass_percent') is distinct from 'number'
    or jsonb_typeof(p_payload->'max_attempts') is distinct from 'number'
    or (p_payload->>'pass_percent') !~ '^([5-9][0-9]|100)$'
    or (p_payload->>'max_attempts') !~ '^([1-9]|10)$' then raise invalid_parameter_value; end if;
  if jsonb_array_length(p_payload->'entries') not between 1 and 20 then raise invalid_parameter_value; end if;
  for entry in
    select value from jsonb_array_elements(p_payload->'entries') with ordinality item(value, ordinal)
    order by case when (p_payload->>'shuffle')::boolean then random() else ordinal::double precision end
  loop
    if entry ? 'question_id' then
      if entry - array['question_id', 'revision'] <> '{}'::jsonb
        or jsonb_typeof(entry->'question_id') is distinct from 'string'
        or (entry->>'question_id') !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
        or jsonb_typeof(entry->'revision') is distinct from 'number'
        or (entry->>'revision') !~ '^[1-9][0-9]{0,8}$' then raise invalid_parameter_value; end if;
      select revision.* into question
      from private.course_bank_questions head
      join private.course_bank_question_revisions revision on revision.question_id = head.id
      where head.organisation_id = p_company_id and head.id = (entry->>'question_id')::uuid
        and revision.revision = (entry->>'revision')::integer
        and ((revision.revision = head.revision and not revision.archived) or exists (
          select 1 from private.course_quiz_bank_sources source
          where source.run_id = p_run_id and source.quiz_version = p_expected_version
            and source.question_id = head.id and source.question_revision = revision.revision
        ))
      for share of head;
      if not found then
        raise exception 'Bank question is unavailable or changed' using errcode = 'PT409';
      end if;
      if question.question_id = any(seen) then raise invalid_parameter_value; end if;
      seen := array_append(seen, question.question_id);
      questions := questions || jsonb_build_array(question.content);
      source_positions := source_positions || jsonb_build_array(jsonb_build_object(
        'position', position, 'question_id', question.question_id, 'question_revision', question.revision
      ));
    else
      questions := questions || jsonb_build_array(private.validated_bank_quiz_item(entry));
    end if;
    position := position + 1;
  end loop;

  command := (p_payload - array['entries','shuffle']) || jsonb_build_object('questions', questions);
  if p_edition = 'internal' then
    perform private.course_workspace_action(p_run_id, 'quiz_config', command, p_expected_version);
  else
    perform private.academy_learning_action(p_run_id, 'quiz_config', command, p_expected_version);
  end if;
  insert into private.course_quiz_bank_sources(run_id, quiz_version, position, question_id, question_revision)
  select p_run_id, p_expected_version + 1, source.position, source.question_id, source.question_revision
  from jsonb_to_recordset(source_positions) source(position integer, question_id uuid, question_revision integer);
  return jsonb_build_object('version', p_expected_version + 1);
exception when serialization_failure then
  raise exception 'Quiz changed' using errcode = 'PT409';
end;
$$;

create function private.course_question_bank_action(p_run_id uuid, p_action text,
  p_payload jsonb, p_expected_version integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  edition text := (select identity.edition from private.installation_identity identity);
  context jsonb;
  company_id uuid;
  target_id uuid;
  current_head private.course_bank_questions%rowtype;
  current_item private.course_bank_question_revisions%rowtype;
  next_content jsonb;
  next_topic text;
  next_difficulty text;
  next_archived boolean;
begin
  if actor_id is null then raise insufficient_privilege; end if;
  if p_action is null or p_action not in ('save','set_archived','configure')
      or jsonb_typeof(p_payload) is distinct from 'object'
      or p_expected_version is null or p_expected_version < 0 then raise invalid_parameter_value; end if;
  -- Match the established course lock order and recheck the actor afterwards.
  if edition = 'internal' then
    perform private.lock_course_premium(p_run_id);
  else
    perform private.lock_academy_course_access();
  end if;
  perform 1 from public.profiles where id = actor_id and active for share;
  if not found then raise insufficient_privilege; end if;
  perform 1 from public.user_roles where user_id = actor_id order by role for share;
  select run.organisation_id into company_id
  from public.course_runs run join public.organisations organisation on organisation.id = run.organisation_id
  where run.id = p_run_id and run.archived_at is null and organisation.archived_at is null
  for no key update of run for share of organisation;
  if not found then raise insufficient_privilege; end if;
  perform 1 from public.job_claims claim join public.jobs job on job.id = claim.job_id
  where job.course_run_id = p_run_id and claim.lecturer_id = actor_id and claim.status = 'confirmed'
  for share of claim;
  context := private.course_workspace_context(p_run_id);
  if (context->>'staff')::boolean is not true or (context->>'lms_enabled')::boolean is not true then
    raise insufficient_privilege;
  end if;

  if p_action = 'configure' then
    return private.configure_bank_quiz(p_run_id, company_id, p_payload, p_expected_version, edition);
  end if;
  if jsonb_typeof(p_payload->'id') is distinct from 'string'
      or (p_payload->>'id') !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then
    raise invalid_parameter_value;
  end if;
  target_id := (p_payload->>'id')::uuid;
  if p_action = 'save' and p_expected_version = 0 then
    insert into private.course_bank_questions(id, organisation_id, author_id, revision)
    values (target_id, company_id, actor_id, 1) on conflict (id) do nothing;
  end if;
  select * into current_head from private.course_bank_questions
  where id = target_id and organisation_id = company_id for update;
  if not found or (current_head.author_id is distinct from actor_id and (context->>'manager')::boolean is not true) then
    raise insufficient_privilege;
  end if;
  select * into current_item from private.course_bank_question_revisions
  where question_id = target_id and revision = current_head.revision;
  if p_action = 'save' then
    if p_payload - array['id','content','topic','difficulty'] <> '{}'::jsonb
      or jsonb_typeof(p_payload->'topic') is distinct from 'string'
      or char_length(btrim(p_payload->>'topic')) not between 1 and 120
      or jsonb_typeof(p_payload->'difficulty') is distinct from 'string'
      or (p_payload->>'difficulty') not in ('introductory','intermediate','advanced') then
      raise invalid_parameter_value;
    end if;
    if current_item.archived then
      raise exception 'Restore the bank question before editing' using errcode = 'PT409';
    end if;
    next_content := private.validated_bank_quiz_item(p_payload->'content');
    next_topic := btrim(p_payload->>'topic');
    next_difficulty := p_payload->>'difficulty';
    next_archived := false;
  else
    if p_payload - array['id','archived'] <> '{}'::jsonb
      or jsonb_typeof(p_payload->'archived') is distinct from 'boolean' then raise invalid_parameter_value; end if;
    next_archived := (p_payload->>'archived')::boolean;
    next_content := current_item.content;
    next_topic := current_item.topic;
    next_difficulty := current_item.difficulty;
  end if;
  if current_item.revision is not null
    and p_expected_version between current_item.revision - 1 and current_item.revision
    and (current_item.content, current_item.topic, current_item.difficulty, current_item.archived)
      is not distinct from (next_content, next_topic, next_difficulty, next_archived) then
    return jsonb_build_object('id', target_id, 'version', current_item.revision);
  end if;
  if p_expected_version <> coalesce(current_item.revision, 0) then
    raise exception 'Bank question changed' using errcode = 'PT409';
  end if;
  insert into private.course_bank_question_revisions(question_id, revision, content, topic, difficulty, archived, created_by)
  values (target_id, p_expected_version + 1, next_content, next_topic, next_difficulty, next_archived, actor_id);
  update private.course_bank_questions set revision = p_expected_version + 1 where id = target_id;
  insert into public.audit_events(actor_id, action, resource_id, details)
  values (actor_id, 'course.question_bank.' || p_action, target_id,
    jsonb_build_object('run_id', p_run_id, 'revision', p_expected_version + 1, 'archived', next_archived));
  return jsonb_build_object('id', target_id, 'version', p_expected_version + 1);
end;
$$;

-- Keep sources separate from the canonical question JSON. The staff editor
-- gets the provenance; other audiences see a positive allowlist of safe keys.
do $migration$
declare
  definition text := pg_catalog.pg_get_functiondef('private.course_workspace_before_premium(uuid)'::regprocedure);
  anchor constant text := $old$case when (c->>'staff')::boolean then quiz.questions else (select jsonb_agg(q-'correct') from jsonb_array_elements(quiz.questions)q) end$old$;
begin
  if cardinality(string_to_array(definition, anchor)) <> 2 then raise exception 'Expected quiz projection'; end if;
  execute replace(definition, anchor, $new$(
    select jsonb_agg(
      case when (c->>'staff')::boolean then
        jsonb_build_object('prompt', item.value->'prompt', 'options', item.value->'options', 'correct', item.value->'correct')
        || case when source.question_id is null then '{}'::jsonb
          else jsonb_build_object('source', jsonb_build_object(
            'question_id', source.question_id, 'revision', source.question_revision)) end
      else jsonb_build_object('prompt', item.value->'prompt', 'options', item.value->'options') end
      order by item.position
    )
    from jsonb_array_elements(quiz.questions) with ordinality item(value, position)
    left join private.course_quiz_bank_sources source
      on source.run_id = p_run_id and source.quiz_version = quiz.version and source.position = item.position - 1
  )$new$);
end;
$migration$;

create function public.course_question_bank(p_run_id uuid, p_search text default '',
  p_include_archived boolean default false, p_offset integer default 0)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.course_question_bank(p_run_id, p_search, p_include_archived, p_offset);
$$;
create function public.course_question_bank_action(p_run_id uuid, p_action text, p_payload jsonb, p_expected_version integer)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.course_question_bank_action(p_run_id, p_action, p_payload, p_expected_version);
$$;

revoke all on function private.prevent_course_bank_revision_mutation(),
  private.validated_bank_quiz_item(jsonb),
  private.configure_bank_quiz(uuid, uuid, jsonb, integer, text),
  private.course_question_bank(uuid, text, boolean, integer),
  public.course_question_bank(uuid, text, boolean, integer),
  private.course_question_bank_action(uuid, text, jsonb, integer),
  public.course_question_bank_action(uuid, text, jsonb, integer)
  from public, anon, authenticated, service_role;
grant execute on function private.course_question_bank(uuid, text, boolean, integer),
  public.course_question_bank(uuid, text, boolean, integer),
  private.course_question_bank_action(uuid, text, jsonb, integer),
  public.course_question_bank_action(uuid, text, jsonb, integer) to authenticated;

-- Active and grace installations may read the bank, but only active ones can write.
do $migration$
declare
  definition text := pg_catalog.pg_get_functiondef('private.require_academy_course_access()'::regprocedure);
  read_anchor constant text := '''/rpc/course_gradebook''';
  write_anchor constant text := '''/rpc/course_content_action''';
begin
  if cardinality(string_to_array(definition, read_anchor)) <> 2
    or cardinality(string_to_array(definition, write_anchor)) <> 2 then raise exception 'Expected Academy LMS paths'; end if;
  execute replace(replace(definition, read_anchor, read_anchor || ', ''/rpc/course_question_bank'''),
    write_anchor, write_anchor || ', ''/rpc/course_question_bank_action''');
end;
$migration$;

notify pgrst, 'reload schema';
commit;
