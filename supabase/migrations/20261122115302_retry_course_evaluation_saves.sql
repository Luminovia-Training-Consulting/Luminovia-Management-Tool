begin;

-- Turn an exact replay of the last save into a receipt after the existing
-- current-role and completion checks and inside the same locked course scope.
do $migration$
declare
  definition text := pg_catalog.pg_get_functiondef(
    'private.save_course_evaluation(uuid,text,text,uuid,integer,integer,text)'::regprocedure
  );
  original constant text := $old$
  if not found then
    raise sqlstate 'PT409' using message = 'Evaluation changed. Reload the current evaluation.';
  end if;
  insert into private.course_evaluation_revisions(evaluation_id, version)
    values (saved.id, saved.version);$old$;
begin
  if cardinality(string_to_array(definition, original)) <> 2 then
    raise exception 'Expected one evaluation conflict and receipt write';
  end if;
  execute replace(definition, original, $new$
  if found then
    insert into private.course_evaluation_revisions(evaluation_id, version)
      values (saved.id, saved.version);
  else
    select * into saved from private.course_evaluations evaluation
    where evaluation.run_id = p_run_id and evaluation.user_id = actor_id
      and evaluation.rater_role = p_rater_role and evaluation.subject_kind = p_subject_kind
      and evaluation.subject_id = p_subject_id and evaluation.version = p_expected_version + 1
      and evaluation.score = p_score and evaluation.comment = normalized_comment;
    if not found then
      raise sqlstate 'PT409' using message = 'Evaluation changed. Reload the current evaluation.';
    end if;
  end if;$new$);
end;
$migration$;

commit;
