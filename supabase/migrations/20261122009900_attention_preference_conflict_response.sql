begin;

-- A stale expected version needs a fresh read rather than transaction retry.
do $$
declare
  definition text := pg_catalog.pg_get_functiondef(
    'private.save_attention_preferences(jsonb,integer)'::regprocedure
  );
  previous_error constant text := 'raise exception ''Preferences changed; reload before saving'' using errcode=''40001''';
  conflict_error constant text := 'raise exception ''Preferences changed; reload before saving'' using errcode=''PT409''';
begin
  if cardinality(string_to_array(definition, previous_error)) <> 2 then
    raise exception 'Expected one attention preference version conflict';
  end if;
  execute replace(definition, previous_error, conflict_error);
end;
$$;

commit;
