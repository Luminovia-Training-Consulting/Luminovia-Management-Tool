begin;

-- The internal "attendance" document still accepts a course-run ID.
-- Use an explicit kind for an exact session, through the same authorised
-- register and redacted report already used by the dedicated editions.
do $migration$
declare
  definition text := pg_catalog.pg_get_functiondef('private.course_document_access(text,uuid)'::regprocedure);
  anchor constant text := '  if p_kind = ''exam'' then';
begin
  if cardinality(string_to_array(definition, anchor)) <> 2 then
    raise exception 'Expected one course document resolver entry';
  end if;
  execute replace(definition, anchor, $fragment$  if p_kind = 'attendance_session' and not dedicated then
    return private.academy_attendance_report(p_id);
  end if;
$fragment$ || anchor);
end;
$migration$;

notify pgrst, 'reload schema';
commit;
