begin;

alter function private.valid_weighted_grade_categories(jsonb) stable;

do $migration$
declare
  correction record;
  definition text;
begin
  for correction in
    select * from (values
      ('private.lti_issue_service_token(uuid,integer,text,timestamptz,text[])', $old$allowed text[] := '{}';$old$, $new$allowed text[] := array[]::text[];$new$),
      ('private.import_course_text_exam_reviews(private.course_text_exam_versions,jsonb)', $old$seen uuid[] := '{}';$old$, $new$seen uuid[] := array[]::uuid[];$new$)
    ) as changes(signature, previous, replacement)
  loop
    definition := pg_catalog.pg_get_functiondef(correction.signature::regprocedure);
    if cardinality(string_to_array(definition, correction.previous)) <> 2 then
      raise exception 'Expected an exact lint correction in %', correction.signature;
    end if;
    execute replace(definition, correction.previous, correction.replacement);
  end loop;
end;
$migration$;

commit;
