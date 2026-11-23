begin;

-- Allow an independent listing description while retaining the selected
-- template, exact course sessions and company in the existing transaction.
do $migration$
declare
  definition text := pg_get_functiondef('private.create_course_run_job(uuid,jsonb,numeric,uuid)'::regprocedure);
  declarations constant text := 'positions integer:=1;';
  allowed_fields constant text := '''source_revision'',''capacity'')) then raise exception ''Invalid course offer''';
  source_check constant text := ' if jsonb_typeof(p_payload->''source_revision'')';
  listing_insert constant text := 'values(job,r.id,t.title,t.description,o.name,';
begin
  if cardinality(string_to_array(definition, declarations)) <> 2
     or cardinality(string_to_array(definition, allowed_fields)) <> 2
     or cardinality(string_to_array(definition, source_check)) <> 2
     or cardinality(string_to_array(definition, listing_insert)) <> 2 then
    raise exception 'Expected course offer content validation and insert';
  end if;

  definition := replace(definition, declarations, declarations || ' offer_title text;');
  definition := replace(definition, allowed_fields,
    '''source_revision'',''capacity'',''title'',''description'')) then raise exception ''Invalid course offer''');
  definition := replace(definition, source_check, $new$
 if p_payload ? 'title' then
  offer_title := regexp_replace(p_payload->>'title', '^[[:space:]]+|[[:space:]]+$', '', 'g');
  if jsonb_typeof(p_payload->'title') is distinct from 'string' or length(offer_title) not between 1 and 200 then
   raise exception 'Invalid offer title' using errcode='22023';
  end if;
 end if;
 if p_payload ? 'description' and
    (jsonb_typeof(p_payload->'description') is distinct from 'string' or length(p_payload->>'description') > 12000) then
  raise exception 'Invalid offer description' using errcode='22023';
 end if;
$new$ || source_check);
  execute replace(definition, listing_insert,
    $new$values(job,r.id,coalesce(offer_title,t.title),coalesce(p_payload->>'description',t.description),o.name,$new$);
end;
$migration$;

-- Compare validated, canonical sessions before replacing an unlinked run's schedule.
-- Company, venue and equivalent time-zone edits retain any dependent session IDs.
do $migration$
declare
  definition text := pg_get_functiondef('private.save_course_run(uuid,jsonb)'::regprocedure);
  declarations constant text := '  session_count integer := 0;';
  wipe constant text := '    delete from public.course_sessions where course_run_id = target;';
  save_sessions constant text := $old$
    if starts is null or ends is null or ends <= starts or exists (
      select 1 from public.course_sessions where course_run_id = target
        and tstzrange(starts_at, ends_at, '[)') && tstzrange(starts, ends, '[)')
    ) then
      raise exception 'Invalid or overlapping sessions' using errcode = '22023';
    end if;
    insert into public.course_sessions(course_run_id, starts_at, ends_at)
    values (target, starts, ends);
    session_count := session_count + 1;
  end loop;
$old$;
begin
  if cardinality(string_to_array(definition, declarations)) <> 2
     or cardinality(string_to_array(definition, wipe)) <> 2
     or cardinality(string_to_array(definition, save_sessions)) <> 2 then
    raise exception 'Expected unlinked course session validation and write';
  end if;

  definition := replace(definition, declarations, declarations || $new$
  session_ranges tstzrange[] := '{}';
  slot tstzrange;$new$);
  definition := replace(definition, wipe || chr(10), '');
  execute replace(definition, save_sessions, $new$
    if starts is null or ends is null or ends <= starts then
      raise exception 'Invalid or overlapping sessions' using errcode = '22023';
    end if;
    slot := tstzrange(starts, ends, '[)');
    if slot && any(session_ranges) then
      raise exception 'Invalid or overlapping sessions' using errcode = '22023';
    end if;
    session_ranges := array_append(session_ranges, slot);
    session_count := session_count + 1;
  end loop;

  if p_id is null or exists (
    with current_slots as (
      select tstzrange(starts_at, ends_at, '[)') as times
      from public.course_sessions where course_run_id = target
    ), proposed_slots as (
      select unnest(session_ranges) as times
    )
    (select times from current_slots except all select times from proposed_slots)
    union all
    (select times from proposed_slots except all select times from current_slots)
  ) then
    if p_id is not null then
      delete from public.course_sessions where course_run_id = target;
    end if;
    insert into public.course_sessions(course_run_id, starts_at, ends_at)
    select target, lower(times), upper(times) from unnest(session_ranges) as proposed(times);
  end if;
$new$);
end;
$migration$;

commit;
