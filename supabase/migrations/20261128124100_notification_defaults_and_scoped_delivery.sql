begin;

-- Version 1 belongs to an unconfigured delivery preference. Apply the portal's
-- default at read and dispatch time; retain later explicit choices and leave
-- historical inbox and outbox rows untouched. Apply the new default only to
-- internal operational roles with access to self-service delivery settings.
create function private.notification_email_selected(p_user uuid, p_enabled boolean, p_version integer)
returns boolean language sql stable set search_path = '' as $$
  select coalesce(p_enabled, false) or (coalesce(p_version = 1, false) and exists (
    select 1 from private.installation_identity installation
    join public.user_roles actor_role on actor_role.user_id = p_user
    where installation.singleton and installation.edition = 'internal'
      and actor_role.role in ('owner','admin','management','lecturer','senior_lecturer','client')
  ));
$$;
revoke all on function private.notification_email_selected(uuid,boolean,integer)
from public, anon, authenticated, service_role;

alter table private.notification_preferences
  add column events boolean not null default true,
  add column invoices boolean not null default true;

create or replace function private.notification_preferences() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if not private.actor_active() then
    raise exception 'Account inactive' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'chat', p.chat, 'forum', p.forum, 'job_updates', p.job_updates,
    'reminders', p.reminders, 'events', p.events, 'invoices', p.invoices,
    'version', p.version
  ) into result
  from private.notification_preferences p where p.user_id = auth.uid();
  return result;
end;
$$;

-- An old installed PWA can still send its four existing flags. Missing new
-- flags inherit the stored choice instead of re-enabling an explicit opt-out.
create or replace function private.save_notification_preferences(
  p_payload jsonb, p_expected_version integer
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare p private.notification_preferences;
begin
  if not private.actor_active() then
    raise exception 'Account inactive' using errcode = '42501';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object'
    or not (p_payload ?& array['chat','forum','job_updates','reminders'])
    or exists (
      select 1 from jsonb_each(p_payload) item
      where item.key not in ('chat','forum','job_updates','reminders','events','invoices')
        or jsonb_typeof(item.value) <> 'boolean'
    ) then
    raise exception 'Invalid preferences' using errcode = '22023';
  end if;
  select * into p from private.notification_preferences
  where user_id = auth.uid() for update;
  if not found or p_expected_version is distinct from p.version then
    raise exception 'Preferences changed; reload before saving' using errcode = 'PT409';
  end if;
  update private.notification_preferences
  set chat = (p_payload->>'chat')::boolean,
      forum = (p_payload->>'forum')::boolean,
      job_updates = (p_payload->>'job_updates')::boolean,
      reminders = (p_payload->>'reminders')::boolean,
      events = coalesce((p_payload->>'events')::boolean, p.events),
      invoices = coalesce((p_payload->>'invoices')::boolean, p.invoices),
      version = version + 1, updated_at = now(), last_refresh_at = null
  where user_id = auth.uid();
  return private.notification_preferences();
end;
$$;

-- A committed submission has its own staff receipt. The invoice owner
-- already receives the existing submission confirmation.
create function private.notify_invoice_submission_review()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status <> 'submitted'
    or (tg_op = 'UPDATE' and old.status = new.status)
    or (select edition from private.installation_identity) <> 'internal' then
    return new;
  end if;
  insert into public.notifications(user_id, kind, resource_id)
  select profile.id, 'invoice_received_for_review', new.id
  from public.profiles profile
  where profile.active and profile.id <> new.user_id
    and exists (
      select 1 from public.user_roles role
      join public.role_permissions permission on permission.role = role.role
      where role.user_id = profile.id and permission.permission = 'finance.manage'
    )
  on conflict (user_id, kind, resource_id) do update
    set created_at = clock_timestamp(), read_at = null;
  return new;
end;
$$;
create trigger invoice_submission_review_receipt
after insert or update of status on public.invoices
for each row execute function private.notify_invoice_submission_review();

-- Recheck current authority both in the inbox and at external dispatch.
-- Delayed notifications carry no invoice number, amount, attachment or name.
create function private.invoice_submission_notice_visible(p_resource uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select edition from private.installation_identity) = 'internal'
    and private.has_permission('finance.manage')
    and exists (
      select 1 from public.invoices invoice
      where invoice.id = p_resource and invoice.status = 'submitted'
        and invoice.user_id <> auth.uid()
    );
$$;
revoke all on function private.notify_invoice_submission_review(),
  private.invoice_submission_notice_visible(uuid) from public, anon, authenticated, service_role;

create or replace function private.delivery_preferences()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare p private.delivery_preferences;
begin
 if (select edition from private.installation_identity) <> 'internal' then
  if not private.learning_actor() or
     not coalesce(private.academy_course_access_status() in ('active','grace'),false) then
    raise insufficient_privilege;
  end if;
 else
  if not private.actor_active() then raise insufficient_privilege; end if;
 end if;
 select * into p from private.delivery_preferences where user_id=auth.uid();
 return jsonb_build_object('email_enabled',private.notification_email_selected(p.user_id,p.email_enabled,p.version),'quiet_start',to_char(p.quiet_start,'HH24:MI'),
  'quiet_end',to_char(p.quiet_end,'HH24:MI'),'time_zone',p.time_zone,'version',p.version);
end;$$;

create or replace function private.email_category_enabled(p_user uuid, p_kind text)
returns boolean language sql stable security definer set search_path = '' as $$
 select coalesce((select case
 when p_kind in ('calendar_invitation','course_schedule_changed','course_start_due','course_start_escalated') then p.events
 when private.invoice_owner_delivery_kind(p_kind)
   or p_kind in ('invoice_review_requested','invoice_received_for_review') then p.invoices
 when p_kind in('chat_message','course_question','course_answer') then p.chat
 when p_kind='forum_reply' then p.forum
 when p_kind in('job_reopened','job_matching','job_waitlist_available','course_preparation_updated','course_resource_shared','course_quiz_published','portal_announcement') then p.job_updates
 when p_kind in('session_reminder','contract_expiring','qualification_expiring','task_assigned','task_due','timesheet_reviewed','course_attendance_updated','course_completion_issued','course_completion_revoked') then p.reminders
 else p_kind in('claim_confirmed','claim_cancelled','contract_available','substitution_proposed','substitution_closed') end
 from private.notification_preferences p where p.user_id=p_user),false);
$$;

create or replace function private.notification_target(p_kind text, p_resource uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare heading text;
begin
  if p_kind = 'invoice_received_for_review' then
    return jsonb_build_object('href',
      case when private.invoice_submission_notice_visible(p_resource) then '/finance' end,
      'title', '');
  end if;
  if not private.customer_order_mail_kind(p_kind) then
    return private.notification_target_before_customer_order_receipt(p_kind, p_resource);
  end if;
  heading := private.customer_order_receipt_title(auth.uid(), p_kind, p_resource);
  return jsonb_build_object('href', case when heading is not null then '/client' end, 'title', coalesce(heading, ''));
end;
$$;

create or replace function private.notification_currently_visible(p_kind text, p_resource uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select case
    when p_kind = 'invoice_received_for_review' then private.invoice_submission_notice_visible(p_resource)
    when p_kind = 'calendar_invitation' then private.calendar_invitation_available(p_resource)
    when p_kind in (
      'invoice_correction_proposed', 'invoice_correction_acknowledged', 'invoice_correction_disputed',
      'invoice_correction_withdrawn', 'invoice_correction_repayment_recorded', 'invoice_correction_repayment_voided'
    ) then private.invoice_correction_notice_href(p_kind, p_resource) is not null
    when p_kind in (
    'invoice_review_requested','invoice_exception_available','invoice_exception_revoked',
    'invoice_series_available','invoice_series_revoked'
  )
      then private.invoice_review_receipt_available(p_kind,p_resource)
    when (select edition from private.installation_identity) <> 'internal' then private.academy_notification_target(p_kind,p_resource) is not null
    when private.customer_order_mail_kind(p_kind) then (private.notification_target(p_kind,p_resource)->>'href') is not null
    when p_kind = 'course_offer_published' then (private.notification_target(p_kind,p_resource)->>'href') is not null
    when private.participant_actor() then
      (p_kind = 'chat_message' or left(coalesce(p_kind, ''), 7) = 'course_') and
      coalesce((private.notification_target(p_kind, p_resource)->>'href') is not null, false)
    when p_kind in ('job_matching', 'job_reopened', 'job_waitlist_available') and private.job_lecturer_blocked(p_resource,auth.uid()) then false
    when private.actor_active() then
      case when left(coalesce(p_kind, ''), 7) = 'course_' or p_kind = 'chat_message'
        then coalesce((private.notification_target(p_kind, p_resource)->>'href') is not null, false)
        else true end
    else false
  end;
$$;

create or replace function private.queue_notification_email()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
 if (select edition from private.installation_identity) <> 'internal' then
  if tg_op = 'UPDATE' and new.created_at is not distinct from old.created_at then return new; end if;
  insert into private.notification_email_outbox(notification_id,occurrence_at,academy_release_commit)
  select new.id,new.created_at,access.release_commit from private.academy_course_access access
  where private.academy_notification_email_current(new.user_id,new.kind,new.resource_id,access.release_commit)
  on conflict do nothing;
  return new;
 end if;
 if tg_op='UPDATE' and new.created_at is not distinct from old.created_at then return new; end if;
 if exists(select 1 from private.delivery_preferences d join public.profiles p on p.id=d.user_id
  where d.user_id=new.user_id and private.notification_email_selected(d.user_id,d.email_enabled,d.version) and p.active
    and exists (select 1 from auth.users identity
      where identity.id = new.user_id and identity.email_confirmed_at is not null))
 and private.email_category_enabled(new.user_id,new.kind) then
  insert into private.notification_email_outbox(notification_id,occurrence_at)
   values(new.id,new.created_at) on conflict do nothing;
 end if;
 return new;
end;$$;

create or replace function private.prepare_notification_email(p_id uuid, p_lease_token uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare o private.notification_email_outbox; n public.notifications; d private.delivery_preferences;
 recipient text; lang text; active_account boolean; defer_until timestamptz; offer jsonb;
begin
 perform private.require_email_worker();
 select * into o from private.notification_email_outbox where id=p_id for update;
 if not found or o.state<>'leased' or o.lease_token is distinct from p_lease_token or o.lease_until<=now() then return null; end if;
 select * into n from public.notifications where id=o.notification_id;
 select * into d from private.delivery_preferences where user_id=n.user_id;
 select u.email,p.locale,p.active into recipient,lang,active_account from public.profiles p
  join auth.users u on u.id=p.id and u.email_confirmed_at is not null where p.id=n.user_id;
 if n.kind = 'course_offer_published' and (select edition from private.installation_identity) = 'internal' then
  offer := private.course_offer_mail_payload(n.user_id, n.resource_id);
 end if;
 if not coalesce(active_account,false) or (not private.customer_order_mail_kind(n.kind) and not private.notification_email_selected(d.user_id,d.email_enabled,d.version))
 or not (case when (select edition from private.installation_identity) = 'internal' then
  o.academy_release_commit is null and case when n.kind = 'course_offer_published' then offer is not null
    when private.customer_order_mail_kind(n.kind)
    then private.customer_order_receipt_title(n.user_id,n.kind,n.resource_id) is not null
    else private.email_category_enabled(n.user_id,n.kind)
      and private.notification_delivery_allowed(n.user_id,n.kind,n.resource_id) end
  else n.created_at = o.occurrence_at and
    private.academy_notification_email_current(n.user_id,n.kind,n.resource_id,o.academy_release_commit)
 end) or recipient is null
 or recipient!~'^[^[:space:]<>@,;]+@[^[:space:]<>@,;]+\.[^[:space:]<>@,;]+$'
 or length(recipient)>254
 or (n.kind = 'job_matching' and exists (
   select 1 from private.course_offer_mail_publications publication where publication.job_id = n.resource_id
 ))
 or (n.kind='session_reminder' and not exists(select 1 from public.assignment_sessions s
  join public.job_claims c on c.id=s.claim_id where s.id=n.resource_id and c.lecturer_id=n.user_id
   and c.status='confirmed' and s.released_at is null and s.starts_at>now()))
 or (n.kind='contract_expiring' and not exists(select 1 from public.contracts c
  where c.id=n.resource_id and c.user_id=n.user_id and c.status='active' and c.revoked_at is null
   and c.effective_from<=now() and c.expires_at>now() and c.expires_at<=now()+interval '30 days'))
 or (n.kind='chat_message' and not exists(select 1 from public.messages m
  join public.chat_members member on member.room_id=m.room_id and member.user_id=n.user_id
  where m.id=n.resource_id and m.deleted_at is null and member.removed_at is null and not member.muted))
 or (n.kind in ('job_matching','job_reopened') and not exists(select 1 from public.jobs j
  where j.id=n.resource_id and j.status='published' and (j.claim_deadline is null or j.claim_deadline>now()))) then
  update private.notification_email_outbox set state='suppressed',finished_at=now(),lease_until=null,
   error_code='recipient_or_preferences_changed' where id=o.id;
  return null;
 end if;
 defer_until=private.email_quiet_until(d.time_zone,d.quiet_start,d.quiet_end,now());
 if defer_until is not null then
  update private.notification_email_outbox set state='pending',available_at=defer_until,lease_until=null,
   attempts=greatest(0,attempts-1),error_code='quiet_hours' where id=o.id;
  return null;
 end if;
 update private.notification_email_outbox set state='sending',lease_until=now()+interval '5 minutes',error_code=null where id=o.id;
 return jsonb_build_object('id',o.id,'lease_token',o.lease_token,'recipient',recipient,'locale',split_part(lang,'-',1),'kind',n.kind,
  'message_id','<luminovia-notification.'||o.id||'@luminovia.org>') || case when offer is not null
   then jsonb_build_object('offer', offer) else '{}'::jsonb end;
end;$$;

create or replace function private.course_offer_mail_recipient(p_user_id uuid, p_job_id uuid)
returns boolean language sql stable set search_path = '' as $$
  select private.course_offer_notice_recipient(p_user_id, p_job_id) and exists (
    select 1 from auth.users identity
    join private.delivery_preferences delivery on delivery.user_id = identity.id
      and private.notification_email_selected(delivery.user_id,delivery.email_enabled,delivery.version)
    where identity.id = p_user_id and identity.email_confirmed_at is not null
      and length(identity.email) <= 254
      and identity.email ~ '^[^[:space:]<>@,;]+@[^[:space:]<>@,;]+\.[^[:space:]<>@,;]+$'
  );
$$;

create or replace function private.refresh_notification_reminders(p_limit integer DEFAULT 100)
returns integer language plpgsql security definer set search_path = '' as $$
declare account_id uuid; added integer; total integer:=0;
begin
 perform private.require_email_worker();
 if (select edition from private.installation_identity) <> 'internal' then return 0; end if;
 if p_limit is null or p_limit not between 1 and 100 then raise exception 'Invalid reminder batch size' using errcode='22023'; end if;
 for account_id in select d.user_id from private.delivery_preferences d
  join public.profiles p on p.id=d.user_id join private.notification_preferences n on n.user_id=d.user_id
  join auth.users identity on identity.id = d.user_id and identity.email_confirmed_at is not null
  where private.notification_email_selected(d.user_id,d.email_enabled,d.version) and p.active and n.reminders
   and (d.last_reminder_scan_at is null or d.last_reminder_scan_at<=now()-interval '15 minutes')
  order by d.last_reminder_scan_at nulls first,d.user_id for update of d skip locked limit p_limit
 loop
  insert into public.notifications(user_id,kind,resource_id)
  select account_id,'session_reminder',s.id from public.assignment_sessions s join public.job_claims c on c.id=s.claim_id
   where c.lecturer_id=account_id and c.status='confirmed' and s.released_at is null
    and s.starts_at>now() and s.starts_at<=now()+interval '24 hours'
   order by s.starts_at limit 200 on conflict do nothing;
  get diagnostics added=row_count;total=total+added;
  insert into public.notifications(user_id,kind,resource_id)
  select account_id,'contract_expiring',c.id from public.contracts c
   where c.user_id=account_id and c.status='active' and c.revoked_at is null
    and c.effective_from<=now() and c.expires_at>now() and c.expires_at<=now()+interval '30 days'
   order by c.expires_at limit 200 on conflict do nothing;
  get diagnostics added=row_count;total=total+added;
  total=total+private.generate_due_work_notifications(account_id);
  update private.delivery_preferences set last_reminder_scan_at=now() where user_id=account_id;
 end loop;
 return total;
end;$$;

create or replace function private.retry_course_mail_delivery(
  p_delivery_id uuid, p_failed_at timestamptz, p_request_id uuid
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  delivery private.notification_email_outbox%rowtype;
  notice public.notifications%rowtype;
  previous private.course_mail_delivery_retries%rowtype;
begin
  perform private.require_mail_admin_write();
  if not private.academy_mail_installation() then
    perform 1 from public.profiles where id = auth.uid() and active for share;
    if not found or not private.mail_admin() then raise insufficient_privilege; end if;
  end if;
  if p_delivery_id is null or p_failed_at is null or not isfinite(p_failed_at) or p_request_id is null then
    raise invalid_parameter_value;
  end if;
  select * into delivery from private.notification_email_outbox where id = p_delivery_id for update;
  if not found then raise insufficient_privilege; end if;
  select * into notice from public.notifications where id = delivery.notification_id;
  if not found or not private.course_mail_recoverable_kind(notice.kind) then
    raise insufficient_privilege;
  end if;
  select * into previous from private.course_mail_delivery_retries
    where outbox_id = delivery.id and request_id = p_request_id;
  if found then
    if previous.actor_id is distinct from auth.uid() or previous.failed_at is distinct from p_failed_at then
      raise exception 'Delivery retry request conflict' using errcode = 'PT409';
    end if;
    return delivery.id;
  end if;
  if delivery.state <> 'failed' or delivery.finished_at is distinct from p_failed_at
     or notice.created_at is distinct from delivery.occurrence_at
     or (select count(*) from private.course_mail_delivery_retries where outbox_id = delivery.id) >= 3 then
    raise exception 'Delivery is no longer retryable' using errcode = 'PT409';
  end if;
  if not exists (select 1 from auth.users identity
      join public.profiles profile on profile.id = identity.id and profile.active
      join private.delivery_preferences preferences on preferences.user_id = identity.id
        and private.notification_email_selected(preferences.user_id,preferences.email_enabled,preferences.version)
      where identity.id = notice.user_id and identity.email_confirmed_at is not null)
     or not (case when private.academy_mail_installation() then
       private.academy_notification_email_current(notice.user_id, notice.kind, notice.resource_id, delivery.academy_release_commit)
     else private.email_category_enabled(notice.user_id, notice.kind)
       and private.notification_delivery_allowed(notice.user_id, notice.kind, notice.resource_id)
     end) then
    raise exception 'Recipient, preferences or course access changed' using errcode = 'PT409';
  end if;
  insert into private.course_mail_delivery_retries(outbox_id, failed_at, actor_id, request_id, attempt_count, error_code)
    values (delivery.id, p_failed_at, auth.uid(), p_request_id, delivery.attempts, delivery.error_code);
  update private.notification_email_outbox
  set state = 'pending', attempts = 0, available_at = clock_timestamp(), lease_token = null,
      lease_until = null, last_outcome = null, error_code = null, finished_at = null, academy_authorized_at = null
  where id = delivery.id;
  insert into public.audit_events(actor_id, action, resource_id)
    values (auth.uid(), 'mail.course_delivery_requeued', delivery.id);
  return delivery.id;
end;
$$;

commit;
