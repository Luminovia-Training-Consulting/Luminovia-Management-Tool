begin;

-- job_discovery_candidates already materializes the actor's manager and
-- lecturer capabilities. Reuse those flags for each candidate instead of
-- rerunning the full can_read_job policy function for every row on every
-- cursor page. Keep the same manager and lecturer visibility rules.
do $migration$
declare
  definition text;
  scope_start integer;
  projection_end integer;
  projection text;
  old_projection constant text := 'select job.id, job.title,';
  new_projection constant text := 'select job.id, job.title, job.status,';
  old_check constant text := 'where private.can_read_job(job.id)';
begin
  definition := pg_catalog.pg_get_functiondef(
    'private.job_discovery_candidates(jsonb)'::regprocedure
  );
  scope_start := strpos(definition, 'jobs_in_scope as materialized');
  if scope_start = 0 then
    raise exception 'Unexpected job discovery scope projection';
  end if;
  projection_end := strpos(substring(definition from scope_start), 'from options');
  if projection_end = 0 then
    raise exception 'Unexpected job discovery scope projection';
  end if;
  projection := substring(definition from scope_start for projection_end);
  if strpos(projection, 'job.status') = 0 then
    if strpos(projection, old_projection) = 0 then
      raise exception 'Unexpected job discovery scope projection';
    end if;
    definition := overlay(
      definition placing new_projection from scope_start + strpos(projection, old_projection) - 1
      for char_length(old_projection)
    );
  end if;
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
