begin;

-- Channel choices fence outgoing delivery independently of the existing inbox
-- preferences, resource eligibility, email opt-out and device consent.
alter table private.notification_preferences
  add column delivery_channels jsonb not null default '{}'::jsonb,
  add column delivery_channels_version integer not null default 0
    check (delivery_channels_version >= 0);

create function private.notification_channel_categories(p_channel text)
returns text[] language sql immutable set search_path = '' as $$
  select array['chat','forum','job_updates','assignments','courses','events','invoices']
    || case when p_channel = 'email' then array['company_orders'] else array[]::text[] end
    || array['reminders','announcements','other'];
$$;

-- Map existing external event kinds only. The fallback can suppress a future
-- kind once its existing producer has independently made it eligible.
create function private.notification_channel_category(p_kind text)
returns text language sql immutable set search_path = '' as $$
  select case
    when p_kind in ('chat_message','course_question','course_answer') then 'chat'
    when p_kind = 'forum_reply' then 'forum'
    when p_kind in ('course_offer_published','job_reopened','job_matching','job_waitlist_available')
      then 'job_updates'
    when p_kind in ('claim_confirmed','claim_cancelled','contract_available','substitution_proposed','substitution_closed')
      then 'assignments'
    when p_kind in ('academy_course_enrolled','course_preparation_updated','course_resource_shared',
      'course_quiz_published','course_attendance_updated','course_completion_issued','course_completion_revoked')
      then 'courses'
    when p_kind in ('calendar_invitation','course_schedule_changed','course_start_due','course_start_escalated')
      then 'events'
    when p_kind in ('invoice_submitted','invoice_approved','invoice_paid','invoice_fully_credited',
      'invoice_rejected','invoice_cancelled','payment_received','invoice_review_requested','invoice_received_for_review')
      then 'invoices'
    when p_kind in ('customer_order_submitted','customer_order_lecturer_confirmed') then 'company_orders'
    when p_kind in ('session_reminder','contract_expiring','qualification_expiring','task_assigned','task_due','timesheet_reviewed')
      then 'reminders'
    when p_kind = 'portal_announcement' then 'announcements'
    else 'other'
  end;
$$;

create function private.notification_channel_selected(p_user uuid, p_kind text, p_channel text)
returns boolean language sql stable set search_path = '' as $$
  select not exists (
    select 1 from private.notification_preferences preferences
    where preferences.user_id = p_user
      and preferences.delivery_channels #> array[p_channel,private.notification_channel_category(p_kind)] = 'false'::jsonb
      and exists (select 1 from private.installation_identity where singleton and edition = 'internal')
  );
$$;

create function private.notification_channel_preferences()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare preferences private.notification_preferences;
begin
  if not private.actor_active()
    or not exists (select 1 from private.installation_identity where singleton and edition = 'internal')
    then raise insufficient_privilege; end if;
  select * into preferences from private.notification_preferences where user_id = auth.uid();
  return jsonb_build_object(
    'version', coalesce(preferences.delivery_channels_version, 0),
    'channels', (
      select jsonb_object_agg(channel.name, (
        select jsonb_object_agg(category.name,
          coalesce(preferences.delivery_channels #> array[channel.name,category.name], 'true'::jsonb))
        from unnest(private.notification_channel_categories(channel.name)) category(name)
      )) from unnest(array['email','push']) channel(name)
    )
  );
end;
$$;

create function private.save_notification_channel_preferences(p_payload jsonb, p_expected_version integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare channel text; selections jsonb; categories text[];
begin
  if not exists (select 1 from private.installation_identity where singleton and edition = 'internal')
    then raise insufficient_privilege; end if;
  perform 1 from public.profiles where id = auth.uid() and active for share;
  if not found or not private.actor_active() then raise insufficient_privilege; end if;
  if p_expected_version is null or p_expected_version < 0
    or jsonb_typeof(p_payload) is distinct from 'object'
    then raise exception 'Invalid delivery channel preferences' using errcode = '22023'; end if;
  if not (p_payload ?& array['email','push']) or p_payload - array['email','push'] <> '{}'::jsonb
    then raise exception 'Invalid delivery channel preferences' using errcode = '22023'; end if;
  foreach channel in array array['email','push'] loop
    selections := p_payload -> channel;
    categories := private.notification_channel_categories(channel);
    if jsonb_typeof(selections) is distinct from 'object'
      then raise exception 'Invalid delivery channel preferences' using errcode = '22023'; end if;
    if not (selections ?& categories) or exists (
      select 1 from jsonb_each(selections) item
      where not item.key = any(categories) or jsonb_typeof(item.value) <> 'boolean'
    ) then raise exception 'Invalid delivery channel preferences' using errcode = '22023'; end if;
  end loop;
  update private.notification_preferences
  set delivery_channels = p_payload, delivery_channels_version = delivery_channels_version + 1
  where user_id = auth.uid() and delivery_channels_version = p_expected_version;
  if not found then raise exception 'Delivery channel preferences changed' using errcode = 'PT409'; end if;
  return private.notification_channel_preferences();
end;
$$;

create function public.notification_channel_preferences()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.notification_channel_preferences();
$$;
create function public.save_notification_channel_preferences(p_payload jsonb, p_expected_version integer)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.save_notification_channel_preferences(p_payload,p_expected_version);
$$;

-- Every existing producer, including transactional and first-offer producers,
-- goes through the same gate. Inbox rows remain available after opt-out.
create function private.check_notification_channel_enqueue()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (
    select 1 from public.notifications notice where notice.id = new.notification_id
      and not private.notification_channel_selected(notice.user_id,notice.kind,tg_argv[0])
  ) then return null; end if;
  return new;
end;
$$;
create trigger notification_email_channel_preference
before insert on private.notification_email_outbox
for each row execute function private.check_notification_channel_enqueue('email');
create trigger notification_push_channel_preference
before insert on private.notification_push_outbox
for each row execute function private.check_notification_channel_enqueue('push');

revoke all on function private.notification_channel_categories(text),
  private.notification_channel_category(text),private.notification_channel_selected(uuid,text,text),
  private.check_notification_channel_enqueue()
  from public, anon, authenticated, service_role;
revoke all on function private.notification_channel_preferences(),
  private.save_notification_channel_preferences(jsonb,integer),
  public.notification_channel_preferences(),public.save_notification_channel_preferences(jsonb,integer)
  from public, anon, authenticated, service_role;
grant execute on function private.notification_channel_preferences(),
  private.save_notification_channel_preferences(jsonb,integer),
  public.notification_channel_preferences(),public.save_notification_channel_preferences(jsonb,integer)
  to authenticated;

-- Preparation repeats the check so previously queued items respect a later
-- opt-out. Keep all existing recipient, lease, edition and eligibility checks.
CREATE OR REPLACE FUNCTION private.prepare_notification_email(p_id uuid, p_lease_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
 if not private.notification_channel_selected(n.user_id,n.kind,'email')
 or not coalesce(active_account,false) or (not private.customer_order_mail_kind(n.kind) and not private.notification_email_selected(d.user_id,d.email_enabled,d.version))
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
end;$function$;

CREATE OR REPLACE FUNCTION private.prepare_notification_push(p_id uuid, p_lease_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare o private.notification_push_outbox;s private.push_subscriptions;n public.notifications;d private.delivery_preferences;lang text;defer_until timestamptz;
begin
 perform private.require_email_worker();select * into o from private.notification_push_outbox where id=p_id for update;
 if not found or o.state<>'leased' or o.lease_token is distinct from p_lease_token or o.lease_until<=now() then return null;end if;
 select * into s from private.push_subscriptions where id=o.subscription_id;select * into n from public.notifications where id=o.notification_id;
 select * into d from private.delivery_preferences where user_id=s.user_id;select locale into lang from public.profiles where id=s.user_id and active;
 if not private.notification_channel_selected(n.user_id,n.kind,'push')
 or lang is null or not s.active or s.expires_at<=now() or not (select enabled from private.push_configuration)
 or not private.push_notification_category_enabled(s.user_id,n.kind) or not private.valid_push_endpoint(s.endpoint) or not private.notification_delivery_allowed(n.user_id,n.kind,n.resource_id)
 or s.user_id is distinct from n.user_id
 or (n.kind = 'job_matching' and exists (
   select 1 from public.notifications publication
   join private.notification_push_outbox delivery on delivery.notification_id = publication.id
   where publication.user_id = n.user_id and publication.kind = 'course_offer_published'
     and publication.resource_id = n.resource_id and delivery.subscription_id = o.subscription_id
 ))
 or (n.kind='session_reminder' and not exists(select 1 from public.assignment_sessions a join public.job_claims c on c.id=a.claim_id where a.id=n.resource_id and c.lecturer_id=n.user_id and c.status='confirmed' and a.released_at is null and a.starts_at>now()))
 or (n.kind='contract_expiring' and not exists(select 1 from public.contracts c where c.id=n.resource_id and c.user_id=n.user_id and c.status='active' and c.revoked_at is null and c.effective_from<=now() and c.expires_at>now() and c.expires_at<=now()+interval '30 days'))
 or (n.kind='chat_message' and not exists(select 1 from public.messages m join public.chat_members member on member.room_id=m.room_id and member.user_id=n.user_id where m.id=n.resource_id and m.deleted_at is null and member.removed_at is null and not member.muted))
 or (n.kind in('job_matching','job_reopened') and not exists(select 1 from public.jobs j where j.id=n.resource_id and j.status='published' and (j.claim_deadline is null or j.claim_deadline>now()))) then
 update private.notification_push_outbox set state='suppressed',finished_at=now(),lease_until=null where id=o.id;return null;end if;
 defer_until=private.email_quiet_until(d.time_zone,d.quiet_start,d.quiet_end,now());
 if defer_until is not null then update private.notification_push_outbox set state='pending',available_at=defer_until,lease_until=null,attempts=greatest(0,attempts-1) where id=o.id;return null;end if;
 update private.notification_push_outbox set state='sending',lease_until=now()+interval '5 minutes' where id=o.id;
 return jsonb_build_object('id',o.id,'lease_token',o.lease_token,'device_token',s.device_token,'locale',split_part(lang,'-',1),
 'subscription',jsonb_build_object('endpoint',s.endpoint,'keys',jsonb_build_object('p256dh',s.p256dh,'auth',s.auth_secret)));
end;$function$;

notify pgrst, 'reload schema';
commit;
