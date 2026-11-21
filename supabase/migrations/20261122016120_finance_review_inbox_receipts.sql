begin;

-- Finance receipts contain no amount, note or contractual metadata.
create function private.notify_invoice_review_request()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.status <> 'pending' or
     (tg_op = 'UPDATE' and old.status = new.status) or
     (select edition from private.installation_identity) <> 'internal' then
    return new;
  end if;
  insert into public.notifications(user_id, kind, resource_id)
  select distinct profile.id, 'invoice_review_requested', new.id
  from public.profiles profile
  join public.user_roles role on role.user_id = profile.id
  join public.role_permissions permission on permission.role = role.role
  where profile.active and permission.permission = 'finance.manage'
  on conflict (user_id,kind,resource_id)
  do update set created_at = clock_timestamp(), read_at = null;
  return new;
end;
$$;

create trigger invoice_review_request_receipt
after insert or update of status on private.invoice_review_requests
for each row execute function private.notify_invoice_review_request();

create function private.notify_invoice_exception_decision()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  prefix text := tg_argv[0];
  event_kind text;
begin
  if (select edition from private.installation_identity) <> 'internal' then return new; end if;
  if tg_op = 'INSERT' and new.revoked_at is null then
    event_kind := prefix || '_available';
  elsif tg_op = 'UPDATE' and old.revoked_at is null and new.revoked_at is not null then
    event_kind := prefix || '_revoked';
  else
    return new;
  end if;
  insert into public.notifications(user_id, kind, resource_id)
  select claim.lecturer_id, event_kind, new.id
  from public.job_claims claim where claim.id = new.claim_id
    and private.lecturer_user(claim.lecturer_id)
  on conflict (user_id,kind,resource_id) do nothing;
  return new;
end;
$$;

create trigger invoice_exception_decision_receipt
after insert or update of revoked_at on private.invoice_exception_approvals
for each row execute function private.notify_invoice_exception_decision('invoice_exception');

create trigger invoice_series_decision_receipt
after insert or update of revoked_at on private.invoice_series_approvals
for each row execute function private.notify_invoice_exception_decision('invoice_series');

create function private.invoice_review_receipt_available(p_kind text,p_resource uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select (select edition from private.installation_identity) = 'internal' and
    case p_kind
      when 'invoice_review_requested' then
        private.has_permission('finance.manage') and exists (
          select 1 from private.invoice_review_requests review
          where review.id = p_resource and review.status = 'pending'
        )
      when 'invoice_exception_available' then
        private.lecturer_actor() and exists (
          select 1 from private.invoice_exception_approvals approval
          join public.job_claims claim on claim.id = approval.claim_id
          where approval.id = p_resource and claim.lecturer_id = auth.uid()
            and approval.revoked_at is null
            and approval.basis = private.invoice_exception_basis(claim.id)
            and not exists (
              select 1 from public.invoice_items item where item.claim_id = claim.id and item.active
            )
        )
      when 'invoice_series_available' then
        private.lecturer_actor() and exists (
          select 1 from private.invoice_series_approvals approval
          join public.job_claims claim on claim.id = approval.claim_id
          where approval.id = p_resource and claim.lecturer_id = auth.uid()
            and private.invoice_series_usable(approval.id)
        )
      when 'invoice_series_revoked' then
        private.lecturer_actor() and exists (
          select 1 from private.invoice_series_approvals approval
          join public.job_claims claim on claim.id = approval.claim_id
          where approval.id = p_resource and claim.lecturer_id = auth.uid()
            and approval.revoked_at is not null
        )
      when 'invoice_exception_revoked' then
        private.lecturer_actor() and exists (
          select 1 from private.invoice_exception_approvals approval
          join public.job_claims claim on claim.id = approval.claim_id
          where approval.id = p_resource and claim.lecturer_id = auth.uid()
            and approval.revoked_at is not null
        )
      else false
    end;
$$;

-- A closed zero balance has no cash payment. Preserve the legacy invoice
-- status for reporting while using the accurate receipt at the boundary.
create or replace function private.notify_invoice_activity()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare event_kind text;
begin
  if tg_op = 'UPDATE' and old.status = new.status then return new; end if;
  event_kind := case when new.status = 'paid' and new.total_amount = 0 and new.series_approval_id is not null
    then 'invoice_fully_credited' else 'invoice_' || new.status end;
  insert into public.notifications(user_id, kind, resource_id)
  values (new.user_id, event_kind, new.id)
  on conflict (user_id,kind,resource_id)
  do update set created_at = clock_timestamp(), read_at = null;
  return new;
end;
$$;

-- Keep the exact edition and participant checks of the existing inbox.
alter function private.notification_target(text,uuid) rename to notification_target_before_invoice_reviews;
create function private.notification_target(p_kind text,p_resource uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  if p_kind in (
    'invoice_review_requested','invoice_exception_available','invoice_exception_revoked',
    'invoice_series_available','invoice_series_revoked'
  ) then
    return jsonb_build_object('href',
      case when private.invoice_review_receipt_available(p_kind,p_resource) then '/finance' end,
      'title','');
  end if;
  return private.notification_target_before_invoice_reviews(
    case when p_kind = 'invoice_fully_credited' then 'invoice_paid' else p_kind end,
    p_resource
  );
end;
$$;

-- Keep the existing visibility function's identity: RLS policies have a
-- stored dependency on it, including the direct Realtime notification feed.
do $patch$
declare
  definition text := pg_catalog.pg_get_functiondef(
    'private.notification_currently_visible(text,uuid)'::regprocedure
  );
  anchor text := 'select case';
begin
  if cardinality(string_to_array(definition,anchor)) <> 2 then
    raise exception 'Expected one inbox visibility decision';
  end if;
  execute replace(definition,anchor,anchor || $branch$
    when p_kind in (
    'invoice_review_requested','invoice_exception_available','invoice_exception_revoked',
    'invoice_series_available','invoice_series_revoked'
  )
      then private.invoice_review_receipt_available(p_kind,p_resource)$branch$);
end;
$patch$;

revoke all on function private.notify_invoice_review_request(), private.notify_invoice_exception_decision(),
  private.invoice_review_receipt_available(text,uuid), private.notification_target(text,uuid),
  private.notification_target_before_invoice_reviews(text,uuid)
from public,anon,authenticated,service_role;

commit;
