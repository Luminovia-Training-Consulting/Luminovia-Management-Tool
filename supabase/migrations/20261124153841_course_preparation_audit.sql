begin;

-- Reuse the retained activity projection and its existing permission and expiry
-- rules. These events already carry a course ID without copying private content.
alter function private.admin_audit_actions() rename to admin_audit_actions_before_preparation;
create function private.admin_audit_actions() returns text[]
language sql immutable set search_path = '' as $$
  select array(
    select distinct action
    from unnest(private.admin_audit_actions_before_preparation() || array[
      'course.preparation.instructions_acknowledged',
      'course.preparation.sessions_confirmed'
    ]) action
    order by action
  );
$$;
revoke all on function private.admin_audit_actions(),
  private.admin_audit_actions_before_preparation()
  from public, anon, authenticated, service_role;

commit;
