begin;

-- The first accepted completion time is stable. Mutable bookmarks and best
-- scores stay within the course and cannot change a statement already sent.
do $migration$
declare
  definition text := pg_catalog.pg_get_functiondef(
    'private.course_xapi_statements(uuid,timestamptz,timestamptz)'::regprocedure
  );
  facts_anchor constant text := '  ), bounded as (';
  verb_anchor constant text := $old$when 'completion' then 'completed' when 'h5p-answer' then 'answered'$old$;
  activity_anchor constant text := $old$when 'weighted-grade' then activity || '/weighted-grade' else activity end)$old$;
  result_anchor constant text := $old$when kind = 'completion' then jsonb_build_object('result', jsonb_build_object('completion', true))$old$;
begin
  if cardinality(string_to_array(definition,facts_anchor)) <> 2
    or cardinality(string_to_array(definition,verb_anchor)) <> 2
    or cardinality(string_to_array(definition,activity_anchor)) <> 2
    or cardinality(string_to_array(definition,result_anchor)) <> 2
    then raise exception 'Expected current xAPI fact and statement definitions'; end if;

  definition := replace(definition,facts_anchor,$facts$
    union all
    select completed.version_id, completed.user_id, completed.completed_at, 'h5p-playback',
      null, null, null, ':' || completed.user_id,
      jsonb_build_object('key', package.version_id)
    from private.course_h5p_progress completed
    join roster using(user_id)
    join private.course_h5p_packages package on package.version_id = completed.version_id
    where package.run_id = p_run_id and package.published_at is not null
      and completed.completed_at >= p_from and completed.completed_at < p_until
    union all
    select completed.version_id, completed.user_id, completed.completed_at, 'scorm-playback',
      null, null, null, ':' || completed.user_id || ':' || completed.item_id,
      jsonb_build_object('key', package.version_id || ':' || completed.item_id)
    from private.course_scorm_progress completed
    join roster using(user_id)
    join private.course_scorm_packages package on package.version_id = completed.version_id
    where package.run_id = p_run_id and package.published_at is not null
      and completed.completed_at >= p_from and completed.completed_at < p_until
$facts$ || facts_anchor);
  definition := replace(definition, verb_anchor,
    $verbs$when 'completion' then 'completed' when 'h5p-playback' then 'completed'
        when 'scorm-playback' then 'completed' when 'h5p-answer' then 'answered'$verbs$);
  definition := replace(definition, activity_anchor,
    $activities$when 'weighted-grade' then activity || '/weighted-grade'
        when 'h5p-playback' then activity || '/h5p/' ||
          encode(extensions.hmac(convert_to('h5p:' || (interaction->>'key'), 'UTF8'), export_key, 'sha256'), 'hex')
        when 'scorm-playback' then activity || '/scorm/' ||
          encode(extensions.hmac(convert_to('scorm:' || (interaction->>'key'), 'UTF8'), export_key, 'sha256'), 'hex')
        else activity end)$activities$);
  execute replace(definition, result_anchor,
    $result$when kind in ('completion','h5p-playback','scorm-playback') then
      jsonb_build_object('result', jsonb_build_object('completion', true))$result$);
end;
$migration$;

commit;
