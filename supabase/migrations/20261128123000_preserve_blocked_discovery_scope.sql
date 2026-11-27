begin;

-- Keep company-specific lecturer blocks in the optimized discovery predicate.
do $migration$
declare
  definition text;
  predicate constant text := 'options.lecturer and exists (';
begin
  definition := pg_catalog.pg_get_functiondef(
    'private.job_discovery_candidates(jsonb)'::regprocedure
  );
  if cardinality(string_to_array(definition, predicate)) <> 2 then
    raise exception 'Unexpected marketplace lecturer visibility predicate';
  end if;
  execute replace(
    definition,
    predicate,
    'options.lecturer and not private.job_lecturer_blocked(candidate.id, options.actor) and exists ('
  );
end;
$migration$;

commit;
