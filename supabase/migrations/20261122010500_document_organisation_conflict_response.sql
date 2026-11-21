begin;

-- A stale reviewed annotation requires a fresh read. Preserve actual
-- serialization failures and all current document and caller checks.
do $$
declare
  definition text := pg_catalog.pg_get_functiondef(
    'private.save_document_organisation(uuid,jsonb,integer)'::regprocedure
  );
  previous_error constant text := 'raise exception ''Personal organisation changed; reload'' using errcode=''40001''';
  conflict_error constant text := 'raise exception ''Personal organisation changed; reload'' using errcode=''PT409''';
begin
  if cardinality(string_to_array(definition, previous_error)) <> 2 then
    raise exception 'Expected one document organisation version conflict';
  end if;
  execute replace(definition, previous_error, conflict_error);
end;
$$;

commit;
