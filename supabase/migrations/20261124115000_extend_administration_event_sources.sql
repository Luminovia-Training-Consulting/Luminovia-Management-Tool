begin;

alter function private.admin_audit_actions() rename to admin_audit_actions_before_delivery_tracking;
create function private.admin_audit_actions() returns text[]
language sql immutable set search_path = '' as $$
  select array(select distinct action from unnest(
    private.admin_audit_actions_before_delivery_tracking() || array[
      'account.username_changed',
      'course.attendance_recorded','course.attendance_evidence_attached','course.enrolment.changed',
      'course.exam_pdf_removed','course.exam_pdf_shared','course_submissions.withdrawn',
      'import.row_applied',
      'push.delivery_accepted','push.delivery_failed','push.delivery_suppressed','push.delivery_uncertain',
      'support.assign','support.links','support.priority','support.reopen','support.status',
      'webhook.delivery_delivered','webhook.delivery_failed','webhook.delivery_cancelled'
    ]) action order by action);
$$;

-- An import receipt is unique and commits in the same transaction as the
-- imported row. Rollbacks and idempotent retries produce no import event.
create function private.capture_import_activity() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.write_admin_activity(new.actor_id, 'import.row_applied', new.row_key, '{}'::jsonb);
  return null;
end;
$$;

create function private.capture_attendance_activity() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.write_admin_activity(new.actor_id, 'course.attendance_recorded', new.session_id, '{}'::jsonb);
  return null;
end;
$$;

-- Terminal queue states only. Never project recipient identities, payloads,
-- provider errors, or intermediate lease/retry updates into the shared log.
create function private.capture_delivery_activity() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.write_admin_activity(null, tg_argv[0] || new.state, new.id, '{}'::jsonb);
  return null;
end;
$$;

create trigger administration_activity_import
  after insert on private.table_import_receipts
  for each row execute function private.capture_import_activity();
create trigger administration_activity_attendance
  after insert on private.course_attendance_audit
  for each row execute function private.capture_attendance_activity();
create trigger administration_activity_push
  after update of state on private.notification_push_outbox
  for each row when (old.state is distinct from new.state
    and new.state in ('accepted','failed','suppressed','uncertain'))
  execute function private.capture_delivery_activity('push.delivery_');
create trigger administration_activity_webhook
  after update of state on private.company_course_webhook_deliveries
  for each row when (old.state is distinct from new.state
    and new.state in ('delivered','failed','cancelled'))
  execute function private.capture_delivery_activity('webhook.delivery_');

revoke all on function private.admin_audit_actions(), private.capture_import_activity(),
  private.capture_attendance_activity(), private.capture_delivery_activity()
  from public, anon, authenticated, service_role;

commit;
