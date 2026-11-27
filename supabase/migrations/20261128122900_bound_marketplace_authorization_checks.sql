begin;

-- Discovery entry points already validate an active actor and restrict access
-- to lecturers and job managers. Avoid repeating those permission RPCs once
-- for every matching offer while preserving the exact job visibility rule.
do $migration$
declare
  definition text;
  predicate constant text := $old$else private.can_read_job(candidate.id) end$old$;
begin
  definition := pg_catalog.pg_get_functiondef(
    'private.job_discovery_candidates(jsonb)'::regprocedure
  );
  if cardinality(string_to_array(definition, predicate)) <> 2 then
    raise exception 'Unexpected marketplace authorization predicate';
  end if;
  execute replace(definition, predicate, $new$else options.manager or (
      options.lecturer and exists (
        select 1 from public.jobs visible_job
        where visible_job.id = candidate.id and (
          visible_job.status = 'published' or exists (
            select 1 from public.job_claims claim
            where claim.job_id = visible_job.id and claim.lecturer_id = options.actor
          )
        )
      )
    ) end$new$);
end;
$migration$;

commit;
