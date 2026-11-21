begin;

-- A stale submitted key version needs a new read. Keep genuine serialization
-- failures retryable and preserve the owning checks and transaction.
do $$
declare
  target regprocedure;
  definition text;
  old_conflict constant text := 'raise exception ''Integration key changed'' using errcode=''40001''';
  new_conflict constant text := 'raise exception ''Integration key changed'' using errcode=''PT409''';
begin
  foreach target in array array[
    'private.issue_company_integration_key(uuid,text,timestamptz,uuid,integer)'::regprocedure,
    'private.revoke_company_integration_key(uuid,integer)'::regprocedure
  ] loop
    definition := pg_catalog.pg_get_functiondef(target);
    if cardinality(string_to_array(definition, old_conflict)) <> 2 then
      raise exception 'Expected one integration key version conflict in %', target;
    end if;
    execute replace(definition, old_conflict, new_conflict);
  end loop;
end;
$$;

commit;
