begin;

alter table private.lms_competency_frameworks add column archived boolean not null default false;
alter table private.lms_competency_decisions add column text_exam_evidence jsonb
  check (text_exam_evidence is null or jsonb_typeof(text_exam_evidence) = 'object');

-- A released mark can be cited without exposing the exam answers or feedback.
create function private.competency_text_exam_evidence(p_run uuid, p_learner uuid)
returns jsonb language sql stable strict set search_path = '' as $$
  select jsonb_build_object(
    'exam_revision', exam.revision, 'review_revision', assessment.revision,
    'title', exam.title, 'score', points.result->'score', 'max_points', points.result->'max_points'
  )
  from private.course_text_exam_versions exam
  join private.course_text_exam_reviews assessment
    on (assessment.run_id, assessment.exam_revision, assessment.learner_id)
      = (exam.run_id, exam.revision, p_learner)
  cross join lateral (select private.course_text_exam_review_payload(assessment, exam) result) points
  where exam.run_id = p_run and exam.published_at is not null and assessment.released_at is not null
  order by exam.revision desc, assessment.revision desc limit 1;
$$;

-- An archived head remains available to existing pins and decision history.
create function private.set_competency_framework_archived(p_company uuid, p_data jsonb, p_expected integer)
returns jsonb language plpgsql set search_path = '' as $$
declare
  head private.lms_competency_frameworks;
  requested boolean;
  next_revision integer;
begin
  if jsonb_typeof(p_data->'id') is distinct from 'string'
    or jsonb_typeof(p_data->'archived') is distinct from 'boolean'
    or p_data - array['id','archived'] <> '{}'::jsonb
    or p_expected < 1 then raise invalid_parameter_value; end if;
  requested := (p_data->>'archived')::boolean;
  select * into head from private.lms_competency_frameworks
    where id = (p_data->>'id')::uuid and organisation_id = p_company for update;
  if not found then raise insufficient_privilege; end if;
  if head.archived = requested and head.revision in (p_expected, p_expected + 1) then
    return jsonb_build_object('id',head.id,'revision',head.revision);
  end if;
  if head.revision <> p_expected then
    raise exception 'Framework revision changed' using errcode = 'PT409';
  end if;
  next_revision := head.revision + 1;
  insert into private.lms_competency_framework_revisions(framework_id,revision,content,created_by)
    select head.id,next_revision,version.content,auth.uid()
    from private.lms_competency_framework_revisions version
    where version.framework_id = head.id and version.revision = head.revision;
  update private.lms_competency_frameworks set archived = requested, revision = next_revision where id = head.id;
  insert into public.audit_events(actor_id,action,resource_id,details)
    values(auth.uid(), 'competency.framework_archive_changed', head.id,
      jsonb_build_object('archived',requested,'revision',next_revision));
  return jsonb_build_object('id',head.id,'revision',next_revision);
end;
$$;

revoke all on function private.competency_text_exam_evidence(uuid,uuid),
  private.set_competency_framework_archived(uuid,jsonb,integer)
  from public, anon, authenticated, service_role;

do $migration$
declare
  correction record;
  definition text;
begin
  for correction in select * from (values
    (1, 'private.course_competencies(uuid,uuid,integer)',
      $old$'id', head.id, 'revision', head.revision, 'content', definition.content)$old$,
      $new$'id', head.id, 'revision', head.revision, 'content', definition.content, 'archived', head.archived)$new$),
    (2, 'private.course_competencies(uuid,uuid,integer)',
      'decision.created_at, decision.assignment_evidence,',
      'decision.created_at, decision.assignment_evidence, decision.text_exam_evidence,'),
    (3, 'private.course_competencies(uuid,uuid,integer)',
      $old$    'assignment_options', assignment_evidence,$old$,
      $new$    'assignment_options', assignment_evidence,
    'text_exam_option', case when staff and writable and subject is not null and pinned_framework is not null
      then private.competency_text_exam_evidence(p_run_id, subject) end,$new$),
    (4, 'private.save_lms_competency_framework(uuid,jsonb,integer)',
      'and head.organisation_id = p_org_id for update;',
      'and head.organisation_id = p_org_id and not head.archived for update;'),
    (5, 'private.course_competency_action(uuid,text,jsonb,integer)',
      $old$  assignment_snapshot jsonb;$old$,
      $new$  assignment_snapshot jsonb;
  requested_exam jsonb := p_payload->'text_exam_evidence';
  exam_snapshot jsonb;$new$),
    (6, 'private.course_competency_action(uuid,text,jsonb,integer)',
      $old$not in ('save_framework','pin','assess')$old$,
      $new$not in ('save_framework','archive_framework','pin','assess')$new$),
    (7, 'private.course_competency_action(uuid,text,jsonb,integer)',
      $old$  select * into current_pin from private.lms_course_competency_pins$old$,
      $new$  if p_action = 'archive_framework' then
    return private.set_competency_framework_archived(company_id,p_payload,p_expected_revision);
  end if;
  select * into current_pin from private.lms_course_competency_pins$new$),
    (8, 'private.course_competency_action(uuid,text,jsonb,integer)',
      $old$and organisation_id = company_id for share;$old$,
      $new$and organisation_id = company_id and not archived for share;$new$),
    (9, 'private.course_competency_action(uuid,text,jsonb,integer)',
      $old$'include_quiz','assignment_evidence']$old$,
      $new$'include_quiz','assignment_evidence','text_exam_evidence']$new$),
    (10, 'private.course_competency_action(uuid,text,jsonb,integer)',
      $old$  select * into previous_decision from private.lms_competency_decisions$old$,
      $new$  if requested_exam is not null then
    if jsonb_typeof(requested_exam) <> 'object'
      or jsonb_typeof(requested_exam->'exam_revision') is distinct from 'number'
      or jsonb_typeof(requested_exam->'review_revision') is distinct from 'number'
      or requested_exam - array['exam_revision','review_revision'] <> '{}'::jsonb
      then raise invalid_parameter_value; end if;
    exam_snapshot := private.competency_text_exam_evidence(p_run_id, subject);
    if exam_snapshot is null
      or (exam_snapshot - array['title','score','max_points']) is distinct from requested_exam then
      raise exception 'Released text examination evidence changed' using errcode = 'PT409';
    end if;
  end if;
  select * into previous_decision from private.lms_competency_decisions$new$),
    (11, 'private.course_competency_action(uuid,text,jsonb,integer)',
      'previous_decision.assignment_evidence)', 'previous_decision.assignment_evidence, previous_decision.text_exam_evidence)'),
    (12, 'private.course_competency_action(uuid,text,jsonb,integer)',
      '(target_level_id, note, evidence, assignment_snapshot)', '(target_level_id, note, evidence, assignment_snapshot, exam_snapshot)'),
    (13, 'private.course_competency_action(uuid,text,jsonb,integer)',
      'created_by, assignment_evidence)', 'created_by, assignment_evidence, text_exam_evidence)'),
    (14, 'private.course_competency_action(uuid,text,jsonb,integer)',
      'note, evidence, actor_id, assignment_snapshot)', 'note, evidence, actor_id, assignment_snapshot, exam_snapshot)')
  ) as changes(position, signature, previous, replacement) order by position
  loop
    definition := pg_catalog.pg_get_functiondef(correction.signature::regprocedure);
    if cardinality(string_to_array(definition, correction.previous)) <> 2 then
      raise exception 'Expected a single competency lifecycle change in % at %', correction.signature, correction.position;
    end if;
    execute replace(definition, correction.previous, correction.replacement);
  end loop;
end;
$migration$;

commit;
