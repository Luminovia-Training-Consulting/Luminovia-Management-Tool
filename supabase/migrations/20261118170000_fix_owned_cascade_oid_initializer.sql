begin;
-- Keep the ownership walk's visited-constraint array explicitly typed. The
-- uncast empty-string initializer works at runtime but triggers schema-lint's
-- type warning, which correctly blocks the complete Portal acceptance gate.
do $migration$
declare source text; patched text;
begin
 select pg_catalog.pg_get_functiondef('private.deletion_scope(text,uuid)'::regprocedure)
 into source;
 if strpos(source, $$processed oid[]:='{}';$$)=0 then
  raise exception 'Unexpected owned-cascade visited-array initializer';
 end if;
 patched:=replace(source,$$processed oid[]:='{}';$$,$$processed oid[]:='{}'::oid[];$$);
 if patched=source then raise exception 'Could not type owned-cascade visited array';end if;
 execute patched;
end$migration$;
notify pgrst,'reload schema';
commit;
