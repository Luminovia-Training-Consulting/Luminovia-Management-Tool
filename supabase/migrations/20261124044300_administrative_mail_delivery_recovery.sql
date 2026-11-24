begin;

-- A transport exception says nothing about whether the provider accepted an
-- invitation. Only the trusted Edge bridge may record a definite rejection.
alter table public.invitation_requests
  add column delivery_rejected boolean not null default false,
  add column superseded_at timestamptz,
  add column retry_of uuid references public.invitation_requests(id) on delete set null;
create unique index invitation_live_recipient on public.invitation_requests(email)
  where superseded_at is null;
create unique index invitation_one_correction on public.invitation_requests(retry_of)
  where retry_of is not null;
alter table public.invitation_requests drop constraint invitation_requests_email_key;
create index invitation_failed_delivery on public.invitation_requests(completed_at desc, id)
  where status = 'failed' and superseded_at is null;
create index notification_email_failed_delivery on private.notification_email_outbox(finished_at desc, id)
  where state in ('failed', 'uncertain');

do $migration$
declare
  definition text := pg_get_functiondef('private.reserve_account_invitation(text,text,text,uuid,uuid)'::regprocedure);
  anchor constant text := 'from public.invitation_requests where email=normalized';
begin
  if cardinality(string_to_array(definition, anchor)) <> 2 then
    raise exception 'Expected the current invitation recipient lookup';
  end if;
  execute replace(definition, anchor, anchor || ' and superseded_at is null');
end;
$migration$;

create function private.complete_invitation_delivery_failure(
  p_invitation_id uuid, p_definite_rejection boolean
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if current_setting('role', true) is distinct from 'service_role' then
    raise insufficient_privilege;
  end if;
  perform private.complete_account_invitation(p_invitation_id, null, '', false);
  if p_definite_rejection is true then
    update public.invitation_requests set delivery_rejected = true
    where id = p_invitation_id and status = 'failed' and auth_user_id is null;
  end if;
end;
$$;
create function public.complete_invitation_delivery_failure(
  p_invitation_id uuid, p_definite_rejection boolean
) returns void language sql security invoker set search_path = '' as $$
  select private.complete_invitation_delivery_failure(
    p_invitation_id, p_definite_rejection
  );
$$;

create function private.reserve_invitation_delivery_retry(
  p_invitation_id uuid, p_email text, p_request_id uuid
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  source public.invitation_requests%rowtype;
  replacement public.invitation_requests%rowtype;
  result jsonb;
  destination text := lower(btrim(p_email));
begin
  if not private.mail_admin() or not private.has_permission('users.manage')
     or not private.has_permission('users.roles.manage')
     or private.academy_mail_installation() then
    raise insufficient_privilege;
  end if;
  perform 1 from public.profiles where id = actor and active for share;
  if not found or not private.mail_admin() or not private.has_permission('users.manage')
     or not private.has_permission('users.roles.manage') then
    raise insufficient_privilege;
  end if;
  if p_request_id is null or destination is null or length(destination) > 254
     or destination !~ '^[^[:space:]<>@,;]+@[^[:space:]<>@,;]+\.[^[:space:]<>@,;]+$' then
    raise invalid_parameter_value;
  end if;
  perform pg_advisory_xact_lock(pg_catalog.hashtextextended('invite:' || actor::text, 0));
  select * into source from public.invitation_requests where id = p_invitation_id for update;
  if not found or source.status <> 'failed' or not source.delivery_rejected
     or source.auth_user_id is not null or source.requested_role = 'owner'
     or (source.requested_role = 'participant' and source.organisation_id is not null)
     or private.account_authority(actor) <= private.account_role_rank(source.requested_role)
     or (source.organisation_id is not null and not private.has_permission('finance.gross.read')) then
    raise insufficient_privilege;
  end if;
  select * into replacement from public.invitation_requests where retry_of = source.id;
  if found then
    if replacement.actor_id is distinct from actor or replacement.idempotency_key is distinct from p_request_id
       or replacement.email is distinct from destination then
      return jsonb_build_object('status', 'idempotency_conflict');
    end if;
    return jsonb_build_object(
      'status', case replacement.status when 'sent' then 'already_sent'
        when 'reserved' then 'in_progress' else 'failed' end,
      'invitation_id', replacement.id
    );
  end if;
  if source.superseded_at is not null then
    return jsonb_build_object('status', 'idempotency_conflict');
  end if;

  -- Reuse the same role, company, address uniqueness and rate limits as a new
  -- invitation. A failed reservation rolls the source change back.
  begin
    update public.invitation_requests set superseded_at = clock_timestamp() where id = source.id;
    result := private.reserve_account_invitation(destination, source.display_name,
      source.requested_role, source.organisation_id, p_request_id);
    if result->>'status' is distinct from 'reserved' then
      raise exception 'Invitation replacement was not reserved' using errcode = 'PT409';
    end if;
    update public.invitation_requests set retry_of = source.id where id = (result->>'invitation_id')::uuid;
  exception when sqlstate 'PT409' then
    return coalesce(result, jsonb_build_object('status', 'idempotency_conflict'));
  end;
  return result || jsonb_build_object('email', destination, 'display_name', source.display_name,
    'role', source.requested_role, 'organisation_id', source.organisation_id);
end;
$$;

create function public.reserve_invitation_delivery_retry(
  p_invitation_id uuid, p_email text, p_request_id uuid
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.reserve_invitation_delivery_retry(p_invitation_id, p_email, p_request_id);
$$;

alter table private.academy_account_requests
  add column delivery_rejected boolean not null default false,
  add column retry_of uuid references private.academy_account_requests(id) on delete set null;
create unique index academy_invitation_one_correction
  on private.academy_account_requests(retry_of) where retry_of is not null;

-- Complete a definite Auth rejection only when no account was created.
create function private.academy_reject_invitation_delivery(p_creation_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if current_setting('role', true) is distinct from 'service_role'
     or not private.academy_mail_installation() then
    raise insufficient_privilege;
  end if;
  update private.academy_account_requests request
  set status = 'failed', delivery_rejected = true
  where id = p_creation_id and mode = 'invite' and status = 'reserved' and user_id is null
    and not exists (select 1 from auth.users identity where lower(identity.email) = request.email);
  return found;
end;
$$;
create function public.academy_reject_invitation_delivery(p_creation_id uuid)
returns boolean language sql security invoker set search_path = '' as $$
  select private.academy_reject_invitation_delivery(p_creation_id);
$$;

create function private.academy_reserve_invitation_delivery_retry(
  p_invitation_id uuid, p_email text, p_request_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  source private.academy_account_requests%rowtype;
  replacement private.academy_account_requests%rowtype;
  result jsonb;
  destination text := lower(btrim(p_email));
begin
  if not private.academy_mail_installation() then raise insufficient_privilege; end if;
  perform private.require_mail_admin_write();
  if p_request_id is null or destination is null or length(destination) > 254
     or destination !~ '^[^[:space:]<>@,;]+@[^[:space:]<>@,;]+[.][^[:space:]<>@,;]+$' then
    raise invalid_parameter_value;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('academy-local-account:' || actor::text, 0));
  select * into source from private.academy_account_requests where id = p_invitation_id for update;
  if not found or source.mode <> 'invite' or source.status <> 'failed'
     or not source.delivery_rejected or source.user_id is not null or source.company_invitation then
    raise insufficient_privilege;
  end if;
  select * into replacement from private.academy_account_requests where retry_of = source.id;
  if found and (replacement.actor_id, replacement.request_id, replacement.email)
    is distinct from (actor, p_request_id, destination) then
    raise exception 'Invitation retry request conflict' using errcode = 'PT409';
  end if;
  select * into replacement from private.academy_account_requests
  where actor_id = actor and request_id = p_request_id;
  if found and replacement.retry_of is distinct from source.id then
    raise exception 'Invitation retry request conflict' using errcode = 'PT409';
  end if;
  result := private.reserve_academy_account(p_request_id, destination, source.display_name,
    source.role, source.organisation_id, 'invite');
  if result->>'status' = 'reserved' then
    update private.academy_account_requests set retry_of = source.id
    where id = (result->>'creation_id')::uuid;
  end if;
  return result || jsonb_build_object('email', destination, 'display_name', source.display_name,
    'role', source.role, 'organisation_id', source.organisation_id);
end;
$$;
create function public.academy_reserve_invitation_delivery_retry(
  p_invitation_id uuid, p_email text, p_request_id uuid
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.academy_reserve_invitation_delivery_retry(p_invitation_id, p_email, p_request_id);
$$;

create table private.course_mail_delivery_retries (
  outbox_id uuid not null references private.notification_email_outbox(id) on delete cascade,
  failed_at timestamptz not null,
  actor_id uuid references public.profiles(id) on delete set null,
  request_id uuid not null,
  attempt_count integer not null,
  error_code text,
  retried_at timestamptz not null default clock_timestamp(),
  primary key(outbox_id, failed_at),
  unique (outbox_id, request_id)
);
alter table private.course_mail_delivery_retries enable row level security;
revoke all on private.course_mail_delivery_retries from public, anon, authenticated, service_role;

create function private.course_mail_recoverable_kind(p_kind text)
returns boolean language sql immutable security invoker set search_path = '' as $$
  select p_kind in (
    'session_reminder', 'course_preparation_updated', 'course_question', 'course_answer',
    'course_resource_shared', 'course_quiz_published', 'course_attendance_updated',
    'course_schedule_changed', 'academy_course_enrolled', 'course_completion_issued',
    'course_completion_revoked'
  );
$$;

create function private.mail_delivery_failures()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.mail_admin() then raise insufficient_privilege; end if;
  return coalesce((
    select jsonb_agg(item order by failed_at desc, item->>'id')
    from (
      select item, failed_at from (
        select jsonb_build_object(
          'id', invitation.id, 'kind', 'invitation', 'status', case when delivery_rejected then 'failed' else 'uncertain' end,
          'recipient', invitation.email, 'created_at', invitation.created_at,
          'failed_at', coalesce(invitation.completed_at, invitation.created_at), 'error_code', null,
          'retry_allowed', invitation.delivery_rejected and invitation.superseded_at is null
            and invitation.auth_user_id is null and private.has_permission('users.manage')
            and private.has_permission('users.roles.manage') and invitation.requested_role <> 'owner'
            and not (invitation.requested_role = 'participant' and invitation.organisation_id is not null)
            and private.account_authority(auth.uid()) > private.account_role_rank(invitation.requested_role)
            and (invitation.organisation_id is null or private.has_permission('finance.gross.read'))
          ) item, coalesce(invitation.completed_at, invitation.created_at) failed_at
        from public.invitation_requests invitation
        where not private.academy_mail_installation() and (invitation.status = 'failed'
          or (invitation.status = 'reserved' and invitation.created_at < now() - interval '15 minutes'))
          and invitation.superseded_at is null
        union all
        select jsonb_build_object(
          'id', invitation.id, 'kind', 'invitation', 'status', case when invitation.delivery_rejected then 'failed' else 'uncertain' end,
          'recipient', invitation.email, 'created_at', invitation.created_at, 'failed_at', invitation.created_at,
          'error_code', null, 'retry_allowed', invitation.delivery_rejected and invitation.status = 'failed'
            and invitation.user_id is null and not invitation.company_invitation
          ), invitation.created_at
        from private.academy_account_requests invitation
        where private.academy_mail_installation() and invitation.mode = 'invite'
          and (invitation.status in ('failed', 'cleanup')
            or (invitation.status = 'reserved' and invitation.created_at < now() - interval '15 minutes'))
          and not exists (select 1 from private.academy_account_requests later where later.retry_of = invitation.id)
        union all
        select jsonb_build_object(
          'id', outbox.id, 'kind', 'course', 'status', outbox.state,
          'recipient', case when profile.active and identity.email_confirmed_at is not null then identity.email end,
          'created_at', outbox.created_at, 'failed_at', outbox.finished_at, 'error_code', outbox.error_code,
          'retry_allowed', outbox.state = 'failed' and profile.active and identity.email_confirmed_at is not null
            and (select count(*) from private.course_mail_delivery_retries r where r.outbox_id = outbox.id) < 3
          ), outbox.finished_at
        from private.notification_email_outbox outbox
        join public.notifications notice on notice.id = outbox.notification_id
        join public.profiles profile on profile.id = notice.user_id
        left join auth.users identity on identity.id = notice.user_id
        where outbox.state in ('failed', 'uncertain') and outbox.finished_at is not null
          and private.course_mail_recoverable_kind(notice.kind)
      ) failed
      order by failed_at desc, item->>'id' limit 80
    ) recent
  ), '[]'::jsonb);
end;
$$;
create function public.mail_delivery_failures()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.mail_delivery_failures();
$$;

create function private.retry_course_mail_delivery(
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
      join private.delivery_preferences preferences on preferences.user_id = identity.id and preferences.email_enabled
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
create function public.retry_course_mail_delivery(
  p_delivery_id uuid, p_failed_at timestamptz, p_request_id uuid
) returns uuid language sql security invoker set search_path = '' as $$
  select private.retry_course_mail_delivery(p_delivery_id, p_failed_at, p_request_id);
$$;

revoke all on function private.course_mail_recoverable_kind(text),
  private.complete_invitation_delivery_failure(uuid,boolean),
  public.complete_invitation_delivery_failure(uuid,boolean),
  private.academy_reject_invitation_delivery(uuid), public.academy_reject_invitation_delivery(uuid),
  private.academy_reserve_invitation_delivery_retry(uuid,text,uuid), public.academy_reserve_invitation_delivery_retry(uuid,text,uuid),
  private.mail_delivery_failures(), public.mail_delivery_failures(),
  private.reserve_invitation_delivery_retry(uuid,text,uuid), public.reserve_invitation_delivery_retry(uuid,text,uuid),
  private.retry_course_mail_delivery(uuid,timestamptz,uuid), public.retry_course_mail_delivery(uuid,timestamptz,uuid)
from public, anon, authenticated, service_role;
grant execute on function private.complete_invitation_delivery_failure(uuid,boolean),
  public.complete_invitation_delivery_failure(uuid,boolean),
  private.academy_reject_invitation_delivery(uuid), public.academy_reject_invitation_delivery(uuid) to service_role;
grant execute on function private.mail_delivery_failures(), public.mail_delivery_failures(),
  private.academy_reserve_invitation_delivery_retry(uuid,text,uuid), public.academy_reserve_invitation_delivery_retry(uuid,text,uuid),
  private.reserve_invitation_delivery_retry(uuid,text,uuid), public.reserve_invitation_delivery_retry(uuid,text,uuid),
  private.retry_course_mail_delivery(uuid,timestamptz,uuid), public.retry_course_mail_delivery(uuid,timestamptz,uuid) to authenticated;

do $migration$
declare
  definition text := pg_get_functiondef('private.require_academy_course_access()'::regprocedure);
  service_gate text := pg_get_functiondef('public.require_portal_access()'::regprocedure);
  known_path constant text := '''/rpc/finish_academy_account'', ''/rpc/reserve_academy_company_invitation''';
  anchor constant text := '  if request_method = ''POST'' and private.academy_mail_admin(auth.uid()) and (';
begin
  if cardinality(string_to_array(definition, anchor)) <> 2
     or cardinality(string_to_array(service_gate, known_path)) <> 2 then
    raise exception 'Expected Academy mail administration gate';
  end if;
  execute replace(definition, anchor, $guard$
  if private.academy_mail_admin(auth.uid()) and (
    (licence_status in ('active', 'grace') and request_method = 'GET' and request_path = '/rpc/mail_delivery_failures')
    or (licence_status = 'active' and request_method = 'POST' and request_path in (
      '/rpc/retry_course_mail_delivery', '/rpc/academy_reserve_invitation_delivery_retry'
    ))
  ) then return; end if;
$guard$ || anchor);
  execute replace(service_gate, known_path, known_path || ', ''/rpc/academy_reject_invitation_delivery''');
end;
$migration$;

notify pgrst, 'reload schema';
commit;
