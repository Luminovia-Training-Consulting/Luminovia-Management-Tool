-- Use the effective course delivery mode for marketplace filtering and cards.
-- Preserve the two legacy values for existing clients and source records.
begin;
create function private.training_offered_mode(p_job_id uuid,p_course_run_id uuid)
returns text language sql stable security invoker set search_path='' as $$
  select case when count(distinct session.config->>'mode')>1 then 'mixed'
    else min(session.config->>'mode') end
  from private.training_effective_delivery(p_course_run_id) session
  join public.job_sessions position on position.job_id=p_job_id and position.course_session_id=session.session_id
$$;
revoke all on function private.training_offered_mode(uuid,uuid) from public,anon,authenticated,service_role;

do $migration$
declare
  definition text;
  delivery_filter constant text := 'job.delivery_type = f->>''delivery''';
  normalizer constant text := 'clean_filters := p_filters - ''include_history'';';
  receipt constant text := 'return jsonb_set(result, ''{include_history}'', to_jsonb(include_history), true);';
  item constant text := '''delivery_type'',j.delivery_type';
  alias constant text := 'j.course_run_id';
begin
  definition := pg_catalog.pg_get_functiondef('private.job_discovery_candidates(jsonb)'::regprocedure);
  if cardinality(string_to_array(definition,delivery_filter))<>2 then
    raise exception 'Unexpected discovery delivery filter';
  end if;
  execute replace(definition,delivery_filter,
    'coalesce(private.training_offered_mode(job.id,job.course_run_id),job.delivery_type) = f->>''delivery''');

  definition := pg_catalog.pg_get_functiondef('private.job_discovery_filters(jsonb)'::regprocedure);
  if cardinality(string_to_array(definition,normalizer))<>2 or
    cardinality(string_to_array(definition,receipt))<>2 then
    raise exception 'Unexpected discovery filter normalizer';
  end if;
  definition := replace(definition,normalizer,normalizer || $code$
  if clean_filters->>'delivery' in ('hybrid','mixed') then
    clean_filters := jsonb_set(clean_filters,'{delivery}','""'::jsonb);
  end if;
  $code$);
  definition := replace(definition,receipt,$code$
  if p_filters->>'delivery' in ('hybrid','mixed') then
    result := jsonb_set(result,'{delivery}',p_filters->'delivery');
  end if;
  $code$ || receipt);
  execute definition;

  -- Use the normal role-scoped item as the entry point and retain company dispatch rules.
  definition := pg_catalog.pg_get_functiondef('private.job_discovery_item(uuid)'::regprocedure);
  if cardinality(string_to_array(definition,item))<>2 then
    raise exception 'Unexpected discovery item projection';
  end if;
  execute replace(definition,item,item || ',''delivery_summary'',private.training_offer_delivery(j.id)');
end;
$migration$;
commit;
