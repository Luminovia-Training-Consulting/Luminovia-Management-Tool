begin;

-- Keep archived reads separate from the operational register and every write.
create function private.inspect_retained_course_attendance(
  p_organisation_id uuid, p_run_id uuid, p_reason text,
  p_after_start timestamptz, p_after_session_id uuid, p_after_user_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  course_zone text;
  items jsonb;
begin
  if not exists (select 1 from private.installation_identity where edition = 'internal')
    or not private.is_company_premium_admin() then
    raise insufficient_privilege;
  end if;
  perform 1 from public.profiles where id = actor_id and active for share;
  if not found then raise insufficient_privilege; end if;
  perform 1 from public.user_roles where user_id = actor_id and role = 'admin' for share;
  if not found then raise insufficient_privilege; end if;
  select run.time_zone into course_zone from public.course_runs run
    join public.organisations organisation on organisation.id = run.organisation_id
    where run.id = p_run_id and run.organisation_id = p_organisation_id
    for share of run, organisation;
  if not found or private.company_premium_enabled(p_organisation_id) then
    raise insufficient_privilege;
  end if;

  if p_reason is null or char_length(btrim(p_reason)) not between 8 and 300
    or num_nonnulls(p_after_start, p_after_session_id, p_after_user_id) not in (0, 3)
    or (p_after_start is not null and not isfinite(p_after_start)) then
    raise exception 'Invalid inspection purpose or cursor' using errcode = '22023';
  end if;

  -- Recorded rows survive an enrolment change. Never infer marks for a
  -- participant who has no retained record for that session.
  select coalesce(jsonb_agg(to_jsonb(page) order by page.starts_at, page.session_id, page.user_id), '[]'::jsonb)
    into items
    from (
      select session.id as session_id, session.starts_at, session.ends_at,
        attendance.user_id, profile.display_name as name,
        coalesce(attendance.register_status, case attendance.state
          when 'attended' then 'present' when 'absent' then 'absent' else 'reported' end) as status,
        attendance.arrival_at, attendance.departure_at, attendance.staff_note as note
      from public.course_sessions session
      join private.course_attendance attendance on attendance.session_id = session.id
      join public.profiles profile on profile.id = attendance.user_id
      where session.course_run_id = p_run_id and (p_after_start is null or
        (session.starts_at, session.id, attendance.user_id) > (p_after_start, p_after_session_id, p_after_user_id))
      order by session.starts_at, session.id, attendance.user_id
      limit 51
    ) page;

  insert into public.audit_events(actor_id, action, resource_id, details)
    values (actor_id, 'course.retained_attendance_inspected', p_run_id, jsonb_build_object(
      'organisation_id', p_organisation_id, 'purpose', btrim(p_reason),
      'returned_count', least(jsonb_array_length(items), 50)
    ));

  return jsonb_build_object(
    'time_zone', course_zone,
    'items', case when jsonb_array_length(items) > 50 then items - 50 else items end,
    'next_cursor', case when jsonb_array_length(items) > 50 then jsonb_build_object(
      'starts_at', items->49->>'starts_at', 'session_id', items->49->>'session_id', 'user_id', items->49->>'user_id'
    ) end
  );
end;
$$;

create function public.inspect_retained_course_attendance(
  p_organisation_id uuid, p_run_id uuid, p_reason text,
  p_after_start timestamptz default null, p_after_session_id uuid default null, p_after_user_id uuid default null
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.inspect_retained_course_attendance(
    p_organisation_id, p_run_id, p_reason, p_after_start, p_after_session_id, p_after_user_id
  );
$$;

revoke all on function private.inspect_retained_course_attendance(uuid, uuid, text, timestamptz, uuid, uuid),
  public.inspect_retained_course_attendance(uuid, uuid, text, timestamptz, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.inspect_retained_course_attendance(uuid, uuid, text, timestamptz, uuid, uuid),
  public.inspect_retained_course_attendance(uuid, uuid, text, timestamptz, uuid, uuid) to authenticated;

create or replace function private.admin_audit_actions() returns text[]
language sql immutable set search_path = '' as $$
  select private.admin_audit_actions_before_course_webhooks() || array[
    'integration.webhook_created', 'integration.webhook_revoked', 'course.retained_attendance_inspected'
  ];
$$;
revoke all on function private.admin_audit_actions() from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';
commit;
