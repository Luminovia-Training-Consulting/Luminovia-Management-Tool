begin;

-- job_discovery_candidates already materializes the actor's manager and
-- lecturer capabilities. Reuse those flags for each candidate instead of
-- rerunning the full can_read_job policy function for every row on every
-- cursor page. Keep the same manager and lecturer visibility rules.
do $migration$
declare
  definition text;
  old_check constant text := 'where private.can_read_job(job.id)';
begin
  definition := pg_catalog.pg_get_functiondef(
    'private.job_discovery_candidates(jsonb)'::regprocedure
  );
  if cardinality(string_to_array(definition, old_check)) <> 2 then
    raise exception 'Unexpected job discovery authorization check';
  end if;
  definition := replace(definition, old_check, $replacement$
    where (
      options.manager
      or (
        options.lecturer
        and not private.job_lecturer_blocked(job.id, options.actor)
        and (
          job.status = 'published'
          or exists (
            select 1 from public.job_claims own
            where own.job_id = job.id and own.lecturer_id = options.actor
          )
        )
      )
    )
  $replacement$);
  execute definition;
end;
$migration$;

commit;
