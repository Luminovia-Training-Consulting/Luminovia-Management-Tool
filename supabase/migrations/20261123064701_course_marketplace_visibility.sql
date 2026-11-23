begin;

-- In the internal portal, prospective lecturers use the teaching-offer
-- marketplace. Course rows can contain private delivery details.
do $migration$
declare
  definition text := pg_get_functiondef('private.can_read_course_run(uuid)'::regprocedure);
  preview constant text := '            run.published and run.archived_at is null';
begin
  if cardinality(string_to_array(definition, preview)) <> 2 then
    raise exception 'Expected existing course visibility branch';
  end if;
  execute replace(definition, preview,
    '            (select edition from private.installation_identity) <> ''internal''
            and run.published and run.archived_at is null');
end;
$migration$;

-- The company picker and its save path share this query. Keep legacy LMS
-- releases usable and let a new course enter the picker through its offer.
do $migration$
declare
  definition text := pg_get_functiondef('private.company_participant_upcoming_courses(uuid,uuid[],timestamptz)'::regprocedure);
  publication constant text := 'run.archived_at is null and run.published';
begin
  if cardinality(string_to_array(definition, publication)) <> 2 then
    raise exception 'Expected company course picker publication guard';
  end if;
  execute replace(definition, publication, $rule$run.archived_at is null
    and (run.published or exists (
      select from public.jobs offer where offer.course_run_id = run.id
        and offer.status in ('published', 'filled')
    ))$rule$);
end;
$migration$;

commit;
