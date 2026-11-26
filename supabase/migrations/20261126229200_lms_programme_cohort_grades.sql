-- A bounded cohort report uses the established authoritative course result for every learner.
begin;

create function private.learning_program_cohort_grades(p_program_id uuid, p_search text, p_offset integer)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  company uuid;
  search text := lower(btrim(p_search));
  report jsonb;
begin
  if p_program_id is null or char_length(search) > 120 or search is null
     or p_offset is null or p_offset < 0 then raise invalid_parameter_value; end if;
  select organisation_id into company from private.learning_programs where id = p_program_id;
  if not found or not coalesce(private.learning_actor() and private.actor_active()
    and private.has_permission('courses.manage') and private.course_lms_read_enabled(company), false)
    then raise insufficient_privilege; end if;

  with page as materialized (
    select member.user_id, profile.display_name as name
    from private.learning_program_members member
    join public.profiles profile on profile.id = member.user_id
    where member.program_id = p_program_id
      and private.active_company_participant(member.user_id, company)
      and (search = '' or strpos(lower(profile.display_name), search) > 0)
    order by lower(profile.display_name), member.user_id
    limit 31 offset p_offset
  ), visible as (
    select user_id, name from page order by lower(name), user_id limit 30
  )
  select jsonb_build_object(
    'more', (select count(*) from page) > 30,
    'rows', coalesce(jsonb_agg(jsonb_build_object(
      'participant_id', visible.user_id, 'name', visible.name,
      'report', private.learning_program_grade_report(p_program_id, visible.user_id)
    ) order by lower(visible.name), visible.user_id), '[]'::jsonb)
  ) into report from visible;
  return report;
end;
$$;
create function public.learning_program_cohort_grades(
  p_program_id uuid, p_search text default '', p_offset integer default 0
) returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.learning_program_cohort_grades(p_program_id, p_search, p_offset);
$$;
revoke all on function private.learning_program_cohort_grades(uuid,text,integer),
  public.learning_program_cohort_grades(uuid,text,integer) from public, anon, authenticated, service_role;
grant execute on function private.learning_program_cohort_grades(uuid,text,integer),
  public.learning_program_cohort_grades(uuid,text,integer) to authenticated;

do $migration$
declare
  gate text := pg_catalog.pg_get_functiondef('private.require_academy_course_access()'::regprocedure);
  anchor constant text := '''/rpc/learning_program_grade_report''';
begin
  if cardinality(string_to_array(gate, anchor)) <> 2 then
    raise exception 'Expected the programme report licence boundary';
  end if;
  execute replace(gate, anchor, anchor || ', ''/rpc/learning_program_cohort_grades''');
end;
$migration$;

notify pgrst, 'reload schema';
commit;
