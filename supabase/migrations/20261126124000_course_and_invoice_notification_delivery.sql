begin;

-- Do not expose or replay historical email-only receipts during an upgrade.
alter table private.course_offer_mail_publications add column portal_notice boolean not null default false;

create function private.course_offer_notice_recipient(p_user_id uuid, p_job_id uuid) returns boolean
language sql stable set search_path = '' as $$
  select private.lecturer_user(p_user_id) and exists (
    select 1 from public.jobs job
    join public.course_runs run on run.id = job.course_run_id
    join private.notification_preferences preference on preference.user_id = p_user_id and preference.job_updates
    where job.id = p_job_id and job.status = 'published'
      and not private.job_lecturer_blocked(job.id, p_user_id)
      and private.job_subject_matches(job.id, p_user_id)
      and (not (job.company_internal or run.own_lecturers_only) or exists (
        select 1 from private.active_company_lecturers(run.organisation_id) lecturer where lecturer.id = p_user_id
      ))
  );
$$;

create or replace function private.course_offer_mail_recipient(p_user_id uuid, p_job_id uuid) returns boolean
language sql stable set search_path = '' as $$
  select private.course_offer_notice_recipient(p_user_id, p_job_id) and exists (
    select 1 from auth.users identity
    join private.delivery_preferences delivery on delivery.user_id = identity.id and delivery.email_enabled
    where identity.id = p_user_id and identity.email_confirmed_at is not null
      and length(identity.email) <= 254
      and identity.email ~ '^[^[:space:]<>@,;]+@[^[:space:]<>@,;]+\.[^[:space:]<>@,;]+$'
  );
$$;

create or replace function private.queue_course_offer_publication_mail() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and old.status <> 'draft' then return null; end if;
  if (select edition from private.installation_identity) is distinct from 'internal'
    or not private.complete_course_offer_for_mail(new.id) then return null; end if;

  insert into private.course_offer_mail_publications(job_id, portal_notice)
  values(new.id, true) on conflict do nothing;
  if not found then return null; end if;

  -- The ordinary insert trigger queues Push. The special, personalised email
  -- independently checks confirmed address and consent before queueing.
  with notices as (
    insert into public.notifications(user_id, kind, resource_id)
    select preference.user_id, 'course_offer_published', new.id
    from private.notification_preferences preference
    where preference.job_updates and private.course_offer_notice_recipient(preference.user_id, new.id)
    on conflict do nothing returning id, user_id, created_at
  )
  insert into private.notification_email_outbox(notification_id, occurrence_at)
  select id, created_at from notices where private.course_offer_mail_recipient(user_id, new.id);
  return null;
end;
$$;

-- Use the existing scoped target resolver at both inbox read and dispatch.
alter function private.notification_target(text, uuid) rename to notification_target_before_course_publication;
create function private.notification_target(p_kind text, p_resource uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare heading text;
begin
  if p_kind <> 'course_offer_published' then
    return private.notification_target_before_course_publication(p_kind, p_resource);
  end if;
  if (select edition from private.installation_identity) = 'internal'
    and private.complete_course_offer_for_mail(p_resource)
    and private.course_offer_notice_recipient(auth.uid(), p_resource) then
    select job.title into heading from private.course_offer_mail_publications publication
    join public.jobs job on job.id = publication.job_id
    where job.id = p_resource and publication.portal_notice and private.can_read_job(job.id);
  end if;
  return jsonb_build_object('href', case when heading is not null then '/jobs/' || p_resource end,
    'title', coalesce(heading, ''));
end;
$$;

-- A fixed allowlist of owner-facing invoice changes; drafts, staff queues and
-- unknown future kinds do not automatically become external notifications.
create function private.invoice_owner_delivery_kind(p_kind text) returns boolean
language sql immutable set search_path = '' as $$
  select p_kind in ('invoice_submitted','invoice_approved','invoice_paid','invoice_fully_credited',
    'invoice_rejected','invoice_cancelled','payment_received');
$$;

create function private.push_notification_category_enabled(p_user uuid, p_kind text) returns boolean
language sql stable set search_path = '' as $$
  select case when p_kind = 'course_offer_published' then exists (
    select 1 from private.notification_preferences where user_id = p_user and job_updates
  ) else private.email_category_enabled(p_user, p_kind) end;
$$;

-- Patch the active routines in place, keeping their stored dependencies and
-- the existing worker leases, edition gates, quiet hours and other categories.
do $migration$
declare change record; definition text;
begin
  for change in select * from (values
    ('private.notification_currently_visible(text,uuid)'::regprocedure,
      $old$when p_kind = 'course_offer_published' then false$old$,
      $new$when p_kind = 'course_offer_published' then (private.notification_target(p_kind,p_resource)->>'href') is not null$new$),
    ('private.email_category_enabled(uuid,text)'::regprocedure,
      $old$else p_kind in('claim_confirmed'$old$,
      $new$else private.invoice_owner_delivery_kind(p_kind) or p_kind in('claim_confirmed'$new$),
    ('private.notification_delivery_allowed(uuid,text,uuid)'::regprocedure,
      $old$  if p_kind = 'substitution_closed' then$old$,
      $new$  if private.invoice_owner_delivery_kind(p_kind) and not exists (
    select 1 from public.invoices invoice where invoice.id = p_resource and invoice.user_id = p_user
  ) then return false; end if;
  if p_kind = 'substitution_closed' then$new$),
    ('private.prepare_notification_email(uuid,uuid)'::regprocedure,
      $old$ or length(recipient)>254$old$,
      $new$ or length(recipient)>254
 or (private.invoice_owner_delivery_kind(n.kind) and not exists (
   select 1 from auth.users identity where identity.id = n.user_id and identity.email_confirmed_at is not null
 ))$new$),
    ('private.queue_notification_push()'::regprocedure,
      'private.email_category_enabled(new.user_id,new.kind)',
      'private.push_notification_category_enabled(new.user_id,new.kind)'),
    ('private.prepare_notification_push(uuid,uuid)'::regprocedure,
      'private.email_category_enabled(s.user_id,n.kind)',
      'private.push_notification_category_enabled(s.user_id,n.kind)'),
    ('private.prepare_notification_push(uuid,uuid)'::regprocedure,
      $old$ or (n.kind='session_reminder'$old$,
      $new$ or s.user_id is distinct from n.user_id
 or (n.kind = 'job_matching' and exists (
   select 1 from public.notifications publication
   join private.notification_push_outbox delivery on delivery.notification_id = publication.id
   where publication.user_id = n.user_id and publication.kind = 'course_offer_published'
     and publication.resource_id = n.resource_id and delivery.subscription_id = o.subscription_id
 ))
 or (n.kind='session_reminder'$new$)
  ) as changes(routine, anchor, replacement)
  loop
    definition := pg_get_functiondef(change.routine);
    if cardinality(string_to_array(definition, change.anchor)) <> 2 then
      raise exception 'Expected one notification delivery integration point in %', change.routine;
    end if;
    execute replace(definition, change.anchor, change.replacement);
  end loop;
end;
$migration$;

revoke all on function private.course_offer_notice_recipient(uuid,uuid),
  private.notification_target(text,uuid), private.notification_target_before_course_publication(text,uuid),
  private.invoice_owner_delivery_kind(text), private.push_notification_category_enabled(uuid,text)
from public, anon, authenticated, service_role;

commit;