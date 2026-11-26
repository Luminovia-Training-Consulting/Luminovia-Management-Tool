-- Store structured teaching text inside the same immutable lesson revision.
begin;

create function private.course_lesson_blocks_valid(p_blocks jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
begin
  if jsonb_typeof(p_blocks) is distinct from 'array' then return false; end if;
  if jsonb_array_length(p_blocks) > 12 then return false; end if;
  if exists (
    select 1 from jsonb_array_elements(p_blocks) block(value)
    where jsonb_typeof(value) is distinct from 'object'
      or value - array['id','kind','title','text','answer'] <> '{}'::jsonb
      or jsonb_typeof(value->'id') is distinct from 'string'
      or (value->>'id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or jsonb_typeof(value->'kind') is distinct from 'string'
      or value->>'kind' not in ('note','practice','checklist')
      or jsonb_typeof(value->'title') is distinct from 'string'
      or char_length(value->>'title') > 120
      or jsonb_typeof(value->'text') is distinct from 'string'
      or char_length(value->>'text') > 4000
      or (value ? 'answer' and (value->>'kind' <> 'practice'
        or jsonb_typeof(value->'answer') is distinct from 'string'
        or char_length(value->>'answer') > 4000))
  ) then return false; end if;
  return (select count(distinct value->>'id') from jsonb_array_elements(p_blocks))
    = jsonb_array_length(p_blocks);
end;
$$;
revoke all on function private.course_lesson_blocks_valid(jsonb) from public, anon, service_role;
grant execute on function private.course_lesson_blocks_valid(jsonb) to authenticated;

do $migration$
declare
  validator text := pg_catalog.pg_get_functiondef('private.course_authoring_content_valid(jsonb)'::regprocedure);
  validation_anchor constant text := '      or not private.course_authoring_document_valid(lesson.value->''body'')';
  field_anchor constant text := '''body'', ''archived'', ''material_ids'')';
begin
  if cardinality(string_to_array(validator, validation_anchor)) <> 2
    or cardinality(string_to_array(validator, field_anchor)) <> 2 then
    raise exception 'Expected current course lesson validation';
  end if;
  validator := replace(validator, validation_anchor, $blocks$
      or (lesson.value ? 'blocks' and not private.course_lesson_blocks_valid(lesson.value->'blocks'))
$blocks$ || validation_anchor);
  execute replace(validator, field_anchor, '''body'', ''archived'', ''material_ids'', ''blocks'')');
end;
$migration$;

commit;
