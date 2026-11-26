begin;

-- Quiz attempts remain the authoritative assessment result. A policy is an
-- immutable course-scoped interpretation; published grades are append-only.
create table private.course_gradebook_policies (
  run_id uuid not null references public.course_runs(id),
  version integer not null check (version > 0),
  scheme text not null check (scheme in ('percentage', 'bands')),
  bands jsonb not null check (jsonb_typeof(bands) = 'array'),
  created_by uuid,
  created_at timestamptz not null default now(),
  primary key (run_id, version),
  check ((scheme = 'percentage' and bands = '[]'::jsonb) or
         (scheme = 'bands' and jsonb_array_length(bands) between 2 and 10))
);

alter table private.course_quiz_attempts
  add constraint course_quiz_attempt_gradebook_identity unique (id, run_id, user_id);

create table private.course_gradebook_revisions (
  run_id uuid not null,
  user_id uuid not null,
  revision integer not null check (revision > 0),
  attempt_id uuid not null,
  quiz_version integer not null,
  source_score integer not null check (source_score between 0 and 100),
  source_passed boolean not null,
  policy_version integer not null,
  grade_percent integer check (grade_percent between 0 and 100),
  grade_label text check (grade_label is null or length(grade_label) between 1 and 80),
  correction_reason text check (correction_reason is null or length(correction_reason) between 3 and 500),
  created_by uuid,
  created_at timestamptz not null default now(),
  primary key (run_id, user_id, revision),
  foreign key (run_id, user_id) references public.course_enrolments(course_run_id, user_id),
  foreign key (attempt_id, run_id, user_id)
    references private.course_quiz_attempts(id, run_id, user_id),
  foreign key (run_id, quiz_version) references private.course_quiz_versions(run_id, version),
  foreign key (run_id, policy_version)
    references private.course_gradebook_policies(run_id, version),
  check ((grade_percent is not null) <> (grade_label is not null))
);

alter table private.course_gradebook_policies enable row level security;
alter table private.course_gradebook_revisions enable row level security;
revoke all on private.course_gradebook_policies, private.course_gradebook_revisions
  from public, anon, authenticated, service_role;

create function private.prevent_course_gradebook_history_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Course gradebook history is immutable' using errcode = '42501';
end;
$$;
create trigger course_gradebook_policies_immutable
  before update or delete on private.course_gradebook_policies
  for each row execute function private.prevent_course_gradebook_history_mutation();
create trigger course_gradebook_revisions_immutable
  before update or delete on private.course_gradebook_revisions
  for each row execute function private.prevent_course_gradebook_history_mutation();
revoke all on function private.prevent_course_gradebook_history_mutation()
  from public, anon, authenticated, service_role;

create function private.course_gradebook_mark(
  p_scheme text, p_bands jsonb, p_score integer
) returns jsonb language sql immutable strict set search_path = '' as $$
  select case p_scheme
    when 'percentage' then jsonb_build_object('grade_percent', p_score, 'grade_label', null)
    else jsonb_build_object(
      'grade_percent', null,
      'grade_label', (
        select band.value->>'label'
        from jsonb_array_elements(p_bands) as band(value)
        where (band.value->>'minimum')::integer <= p_score
        order by (band.value->>'minimum')::integer desc
        limit 1
      )
    )
  end;
$$;
revoke all on function private.course_gradebook_mark(text, jsonb, integer)
  from public, anon, authenticated, service_role;

-- Use the same edition, entitlement and current course authority for both
-- overview and history. Fail closed if the dedicated licence has no status.
create function private.course_gradebook_context(p_run_id uuid)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  context jsonb;
  edition text := (select installation.edition from private.installation_identity installation);
  licence_status text;
begin
  if edition is distinct from 'internal' then
    licence_status := private.academy_course_access_status();
    if licence_status is null or licence_status not in ('active', 'grace') then
      raise insufficient_privilege;
    end if;
  end if;
  context := private.course_workspace_context(p_run_id);
  if not coalesce((context->>'lms_enabled')::boolean, false) or
     (not coalesce((context->>'staff')::boolean, false) and
      not coalesce((context->>'learner')::boolean, false)) then
    raise insufficient_privilege;
  end if;
  return context || jsonb_build_object('gradebook_can_manage',
    coalesce((context->>'staff')::boolean, false) and
    (edition = 'internal' or licence_status = 'active'));
end;
$$;
revoke all on function private.course_gradebook_context(uuid)
  from public, anon, authenticated, service_role;

-- Project explicit fields so internal correction reasons never reach learners.
create function private.course_gradebook_revision_json(
  p_revision private.course_gradebook_revisions, p_staff boolean
) returns jsonb language sql stable strict set search_path = '' as $$
  select jsonb_build_object(
    'revision', p_revision.revision, 'attempt_id', p_revision.attempt_id,
    'quiz_version', p_revision.quiz_version, 'score', p_revision.source_score,
    'passed', p_revision.source_passed, 'policy_version', p_revision.policy_version,
    'grade_percent', p_revision.grade_percent, 'grade_label', p_revision.grade_label,
    'corrected', p_revision.correction_reason is not null, 'published_at', p_revision.created_at
  ) || case when p_staff then jsonb_build_object('reason', p_revision.correction_reason)
    else '{}'::jsonb end;
$$;
revoke all on function private.course_gradebook_revision_json(private.course_gradebook_revisions, boolean)
  from public, anon, authenticated, service_role;

create function private.course_gradebook_projection(
  p_run_id uuid, p_offset integer, p_limit integer
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  context jsonb;
  policy_row private.course_gradebook_policies%rowtype;
  enrolment record;
  best private.course_quiz_attempts%rowtype;
  current_grade private.course_gradebook_revisions%rowtype;
  rows jsonb := '[]'::jsonb;
  own_grade jsonb := 'null'::jsonb;
  policy jsonb := 'null'::jsonb;
  grade_value jsonb;
  can_manage boolean := false;
  total_rows integer := 0;
begin
  if p_offset is null or p_offset < 0 or p_limit is null or p_limit not between 1 and 100 then
    raise exception 'Invalid course gradebook page' using errcode = '22023';
  end if;
  context := private.course_gradebook_context(p_run_id);
  can_manage := (context->>'gradebook_can_manage')::boolean;

  select * into policy_row
  from private.course_gradebook_policies
  where run_id = p_run_id
  order by version desc
  limit 1;
  if found and (context->>'staff')::boolean then
    policy := jsonb_build_object(
      'version', policy_row.version,
      'scheme', policy_row.scheme,
      'bands', policy_row.bands,
      'created_at', policy_row.created_at
    );
  end if;

  if coalesce((context->>'staff')::boolean, false) then
    select count(*)::integer into total_rows
    from public.course_enrolments membership
    where membership.course_run_id = p_run_id and membership.status in ('enrolled', 'completed');

    for enrolment in
      select membership.user_id, profile.display_name, membership.status
      from public.course_enrolments membership
      join public.profiles profile on profile.id = membership.user_id
      where membership.course_run_id = p_run_id
        and membership.status in ('enrolled', 'completed')
      order by profile.display_name, membership.user_id
      offset p_offset limit p_limit
    loop
      select attempt.* into best
      from private.course_quiz_attempts attempt
      join private.course_quizzes active_quiz
        on active_quiz.run_id = attempt.run_id and active_quiz.version = attempt.quiz_version
      join private.course_quiz_versions quiz_version
        on quiz_version.run_id = active_quiz.run_id and quiz_version.version = active_quiz.version
      where attempt.run_id = p_run_id and attempt.user_id = enrolment.user_id
        and quiz_version.published
      order by attempt.score desc, attempt.created_at desc, attempt.id
      limit 1;

      select revision.* into current_grade
      from private.course_gradebook_revisions revision
      where revision.run_id = p_run_id and revision.user_id = enrolment.user_id
      order by revision.revision desc limit 1;
      if found then
        grade_value := private.course_gradebook_revision_json(current_grade, true);
      else
        grade_value := null;
      end if;

      rows := rows || jsonb_build_array(jsonb_build_object(
        'user_id', enrolment.user_id,
        'name', coalesce(enrolment.display_name, ''),
        'status', enrolment.status,
        'best_attempt', case when best.id is null then null else jsonb_build_object(
          'id', best.id, 'quiz_version', best.quiz_version, 'score', best.score,
          'passed', best.passed, 'created_at', best.created_at
        ) end,
        'preview', case when best.id is null or policy_row.version is null then null
          else private.course_gradebook_mark(policy_row.scheme, policy_row.bands, best.score) end,
        'grade', grade_value
      ));
    end loop;
  elsif coalesce((context->>'learner')::boolean, false) then
    select revision.* into current_grade
    from private.course_gradebook_revisions revision
    where revision.run_id = p_run_id and revision.user_id = auth.uid()
    order by revision.revision desc limit 1;
    if found then
      own_grade := private.course_gradebook_revision_json(current_grade, false);
    end if;
  end if;

  return jsonb_build_object(
    'can_manage', can_manage,
    'policy', policy,
    'learners', rows,
    'own_grade', own_grade,
    'total', total_rows,
    'offset', p_offset,
    'limit', p_limit
  );
end;
$$;
revoke all on function private.course_gradebook_projection(uuid, integer, integer)
  from public, anon, authenticated, service_role;

create function private.course_gradebook_command(
  p_run_id uuid, p_action text, p_payload jsonb, p_expected_version integer,
  p_dedicated boolean default false
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  context jsonb;
  current_policy private.course_gradebook_policies%rowtype;
  current_grade private.course_gradebook_revisions%rowtype;
  best private.course_quiz_attempts%rowtype;
  revision_value integer;
  next_version integer;
  target_user uuid;
  expected_revision integer;
  scheme_value text;
  bands_value jsonb;
  band_count integer;
  canonical_bands jsonb;
  mark jsonb;
  grade_value text;
  reason_value text;
begin
  if p_action is null or p_action not in ('gradebook_policy', 'gradebook_publish', 'gradebook_correct') or
     p_payload is null or jsonb_typeof(p_payload) is distinct from 'object' or
     p_expected_version is null or p_expected_version < 0 then
    raise exception 'Invalid gradebook command' using errcode = '22023';
  end if;

  if p_dedicated then
    if (select edition from private.installation_identity) = 'internal' or
       private.academy_course_access_status() is distinct from 'active' then
      raise insufficient_privilege;
    end if;
  else
    if (select edition from private.installation_identity) is distinct from 'internal' then
      raise insufficient_privilege;
    end if;
    perform private.lock_course_premium(p_run_id);
  end if;

  perform 1 from public.profiles where id = auth.uid() and active for share;
  if not found then raise insufficient_privilege; end if;
  perform 1 from public.user_roles where user_id = auth.uid() order by role for share;
  perform 1 from public.job_claims claim join public.jobs job on job.id = claim.job_id
  where job.course_run_id = p_run_id and claim.lecturer_id = auth.uid() and claim.status = 'confirmed'
  for share of claim;
  context := private.course_workspace_context(p_run_id);
  if not coalesce((context->>'lms_enabled')::boolean, false) or
     not coalesce((context->>'staff')::boolean, false) then
    raise insufficient_privilege;
  end if;
  -- Serialize policy and grade writes before comparing the reviewed versions.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('course-gradebook:' || p_run_id::text, 0)
  );
  select * into current_policy
  from private.course_gradebook_policies
  where run_id = p_run_id order by version desc limit 1;
  if coalesce(current_policy.version, 0) <> p_expected_version then
    raise exception 'Course grading policy changed' using errcode = 'PT409';
  end if;

  if p_action = 'gradebook_policy' then
    if not (p_payload ?& array['scheme', 'bands']) or
       p_payload - array['scheme', 'bands'] <> '{}'::jsonb or
       jsonb_typeof(p_payload->'scheme') is distinct from 'string' or
       jsonb_typeof(p_payload->'bands') is distinct from 'array' then
      raise exception 'Invalid course grading policy' using errcode = '22023';
    end if;
    scheme_value := p_payload->>'scheme';
    bands_value := p_payload->'bands';
    if scheme_value = 'percentage' then
      if jsonb_array_length(bands_value) <> 0 then
        raise exception 'Percentage policy cannot contain bands' using errcode = '22023';
      end if;
      canonical_bands := '[]'::jsonb;
    elsif scheme_value = 'bands' then
      band_count := jsonb_array_length(bands_value);
      if band_count not between 2 and 10 or exists (
        select 1 from jsonb_array_elements(bands_value) as item(value)
        where jsonb_typeof(item.value) is distinct from 'object'
          or not (item.value ?& array['minimum', 'label'])
          or item.value - array['minimum', 'label'] <> '{}'::jsonb
          or jsonb_typeof(item.value->'label') is distinct from 'string'
          or length(btrim(item.value->>'label')) not between 1 and 80
          or jsonb_typeof(item.value->'minimum') is distinct from 'number'
          or (item.value->>'minimum') !~ '^(0|[1-9][0-9]?|100)$'
      ) or not exists (
        select 1 from jsonb_array_elements(bands_value) as item(value)
        where (item.value->>'minimum')::integer = 0
      ) or (
        select count(distinct lower(btrim(item.value->>'label')))
        from jsonb_array_elements(bands_value) as item(value)
      ) <> band_count or (
        select count(distinct (item.value->>'minimum')::integer)
        from jsonb_array_elements(bands_value) as item(value)
      ) <> band_count then
        raise exception 'Invalid or overlapping grading bands' using errcode = '22023';
      end if;
      select jsonb_agg(
        jsonb_build_object('minimum', (item.value->>'minimum')::integer,
                           'label', btrim(item.value->>'label'))
        order by (item.value->>'minimum')::integer desc
      ) into canonical_bands
      from jsonb_array_elements(bands_value) as item(value);
    else
      raise exception 'Unsupported grading scheme' using errcode = '22023';
    end if;
    next_version := coalesce(current_policy.version, 0) + 1;
    insert into private.course_gradebook_policies(run_id, version, scheme, bands, created_by)
    values (p_run_id, next_version, scheme_value, canonical_bands, auth.uid());
    insert into public.audit_events(actor_id, action, resource_id, details)
    values (auth.uid(), 'course.gradebook_policy_published', p_run_id,
            jsonb_build_object('version', next_version, 'scheme', scheme_value));
    return jsonb_build_object('version', next_version);
  end if;

  if current_policy.version is null then
    raise exception 'Publish a grading policy first' using errcode = '22023';
  end if;
  if jsonb_typeof(p_payload->'user_id') is distinct from 'string' or
     jsonb_typeof(p_payload->'reason') is distinct from 'string' or
     jsonb_typeof(p_payload->'expected_revision') is distinct from 'number' or
     (p_payload->>'expected_revision') !~ '^(0|[1-9][0-9]{0,8})$' then
    raise exception 'Learner and expected grade revision are required' using errcode = '22023';
  end if;
  target_user := (p_payload->>'user_id')::uuid;
  expected_revision := (p_payload->>'expected_revision')::integer;
  perform 1 from public.course_enrolments membership
  where membership.course_run_id = p_run_id and membership.user_id = target_user
    and membership.status in ('enrolled', 'completed') for share;
  if not found then raise insufficient_privilege; end if;
  if p_action = 'gradebook_publish' then
    if jsonb_typeof(p_payload->'attempt_id') is distinct from 'string' or
       p_payload - array['user_id', 'attempt_id', 'expected_revision', 'reason'] <> '{}'::jsonb then
      raise exception 'Invalid grade publication' using errcode = '22023';
    end if;
    -- Use the quiz submission lock and pin its current revision until publication commits.
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('quiz-attempt:' || p_run_id::text || ':' || target_user::text, 0)
    );
    perform 1 from private.course_quizzes active_quiz
    where active_quiz.run_id = p_run_id for share;
    select attempt.* into best
    from private.course_quiz_attempts attempt
    join private.course_quizzes active_quiz
      on active_quiz.run_id = attempt.run_id and active_quiz.version = attempt.quiz_version
    join private.course_quiz_versions quiz_version
      on quiz_version.run_id = active_quiz.run_id and quiz_version.version = active_quiz.version
    where attempt.run_id = p_run_id and attempt.user_id = target_user and quiz_version.published
    order by attempt.score desc, attempt.created_at desc, attempt.id
    limit 1;
    if not found or (p_payload->>'attempt_id')::uuid is distinct from best.id then
      raise exception 'The selected attempt is no longer the best current attempt' using errcode = 'PT409';
    end if;
  end if;
  if p_action = 'gradebook_correct' and (
    not (p_payload ?& array['user_id', 'grade_value', 'expected_revision', 'reason']) or
    p_payload - array['user_id', 'grade_value', 'expected_revision', 'reason'] <> '{}'::jsonb or
    jsonb_typeof(p_payload->'grade_value') is distinct from 'string'
  ) then
    raise exception 'Invalid grade correction' using errcode = '22023';
  end if;
  reason_value := btrim(coalesce(p_payload->>'reason', ''));
  if p_action = 'gradebook_correct' and length(reason_value) not between 3 and 500 then
    raise exception 'A correction reason between 3 and 500 characters is required' using errcode = '22023';
  end if;

  select revision.* into current_grade
  from private.course_gradebook_revisions revision
  where revision.run_id = p_run_id and revision.user_id = target_user
  order by revision.revision desc limit 1;
  revision_value := coalesce(current_grade.revision, 0);
  if revision_value <> expected_revision then
    raise exception 'Published grade changed' using errcode = 'PT409';
  end if;

  if p_action = 'gradebook_publish' then
    if revision_value > 0 and length(reason_value) not between 3 and 500 then
      raise exception 'A reason is required for a grade revision' using errcode = '22023';
    end if;
    mark := private.course_gradebook_mark(current_policy.scheme, current_policy.bands, best.score);
    insert into private.course_gradebook_revisions(
      run_id, user_id, revision, attempt_id, quiz_version, source_score,
      source_passed, policy_version, grade_percent, grade_label,
      correction_reason, created_by
    ) values (
      p_run_id, target_user, revision_value + 1, best.id, best.quiz_version,
      best.score, best.passed, current_policy.version,
      nullif(mark->>'grade_percent', '')::integer,
      nullif(mark->>'grade_label', ''),
      case when revision_value > 0 then reason_value else null end, auth.uid()
    );
  else
    if current_grade.revision is null then
      raise exception 'There is no published grade to correct' using errcode = '22023';
    end if;
    grade_value := btrim(coalesce(p_payload->>'grade_value', ''));
    if current_policy.scheme = 'percentage' then
      if grade_value !~ '^(100|[0-9]{1,2})$' then
        raise exception 'Corrected percentage must be an integer from 0 to 100' using errcode = '22023';
      end if;
      mark := jsonb_build_object('grade_percent', grade_value::integer, 'grade_label', null);
    else
      if not exists (
        select 1 from jsonb_array_elements(current_policy.bands) as item(value)
        where item.value->>'label' = grade_value
      ) then
        raise exception 'Corrected label must be in the current grading policy' using errcode = '22023';
      end if;
      mark := jsonb_build_object('grade_percent', null, 'grade_label', grade_value);
    end if;
    insert into private.course_gradebook_revisions(
      run_id, user_id, revision, attempt_id, quiz_version, source_score,
      source_passed, policy_version, grade_percent, grade_label,
      correction_reason, created_by
    ) values (
      p_run_id, target_user, revision_value + 1, current_grade.attempt_id,
      current_grade.quiz_version, current_grade.source_score,
      current_grade.source_passed, current_policy.version,
      nullif(mark->>'grade_percent', '')::integer,
      nullif(mark->>'grade_label', ''), reason_value, auth.uid()
    );
  end if;
  insert into public.audit_events(actor_id, action, resource_id, details)
  values (auth.uid(), case when p_action = 'gradebook_correct'
      then 'course.gradebook_grade_corrected' else 'course.gradebook_grade_published' end,
    p_run_id, jsonb_build_object('user_id', target_user, 'revision', revision_value + 1,
      'attempt_id', case when p_action = 'gradebook_publish' then best.id else current_grade.attempt_id end,
      'policy_version', current_policy.version));
  return jsonb_build_object('revision', revision_value + 1);
end;
$$;
revoke all on function private.course_gradebook_command(uuid, text, jsonb, integer, boolean)
  from public, anon, authenticated, service_role;

create function private.course_gradebook(
  p_run_id uuid, p_offset integer default 0, p_limit integer default 20
) returns jsonb language sql stable security definer set search_path = '' as $$
  select private.course_gradebook_projection(p_run_id, p_offset, p_limit);
$$;
create function public.course_gradebook(
  p_run_id uuid, p_offset integer default 0, p_limit integer default 20
) returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.course_gradebook(p_run_id, p_offset, p_limit);
$$;
revoke all on function private.course_gradebook(uuid, integer, integer),
  public.course_gradebook(uuid, integer, integer) from public, anon, service_role;
grant execute on function private.course_gradebook(uuid, integer, integer),
  public.course_gradebook(uuid, integer, integer) to authenticated;

-- A keyset cursor keeps successive reads stable while additional revisions are
-- published. Roles see only the retained record scopes that they can currently access.
create function private.course_gradebook_history(
  p_run_id uuid, p_user_id uuid default null, p_before_revision integer default null,
  p_limit integer default 20
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  context jsonb;
  staff boolean;
  target_user uuid := coalesce(p_user_id, auth.uid());
begin
  if p_limit is null or p_limit not between 1 and 100 or
     (p_before_revision is not null and p_before_revision < 1) then
    raise exception 'Invalid gradebook history page' using errcode = '22023';
  end if;
  context := private.course_gradebook_context(p_run_id);
  staff := coalesce((context->>'staff')::boolean, false);
  if (not staff and target_user is distinct from auth.uid()) or not exists (
    select 1 from public.course_enrolments membership
    where membership.course_run_id = p_run_id and membership.user_id = target_user
      and membership.status in ('enrolled', 'completed')
  ) then
    raise insufficient_privilege;
  end if;

  return (
    with candidates as materialized (
      select history as grade, history.revision
      from private.course_gradebook_revisions history
      where history.run_id = p_run_id and history.user_id = target_user
        and (p_before_revision is null or history.revision < p_before_revision)
      order by history.revision desc limit p_limit + 1
    ), page as (
      select * from candidates order by revision desc limit p_limit
    )
    select jsonb_build_object(
      'revisions', coalesce(jsonb_agg(
        private.course_gradebook_revision_json(grade, staff) order by revision desc
      ), '[]'::jsonb),
      'next_before', case when (select count(*) from candidates) > p_limit then min(revision) end
    ) from page
  );
end;
$$;
create function public.course_gradebook_history(
  p_run_id uuid, p_user_id uuid default null, p_before_revision integer default null,
  p_limit integer default 20
) returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.course_gradebook_history(p_run_id, p_user_id, p_before_revision, p_limit);
$$;
revoke all on function private.course_gradebook_history(uuid, uuid, integer, integer),
  public.course_gradebook_history(uuid, uuid, integer, integer) from public, anon, service_role;
grant execute on function private.course_gradebook_history(uuid, uuid, integer, integer),
  public.course_gradebook_history(uuid, uuid, integer, integer) to authenticated;

-- Export one transaction-consistent view of the active roster's current grades.
-- Historical reasons stay in the individually authorized history projection.
create function private.course_gradebook_export(p_run_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  context jsonb := private.course_gradebook_context(p_run_id);
  maximum_rows constant integer := 5000;
  grade_rows jsonb;
begin
  if not coalesce((context->>'staff')::boolean, false) then
    raise insufficient_privilege;
  end if;

  with current_grades as (
    select membership.user_id, coalesce(profile.display_name, '') as name,
      history.grade
    from public.course_enrolments membership
    join public.profiles profile on profile.id = membership.user_id
    join lateral (
      select candidate as grade from private.course_gradebook_revisions candidate
      where candidate.run_id = membership.course_run_id and candidate.user_id = membership.user_id
      order by candidate.revision desc limit 1
    ) history on true
    where membership.course_run_id = p_run_id and membership.status in ('enrolled', 'completed')
    order by profile.display_name, membership.user_id limit maximum_rows + 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'user_id', user_id, 'name', name,
    'grade', private.course_gradebook_revision_json(grade, false)
  ) order by name, user_id), '[]'::jsonb) into grade_rows
  from current_grades;

  if jsonb_array_length(grade_rows) > maximum_rows then
    raise exception 'Course grade export exceeds 5000 published grades' using errcode = '22023';
  end if;
  return grade_rows;
end;
$$;
create function public.course_gradebook_export(p_run_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.course_gradebook_export(p_run_id);
$$;
revoke all on function private.course_gradebook_export(uuid), public.course_gradebook_export(uuid)
  from public, anon, service_role;
grant execute on function private.course_gradebook_export(uuid), public.course_gradebook_export(uuid)
  to authenticated;

-- Internal mutations retain the original Premium and exact-resource command paths.
alter function private.course_workspace_action(uuid, text, jsonb, integer)
  rename to course_workspace_action_before_gradebook;
revoke all on function private.course_workspace_action_before_gradebook(uuid, text, jsonb, integer)
  from public, anon, authenticated, service_role;
create function private.course_workspace_action(
  p_run_id uuid, p_action text, p_payload jsonb, p_expected_version integer default 0
) returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if p_action in ('gradebook_policy', 'gradebook_publish', 'gradebook_correct') then
    return private.course_gradebook_command(p_run_id, p_action, p_payload, p_expected_version, false);
  end if;
  return private.course_workspace_action_before_gradebook(
    p_run_id, p_action, p_payload, p_expected_version
  );
end;
$$;
revoke all on function private.course_workspace_action(uuid, text, jsonb, integer)
  from public, anon, authenticated, service_role;
grant execute on function private.course_workspace_action(uuid, text, jsonb, integer)
  to authenticated;

-- Academy writes use the dedicated active-only action and never the internal RPC.
do $$
declare
  definition text := pg_catalog.pg_get_functiondef('private.academy_learning_action(uuid,text,jsonb,integer)'::regprocedure);
  input_anchor constant text := $anchor$when 'feedback' then array['rating','comment']$anchor$;
  write_anchor constant text := '  result := private.course_workspace_action_before_premium';
begin
  if cardinality(string_to_array(definition, input_anchor)) <> 2 or
     cardinality(string_to_array(definition, write_anchor)) <> 2 then
    raise exception 'Expected Academy learning action boundaries';
  end if;
  execute replace(replace(definition, input_anchor, input_anchor || $extra$
    when 'gradebook_policy' then array['scheme','bands']
    when 'gradebook_publish' then array['user_id','attempt_id','expected_revision','reason']
    when 'gradebook_correct' then array['user_id','grade_value','expected_revision','reason']
$extra$), write_anchor, $dispatch$
  if p_action in ('gradebook_policy', 'gradebook_publish', 'gradebook_correct') then
    return private.course_gradebook_command(p_run_id, p_action, p_payload, p_expected_version, true);
  end if;
$dispatch$ || write_anchor);
end;
$$;

-- The existing Academy transport gate admits only this read-only endpoint in
-- active/grace; all learner and course scope checks still run in PostgreSQL.
do $$
declare
  definition text := pg_catalog.pg_get_functiondef('private.require_academy_course_access()'::regprocedure);
  anchor constant text := '''/rpc/course_content_studio''';
  portal_definition text := pg_catalog.pg_get_functiondef('private.require_portal_access()'::regprocedure);
  portal_anchor constant text := '= ''/rpc/course_content_studio''';
begin
  if cardinality(string_to_array(definition, anchor)) <> 2 or
     cardinality(string_to_array(portal_definition, portal_anchor)) <> 2 then
    raise exception 'Expected Academy course workspace read gate';
  end if;
  execute replace(definition, anchor,
    anchor || ', ''/rpc/course_gradebook'', ''/rpc/course_gradebook_history'', ''/rpc/course_gradebook_export''');
  execute replace(portal_definition, portal_anchor,
    'in (''/rpc/course_content_studio'', ''/rpc/course_gradebook'', ''/rpc/course_gradebook_history'', ''/rpc/course_gradebook_export'')');
end;
$$;

notify pgrst, 'reload schema';
commit;
