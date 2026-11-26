begin;

-- Copy matching competency references only. Course shares can reuse the same
-- clean file even if the target course uses a different framework.
do $migration$
declare
  reuse_definition text := pg_catalog.pg_get_functiondef(
    'private.reuse_course_material(uuid,uuid,boolean)'::regprocedure
  );
  anchor constant text := '      perform private.set_course_material_metadata(target_id, 0, source_revision);';
begin
  if cardinality(string_to_array(reuse_definition, anchor)) <> 2 then
    raise exception 'Expected a single material metadata copy';
  end if;
  execute replace(reuse_definition, anchor, $new$
      if source_revision ? 'competencies' then
        source_revision := source_revision || jsonb_build_object('competencies', (
          select coalesce(jsonb_agg(link.value order by link.ordinality), '[]'::jsonb)
          from jsonb_array_elements(source_revision->'competencies') with ordinality link(value, ordinality)
          where private.valid_material_competencies(p_target_run_id, jsonb_build_array(link.value), null)
        ));
      end if;
      perform private.set_course_material_metadata(target_id, 0, source_revision);$new$);
end;
$migration$;

commit;
