begin;

-- Reconcile historic duplicates without removing their text, terms, requests
-- or dependencies. Keep the newest created draft, with a stable tie-break.
lock table public.jobs in share row exclusive mode;
with ranked as (
  select id, row_number() over (
    partition by course_run_id order by created_at desc, id desc
  ) as position
  from public.jobs
  where course_run_id is not null and status = 'draft'
)
update public.jobs as job
set status = 'archived'
from ranked
where job.id = ranked.id and ranked.position > 1;

-- Flush deferred job/run consistency triggers before building the index.
set constraints all immediate;

create unique index jobs_one_course_draft_idx on public.jobs (course_run_id)
where course_run_id is not null and status = 'draft';

-- Let the existing run row lock serialize creation. Keep exact request retries
-- ahead of this check and report the editable draft before creating any rows.
do $migration$
declare
  definition text := pg_catalog.pg_get_functiondef('private.create_course_run_job(uuid,jsonb,numeric,uuid)'::regprocedure);
  run_check constant text := $old$ if not found then raise exception 'Course run unavailable' using errcode='22023';end if;$old$;
begin
  if cardinality(string_to_array(definition, run_check)) <> 2 then
    raise exception 'Expected one course run availability check';
  end if;
  execute replace(definition, run_check, run_check || $new$
 if exists(select 1 from public.jobs where course_run_id=r.id and status='draft') then
  raise exception 'course_run_draft_exists' using errcode='23505',
   detail=(select id::text from public.jobs where course_run_id=r.id and status='draft');
 end if;$new$);
end;
$migration$;

commit;
