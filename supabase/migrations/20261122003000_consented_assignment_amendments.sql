-- Formal changes extend confirmed work through explicit immutable amendments.
-- Originals, executed contracts, historical invoices and gross ledgers remain
-- intact. Every exposed wrapper delegates through current actor/MFA checks;
-- private ledgers have RLS and no browser table grants.
begin;
create table private.assignment_change_requests (
 id uuid primary key default gen_random_uuid(),claim_id uuid not null references public.job_claims(id),
 requester_id uuid not null references public.profiles(id),lecturer_id uuid not null references public.profiles(id),
 reason text not null check(length(trim(reason)) between 5 and 2000),
 status text not null default 'draft' check(status in('draft','submitted','awaiting_response','accepted','rejected','withdrawn','applied')),
 version integer not null default 1 check(version>0),original jsonb not null,proposed jsonb not null,source_hash text not null,
 manager_approved_by uuid references public.profiles(id),manager_approved_at timestamptz,
 lecturer_approved_at timestamptz,created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),applied_at timestamptz
);
create index assignment_changes_claim on private.assignment_change_requests(claim_id,created_at desc,id);
create table private.assignment_change_events (
 id uuid primary key default gen_random_uuid(),change_id uuid not null references private.assignment_change_requests(id),
 actor_id uuid not null references public.profiles(id),action text not null,note text not null default '',
 previous_version integer not null,snapshot jsonb,created_at timestamptz not null default clock_timestamp()
);
create index assignment_change_events_parent on private.assignment_change_events(change_id,created_at,id);
create table private.assignment_amendments (
 id uuid primary key default gen_random_uuid(),claim_id uuid not null references public.job_claims(id),change_id uuid not null unique references private.assignment_change_requests(id),
 version integer not null,original jsonb not null,accepted jsonb not null,
 manager_id uuid not null references public.profiles(id),lecturer_id uuid not null references public.profiles(id),
 created_at timestamptz not null default clock_timestamp(),unique(claim_id,version),check(manager_id<>lecturer_id)
);
-- Record a release driven by a consented replacement schedule. Finance can
-- now distinguish archival history from a cancellation or partial release.
create table private.assignment_session_supersessions (
 session_id uuid primary key references public.assignment_sessions(id),
 amendment_id uuid not null references private.assignment_amendments(id)
);
alter table private.assignment_session_supersessions enable row level security;
revoke all on private.assignment_session_supersessions from public,anon,authenticated,service_role;

create table private.assignment_change_operations (
 actor_id uuid not null references public.profiles(id),request_id uuid not null,payload jsonb not null,result uuid not null,
 primary key(actor_id,request_id)
);
do $$declare t text;begin foreach t in array array['assignment_change_requests','assignment_change_events','assignment_amendments','assignment_change_operations'] loop
 execute format('alter table private.%I enable row level security',t);execute format('revoke all on private.%I from public,anon,authenticated',t);
end loop;end;$$;
-- Submitted evidence is append-only through product APIs; isolated fixtures use their separate trusted cleanup boundary.
create function private.immutable_assignment_amendment() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Accepted amendment evidence is immutable' using errcode='55000';end;$$;
create trigger immutable_assignment_amendment before update or delete on private.assignment_amendments for each row execute function private.immutable_assignment_amendment();
create trigger immutable_assignment_change_events before update or delete on private.assignment_change_events for each row execute function private.immutable_assignment_amendment();
create trigger immutable_assignment_change_operations before update or delete on private.assignment_change_operations for each row execute function private.immutable_assignment_amendment();
create trigger immutable_assignment_session_supersession
 before update or delete on private.assignment_session_supersessions
 for each row execute function private.immutable_assignment_amendment();


-- Scope every request to its actual lecturer or current management capability, including fresh account status.
-- Finance and future invoice creation read the latest consented amendment; the original accepted claim is never rewritten.
create function private.effective_assignment(p_claim uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce((select a.accepted from private.assignment_amendments a where a.claim_id=c.id order by a.version desc limit 1),jsonb_build_object(
  'amount',c.amount,'total_amount',c.total_amount,'currency',c.currency,'rate_unit',c.rate_unit,'terms',c.terms)) from public.job_claims c where c.id=p_claim;
$$;
-- Bind an independently installed readiness configuration without assuming that
-- another feature migration has already been installed on this branch.
-- Resolve only the installed private readiness relation; capture its version and meeting override for stale-source detection.
create function private.assignment_change_readiness(p_run uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;settings_table regclass:=to_regclass('private.course_readiness_settings');
begin
 if p_run is null or settings_table is null then return null;end if;
 execute format('select jsonb_build_object(''version'',version,''meeting_url'',meeting_url) from %s where course_run_id=$1',settings_table) into result using p_run;
 return coalesce(result,jsonb_build_object('version',0,'meeting_url',''));
end;$$;
-- Capture operational and accepted commercial source values, including exact allocation evidence, before any draft can change work.
create function private.assignment_change_source(p_claim uuid) returns jsonb language sql stable security definer set search_path='' set timezone='UTC' as $$
 select jsonb_build_object('claim_id',c.id,'job_id',j.id,'course_run_id',j.course_run_id,'lecturer_id',c.lecturer_id,
 'title',j.title,'time_zone',j.time_zone,'delivery_type',j.delivery_type,'location',j.location,'scope',j.description,
 'amount',(private.effective_assignment(c.id)->>'amount')::numeric,'total_amount',(private.effective_assignment(c.id)->>'total_amount')::numeric,
 'currency',c.currency,'rate_unit',private.effective_assignment(c.id)->>'rate_unit','terms',private.effective_assignment(c.id)->>'terms',
 'cancel',false,'job_version',j.lifecycle_version,'claim_status',c.status,'readiness',private.assignment_change_readiness(j.course_run_id),
 'amendment_version',coalesce((select max(version) from private.assignment_amendments a where a.claim_id=c.id),0),
 'sessions',coalesce((select jsonb_agg(jsonb_build_object('starts_at',s.starts_at,'ends_at',s.ends_at) order by s.starts_at,s.id) from public.assignment_sessions s where s.claim_id=c.id and s.released_at is null),'[]'::jsonb),
 'session_evidence',coalesce((select jsonb_agg(to_jsonb(s) order by s.starts_at,s.id) from public.assignment_sessions s where s.claim_id=c.id and s.released_at is null),'[]'::jsonb),
 'offer_sessions',coalesce((select jsonb_agg(to_jsonb(s) order by s.starts_at,s.id) from public.job_sessions s where s.job_id=j.id),'[]'::jsonb))
 from public.job_claims c join public.jobs j on j.id=c.job_id where c.id=p_claim;
$$;
-- Allow only supported proposed fields, canonical instants and exact positive currency amounts; reject unknown or invalid requests.
create function private.assignment_change_normalize(p_original jsonb,p_values jsonb) returns jsonb language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare item jsonb; result jsonb; sessions jsonb:='[]'::jsonb; starts timestamptz; ends timestamptz; amount numeric; total numeric;
begin
 if p_values is null or jsonb_typeof(p_values)<>'object' or exists(select 1 from jsonb_object_keys(p_values) key where key not in('sessions','location','scope','amount','total_amount','rate_unit','terms','cancel')) then raise exception 'Unsupported change property' using errcode='22023';end if;
 result=(p_original-'session_evidence'-'offer_sessions'-'job_version'-'claim_status'-'amendment_version'-'readiness')||p_values;
 if jsonb_typeof(result->'sessions')<>'array' or jsonb_array_length(result->'sessions') not between 1 and 60
 or jsonb_typeof(result->'location')<>'string' or length(result->>'location')>500
 or jsonb_typeof(result->'scope')<>'string' or length(result->>'scope')>12000
 or jsonb_typeof(result->'terms')<>'string' or length(trim(result->>'terms')) not between 1 and 8000
 or jsonb_typeof(result->'cancel')<>'boolean' then raise exception 'Invalid assignment change' using errcode='22023';end if;
 if result->>'delivery_type'='online' and result->>'location' is distinct from p_original->>'location'
 and ((result->>'location')!~'^https://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{1,5})?([/?#][^[:space:]<>"\\]*)?$'
 or not coalesce(substring(result->>'location' from '^https://[^/:?#]+:([0-9]{1,5})(?:[/?#]|$)')::integer between 1 and 65535,true)) then raise exception 'A changed online meeting requires a valid HTTPS URL' using errcode='22023';end if;
 for item in select value from jsonb_array_elements(result->'sessions') loop
  if jsonb_typeof(item)<>'object' or (select count(*) from jsonb_object_keys(item))<>2 or exists(select 1 from jsonb_object_keys(item) key where key not in('starts_at','ends_at'))
  or coalesce(item->>'starts_at','')!~'(Z|[+-][0-9]{2}:[0-9]{2})$' or coalesce(item->>'ends_at','')!~'(Z|[+-][0-9]{2}:[0-9]{2})$' then raise exception 'Explicit session instants required' using errcode='22023';end if;
  starts=(item->>'starts_at')::timestamptz;ends=(item->>'ends_at')::timestamptz;
  if starts is null or ends is null or not isfinite(starts) or not isfinite(ends) or starts<=clock_timestamp() or ends<=starts
  or exists(select 1 from jsonb_array_elements(sessions) s where tstzrange((s->>'starts_at')::timestamptz,(s->>'ends_at')::timestamptz,'[)')&&tstzrange(starts,ends,'[)')) then raise exception 'Future finite non-overlapping sessions required' using errcode='22023';end if;
  sessions=sessions||jsonb_build_array(jsonb_build_object('starts_at',starts,'ends_at',ends));
 end loop;
 select jsonb_agg(s order by (s->>'starts_at')::timestamptz) into sessions from jsonb_array_elements(sessions) s;
 amount=(result->>'amount')::numeric;total=(result->>'total_amount')::numeric;
 if amount is null or total is null or amount not between 0.01 and 9999999999.99 or total not between 0.01 and 9999999999.99
 or amount<>round(amount,2) or total<>round(total,2) or coalesce(result->>'rate_unit','') not in('per_hour','per_day','per_teaching_unit','fixed_total')
 or (result->>'rate_unit'='fixed_total' and amount<>total) then raise exception 'Exact positive original-currency compensation required' using errcode='22023';end if;
 return result||jsonb_build_object('sessions',sessions,'amount',amount,'total_amount',total);
end;$$;
-- Separate protected compensation decisions from schedule/location/scope amendments without relying on browser flags.
create function private.assignment_change_price_changed(p_original jsonb,p_proposed jsonb) returns boolean language sql immutable set search_path='' as $$
 select (p_original->'amount',p_original->'total_amount',p_original->'rate_unit') is distinct from (p_proposed->'amount',p_proposed->'total_amount',p_proposed->'rate_unit');
$$;

-- Bind retries to the same actor, exact request UUID, original version and payload; changed input cannot replay an earlier action.
create function private.assignment_change_retry(p_request uuid,p_payload jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare prior private.assignment_change_operations;
begin
 if p_request is null then raise exception 'Request ID required' using errcode='22023';end if;
 select * into prior from private.assignment_change_operations where actor_id=auth.uid() and request_id=p_request;
 if not found then return null;end if;if prior.payload is distinct from p_payload then raise exception 'Change request retry conflict' using errcode='22023';end if;return prior.result;
end;$$;


alter table public.invoice_items add column amendment_id uuid references private.assignment_amendments(id);
-- An issued invoice item permanently identifies the amendment that supplied its amount; later edits cannot retarget it.
create function private.immutable_invoice_amendment() returns trigger language plpgsql set search_path='' as $$
begin if new.amendment_id is distinct from old.amendment_id then raise exception 'Invoice amendment reference is immutable' using errcode='23514';end if;return new;end;$$;
create trigger invoice_amendment_immutable before update on public.invoice_items for each row execute function private.immutable_invoice_amendment();

alter table private.assignment_change_requests add column requested_by_customer boolean not null default false;
create table private.assignment_financial_amendments (
 amendment_id uuid primary key references private.assignment_amendments(id),
 claim_id uuid not null references private.claim_revenue_ledger(claim_id),
 organisation_id uuid not null references public.organisations(id),
 currency text not null check(currency in('EUR','AUD')),
 gross_amount numeric(12,2) not null check(gross_amount>0),
 gross_total_amount numeric(12,2) not null check(gross_total_amount>0),
 lecturer_net_amount numeric(12,2) not null check(lecturer_net_amount>0),
 lecturer_net_total_amount numeric(12,2) not null check(lecturer_net_total_amount>0),
 platform_amount numeric(12,2) not null check(platform_amount>=0),
 platform_total_amount numeric(12,2) not null check(platform_total_amount>=0),
 platform_percent numeric(5,2) not null check(platform_percent between 0 and 100),
 created_at timestamptz not null default clock_timestamp(),
 check(gross_amount=lecturer_net_amount+platform_amount),
 check(gross_total_amount=lecturer_net_total_amount+platform_total_amount)
);
create index assignment_financial_claim on private.assignment_financial_amendments(claim_id,created_at desc,amendment_id);
alter table private.assignment_financial_amendments enable row level security;
revoke all on private.assignment_financial_amendments from public,anon,authenticated,service_role;
create trigger immutable_assignment_financial_amendment before update or delete on private.assignment_financial_amendments
 for each row execute function private.immutable_assignment_amendment();

-- Preserve the original staff boundary while a separate helper derives current
-- customer scope from trusted organisation membership and this exact assignment.
create function private.assignment_change_staff_access(p_claim uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.actor_active() and exists(select 1 from public.job_claims c where c.id=p_claim and
  (private.has_permission('jobs.manage') or(c.lecturer_id=auth.uid() and private.lecturer_actor())));
$$;
create function private.assignment_change_customer_access(p_claim uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.actor_active() and exists(select 1 from public.job_claims c join public.jobs j on j.id=c.job_id
  left join public.course_runs r on r.id=j.course_run_id left join private.claim_revenue_ledger l on l.claim_id=c.id
  where c.id=p_claim and private.client_has_organisation(coalesce(l.organisation_id,r.organisation_id)));
$$;
create or replace function private.assignment_change_access(p_claim uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.assignment_change_staff_access(p_claim) or private.assignment_change_customer_access(p_claim);
$$;
-- Existing membership edits use this exact per-client advisory boundary, not
-- the actor profile alone. Hold it before business locks, protect organisation
-- archival and recheck after either wait so revoked customers cannot mutate.
create function private.lock_assignment_change_customer(p_claim uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if not private.assignment_change_staff_access(p_claim)then
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('client-membership:'||auth.uid()::text,0));
  perform 1 from public.organisations o where o.id=(select coalesce(l.organisation_id,r.organisation_id)
   from public.job_claims c join public.jobs j on j.id=c.job_id left join public.course_runs r on r.id=j.course_run_id
   left join private.claim_revenue_ledger l on l.claim_id=c.id where c.id=p_claim)for share;
  if not private.assignment_change_customer_access(p_claim)then raise exception 'Current customer membership required'using errcode='42501';end if;
 end if;
end;$$;

-- Net-only finance access does not authorise changing a customer's captured
-- platform/net allocation. A current gross-finance decision is required.
create function private.assignment_change_money_authority(p_claim uuid) returns boolean language sql stable security definer set search_path='' as $$
 select case when exists(select 1 from private.claim_revenue_ledger where claim_id=p_claim)
  then private.has_permission('finance.gross.read') else private.has_permission('finance.manage') end;
$$;
-- Accounting is independently delivered and may be absent. Discover only its
-- exact private relation; no constant reference can break a formal-only install.
create function private.assignment_change_customer_invoiced(p_claim uuid) returns boolean language plpgsql stable security definer set search_path='' as $$
declare items regclass:=to_regclass('private.accounting_customer_items');result boolean:=false;
begin
 if items is not null then execute format('select exists(select 1 from %s where claim_id=$1)',items) into result using p_claim;end if;
 return result;
end;$$;

-- Only authorised gross-finance decisions evaluate the budget. A lecturer may
-- propose their own net without turning draft validation into a gross-price
-- binary-search oracle. Over-budget proposals can never be approved or applied.
create function private.validate_commissioned_amendment(p_claim uuid,p_original jsonb,p_proposed jsonb) returns void
language plpgsql stable security definer set search_path='' as $$
declare ledger private.claim_revenue_ledger;
begin
 select * into ledger from private.claim_revenue_ledger where claim_id=p_claim;
 if not found or not private.assignment_change_price_changed(p_original,p_proposed) then return;end if;
 if not private.has_permission('finance.gross.read') then raise exception 'Gross finance required for compensation approval' using errcode='42501';end if;
 if p_proposed->>'currency' is distinct from ledger.currency
 or p_proposed->>'rate_unit' is distinct from p_original->>'rate_unit'
 or(p_proposed->>'amount')::numeric>ledger.gross_amount
 or(p_proposed->>'total_amount')::numeric>ledger.gross_total_amount then
  raise exception 'Proposed net compensation exceeds the unchanged customer charge or changes its unit' using errcode='22023';end if;
end;$$;

-- Capture a balanced, immutable financial amendment only inside the same fully
-- consented apply transaction. The original accepted gross and revenue row stay
-- unchanged; percentage is the effective share of the captured total charge.
create function private.capture_assignment_financial_amendment() returns trigger language plpgsql security definer set search_path='' as $$
declare ledger private.claim_revenue_ledger;net numeric;total numeric;
begin
 select * into ledger from private.claim_revenue_ledger where claim_id=new.claim_id;
 if not found or not private.assignment_change_price_changed(new.original,new.accepted) then return new;end if;
 perform private.validate_commissioned_amendment(new.claim_id,new.original,new.accepted);
 net=(new.accepted->>'amount')::numeric;total=(new.accepted->>'total_amount')::numeric;
 insert into private.assignment_financial_amendments(amendment_id,claim_id,organisation_id,currency,gross_amount,gross_total_amount,
  lecturer_net_amount,lecturer_net_total_amount,platform_amount,platform_total_amount,platform_percent)
 values(new.id,new.claim_id,ledger.organisation_id,ledger.currency,ledger.gross_amount,ledger.gross_total_amount,
  net,total,ledger.gross_amount-net,ledger.gross_total_amount-total,round(100*(ledger.gross_total_amount-total)/ledger.gross_total_amount,2));
 return new;
end;$$;
create trigger capture_assignment_financial_amendment after insert on private.assignment_amendments
 for each row execute function private.capture_assignment_financial_amendment();

-- Customer snapshots use an explicit safe projection. New private snapshot
-- fields must not accidentally enter client JSON, logs, comparison or exports.
create function private.assignment_change_visible_snapshot(p_snapshot jsonb,p_customer boolean,p_price boolean) returns jsonb
language sql immutable set search_path='' as $$
 select case when p_customer then jsonb_build_object(
  'claim_id',p_snapshot->'claim_id','job_id',p_snapshot->'job_id','course_run_id',p_snapshot->'course_run_id',
  'lecturer_id',p_snapshot->'lecturer_id','title',p_snapshot->'title','time_zone',p_snapshot->'time_zone',
  'delivery_type',p_snapshot->'delivery_type','location',p_snapshot->'location','scope',p_snapshot->'scope',
  'sessions',p_snapshot->'sessions','cancel',p_snapshot->'cancel','amount',null,'total_amount',null,
  'currency',null,'rate_unit',null,'terms',null)
 else(p_snapshot-'session_evidence'-'offer_sessions')||case when p_price then '{}'::jsonb
  else jsonb_build_object('amount',null,'total_amount',null)end end;
$$;

-- Retain every existing scheduling/delivery guard and also refuse independent customer invoice history.
create or replace function private.assignment_change_validate(p_claim uuid,p_proposed jsonb) returns void language plpgsql security definer set search_path='' as $$
declare c public.job_claims;j public.jobs; starts timestamptz;ends timestamptz;submitted boolean;delivery_table regclass:=to_regclass('private.delivery_records');replacement_table regclass:=to_regclass('private.replacement_offers');
begin
 select * into c from public.job_claims where id=p_claim;select * into j from public.jobs where id=c.job_id;
 if c.id is null or c.status<>'confirmed' or j.capacity<>1 or (select count(*) from public.job_claims where job_id=j.id and status='confirmed')<>1
 or exists(select 1 from public.invoice_items where claim_id=c.id)
 or exists(select 1 from private.invoice_review_requests where claim_id=c.id)
 or exists(select 1 from public.assignment_sessions s where s.claim_id=c.id and s.released_at is not null
  and not exists(select 1 from private.assignment_session_supersessions x where x.session_id=s.id))
 or exists(select s.starts_at,s.ends_at from public.assignment_sessions s where s.claim_id=c.id and s.released_at is null
     except select s.starts_at,s.ends_at from public.job_sessions s where s.job_id=j.id)
 or exists(select s.starts_at,s.ends_at from public.job_sessions s where s.job_id=j.id
     except select s.starts_at,s.ends_at from public.assignment_sessions s where s.claim_id=c.id and s.released_at is null)
 or private.assignment_change_customer_invoiced(c.id) or not exists(select 1 from public.assignment_sessions where claim_id=c.id and released_at is null)
 or exists(select 1 from public.assignment_sessions where claim_id=c.id and released_at is null and starts_at<=clock_timestamp())
 or (j.course_run_id is not null and exists(select 1 from public.jobs where course_run_id=j.course_run_id and id<>j.id)) then raise exception 'Only unstarted, uninvoiced single-position assignments on a dedicated course run can be amended' using errcode='22023';end if;
 -- Other independently delivered modules may be integrated before or after this
 -- migration. Runtime guards use their actual tables without a reset/rewritten history.
 if delivery_table is not null then
  execute format('select exists(select 1 from %s d join public.assignment_sessions s on s.id=d.session_id where s.claim_id=$1 and d.latest_submission_id is not null)',delivery_table) into submitted using c.id;
  if submitted then raise exception 'Submitted delivery requires separate commercial review' using errcode='22023';end if;
 end if;
 if replacement_table is not null then
  execute format('select exists(select 1 from %s where original_claim_id=$1 and status=''open'')',replacement_table) into submitted using c.id;
  if submitted then raise exception 'Close the current replacement process first' using errcode='22023';end if;
 end if;
 if not private.lecturer_user(c.lecturer_id) then raise exception 'An active lecturer is required' using errcode='42501';end if;
 if (p_proposed->>'cancel')::boolean then return;end if;
 if (j.course_run_id is not null or exists(
     select 1 from public.job_sessions s where s.job_id=j.id and s.course_session_id is not null
    )) and p_proposed->'sessions' is distinct from private.assignment_change_source(c.id)->'sessions' then
  raise exception 'Linked course sessions retain their learning and attendance evidence' using errcode='22023';
 end if;

 select min((s->>'starts_at')::timestamptz),max((s->>'ends_at')::timestamptz) into starts,ends from jsonb_array_elements(p_proposed->'sessions') s;
 if exists(select 1 from public.job_requirements r where r.job_id=j.id and not exists(select 1 from public.lecturer_topics q where q.user_id=c.lecturer_id and q.topic_id=r.topic_id and q.verified and (q.valid_until is null or q.valid_until>=ends))) then raise exception 'Qualifications do not cover amended work' using errcode='22023';end if;
 if j.requires_contract and private.current_contract_for_interval(c.lecturer_id,starts,ends) is null then raise exception 'Agreement does not cover amended work' using errcode='22023';end if;
 if exists(select 1 from jsonb_array_elements(p_proposed->'sessions') s join public.assignment_sessions other on other.lecturer_id=c.lecturer_id and other.claim_id<>c.id and other.released_at is null and tstzrange(other.starts_at,other.ends_at,'[)')&&tstzrange((s->>'starts_at')::timestamptz,(s->>'ends_at')::timestamptz,'[)'))
 or exists(select 1 from jsonb_array_elements(p_proposed->'sessions') s join public.personal_events other on other.user_id=c.lecturer_id and tstzrange(other.starts_at,other.ends_at,'[)')&&tstzrange((s->>'starts_at')::timestamptz,(s->>'ends_at')::timestamptz,'[)'))
 or exists(select 1 from jsonb_array_elements(p_proposed->'sessions') s join public.lecturer_availability other on other.user_id=c.lecturer_id and other.kind='unavailable' and tstzrange(other.starts_at,other.ends_at,'[)')&&tstzrange((s->>'starts_at')::timestamptz,(s->>'ends_at')::timestamptz,'[)')) then raise exception 'Amended sessions conflict with current commitments' using errcode='23P01';end if;
end;$$;

-- Authorised clients see only their own requests and operational comparisons.
-- Lecturer/net-finance readers retain existing net access; management decisions
-- involving commissioned money additionally require current gross authority.
create or replace function private.assignment_change_projection(p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r private.assignment_change_requests;price boolean;customer boolean;money boolean;commissioned boolean;
begin
 select * into r from private.assignment_change_requests where id=p_id;
 if not found or not private.assignment_change_access(r.claim_id) then raise exception 'Change request access denied' using errcode='42501';end if;
 customer=not private.assignment_change_staff_access(r.claim_id);
 if customer and r.requester_id<>auth.uid() then raise exception 'Own customer request required' using errcode='42501';end if;
 price=not customer and(r.lecturer_id=auth.uid() or private.has_permission('finance.manage'));
 commissioned=exists(select 1 from private.claim_revenue_ledger where claim_id=r.claim_id);
 money=private.assignment_change_price_changed(r.original,r.proposed);
 return jsonb_build_object('id',r.id,'claim_id',r.claim_id,'requester_id',r.requester_id,'lecturer_id',r.lecturer_id,
  'reason',r.reason,'status',r.status,'version',r.version,'customer_view',customer,'requested_by_customer',r.requested_by_customer,'commissioned',commissioned,
  'original',private.assignment_change_visible_snapshot(r.original,customer,price),
  'proposed',private.assignment_change_visible_snapshot(r.proposed,customer,price),
  'can_price',not customer and(r.lecturer_id=auth.uid() or private.assignment_change_money_authority(r.claim_id)),
  'can_edit',r.status='draft'and r.requester_id=auth.uid(),'can_submit',r.status='draft'and r.requester_id=auth.uid(),
  'can_respond',not customer and r.status in('submitted','awaiting_response')and
   (auth.uid()=r.lecturer_id or(private.has_permission('jobs.manage')and(not money or private.assignment_change_money_authority(r.claim_id)))),
  'can_apply',not customer and r.status='accepted'and private.has_permission('jobs.manage')and(not money or private.assignment_change_money_authority(r.claim_id)),
  'can_withdraw',r.status in('draft','submitted','awaiting_response','accepted')and r.requester_id=auth.uid(),
  'manager_approved',r.manager_approved_at is not null,'lecturer_approved',r.lecturer_approved_at is not null,
  'created_at',r.created_at,'updated_at',r.updated_at,'applied_at',r.applied_at,
  'events',coalesce((select jsonb_agg(jsonb_build_object('action',e.action,'actor_name',p.display_name,
   'note',case when not customer or e.actor_id=auth.uid()then e.note else ''end,'created_at',e.created_at)order by e.created_at,e.id)
   from private.assignment_change_events e join public.profiles p on p.id=e.actor_id where e.change_id=r.id),'[]'::jsonb));
end;$$;
create or replace function private.assignment_changes(p_id uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.actor_active() then raise exception 'Active login required' using errcode='42501';end if;
 if p_id is not null then return jsonb_build_array(private.assignment_change_projection(p_id));end if;
 return coalesce((select jsonb_agg(private.assignment_change_projection(r.id)order by r.created_at desc,r.id)
  from(select * from private.assignment_change_requests where private.assignment_change_access(claim_id)
   and(private.assignment_change_staff_access(claim_id)or requester_id=auth.uid())order by created_at desc,id limit 250)r),'[]'::jsonb);
end;$$;

-- Discovery returns safe client operational choices without exposing protected commercial terms.
create or replace function private.changeable_assignments() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not private.actor_active() then raise exception 'Active login required' using errcode='42501';end if;
 select coalesce(jsonb_agg(jsonb_build_object('claim_id',c.id,'title',j.title,'lecturer_name',p.display_name,'time_zone',j.time_zone,
 'can_price',private.assignment_change_staff_access(c.id)and(c.lecturer_id=auth.uid()or private.assignment_change_money_authority(c.id)),'customer_view',not private.assignment_change_staff_access(c.id),'commissioned',exists(select 1 from private.claim_revenue_ledger where claim_id=c.id),
 'current',private.assignment_change_visible_snapshot(private.assignment_change_source(c.id),not private.assignment_change_staff_access(c.id),c.lecturer_id=auth.uid()or private.has_permission('finance.manage'))) order by c.created_at desc,c.id),'[]'::jsonb) into result
 from (select c.* from public.job_claims c join public.jobs j on j.id=c.job_id where c.status='confirmed' and private.assignment_change_access(c.id)
 and j.capacity=1 and not exists(select 1 from public.invoice_items where claim_id=c.id)and not private.assignment_change_customer_invoiced(c.id)
 and exists(select 1 from public.assignment_sessions where claim_id=c.id and released_at is null)
 and not exists(select 1 from public.assignment_sessions where claim_id=c.id and released_at is null and starts_at<=now())
 and not exists(select 1 from public.jobs other where other.course_run_id=j.course_run_id and other.id<>j.id)
 order by c.created_at desc,c.id limit 250)c join public.jobs j on j.id=c.job_id join public.profiles p on p.id=c.lecturer_id;
 return result;
end;$$;

-- Persist only client-safe fields or authorised own/net proposals; current profile locking also guards old receipts.
create or replace function private.save_assignment_change(p_id uuid,p_claim_id uuid,p_payload jsonb,p_expected_version integer,p_request_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare r private.assignment_change_requests;source jsonb;proposal jsonb;payload jsonb;result uuid;v_reason text;customer boolean;
begin
 perform 1 from public.profiles where id=auth.uid()and active for share;
 if not found then raise exception 'Active account required' using errcode='42501';end if;
 if not private.assignment_change_access(p_claim_id) then raise exception 'Assignment access denied' using errcode='42501';end if;
 perform private.lock_assignment_change_customer(p_claim_id);
 customer=not private.assignment_change_staff_access(p_claim_id);
 if customer and exists(select 1 from jsonb_object_keys(p_payload->'changes')k where k not in('sessions','location','scope'))then raise exception 'Customers may propose only schedule, location and scope'using errcode='42501';end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or (select count(*) from jsonb_object_keys(p_payload))<>2 or not(p_payload?'reason' and p_payload?'changes') then raise exception 'Reason and changes required' using errcode='22023';end if;
 v_reason=trim(p_payload->>'reason');if v_reason is null or length(v_reason) not between 5 and 2000 then raise exception 'Change reason required' using errcode='22023';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('assignment-change-request:'||auth.uid()::text||p_request_id::text,0));
 if not private.assignment_change_access(p_claim_id)then raise exception 'Assignment access denied'using errcode='42501';end if;
 payload=jsonb_build_object('action','save','id',p_id,'claim',p_claim_id,'values',p_payload,'version',p_expected_version);
 result=private.assignment_change_retry(p_request_id,payload);if result is not null then return result;end if;
 if(p_payload->'changes')?|array['amount','total_amount','rate_unit']and not exists(
  select 1 from public.job_claims c where c.id=p_claim_id and(c.lecturer_id=auth.uid()or private.assignment_change_money_authority(p_claim_id))) then raise exception 'Compensation fields require finance authority or own assignment ownership' using errcode='42501';end if;
 source=private.assignment_change_source(p_claim_id);proposal=private.assignment_change_normalize(source,p_payload->'changes');
 if (proposal->>'cancel')::boolean and proposal is distinct from private.assignment_change_normalize(source,jsonb_build_object('cancel',true)) then raise exception 'Cancellation must not silently alter compensation or scope; create a separate explicit settlement amendment' using errcode='22023';end if;
 if private.assignment_change_price_changed(source,proposal) and not((source->>'lecturer_id')::uuid=auth.uid()or private.assignment_change_money_authority(p_claim_id)) then raise exception 'Compensation access required' using errcode='42501';end if;
 if private.has_permission('finance.gross.read')then perform private.validate_commissioned_amendment(p_claim_id,source,proposal);end if;
 perform private.assignment_change_validate(p_claim_id,proposal);
 if p_id is null then
  if p_expected_version is distinct from 0 then raise exception 'New request version required' using errcode='40001';end if;
  insert into private.assignment_change_requests(claim_id,requester_id,lecturer_id,reason,original,proposed,source_hash,requested_by_customer)values(p_claim_id,auth.uid(),(source->>'lecturer_id')::uuid,v_reason,source,proposal,md5(source::text),customer) returning * into r;
 else
  select * into r from private.assignment_change_requests where id=p_id for update;
  if not found or r.claim_id<>p_claim_id or r.requester_id<>auth.uid() then raise exception 'Own request required' using errcode='42501';end if;
  if r.version is distinct from p_expected_version or r.status<>'draft' or r.source_hash<>md5(source::text) then raise exception 'Change request or source changed; reload' using errcode='40001';end if;
  update private.assignment_change_requests set reason=v_reason,proposed=proposal,version=version+1,updated_at=clock_timestamp() where id=r.id;
 end if;
 insert into private.assignment_change_events(change_id,actor_id,action,previous_version,snapshot) values(r.id,auth.uid(),'saved',coalesce(p_expected_version,0),jsonb_build_object('before',case when p_id is not null then to_jsonb(r) else null end,'reason',v_reason,'proposed',proposal));
 insert into private.assignment_change_operations values(auth.uid(),p_request_id,payload,r.id);return r.id;
end;$$;

-- Retain existing independent consent/apply workflow while gross-finance gates money decisions; clients cannot consent or apply.
create or replace function private.assignment_change_action(p_id uuid,p_action text,p_expected_version integer,p_note text,p_request_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare r private.assignment_change_requests;c public.job_claims;j public.jobs;source jsonb;payload jsonb;result uuid;proposal jsonb;item jsonb;amendment_id uuid;changed_schedule boolean;settings_table regclass:=to_regclass('private.course_readiness_settings');events_table regclass:=to_regclass('private.course_readiness_events');
begin
 select * into r from private.assignment_change_requests where id=p_id;
 if not found or not private.assignment_change_access(r.claim_id) then raise exception 'Change request access denied' using errcode='42501';end if;
 perform 1 from public.profiles where id in(auth.uid(),r.lecturer_id)order by id for share;
 perform private.lock_assignment_change_customer(r.claim_id);
 if not private.assignment_change_access(r.claim_id)or(not private.assignment_change_staff_access(r.claim_id)and r.requester_id<>auth.uid())then raise exception 'Change request access denied'using errcode='42501';end if;
 if p_action is null or p_action not in('submit','accept','reject','withdraw','apply') or p_note is null or length(p_note)>2000 then raise exception 'Invalid change action' using errcode='22023';end if;
 -- Even matching apply receipts retain current privileged authority; owning
 -- historical evidence is not a substitute for a current management session.
 if p_action='apply' and (not private.has_permission('jobs.manage') or (private.assignment_change_price_changed(r.original,r.proposed) and not private.assignment_change_money_authority(r.claim_id))) then raise exception 'Current management/finance authority required' using errcode='42501';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('assignment-change-request:'||auth.uid()::text||p_request_id::text,0));
 if not private.assignment_change_access(r.claim_id)then raise exception 'Change request access denied'using errcode='42501';end if;
 payload=jsonb_build_object('action',p_action,'id',p_id,'version',p_expected_version,'note',p_note);
 result=private.assignment_change_retry(p_request_id,payload);if result is not null then return result;end if;
 -- Every transition already holds profile/customer authority locks. Apply
 -- adds calendar/invoice ordering: lecturer, job/run/preparation, then request.
 -- Other transitions add only the business request row to those earlier locks.
 if p_action='apply' then
  if not private.has_permission('jobs.manage') then raise exception 'Management required' using errcode='42501';end if;
  perform 1 from public.profiles where id in(auth.uid(),r.lecturer_id) and active order by id for share;
  if not private.has_permission('jobs.manage') then raise exception 'Management authority changed' using errcode='42501';end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(r.lecturer_id::text,0));
  perform 1 from public.lecturer_topics where user_id=r.lecturer_id order by topic_id for share;
  select * into c from public.job_claims where id=r.claim_id;select * into j from public.jobs where id=c.job_id for update;
  perform 1 from public.course_runs where id=j.course_run_id for update;
  if j.course_run_id is not null then perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('course-readiness:'||j.course_run_id::text,0));end if;
 end if;
 select * into r from private.assignment_change_requests where id=p_id for update;
 if not private.assignment_change_access(r.claim_id)then raise exception 'Change request access denied'using errcode='42501';end if;
 if r.version is distinct from p_expected_version then raise exception 'Change request changed; reload' using errcode='40001';end if;
 if p_action='submit' then
  if r.requester_id<>auth.uid() or r.status<>'draft' then raise exception 'Own draft required' using errcode='42501';end if;
  if r.source_hash<>md5(private.assignment_change_source(r.claim_id)::text) then raise exception 'Original assignment changed; recreate request' using errcode='40001';end if;
  perform private.assignment_change_validate(r.claim_id,r.proposed);
  update private.assignment_change_requests set status='submitted' where id=r.id;
 elsif p_action in('accept','reject') then
  if r.status not in('submitted','awaiting_response') then raise exception 'Request is not awaiting a response' using errcode='40001';end if;
  if not(auth.uid()=r.lecturer_id and private.lecturer_actor() or private.has_permission('jobs.manage')) then raise exception 'Required responder only' using errcode='42501';end if;
  if auth.uid()<>r.lecturer_id and private.assignment_change_price_changed(r.original,r.proposed)
   and not private.assignment_change_money_authority(r.claim_id)then raise exception 'Current finance authority required for a money decision'using errcode='42501';end if;
  if p_action='reject' then
   if length(trim(p_note))<5 then raise exception 'Rejection reason required' using errcode='22023';end if;
   update private.assignment_change_requests set status='rejected' where id=r.id;
  else
   if r.source_hash<>md5(private.assignment_change_source(r.claim_id)::text) then raise exception 'Original assignment changed; recreate request' using errcode='40001';end if;
   if auth.uid()=r.lecturer_id then update private.assignment_change_requests set lecturer_approved_at=clock_timestamp() where id=r.id;
   else
    if private.assignment_change_price_changed(r.original,r.proposed)and not private.assignment_change_money_authority(r.claim_id)then raise exception 'Finance approval required'using errcode='42501';end if;
    perform private.validate_commissioned_amendment(r.claim_id,r.original,r.proposed);
    update private.assignment_change_requests set manager_approved_by=auth.uid(),manager_approved_at=clock_timestamp() where id=r.id;
   end if;
   update private.assignment_change_requests set status=case when manager_approved_at is not null and lecturer_approved_at is not null then 'accepted' else 'awaiting_response' end where id=r.id;
  end if;
 elsif p_action='withdraw' then
  if r.requester_id<>auth.uid() or r.status not in('draft','submitted','awaiting_response','accepted') or length(trim(p_note))<5 then raise exception 'Own active request and withdrawal reason required' using errcode='42501';end if;
  update private.assignment_change_requests set status='withdrawn' where id=r.id;
 else
  if r.status<>'accepted' or r.manager_approved_by is null or r.manager_approved_by=r.lecturer_id or r.lecturer_approved_at is null then raise exception 'Independent management and lecturer acceptance required' using errcode='42501';end if;
  source=private.assignment_change_source(r.claim_id);
  if r.source_hash<>md5(source::text) then raise exception 'Original assignment changed; recreate request' using errcode='40001';end if;
  proposal=private.assignment_change_normalize(r.original,r.proposed-'claim_id'-'job_id'-'course_run_id'-'lecturer_id'-'title'-'time_zone'-'delivery_type'-'currency');
  perform private.assignment_change_validate(r.claim_id,proposal);
  if private.assignment_change_price_changed(r.original,proposal)and not private.assignment_change_money_authority(r.claim_id) then raise exception 'Permitted finance amendment required' using errcode='42501';end if;
  perform private.validate_commissioned_amendment(r.claim_id,r.original,proposal);
  insert into private.assignment_amendments(claim_id,change_id,version,original,accepted,manager_id,lecturer_id)
   values(r.claim_id,r.id,(r.original->>'amendment_version')::integer+1,r.original,proposal,r.manager_approved_by,r.lecturer_id) returning id into amendment_id;
  if (proposal->>'cancel')::boolean then perform private.cancel_job_assignment(r.claim_id,r.reason,p_request_id);
  else
   changed_schedule=r.original->'sessions' is distinct from proposal->'sessions';
   if changed_schedule then
    -- Retain original allocations and record why their release does not
    -- require partial-delivery review. Linked courses retain their session IDs.
    insert into private.assignment_session_supersessions(session_id, amendment_id)
     select s.id,amendment_id from public.assignment_sessions s where s.claim_id=r.claim_id and s.released_at is null;
    update public.assignment_sessions set released_at=clock_timestamp() where claim_id=r.claim_id and released_at is null;
    delete from public.job_sessions where job_id=j.id;
    for item in select value from jsonb_array_elements(proposal->'sessions') loop
     insert into public.job_sessions(job_id,starts_at,ends_at) values(j.id,(item->>'starts_at')::timestamptz,(item->>'ends_at')::timestamptz);
     insert into public.assignment_sessions(claim_id,lecturer_id,starts_at,ends_at) values(c.id,c.lecturer_id,(item->>'starts_at')::timestamptz,(item->>'ends_at')::timestamptz);
    end loop;
   end if;
   if exists(select 1 from private.claim_revenue_ledger where claim_id=r.claim_id) then
    update public.jobs set location=proposal->>'location',description=proposal->>'scope',terms=proposal->>'terms',
     lifecycle_version=lifecycle_version+1,terms_version=terms_version+1 where id=j.id;
   else
    update public.jobs set location=proposal->>'location',description=proposal->>'scope',terms=proposal->>'terms',
     amount=(proposal->>'amount')::numeric,total_amount=(proposal->>'total_amount')::numeric,rate_unit=proposal->>'rate_unit',
     lifecycle_version=lifecycle_version+1,terms_version=terms_version+1 where id=j.id;
   end if;
   if j.course_run_id is not null then update public.course_runs set venue=proposal->>'location' where id=j.course_run_id;end if;
   if j.course_run_id is not null and j.delivery_type='online' and r.original->>'location' is distinct from proposal->>'location' and settings_table is not null and events_table is not null then
    execute format('insert into %s as settings(course_run_id,meeting_url,version) values($1,$2,1) on conflict(course_run_id) do update set meeting_url=excluded.meeting_url,version=settings.version+1,updated_at=clock_timestamp()',settings_table) using j.course_run_id,proposal->>'location';
    execute format('insert into %s(course_run_id,actor_id,action,details) values($1,$2,''assignment_amendment'',jsonb_build_object(''change_id'',$3))',events_table) using j.course_run_id,auth.uid(),r.id;
   end if;
  end if;
  update private.assignment_change_requests set status='applied',applied_at=clock_timestamp() where id=r.id;
 end if;
 update private.assignment_change_requests set version=version+1,updated_at=clock_timestamp() where id=r.id;
 insert into private.assignment_change_events(change_id,actor_id,action,note,previous_version) values(r.id,auth.uid(),p_action,p_note,r.version);
 insert into private.assignment_change_operations values(auth.uid(),p_request_id,payload,r.id);
 insert into public.audit_events(actor_id,action,resource_id) values(auth.uid(),'assignment.change.'||p_action,r.id);
 insert into public.notifications(user_id,kind,resource_id)
 select recipient,'assignment_change',r.id from (
  select r.lecturer_id recipient union select r.requester_id union select p.id from public.profiles p where p.active and exists(
   select 1 from public.user_roles ur join public.role_permissions rp on rp.role=ur.role where ur.user_id=p.id and rp.permission='jobs.manage')
 )people on conflict(user_id,kind,resource_id) do update set read_at=null,created_at=clock_timestamp();
 return r.id;
end;$$;

-- Preserve the exact installed report implementation and original public
-- predicate OID. Only this definer can invoke the captured predecessor.
do $$declare definition text;begin
 definition=pg_get_functiondef('private.commission_report(uuid)'::regprocedure);
 definition=replace(definition,'FUNCTION private.commission_report(','FUNCTION private.commission_report_before_financial_amendments(');
 execute definition;
end;$$;
revoke all on function private.commission_report_before_financial_amendments(uuid)from public,anon,authenticated,service_role;
create or replace function private.commission_report(p_organisation_id uuid default null)
returns table(job_id uuid,claim_id uuid,organisation_id uuid,organisation_name text,title text,status text,currency text,gross_amount numeric,gross_total_amount numeric,platform_percent numeric,platform_total_amount numeric,lecturer_net_amount numeric,lecturer_net_total_amount numeric,lecturer_id uuid,lecturer_name text,accepted_at timestamptz,pricing_model text,capacity integer)
language plpgsql stable security definer set search_path=''as $$
begin
 if not private.has_permission('finance.gross.read')then raise exception 'Gross finance permission required'using errcode='42501';end if;
 return query select b.job_id,b.claim_id,b.organisation_id,b.organisation_name,b.title,b.status,b.currency,
  b.gross_amount,b.gross_total_amount,coalesce(f.platform_percent,b.platform_percent),coalesce(f.platform_total_amount,b.platform_total_amount),
  coalesce(f.lecturer_net_amount,(effective.value->>'amount')::numeric,b.lecturer_net_amount),
  coalesce(f.lecturer_net_total_amount,(effective.value->>'total_amount')::numeric,b.lecturer_net_total_amount),
  b.lecturer_id,b.lecturer_name,b.accepted_at,b.pricing_model,b.capacity
 from private.commission_report_before_financial_amendments(p_organisation_id)b
 left join lateral(select a.*from private.assignment_financial_amendments a join private.assignment_amendments m on m.id=a.amendment_id
  where a.claim_id=b.claim_id order by m.version desc limit 1)f on true
 left join lateral(select private.effective_assignment(b.claim_id) value) effective on b.claim_id is not null;
end;$$;
revoke all on function private.assignment_change_staff_access(uuid),private.assignment_change_customer_access(uuid),
 private.lock_assignment_change_customer(uuid),
 private.assignment_change_money_authority(uuid),private.assignment_change_customer_invoiced(uuid),
 private.validate_commissioned_amendment(uuid,jsonb,jsonb),private.capture_assignment_financial_amendment(),
 private.assignment_change_visible_snapshot(jsonb,boolean,boolean)from public,anon,authenticated,service_role;


create function public.assignment_changes(p_id uuid default null) returns jsonb language sql stable security invoker set search_path='' as $$select private.assignment_changes(p_id);$$;
create function public.changeable_assignments() returns jsonb language sql stable security invoker set search_path='' as $$select private.changeable_assignments();$$;
create function public.save_assignment_change(p_id uuid,p_claim_id uuid,p_payload jsonb,p_expected_version integer,p_request_id uuid) returns uuid language sql security invoker set search_path='' as $$select private.save_assignment_change(p_id,p_claim_id,p_payload,p_expected_version,p_request_id);$$;
create function public.assignment_change_action(p_id uuid,p_action text,p_expected_version integer,p_note text,p_request_id uuid) returns uuid language sql security invoker set search_path='' as $$select private.assignment_change_action(p_id,p_action,p_expected_version,p_note,p_request_id);$$;

do $$declare fn record;begin
 for fn in select p.oid::regprocedure signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('private','public') and p.proname in('immutable_assignment_amendment','assignment_change_access','effective_assignment','assignment_change_readiness','assignment_change_source','assignment_change_normalize','assignment_change_price_changed','assignment_change_validate','assignment_change_projection','assignment_changes','changeable_assignments','assignment_change_retry','save_assignment_change','assignment_change_action','immutable_invoice_amendment') loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',fn.signature);
 if fn.proname in('assignment_changes','changeable_assignments','save_assignment_change','assignment_change_action') then execute format('grant execute on function %s to authenticated',fn.signature);end if;
 end loop;
end;$$;


-- Keep accepted-schedule archives out of current invoice calculations without
-- ignoring any other release, cancellation or inconsistent assignment block.
create function private.assignment_session_counts_for_invoice(p_session uuid)
returns boolean language sql stable security invoker set search_path='' as $$
 select not exists(select 1 from private.assignment_session_supersessions x where x.session_id=p_session);
$$;
revoke all on function private.assignment_session_counts_for_invoice(uuid)
 from public,anon,authenticated,service_role;

create or replace function private.finance_earnings_before_invoice_eligibility(p_all boolean default false)
returns table(claim_id uuid,job_id uuid,lecturer_id uuid,lecturer_name text,title text,customer_name text,starts_at timestamptz,ends_at timestamptz,amount numeric,rate_unit text,total_amount numeric,currency text,stage text,invoice_id uuid)
language plpgsql stable security definer set search_path='' as $$
begin
 if not private.actor_active() or (p_all and not private.has_permission('finance.manage'))
 or (not private.lecturer_actor() and not private.has_permission('finance.manage')) then raise exception 'Own earnings or finance management and MFA required' using errcode='42501';end if;
 return query select c.id,c.job_id,c.lecturer_id,p.display_name,j.title,j.customer_name,(select min(s.starts_at) from public.assignment_sessions s where s.claim_id=c.id and private.assignment_session_counts_for_invoice(s.id)),(select max(s.ends_at) from public.assignment_sessions s where s.claim_id=c.id and private.assignment_session_counts_for_invoice(s.id)),(effective.value->>'amount')::numeric,effective.value->>'rate_unit',(effective.value->>'total_amount')::numeric,c.currency,
 case when i.status='paid' then 'paid' when i.id is not null then 'invoiced' when (select max(s.ends_at) from public.assignment_sessions s where s.claim_id=c.id and private.assignment_session_counts_for_invoice(s.id))<=now() then 'completed' else 'expected' end,i.id
 from public.job_claims c cross join lateral(select private.effective_assignment(c.id) value) effective join public.profiles p on p.id=c.lecturer_id join public.jobs j on j.id=c.job_id left join public.invoice_items item on item.claim_id=c.id and item.active left join public.invoices i on i.id=item.invoice_id
 where c.status='confirmed' and (p_all or c.lecturer_id=auth.uid()) order by c.created_at desc,c.id;
end;$$;

create or replace function private.finance_earnings(p_all boolean default false)
returns table(
  claim_id uuid, job_id uuid, lecturer_id uuid, lecturer_name text,
  title text, customer_name text, starts_at timestamptz, ends_at timestamptz,
  amount numeric, rate_unit text, total_amount numeric, currency text,
  stage text, invoice_id uuid, invoice_eligible_at timestamptz,
  invoice_review_required boolean, invoice_review_reason text,
  invoice_review_status text, invoice_review_note text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.actor_active() or
     (coalesce(p_all, false) and not private.has_permission('finance.manage')) then
    raise exception 'Own earnings or finance management required' using errcode = '42501';
  end if;
  return query
  with earnings as (
    select base.*, claim.status claim_status,
      coalesce(session_data.session_count, 0) session_count,
      coalesce(session_data.has_released, false) has_released,
      session_data.last_end,
      coalesce(job_session_data.session_count, 0) job_session_count,
      review.status review_status, review.resolution_note review_note,
      claim.created_at
    from private.finance_earnings_before_invoice_eligibility(p_all) base
    join public.job_claims claim on claim.id = base.claim_id
    left join lateral (
      select count(*) session_count,
        coalesce(bool_or(s.released_at is not null), false) has_released,
        max(s.ends_at) last_end
      from public.assignment_sessions s where s.claim_id = claim.id and private.assignment_session_counts_for_invoice(s.id)
    ) session_data on true
    left join lateral (
      select count(*) session_count
      from public.job_sessions s where s.job_id = claim.job_id
    ) job_session_data on true
    left join lateral (
      select r.status, r.resolution_note
      from private.invoice_review_requests r
      where r.claim_id = claim.id and r.requested_by = claim.lecturer_id
      order by r.requested_at desc, r.id desc limit 1
    ) review on true
  ), rows as (
    select e.claim_id, e.job_id, e.lecturer_id, e.lecturer_name,
      e.title, e.customer_name, e.starts_at, e.ends_at,
      e.amount, e.rate_unit, e.total_amount, e.currency,
      case
        when e.stage in ('paid', 'invoiced') then e.stage
        when e.claim_status = 'cancelled' or e.session_count = 0 or
             e.session_count <> e.job_session_count or e.has_released then 'review'
        else e.stage
      end stage,
      e.invoice_id,
      case
        when e.claim_status = 'cancelled' or e.session_count = 0 or
             e.session_count <> e.job_session_count or e.has_released then null
        else e.last_end
      end invoice_eligible_at,
      (e.claim_status = 'cancelled' or e.session_count = 0 or
       e.session_count <> e.job_session_count or e.has_released) invoice_review_required,
      case
        when e.claim_status = 'cancelled' then 'cancelled'
        when e.session_count = 0 or e.session_count <> e.job_session_count then 'schedule_mismatch'
        when e.has_released then 'partial_delivery'
        else null
      end invoice_review_reason,
      e.review_status invoice_review_status,
      e.review_note invoice_review_note,
      e.created_at
    from earnings e
    union all
    select claim.id, claim.job_id, claim.lecturer_id, profile.display_name,
      job.title, job.customer_name,
      (select min(s.starts_at) from public.assignment_sessions s where s.claim_id = claim.id and private.assignment_session_counts_for_invoice(s.id)),
      (select max(s.ends_at) from public.assignment_sessions s where s.claim_id = claim.id and private.assignment_session_counts_for_invoice(s.id)),
      claim.amount, claim.rate_unit, claim.total_amount, claim.currency,
      'review', invoice.id,
      null::timestamptz, true, 'cancelled', review.status, review.resolution_note,
      claim.created_at
    from public.job_claims claim
    join public.jobs job on job.id = claim.job_id
    join public.profiles profile on profile.id = claim.lecturer_id
    left join public.invoice_items item on item.claim_id = claim.id and item.active
    left join public.invoices invoice on invoice.id = item.invoice_id
    left join lateral (
      select r.status, r.resolution_note
      from private.invoice_review_requests r
      where r.claim_id = claim.id and r.requested_by = claim.lecturer_id
      order by r.requested_at desc, r.id desc limit 1
    ) review on true
    where claim.status = 'cancelled' and
      (coalesce(p_all, false) or claim.lecturer_id = auth.uid())
  )
  select r.claim_id, r.job_id, r.lecturer_id, r.lecturer_name,
    r.title, r.customer_name, r.starts_at, r.ends_at,
    r.amount, r.rate_unit, r.total_amount, r.currency,
    r.stage, r.invoice_id, r.invoice_eligible_at, r.invoice_review_required,
    r.invoice_review_reason, r.invoice_review_status, r.invoice_review_note
  from rows r
  order by r.created_at desc, r.claim_id;
end;
$$;

create or replace function private.my_invoice_review_candidates()
returns table(
  claim_id uuid, job_id uuid, title text, claim_status text,
  reason text, review_status text, requested_at timestamptz,
  resolution_note text, scheduled_end timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.lecturer_actor() then
    raise exception 'Active lecturer required' using errcode = '42501';
  end if;
  return query
  select c.id, c.job_id, j.title, c.status,
    case
      when c.status = 'cancelled' then 'cancelled'
      when not exists (
        select 1 from public.assignment_sessions s where s.claim_id = c.id and private.assignment_session_counts_for_invoice(s.id)
      ) then 'schedule_mismatch'
      else 'partial_delivery'
    end,
    latest.status, latest.requested_at, latest.resolution_note,
    (select max(s.ends_at) from public.assignment_sessions s where s.claim_id = c.id and private.assignment_session_counts_for_invoice(s.id))
  from public.job_claims c
  join public.jobs j on j.id = c.job_id
  left join lateral (
    select r.status, r.requested_at, r.resolution_note
    from private.invoice_review_requests r
    where r.claim_id = c.id and r.requested_by = auth.uid()
    order by r.requested_at desc, r.id desc limit 1
  ) latest on true
  where c.lecturer_id = auth.uid() and c.status in ('confirmed', 'cancelled')
    and not exists (
      select 1 from public.invoice_items item
      where item.claim_id = c.id and item.active
    )
    and (
      c.status = 'cancelled' or
      exists (
        select 1 from public.assignment_sessions s
        where s.claim_id = c.id and private.assignment_session_counts_for_invoice(s.id) and s.released_at is not null
      ) or
      (select count(*) from public.assignment_sessions s where s.claim_id = c.id and private.assignment_session_counts_for_invoice(s.id)) <>
      (select count(*) from public.job_sessions s where s.job_id = c.job_id)
    )
  order by c.created_at desc, c.id;
end;
$$;

create or replace function private.request_invoice_review(p_claim_id uuid, p_request_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  claim_row public.job_claims%rowtype;
  existing_request private.invoice_review_requests%rowtype;
  reason_value text;
  result_id uuid;
begin
  if not private.lecturer_actor() then
    raise exception 'Active lecturer required' using errcode = '42501';
  end if;
  if p_claim_id is null or p_request_id is null then
    raise exception 'Invoice review request ID required' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('invoice:' || auth.uid()::text, 0)
  );
  select * into existing_request
  from private.invoice_review_requests
  where requested_by = auth.uid() and request_id = p_request_id;
  if found then
    if existing_request.claim_id <> p_claim_id then
      raise exception 'Invoice review idempotency conflict' using errcode = '22023';
    end if;
    return existing_request.id;
  end if;
  select * into claim_row
  from public.job_claims
  where id = p_claim_id and lecturer_id = auth.uid()
  for update;
  if not found then
    raise exception 'Own accepted claim required' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.invoice_items item
    where item.claim_id = p_claim_id and item.active
  ) then
    raise exception 'Use the existing invoice review workflow' using errcode = '22023';
  end if;
  if claim_row.status = 'cancelled' then
    reason_value := 'cancelled';
  elsif claim_row.status = 'confirmed' then
    if not exists (
      select 1 from public.assignment_sessions s where s.claim_id = p_claim_id and private.assignment_session_counts_for_invoice(s.id)
    ) or (select count(*) from public.assignment_sessions s where s.claim_id = p_claim_id and private.assignment_session_counts_for_invoice(s.id)) <>
       (select count(*) from public.job_sessions s where s.job_id = claim_row.job_id) then
      reason_value := 'schedule_mismatch';
    elsif exists (
      select 1 from public.assignment_sessions s
      where s.claim_id = p_claim_id and private.assignment_session_counts_for_invoice(s.id) and s.released_at is not null
    ) then
      reason_value := 'partial_delivery';
    else
      raise exception 'Invoice block does not require a cancellation/partial-delivery review' using errcode = '22023';
    end if;
  else
    raise exception 'Invoice review is unavailable for this claim' using errcode = '22023';
  end if;

  select id into result_id
  from private.invoice_review_requests
  where claim_id = p_claim_id and status = 'pending'
  for update;
  if found then return result_id; end if;
  insert into private.invoice_review_requests(
    claim_id, requested_by, request_id, reason
  ) values (p_claim_id, auth.uid(), p_request_id, reason_value)
  returning id into result_id;
  insert into public.audit_events(actor_id, action, resource_id, details)
  values (
    auth.uid(), 'invoice.review_requested', result_id,
    jsonb_build_object('claim_id', p_claim_id, 'job_id', claim_row.job_id, 'reason', reason_value)
  );
  return result_id;
end;
$$;

create or replace function private.submit_invoice_with_session_eligibility(
  p_number text, p_claim_ids uuid[], p_document_version_id uuid,
  p_issued_on date, p_due_on date default null,
  p_client_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized uuid[];
  effective_due date;
  prior_invoice public.invoices%rowtype;
  target_claim public.job_claims%rowtype;
  session_count bigint;
  job_session_count bigint;
  last_session_end timestamptz;
begin
  if not private.has_role(array['lecturer', 'senior_lecturer']) then
    raise exception 'Active lecturer required' using errcode = '42501';
  end if;
  effective_due := case
    when p_due_on is null and p_issued_on is not null then p_issued_on + 30
    else p_due_on
  end;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('invoice:' || auth.uid()::text, 0)
  );

  -- Preserve an already-confirmed retry even if claim scheduling metadata has
  -- changed since that exact invoice request committed.
  select * into prior_invoice
  from public.invoices
  where user_id = auth.uid() and client_id = p_client_id;
  if found then
    return private.submit_invoice_before_session_eligibility(
      p_number, p_claim_ids, p_document_version_id,
      p_issued_on, effective_due, p_client_id
    );
  end if;

  if p_claim_ids is not null then
    select array_agg(distinct selected.claim_id order by selected.claim_id)
    into normalized
    from unnest(p_claim_ids) as selected(claim_id);
    if normalized is not null and cardinality(normalized) = cardinality(p_claim_ids) then
      -- Validate ownership before returning any review/eligibility distinction.
      if exists (
        select 1 from unnest(normalized) as selected(claim_id)
        where not exists (
          select 1 from public.job_claims claim
          where claim.id = selected.claim_id and claim.lecturer_id = auth.uid()
        )
      ) then
        return private.submit_invoice_before_session_eligibility(
          p_number, p_claim_ids, p_document_version_id,
          p_issued_on, effective_due, p_client_id
        );
      end if;
      if exists (
        select 1 from public.job_claims claim
        where claim.id = any(normalized) and claim.status = 'cancelled'
      ) then
        raise exception 'invoice_review_required: cancelled assignment block' using errcode = '22023';
      end if;
      for target_claim in
        select claim.* from public.job_claims claim
        where claim.id = any(normalized) and claim.status = 'confirmed'
        order by claim.id for update
      loop
        select count(*), max(session.ends_at)
        into session_count, last_session_end
        from public.assignment_sessions session
        where session.claim_id = target_claim.id and private.assignment_session_counts_for_invoice(session.id);
        select count(*) into job_session_count
        from public.job_sessions session
        where session.job_id = target_claim.job_id;
        if session_count = 0 or session_count <> job_session_count or exists (
          select 1 from public.assignment_sessions session
          where session.claim_id = target_claim.id and private.assignment_session_counts_for_invoice(session.id) and session.released_at is not null
        ) then
          raise exception 'invoice_review_required: partial or inconsistent assignment block' using errcode = '22023';
        end if;
        if last_session_end > clock_timestamp() then
          raise exception 'invoice_not_ready: final scheduled session has not ended' using errcode = '22023';
        end if;
      end loop;
    end if;
  end if;

  return private.submit_invoice_before_session_eligibility(
    p_number, p_claim_ids, p_document_version_id,
    p_issued_on, effective_due, p_client_id
  );
end;
$$;

-- Patch only the existing owner-internal insert implementation. The current
-- public writer still takes the lecturer lock, then runs invoice eligibility,
-- retained retry checks and clean-file validation before it reaches this body.

create or replace function private.submit_invoice_before_session_eligibility(p_number text,p_claim_ids uuid[],p_document_version_id uuid,p_issued_on date,p_due_on date,p_client_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare previous public.invoices; version public.document_versions; document public.documents; normalized uuid[]; result uuid; currencies int; total numeric; original_currency text;
begin
 if not private.lecturer_actor() then raise exception 'Active lecturer required' using errcode='42501';end if;
 if p_client_id is null or p_number is null or length(trim(p_number)) not between 1 and 80 or cardinality(p_claim_ids) not between 1 and 50 or p_claim_ids is null or p_issued_on is null or p_due_on is null or p_due_on<p_issued_on then raise exception 'Invalid invoice metadata' using errcode='22023';end if;
 perform 1 from public.profiles where id=auth.uid() and active for share;
 if not found then raise exception 'Authentication required' using errcode='42501';end if;
 -- Serialize status validation and invoice-item insertion with cancellation.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text,0));
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('invoice:'||auth.uid()::text,0));
 select array_agg(distinct x order by x) into normalized from unnest(p_claim_ids) x;
 if cardinality(normalized)<>cardinality(p_claim_ids) or array_position(normalized,null) is not null then raise exception 'Unique claim IDs required' using errcode='22023';end if;
 select * into previous from public.invoices where user_id=auth.uid() and client_id=p_client_id;
 if found then
  if previous.number<>trim(p_number) or previous.document_version_id<>p_document_version_id or previous.issued_on<>p_issued_on or previous.due_on<>p_due_on or normalized is distinct from (select array_agg(claim_id order by claim_id) from public.invoice_items where invoice_id=previous.id) then raise exception 'Invoice idempotency conflict' using errcode='22023';end if;return previous.id;
 end if;
 if exists(select 1 from unnest(normalized) selected where not exists(select 1 from public.job_claims c where c.id=selected and c.lecturer_id=auth.uid() and c.status='confirmed')) then raise exception 'Only own accepted claims can be invoiced' using errcode='42501';end if;
 if exists(select 1 from public.invoice_items where claim_id=any(normalized) and active) then raise exception 'A claim already has an active invoice' using errcode='23505';end if;
 select count(distinct c.currency),sum((private.effective_assignment(c.id)->>'total_amount')::numeric),min(c.currency) into currencies,total,original_currency from public.job_claims c where c.id=any(normalized);
 if currencies<>1 or total<=0 then raise exception 'Invoice must use one original currency and positive accepted compensation' using errcode='22023';end if;
 select * into version from public.document_versions where id=p_document_version_id;
 select * into document from public.documents where id=version.document_id;
 if document.id is null or document.owner_id<>auth.uid() or document.deleted_at is not null or document.kind<>'invoice' or document.scope<>'personal' or version.status<>'clean' or version.mime_type<>'application/pdf' or version.sha256 is null then raise exception 'Own clean invoice PDF required' using errcode='42501';end if;
 insert into public.invoices(user_id,number,issued_on,due_on,currency,total_amount,document_version_id,client_id) values(auth.uid(),trim(p_number),p_issued_on,p_due_on,original_currency,total,p_document_version_id,p_client_id) returning id into result;
 insert into public.invoice_items(invoice_id,claim_id,amendment_id)
 select result,x,(select a.id from private.assignment_amendments a where a.claim_id=x order by a.version desc limit 1) from unnest(normalized) x;
 insert into public.audit_events(actor_id,action,resource_id,details) values(auth.uid(),'invoice.submitted',result,jsonb_build_object('currency',original_currency,'accepted_compensation',total));return result;
end;$$;

create or replace function private.claim_paid_amount(p_claim uuid) returns numeric language sql stable security definer set search_path='' as $$
 with invoices as(
  select i.id,i.total_amount,coalesce((select sum(p.amount) from public.payment_records p where p.invoice_id=i.id and p.voided_at is null),0) paid
  from public.invoice_items item join public.invoices i on i.id=item.invoice_id where item.claim_id=p_claim and item.active and i.status not in('cancelled','rejected')
 ), raw as(
  select invoice.id invoice_id,item.claim_id,invoice.paid,invoice.paid*coalesce((amendment.accepted->>'total_amount')::numeric,c.total_amount)/invoice.total_amount*100 cents
  from invoices invoice join public.invoice_items item on item.invoice_id=invoice.id and item.active join public.job_claims c on c.id=item.claim_id
  left join private.assignment_amendments amendment on amendment.id=item.amendment_id
 ), allocated as(
  select r.*,floor(cents) base_cents,row_number() over(partition by invoice_id order by cents-floor(cents) desc,claim_id) priority,
   round(paid*100)-sum(floor(cents)) over(partition by invoice_id) remaining from raw r
 )select coalesce(sum((base_cents+case when priority<=remaining then 1 else 0 end)/100) filter(where claim_id=p_claim),0) from allocated;
$$;

create or replace function private.finance_statement(p_from date,p_until date,p_all boolean default false) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare data jsonb;claims jsonb;totals jsonb;minutes jsonb;zone text;begins timestamptz;ends timestamptz;person text;
begin
 if not private.actor_active() or (p_all and not private.has_permission('finance.manage')) then raise exception 'Own statement or finance.manage and MFA required' using errcode='42501';end if;
 if p_all is null then raise exception 'Explicit statement scope required' using errcode='22023';end if;
 perform private.finance_period(p_from,p_until);
 select time_zone,display_name into zone,person from public.profiles where id=auth.uid();begins=p_from::timestamp at time zone zone;ends=p_until::timestamp at time zone zone;
 with entries as(
  select c.id claim_id,c.lecturer_id,p.display_name lecturer_name,j.title,j.customer_name,c.status,(effective.value->>'amount')::numeric amount,(effective.value->>'total_amount')::numeric total_amount,c.currency,effective.value->>'rate_unit' rate_unit,c.created_at accepted_at,
   sessions.starts_at,sessions.ends_at,
   case when c.status='cancelled' then 'cancelled' when sessions.ends_at<=now() then 'completed' else 'expected' end stage,
   bill.id invoice_id,bill.number invoice_number,bill.status invoice_status,bill.due_on,
   private.claim_paid_amount(c.id) paid_amount
  from public.job_claims c join public.jobs j on j.id=c.job_id join public.profiles p on p.id=c.lecturer_id
  cross join lateral(select private.effective_assignment(c.id) value) effective
  cross join lateral(select min(starts_at) starts_at,max(ends_at) ends_at from public.assignment_sessions s where s.claim_id=c.id and private.assignment_session_counts_for_invoice(s.id))sessions
  left join lateral(select i.* from public.invoice_items item join public.invoices i on i.id=item.invoice_id where item.claim_id=c.id and item.active and i.status not in('rejected','cancelled') order by i.created_at desc,i.id limit 1)bill on true
  where (p_all or c.lecturer_id=auth.uid()) and sessions.starts_at>=begins and sessions.starts_at<ends
  order by sessions.starts_at,c.id limit 1001
 )select coalesce(jsonb_agg(to_jsonb(e) order by e.starts_at,e.claim_id),'[]'::jsonb) into claims from entries e;
 if jsonb_array_length(claims)>1000 then raise exception 'Too many assignments; select a shorter statement period' using errcode='54000';end if;
 select coalesce(jsonb_agg(to_jsonb(t) order by t.currency),'[]'::jsonb) into totals from(
  select x->>'currency' currency,
   coalesce(sum((x->>'total_amount')::numeric) filter(where x->>'stage'='expected'),0) expected,
   coalesce(sum((x->>'total_amount')::numeric) filter(where x->>'stage'='completed'),0) completed,
   coalesce(sum((x->>'total_amount')::numeric) filter(where x->>'status'='confirmed' and x->>'invoice_id' is not null),0) invoiced,
   coalesce(sum((x->>'paid_amount')::numeric),0) paid
  from jsonb_array_elements(claims)x group by x->>'currency')t;
 select coalesce(jsonb_agg(to_jsonb(t) order by t.claim_id),'[]'::jsonb) into minutes from(
  select s.claim_id,sum(floor(extract(epoch from t.ends_at-t.starts_at)/60)::integer-t.break_minutes)::integer minutes
  from private.teaching_timesheets t join public.assignment_sessions s on s.id=t.session_id
  where t.state='approved' and (p_all or t.lecturer_id=auth.uid()) and exists(select 1 from jsonb_array_elements(claims)c where (c->>'claim_id')::uuid=s.claim_id)
  group by s.claim_id)t;
 data=jsonb_build_object('type','finance_statement','from',p_from,'until',p_until,'time_zone',zone,'scope',case when p_all then 'management' else 'own' end,
  'account_name',person,'period_basis','assignment_start','claims',claims,'totals',totals,'approved_minutes',minutes);
 return jsonb_build_object('data',data,'hash',encode(sha256(convert_to(data::text,'UTF8')),'hex'));
end;$$;

alter function private.notification_target(text,uuid) rename to notification_target_before_assignment_amendments;
revoke all on function private.notification_target_before_assignment_amendments(text,uuid)
 from public,anon,authenticated,service_role;
create function private.notification_target(p_kind text,p_resource uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare heading text;
begin
 if p_kind='assignment_change' then
  select r.original->>'title' into heading
  from private.assignment_change_requests r where r.id=p_resource and
   (private.assignment_change_staff_access(r.claim_id)
      or (r.requester_id=auth.uid() and private.assignment_change_customer_access(r.claim_id)));
  return jsonb_build_object('href',case when heading is not null then '/changes/'||p_resource end,'title',coalesce(heading,''));
 end if;
 return private.notification_target_before_assignment_amendments(p_kind,p_resource);
end;
$$;
revoke all on function private.notification_target(text,uuid) from public,anon,authenticated,service_role;
notify pgrst, 'reload schema';
commit;
