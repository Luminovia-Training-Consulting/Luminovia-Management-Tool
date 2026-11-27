begin;

-- A lecturer who sourced an emergency reopening must not see that offer.
do $migration$
declare
  definition text;
  predicate constant text := 'where visible_job.id = candidate.id and (';
begin
  definition := pg_catalog.pg_get_functiondef(
    'private.job_discovery_candidates(jsonb)'::regprocedure
  );
  if cardinality(string_to_array(definition, predicate)) <> 2 then
    raise exception 'Unexpected marketplace lecturer authorization scope';
  end if;
  execute replace(
    definition,
    predicate,
    $new$where visible_job.id = candidate.id
          and not (visible_job.urgent_reopened_at is not null
            and private.emergency_source_lecturer(visible_job.id, options.actor))
          and ($new$
  );
end;
$migration$;

commit;
