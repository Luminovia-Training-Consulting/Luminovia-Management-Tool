begin;

insert into public.role_permissions(role, permission) values
  ('management', 'audit.read'), ('admin', 'audit.clear'), ('owner', 'audit.clear')
on conflict do nothing;

-- Extend the reviewed metadata vocabulary. Private chat, personal calendars
-- and contract contents never enter the operational projection.
alter function private.admin_audit_actions() rename to admin_audit_actions_before_expansion;
create function private.admin_audit_actions() returns text[]
language sql immutable set search_path = '' as $$
  select array(select distinct action from unnest(
    private.admin_audit_actions_before_expansion() || array[
      'academy.account.created','academy.course.published','academy.instructor.assigned','academy.instructor.released',
      'account.creation_failed','account.access_mail_requested','account.access_mail_failed',
      'accounting.customer_credit_note_registered','accounting.customer_invoice_registered','accounting.export_created',
      'announcement.archived','announcement.draft_saved','announcement.published','announcement.recovered',
      'assignment.change.apply','assignment.change.submit','assignment.change.coordinate','assignment.change.accept',
      'assignment.change.reject','assignment.change.withdraw','assignment.deletion.applied','assignment.emergency_day_released',
      'assignment.lecturer_replaced','assignment.manually_confirmed','assignment.substitution_accepted','assignment.substitution_proposed',
      'calendar.global_save','calendar.global_publish','calendar.global_unpublish','calendar.global_archive','calendar.global_recover',
      'claim.confirmed','company.dispatch_contact_changed','company.lecturer_added','company.lecturer_removed','company.premium.updated',
      'company.lecturer_rejection_finance_review','company.lecturer_rejection_released','company.rejection_finance_resolved',
      'company.participant_class_changed','company.participant_invitation_reserved','company.participant_link_accepted',
      'company.participant_membership_removed','company.participant_placement_saved','company.participant_reference_changed',
      'course.attendance_imported','course.class.changed','course.completion_revoked','course.contact_changed',
      'course.exam_requirement_changed','course.meeting_link.updated','course.review.deleted','course.review.moderated',
      'course.preparation_changed','course.readiness_changed','course.start_policy_changed','course.closeout_changed','course.resources_changed',
      'course_exam.grades_published','course_exam.grades_saved','course_exam.schedule_saved',
      'course_submissions.disabled','course_submissions.enabled',
      'forum.answer_selected','forum.post_deleted','forum.report_reviewed','forum.thread_metadata_updated','forum.thread_moderated',
      'integration.webhook_created','integration.webhook_revoked',
      'invoice.exception_approved','invoice.exception_revoked','invoice.labels_changed',
      'invoice.review_requested','invoice.review_resolved','invoice.reviewed','invoice.series_approved',
      'invoice.series_correction_acknowledged','invoice.series_correction_disputed','invoice.series_correction_proposed',
      'invoice.series_correction_withdrawn','invoice.series_revoked','invoice.submitted',
      'job.briefing.saved','job.company_assigned','job.dispatch_saved','job.lifecycle.edit_metadata','job.reopened_after_assignment_release',
      'knowledge.category_saved','learning.program.enrolled','learning.program.saved',
      'mail.course_delivery_requeued','mail.delivery_accepted','mail.delivery_failed','mail.delivery_suppressed','mail.delivery_uncertain',
      'qualification.expertise_selection_changed','replacement.cancelled','replacement.completed','replacement.opened',
      'replacement.superseded_by_directed_handover','support.created','timesheet.saved','wiki.revision_saved'
    ]) action order by action);
$$;

create function private.capture_activity_state() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  current_row jsonb := to_jsonb(new);
  previous_row jsonb := to_jsonb(old);
  actor uuid := auth.uid();
  target uuid;
  activity text;
begin
  case tg_table_name
    when 'job_claims' then
      if current_row->>'status' = 'confirmed' then
        activity := 'claim.confirmed';
        actor := coalesce(actor, (current_row->>'lecturer_id')::uuid);
        target := (current_row->>'id')::uuid;
      end if;
    when 'notification_email_outbox' then
      if (current_row->>'state') is distinct from (previous_row->>'state')
        and current_row->>'state' in ('accepted','failed','suppressed','uncertain') then
        activity := 'mail.delivery_' || (current_row->>'state');
        actor := null;
        target := (current_row->>'id')::uuid;
      end if;
    when 'account_creation_requests' then
      if (current_row->>'status') is distinct from (previous_row->>'status') and current_row->>'status' = 'failed' then
        activity := 'account.creation_failed';
        actor := (current_row->>'actor_id')::uuid;
        target := (current_row->>'id')::uuid;
      end if;
    when 'company_dispatch_settings', 'course_workspace_settings' then
      if tg_op <> 'UPDATE' or (current_row->>'contact_id') is distinct from (previous_row->>'contact_id') then
        if tg_table_name = 'company_dispatch_settings' then
          activity := 'company.dispatch_contact_changed';
          target := coalesce(current_row->>'organisation_id', previous_row->>'organisation_id')::uuid;
        else
          activity := 'course.contact_changed';
          target := coalesce(current_row->>'run_id', previous_row->>'run_id')::uuid;
        end if;
      end if;
    when 'course_preparation_items', 'course_resources', 'course_readiness_settings', 'course_closeout_reviews', 'course_start_policies' then
      if current_row is distinct from previous_row then
        activity := case tg_table_name
          when 'course_preparation_items' then 'course.preparation_changed'
          when 'course_resources' then 'course.resources_changed'
          when 'course_readiness_settings' then 'course.readiness_changed'
          when 'course_closeout_reviews' then 'course.closeout_changed'
          when 'course_start_policies' then 'course.start_policy_changed'
        end;
        target := coalesce(current_row->>'course_run_id', previous_row->>'course_run_id',
          current_row->>'run_id', previous_row->>'run_id')::uuid;
      end if;
  end case;
  if activity is not null then
    perform private.write_admin_activity(actor,activity,target,'{}'::jsonb);
  end if;
  return null;
end;
$$;

create trigger administration_activity_claim after insert on public.job_claims
  for each row execute function private.capture_activity_state();
create trigger administration_activity_mail_outcome after update of state on private.notification_email_outbox
  for each row execute function private.capture_activity_state();
create trigger administration_activity_failed_account after update of status on private.account_creation_requests
  for each row execute function private.capture_activity_state();
create trigger administration_activity_dispatch_contact after insert or update of contact_id or delete on private.company_dispatch_settings
  for each row execute function private.capture_activity_state();
create trigger administration_activity_course_contact after insert or update of contact_id or delete on private.course_workspace_settings
  for each row execute function private.capture_activity_state();
create trigger administration_activity_course_preparation after insert or update or delete on private.course_preparation_items
  for each row execute function private.capture_activity_state();
create trigger administration_activity_course_resources after insert or update of removed_at or delete on private.course_resources
  for each row execute function private.capture_activity_state();
create trigger administration_activity_course_readiness after insert or update or delete on private.course_readiness_settings
  for each row execute function private.capture_activity_state();
create trigger administration_activity_course_closeout after insert or update or delete on private.course_closeout_reviews
  for each row execute function private.capture_activity_state();
create trigger administration_activity_course_start after insert or update of responsible_user_id,backup_user_id or delete on private.course_start_policies
  for each row execute function private.capture_activity_state();


-- The Edge function records only whether Auth accepted the request, never
-- the email address, credential or recovery URL.
create function public._record_account_access_mail(p_creation_id uuid,p_requested boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  request private.account_creation_requests;
begin
  if (auth.jwt()->>'role') is distinct from 'service_role' then raise insufficient_privilege; end if;
  if p_requested is null then raise invalid_parameter_value; end if;
  select * into strict request from private.account_creation_requests where id=p_creation_id and status='created';
  perform private.write_admin_activity(request.actor_id,
    case when p_requested then 'account.access_mail_requested' else 'account.access_mail_failed' end,
    request.auth_user_id, '{}'::jsonb);
end;
$$;

create function private.clear_administration_activity(p_confirm boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  removed bigint;
begin
  if (select edition from private.installation_identity where singleton) is distinct from 'internal'
    or not private.has_permission('audit.clear') or not private.has_role(array['admin','owner']) then
    raise insufficient_privilege;
  end if;
  if p_confirm is distinct from true then raise invalid_parameter_value; end if;
  -- Serialize whole-log clears with projection inserts. Source receipts,
  -- transactional records, files and accounts are outside this operation.
  lock table private.administration_activity in share row exclusive mode;
  delete from private.administration_activity;
  get diagnostics removed = row_count;
  return jsonb_build_object('removed',removed);
end;
$$;

create function public.clear_administration_activity(p_confirm boolean) returns jsonb
language sql security invoker set search_path = '' as $$
  select private.clear_administration_activity(p_confirm);
$$;

revoke all on function private.admin_audit_actions(), private.capture_activity_state()
  from public, anon, authenticated, service_role;
revoke all on function public._record_account_access_mail(uuid,boolean)
  from public, anon, authenticated, service_role;
grant execute on function public._record_account_access_mail(uuid,boolean) to service_role;
revoke all on function private.clear_administration_activity(boolean), public.clear_administration_activity(boolean)
  from public, anon, authenticated, service_role;
grant execute on function private.clear_administration_activity(boolean), public.clear_administration_activity(boolean)
  to authenticated;

notify pgrst, 'reload schema';
commit;
