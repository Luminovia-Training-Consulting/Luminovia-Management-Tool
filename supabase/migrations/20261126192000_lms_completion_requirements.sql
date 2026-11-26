begin;

-- Canonical completion rule version 1. Keep its source facts compatible with
-- existing certificates and give both issuance and the UI the same predicates.
create function private.course_completion_requirements(p_run_id uuid, p_user_id uuid)
returns table (
  enrolment_completed boolean, session_count integer, ended_count integer,
  verified_count integer, ends_at timestamptz, quiz_version integer,
  quiz_passed boolean, reverify_required boolean
) language sql stable strict set search_path = '' as $$
  with presence as (
    select count(*)::integer as session_count,
      count(*) filter (where session.ends_at <= now())::integer as ended_count,
      count(*) filter (
        where session.ends_at <= now() and evidence.state = 'attended'
          and evidence.minutes >= ceil(extract(epoch from (session.ends_at - session.starts_at)) / 60 * 0.8)
      )::integer as verified_count,
      max(session.ends_at) as ends_at
    from public.course_sessions session
    left join private.course_attendance evidence
      on evidence.session_id = session.id and evidence.user_id = p_user_id
    where session.course_run_id = p_run_id
  ), current_quiz as (
    select quiz.version
    from private.course_quiz_versions quiz
    join private.course_quizzes active
      on active.run_id = quiz.run_id and active.version = quiz.version
    where quiz.run_id = p_run_id and quiz.published
  )
  select
    exists (
      select 1 from public.course_enrolments enrolment
      where enrolment.course_run_id = p_run_id and enrolment.user_id = p_user_id
        and enrolment.status = 'completed'
    ),
    presence.session_count, presence.ended_count, presence.verified_count, presence.ends_at,
    current_quiz.version,
    current_quiz.version is null or exists (
      select 1 from private.course_quiz_attempts attempt
      where attempt.run_id = p_run_id and attempt.quiz_version = current_quiz.version
        and attempt.user_id = p_user_id and attempt.passed
    ),
    exists (
      select 1 from private.course_completion_records revoked
      where revoked.run_id = p_run_id and revoked.user_id = p_user_id
        and revoked.revoked_at is not null and not exists (
          select 1 from private.course_attendance evidence
          join public.course_sessions session on session.id = evidence.session_id
          where session.course_run_id = p_run_id and evidence.user_id = p_user_id
            and evidence.updated_at > revoked.revoked_at
        )
    )
  from presence left join current_quiz on true;
$$;
revoke all on function private.course_completion_requirements(uuid, uuid)
  from public, anon, authenticated, service_role;

-- Update only the shared certificate eligibility branch. Existing snapshots,
-- idempotent issuance, audit, error messages and licence gates are preserved.
do $$
declare
  definition text := pg_catalog.pg_get_functiondef(
    'private.course_workspace_action_before_premium(uuid,text,jsonb,integer)'::regprocedure
  );
  declaration constant text := 'v_document_version uuid;';
  existing constant text := $old$
  if exists(select 1 from private.course_completion_records old where old.run_id=p_run_id and old.user_id=auth.uid() and old.revoked_at is not null
   and not exists(select 1 from private.course_attendance reviewed join public.course_sessions reviewed_session on reviewed_session.id=reviewed.session_id where reviewed_session.course_run_id=p_run_id and reviewed.user_id=auth.uid() and reviewed.updated_at>old.revoked_at)) then raise exception 'Teaching staff must reverify attendance after revocation before reissue' using errcode='22023';end if;
  if not exists(select 1 from public.course_enrolments where course_run_id=p_run_id and user_id=auth.uid() and status='completed') or not exists(select 1 from public.course_sessions where course_run_id=p_run_id) or exists(select 1 from public.course_sessions s left join private.course_attendance a on a.session_id=s.id and a.user_id=auth.uid() where s.course_run_id=p_run_id and (s.ends_at>now() or a.state is distinct from 'attended' or a.minutes<ceil(extract(epoch from(s.ends_at-s.starts_at))/60*0.8))) then raise exception 'Completed enrolment and verified 80 percent attendance in every ended session required' using errcode='22023';end if;
  select q.* into quiz from private.course_quiz_versions q join private.course_quizzes h on h.run_id=q.run_id and h.version=q.version where q.run_id=p_run_id and q.published;
  if quiz.version is not null and not exists(select 1 from private.course_quiz_attempts a where a.run_id=p_run_id and a.quiz_version=quiz.version and a.user_id=auth.uid() and a.passed) then raise exception 'Pass current published quiz first' using errcode='22023';end if;
$old$;
  evaluation constant text := $new$
  select * into completion_requirements
  from private.course_completion_requirements(p_run_id, auth.uid());
  if completion_requirements.reverify_required then
    raise exception 'Teaching staff must reverify attendance after revocation before reissue' using errcode='22023';
  end if;
  if not completion_requirements.enrolment_completed or completion_requirements.session_count = 0
     or completion_requirements.verified_count <> completion_requirements.session_count then
    raise exception 'Completed enrolment and verified 80 percent attendance in every ended session required' using errcode='22023';
  end if;
  quiz.version := completion_requirements.quiz_version;
  if not completion_requirements.quiz_passed then
    raise exception 'Pass current published quiz first' using errcode='22023';
  end if;
$new$;
begin
  if cardinality(string_to_array(definition, declaration)) <> 2
      or cardinality(string_to_array(definition, existing)) <> 2 then
    raise exception 'Expected canonical course completion branch';
  end if;
  execute replace(replace(definition, declaration, declaration || 'completion_requirements record;'),
    existing, evaluation);
end;
$$;

-- The staff query is per enrolment; learner calls can only read their own facts.
-- Current course authority is required even for a previously issued certificate.
create function private.course_completion_status(p_run_id uuid, p_user_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  licence_status text;
  context jsonb;
  target_user uuid := coalesce(p_user_id, auth.uid());
  requirements record;
  issued boolean;
begin
  if (select installation.edition from private.installation_identity installation)
      is distinct from 'internal' then
    licence_status := private.academy_course_access_status();
    if licence_status is null or licence_status not in ('active', 'grace') then
      raise insufficient_privilege;
    end if;
  end if;
  context := private.course_workspace_context(p_run_id);
  if not coalesce((context->>'lms_enabled')::boolean, false)
     or (not coalesce((context->>'staff')::boolean, false)
       and (not coalesce((context->>'learner')::boolean, false) or target_user is distinct from auth.uid()))
     or not exists (
       select 1 from public.course_enrolments enrolment
       where enrolment.course_run_id = p_run_id and enrolment.user_id = target_user
         and enrolment.status in ('enrolled', 'completed')
     ) then
    raise insufficient_privilege;
  end if;

  select * into requirements from private.course_completion_requirements(p_run_id, target_user);
  select exists (
    select 1 from private.course_completion_records completion
    where completion.run_id = p_run_id and completion.user_id = target_user
      and completion.revoked_at is null
  ) into issued;
  return to_jsonb(requirements) || jsonb_build_object(
    'rule_version', 1,
    'state', case
      when issued then 'issued'
      when requirements.enrolment_completed and requirements.session_count > 0
        and requirements.verified_count = requirements.session_count
        and requirements.quiz_passed and not requirements.reverify_required then 'ready'
      else 'pending'
    end
  );
end;
$$;
create function public.course_completion_status(p_run_id uuid, p_user_id uuid default null)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.course_completion_status(p_run_id, p_user_id);
$$;
revoke all on function private.course_completion_status(uuid, uuid),
  public.course_completion_status(uuid, uuid) from public, anon, service_role;
grant execute on function private.course_completion_status(uuid, uuid),
  public.course_completion_status(uuid, uuid) to authenticated;

-- Permit this scoped read through both dedicated-edition pre-request gates.
do $$
declare
  academy_definition text := pg_catalog.pg_get_functiondef(
    'private.require_academy_course_access()'::regprocedure
  );
  portal_definition text := pg_catalog.pg_get_functiondef(
    'private.require_portal_access()'::regprocedure
  );
  anchor constant text := '''/rpc/course_gradebook_export''';
begin
  if cardinality(string_to_array(academy_definition, anchor)) <> 2
      or cardinality(string_to_array(portal_definition, anchor)) <> 2 then
    raise exception 'Expected read-only course workspace boundary';
  end if;
  execute replace(academy_definition, anchor, anchor || ', ''/rpc/course_completion_status''');
  execute replace(portal_definition, anchor, anchor || ', ''/rpc/course_completion_status''');
end;
$$;

notify pgrst, 'reload schema';
commit;
