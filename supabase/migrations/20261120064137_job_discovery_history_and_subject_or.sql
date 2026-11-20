begin;

-- Keep the reviewed text-sort validator and pagination contract, but add an
-- explicit history bit and make the unfiltered marketplace sort by next start.
create or replace function private.job_discovery_filters(p_filters jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  clean_filters jsonb;
  result jsonb;
  chosen_sort text;
  include_history boolean;
begin
  if p_filters is null or jsonb_typeof(p_filters) <> 'object' or
     (p_filters ? 'include_history' and
       jsonb_typeof(p_filters->'include_history') <> 'boolean') then
    raise exception 'Invalid discovery filters' using errcode = '22023';
  end if;
  include_history := coalesce((p_filters->>'include_history')::boolean, false);
  clean_filters := p_filters - 'include_history';
  if not (clean_filters ? 'sort') then
    clean_filters := jsonb_set(clean_filters, '{sort}', '"soonest"'::jsonb, true);
  end if;
  chosen_sort := clean_filters->>'sort';
  if chosen_sort in ('customer_asc', 'topic_de_asc', 'topic_en_asc') then
    result := private.job_discovery_filters_before_text_sort(
      jsonb_set(clean_filters, '{sort}', '"title"'::jsonb, true)
    );
    result := jsonb_set(result, '{sort}', to_jsonb(chosen_sort), true);
  else
    result := private.job_discovery_filters_before_text_sort(clean_filters);
  end if;
  return jsonb_set(result, '{include_history}', to_jsonb(include_history), true);
end;
$$;
revoke all on function private.job_discovery_filters(jsonb)
  from public, anon, authenticated, service_role;

-- Preserve the current role-aware, quote-safe candidate implementation before
-- applying the open-marketplace defaults and OR-within-subject selection.
do $$
declare
  body text;
begin
  select prosrc into strict body
  from pg_catalog.pg_proc
  where oid = 'private.job_discovery_candidates(jsonb)'::regprocedure;
  execute format(
    'create function private.job_discovery_candidates_before_history(f jsonb) returns table(job_id uuid,sort_number numeric,sort_text text) language sql stable security definer set search_path = %L as %L',
    '', body
  );
end;
$$;
revoke all on function private.job_discovery_candidates_before_history(jsonb)
  from public, anon, authenticated, service_role;

create or replace function private.job_discovery_candidates(f jsonb)
returns table(job_id uuid, sort_number numeric, sort_text text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  base_filters jsonb;
begin
  -- The existing base filter uses AND across selected topics. Clear only that
  -- list in its input, then intersect the other filters with any selected topic.
  base_filters := jsonb_set(f, '{topic_ids}', '[]'::jsonb, true);
  return query
  select candidate.job_id, candidate.sort_number, candidate.sort_text
  from private.job_discovery_candidates_before_history(base_filters) candidate
  join public.jobs job on job.id = candidate.job_id
  where (
    jsonb_array_length(f->'topic_ids') = 0 or exists (
      select 1
      from jsonb_array_elements_text(f->'topic_ids') selected(topic_id)
      join public.job_requirements requirement
        on requirement.job_id = job.id
       and requirement.topic_id = selected.topic_id::uuid
    )
  )
  and (
    (f->>'include_history')::boolean or (
      job.status = 'published' and
      (job.claim_deadline is null or job.claim_deadline > now()) and
      exists (
        select 1 from public.job_sessions session
        where session.job_id = job.id
      ) and
      not exists (
        select 1 from public.job_sessions session
        where session.job_id = job.id and session.starts_at <= now()
      ) and
      (select count(*) from public.job_claims claim
       where claim.job_id = job.id and claim.status = 'confirmed') < job.capacity
    )
  )
  and (
    not private.lecturer_actor() or not exists (
      select 1 from public.job_claims own_claim
      where own_claim.job_id = job.id
        and own_claim.lecturer_id = auth.uid()
        and own_claim.status = 'confirmed'
    )
  )
  order by candidate.sort_number, candidate.job_id;
end;
$$;
revoke all on function private.job_discovery_candidates(jsonb)
  from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';
commit;