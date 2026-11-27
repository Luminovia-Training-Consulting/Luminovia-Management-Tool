begin;

-- Extend the existing revisioned evaluation store; no participant records enter
-- the cross-company lecturer directory.
alter table private.course_evaluations drop constraint course_evaluation_recipient;
alter table private.course_evaluations add constraint course_evaluation_recipient check (
  (rater_role = 'learner' and subject_kind in ('lecturer', 'company'))
  or (rater_role = 'company' and subject_kind = 'lecturer')
  or (rater_role = 'lecturer' and subject_kind in ('course', 'company', 'class', 'participant'))
);
alter table private.course_evaluations add column participant_id uuid
  generated always as (case when subject_kind = 'participant' then subject_id end) stored
  references public.profiles(id) on delete cascade;
create index course_evaluations_participant on private.course_evaluations(participant_id)
  where participant_id is not null;
create index course_evaluations_lecturer_directory on private.course_evaluations(subject_id, id)
  where subject_kind = 'lecturer';
drop index private.course_evaluation_comments_page;
create index course_evaluations_subject_pages on private.course_evaluations(run_id, rater_role, subject_kind, subject_id, id);

-- Both the author's rows and reviews identifying a deleted participant belong
-- in the account deletion snapshot and its revision cleanup.
alter function private.deletion_scope(text,uuid) rename to deletion_scope_before_individual_feedback;
create function private.deletion_scope(p_kind text, p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  scope jsonb := private.deletion_scope_before_individual_feedback(p_kind, p_id);
  match_account text := format('x.user_id=%1$L::uuid or x.participant_id=%1$L::uuid', p_id);
begin
  if p_kind <> 'account' then return scope; end if;
  scope := private.deletion_add_scope(scope, 'private.course_evaluations', match_account);
  return private.deletion_add_scope(scope, 'private.course_evaluation_revisions',
    format('x.evaluation_id in (select id from private.course_evaluations x where %s)', match_account));
end;
$$;
revoke all on function private.deletion_scope_before_individual_feedback(text,uuid),
  private.deletion_scope(text,uuid) from public, anon, authenticated, service_role;

-- The participant roster is released only to the people who teach, manage or
-- own this course and to the individual enrollee for their own review.

create or replace function private.course_evaluation_subjects(p_run_id uuid)
returns table(subject_kind text, subject_id uuid, label text)
language sql stable security invoker set search_path = '' as $$
  with caller as materialized (select private.course_workspace_context(p_run_id) context),
  course as (
    select run.id, run.organisation_id, template.title, organisation.name
    from public.course_runs run
    join public.course_templates template on template.id = run.template_id
    join public.organisations organisation on organisation.id = run.organisation_id
    where run.id = p_run_id and run.archived_at is null and organisation.archived_at is null
  )
  select 'course', course.id, course.title from course
  union all
  select 'company', course.organisation_id, course.name from course cross join caller
  where (caller.context->>'learner')::boolean or (caller.context->>'client')::boolean
    or (caller.context->>'manager')::boolean or private.can_read_course_customer(p_run_id)
  union all
  select 'participant', profile.id, profile.display_name from course
  cross join caller
  join public.course_enrolments enrolment on enrolment.course_run_id = course.id
  join public.profiles profile on profile.id = enrolment.user_id
  where enrolment.status in ('enrolled', 'completed')
    and (
      private.active_company_participant(profile.id, course.organisation_id)
      or (
        -- Old courses may have valid legacy enrolments established before company
        -- associations. A recorded inactive association still blocks access.
        profile.active and exists (
          select 1 from public.user_roles role where role.user_id = profile.id and role.role = 'participant'
        ) and not exists (
          select 1 from private.company_participant_memberships association
          where association.organisation_id = course.organisation_id and association.user_id = profile.id
        )
      )
    )
    and ((caller.context->>'manager')::boolean or (caller.context->>'teacher')::boolean
      or (caller.context->>'client')::boolean
      or ((caller.context->>'learner')::boolean and profile.id = auth.uid()))
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
  where private.course_has_current_teacher(course.id, profile.id);
$$;

create or replace function private.course_evaluation_can_rate(
  p_context jsonb, p_rater_role text, p_kind text, p_subject uuid
)
returns boolean language sql stable security invoker set search_path = '' as $$
  select coalesce(case p_rater_role
    when 'learner' then (p_context->>'learner')::boolean
      and (p_kind = 'company' or (p_kind = 'lecturer' and p_subject <> auth.uid()))
    when 'company' then (p_context->>'client')::boolean and p_kind = 'lecturer' and p_subject <> auth.uid()
    when 'lecturer' then (p_context->>'teacher')::boolean and (p_kind in ('course', 'company', 'class')
      or (p_kind = 'participant' and p_subject <> auth.uid()))
  end, false);
$$;

create or replace function private.course_evaluation_can_review(
  p_context jsonb, p_rater_role text, p_kind text, p_subject uuid, p_written boolean
)
returns boolean language sql stable security invoker set search_path = '' as $$
  select (p_context->>'manager')::boolean
    or ((p_context->>'teacher')::boolean and (
      (p_kind = 'lecturer' and p_subject = auth.uid()) or
      (p_rater_role = 'lecturer' and p_kind in ('course', 'company', 'class'))
    ))
    or ((p_context->>'client')::boolean and (
      p_kind = 'lecturer'
      or (p_kind = 'company' and p_rater_role in ('learner', 'lecturer'))
      or (p_kind in ('class', 'course', 'participant') and p_rater_role = 'lecturer')
    ))
    or ((p_context->>'learner')::boolean and p_kind = 'participant' and p_subject = auth.uid())
    or (not p_written and (p_context->>'learner')::boolean and p_kind = 'lecturer');
$$;

create or replace function private.course_evaluations(p_run_id uuid)
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
  ), review_subjects as (
    select * from subjects
    union all
    -- Managers reviewing the same run can still see the dated allocation's
    -- retained evaluations. Ordinary roles see only currently scoped subjects.
    select distinct retained.subject_kind, retained.subject_id,
      coalesce(profile.display_name, organisation.name, class.name, '')
    from private.course_evaluations retained
    left join public.profiles profile on retained.subject_kind in ('lecturer', 'participant') and profile.id = retained.subject_id
    left join public.organisations organisation on retained.subject_kind = 'company' and organisation.id = retained.subject_id
    left join private.course_classes class on retained.subject_kind = 'class' and class.id = retained.subject_id
    where retained.run_id = p_run_id and (context->>'manager')::boolean and not exists (
      select 1 from subjects subject
      where subject.subject_kind = retained.subject_kind and subject.subject_id = retained.subject_id
    )
  ), grouped as (
    select evaluation.rater_role, subject.subject_kind, subject.subject_id, subject.label,
      count(*) as count, round(avg(evaluation.score), 2) as average,
      private.course_evaluation_can_review(
        context, evaluation.rater_role, subject.subject_kind, subject.subject_id, true
      ) as can_read_comments
    from private.course_evaluations evaluation
    join review_subjects subject using (subject_kind, subject_id)
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

create or replace function private.course_evaluation_comments(
  p_run_id uuid, p_rater_role text, p_subject_kind text, p_subject_id uuid, p_after uuid
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  context jsonb := private.course_evaluation_context(p_run_id);
  result jsonb;
begin
  if p_rater_role is null or p_rater_role not in ('learner', 'company', 'lecturer')
    or p_subject_kind is null or p_subject_kind not in ('lecturer', 'company', 'class', 'course', 'participant')
    or p_subject_id is null then raise invalid_parameter_value; end if;
  if not private.course_evaluation_completed(p_run_id)
    or not coalesce(private.course_evaluation_can_review(
      context, p_rater_role, p_subject_kind, p_subject_id, true
    ), false)
    or not (
      exists (
        select 1 from private.course_evaluation_subjects(p_run_id) subject
        where subject.subject_kind = p_subject_kind and subject.subject_id = p_subject_id
      ) or ((context->>'manager')::boolean and exists (
        select 1 from private.course_evaluations retained
        where retained.run_id = p_run_id and retained.rater_role = p_rater_role
          and retained.subject_kind = p_subject_kind and retained.subject_id = p_subject_id
      ))
    ) then raise insufficient_privilege; end if;

  with page as (
    select id, comment, score from private.course_evaluations evaluation
    where evaluation.run_id = p_run_id and evaluation.rater_role = p_rater_role
      and evaluation.subject_kind = p_subject_kind and evaluation.subject_id = p_subject_id
      and (p_after is null or evaluation.id > p_after)
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

create or replace function private.save_course_evaluation(
  p_run_id uuid, p_rater_role text, p_subject_kind text, p_subject_id uuid,
  p_score integer, p_expected_version integer, p_comment text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  target_teacher_id uuid;
  company_id uuid;
  target_participant_id uuid := case when p_subject_kind = 'participant' then p_subject_id end;
  internal_edition boolean := (select edition from private.installation_identity) = 'internal';
  context jsonb;
  subject_label text;
  normalized_comment text := btrim(p_comment, E' \t\n\r');
  saved private.course_evaluations%rowtype;
begin
  if p_rater_role is null or p_rater_role not in ('learner', 'company', 'lecturer')
    or p_subject_kind is null or p_subject_kind not in ('lecturer', 'company', 'class', 'course', 'participant')
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
  perform 1 from public.profiles where id in (actor_id, target_teacher_id, target_participant_id) order by id for share;
  perform 1 from public.user_roles where user_id in (actor_id, target_teacher_id, target_participant_id) order by user_id, role for share;
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
  if target_participant_id is not null then
    -- Serialize the individual recipient against membership and enrolment
    -- changes; the current subject list rechecks both below.
    perform 1 from private.company_participant_memberships
      where organisation_id = company_id and user_id = target_participant_id and status = 'active' for share;
    perform 1 from public.course_enrolments
      where course_run_id = p_run_id and user_id = target_participant_id
        and status in ('enrolled', 'completed') for share;
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

  saved := private.write_course_evaluation(
    p_run_id, p_rater_role, p_subject_kind, p_subject_id, p_score, p_expected_version, normalized_comment
  );
  return jsonb_build_object('rater_role', p_rater_role, 'subject_kind', p_subject_kind, 'subject_id', p_subject_id,
    'label', subject_label, 'score', saved.score, 'comment', saved.comment, 'version', saved.version);
end;
$$;


-- The participant API accepts only the exact POST path and the public schema.
-- The review RPC independently checks course access and self-recipient scope.
alter function private.require_portal_access() rename to require_portal_access_before_individual_feedback;
create function private.require_portal_access()
returns void language plpgsql stable security definer set search_path = '' as $$
declare
  headers jsonb := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
begin
  if current_setting('request.path', true) = '/rpc/course_evaluation_comments'
     and current_setting('request.method', true) = 'POST'
     and coalesce(headers->>'accept-profile', 'public') = 'public'
     and coalesce(headers->>'content-profile', 'public') = 'public'
     and private.participant_actor() then return; end if;
  perform private.require_portal_access_before_individual_feedback();
end;
$$;
revoke all on function private.require_portal_access_before_individual_feedback(),
  private.require_portal_access() from public, anon, authenticated, service_role;
grant execute on function private.require_portal_access() to authenticated;

-- This audience has no implied booking relationship. Return only lecturer
-- identity, current verified qualifications, totals and anonymous scores;
-- profile contact, evidence files and feedback prose stay in their existing scopes.
create function private.company_lecturer_feedback(
  p_user_id uuid, p_search text, p_after uuid
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  result jsonb;
begin
  if not coalesce(private.actor_active() and private.has_role(array['client']), false)
    or (select edition from private.installation_identity) is distinct from 'internal'
    or not exists (
      select 1 from public.client_organisation_memberships membership
      join public.organisations organisation on organisation.id = membership.organisation_id
      where membership.user_id = auth.uid() and membership.removed_at is null
        and organisation.archived_at is null
    ) then raise insufficient_privilege; end if;
  if p_search is null or char_length(p_search) > 100 or (p_user_id is not null and p_search <> '') then
    raise invalid_parameter_value;
  end if;

  if p_user_id is null then
    with page as materialized (
      select profile.id, profile.display_name
      from public.profiles profile
      where (p_after is null or profile.id > p_after)
        and private.lecturer_user(profile.id)
        and (p_search = '' or strpos(lower(profile.display_name), lower(p_search)) > 0)
      order by profile.id limit 26
    ), visible as (select * from page order by id limit 25)
    select jsonb_build_object(
      'lecturers', coalesce(jsonb_agg(to_jsonb(visible) order by display_name, id), '[]'::jsonb),
      'next', case when (select count(*) from page) > 25 then (select id from visible order by id desc limit 1) end
    ) into result from visible;
    return result;
  end if;

  if not private.lecturer_user(p_user_id) then raise insufficient_privilege; end if;
  with source_scores as (
    select evaluation.id, evaluation.rater_role, evaluation.score
    from private.course_evaluations evaluation
    join public.course_runs run on run.id = evaluation.run_id and run.archived_at is null
    join public.organisations company on company.id = run.organisation_id and company.archived_at is null
    where evaluation.subject_id = p_user_id and evaluation.subject_kind = 'lecturer'
      and (p_after is null or evaluation.id > p_after)
      and private.course_evaluation_completed(run.id)
      and not private.deletion_row_fenced('public.course_runs', to_jsonb(run))
    union all
    select review.id, 'learner', review.rating
    from public.course_reviews review
    join public.course_runs run on run.id = review.course_run_id and run.archived_at is null
    join public.organisations company on company.id = run.organisation_id and company.archived_at is null
    join public.course_enrolments enrolment on enrolment.course_run_id = run.id
      and enrolment.user_id = review.reviewer_id and enrolment.status = 'completed'
    where review.lecturer_id = p_user_id and review.deleted_at is null and not review.hidden
      and (p_after is null or review.id > p_after)
      and private.course_evaluation_completed(run.id)
      and not private.deletion_row_fenced('public.course_runs', to_jsonb(run))
      and not exists (
        select 1 from private.course_evaluations evaluation
        where evaluation.run_id = review.course_run_id and evaluation.user_id = review.reviewer_id
          and evaluation.rater_role = 'learner' and evaluation.subject_kind = 'lecturer'
          and evaluation.subject_id = review.lecturer_id
      )
  ), page as materialized (
    select * from source_scores order by id limit 26
  ), visible as (select * from page order by id limit 25)
  select jsonb_build_object(
    'lecturer', (select jsonb_build_object('id', profile.id, 'display_name', profile.display_name,
      'teaching_minutes', private.lecturer_delivery_minutes(p_user_id))
      from public.profiles profile where profile.id = p_user_id),
    'qualifications', coalesce((
      select jsonb_agg(jsonb_build_object('id', topic.id, 'label_de', topic.label_de, 'label_en', topic.label_en)
        order by topic.label_de, topic.id)
      from public.lecturer_topics qualification join public.topics topic on topic.id = qualification.topic_id
      where qualification.user_id = p_user_id and qualification.verified
        and private.profile_topics_visible(p_user_id)
        and (qualification.valid_until is null or qualification.valid_until > statement_timestamp())
    ), '[]'::jsonb),
    'reviews', coalesce((select jsonb_agg(to_jsonb(visible) order by id) from visible), '[]'::jsonb),
    'next', case when (select count(*) from page) > 25 then (select id from visible order by id desc limit 1) end
  ) into result;
  return result;
end;
$$;

create function public.company_lecturer_feedback(
  p_user_id uuid default null, p_search text default '', p_after uuid default null
) returns jsonb language sql stable security invoker set search_path = ''
return private.company_lecturer_feedback(p_user_id, p_search, p_after);

revoke all on function private.company_lecturer_feedback(uuid,text,uuid),
  public.company_lecturer_feedback(uuid,text,uuid) from public, anon, authenticated, service_role;
grant execute on function private.company_lecturer_feedback(uuid,text,uuid),
  public.company_lecturer_feedback(uuid,text,uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
