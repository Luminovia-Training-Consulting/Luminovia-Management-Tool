begin;

-- Keep structured recipient-directed evaluations separate from the older
-- anonymous course feedback and the reviewed lecturer profile publication.
create table private.course_evaluations (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.course_runs(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  rater_role text not null,
  subject_kind text not null,
  subject_id uuid not null,
  score integer not null check (score between 1 and 5),
  comment text not null default '' check (char_length(comment) <= 2000),
  version integer not null default 1 check (version > 0),
  unique (run_id, user_id, rater_role, subject_kind, subject_id),
  constraint course_evaluation_recipient check (
    (rater_role = 'learner' and subject_kind in ('lecturer', 'company'))
    or (rater_role = 'company' and subject_kind = 'lecturer')
    or (rater_role = 'lecturer' and subject_kind in ('course', 'company', 'class'))
  )
);
create index course_evaluations_user on private.course_evaluations(user_id);
create index course_evaluation_comments_page
  on private.course_evaluations(run_id, rater_role, subject_kind, subject_id, id)
  where comment <> '';
alter table private.course_evaluations enable row level security;
revoke all on private.course_evaluations from public, anon, authenticated, service_role;
create trigger permanent_deletion_fence before insert or update or delete on private.course_evaluations
  for each row execute function private.guard_permanent_deletion();

-- A private append-only receipt avoids joining a public comment ID to the
-- generic administration audit's actor-name projection.
create table private.course_evaluation_revisions (
  evaluation_id uuid not null references private.course_evaluations(id) on delete cascade,
  version integer not null check (version > 0),
  recorded_at timestamptz not null default statement_timestamp(),
  primary key (evaluation_id, version)
);
alter table private.course_evaluation_revisions enable row level security;
revoke all on private.course_evaluation_revisions from public, anon, authenticated, service_role;
create trigger permanent_deletion_fence before insert or update or delete on private.course_evaluation_revisions
  for each row execute function private.guard_permanent_deletion();

create function private.course_evaluation_completed(p_run_id uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select coalesce(max(session.ends_at) < statement_timestamp(), false)
    from public.course_sessions session where session.course_run_id = p_run_id;
$$;

create function private.course_evaluation_subjects(p_run_id uuid)
returns table(subject_kind text, subject_id uuid, label text)
language sql stable security invoker set search_path = '' as $$
  with course as (
    select run.id, run.organisation_id, template.title, organisation.name
    from public.course_runs run
    join public.course_templates template on template.id = run.template_id
    join public.organisations organisation on organisation.id = run.organisation_id
    where run.id = p_run_id and run.archived_at is null and organisation.archived_at is null
  )
  select 'course', course.id, course.title from course
  union all
  select 'company', course.organisation_id, course.name from course
  union all
  select 'class', class.id, class.name from course
  join private.course_class_assignments link on link.course_id = course.id and link.organisation_id = course.organisation_id
  join private.course_classes class on class.id = link.class_id and class.organisation_id = course.organisation_id
  union all
  select distinct 'lecturer', profile.id, profile.display_name
  from course
  join public.jobs position on position.course_run_id = course.id
  join public.job_claims claim on claim.job_id = position.id and claim.status = 'confirmed'
  join public.profiles profile on profile.id = claim.lecturer_id
  where private.lecturer_user(profile.id) and (
    (select edition from private.installation_identity) = 'internal' or
    private.academy_course_teacher(course.id, profile.id)
  );
$$;

create function private.course_evaluation_can_rate(
  p_context jsonb, p_rater_role text, p_kind text, p_subject uuid
)
returns boolean language sql stable security invoker set search_path = '' as $$
  select coalesce(case p_rater_role
    when 'learner' then (p_context->>'learner')::boolean
      and (p_kind = 'company' or (p_kind = 'lecturer' and p_subject <> auth.uid()))
    when 'company' then (p_context->>'client')::boolean and p_kind = 'lecturer' and p_subject <> auth.uid()
    when 'lecturer' then (p_context->>'teacher')::boolean and p_kind in ('course', 'company', 'class')
  end, false);
$$;

-- A separate decision for written feedback prevents a learner's permission
-- to see their instructor's aggregate from exposing someone else's prose.
create function private.course_evaluation_can_review(
  p_context jsonb, p_rater_role text, p_kind text, p_subject uuid, p_written boolean
)
returns boolean language sql stable security invoker set search_path = '' as $$
  select (p_context->>'manager')::boolean
    or ((p_context->>'teacher')::boolean and (
      (p_kind = 'lecturer' and p_subject = auth.uid()) or
      (p_rater_role = 'lecturer' and p_kind in ('course', 'company', 'class'))
    ))
    or ((p_context->>'client')::boolean and p_kind = 'company' and p_rater_role = 'learner')
    or (not p_written and (p_context->>'learner')::boolean and p_kind = 'lecturer');
$$;

create function private.course_evaluation_context(p_run_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare context jsonb := private.course_workspace_context(p_run_id);
begin
  if (context->>'lms_enabled')::boolean is not true or not exists (
    select 1 from public.course_runs run
    join public.organisations organisation on organisation.id = run.organisation_id
    where run.id = p_run_id and organisation.archived_at is null
      and not private.deletion_row_fenced('public.course_runs', to_jsonb(run))
  ) then raise insufficient_privilege; end if;
  return context;
end;
$$;

create function private.course_evaluations(p_run_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  context jsonb := private.course_evaluation_context(p_run_id);
  completed boolean := private.course_evaluation_completed(p_run_id);
  writable boolean := completed and private.course_submission_write_enabled();
  result jsonb;
begin
  if not completed then
    return jsonb_build_object('completed', false, 'writable', false,
      'targets', '[]'::jsonb, 'mine', '[]'::jsonb, 'summaries', '[]'::jsonb);
  end if;
  with subjects as materialized (
    select * from private.course_evaluation_subjects(p_run_id)
  ), targets as (
    select rater.rater_role, subject.*
    from subjects subject
    cross join (values ('learner'), ('company'), ('lecturer')) rater(rater_role)
    where private.course_evaluation_can_rate(context, rater.rater_role, subject.subject_kind, subject.subject_id)
  ), grouped as (
    select evaluation.rater_role, subject.subject_kind, subject.subject_id, subject.label,
      count(*) as count, round(avg(evaluation.score), 2) as average,
      bool_or(evaluation.comment <> '') and private.course_evaluation_can_review(
        context, evaluation.rater_role, subject.subject_kind, subject.subject_id, true
      ) as can_read_comments
    from private.course_evaluations evaluation
    join subjects subject using (subject_kind, subject_id)
    where evaluation.run_id = p_run_id and private.course_evaluation_can_review(
      context, evaluation.rater_role, subject.subject_kind, subject.subject_id, false
    )
    group by evaluation.rater_role, subject.subject_kind, subject.subject_id, subject.label
  )
  select jsonb_build_object(
    'completed', true, 'writable', writable,
    'targets', coalesce((
      select jsonb_agg(to_jsonb(target) order by target.rater_role, target.subject_kind, target.label, target.subject_id)
      from targets target
    ), '[]'::jsonb),
    'mine', coalesce((
      select jsonb_agg(to_jsonb(target) || jsonb_build_object(
        'score', evaluation.score, 'comment', evaluation.comment, 'version', evaluation.version
      ) order by target.rater_role, target.subject_kind, target.label, target.subject_id)
      from targets target
      join private.course_evaluations evaluation using (rater_role, subject_kind, subject_id)
      where evaluation.run_id = p_run_id and evaluation.user_id = auth.uid()
    ), '[]'::jsonb),
    'summaries', coalesce((
      select jsonb_agg(to_jsonb(summary) order by summary.rater_role, summary.subject_kind, summary.label, summary.subject_id)
      from grouped summary
    ), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

create function private.course_evaluation_comments(
  p_run_id uuid, p_rater_role text, p_subject_kind text, p_subject_id uuid, p_after uuid
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  context jsonb := private.course_evaluation_context(p_run_id);
  result jsonb;
begin
  if p_rater_role is null or p_rater_role not in ('learner', 'company', 'lecturer')
    or p_subject_kind is null or p_subject_kind not in ('lecturer', 'company', 'class', 'course')
    or p_subject_id is null then raise invalid_parameter_value; end if;
  if not private.course_evaluation_completed(p_run_id)
    or not coalesce(private.course_evaluation_can_review(
      context, p_rater_role, p_subject_kind, p_subject_id, true
    ), false)
    or not exists (
      select 1 from private.course_evaluation_subjects(p_run_id) subject
      where subject.subject_kind = p_subject_kind and subject.subject_id = p_subject_id
    ) then raise insufficient_privilege; end if;

  with page as (
    select id, comment from private.course_evaluations evaluation
    where evaluation.run_id = p_run_id and evaluation.rater_role = p_rater_role
      and evaluation.subject_kind = p_subject_kind and evaluation.subject_id = p_subject_id
      and evaluation.comment <> '' and (p_after is null or evaluation.id > p_after)
    order by evaluation.id limit 26
  ), visible as (select * from page order by id limit 25)
  select jsonb_build_object(
    'items', coalesce(jsonb_agg(to_jsonb(visible) order by visible.id), '[]'::jsonb),
    'next', case when (select count(*) from page) > 25 then
      (select id from visible order by id desc limit 1) end
  ) into result from visible;
  return result;
end;
$$;

create function private.save_course_evaluation(
  p_run_id uuid, p_rater_role text, p_subject_kind text, p_subject_id uuid,
  p_score integer, p_expected_version integer, p_comment text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  target_teacher_id uuid;
  company_id uuid;
  internal_edition boolean := (select edition from private.installation_identity) = 'internal';
  context jsonb;
  subject_label text;
  normalized_comment text := btrim(p_comment, E' \t\n\r');
  saved private.course_evaluations%rowtype;
begin
  if p_rater_role is null or p_rater_role not in ('learner', 'company', 'lecturer')
    or p_subject_kind is null or p_subject_kind not in ('lecturer', 'company', 'class', 'course')
    or p_subject_id is null or p_score is null or p_score not between 1 and 5
    or p_expected_version is null or p_expected_version not between 0 and 2147483646
    or normalized_comment is null or char_length(normalized_comment) > 2000 then
    raise invalid_parameter_value;
  end if;
  target_teacher_id := case when p_subject_kind = 'lecturer' then p_subject_id
    when p_rater_role = 'lecturer' then actor_id end;
  -- Authorize once before taking resource locks, then verify the same scope
  -- again under locks before trusting the selected recipient.
  context := private.course_evaluation_context(p_run_id);
  if not private.course_evaluation_can_rate(context, p_rater_role, p_subject_kind, p_subject_id) then
    raise insufficient_privilege;
  end if;

  -- Internal scheduling amendments lock positions before their run. The
  -- dedicated scheduler instead locks its licence and run before positions.
  if internal_edition and target_teacher_id is not null then
    perform 1 from public.jobs position
    where position.course_run_id = p_run_id and exists (
      select 1 from public.job_claims claim where claim.job_id = position.id
        and claim.lecturer_id = target_teacher_id and claim.status = 'confirmed'
    ) order by position.id for share;
  end if;
  company_id := private.lock_course_submission_scope(p_run_id);
  -- The parent key lock also serializes new sessions with the completion check.
  perform 1 from public.course_runs where id = p_run_id for update;
  perform 1 from public.course_sessions where course_run_id = p_run_id order by id for share;
  perform 1 from auth.users where id = actor_id and email_confirmed_at is not null for share;
  if not found then raise insufficient_privilege; end if;
  perform 1 from public.profiles where id in (actor_id, target_teacher_id) order by id for share;
  perform 1 from public.user_roles where user_id in (actor_id, target_teacher_id) order by user_id, role for share;
  if target_teacher_id is not null then
    perform 1 from public.job_claims claim join public.jobs position on position.id = claim.job_id
    where position.course_run_id = p_run_id and claim.lecturer_id = target_teacher_id and claim.status = 'confirmed'
    order by position.id, claim.id for share of claim, position;
    if not internal_edition then
      perform 1 from private.academy_course_instructors
        where course_id = p_run_id and instructor_id = target_teacher_id
          and released_at is null order by claim_id for share;
    end if;
  end if;
  case p_rater_role
    when 'learner' then
      perform 1 from private.company_participant_memberships
        where organisation_id = company_id and user_id = actor_id and status = 'active' for share;
      perform 1 from public.course_enrolments
        where course_run_id = p_run_id and user_id = actor_id and status in ('enrolled', 'completed') for share;
    when 'company' then
      perform 1 from public.client_organisation_memberships
        where organisation_id = company_id and user_id = actor_id and removed_at is null for share;
    else
      perform 1 from private.course_class_assignments where course_id = p_run_id for share;
  end case;
  context := private.course_evaluation_context(p_run_id);
  if not private.course_evaluation_completed(p_run_id)
    or not private.course_evaluation_can_rate(context, p_rater_role, p_subject_kind, p_subject_id) then
    raise insufficient_privilege;
  end if;
  select subject.label into subject_label from private.course_evaluation_subjects(p_run_id) subject
    where subject.subject_kind = p_subject_kind and subject.subject_id = p_subject_id;
  if not found then raise insufficient_privilege; end if;

  if p_expected_version = 0 then
    insert into private.course_evaluations(run_id, user_id, rater_role, subject_kind, subject_id, score, comment)
      values (p_run_id, actor_id, p_rater_role, p_subject_kind, p_subject_id, p_score, normalized_comment)
      on conflict (run_id, user_id, rater_role, subject_kind, subject_id) do nothing
      returning * into saved;
  else
    update private.course_evaluations evaluation
    set score = p_score, comment = normalized_comment, version = evaluation.version + 1
    where evaluation.run_id = p_run_id and evaluation.user_id = actor_id and evaluation.rater_role = p_rater_role
      and evaluation.subject_kind = p_subject_kind and evaluation.subject_id = p_subject_id
      and evaluation.version = p_expected_version
    returning * into saved;
  end if;
  if not found then
    raise sqlstate 'PT409' using message = 'Evaluation changed. Reload the current evaluation.';
  end if;
  insert into private.course_evaluation_revisions(evaluation_id, version)
    values (saved.id, saved.version);
  return jsonb_build_object('rater_role', p_rater_role, 'subject_kind', p_subject_kind, 'subject_id', p_subject_id,
    'label', subject_label, 'score', saved.score, 'comment', saved.comment, 'version', saved.version);
end;
$$;

create function public.course_evaluations(p_run_id uuid)
returns jsonb language sql stable security invoker set search_path = ''
return private.course_evaluations(p_run_id);

create function public.course_evaluation_comments(
  p_run_id uuid, p_rater_role text, p_subject_kind text, p_subject_id uuid, p_after uuid default null
)
returns jsonb language sql stable security invoker set search_path = ''
return private.course_evaluation_comments(p_run_id, p_rater_role, p_subject_kind, p_subject_id, p_after);

create function public.save_course_evaluation(
  p_run_id uuid, p_rater_role text, p_subject_kind text, p_subject_id uuid,
  p_score integer, p_expected_version integer, p_comment text default ''
)
returns jsonb language sql security invoker set search_path = ''
return private.save_course_evaluation(p_run_id, p_rater_role, p_subject_kind, p_subject_id, p_score, p_expected_version, p_comment);

revoke all on function private.course_evaluation_completed(uuid), private.course_evaluation_subjects(uuid),
  private.course_evaluation_can_rate(jsonb,text,text,uuid), private.course_evaluation_can_review(jsonb,text,text,uuid,boolean),
  private.course_evaluation_context(uuid), private.course_evaluations(uuid), public.course_evaluations(uuid),
  private.course_evaluation_comments(uuid,text,text,uuid,uuid), public.course_evaluation_comments(uuid,text,text,uuid,uuid),
  private.save_course_evaluation(uuid,text,text,uuid,integer,integer,text), public.save_course_evaluation(uuid,text,text,uuid,integer,integer,text)
  from public, anon, authenticated, service_role;
grant execute on function private.course_evaluations(uuid), public.course_evaluations(uuid),
  private.course_evaluation_comments(uuid,text,text,uuid,uuid), public.course_evaluation_comments(uuid,text,text,uuid,uuid),
  private.save_course_evaluation(uuid,text,text,uuid,integer,integer,text), public.save_course_evaluation(uuid,text,text,uuid,integer,integer,text)
  to authenticated;

alter function private.require_portal_access() rename to require_portal_access_before_course_evaluations;
revoke all on function private.require_portal_access_before_course_evaluations() from public, anon, authenticated, service_role;
create function private.require_portal_access()
returns void language plpgsql stable security definer set search_path = '' as $$
declare
  request_headers jsonb := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
begin
  if private.participant_actor()
     and coalesce(request_headers->>'accept-profile', 'public') = 'public'
     and coalesce(request_headers->>'content-profile', 'public') = 'public'
     and current_setting('request.method', true) = 'POST'
     and current_setting('request.path', true) in ('/rpc/course_evaluations', '/rpc/save_course_evaluation')
  then return; end if;
  perform private.require_portal_access_before_course_evaluations();
end;
$$;
revoke all on function private.require_portal_access() from public, anon, authenticated, service_role;
grant execute on function private.require_portal_access() to authenticated;

do $$
declare
  gate text := pg_get_functiondef('private.require_academy_course_access()'::regprocedure);
  anchor constant text := '  licence_status := private.academy_course_access_status();';
begin
  if cardinality(string_to_array(gate, anchor)) <> 2 then
    raise exception 'Expected the licensed course profile request gate';
  end if;
  execute replace(gate, anchor, anchor || $access$
  if request_method = 'POST' and (
    (licence_status in ('active', 'grace')
      and request_path in ('/rpc/course_evaluations', '/rpc/course_evaluation_comments'))
    or (licence_status = 'active' and request_path = '/rpc/save_course_evaluation')
  ) then return; end if;$access$);
end;
$$;

alter function private.deletion_scope(text,uuid) rename to deletion_scope_before_course_evaluations;
revoke all on function private.deletion_scope_before_course_evaluations(text,uuid) from public, anon, authenticated, service_role;
create function private.deletion_scope(p_kind text, p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare scope jsonb := private.deletion_scope_before_course_evaluations(p_kind, p_id);
begin
  if p_kind = 'course_run' then
    scope := private.deletion_add_scope(scope, 'private.course_evaluations', format('x.run_id=%L::uuid', p_id));
    return private.deletion_add_scope(scope, 'private.course_evaluation_revisions',
      format('x.evaluation_id in (select id from private.course_evaluations where run_id=%L::uuid)', p_id));
  end if;
  return scope;
end;
$$;
revoke all on function private.deletion_scope(text,uuid) from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';
commit;
