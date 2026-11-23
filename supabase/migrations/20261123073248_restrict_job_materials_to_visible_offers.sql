begin;

-- Use current offer authority for standard job attachments. Keep the original
-- before/after-claim distinction and every dedicated evidence policy.
do $migration$
declare
  definition text := pg_catalog.pg_get_functiondef('private.can_access_document(uuid)'::regprocedure);
  fallback_call constant text := ' return private.accounting_document_access_fallback(p_id);';
  updated_definition text;
begin
  updated_definition := replace(definition, fallback_call, $access$
 if exists (
   select from public.documents document
   where document.id = p_id and document.kind = 'material'
     and document.scope in ('job_before', 'job_after')
     and not private.can_read_job(document.job_id)
 ) then
   return false;
 end if;
 return private.accounting_document_access_fallback(p_id);$access$);
  if updated_definition = definition then
    raise exception 'Installed job material access gate has changed';
  end if;
  execute updated_definition;
end;
$migration$;

commit;
