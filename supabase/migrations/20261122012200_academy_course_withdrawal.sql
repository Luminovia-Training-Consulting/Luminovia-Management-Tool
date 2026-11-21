begin;

-- Keep one audited whole-course action. The standalone path serializes with
-- its own profile, course, company and participant membership changes.
create or replace function private.cancel_own_course_enrolment(p_course_run_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  first_start timestamptz;
  room record;
  actor uuid := auth.uid();
  company_id uuid;
  internal boolean := (select edition = 'internal' from private.installation_identity);
begin
  if not private.participant_actor() then
    raise exception 'Active participant required' using errcode = '42501';
  end if;
  if internal then
    perform private.lock_course_premium(p_course_run_id);
    select run.organisation_id into company_id
    from public.course_runs run where run.id = p_course_run_id for update;
  else
    perform private.lock_academy_course_access();
    perform 1 from public.profiles where id = actor and active for share;
    if not found then raise insufficient_privilege; end if;
    perform 1 from public.user_roles where user_id = actor order by role for share;
    -- The same course row serializes withdrawals with schedule/capacity and
    -- with chat writes that check the enrolment before recording a message.
    select org.id into company_id
    from public.course_runs run
    join public.organisations org on org.id = run.organisation_id
    where run.id = p_course_run_id and run.archived_at is null and org.archived_at is null
    for update of run for share of org;
    if not found then raise insufficient_privilege; end if;
    perform 1 from private.company_participant_memberships membership
    where membership.organisation_id = company_id and membership.user_id = actor
      and membership.status = 'active' for share;
  end if;
  if not found or not private.active_company_participant(actor, company_id) then
    raise exception 'Active company participant required' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text, 0));
  perform 1 from public.course_enrolments
  where course_run_id = p_course_run_id and user_id = actor and status = 'enrolled' for update;
  if not found then raise exception 'Active enrolment required' using errcode = '42501'; end if;

  select min(starts_at) into first_start from public.course_sessions where course_run_id = p_course_run_id;
  if first_start is null or first_start < clock_timestamp() + interval '7 days' then
    raise exception 'Cancellation deadline passed' using errcode = '22023';
  end if;
  update public.course_enrolments set status = 'removed', updated_at = clock_timestamp()
  where course_run_id = p_course_run_id and user_id = actor;
  for room in
    select id, owner_id from public.chat_rooms
    where course_run_id = p_course_run_id and kind = 'participant_course' order by id for update
  loop
    -- The standalone ACL requires current enrolment even for a retained
    -- independent or unresolved membership. Do not delete its provenance.
    if internal or (room.owner_id is distinct from actor and exists (
      select 1 from private.participant_chat_origins origin
      where origin.room_id = room.id and origin.user_id = actor
        and origin.assignment and not origin.manual and not origin.unknown
    )) then
      perform private.participant_chat_assignment_release(room.id, actor, p_course_run_id);
    end if;
  end loop;
  insert into public.audit_events(actor_id, action, resource_id, details)
  values (actor, 'course.enrolment.changed', p_course_run_id,
    jsonb_build_object('user_id', actor, 'previous', 'enrolled', 'status', 'removed', 'self_cancelled', true));
end;
$$;

do $$
declare
  window_sql text := pg_catalog.pg_get_functiondef('private.course_withdrawal_window(uuid)'::regprocedure);
  window_anchor constant text := '''can_withdraw'',is_enrolled and coalesce(';
  gate text := pg_catalog.pg_get_functiondef('private.require_academy_course_access()'::regprocedure);
  read_anchor constant text := '''/rpc/course_welcome_content''';
  write_anchor constant text := '''/rpc/manage_course_enrolment''';
begin
  if cardinality(string_to_array(window_sql, window_anchor)) <> 2
    or cardinality(string_to_array(gate, read_anchor)) <> 2
    or cardinality(string_to_array(gate, write_anchor)) <> 2 then
    raise exception 'Expected exact academy learner withdrawal gates';
  end if;
  execute replace(window_sql, window_anchor, '''can_withdraw'',is_enrolled and (
    (select edition from private.installation_identity) = ''internal''
    or coalesce(private.academy_course_access_status() = ''active'', false)
  ) and coalesce(');
  execute replace(replace(gate, read_anchor, read_anchor || ', ''/rpc/course_withdrawal_window'''),
    write_anchor, write_anchor || ', ''/rpc/cancel_own_course_enrolment''');
end;
$$;

notify pgrst, 'reload schema';
commit;
