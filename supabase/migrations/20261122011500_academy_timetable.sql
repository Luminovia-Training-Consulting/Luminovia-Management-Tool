begin;

-- Bound searches by UTC first, then intersect the exact civil-date window for
-- each course. An overnight lesson remains visible on the next day.
create index course_sessions_timetable_span_idx on public.course_sessions
  using gist (tstzrange(starts_at, ends_at, '[)'));

create function private.academy_timetable(
  p_from date, p_until date, p_after_start timestamptz, p_after_id uuid
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  manager boolean := private.has_permission('courses.manage');
  lecturer boolean := private.lecturer_actor();
  page_size constant integer := 100;
begin
  if (select edition from private.installation_identity) = 'internal'
     or not coalesce(private.academy_course_access_status() in ('active', 'grace'), false)
     or not (private.actor_active() or private.participant_actor()) then
    raise insufficient_privilege;
  end if;
  if p_from is null or p_until is null or not isfinite(p_from) or not isfinite(p_until)
     or p_from < date '0001-01-01' or p_until > date '9999-12-31'
     or p_until < p_from or p_until - p_from >= 31
     or (p_after_start is null) <> (p_after_id is null)
     or (p_after_start is not null and not isfinite(p_after_start)) then
    raise exception 'Invalid timetable date window or cursor' using errcode = '22023';
  end if;

  return (
    with scoped as (
      select session.id as session_id, run.id as course_run_id, template.title as course_title,
        session.starts_at, session.ends_at, run.time_zone, run.venue, run.delivery_type
      from public.course_sessions session
      join public.course_runs run on run.id = session.course_run_id and run.archived_at is null
      join public.organisations organisation on organisation.id = run.organisation_id
        and organisation.archived_at is null
      join public.course_templates template on template.id = run.template_id
      where isfinite(session.starts_at) and isfinite(session.ends_at)
        and tstzrange(session.starts_at, session.ends_at, '[)') && tstzrange(
          (p_from::timestamp at time zone 'UTC') - interval '24 hours',
          ((p_until + 1)::timestamp at time zone 'UTC') + interval '24 hours', '[)')
        and (p_after_start is null or (session.starts_at, session.id) > (p_after_start, p_after_id))
        and (
          manager or (lecturer and private.course_has_current_teacher(run.id))
          or private.client_has_organisation(run.organisation_id)
          or (private.active_company_participant(actor_id, run.organisation_id) and exists (
            select 1 from public.course_enrolments enrolment
            where enrolment.course_run_id = run.id and enrolment.user_id = actor_id
              and enrolment.status in ('enrolled', 'completed')
          ))
        )
    ), windowed as (
      select scoped.*,
        greatest((scoped.starts_at at time zone zone.name)::date, p_from) as local_day
      from scoped
      -- Legacy rows may predate validated course zones. Only display sessions
      -- with a named PostgreSQL time zone, without inventing an offset.
      join pg_catalog.pg_timezone_names zone on zone.name = scoped.time_zone
      where tstzrange(scoped.starts_at, scoped.ends_at, '[)') && tstzrange(
        p_from::timestamp at time zone zone.name, (p_until + 1)::timestamp at time zone zone.name, '[)')
      order by scoped.starts_at, scoped.session_id
      limit page_size + 1
    ), page as (
      select * from windowed order by starts_at, session_id limit page_size
    )
    select jsonb_build_object(
      'rows', coalesce((select jsonb_agg(to_jsonb(page) order by starts_at, session_id) from page), '[]'::jsonb),
      'next', case when (select count(*) from windowed) > page_size then (
        select jsonb_build_object('start', starts_at, 'id', session_id)
        from page order by starts_at desc, session_id desc limit 1
      ) end
    )
  );
end;
$$;

create function public.academy_timetable(
  p_from date, p_until date, p_after_start timestamptz default null, p_after_id uuid default null
) returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.academy_timetable(p_from, p_until, p_after_start, p_after_id);
$$;

revoke all on function private.academy_timetable(date,date,timestamptz,uuid),
  public.academy_timetable(date,date,timestamptz,uuid) from public, anon, authenticated, service_role;
grant execute on function private.academy_timetable(date,date,timestamptz,uuid),
  public.academy_timetable(date,date,timestamptz,uuid) to authenticated;

-- This endpoint is an authenticated read during active or grace access.
do $$
declare
  definition text := pg_catalog.pg_get_functiondef('private.require_academy_course_access()'::regprocedure);
  endpoint constant text := '''/rpc/course_session_register''';
begin
  if cardinality(string_to_array(definition, endpoint)) <> 2 then
    raise exception 'Expected exactly one academy session register read endpoint';
  end if;
  execute replace(definition, endpoint, endpoint || ', ''/rpc/academy_timetable''');
end;
$$;

notify pgrst, 'reload schema';
commit;
