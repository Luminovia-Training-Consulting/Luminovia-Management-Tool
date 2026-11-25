begin;

create table private.course_offer_mail_publications (
  job_id uuid primary key references public.jobs(id) on delete cascade
);
alter table private.course_offer_mail_publications enable row level security;
revoke all on private.course_offer_mail_publications from public, anon, authenticated, service_role;

-- A complete course offer covers all sessions of its run, not a standalone
-- job or a replacement for a subset of sessions.
create function private.complete_course_offer_for_mail(p_job_id uuid) returns boolean
language sql stable set search_path = '' as $$
  select exists (
    select 1 from public.jobs job
    join public.course_runs run on run.id = job.course_run_id and run.archived_at is null
    where job.id = p_job_id and job.status = 'published' and job.urgent_reopened_at is null
      and (job.claim_deadline is null or job.claim_deadline > statement_timestamp())
      and exists (select 1 from public.job_sessions slot where slot.job_id = job.id)
      and not exists (
        select 1 from public.job_sessions slot
        left join public.course_sessions session on session.id = slot.course_session_id
          and session.course_run_id = run.id
          and (session.starts_at, session.ends_at) = (slot.starts_at, slot.ends_at)
        where slot.job_id = job.id and (session.id is null or slot.starts_at <= statement_timestamp())
      ) and not exists (
        select 1 from public.course_sessions session where session.course_run_id = run.id
        and not exists (select 1 from public.job_sessions slot
          where slot.job_id = job.id and slot.course_session_id = session.id)
      )
  );
$$;

create function private.course_offer_mail_recipient(p_user_id uuid, p_job_id uuid) returns boolean
language sql stable set search_path = '' as $$
  select exists (
    select 1 from public.profiles profile
    join auth.users identity on identity.id = profile.id and identity.email_confirmed_at is not null
    join private.delivery_preferences delivery on delivery.user_id = profile.id and delivery.email_enabled
    join private.notification_preferences preference on preference.user_id = profile.id and preference.job_updates
    join public.jobs job on job.id = p_job_id and job.status = 'published'
    join public.course_runs run on run.id = job.course_run_id
    where profile.id = p_user_id and profile.active
      and length(identity.email) <= 254
      and identity.email ~ '^[^[:space:]<>@,;]+@[^[:space:]<>@,;]+\.[^[:space:]<>@,;]+$'
      and private.lecturer_user(profile.id)
      and not private.job_lecturer_blocked(job.id, profile.id)
      and private.job_subject_matches(job.id, profile.id)
      and (not (job.company_internal or run.own_lecturers_only) or exists (
        select 1 from private.active_company_lecturers(run.organisation_id) lecturer where lecturer.id = profile.id
      ))
  );
$$;

create function private.course_offer_mail_payload(p_user_id uuid, p_job_id uuid) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  job public.jobs%rowtype;
  quote jsonb;
begin
  if not private.complete_course_offer_for_mail(p_job_id)
    or not private.course_offer_mail_recipient(p_user_id, p_job_id) then return null; end if;
  select * into job from public.jobs where id = p_job_id and status = 'published';
  if not found then return null; end if;
  if not job.company_internal then quote := private.lecturer_job_quote(p_user_id, p_job_id); end if;
  return jsonb_build_object('id', job.id, 'title', job.title, 'description', job.description,
    'internal', job.company_internal, 'quote', case when quote is not null then jsonb_build_object(
      'total_amount', quote->>'total_amount', 'currency', quote->>'currency') end);
end;
$$;

create function private.queue_course_offer_publication_mail() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and old.status <> 'draft' then return null; end if;
  if (select edition from private.installation_identity) is distinct from 'internal'
    or not private.complete_course_offer_for_mail(new.id) then return null; end if;

  insert into private.course_offer_mail_publications(job_id) values(new.id) on conflict do nothing;
  if not found then return null; end if;

  -- Email-only receipt: do not fan out to push or change the matching inbox.
  with notices as (
    insert into public.notifications(user_id, kind, resource_id)
    select preference.user_id, 'course_offer_published', new.id
    from private.delivery_preferences preference
    where preference.email_enabled and private.course_offer_mail_recipient(preference.user_id, new.id)
    on conflict do nothing returning id, created_at
  )
  insert into private.notification_email_outbox(notification_id, occurrence_at)
  select id, created_at from notices;
  return null;
end;
$$;

create constraint trigger notify_course_offer_mail
after insert or update on public.jobs deferrable initially deferred
for each row when (new.status = 'published')
execute function private.queue_course_offer_publication_mail();

revoke all on function private.complete_course_offer_for_mail(uuid),
  private.course_offer_mail_recipient(uuid,uuid), private.course_offer_mail_payload(uuid,uuid),
  private.queue_course_offer_publication_mail() from public, anon, authenticated, service_role;

do $migration$
declare
  change record;
  definition text;
begin
  for change in select * from (values
    ('private.prepare_notification_email(uuid,uuid)'::regprocedure,
      'recipient text; lang text; active_account boolean; defer_until timestamptz;',
      'recipient text; lang text; active_account boolean; defer_until timestamptz; offer jsonb;'),
    ('private.prepare_notification_email(uuid,uuid)'::regprocedure,
      ' if not coalesce(active_account,false)',
      $new$ if n.kind = 'course_offer_published' and (select edition from private.installation_identity) = 'internal' then
  offer := private.course_offer_mail_payload(n.user_id, n.resource_id);
 end if;
 if not coalesce(active_account,false)$new$),
    ('private.prepare_notification_email(uuid,uuid)'::regprocedure,
      'and private.email_category_enabled(n.user_id,n.kind)' || chr(10) || '    and private.notification_delivery_allowed(n.user_id,n.kind,n.resource_id)',
      $new$and case when n.kind = 'course_offer_published' then offer is not null
    else private.email_category_enabled(n.user_id,n.kind)
      and private.notification_delivery_allowed(n.user_id,n.kind,n.resource_id) end$new$),
    ('private.prepare_notification_email(uuid,uuid)'::regprocedure,
      ' or length(recipient)>254',
      $new$ or length(recipient)>254
 or (n.kind = 'job_matching' and exists (
   select 1 from private.course_offer_mail_publications publication where publication.job_id = n.resource_id
 ))$new$),
    ('private.prepare_notification_email(uuid,uuid)'::regprocedure,
      $old$||o.id||'@luminovia.org>');$old$,
      $new$||o.id||'@luminovia.org>') || case when offer is not null
   then jsonb_build_object('offer', offer) else '{}'::jsonb end;$new$),
    ('private.notification_currently_visible(text,uuid)'::regprocedure,
      'when private.participant_actor() then',
      $new$when p_kind = 'course_offer_published' then false
    when private.participant_actor() then$new$),
    ('private.clean_deleted_job_notifications()'::regprocedure,
      $old$kind in ('job_matching','job_reopened')$old$,
      $new$kind in ('job_matching','job_reopened','course_offer_published')$new$)
  ) as changes(routine, before, after)
  loop
    definition := pg_get_functiondef(change.routine);
    if cardinality(string_to_array(definition, change.before)) <> 2 then
      raise exception 'Expected one course offer email integration point in %', change.routine;
    end if;
    execute replace(definition, change.before, change.after);
  end loop;
end;
$migration$;

commit;