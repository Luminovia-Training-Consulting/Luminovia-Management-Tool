begin;

-- Optional additional terms are represented by an empty immutable snapshot.
alter table public.jobs drop constraint jobs_terms_check;
alter table public.jobs add constraint jobs_terms_check check (length(terms) <= 12000);

do $migration$
declare
  rule record;
  definition text;
begin
  for rule in select * from (values
    ('private.create_course_run_job(uuid,jsonb,numeric,uuid)',
      $old$if exists(select 1 from public.jobs where course_run_id=r.id and status in('draft','published','filled')) then raise exception 'course_run_offer_exists' using errcode='22023';end if;$old$,
      ''),
    ('private.create_course_run_job(uuid,jsonb,numeric,uuid)',
      $old$jsonb_typeof(p_payload->'terms') is distinct from 'string' or length(trim(p_payload->>'terms')) not between 1 and 10000$old$,
      $new$(p_payload?'terms' and jsonb_typeof(p_payload->'terms') is distinct from 'string') or length(coalesce(p_payload->>'terms','')) > 10000$new$),
    ('private.create_course_run_job(uuid,jsonb,numeric,uuid)',
      $old$end,p_payload->>'terms',coalesce((p_payload->>'requires_contract')::boolean,true)$old$,
      $new$end,coalesce(p_payload->>'terms',''),coalesce((p_payload->>'requires_contract')::boolean,true)$new$),
    ('private.manage_job_offer(uuid,text,integer,uuid,jsonb)',
      $old$(p_payload?'terms' and length(coalesce(p_payload->>'terms','')) not between 1 and 12000)$old$,
      $new$(p_payload?'terms' and (jsonb_typeof(p_payload->'terms') is distinct from 'string' or length(p_payload->>'terms') > 12000))$new$),
    ('private.assignment_change_normalize(jsonb,jsonb)',
      $old$length(trim(result->>'terms')) not between 1 and 12000$old$,
      $new$length(result->>'terms') > 12000$new$)
  ) as rules(signature, old_text, new_text)
  loop
    definition := pg_get_functiondef(rule.signature::regprocedure);
    if cardinality(string_to_array(definition, rule.old_text)) <> 2 then
      raise exception 'Expected one course offer update point in %', rule.signature;
    end if;
    execute replace(definition, rule.old_text, rule.new_text);
  end loop;
end;
$migration$;

commit;
