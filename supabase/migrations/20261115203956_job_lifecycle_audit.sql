begin;

-- Cancellation releases availability without deleting the accepted interval or
-- mutating any accepted fee/terms/revenue row. Old active data keep NULL here.
alter table public.jobs add column lifecycle_version integer not null default 1 check(lifecycle_version>0);
alter table public.assignment_sessions add column released_at timestamptz check(released_at is null or isfinite(released_at));
do $$declare c record;begin
 for c in select conname from pg_catalog.pg_constraint where conrelid='public.assignment_sessions'::regclass and contype='x' loop
  execute format('alter table public.assignment_sessions drop constraint %I',c.conname);
 end loop;
end;$$;


alter table public.assignment_sessions add constraint active_assignment_no_overlap exclude using gist(lecturer_id with =,tstzrange(starts_at,ends_at,'[)') with &&) where(released_at is null);
alter table private.claim_revenue_ledger drop constraint claim_revenue_ledger_job_id_key;
create index claim_revenue_job_history on private.claim_revenue_ledger(job_id);

create table private.job_lifecycle_requests(
 actor_id uuid not null references public.profiles(id),request_id uuid not null,payload jsonb not null,result uuid not null,created_at timestamptz not null default clock_timestamp(),primary key(actor_id,request_id)
);
alter table private.job_lifecycle_requests enable row level security;
revoke all on private.job_lifecycle_requests from public,anon,authenticated;
grant all on private.job_lifecycle_requests to service_role;

create function private.bump_job_lifecycle_version() returns trigger language plpgsql set search_path='' as $$begin new.lifecycle_version=old.lifecycle_version+1;return new;end;$$;
create trigger job_lifecycle_revision before update on public.jobs for each row execute function private.bump_job_lifecycle_version();
revoke execute on function private.bump_job_lifecycle_version() from public,anon,authenticated;

create or replace function private.check_personal_event() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is not null and (auth.uid()<>new.user_id or not private.actor_active()) then raise exception 'Calendar owner mismatch' using errcode='42501'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.user_id::text,0));
 if exists(select 1 from public.assignment_sessions a where a.lecturer_id=new.user_id and a.released_at is null and tstzrange(a.starts_at,a.ends_at,'[)') && tstzrange(new.starts_at,new.ends_at,'[)')) then raise exception 'Private appointment conflicts with a confirmed assignment' using errcode='23P01';end if;
 return new;
end;$$;

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
 if exists(select 1 from public.job_sessions js join public.assignment_sessions a on a.lecturer_id=actor and a.released_at is null and tstzrange(a.starts_at,a.ends_at,'[)') && tstzrange(js.starts_at,js.ends_at,'[)') where js.job_id=j.id)
 or exists(select 1 from public.job_sessions js join public.personal_events e on e.user_id=actor and tstzrange(e.starts_at,e.ends_at,'[)') && tstzrange(js.starts_at,js.ends_at,'[)') where js.job_id=j.id)
 then return jsonb_build_object('status','conflict'); end if;
 insert into public.job_claims(job_id,lecturer_id,idempotency_key,amount,currency,rate_unit,total_amount,terms,terms_version,contract_id)
 values(j.id,actor,p_idempotency_key,j.amount,j.currency,j.rate_unit,j.total_amount,j.terms,j.terms_version,v_contract) returning id into v_claim;
 insert into public.assignment_sessions(claim_id,lecturer_id,starts_at,ends_at) select v_claim,actor,starts_at,ends_at from public.job_sessions where job_id=j.id;
 update public.jobs set status='filled' where id=j.id;
 insert into public.claim_events(claim_id,actor_id,event_type) values(v_claim,actor,'confirmed');
 insert into public.notifications(user_id,kind,resource_id) values(actor,'claim_confirmed',v_claim);
 insert into public.chat_rooms(job_id) values(j.id) on conflict(job_id) do update set job_id=excluded.job_id returning id into v_room;
 insert into public.chat_members(room_id,user_id) values(v_room,actor) on conflict(room_id,user_id) do update set removed_at=null,joined_at=clock_timestamp();
 update public.chat_rooms set owner_id=actor where id=v_room and owner_id is null;
 return jsonb_build_object('status','confirmed','claim_id',v_claim);
exception when exclusion_violation then
 -- PL/pgSQL exception subtransaction rolls back EVERY preceding write.
 return jsonb_build_object('status','conflict');
end;$$;

create or replace function private.commission_report(p_organisation_id uuid default null) returns table(job_id uuid,claim_id uuid,organisation_id uuid,organisation_name text,title text,status text,currency text,gross_amount numeric,gross_total_amount numeric,platform_percent numeric,platform_total_amount numeric,lecturer_net_amount numeric,lecturer_net_total_amount numeric,lecturer_id uuid,lecturer_name text,accepted_at timestamptz,pricing_model text) language plpgsql stable security definer set search_path='' as $$
begin
 if not private.has_permission('finance.gross.read') then raise exception 'Gross finance permission and MFA required' using errcode='42501';end if;
 return query select o.job_id,l.claim_id,o.organisation_id,org.name,j.title,j.status,coalesce(l.currency,o.currency),coalesce(l.gross_amount,o.gross_amount),coalesce(l.gross_total_amount,o.gross_total_amount),coalesce(l.platform_percent,o.platform_percent),coalesce(l.platform_total_amount,o.platform_total_amount),coalesce(l.lecturer_net_amount,o.lecturer_net_amount),coalesce(l.lecturer_net_total_amount,o.lecturer_net_total_amount),l.lecturer_id,p.display_name,l.accepted_at,'commission'::text
 from private.job_commission_offers o join public.jobs j on j.id=o.job_id join public.organisations org on org.id=o.organisation_id left join private.claim_revenue_ledger l on l.job_id=o.job_id and exists(select 1 from public.job_claims active where active.id=l.claim_id and active.status='confirmed') left join public.profiles p on p.id=l.lecturer_id where p_organisation_id is null or o.organisation_id=p_organisation_id
 union all select j.id,c.id,r.organisation_id,coalesce(org.name,j.customer_name),j.title,j.status,coalesce(c.currency,j.currency),null::numeric,null::numeric,null::numeric,null::numeric,coalesce(c.amount,j.amount),coalesce(c.total_amount,j.total_amount),c.lecturer_id,p.display_name,c.created_at,'legacy_net'::text
 from public.jobs j left join public.course_runs r on r.id=j.course_run_id left join public.organisations org on org.id=r.organisation_id left join public.job_claims c on c.job_id=j.id and c.status='confirmed' left join public.profiles p on p.id=c.lecturer_id where not exists(select 1 from private.job_commission_offers offer where offer.job_id=j.id) and (p_organisation_id is null or r.organisation_id=p_organisation_id);
end;$$;

create or replace function private.client_spend_summary() returns table(organisation_id uuid,organisation_name text,currency text,request_count bigint,published_count bigint,assigned_count bigint,gross_total_amount numeric,gross_assigned_amount numeric,teachers jsonb) language sql stable security definer set search_path='' as $$
 with entries as (
  select r.organisation_id,r.payload->>'currency' currency,r.job_id,case when r.job_id is null then r.status else j.status end status,coalesce(l.gross_total_amount,fee.gross_total_amount,(r.payload->>'gross_total_amount')::numeric) gross_total_amount,l.claim_id,coalesce(l.gross_total_amount,0) gross_assigned_amount
  from private.client_course_requests r left join public.jobs j on j.id=r.job_id left join private.job_commission_offers fee on fee.job_id=r.job_id left join private.claim_revenue_ledger l on l.job_id=r.job_id and exists(select 1 from public.job_claims active where active.id=l.claim_id and active.status='confirmed') where r.status<>'cancelled'
  union all select fee.organisation_id,fee.currency,fee.job_id,j.status,coalesce(l.gross_total_amount,fee.gross_total_amount),l.claim_id,coalesce(l.gross_total_amount,0) from private.job_commission_offers fee join public.jobs j on j.id=fee.job_id left join private.claim_revenue_ledger l on l.job_id=fee.job_id and exists(select 1 from public.job_claims active where active.id=l.claim_id and active.status='confirmed') where not exists(select 1 from private.client_course_requests r where r.job_id=fee.job_id)
 ),summary as (
  select o.id organisation_id,o.name organisation_name,e.currency,count(*) request_count,count(*)filter(where e.status in ('published','filled')) published_count,count(*)filter(where e.claim_id is not null) assigned_count,sum(e.gross_total_amount) gross_total_amount,sum(e.gross_assigned_amount) gross_assigned_amount
  from entries e join public.organisations o on o.id=e.organisation_id where private.has_permission('finance.gross.read') or private.client_has_organisation(o.id) group by o.id,o.name,e.currency
 )select s.*,coalesce((select jsonb_agg(x) from(select distinct p.id,p.display_name from private.claim_revenue_ledger rev join public.profiles p on p.id=rev.lecturer_id where exists(select 1 from public.job_claims active where active.id=rev.claim_id and active.status='confirmed') and rev.organisation_id=s.organisation_id and rev.currency=s.currency)x),'[]') from summary s order by s.organisation_name,s.currency;
$$;

create function private.job_lifecycle(p_job_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare j public.jobs; manager boolean:=private.has_permission('jobs.manage');
begin
 if not private.actor_active() then raise exception 'Authentication required' using errcode='42501';end if;
 select * into j from public.jobs where id=p_job_id;
 if j.id is null or not (manager or (private.lecturer_actor() and j.status='published') or exists(select 1 from public.job_claims c where c.job_id=j.id and c.lecturer_id=auth.uid())) then raise exception 'Job access denied' using errcode='42501';end if;
 return jsonb_build_object('version',j.lifecycle_version,'can_manage',manager,'can_edit',manager and not exists(select 1 from public.job_claims c where c.job_id=j.id),
 'can_duplicate',manager and private.has_permission('courses.manage') and not exists(select 1 from public.job_sessions where job_id=j.id and starts_at<=now()) and (not exists(select 1 from private.job_commission_offers o where o.job_id=j.id) or private.has_permission('finance.gross.read')),
 'claims',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'lecturer_id',c.lecturer_id,'lecturer_name',p.display_name,'status',c.status,'created_at',c.created_at,
 'can_cancel',c.status='confirmed' and not exists(select 1 from public.invoice_items i where i.claim_id=c.id) and (select min(s.starts_at) from public.assignment_sessions s where s.claim_id=c.id)>now(),
 'sessions',(select jsonb_agg(jsonb_build_object('starts_at',s.starts_at,'ends_at',s.ends_at,'released_at',s.released_at) order by s.starts_at) from public.assignment_sessions s where s.claim_id=c.id),
 'events',(select jsonb_agg(jsonb_build_object('type',e.event_type,'created_at',e.created_at,'reason',case when e.event_type='cancelled' then a.details->>'reason' end) order by e.created_at,e.id) from public.claim_events e left join public.audit_events a on a.resource_id=c.id and a.action='claim.cancelled' where e.claim_id=c.id)) order by c.created_at desc,c.id)
 from public.job_claims c join public.profiles p on p.id=c.lecturer_id where c.job_id=j.id and (manager or c.lecturer_id=auth.uid())),'[]'::jsonb));
end;$$;
create function public.job_lifecycle(p_job_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$select private.job_lifecycle(p_job_id);$$;

create function private.cancel_job_assignment(p_claim_id uuid,p_reason text,p_request_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare c public.job_claims;j public.jobs;prior private.job_lifecycle_requests;reason text:=trim(coalesce(p_reason,''));payload jsonb;
begin
 if not private.actor_active() then raise exception 'Authentication required' using errcode='42501';end if;
 perform 1 from public.profiles where id=auth.uid() and active for share;
 if not found then raise exception 'Authentication required' using errcode='42501';end if;
 if p_request_id is null or length(reason) not between 5 and 1000 then raise exception 'A cancellation reason and request key are required' using errcode='22023';end if;
 select * into c from public.job_claims where id=p_claim_id;
 if c.id is null or not (c.lecturer_id=auth.uid() and private.lecturer_actor() or private.has_permission('jobs.manage')) then raise exception 'Assignment access denied' using errcode='42501';end if;
 -- Serialize caller retries before following the claim/calendar/invoice lock order.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('job-request:'||auth.uid()::text||p_request_id::text,0));
 -- Match the claim/calendar/invoice lock order: lecturer first, job second.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(c.lecturer_id::text,0));
 select * into j from public.jobs where id=c.job_id for update;
 select * into c from public.job_claims where id=p_claim_id for update;
 payload=jsonb_build_object('action','cancel','claim_id',p_claim_id,'reason',reason);
 select * into prior from private.job_lifecycle_requests where actor_id=auth.uid() and request_id=p_request_id;
 if found then if prior.payload<>payload then raise exception 'Lifecycle idempotency conflict' using errcode='22023';end if;return prior.result;end if;
 if c.status<>'confirmed' then raise exception 'Assignment is already cancelled' using errcode='22023';end if;
 if exists(select 1 from public.invoice_items where claim_id=c.id) then raise exception 'Invoiced work requires financial review' using errcode='22023';end if;
 if (select min(starts_at) from public.assignment_sessions where claim_id=c.id)<=clock_timestamp() then raise exception 'Started work requires separate review' using errcode='22023';end if;
 update public.job_claims set status='cancelled' where id=c.id;
 update public.assignment_sessions set released_at=clock_timestamp() where claim_id=c.id and released_at is null;
 update public.jobs set status='draft' where id=j.id;
 update public.chat_members m set removed_at=clock_timestamp() from public.chat_rooms r where r.job_id=j.id and r.kind='lecturer_course' and m.room_id=r.id and m.user_id=c.lecturer_id and m.removed_at is null;
 update public.chat_rooms set owner_id=null where job_id=j.id and kind='lecturer_course' and owner_id=c.lecturer_id;
 insert into public.claim_events(claim_id,actor_id,event_type) values(c.id,auth.uid(),'cancelled');
 insert into public.audit_events(actor_id,action,resource_id,details) values(auth.uid(),'claim.cancelled',c.id,jsonb_build_object('job_id',j.id,'reason',reason));
 insert into public.notifications(user_id,kind,resource_id) values(c.lecturer_id,'claim_cancelled',c.id) on conflict do nothing;
 insert into private.job_lifecycle_requests(actor_id,request_id,payload,result) values(auth.uid(),p_request_id,payload,c.id);
 return c.id;
end;$$;
create function public.cancel_job_assignment(p_claim_id uuid,p_reason text,p_request_id uuid) returns uuid language sql security invoker set search_path='' as $$select private.cancel_job_assignment(p_claim_id,p_reason,p_request_id);$$;

create function private.manage_job_offer(p_job_id uuid,p_action text,p_expected_version int,p_request_id uuid,p_payload jsonb default '{}'::jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare j public.jobs;prior private.job_lifecycle_requests;payload jsonb;result uuid;run uuid;k text;deadline timestamptz;reason text:=trim(coalesce(p_payload->>'reason',''));
begin
 if not private.has_permission('jobs.manage') then raise exception 'jobs.manage and MFA required' using errcode='42501';end if;
 perform 1 from public.profiles where id=auth.uid() and active for share;
 if not found then raise exception 'Authentication required' using errcode='42501';end if;
 if p_request_id is null or p_expected_version is null or p_action is null or p_action not in('draft','published','archived','reopen','edit','duplicate') or jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Invalid lifecycle request' using errcode='22023';end if;
 for k in select jsonb_object_keys(p_payload) loop if k not in('reason','title','description','location','terms','claim_deadline') or (p_action not in('edit','reopen') and k not in('reason','title')) or (p_action not in('edit','duplicate') and k='title') or (p_action='reopen' and k not in('reason','claim_deadline')) then raise exception 'Unsupported lifecycle property' using errcode='22023';end if;if jsonb_typeof(p_payload->k) is distinct from 'string' and not(k='claim_deadline' and p_payload->k='null'::jsonb) then raise exception 'Lifecycle text and deadline must have the declared JSON types' using errcode='22023';end if;end loop;
 if length(reason)>1000 then raise exception 'Reason is too long' using errcode='22023';end if;
 payload=jsonb_build_object('job_id',p_job_id,'action',p_action,'version',p_expected_version,'values',p_payload);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('job-request:'||auth.uid()::text||p_request_id::text,0));
 select * into prior from private.job_lifecycle_requests where actor_id=auth.uid() and request_id=p_request_id;
 if found then if prior.payload<>payload then raise exception 'Lifecycle idempotency conflict' using errcode='22023';end if;return prior.result;end if;
 select * into j from public.jobs where id=p_job_id for update;
 if j.id is null then raise exception 'Job not found' using errcode='22023';end if;
 if j.lifecycle_version<>p_expected_version then raise exception 'Job changed; refresh before saving' using errcode='40001';end if;
 if p_action='duplicate' then
  if not exists(select 1 from public.job_sessions where job_id=j.id) or exists(select 1 from public.job_sessions where job_id=j.id and starts_at<=clock_timestamp()) then raise exception 'Copy past course content through course planning before creating a new offer' using errcode='22023';end if;
  if not private.has_permission('courses.manage') or (exists(select 1 from private.job_commission_offers where job_id=j.id) and not private.has_permission('finance.gross.read')) then raise exception 'Course and applicable pricing permission required' using errcode='42501';end if;
  if length(trim(coalesce(p_payload->>'title',j.title))) not between 1 and 200 then raise exception 'Invalid duplicate title' using errcode='22023';end if;
  run=private.duplicate_course_run(j.course_run_id);
  insert into public.jobs(course_run_id,title,description,customer_name,delivery_type,location,time_zone,status,amount,currency,rate_unit,total_amount,terms,requires_contract,created_by)
   values(run,trim(coalesce(p_payload->>'title',j.title)),j.description,j.customer_name,j.delivery_type,j.location,j.time_zone,'draft',j.amount,j.currency,j.rate_unit,j.total_amount,j.terms,j.requires_contract,auth.uid()) returning id into result;
  insert into public.job_sessions(job_id,course_session_id,starts_at,ends_at) select result,c.id,s.starts_at,s.ends_at from public.job_sessions s join public.course_sessions c on c.course_run_id=run and c.starts_at=s.starts_at and c.ends_at=s.ends_at where s.job_id=j.id;
  insert into public.job_requirements(job_id,topic_id) select result,topic_id from public.job_requirements where job_id=j.id;
  insert into private.job_commission_offers(job_id,organisation_id,gross_amount,gross_total_amount,platform_percent,platform_total_amount,lecturer_net_amount,lecturer_net_total_amount,currency)
   select result,organisation_id,gross_amount,gross_total_amount,platform_percent,platform_total_amount,lecturer_net_amount,lecturer_net_total_amount,currency from private.job_commission_offers where job_id=j.id;
 else
  if exists(select 1 from public.job_claims where job_id=j.id and status='confirmed') then raise exception 'Cancel confirmed work explicitly before changing availability' using errcode='22023';end if;
  if p_action='reopen' then
   if not exists(select 1 from public.job_claims where job_id=j.id and status='cancelled') or length(reason)<5 then raise exception 'Reopening requires cancelled history and a reason' using errcode='22023';end if;
   if j.status='published' then raise exception 'Job is already published' using errcode='22023';end if;
  elsif p_action in('edit','draft','published') and exists(select 1 from public.job_claims where job_id=j.id) then raise exception 'Accepted history is frozen; use audited reopening or a new copy' using errcode='22023';end if;
  deadline=case when p_payload?'claim_deadline' then nullif(p_payload->>'claim_deadline','')::timestamptz else j.claim_deadline end;
  if deadline is not null and (not isfinite(deadline) or deadline>(select min(starts_at) from public.job_sessions where job_id=j.id)) then raise exception 'Deadline must precede the first future session' using errcode='22023';end if;
  if p_action in('reopen','published') and (not exists(select 1 from public.job_sessions where job_id=j.id) or exists(select 1 from public.job_sessions where job_id=j.id and starts_at<=clock_timestamp()) or deadline<=clock_timestamp()) then raise exception 'Future sessions and an open deadline are required' using errcode='22023';end if;
  if p_action='edit' then
   if (p_payload?'title' and length(trim(coalesce(p_payload->>'title',''))) not between 1 and 200) or (p_payload?'description' and length(coalesce(p_payload->>'description',''))>12000) or (p_payload?'location' and length(coalesce(p_payload->>'location',''))>500) or (p_payload?'terms' and length(coalesce(p_payload->>'terms','')) not between 1 and 12000) then raise exception 'Invalid offer text' using errcode='22023';end if;
   deadline=case when p_payload?'claim_deadline' then nullif(p_payload->>'claim_deadline','')::timestamptz else j.claim_deadline end;
   if deadline is not null and (not isfinite(deadline) or deadline<=clock_timestamp() or deadline>(select min(starts_at) from public.job_sessions where job_id=j.id)) then raise exception 'Deadline must precede the first future session' using errcode='22023';end if;
   update public.jobs set title=case when p_payload?'title' then trim(p_payload->>'title') else j.title end,description=coalesce(p_payload->>'description',j.description),location=coalesce(p_payload->>'location',j.location),terms=coalesce(p_payload->>'terms',j.terms),claim_deadline=deadline where id=j.id;
  else update public.jobs set status=case when p_action='reopen' then 'published' else p_action end,claim_deadline=deadline where id=j.id;end if;
  result=j.id;
 end if;
 insert into public.audit_events(actor_id,action,resource_id,details) values(auth.uid(),'job.lifecycle.'||p_action,result,jsonb_build_object('source_job_id',j.id,'reason',reason,'prior_version',j.lifecycle_version));
 if p_action='reopen' then insert into public.notifications(user_id,kind,resource_id) select distinct lecturer_id,'job_reopened',j.id from public.job_claims where job_id=j.id and status='cancelled' on conflict do nothing;end if;
 insert into private.job_lifecycle_requests(actor_id,request_id,payload,result) values(auth.uid(),p_request_id,payload,result);return result;
end;$$;
create function public.manage_job_offer(p_job_id uuid,p_action text,p_expected_version int,p_request_id uuid,p_payload jsonb default '{}'::jsonb) returns uuid language sql security invoker set search_path='' as $$select private.manage_job_offer(p_job_id,p_action,p_expected_version,p_request_id,p_payload);$$;

-- Existing clients retain safe status changes for never-accepted offers. They
-- cannot silently publish cancelled history through the old two-argument API.
create or replace function private.set_job_status(p_job_id uuid,p_status text) returns void language plpgsql security definer set search_path='' as $$
declare j public.jobs;
begin
 if not private.has_permission('jobs.manage') then raise exception 'jobs.manage and MFA required' using errcode='42501';end if;
 if p_status is null or p_status not in('draft','published','archived') then raise exception 'Invalid status transition' using errcode='22023';end if;
 select * into j from public.jobs where id=p_job_id for update;
 if j.id is null or exists(select 1 from public.job_claims where job_id=j.id) then raise exception 'Accepted history is frozen; use audited reopening' using errcode='22023';end if;
 if p_status='published' and (not exists(select 1 from public.job_sessions where job_id=j.id) or exists(select 1 from public.job_sessions where job_id=j.id and starts_at<=clock_timestamp()) or j.claim_deadline<=clock_timestamp()) then raise exception 'Future sessions and an open deadline required' using errcode='22023';end if;
 update public.jobs set status=p_status where id=j.id;
 insert into public.audit_events(actor_id,action,resource_id) values(auth.uid(),'job.status.'||p_status,j.id);
end;$$;

revoke execute on function private.job_lifecycle(uuid),public.job_lifecycle(uuid),private.cancel_job_assignment(uuid,text,uuid),public.cancel_job_assignment(uuid,text,uuid),private.manage_job_offer(uuid,text,int,uuid,jsonb),public.manage_job_offer(uuid,text,int,uuid,jsonb) from public,anon;
grant execute on function private.job_lifecycle(uuid),public.job_lifecycle(uuid),private.cancel_job_assignment(uuid,text,uuid),public.cancel_job_assignment(uuid,text,uuid),private.manage_job_offer(uuid,text,int,uuid,jsonb),public.manage_job_offer(uuid,text,int,uuid,jsonb) to authenticated;

commit;
