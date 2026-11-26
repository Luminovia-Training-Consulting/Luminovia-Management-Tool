begin;

-- Course access authorises the reader, not every historical person recorded
-- in the course. Check the subject's own current company relationship too.
create function private.current_course_company_participant(p_run_id uuid, p_user_id uuid)
returns boolean language sql stable set search_path = '' as $$
  select exists (
    select from public.course_runs r where r.id = p_run_id
      and private.active_company_participant(p_user_id, r.organisation_id)
  );
$$;
revoke all on function private.current_course_company_participant(uuid, uuid)
from public, anon, authenticated, service_role;

do $migration$
declare
  rule record;
  definition text;
begin
  for rule in select * from (values
    ('private.course_enrolments(uuid)',
      'where enrolment.course_run_id = p_course_run_id',
      $new$where enrolment.course_run_id = p_course_run_id
      and ((context->>'manager')::boolean
        or private.current_course_company_participant(p_course_run_id, enrolment.user_id))$new$),
    ('private.course_workspace_before_premium(uuid)',
      $old$e.course_run_id=r.id and e.status in('enrolled','completed')$old$,
      $new$e.course_run_id=r.id and e.status in('enrolled','completed')
    and ((c->>'manager')::boolean or private.current_course_company_participant(r.id, e.user_id))$new$),
    ('private.course_document_access_before_premium(text,uuid)',
      $old$if record.user_id<>auth.uid() and not(c->>'staff')::boolean and not(c->>'client')::boolean then$old$,
      $new$if record.user_id <> auth.uid() and not (
    (c->>'manager')::boolean or (
      ((c->>'staff')::boolean or (c->>'client')::boolean)
      and private.current_course_company_participant(record.run_id, record.user_id)
      and exists (select from public.course_enrolments e where e.course_run_id = record.run_id
        and e.user_id = record.user_id and e.status in ('enrolled', 'completed'))
    )) then$new$),
    ('private.course_attendance_summary(uuid,uuid)',
      $old$where enrolment.status in ('enrolled','completed')$old$,
      $new$where enrolment.status in ('enrolled','completed')
        and ((context->>'manager')::boolean or private.current_course_company_participant(run.id, enrolment.user_id))$new$),
    ('private.course_attendance_summary(uuid,uuid)',
      'join scoped_runs run on run.id = enrolment.course_run_id' || chr(10) || '      join public.course_sessions',
      $new$join scoped_runs run on run.id = enrolment.course_run_id
        and ((context->>'manager')::boolean or private.current_course_company_participant(run.id, enrolment.user_id))
      join public.course_sessions$new$),
    ('private.course_session_register(uuid,uuid)',
      $old$where enrolment.course_run_id=p_run_id and enrolment.status in ('enrolled','completed')$old$,
      $new$where enrolment.course_run_id=p_run_id and enrolment.status in ('enrolled','completed')
        and ((context->>'manager')::boolean or private.current_course_company_participant(p_run_id, enrolment.user_id))$new$),
    ('private.course_session_register(uuid,uuid)',
      'where audit.session_id=session_row.id',
      $new$where audit.session_id=session_row.id
        and ((context->>'manager')::boolean or private.current_course_company_participant(p_run_id, audit.user_id))$new$),
    ('private.save_course_session_attendance_before_premium_lock(uuid,uuid,uuid,text,timestamptz,timestamptz,text,text,integer)',
      'if not found or session_row.starts_at>now() or',
      $new$if not found or session_row.starts_at>now()
     or (not (context->>'manager')::boolean and not private.current_course_company_participant(p_run_id, p_user_id)) or$new$)
  ) as rules(signature, old_text, new_text)
  loop
    definition := pg_get_functiondef(rule.signature::regprocedure);
    if cardinality(string_to_array(definition, rule.old_text)) <> 2 then
      raise exception 'Unexpected course participant projection: %', rule.signature;
    end if;
    execute replace(definition, rule.old_text, rule.new_text);
  end loop;
end;
$migration$;

commit;