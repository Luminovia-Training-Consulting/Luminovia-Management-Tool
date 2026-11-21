begin;

-- Subscriptions have the same tenant, issuer and revocation boundary as the
-- courses.read credential they were created for. The destination alias is
-- resolved by the operator's worker, never used as a network address by SQL.
create table private.company_course_webhooks (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid not null references private.company_integration_keys(id) on delete cascade,
  integration_version integer not null,
  destination text not null check (destination ~ '^[a-z][a-z0-9-]{0,39}$'),
  premium_events boolean not null default false,
  signing_secret text not null check (signing_secret ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index company_course_webhooks_integration on private.company_course_webhooks(integration_id);
create table private.company_course_webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null,
  subscription_id uuid not null references private.company_course_webhooks(id) on delete cascade,
  course_id uuid not null,
  event_type text not null check (event_type in (
    'course.published','course.updated','course.schedule_changed','course.assignment_changed',
    'course.enrolment_changed','course.exam_published','course.attendance_changed',
    'course.completion_changed','course.material_published'
  )),
  premium_version integer,
  source_transaction xid8 not null default pg_current_xact_id(),
  occurred_at timestamptz not null default statement_timestamp(),
  available_at timestamptz not null default statement_timestamp(),
  attempts integer not null default 0 check (attempts between 0 and 5),
  lease_token uuid,
  state text not null default 'pending' check (state in ('pending','delivered','failed','cancelled')),
  unique(subscription_id,course_id,event_type,source_transaction)
);
create index company_course_webhook_queue
  on private.company_course_webhook_deliveries(available_at,id) where state='pending';
create index company_course_webhook_history
  on private.company_course_webhook_deliveries(subscription_id,occurred_at desc,id desc);
create index company_course_webhook_retention on private.company_course_webhook_deliveries(occurred_at);
create index company_course_webhook_course_pending
  on private.company_course_webhook_deliveries(course_id) where state='pending';
alter table private.company_course_webhooks enable row level security;
alter table private.company_course_webhook_deliveries enable row level security;
revoke all on private.company_course_webhooks,private.company_course_webhook_deliveries
  from public,anon,authenticated,service_role;

-- Used for enqueue, leasing and the final authorization immediately before a
-- network request. Old leases cannot survive a key rotation or issuer removal.
create function private.company_course_webhook_has_scope(
  p_key private.company_integration_keys, p_subscription private.company_course_webhooks
)
returns boolean language sql stable set search_path='' as $$
  select p_subscription.revoked_at is null and p_subscription.integration_version=p_key.version
    and p_key.revoked_at is null and p_key.expires_at > statement_timestamp()
    and exists(select 1 from public.organisations o where o.id=p_key.organisation_id and o.archived_at is null)
    and exists(select 1 from public.user_roles r join public.profiles p on p.id=r.user_id
      where r.user_id=p_key.issued_by and p.active and r.role in ('admin','owner'));
$$;

create function private.company_course_webhook_subscribe(p_organisation uuid,p_integration uuid,p_destination text,p_premium_events boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  key_row private.company_integration_keys;
  subscription private.company_course_webhooks;
begin
  if not private.company_integration_admin() then raise insufficient_privilege; end if;
  if p_premium_events is null or p_destination is null or p_destination !~ '^[a-z][a-z0-9-]{0,39}$'
    then raise invalid_parameter_value; end if;
  if p_premium_events and not private.is_company_premium_admin() then raise insufficient_privilege; end if;
  -- Match the key issuer's organisation → key lock order. Serializing on
  -- the company also prevents two keys competing for one receiver alias.
  perform 1 from public.organisations where id=p_organisation and archived_at is null for update;
  if not found then raise insufficient_privilege; end if;
  select * into key_row from private.company_integration_keys
    where id=p_integration and organisation_id=p_organisation for update;
  if not found or not private.company_integration_admin() then raise insufficient_privilege; end if;
  if p_premium_events and (not private.is_company_premium_admin() or
    not private.company_premium_enabled(p_organisation)) then raise insufficient_privilege; end if;
  subscription.integration_version:=key_row.version;
  if not private.company_course_webhook_has_scope(key_row,subscription) then raise insufficient_privilege; end if;
  if (select count(*) from private.company_course_webhooks s
      where s.integration_id=key_row.id and s.integration_version=key_row.version
        and s.revoked_at is null)>=5 then raise program_limit_exceeded; end if;
  if exists(select 1 from private.company_course_webhooks s join private.company_integration_keys k on k.id=s.integration_id
      where k.organisation_id=p_organisation and s.destination=p_destination and private.company_course_webhook_has_scope(k,s))
    then raise unique_violation; end if;
  insert into private.company_course_webhooks(integration_id,integration_version,destination,premium_events,signing_secret)
    values(key_row.id,key_row.version,p_destination,p_premium_events,replace(gen_random_uuid()::text || gen_random_uuid()::text,'-',''))
    returning * into subscription;
  insert into public.audit_events(actor_id,action,resource_id,details)
    values(auth.uid(),'integration.webhook_created',subscription.id,jsonb_build_object('organisation_id',p_organisation));
  return jsonb_build_object('id',subscription.id,'signing_secret',subscription.signing_secret);
end;
$$;

create function private.company_course_webhook_revoke(p_organisation uuid,p_subscription uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not private.company_integration_admin() then raise insufficient_privilege; end if;
  perform 1 from private.company_course_webhooks s join private.company_integration_keys k on k.id=s.integration_id
    where s.id=p_subscription and k.organisation_id=p_organisation and s.revoked_at is null for update of s;
  if not found or not private.company_integration_admin() then raise insufficient_privilege; end if;
  update private.company_course_webhooks set revoked_at=statement_timestamp() where id=p_subscription;
  update private.company_course_webhook_deliveries set state='cancelled',lease_token=null
    where subscription_id=p_subscription and state='pending';
  insert into public.audit_events(actor_id,action,resource_id,details)
    values(auth.uid(),'integration.webhook_revoked',p_subscription,jsonb_build_object('organisation_id',p_organisation));
end;
$$;

-- Check the exact entitlement epoch. An off → on switch cannot restore
-- delivery eligibility for learning changes queued during a prior period.
create function private.company_course_webhook_premium_current(p_company uuid,p_version integer)
returns boolean language sql stable set search_path='' as $$
  select p_version is null or exists(
    select 1 from private.company_premium_settings p
      where p.organisation_id=p_company and p.enabled and p.version=p_version
  );
$$;

create function private.company_course_webhook_list(p_organisation uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not private.company_integration_admin() then raise insufficient_privilege; end if;
  return coalesce((
    select jsonb_agg(to_jsonb(summary) order by summary.active desc,summary.created_at desc,summary.id)
    from (
      select s.id,s.destination,s.created_at,s.premium_events,k.label as integration_label,
        private.company_course_webhook_has_scope(k,s) as active,
        (select coalesce(jsonb_agg(to_jsonb(recent) order by recent.occurred_at desc,recent.id),'[]'::jsonb)
         from (select id,event_type,occurred_at,attempts,
           case when state='pending' and (not private.company_course_webhook_has_scope(k,s)
                or not private.company_course_webhook_premium_current(k.organisation_id,d.premium_version)) then 'cancelled'
                when state='pending' and available_at<=statement_timestamp()
                    and (attempts>=5 or occurred_at<statement_timestamp()-interval '1 day') then 'failed'
                else state end as state
           from private.company_course_webhook_deliveries d where d.subscription_id=s.id
           order by d.occurred_at desc,d.id desc limit 10) recent) as deliveries
      from private.company_course_webhooks s join private.company_integration_keys k on k.id=s.integration_id
      where k.organisation_id=p_organisation order by active desc,s.created_at desc,s.id limit 100
    ) summary
  ),'[]'::jsonb);
end;
$$;

-- Transactional outbox: only IDs and an event kind leave Postgres. Draft runs
-- and events for other companies cannot enter a subscription's queue.
create function private.enqueue_company_course_webhook(p_course uuid,p_organisation uuid,p_event text,p_premium boolean default false)
returns void language plpgsql security definer set search_path='' as $$
declare
  event_id uuid:=gen_random_uuid();
  entitlement_version integer;
begin
  if p_premium then
    select version into entitlement_version from private.company_premium_settings p
      where p.organisation_id=p_organisation and p.enabled;
    if not found then return; end if;
  end if;
  -- Repeated changes to one course and event kind in an atomic operation
  -- (for example an attendance import) yield one notification per subscription.
  insert into private.company_course_webhook_deliveries(event_id,subscription_id,course_id,event_type,premium_version)
    select event_id,s.id,p_course,p_event,entitlement_version
    from private.company_course_webhooks s join private.company_integration_keys k on k.id=s.integration_id
    where k.organisation_id=p_organisation and private.company_course_webhook_has_scope(k,s)
      and (not p_premium or s.premium_events)
    on conflict(subscription_id,course_id,event_type,source_transaction) do nothing;
end;
$$;

create function private.company_course_webhook_run_changed()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='DELETE' or (tg_op='UPDATE' and
       (not new.published or new.archived_at is not null or old.organisation_id is distinct from new.organisation_id)) then
    update private.company_course_webhook_deliveries set state='cancelled',lease_token=null
      where course_id=old.id and state='pending';
  end if;
  if tg_op='DELETE' or not new.published or new.archived_at is not null or new.organisation_id is null
    then return null; end if;
  if tg_op='INSERT' or not old.published or old.archived_at is not null or old.organisation_id is distinct from new.organisation_id then
    perform private.enqueue_company_course_webhook(new.id,new.organisation_id,'course.published');
  elsif (old.template_id,old.time_zone) is distinct from (new.template_id,new.time_zone) then
    perform private.enqueue_company_course_webhook(new.id,new.organisation_id,'course.updated');
  end if;
  return null;
end;
$$;

create function private.company_course_webhook_schedule_changed()
returns trigger language plpgsql security definer set search_path='' as $$
declare run public.course_runs;
begin
  if tg_op='UPDATE' and (old.course_run_id,old.starts_at,old.ends_at) is not distinct from
      (new.course_run_id,new.starts_at,new.ends_at) then return null; end if;
  for run in select r.* from public.course_runs r where r.published and r.archived_at is null and
      (r.id=new.course_run_id or r.id=old.course_run_id)
  loop
    perform private.enqueue_company_course_webhook(run.id,run.organisation_id,'course.schedule_changed');
  end loop;
  return null;
end;
$$;

create trigger company_course_webhook_run_changed
  after insert or update or delete on public.course_runs for each row
  execute function private.company_course_webhook_run_changed();
create trigger company_course_webhook_schedule_changed
  after insert or update or delete on public.course_sessions for each row
  execute function private.company_course_webhook_schedule_changed();

-- These notifications deliberately carry no row IDs, participant names,
-- dates, documents or compensation. They indicate a change to a course.
create function private.company_course_webhook_milestone()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  run_id uuid;
  company_id uuid;
  event_kind text;
  premium boolean:=true;
begin
  case tg_table_name
    when 'job_claims' then
      if (tg_op='INSERT' and new.status<>'confirmed') or
        (tg_op='UPDATE' and old.status is not distinct from new.status) then return null; end if;
      select j.course_run_id into run_id from public.jobs j where j.id=new.job_id;
      event_kind:='course.assignment_changed';
      premium:=false;
    when 'course_enrolments' then
      if tg_op='UPDATE' and old.status is not distinct from new.status then return null; end if;
      run_id:=new.course_run_id;
      event_kind:='course.enrolment_changed';
    when 'course_exam_documents' then
      if new.audience<>'students' or new.removed_at is not null or
        (tg_op='UPDATE' and old.removed_at is null) or
        not exists(select 1 from public.document_versions v where v.id=new.version_id and v.status='clean' and v.sha256 is not null) or
        not exists(select 1 from private.course_exam_settings e where e.run_id=new.run_id and e.required)
        then return null; end if;
      run_id:=new.run_id;
      event_kind:='course.exam_published';
    when 'course_exam_settings' then
      if not new.required or (tg_op='UPDATE' and old.required) or not exists(
        select 1 from private.course_exam_documents d join public.document_versions v on v.id=d.version_id
        where d.run_id=new.run_id and d.removed_at is null and d.audience='students' and v.status='clean' and v.sha256 is not null
      ) then return null; end if;
      run_id:=new.run_id;
      event_kind:='course.exam_published';
    when 'course_attendance' then
      if new.state='reported' and new.register_status is null then return null; end if;
      select x.course_run_id into run_id from public.course_sessions x where x.id=new.session_id;
      event_kind:='course.attendance_changed';
    when 'course_completion_records' then
      if tg_op='UPDATE' and old.revoked_at is not distinct from new.revoked_at then return null; end if;
      run_id:=new.run_id;
      event_kind:='course.completion_changed';
    when 'course_resources' then
      if new.audience not in ('all','client') or new.removed_at is not null or
        (tg_op='UPDATE' and old.removed_at is null) or
        not exists(select 1 from public.document_versions v where v.id=new.version_id and v.status='clean' and v.sha256 is not null)
        then return null; end if;
      run_id:=new.run_id;
      event_kind:='course.material_published';
  end case;
  select r.organisation_id into company_id from public.course_runs r
    where r.id=run_id and r.published and r.archived_at is null;
  if company_id is not null then
    perform private.enqueue_company_course_webhook(run_id,company_id,event_kind,premium);
  end if;
  return null;
end;
$$;

create trigger company_course_webhook_assignment after insert or update of status on public.job_claims
  for each row execute function private.company_course_webhook_milestone();
create trigger company_course_webhook_enrolment after insert or update of status on public.course_enrolments
  for each row execute function private.company_course_webhook_milestone();
create trigger company_course_webhook_exam_document after insert or update of removed_at on private.course_exam_documents
  for each row execute function private.company_course_webhook_milestone();
create trigger company_course_webhook_exam_setting after insert or update of required on private.course_exam_settings
  for each row execute function private.company_course_webhook_milestone();
create trigger company_course_webhook_attendance after insert or update on private.course_attendance
  for each row execute function private.company_course_webhook_milestone();
create trigger company_course_webhook_completion after insert or update of revoked_at on private.course_completion_records
  for each row execute function private.company_course_webhook_milestone();
create trigger company_course_webhook_material after insert or update of removed_at on private.course_resources
  for each row execute function private.company_course_webhook_milestone();

-- Lease one delivery fenced by an unpredictable token. A lost worker lease
-- expires after a minute. Retrying this event always uses the same event ID.
create function private.lease_company_course_webhook(p_destinations text[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  leased private.company_course_webhook_deliveries;
begin
  if p_destinations is null or cardinality(p_destinations) not between 1 and 100
    then raise invalid_parameter_value; end if;
  delete from private.company_course_webhook_deliveries where id in (
    select id from private.company_course_webhook_deliveries where occurred_at<statement_timestamp()-interval '30 days'
    order by occurred_at limit 200 for update skip locked
  );
  select d.* into leased from private.company_course_webhook_deliveries d
    join private.company_course_webhooks s on s.id=d.subscription_id
    join private.company_integration_keys k on k.id=s.integration_id
    join public.course_runs r on r.id=d.course_id
    where d.state='pending' and d.attempts<5 and d.available_at<=statement_timestamp()
      and d.occurred_at>=statement_timestamp()-interval '1 day'
      and (k.organisation_id::text || '/' || s.destination)=any(p_destinations)
      and r.organisation_id=k.organisation_id and r.published and r.archived_at is null
      and private.company_course_webhook_has_scope(k,s)
      and private.company_course_webhook_premium_current(k.organisation_id,d.premium_version)
    order by d.available_at,d.id limit 1 for update of d skip locked;
  if not found then return null; end if;
  update private.company_course_webhook_deliveries
    set lease_token=gen_random_uuid(),attempts=attempts+1,available_at=statement_timestamp()+interval '1 minute'
    where id=leased.id returning * into leased;
  return (select jsonb_build_object('id',leased.id,'token',leased.lease_token,
    'destination',k.organisation_id::text || '/' || s.destination)
    from private.company_course_webhooks s join private.company_integration_keys k on k.id=s.integration_id
    where s.id=leased.subscription_id);
end;
$$;

create function private.prepare_company_course_webhook(p_id uuid,p_token uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('destination',k.organisation_id::text || '/' || s.destination,'signing_secret',s.signing_secret,
    'event',jsonb_build_object('id',d.event_id,'type',d.event_type,'version',1,
      'occurred_at',d.occurred_at,'course_id',d.course_id))
  from private.company_course_webhook_deliveries d
    join private.company_course_webhooks s on s.id=d.subscription_id
    join private.company_integration_keys k on k.id=s.integration_id
    join public.course_runs r on r.id=d.course_id
  where d.id=p_id and d.lease_token=p_token and d.state='pending' and d.available_at>statement_timestamp()
    and r.organisation_id=k.organisation_id and r.published and r.archived_at is null
    and private.company_course_webhook_has_scope(k,s)
    and private.company_course_webhook_premium_current(k.organisation_id,d.premium_version);
$$;

create function private.finish_company_course_webhook(p_id uuid,p_token uuid,p_result text)
returns void language plpgsql security definer set search_path='' as $$
begin
  if p_result is null or p_result not in ('delivered','retry','failed','cancelled') then raise invalid_parameter_value; end if;
  update private.company_course_webhook_deliveries
    set lease_token=null,
      state=case when p_result='retry' and attempts<5 then 'pending'
                 when p_result='retry' then 'failed' else p_result end,
      available_at=statement_timestamp()+make_interval(mins=>power(2,attempts)::integer)
    where id=p_id and lease_token=p_token and state='pending' and available_at>statement_timestamp();
end;
$$;

create function public.company_course_webhook_subscribe(p_organisation uuid,p_integration uuid,p_destination text,p_premium_events boolean default false)
returns jsonb language sql security invoker set search_path='' as $$
  select private.company_course_webhook_subscribe(p_organisation,p_integration,p_destination,p_premium_events);
$$;
create function public.company_course_webhook_revoke(p_organisation uuid,p_subscription uuid)
returns void language sql security invoker set search_path='' as $$
  select private.company_course_webhook_revoke(p_organisation,p_subscription);
$$;
create function public.company_course_webhook_list(p_organisation uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
  select private.company_course_webhook_list(p_organisation);
$$;
create function public.lease_company_course_webhook(p_destinations text[])
returns jsonb language sql security invoker set search_path='' as $$
  select private.lease_company_course_webhook(p_destinations);
$$;
create function public.prepare_company_course_webhook(p_id uuid,p_token uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
  select private.prepare_company_course_webhook(p_id,p_token);
$$;
create function public.finish_company_course_webhook(p_id uuid,p_token uuid,p_result text)
returns void language sql security invoker set search_path='' as $$
  select private.finish_company_course_webhook(p_id,p_token,p_result);
$$;

revoke all on function private.company_course_webhook_has_scope(private.company_integration_keys,private.company_course_webhooks),
  private.enqueue_company_course_webhook(uuid,uuid,text,boolean),private.company_course_webhook_run_changed(),
  private.company_course_webhook_schedule_changed(),private.company_course_webhook_milestone(),
  private.company_course_webhook_premium_current(uuid,integer),
  private.company_course_webhook_subscribe(uuid,uuid,text,boolean),private.company_course_webhook_revoke(uuid,uuid),
  private.company_course_webhook_list(uuid),public.company_course_webhook_subscribe(uuid,uuid,text,boolean),
  public.company_course_webhook_revoke(uuid,uuid),public.company_course_webhook_list(uuid),
  private.lease_company_course_webhook(text[]),private.prepare_company_course_webhook(uuid,uuid),
  private.finish_company_course_webhook(uuid,uuid,text),public.lease_company_course_webhook(text[]),
  public.prepare_company_course_webhook(uuid,uuid),public.finish_company_course_webhook(uuid,uuid,text)
  from public,anon,authenticated,service_role;
grant execute on function private.company_course_webhook_subscribe(uuid,uuid,text,boolean),private.company_course_webhook_revoke(uuid,uuid),
  private.company_course_webhook_list(uuid),public.company_course_webhook_subscribe(uuid,uuid,text,boolean),
  public.company_course_webhook_revoke(uuid,uuid),public.company_course_webhook_list(uuid) to authenticated;
grant execute on function private.lease_company_course_webhook(text[]),private.prepare_company_course_webhook(uuid,uuid),
  private.finish_company_course_webhook(uuid,uuid,text),public.lease_company_course_webhook(text[]),
  public.prepare_company_course_webhook(uuid,uuid),public.finish_company_course_webhook(uuid,uuid,text) to service_role;
-- Expose metadata-only subscription actions through the existing audit viewer.
alter function private.admin_audit_actions() rename to admin_audit_actions_before_course_webhooks;
create function private.admin_audit_actions() returns text[]
language sql immutable set search_path='' as $$
  select private.admin_audit_actions_before_course_webhooks() ||
    array['integration.webhook_created','integration.webhook_revoked'];
$$;
revoke all on function private.admin_audit_actions() from public,anon,authenticated,service_role;
commit;
