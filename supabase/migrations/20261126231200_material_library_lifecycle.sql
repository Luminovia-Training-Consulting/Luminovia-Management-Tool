-- Archive and master status apply to the catalogue entry. Established course
-- shares continue to use the exact scanned byte version and original audience.
begin;

do $migration$
declare
  write_definition text := pg_catalog.pg_get_functiondef(
    'private.set_course_material_metadata(uuid,integer,jsonb)'::regprocedure
  );
  search_definition text := pg_catalog.pg_get_functiondef(
    'private.search_course_materials(uuid,text,text,integer)'::regprocedure
  );
  reuse_definition text := pg_catalog.pg_get_functiondef(
    'private.reuse_course_material(uuid,uuid,boolean)'::regprocedure
  );
  keys constant text := '''learning_objectives'', ''review_on'', ''competencies'']';
  write_anchor constant text := '  if normalized = current_content then';
  category_validation constant text := 'p_category not in (''material'', ''report'')';
  category_where constant text := '(p_category is null or resource.category = p_category)';
  select_anchor constant text := 'as name,' || chr(10) || '        file_version.version, resource.category,';
  reuse_anchor constant text := 'if source_revision ? ''competencies'' then';
begin
  if cardinality(string_to_array(write_definition, keys)) <> 2
    or cardinality(string_to_array(write_definition, write_anchor)) <> 2
    or cardinality(string_to_array(search_definition, category_validation)) <> 2
    or cardinality(string_to_array(search_definition, category_where)) <> 2
    or cardinality(string_to_array(search_definition, select_anchor)) <> 2
    or cardinality(string_to_array(reuse_definition, reuse_anchor)) <> 2
    then raise exception 'Expected current course material lifecycle definitions'; end if;

  execute replace(replace(write_definition, keys,
    '''learning_objectives'', ''review_on'', ''competencies'', ''library_archived'', ''library_master'']'),
    write_anchor, $write$
  foreach field in array array['library_archived', 'library_master'] loop
    if p_metadata ? field then
      if jsonb_typeof(p_metadata->field) is distinct from 'boolean' then
        raise invalid_parameter_value;
      end if;
      if p_metadata->field = 'true'::jsonb then
        if field = 'library_master'
          and current_content->field is distinct from 'true'::jsonb
          and (private.course_material_reuse_source(resource.id)).id is null then
          raise insufficient_privilege;
        end if;
        normalized := normalized || jsonb_build_object(field, true);
      end if;
    elsif current_content->field = 'true'::jsonb then
      normalized := normalized || jsonb_build_object(field, true);
    end if;
  end loop;

$write$ || write_anchor);

  execute replace(replace(replace(search_definition, category_validation,
    'p_category not in (''material'', ''report'', ''archived'', ''master'')'),
    select_anchor, select_anchor || ' resource.audience,'),
    category_where, $filter$case
      when p_category in ('archived', 'master') then
        case when private.course_resource_allowed(resource.id) then
          (private.course_workspace_context(run.id)->>'staff')::boolean is true and (
            (p_category = 'archived' and metadata.content->'library_archived' = 'true'::jsonb)
            or (p_category = 'master' and metadata.content->'library_master' = 'true'::jsonb
              and metadata.content->'library_archived' is distinct from 'true'::jsonb)
          )
        else false end
      else metadata.content->'library_archived' is distinct from 'true'::jsonb
        and (p_category is null or resource.category = p_category)
    end$filter$);

  execute replace(reuse_definition, reuse_anchor,
    'source_revision := source_revision - array[''library_archived'', ''library_master''];'
      || chr(10) || '      ' || reuse_anchor);
end;
$migration$;

commit;
