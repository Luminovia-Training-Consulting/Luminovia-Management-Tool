begin;

-- Authorising a report reader does not grant visibility to every historical
-- participant in that course. Apply the same current-organisation boundary as
-- the course workspace before sorting and pagination.
do $migration$
declare
  definition text := pg_get_functiondef(
    'private.academy_course_participation_report(uuid,uuid,integer)'::regprocedure
  );
  anchor constant text := $anchor$where enrolment.course_run_id=p_run_id and enrolment.status in ('enrolled','completed')
        and (p_after_user_id is null or enrolment.user_id>p_after_user_id)$anchor$;
  replacement constant text := $replacement$where enrolment.course_run_id=p_run_id and enrolment.status in ('enrolled','completed')
        and ((access->>'manager')::boolean
          or private.current_course_company_participant(p_run_id,enrolment.user_id))
        and (p_after_user_id is null or enrolment.user_id>p_after_user_id)$replacement$;
begin
  if cardinality(string_to_array(definition, anchor)) <> 2 then
    raise exception 'Unexpected Academy course participation report projection';
  end if;
  execute replace(definition, anchor, replacement);
end;
$migration$;

notify pgrst, 'reload schema';
commit;
