begin;

-- An internal draft with dates but no delivery can be deleted in one reviewed
-- operation. Dates join the impact preview, while their incoming references
-- (attendance, evidence, allocations, etc.) remain protected blockers.
alter function private.deletion_scope(text, uuid)
  rename to deletion_scope_before_draft_course_dates;

create function private.deletion_scope(p_kind text, p_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  scope jsonb := private.deletion_scope_before_draft_course_dates(p_kind, p_id);
begin
  if p_kind = 'course_run'
     and (select edition from private.installation_identity) = 'internal'
     and exists (
       select 1 from public.course_runs run
       where run.id = p_id and not run.published and run.archived_at is null
     )
     and not exists (select 1 from public.jobs where course_run_id = p_id)
     and not exists (select 1 from private.course_evaluations where run_id = p_id)
     and not exists (select 1 from private.course_exam_results where run_id = p_id)
  then
    scope := private.deletion_add_scope(
      scope, 'public.course_sessions', format('x.course_run_id=%L::uuid', p_id)
    );
  end if;
  return scope;
end;
$$;

revoke all on function private.deletion_scope_before_draft_course_dates(text, uuid),
  private.deletion_scope(text, uuid) from public, anon, authenticated, service_role;

-- These two session dependencies were introduced after the common deletion
-- fence. Prevent evidence writes between confirmation and the worker's delete.
create trigger permanent_deletion_fence
before insert or update or delete on private.course_attendance_evidence
for each row execute function private.guard_permanent_deletion();

create trigger permanent_deletion_fence
before insert or update or delete on private.academy_course_material_intake
for each row execute function private.guard_permanent_deletion();

commit;
