begin;

-- Store the exact competency revision as catalogue metadata. A later
-- framework edit leaves an existing metadata revision readable.
create function private.valid_material_competencies(
  p_course uuid, p_links jsonb, p_previous jsonb
) returns boolean language plpgsql stable set search_path = '' as $$
declare
  allowed jsonb;
begin
  if jsonb_typeof(p_links) is distinct from 'array' then return false; end if;
  if jsonb_array_length(p_links) > 12 then return false; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', competency.value->>'id', 'code', trim(competency.value->>'code'),
    'title', trim(competency.value->>'title'),
    'framework_id', pin.framework_id, 'framework_revision', pin.framework_revision
  )), '[]'::jsonb) into allowed
  from (
    select * from private.lms_course_competency_pins entry
    where entry.run_id = p_course order by entry.revision desc limit 1
  ) pin
  join private.lms_competency_framework_revisions definition
    on (definition.framework_id, definition.revision) = (pin.framework_id, pin.framework_revision)
  cross join lateral jsonb_array_elements(definition.content->'competencies') competency(value);

  return not exists (
    select 1 from jsonb_array_elements(p_links) link(value)
    where not exists (
      select 1 from jsonb_array_elements(allowed || coalesce(p_previous, '[]'::jsonb)) valid(value)
      where valid.value = link.value
    )
  ) and not exists (
    select 1 from jsonb_array_elements(p_links) link(value)
    group by link.value->>'framework_id', link.value->>'id' having count(*) > 1
  );
end;
$$;
revoke all on function private.valid_material_competencies(uuid,jsonb,jsonb)
  from public, anon, authenticated, service_role;

do $migration$
declare
  write_definition text := pg_catalog.pg_get_functiondef(
    'private.set_course_material_metadata(uuid,integer,jsonb)'::regprocedure
  );
  search_definition text := pg_catalog.pg_get_functiondef(
    'private.search_course_materials(uuid,text,text,integer)'::regprocedure
  );
  keys constant text := '''learning_objectives'', ''review_on'']';
  write_anchor constant text := '  if normalized = current_content then';
  search_anchor constant text := $old$          or exists (select 1 from jsonb_array_elements_text(metadata.content->'tags')$old$;
begin
  if cardinality(string_to_array(write_definition, keys)) <> 2
    or cardinality(string_to_array(write_definition, write_anchor)) <> 2
    or cardinality(string_to_array(search_definition, search_anchor)) <> 2
    then raise exception 'Expected current course catalogue metadata and search'; end if;

  execute replace(replace(write_definition, keys, '''learning_objectives'', ''review_on'', ''competencies'']'),
    write_anchor, $new$  if p_metadata ? 'competencies' then
    if not private.valid_material_competencies(course_id, p_metadata->'competencies', current_content->'competencies')
      then raise invalid_parameter_value; end if;
    if p_metadata->'competencies' <> '[]'::jsonb then
      normalized := normalized || jsonb_build_object('competencies', p_metadata->'competencies');
    end if;
  elsif current_content ? 'competencies' then
    normalized := normalized || jsonb_build_object('competencies', current_content->'competencies');
  end if;
$new$ || write_anchor);
  execute replace(search_definition, search_anchor,
    $new$          or exists (select 1 from jsonb_array_elements(metadata.content->'competencies') as competency(value)
            where strpos(lower(competency.value->>'code'), needle) > 0
              or strpos(lower(competency.value->>'title'), needle) > 0)
$new$ || search_anchor);
end;
$migration$;

commit;
