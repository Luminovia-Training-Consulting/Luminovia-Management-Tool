begin;

-- The bounded authorization predicate reuses the job status. Add it to the
-- candidate scope projection for databases where the authorization migration
-- was already applied; fresh installations may already include this field.
do $migration$
declare
  definition text;
  old_projection constant text := 'select job.id, job.title,';
  new_projection constant text := 'select job.id, job.title, job.status,';
begin
  definition := pg_catalog.pg_get_functiondef(
    'private.job_discovery_candidates(jsonb)'::regprocedure
  );
  if cardinality(string_to_array(definition, new_projection)) = 2 then
    null;
  elsif cardinality(string_to_array(definition, old_projection)) = 2 then
    definition := replace(definition, old_projection, new_projection);
    execute definition;
  else
    raise exception 'Unexpected job discovery scope projection';
  end if;
end;
$migration$;

commit;
