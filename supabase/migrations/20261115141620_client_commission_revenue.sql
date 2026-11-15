begin;
-- Gross customer prices never enter lecturer-readable jobs/claim snapshots.
alter table public.user_roles drop constraint user_roles_role_check;
alter table public.user_roles add constraint user_roles_role_check check(role in ('admin','owner','management','senior_lecturer','lecturer','participant','client'));
insert into public.role_permissions(role,permission) select 'owner',permission from public.role_permissions where role='admin' on conflict do nothing;
insert into public.role_permissions(role,permission) values('admin','users.roles.manage'),('owner','users.roles.manage'),('admin','finance.gross.read'),('owner','finance.gross.read') on conflict do nothing;

-- Functional admin/owner roles do not alter actual role rows, permissions or
-- resource ownership. Sensitive capabilities still require fresh has_permission/AAL2.
create or replace function private.has_role(p_roles text[]) returns boolean language sql stable security definer set search_path='' as $$
 select private.actor_active() and exists(select 1 from public.user_roles where user_id=auth.uid() and (role=any(p_roles) or (role in ('admin','owner') and p_roles&&array['admin','owner','management','senior_lecturer','lecturer','participant'])));
$$;
create function private.lecturer_user(p_user_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p join public.user_roles r on r.user_id=p.id where p.id=p_user_id and p.active and r.role in ('lecturer','senior_lecturer','admin','owner'));
$$;
create function private.lecturer_actor() returns boolean language sql stable security definer set search_path='' as $$ select private.actor_active() and private.lecturer_user(auth.uid()); $$;
create or replace function private.chat_staff(p_user_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p join public.user_roles r on r.user_id=p.id where p.id=p_user_id and p.active and r.role in ('admin','owner','management','senior_lecturer','lecturer'));
$$;
create table public.client_organisation_memberships (
 user_id uuid not null references public.profiles(id),organisation_id uuid not null references public.organisations(id),
 removed_at timestamptz,created_at timestamptz not null default clock_timestamp(),primary key(user_id,organisation_id)
);
create index client_organisation_memberships_org on public.client_organisation_memberships(organisation_id,user_id) where removed_at is null;
alter table public.client_organisation_memberships enable row level security;
revoke all on public.client_organisation_memberships from public,anon,authenticated;
grant select on public.client_organisation_memberships to authenticated;
grant all on public.client_organisation_memberships to service_role;
create function private.client_has_organisation(p_organisation_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.has_role(array['client']) and exists(select 1 from public.client_organisation_memberships m join public.organisations o on o.id=m.organisation_id where m.user_id=auth.uid() and m.organisation_id=p_organisation_id and m.removed_at is null and o.archived_at is null);
$$;
create policy client_membership_read on public.client_organisation_memberships for select to authenticated using((select private.actor_active()) and (user_id=(select auth.uid()) or (select private.has_permission('users.roles.manage'))));
create function private.manage_client_organisation(p_user_id uuid,p_organisation_id uuid,p_remove boolean default false) returns void language plpgsql security definer set search_path='' as $$
begin
 if not private.has_permission('users.roles.manage') then raise exception 'Client membership management and MFA required' using errcode='42501';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('client-membership:'||p_user_id::text,0));
 if p_remove is null or not exists(select 1 from public.organisations where id=p_organisation_id) or (not p_remove and not exists(select 1 from public.profiles p join public.user_roles r on r.user_id=p.id where p.id=p_user_id and p.active and r.role='client')) then raise exception 'Active client and valid organisation required' using errcode='22023';end if;
 insert into public.client_organisation_memberships(user_id,organisation_id,removed_at) values(p_user_id,p_organisation_id,case when p_remove then clock_timestamp() end) on conflict(user_id,organisation_id) do update set removed_at=excluded.removed_at;
 insert into public.audit_events(actor_id,action,resource_id,details) values(auth.uid(),case when p_remove then 'client.membership_removed' else 'client.membership_added' end,p_user_id,jsonb_build_object('organisation_id',p_organisation_id));
end;$$;
create function public.manage_client_organisation(p_user_id uuid,p_organisation_id uuid,p_remove boolean default false) returns void language sql security invoker set search_path='' as $$select private.manage_client_organisation(p_user_id,p_organisation_id,p_remove);$$;
create function private.commission_access() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('can_manage_gross',private.has_permission('finance.gross.read'),'can_manage_client_memberships',private.has_permission('users.roles.manage'),'can_request',private.has_permission('finance.gross.read') or (private.has_role(array['client']) and exists(select 1 from public.client_organisation_memberships m where m.user_id=auth.uid() and private.client_has_organisation(m.organisation_id))));
$$;
create function public.commission_access() returns jsonb language sql stable security invoker set search_path='' as $$select private.commission_access();$$;
create function private.client_organisations() returns table(id uuid,name text) language sql stable security definer set search_path='' as $$
 select o.id,o.name from public.organisations o where o.archived_at is null and (private.has_permission('finance.gross.read') or private.client_has_organisation(o.id)) order by o.name,o.id;
$$;
create function public.client_organisations() returns table(id uuid,name text) language sql stable security invoker set search_path='' as $$select * from private.client_organisations();$$;

create table private.client_course_requests (
 id uuid primary key default gen_random_uuid(),organisation_id uuid not null references public.organisations(id),requested_by uuid not null references public.profiles(id),
 client_id uuid not null,payload jsonb not null,creation_options jsonb,status text not null default 'submitted' check(status in ('submitted','published','cancelled')),
 job_id uuid unique references public.jobs(id),created_at timestamptz not null default clock_timestamp(),unique(requested_by,client_id)
);
create index client_requests_org_created on private.client_course_requests(organisation_id,created_at desc);
create table private.job_commission_offers (
 job_id uuid primary key references public.jobs(id),organisation_id uuid not null references public.organisations(id),
 gross_amount numeric(12,2) not null check(gross_amount>0),gross_total_amount numeric(12,2) not null check(gross_total_amount>0),
 platform_percent numeric(5,2) not null default 50 check(platform_percent between 0 and 100),
 platform_total_amount numeric(12,2) not null,lecturer_net_amount numeric(12,2) not null,lecturer_net_total_amount numeric(12,2) not null,
 currency text not null check(currency in ('EUR','AUD')),created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 check(gross_total_amount=platform_total_amount+lecturer_net_total_amount),check(lecturer_net_total_amount>=0 and lecturer_net_amount>=0)
);
create index job_commission_offers_org on private.job_commission_offers(organisation_id,currency);
create table private.claim_revenue_ledger (
 claim_id uuid primary key references public.job_claims(id),job_id uuid not null unique references public.jobs(id),organisation_id uuid not null references public.organisations(id),
 lecturer_id uuid not null references public.profiles(id),gross_amount numeric(12,2) not null,gross_total_amount numeric(12,2) not null,
 platform_percent numeric(5,2) not null,platform_total_amount numeric(12,2) not null,lecturer_net_amount numeric(12,2) not null,lecturer_net_total_amount numeric(12,2) not null,
 currency text not null check(currency in ('EUR','AUD')),accepted_at timestamptz not null default clock_timestamp(),check(gross_total_amount=platform_total_amount+lecturer_net_total_amount)
);
create index claim_revenue_org_currency on private.claim_revenue_ledger(organisation_id,currency);
do $$declare t text;begin foreach t in array array['client_course_requests','job_commission_offers','claim_revenue_ledger'] loop execute format('alter table private.%I enable row level security',t);execute format('revoke all on private.%I from public,anon,authenticated',t);end loop;end;$$;

create function private.create_client_request(p_organisation_id uuid,p_payload jsonb,p_client_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare r private.client_course_requests; s jsonb; k text; normalized jsonb; sessions jsonb:='[]'::jsonb; topics jsonb; starts timestamptz; ends timestamptz; tz text; gross numeric; total numeric;
begin
 if not (private.has_permission('finance.gross.read') or private.client_has_organisation(p_organisation_id)) then raise exception 'Organisation access required' using errcode='42501';end if;
 if p_client_id is null or jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Invalid request' using errcode='22023';end if;
 for k in select jsonb_object_keys(p_payload) loop if k not in ('title','description','delivery_type','location','time_zone','sessions','topic_ids','gross_amount','gross_total_amount','currency','rate_unit') then raise exception 'Unsupported request property' using errcode='22023';end if;end loop;
 tz=coalesce(p_payload->>'time_zone','Europe/Berlin');gross=(p_payload->>'gross_amount')::numeric;total=(p_payload->>'gross_total_amount')::numeric;
 if gross is null or total is null or gross not between 0.01 and 9999999999.99 or total not between 0.01 and 9999999999.99 or gross<>round(gross,2) or total<>round(total,2) or p_payload->>'currency' is null or p_payload->>'currency' not in ('EUR','AUD') or p_payload->>'rate_unit' is null or p_payload->>'rate_unit' not in ('per_day','per_teaching_unit','per_hour','fixed_total') or (p_payload->>'rate_unit'='fixed_total' and gross<>total) then raise exception 'Invalid original-currency fee' using errcode='22023';end if;
 if length(trim(coalesce(p_payload->>'title',''))) not between 1 and 200 or length(coalesce(p_payload->>'description',''))>12000 or length(coalesce(p_payload->>'location',''))>500 or p_payload->>'delivery_type' is null or p_payload->>'delivery_type' not in ('online','onsite') or not exists(select 1 from pg_catalog.pg_timezone_names where name=tz) or jsonb_typeof(p_payload->'sessions') is distinct from 'array' or jsonb_array_length(p_payload->'sessions') not between 1 and 60 then raise exception 'Invalid course request' using errcode='22023';end if;
 for s in select value from jsonb_array_elements(p_payload->'sessions') loop
  if jsonb_typeof(s) is distinct from 'object' or exists(select 1 from jsonb_object_keys(s) x where x not in ('starts_at','ends_at')) then raise exception 'Invalid session' using errcode='22023';end if;
  starts=(s->>'starts_at')::timestamptz;ends=(s->>'ends_at')::timestamptz;
  if starts is null or ends is null or starts<=clock_timestamp() or ends<=starts or not isfinite(starts) or not isfinite(ends) then raise exception 'Future finite sessions required' using errcode='22023';end if;
  if exists(select 1 from jsonb_array_elements(sessions) previous where tstzrange((previous->>'starts_at')::timestamptz,(previous->>'ends_at')::timestamptz,'[)') && tstzrange(starts,ends,'[)')) then raise exception 'Overlapping sessions' using errcode='22023';end if;
  sessions=sessions||jsonb_build_array(jsonb_build_object('starts_at',starts,'ends_at',ends));
 end loop;
 if jsonb_typeof(coalesce(p_payload->'topic_ids','[]'))<>'array' or jsonb_array_length(coalesce(p_payload->'topic_ids','[]'))>100 then raise exception 'Invalid topics' using errcode='22023';end if;
 select coalesce(jsonb_agg(t.id order by t.id),'[]') into topics from public.topics t where t.id in(select value::uuid from jsonb_array_elements_text(coalesce(p_payload->'topic_ids','[]')));
 if (select count(distinct value::uuid) from jsonb_array_elements_text(coalesce(p_payload->'topic_ids','[]')))<>jsonb_array_length(topics) then raise exception 'Unknown topic' using errcode='22023';end if;
 normalized=jsonb_build_object('title',trim(p_payload->>'title'),'description',coalesce(p_payload->>'description',''),'delivery_type',p_payload->>'delivery_type','location',coalesce(p_payload->>'location',''),'time_zone',tz,'sessions',sessions,'topic_ids',topics,'gross_amount',gross,'gross_total_amount',total,'currency',p_payload->>'currency','rate_unit',p_payload->>'rate_unit');
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('client-request:'||auth.uid()::text,0));
 select * into r from private.client_course_requests where requested_by=auth.uid() and client_id=p_client_id;
 if found then if r.organisation_id is distinct from p_organisation_id or r.payload is distinct from normalized then raise exception 'Request idempotency conflict' using errcode='22023';end if;return r.id;end if;
 perform 1 from public.organisations where id=p_organisation_id and archived_at is null for share;if not found then raise exception 'Organisation unavailable' using errcode='22023';end if;
 if (select count(*) from private.client_course_requests where requested_by=auth.uid() and created_at>clock_timestamp()-interval '1 hour')>=20 then raise exception 'Request rate limit reached' using errcode='54000';end if;
 insert into private.client_course_requests(organisation_id,requested_by,client_id,payload) values(p_organisation_id,auth.uid(),p_client_id,normalized) returning id into r.id;
 insert into public.audit_events(actor_id,action,resource_id) values(auth.uid(),'client.request_submitted',r.id);
 return r.id;
end;$$;
create function public.create_client_request(p_organisation_id uuid,p_payload jsonb,p_client_id uuid) returns uuid language sql security invoker set search_path='' as $$select private.create_client_request(p_organisation_id,p_payload,p_client_id);$$;

create function private.set_job_commission(p_job_id uuid,p_gross_amount numeric,p_gross_total_amount numeric,p_platform_percent numeric default 50) returns void language plpgsql security definer set search_path='' as $$
declare j public.jobs; org uuid; net numeric; net_total numeric; platform numeric;
begin
 if not private.has_permission('finance.gross.read') then raise exception 'Gross finance permission and MFA required' using errcode='42501';end if;
 if p_gross_amount is null or p_gross_total_amount is null or p_platform_percent is null or p_gross_amount not between 0.01 and 9999999999.99 or p_gross_total_amount not between 0.01 and 9999999999.99 or p_platform_percent not between 0 and 100 or p_gross_amount<>round(p_gross_amount,2) or p_gross_total_amount<>round(p_gross_total_amount,2) or p_platform_percent<>round(p_platform_percent,2) then raise exception 'Invalid commission' using errcode='22023';end if;
 select * into j from public.jobs where id=p_job_id for update;
 if not found or j.status not in ('draft','published') or exists(select 1 from public.job_claims where job_id=p_job_id) then raise exception 'Only unaccepted offers can change commission' using errcode='22023';end if;
 select organisation_id into org from public.course_runs where id=j.course_run_id;
 if org is null then raise exception 'Offer requires an organisation' using errcode='22023';end if;
 if j.rate_unit='fixed_total' and p_gross_amount<>p_gross_total_amount then raise exception 'Fixed total fee must match' using errcode='22023';end if;
 net=p_gross_amount-round(p_gross_amount*p_platform_percent/100,2);platform=round(p_gross_total_amount*p_platform_percent/100,2);net_total=p_gross_total_amount-platform;
 if exists(select 1 from private.job_commission_offers o where o.job_id=p_job_id and o.gross_amount=p_gross_amount and o.gross_total_amount=p_gross_total_amount and o.platform_percent=p_platform_percent and o.currency=j.currency and j.amount=o.lecturer_net_amount and j.total_amount=o.lecturer_net_total_amount) then return;end if;
 insert into private.job_commission_offers(job_id,organisation_id,gross_amount,gross_total_amount,platform_percent,platform_total_amount,lecturer_net_amount,lecturer_net_total_amount,currency) values(p_job_id,org,p_gross_amount,p_gross_total_amount,p_platform_percent,platform,net,net_total,j.currency)
 on conflict(job_id) do update set organisation_id=excluded.organisation_id,gross_amount=excluded.gross_amount,gross_total_amount=excluded.gross_total_amount,platform_percent=excluded.platform_percent,platform_total_amount=excluded.platform_total_amount,lecturer_net_amount=excluded.lecturer_net_amount,lecturer_net_total_amount=excluded.lecturer_net_total_amount,currency=excluded.currency,updated_at=clock_timestamp();
 update public.jobs set amount=net,total_amount=net_total,terms_version=terms_version+1 where id=p_job_id;
 insert into public.audit_events(actor_id,action,resource_id) values(auth.uid(),'job.commission_configured',p_job_id);
end;$$;
create function public.set_job_commission(p_job_id uuid,p_gross_amount numeric,p_gross_total_amount numeric,p_platform_percent numeric default 50) returns void language sql security invoker set search_path='' as $$select private.set_job_commission(p_job_id,p_gross_amount,p_gross_total_amount,p_platform_percent);$$;

create function private.publish_client_request(p_request_id uuid,p_platform_percent numeric default 50,p_terms text default 'Accepted lecturer assignment terms.',p_requires_contract boolean default true,p_claim_deadline timestamptz default null) returns uuid language plpgsql security definer set search_path='' as $$
declare r private.client_course_requests; j public.jobs; org public.organisations; template uuid; run uuid; job uuid; session_id uuid; s jsonb;
begin
 if not private.has_permission('finance.gross.read') then raise exception 'Gross finance permission and MFA required' using errcode='42501';end if;
 select * into r from private.client_course_requests where id=p_request_id for update;
 if not found or r.status='cancelled' then raise exception 'Request unavailable' using errcode='22023';end if;
 if p_terms is null or length(trim(p_terms)) not between 1 and 12000 or p_requires_contract is null or (p_claim_deadline is not null and (not isfinite(p_claim_deadline) or p_claim_deadline<=clock_timestamp())) then raise exception 'Valid lecturer terms required' using errcode='22023';end if;
 if r.job_id is not null then
  select * into j from public.jobs where id=r.job_id;
  if j.terms is distinct from p_terms or j.requires_contract is distinct from p_requires_contract or j.claim_deadline is distinct from p_claim_deadline or not exists(select 1 from private.job_commission_offers o where o.job_id=j.id and o.platform_percent=p_platform_percent) then raise exception 'Publication idempotency conflict' using errcode='22023';end if;return r.job_id;
 end if;
 select * into org from public.organisations where id=r.organisation_id and archived_at is null for share;if not found then raise exception 'Organisation unavailable' using errcode='22023';end if;
 if exists(select 1 from jsonb_array_elements(r.payload->'sessions') x where (x->>'starts_at')::timestamptz<=clock_timestamp()) then raise exception 'Future sessions required' using errcode='22023';end if;
 insert into public.course_templates(title,description) values(r.payload->>'title',r.payload->>'description') returning id into template;
 insert into public.course_runs(template_id,organisation_id,time_zone,delivery_type,venue,published) values(template,org.id,r.payload->>'time_zone',r.payload->>'delivery_type',r.payload->>'location',true) returning id into run;
 -- Start at zero net in this transaction. set_job_commission derives the actual net
 -- before publication is visible; no gross amount ever enters a public job column.
 insert into public.jobs(course_run_id,title,description,customer_name,delivery_type,location,time_zone,status,amount,currency,rate_unit,total_amount,terms,requires_contract,claim_deadline,created_by)
 values(run,r.payload->>'title',r.payload->>'description',org.name,r.payload->>'delivery_type',r.payload->>'location',r.payload->>'time_zone','draft',0,r.payload->>'currency',r.payload->>'rate_unit',0,p_terms,p_requires_contract,p_claim_deadline,auth.uid()) returning id into job;
 for s in select value from jsonb_array_elements(r.payload->'sessions') loop
  insert into public.course_sessions(course_run_id,starts_at,ends_at) values(run,(s->>'starts_at')::timestamptz,(s->>'ends_at')::timestamptz) returning id into session_id;
  insert into public.job_sessions(job_id,course_session_id,starts_at,ends_at) values(job,session_id,(s->>'starts_at')::timestamptz,(s->>'ends_at')::timestamptz);
 end loop;
 insert into public.job_requirements(job_id,topic_id) select job,value::uuid from jsonb_array_elements_text(r.payload->'topic_ids');
 insert into public.course_template_topics(template_id,topic_id) select template,value::uuid from jsonb_array_elements_text(r.payload->'topic_ids');
 perform private.set_job_commission(job,(r.payload->>'gross_amount')::numeric,(r.payload->>'gross_total_amount')::numeric,p_platform_percent);
 update public.jobs set status='published' where id=job;update private.client_course_requests set status='published',job_id=job where id=r.id;
 insert into public.audit_events(actor_id,action,resource_id) values(auth.uid(),'client.request_published',r.id);
 return job;
end;$$;
create function public.publish_client_request(p_request_id uuid,p_platform_percent numeric default 50,p_terms text default 'Accepted lecturer assignment terms.',p_requires_contract boolean default true,p_claim_deadline timestamptz default null) returns uuid language sql security invoker set search_path='' as $$select private.publish_client_request(p_request_id,p_platform_percent,p_terms,p_requires_contract,p_claim_deadline);$$;

create function private.create_commission_job(p_organisation_id uuid,p_payload jsonb,p_platform_percent numeric default 50,p_client_id uuid default null) returns uuid language plpgsql security definer set search_path='' as $$
declare org uuid:=p_organisation_id; request_id uuid; job uuid; previous private.client_course_requests; customer text:=trim(coalesce(p_payload->>'customer_name','')); desired_status text:=coalesce(p_payload->>'status','published'); options jsonb:=jsonb_build_object('organisation_id',p_organisation_id,'payload',p_payload,'platform_percent',p_platform_percent);
begin
 if not private.has_permission('finance.gross.read') then raise exception 'Gross finance permission and MFA required' using errcode='42501';end if;
 if p_client_id is null or desired_status not in ('draft','published') then raise exception 'Valid request ID and status required' using errcode='22023';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('client-request:'||auth.uid()::text,0));
 select * into previous from private.client_course_requests where requested_by=auth.uid() and client_id=p_client_id;
 if found and previous.creation_options is distinct from options then raise exception 'Request operation idempotency conflict' using errcode='22023';end if;
 if org is null then
  if length(customer) not between 1 and 200 then raise exception 'Customer name required' using errcode='22023';end if;
  if previous.id is not null then org=previous.organisation_id;if not exists(select 1 from public.organisations where id=org and name=customer) then raise exception 'Request idempotency conflict' using errcode='22023';end if;
  else insert into public.organisations(name,time_zone) values(customer,coalesce(p_payload->>'time_zone','Europe/Berlin')) returning id into org;end if;
 end if;
 request_id=private.create_client_request(org,p_payload-array['customer_name','status','terms','requires_contract','claim_deadline'],p_client_id);
 if previous.id is null then update private.client_course_requests set creation_options=options where id=request_id;end if;
 job=private.publish_client_request(request_id,p_platform_percent,coalesce(p_payload->>'terms','Accepted lecturer assignment terms.'),coalesce((p_payload->>'requires_contract')::boolean,true),(p_payload->>'claim_deadline')::timestamptz);
 if previous.job_id is not null and exists(select 1 from public.jobs where id=job and status<>desired_status) then raise exception 'Publication idempotency conflict' using errcode='22023';end if;
 if desired_status='draft' then update public.jobs set status='draft' where id=job;update public.course_runs set published=false where id=(select course_run_id from public.jobs where id=job);end if;
 return job;
end;$$;
create function public.create_commission_job(p_organisation_id uuid,p_payload jsonb,p_platform_percent numeric default 50,p_client_id uuid default null) returns uuid language sql security invoker set search_path='' as $$select private.create_commission_job(p_organisation_id,p_payload,p_platform_percent,p_client_id);$$;
create function private.cancel_client_request(p_request_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare r private.client_course_requests;
begin
 select * into r from private.client_course_requests where id=p_request_id for update;
 if not found or not (private.has_permission('finance.gross.read') or private.client_has_organisation(r.organisation_id)) then raise exception 'Request unavailable' using errcode='42501';end if;
 if r.job_id is not null or r.status not in ('submitted','cancelled') then raise exception 'Published requests require an audited job workflow' using errcode='22023';end if;
 if r.status='cancelled' then return;end if;
 update private.client_course_requests set status='cancelled' where id=r.id;insert into public.audit_events(actor_id,action,resource_id) values(auth.uid(),'client.request_cancelled',r.id);
end;$$;
create function public.cancel_client_request(p_request_id uuid) returns void language sql security invoker set search_path='' as $$select private.cancel_client_request(p_request_id);$$;

create function private.capture_claim_revenue() returns trigger language plpgsql security definer set search_path='' as $$
declare o private.job_commission_offers;
begin
 select * into o from private.job_commission_offers where job_id=new.job_id;
 if found then
  if new.amount<>o.lecturer_net_amount or new.total_amount<>o.lecturer_net_total_amount or new.currency<>o.currency then raise exception 'Offer changed; refresh before claiming' using errcode='23514';end if;
  insert into private.claim_revenue_ledger(claim_id,job_id,organisation_id,lecturer_id,gross_amount,gross_total_amount,platform_percent,platform_total_amount,lecturer_net_amount,lecturer_net_total_amount,currency)
  values(new.id,new.job_id,o.organisation_id,new.lecturer_id,o.gross_amount,o.gross_total_amount,o.platform_percent,o.platform_total_amount,o.lecturer_net_amount,o.lecturer_net_total_amount,o.currency);
 end if;return new;
end;$$;
create trigger capture_claim_revenue after insert on public.job_claims for each row execute function private.capture_claim_revenue();
create function private.immutable_revenue_ledger() returns trigger language plpgsql set search_path='' as $$begin raise exception 'Accepted revenue snapshots are immutable' using errcode='23514';end;$$;
create trigger immutable_revenue_ledger before update on private.claim_revenue_ledger for each row execute function private.immutable_revenue_ledger();

create function private.client_requests(p_organisation_id uuid default null) returns table(id uuid,organisation_id uuid,organisation_name text,title text,description text,delivery_type text,location text,time_zone text,gross_amount numeric,gross_total_amount numeric,currency text,rate_unit text,sessions jsonb,topic_ids jsonb,status text,job_id uuid,assigned_lecturer_id uuid,assigned_lecturer_name text,created_at timestamptz) language sql stable security definer set search_path='' as $$
 select r.id,r.organisation_id,o.name,r.payload->>'title',r.payload->>'description',r.payload->>'delivery_type',r.payload->>'location',r.payload->>'time_zone',coalesce(rev.gross_amount,fee.gross_amount,(r.payload->>'gross_amount')::numeric),coalesce(rev.gross_total_amount,fee.gross_total_amount,(r.payload->>'gross_total_amount')::numeric),r.payload->>'currency',r.payload->>'rate_unit',r.payload->'sessions',r.payload->'topic_ids',case when c.id is not null then 'assigned' when r.job_id is not null and j.status='draft' then 'submitted' else r.status end,r.job_id,c.lecturer_id,p.display_name,r.created_at
 from private.client_course_requests r join public.organisations o on o.id=r.organisation_id left join public.jobs j on j.id=r.job_id left join public.job_claims c on c.job_id=r.job_id and c.status='confirmed' left join public.profiles p on p.id=c.lecturer_id left join private.job_commission_offers fee on fee.job_id=r.job_id left join private.claim_revenue_ledger rev on rev.claim_id=c.id
 where (p_organisation_id is null or r.organisation_id=p_organisation_id) and (private.has_permission('finance.gross.read') or private.client_has_organisation(r.organisation_id)) order by r.created_at desc,r.id limit 500;
$$;
create function public.client_requests(p_organisation_id uuid default null) returns table(id uuid,organisation_id uuid,organisation_name text,title text,description text,delivery_type text,location text,time_zone text,gross_amount numeric,gross_total_amount numeric,currency text,rate_unit text,sessions jsonb,topic_ids jsonb,status text,job_id uuid,assigned_lecturer_id uuid,assigned_lecturer_name text,created_at timestamptz) language sql stable security invoker set search_path='' as $$select * from private.client_requests(p_organisation_id);$$;
create function private.commission_report(p_organisation_id uuid default null) returns table(job_id uuid,claim_id uuid,organisation_id uuid,organisation_name text,title text,status text,currency text,gross_amount numeric,gross_total_amount numeric,platform_percent numeric,platform_total_amount numeric,lecturer_net_amount numeric,lecturer_net_total_amount numeric,lecturer_id uuid,lecturer_name text,accepted_at timestamptz,pricing_model text) language plpgsql stable security definer set search_path='' as $$
begin
 if not private.has_permission('finance.gross.read') then raise exception 'Gross finance permission and MFA required' using errcode='42501';end if;
 return query select o.job_id,l.claim_id,o.organisation_id,org.name,j.title,j.status,coalesce(l.currency,o.currency),coalesce(l.gross_amount,o.gross_amount),coalesce(l.gross_total_amount,o.gross_total_amount),coalesce(l.platform_percent,o.platform_percent),coalesce(l.platform_total_amount,o.platform_total_amount),coalesce(l.lecturer_net_amount,o.lecturer_net_amount),coalesce(l.lecturer_net_total_amount,o.lecturer_net_total_amount),l.lecturer_id,p.display_name,l.accepted_at,'commission'::text
 from private.job_commission_offers o join public.jobs j on j.id=o.job_id join public.organisations org on org.id=o.organisation_id left join private.claim_revenue_ledger l on l.job_id=o.job_id left join public.profiles p on p.id=l.lecturer_id where p_organisation_id is null or o.organisation_id=p_organisation_id
 union all select j.id,c.id,r.organisation_id,coalesce(org.name,j.customer_name),j.title,j.status,coalesce(c.currency,j.currency),null::numeric,null::numeric,null::numeric,null::numeric,coalesce(c.amount,j.amount),coalesce(c.total_amount,j.total_amount),c.lecturer_id,p.display_name,c.created_at,'legacy_net'::text
 from public.jobs j left join public.course_runs r on r.id=j.course_run_id left join public.organisations org on org.id=r.organisation_id left join public.job_claims c on c.job_id=j.id and c.status='confirmed' left join public.profiles p on p.id=c.lecturer_id where not exists(select 1 from private.job_commission_offers offer where offer.job_id=j.id) and (p_organisation_id is null or r.organisation_id=p_organisation_id);
end;$$;
create function public.commission_report(p_organisation_id uuid default null) returns table(job_id uuid,claim_id uuid,organisation_id uuid,organisation_name text,title text,status text,currency text,gross_amount numeric,gross_total_amount numeric,platform_percent numeric,platform_total_amount numeric,lecturer_net_amount numeric,lecturer_net_total_amount numeric,lecturer_id uuid,lecturer_name text,accepted_at timestamptz,pricing_model text) language sql stable security invoker set search_path='' as $$select * from private.commission_report(p_organisation_id);$$;
create function private.client_spend_summary() returns table(organisation_id uuid,organisation_name text,currency text,request_count bigint,published_count bigint,assigned_count bigint,gross_total_amount numeric,gross_assigned_amount numeric,teachers jsonb) language sql stable security definer set search_path='' as $$
 with entries as (
  select r.organisation_id,r.payload->>'currency' currency,r.job_id,case when r.job_id is null then r.status else j.status end status,coalesce(l.gross_total_amount,fee.gross_total_amount,(r.payload->>'gross_total_amount')::numeric) gross_total_amount,l.claim_id,coalesce(l.gross_total_amount,0) gross_assigned_amount
  from private.client_course_requests r left join public.jobs j on j.id=r.job_id left join private.job_commission_offers fee on fee.job_id=r.job_id left join private.claim_revenue_ledger l on l.job_id=r.job_id where r.status<>'cancelled'
  union all select fee.organisation_id,fee.currency,fee.job_id,j.status,coalesce(l.gross_total_amount,fee.gross_total_amount),l.claim_id,coalesce(l.gross_total_amount,0) from private.job_commission_offers fee join public.jobs j on j.id=fee.job_id left join private.claim_revenue_ledger l on l.job_id=fee.job_id where not exists(select 1 from private.client_course_requests r where r.job_id=fee.job_id)
 ),summary as (
  select o.id organisation_id,o.name organisation_name,e.currency,count(*) request_count,count(*)filter(where e.status in ('published','filled')) published_count,count(*)filter(where e.claim_id is not null) assigned_count,sum(e.gross_total_amount) gross_total_amount,sum(e.gross_assigned_amount) gross_assigned_amount
  from entries e join public.organisations o on o.id=e.organisation_id where private.has_permission('finance.gross.read') or private.client_has_organisation(o.id) group by o.id,o.name,e.currency
 )select s.*,coalesce((select jsonb_agg(x) from(select distinct p.id,p.display_name from private.claim_revenue_ledger rev join public.profiles p on p.id=rev.lecturer_id where rev.organisation_id=s.organisation_id and rev.currency=s.currency)x),'[]') from summary s order by s.organisation_name,s.currency;
$$;
create function public.client_spend_summary() returns table(organisation_id uuid,organisation_name text,currency text,request_count bigint,published_count bigint,assigned_count bigint,gross_total_amount numeric,gross_assigned_amount numeric,teachers jsonb) language sql stable security invoker set search_path='' as $$select * from private.client_spend_summary();$$;

-- Admin/owner may perform their own lecturer workflows; resource privacy stays scoped.
create or replace function private.claim_job(p_job_id uuid,p_idempotency_key uuid,p_terms_version integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 actor uuid:=auth.uid(); j public.jobs; c public.job_claims; v_contract uuid; v_claim uuid; v_room uuid;
begin
 if not private.actor_active() then raise exception 'Authentication required' using errcode='42501'; end if;
 perform 1 from public.profiles where id=actor and active for share;
 if not found then raise exception 'Authentication required' using errcode='42501';end if;
 if p_idempotency_key is null or p_terms_version is null then raise exception 'Missing claim data' using errcode='22023'; end if;
 if not private.lecturer_actor() then return jsonb_build_object('status','not_eligible'); end if;
 -- Serialize requests per actor BEFORE per-job locking, protecting across distinct jobs and
 -- idempotency keys. Exclusion constraints provide a second independent conflict guard.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text,0));
 select * into c from public.job_claims where lecturer_id=actor and idempotency_key=p_idempotency_key;
 if found then
  if c.job_id<>p_job_id then return jsonb_build_object('status','idempotency_conflict'); end if;
  return jsonb_build_object('status',c.status,'claim_id',c.id);
 end if;
 select * into j from public.jobs where id=p_job_id for update;
 if not found then return jsonb_build_object('status','unavailable'); end if;
 if j.status='filled' then return jsonb_build_object('status','filled'); end if;
 if j.status<>'published' or (j.claim_deadline is not null and j.claim_deadline<=now()) then return jsonb_build_object('status','unavailable'); end if;
 if j.terms_version<>p_terms_version then return jsonb_build_object('status','terms_changed'); end if;
 if not exists(select 1 from public.job_sessions where job_id=j.id) or exists(select 1 from public.job_sessions where job_id=j.id and starts_at<=now()) then return jsonb_build_object('status','unavailable'); end if;
 if exists(select 1 from public.job_requirements r where r.job_id=j.id and not exists(select 1 from public.lecturer_topics lt where lt.user_id=actor and lt.topic_id=r.topic_id and lt.verified and (lt.valid_until is null or lt.valid_until>=(select max(ends_at) from public.job_sessions where job_id=j.id)))) then return jsonb_build_object('status','not_eligible'); end if;
 if j.requires_contract then
  v_contract=private.current_contract_for_interval(actor,(select min(starts_at) from public.job_sessions where job_id=j.id),(select max(ends_at) from public.job_sessions where job_id=j.id));
  if v_contract is null then return jsonb_build_object('status','prerequisite_missing'); end if;
 end if;
 if exists(select 1 from public.job_sessions js join public.assignment_sessions a on a.lecturer_id=actor and tstzrange(a.starts_at,a.ends_at,'[)') && tstzrange(js.starts_at,js.ends_at,'[)') where js.job_id=j.id)
 or exists(select 1 from public.job_sessions js join public.personal_events e on e.user_id=actor and tstzrange(e.starts_at,e.ends_at,'[)') && tstzrange(js.starts_at,js.ends_at,'[)') where js.job_id=j.id)
 then return jsonb_build_object('status','conflict'); end if;
 insert into public.job_claims(job_id,lecturer_id,idempotency_key,amount,currency,rate_unit,total_amount,terms,terms_version,contract_id)
 values(j.id,actor,p_idempotency_key,j.amount,j.currency,j.rate_unit,j.total_amount,j.terms,j.terms_version,v_contract) returning id into v_claim;
 insert into public.assignment_sessions(claim_id,lecturer_id,starts_at,ends_at) select v_claim,actor,starts_at,ends_at from public.job_sessions where job_id=j.id;
 update public.jobs set status='filled' where id=j.id;
 insert into public.claim_events(claim_id,actor_id,event_type) values(v_claim,actor,'confirmed');
 insert into public.notifications(user_id,kind,resource_id) values(actor,'claim_confirmed',v_claim);
 insert into public.chat_rooms(job_id) values(j.id) on conflict(job_id) do update set job_id=excluded.job_id returning id into v_room;
 insert into public.chat_members(room_id,user_id) values(v_room,actor) on conflict do nothing;
 return jsonb_build_object('status','confirmed','claim_id',v_claim);
exception when exclusion_violation then
 -- PL/pgSQL exception subtransaction rolls back EVERY preceding write.
 return jsonb_build_object('status','conflict');
end;$$;
create or replace function private.commercial_access() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('can_manage_contracts',private.has_permission('contracts.manage'),'can_manage_finance',private.has_permission('finance.manage'),'can_submit_invoice',private.lecturer_actor());
$$;
create or replace function private.commercial_people() returns table(id uuid,display_name text) language sql stable security definer set search_path='' as $$
 select p.id,p.display_name from public.profiles p where private.actor_active() and ((p.id=auth.uid()) or ((private.has_permission('contracts.manage') or private.has_permission('finance.manage') or private.has_permission('contracts.read')) and p.active and exists(select 1 from public.user_roles r where r.user_id=p.id and r.role in ('lecturer','senior_lecturer','admin','owner')))) order by p.display_name,p.id;
$$;
create or replace function private.register_executed_contract(p_user_id uuid,p_title text,p_document_version_id uuid,p_effective_from timestamptz,p_expires_at timestamptz,p_kind text default 'master',p_parent_id uuid default null,p_client_id uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare version public.document_versions; document public.documents; previous public.contracts; result uuid; next_version int;
begin
 if not private.has_permission('contracts.manage') then raise exception 'contracts.manage and MFA required' using errcode='42501';end if;
 if p_client_id is null or p_user_id is null or p_document_version_id is null or p_title is null or length(trim(p_title)) not between 1 and 200 or p_effective_from is null or (p_expires_at is not null and p_expires_at<=p_effective_from) or p_kind not in ('master','addendum') or p_kind is null or (p_kind='addendum')<>(p_parent_id is not null) then raise exception 'Invalid executed contract data' using errcode='22023';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text,0));
 select * into previous from public.contracts c where c.registered_by=auth.uid() and c.client_id=p_client_id;
 if found then
  if previous.user_id<>p_user_id or previous.document_version_id<>p_document_version_id or previous.title<>trim(p_title) or previous.effective_from<>p_effective_from or previous.expires_at is distinct from p_expires_at or previous.kind<>p_kind or previous.parent_contract_id is distinct from p_parent_id then raise exception 'Contract idempotency conflict' using errcode='22023';end if;return previous.id;
 end if;
 if not exists(select 1 from public.profiles p join public.user_roles r on r.user_id=p.id where p.id=p_user_id and p.active and r.role in ('lecturer','senior_lecturer','admin','owner')) then raise exception 'An active lecturer is required' using errcode='22023';end if;
 select * into version from public.document_versions where id=p_document_version_id;
 select * into document from public.documents where id=version.document_id;
 if document.id is null or document.deleted_at is not null or document.owner_id<>p_user_id or document.kind<>'contract' or document.scope<>'personal' or version.status<>'clean' or version.mime_type<>'application/pdf' or version.sha256 is null then raise exception 'A clean executed-contract PDF owned by the lecturer is required' using errcode='42501';end if;
 if p_parent_id is not null and not exists(select 1 from public.contracts c where c.id=p_parent_id and c.user_id=p_user_id and c.document_version_id is not null) then raise exception 'A prior executed version for this lecturer is required' using errcode='22023';end if;
 select coalesce(max(c.version),0)+1 into next_version from public.contracts c where c.user_id=p_user_id;
 insert into public.contracts(user_id,status,effective_from,expires_at,version,title,kind,parent_contract_id,document_version_id,document_sha256,registered_by,client_id)
 values(p_user_id,case when p_expires_at<=clock_timestamp() then 'expired' else 'active' end,p_effective_from,p_expires_at,next_version,trim(p_title),p_kind,p_parent_id,p_document_version_id,version.sha256,auth.uid(),p_client_id) returning id into result;
 insert into public.audit_events(actor_id,action,resource_id,details) values(auth.uid(),'contract.executed_version_registered',result,jsonb_build_object('user_id',p_user_id,'version',next_version,'document_version_id',p_document_version_id,'basis','externally_executed_document'));
 insert into public.notifications(user_id,kind,resource_id) values(p_user_id,'contract_available',result);return result;
end;$$;
create or replace function private.submit_invoice(p_number text,p_claim_ids uuid[],p_document_version_id uuid,p_issued_on date,p_due_on date,p_client_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare previous public.invoices; version public.document_versions; document public.documents; normalized uuid[]; result uuid; currencies int; total numeric; original_currency text;
begin
 if not private.lecturer_actor() then raise exception 'Active lecturer required' using errcode='42501';end if;
 if p_client_id is null or p_number is null or length(trim(p_number)) not between 1 and 80 or cardinality(p_claim_ids) not between 1 and 50 or p_claim_ids is null or p_issued_on is null or p_due_on is null or p_due_on<p_issued_on then raise exception 'Invalid invoice metadata' using errcode='22023';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('invoice:'||auth.uid()::text,0));
 select array_agg(distinct x order by x) into normalized from unnest(p_claim_ids) x;
 if cardinality(normalized)<>cardinality(p_claim_ids) or array_position(normalized,null) is not null then raise exception 'Unique claim IDs required' using errcode='22023';end if;
 select * into previous from public.invoices where user_id=auth.uid() and client_id=p_client_id;
 if found then
  if previous.number<>trim(p_number) or previous.document_version_id<>p_document_version_id or previous.issued_on<>p_issued_on or previous.due_on<>p_due_on or normalized is distinct from (select array_agg(claim_id order by claim_id) from public.invoice_items where invoice_id=previous.id) then raise exception 'Invoice idempotency conflict' using errcode='22023';end if;return previous.id;
 end if;
 if exists(select 1 from unnest(normalized) selected where not exists(select 1 from public.job_claims c where c.id=selected and c.lecturer_id=auth.uid() and c.status='confirmed')) then raise exception 'Only own accepted claims can be invoiced' using errcode='42501';end if;
 if exists(select 1 from public.invoice_items where claim_id=any(normalized) and active) then raise exception 'A claim already has an active invoice' using errcode='23505';end if;
 select count(distinct c.currency),sum(c.total_amount),min(c.currency) into currencies,total,original_currency from public.job_claims c where c.id=any(normalized);
 if currencies<>1 or total<=0 then raise exception 'Invoice must use one original currency and positive accepted compensation' using errcode='22023';end if;
 select * into version from public.document_versions where id=p_document_version_id;
 select * into document from public.documents where id=version.document_id;
 if document.id is null or document.owner_id<>auth.uid() or document.deleted_at is not null or document.kind<>'invoice' or document.scope<>'personal' or version.status<>'clean' or version.mime_type<>'application/pdf' or version.sha256 is null then raise exception 'Own clean invoice PDF required' using errcode='42501';end if;
 insert into public.invoices(user_id,number,issued_on,due_on,currency,total_amount,document_version_id,client_id) values(auth.uid(),trim(p_number),p_issued_on,p_due_on,original_currency,total,p_document_version_id,p_client_id) returning id into result;
 insert into public.invoice_items(invoice_id,claim_id) select result,x from unnest(normalized) x;
 insert into public.audit_events(actor_id,action,resource_id,details) values(auth.uid(),'invoice.submitted',result,jsonb_build_object('currency',original_currency,'accepted_compensation',total));return result;
end;$$;
create or replace function private.can_read_course_run(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.actor_active() and (
 private.has_permission('courses.manage')
 or (private.lecturer_actor() and exists(select 1 from public.course_runs r where r.id=p_id and r.published and r.archived_at is null))
 or exists(select 1 from public.jobs j join public.job_claims c on c.job_id=j.id where j.course_run_id=p_id and c.lecturer_id=auth.uid() and c.status='confirmed')
 or exists(select 1 from public.chat_rooms r where r.kind='participant_course' and r.course_run_id=p_id and private.can_access_chat_room(r.id))
 );
$$;
create or replace function private.can_access_document(p_id uuid) returns boolean language plpgsql stable security definer set search_path='' as $$
declare d public.documents;
begin
 if not private.actor_active() then return false; end if;
 select * into d from public.documents where id=p_id and deleted_at is null;
 if not found then return false; end if;
 if d.scope='room' then return private.can_access_chat_room(d.room_id); end if;
 if d.scope='personal' then
  return d.owner_id=auth.uid()
   or (d.kind='certificate' and private.has_permission('qualifications.verify'))
   or (d.kind='cv' and private.has_permission('users.manage'))
   or (d.kind='contract' and private.has_permission('contracts.read'))
   or (d.kind='invoice' and private.has_permission('finance.manage'));
 end if;
 if private.has_permission('jobs.manage') then return true; end if;
 if exists(select 1 from public.job_claims c where c.job_id=d.job_id and c.lecturer_id=auth.uid() and c.status='confirmed') then return true; end if;
 return d.scope='job_before' and private.lecturer_actor() and exists(select 1 from public.jobs j where j.id=d.job_id and j.status='published');
end;$$;

drop policy jobs_read on public.jobs;
create policy jobs_read on public.jobs for select to authenticated using((select private.actor_active()) and ((select private.has_permission('jobs.manage')) or (status='published' and (select private.lecturer_actor())) or exists(select 1 from public.job_claims c where c.job_id=jobs.id and c.lecturer_id=(select auth.uid()))));

-- Owner is an available staff contact/group member, without any room read bypass.
create or replace function private.can_chat_contact(p_user_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.actor_active() and p_user_id<>auth.uid()
 and exists(select 1 from public.profiles p join public.user_roles r on r.user_id=p.id where p.id=p_user_id and p.active and r.role in ('admin','owner','management','senior_lecturer','lecturer','participant'))
 and ((private.chat_staff(auth.uid()) and private.chat_staff(p_user_id))
 or private.has_permission('courses.manage')
 or exists(select 1 from public.chat_members a join public.chat_members b on b.room_id=a.room_id join public.chat_rooms r on r.id=a.room_id where a.user_id=auth.uid() and b.user_id=p_user_id and a.removed_at is null and b.removed_at is null and r.kind='participant_course'));
$$;
create or replace function private.create_chat_group(p_title text,p_member_ids uuid[],p_kind text default 'topic',p_job_id uuid default null) returns uuid language plpgsql security definer set search_path='' as $$
declare room uuid; member uuid; course uuid; normalized uuid[];
begin
 if not private.actor_active() then raise exception 'Authentication required' using errcode='42501'; end if;
 if p_kind not in ('topic','participant_course') or p_kind is null or length(trim(coalesce(p_title,''))) not between 1 and 160 or cardinality(p_member_ids)>100 then raise exception 'Invalid group data' using errcode='22023'; end if;
 if p_kind='topic' and not private.chat_staff(auth.uid()) then raise exception 'Staff role required' using errcode='42501'; end if;
 if p_kind='participant_course' then
  if not private.has_permission('courses.manage') then raise exception 'courses.manage and MFA required' using errcode='42501'; end if;
  select course_run_id into course from public.jobs where public.jobs.id=p_job_id;
  if course is null then raise exception 'A real course run is required' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('participant-course:'||course::text,0));
  if exists(select 1 from public.chat_rooms where kind='participant_course' and course_run_id=course) then raise exception 'Participant channel already exists' using errcode='23505'; end if;
 end if;
 select array_agg(distinct x) into normalized from unnest(coalesce(p_member_ids,'{}')||array[auth.uid()]) x;
 foreach member in array normalized loop
  if not exists(select 1 from public.profiles p join public.user_roles ur on ur.user_id=p.id where p.id=member and p.active and ur.role in ('admin','owner','management','senior_lecturer','lecturer','participant')) or (p_kind='topic' and not private.chat_staff(member)) then raise exception 'Invalid group member' using errcode='22023'; end if;
 end loop;
 insert into public.chat_rooms(kind,title,owner_id,course_run_id) values(p_kind,trim(p_title),auth.uid(),course) returning id into room;
 insert into public.chat_members(room_id,user_id) select room,x from unnest(normalized) x;
 insert into public.audit_events(actor_id,action,resource_id,details) values(auth.uid(),'chat.group_created',room,jsonb_build_object('kind',p_kind,'member_count',cardinality(normalized)));
 return room;
end;$$;
create or replace function private.manage_chat_member(p_room_id uuid,p_user_id uuid,p_remove boolean) returns void language plpgsql security definer set search_path='' as $$
declare room public.chat_rooms;
begin
 select * into room from public.chat_rooms where id=p_room_id for update;
 if not found or not private.can_access_chat_room(p_room_id) or room.kind in ('dm','general') then raise exception 'Membership management denied' using errcode='42501'; end if;
 if room.owner_id is distinct from auth.uid() and not (room.kind in ('participant_course','lecturer_course') and private.has_permission('courses.manage')) then raise exception 'Only the group owner may manage members' using errcode='42501'; end if;
 if p_remove is null or p_user_id=room.owner_id then raise exception 'The owner must remain a member' using errcode='22023'; end if;
 if p_remove then
  update public.chat_members set removed_at=clock_timestamp() where room_id=p_room_id and user_id=p_user_id and removed_at is null;
 else
  if not exists(select 1 from public.profiles p join public.user_roles ur on ur.user_id=p.id where p.id=p_user_id and p.active and ur.role in ('admin','owner','management','senior_lecturer','lecturer','participant')) or (room.kind in ('topic','lecturer_course') and not private.chat_staff(p_user_id)) then raise exception 'Invalid group member' using errcode='22023'; end if;
  insert into public.chat_members(room_id,user_id) values(p_room_id,p_user_id) on conflict(room_id,user_id) do update set removed_at=null,joined_at=clock_timestamp();
 end if;
 insert into public.audit_events(actor_id,action,resource_id,details) values(auth.uid(),case when p_remove then 'chat.member_removed' else 'chat.member_added' end,p_room_id,jsonb_build_object('user_id',p_user_id));
end;$$;
create or replace function private.verify_lecturer_topic(p_user_id uuid,p_topic_id uuid,p_verified boolean,p_valid_until timestamptz default null)
returns void language plpgsql security definer set search_path='' as $$
declare previous public.lecturer_topics; expiry timestamptz;
begin
 if not private.has_permission('qualifications.verify') then raise exception 'qualifications.verify and MFA required' using errcode='42501'; end if;
 if p_verified is null then raise exception 'Verification decision required' using errcode='22023'; end if;
 if p_verified and p_valid_until is not null and p_valid_until<=now() then raise exception 'Verification expiry must be in the future' using errcode='22023'; end if;
 -- Do not attest an inactive or non-lecturer account. Locking the target profile also
 -- serializes this decision against suspension without widening profile visibility.
 perform 1 from public.profiles p where p.id=p_user_id and p.active for share;
 if not found or not private.lecturer_user(p_user_id) then raise exception 'An active lecturer is required' using errcode='22023'; end if;
 select * into previous from public.lecturer_topics where user_id=p_user_id and topic_id=p_topic_id for update;
 if not found then raise exception 'The lecturer must select this expertise first' using errcode='22023'; end if;
 expiry=case when p_verified then p_valid_until else null end;
 update public.lecturer_topics set verified=p_verified,valid_until=expiry where user_id=p_user_id and topic_id=p_topic_id;
 insert into public.audit_events(actor_id,action,resource_id,details)
 values(auth.uid(),'qualification.attested',p_user_id,jsonb_build_object('topic_id',p_topic_id,'previous_verified',previous.verified,'previous_valid_until',previous.valid_until,'verified',p_verified,'valid_until',expiry,'basis','management_attestation'));
end;$$;

-- Labels are mutable organization metadata, never an accepted fee/PDF change.
alter table public.invoices add column labels text[] not null default '{}' check(cardinality(labels)<=10);
create or replace function private.immutable_invoice_snapshot() returns trigger language plpgsql set search_path='' as $$
begin
 if (to_jsonb(new)-'status'-'note'-'reviewed_by'-'reviewed_at'-'labels') is distinct from (to_jsonb(old)-'status'-'note'-'reviewed_by'-'reviewed_at'-'labels') then raise exception 'Submitted invoice snapshots are immutable' using errcode='23514';end if;return new;
end;$$;
create function private.set_invoice_labels(p_invoice_id uuid,p_labels text[]) returns void language plpgsql security definer set search_path='' as $$
declare invoice public.invoices; normalized text[];
begin
 if not private.actor_active() then raise exception 'Invoice access required' using errcode='42501';end if;
 select * into invoice from public.invoices where id=p_invoice_id for update;
 if not found or not (invoice.user_id=auth.uid() or private.has_permission('finance.manage')) then raise exception 'Invoice access required' using errcode='42501';end if;
 if p_labels is null or cardinality(p_labels)>10 or exists(select 1 from unnest(p_labels) label where label is null or length(trim(label)) not between 1 and 50 or label~'[[:cntrl:]]') then raise exception 'Up to ten labels of one to fifty characters required' using errcode='22023';end if;
 select coalesce(array_agg(label order by label),'{}') into normalized from(select distinct trim(label) label from unnest(p_labels) label)x;
 if invoice.labels is not distinct from normalized then return;end if;
 update public.invoices set labels=normalized where id=p_invoice_id;
 insert into public.audit_events(actor_id,action,resource_id) values(auth.uid(),'invoice.labels_changed',p_invoice_id);
end;$$;
create function public.set_invoice_labels(p_invoice_id uuid,p_labels text[]) returns void language sql security invoker set search_path='' as $$select private.set_invoice_labels(p_invoice_id,p_labels);$$;
drop function public.invoice_records(boolean);
drop function private.invoice_records(boolean);
create function private.invoice_records(p_all boolean default false)
returns table(id uuid,user_id uuid,user_name text,number text,issued_on date,due_on date,currency text,total_amount numeric,paid_amount numeric,status text,document_id uuid,document_version_id uuid,claim_ids uuid[],created_at timestamptz,note text,paid_at timestamptz,labels text[])
language plpgsql stable security definer set search_path='' as $$
begin
 if not private.actor_active() or (p_all and not private.has_permission('finance.manage')) then raise exception 'Own invoices or finance management and MFA required' using errcode='42501';end if;
 return query select i.id,i.user_id,p.display_name,i.number,i.issued_on,i.due_on,i.currency,i.total_amount,
 coalesce((select sum(r.amount) from public.payment_records r where r.invoice_id=i.id and r.voided_at is null),0),i.status,v.document_id,i.document_version_id,
 coalesce((select array_agg(item.claim_id order by item.claim_id) from public.invoice_items item where item.invoice_id=i.id),'{}'::uuid[]),i.created_at,i.note,(select max(r.paid_at) from public.payment_records r where r.invoice_id=i.id and r.voided_at is null),i.labels
 from public.invoices i join public.profiles p on p.id=i.user_id join public.document_versions v on v.id=i.document_version_id where p_all or i.user_id=auth.uid() order by i.created_at desc,i.id;
end;$$;
create function public.invoice_records(p_all boolean default false)
returns table(id uuid,user_id uuid,user_name text,number text,issued_on date,due_on date,currency text,total_amount numeric,paid_amount numeric,status text,document_id uuid,document_version_id uuid,claim_ids uuid[],created_at timestamptz,note text,paid_at timestamptz,labels text[])
language sql stable security invoker set search_path='' as $$ select * from private.invoice_records(p_all); $$;


-- Private implementations remain unexposed; wrappers invoke their fresh actor checks.
do $$declare item record;begin
 for item in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.proname in ('lecturer_user','lecturer_actor','client_has_organisation','manage_client_organisation','commission_access','client_organisations','create_client_request','set_job_commission','publish_client_request','create_commission_job','cancel_client_request','client_requests','commission_report','client_spend_summary','set_invoice_labels','invoice_records') loop
  execute format('revoke execute on function %s from public,anon,authenticated',item.signature);execute format('grant execute on function %s to authenticated',item.signature);
 end loop;
end;$$;
revoke execute on function private.capture_claim_revenue(),private.immutable_revenue_ledger() from public,anon,authenticated;
commit;
