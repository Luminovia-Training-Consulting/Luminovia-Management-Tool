BEGIN;

create table private.course_text_exam_versions (
  run_id uuid not null references public.course_runs(id) on delete cascade,
  revision integer not null check (revision > 0),
  title text not null check (char_length(title) between 1 and 160),
  opens_at timestamptz not null,
  closes_at timestamptz not null check (closes_at > opens_at),
  pass_percent integer not null check (pass_percent between 1 and 100),
  questions jsonb not null check (jsonb_typeof(questions) = 'array'),
  published_at timestamptz,
  primary key (run_id, revision)
);

create table private.course_text_exam_attempts (
  run_id uuid not null,
  exam_revision integer not null,
  learner_id uuid not null references public.profiles(id) on delete cascade,
  revision integer not null check (revision > 0),
  answers jsonb not null check (jsonb_typeof(answers) = 'array'),
  submitted_at timestamptz,
  primary key (run_id, exam_revision, learner_id),
  foreign key (run_id, exam_revision) references private.course_text_exam_versions(run_id, revision) on delete cascade
);

create table private.course_text_exam_reviews (
  run_id uuid not null,
  exam_revision integer not null,
  learner_id uuid not null,
  revision integer not null check (revision > 0),
  points jsonb not null check (jsonb_typeof(points) = 'array'),
  feedback text not null check (char_length(feedback) <= 4000),
  released_at timestamptz,
  primary key (run_id, exam_revision, learner_id, revision),
  foreign key (run_id, exam_revision, learner_id)
    references private.course_text_exam_attempts(run_id, exam_revision, learner_id) on delete cascade
);

alter table private.course_text_exam_versions enable row level security;
alter table private.course_text_exam_attempts enable row level security;
alter table private.course_text_exam_reviews enable row level security;
revoke all on private.course_text_exam_versions, private.course_text_exam_attempts,
  private.course_text_exam_reviews from public, anon, authenticated, service_role;

create function private.course_text_exam_review_payload(
  p_review private.course_text_exam_reviews, p_exam private.course_text_exam_versions
) returns jsonb language sql immutable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'revision', p_review.revision, 'points', p_review.points, 'feedback', p_review.feedback,
    'released_at', p_review.released_at, 'score', actual.total, 'max_points', maximum.total,
    'passed', actual.total * 100 >= maximum.total * p_exam.pass_percent
  )
  from (select sum(point::integer) total from jsonb_array_elements_text(p_review.points) point) actual
  cross join (select sum((question->>'max_points')::integer) total from jsonb_array_elements(p_exam.questions) question) maximum
  where p_review.revision is not null;
$$;

-- Give staff a paged list of submitted work. A learner can read only their
-- own attempt and latest released review, including after a new exam version.
create function private.course_text_exam(
  p_run_id uuid, p_revision integer, p_learner_id uuid, p_offset integer
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  who uuid := auth.uid();
  context jsonb := private.course_workspace_context(p_run_id);
  academy text := private.academy_course_access_status();
  staff boolean := (context->>'staff')::boolean is true;
  writable boolean := (select edition from private.installation_identity) = 'internal' or academy = 'active';
  exam private.course_text_exam_versions%rowtype;
  attempt private.course_text_exam_attempts%rowtype;
  review private.course_text_exam_reviews%rowtype;
  deadline timestamptz;
  paper jsonb;
  versions jsonb;
  submissions jsonb;
  has_more boolean := false;
  selected_learner uuid;
begin
  if who is null or (context->>'lms_enabled')::boolean is not true
    or not (staff or (context->>'learner')::boolean is true)
    or ((select edition from private.installation_identity) <> 'internal' and coalesce(academy, '') not in ('active','grace'))
    or (p_learner_id is not null and not staff)
    then raise insufficient_privilege; end if;
  if p_offset is null or p_offset not between 0 and 1000000 or (p_revision is not null and p_revision < 1)
    then raise invalid_parameter_value; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'revision', version.revision, 'title', version.title, 'published_at', version.published_at
  ) order by version.revision desc), '[]'::jsonb) into versions
  from private.course_text_exam_versions version
  where version.run_id = p_run_id and (staff or version.published_at is not null);

  select version.* into exam from private.course_text_exam_versions version
  where version.run_id = p_run_id and (p_revision is null or version.revision = p_revision)
    and (staff or version.published_at is not null)
  order by case
    when not staff and statement_timestamp() >= version.opens_at
      and statement_timestamp() < version.closes_at + make_interval(mins => private.course_exam_extra_minutes(p_run_id, who))
    then 0 else 1 end, version.revision desc limit 1;

  if exam.revision is not null then
    selected_learner := case when staff then p_learner_id else who end;
    deadline := exam.closes_at;
    if staff and exam.published_at is not null then
      deadline := private.course_exam_grading_deadline(p_run_id, exam.closes_at);
      select coalesce(jsonb_agg(jsonb_build_object(
        'learner_id', submission.learner_id, 'name', submission.display_name, 'submitted_at', submission.submitted_at,
        'review_state', submission.review_state
      ) order by submission.learner_id) filter (where submission.position <= 25), '[]'::jsonb),
        count(*) > 25 into submissions, has_more
      from (
        select candidate.learner_id, profile.display_name, candidate.submitted_at,
          case when assessment.released_at is not null then 'released'
            when assessment.revision is not null then 'draft' else 'ungraded' end review_state,
          row_number() over (order by candidate.learner_id) - p_offset as position
        from private.course_text_exam_attempts candidate
        join public.profiles profile on profile.id = candidate.learner_id
        left join lateral (
          select assessment.revision, assessment.released_at
          from private.course_text_exam_reviews assessment
          where assessment.run_id = p_run_id and assessment.exam_revision = exam.revision
            and assessment.learner_id = candidate.learner_id
          order by assessment.revision desc limit 1
        ) assessment on true
        where candidate.run_id = p_run_id and candidate.exam_revision = exam.revision
          and candidate.submitted_at is not null and candidate.learner_id <> who
        order by candidate.learner_id offset p_offset limit 26
      ) submission;
    elsif not staff then
      deadline := exam.closes_at + make_interval(mins => private.course_exam_extra_minutes(p_run_id, who));
    end if;
    paper := jsonb_build_object(
      'revision', exam.revision, 'title', exam.title, 'opens_at', exam.opens_at, 'closes_at', exam.closes_at,
      'deadline', deadline, 'pass_percent', exam.pass_percent, 'published_at', exam.published_at,
      'questions', case when staff or statement_timestamp() >= exam.opens_at then exam.questions end
    );

    if selected_learner is not null and (not staff or selected_learner <> who) then
      select candidate.* into attempt from private.course_text_exam_attempts candidate
      where candidate.run_id = p_run_id and candidate.exam_revision = exam.revision
        and candidate.learner_id = selected_learner and (not staff or candidate.submitted_at is not null)
        and (staff or statement_timestamp() >= exam.opens_at);
      if attempt.submitted_at is not null then
        select assessment.* into review from private.course_text_exam_reviews assessment
        where assessment.run_id = p_run_id and assessment.exam_revision = exam.revision
          and assessment.learner_id = selected_learner and (staff or assessment.released_at is not null)
        order by assessment.revision desc limit 1;
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'now', statement_timestamp(), 'staff', staff, 'can_write', writable,
    'can_author', writable and (context->>'manager')::boolean is true,
    'head_revision', case when staff then coalesce((versions->0->>'revision')::integer, 0) end,
    'versions', versions, 'exam', paper, 'submissions', coalesce(submissions, '[]'::jsonb), 'has_more', has_more,
    'attempt', case when attempt.revision is not null then jsonb_build_object(
      'revision', attempt.revision, 'answers', attempt.answers, 'submitted_at', attempt.submitted_at
    ) end,
    'review', private.course_text_exam_review_payload(review, exam)
  );
end;
$$;

-- Checks current access and serializes commands on the same locked course
-- row as exam settings and enrolment changes.
create function private.lock_course_text_exam_actor(p_run_id uuid, p_action text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  who uuid := auth.uid();
  course_org uuid;
  context jsonb;
begin
  if who is null then raise insufficient_privilege; end if;
  if (select edition from private.installation_identity) = 'internal' then
    perform private.lock_course_premium(p_run_id);
  else
    perform private.lock_academy_course_access();
  end if;
  perform 1 from public.profiles where id = who and active for share;
  if not found then raise insufficient_privilege; end if;
  perform 1 from public.user_roles where user_id = who order by role for share;
  select run.organisation_id into course_org from public.course_runs run
    join public.organisations company on company.id = run.organisation_id
    where run.id = p_run_id and run.archived_at is null and company.archived_at is null
    for no key update of run for share of company;
  if not found then raise insufficient_privilege; end if;
  if p_action in ('save_answers','submit') then
    perform 1 from private.company_participant_memberships
      where organisation_id = course_org and user_id = who and status = 'active' for share;
    if not found then raise insufficient_privilege; end if;
    perform 1 from public.course_enrolments
      where course_run_id = p_run_id and user_id = who and status in ('enrolled','completed') for share;
    if not found then raise insufficient_privilege; end if;
  else
    perform 1 from public.job_claims claim join public.jobs job on job.id = claim.job_id
      where job.course_run_id = p_run_id and claim.lecturer_id = who and claim.status = 'confirmed'
      for share of claim;
  end if;
  context := private.course_workspace_context(p_run_id);
  if (context->>'lms_enabled')::boolean is not true
    or (context->>case when p_action in ('save_exam','publish') then 'manager'
      when p_action in ('save_answers','submit') then 'learner' else 'staff' end)::boolean is not true
    then raise insufficient_privilege; end if;
end;
$$;

create function private.course_text_exam_author(
  p_run_id uuid, p_action text, p_expected integer, p_payload jsonb
) returns integer language plpgsql security invoker set search_path = '' as $$
declare
  head private.course_text_exam_versions%rowtype;
  opens timestamptz;
  closes timestamptz;
  threshold integer;
  question jsonb;
  validated_questions jsonb := '[]'::jsonb;
begin
  select * into head from private.course_text_exam_versions where run_id = p_run_id order by revision desc limit 1;
  if p_action = 'save_exam' then
    if p_payload - array['title','opens_at','closes_at','pass_percent','questions'] <> '{}'::jsonb
      or jsonb_typeof(p_payload->'title') is distinct from 'string'
      or char_length(btrim(p_payload->>'title')) not between 1 and 160
      or jsonb_typeof(p_payload->'opens_at') is distinct from 'string'
      or jsonb_typeof(p_payload->'closes_at') is distinct from 'string'
      or jsonb_typeof(p_payload->'pass_percent') is distinct from 'number'
      or (p_payload->>'pass_percent') !~ '^[1-9][0-9]{0,2}$'
      or jsonb_typeof(p_payload->'questions') is distinct from 'array'
      then raise invalid_parameter_value; end if;
    opens := (p_payload->>'opens_at')::timestamptz;
    closes := (p_payload->>'closes_at')::timestamptz;
    threshold := (p_payload->>'pass_percent')::integer;
    if not isfinite(opens) or not isfinite(closes) or closes <= opens or closes - opens > interval '7 days'
      or threshold > 100 or jsonb_array_length(p_payload->'questions') not between 1 and 20
      then raise invalid_parameter_value; end if;
    for question in select value from jsonb_array_elements(p_payload->'questions') loop
      if jsonb_typeof(question) is distinct from 'object'
        or question - array['prompt','max_points'] <> '{}'::jsonb
        or jsonb_typeof(question->'prompt') is distinct from 'string'
        or char_length(btrim(question->>'prompt')) not between 1 and 2000
        or jsonb_typeof(question->'max_points') is distinct from 'number'
        or (question->>'max_points') !~ '^[1-9][0-9]{0,2}$'
        then raise invalid_parameter_value; end if;
      validated_questions := validated_questions || jsonb_build_object(
        'prompt', btrim(question->>'prompt'), 'max_points', question->'max_points'
      );
    end loop;
    if head.revision in (p_expected, p_expected + 1) and head.title = btrim(p_payload->>'title')
      and head.opens_at = opens and head.closes_at = closes and head.pass_percent = threshold
      and head.questions = validated_questions then return head.revision; end if;
    if coalesce(head.revision, 0) <> p_expected
      then raise exception 'Text exam draft changed' using errcode = 'PT409'; end if;
    insert into private.course_text_exam_versions(run_id, revision, title, opens_at, closes_at, pass_percent, questions)
      values (p_run_id, p_expected + 1, btrim(p_payload->>'title'), opens, closes, threshold, validated_questions);
    return p_expected + 1;
  end if;

  if p_payload <> '{}'::jsonb then raise invalid_parameter_value; end if;
  if head.revision is distinct from p_expected
    then raise exception 'Text exam draft changed' using errcode = 'PT409'; end if;
  if head.published_at is not null then return head.revision; end if;
  if head.closes_at <= clock_timestamp() then raise invalid_parameter_value; end if;
  if exists (
    select 1 from private.course_text_exam_versions previous
    where previous.run_id = p_run_id and previous.published_at is not null
      and tstzrange(previous.opens_at, private.course_exam_grading_deadline(p_run_id, previous.closes_at)) &&
        tstzrange(head.opens_at, private.course_exam_grading_deadline(p_run_id, head.closes_at))
  ) then raise exception 'Published text exam windows overlap' using errcode = 'PT409'; end if;
  update private.course_text_exam_versions set published_at = clock_timestamp()
    where run_id = p_run_id and revision = head.revision;
  return head.revision;
end;
$$;

create function private.course_text_exam_submit(
  p_exam private.course_text_exam_versions, p_action text, p_expected integer, p_payload jsonb
) returns integer language plpgsql security invoker set search_path = '' as $$
declare
  who uuid := auth.uid();
  previous private.course_text_exam_attempts%rowtype;
  answer jsonb;
  submitted timestamptz;
  checked_at timestamptz;
begin
  if p_payload - 'answers' <> '{}'::jsonb or jsonb_typeof(p_payload->'answers') is distinct from 'array'
    then raise invalid_parameter_value; end if;
  if jsonb_array_length(p_payload->'answers') <> jsonb_array_length(p_exam.questions)
    then raise invalid_parameter_value; end if;
  for answer in select value from jsonb_array_elements(p_payload->'answers') loop
    if jsonb_typeof(answer) is distinct from 'string' or char_length(answer #>> '{}') > 4000
      or (p_action = 'submit' and (answer #>> '{}') !~ '[^[:space:]]')
      then raise invalid_parameter_value; end if;
  end loop;
  select * into previous from private.course_text_exam_attempts
  where run_id = p_exam.run_id and exam_revision = p_exam.revision and learner_id = who;
  if previous.revision = p_expected + 1 and previous.answers = p_payload->'answers'
    and (previous.submitted_at is not null) = (p_action = 'submit') then return previous.revision; end if;
  if previous.submitted_at is not null or coalesce(previous.revision, 0) <> p_expected
    then raise exception 'Text exam answers changed' using errcode = 'PT409'; end if;
  checked_at := clock_timestamp();
  if checked_at < p_exam.opens_at
    or checked_at >= p_exam.closes_at + make_interval(mins => private.course_exam_extra_minutes(p_exam.run_id, who))
    then raise exception 'Text exam is closed' using errcode = 'PT409'; end if;
  if p_action = 'submit' then submitted := checked_at; end if;
  insert into private.course_text_exam_attempts(run_id, exam_revision, learner_id, revision, answers, submitted_at)
    values (p_exam.run_id, p_exam.revision, who, p_expected + 1, p_payload->'answers', submitted)
    on conflict (run_id, exam_revision, learner_id) do update set
      revision = excluded.revision, answers = excluded.answers, submitted_at = excluded.submitted_at;
  return p_expected + 1;
end;
$$;

create function private.course_text_exam_grade(
  p_exam private.course_text_exam_versions, p_action text, p_expected integer, p_payload jsonb
) returns integer language plpgsql security invoker set search_path = '' as $$
declare
  target uuid;
  head private.course_text_exam_reviews%rowtype;
  item jsonb;
  position integer;
begin
  if jsonb_typeof(p_payload->'learner_id') is distinct from 'string' then raise invalid_parameter_value; end if;
  target := (p_payload->>'learner_id')::uuid;
  if target = auth.uid() or not exists (
    select 1 from private.course_text_exam_attempts attempt
    where attempt.run_id = p_exam.run_id and attempt.exam_revision = p_exam.revision
      and attempt.learner_id = target and attempt.submitted_at is not null
  ) then raise insufficient_privilege; end if;
  if clock_timestamp() < private.course_exam_grading_deadline(p_exam.run_id, p_exam.closes_at)
    then raise exception 'Text exam is still open' using errcode = 'PT409'; end if;
  select * into head from private.course_text_exam_reviews
  where run_id = p_exam.run_id and exam_revision = p_exam.revision and learner_id = target
  order by revision desc limit 1;

  if p_action = 'save_review' then
    if p_payload - array['learner_id','points','feedback'] <> '{}'::jsonb
      or jsonb_typeof(p_payload->'feedback') is distinct from 'string'
      or char_length(p_payload->>'feedback') > 4000
      or jsonb_typeof(p_payload->'points') is distinct from 'array' then raise invalid_parameter_value; end if;
    if jsonb_array_length(p_payload->'points') <> jsonb_array_length(p_exam.questions) then raise invalid_parameter_value; end if;
    for item, position in select value, ordinality::integer - 1
      from jsonb_array_elements(p_payload->'points') with ordinality loop
      if jsonb_typeof(item) is distinct from 'number' or (item #>> '{}') !~ '^(0|[1-9][0-9]{0,2})$'
        then raise invalid_parameter_value; end if;
      if (item #>> '{}')::integer > (p_exam.questions->position->>'max_points')::integer
        then raise invalid_parameter_value; end if;
    end loop;
    if head.revision in (p_expected, p_expected + 1) and head.points = p_payload->'points' and head.feedback = p_payload->>'feedback'
      then return head.revision; end if;
    if coalesce(head.revision, 0) <> p_expected
      then raise exception 'Text exam review changed' using errcode = 'PT409'; end if;
    insert into private.course_text_exam_reviews(run_id, exam_revision, learner_id, revision, points, feedback)
      values (p_exam.run_id, p_exam.revision, target, p_expected + 1, p_payload->'points', p_payload->>'feedback');
    return p_expected + 1;
  end if;

  if p_payload - 'learner_id' <> '{}'::jsonb then raise invalid_parameter_value; end if;
  if head.revision is distinct from p_expected
    then raise exception 'Text exam review changed' using errcode = 'PT409'; end if;
  if head.released_at is null then
    update private.course_text_exam_reviews set released_at = clock_timestamp()
      where run_id = p_exam.run_id and exam_revision = p_exam.revision and learner_id = target and revision = head.revision;
  end if;
  return head.revision;
end;
$$;

create function private.course_text_exam_action(
  p_run_id uuid, p_action text, p_revision integer, p_expected integer, p_payload jsonb
) returns integer language plpgsql security definer set search_path = '' as $$
declare
  exam private.course_text_exam_versions%rowtype;
  accepted integer;
begin
  if p_run_id is null or p_action is null or p_action not in ('save_exam','publish','save_answers','submit','save_review','release')
    or p_expected is null or p_expected not between 0 and 999999999
    or jsonb_typeof(p_payload) is distinct from 'object' then raise invalid_parameter_value; end if;
  perform private.lock_course_text_exam_actor(p_run_id, p_action);

  if p_action in ('save_exam','publish') then
    if p_revision is not null then raise invalid_parameter_value; end if;
    accepted := private.course_text_exam_author(p_run_id, p_action, p_expected, p_payload);
  else
    select * into exam from private.course_text_exam_versions
    where run_id = p_run_id and revision = p_revision and published_at is not null;
    if not found then raise insufficient_privilege; end if;
    if p_action in ('save_answers','submit') then
      return private.course_text_exam_submit(exam, p_action, p_expected, p_payload);
    end if;
    accepted := private.course_text_exam_grade(exam, p_action, p_expected, p_payload);
  end if;

  -- Audit the operation without copying private answers, scores or feedback.
  insert into public.audit_events(actor_id, action, resource_id)
    values (auth.uid(), 'course.text_exam.' || p_action, p_run_id);
  return accepted;
end;
$$;

create function public.course_text_exam(
  p_run_id uuid, p_revision integer default null, p_learner_id uuid default null, p_offset integer default 0
) returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.course_text_exam(p_run_id, p_revision, p_learner_id, p_offset);
$$;
create function public.course_text_exam_action(
  p_run_id uuid, p_action text, p_revision integer, p_expected integer, p_payload jsonb
) returns integer language sql security invoker set search_path = '' as $$
  select private.course_text_exam_action(p_run_id, p_action, p_revision, p_expected, p_payload);
$$;
revoke all on function private.course_text_exam_review_payload(private.course_text_exam_reviews, private.course_text_exam_versions),
  private.lock_course_text_exam_actor(uuid, text), private.course_text_exam_author(uuid, text, integer, jsonb),
  private.course_text_exam_submit(private.course_text_exam_versions, text, integer, jsonb),
  private.course_text_exam_grade(private.course_text_exam_versions, text, integer, jsonb),
  private.course_text_exam(uuid, integer, uuid, integer), public.course_text_exam(uuid, integer, uuid, integer),
  private.course_text_exam_action(uuid, text, integer, integer, jsonb),
  public.course_text_exam_action(uuid, text, integer, integer, jsonb) from public, anon, authenticated, service_role;
grant execute on function private.course_text_exam(uuid, integer, uuid, integer),
  public.course_text_exam(uuid, integer, uuid, integer), private.course_text_exam_action(uuid, text, integer, integer, jsonb),
  public.course_text_exam_action(uuid, text, integer, integer, jsonb) to authenticated;

do $migration$
declare
  academy text := pg_catalog.pg_get_functiondef('private.require_academy_course_access()'::regprocedure);
  portal text := pg_catalog.pg_get_functiondef('private.require_portal_access()'::regprocedure);
  read_anchor constant text := '''/rpc/course_peer_feedback''';
  write_anchor constant text := '''/rpc/course_peer_feedback_action''';
  portal_write constant text := '= ' || write_anchor;
begin
  if cardinality(string_to_array(academy, read_anchor)) <> 2 or cardinality(string_to_array(portal, read_anchor)) <> 2
    or cardinality(string_to_array(academy, write_anchor)) <> 2 or cardinality(string_to_array(portal, portal_write)) <> 2
    then raise exception 'Expected the Academy and participant ingress allowlists'; end if;
  execute replace(replace(academy, read_anchor, read_anchor || ', ''/rpc/course_text_exam'''),
    write_anchor, write_anchor || ', ''/rpc/course_text_exam_action''');
  execute replace(replace(portal, read_anchor, read_anchor || ', ''/rpc/course_text_exam'''),
    portal_write, 'in (' || write_anchor || ', ''/rpc/course_text_exam_action'')');
end;
$migration$;

notify pgrst, 'reload schema';
COMMIT;
