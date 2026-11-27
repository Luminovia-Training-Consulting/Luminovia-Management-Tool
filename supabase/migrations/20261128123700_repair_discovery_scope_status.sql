begin;

-- Older installations may have recorded the optimization before its status
-- projection was present. Repair only the jobs_in_scope SELECT projection.
do $migration$
declare
  definition text;
  scope_start integer;
  projection_end integer;
  projection text;
  old_projection constant text := 'select job.id, job.title,';
  new_projection constant text := 'select job.id, job.title, job.status,';
begin
  definition := pg_catalog.pg_get_functiondef(
    'private.job_discovery_candidates(jsonb)'::regprocedure
  );
  scope_start := strpos(definition, 'jobs_in_scope as materialized');
  projection_end := strpos(substring(definition from scope_start), 'from options');
  if scope_start = 0 or projection_end = 0 then
    raise exception 'Unexpected job discovery scope projection';
  end if;
  projection := substring(definition from scope_start for projection_end);
  if strpos(projection, 'job.status') > 0 then
    null;
  elsif strpos(projection, old_projection) > 0 then
    definition := overlay(
      definition placing new_projection from scope_start + strpos(projection, old_projection) - 1
      for char_length(old_projection)
    );
    execute definition;
  else
    raise exception 'Unexpected job discovery scope projection';
  end if;
end;
$migration$;

commit;
