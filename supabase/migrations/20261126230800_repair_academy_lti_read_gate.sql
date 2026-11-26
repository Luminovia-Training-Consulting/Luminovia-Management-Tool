begin;

do $migration$
declare
  gate text := pg_catalog.pg_get_functiondef('private.require_academy_course_access()'::regprocedure);
  broken constant text := $old$request_path = '/rpc/course_lti_tools', '/rpc/course_lti_ags_grades')$old$;
  corrected constant text := $new$request_path in ('/rpc/course_lti_tools', '/rpc/course_lti_ags_grades'))$new$;
begin
  if cardinality(string_to_array(gate, broken)) <> 2 then
    raise exception 'Expected a single LTI Academy read gate';
  end if;
  execute replace(gate, broken, corrected);
end;
$migration$;

commit;
