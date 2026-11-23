begin;

-- Extend the existing versioned meeting link to current contacts of the exact course's company.
do $migration$
declare
  reader text := pg_get_functiondef('private.course_workspace_with_meeting_link(uuid)'::regprocedure);
  writer text := pg_get_functiondef('private.set_course_meeting_link(uuid,text,integer)'::regprocedure);
  reader_check constant text := $check$(workspace#>>'{access,staff}')::boolean$check$;
  writer_check constant text := $check$(context->>'staff')::boolean is not true$check$;
begin
  if cardinality(string_to_array(reader, reader_check)) <> 2
    or cardinality(string_to_array(writer, writer_check)) <> 3 then
    raise exception 'Expected the current meeting link workspace and writer checks';
  end if;
  execute replace(reader, reader_check,
    $check$((workspace#>>'{access,staff}')::boolean or (workspace#>>'{access,client}')::boolean)$check$);
  execute replace(writer, writer_check,
    $check$not (coalesce((context->>'staff')::boolean, false) or coalesce((context->>'client')::boolean, false))$check$);
end;
$migration$;

-- One aggregate per learner across the selected class's authorised, unarchived runs.
-- Unlinked courses use just the requested run. Respect the same current enrolment
-- and legacy verified-mark semantics as the individual session register.
create function private.course_attendance_summary(p_run_id uuid, p_after_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  context jsonb := private.course_workspace_context(p_run_id);
  internal_edition boolean := (select edition = 'internal' from private.installation_identity);
  selected_class private.course_classes%rowtype;
begin
  if (context->>'lms_enabled')::boolean is not true or not (
    (context->>'manager')::boolean or (context->>'teacher')::boolean or (context->>'client')::boolean
  ) or (not internal_edition and not coalesce(private.academy_course_access_status() in ('active','grace'), false))
  then raise insufficient_privilege; end if;

  select class.* into selected_class
  from private.course_class_assignments assignment
  join private.course_classes class on class.id = assignment.class_id
    and class.organisation_id = assignment.organisation_id
  where assignment.course_id = p_run_id;

  return (
    with scoped_runs as materialized (
      select p_run_id as id
      union
      select run.id
      from private.course_class_assignments peer
      join public.course_runs run on run.id = peer.course_id and run.organisation_id = peer.organisation_id
      where peer.class_id = selected_class.id and peer.organisation_id = selected_class.organisation_id
        and run.archived_at is null
        and ((context->>'manager')::boolean or (context->>'client')::boolean or private.course_has_current_teacher(run.id))
    ), requested as materialized (
      select distinct enrolment.user_id
      from public.course_enrolments enrolment
      join scoped_runs run on run.id = enrolment.course_run_id
      where enrolment.status in ('enrolled','completed')
        and (p_after_user_id is null or enrolment.user_id > p_after_user_id)
      order by enrolment.user_id
      limit 51
    ), page as materialized (
      select user_id from requested order by user_id limit 50
    ), marks as (
      select entry.user_id,
        count(*) filter (where mark.status = 'present') as present,
        count(*) filter (where mark.status = 'absent') as absent,
        count(*) filter (where mark.status = 'excused') as excused,
        sum(case when session.ends_at > statement_timestamp() then least(
          entry.minutes,
          greatest(0, ceil(extract(epoch from (
            least(statement_timestamp(), coalesce(entry.departure_at, session.ends_at))
              - greatest(session.starts_at, coalesce(entry.arrival_at, session.starts_at))
          )) / 60))
        ) else entry.minutes end) filter (where mark.status = 'present') as minutes
      from page
      join public.course_enrolments enrolment on enrolment.user_id = page.user_id
        and enrolment.status in ('enrolled','completed')
      join scoped_runs run on run.id = enrolment.course_run_id
      join public.course_sessions session on session.course_run_id = run.id
      join private.course_attendance entry on entry.session_id = session.id and entry.user_id = page.user_id
      cross join lateral (values (coalesce(entry.register_status, case entry.state
        when 'attended' then 'present' when 'absent' then 'absent' end))) as mark(status)
      group by entry.user_id
    )
    select jsonb_build_object(
      'class_name', selected_class.name,
      'course_count', (select count(*) from scoped_runs),
      'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'user_id',page.user_id, 'name',profile.display_name,
        'present',coalesce(marks.present,0), 'absent',coalesce(marks.absent,0),
        'excused',coalesce(marks.excused,0), 'minutes',coalesce(marks.minutes,0)
      ) order by page.user_id)
      from page join public.profiles profile on profile.id = page.user_id
      left join marks on marks.user_id = page.user_id), '[]'::jsonb),
      'next_after', case when (select count(*) from requested) > 50
        then (select user_id from page order by user_id desc limit 1) end
    )
  );
end;
$$;

create function public.course_attendance_summary(p_run_id uuid, p_after_user_id uuid default null)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.course_attendance_summary(p_run_id, p_after_user_id);
$$;

revoke all on function private.course_attendance_summary(uuid,uuid),
  public.course_attendance_summary(uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function private.course_attendance_summary(uuid,uuid),
  public.course_attendance_summary(uuid,uuid) to authenticated;

do $migration$
declare
  gate text := pg_get_functiondef('private.require_academy_course_access()'::regprocedure);
  anchor constant text := '''/rpc/course_session_register''';
begin
  if cardinality(string_to_array(gate, anchor)) <> 2 then
    raise exception 'Expected one current Academy attendance route';
  end if;
  execute replace(gate, anchor, anchor || ', ''/rpc/course_attendance_summary''');
end;
$migration$;

notify pgrst, 'reload schema';
commit;
