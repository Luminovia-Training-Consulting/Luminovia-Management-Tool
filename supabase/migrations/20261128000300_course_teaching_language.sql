begin;

alter table public.course_runs add column teaching_language text
  check (teaching_language in ('de', 'en'));

create function private.teaching_language_matches(p_language text, p_lecturer uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_language is null or exists (
    select 1 from private.lecturer_matching_preferences preference
    where preference.user_id = p_lecturer and p_language = any(preference.teaching_languages)
  );
$$;
revoke all on function private.teaching_language_matches(text, uuid)
  from public, anon, authenticated, service_role;

do $migration$
declare
  save_run text := pg_get_functiondef('private.save_course_run(uuid,jsonb)'::regprocedure);
  creator text := pg_get_functiondef('private.course_creator_draft_action(text,uuid,integer,jsonb)'::regprocedure);
  copy_run text := pg_get_functiondef('private.copy_training_course(uuid,text,jsonb,text,uuid)'::regprocedure);
  match_job text := pg_get_functiondef('private.job_required_profile_matches(uuid,uuid)'::regprocedure);
  read_job text := pg_get_functiondef('private.can_read_job(uuid)'::regprocedure);
  read_run text := pg_get_functiondef('private.can_read_course_run(uuid)'::regprocedure);
  saved_return constant text := '  return target;';
  linked_return constant text := '      return private.save_linked_course_run(run_row, p_payload);';
  company_fields constant text := $old$'venue','sessions','published','archived'])$old$;
  fields constant text := '''delivery_type'', ''venue'', ''sessions'']';
  copy_columns constant text := 'insert into public.course_runs(template_id,organisation_id,time_zone,delivery_type,published,venue)';
  copy_values constant text := $old$case when copy_delivery then source.delivery_type else 'online' end,false,'')$old$;
  copy_preview constant text := $old$'source_run_id',source.id,'organisation_id',source.organisation_id,'time_zone',source.time_zone,$old$;
  requirement constant text := '  select coalesce((';
  listing constant text := 'job.urgent_reopened_at is not null or private.job_subject_matches(job.id, auth.uid())';
  course_preview constant text := 'and not private.course_lecturer_blocked(run.id,auth.uid())';
begin
  if cardinality(string_to_array(save_run, saved_return)) <> 2
    or cardinality(string_to_array(save_run, linked_return)) <> 2
    or cardinality(string_to_array(save_run, company_fields)) <> 2
    or cardinality(string_to_array(creator, fields)) <> 2
    or cardinality(string_to_array(copy_run, copy_columns)) <> 2
    or cardinality(string_to_array(copy_run, copy_values)) <> 2
    or cardinality(string_to_array(copy_run, copy_preview)) <> 2
    or cardinality(string_to_array(match_job, requirement)) <> 2
    or cardinality(string_to_array(read_job, listing)) <> 2
    or cardinality(string_to_array(read_run, course_preview)) <> 2 then
    raise exception 'Expected current course and job language integration points';
  end if;

  save_run := replace(save_run, linked_return, $body$
      if p_payload ? 'teaching_language'
        and nullif(p_payload->>'teaching_language', '') is distinct from run_row.teaching_language then
        raise exception 'Teaching language cannot change after an offer is linked' using errcode = '22023';
      end if;
$body$ || linked_return);
  save_run := replace(save_run, company_fields,
    $new$'venue','sessions','published','archived','teaching_language'])$new$);
  execute replace(save_run, saved_return, $body$
  if p_payload ? 'teaching_language' then
    update public.course_runs set teaching_language = nullif(p_payload->>'teaching_language', '')
    where id = target;
  end if;
$body$ || saved_return);
  execute replace(creator, fields, '''delivery_type'', ''venue'', ''sessions'', ''teaching_language'']');
  copy_run := replace(copy_run, copy_columns,
    'insert into public.course_runs(template_id,organisation_id,time_zone,delivery_type,published,venue,teaching_language)');
  copy_run := replace(copy_run, copy_preview, copy_preview || $field$ 'teaching_language',source.teaching_language,$field$);
  execute replace(copy_run, copy_values,
    $body$case when copy_delivery then source.delivery_type else 'online' end,false,'',source.teaching_language)$body$);
  execute replace(match_job, requirement, $body$
  select private.teaching_language_matches((
    select run.teaching_language from public.jobs job
    join public.course_runs run on run.id = job.course_run_id where job.id = p_job
  ), p_lecturer) and coalesce((
$body$);
  execute replace(read_job, listing, $body$
    (job.urgent_reopened_at is not null and private.teaching_language_matches((
      select run.teaching_language from public.course_runs run where run.id = job.course_run_id
    ), auth.uid())) or private.job_subject_matches(job.id, auth.uid())
$body$);
  execute replace(read_run, course_preview, course_preview ||
    ' and private.teaching_language_matches(run.teaching_language, auth.uid())');
end;
$migration$;

commit;
