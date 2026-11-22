begin;

-- Aggregate reports use the same current teaching, company and LMS rights
-- as the course workspace. Company authority is independent of the teaching role.
create function private.learning_analytics_access()
returns jsonb language sql stable security definer set search_path = '' as $$
  with role_access as (
    select private.lecturer_actor() as personal, private.has_permission('courses.manage') as staff
    where private.actor_active()
  )
  select coalesce((
    select jsonb_build_object(
      'personal', role_access.personal,
      'staff', role_access.staff,
      'time_zone', (select time_zone from public.profiles where id = auth.uid()),
      'organisations', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', org.id, 'name', org.name, 'company', private.client_has_organisation(org.id)
        ) order by org.name, org.id), '[]'::jsonb)
        from public.organisations org
        where org.archived_at is null and private.course_lms_read_enabled(org.id)
          and (role_access.staff or private.client_has_organisation(org.id))
      )
    )
    from role_access
  ), '{"personal":false,"staff":false,"time_zone":null,"organisations":[]}'::jsonb);
$$;

create function private.learning_analytics_report(
  p_scope text, p_from date, p_until date, p_organisation_id uuid,
  p_status text, p_search text, p_page integer
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  zone text;
  observed constant timestamptz := statement_timestamp();
  search text := lower(btrim(p_search));
  page_size constant integer := 25;
begin
  if not private.actor_active() or (case p_scope
    when 'personal' then p_organisation_id is not null or not private.lecturer_actor()
    when 'company' then p_organisation_id is null or not private.client_has_organisation(p_organisation_id)
    when 'staff' then not private.has_permission('courses.manage')
    else true
  end) then
    raise insufficient_privilege;
  end if;

  if p_from is null or p_until is null or not isfinite(p_from) or not isfinite(p_until)
    or p_from < date '1900-01-01' or p_until > date '2200-01-01'
    or p_until <= p_from or p_until - p_from > 731
    or p_status is null or p_status not in ('all', 'draft', 'upcoming', 'running', 'finished', 'archived')
    or p_search is null or char_length(p_search) > 120 or p_page is null or p_page not between 1 and 100000
  then
    raise exception 'Invalid learning analytics filters' using errcode = '22023';
  end if;
  if p_scope = 'company' and not exists (
    select from public.organisations org where org.id = p_organisation_id and org.archived_at is null
      and private.course_lms_read_enabled(org.id)
  ) then
    raise insufficient_privilege;
  end if;

  select time_zone into zone from public.profiles where id = auth.uid();
  zone := coalesce(zone, 'UTC');

  return (
    with eligible as materialized (
      select run.id, run.organisation_id, run.published, run.archived_at, run.created_at,
        template.title, org.name as organisation, class.name as class_name
      from public.course_runs run
      join public.course_templates template on template.id = run.template_id
      join public.organisations org on org.id = run.organisation_id
      left join private.course_class_assignments link
        on link.course_id = run.id and link.organisation_id = org.id
      left join private.course_classes class on class.id = link.class_id and class.organisation_id = org.id
      where org.archived_at is null and private.course_lms_read_enabled(org.id)
        and (p_organisation_id is null or org.id = p_organisation_id)
        and (p_scope = 'staff' or run.archived_at is null)
        and (p_scope <> 'personal' or private.course_has_current_teacher(run.id))
        and (search = '' or strpos(lower(template.title), search) > 0
          or strpos(lower(coalesce(class.name, '')), search) > 0)
    ), scheduled as (
      select session.course_run_id, min(session.starts_at) as starts_at,
        max(session.ends_at) as ends_at, count(*) as sessions,
        round(sum(extract(epoch from session.ends_at - session.starts_at)) / 60, 2) as minutes
      from public.course_sessions session join eligible course on course.id = session.course_run_id
      group by session.course_run_id
    ), dated as (
      select course.id, course.organisation_id, course.title, course.organisation, course.class_name,
        schedule.starts_at, schedule.ends_at,
        coalesce(schedule.sessions, 0) as sessions, coalesce(schedule.minutes, 0) as minutes,
        (coalesce(schedule.starts_at, course.created_at) at time zone zone)::date as cohort_date,
        case
          when course.archived_at is not null then 'archived'
          when not course.published or schedule.starts_at is null then 'draft'
          when schedule.ends_at <= observed then 'finished'
          when schedule.starts_at > observed then 'upcoming'
          else 'running'
        end as status
      from eligible course left join scheduled schedule on schedule.course_run_id = course.id
    ), scoped as materialized (
      select * from dated where cohort_date >= p_from and cohort_date < p_until
        and (p_status = 'all' or status = p_status)
    ), roster as materialized (
      select enrol.course_run_id, enrol.user_id, enrol.status
      from public.course_enrolments enrol join scoped course on course.id = enrol.course_run_id
      where enrol.status in ('enrolled', 'completed')
        and private.active_company_participant(enrol.user_id, course.organisation_id)
    ), enrolments as (
      select course_run_id, count(*) as enrolments,
        count(*) filter (where status = 'completed') as completions
      from roster group by course_run_id
    ), certified as (
      select certificate.run_id, count(*) as certificates
      from private.course_completion_records certificate
      join roster on roster.course_run_id = certificate.run_id and roster.user_id = certificate.user_id
      where certificate.revoked_at is null
      group by certificate.run_id
    ), attendance as (
      select session.course_run_id,
        count(*) filter (where mark.value = 'present') as present,
        count(*) filter (where mark.value = 'absent') as absent,
        count(*) filter (where mark.value = 'excused') as excused
      from public.course_sessions session
      join private.course_attendance record on record.session_id = session.id
      join roster on roster.course_run_id = session.course_run_id and roster.user_id = record.user_id
      cross join lateral (values (coalesce(record.register_status,
        case record.state when 'attended' then 'present' when 'absent' then 'absent' end))) mark(value)
      where session.ends_at <= observed
      group by session.course_run_id
    ), metrics as materialized (
      select course.id, course.title, course.organisation, course.class_name, course.status,
        course.starts_at, course.ends_at, course.cohort_date, course.sessions, course.minutes,
        coalesce(enrol.enrolments, 0) as enrolments,
        coalesce(enrol.completions, 0) as completions,
        coalesce(certified.certificates, 0) as certificates,
        coalesce(attendance.present, 0) as present, coalesce(attendance.absent, 0) as absent,
        coalesce(attendance.excused, 0) as excused
      from scoped course
      left join enrolments enrol on enrol.course_run_id = course.id
      left join certified on certified.run_id = course.id
      left join attendance on attendance.course_run_id = course.id
    ), pages as (
      select * from metrics order by cohort_date desc, id desc limit page_size offset (p_page - 1) * page_size
    ), monthly as (
      select month::date as month,
        count(metric.id) filter (where metric.status = 'finished') as finished,
        count(metric.id) filter (where metric.status = 'upcoming') as upcoming,
        coalesce(sum(metric.enrolments), 0) as enrolments,
        coalesce(sum(metric.completions), 0) as completions
      from generate_series(date_trunc('month', p_from::timestamp),
        date_trunc('month', (p_until - 1)::timestamp), interval '1 month') calendar(month)
      left join metrics metric on metric.cohort_date >= month::date
        and metric.cohort_date < (month + interval '1 month')::date
      group by month
    )
    select jsonb_build_object(
      'time_zone', zone,
      'totals', (select jsonb_build_object(
        'courses', count(*), 'upcoming', count(*) filter (where status = 'upcoming'),
        'participants', (select count(distinct user_id) from roster),
        'enrolments', coalesce(sum(enrolments), 0), 'completions', coalesce(sum(completions), 0),
        'certificates', coalesce(sum(certificates), 0), 'sessions', coalesce(sum(sessions), 0),
        'minutes', coalesce(sum(minutes), 0), 'present', coalesce(sum(present), 0),
        'absent', coalesce(sum(absent), 0), 'excused', coalesce(sum(excused), 0)
      ) from metrics),
      'months', (select jsonb_agg(to_jsonb(monthly) order by month) from monthly),
      'courses', (select coalesce(jsonb_agg(to_jsonb(pages) order by cohort_date desc, id desc), '[]'::jsonb) from pages)
    )
  );
end;
$$;

create function public.learning_analytics_access()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.learning_analytics_access();
$$;

create function public.learning_analytics_report(
  p_scope text, p_from date, p_until date, p_organisation_id uuid default null,
  p_status text default 'all', p_search text default '', p_page integer default 1
)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.learning_analytics_report(p_scope, p_from, p_until, p_organisation_id, p_status, p_search, p_page);
$$;

revoke all on function private.learning_analytics_access(), public.learning_analytics_access(),
  private.learning_analytics_report(text,date,date,uuid,text,text,integer),
  public.learning_analytics_report(text,date,date,uuid,text,text,integer)
from public, anon, authenticated, service_role;
grant execute on function private.learning_analytics_access(), public.learning_analytics_access(),
  private.learning_analytics_report(text,date,date,uuid,text,text,integer),
  public.learning_analytics_report(text,date,date,uuid,text,text,integer) to authenticated;

do $migration$
declare
  source text := pg_get_functiondef('private.require_academy_course_access()'::regprocedure);
  anchor constant text := '''/rpc/academy_course_participation_report''';
begin
  if cardinality(string_to_array(source, anchor)) <> 2 then
    raise exception 'Expected one dedicated learning-report read route';
  end if;
  execute replace(source, anchor, anchor || ', ''/rpc/learning_analytics_access'', ''/rpc/learning_analytics_report''');
end;
$migration$;

notify pgrst, 'reload schema';
commit;
