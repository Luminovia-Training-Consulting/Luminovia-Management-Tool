begin;
-- Released migrations are immutable. Correct the empty-array initializer in the
-- current deletion-scope implementation so PostgreSQL infers oid[] directly.
do $migration$
declare source text; patched text;
begin
 select pg_catalog.pg_get_functiondef(
   'private.deletion_scope(text,uuid)'::regprocedure
 ) into source;
 patched:=replace(
   source,
   $needle$processed oid[]:='{}'$needle$,
   $replacement$processed oid[]:=array[]::oid[]$replacement$
 );
 if patched=source then
   raise exception 'Expected owned-deletion empty oid[] initializer was not found';
 end if;
 execute patched;
end;
$migration$;
commit;
