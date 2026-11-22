begin;

-- An explicit, separately authorised subscription reuses the private worker
-- and its versioned integration key without broadening existing course feeds.
alter table private.company_course_webhooks
  add column accounting_issuer uuid references public.profiles(id) on delete cascade,
  add constraint company_webhook_accounting_scope
    check (accounting_issuer is null or not premium_events);
create index company_webhook_accounting_issuer
  on private.company_course_webhooks(accounting_issuer) where accounting_issuer is not null;

alter table private.company_course_webhook_deliveries
  alter column course_id drop not null,
  add column invoice_id uuid,
  drop constraint company_course_webhook_deliveries_event_type_check,
  add constraint company_webhook_delivery_event_scope check (
    (course_id is not null and invoice_id is null and event_type in (
      'course.published','course.updated','course.schedule_changed','course.assignment_changed',
      'course.enrolment_changed','course.exam_published','course.attendance_changed',
      'course.completion_changed','course.material_published'
    )) or (invoice_id is not null and course_id is null
      and premium_version is null and academy_release_commit is null and event_type in (
        'invoice.registered','payment.recorded','payment.reversed','credit_note.applied',
        'credit_note.reversed','refund.recorded','refund.reversed'
      ))
  );

-- Worker sessions cannot impersonate the authorising human. Recheck their
-- current database roles directly, using the generation-independent policy.
create function private.company_accounting_webhook_issuer(p_actor uuid)
returns boolean language sql stable set search_path = '' as $$
  select exists (select 1 from private.installation_identity where edition = 'internal')
    and private.course_index_integration_issuer(p_actor)
    and exists (
      select 1 from public.user_roles role
      join public.role_permissions permission on permission.role = role.role
      where role.user_id = p_actor and permission.permission = 'finance.gross.read'
    );
$$;

create or replace function private.company_course_webhook_has_scope(
  p_key private.company_integration_keys, p_subscription private.company_course_webhooks
)
returns boolean language sql stable set search_path = '' as $$
  select p_subscription.revoked_at is null and p_subscription.integration_version = p_key.version
    and p_key.revoked_at is null and p_key.expires_at > statement_timestamp()
    and exists (select 1 from public.organisations o where o.id = p_key.organisation_id and o.archived_at is null)
    and case when (select edition from private.installation_identity) = 'internal' then
      p_key.purpose = 'course-index' and private.course_index_integration_issuer(p_key.issued_by)
      and (p_subscription.accounting_issuer is null
        or private.company_accounting_webhook_issuer(p_subscription.accounting_issuer))
    else p_subscription.accounting_issuer is null and p_key.purpose = 'academy-webhook'
      and coalesce(private.academy_course_access_status() = 'active', false)
      and private.academy_local_admin(p_key.issued_by)
    end;
$$;

create function private.company_accounting_webhook_subscribe(
  p_organisation uuid,p_integration uuid,p_destination text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  subscription jsonb;
begin
  if not private.company_accounting_webhook_issuer(actor) then raise insufficient_privilege; end if;
  subscription := private.company_course_webhook_subscribe(p_organisation,p_integration,p_destination,false);
  if not private.company_accounting_webhook_issuer(actor) then raise insufficient_privilege; end if;
  update private.company_course_webhooks set accounting_issuer = actor
    where id = (subscription->>'id')::uuid;
  return subscription;
exception
  when program_limit_exceeded then
    raise exception 'At most five active webhook subscriptions are allowed per key'
      using errcode='PT429';
end;
$$;

create function public.company_accounting_webhook_subscribe(
  p_organisation uuid,p_integration uuid,p_destination text
)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.company_accounting_webhook_subscribe(p_organisation,p_integration,p_destination);
$$;

create or replace function private.company_course_webhook_revoke(p_organisation uuid,p_subscription uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.company_course_webhook_admin() then raise insufficient_privilege; end if;
  perform 1 from private.company_course_webhooks s join private.company_integration_keys k on k.id = s.integration_id
    where s.id = p_subscription and k.organisation_id = p_organisation and s.revoked_at is null
      and (s.accounting_issuer is null or private.company_accounting_webhook_issuer(auth.uid()))
    for update of s;
  if not found or not private.company_course_webhook_admin() then raise insufficient_privilege; end if;
  update private.company_course_webhooks set revoked_at = statement_timestamp() where id = p_subscription;
  update private.company_course_webhook_deliveries set state = 'cancelled',lease_token = null
    where subscription_id = p_subscription and state = 'pending';
  insert into public.audit_events(actor_id,action,resource_id,details)
    values(auth.uid(),'integration.webhook_revoked',p_subscription,jsonb_build_object('organisation_id',p_organisation));
end;
$$;

create or replace function private.enqueue_company_course_webhook(
  p_course uuid, p_organisation uuid, p_event text, p_premium boolean default false
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  event_id uuid := gen_random_uuid();
  entitlement_version integer;
  active_release text;
begin
  if (select edition from private.installation_identity) <> 'internal' then
    if private.academy_course_access_status() is distinct from 'active' then return; end if;
    select release_commit into strict active_release from private.academy_course_access;
  elsif p_premium then
    select version into entitlement_version from private.company_premium_settings
    where organisation_id = p_organisation and enabled;
    if not found then return; end if;
  end if;
  insert into private.company_course_webhook_deliveries(
    event_id, subscription_id, course_id, event_type, premium_version, academy_release_commit
  )
    select event_id,s.id,p_course,p_event,entitlement_version,active_release
    from private.company_course_webhooks s join private.company_integration_keys k on k.id = s.integration_id
    where k.organisation_id = p_organisation and s.accounting_issuer is null
      and private.company_course_webhook_has_scope(k,s) and (not p_premium or s.premium_events)
    on conflict(subscription_id,course_id,event_type,source_transaction) do nothing;
end;
$$;

-- Commit an ID-only event alongside each immutable customer ledger entry.
-- Repeat calls return the existing accounting operation and insert no entry.
-- Distinct payments on the same invoice retain distinct IDs even in one commit.
create function private.enqueue_company_accounting_webhook()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  invoice uuid;
  company uuid;
  kind text;
  event_id uuid := gen_random_uuid();
begin
  if not exists (select 1 from private.installation_identity where edition = 'internal') then return new; end if;
  if tg_table_name = 'accounting_customer_invoices' then
    invoice := new.id;
    company := new.organisation_id;
    kind := 'invoice.registered';
  else
    invoice := new.invoice_id;
    select organisation_id into strict company from private.accounting_customer_invoices where id = invoice;
    kind := case tg_table_name
      when 'accounting_customer_payments' then
        case when new.reverses_id is null then 'payment.recorded' else 'payment.reversed' end
      when 'accounting_customer_credit_applications' then
        case when new.reverses_id is null then 'credit_note.applied' else 'credit_note.reversed' end
      when 'accounting_customer_refunds' then
        case when new.reverses_id is null then 'refund.recorded' else 'refund.reversed' end
    end;
  end if;
  insert into private.company_course_webhook_deliveries(event_id,subscription_id,invoice_id,event_type)
    select event_id,s.id,invoice,kind
    from private.company_course_webhooks s
    join private.company_integration_keys k on k.id = s.integration_id
    where k.organisation_id = company and s.accounting_issuer is not null
      and private.company_course_webhook_has_scope(k,s);
  return new;
end;
$$;

create trigger company_accounting_webhook_invoice after insert on private.accounting_customer_invoices
  for each row execute function private.enqueue_company_accounting_webhook();
create trigger company_accounting_webhook_payment after insert on private.accounting_customer_payments
  for each row execute function private.enqueue_company_accounting_webhook();
create trigger company_accounting_webhook_credit after insert on private.accounting_customer_credit_applications
  for each row execute function private.enqueue_company_accounting_webhook();
create trigger company_accounting_webhook_refund after insert on private.accounting_customer_refunds
  for each row execute function private.enqueue_company_accounting_webhook();

-- Use the same eligibility immediately before send as at lease time. An
-- invoice may span several courses. Its own company is the delivery boundary.
create function private.company_webhook_resource_current(
  p_company uuid,p_accounting_issuer uuid,d private.company_course_webhook_deliveries
)
returns boolean language sql stable set search_path = '' as $$
  select case when d.invoice_id is not null then p_accounting_issuer is not null
    and exists (select 1 from private.accounting_customer_invoices i
      where i.id = d.invoice_id and i.organisation_id = p_company)
  else p_accounting_issuer is null
    and exists (select 1 from public.course_runs r where r.id = d.course_id
      and r.organisation_id = p_company and r.published and r.archived_at is null)
    and private.company_course_webhook_delivery_current(p_company,d.premium_version,d.academy_release_commit)
  end;
$$;

create or replace function private.lease_company_course_webhook(p_destinations text[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  leased private.company_course_webhook_deliveries;
begin
  if p_destinations is null or cardinality(p_destinations) not between 1 and 100
    then raise invalid_parameter_value; end if;
  delete from private.company_course_webhook_deliveries where id in (
    select id from private.company_course_webhook_deliveries where occurred_at < statement_timestamp()-interval '30 days'
    order by occurred_at limit 200 for update skip locked
  );
  select d.* into leased from private.company_course_webhook_deliveries d
    join private.company_course_webhooks s on s.id = d.subscription_id
    join private.company_integration_keys k on k.id = s.integration_id
    where d.state = 'pending' and d.attempts < 5 and d.available_at <= statement_timestamp()
      and d.occurred_at >= statement_timestamp()-interval '1 day'
      and (k.organisation_id::text || '/' || s.destination) = any(p_destinations)
      and private.company_course_webhook_has_scope(k,s)
      and private.company_webhook_resource_current(k.organisation_id,s.accounting_issuer,d)
    order by d.available_at,d.id limit 1 for update of d skip locked;
  if not found then return null; end if;
  update private.company_course_webhook_deliveries set lease_token = gen_random_uuid(),
    attempts = attempts+1,available_at = statement_timestamp()+interval '1 minute'
    where id = leased.id returning * into leased;
  return (select jsonb_build_object('id',leased.id,'token',leased.lease_token,
    'destination',k.organisation_id::text || '/' || s.destination)
    from private.company_course_webhooks s join private.company_integration_keys k on k.id = s.integration_id
    where s.id = leased.subscription_id);
end;
$$;

create or replace function private.prepare_company_course_webhook(p_id uuid,p_token uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('destination',k.organisation_id::text || '/' || s.destination,'signing_secret',s.signing_secret,
    'event',jsonb_build_object('id',d.event_id,'type',d.event_type,'version',1,'occurred_at',d.occurred_at)
      || case when d.invoice_id is not null then jsonb_build_object('invoice_id',d.invoice_id)
        else jsonb_build_object('course_id',d.course_id) end)
  from private.company_course_webhook_deliveries d
    join private.company_course_webhooks s on s.id = d.subscription_id
    join private.company_integration_keys k on k.id = s.integration_id
  where d.id = p_id and d.lease_token = p_token and d.state = 'pending' and d.available_at > statement_timestamp()
    and private.company_course_webhook_has_scope(k,s)
    and private.company_webhook_resource_current(k.organisation_id,s.accounting_issuer,d);
$$;

create or replace function private.company_course_webhook_list(p_organisation uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.company_course_webhook_admin() then raise insufficient_privilege; end if;
  return coalesce((
    select jsonb_agg(
      (to_jsonb(summary) - 'accounting_events') ||
        case when summary.accounting_events then jsonb_build_object('accounting_events',true) else '{}'::jsonb end
      order by summary.active desc,summary.created_at desc,summary.id
    )
    from (
      select s.id,s.destination,s.created_at,s.premium_events,k.label as integration_label,
        s.accounting_issuer is not null as accounting_events,
        private.company_course_webhook_has_scope(k,s) as active,
        (select coalesce(jsonb_agg(to_jsonb(recent) order by recent.occurred_at desc,recent.id),'[]'::jsonb)
         from (select id,event_type,occurred_at,attempts,
           case when state = 'pending' and (not private.company_course_webhook_has_scope(k,s)
                or not private.company_course_webhook_delivery_current(k.organisation_id,d.premium_version,d.academy_release_commit)) then 'cancelled'
                when state = 'pending' and available_at <= statement_timestamp()
                    and (attempts >= 5 or occurred_at < statement_timestamp()-interval '1 day') then 'failed'
                else state end as state
           from private.company_course_webhook_deliveries d where d.subscription_id = s.id
           order by d.occurred_at desc,d.id desc limit 10) recent) as deliveries
      from private.company_course_webhooks s join private.company_integration_keys k on k.id = s.integration_id
      where k.organisation_id = p_organisation
        and (s.accounting_issuer is null or private.company_accounting_webhook_issuer(auth.uid()))
      order by active desc,s.created_at desc,s.id limit 100
    ) summary
  ),'[]'::jsonb);
end;
$$;

revoke all on function private.company_accounting_webhook_issuer(uuid),
  private.company_accounting_webhook_subscribe(uuid,uuid,text),
  public.company_accounting_webhook_subscribe(uuid,uuid,text),
  private.enqueue_company_accounting_webhook(),
  private.company_webhook_resource_current(uuid,uuid,private.company_course_webhook_deliveries)
  from public,anon,authenticated,service_role;
grant execute on function private.company_accounting_webhook_subscribe(uuid,uuid,text),
  public.company_accounting_webhook_subscribe(uuid,uuid,text) to authenticated;

notify pgrst, 'reload schema';
commit;
