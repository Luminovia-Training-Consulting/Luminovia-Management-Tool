BEGIN;

-- Aggregate results are an independent, opt-in grading policy. They consume
-- released assessment facts and do not change an assessment or certificate.
create table private.course_weighted_policies (
  run_id uuid not null references public.course_runs(id),
  version integer not null check (version > 0),
  threshold integer not null check (threshold between 0 and 100),
  missing_required text not null check (missing_required in ('block','zero')),
  separate_reviewer boolean not null,
  items jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 1 and 30),
  created_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (run_id, version)
);
create table private.course_weighted_exemptions (
  run_id uuid not null,
  user_id uuid not null,
  policy_version integer not null,
  item_key text not null,
  revision integer not null check (revision > 0),
  excused boolean not null,
  reason text not null check (length(reason) between 3 and 500),
  created_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (run_id, user_id, policy_version, item_key, revision),
  foreign key (run_id, user_id) references public.course_enrolments(course_run_id,user_id),
  foreign key (run_id, policy_version) references private.course_weighted_policies(run_id,version)
);
create table private.course_weighted_reviews (
  run_id uuid not null,
  user_id uuid not null,
  revision integer not null check (revision > 0),
  policy_version integer not null,
  prior_release integer not null check (prior_release >= 0),
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  reason text not null check (length(reason) <= 500),
  reviewed_by uuid not null,
  reviewed_at timestamptz not null default clock_timestamp(),
  primary key (run_id,user_id,revision),
  foreign key (run_id,user_id) references public.course_enrolments(course_run_id,user_id),
  foreign key (run_id,policy_version) references private.course_weighted_policies(run_id,version)
);
create table private.course_weighted_releases (
  run_id uuid not null,
  user_id uuid not null,
  revision integer not null check (revision > 0),
  review_revision integer not null,
  released_by uuid not null,
  released_at timestamptz not null default clock_timestamp(),
  primary key (run_id,user_id,revision),
  unique (run_id,user_id,review_revision),
  foreign key (run_id,user_id,review_revision) references private.course_weighted_reviews(run_id,user_id,revision)
);
alter table private.course_weighted_policies enable row level security;
alter table private.course_weighted_exemptions enable row level security;
alter table private.course_weighted_reviews enable row level security;
alter table private.course_weighted_releases enable row level security;
revoke all on private.course_weighted_policies, private.course_weighted_exemptions,
  private.course_weighted_reviews, private.course_weighted_releases from public, anon, authenticated, service_role;

create trigger course_weighted_policies_immutable before update or delete on private.course_weighted_policies
for each row execute function private.prevent_course_gradebook_history_mutation();
create trigger course_weighted_exemptions_immutable before update or delete on private.course_weighted_exemptions
for each row execute function private.prevent_course_gradebook_history_mutation();
create trigger course_weighted_reviews_immutable before update or delete on private.course_weighted_reviews
for each row execute function private.prevent_course_gradebook_history_mutation();
create trigger course_weighted_releases_immutable before update or delete on private.course_weighted_releases
for each row execute function private.prevent_course_gradebook_history_mutation();

-- Resolve only released numeric evidence. A changed legacy quiz band has no
-- exact numeric value, unlike a grade calculated from an unchanged band label.
create function private.course_weighted_source(p_run_id uuid, p_user_id uuid, p_key text)
returns jsonb language plpgsql stable strict set search_path = '' as $$
declare
  evidence jsonb;
begin
  if p_key = 'quiz' then
    select jsonb_build_object(
      'score', case when grade.grade_percent is not null then grade.grade_percent
        when grade.grade_label = private.course_gradebook_mark(policy.scheme,policy.bands,grade.source_score)->>'grade_label'
          then grade.source_score end,
      'revision', grade.revision, 'attempt', grade.attempt_id, 'quiz_version', grade.quiz_version,
      'unscored', grade.grade_percent is null and grade.grade_label is distinct from
        private.course_gradebook_mark(policy.scheme,policy.bands,grade.source_score)->>'grade_label'
    ) into evidence
    from private.course_gradebook_revisions grade
    join private.course_gradebook_policies policy on policy.run_id = grade.run_id and policy.version = grade.policy_version
    where grade.run_id = p_run_id and grade.user_id = p_user_id order by grade.revision desc limit 1;
  elsif p_key = 'exam' then
    select jsonb_build_object('score', result.score, 'revision', scheduled.version)
    into evidence
    from private.course_timed_exams scheduled
    join private.course_exam_results result on result.run_id = scheduled.run_id
    where scheduled.run_id = p_run_id and result.participant_id = p_user_id
      and scheduled.published_at is not null and result.score is not null;
  else
    -- An older result cannot silently replace the review of the latest submission.
    -- A private draft never revokes an existing visible release on that attempt.
    select jsonb_build_object('score', case when review.state = 'released' then
      (select sum(score.value::numeric) from jsonb_array_elements(review.scores) score(value)) * 100
      / nullif((select sum(maximum.points) from jsonb_array_elements(definition.rubric) criterion(value)
        cross join lateral (
          select max((level.value->>'points')::numeric) points
          from jsonb_array_elements(criterion.value->'levels') level(value)
        ) maximum), 0) end,
      'attempt', attempt.id, 'revision', review.version, 'assignment_version', attempt.assignment_version,
      'review_state', review.state
    ) into evidence
    from private.course_assignment_attempts attempt
    join private.course_assignments assignment on assignment.id = attempt.assignment_id
    join private.course_assignment_definitions definition on definition.assignment_id = assignment.id
      and definition.version = attempt.assignment_version
    left join lateral (
      select reviewed.version, reviewed.state, reviewed.scores from private.course_assignment_reviews reviewed
      where reviewed.attempt_id = attempt.id and reviewed.state <> 'draft'
      order by reviewed.version desc limit 1
    ) review on true
    where assignment.run_id = p_run_id and assignment.id = p_key::uuid and attempt.user_id = p_user_id
    order by attempt.attempt_no desc limit 1;
  end if;
  return evidence;
end;
$$;
revoke all on function private.course_weighted_source(uuid,uuid,text) from public, anon, authenticated, service_role;

-- Use exact decimal arithmetic and round once, including the capped bonus.
-- The basis records private source and exemption revisions for reproducibility.
create function private.course_weighted_snapshot(
  p_policy private.course_weighted_policies, p_user_id uuid
) returns jsonb language plpgsql stable set search_path = '' as $$
declare
  item jsonb;
  item_key text;
  treatment text;
  weight integer;
  score numeric;
  evidence jsonb;
  exemption private.course_weighted_exemptions;
  components jsonb := '[]'::jsonb;
  basis jsonb := '[]'::jsonb;
  status text;
  denominator integer := 0;
  numerator numeric := 0;
  bonus numeric := 0;
  blocked boolean := false;
  final numeric;
begin
  for item in select value from jsonb_array_elements(p_policy.items) loop
    item_key := item->>'key';
    treatment := item->>'treatment';
    weight := (item->>'weight')::integer;
    select * into exemption from private.course_weighted_exemptions
      where run_id = p_policy.run_id and user_id = p_user_id and policy_version = p_policy.version
        and course_weighted_exemptions.item_key = item->>'key'
      order by revision desc limit 1;
    evidence := case when not coalesce(exemption.excused, false)
      then private.course_weighted_source(p_policy.run_id, p_user_id, item_key) end;
    score := (evidence->>'score')::numeric;
    if exemption.excused then
      status := 'excused';
    elsif coalesce((evidence->>'unscored')::boolean,false) then
      -- A released categorical correction is not missing work. It needs a
      -- numerical quiz release or an explicit exemption before contributing.
      status := 'unscored';
      blocked := blocked or treatment = 'required';
    elsif treatment = 'bonus' then
      status := case when score is null then 'missing' else 'graded' end;
      bonus := bonus + weight * coalesce(score, 0) / 100;
    elsif score is not null then
      status := 'graded';
      denominator := denominator + weight;
      numerator := numerator + weight * score;
    elsif treatment = 'optional' then
      status := 'missing';
    elsif p_policy.missing_required = 'zero' then
      status := 'zero';
      denominator := denominator + weight;
    else
      status := 'missing';
      blocked := true;
    end if;
    components := components || jsonb_build_array(item || jsonb_build_object(
      'status', status, 'score', round(score, 2)
    ));
    basis := basis || jsonb_build_array(jsonb_build_object(
      'key', item_key, 'evidence', evidence, 'exemption_revision', exemption.revision
    ));
  end loop;
  if not blocked and denominator > 0 then
    final := round(least(100::numeric, numerator / denominator + bonus), 2);
  end if;
  return jsonb_build_object(
    'policy_version', p_policy.version, 'threshold', p_policy.threshold, 'components', components,
    'missing_required', p_policy.missing_required, 'percent', final,
    'passed', final >= p_policy.threshold, 'basis', basis
  );
end;
$$;
revoke all on function private.course_weighted_snapshot(private.course_weighted_policies,uuid)
  from public, anon, authenticated, service_role;

create function private.course_weighted_fingerprint(p_snapshot jsonb)
returns text language sql immutable strict set search_path = '' as $$
  select encode(extensions.digest(p_snapshot::text, 'sha256'), 'hex');
$$;
revoke all on function private.course_weighted_fingerprint(jsonb)
  from public, anon, authenticated, service_role;

-- Read one learner's preview and paged release histories. Learners never receive
-- pending reviews, staff notes, source IDs or the course-wide roster.
create function private.course_weighted_gradebook(
  p_run_id uuid, p_user_id uuid default null, p_before_revision integer default null
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  context jsonb := private.course_gradebook_context(p_run_id);
  staff boolean := (context->>'staff')::boolean;
  target_user uuid := case when staff then p_user_id else auth.uid() end;
  policy private.course_weighted_policies;
  sources jsonb;
  preview jsonb;
  draft jsonb;
  history jsonb;
  next_before integer;
  release_count integer;
  latest_exemptions jsonb;
begin
  if p_before_revision is not null and p_before_revision < 1 then raise invalid_parameter_value; end if;
  if not staff and p_user_id is not null and p_user_id is distinct from auth.uid() then raise insufficient_privilege; end if;
  if target_user is not null and not exists (
    select 1 from public.course_enrolments where course_run_id = p_run_id and user_id = target_user
      and status in ('enrolled','completed')
  ) then raise insufficient_privilege; end if;

  if staff then
    select * into policy from private.course_weighted_policies where run_id = p_run_id order by version desc limit 1;
    select jsonb_build_array(jsonb_build_object('key','quiz','label',null), jsonb_build_object('key','exam','label',null),
      jsonb_build_object('key','text_exam','label',null))
      || coalesce(jsonb_agg(jsonb_build_object('key', assignment.id, 'label', definition.title)
        order by definition.title, assignment.id), '[]'::jsonb) into sources
    from private.course_assignments assignment
    join private.course_assignment_definitions definition on definition.assignment_id = assignment.id
      and definition.version = assignment.published_version
    where assignment.run_id = p_run_id;

    if target_user is not null and policy.version is not null then
      preview := private.course_weighted_snapshot(policy, target_user);
      select jsonb_build_object('revision', review.revision, 'policy_version', review.policy_version,
          'prior_release', review.prior_release, 'fingerprint', review.fingerprint,
          'reviewed_at', review.reviewed_at, 'own_review', review.reviewed_by = auth.uid(),
          'reason', review.reason) into draft
      from private.course_weighted_reviews review where review.run_id = p_run_id
        and review.user_id = target_user order by review.revision desc limit 1;
      select coalesce(jsonb_object_agg(item_key, jsonb_build_object(
        'revision', item.revision, 'excused', item.excused, 'reason', item.reason
      )), '{}'::jsonb) into latest_exemptions
      from (select distinct on (item_key) item_key, revision, excused, reason
        from private.course_weighted_exemptions where run_id = p_run_id and user_id = target_user
          and policy_version = policy.version order by item_key, revision desc) item;
    end if;
  end if;

  if target_user is not null then
    select coalesce(max(revision), 0) into release_count from private.course_weighted_releases
      where run_id = p_run_id and user_id = target_user;
    with candidates as materialized (
      select grade.revision, grade.released_at, review.snapshot, review.reason
      from private.course_weighted_releases grade join private.course_weighted_reviews review
        on review.run_id = grade.run_id and review.user_id = grade.user_id and review.revision = grade.review_revision
      where grade.run_id = p_run_id and grade.user_id = target_user
        and (p_before_revision is null or grade.revision < p_before_revision)
      order by grade.revision desc limit 21
    )
    select coalesce(jsonb_agg(jsonb_build_object(
      'revision', entry.revision, 'released_at', entry.released_at, 'result', entry.snapshot - 'basis',
      'reason', case when staff then entry.reason end
    ) order by entry.revision desc), '[]'::jsonb),
      case when (select count(*) from candidates) > 20 then min(entry.revision) end
    into history, next_before from (select * from candidates order by revision desc limit 20) entry;
  end if;

  return jsonb_build_object(
    'can_manage', (context->>'gradebook_can_manage')::boolean,
    'policy', case when policy.version is not null then to_jsonb(policy) - array['run_id','created_by'] end,
    'sources', coalesce(sources, '[]'::jsonb),
    'preview', preview - 'basis', 'fingerprint', private.course_weighted_fingerprint(preview),
    'review', draft, 'exemptions', coalesce(latest_exemptions, '{}'::jsonb),
    'latest_release', coalesce(release_count, 0), 'history', coalesce(history, '[]'::jsonb),
    'next_before', next_before
  );
end;
$$;

create function private.course_weighted_gradebook_command(
  p_run_id uuid, p_action text, p_payload jsonb, p_expected_policy integer
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  context jsonb;
  policy private.course_weighted_policies;
  items jsonb := '[]'::jsonb;
  seen text[] := '{}';
  item jsonb;
  item_key text;
  assessment_label text;
  base_weight integer := 0;
  bonus_weight integer := 0;
  weight integer;
  learner uuid;
  current_exemption integer;
  current_review private.course_weighted_reviews;
  current_release integer;
  snapshot jsonb;
  fingerprint text;
  reason text;
  version_value integer;
begin
  if p_run_id is null or p_action is null or p_action not in ('policy','exempt','review','release')
    or jsonb_typeof(p_payload) is distinct from 'object' or p_expected_policy is null or p_expected_policy < 0
    then raise invalid_parameter_value; end if;
  -- Existing source writers also use course locking. Check scope again after
  -- taking the lock and preserve a consistent snapshot through publication.
  if (select installation.edition from private.installation_identity installation) = 'internal'
    then perform private.lock_course_premium(p_run_id);
  else
    perform private.lock_academy_course_access();
    perform 1 from public.course_runs where id = p_run_id and archived_at is null for no key update;
  end if;
  perform 1 from public.profiles where id = auth.uid() and active for share;
  if not found then raise insufficient_privilege; end if;
  perform 1 from public.user_roles where user_id = auth.uid() order by role for share;
  context := private.course_gradebook_context(p_run_id);
  if not coalesce((context->>'gradebook_can_manage')::boolean,false) then raise insufficient_privilege; end if;
  select * into policy from private.course_weighted_policies where run_id = p_run_id order by version desc limit 1;
  if coalesce(policy.version,0) <> p_expected_policy
    then raise exception 'Weighted grading policy changed' using errcode = 'PT409'; end if;

  if p_action = 'policy' then
    if p_payload - array['items','threshold','missing_required','separate_reviewer'] <> '{}'::jsonb
      or jsonb_typeof(p_payload->'threshold') is distinct from 'number'
      or (p_payload->>'threshold') !~ '^(0|[1-9][0-9]?|100)$'
      or not coalesce(p_payload->>'missing_required' in ('block','zero'),false)
      or jsonb_typeof(p_payload->'separate_reviewer') is distinct from 'boolean'
      or jsonb_typeof(p_payload->'items') is distinct from 'array'
      then raise invalid_parameter_value; end if;
    if jsonb_array_length(p_payload->'items') not between 1 and 30 then raise invalid_parameter_value; end if;
    for item in select value from jsonb_array_elements(p_payload->'items') loop
      item_key := item->>'key';
      if jsonb_typeof(item) <> 'object' or item - array['key','weight','treatment'] <> '{}'::jsonb
        or jsonb_typeof(item->'key') is distinct from 'string' or item_key = any(seen)
        or not coalesce(item->>'treatment' in ('required','optional','bonus'),false)
        or jsonb_typeof(item->'weight') is distinct from 'number'
        or (item->>'weight') !~ '^([1-9][0-9]?|100)$'
        then raise invalid_parameter_value; end if;
      assessment_label := null;
      if item_key not in ('quiz','exam','text_exam') then
        select definition.title into assessment_label from private.course_assignments assignment
        join private.course_assignment_definitions definition on definition.assignment_id = assignment.id
          and definition.version = assignment.published_version
        where assignment.run_id = p_run_id and assignment.id = item_key::uuid;
        if not found or item_key <> ((item_key::uuid)::text) then raise invalid_parameter_value; end if;
      end if;
      weight := (item->>'weight')::integer;
      if item->>'treatment' = 'bonus' then bonus_weight := bonus_weight + weight;
      else base_weight := base_weight + weight; end if;
      seen := array_append(seen, item_key);
      items := items || jsonb_build_array(item || jsonb_build_object('label', assessment_label));
    end loop;
    if base_weight <> 100 or bonus_weight > 100 then raise invalid_parameter_value; end if;
    version_value := p_expected_policy + 1;
    insert into private.course_weighted_policies(run_id,version,threshold,missing_required,separate_reviewer,items,created_by)
    values (p_run_id,version_value,(p_payload->>'threshold')::integer,p_payload->>'missing_required',
      (p_payload->>'separate_reviewer')::boolean,items,auth.uid());
    insert into public.audit_events(actor_id,action,resource_id,details)
    values (auth.uid(),'course.weighted_policy_saved',p_run_id,jsonb_build_object('version',version_value));
    return jsonb_build_object('version',version_value);
  end if;

  if policy.version is null or jsonb_typeof(p_payload->'user_id') is distinct from 'string'
    then raise invalid_parameter_value; end if;
  learner := (p_payload->>'user_id')::uuid;
  if learner = auth.uid() then raise insufficient_privilege; end if;
  perform 1 from public.course_enrolments where course_run_id = p_run_id and user_id = learner
    and status in ('enrolled','completed') for share;
  if not found then raise insufficient_privilege; end if;

  if p_action = 'exempt' then
    item_key := p_payload->>'key';
    reason := btrim(coalesce(p_payload->>'reason',''));
    if p_payload - array['user_id','key','excused','reason','expected_exemption'] <> '{}'::jsonb
      or jsonb_typeof(p_payload->'excused') is distinct from 'boolean'
      or jsonb_typeof(p_payload->'reason') is distinct from 'string' or length(reason) not between 3 and 500
      or jsonb_typeof(p_payload->'expected_exemption') is distinct from 'number'
      or (p_payload->>'expected_exemption') !~ '^(0|[1-9][0-9]{0,8})$'
      or not exists (select 1 from jsonb_array_elements(policy.items) slot(value) where slot.value->>'key' = item_key)
      then raise invalid_parameter_value; end if;
    select coalesce(max(exemption.revision),0) into current_exemption
    from private.course_weighted_exemptions exemption where exemption.run_id = p_run_id
      and exemption.user_id = learner and exemption.policy_version = policy.version
      and exemption.item_key = p_payload->>'key';
    if current_exemption <> (p_payload->>'expected_exemption')::integer
      then raise exception 'Weighted exemption changed' using errcode = 'PT409'; end if;
    version_value := current_exemption + 1;
    insert into private.course_weighted_exemptions(run_id,user_id,policy_version,item_key,revision,excused,reason,created_by)
    values (p_run_id,learner,policy.version,item_key,version_value,(p_payload->>'excused')::boolean,reason,auth.uid());
  else
    if jsonb_typeof(p_payload->'expected_review') is distinct from 'number'
      or (p_payload->>'expected_review') !~ '^(0|[1-9][0-9]{0,8})$'
      or jsonb_typeof(p_payload->'expected_release') is distinct from 'number'
      or (p_payload->>'expected_release') !~ '^(0|[1-9][0-9]{0,8})$'
      then raise invalid_parameter_value; end if;
    select * into current_review from private.course_weighted_reviews where run_id = p_run_id and user_id = learner
      order by revision desc limit 1;
    select coalesce(max(revision),0) into current_release from private.course_weighted_releases
      where run_id = p_run_id and user_id = learner;
    if coalesce(current_review.revision,0) <> (p_payload->>'expected_review')::integer
      or current_release <> (p_payload->>'expected_release')::integer
      then raise exception 'Weighted result changed' using errcode = 'PT409'; end if;
    snapshot := private.course_weighted_snapshot(policy,learner);
    fingerprint := private.course_weighted_fingerprint(snapshot);
    if snapshot->>'percent' is null then raise exception 'Weighted grade incomplete' using errcode = 'PT409'; end if;
    if p_action = 'review' then
      reason := btrim(coalesce(p_payload->>'reason',''));
      if p_payload - array['user_id','expected_review','expected_release','fingerprint','reason'] <> '{}'::jsonb
        or jsonb_typeof(p_payload->'reason') is distinct from 'string' or length(reason) > 500
        or (current_release > 0 and length(reason) < 3) then raise invalid_parameter_value; end if;
      if p_payload->>'fingerprint' is distinct from fingerprint
        then raise exception 'Assessment evidence changed' using errcode = 'PT409'; end if;
      version_value := coalesce(current_review.revision,0) + 1;
      insert into private.course_weighted_reviews(
        run_id,user_id,revision,policy_version,prior_release,fingerprint,snapshot,reason,reviewed_by
      ) values (p_run_id,learner,version_value,policy.version,current_release,fingerprint,snapshot,reason,auth.uid());
    else
      if p_payload - array['user_id','expected_review','expected_release'] <> '{}'::jsonb then raise invalid_parameter_value; end if;
      if current_review.revision is null or current_review.prior_release <> current_release
        or current_review.policy_version <> policy.version or current_review.fingerprint <> fingerprint
        then raise exception 'Refresh the weighted review' using errcode = 'PT409'; end if;
      if policy.separate_reviewer and current_review.reviewed_by = auth.uid() then raise insufficient_privilege; end if;
      version_value := current_release + 1;
      insert into private.course_weighted_releases(run_id,user_id,revision,review_revision,released_by)
      values (p_run_id,learner,version_value,current_review.revision,auth.uid());
    end if;
  end if;
  insert into public.audit_events(actor_id,action,resource_id,details)
  values (auth.uid(),'course.weighted_grade_' || p_action,p_run_id,
    jsonb_build_object('user_id',learner,'version',version_value,'policy_version',policy.version));
  return jsonb_build_object('version',version_value);
end;
$$;

create function public.course_weighted_gradebook(p_run_id uuid,p_user_id uuid default null,p_before_revision integer default null)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.course_weighted_gradebook(p_run_id,p_user_id,p_before_revision);
$$;
create function public.course_weighted_gradebook_command(p_run_id uuid,p_action text,p_payload jsonb,p_expected_policy integer)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.course_weighted_gradebook_command(p_run_id,p_action,p_payload,p_expected_policy);
$$;
revoke all on function private.course_weighted_gradebook(uuid,uuid,integer),public.course_weighted_gradebook(uuid,uuid,integer),
  private.course_weighted_gradebook_command(uuid,text,jsonb,integer),public.course_weighted_gradebook_command(uuid,text,jsonb,integer)
  from public,anon,service_role;
grant execute on function private.course_weighted_gradebook(uuid,uuid,integer),public.course_weighted_gradebook(uuid,uuid,integer),
  private.course_weighted_gradebook_command(uuid,text,jsonb,integer),public.course_weighted_gradebook_command(uuid,text,jsonb,integer)
  to authenticated;

do $$
declare
  academy_gate text := pg_catalog.pg_get_functiondef('private.require_academy_course_access()'::regprocedure);
  portal_gate text := pg_catalog.pg_get_functiondef('private.require_portal_access()'::regprocedure);
  academy_anchor constant text := '  licence_status := private.academy_course_access_status();';
  portal_anchor constant text := '  perform private.require_portal_access_before_course_content();';
begin
  if cardinality(string_to_array(academy_gate, academy_anchor)) <> 2
     or cardinality(string_to_array(portal_gate, portal_anchor)) <> 2 then raise exception 'Expected gradebook request gates'; end if;
  execute replace(academy_gate, academy_anchor, academy_anchor || chr(10) || $gate$
  if (licence_status in ('active','grace') and request_method in ('GET','HEAD','POST')
      and request_path = '/rpc/course_weighted_gradebook')
    or (licence_status = 'active' and request_method = 'POST'
      and request_path = '/rpc/course_weighted_gradebook_command')
  then return; end if;
$gate$);
  execute replace(portal_gate, portal_anchor, $gate$
  if (select installation.edition from private.installation_identity installation) = 'internal'
     and current_setting('role',true) = 'authenticated' and private.participant_actor() and (
       current_setting('request.method',true) in ('GET','HEAD','POST')
       and current_setting('request.path',true) = '/rpc/course_weighted_gradebook'
     ) then return; end if;
$gate$ || portal_anchor);
end;
$$;
notify pgrst, 'reload schema';
COMMIT;
