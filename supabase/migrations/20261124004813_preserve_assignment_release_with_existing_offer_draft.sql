begin;

-- Releasing a claim must never need the only draft slot on the course.
-- Preserve an archived offer, and use the ordinary reopening eligibility
-- when a concurrent draft makes the intermediate draft status unavailable.
do $migration$
declare
  definition text := pg_get_functiondef('private.cancel_job_assignment_before_chat_origins(uuid,text,uuid)'::regprocedure);
  transition constant text := 'update public.jobs set status=''draft'' where id=j.id;';
begin
  if cardinality(string_to_array(definition, transition)) <> 2 then
    raise exception 'Expected one cancellation status transition';
  end if;
  execute replace(definition, transition, $replacement$
 declare
  failed_constraint text;
 begin
  update public.jobs set status = case when j.status = 'archived' then 'archived' else 'draft' end
   where id = j.id;
 exception when unique_violation then
  get stacked diagnostics failed_constraint = constraint_name;
  if failed_constraint is distinct from 'jobs_one_course_draft_idx' then raise; end if;
  update public.jobs
   set status = case
    when (select edition from private.installation_identity) = 'internal'
      and exists (select from private.matching_job_lecturers(j.id))
    then 'published'
    else 'archived'
   end
   where id = j.id;
 end;$replacement$);
end;
$migration$;

commit;
