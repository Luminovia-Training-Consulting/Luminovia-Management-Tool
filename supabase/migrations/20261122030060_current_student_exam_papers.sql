begin;

-- A newer explicit publication supersedes older learner-facing versions of
-- the same paper in this course. An unshared upload, a staff key or a different
-- paper does not supersede it. Withdrawing the replacement cannot restore an
-- older edition. All publication records and exact bytes stay available to
-- the editors authorised by the existing readers.
create function private.course_student_exam_paper_current(p_exam_id uuid)
returns boolean language sql stable security invoker set search_path = ''
as $$
  select exists (
    select 1
    from private.course_exam_documents paper
    join public.document_versions version on version.id = paper.version_id
    where paper.id = p_exam_id and paper.audience = 'students'
      and not exists (
        select 1
        from public.document_versions successor
        join private.course_exam_documents publication
          on publication.version_id = successor.id
         and publication.run_id = paper.run_id
         and publication.audience = 'students'
        where successor.document_id = version.document_id
          and successor.version > version.version
      )
  );
$$;

revoke all on function private.course_student_exam_paper_current(uuid)
  from public, anon, authenticated, service_role;

do $migration$
declare
  change record;
  definition text;
begin
  for change in select *
    from (values
      ('private.course_exams(uuid)'::regprocedure,
        $before$and version.mime_type = 'application/pdf' and document.deleted_at is null$before$,
        $after$and version.mime_type = 'application/pdf' and document.deleted_at is null
          and (editor or private.course_student_exam_paper_current(exam.id))$after$),
      ('private.course_exam_document_access(uuid)'::regprocedure,
        $before$(coalesce((context->>'learner')::boolean, false) and
        exists (select 1 from private.course_exam_settings setting$before$,
        $after$(coalesce((context->>'learner')::boolean, false) and
        private.course_student_exam_paper_current(exam.id) and
        exists (select 1 from private.course_exam_settings setting$after$),
      ('private.academy_student_exam_document_access(uuid)'::regprocedure,
        $before$(private.course_exam_editor(context) or (context->>'learner')::boolean)) then$before$,
        $after$(private.course_exam_editor(context) or
      ((context->>'learner')::boolean and private.course_student_exam_paper_current(selected.id)))) then$after$)
    ) as changes(target, previous, replacement)
  loop
    definition := pg_catalog.pg_get_functiondef(change.target);
    if cardinality(string_to_array(definition, change.previous)) <> 2 then
      raise exception 'Unexpected shared exam publication reader in %', change.target;
    end if;
    execute replace(definition, change.previous, change.replacement);
  end loop;
end;
$migration$;

notify pgrst, 'reload schema';
commit;
