begin;

-- Prefer current management-confirmed delivery evidence. Approved time sheets
-- also cover older sessions that have no delivery record. Each session enters
-- the total through at most one path, and cancellations contribute no time.
create function private.lecturer_delivery_minutes(p_lecturer_id uuid)
returns bigint language sql stable set search_path = '' as $$
  select coalesce(sum(evidence.minutes), 0)
  from (
    select floor(extract(epoch from submission.actual_end - submission.actual_start) / 60)::integer
      - coalesce(sheet.break_minutes, 0) as minutes
    from public.assignment_sessions session
    join private.delivery_records record on record.session_id = session.id and record.status = 'confirmed'
    join private.delivery_submissions submission on submission.id = record.latest_submission_id
      and submission.session_id = session.id and submission.lecturer_id = session.lecturer_id
    left join private.teaching_timesheets sheet on sheet.session_id = session.id
      and sheet.lecturer_id = session.lecturer_id and sheet.state = 'approved'
      and sheet.starts_at = submission.actual_start and sheet.ends_at = submission.actual_end
    where session.lecturer_id = p_lecturer_id and submission.actual_end <= now()
    union all
    select floor(extract(epoch from sheet.ends_at - sheet.starts_at) / 60)::integer - sheet.break_minutes
    from private.teaching_timesheets sheet
    where sheet.lecturer_id = p_lecturer_id and sheet.state = 'approved' and sheet.ends_at <= now()
      and not exists (select 1 from private.delivery_records record where record.session_id = sheet.session_id)
  ) evidence
$$;

revoke all on function private.lecturer_delivery_minutes(uuid)
from public, anon, authenticated, service_role;

do $migration$
declare
  definition text := pg_get_functiondef('private.person_profile(uuid)'::regprocedure);
  marker constant text := $field$'teaching_experience', coalesce(d.teaching_experience, ''),$field$;
begin
  if cardinality(string_to_array(definition, marker)) <> 2 then
    raise exception 'Expected the authorized profile experience projection';
  end if;
  execute replace(definition, marker, marker || $minutes$
    'teaching_minutes', case when private.lecturer_user(p.id) then private.lecturer_delivery_minutes(p.id) end,$minutes$);
end;
$migration$;

create or replace function private.own_profile_details()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  details public.profile_details;
begin
  if not private.actor_active() then
    raise exception 'Active login required' using errcode = '42501';
  end if;
  select * into details from public.profile_details where user_id = auth.uid();
  return jsonb_build_object(
    'country', coalesce(details.country, ''),
    'languages', coalesce(details.languages, array[]::text[]),
    'teaching_experience', coalesce(details.teaching_experience, ''),
    'labels', coalesce(details.labels, array[]::text[]),
    'teaching_minutes', case when private.lecturer_user(auth.uid()) then private.lecturer_delivery_minutes(auth.uid()) end
  );
end;
$$;

commit;
