begin;

create index course_completion_report_by_learner on private.course_completion_records(run_id,user_id);

-- Use the course workspace's current teacher, company, management and edition
-- checks. The result deliberately excludes learner notes and assessment answers.
create function private.academy_course_participation_report(p_run_id uuid,p_after_user_id uuid,p_limit integer)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  access jsonb;
begin
  if p_limit is null or p_limit not between 1 and 200 then
    raise exception 'Participation report page size must be between 1 and 200' using errcode='22023';
  end if;
  if (select edition from private.installation_identity) = 'internal' then
    raise insufficient_privilege;
  end if;
  access := private.course_workspace_context(p_run_id);
  if (access->>'lms_enabled')::boolean is not true or
     not ((access->>'manager')::boolean or (access->>'teacher')::boolean or (access->>'client')::boolean) then
    raise exception 'Course participation report unavailable' using errcode='42501';
  end if;

  return (
    with requested as materialized (
      select enrolment.user_id, enrolment.status, profile.display_name, profile.luminovia_user_id
      from public.course_enrolments enrolment
      join public.profiles profile on profile.id=enrolment.user_id
      where enrolment.course_run_id=p_run_id and enrolment.status in ('enrolled','completed')
        and (p_after_user_id is null or enrolment.user_id>p_after_user_id)
      order by enrolment.user_id
      limit p_limit+1
    ),
    page as materialized (
      select * from requested order by user_id limit p_limit
    ),
    attendance as (
      select entry.user_id,
        count(*) filter (where status.value='present') as present,
        count(*) filter (where status.value='absent') as absent,
        count(*) filter (where status.value='excused') as excused
      from private.course_attendance entry
      join public.course_sessions session on session.id=entry.session_id and session.course_run_id=p_run_id
      join page on page.user_id=entry.user_id
      cross join lateral (values (coalesce(entry.register_status,
        case entry.state when 'attended' then 'present' when 'absent' then 'absent' end
      ))) as status(value)
      group by entry.user_id
    ),
    completion as (
      select record.user_id, bool_or(record.revoked_at is null) as issued
      from private.course_completion_records record join page on page.user_id=record.user_id
      where record.run_id=p_run_id
      group by record.user_id
    )
    select jsonb_build_object(
      'course_id',p_run_id,
      'session_count',(select count(*) from public.course_sessions where course_run_id=p_run_id),
      'rows',coalesce((select jsonb_agg(jsonb_build_object(
        'user_id',page.user_id,
        'participant_id',page.luminovia_user_id,
        'name',page.display_name,
        'enrolment',page.status,
        'present',coalesce(attendance.present,0),
        'absent',coalesce(attendance.absent,0),
        'excused',coalesce(attendance.excused,0),
        'completion',case
          when completion.issued then 'issued'
          when completion.user_id is not null then 'revoked'
          else 'not_issued'
        end
      ) order by page.user_id)
      from page
      left join attendance on attendance.user_id=page.user_id
      left join completion on completion.user_id=page.user_id
      ),'[]'::jsonb),
      'next_after',case when (select count(*) from requested)>p_limit
        then (select user_id from page order by user_id desc limit 1)
      end
    )
  );
end;
$$;

create function public.academy_course_participation_report(
  p_run_id uuid,p_after_user_id uuid default null,p_limit integer default 100
) returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.academy_course_participation_report(p_run_id,p_after_user_id,p_limit);
$$;
revoke all on function private.academy_course_participation_report(uuid,uuid,integer),
  public.academy_course_participation_report(uuid,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function private.academy_course_participation_report(uuid,uuid,integer),
  public.academy_course_participation_report(uuid,uuid,integer) to authenticated;

-- The dedicated gateway permits only the current edition’s explicit RPC list.
do $migration$
declare
  source text := pg_get_functiondef('private.require_academy_course_access()'::regprocedure);
  anchor constant text := '''/rpc/course_session_register''';
begin
  if cardinality(string_to_array(source,anchor))<>2 then
    raise exception 'Expected one current academy attendance read route';
  end if;
  execute replace(source,anchor,anchor || ', ''/rpc/academy_course_participation_report''');
end;
$migration$;

notify pgrst, 'reload schema';
commit;
