begin;

-- A short-lived operational projection must not expire immutable accounting,
-- deletion and workflow receipts that the application still resolves.
create table private.administration_activity (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  action text not null,
  resource_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  resource_kind text,
  changed_fields text[]
);

alter table private.administration_activity enable row level security;
revoke all on private.administration_activity from public, anon, authenticated, service_role;
create index administration_activity_time on private.administration_activity (created_at desc, id desc);

alter function private.admin_audit_actions() rename to admin_audit_actions_before_activity;
create function private.admin_audit_actions() returns text[]
language sql immutable set search_path = '' as $$
  select array(select distinct action from unnest(
    private.admin_audit_actions_before_activity() || array[
      'academy.white_label.changed','academy.branding.changed','academy.brand_links.changed',
      'academy.logo.changed','academy.pwa_icon.changed',
      'academy.support.granted','academy.support.revoked','academy.organisation.created','academy.account.reactivated','academy.account.suspended',
      'academy.account.role_changed','academy.management.delegated','academy.management.revoked',
      'academy.course.schedule_updated','academy.course.capacity_updated',
      'company.lecturer_blocked','company.lecturer_unblocked',
      'compensation.policy_changed','lecturer.compensation_changed',
      'mail.saved','mail.smtp_tested','mail.imap_tested',
      'integration.created','integration.rotated','integration.revoked',
      'enquiry.received','enquiry.status','enquiry.assign','enquiry.link_customer','enquiry.create_customer','enquiry.convert','enquiry.note',
      'account.created','account.profile_updated','document.uploaded','document.file_downloaded',
      'invoice.payment_recorded','invoice.payment_voided','invoice.series_repayment_recorded','invoice.series_repayment_voided',
      'accounting.customer_payment_recorded','accounting.customer_payment_reversed',
      'accounting.customer_refund_recorded','accounting.customer_refund_reversed'
    ]) action order by action);
$$;
revoke all on function private.admin_audit_actions(), private.admin_audit_actions_before_activity()
  from public, anon, authenticated, service_role;

-- Do not copy raw audit JSON. Only retain an enumerated deletion kind or
-- names of changed setup fields, never their values or an operator secret.
create function private.project_administration_activity(
  p_id uuid, p_actor_id uuid, p_action text, p_resource_id uuid, p_details jsonb, p_created_at timestamptz
) returns void
language plpgsql security invoker set search_path = '' as $$
declare
  kind text;
  fields text[];
begin
  if p_created_at <= statement_timestamp() - interval '720 hours'
     or not coalesce(p_action = any(private.admin_audit_actions()), false) then return; end if;
  if p_action in ('resource.deletion.confirmed', 'resource.deletion.completed') then
    kind := p_details->>'kind';
    if not coalesce(kind = any(array[
      'account','job','assignment','organisation','organisation_contact','course_template',
      'course_run','course_session','topic','building_block','announcement','global_event'
    ]), false) then return; end if;
  elsif p_action = 'academy.white_label.changed' and jsonb_typeof(p_details->'fields') = 'array' then
    select array_agg(distinct field order by field) into fields
    from jsonb_array_elements_text(p_details->'fields') as item(field)
    where field in ('name','short_name','theme_color','support_url','privacy_url','legal_url','terms_url');
  end if;
  insert into private.administration_activity(id,actor_id,action,resource_id,created_at,resource_kind,changed_fields)
  values(p_id,p_actor_id,p_action,p_resource_id,p_created_at,kind,fields)
  on conflict (id) do nothing;
end;
$$;

create function private.capture_administration_activity() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.project_administration_activity(new.id,new.actor_id,new.action,new.resource_id,new.details,new.created_at);
  return new;
end;
$$;

create trigger capture_administration_activity after insert on public.audit_events
  for each row execute function private.capture_administration_activity();

-- New gateway receipts are private operational data only.
create function private.write_admin_activity(p_actor_id uuid, p_action text, p_resource_id uuid, p_details jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  perform private.project_administration_activity(gen_random_uuid(),p_actor_id,p_action,p_resource_id,p_details,clock_timestamp());
end;
$$;

create function private.capture_support_grant_activity() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform private.write_admin_activity(new.granted_by,'academy.support.granted',new.id,'{}'::jsonb);
  elsif old.revoked_at is null and new.revoked_at is not null then
    perform private.write_admin_activity(new.revoked_by,'academy.support.revoked',new.id,'{}'::jsonb);
  end if;
  return new;
end;
$$;

create trigger capture_support_grant_activity after insert or update of revoked_at
  on private.academy_support_grants for each row execute function private.capture_support_grant_activity();

create function private.capture_mail_activity() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.write_admin_activity(new.actor_id,'mail.' || new.action,null,'{}'::jsonb);
  return new;
end;
$$;

create trigger capture_mail_activity after insert on private.mail_configuration_audit
  for each row execute function private.capture_mail_activity();

create function private.prune_administration_activity() returns integer
language sql security invoker set search_path = '' as $$
  with due as (
    select id from private.administration_activity
    where created_at <= statement_timestamp() - interval '720 hours'
    order by created_at,id limit 10000 for update skip locked
  ), removed as (
    delete from private.administration_activity activity using due
    where activity.id=due.id returning activity.id
  )
  select count(*)::integer from removed;
$$;

revoke all on function
  private.project_administration_activity(uuid,uuid,text,uuid,jsonb,timestamptz),
  private.capture_administration_activity(),
  private.capture_support_grant_activity(),
  private.capture_mail_activity(),
  private.write_admin_activity(uuid,text,uuid,jsonb),
  private.prune_administration_activity()
from public, anon, authenticated, service_role;

-- Existing readers begin with the same permitted recent receipts.
select private.project_administration_activity(e.id,e.actor_id,e.action,e.resource_id,e.details,e.created_at)
  from public.audit_events e
  where e.created_at > statement_timestamp() - interval '720 hours'
    and e.action = any(private.admin_audit_actions());

-- Supabase migration users need not be superusers. The owned local/self-hosted
-- database start calls this as supabase_admin when extension setup is needed.
create function private.ensure_administration_activity_schedule() returns boolean
language plpgsql security invoker set search_path = '' as $$
declare
  scheduled_job bigint;
  use_socket boolean := current_user = 'supabase_admin'
    and current_setting('cron.use_background_workers', true) = 'off';
begin
  if current_database() is distinct from current_setting('cron.database_name', true)
     or not ('pg_cron' = any(regexp_split_to_array(current_setting('shared_preload_libraries'), '\s*,\s*'))) then
    return false;
  end if;
  if not exists (select 1 from pg_extension where extname='pg_cron') then
    if not exists (select 1 from pg_roles where rolname=current_user and rolsuper) then
      return false;
    end if;
    create extension pg_cron with schema pg_catalog;
  end if;
  if not has_schema_privilege(current_user, 'cron', 'USAGE') then return false; end if;
  if exists (select 1 from cron.job where jobname='portal-administration-activity-retention'
    and command='select private.prune_administration_activity()' and active
    and (not use_socket or nodename='')) then return true; end if;
  scheduled_job := cron.schedule('portal-administration-activity-retention', '*/15 * * * *',
    'select private.prune_administration_activity()');
  if use_socket then
    -- Use the same local socket as the owned database bootstrap, without
    -- introducing a TCP database password or changing unrelated cron jobs.
    update cron.job set nodename='' where jobid=scheduled_job;
  end if;
  return true;
end;
$$;
revoke all on function private.ensure_administration_activity_schedule()
  from public, anon, authenticated, service_role;
select private.ensure_administration_activity_schedule();

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
begin
  if not private.has_permission('audit.read') or
    ((select edition from private.installation_identity) <> 'internal' and
      (not private.academy_administration_actor(auth.uid())
       or private.academy_course_access_status() not in ('active','grace'))) then
    raise insufficient_privilege;
  end if;
  if not isfinite(range_from) or not isfinite(range_to) or range_from >= range_to
    or range_to-range_from > interval '93 days 2 hours'
    or p_action is null or (p_action <> '' and not (p_action = any(private.admin_audit_actions())))
    or p_search is null or length(p_search) > 160 or p_limit is null or p_limit not between 1 and 100
    or ((p_before_at is null) <> (p_before_id is null))
    or (p_before_at is not null and (not isfinite(p_before_at) or p_before_at < range_from or p_before_at >= range_to))
  then raise invalid_parameter_value; end if;
  with page as materialized (
    select e.id, coalesce(p.display_name, '') actor_name, e.action, e.resource_id, e.created_at,
      e.resource_kind, e.changed_fields
    from private.administration_activity e
    left join public.profiles p on p.id=e.actor_id
    where e.created_at > retained_from and e.created_at >= range_from and e.created_at < range_to
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
    'from',range_from,'to',range_to,'actions',private.admin_audit_actions());
end;
$$;

-- Extend the existing dedicated catalogue read branch, keeping its session,
-- entitlement and method checks. The audit RPC also checks audit authority.
do $gate$
declare
  definition text := pg_get_functiondef('private.require_academy_course_access()'::regprocedure);
  anchor constant text := '''/rpc/academy_administration'',';
begin
  if cardinality(string_to_array(definition,anchor)) <> 2 then
    raise exception 'Expected dedicated administration read gate';
  end if;
  execute replace(definition,anchor,anchor || ' ''/rpc/admin_audit_events'',');
end;
$gate$;
notify pgrst, 'reload schema';

commit;
