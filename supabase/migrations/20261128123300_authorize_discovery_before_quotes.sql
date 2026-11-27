begin;

-- Marketplace paging used to repeat the full job-read policy while pricing
-- every candidate, even though each returned item was checked again. Compute
-- authorization once in the materialized scope, then use a private quote
-- projection that is only reachable from that already-authorized scope.
create function private.job_discovery_quote_authorized(p_job_id uuid)
returns table(amount numeric, total_amount numeric, terms_version integer)
language sql stable security definer set search_path = '' as $$
  select
    case when offer.pricing_mode = 'role_split'
      then case when private.lecturer_actor()
        then private.role_net(offer.gross_amount, auth.uid(), job.id) end
      else job.amount end,
    case when offer.pricing_mode = 'role_split'
      then case when private.lecturer_actor()
        then private.role_net(offer.gross_total_amount, auth.uid(), job.id) end
      else job.total_amount end,
    case when offer.pricing_mode = 'role_split' and private.lecturer_actor()
      then private.role_quote_version(job.terms_version, auth.uid())
      else job.terms_version end
  from public.jobs job
  left join private.job_commission_offers offer on offer.job_id = job.id
  where job.id = p_job_id;
$$;
revoke all on function private.job_discovery_quote_authorized(uuid)
  from public, anon, authenticated, service_role;

do $migration$
declare
  definition text;
  job_source constant text := 'cross join public.jobs job';
  scope_end constant text := E'\n  ), candidates as materialized (';
  old_candidates constant text :=
    'select job.id, job.title, job.customer_name, job.created_at, first_session.starts_at';
  old_candidate_filter constant text := $old$where not options.open_only or (
      first_session.starts_at > now()
      and (
        select count(*) from public.job_claims claim
        where claim.job_id = job.id and claim.status = 'confirmed'
      ) < job.capacity
    )$old$;
  old_quote constant text := 'private.job_discovery_quote(case when options.needs_quote then candidate.id end)';
  auth_start integer;
  auth_end integer;
begin
  definition := pg_catalog.pg_get_functiondef(
    'private.job_discovery_candidates(jsonb)'::regprocedure
  );
  if cardinality(string_to_array(definition, job_source)) <> 2
    or cardinality(string_to_array(definition, scope_end)) <> 2
    or cardinality(string_to_array(definition, old_candidates)) <> 2
    or cardinality(string_to_array(definition, old_candidate_filter)) <> 2
    or cardinality(string_to_array(definition, old_quote)) <> 2 then
    raise exception 'Unexpected marketplace scope or quote integration';
  end if;
  definition := replace(definition, job_source, $new$cross join public.jobs job
    cross join lateral (select private.can_read_job(job.id) as authorized offset 0) read_scope$new$);
  definition := replace(definition, scope_end,
    E'\n    and read_scope.authorized\n  ), candidates as materialized (');
  definition := replace(definition,
    'select job.id, job.title, job.customer_name, job.created_at, job.capacity',
    'select job.id, job.title, job.customer_name, job.created_at, job.capacity, read_scope.authorized');
  definition := replace(definition, old_candidates,
    old_candidates || ', job.authorized');
  definition := replace(definition, old_candidate_filter,
    replace(old_candidate_filter, 'where not options.open_only', 'where job.authorized and not options.open_only'));
  definition := replace(definition, old_quote,
    'private.job_discovery_quote_authorized(case when options.needs_quote then candidate.id end)');

  auth_start := strpos(definition,
    'where case when options.needs_quote then quote.authorized_job is true');
  auth_end := strpos(definition, '    and (f->>''min_total'' is null', auth_start);
  if auth_start = 0 or auth_end <= auth_start then
    raise exception 'Unexpected marketplace candidate authorization projection';
  end if;
  definition := left(definition, auth_start - 1)
    || 'where candidate.authorized and (not options.needs_quote or quote.authorized_job is true)' || E'\n'
    || substring(definition from auth_end);

  execute definition;
end;
$migration$;

commit;
