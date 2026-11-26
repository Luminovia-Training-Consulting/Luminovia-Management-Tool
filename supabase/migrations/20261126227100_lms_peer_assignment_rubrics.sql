-- Use published assignment criteria as qualitative peer review guidance.
begin;

alter table private.lms_peer_rounds add column assignment_rubric jsonb;

do $migration$
declare
  reader text := pg_catalog.pg_get_functiondef('private.course_peer_feedback(uuid,integer)'::regprocedure);
  writer text := pg_catalog.pg_get_functiondef('private.course_peer_feedback_action(uuid,text,jsonb)'::regprocedure);
  read_anchor constant text := '''round_number'', round.round_number, ''rounds'', rounds,';
  write_declare constant text := '  feedback_body text;';
  open_anchor constant text := '    insert into private.lms_peer_rounds(run_id, round_number, prompt) values (p_run_id, target_round, btrim(p_payload->>''body''));';
  allowed constant text := '    if p_payload - ''body'' <> ''{}''::jsonb' || chr(10);
begin
  if cardinality(string_to_array(reader, read_anchor)) <> 2
    or cardinality(string_to_array(writer, write_declare)) <> 2
    or cardinality(string_to_array(writer, open_anchor)) <> 2
    or cardinality(string_to_array(writer, allowed)) <> 2
    then raise exception 'Expected the peer round projection and opening command'; end if;

  execute replace(reader, read_anchor, read_anchor || $reader$
    'assignment_rubric', round.assignment_rubric,
    'available_assignments', case when staff and writable then (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', assignment.id, 'title', definition.title, 'version', definition.version
      ) order by definition.title, assignment.id), '[]'::jsonb)
      from private.course_assignments assignment
      join private.course_assignment_definitions definition on
        definition.assignment_id = assignment.id and definition.version = assignment.published_version
      where assignment.run_id = p_run_id
    ) else '[]'::jsonb end,
$reader$);

  -- Only the open action can carry an assignment selection.
  writer := replace(writer, allowed,
    '    if p_payload - array[''body'',''assignment_id'',''assignment_version''] <> ''{}''::jsonb' || chr(10));
  execute replace(replace(writer, write_declare, write_declare || '
  rubric_snapshot jsonb;'), open_anchor, $writer$
    if p_payload ?| array['assignment_id','assignment_version'] then
      if jsonb_typeof(p_payload->'assignment_id') is distinct from 'string'
        or jsonb_typeof(p_payload->'assignment_version') is distinct from 'number'
        or (p_payload->>'assignment_version') !~ '^[1-9][0-9]{0,8}$'
        then raise invalid_parameter_value; end if;
      select jsonb_build_object(
        'title', definition.title, 'version', definition.version, 'criteria',
        (select jsonb_agg(criterion.value->>'label' order by criterion.ordinality)
          from jsonb_array_elements(definition.rubric) with ordinality as criterion)
      ) into rubric_snapshot
      from private.course_assignments assignment
      join private.course_assignment_definitions definition on
        definition.assignment_id = assignment.id and definition.version = assignment.published_version
      where assignment.run_id = p_run_id and assignment.id = (p_payload->>'assignment_id')::uuid
        and definition.version = (p_payload->>'assignment_version')::integer
      for share of assignment;
      if not found then
        raise exception 'Published assignment changed' using errcode = 'PT409';
      end if;
    end if;
    insert into private.lms_peer_rounds(run_id, round_number, prompt, assignment_rubric)
      values (p_run_id, target_round, btrim(p_payload->>'body'), rubric_snapshot);
$writer$);
end;
$migration$;

commit;
