-- An exam may require a second current staff member to release a marked attempt.
begin;

alter table private.course_text_exam_versions
  add column second_reviewer_required boolean not null default false;
alter table private.course_text_exam_reviews
  add column assessed_by uuid references public.profiles(id) on delete set null,
  add column released_by uuid references public.profiles(id) on delete set null;

do $migration$
declare
  reader text := pg_catalog.pg_get_functiondef('private.course_text_exam(uuid,integer,uuid,integer)'::regprocedure);
  author text := pg_catalog.pg_get_functiondef('private.course_text_exam_author(uuid,text,integer,jsonb)'::regprocedure);
  grade text := pg_catalog.pg_get_functiondef('private.course_text_exam_grade(private.course_text_exam_versions,text,integer,jsonb)'::regprocedure);
  paper_anchor constant text := '''deadline'', deadline, ''pass_percent'', exam.pass_percent,';
  review_anchor constant text := '''review'', private.course_text_exam_review_payload(review, exam)';
  author_fields constant text := 'array[''title'',''opens_at'',''closes_at'',''pass_percent'',''questions'']';
  author_compare constant text := 'and head.questions = validated_questions';
  author_insert constant text := 'opens_at, closes_at, pass_percent, questions)';
  author_values constant text := 'threshold, validated_questions);';
  author_threshold constant text := '  threshold integer;';
  grade_columns constant text := 'learner_id, revision, points, feedback)';
  grade_values constant text := 'p_payload->''points'', p_payload->>''feedback'');';
  release_anchor constant text := '    update private.course_text_exam_reviews set released_at = clock_timestamp()';
begin
  if cardinality(string_to_array(reader, paper_anchor)) <> 2
    or cardinality(string_to_array(reader, review_anchor)) <> 2
    or cardinality(string_to_array(author, author_fields)) <> 2
    or cardinality(string_to_array(author, author_compare)) <> 2
    or cardinality(string_to_array(author, author_insert)) <> 2
    or cardinality(string_to_array(author, author_values)) <> 2
    or cardinality(string_to_array(author, author_threshold)) <> 2
    or cardinality(string_to_array(grade, grade_columns)) <> 2
    or cardinality(string_to_array(grade, grade_values)) <> 2
    or cardinality(string_to_array(grade, release_anchor)) <> 2
    then raise exception 'Expected native text examination author and grading commands'; end if;

  reader := replace(reader, paper_anchor, paper_anchor ||
    ' ''second_reviewer_required'', exam.second_reviewer_required,');
  execute replace(reader, review_anchor, review_anchor || $review$
      || case when staff then jsonb_build_object('can_release',
        writable and (not exam.second_reviewer_required or review.assessed_by is distinct from who))
        else '{}'::jsonb end
$review$);
  author := replace(author, author_threshold, author_threshold || '  second_reviewer boolean;');
  author := replace(author, author_fields, $flags$
    array['title','opens_at','closes_at','pass_percent','questions','second_reviewer_required']
$flags$);
  author := replace(author, '    opens := (p_payload->>''opens_at'')::timestamptz;', $value$
    if p_payload ? 'second_reviewer_required' and jsonb_typeof(p_payload->'second_reviewer_required') is distinct from 'boolean'
      then raise invalid_parameter_value; end if;
    second_reviewer := coalesce((p_payload->>'second_reviewer_required')::boolean, head.second_reviewer_required, false);
    opens := (p_payload->>'opens_at')::timestamptz;
$value$);
  author := replace(author, author_compare, author_compare || ' and head.second_reviewer_required = second_reviewer');
  author := replace(author, author_insert, 'opens_at, closes_at, pass_percent, questions, second_reviewer_required)');
  execute replace(author, author_values, 'threshold, validated_questions, second_reviewer);');
  grade := replace(grade, grade_columns, 'learner_id, revision, points, feedback, assessed_by)');
  grade := replace(grade, grade_values, 'p_payload->''points'', p_payload->>''feedback'', auth.uid());');
  execute replace(grade, release_anchor, $release$
    if p_exam.second_reviewer_required and head.assessed_by is not distinct from auth.uid() then
      raise exception 'A second current staff member must release this assessment' using errcode = '42501';
    end if;
    update private.course_text_exam_reviews set released_at = clock_timestamp(), released_by = auth.uid()
$release$);
end;
$migration$;

commit;
