begin;

-- Share the scheduled-course criteria between the company picker and the
-- confirmation transaction. The callers own the company and actor checks.
create function private.company_participant_upcoming_courses(
  p_organisation_id uuid, p_run_ids uuid[], p_after timestamptz
)
returns table(run_id uuid, title text, starts_at timestamptz, ends_at timestamptz, time_zone text)
language sql stable security invoker set search_path = ''
as $$
  select run.id, template.title, schedule.starts_at, schedule.ends_at, run.time_zone
  from public.course_runs run
  join public.course_templates template on template.id = run.template_id
  cross join lateral (
    select min(session.starts_at) as starts_at, max(session.ends_at) as ends_at
    from public.course_sessions session
    where session.course_run_id = run.id
  ) schedule
  where run.organisation_id = p_organisation_id and run.archived_at is null and run.published
    and (p_run_ids is null or run.id = any(p_run_ids))
    and schedule.starts_at > p_after;
$$;

create function private.company_participant_assignable_courses(
  p_organisation_id uuid, p_user_id uuid, p_search text, p_limit integer, p_offset integer
)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_internal_company_participant_manager(p_organisation_id);
  if not private.company_premium_enabled(p_organisation_id)
    or not private.active_company_participant(p_user_id, p_organisation_id) then
    raise exception 'Company participant unavailable' using errcode = '42501';
  end if;
  if p_search is null or char_length(p_search) > 200
    or p_limit is null or p_limit not between 1 and 100
    or p_offset is null or p_offset < 0 then
    raise exception 'Invalid course selection page' using errcode = '22023';
  end if;
  return (
    with requested as materialized (
      select course.*
      from private.company_participant_upcoming_courses(p_organisation_id, null, statement_timestamp()) course
      where strpos(lower(course.title), lower(btrim(p_search))) > 0
        and not exists (
          select 1 from public.course_enrolments existing
          where existing.course_run_id = course.run_id and existing.user_id = p_user_id
            and existing.status in ('enrolled', 'completed')
        )
      order by course.starts_at, course.run_id
      limit p_limit + 1 offset p_offset
    ), page as (
      select * from requested order by starts_at, run_id limit p_limit
    )
    select jsonb_build_object(
      'items', coalesce((select jsonb_agg(to_jsonb(page) order by starts_at, run_id) from page), '[]'::jsonb),
      'has_more', (select count(*) from requested) > p_limit
    )
  );
end;
$$;

create function private.assign_company_participant_courses(
  p_organisation_id uuid, p_user_id uuid, p_run_ids uuid[]
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  locked_count bigint;
  enrolled uuid[];
  unchanged uuid[];
  course_id uuid;
  confirmed_at timestamptz;
begin
  perform private.require_internal_company_participant_manager(p_organisation_id);
  if not private.company_premium_enabled(p_organisation_id)
    or not private.active_company_participant(p_user_id, p_organisation_id) then
    raise exception 'Company participant unavailable' using errcode = '42501';
  end if;
  if p_run_ids is null or array_ndims(p_run_ids) is distinct from 1
    or cardinality(p_run_ids) not between 1 and 50
    or (select count(distinct id) from unnest(p_run_ids) as selected(id)) <> cardinality(p_run_ids) then
    raise exception 'Select one to fifty distinct courses' using errcode = '22023';
  end if;

  -- Match company membership commands and the course-first Premium lock order.
  -- Lock all selected runs in UUID order so overlapping batches serialize even
  -- when the caller selects the same courses in different orders.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('participant-membership:' || p_user_id::text, 0)
  );
  perform 1 from public.course_runs run
  where run.id = any(p_run_ids) and run.organisation_id = p_organisation_id and run.archived_at is null
  order by run.id for update;
  get diagnostics locked_count = row_count;
  perform private.lock_company_premium(p_organisation_id);

  -- Account role changes lock the owning profile. Pin current account and
  -- client membership state before rechecking the authenticated actor.
  perform 1 from public.profiles profile
  where profile.id in (auth.uid(), p_user_id) order by profile.id for share;
  perform 1 from public.client_organisation_memberships membership
  where membership.organisation_id = p_organisation_id
    and membership.user_id = auth.uid() and membership.removed_at is null
  for share;
  perform private.require_internal_company_participant_manager(p_organisation_id);
  if not private.active_company_participant(p_user_id, p_organisation_id) then
    raise exception 'Company participant unavailable' using errcode = '42501';
  end if;
  if locked_count <> cardinality(p_run_ids) then
    raise exception 'Course selection changed' using errcode = 'PT409';
  end if;

  -- Already-enrolled and completed rows need no write. This preserves history
  -- and returns a harmless receipt for retries, including after a course starts.
  select coalesce(array_agg(existing.course_run_id order by existing.course_run_id), '{}') into unchanged
  from public.course_enrolments existing
  where existing.course_run_id = any(p_run_ids) and existing.user_id = p_user_id
    and existing.status in ('enrolled', 'completed');
  confirmed_at := clock_timestamp();
  select coalesce(array_agg(course.run_id order by course.run_id), '{}') into enrolled
  from private.company_participant_upcoming_courses(p_organisation_id, p_run_ids, confirmed_at) course
  where course.run_id <> all(unchanged);
  if cardinality(enrolled) + cardinality(unchanged) <> cardinality(p_run_ids) then
    raise exception 'Course selection changed' using errcode = 'PT409';
  end if;

  -- Reuse the single-course transaction for audit, access and chat membership.
  foreach course_id in array enrolled loop
    perform private.manage_course_enrolment(course_id, p_user_id, 'enrolled');
  end loop;
  return jsonb_build_object('enrolled', enrolled, 'unchanged', unchanged);
end;
$$;

create function public.company_participant_assignable_courses(
  p_organisation_id uuid, p_user_id uuid, p_search text default '', p_limit integer default 30, p_offset integer default 0
)
returns jsonb language sql stable security invoker set search_path = ''
as $$
  select private.company_participant_assignable_courses(p_organisation_id, p_user_id, p_search, p_limit, p_offset);
$$;

create function public.assign_company_participant_courses(
  p_organisation_id uuid, p_user_id uuid, p_run_ids uuid[]
)
returns jsonb language sql security invoker set search_path = ''
as $$
  select private.assign_company_participant_courses(p_organisation_id, p_user_id, p_run_ids);
$$;

revoke all on function private.company_participant_upcoming_courses(uuid, uuid[], timestamptz),
  private.company_participant_assignable_courses(uuid, uuid, text, integer, integer),
  private.assign_company_participant_courses(uuid, uuid, uuid[]),
  public.company_participant_assignable_courses(uuid, uuid, text, integer, integer),
  public.assign_company_participant_courses(uuid, uuid, uuid[])
from public, anon, authenticated, service_role;
grant execute on function private.company_participant_assignable_courses(uuid, uuid, text, integer, integer),
  private.assign_company_participant_courses(uuid, uuid, uuid[]),
  public.company_participant_assignable_courses(uuid, uuid, text, integer, integer),
  public.assign_company_participant_courses(uuid, uuid, uuid[])
to authenticated;

notify pgrst, 'reload schema';
commit;
