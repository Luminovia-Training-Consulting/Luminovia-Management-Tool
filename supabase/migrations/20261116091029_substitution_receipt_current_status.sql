-- Return the current target-owned assignment state on accepted-offer retries.
-- Exact hash/consent, role/lock checks and every immutable deal remain intact.
BEGIN;

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
 -- Pre-lock checks only reject obvious foreign requests. A role edit may
 -- commit while this request waits for its profile lock; after all locks,
 -- require current management capability or immutable owner/proposer rights.
 if p_action='withdraw' and not(offer.proposed_by=actor or original.lecturer_id=actor or private.has_permission('jobs.manage')) then
  raise exception 'Only the proposer or current assignment manager can withdraw' using errcode='42501';end if;
 if p_action='accept' and offer.target_user_id<>actor then raise exception 'Only the recipient can accept' using errcode='42501';end if;
 if p_action in('accept','decline') and offer.target_user_id<>actor then raise exception 'Only the recipient can respond' using errcode='42501';end if;
 if offer.status='accepted' and p_action='accept' then
  if p_quote_hash is distinct from offer.quote_hash or not coalesce(p_accept_terms,false) then raise exception 'Exact accepted terms required' using errcode='22023';end if;
  -- Accepted offer history is immutable, but its resulting assignment may
  -- subsequently be cancelled. The caller/lecturer/job locks precede this
  -- current owned receipt read, so retries cannot resurrect its allocation.
  select * into previous from public.job_claims where id=offer.accepted_claim_id and lecturer_id=actor and job_id=offer.job_id for share;
  if not found then return jsonb_build_object('status','unavailable');end if;
  return jsonb_build_object('status',previous.status,'claim_id',previous.id);
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

COMMIT;
