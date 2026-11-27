-- Chat and the course material library use their own security-definer lookups.
-- They retain permitted preparation content while withholding customer labels.
begin;
do $migration$
declare
  definition text;
  job_customer constant text := 'job.customer_name,';
  company_join constant text := 'left join public.organisations company on company.id = run.organisation_id';
  material_customer constant text := 'organisation.name as organisation_name';
begin
  definition := pg_get_functiondef('private.chat_directory_filters()'::regprocedure);
  if cardinality(string_to_array(definition,job_customer))<>2
    or cardinality(string_to_array(definition,company_join))<>2 then
    raise exception 'Unexpected course chat company facets';
  end if;
  definition := replace(definition,job_customer,
    'private.visible_job_customer(job.id,job.customer_name) as customer_name,');
  execute replace(definition,company_join,
    company_join || ' and private.can_read_course_customer(run.id)');

  definition := pg_get_functiondef('private.search_course_materials(uuid,text,text,integer)'::regprocedure);
  if cardinality(string_to_array(definition,material_customer))<>2 then
    raise exception 'Unexpected course material company projection';
  end if;
  execute replace(definition,material_customer,
    'case when private.can_read_course_customer(run.id) then organisation.name end as organisation_name');
end;
$migration$;
commit;
