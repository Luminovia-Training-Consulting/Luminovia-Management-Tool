begin;

-- The legacy audit permission also protects deletion evidence. Grant a
-- separate permission to management for the short-lived operational view.
delete from public.role_permissions where role='management' and permission='audit.read';
insert into public.role_permissions(role, permission)
values ('management','audit.activity.read')
on conflict do nothing;

create function private.administration_activity_sources()
returns table (schema_name text, table_name text, resource_key text, scope text)
language sql immutable set search_path = '' as $$
  values
    ('public','profiles','id','all'),
    ('public','profile_details','user_id','all'),
    ('public','user_roles','user_id','all'),
    ('public','organisations','id','all'),
    ('public','organisation_contacts','id','all'),
    ('public','organisation_private_details','organisation_id','all'),
    ('public','client_organisation_memberships','organisation_id','all'),
    ('public','course_templates','id','all'),
    ('public','course_runs','id','all'),
    ('public','course_sessions','id','all'),
    ('public','course_enrolments','course_run_id','all'),
    ('public','jobs','id','all'),
    ('public','job_sessions','id','all'),
    ('public','job_claims','id','all'),
    ('public','topics','id','all'),
    ('public','building_blocks','id','all'),
    ('public','building_block_sources','id','all'),
    ('public','global_events','id','all'),
    ('public','documents','id','job_material'),
    ('public','invoices','id','all'),
    ('public','invoice_items','invoice_id','all'),
    ('public','knowledge_categories','id','all'),
    ('public','wiki_pages','id','all'),
    ('public','wiki_revisions','id','all'),
    ('public','forum_threads','id','all'),
    ('public','forum_posts','id','all'),
    ('private','academy_course_instructors','course_id','all'),
    ('private','academy_management_delegations','user_id','all'),
    ('private','academy_customer_settings','','all'),
    ('private','announcement_publications','revision_id','all'),
    ('private','announcement_revisions','id','all'),
    ('private','assignment_change_requests','id','all'),
    ('private','assignment_amendments','id','all'),
    ('private','assignment_withdrawals','id','all'),
    ('private','client_course_requests','id','all'),
    ('private','company_dispatch_settings','organisation_id','all'),
    ('private','company_lecturers','organisation_id','all'),
    ('private','company_participant_memberships','organisation_id','all'),
    ('private','company_premium_settings','organisation_id','all'),
    ('private','course_class_assignments','course_id','all'),
    ('private','course_classes','id','all'),
    ('private','course_completion_records','run_id','all'),
    ('private','course_exam_settings','run_id','all'),
    ('private','course_meeting_links','course_run_id','all'),
    ('private','course_readiness_tasks','id','all'),
    ('private','course_submission_settings','run_id','all'),
    ('private','course_submissions','run_id','all'),
    ('private','course_timed_exams','run_id','all'),
    ('private','course_workspace_settings','run_id','all'),
    ('private','delivery_records','session_id','all'),
    ('private','delivery_submissions','id','all'),
    ('private','document_storage_limits','','all'),
    ('private','global_event_invitations','event_id','all'),
    ('private','job_briefings','job_id','all'),
    ('private','job_dispatch','job_id','all'),
    ('private','job_substitutions','id','all'),
    ('private','learning_programs','id','all'),
    ('private','learning_program_courses','program_id','all'),
    ('private','learning_program_members','program_id','all'),
    ('private','portal_announcements','id','all'),
    ('private','qualification_states','user_id','all'),
    ('private','replacement_offers','id','all'),
    ('private','support_tickets','id','all'),
    ('private','support_messages','ticket_id','all'),
    ('private','teaching_timesheets','id','all'),
    ('private','website_enquiries','id','all'),
    ('private','work_tasks','id','operations_task'),
    ('private','work_task_templates','id','shared_template');
$$;

alter function private.admin_audit_actions() rename to admin_audit_actions_before_broad_coverage;
create function private.admin_audit_actions() returns text[]
language sql immutable set search_path = '' as $$
  select array(
    select distinct action from (
      select unnest(private.admin_audit_actions_before_broad_coverage() || array[
        'account.auth.created','account.auth.invited','account.auth.updated','account.auth.password_updated','account.auth.deleted',
        'account.creation.reserved',
        'account.invitation.reserved','account.invitation.sent','account.invitation.failed','account.invitation.duplicate',
        'invitation.delivery_rejected','account.username_changed',
        'mail.auth.recovery_requested','mail.auth.confirmation_requested','mail.auth.email_change_requested',
        'mail.auth.accepted','mail.auth.failed','mail.auth.uncertain',
        'assignment.lecturer_replaced','assignment.manually_confirmed',
        'job.company_assigned','job.dispatch_saved','job.briefing.saved',
        'course.class.changed','course.meeting_link.updated','course.attendance_imported',
        'course_exam.schedule_saved','course_exam.grades_saved','course_exam.grades_published',
        'learning.program.saved','learning.program.enrolled',
        'company.participant_placement_saved','company.participant_class_changed',
        'company.lecturer_added','company.lecturer_removed',
        'document.deleted','document.renamed','invoice.submitted','invoice.reviewed',
        'accounting.customer_invoice_registered','accounting.customer_credit_note_registered','accounting.export_created',
        'knowledge.category_saved','wiki.revision_saved'
      ]) as action
      union all
      select 'activity.' || source.table_name || '.' || operation.name
      from private.administration_activity_sources() source
      cross join (values ('created'),('updated'),('deleted')) operation(name)
    ) available order by action
  );
$$;

-- Keep sensitive values and workflow payloads out of the operational store.
-- The row is inspected only to detect a meaningful update, scope and UUID.
create function private.capture_business_activity() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  item jsonb;
  before_item jsonb;
  target uuid;
  operation text;
begin
  if tg_op <> 'INSERT' then before_item := to_jsonb(old); end if;
  if tg_op = 'DELETE' then item := before_item; else item := to_jsonb(new); end if;

  if tg_op = 'UPDATE' and
    (item - array['updated_at','last_seen_at']) = (before_item - array['updated_at','last_seen_at']) then
    return null;
  end if;

  if (tg_argv[1] = 'job_material' and
       not (item->>'kind' = 'material' and item->>'scope' in ('job_before','job_after')))
    or (tg_argv[1] = 'operations_task' and item->>'scope' is distinct from 'operations')
    or (tg_argv[1] = 'shared_template' and item->>'shared' is distinct from 'true') then
    return null;
  end if;

  target := (item->>tg_argv[0])::uuid;
  operation := case tg_op when 'INSERT' then 'created' when 'UPDATE' then 'updated' else 'deleted' end;
  insert into private.administration_activity(actor_id, action, resource_id, resource_kind)
  values (auth.uid(), 'activity.' || tg_table_name || '.' || operation, target, tg_table_name);
  return null;
end;
$$;

do $triggers$
declare
  source record;
  relation regclass;
begin
  for source in select * from private.administration_activity_sources() loop
    relation := format('%I.%I',source.schema_name,source.table_name)::regclass;
    if source.resource_key <> '' and not exists (
      select 1 from pg_attribute
      where attrelid=relation and attname=source.resource_key and not attisdropped
        and atttypid='uuid'::regtype
    ) then raise exception 'Expected UUID key %.%',relation,source.resource_key; end if;
    execute format(
      'create trigger capture_business_activity after insert or update or delete on %s
       for each row execute function private.capture_business_activity(%L,%L)',
      relation,source.resource_key,source.scope
    );
  end loop;
end;
$triggers$;

create function private.capture_account_request_activity() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  action_name text;
  actor uuid;
begin
  case tg_table_name
    when 'account_creation_requests' then
      if tg_op = 'UPDATE' and new.status is not distinct from old.status then return null; end if;
      actor := new.actor_id;
      if new.status = 'reserved' then action_name := 'account.creation.reserved'; end if;
    when 'invitation_requests' then
      if new.delivery_rejected and not old.delivery_rejected then
        actor := new.actor_id;
        action_name := 'invitation.delivery_rejected';
      end if;
    when 'academy_account_requests' then
      actor := new.actor_id;
      if new.mode = 'invite' then
        if tg_op = 'INSERT' and new.status = 'reserved' then action_name := 'account.invitation.reserved';
        elsif tg_op = 'UPDATE' then
          if new.delivery_rejected and not old.delivery_rejected then action_name := 'account.invitation.failed';
          elsif new.status = 'created' and old.status <> 'created' then action_name := 'account.invitation.sent';
          elsif new.status = 'failed' and old.status <> 'failed' then action_name := 'account.invitation.failed';
          end if;
        end if;
      end if;
    when 'company_participant_invitation_dispatches' then
      if tg_op = 'UPDATE' and new.status is not distinct from old.status then return null; end if;
      actor := new.actor_id;
      action_name := case new.status
        when 'pending' then 'account.invitation.reserved'
        when 'sent' then 'account.invitation.sent'
        when 'failed' then 'account.invitation.failed'
        when 'duplicate' then 'account.invitation.duplicate'
      end;
  end case;
  if action_name is not null then
    perform private.write_admin_activity(actor,action_name,new.id,'{}'::jsonb);
  end if;
  return null;
end;
$$;

create trigger capture_account_request_activity after insert or update of status on private.account_creation_requests
  for each row execute function private.capture_account_request_activity();
create trigger capture_account_request_activity after update of delivery_rejected on public.invitation_requests
  for each row execute function private.capture_account_request_activity();
create trigger capture_account_request_activity after insert or update of status,delivery_rejected on private.academy_account_requests
  for each row execute function private.capture_account_request_activity();
create trigger capture_account_request_activity after insert or update of status on private.company_participant_invitation_dispatches
  for each row execute function private.capture_account_request_activity();

-- GoTrue events attest to a request or an account action, not email delivery.
-- Ignore sign-in telemetry, IPs, email addresses and all other Auth payload.
create function private.capture_auth_account_activity() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid;
  action_name text := case new.payload->>'action'
    when 'user_signedup' then 'account.auth.created'
    when 'user_invited' then 'account.auth.invited'
    when 'user_modified' then 'account.auth.updated'
    when 'user_updated_password' then 'account.auth.password_updated'
    when 'user_deleted' then 'account.auth.deleted'
    when 'user_recovery_requested' then 'mail.auth.recovery_requested'
    when 'user_confirmation_requested' then 'mail.auth.confirmation_requested'
    when 'user_email_change_requested' then 'mail.auth.email_change_requested'
  end;
begin
  if action_name is null then return null; end if;
  if action_name like 'account.auth.%' and
     (new.payload->>'actor_id') ~ '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$' then
    actor := (new.payload->>'actor_id')::uuid;
  end if;
  perform private.write_admin_activity(actor,action_name,null,'{}'::jsonb);
  return null;
end;
$$;

do $auth_events$
begin
  if to_regclass('auth.audit_log_entries') is not null then
    create trigger capture_auth_account_activity after insert on auth.audit_log_entries
      for each row execute function private.capture_auth_account_activity();
  end if;
end;
$auth_events$;

revoke all on function private.administration_activity_sources(),
  private.admin_audit_actions(), private.admin_audit_actions_before_broad_coverage(),
  private.capture_business_activity(), private.capture_account_request_activity(), private.capture_auth_account_activity()
from public, anon, authenticated, service_role;

-- Preserve durable source receipts used by business workflows. Close the
-- direct table route so the administration view is the human log boundary.
revoke select on public.audit_events from anon, authenticated;

create function private.can_clear_administration_activity() returns boolean
language sql stable security invoker set search_path = '' as $$
  select private.has_permission('audit.clear') and exists (
    select 1 from public.user_roles
    where user_id=auth.uid() and role in ('owner','admin')
  ) and (
    (select edition from private.installation_identity) = 'internal' or (
      private.academy_administration_actor(auth.uid()) and private.academy_course_access_status() = 'active'
    )
  );
$$;

create or replace function private.clear_administration_activity(p_confirm boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  deleted_count bigint;
begin
  if not private.can_clear_administration_activity() then raise insufficient_privilege; end if;
  if p_confirm is distinct from true then raise invalid_parameter_value; end if;
  lock table private.administration_activity in share row exclusive mode;
  if not private.can_clear_administration_activity() then raise insufficient_privilege; end if;
  delete from private.administration_activity;
  get diagnostics deleted_count = row_count;
  return jsonb_build_object('removed',deleted_count);
end;
$$;

revoke all on function private.can_clear_administration_activity()
from public, anon, authenticated, service_role;

create function private.record_auth_mail_activity(p_outcome text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege; end if;
  if p_outcome is null or p_outcome not in ('accepted','failed','uncertain') then raise invalid_parameter_value; end if;
  perform private.write_admin_activity(null,'mail.auth.' || p_outcome,null,'{}'::jsonb);
end;
$$;

create function public.record_auth_mail_activity(p_outcome text) returns void
language sql security invoker set search_path = '' as $$
  select private.record_auth_mail_activity(p_outcome);
$$;

revoke all on function private.record_auth_mail_activity(text), public.record_auth_mail_activity(text)
from public, anon, authenticated, service_role;
grant execute on function private.record_auth_mail_activity(text), public.record_auth_mail_activity(text)
to service_role;

create or replace function private.admin_audit_events(
  p_from timestamptz default null, p_to timestamptz default null,
  p_action text default '', p_search text default '', p_before_at timestamptz default null,
  p_before_id uuid default null, p_limit integer default 40
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  range_to timestamptz := coalesce(p_to, now());
  range_from timestamptz := coalesce(p_from, range_to - interval '30 days');
  retained_from timestamptz := now() - interval '720 hours';
  event_rows jsonb;
  more boolean;
  cursor jsonb;
  legacy_reader boolean := private.has_permission('audit.read');
  actions text[] := private.admin_audit_actions();
begin
  if not (legacy_reader or private.has_permission('audit.activity.read')) or
    ((select edition from private.installation_identity) <> 'internal' and
      (not private.academy_administration_actor(auth.uid())
       or private.academy_course_access_status() not in ('active','grace'))) then
    raise insufficient_privilege;
  end if;
  if not legacy_reader then
    select array_agg(action order by action) into actions from unnest(actions) action
    where action not in ('course.chat_inspected','course.retained_attendance_inspected',
      'course.retained_files_inspected','course.retained_file_download_authorized','course_submissions.review_accessed');
  end if;
  if not isfinite(range_from) or not isfinite(range_to) or range_from >= range_to
    or range_to-range_from > interval '93 days 2 hours'
    or p_action is null or (p_action <> '' and not (p_action = any(actions)))
    or p_search is null or length(p_search) > 160 or p_limit is null or p_limit not between 1 and 100
    or ((p_before_at is null) <> (p_before_id is null))
    or (p_before_at is not null and (not isfinite(p_before_at) or p_before_at < range_from or p_before_at >= range_to))
  then raise invalid_parameter_value; end if;
  with page as materialized (
    select e.id, coalesce(p.display_name, '') actor_name, e.action, e.resource_id, e.created_at,
      e.resource_kind, e.changed_fields
    from private.administration_activity e
    left join public.profiles p on p.id=e.actor_id
    where e.action = any(actions) and e.created_at > retained_from and e.created_at >= range_from and e.created_at < range_to
      and (p_action='' or e.action=p_action)
      and (p_search='' or strpos(lower(e.action),lower(p_search))>0
        or strpos(lower(coalesce(p.display_name,'')),lower(p_search))>0
        or strpos(coalesce(e.resource_id::text,''),lower(p_search))>0)
      and (p_before_at is null or (e.created_at,e.id)<(p_before_at,p_before_id))
    order by e.created_at desc, e.id desc limit p_limit+1
  ), visible as (
    select * from page order by created_at desc, id desc limit p_limit
  )
  select coalesce((select jsonb_agg(
    (to_jsonb(v) - 'resource_kind' - 'changed_fields') ||
    jsonb_strip_nulls(jsonb_build_object(
      'resource_kind',v.resource_kind,
      'changed_fields',v.changed_fields,
      'payment',case when v.action = any(array[
        'invoice.payment_recorded','invoice.payment_voided','invoice.series_repayment_recorded','invoice.series_repayment_voided',
        'accounting.customer_payment_recorded','accounting.customer_payment_reversed',
        'accounting.customer_refund_recorded','accounting.customer_refund_reversed'
      ]) then private.admin_audit_payment_facts(v.action,v.resource_id) end
    )) order by v.created_at desc, v.id desc) from visible v),'[]'::jsonb),
    (select count(*)>p_limit from page),
    (select jsonb_build_object('at',v.created_at,'id',v.id) from visible v order by v.created_at,v.id limit 1)
  into event_rows, more, cursor;
  return jsonb_build_object('items',event_rows,'has_more',more,'next_cursor',case when more then cursor end,
    'from',range_from,'to',range_to,'actions',actions,
    'can_clear',private.can_clear_administration_activity());
end;
$$;

-- Preserve the licence gate for both dedicated editions. Read access keeps its
-- existing Academy GET/POST registration. A clear is limited to active licences.
do $gate$
declare
  definition text := pg_get_functiondef('private.require_academy_course_access()'::regprocedure);
  service_definition text := pg_get_functiondef('public.require_portal_access()'::regprocedure);
  anchor constant text := '  if request_method = ''POST'' and private.academy_mail_admin(auth.uid()) and (';
  mail_anchor constant text := '''/rpc/get_mail_delivery_transport''';
begin
  if cardinality(string_to_array(definition,anchor)) <> 2
    or cardinality(string_to_array(service_definition,mail_anchor)) <> 2 then
    raise exception 'Expected Academy administration gate';
  end if;
  execute replace(definition,anchor,$rule$
  if request_method = 'POST' and request_path = '/rpc/clear_administration_activity'
    and licence_status = 'active' and private.academy_administration_actor(auth.uid()) then
    return;
  end if;
$rule$ || anchor);
  execute replace(service_definition,mail_anchor,mail_anchor || ', ''/rpc/record_auth_mail_activity''');
end;
$gate$;

notify pgrst, 'reload schema';
commit;
