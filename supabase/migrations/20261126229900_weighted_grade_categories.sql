begin;

-- Category labels and relationships belong to the reviewed policy version.
alter table private.course_weighted_policies
  add column categories jsonb not null default '[]'::jsonb
  check (jsonb_typeof(categories) = 'array' and jsonb_array_length(categories) <= 15);

create function private.valid_weighted_grade_categories(p_categories jsonb)
returns boolean language plpgsql immutable strict set search_path = '' as $$
declare
  category jsonb;
  known jsonb := '{}'::jsonb;
  category_id text;
  parent_id text;
  depth integer;
begin
  if jsonb_typeof(p_categories) <> 'array' then return false; end if;
  if jsonb_array_length(p_categories) > 15 then return false; end if;
  for category in select value from jsonb_array_elements(p_categories) loop
    category_id := category->>'id';
    parent_id := category->>'parent_id';
    if jsonb_typeof(category) <> 'object'
      or category - array['id','label','parent_id'] <> '{}'::jsonb
      or jsonb_typeof(category->'id') is distinct from 'string'
      or category_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or jsonb_typeof(category->'label') is distinct from 'string'
      or length(btrim(category->>'label')) not between 1 and 80
      or coalesce(jsonb_typeof(category->'parent_id'), 'null') not in ('null','string')
      or known ? category_id
      or (parent_id is not null and not (known ? parent_id))
      then return false; end if;
    depth := coalesce((known->>parent_id)::integer, 0) + 1;
    if depth > 3 then return false; end if;
    known := known || jsonb_build_object(category_id, depth);
  end loop;
  return true;
end;
$$;
revoke all on function private.valid_weighted_grade_categories(jsonb)
  from public, anon, authenticated, service_role;

-- Keep earlier policies and pending reviews valid. An ungrouped policy produces
-- its original snapshot, while a grouped policy freezes the names and tree.
do $migration$
declare
  correction record;
  definition text;
begin
  for correction in
    select * from (values
      (1, 'private.course_weighted_gradebook_command(uuid,text,jsonb,integer)',
        '  items jsonb :=', '  categories jsonb;' || chr(10) || '  items jsonb :='),
      (2, 'private.course_weighted_gradebook_command(uuid,text,jsonb,integer)',
        $old$  if p_action = 'policy' then
    if p_payload - array['items','threshold','missing_required','separate_reviewer'] <> '{}'::jsonb$old$,
        $new$  if p_action = 'policy' then
    categories := coalesce(p_payload->'categories', '[]'::jsonb);
    if not private.valid_weighted_grade_categories(categories)
      or p_payload - array['items','threshold','missing_required','separate_reviewer','categories'] <> '{}'::jsonb$new$),
      (3, 'private.course_weighted_gradebook_command(uuid,text,jsonb,integer)',
        $old$item - array['key','weight','treatment'] <> '{}'::jsonb$old$,
        $new$item - array['key','weight','treatment','category_id'] <> '{}'::jsonb
        or coalesce(jsonb_typeof(item->'category_id'), 'null') not in ('null','string')
        or (item->>'category_id' is not null
          and not (categories @> jsonb_build_array(jsonb_build_object('id',item->>'category_id'))))$new$),
      (4, 'private.course_weighted_gradebook_command(uuid,text,jsonb,integer)',
        'separate_reviewer,items,created_by)', 'separate_reviewer,items,created_by,categories)'),
      (5, 'private.course_weighted_gradebook_command(uuid,text,jsonb,integer)',
        '::boolean,items,auth.uid());', '::boolean,items,auth.uid(),categories);'),
      (6, 'private.course_weighted_snapshot(private.course_weighted_policies,uuid)',
        $old$'passed', final >= p_policy.threshold, 'basis', basis
  );$old$,
        $new$'passed', final >= p_policy.threshold, 'basis', basis
  ) || case when p_policy.categories = '[]'::jsonb then '{}'::jsonb
    else jsonb_build_object('categories', p_policy.categories) end;$new$)
    ) as changes(position, signature, previous, replacement)
    order by position
  loop
    definition := pg_catalog.pg_get_functiondef(correction.signature::regprocedure);
    if cardinality(string_to_array(definition, correction.previous)) <> 2 then
      raise exception 'Expected a single category change in % at %', correction.signature, correction.position;
    end if;
    execute replace(definition, correction.previous, correction.replacement);
  end loop;
end;
$migration$;

commit;
