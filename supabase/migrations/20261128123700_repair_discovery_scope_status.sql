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
  status_projection constant text := 'select job.id, job.title, job.status,';
  full_projection constant text := 'select job.id, job.title, job.status, job.urgent_reopened_at, job.course_run_id,';
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
      definition placing full_projection from scope_start + strpos(projection, old_projection) - 1
      for char_length(old_projection)
    );
  elsif strpos(projection, 'job.urgent_reopened_at') = 0
    or strpos(projection, 'job.course_run_id') = 0 then
    if strpos(projection, status_projection) = 0 then
      raise exception 'Unexpected job discovery scope projection';
    end if;
    definition := overlay(
      definition placing full_projection from scope_start + strpos(projection, status_projection) - 1
      for char_length(status_projection)
    );
  else
    null;
  end if;
  execute definition;
end;
$migration$;

commit;
