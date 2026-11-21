begin;

-- Keep the installed security, eligibility and locking logic intact. These
-- three declarations no longer carry data after composing the live routines.
do $migration$
declare
  source text;
begin
  source := pg_catalog.pg_get_functiondef(
    'private.attach_course_session_evidence_before_premium_lock(uuid,uuid,uuid)'::regprocedure
  );
  if strpos(source, ' version_row public.document_versions%rowtype;') = 0 or
     strpos(source, 'select version.* into version_row from public.document_versions version') = 0 then
    raise exception 'Unexpected attendance evidence version check';
  end if;
  source := replace(source, ' version_row public.document_versions%rowtype;', '');
  source := replace(source,
    'select version.* into version_row from public.document_versions version',
    'perform 1 from public.document_versions version');
  execute source;

  source := pg_catalog.pg_get_functiondef(
    'private.submit_invoice_with_session_eligibility(text,uuid[],uuid,date,date,uuid)'::regprocedure
  );
  if strpos(source, 'prior_invoice public.invoices%rowtype;') = 0 or
     strpos(source, E'select * into prior_invoice\n  from public.invoices') = 0 then
    raise exception 'Unexpected existing invoice receipt check';
  end if;
  source := replace(source, E'  prior_invoice public.invoices%rowtype;\n', '');
  source := replace(source,
    E'select * into prior_invoice\n  from public.invoices',
    E'perform 1\n  from public.invoices');
  execute source;

  source := pg_catalog.pg_get_functiondef(
    'private.assignment_change_action(uuid,text,integer,text,uuid)'::regprocedure
  );
  if strpos(source, ';item jsonb;') = 0 then
    raise exception 'Unexpected assignment amendment declaration';
  end if;
  execute replace(source, ';item jsonb;', ';');
end;
$migration$;

commit;
