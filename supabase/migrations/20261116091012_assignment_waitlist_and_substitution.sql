begin;

-- Waiting expresses interest only. It never reserves capacity or skips a claim.
create table private.job_waitlist (
 job_id uuid not null references public.jobs(id) on delete cascade,
 user_id uuid not null references public.profiles(id) on delete cascade,
 joined_at timestamptz not null default clock_timestamp(),
 last_notified_version integer,
 primary key(job_id,user_id)
);
create index job_waitlist_user on private.job_waitlist(user_id,job_id);
alter table private.job_waitlist enable row level security;
revoke all on private.job_waitlist from public,anon,authenticated,service_role;

-- Return eligibility, never another lecturer's calendar rows or private notes.
-- Handover uses the accepted allocation block rather than a mutable template.
create function private.assignment_replacement_eligibility(p_job uuid,p_user uuid,p_claim uuid default null) returns text
language plpgsql stable security definer set search_path='' as $$
declare j public.jobs; starts timestamptz; ends timestamptz; intervals jsonb;
begin
 if not private.lecturer_user(p_user) then return 'not_eligible';end if;
 select * into j from public.jobs where id=p_job;
 if not found or j.status='archived' then return 'unavailable';end if;
 if p_claim is null then
  select min(s.starts_at),max(s.ends_at),jsonb_agg(jsonb_build_object('start',s.starts_at,'end',s.ends_at))
   into starts,ends,intervals from public.job_sessions s where s.job_id=p_job;
 else
  select min(s.starts_at),max(s.ends_at),jsonb_agg(jsonb_build_object('start',s.starts_at,'end',s.ends_at))
   into starts,ends,intervals from public.assignment_sessions s where s.claim_id=p_claim and s.released_at is null;
 end if;
 if starts is null or starts<=now() then return 'unavailable';end if;
 if exists(select 1 from public.job_requirements r where r.job_id=p_job and not exists(select 1 from public.lecturer_topics t
  where t.user_id=p_user and t.topic_id=r.topic_id and t.verified and (t.valid_until is null or t.valid_until>=ends))) then return 'not_eligible';end if;
 if j.requires_contract and private.current_contract_for_interval(p_user,starts,ends) is null then return 'prerequisite_missing';end if;
 if exists(select 1 from jsonb_array_elements(intervals) s join public.assignment_sessions a on a.lecturer_id=p_user and a.released_at is null
   and tstzrange(a.starts_at,a.ends_at,'[)') && tstzrange((s->>'start')::timestamptz,(s->>'end')::timestamptz,'[)'))
 or exists(select 1 from jsonb_array_elements(intervals) s join public.personal_events e on e.user_id=p_user
   and tstzrange(e.starts_at,e.ends_at,'[)') && tstzrange((s->>'start')::timestamptz,(s->>'end')::timestamptz,'[)'))
 or exists(select 1 from jsonb_array_elements(intervals) s join public.lecturer_availability a on a.user_id=p_user and a.kind='unavailable'
   and tstzrange(a.starts_at,a.ends_at,'[)') && tstzrange((s->>'start')::timestamptz,(s->>'end')::timestamptz,'[)')) then return 'conflict';end if;
 return 'eligible';
end;$$;

create function private.job_waitlist(p_job_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare j public.jobs; joined boolean; can_join boolean;
begin
 if not private.lecturer_actor() then raise exception 'Lecturer account required' using errcode='42501';end if;
 select * into j from public.jobs where id=p_job_id;
 select exists(select 1 from private.job_waitlist w where w.job_id=p_job_id and w.user_id=auth.uid()) into joined;
 if j.id is null or (not joined and j.status not in('filled','published')) then raise exception 'Waitlist unavailable' using errcode='42501';end if;
 can_join=j.status in('filled','published') and exists(select 1 from public.job_sessions where job_id=j.id)
  and not exists(select 1 from public.job_sessions where job_id=j.id and starts_at<=now())
  and not exists(select 1 from public.job_claims where job_id=j.id and lecturer_id=auth.uid() and status='confirmed')
  and (j.status='filled' or (select count(*) from public.job_claims where job_id=j.id and status='confirmed')>=j.capacity);
 return jsonb_build_object('job_id',j.id,'title',j.title,'joined',joined,'can_join',can_join,
  'available',j.status='published' and (select count(*) from public.job_claims where job_id=j.id and status='confirmed')<j.capacity
   and (j.claim_deadline is null or j.claim_deadline>now()));
end;$$;
create function public.job_waitlist(p_job_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$select private.job_waitlist(p_job_id);$$;

create function private.my_job_waitlist() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.lecturer_actor() then raise exception 'Lecturer account required' using errcode='42501';end if;
 return coalesce((select jsonb_agg(private.job_waitlist(w.job_id)||jsonb_build_object('joined_at',w.joined_at) order by w.joined_at desc,w.job_id)
  from (select job_id,joined_at from private.job_waitlist where user_id=auth.uid() order by joined_at desc,job_id limit 100)w),'[]'::jsonb);
end;$$;
create function public.my_job_waitlist() returns jsonb language sql stable security invoker set search_path='' as $$select private.my_job_waitlist();$$;

create function private.set_job_waitlist(p_job_id uuid,p_join boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j public.jobs; state jsonb;
begin
 if not private.actor_active() or (p_join and not private.lecturer_actor()) then raise exception 'Lecturer account required' using errcode='42501';end if;
 if p_join is null then raise exception 'Join or leave required' using errcode='22023';end if;
 perform 1 from public.profiles where id=auth.uid() and active for share;
 select * into j from public.jobs where id=p_job_id for update;
 if not found then raise exception 'Waitlist unavailable' using errcode='42501';end if;
 if p_join then
  state=private.job_waitlist(p_job_id);
  if not (state->>'joined')::boolean and not (state->>'can_join')::boolean then raise exception 'Only a full future offer can be waitlisted' using errcode='22023';end if;
  insert into private.job_waitlist(job_id,user_id) values(p_job_id,auth.uid()) on conflict do nothing;
 else
  delete from private.job_waitlist where job_id=p_job_id and user_id=auth.uid();
  delete from public.notifications where user_id=auth.uid() and kind='job_waitlist_available' and resource_id=p_job_id;
  return jsonb_build_object('job_id',j.id,'title',j.title,'joined',false,'can_join',false,'available',false);
 end if;
 return private.job_waitlist(p_job_id);
end;$$;
create function public.set_job_waitlist(p_job_id uuid,p_join boolean) returns jsonb language sql security invoker set search_path='' as $$select private.set_job_waitlist(p_job_id,p_join);$$;

create function private.notify_job_waitlist() returns trigger
language plpgsql security definer set search_path='' as $$
declare j public.jobs; waiter record;
begin
 if new.status<>'published' or old.status='published' then return null;end if;
 select * into j from public.jobs where id=new.id;
 if j.status<>'published' or j.claim_deadline<=now() or
  (select count(*) from public.job_claims where job_id=j.id and status='confirmed')>=j.capacity then return null;end if;
 for waiter in select w.user_id from private.job_waitlist w join private.notification_preferences p on p.user_id=w.user_id
  where w.job_id=j.id and p.job_updates and w.last_notified_version is distinct from j.lifecycle_version
   and private.assignment_replacement_eligibility(j.id,w.user_id)='eligible'
   and not exists(select 1 from public.job_claims c where c.job_id=j.id and c.lecturer_id=w.user_id and c.status='confirmed')
 loop
  insert into public.notifications(user_id,kind,resource_id) values(waiter.user_id,'job_waitlist_available',j.id)
   on conflict(user_id,kind,resource_id) do update set read_at=null,created_at=clock_timestamp();
  update private.job_waitlist set last_notified_version=j.lifecycle_version where job_id=j.id and user_id=waiter.user_id;
 end loop;
 return null;
end;$$;
create constraint trigger notify_job_waitlist after update on public.jobs deferrable initially deferred
 for each row execute function private.notify_job_waitlist();

create table private.job_substitutions (
 id uuid primary key default gen_random_uuid(),
 original_claim_id uuid not null references public.job_claims(id),
 job_id uuid not null references public.jobs(id),
 target_user_id uuid not null references public.profiles(id),
 proposed_by uuid not null references public.profiles(id),
 request_id uuid not null,
 reason text not null check(length(reason) between 5 and 1000),
 quote jsonb not null,
 quote_hash text not null,
 status text not null default 'pending' check(status in('pending','accepting','accepted','declined','withdrawn','superseded','expired')),
 expires_at timestamptz not null,
 accepted_claim_id uuid references public.job_claims(id),
 accept_request_id uuid,
 created_at timestamptz not null default clock_timestamp(),
 resolved_at timestamptz,
 unique(proposed_by,request_id)
);
create unique index one_pending_substitute on private.job_substitutions(original_claim_id) where status in('pending','accepting');
create index substitution_target_status on private.job_substitutions(target_user_id,status,created_at desc);
create index substitution_job_history on private.job_substitutions(job_id,created_at desc);
create index substitution_proposer on private.job_substitutions(proposed_by,created_at desc);
create index substitution_source on private.job_substitutions(original_claim_id);
create index substitution_result on private.job_substitutions(accepted_claim_id) where accepted_claim_id is not null;
alter table private.job_substitutions enable row level security;
revoke all on private.job_substitutions from public,anon,authenticated,service_role;

create function private.substitution_quote(p_claim uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('title',j.title,'customer_name',j.customer_name,'time_zone',j.time_zone,
  'delivery_type',j.delivery_type,'location',j.location,'amount',c.amount,'total_amount',c.total_amount,
  'currency',c.currency,'rate_unit',c.rate_unit,'terms',c.terms,'terms_version',c.terms_version,
  'requires_contract',j.requires_contract,'sessions',(select jsonb_agg(jsonb_build_object('starts_at',s.starts_at,'ends_at',s.ends_at) order by s.starts_at,s.id)
   from public.assignment_sessions s where s.claim_id=c.id and s.released_at is null))
 from public.job_claims c join public.jobs j on j.id=c.job_id where c.id=p_claim;
$$;
create function private.check_substitution_claim(p_claim uuid) returns public.job_claims
language plpgsql stable security definer set search_path='' as $$
declare c public.job_claims;
begin
 select * into c from public.job_claims where id=p_claim;
 if c.id is null or not(private.has_permission('jobs.manage') or (c.lecturer_id=auth.uid() and private.lecturer_actor())) then
  raise exception 'Own assignment or jobs.manage and MFA required' using errcode='42501';end if;
 if c.status<>'confirmed' or not exists(select 1 from public.assignment_sessions where claim_id=c.id)
 or exists(select 1 from public.assignment_sessions where claim_id=c.id and (starts_at<=now() or released_at is not null))
 or exists(select 1 from public.invoice_items where claim_id=c.id) then
  raise exception 'Only a complete future uninvoiced assignment can be handed over' using errcode='22023';end if;
 return c;
end;$$;
create function private.substitution_candidates(p_claim_id uuid,p_search text default '',p_limit integer default 30) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare c public.job_claims;
begin
 if not private.actor_active() then raise exception 'Active account required' using errcode='42501';end if;
 if p_search is null or length(p_search)>120 or p_limit is null or p_limit not between 1 and 50 then raise exception 'Invalid candidate search' using errcode='22023';end if;
 c=private.check_substitution_claim(p_claim_id);
 return coalesce((select jsonb_agg(to_jsonb(candidate)) from (
  select p.id,p.display_name from public.profiles p where p.id<>c.lecturer_id and p.active
   and strpos(lower(p.display_name),lower(p_search))>0 and private.assignment_replacement_eligibility(c.job_id,p.id,c.id)='eligible'
   and not exists(select 1 from public.job_claims other where other.job_id=c.job_id and other.lecturer_id=p.id and other.status='confirmed')
   order by p.display_name,p.id limit p_limit) candidate),'[]'::jsonb);
end;$$;
create function public.substitution_candidates(p_claim_id uuid,p_search text default '',p_limit integer default 30) returns jsonb
language sql stable security invoker set search_path='' as $$select private.substitution_candidates(p_claim_id,p_search,p_limit);$$;

create function private.propose_job_substitution(p_claim_id uuid,p_target_user_id uuid,p_reason text,p_request_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare c public.job_claims; previous private.job_substitutions; result uuid; quote jsonb; member uuid;
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
 quote=private.substitution_quote(c.id);
 insert into private.job_substitutions(original_claim_id,job_id,target_user_id,proposed_by,request_id,reason,quote,quote_hash,expires_at)
 values(c.id,c.job_id,p_target_user_id,auth.uid(),p_request_id,trim(p_reason),quote,
  encode(sha256(convert_to(quote::text,'UTF8')),'hex'),least(now()+interval '7 days',(select min(starts_at) from public.assignment_sessions where claim_id=c.id))) returning id into result;
 insert into public.notifications(user_id,kind,resource_id) values(p_target_user_id,'substitution_proposed',result);
 insert into public.audit_events(actor_id,action,resource_id,details) values(auth.uid(),'assignment.substitution_proposed',result,jsonb_build_object('claim_id',c.id));
 return result;
end;$$;
create function public.propose_job_substitution(p_claim_id uuid,p_target_user_id uuid,p_reason text,p_request_id uuid) returns uuid
language sql security invoker set search_path='' as $$select private.propose_job_substitution(p_claim_id,p_target_user_id,p_reason,p_request_id);$$;

create function private.job_substitutions(p_job_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not private.actor_active() then raise exception 'Active account required' using errcode='42501';end if;
 if p_job_id is not null and not(private.has_permission('jobs.manage') or exists(select 1 from public.job_claims c where c.job_id=p_job_id and c.lecturer_id=auth.uid())) then
  raise exception 'Assignment history unavailable' using errcode='42501';end if;
 return coalesce((select jsonb_agg(item) from (
  select jsonb_build_object('id',s.id,'job_id',s.job_id,'original_claim_id',s.original_claim_id,
   'target_user_id',s.target_user_id,'target_name',target.display_name,'proposer_name',proposer.display_name,
   'quote',s.quote,'quote_hash',s.quote_hash,'reason',s.reason,
   'status',case when s.status='pending' and s.expires_at<=now() then 'expired' else s.status end,
   'expires_at',s.expires_at,'created_at',s.created_at,'accepted_claim_id',s.accepted_claim_id,
   'can_accept',s.target_user_id=auth.uid() and s.status='pending' and s.expires_at>now(),
   'can_withdraw',s.status='pending' and s.expires_at>now() and (s.proposed_by=auth.uid() or c.lecturer_id=auth.uid() or private.has_permission('jobs.manage'))) item
  from private.job_substitutions s join public.job_claims c on c.id=s.original_claim_id
   join public.profiles target on target.id=s.target_user_id join public.profiles proposer on proposer.id=s.proposed_by
  where ((p_job_id is null and s.target_user_id=auth.uid()) or (p_job_id=s.job_id and (s.target_user_id=auth.uid() or s.proposed_by=auth.uid() or c.lecturer_id=auth.uid() or private.has_permission('jobs.manage'))))
  order by s.created_at desc,s.id limit 100) visible),'[]'::jsonb);
end;$$;
create function public.job_substitutions(p_job_id uuid default null) returns jsonb language sql stable security invoker set search_path='' as $$select private.job_substitutions(p_job_id);$$;

create function private.close_cancelled_substitutions() returns trigger
language plpgsql security definer set search_path='' as $$
declare offer record;
begin
 if new.status<>'cancelled' or old.status='cancelled' then return new;end if;
 for offer in update private.job_substitutions set status='superseded',resolved_at=clock_timestamp()
  where original_claim_id=new.id and status='pending' returning id,target_user_id,proposed_by loop
  insert into public.notifications(user_id,kind,resource_id) values(offer.target_user_id,'substitution_closed',offer.id) on conflict do nothing;
 end loop;
 return new;
end;$$;
create trigger close_cancelled_substitutions after update of status on public.job_claims
 for each row execute function private.close_cancelled_substitutions();

create function private.respond_job_substitution(p_offer_id uuid,p_action text,p_quote_hash text,p_request_id uuid,p_accept_terms boolean default false) returns jsonb
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
 if private.substitution_quote(original.id) is distinct from offer.quote then return jsonb_build_object('status','terms_changed');end if;
 status=private.assignment_replacement_eligibility(j.id,actor,original.id);
 if status<>'eligible' then return jsonb_build_object('status',status);end if;
 select * into previous from public.job_claims where lecturer_id=actor and idempotency_key=p_request_id;
 if found then return jsonb_build_object('status','idempotency_conflict');end if;
 -- Commission snapshots may not be silently recalculated for a transfer.
 if exists(select 1 from private.claim_revenue_ledger where claim_id=original.id) and not exists(
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
 values(j.id,actor,p_request_id,original.amount,original.currency,original.rate_unit,original.total_amount,original.terms,original.terms_version,contract) returning id into new_claim;
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
create function public.respond_job_substitution(p_offer_id uuid,p_action text,p_quote_hash text,p_request_id uuid,p_accept_terms boolean default false) returns jsonb
language sql security invoker set search_path='' as $$select private.respond_job_substitution(p_offer_id,p_action,p_quote_hash,p_request_id,p_accept_terms);$$;

-- Read-only historical quote fields are immutable even for accidental service
-- updates. Status/result changes are owned by the reviewed RPCs above.
create function private.immutable_substitution_quote() returns trigger language plpgsql set search_path='' as $$
begin
 if (to_jsonb(new)-array['status','accepted_claim_id','accept_request_id','resolved_at']) is distinct from
  (to_jsonb(old)-array['status','accepted_claim_id','accept_request_id','resolved_at']) then raise exception 'Substitution quote is immutable' using errcode='23514';end if;
 return new;
end;$$;
create trigger immutable_substitution_quote before update on private.job_substitutions for each row execute function private.immutable_substitution_quote();

create or replace function private.email_category_enabled(p_user uuid,p_kind text) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce((select case when p_kind='chat_message' then p.chat when p_kind='forum_reply' then p.forum
  when p_kind in('job_reopened','job_matching','job_waitlist_available') then p.job_updates
  when p_kind in('session_reminder','contract_expiring') then p.reminders
  else p_kind in('claim_confirmed','claim_cancelled','contract_available','substitution_proposed','substitution_closed') end
 from private.notification_preferences p where p.user_id=p_user),false);
$$;

create or replace function private.notification_target(p_kind text,p_resource uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare target uuid; heading text; path text;
begin
 if p_kind='job_waitlist_available' then
  select j.id,j.title into target,heading from public.jobs j join private.job_waitlist w on w.job_id=j.id
   where j.id=p_resource and w.user_id=auth.uid() and j.status='published' and private.can_read_job(j.id);
  if found then path='/jobs/'||target;end if;
 elsif p_kind in('substitution_proposed','substitution_closed') then
  select s.id,s.quote->>'title' into target,heading from private.job_substitutions s join public.job_claims c on c.id=s.original_claim_id
   where s.id=p_resource and (s.target_user_id=auth.uid() or s.proposed_by=auth.uid() or c.lecturer_id=auth.uid() or private.has_permission('jobs.manage'))
   and (p_kind='substitution_closed' or (s.status='pending' and s.expires_at>now()));
  if found then path='/jobs?substitution='||target;end if;
 elsif p_kind in ('claim_confirmed','claim_cancelled') then
  select j.id,j.title into target,heading from public.job_claims c join public.jobs j on j.id=c.job_id
   where c.id=p_resource and c.lecturer_id=auth.uid() and private.can_read_job(j.id);
  if found then path='/jobs/'||target; end if;
 elsif p_kind in ('job_reopened','job_matching') then
  select j.id,j.title into target,heading from public.jobs j where j.id=p_resource and private.can_read_job(j.id);
  if found then path='/jobs/'||target; end if;
 elsif p_kind='chat_message' then
  select r.id,r.title into target,heading from public.messages m join public.chat_rooms r on r.id=m.room_id
   where m.id=p_resource and m.deleted_at is null and private.can_access_chat_room(r.id);
  if found then path='/chats?room='||target; end if;
 elsif p_kind='forum_reply' then
  select t.id,t.title into target,heading from public.forum_threads t where t.id=p_resource and private.can_read_forum(t.id);
  if found then path='/forum?thread='||target; end if;
 elsif p_kind='session_reminder' then
  select j.id,j.title into target,heading from public.assignment_sessions s join public.job_claims c on c.id=s.claim_id
   join public.jobs j on j.id=c.job_id where s.id=p_resource and c.lecturer_id=auth.uid()
   and c.status='confirmed' and s.released_at is null and private.can_read_job(j.id);
  if found then path='/jobs/'||target; end if;
 elsif p_kind in ('contract_available','contract_expiring') then
  select c.id,c.title into target,heading from public.contracts c where c.id=p_resource and c.user_id=auth.uid();
  if found then path='/contracts'; end if;
 end if;
 return jsonb_build_object('href',path,'title',coalesce(heading,''));
end;$$;

revoke all on function private.assignment_replacement_eligibility(uuid,uuid,uuid),private.notify_job_waitlist(),private.substitution_quote(uuid),
 private.check_substitution_claim(uuid),private.close_cancelled_substitutions(),private.immutable_substitution_quote() from public,anon,authenticated,service_role;
revoke all on function private.job_waitlist(uuid),public.job_waitlist(uuid),private.set_job_waitlist(uuid,boolean),public.set_job_waitlist(uuid,boolean),
 private.my_job_waitlist(),public.my_job_waitlist(),
 private.substitution_candidates(uuid,text,integer),public.substitution_candidates(uuid,text,integer),
 private.propose_job_substitution(uuid,uuid,text,uuid),public.propose_job_substitution(uuid,uuid,text,uuid),
 private.job_substitutions(uuid),public.job_substitutions(uuid),private.respond_job_substitution(uuid,text,text,uuid,boolean),public.respond_job_substitution(uuid,text,text,uuid,boolean)
 from public,anon,authenticated;
grant execute on function private.job_waitlist(uuid),public.job_waitlist(uuid),private.set_job_waitlist(uuid,boolean),public.set_job_waitlist(uuid,boolean),
 private.my_job_waitlist(),public.my_job_waitlist(),
 private.substitution_candidates(uuid,text,integer),public.substitution_candidates(uuid,text,integer),
 private.propose_job_substitution(uuid,uuid,text,uuid),public.propose_job_substitution(uuid,uuid,text,uuid),
 private.job_substitutions(uuid),public.job_substitutions(uuid),private.respond_job_substitution(uuid,text,text,uuid,boolean),public.respond_job_substitution(uuid,text,text,uuid,boolean)
 to authenticated;
commit;
