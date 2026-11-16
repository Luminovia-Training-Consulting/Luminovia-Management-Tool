-- Bind each replacement's consent to its own role-dependent net deal.
-- Existing accepted claims/revenue remain immutable; no operational policy is seeded.
BEGIN;

alter table private.job_substitutions add column pricing_context jsonb;
-- Old pending quotes lack a recipient-specific pricing snapshot. Retain their
-- history and require a new offer instead of silently changing their contract.
update private.job_substitutions set status='superseded',resolved_at=clock_timestamp() where status='pending';

-- This private snapshot includes the captured offer policy/ledger facts, never
-- exposed through the lecturer quote or a browser-supplied authority field.
create function private.substitution_pricing_context(p_claim uuid,p_target uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare c public.job_claims;o private.job_commission_offers;net numeric;net_total numeric;platform numeric;quote_version integer;
begin
 select * into c from public.job_claims where id=p_claim;
 if c.id is null then raise exception 'Assignment unavailable' using errcode='22023';end if;
 select * into o from private.job_commission_offers where job_id=c.job_id;
 net=c.amount;net_total=c.total_amount;quote_version=c.terms_version;
 if o.pricing_mode='role_split' then
  if o.policy_version is null then raise exception 'Compensation policy has not been configured' using errcode='22023';end if;
  net=private.role_net(o.gross_amount,p_target,c.job_id);net_total=private.role_net(o.gross_total_amount,p_target,c.job_id);
  quote_version=private.role_quote_version(c.terms_version,p_target);
  platform=case when exists(select 1 from public.user_roles where user_id=p_target and role='senior_lecturer') then 100-o.senior_percent else 100-o.regular_percent end;
 elsif o.job_id is not null then platform=o.platform_percent;
 end if;
 return jsonb_build_object('model',coalesce(o.pricing_mode,'uncommissioned'),'recipient_id',p_target,
  'role_discriminator',case when o.pricing_mode='role_split' then exists(select 1 from public.user_roles where user_id=p_target and role='senior_lecturer') end,
  'policy_version',o.policy_version,'amount',net,'total_amount',net_total,'currency',c.currency,'quote_version',quote_version,
  'organisation_id',o.organisation_id,'gross_amount',o.gross_amount,'gross_total_amount',o.gross_total_amount,
  'platform_percent',platform,'platform_total_amount',o.gross_total_amount-net_total);
end;$$;

-- Only the recipient's net and ordinary operational terms enter public consent.
create function private.substitution_target_quote(p_claim uuid,p_target uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select private.substitution_quote(p_claim)||jsonb_build_object('amount',context->'amount','total_amount',context->'total_amount',
  'currency',context->'currency','terms_version',context->'quote_version')
 from(select private.substitution_pricing_context(p_claim,p_target)context)pricing;
$$;

create or replace function private.propose_job_substitution(p_claim_id uuid,p_target_user_id uuid,p_reason text,p_request_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare c public.job_claims; previous private.job_substitutions; result uuid; quote jsonb; context jsonb; member uuid;
begin
 if not private.actor_active() then raise exception 'Active account required' using errcode='42501';end if;
 if p_request_id is null or p_target_user_id is null or length(trim(coalesce(p_reason,''))) not between 5 and 1000 then raise exception 'Target, reason and request key required' using errcode='22023';end if;
 select * into c from public.job_claims where id=p_claim_id;
 if c.id is null then raise exception 'Assignment unavailable' using errcode='42501';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('substitute-request:'||auth.uid()::text||p_request_id::text,0));
 select * into previous from private.job_substitutions where proposed_by=auth.uid() and request_id=p_request_id;
 if found then
  if previous.original_claim_id<>p_claim_id or previous.target_user_id<>p_target_user_id or previous.reason<>trim(p_reason) then raise exception 'Substitution idempotency conflict' using errcode='22023';end if;
  return previous.id;
 end if;
 -- Lock both lecturers in a global order, before the shared job/claim locks.
 perform 1 from public.profiles where id in(auth.uid(),c.lecturer_id,p_target_user_id) order by id for share;
 if not private.actor_active() then raise exception 'Active account required' using errcode='42501';end if;
 for member in select distinct u from unnest(array[c.lecturer_id,p_target_user_id])u order by u loop
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(member::text,0));end loop;
 perform 1 from public.jobs where id=c.job_id for update;
 perform 1 from public.job_claims where id=c.id for update;
 c=private.check_substitution_claim(c.id);
 if p_target_user_id=c.lecturer_id or private.assignment_replacement_eligibility(c.job_id,p_target_user_id,c.id)<>'eligible'
 or exists(select 1 from public.job_claims where job_id=c.job_id and lecturer_id=p_target_user_id and status='confirmed') then
  raise exception 'Target must be a qualified available lecturer' using errcode='22023';end if;
 update private.job_substitutions set status='expired',resolved_at=clock_timestamp() where original_claim_id=c.id and status='pending' and expires_at<=now();
 context=private.substitution_pricing_context(c.id,p_target_user_id);
 quote=private.substitution_target_quote(c.id,p_target_user_id);
 insert into private.job_substitutions(original_claim_id,job_id,target_user_id,proposed_by,request_id,reason,quote,quote_hash,pricing_context,expires_at)
 values(c.id,c.job_id,p_target_user_id,auth.uid(),p_request_id,trim(p_reason),quote,
  encode(sha256(convert_to(quote::text,'UTF8')),'hex'),context,least(now()+interval '7 days',(select min(starts_at) from public.assignment_sessions where claim_id=c.id))) returning id into result;
 insert into public.notifications(user_id,kind,resource_id) values(p_target_user_id,'substitution_proposed',result);
 insert into public.audit_events(actor_id,action,resource_id,details) values(auth.uid(),'assignment.substitution_proposed',result,jsonb_build_object('claim_id',c.id));
 return result;
end;$$;

create or replace function private.job_substitutions(p_job_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not private.actor_active() then raise exception 'Active account required' using errcode='42501';end if;
 if p_job_id is not null and not(private.has_permission('jobs.manage') or exists(select 1 from public.job_claims c where c.job_id=p_job_id and c.lecturer_id=auth.uid())) then
  raise exception 'Assignment history unavailable' using errcode='42501';end if;
 return coalesce((select jsonb_agg(item) from (
  select jsonb_build_object('id',s.id,'job_id',s.job_id,'original_claim_id',s.original_claim_id,
   'target_user_id',s.target_user_id,'target_name',target.display_name,'proposer_name',proposer.display_name,
   -- A source/proposer may withdraw and follow operational progress, but
   -- cannot inspect another lecturer's offered pay or brute-force its hash.
   'quote',case when (s.target_user_id=auth.uid() and s.pricing_context is not null) or private.has_permission('finance.gross.read') then s.quote
    else s.quote||jsonb_build_object('amount',null,'total_amount',null,'currency',null,'rate_unit',null,'terms',null,'terms_version',null) end,
   'quote_hash',case when (s.target_user_id=auth.uid() and s.pricing_context is not null) or private.has_permission('finance.gross.read') then s.quote_hash end,'reason',s.reason,
   'status',case when s.status='pending' and s.expires_at<=now() then 'expired' else s.status end,
   'expires_at',s.expires_at,'created_at',s.created_at,'accepted_claim_id',s.accepted_claim_id,
   'can_accept',s.target_user_id=auth.uid() and s.pricing_context is not null and s.status='pending' and s.expires_at>now(),
   'can_withdraw',s.status='pending' and s.expires_at>now() and (s.proposed_by=auth.uid() or c.lecturer_id=auth.uid() or private.has_permission('jobs.manage'))) item
  from private.job_substitutions s join public.job_claims c on c.id=s.original_claim_id
   join public.profiles target on target.id=s.target_user_id join public.profiles proposer on proposer.id=s.proposed_by
  where ((p_job_id is null and s.target_user_id=auth.uid()) or (p_job_id=s.job_id and (s.target_user_id=auth.uid() or s.proposed_by=auth.uid() or c.lecturer_id=auth.uid() or private.has_permission('jobs.manage'))))
  order by s.created_at desc,s.id limit 100) visible),'[]'::jsonb);
end;$$;

create or replace function private.respond_job_substitution(p_offer_id uuid,p_action text,p_quote_hash text,p_request_id uuid,p_accept_terms boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare offer private.job_substitutions; original public.job_claims; j public.jobs; actor uuid:=auth.uid(); member uuid;
 status text; new_claim uuid; contract uuid; room record; previous public.job_claims;
begin
 if not private.actor_active() then raise exception 'Active account required' using errcode='42501';end if;
 if p_action is null or p_action not in('accept','decline','withdraw') or p_request_id is null then raise exception 'Explicit action and request required' using errcode='22023';end if;
 select * into offer from private.job_substitutions where id=p_offer_id;
 select * into original from public.job_claims where id=offer.original_claim_id;
 if offer.id is null or not(offer.target_user_id=actor or (p_action='withdraw' and (offer.proposed_by=actor or original.lecturer_id=actor or private.has_permission('jobs.manage')))) then
  raise exception 'Substitution access denied' using errcode='42501';end if;
 if p_action='withdraw' and not(offer.proposed_by=actor or original.lecturer_id=actor or private.has_permission('jobs.manage')) then
  raise exception 'Only the proposer or assignment manager can withdraw' using errcode='42501';end if;
 perform 1 from public.profiles where id in(actor,original.lecturer_id) order by id for share;
 if not private.actor_active() then raise exception 'Active account required' using errcode='42501';end if;
 for member in select distinct u from unnest(array[original.lecturer_id,offer.target_user_id])u order by u loop
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(member::text,0));end loop;
 select * into j from public.jobs where id=offer.job_id for update;
 select * into original from public.job_claims where id=offer.original_claim_id for update;
 select * into offer from private.job_substitutions where id=p_offer_id for update;
 if p_action='accept' and offer.target_user_id<>actor then raise exception 'Only the recipient can accept' using errcode='42501';end if;
 if p_action in('accept','decline') and offer.target_user_id<>actor then raise exception 'Only the recipient can respond' using errcode='42501';end if;
 if offer.status='accepted' and p_action='accept' then
  if p_quote_hash is distinct from offer.quote_hash or not coalesce(p_accept_terms,false) then raise exception 'Exact accepted terms required' using errcode='22023';end if;
  return jsonb_build_object('status','confirmed','claim_id',offer.accepted_claim_id);
 end if;
 if offer.status=p_action||'d' or (p_action='withdraw' and offer.status='withdrawn') then return jsonb_build_object('status',offer.status);end if;
 if offer.status<>'pending' then return jsonb_build_object('status','unavailable');end if;
 if offer.expires_at<=now() then update private.job_substitutions set status='expired',resolved_at=clock_timestamp() where id=offer.id;return jsonb_build_object('status','expired');end if;
 if p_action<>'accept' then
  update private.job_substitutions set status=case when p_action='decline' then 'declined' else 'withdrawn' end,resolved_at=clock_timestamp() where id=offer.id;
  insert into public.notifications(user_id,kind,resource_id) select distinct user_id,'substitution_closed',offer.id from unnest(array[offer.target_user_id,offer.proposed_by,original.lecturer_id])user_id on conflict do nothing;
  insert into public.audit_events(actor_id,action,resource_id) values(actor,'assignment.substitution_'||p_action,offer.id);
  return jsonb_build_object('status',case when p_action='decline' then 'declined' else 'withdrawn' end);
 end if;
 if not coalesce(p_accept_terms,false) or p_quote_hash is distinct from offer.quote_hash then raise exception 'Explicit consent to the exact quote is required' using errcode='22023';end if;
 if original.status<>'confirmed' or exists(select 1 from public.invoice_items where claim_id=original.id)
 or not exists(select 1 from public.assignment_sessions where claim_id=original.id)
 or exists(select 1 from public.assignment_sessions where claim_id=original.id and (starts_at<=clock_timestamp() or released_at is not null)) then return jsonb_build_object('status','unavailable');end if;
 -- The target profile lock is shared with role edits; the job lock protects
 -- offer repricing. Compare the complete private context before the INSERT
 -- trigger can derive a rate, even if rounding leaves a public amount equal.
 if offer.pricing_context is null or private.substitution_pricing_context(original.id,actor) is distinct from offer.pricing_context
 or private.substitution_target_quote(original.id,actor) is distinct from offer.quote then return jsonb_build_object('status','terms_changed');end if;
 status=private.assignment_replacement_eligibility(j.id,actor,original.id);
 if status<>'eligible' then return jsonb_build_object('status',status);end if;
 select * into previous from public.job_claims where lecturer_id=actor and idempotency_key=p_request_id;
 if found then return jsonb_build_object('status','idempotency_conflict');end if;
 -- Commission snapshots may not be silently recalculated for a transfer.
 -- Recipient net can legitimately differ by tier; the customer's accepted
 -- gross, organisation and currency must still match the original ledger.
 if exists(select 1 from private.claim_revenue_ledger where claim_id=original.id) and not exists(
  select 1 from private.claim_revenue_ledger l join private.job_commission_offers o on o.job_id=l.job_id
   where l.claim_id=original.id and row(l.organisation_id,l.gross_amount,l.gross_total_amount,l.currency)
    is not distinct from row(o.organisation_id,o.gross_amount,o.gross_total_amount,o.currency)) then return jsonb_build_object('status','financial_review');end if;
 if coalesce((select pricing_mode from private.job_commission_offers where job_id=original.job_id),'legacy')<>'role_split'
 and exists(select 1 from private.claim_revenue_ledger where claim_id=original.id) and not exists(
  select 1 from private.claim_revenue_ledger l join private.job_commission_offers o on o.job_id=l.job_id
   where l.claim_id=original.id and row(l.gross_amount,l.gross_total_amount,l.platform_percent,l.platform_total_amount,l.lecturer_net_amount,l.lecturer_net_total_amount,l.currency)
    is not distinct from row(o.gross_amount,o.gross_total_amount,o.platform_percent,o.platform_total_amount,o.lecturer_net_amount,o.lecturer_net_total_amount,o.currency)) then return jsonb_build_object('status','financial_review');end if;
 if j.requires_contract then contract=private.current_contract_for_interval(actor,(select min(starts_at) from public.assignment_sessions where claim_id=original.id),(select max(ends_at) from public.assignment_sessions where claim_id=original.id));end if;
 -- The temporary state is internal to this single transaction; cancellation's
 -- trigger closes competing pending offers but cannot close this atomic accept.
 update private.job_substitutions set status='accepting' where id=offer.id;
 update public.job_claims set status='cancelled' where id=original.id;
 update public.assignment_sessions set released_at=clock_timestamp() where claim_id=original.id and released_at is null;
 insert into public.job_claims(job_id,lecturer_id,idempotency_key,amount,currency,rate_unit,total_amount,terms,terms_version,contract_id)
 values(j.id,actor,p_request_id,(offer.quote->>'amount')::numeric,original.currency,original.rate_unit,(offer.quote->>'total_amount')::numeric,offer.quote->>'terms',original.terms_version,contract) returning id into new_claim;
 -- Independent receipt checks fail the whole transfer if a future trigger
 -- changes the quoted net or captured revenue. The old ledger is never edited.
 if not exists(select 1 from public.job_claims c where c.id=new_claim and row(c.amount,c.total_amount,c.currency)
  is not distinct from row((offer.quote->>'amount')::numeric,(offer.quote->>'total_amount')::numeric,offer.quote->>'currency')) then
  raise exception 'Replacement compensation changed; refresh the offer' using errcode='23514';end if;
 if offer.pricing_context->>'model'<>'uncommissioned' and not exists(select 1 from private.claim_revenue_ledger l where l.claim_id=new_claim
  and row(l.organisation_id,l.gross_amount,l.gross_total_amount,l.platform_percent,l.platform_total_amount,l.lecturer_net_amount,l.lecturer_net_total_amount,l.currency)
  is not distinct from row((offer.pricing_context->>'organisation_id')::uuid,(offer.pricing_context->>'gross_amount')::numeric,(offer.pricing_context->>'gross_total_amount')::numeric,
   (offer.pricing_context->>'platform_percent')::numeric,(offer.pricing_context->>'platform_total_amount')::numeric,(offer.quote->>'amount')::numeric,(offer.quote->>'total_amount')::numeric,offer.quote->>'currency')) then
  raise exception 'Replacement revenue changed; refresh the offer' using errcode='23514';end if;
 insert into public.assignment_sessions(claim_id,lecturer_id,starts_at,ends_at)
  select new_claim,actor,starts_at,ends_at from public.assignment_sessions where claim_id=original.id order by starts_at,id;
 insert into public.chat_rooms(job_id) values(j.id) on conflict(job_id) do update set job_id=excluded.job_id;
 -- Revoke the old lecturer's assignment-derived course memberships. A genuine
 -- independent enrolment/other accepted course assignment keeps its own rights.
 for room in select r.id,r.kind,r.owner_id from public.chat_rooms r where
  (r.job_id=j.id and r.kind='lecturer_course') or (j.course_run_id is not null and r.course_run_id=j.course_run_id and r.kind='participant_course') order by r.id for update loop
  if room.kind='lecturer_course' or (not exists(select 1 from public.jobs other join public.job_claims c on c.job_id=other.id where other.course_run_id=j.course_run_id and c.lecturer_id=original.lecturer_id and c.status='confirmed')
   and not exists(select 1 from public.course_enrolments e where e.course_run_id=j.course_run_id and e.user_id=original.lecturer_id and e.status in('enrolled','completed'))) then
   update public.chat_members set removed_at=clock_timestamp() where room_id=room.id and user_id=original.lecturer_id and removed_at is null;
  end if;
  insert into public.chat_members(room_id,user_id) values(room.id,actor) on conflict(room_id,user_id) do update set removed_at=null,joined_at=clock_timestamp();
  if room.owner_id=original.lecturer_id then update public.chat_rooms set owner_id=actor where id=room.id;end if;
 end loop;
 delete from private.job_waitlist where job_id=j.id and user_id=actor;
 update private.job_substitutions set status='accepted',accepted_claim_id=new_claim,accept_request_id=p_request_id,resolved_at=clock_timestamp() where id=offer.id;
 insert into public.claim_events(claim_id,actor_id,event_type) values(original.id,actor,'substituted_out'),(new_claim,actor,'confirmed');
 insert into public.notifications(user_id,kind,resource_id) values(original.lecturer_id,'claim_cancelled',original.id),(actor,'claim_confirmed',new_claim) on conflict do nothing;
 insert into public.notifications(user_id,kind,resource_id) select distinct user_id,'substitution_closed',offer.id from unnest(array[offer.target_user_id,offer.proposed_by,original.lecturer_id])user_id on conflict do nothing;
 insert into public.audit_events(actor_id,action,resource_id,details) values(actor,'assignment.substitution_accepted',offer.id,jsonb_build_object('source_claim_id',original.id,'replacement_claim_id',new_claim));
 return jsonb_build_object('status','confirmed','claim_id',new_claim);
exception when exclusion_violation then
 -- Includes the independent calendar/availability exclusion guard: all writes
 -- in this PL/pgSQL subtransaction are rolled back, including old releases.
 return jsonb_build_object('status','conflict');
end;$$;

create or replace function private.finance_forecast(p_from date,p_until date,p_pipeline_probability numeric default 0) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;can_gross boolean;zone text;begins timestamptz;ends timestamptz;
begin
 if not private.has_permission('finance.manage') then raise exception 'finance.manage and MFA required' using errcode='42501';end if;
 perform private.finance_period(p_from,p_until);
 if p_pipeline_probability is null or p_pipeline_probability<0 or p_pipeline_probability>1 or p_pipeline_probability::text in('NaN','Infinity','-Infinity') then raise exception 'Explicit pipeline probability from zero to one required' using errcode='22023';end if;
 can_gross=private.has_permission('finance.gross.read');select time_zone into zone from public.profiles where id=auth.uid();
 begins=p_from::timestamp at time zone zone;ends=p_until::timestamp at time zone zone;
 with accepted as(
  select date_trunc('month',sessions.starts_at at time zone zone)::date as month,c.currency,c.total_amount cost,
   case when can_gross then l.gross_total_amount end gross,
   case when can_gross and l.claim_id is not null then l.gross_total_amount-c.total_amount end margin,
   case when l.claim_id is null then 1 else 0 end unknown_gross
  from public.job_claims c cross join lateral(select min(starts_at) starts_at from public.assignment_sessions where claim_id=c.id)sessions
  left join private.claim_revenue_ledger l on l.claim_id=c.id where c.status='confirmed' and sessions.starts_at>=begins and sessions.starts_at<ends
 ), offers as(
  select date_trunc('month',sessions.starts_at at time zone zone)::date as month,j.currency,
   (j.capacity-(select count(*) from public.job_claims c where c.job_id=j.id and c.status='confirmed'))::numeric slots,case when fee.pricing_mode='role_split' then null else j.total_amount end cost,
   case when can_gross then fee.gross_total_amount end gross
  from public.jobs j cross join lateral(select min(starts_at) starts_at from public.job_sessions where job_id=j.id)sessions
  left join private.job_commission_offers fee on fee.job_id=j.id where j.status='published' and (j.claim_deadline is null or j.claim_deadline>now())
   and sessions.starts_at>now() and sessions.starts_at>=begins and sessions.starts_at<ends
 ), requests as(
  select date_trunc('month',(r.payload->'sessions'->0->>'starts_at')::timestamptz at time zone zone)::date as month,r.payload->>'currency' currency,
   case when can_gross then (r.payload->>'gross_total_amount')::numeric end gross
  from private.client_course_requests r where can_gross and r.job_id is null and r.status='submitted'
   and (r.payload->'sessions'->0->>'starts_at')::timestamptz>now() and (r.payload->'sessions'->0->>'starts_at')::timestamptz>=begins and (r.payload->'sessions'->0->>'starts_at')::timestamptz<ends
 ), payment_entries as(
  select date_trunc('month',p.paid_at at time zone zone)::date as month,p.currency,p.amount
  from public.payment_records p where p.voided_at is null and p.paid_at>=begins and p.paid_at<ends
 ), buckets as(select a.month,a.currency from accepted a union select o.month,o.currency from offers o union select r.month,r.currency from requests r union select p.month,p.currency from payment_entries p)
 select coalesce(jsonb_agg(jsonb_build_object('month',b.month,'currency',b.currency,
  'accepted_lecturer_cost',coalesce((select sum(cost) from accepted a where a.month=b.month and a.currency=b.currency),0),
  'accepted_gross_known',case when can_gross then coalesce((select sum(gross) from accepted a where a.month=b.month and a.currency=b.currency),0) end,
  'accepted_margin_known',case when can_gross then coalesce((select sum(margin) from accepted a where a.month=b.month and a.currency=b.currency),0) end,
  'unknown_gross_claims',case when can_gross then coalesce((select sum(unknown_gross) from accepted a where a.month=b.month and a.currency=b.currency),0) end,
  -- A public role-split zero is a privacy sentinel, not a free lecturer.
  -- Do not invent the future mix of regular/senior recipients or disclose
  -- alternate rates to finance operations lacking gross-finance authority.
  'pipeline_cost_unknown_positions',coalesce((select sum(slots) from offers o where o.month=b.month and o.currency=b.currency and o.cost is null),0),
  'pipeline_lecturer_cost_known',case when exists(select 1 from offers o where o.month=b.month and o.currency=b.currency and o.cost is null and o.slots>0) then null
   else coalesce((select round(sum(cost*slots)*p_pipeline_probability,2) from offers o where o.month=b.month and o.currency=b.currency),0) end,
  'pipeline_gross_known',case when can_gross then coalesce((select round(sum(gross*slots)*p_pipeline_probability,2) from offers o where o.month=b.month and o.currency=b.currency),0)+coalesce((select round(sum(gross)*p_pipeline_probability,2) from requests r where r.month=b.month and r.currency=b.currency),0) end,
  'lecturer_invoice_payments',coalesce((select sum(amount) from payment_entries p where p.month=b.month and p.currency=b.currency),0)) order by b.month,b.currency),'[]'::jsonb) into result from buckets b;
 return jsonb_build_object('from',p_from,'until',p_until,'time_zone',zone,'pipeline_probability',p_pipeline_probability,'gross_authorized',can_gross,
  'payment_basis','lecturer_invoice_payment_records','months',result);
end;$$;
revoke all on function private.substitution_pricing_context(uuid,uuid),private.substitution_target_quote(uuid,uuid) from public,anon,authenticated,service_role;
COMMIT;
