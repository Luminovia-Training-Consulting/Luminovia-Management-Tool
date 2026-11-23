begin;

-- Keep the dynamically patched course editor warning-free under strict
-- plpgsql_check: an empty array literal needs the destination type explicitly.
do $migration$
declare
  definition text := pg_get_functiondef('private.save_course_run(uuid,jsonb)'::regprocedure);
  previous constant text := $old$session_ranges tstzrange[] := '{}';$old$;
begin
  if cardinality(string_to_array(definition, previous)) <> 2 then
    raise exception 'Expected untyped session range initializer';
  end if;

  execute replace(definition, previous,
    $new$session_ranges tstzrange[] := '{}'::tstzrange[];$new$);
end;
$migration$;

commit;
