-- Keep the already published migration bytes and retain the current function ACLs.
begin;

do $migration$
declare
  correction record;
  definition text;
begin
  for correction in
    select * from (values
      (1, 'private.course_weighted_gradebook_command(uuid,text,jsonb,integer)',
        $old$seen text[] := '{}';$old$, $new$seen text[] := array[]::text[];$new$),
      (2, 'private.valid_course_assignment_rubric(jsonb)',
        $old$criterion_labels text[] := '{}';$old$, $new$criterion_labels text[] := array[]::text[];$new$),
      (3, 'private.valid_course_assignment_rubric(jsonb)',
        $old$level_labels := '{}';$old$, $new$level_labels := array[]::text[];$new$),
      (4, 'private.deletion_scope_before_exam_time(text,uuid)',
        $old$participants text[] := '{}';$old$, $new$participants text[] := array[]::text[];$new$),
      (5, 'private.deletion_scope_before_completion_policies(text,uuid)',
        $old$filters text[] := '{}';$old$, $new$filters text[] := array[]::text[];$new$),
      (6, 'private.deletion_scope_before_weighted_policy(text,uuid)',
        $old$verification_filters text[] := '{}';$old$, $new$verification_filters text[] := array[]::text[];$new$),
      (7, 'private.create_crm_opportunity(uuid,text,numeric,text,uuid)',
        'select e.* into v_event', 'perform 1'),
      (8, 'private.create_crm_opportunity(uuid,text,numeric,text,uuid)',
        '  v_event public.crm_opportunity_events;' || chr(10), ''),
      (9, 'private.reuse_course_material(uuid,uuid,boolean)',
        'select document.id into document_id', 'perform 1'),
      (10, 'private.reuse_course_material(uuid,uuid,boolean)',
        '  document_id uuid;' || chr(10), '')
    ) as changes(position, signature, previous, replacement)
    order by position
  loop
    definition := pg_catalog.pg_get_functiondef(correction.signature::regprocedure);
    if cardinality(string_to_array(definition, correction.previous)) <> 2 then
      raise exception 'Expected a single lint correction in %', correction.signature;
    end if;
    execute replace(definition, correction.previous, correction.replacement);
  end loop;
end;
$migration$;

-- PostgreSQL marks JSON builders used by the normalizer stable.
alter function private.validated_bank_quiz_item(jsonb) stable;

commit;
