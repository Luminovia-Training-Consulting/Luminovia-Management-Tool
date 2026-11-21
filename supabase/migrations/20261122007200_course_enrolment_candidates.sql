begin;

-- Only staff authorised to manage this course or contacts of its company
-- can select current company participants for enrolment. Search stays within
-- that one company and omits learners already enrolled or completed.
create function private.course_enrolment_candidates(
  p_course_run_id uuid, p_search text default ''
) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  context jsonb := private.course_workspace_context(p_course_run_id);
  needle text := lower(btrim(coalesce(p_search,'')));
begin
  if not coalesce((context->>'lms_enabled')::boolean,false)
    or not (coalesce((context->>'manager')::boolean,false)
      or coalesce((context->>'client')::boolean,false)) then
    raise exception 'Course enrolment management required' using errcode='42501';
  end if;
  if length(needle)>120 then
    raise exception 'Invalid enrolment search' using errcode='22023';
  end if;
  return coalesce((
    select jsonb_agg(to_jsonb(candidate) order by candidate.display_name, candidate.luminovia_user_id)
    from (
      select profile.id as user_id, profile.display_name, profile.luminovia_user_id
      from public.course_runs run
      join private.company_participant_memberships membership
        on membership.organisation_id=run.organisation_id and membership.status='active'
      join public.profiles profile on profile.id=membership.user_id
      where run.id=p_course_run_id
        and private.active_company_participant(profile.id,run.organisation_id)
        and (needle='' or strpos(lower(profile.display_name),needle)>0
          or strpos(lower(profile.luminovia_user_id),needle)>0)
        and not exists (
          select 1 from public.course_enrolments enrolment
          where enrolment.course_run_id=run.id and enrolment.user_id=profile.id
            and enrolment.status in ('enrolled','completed')
        )
      order by profile.display_name, profile.luminovia_user_id
      limit 100
    ) candidate
  ),'[]'::jsonb);
end;
$$;

create function public.course_enrolment_candidates(
  p_course_run_id uuid, p_search text default ''
) returns jsonb language sql stable security invoker set search_path = ''
as $$select private.course_enrolment_candidates(p_course_run_id,p_search);$$;

revoke all on function private.course_enrolment_candidates(uuid,text),
  public.course_enrolment_candidates(uuid,text) from public,anon,authenticated,service_role;
grant execute on function private.course_enrolment_candidates(uuid,text),
  public.course_enrolment_candidates(uuid,text) to authenticated;
-- The learner gets only their current withdrawal option for this exact
-- course. Computing availability with the server clock matches the mutation.
create function private.course_withdrawal_window(p_course_run_id uuid)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare
  context jsonb := private.course_workspace_context(p_course_run_id);
  first_start timestamptz;
  is_enrolled boolean;
begin
  if not coalesce((context->>'lms_enabled')::boolean,false)
    or not coalesce((context->>'learner')::boolean,false)
    or not private.participant_actor() then
    raise exception 'Active course participant required' using errcode='42501';
  end if;
  select min(session.starts_at) into first_start
  from public.course_sessions session where session.course_run_id=p_course_run_id;
  select exists (
    select 1 from public.course_enrolments enrolment
    where enrolment.course_run_id=p_course_run_id and enrolment.user_id=auth.uid()
      and enrolment.status='enrolled'
  ) into is_enrolled;
  return jsonb_build_object(
    'deadline_at',case when is_enrolled then first_start-interval '7 days' else null end,
    'can_withdraw',is_enrolled and coalesce(first_start>=statement_timestamp()+interval '7 days',false)
  );
end;
$$;

create function public.course_withdrawal_window(p_course_run_id uuid)
returns jsonb language sql stable security invoker set search_path=''
as $$select private.course_withdrawal_window(p_course_run_id);$$;
revoke all on function private.course_withdrawal_window(uuid),public.course_withdrawal_window(uuid)
  from public,anon,authenticated,service_role;
grant execute on function private.course_withdrawal_window(uuid),public.course_withdrawal_window(uuid) to authenticated;

alter function private.require_portal_access() rename to require_portal_access_before_course_withdrawal;
revoke all on function private.require_portal_access_before_course_withdrawal()
  from public,anon,authenticated,service_role;
create function private.require_portal_access()
returns void language plpgsql stable security definer set search_path='' as $$
begin
  if current_setting('role',true)='authenticated'
    and current_setting('request.path',true)='/rpc/course_withdrawal_window'
    and private.participant_actor() then return; end if;
  perform private.require_portal_access_before_course_withdrawal();
end;
$$;
revoke all on function private.require_portal_access() from public,anon,authenticated,service_role;
grant execute on function private.require_portal_access() to authenticated;
notify pgrst,'reload schema';
commit;
