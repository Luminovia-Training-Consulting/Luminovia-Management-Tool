begin;

-- Receipts carry only the event kind and an opaque resource ID. Resolve
-- the destination from current account authority instead of storing details.
create function private.notify_invoice_correction()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  lecturer uuid;
  event_kind text;
begin
  if (select edition from private.installation_identity) <> 'internal' then return new; end if;
  select claim.lecturer_id into strict lecturer from public.job_claims claim where claim.id = new.claim_id;
  if tg_op = 'INSERT' then
    event_kind := 'invoice_correction_proposed';
  elsif old.withdrawn_at is null and new.withdrawn_at is not null then
    event_kind := 'invoice_correction_withdrawn';
  elsif old.accepted is null and new.accepted is not null then
    event_kind := case when new.accepted then 'invoice_correction_acknowledged' else 'invoice_correction_disputed' end;
    insert into public.notifications(user_id, kind, resource_id)
    select distinct profile.id, event_kind, new.id
    from public.profiles profile
    join public.user_roles role on role.user_id = profile.id
    join public.role_permissions permission on permission.role = role.role
    where profile.active and profile.id <> lecturer and permission.permission = 'finance.manage'
    on conflict (user_id, kind, resource_id) do nothing;
    return new;
  else
    return new;
  end if;
  if private.lecturer_user(lecturer) then
    insert into public.notifications(user_id, kind, resource_id)
    values (lecturer, event_kind, new.id)
    on conflict (user_id, kind, resource_id) do nothing;
  end if;
  return new;
end;
$$;
create trigger invoice_correction_inbox
after insert or update of accepted, withdrawn_at on private.invoice_series_corrections
for each row execute function private.notify_invoice_correction();

create function private.notify_invoice_correction_repayment()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare event_kind text;
begin
  if (select edition from private.installation_identity) <> 'internal' then return new; end if;
  if tg_op = 'INSERT' and new.voided_at is null then
    event_kind := 'invoice_correction_repayment_recorded';
  elsif tg_op = 'UPDATE' and old.voided_at is null and new.voided_at is not null then
    event_kind := 'invoice_correction_repayment_voided';
  else
    return new;
  end if;
  insert into public.notifications(user_id, kind, resource_id)
  select claim.lecturer_id, event_kind, new.id
  from private.invoice_series_corrections correction
  join public.job_claims claim on claim.id = correction.claim_id
  where correction.id = new.correction_id and private.lecturer_user(claim.lecturer_id)
  on conflict (user_id, kind, resource_id) do nothing;
  return new;
end;
$$;
create trigger invoice_correction_repayment_inbox
after insert or update of voided_at on private.invoice_series_repayments
for each row execute function private.notify_invoice_correction_repayment();

create function private.invoice_correction_notice_href(p_kind text, p_resource uuid)
returns text language plpgsql stable security definer set search_path = ''
as $$
declare
  correction_id uuid := p_resource;
  repayment_voided_at timestamptz;
  correction private.invoice_series_corrections%rowtype;
  lecturer uuid;
begin
  if (select edition from private.installation_identity) <> 'internal' then return null; end if;
  if p_kind in ('invoice_correction_repayment_recorded', 'invoice_correction_repayment_voided') then
    select r.correction_id, r.voided_at into correction_id, repayment_voided_at
    from private.invoice_series_repayments r where r.id = p_resource;
    if not found then return null; end if;
  end if;
  select * into correction from private.invoice_series_corrections c where c.id = correction_id;
  if not found then return null; end if;
  select lecturer_id into strict lecturer from public.job_claims where id = correction.claim_id;

  if p_kind in ('invoice_correction_acknowledged', 'invoice_correction_disputed') then
    if lecturer is distinct from auth.uid() and private.has_permission('finance.manage')
       and correction.withdrawn_at is null
       and correction.accepted is not distinct from (p_kind = 'invoice_correction_acknowledged') then
      return '/finance?series=' || correction.claim_id::text;
    end if;
    return null;
  end if;

  if lecturer is distinct from auth.uid() or not private.lecturer_actor() then return null; end if;
  if (case p_kind
    when 'invoice_correction_proposed' then
      correction.accepted is null and private.invoice_series_correction_current(correction.id)
    when 'invoice_correction_withdrawn' then correction.withdrawn_at is not null
    when 'invoice_correction_repayment_recorded' then
      correction.withdrawn_at is null and repayment_voided_at is null
    when 'invoice_correction_repayment_voided' then
      correction.withdrawn_at is null and repayment_voided_at is not null
    else false end)
  then return '/finance#correction-' || correction.id::text;
  end if;
  return null;
end;
$$;

alter function private.notification_target(text, uuid) rename to notification_target_before_invoice_corrections;
create function private.notification_target(p_kind text, p_resource uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  if p_kind in (
    'invoice_correction_proposed', 'invoice_correction_acknowledged', 'invoice_correction_disputed',
    'invoice_correction_withdrawn', 'invoice_correction_repayment_recorded', 'invoice_correction_repayment_voided'
  ) then
    return jsonb_build_object('href', private.invoice_correction_notice_href(p_kind, p_resource), 'title', '');
  end if;
  return private.notification_target_before_invoice_corrections(p_kind, p_resource);
end;
$$;

-- Retain the function identity used by notification RLS and inbox counts.
do $patch$
declare
  definition text := pg_catalog.pg_get_functiondef('private.notification_currently_visible(text,uuid)'::regprocedure);
  anchor text := 'select case';
begin
  if cardinality(string_to_array(definition, anchor)) <> 2 then
    raise exception 'Expected one inbox visibility decision';
  end if;
  execute replace(definition, anchor, anchor || $branch$
    when p_kind in (
      'invoice_correction_proposed', 'invoice_correction_acknowledged', 'invoice_correction_disputed',
      'invoice_correction_withdrawn', 'invoice_correction_repayment_recorded', 'invoice_correction_repayment_voided'
    ) then private.invoice_correction_notice_href(p_kind, p_resource) is not null$branch$);
end;
$patch$;

revoke all on function private.notify_invoice_correction(), private.notify_invoice_correction_repayment(),
  private.invoice_correction_notice_href(text, uuid), private.notification_target(text, uuid),
  private.notification_target_before_invoice_corrections(text, uuid)
from public, anon, authenticated, service_role;

commit;
