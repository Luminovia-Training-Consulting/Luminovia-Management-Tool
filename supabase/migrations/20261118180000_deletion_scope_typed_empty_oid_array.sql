begin;

-- Preserve the reviewed owned-deletion graph and its grants. PostgreSQL
-- accepts the legacy unknown literal as oid[], but plpgsql_check reports a
-- type warning under the strict migration gate. Make the empty array explicit.
do $migration$
declare source text; old_decl text := 'processed oid[]:=''{}''';
begin
  source := pg_catalog.pg_get_functiondef('private.deletion_scope(text,uuid)'::regprocedure);
  if pg_catalog.strpos(source, old_decl) = 0 then
    raise exception 'Unexpected owned deletion scope definition';
  end if;
  execute pg_catalog.replace(source, old_decl, 'processed oid[]:=array[]::oid[]');
end;
$migration$;

commit;
