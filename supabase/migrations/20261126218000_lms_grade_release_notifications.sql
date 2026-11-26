-- Released results create an in-app receipt for the exact learner.
BEGIN;

create function private.notify_lms_grade_release()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  recipient uuid;
  notification_kind text;
begin
  if tg_table_name = 'course_weighted_releases' then
    recipient := new.user_id;
    notification_kind := 'course_weighted_grade_released';
  else
    recipient := new.learner_id;
    notification_kind := 'course_text_exam_graded';
  end if;

  insert into public.notifications(user_id, kind, resource_id)
  values (recipient, notification_kind, new.run_id)
  on conflict (user_id, kind, resource_id)
  do update set read_at = null, created_at = clock_timestamp();
  return new;
end;
$$;

create trigger notify_weighted_grade_release
  after insert on private.course_weighted_releases
  for each row execute function private.notify_lms_grade_release();

create trigger notify_text_exam_grade_release
  after update of released_at on private.course_text_exam_reviews
  for each row when (old.released_at is null and new.released_at is not null)
  execute function private.notify_lms_grade_release();

create function private.lms_grade_notification_target(p_kind text, p_run_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  context jsonb;
  heading text;
  section text;
begin
  if p_kind = 'course_weighted_grade_released' then
    if not exists (
      select 1 from private.course_weighted_releases
      where run_id = p_run_id and user_id = auth.uid()
    ) then return null; end if;
    section := 'course-weighted-gradebook';
  elsif p_kind = 'course_text_exam_graded' then
    if not exists (
      select 1 from private.course_text_exam_reviews
      where run_id = p_run_id and learner_id = auth.uid() and released_at is not null
    ) then return null; end if;
    section := 'course-learning';
  else
    return null;
  end if;

  context := private.course_workspace_context(p_run_id);
  if (context->>'lms_enabled')::boolean is not true or (context->>'learner')::boolean is not true
    then return null; end if;
  select template.title into heading from public.course_runs course
  join public.course_templates template on template.id = course.template_id
  where course.id = p_run_id and course.archived_at is null;
  if not found then return null; end if;
  return jsonb_build_object('title', coalesce(heading, ''),
    'href', '/courses/' || p_run_id || '/workspace#' || section);
exception when insufficient_privilege then
  return null;
end;
$$;

revoke all on function private.notify_lms_grade_release(),
  private.lms_grade_notification_target(text,uuid) from public, anon, authenticated, service_role;

do $migration$
declare
  internal_target text := pg_get_functiondef('private.course_notification_target(text,uuid)'::regprocedure);
  academy_target text := pg_get_functiondef('private.academy_notification_target(text,uuid)'::regprocedure);
  internal_anchor constant text := $anchor$if p_kind = 'course_assignment_feedback' then$anchor$;
  academy_anchor constant text := $anchor$when 'course_assignment_feedback' then$anchor$;
begin
  if cardinality(string_to_array(internal_target,internal_anchor)) <> 2
    or cardinality(string_to_array(academy_target,academy_anchor)) <> 2 then
    raise exception 'Expected the current LMS notification boundaries';
  end if;
  execute replace(internal_target, internal_anchor,
    $target$if p_kind in ('course_weighted_grade_released','course_text_exam_graded') then
    return coalesce(private.lms_grade_notification_target(p_kind,p_resource),jsonb_build_object('href',null,'title',''));
  elsif p_kind = 'course_assignment_feedback' then$target$);
  execute replace(academy_target, academy_anchor,
    $target$when 'course_weighted_grade_released', 'course_text_exam_graded' then
        return private.lms_grade_notification_target(p_kind,p_resource);
      when 'course_assignment_feedback' then$target$);
end;
$migration$;

COMMIT;
