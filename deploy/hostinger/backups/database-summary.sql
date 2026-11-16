-- Read-only recovery inventory of actual table counts, RLS, ACLs, functions and database settings; do not report sensitive row contents.
select json_build_object(
 'database',current_database(),
 'server_version',current_setting('server_version'),
 'database_settings',(select json_build_object('owner',pg_get_userbyid(datdba),'acl',datacl::text,'connection_limit',datconnlimit,'template',datistemplate,'collation',datcollversion,'comment',obj_description(oid,'pg_database'),'settings',(select coalesce(json_agg(json_build_object('role',case when setrole=0 then null else pg_get_userbyid(setrole) end,'values',setconfig) order by case when setrole=0 then null else pg_get_userbyid(setrole) end nulls first),'[]'::json) from pg_db_role_setting where setdatabase=pg_database.oid)) from pg_database where datname=current_database()),
 'bootstrap_role',(select rolname from pg_roles where oid=10),
 'extensions',(select coalesce(json_object_agg(extname,extversion order by extname),'{}'::json) from pg_extension),
 'tables',(select coalesce(json_agg(row_to_json(t) order by t.schema,t.name),'[]'::json) from (
  select n.nspname as schema,c.relname as name,c.relrowsecurity as rls,c.relforcerowsecurity as force_rls,
   pg_get_userbyid(c.relowner) as owner,c.relacl::text as acl,
   ((xpath('/row/c/text()',query_to_xml(format('select count(*) as c from %I.%I',n.nspname,c.relname),false,true,'')))[1]::text)::bigint as rows
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where c.relkind in('r','p') and n.nspname not like 'pg_%' and n.nspname<>'information_schema'
 ) t),
 'policies',(select coalesce(json_agg(row_to_json(p) order by p.schemaname,p.tablename,p.policyname),'[]'::json) from pg_policies p where schemaname not like 'pg_%'),
 'functions',(select coalesce(json_agg(row_to_json(f) order by f.schema,f.name,f.arguments),'[]'::json) from(
  select n.nspname as schema,p.proname as name,pg_get_function_identity_arguments(p.oid) as arguments,
   pg_get_userbyid(p.proowner) as owner,p.proacl::text as acl,p.prosecdef as security_definer,p.proconfig as configuration
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname not like 'pg_%' and n.nspname<>'information_schema'
 ) f)
)::text;
