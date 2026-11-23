begin;

alter function private.deletion_scope(text, uuid)
  rename to deletion_scope_before_course_offers;

-- Compose the existing owned job scopes with the run. Incoming references
-- outside that reviewed graph remain blockers in deletion_snapshot.
create function private.deletion_scope(p_kind text, p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  scope jsonb := private.deletion_scope_before_course_offers(p_kind, p_id);
  job_scope jsonb;
begin
  if p_kind <> 'course_run'
     or (select edition from private.installation_identity) is distinct from 'internal'
     or exists (
       select 1 from public.jobs job where job.course_run_id = p_id
         and (job.status = 'filled' or exists (
           select 1 from public.job_claims claim where claim.job_id = job.id
         ))
     )
     or exists (select 1 from private.course_evaluations where run_id = p_id)
     or exists (select 1 from private.course_exam_results where run_id = p_id)
  then
    return scope;
  end if;

  if private.deletion_selector(scope, 'public.course_sessions') is null then
    scope := private.deletion_add_scope(
      scope, 'public.course_sessions', format('x.course_run_id=%L::uuid', p_id)
    );
  end if;

  for job_scope in
    select private.deletion_scope_before_course_offers('job', job.id)
    from public.jobs job where job.course_run_id = p_id order by job.id
  loop
    scope := scope || job_scope;
  end loop;

  -- One entry per relation preserves complete counts, fingerprints and fences.
  return (
    select coalesce(jsonb_agg(jsonb_build_object('table', relation, 'predicate', predicate)
      order by first_position), '[]'::jsonb)
    from (
      select entry->>'table' relation,
        string_agg('(' || (entry->>'predicate') || ')', ' or ' order by position) predicate,
        min(position) first_position
      from jsonb_array_elements(scope) with ordinality item(entry, position)
      group by entry->>'table'
    ) grouped
  );
end;
$$;

revoke all on function private.deletion_scope_before_course_offers(text, uuid),
  private.deletion_scope(text, uuid) from public, anon, authenticated, service_role;

commit;
