begin;

-- Use a typed empty array so strict PL/pgSQL lint accepts the initializer.
create or replace function private.deletion_scope(p_kind text,p_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  scope jsonb := private.deletion_scope_before_timed_exams(p_kind,p_id);
  course_filter text := private.deletion_selector(scope,'public.course_runs');
  profile_filter text := private.deletion_selector(scope,'public.profiles');
  version_filter text := private.deletion_selector(scope,'public.document_versions');
  result_filters text[] := array[]::text[];
begin
  if course_filter is not null then
    scope:=private.deletion_add_scope(scope,'private.course_timed_exams',
      format('x.run_id in (select scoped.id from public.course_runs scoped where %s)',replace(course_filter,'x.','scoped.')));
    result_filters:=array_append(result_filters,
      format('x.run_id in (select scoped.id from public.course_runs scoped where %s)',replace(course_filter,'x.','scoped.')));
  end if;
  if profile_filter is not null then
    result_filters:=array_append(result_filters,
      format('x.participant_id in (select scoped.id from public.profiles scoped where %s)',replace(profile_filter,'x.','scoped.')));
  end if;
  if version_filter is not null then
    result_filters:=array_append(result_filters,
      format('x.submitted_version_id in (select scoped.id from public.document_versions scoped where %s)',replace(version_filter,'x.','scoped.')));
  end if;
  if cardinality(result_filters)>0 then
    scope:=private.deletion_add_scope(scope,'private.course_exam_results',array_to_string(result_filters,' or '));
  end if;
  return scope;
end;
$$;

commit;
