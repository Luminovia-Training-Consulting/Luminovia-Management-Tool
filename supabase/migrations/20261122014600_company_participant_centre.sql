begin;

alter table private.company_participant_memberships
  add column company_reference text check (
    char_length(company_reference) between 1 and 64
    and company_reference = regexp_replace(company_reference, '^[[:space:]]+|[[:space:]]+$', '', 'g')
  ),
  add column company_reference_written_by uuid,
  add column company_reference_written_version integer;

create unique index company_participant_reference_per_company
  on private.company_participant_memberships (organisation_id, lower(company_reference))
  where company_reference is not null;

-- The existing directory retains its current grants and permission checks.
create or replace function private.company_participants(p_organisation_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  internal_edition boolean := (select edition from private.installation_identity) = 'internal';
begin
  if not private.actor_active() or not (
    private.client_has_organisation(p_organisation_id) or private.has_permission('courses.manage')
  ) then
    raise exception 'Company participant management required' using errcode = '42501';
  end if;
  if not private.company_premium_enabled(p_organisation_id) then
    raise exception 'Company Premium LMS is OFF' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'user_id', profile.id,
      'luminovia_user_id', profile.luminovia_user_id,
      'display_name', profile.display_name,
      'joined_at', membership.joined_at,
      'version', membership.version,
      'company_reference', case when internal_edition then membership.company_reference end
    ) order by profile.display_name, profile.luminovia_user_id)
    from private.company_participant_memberships membership
    join public.profiles profile on profile.id = membership.user_id
    where membership.organisation_id = p_organisation_id
      and private.active_company_participant(profile.id, p_organisation_id)
  ), '[]'::jsonb);
end;
$$;

create function private.require_internal_company_participant_manager(p_organisation_id uuid)
returns void language plpgsql stable security invoker set search_path = ''
as $$
begin
  if (select edition from private.installation_identity) is distinct from 'internal'
    or not private.actor_active() or not (
      private.client_has_organisation(p_organisation_id) or private.has_permission('courses.manage')
    ) then
    raise exception 'Company participant management required' using errcode = '42501';
  end if;
end;
$$;

create function private.set_company_participant_reference(
  p_organisation_id uuid, p_user_id uuid, p_reference text, p_expected_version integer
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  normalized_reference text := regexp_replace(p_reference, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  membership private.company_participant_memberships%rowtype;
begin
  perform private.require_internal_company_participant_manager(p_organisation_id);
  if p_user_id is null or p_expected_version is null or p_expected_version < 1
    or (normalized_reference is not null and char_length(normalized_reference) not between 1 and 64) then
    raise exception 'Invalid company participant reference' using errcode = '22023';
  end if;

  -- Match the existing association/removal lock order before reading the version.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('participant-membership:' || p_user_id::text, 0)
  );
  perform private.lock_company_premium(p_organisation_id);
  select * into membership
    from private.company_participant_memberships
    where organisation_id = p_organisation_id and user_id = p_user_id
    for update;

  perform private.require_internal_company_participant_manager(p_organisation_id);
  if membership.status is distinct from 'active'
    or not private.active_company_participant(p_user_id, p_organisation_id) then
    raise exception 'Participant membership unavailable' using errcode = '42501';
  end if;

  if membership.version <> p_expected_version then
    -- Only a retry of this caller's immediately preceding reference change can
    -- return a successful result for a stale version.
    if membership.version::bigint = p_expected_version::bigint + 1
      and membership.company_reference_written_version = membership.version
      and membership.company_reference_written_by = actor_id
      and membership.company_reference is not distinct from normalized_reference then
      return jsonb_build_object('company_reference', membership.company_reference, 'version', membership.version);
    end if;
    raise exception 'Company participant membership changed' using errcode = 'PT409';
  end if;
  if membership.company_reference is not distinct from normalized_reference then
    return jsonb_build_object('company_reference', membership.company_reference, 'version', membership.version);
  end if;
  if membership.version = 2147483647 then
    raise exception 'Company participant membership version limit reached' using errcode = 'PT409';
  end if;

  begin
    update private.company_participant_memberships set
      company_reference = normalized_reference,
      version = membership.version + 1,
      company_reference_written_by = actor_id,
      company_reference_written_version = membership.version + 1
    where organisation_id = p_organisation_id and user_id = p_user_id
    returning * into membership;
  exception when unique_violation then
    raise exception 'Company participant reference already in use' using errcode = 'PT409';
  end;

  insert into public.audit_events(actor_id, action, resource_id, details)
  values (
    actor_id, 'company.participant_reference_changed', p_organisation_id,
    jsonb_build_object('user_id', p_user_id, 'version', membership.version)
  );
  return jsonb_build_object('company_reference', membership.company_reference, 'version', membership.version);
end;
$$;

create function private.company_participant_overview(
  p_organisation_id uuid, p_user_id uuid, p_limit integer, p_offset integer
)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_internal_company_participant_manager(p_organisation_id);
  if not private.company_premium_enabled(p_organisation_id) then
    raise exception 'Company Premium LMS is OFF' using errcode = '42501';
  end if;
  if p_user_id is null or p_limit is null or p_limit not between 1 and 100
    or p_offset is null or p_offset < 0 then
    raise exception 'Invalid company participant overview page' using errcode = '22023';
  end if;
  if not private.active_company_participant(p_user_id, p_organisation_id) then
    raise exception 'Participant membership unavailable' using errcode = '42501';
  end if;

  return (
    with requested as materialized (
      select run.id, template.title, enrolment.status, run.time_zone, entry.starts_at
      from public.course_enrolments enrolment
      join public.course_runs run on run.id = enrolment.course_run_id
      join public.course_templates template on template.id = run.template_id
      left join lateral (
        select session.starts_at from public.course_sessions session where session.course_run_id = run.id
        order by session.starts_at limit 1
      ) entry on true
      where enrolment.user_id = p_user_id and run.organisation_id = p_organisation_id
        and run.archived_at is null
      order by entry.starts_at desc nulls last, run.id
      limit p_limit + 1 offset p_offset
    ), page as (
      select * from requested order by starts_at desc nulls last, id limit p_limit
    )
    select jsonb_build_object(
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
          'run_id', page.id,
          'title', page.title,
          'status', page.status,
          'starts_at', page.starts_at,
          'ends_at', attendance.ends_at,
          'time_zone', page.time_zone,
          'session_count', attendance.session_count,
          'present_count', attendance.present_count,
          'absent_count', attendance.absent_count,
          'excused_count', attendance.excused_count
        ) order by page.starts_at desc nulls last, page.id)
        from page
        cross join lateral (
          select max(session.ends_at) as ends_at, count(*) as session_count,
            count(*) filter (where register.status = 'present') as present_count,
            count(*) filter (where register.status = 'absent') as absent_count,
            count(*) filter (where register.status = 'excused') as excused_count
          from public.course_sessions session
          left join private.course_attendance entry on entry.session_id = session.id and entry.user_id = p_user_id
          cross join lateral (values (coalesce(entry.register_status,
            case entry.state when 'attended' then 'present' when 'absent' then 'absent' end
          ))) register(status)
          where session.course_run_id = page.id
        ) attendance
      ), '[]'::jsonb),
      'has_more', (select count(*) from requested) > p_limit
    )
  );
end;
$$;

create function public.set_company_participant_reference(
  p_organisation_id uuid, p_user_id uuid, p_reference text, p_expected_version integer
)
returns jsonb language sql security invoker set search_path = ''
as $$
  select private.set_company_participant_reference(p_organisation_id, p_user_id, p_reference, p_expected_version);
$$;

create function public.company_participant_overview(
  p_organisation_id uuid, p_user_id uuid, p_limit integer default 30, p_offset integer default 0
)
returns jsonb language sql stable security invoker set search_path = ''
as $$
  select private.company_participant_overview(p_organisation_id, p_user_id, p_limit, p_offset);
$$;

revoke all on function private.require_internal_company_participant_manager(uuid),
  private.set_company_participant_reference(uuid, uuid, text, integer),
  private.company_participant_overview(uuid, uuid, integer, integer),
  public.set_company_participant_reference(uuid, uuid, text, integer),
  public.company_participant_overview(uuid, uuid, integer, integer)
from public, anon, authenticated, service_role;
grant execute on function private.set_company_participant_reference(uuid, uuid, text, integer),
  private.company_participant_overview(uuid, uuid, integer, integer),
  public.set_company_participant_reference(uuid, uuid, text, integer),
  public.company_participant_overview(uuid, uuid, integer, integer)
to authenticated;

notify pgrst, 'reload schema';
commit;
