begin;

-- Match the current read policy: verified subject scope, urgent language scope
-- and the precise rule for a lecturer's own historical claim.
do $migration$
declare
  definition text;
  predicate constant text := $old$and (
          visible_job.status = 'published' or exists (
            select 1 from public.job_claims claim
            where claim.job_id = visible_job.id and claim.lecturer_id = options.actor
          )
        )$old$;
begin
  definition := pg_catalog.pg_get_functiondef(
    'private.job_discovery_candidates(jsonb)'::regprocedure
  );
  if cardinality(string_to_array(definition, predicate)) <> 2 then
    raise exception 'Unexpected lecturer match predicate in discovery';
  end if;
  execute replace(definition, predicate, $new$and (
          (visible_job.status = 'published' and (
            (visible_job.urgent_reopened_at is not null and private.teaching_language_matches((
              select run.teaching_language from public.course_runs run
              where run.id = visible_job.course_run_id
            ), options.actor)) or private.job_subject_matches(visible_job.id, options.actor)
          )) or exists (
            select 1 from public.job_claims own
            where own.job_id = visible_job.id and own.lecturer_id = options.actor
              and (own.status = 'confirmed' or not exists (
                select 1 from public.job_claims active
                where active.job_id = visible_job.id and active.status = 'confirmed'
              ))
          )
        )$new$);
end;
$migration$;

commit;
