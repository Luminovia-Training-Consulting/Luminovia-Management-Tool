BEGIN;

-- A review also anchors every released grade through its foreign key. Any
-- recorded exemption or review keeps all versions of this course policy.
create function private.course_weighted_policy_unused(p_run_id uuid)
returns boolean language sql stable strict set search_path = '' as $$
  select not exists (select 1 from private.course_weighted_exemptions where run_id = p_run_id)
     and not exists (select 1 from private.course_weighted_reviews where run_id = p_run_id);
$$;

alter function private.deletion_scope(text, uuid) rename to deletion_scope_before_weighted_policy;
create function private.deletion_scope(p_kind text, p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  scope jsonb := private.deletion_scope_before_weighted_policy(p_kind, p_id);
begin
  -- Add only course-owned configuration to an ordinary approved course plan.
  -- Used policies stay outside its scope and surface as protected dependencies.
  if p_kind = 'course_run' and private.course_weighted_policy_unused(p_id)
    and exists (select 1 from private.course_weighted_policies where run_id = p_id)
  then
    scope := private.deletion_add_scope(scope, 'private.course_weighted_policies',
      format('x.run_id = %L::uuid', p_id));
  end if;
  return scope;
end;
$$;

-- The existing worker sets this local operation ID only after validating the
-- current execution permit. Recheck the exact approved target and protect all
-- versions from edits or unrelated deletion paths.
create function private.prevent_weighted_policy_history_mutation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' and current_setting('role', true) = 'service_role' and exists (
    select 1 from private.deletion_operations operation
    where operation.id::text = current_setting('private.deletion_operation', true)
      and operation.kind = 'course_run' and operation.target_id = old.run_id
      and not operation.applied and operation.status <> 'completed'
      and private.deletion_selector(operation.scope, 'private.course_weighted_policies') is not null
  ) and private.course_weighted_policy_unused(old.run_id) then
    return old;
  end if;
  raise exception 'Course gradebook history is immutable' using errcode = '42501';
end;
$$;

create or replace trigger course_weighted_policies_immutable
  before update or delete on private.course_weighted_policies
  for each row execute function private.prevent_weighted_policy_history_mutation();

-- Confirming the dependency graph also locks incoming references to the
-- policy. Fence later inserts so pending execution cannot acquire new evidence.
create trigger permanent_deletion_fence before insert on private.course_weighted_policies
  for each row execute function private.guard_permanent_deletion();
create trigger permanent_deletion_fence before insert on private.course_weighted_exemptions
  for each row execute function private.guard_permanent_deletion();
create trigger permanent_deletion_fence before insert on private.course_weighted_reviews
  for each row execute function private.guard_permanent_deletion();

revoke all on function private.course_weighted_policy_unused(uuid),
  private.deletion_scope_before_weighted_policy(text, uuid), private.deletion_scope(text, uuid),
  private.prevent_weighted_policy_history_mutation() from public, anon, authenticated, service_role;

COMMIT;
