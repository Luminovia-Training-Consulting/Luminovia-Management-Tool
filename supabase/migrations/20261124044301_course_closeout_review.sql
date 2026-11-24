begin;

create table private.course_closeout_reviews (
  course_run_id uuid primary key references public.course_runs(id) on delete cascade,
  reviewed_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles(id) on delete set null,
  review_token text not null check (length(review_token) = 32),
  exceptions jsonb not null check (jsonb_typeof(exceptions) = 'array'),
  followups jsonb not null check (jsonb_typeof(followups) = 'object')
);
alter table private.course_closeout_reviews enable row level security;
revoke all on private.course_closeout_reviews from public, anon, authenticated, service_role;

-- Materialise only exception identifiers, never actual grades or submitted files.
create function private.course_closeout_exceptions(p_run uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  with roster as materialized (
    select profile.id, profile.display_name
    from public.course_enrolments enrolment
    join public.profiles profile on profile.id = enrolment.user_id
    where enrolment.course_run_id = p_run and enrolment.status in ('enrolled', 'completed')
  ), exceptions as (
    select 'attendance' as kind, learner.id, learner.display_name, session.id as session_id, session.starts_at as session_start
    from roster learner
    cross join public.course_sessions session
    where session.course_run_id = p_run
      and not exists (
        select 1 from private.course_attendance entry
        where entry.session_id = session.id and entry.user_id = learner.id
          and entry.register_status in ('present', 'absent', 'excused')
      )
    union all
    select 'grade', learner.id, learner.display_name, null, null
    from roster learner
    where (
      exists (select 1 from private.course_timed_exams exam where exam.run_id = p_run)
      and not exists (
        select 1 from private.course_exam_results result
        where result.run_id = p_run and result.participant_id = learner.id and result.score is not null
      )
    ) or (
      exists (
        select 1 from private.course_quizzes quiz
        join private.course_quiz_versions revision using (run_id, version)
        where quiz.run_id = p_run and revision.published
          and not exists (
            select 1 from private.course_quiz_attempts attempt
            where attempt.run_id = p_run and attempt.quiz_version = revision.version and attempt.user_id = learner.id
          )
      )
    )
    union all
    select 'submission', learner.id, learner.display_name, null, null
    from roster learner
    where exists (
      select 1 from private.course_submission_settings settings where settings.run_id = p_run and settings.enabled
    ) and not exists (
      select 1 from private.course_submissions submission
      join public.document_versions version on version.id = submission.version_id
      join public.documents document on document.id = version.document_id
      where submission.run_id = p_run and submission.withdrawn_at is null and not submission.is_exam
        and version.status = 'clean' and document.deleted_at is null and document.owner_id = learner.id
    )
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'kind', item.kind, 'person_id', item.id, 'person', item.display_name,
    'session_id', item.session_id, 'session_start', item.session_start
  ) order by item.kind, item.display_name, item.id, item.session_start, item.session_id), '[]'::jsonb)
  from exceptions item
$$;

create function private.course_closeout(p_course_run_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  run public.course_runs;
  final_session timestamptz;
  issues jsonb;
  saved private.course_closeout_reviews;
begin
  if not private.has_permission('courses.manage')
    or (select edition from private.installation_identity) is distinct from 'internal' then
    raise insufficient_privilege;
  end if;
  select * into run from public.course_runs
    where id = p_course_run_id and archived_at is null;
  if not found or not private.course_lms_read_enabled(run.organisation_id) then
    raise insufficient_privilege;
  end if;
  select max(ends_at) into final_session from public.course_sessions where course_run_id = run.id;
  issues := private.course_closeout_exceptions(run.id);
  select * into saved from private.course_closeout_reviews where course_run_id = run.id;
  return jsonb_build_object(
    'can_close', coalesce(final_session <= now(), false) and private.has_permission('jobs.manage'),
    'review_token', md5(jsonb_build_array(
      (select jsonb_agg(jsonb_build_array(id, extract(epoch from starts_at), extract(epoch from ends_at)) order by id)
        from public.course_sessions where course_run_id = run.id),
      issues
    )::text),
    'items', issues,
    'staff', coalesce((select jsonb_agg(to_jsonb(staff) order by staff.name, staff.id)
       from private.course_start_staff() staff where private.chat_staff(staff.id)), '[]'::jsonb),
    'confirmed_at', saved.reviewed_at,
    'followups', coalesce((select jsonb_object_agg(pair.key, jsonb_build_object(
        'task_id', task.id, 'state', task.state, 'name', profile.display_name))
      from jsonb_each_text(saved.followups) pair
      join private.work_tasks task on task.id = pair.value::uuid
      join public.profiles profile on profile.id = task.assignee_id
      where private.can_read_work_task(task.id)), '{}'::jsonb)
  );
end;
$$;

create function public.course_closeout(p_course_run_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select private.course_closeout(p_course_run_id)
$$;

create function private.confirm_course_closeout(
  p_course_run_id uuid, p_review_token text, p_assignees jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  plan jsonb;
  issues text[];
  kind text;
  target uuid;
  task_id uuid;
  tasks jsonb := '{}'::jsonb;
  is_german boolean;
  course_title text;
  zone text;
  saved private.course_closeout_reviews;
begin
  if not private.has_permission('jobs.manage') or not private.has_permission('courses.manage')
    or (select edition from private.installation_identity) is distinct from 'internal' then
    raise insufficient_privilege;
  end if;
  -- Check authority again once the account and premium entitlement are stable.
  perform 1 from public.profiles where id = auth.uid() and active for share;
  if not found or not private.has_permission('jobs.manage') or not private.has_permission('courses.manage') then
    raise insufficient_privilege;
  end if;
  perform private.lock_course_premium(p_course_run_id);
  select * into saved from private.course_closeout_reviews where course_run_id = p_course_run_id;
  if found then
    if saved.review_token = p_review_token then return private.course_closeout(p_course_run_id); end if;
    raise exception 'This course closeout is already confirmed' using errcode = '40001';
  end if;
  plan := private.course_closeout(p_course_run_id);
  if not (plan->>'can_close')::boolean then
    raise exception 'Course sessions must have ended before closeout' using errcode = '22023';
  end if;
  if plan->>'review_token' is distinct from p_review_token then
    raise exception 'Course evidence changed; review the current closeout again' using errcode = '40001';
  end if;
  select coalesce(array_agg(distinct entry->>'kind'), array[]::text[]) into issues
    from jsonb_array_elements(plan->'items') entry;
  if jsonb_typeof(p_assignees) is distinct from 'object'
     or (select count(*) from jsonb_object_keys(p_assignees)) <> cardinality(issues)
     or not (p_assignees ?& issues) then
    raise exception 'Assign every open closeout category' using errcode = '22023';
  end if;

  select template.title, run.time_zone into course_title, zone
    from public.course_runs run join public.course_templates template on template.id = run.template_id
    where run.id = p_course_run_id;
  select left(locale, 2) = 'de' into is_german from public.profiles where id = auth.uid();
  foreach kind in array issues loop
    target := (p_assignees->>kind)::uuid;
    if not exists(select 1 from private.course_start_staff() staff where staff.id = target) then
      raise insufficient_privilege;
    end if;
    task_id := (private.save_work_task(null, jsonb_build_object(
      'scope', 'operations', 'state', 'open', 'assignee_id', target,
      'title', case when is_german then 'Kursabschluss prüfen: ' else 'Review course closeout: ' end
        || case kind when 'attendance' then case when is_german then 'Anwesenheit' else 'Attendance' end
          when 'grade' then case when is_german then 'Bewertung' else 'Grades' end
          else case when is_german then 'Abgaben' else 'Submissions' end end,
      'description', course_title || E'\n/courses/' || p_course_run_id || '/workspace#course-closeout',
      'due_at', now() + interval '7 days', 'time_zone', zone, 'source_message_id', null
    ), 0, gen_random_uuid())->>'id')::uuid;
    tasks := tasks || jsonb_build_object(kind, task_id);
  end loop;

  insert into private.course_closeout_reviews(course_run_id, reviewed_by, review_token, exceptions, followups)
    values(p_course_run_id, auth.uid(), p_review_token, plan->'items', tasks);
  return private.course_closeout(p_course_run_id);
end;
$$;

create function public.confirm_course_closeout(
  p_course_run_id uuid, p_review_token text, p_assignees jsonb
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.confirm_course_closeout(p_course_run_id, p_review_token, p_assignees)
$$;

revoke all on function private.course_closeout_exceptions(uuid) from public, anon, authenticated, service_role;
revoke all on function public.course_closeout(uuid), private.course_closeout(uuid),
  public.confirm_course_closeout(uuid, text, jsonb), private.confirm_course_closeout(uuid, text, jsonb)
  from public, anon;
grant execute on function public.course_closeout(uuid), private.course_closeout(uuid),
  public.confirm_course_closeout(uuid, text, jsonb), private.confirm_course_closeout(uuid, text, jsonb) to authenticated;
notify pgrst, 'reload schema';
commit;
