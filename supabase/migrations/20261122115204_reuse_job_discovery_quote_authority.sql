begin;

-- The quote reader returns a row only after can_read_job passes. Use that
-- decision for monetary filters and sorting instead of repeating it for each
-- matching offer. Price-free discovery still authorizes each job directly.
do $migration$
declare
  definition text := pg_catalog.pg_get_functiondef('private.job_discovery_candidates_before_text_sort(jsonb)'::regprocedure);
  quote_join constant text := $old$
  left join lateral private.job_discovery_quote(
    case
      when f->>'sort' in ('rate_asc', 'rate_desc', 'total_asc', 'total_desc')
        or f->>'min_rate' is not null or f->>'max_rate' is not null
        or f->>'min_total' is not null or f->>'max_total' is not null
      then job.id
    end
  ) quote on true$old$;
  access_check constant text := '  where private.can_read_job(job.id)';
begin
  if cardinality(string_to_array(definition, quote_join)) <> 2
     or cardinality(string_to_array(definition, access_check)) <> 2 then
    raise exception 'Expected one authorized discovery quote join and job access check';
  end if;
  definition := replace(definition, quote_join, $new$
  cross join lateral (
    select f->>'sort' in ('rate_asc', 'rate_desc', 'total_asc', 'total_desc')
      or f->>'min_rate' is not null or f->>'max_rate' is not null
      or f->>'min_total' is not null or f->>'max_total' is not null as needed
  ) pricing
  left join lateral (
    select authorized.*, true as authorized_job
    from private.job_discovery_quote(case when pricing.needed then job.id end) authorized
  ) quote on true$new$);
  execute replace(definition, access_check, $new$
  where case when pricing.needed then quote.authorized_job is true
    else private.can_read_job(job.id) end$new$);
end;
$migration$;

commit;
