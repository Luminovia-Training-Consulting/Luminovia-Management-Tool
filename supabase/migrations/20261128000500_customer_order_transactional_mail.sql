begin;

create table private.customer_order_receipts (
  notification_id uuid primary key references public.notifications(id) on delete cascade,
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  request_id uuid unique references private.client_course_requests(id) on delete cascade,
  claim_id uuid unique references public.job_claims(id) on delete cascade,
  check ((request_id is null) <> (claim_id is null))
);
alter table private.customer_order_receipts enable row level security;
revoke all on private.customer_order_receipts from public, anon, authenticated, service_role;

-- Resolve ownership from the same current links that authorize company
-- decisions. Disagreement between these links cannot mail either tenant.
create function private.customer_order_job_organisation(p_job_id uuid) returns uuid
language sql stable set search_path = '' as $$
  select min(links.organisation_id::text)::uuid
  from (
    select request.organisation_id from private.client_course_requests request
    where request.job_id = p_job_id
    union all
    select offer.organisation_id from private.job_commission_offers offer
    where offer.job_id = p_job_id
    union all
    select run.organisation_id from public.jobs job join public.course_runs run on run.id = job.course_run_id
    where job.id = p_job_id
  ) links
  having count(distinct links.organisation_id) = 1;
$$;

create function private.customer_order_mail_kind(p_kind text) returns boolean
language sql immutable set search_path = '' as $$
  select p_kind in ('customer_order_submitted', 'customer_order_lecturer_confirmed');
$$;

create function private.customer_order_contact_accounts(p_organisation_id uuid)
returns table(user_id uuid, email text, membership_created_at timestamptz)
language sql stable set search_path = '' as $$
  select membership.user_id, identity.email, membership.created_at
  from public.client_organisation_memberships membership
  join public.organisations organisation on organisation.id = membership.organisation_id
    and organisation.archived_at is null
  join public.profiles profile on profile.id = membership.user_id and profile.active
  join public.user_roles role on role.user_id = membership.user_id and role.role = 'client'
  join auth.users identity on identity.id = membership.user_id and identity.email_confirmed_at is not null
  where membership.organisation_id = p_organisation_id and membership.removed_at is null
    and length(identity.email) <= 254
    and identity.email ~ '^[^[:space:]<>@,;]+@[^[:space:]<>@,;]+\.[^[:space:]<>@,;]+$';
$$;

create function private.queue_customer_order_receipt(
  p_organisation_id uuid, p_request_id uuid, p_claim_id uuid, p_requester uuid
) returns void language plpgsql set search_path = '' as $$
declare recipient uuid; notice public.notifications; event_kind text; contact_email text;
begin
  if p_organisation_id is null
    or (select edition from private.installation_identity) is distinct from 'internal' then return; end if;
  contact_email := private.dispatch_contact(p_organisation_id)->>'email';
  select account.user_id into recipient
  from private.customer_order_contact_accounts(p_organisation_id) account
  order by (account.user_id = p_requester) desc nulls last,
    (lower(account.email) = lower(contact_email)) desc nulls last,
    account.membership_created_at, account.user_id
  limit 1;
  if recipient is null then return; end if;

  event_kind := case when p_request_id is not null then 'customer_order_submitted'
    else 'customer_order_lecturer_confirmed' end;
  insert into public.notifications(user_id, kind, resource_id)
  values (recipient, event_kind, coalesce(p_request_id, p_claim_id))
  on conflict (user_id, kind, resource_id) do nothing returning * into notice;
  if not found then return; end if;

  insert into private.customer_order_receipts(notification_id, organisation_id, request_id, claim_id)
  values (notice.id, p_organisation_id, p_request_id, p_claim_id)
  on conflict do nothing;
  if not found then
    delete from public.notifications where id = notice.id;
    return;
  end if;

  -- Order receipts are transactional. Optional delivery settings still apply
  -- to the other categories, and any configured quiet hours are respected.
  insert into private.notification_email_outbox(notification_id, occurrence_at)
  values (notice.id, notice.created_at);
end;
$$;

create function private.customer_request_submitted_receipt() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.queue_customer_order_receipt(new.organisation_id, new.id, null, new.requested_by);
  return null;
end;
$$;

create trigger customer_request_submitted_receipt
after insert on private.client_course_requests for each row when (new.status = 'submitted')
execute function private.customer_request_submitted_receipt();

create function private.customer_lecturer_confirmed_receipt() returns trigger
language plpgsql security definer set search_path = '' as $$
declare requester uuid;
begin
  if (tg_op = 'UPDATE' and old.status = new.status) or not exists (
    select 1 from public.job_claims claim where claim.id = new.id and claim.status = 'confirmed'
  ) then return null; end if;
  select request.requested_by into requester
  from private.client_course_requests request where request.job_id = new.job_id;
  perform private.queue_customer_order_receipt(
    private.customer_order_job_organisation(new.job_id), null, new.id, requester);
  return null;
end;
$$;

-- Allocation writers can establish the authoritative ownership links later in
-- the same transaction. Evaluate the final state before queuing the receipt.
create constraint trigger customer_lecturer_confirmed_receipt
after insert or update of status on public.job_claims deferrable initially deferred
for each row when (new.status = 'confirmed')
execute function private.customer_lecturer_confirmed_receipt();

create function private.clean_customer_order_receipt() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.notifications where id = old.notification_id;
  return null;
end;
$$;

create trigger clean_customer_order_receipt after delete on private.customer_order_receipts
for each row execute function private.clean_customer_order_receipt();

alter function private.deletion_scope(text, uuid) rename to deletion_scope_before_customer_order_receipts;
create function private.deletion_scope(p_kind text, p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  scope jsonb := private.deletion_scope_before_customer_order_receipts(p_kind, p_id);
  link record;
  source text;
  source_predicate text;
  receipt_predicate text;
  notification_predicate text;
  outbox_predicate text;
begin
  for link in select * from (values
    ('public.notifications', 'notification_id'),
    ('public.organisations', 'organisation_id'),
    ('private.client_course_requests', 'request_id'),
    ('public.job_claims', 'claim_id')
  ) as links(relation, column_name)
  loop
    source := private.deletion_selector(scope, link.relation);
    if source is not null then
      source_predicate := concat_ws(' or ', source_predicate,
        format('x.%I in (select x.id from %s x where %s)', link.column_name, link.relation, source));
    end if;
  end loop;
  if source_predicate is null then return scope; end if;
  receipt_predicate := format('x.notification_id in (select x.notification_id from private.customer_order_receipts x where %s)', source_predicate);
  notification_predicate := format('x.id in (select x.notification_id from private.customer_order_receipts x where %s)', source_predicate);
  outbox_predicate := format('x.notification_id in (select x.notification_id from private.customer_order_receipts x where %s)', source_predicate);
  return (
    select jsonb_agg(jsonb_build_object('table', relation, 'predicate', predicate) order by first_position)
    from (
      select entry->>'table' relation,
        string_agg('(' || (entry->>'predicate') || ')', ' or ' order by position) predicate,
        min(position) first_position
      from jsonb_array_elements(scope || jsonb_build_array(
        jsonb_build_object('table', 'public.notifications', 'predicate', notification_predicate),
        jsonb_build_object('table', 'private.notification_email_outbox', 'predicate', outbox_predicate),
        jsonb_build_object('table', 'private.customer_order_receipts', 'predicate', receipt_predicate)
      )) with ordinality item(entry, position)
      group by entry->>'table'
    ) grouped
  );
end;
$$;

create trigger permanent_deletion_fence before insert or update or delete on private.customer_order_receipts
for each row execute function private.guard_permanent_deletion();

create function private.customer_order_receipt_title(p_user uuid, p_kind text, p_resource uuid) returns text
language sql stable set search_path = '' as $$
  select case when request.id is not null then request.payload->>'title' else job.title end
  from private.customer_order_receipts receipt
  join public.notifications notice on notice.id = receipt.notification_id
  left join private.client_course_requests request on request.id = receipt.request_id
  left join public.job_claims claim on claim.id = receipt.claim_id
  left join public.jobs job on job.id = claim.job_id
  where notice.user_id = p_user and notice.kind = p_kind and notice.resource_id = p_resource
    and (select edition from private.installation_identity) = 'internal'
    and receipt.organisation_id = coalesce(request.organisation_id, private.customer_order_job_organisation(job.id))
    and (request.id is not null or (claim.status = 'confirmed' and job.status in ('filled', 'published')))
    and exists (
      select 1 from private.customer_order_contact_accounts(receipt.organisation_id) account where account.user_id = p_user
    );
$$;

alter function private.notification_target(text, uuid) rename to notification_target_before_customer_order_receipt;
create function private.notification_target(p_kind text, p_resource uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare heading text;
begin
  if not private.customer_order_mail_kind(p_kind) then
    return private.notification_target_before_customer_order_receipt(p_kind, p_resource);
  end if;
  heading := private.customer_order_receipt_title(auth.uid(), p_kind, p_resource);
  return jsonb_build_object('href', case when heading is not null then '/client' end, 'title', coalesce(heading, ''));
end;
$$;

-- Keep the existing worker claim, lease, quiet-hours and replay behavior.
-- For these two transactional receipts the dedicated current ownership and
-- verified membership check replaces the optional email preference checks.
do $migration$
declare change record; definition text;
begin
  for change in select * from (values
    ('private.notification_currently_visible(text,uuid)'::regprocedure,
      $old$when p_kind = 'course_offer_published' then$old$,
      $new$when private.customer_order_mail_kind(p_kind) then (private.notification_target(p_kind,p_resource)->>'href') is not null
    when p_kind = 'course_offer_published' then$new$),
    ('private.prepare_notification_email(uuid,uuid)'::regprocedure,
      $old$or not coalesce(d.email_enabled,false)$old$,
      $new$or (not private.customer_order_mail_kind(n.kind) and not coalesce(d.email_enabled,false))$new$),
    ('private.prepare_notification_email(uuid,uuid)'::regprocedure,
      $old$else private.email_category_enabled(n.user_id,n.kind)$old$,
      $new$when private.customer_order_mail_kind(n.kind)
    then private.customer_order_receipt_title(n.user_id,n.kind,n.resource_id) is not null
    else private.email_category_enabled(n.user_id,n.kind)$new$)
  ) as changes(routine, anchor, replacement)
  loop
    definition := pg_get_functiondef(change.routine);
    if cardinality(string_to_array(definition, change.anchor)) <> 2 then
      raise exception 'Expected one customer order receipt integration point in %', change.routine;
    end if;
    execute replace(definition, change.anchor, change.replacement);
  end loop;
end;
$migration$;

revoke all on function private.customer_order_job_organisation(uuid),
  private.customer_order_mail_kind(text), private.customer_order_contact_accounts(uuid),
  private.queue_customer_order_receipt(uuid,uuid,uuid,uuid),
  private.customer_request_submitted_receipt(), private.customer_lecturer_confirmed_receipt(),
  private.clean_customer_order_receipt(), private.customer_order_receipt_title(uuid,text,uuid),
  private.notification_target(text,uuid), private.notification_target_before_customer_order_receipt(text,uuid),
  private.deletion_scope(text,uuid), private.deletion_scope_before_customer_order_receipts(text,uuid)
from public, anon, authenticated, service_role;

commit;
