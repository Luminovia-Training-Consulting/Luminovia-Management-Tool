begin;

alter function private.deletion_scope(text, uuid) rename to deletion_scope_before_course_submissions;

create function private.deletion_scope(p_kind text, p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  scope jsonb := private.deletion_scope_before_course_submissions(p_kind, p_id);
  version_filter text := private.deletion_selector(scope, 'public.document_versions');
  course_filter text := private.deletion_selector(scope, 'public.course_runs');
  selected_versions text;
begin
  -- A submission record is owned by its exact file version. Removing a course
  -- or an organisation cannot silently orphan bytes still owned by learners.
  select coalesce(jsonb_agg(entry order by position), '[]'::jsonb) into scope
  from jsonb_array_elements(scope) with ordinality as item(entry, position)
  where entry->>'table' <> 'private.course_submissions';

  if version_filter is not null then
    execute format(
      'select string_agg(quote_literal(submission.version_id), '','' order by submission.version_id)
       from private.course_submissions submission
       join public.document_versions x on x.id = submission.version_id
       where %s', version_filter
    ) into selected_versions;
    if selected_versions is not null then
      scope := private.deletion_add_scope(scope, 'private.course_submissions',
        format('x.version_id in (%s)', selected_versions));
    end if;
  end if;

  -- The course switch, unlike a learner file, has no separate owner.
  if course_filter is not null and private.deletion_selector(scope, 'private.course_submission_settings') is null then
    scope := private.deletion_add_scope(scope, 'private.course_submission_settings',
      format('x.run_id in (select x.id from public.course_runs x where %s)', course_filter));
  end if;
  return scope;
end;
$$;

revoke all on function private.deletion_scope_before_course_submissions(text, uuid),
  private.deletion_scope(text, uuid) from public, anon, authenticated, service_role;

commit;
