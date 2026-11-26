begin;

-- An assignment points to its editable and published definitions independently.
-- Published attempts pin the rubric and exact scan-bound version used at submit.
create table private.course_assignments (
  id uuid primary key,
  run_id uuid not null references public.course_runs(id) on delete cascade,
  current_version integer not null check (current_version > 0),
  published_version integer check (published_version between 1 and current_version),
  unique (id, run_id)
);
create index course_assignments_run on private.course_assignments(run_id, id);

create table private.course_assignment_definitions (
  assignment_id uuid not null references private.course_assignments(id) on delete cascade,
  version integer not null check (version > 0),
  title text not null check (length(title) between 1 and 160),
  instructions text not null check (length(instructions) between 1 and 8000),
  due_at timestamptz not null check (isfinite(due_at)),
  max_attempts integer not null check (max_attempts between 1 and 10),
  rubric jsonb not null,
  primary key (assignment_id, version)
);

create table private.course_assignment_extensions (
  assignment_id uuid not null references private.course_assignments(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  version integer not null check (version > 0),
  due_at timestamptz not null check (isfinite(due_at)),
  primary key (assignment_id, user_id, version)
);

alter table private.course_submissions
  add column assignment_id uuid,
  add column assignment_version integer,
  add constraint course_submission_assignment_run foreign key (assignment_id, run_id)
    references private.course_assignments(id, run_id) on delete cascade,
  add constraint course_submission_assignment_definition foreign key (assignment_id, assignment_version)
    references private.course_assignment_definitions(assignment_id, version) match full on delete cascade,
  add constraint course_submission_single_purpose check (assignment_id is null or not is_exam);
create index course_submission_assignment_version on private.course_submissions(assignment_id, assignment_version)
  where assignment_id is not null;

create table private.course_assignment_attempts (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null,
  assignment_version integer not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  attempt_no integer not null check (attempt_no between 1 and 10),
  file_version_id uuid unique references private.course_submissions(version_id) on delete set null,
  file_name text not null,
  submitted_at timestamptz not null default clock_timestamp(),
  unique (assignment_id, user_id, attempt_no),
  foreign key (assignment_id, assignment_version) references private.course_assignment_definitions(assignment_id, version) on delete cascade
);

create table private.course_assignment_reviews (
  attempt_id uuid not null references private.course_assignment_attempts(id) on delete cascade,
  version integer not null check (version > 0),
  state text not null check (state in ('draft', 'revision_requested', 'released')),
  scores jsonb not null,
  feedback text not null check (length(feedback) <= 4000),
  private_note text not null check (length(private_note) <= 4000),
  primary key (attempt_id, version)
);

alter table private.course_assignments enable row level security;
alter table private.course_assignment_definitions enable row level security;
alter table private.course_assignment_extensions enable row level security;
alter table private.course_assignment_attempts enable row level security;
alter table private.course_assignment_reviews enable row level security;
revoke all on private.course_assignments, private.course_assignment_definitions, private.course_assignment_extensions,
  private.course_assignment_attempts, private.course_assignment_reviews from public, anon, authenticated, service_role;

-- Rubrics are data, never executable markup. Levels carry exact integer points.
create function private.valid_course_assignment_rubric(p_rubric jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  criterion jsonb;
  level jsonb;
  criterion_labels text[] := '{}';
  level_labels text[];
  last_points integer;
  points integer;
begin
  if coalesce(jsonb_typeof(p_rubric), '') <> 'array' then return false; end if;
  if jsonb_array_length(p_rubric) not between 1 and 20 then return false; end if;
  for criterion in select value from jsonb_array_elements(p_rubric) loop
    if jsonb_typeof(criterion) <> 'object' or coalesce(jsonb_typeof(criterion->'label'), '') <> 'string'
      or length(trim(criterion->>'label')) not between 1 and 160
      or coalesce(jsonb_typeof(criterion->'levels'), '') <> 'array' then return false; end if;
    if criterion - array['label','levels'] <> '{}'::jsonb or jsonb_array_length(criterion->'levels') not between 2 and 8
      or lower(trim(criterion->>'label')) = any(criterion_labels) then return false; end if;
    criterion_labels := array_append(criterion_labels, lower(trim(criterion->>'label')));
    level_labels := '{}';
    last_points := -1;
    for level in select value from jsonb_array_elements(criterion->'levels') loop
      if jsonb_typeof(level) <> 'object' or coalesce(jsonb_typeof(level->'label'), '') <> 'string'
        or length(trim(level->>'label')) not between 1 and 160
        or coalesce(jsonb_typeof(level->'points'), '') <> 'number'
        or level->>'points' !~ '^(0|[1-9][0-9]{0,2}|1000)$' then return false; end if;
      points := (level->>'points')::integer;
      if level - array['label','points'] <> '{}'::jsonb or points <= last_points
        or (last_points = -1 and points <> 0)
        or lower(trim(level->>'label')) = any(level_labels) then return false; end if;
      last_points := points;
      level_labels := array_append(level_labels, lower(trim(level->>'label')));
    end loop;
  end loop;
  return true;
end;
$$;

-- Retake rights and the effective instant use only the current publication,
-- the most recent attempt/review and a current, scoped enrolment.
create function private.can_submit_course_assignment(p_run_id uuid, p_assignment_id uuid, p_actor uuid, p_now timestamptz)
returns boolean language sql stable set search_path = '' as $$
  select exists (
    select 1
    from private.course_assignments assignment
    join private.course_assignment_definitions definition
      on (definition.assignment_id, definition.version) = (assignment.id, assignment.published_version)
    join public.course_runs run on run.id = assignment.run_id
    join public.course_enrolments enrolment
      on enrolment.course_run_id = run.id and enrolment.user_id = p_actor and enrolment.status = 'enrolled'
    left join lateral (
      select due_at from private.course_assignment_extensions
      where assignment_id = assignment.id and user_id = p_actor order by version desc limit 1
    ) extension on true
    left join lateral (
      select id, attempt_no from private.course_assignment_attempts
      where assignment_id = assignment.id and user_id = p_actor order by attempt_no desc limit 1
    ) attempt on true
    left join lateral (
      select state from private.course_assignment_reviews
      where attempt_id = attempt.id and state <> 'draft' order by version desc limit 1
    ) review on true
    where assignment.id = p_assignment_id and assignment.run_id = p_run_id
      and private.active_company_participant(p_actor, run.organisation_id)
      and p_now < greatest(definition.due_at, extension.due_at)
      and coalesce(attempt.attempt_no, 0) < definition.max_attempts
      and (attempt.id is null or review.state = 'revision_requested')
  );
$$;

create function private.lock_course_assignment_upload(p_run_id uuid, p_assignment_id uuid, p_actor uuid)
returns void language plpgsql set search_path = '' as $$
declare
  company_id uuid := private.lock_course_submission_scope(p_run_id);
begin
  perform 1 from auth.users where id = p_actor and email_confirmed_at is not null for share;
  if not found then raise insufficient_privilege; end if;
  perform 1 from public.profiles where id = p_actor and active for share;
  if not found then raise insufficient_privilege; end if;
  perform 1 from public.user_roles where user_id = p_actor order by role for share;
  perform 1 from private.company_participant_memberships
    where organisation_id = company_id and user_id = p_actor and status = 'active' for share;
  if not found then raise insufficient_privilege; end if;
  perform 1 from public.course_enrolments
    where course_run_id = p_run_id and user_id = p_actor and status = 'enrolled' for share;
  if not found or not private.can_submit_course_assignment(p_run_id, p_assignment_id, p_actor, clock_timestamp()) then
    raise insufficient_privilege;
  end if;
end;
$$;

-- Same quota, identity and document-version reservation as the two existing
-- submission paths. Each new reservation is scoped before any bytes can be written.
create function private.reserve_course_assignment_submission(
  p_run_id uuid, p_assignment_id uuid, p_name text, p_mime text, p_size bigint, p_client_id uuid, p_sha256 text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  existing_version public.document_versions%rowtype;
  published integer;
  result jsonb;
begin
  perform private.lock_course_assignment_upload(p_run_id, p_assignment_id, actor_id);
  select published_version into strict published from private.course_assignments where id = p_assignment_id;
  if p_client_id is null or p_size is null or p_size not between 1 and 10485760
    or not coalesce(p_sha256 ~ '^[0-9a-f]{64}$', false) then raise invalid_parameter_value; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('documents-global-quota', 0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('documents:' || actor_id::text, 0));
  select * into existing_version from public.document_versions where uploaded_by = actor_id and client_id = p_client_id;
  if found then
    if existing_version.original_name is distinct from p_name
      or existing_version.mime_type is distinct from p_mime or existing_version.size_bytes is distinct from p_size
      or existing_version.version <> 1 or not exists (
        select 1 from private.course_submissions intake
        join public.documents document on document.current_version_id = intake.version_id
        where intake.version_id = existing_version.id and intake.run_id = p_run_id and intake.assignment_id = p_assignment_id
          and intake.assignment_version = published and intake.expected_sha256 = p_sha256 and intake.withdrawn_at is null
          and document.owner_id = actor_id and document.id = existing_version.document_id
          and document.kind = 'participant_submission' and document.deleted_at is null
          and not private.deletion_document_fenced(document.id)
      ) then
      raise exception 'Assignment reservation conflicts with this upload' using errcode = 'PT409';
    end if;
    return jsonb_build_object('document_id', existing_version.document_id, 'version_id', existing_version.id,
      'object_path', existing_version.object_path, 'status', existing_version.status);
  end if;
  if (select edition from private.installation_identity) is distinct from 'internal'
    and (select coalesce(sum(size_bytes), 0) from public.document_versions) + p_size >
        (select (terms #>> '{limits,storage_bytes}')::bigint from private.installation_verified_licence) then
    raise exception 'Academy storage quota reached' using errcode = '54000';
  end if;
  result := private.reserve_document_before_contract_owner(p_name, p_mime, p_size, 'personal', 'participant_submission',
    null, null, p_client_id, null, null);
  insert into private.course_submissions(version_id, run_id, expected_sha256, assignment_id, assignment_version)
    values ((result->>'version_id')::uuid, p_run_id, p_sha256, p_assignment_id, published);
  return result;
end;
$$;

-- Use one read projection in both editions. Staff get one bounded review page;
-- learners see their own attempts and released feedback with no private notes.
create function private.course_assignments(p_run_id uuid, p_assignment_id uuid, p_offset integer)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  context jsonb := private.course_submission_context(p_run_id);
  staff boolean := coalesce((context->>'staff')::boolean, false);
  learner boolean := coalesce((context->>'learner')::boolean, false);
  summaries jsonb;
  detail jsonb;
begin
  if not staff and not learner then raise insufficient_privilege; end if;
  if p_offset is null or p_offset < 0 then raise invalid_parameter_value; end if;
  select coalesce(jsonb_agg(to_jsonb(summary) order by summary.title, summary.id), '[]'::jsonb) into summaries
  from (
    select a.id, d.title, d.due_at, a.published_version
    from private.course_assignments a
    join private.course_assignment_definitions d
      on d.assignment_id = a.id and d.version = case when staff then a.current_version else a.published_version end
    where a.run_id = p_run_id order by d.title, a.id limit 100
  ) summary;
  if p_assignment_id is not null then
    select to_jsonb(definition) || jsonb_build_object('published_version', a.published_version,
      'can_submit', learner and private.course_submission_write_enabled()
        and private.can_submit_course_assignment(p_run_id, a.id, auth.uid(), statement_timestamp()),
      'effective_due_at', greatest(definition.due_at, (
        select due_at from private.course_assignment_extensions where assignment_id = a.id and user_id = auth.uid()
        order by version desc limit 1
      )),
      'extensions', case when staff then coalesce((
        select jsonb_agg(to_jsonb(current_extension) order by current_extension.user_id)
        from (
          select distinct on (user_id) user_id, version, due_at
          from private.course_assignment_extensions
          where assignment_id = a.id order by user_id, version desc
        ) current_extension
      ), '[]'::jsonb) else '[]'::jsonb end,
      'attempts', coalesce((
        select jsonb_agg(to_jsonb(visible) order by visible.attempt_no desc, visible.id)
        from (
          select attempt.id, attempt.user_id, profile.display_name, attempt.attempt_no,
            attempt.file_version_id, attempt.file_name, attempt.submitted_at,
            pinned.rubric, to_jsonb(review) as review
          from private.course_assignment_attempts attempt
          join public.profiles profile on profile.id = attempt.user_id and profile.active
          join private.course_assignment_definitions pinned
            on (pinned.assignment_id, pinned.version) = (attempt.assignment_id, attempt.assignment_version)
          left join lateral (
            select rev.version, rev.state, rev.scores, rev.feedback,
              case when staff then rev.private_note end as private_note
            from private.course_assignment_reviews rev
            where rev.attempt_id = attempt.id and (staff or rev.state <> 'draft')
            order by rev.version desc limit 1
          ) review on true
          where attempt.assignment_id = a.id and (staff or attempt.user_id = auth.uid())
          order by attempt.attempt_no desc, attempt.id offset p_offset limit 25
        ) visible
      ), '[]'::jsonb))
    into detail
    from private.course_assignments a join private.course_assignment_definitions definition
      on definition.assignment_id = a.id and definition.version = case when staff then a.current_version else a.published_version end
    where a.id = p_assignment_id and a.run_id = p_run_id;
    if detail is null then raise insufficient_privilege; end if;
  end if;
  return jsonb_build_object('can_manage', staff and private.course_submission_write_enabled(),
    'assignments', summaries, 'detail', detail);
end;
$$;

create function private.course_assignment_action(
  p_run_id uuid, p_assignment_id uuid, p_action text, p_payload jsonb, p_expected_version integer
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  context jsonb := private.lock_course_submission_settings_actor(p_run_id);
  assignment private.course_assignments%rowtype;
  attempt private.course_assignment_attempts%rowtype;
  definition private.course_assignment_definitions%rowtype;
  current_revision integer;
  target_user uuid;
  next_due timestamptz;
  file_id uuid;
  filename text;
  criterion record;
  score jsonb;
  title text := trim(p_payload->>'title');
  instructions text := trim(p_payload->>'instructions');
  feedback text := trim(coalesce(p_payload->>'feedback', ''));
  note text := trim(coalesce(p_payload->>'private_note', ''));
  review_state text := p_payload->>'state';
  result_id uuid := p_assignment_id;
  accepted_fields text[];
  deadline_text text := p_payload->>'due_at';
begin
  if not private.course_submission_write_enabled() then raise insufficient_privilege; end if;
  if p_action is null or p_assignment_id is null or p_expected_version is null or p_expected_version < 0
    or p_payload is null or jsonb_typeof(p_payload) <> 'object' or octet_length(p_payload::text) > 65536 then
    raise invalid_parameter_value;
  end if;
  accepted_fields := case p_action
    when 'save' then array['title','instructions','due_at','max_attempts','rubric']
    when 'publish' then '{}'::text[]
    when 'extend' then array['user_id','due_at']
    when 'submit' then array['file_version_id']
    when 'review' then array['attempt_id','state','scores','feedback','private_note']
  end;
  if accepted_fields is null or p_payload - accepted_fields <> '{}'::jsonb then raise invalid_parameter_value; end if;
  if p_action in ('save','extend') and not coalesce(
    deadline_text ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$', false
  ) then raise invalid_parameter_value; end if;
  select * into assignment from private.course_assignments where run_id = p_run_id and id = p_assignment_id;
  if p_action = 'submit' then
    if (context->>'learner')::boolean is not true or assignment.published_version is null then raise insufficient_privilege; end if;
    file_id := (p_payload->>'file_version_id')::uuid;
    select * into attempt from private.course_assignment_attempts
      where assignment_id = p_assignment_id and user_id = auth.uid() and file_version_id = file_id;
    if found then return jsonb_build_object('id', attempt.id); end if;
    perform private.lock_course_assignment_upload(p_run_id, p_assignment_id, auth.uid());
    if p_expected_version <> assignment.published_version then
      raise exception 'Assignment publication changed' using errcode = 'PT409';
    end if;
    select version.original_name into filename
    from private.course_submissions intake
    join public.document_versions version on version.id = intake.version_id
    join public.documents document on document.id = version.document_id and document.current_version_id = version.id
    where intake.version_id = file_id and intake.assignment_id = p_assignment_id
      and intake.assignment_version = assignment.published_version and intake.withdrawn_at is null
      and version.uploaded_by = auth.uid() and document.owner_id = auth.uid()
      and version.status = 'clean' and document.status = 'clean' and version.sha256 = intake.expected_sha256
      and document.deleted_at is null and not private.deletion_document_fenced(document.id)
    for share of version, document;
    if not found then raise insufficient_privilege; end if;
    select coalesce(max(attempt_no), 0) into current_revision from private.course_assignment_attempts
      where assignment_id = p_assignment_id and user_id = auth.uid();
    insert into private.course_assignment_attempts(assignment_id, assignment_version, user_id, attempt_no, file_version_id, file_name)
      values(p_assignment_id, assignment.published_version, auth.uid(), current_revision + 1, file_id, filename)
      returning id into result_id;
  else
    if (context->>'staff')::boolean is not true then raise insufficient_privilege; end if;
    if p_action = 'save' then
      if coalesce(length(title), 0) not between 1 and 160 or coalesce(length(instructions), 0) not between 1 and 8000
        or not coalesce(p_payload->>'max_attempts' ~ '^([1-9]|10)$', false)
        or not private.valid_course_assignment_rubric(p_payload->'rubric') then raise invalid_parameter_value; end if;
      next_due := deadline_text::timestamptz;
      if next_due is null or not isfinite(next_due) then raise invalid_parameter_value; end if;
      current_revision := coalesce(assignment.current_version, 0);
      if current_revision <> p_expected_version then raise exception 'Assignment draft changed' using errcode = 'PT409'; end if;
      if current_revision = 0 then
        if (select count(*) from private.course_assignments where run_id = p_run_id) >= 100 then
          raise exception 'Course assignment limit reached' using errcode = '54000';
        end if;
        insert into private.course_assignments(id, run_id, current_version) values(p_assignment_id, p_run_id, 1);
      else
        update private.course_assignments set current_version = current_revision + 1 where id = p_assignment_id;
      end if;
      insert into private.course_assignment_definitions(assignment_id, version, title, instructions, due_at, max_attempts, rubric)
        values(p_assignment_id, current_revision + 1, title, instructions, next_due, (p_payload->>'max_attempts')::integer, p_payload->'rubric');
    elsif assignment.id is null then
      raise insufficient_privilege;
    elsif p_action = 'publish' then
      if p_expected_version <> assignment.current_version then raise exception 'Assignment draft changed' using errcode = 'PT409'; end if;
      if assignment.published_version = assignment.current_version then return jsonb_build_object('id', p_assignment_id); end if;
      if not exists(select 1 from private.course_assignment_definitions where assignment_id = p_assignment_id
        and version = assignment.current_version and due_at > clock_timestamp()) then raise invalid_parameter_value; end if;
      update private.course_assignments set published_version = current_version where id = p_assignment_id;
    elsif p_action = 'extend' then
      target_user := (p_payload->>'user_id')::uuid;
      next_due := deadline_text::timestamptz;
      if target_user is null or target_user = auth.uid() or assignment.published_version is null
        or not exists(select 1 from public.course_enrolments where course_run_id = p_run_id and user_id = target_user and status = 'enrolled')
        or next_due is null or not isfinite(next_due) or next_due <= clock_timestamp()
        or not exists(select 1 from private.course_assignment_definitions where assignment_id = p_assignment_id
          and version = assignment.published_version and due_at < next_due) then raise invalid_parameter_value; end if;
      select coalesce(max(version), 0) into current_revision from private.course_assignment_extensions
        where assignment_id = p_assignment_id and user_id = target_user;
      if p_expected_version <> current_revision then raise exception 'Assignment extension changed' using errcode = 'PT409'; end if;
      if exists(select 1 from private.course_assignment_extensions where assignment_id = p_assignment_id
        and user_id = target_user and version = current_revision and due_at >= next_due) then raise invalid_parameter_value; end if;
      insert into private.course_assignment_extensions(assignment_id, user_id, version, due_at)
        values(p_assignment_id, target_user, current_revision + 1, next_due);
    elsif p_action = 'review' then
      select * into attempt from private.course_assignment_attempts
        where id = (p_payload->>'attempt_id')::uuid and assignment_id = p_assignment_id;
      if not found or attempt.user_id = auth.uid() then raise insufficient_privilege; end if;
      select * into strict definition from private.course_assignment_definitions
        where assignment_id = p_assignment_id and version = attempt.assignment_version;
      if review_state is null or review_state not in ('draft', 'revision_requested', 'released')
        or length(feedback) > 4000 or length(note) > 4000
        or (review_state = 'revision_requested' and (feedback = '' or exists (
          select 1 from private.course_assignment_attempts later
          where later.assignment_id = p_assignment_id and later.user_id = attempt.user_id and later.attempt_no > attempt.attempt_no
        ))) or coalesce(jsonb_typeof(p_payload->'scores'), '') <> 'array' then raise invalid_parameter_value; end if;
      if jsonb_array_length(p_payload->'scores') <> jsonb_array_length(definition.rubric) then raise invalid_parameter_value; end if;
      for criterion in select value, ordinality - 1 as idx from jsonb_array_elements(definition.rubric) with ordinality loop
        score := p_payload->'scores'->(criterion.idx::integer);
        if not exists(select 1 from jsonb_array_elements(criterion.value->'levels') as level(value) where level.value->'points' = score) then
          raise invalid_parameter_value;
        end if;
      end loop;
      select coalesce(max(version), 0) into current_revision from private.course_assignment_reviews where attempt_id = attempt.id;
      if p_expected_version <> current_revision then raise exception 'Assignment review changed' using errcode = 'PT409'; end if;
      insert into private.course_assignment_reviews(attempt_id, version, state, scores, feedback, private_note)
        values(attempt.id, current_revision + 1, review_state, p_payload->'scores', feedback, note);
      if review_state <> 'draft' then
        insert into public.notifications(user_id, kind, resource_id)
          values(attempt.user_id, 'course_assignment_feedback', attempt.id)
          on conflict(user_id, kind, resource_id) do update set created_at = clock_timestamp(), read_at = null;
      end if;
      result_id := attempt.id;
    else
      raise invalid_parameter_value;
    end if;
  end if;
  insert into public.audit_events(actor_id, action, resource_id, details)
    values(auth.uid(), 'course_assignment.' || p_action, p_run_id,
      jsonb_build_object('assignment_id', p_assignment_id, 'action_id', result_id));
  return jsonb_build_object('id', result_id);
end;
$$;

create function public.course_assignments(p_run_id uuid, p_assignment_id uuid default null, p_offset integer default 0)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.course_assignments(p_run_id, p_assignment_id, p_offset);
$$;

create function public.course_assignment_action(
  p_run_id uuid, p_assignment_id uuid, p_action text, p_payload jsonb, p_expected_version integer
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.course_assignment_action(p_run_id, p_assignment_id, p_action, p_payload, p_expected_version);
$$;

create function public.reserve_course_assignment_submission(
  p_run_id uuid, p_assignment_id uuid, p_name text, p_mime text, p_size bigint, p_client_id uuid, p_sha256 text
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.reserve_course_assignment_submission(p_run_id, p_assignment_id, p_name, p_mime, p_size, p_client_id, p_sha256);
$$;

revoke all on function private.valid_course_assignment_rubric(jsonb),
  private.can_submit_course_assignment(uuid, uuid, uuid, timestamptz),
  private.lock_course_assignment_upload(uuid, uuid, uuid),
  private.course_assignments(uuid, uuid, integer), public.course_assignments(uuid, uuid, integer),
  private.course_assignment_action(uuid, uuid, text, jsonb, integer), public.course_assignment_action(uuid, uuid, text, jsonb, integer),
  private.reserve_course_assignment_submission(uuid, uuid, text, text, bigint, uuid, text),
  public.reserve_course_assignment_submission(uuid, uuid, text, text, bigint, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function private.course_assignments(uuid, uuid, integer), public.course_assignments(uuid, uuid, integer),
  private.course_assignment_action(uuid, uuid, text, jsonb, integer), public.course_assignment_action(uuid, uuid, text, jsonb, integer),
  private.reserve_course_assignment_submission(uuid, uuid, text, text, bigint, uuid, text),
  public.reserve_course_assignment_submission(uuid, uuid, text, text, bigint, uuid, text) to authenticated;

-- Update only the named current checks in the scanner, intake and gateway gate.
-- Legacy rows have no assignment and continue through their original policies.
do $migration$
declare
  change record;
  definition text;
begin
  for change in select * from (values
    ('private.reserve_submission_for_purpose(uuid,text,text,bigint,uuid,text,boolean)'::regprocedure,
      'submission.is_exam=p_exam', 'submission.assignment_id is null and submission.is_exam=p_exam'),
    ('private.course_submission_scan(uuid,uuid,text,uuid,text,text)'::regprocedure,
      'perform private.lock_timed_submission_upload(intake.run_id, version.uploaded_by, intake.is_exam);',
      $new$if intake.assignment_id is not null then
        perform private.lock_course_assignment_upload(intake.run_id, intake.assignment_id, version.uploaded_by);
      else
        perform private.lock_timed_submission_upload(intake.run_id, version.uploaded_by, intake.is_exam);
      end if;$new$),
    ('private.course_submission_status(uuid,uuid,uuid)'::regprocedure,
      'and case when submission.is_exam then',
      $new$and case when submission.assignment_id is not null then
        private.can_submit_course_assignment(p_run_id, submission.assignment_id, auth.uid(), statement_timestamp())
        when submission.is_exam then$new$),
    ('private.course_submissions(uuid,uuid)'::regprocedure,
      'submission.withdrawn_at is null and not submission.is_exam',
      'submission.withdrawn_at is null and not submission.is_exam and submission.assignment_id is null'),
    ('private.course_submissions(uuid,uuid)'::regprocedure,
      'version.id = p_after and not submission.is_exam',
      'version.id = p_after and not submission.is_exam and submission.assignment_id is null'),
    ('private.withdraw_course_submission(uuid,uuid)'::regprocedure,
      'submission.withdrawn_at is null and not submission.is_exam',
      'submission.withdrawn_at is null and not submission.is_exam and submission.assignment_id is null'),
    ('private.course_submission_access(uuid,uuid,boolean)'::regprocedure,
      'and (not submission.is_exam or (',
      $new$and (submission.assignment_id is null or (
        ((context->>'staff')::boolean or ((context->>'learner')::boolean and document.owner_id = auth.uid()))
        and exists (select 1 from private.course_assignment_attempts where file_version_id = p_version_id)
      ))
      and (not submission.is_exam or ($new$),
    ('private.course_notification_target(text,uuid)'::regprocedure,
      'if p_kind = ''course_preparation_updated'' then',
      $new$if p_kind = 'course_assignment_feedback' then
        select assignment.run_id into run_id
        from private.course_assignment_attempts attempt
        join private.course_assignments assignment on assignment.id = attempt.assignment_id
        where attempt.id = p_resource and attempt.user_id = auth.uid()
          and exists(select 1 from private.course_assignment_reviews review where review.attempt_id = attempt.id and review.state <> 'draft');
      elsif p_kind = 'course_preparation_updated' then$new$),
    ('private.course_notification_target(text,uuid)'::regprocedure,
      '(p_kind = ''course_quiz_published'' and not (context->>''learner'')::boolean)',
      '(p_kind in (''course_quiz_published'', ''course_assignment_feedback'') and not (context->>''learner'')::boolean)'),
    ('private.academy_notification_target(text,uuid)'::regprocedure,
      'when ''course_attendance_updated'' then',
      $new$when 'course_assignment_feedback' then
        select assignment.run_id into run_id
        from private.course_assignment_attempts attempt
        join private.course_assignments assignment on assignment.id = attempt.assignment_id
        where attempt.id = p_resource and attempt.user_id = auth.uid()
          and exists(select 1 from private.course_assignment_reviews review where review.attempt_id = attempt.id and review.state <> 'draft');
        if run_id is not null and not coalesce((private.course_workspace_context(run_id)->>'learner')::boolean, false) then
          return null;
        end if;
        section := '#course-submissions';
      when 'course_attendance_updated' then$new$),
    ('private.require_portal_access()'::regprocedure,
      'perform private.require_portal_access_before_course_content();',
      $new$if (select edition from private.installation_identity) = 'internal'
         and private.participant_actor() and (
           (current_setting('request.path', true) = '/rpc/course_assignments'
             and current_setting('request.method', true) in ('GET', 'HEAD', 'POST'))
           or (current_setting('request.path', true) in ('/rpc/course_assignment_action', '/rpc/reserve_course_assignment_submission')
             and current_setting('request.method', true) = 'POST')
         ) then return; end if;
      perform private.require_portal_access_before_course_content();$new$),
    ('private.require_academy_course_access()'::regprocedure,
      '  licence_status := private.academy_course_access_status();',
      $new$  licence_status := private.academy_course_access_status();
      if request_method in ('POST', 'GET') and licence_status in ('active', 'grace')
         and request_path = '/rpc/course_assignments' then return; end if;
      if request_method = 'POST' and licence_status = 'active'
         and request_path in ('/rpc/course_assignment_action', '/rpc/reserve_course_assignment_submission') then return; end if;$new$)
  ) edits(target, previous, replacement)
  loop
    definition := pg_get_functiondef(change.target);
    if cardinality(string_to_array(definition, change.previous)) <> 2 then
      raise exception 'Unexpected assignment integration anchor in %', change.target;
    end if;
    execute replace(definition, change.previous, change.replacement);
  end loop;
end;
$migration$;

-- Include owned evidence in the existing dependency-aware deletion plan. Fences
-- also cover notes and receipts created while a resource deletion is in progress.
alter function private.deletion_scope(text, uuid) rename to deletion_scope_before_assignments;
create function private.deletion_scope(p_kind text, p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  scope jsonb := private.deletion_scope_before_assignments(p_kind, p_id);
  course_filter text := private.deletion_selector(scope, 'public.course_runs');
  profile_filter text := private.deletion_selector(scope, 'public.profiles');
  version_filter text := private.deletion_selector(scope, 'public.document_versions');
  assignment_selector text;
  participants text[] := '{}';
  attempt_selector text;
begin
  if course_filter is not null then
    scope := private.deletion_add_scope(scope, 'private.course_assignments',
      format('x.run_id in (select scoped.id from public.course_runs scoped where %s)', replace(course_filter, 'x.', 'scoped.')));
    assignment_selector := format('x.assignment_id in (select assignment.id from private.course_assignments assignment
      join public.course_runs scoped on scoped.id = assignment.run_id where %s)', replace(course_filter, 'x.', 'scoped.'));
    scope := private.deletion_add_scope(scope, 'private.course_assignment_definitions', assignment_selector);
    participants := array_append(participants, assignment_selector);
  end if;
  if profile_filter is not null then
    participants := array_append(participants,
      format('x.user_id in (select scoped.id from public.profiles scoped where %s)', replace(profile_filter, 'x.', 'scoped.')));
  end if;
  if cardinality(participants) > 0 then
    scope := private.deletion_add_scope(scope, 'private.course_assignment_extensions', array_to_string(participants, ' or '));
  end if;
  if version_filter is not null then
    participants := array_append(participants,
      format('x.file_version_id in (select scoped.id from public.document_versions scoped where %s)', replace(version_filter, 'x.', 'scoped.')));
  end if;
  if cardinality(participants) > 0 then
    attempt_selector := array_to_string(participants, ' or ');
    scope := private.deletion_add_scope(scope, 'private.course_assignment_attempts', attempt_selector);
    scope := private.deletion_add_scope(scope, 'private.course_assignment_reviews',
      format('x.attempt_id in (select attempt.id from private.course_assignment_attempts attempt where %s)', replace(attempt_selector, 'x.', 'attempt.')));
    scope := private.deletion_add_scope(scope, 'public.notifications',
      format('x.kind = %L and x.resource_id in (select attempt.id from private.course_assignment_attempts attempt where %s)',
        'course_assignment_feedback', replace(attempt_selector, 'x.', 'attempt.')));
  end if;
  return scope;
end;
$$;
revoke all on function private.deletion_scope_before_assignments(text, uuid), private.deletion_scope(text, uuid)
  from public, anon, authenticated, service_role;

create trigger permanent_deletion_fence before insert or update or delete on private.course_assignments
  for each row execute function private.guard_permanent_deletion();
create trigger permanent_deletion_fence before insert or update or delete on private.course_assignment_definitions
  for each row execute function private.guard_permanent_deletion();
create trigger permanent_deletion_fence before insert or update or delete on private.course_assignment_extensions
  for each row execute function private.guard_permanent_deletion();
create trigger permanent_deletion_fence before insert or update or delete on private.course_assignment_attempts
  for each row execute function private.guard_permanent_deletion();
create trigger permanent_deletion_fence before insert or update or delete on private.course_assignment_reviews
  for each row execute function private.guard_permanent_deletion();

notify pgrst, 'reload schema';
commit;
