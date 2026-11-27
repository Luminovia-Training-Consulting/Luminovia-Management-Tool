begin;

-- Retain the existing ownership and grants on the intermediate scope helper.
-- Use an explicitly typed empty array for PL/pgSQL static analysis.
do $migration$
declare
  definition text := pg_get_functiondef('private.deletion_scope_before_removal_appeals(text,uuid)'::regprocedure);
  marker constant text := $old$selectors text[] := '{}';$old$;
begin
  if cardinality(string_to_array(definition, marker)) <> 2 then
    raise exception 'Expected the existing draft deletion selector initializer';
  end if;
  execute replace(definition, marker, 'selectors text[] := array[]::text[];');
end;
$migration$;

commit;
