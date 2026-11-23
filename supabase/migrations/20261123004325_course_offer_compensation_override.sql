begin;

-- An explicit course percentage wins over a lecturer's personal or role rate.
-- Existing offers and accepted claim snapshots retain their current values.
alter table private.job_commission_offers
  add column platform_percent_override numeric(5,2)
  check (platform_percent_override between 0 and 100);
alter table private.client_course_requests
  add column published_platform_percent numeric(5,2)
  check (published_platform_percent between 0 and 100);

-- Operational pricing is deliberately narrower than finance access. Management
-- can set and read explicit pricing on its own unaccepted offers only.
insert into public.role_permissions(role, permission)
values ('management', 'courses.pricing.manage') on conflict do nothing;

create function private.can_price_owned_course_offers()
returns boolean language sql stable security definer set search_path = '' as $$
  select (select edition from private.installation_identity where singleton) = 'internal'
    and private.has_permission('jobs.manage')
    and private.has_permission('courses.manage')
    and private.has_permission('courses.pricing.manage');
$$;
revoke all on function private.can_price_owned_course_offers()
from public, anon, authenticated, service_role;

create or replace function private.commission_access()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'can_manage_gross', private.has_permission('finance.gross.read'),
    'can_manage_client_memberships', private.has_permission('finance.gross.read'),
    'can_request', private.has_permission('finance.gross.read') or (
      private.has_role(array['client']) and exists (
        select 1 from public.client_organisation_memberships m
        where m.user_id = auth.uid() and private.client_has_organisation(m.organisation_id)
      )
    ),
    'policy_configured', exists (select 1 from private.compensation_policy)
  ) || case
    when private.has_permission('finance.gross.read') then jsonb_build_object(
      'regular_lecturer_percent', (select regular_percent from private.compensation_policy),
      'senior_lecturer_percent', (select senior_percent from private.compensation_policy),
      'policy_version', coalesce((select version from private.compensation_policy), 0)
    )
    when private.can_price_owned_course_offers() then jsonb_build_object(
      'can_manage_own_course_pricing', true
    )
    else '{}'::jsonb
  end;
$$;

-- Keep request authorization at the existing public boundary. Only the
-- authorized offer creators can call this shared private write path directly.
create function private.create_client_request_record(p_organisation_id uuid,p_payload jsonb,p_client_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare r private.client_course_requests; s jsonb; k text; normalized jsonb; sessions jsonb:='[]'::jsonb; topics jsonb; starts timestamptz; ends timestamptz; tz text; gross numeric; total numeric;
begin
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
revoke all on function private.create_client_request_record(uuid,jsonb,uuid)
from public, anon, authenticated, service_role;

create or replace function private.create_client_request(
  p_organisation_id uuid, p_payload jsonb, p_client_id uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
begin
  if not (
    private.has_permission('finance.gross.read')
    or private.client_has_organisation(p_organisation_id)
  ) then
    raise exception 'Organisation access required' using errcode = '42501';
  end if;
  return private.create_client_request_record(p_organisation_id, p_payload, p_client_id);
end;
$$;

create or replace function private.set_job_commission(
  p_job_id uuid, p_gross_amount numeric, p_gross_total_amount numeric,
  p_platform_percent numeric default null
) returns void language plpgsql security definer set search_path = '' as $$
declare
  j public.jobs%rowtype;
  org uuid;
  policy private.compensation_policy%rowtype;
  regular_share numeric;
  senior_share numeric;
  net_rate numeric;
  net_total numeric;
  gross_finance boolean := private.has_permission('finance.gross.read');
begin
  if not gross_finance and not (private.can_price_owned_course_offers() and p_platform_percent is not null) then
    raise exception 'Gross finance permission required' using errcode = '42501';
  end if;
  if p_platform_percent is not null
     and (select edition from private.installation_identity where singleton) is distinct from 'internal' then
    raise exception 'Course commission is only available in the internal edition' using errcode = '42501';
  end if;
  if p_gross_amount is null or p_gross_total_amount is null
     or p_gross_amount not between 0.01 and 9999999999.99
     or p_gross_total_amount not between 0.01 and 9999999999.99
     or p_gross_amount <> round(p_gross_amount, 2)
     or p_gross_total_amount <> round(p_gross_total_amount, 2)
     or (p_platform_percent is not null and (
       p_platform_percent not between 0 and 100
       or p_platform_percent <> round(p_platform_percent, 2)
     )) then
    raise exception 'Invalid commission' using errcode = '22023';
  end if;
  select * into j from public.jobs where id = p_job_id for update;
  if not gross_finance and (
    j.created_by is distinct from auth.uid() or exists (
      select 1 from private.job_commission_offers o
      where o.job_id = p_job_id and o.platform_percent_override is null
    )
  ) then
    raise exception 'Own offer with explicit pricing required' using errcode = '42501';
  end if;
  if j.id is null or j.status not in ('draft', 'published')
     or exists (select 1 from public.job_claims where job_id = p_job_id) then
    raise exception 'Only unaccepted offers can change commission' using errcode = '22023';
  end if;
  select organisation_id into org from public.course_runs where id = j.course_run_id;
  if org is null then
    raise exception 'Offer requires an organisation' using errcode = '22023';
  end if;
  if j.rate_unit = 'fixed_total' and p_gross_amount <> p_gross_total_amount then
    raise exception 'Fixed total fee must match' using errcode = '22023';
  end if;
  select * into policy from private.compensation_policy where singleton;
  regular_share := coalesce(100 - p_platform_percent, policy.regular_percent, 50);
  senior_share := coalesce(100 - p_platform_percent, policy.senior_percent, 50);

  if exists (
    select 1 from private.job_commission_offers o
    where o.job_id = p_job_id and o.gross_amount = p_gross_amount
      and o.gross_total_amount = p_gross_total_amount and o.currency = j.currency
      and o.pricing_mode = 'role_split' and o.policy_version = coalesce(policy.version, 1)
      and o.regular_percent = regular_share and o.senior_percent = senior_share
      and o.platform_percent_override is not distinct from p_platform_percent
  ) then return; end if;

  net_rate := round(p_gross_amount * regular_share / 100, 2);
  net_total := round(p_gross_total_amount * regular_share / 100, 2);
  insert into private.job_commission_offers (
    job_id, organisation_id, gross_amount, gross_total_amount,
    platform_percent, platform_total_amount, lecturer_net_amount, lecturer_net_total_amount,
    currency, pricing_mode, regular_percent, senior_percent, policy_version,
    platform_percent_override
  ) values (
    p_job_id, org, p_gross_amount, p_gross_total_amount,
    100 - regular_share, p_gross_total_amount - net_total, net_rate, net_total,
    j.currency, 'role_split', regular_share, senior_share, coalesce(policy.version, 1),
    p_platform_percent
  ) on conflict (job_id) do update set
    organisation_id = excluded.organisation_id,
    gross_amount = excluded.gross_amount,
    gross_total_amount = excluded.gross_total_amount,
    currency = excluded.currency,
    pricing_mode = excluded.pricing_mode,
    regular_percent = excluded.regular_percent,
    senior_percent = excluded.senior_percent,
    policy_version = excluded.policy_version,
    platform_percent_override = excluded.platform_percent_override,
    updated_at = clock_timestamp();

  update public.jobs set amount = 0, total_amount = 0, terms_version = terms_version + 1
  where id = p_job_id;
  insert into public.audit_events(actor_id, action, resource_id)
  values (auth.uid(), 'job.commission_configured', p_job_id);
end;
$$;

create or replace function private.commission_offer_policy(p_job_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  result jsonb;
  gross_finance boolean := private.has_permission('finance.gross.read');
begin
  if not gross_finance then
    if not private.can_price_owned_course_offers() or not exists (
      select 1 from public.jobs j
      join public.course_runs r on r.id = j.course_run_id
      where j.id = p_job_id and j.created_by = auth.uid() and r.organisation_id is not null
    ) or exists (
      select 1 from private.job_commission_offers o
      where o.job_id = p_job_id and o.platform_percent_override is null
    ) then
      raise exception 'Gross finance permission or own explicit offer required' using errcode = '42501';
    end if;
  end if;
  select jsonb_build_object(
    'regular_lecturer_percent', regular_percent,
    'senior_lecturer_percent', senior_percent,
    'policy_version', policy_version
  ) || case when platform_percent_override is not null then
    jsonb_build_object('platform_percent_override', platform_percent_override)
  else '{}'::jsonb end || case when not gross_finance then
    jsonb_build_object('gross_amount', gross_amount, 'gross_total_amount', gross_total_amount)
  else '{}'::jsonb end into result
  from private.job_commission_offers
  where job_id = p_job_id and pricing_mode = 'role_split' and policy_version is not null;
  return result;
end;
$$;

create or replace function private.lecturer_job_quote(
  p_user_id uuid, p_job_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  configured private.lecturer_compensation%rowtype;
  job_row public.jobs%rowtype;
  offer_row private.job_commission_offers%rowtype;
  customized boolean;
  role_percent numeric(5,2);
  net_amount numeric;
  net_total numeric;
  teaching_days integer;
  units numeric;
begin
  select * into job_row from public.jobs where id = p_job_id;
  if not found or not private.lecturer_user(p_user_id) then return null; end if;
  select * into offer_row
  from private.job_commission_offers where job_id = p_job_id;
  if offer_row.job_id is null or offer_row.pricing_mode <> 'role_split' then
    return jsonb_build_object(
      'amount', job_row.amount,
      'total_amount', job_row.total_amount,
      'currency', job_row.currency,
      'rate_unit', job_row.rate_unit
    );
  end if;

  select * into configured
  from private.lecturer_compensation where user_id = p_user_id;
  customized := found;
  if offer_row.platform_percent_override is not null
     or not customized or configured.mode = 'percent' then
    role_percent := case
      when offer_row.platform_percent_override is not null then offer_row.regular_percent
      when customized then configured.percent
      when exists (
        select 1 from public.user_roles
        where user_id = p_user_id and role = 'senior_lecturer'
      ) then coalesce(offer_row.senior_percent, 50)
      else coalesce(offer_row.regular_percent, 50)
    end;
    net_amount := round(offer_row.gross_amount * role_percent / 100, 2);
    net_total := round(offer_row.gross_total_amount * role_percent / 100, 2);
  else
    if configured.currency <> job_row.currency then return null; end if;
    select count(distinct day_value::date) into teaching_days
    from public.job_sessions session
    cross join lateral generate_series(
      (session.starts_at at time zone job_row.time_zone)::date,
      ((session.ends_at - interval '1 microsecond') at time zone job_row.time_zone)::date,
      interval '1 day'
    ) day_value
    where session.job_id = job_row.id;
    if teaching_days < 1 then return null; end if;
    net_total := round(configured.daily_rate * teaching_days, 2);
    units := case
      when job_row.rate_unit = 'fixed_total' then 1
      when job_row.rate_unit = 'per_day' then teaching_days
      else (
        select sum(extract(epoch from ends_at - starts_at)) / 3600
        from public.job_sessions where job_id = job_row.id
      )
    end;
    if units is null or units <= 0 then return null; end if;
    net_amount := round(net_total / units, 2);
  end if;

  if net_amount is null or net_total is null or
     net_amount > offer_row.gross_amount or
     net_total > offer_row.gross_total_amount then
    return null;
  end if;
  return jsonb_build_object(
    'amount', net_amount,
    'total_amount', net_total,
    'currency', job_row.currency,
    'rate_unit', job_row.rate_unit
  );
end;
$$;

create or replace function private.publish_client_request(p_request_id uuid,p_platform_percent numeric default null,p_terms text default 'Accepted lecturer assignment terms.',p_requires_contract boolean default true,p_claim_deadline timestamptz default null) returns uuid language plpgsql security definer set search_path='' as $$
declare r private.client_course_requests; j public.jobs; org public.organisations; template uuid; run uuid; job uuid; session_id uuid; s jsonb;
 gross_finance boolean := private.has_permission('finance.gross.read');
begin
 if not gross_finance and not (private.can_price_owned_course_offers() and p_platform_percent is not null) then raise exception 'Gross finance permission required' using errcode='42501';end if;
 select * into r from private.client_course_requests where id=p_request_id for update;
 if not gross_finance and (
   r.requested_by is distinct from auth.uid()
   or r.creation_options->'platform_percent' is distinct from to_jsonb(p_platform_percent)
 ) then raise exception 'Own offer publication required' using errcode='42501';end if;
 if r.id is null or r.status='cancelled' then raise exception 'Request unavailable' using errcode='22023';end if;
 if p_terms is null or length(trim(p_terms)) not between 1 and 12000 or p_requires_contract is null or (p_claim_deadline is not null and (not isfinite(p_claim_deadline) or p_claim_deadline<=clock_timestamp())) then raise exception 'Valid lecturer terms required' using errcode='22023';end if;
 if r.job_id is not null then
  select * into j from public.jobs where id=r.job_id;
  if j.terms is distinct from p_terms or j.requires_contract is distinct from p_requires_contract or j.claim_deadline is distinct from p_claim_deadline or r.published_platform_percent is distinct from p_platform_percent or not exists(select 1 from private.job_commission_offers o where o.job_id=j.id and o.pricing_mode='role_split') then raise exception 'Publication idempotency conflict' using errcode='22023';end if;return r.job_id;
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
 update public.jobs set status='published' where id=job;update private.client_course_requests set status='published',job_id=job,published_platform_percent=p_platform_percent where id=r.id;
 insert into public.audit_events(actor_id,action,resource_id) values(auth.uid(),'client.request_published',r.id);
 return job;
end;$$;

create or replace function private.create_commission_job(p_organisation_id uuid,p_payload jsonb,p_platform_percent numeric default null,p_client_id uuid default null) returns uuid language plpgsql security definer set search_path='' as $$
declare org uuid:=p_organisation_id; request_id uuid; job uuid; previous private.client_course_requests; customer text:=trim(coalesce(p_payload->>'customer_name','')); desired_status text:=coalesce(p_payload->>'status','published'); options jsonb:=jsonb_build_object('organisation_id',p_organisation_id,'payload',p_payload,'platform_percent',p_platform_percent);
begin
 if not private.has_permission('finance.gross.read') and not (private.can_price_owned_course_offers() and p_platform_percent is not null) then raise exception 'Gross finance permission required' using errcode='42501';end if;
 if p_client_id is null or desired_status not in ('draft','published') then raise exception 'Valid request ID and status required' using errcode='22023';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('client-request:'||auth.uid()::text,0));
 select * into previous from private.client_course_requests where requested_by=auth.uid() and client_id=p_client_id;
 if found and previous.creation_options is distinct from options then raise exception 'Request operation idempotency conflict' using errcode='22023';end if;
 if org is null then
  if length(customer) not between 1 and 200 then raise exception 'Customer name required' using errcode='22023';end if;
  if previous.id is not null then org=previous.organisation_id;if not exists(select 1 from public.organisations where id=org and name=customer) then raise exception 'Request idempotency conflict' using errcode='22023';end if;
  else insert into public.organisations(name,time_zone) values(customer,coalesce(p_payload->>'time_zone','Europe/Berlin')) returning id into org;end if;
 end if;
 request_id=private.create_client_request_record(org,p_payload-array['customer_name','status','terms','requires_contract','claim_deadline'],p_client_id);
 if previous.id is null then update private.client_course_requests set creation_options=options where id=request_id;end if;
 job=private.publish_client_request(request_id,p_platform_percent,coalesce(p_payload->>'terms','Accepted lecturer assignment terms.'),coalesce((p_payload->>'requires_contract')::boolean,true),(p_payload->>'claim_deadline')::timestamptz);
 if previous.job_id is not null and exists(select 1 from public.jobs where id=job and status<>desired_status) then raise exception 'Publication idempotency conflict' using errcode='22023';end if;
 if desired_status='draft' then update public.jobs set status='draft' where id=job;update public.course_runs set published=false where id=(select course_run_id from public.jobs where id=job);end if;
 return job;
end;$$;

create or replace function private.create_capacity_job(p_payload jsonb,p_capacity int,p_request_id uuid,p_organisation_id uuid default null,p_platform_percent numeric default null) returns uuid language plpgsql security definer set search_path='' as $$
declare prior private.job_lifecycle_requests;parameters jsonb;result uuid;
begin
 if not private.has_permission('jobs.manage') then raise exception 'jobs.manage and MFA required' using errcode='42501';end if;
 perform 1 from public.profiles where id=auth.uid() and active for share;
 if not found then raise exception 'Authentication required' using errcode='42501';end if;
 if p_capacity is null or p_capacity not between 1 and 20 or p_request_id is null or jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'One to twenty explicitly priced positions required' using errcode='22023';end if;
 parameters=jsonb_build_object('action','create_capacity_job','payload',p_payload,'capacity',p_capacity,'organisation_id',p_organisation_id,'platform_percent',p_platform_percent);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('job-request:'||auth.uid()::text||p_request_id::text,0));
 select * into prior from private.job_lifecycle_requests where actor_id=auth.uid() and request_id=p_request_id;
 if found then if prior.payload<>parameters then raise exception 'Lifecycle idempotency conflict' using errcode='22023';end if;return prior.result;end if;
 if p_payload?'gross_amount' or p_payload?'gross_total_amount' then
  result=private.create_commission_job(p_organisation_id,p_payload,p_platform_percent,p_request_id);
 else
  if p_platform_percent is not null then raise exception 'Gross pricing required for commission override' using errcode='42501';end if;
  if p_organisation_id is not null then raise exception 'Organisation pricing requires the gross workflow' using errcode='22023';end if;
  result=private.create_job(p_payload);
 end if;
 update public.jobs set capacity=p_capacity,capacity_basis='per_position' where id=result;
 insert into private.job_lifecycle_requests(actor_id,request_id,payload,result) values(auth.uid(),p_request_id,parameters,result);
 insert into public.audit_events(actor_id,action,resource_id,details) values(auth.uid(),'job.capacity_created',result,jsonb_build_object('positions',p_capacity,'basis','per_position'));
 return result;
end;$$;

do $migration$
declare
  definition text := pg_catalog.pg_get_functiondef(
    'private.create_course_run_job(uuid,jsonb,numeric,uuid)'::regprocedure
  );
  updated text;
begin
  -- Keep the established legacy net argument (50) and the course-run capacity checks.
  updated := replace(definition,
    $old$ if gross and p_platform_percent is not null then raise exception 'Compensation policy is configured separately' using errcode='22023';end if;$old$,
    ''
  );
  if updated = definition then
    raise exception 'Course-offer commission validation seam missing';
  end if;
  definition := updated;
  updated := replace(definition,
    $old$gross boolean:=private.has_permission('finance.gross.read');$old$,
    $new$gross boolean:=private.has_permission('finance.gross.read') or
      (private.can_price_owned_course_offers() and p_platform_percent is not null
       and (p_payload?'gross_amount' or p_payload?'gross_total_amount'));$new$
  );
  if updated = definition then
    raise exception 'Course-offer pricing permission seam missing';
  end if;
  definition := updated;
  updated := replace(definition,
    'request_id=private.create_client_request(',
    'request_id=private.create_client_request_record('
  );
  if updated = definition then
    raise exception 'Course-offer request seam missing';
  end if;
  definition := updated;
  updated := replace(definition,
    $old$set job_id=job,status='published',creation_options=$old$,
    $new$set job_id=job,status='published',published_platform_percent=p_platform_percent,
    creation_options=jsonb_build_object('platform_percent',p_platform_percent) || $new$
  );
  if updated = definition then
    raise exception 'Course-offer publication retry seam missing';
  end if;
  execute updated;
end;
$migration$;

notify pgrst, 'reload schema';
commit;
