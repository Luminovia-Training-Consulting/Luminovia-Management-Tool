begin;

-- Lecturer withdrawal is a separate workflow from administrative cancellation.
-- Reasons stay in this private table; neither inbox rows nor public audit details
-- copy potentially sensitive text. Only the author and current job managers read it.
create table private.assignment_withdrawals (
 id uuid primary key default gen_random_uuid(),
 claim_id uuid not null references public.job_claims(id),
 lecturer_id uuid not null references public.profiles(id),
 status text not null check(status in('pending','approved','rejected','withdrawn','superseded')),
 reason text not null check(length(reason)<=1000),
 review_reason text check(review_reason is null or length(review_reason)<=1000),
 reviewed_by uuid references public.profiles(id),
 created_at timestamptz not null default clock_timestamp(),
 resolved_at timestamptz,
 check((status='pending' and resolved_at is null) or (status<>'pending' and resolved_at is not null))
);
create unique index assignment_withdrawals_one_pending on private.assignment_withdrawals(claim_id) where status='pending';
create index assignment_withdrawals_lecturer on private.assignment_withdrawals(lecturer_id,created_at desc,id);
alter table private.assignment_withdrawals enable row level security;
revoke all on private.assignment_withdrawals from public,anon,authenticated,service_role;

-- A transport retry reuses one immutable command payload. A rejected request may
-- be followed by a new application with a new command identity.
create table private.assignment_withdrawal_commands (
 actor_id uuid not null references public.profiles(id),
 request_id uuid not null,
 payload jsonb not null,
 withdrawal_id uuid not null references private.assignment_withdrawals(id),
 primary key(actor_id,request_id)
);
alter table private.assignment_withdrawal_commands enable row level security;
revoke all on private.assignment_withdrawal_commands from public,anon,authenticated,service_role;

-- Keep the complete existing release/snapshot/chat/invoice safeguards in a
-- non-callable helper. The public legacy endpoint cannot bypass the new window,
-- including when a lecturer also has a management role and cancels their own work.
alter function private.cancel_job_assignment(uuid,text,uuid) rename to cancel_job_assignment_immediate;
revoke all on function private.cancel_job_assignment_immediate(uuid,text,uuid) from public,anon,authenticated,service_role;
create function private.cancel_job_assignment(p_claim_id uuid,p_reason text,p_request_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare c public.job_claims;first_start timestamptz;
begin
 if not private.actor_active() then raise exception 'Authentication required' using errcode='42501';end if;
 perform 1 from public.profiles where id=auth.uid() and active for share;
 if not found then raise exception 'Authentication required' using errcode='42501';end if;
 select * into c from public.job_claims where id=p_claim_id;
 if c.lecturer_id=auth.uid() then
  -- Match the shared lecturer -> job -> claim order before deciding the window.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('job-request:'||auth.uid()::text||p_request_id::text,0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(c.lecturer_id::text,0));
  perform 1 from public.jobs where id=c.job_id for update;
  select * into c from public.job_claims where id=c.id for update;
  select min(starts_at) into first_start from public.assignment_sessions where claim_id=c.id;
  if c.status='confirmed' and first_start>clock_timestamp() and first_start<clock_timestamp()+interval '168 hours' then
   raise exception 'Short-notice withdrawal requires a reviewed application' using errcode='22023';
  end if;
 end if;
 return private.cancel_job_assignment_immediate(p_claim_id,p_reason,p_request_id);
end;$$;
create or replace function public.cancel_job_assignment(p_claim_id uuid,p_reason text,p_request_id uuid) returns uuid
language sql security invoker set search_path='' as $$select private.cancel_job_assignment(p_claim_id,p_reason,p_request_id);$$;

-- Administrative cancellation or a completed substitute can overtake a pending
-- application. Mark it closed in the same transaction, never leave a reviewable
-- request attached to an already released assignment. Approval replaces this
-- intermediate marker with 'approved' before the transaction commits.
create function private.supersede_assignment_withdrawals() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.status='cancelled' and old.status='confirmed' then
  update private.assignment_withdrawals set status='superseded',resolved_at=clock_timestamp()
   where claim_id=new.id and status='pending';
 end if;
 return new;
end;$$;
create trigger supersede_assignment_withdrawals after update of status on public.job_claims
 for each row execute function private.supersede_assignment_withdrawals();

-- This projection supplies current database time/window decisions to the UI.
-- Global reads contain only own applications or current MFA-authorized job
-- management work, and are bounded; a job link retrieves that exact history.
create function private.assignment_withdrawals(p_job_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare manager boolean:=private.has_permission('jobs.manage');items jsonb;claims jsonb;
begin
 if not private.actor_active() then raise exception 'Authentication required' using errcode='42501';end if;
 select coalesce(jsonb_agg(x.item order by x.pending desc,x.created_at desc,x.id),'[]'::jsonb) into items from(
  select w.id,w.created_at,w.status='pending' pending,jsonb_build_object(
   'id',w.id,'claim_id',w.claim_id,'job_id',c.job_id,'job_title',j.title,
   'lecturer_id',w.lecturer_id,'lecturer_name',p.display_name,'status',w.status,
   'reason',w.reason,'review_reason',w.review_reason,'created_at',w.created_at,'resolved_at',w.resolved_at,
   'can_review',manager and w.lecturer_id<>auth.uid() and w.status='pending' and c.status='confirmed'
    and not exists(select 1 from public.invoice_items i where i.claim_id=c.id)
    and coalesce((select min(s.starts_at) from public.assignment_sessions s where s.claim_id=c.id)>now(),false)) item
  from private.assignment_withdrawals w join public.job_claims c on c.id=w.claim_id
   join public.jobs j on j.id=c.job_id join public.profiles p on p.id=w.lecturer_id
  where (p_job_id is null or c.job_id=p_job_id) and (w.lecturer_id=auth.uid() or manager)
  order by (w.status='pending') desc,w.created_at desc,w.id limit 200
 )x;
 select coalesce(jsonb_agg(jsonb_build_object('claim_id',c.id,'starts_at',s.starts_at,
  'can_withdraw',coalesce(s.starts_at>now(),false) and private.lecturer_actor()
   and not exists(select 1 from public.invoice_items i where i.claim_id=c.id)
   and not exists(select 1 from private.assignment_withdrawals w where w.claim_id=c.id and w.status='pending'),
  'requires_approval',coalesce(s.starts_at<now()+interval '168 hours',false)) order by s.starts_at,c.id),'[]'::jsonb)
 into claims from public.job_claims c
 cross join lateral(select min(starts_at) starts_at from public.assignment_sessions where claim_id=c.id)s
 where c.lecturer_id=auth.uid() and c.status='confirmed' and (p_job_id is null or c.job_id=p_job_id);
 return jsonb_build_object('items',items,'claims',claims,'can_review',manager);
end;$$;
create function public.assignment_withdrawals(p_job_id uuid default null) returns jsonb
language sql stable security invoker set search_path='' as $$select private.assignment_withdrawals(p_job_id);$$;

-- Both commands hold the retry lock, lecturer lock, job and claim row before
-- touching request rows. This is the existing claim/calendar/invoice lock order;
-- racing approvals, direct cancellations and substitutes cannot partially release.
create function private.request_assignment_withdrawal(p_claim_id uuid,p_reason text,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.job_claims;w private.assignment_withdrawals;prior private.assignment_withdrawal_commands;
 actor uuid:=auth.uid();reason text:=trim(coalesce(p_reason,''));payload jsonb;first_start timestamptz;needs_review boolean;
begin
 if not private.lecturer_actor() then raise exception 'Lecturer authentication required' using errcode='42501';end if;
 perform 1 from public.profiles where id=actor and active for share;
 if not found or not private.lecturer_actor() then raise exception 'Lecturer authentication required' using errcode='42501';end if;
 if p_request_id is null or p_claim_id is null or length(reason)>1000 then raise exception 'Invalid withdrawal request' using errcode='22023';end if;
 payload=jsonb_build_object('action','request','claim_id',p_claim_id,'reason',reason);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('job-request:'||actor::text||p_request_id::text,0));
 select * into prior from private.assignment_withdrawal_commands where actor_id=actor and request_id=p_request_id;
 if found then
  if prior.payload<>payload then raise exception 'Withdrawal idempotency conflict' using errcode='22023';end if;
  select * into w from private.assignment_withdrawals where id=prior.withdrawal_id and lecturer_id=actor;
  return jsonb_build_object('id',w.id,'status',w.status);
 end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text,0));
 select * into c from public.job_claims where id=p_claim_id and lecturer_id=actor;
 if c.id is null then raise exception 'Assignment access denied' using errcode='42501';end if;
 perform 1 from public.jobs where id=c.job_id for update;
 select * into c from public.job_claims where id=c.id for update;
 select min(starts_at) into first_start from public.assignment_sessions where claim_id=c.id;
 if c.status<>'confirmed' or first_start is null or first_start<=clock_timestamp()
 or exists(select 1 from public.invoice_items where claim_id=c.id) then
  raise exception 'Started, cancelled or invoiced work requires separate review' using errcode='22023';
 end if;
 needs_review=first_start<clock_timestamp()+interval '168 hours';
 if needs_review and length(reason)<5 then raise exception 'A withdrawal reason is required' using errcode='22023';end if;
 select * into w from private.assignment_withdrawals where claim_id=c.id and status='pending' for update;
 if found then
  if w.reason<>reason then raise exception 'A withdrawal application is already pending' using errcode='22023';end if;
 else
  insert into private.assignment_withdrawals(claim_id,lecturer_id,status,reason,resolved_at)
   values(c.id,actor,case when needs_review then 'pending' else 'withdrawn' end,reason,
    case when not needs_review then clock_timestamp() end) returning * into w;
  if not needs_review then
   perform private.cancel_job_assignment_immediate(c.id,'Lecturer withdrawal: '||w.id::text,p_request_id);
  end if;
  insert into public.audit_events(actor_id,action,resource_id,details)
   values(actor,'assignment.withdrawal_'||w.status,w.id,jsonb_build_object('claim_id',c.id,'job_id',c.job_id));
  insert into public.notifications(user_id,kind,resource_id)
   values(actor,case when needs_review then 'assignment_withdrawal_requested' else 'assignment_withdrawal_withdrawn' end,w.id)
   on conflict do nothing;
  insert into public.notifications(user_id,kind,resource_id)
   select distinct p.id,case when needs_review then 'assignment_withdrawal_requested' else 'assignment_withdrawal_withdrawn' end,w.id
   from public.profiles p join public.user_roles r on r.user_id=p.id join public.role_permissions rp on rp.role=r.role
   where p.active and p.id<>actor and rp.permission='jobs.manage' on conflict do nothing;
 end if;
 insert into private.assignment_withdrawal_commands(actor_id,request_id,payload,withdrawal_id) values(actor,p_request_id,payload,w.id);
 return jsonb_build_object('id',w.id,'status',w.status);
end;$$;
create function public.request_assignment_withdrawal(p_claim_id uuid,p_reason text,p_request_id uuid) returns jsonb
language sql security invoker set search_path='' as $$select private.request_assignment_withdrawal(p_claim_id,p_reason,p_request_id);$$;

-- A current MFA-authorized manager decides once; the author cannot decide their
-- own application. Rejecting retains every reservation and accepted snapshot.
create function private.review_assignment_withdrawal(p_withdrawal_id uuid,p_approve boolean,p_reason text,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.job_claims;w private.assignment_withdrawals;prior private.assignment_withdrawal_commands;
 actor uuid:=auth.uid();decision_reason text:=trim(coalesce(p_reason,''));payload jsonb;
begin
 if not private.has_permission('jobs.manage') then raise exception 'Job management and MFA required' using errcode='42501';end if;
 perform 1 from public.profiles where id=actor and active for share;
 if not found or not private.has_permission('jobs.manage') then raise exception 'Job management and MFA required' using errcode='42501';end if;
 if p_withdrawal_id is null or p_request_id is null or p_approve is null or length(decision_reason) not between 5 and 1000 then raise exception 'A decision reason and request key are required' using errcode='22023';end if;
 payload=jsonb_build_object('action','review','withdrawal_id',p_withdrawal_id,'approve',p_approve,'reason',decision_reason);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('job-request:'||actor::text||p_request_id::text,0));
 select * into prior from private.assignment_withdrawal_commands where actor_id=actor and request_id=p_request_id;
 if found then
  if prior.payload<>payload then raise exception 'Withdrawal idempotency conflict' using errcode='22023';end if;
  select * into w from private.assignment_withdrawals where id=prior.withdrawal_id;
  return jsonb_build_object('id',w.id,'status',w.status);
 end if;
 select * into w from private.assignment_withdrawals where id=p_withdrawal_id;
 if w.id is null or w.lecturer_id=actor then raise exception 'Withdrawal review access denied' using errcode='42501';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(w.lecturer_id::text,0));
 select * into c from public.job_claims where id=w.claim_id;
 perform 1 from public.jobs where id=c.job_id for update;
 select * into c from public.job_claims where id=c.id for update;
 select * into w from private.assignment_withdrawals where id=p_withdrawal_id for update;
 if w.status<>'pending' or c.status<>'confirmed' then raise exception 'Withdrawal is no longer pending' using errcode='40001';end if;
 if coalesce((select min(starts_at) from public.assignment_sessions where claim_id=c.id),'-infinity'::timestamptz)<=clock_timestamp()
 or exists(select 1 from public.invoice_items where claim_id=c.id) then
  raise exception 'Started or invoiced work requires separate review' using errcode='22023';
 end if;
 if p_approve then
  perform private.cancel_job_assignment_immediate(c.id,'Approved withdrawal: '||w.id::text,p_request_id);
 end if;
 update private.assignment_withdrawals set status=case when p_approve then 'approved' else 'rejected' end,
  review_reason=decision_reason,reviewed_by=actor,resolved_at=clock_timestamp() where id=w.id returning * into w;
 insert into private.assignment_withdrawal_commands(actor_id,request_id,payload,withdrawal_id) values(actor,p_request_id,payload,w.id);
 insert into public.audit_events(actor_id,action,resource_id,details)
  values(actor,'assignment.withdrawal_'||w.status,w.id,jsonb_build_object('claim_id',c.id,'job_id',c.job_id));
 insert into public.notifications(user_id,kind,resource_id)
  values(w.lecturer_id,case when p_approve then 'assignment_withdrawal_approved' else 'assignment_withdrawal_rejected' end,w.id)
  on conflict do nothing;
 return jsonb_build_object('id',w.id,'status',w.status);
end;$$;
create function public.review_assignment_withdrawal(p_withdrawal_id uuid,p_approve boolean,p_reason text,p_request_id uuid) returns jsonb
language sql security invoker set search_path='' as $$select private.review_assignment_withdrawal(p_withdrawal_id,p_approve,p_reason,p_request_id);$$;

-- Preserve the complete existing lifecycle projection and financial redaction,
-- changing only the obsolete own short-notice cancellation capability.
alter function private.job_lifecycle(uuid) rename to job_lifecycle_before_withdrawals;
revoke all on function private.job_lifecycle_before_withdrawals(uuid) from public,anon,authenticated,service_role;
create function private.job_lifecycle(p_job_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 result=private.job_lifecycle_before_withdrawals(p_job_id);
 return jsonb_set(result,'{claims}',coalesce((select jsonb_agg(
  case when x->>'lecturer_id'=auth.uid()::text and exists(select 1 from public.assignment_sessions s
   where s.claim_id=(x->>'id')::uuid and s.starts_at<now()+interval '168 hours')
   then jsonb_set(x,'{can_cancel}','false'::jsonb) else x end)
  from jsonb_array_elements(result->'claims')x),'[]'::jsonb));
end;$$;
create or replace function public.job_lifecycle(p_job_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$select private.job_lifecycle(p_job_id);$$;

-- Resolve safe job links from current roles/ownership on every inbox read. No
-- request body is copied into notifications, external mail or push payloads.
alter function private.notification_target(text,uuid) rename to notification_target_before_withdrawals;
revoke all on function private.notification_target_before_withdrawals(text,uuid) from public,anon,authenticated,service_role;
create function private.notification_target(p_kind text,p_resource uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare target uuid;heading text;
begin
 if p_kind in('assignment_withdrawal_requested','assignment_withdrawal_approved','assignment_withdrawal_rejected','assignment_withdrawal_withdrawn') then
  select j.id,j.title into target,heading from private.assignment_withdrawals w
   join public.job_claims c on c.id=w.claim_id join public.jobs j on j.id=c.job_id
   where w.id=p_resource and private.actor_active()
    and (w.lecturer_id=auth.uid() or private.has_permission('jobs.manage')) and private.can_read_job(j.id);
  return jsonb_build_object('href',case when target is not null then '/jobs/'||target end,'title',coalesce(heading,''));
 end if;
 return private.notification_target_before_withdrawals(p_kind,p_resource);
end;$$;

revoke all on function private.supersede_assignment_withdrawals(),private.notification_target(text,uuid) from public,anon,authenticated,service_role;
revoke all on function private.cancel_job_assignment(uuid,text,uuid),private.job_lifecycle(uuid),
 private.assignment_withdrawals(uuid),public.assignment_withdrawals(uuid),
 private.request_assignment_withdrawal(uuid,text,uuid),public.request_assignment_withdrawal(uuid,text,uuid),
 private.review_assignment_withdrawal(uuid,boolean,text,uuid),public.review_assignment_withdrawal(uuid,boolean,text,uuid)
 from public,anon,authenticated,service_role;
grant execute on function private.cancel_job_assignment(uuid,text,uuid),private.job_lifecycle(uuid),
 private.assignment_withdrawals(uuid),public.assignment_withdrawals(uuid),
 private.request_assignment_withdrawal(uuid,text,uuid),public.request_assignment_withdrawal(uuid,text,uuid),
 private.review_assignment_withdrawal(uuid,boolean,text,uuid),public.review_assignment_withdrawal(uuid,boolean,text,uuid)
 to authenticated;

-- Substitution also releases the original assignment. Apply the same own
-- short-notice boundary to proposals/candidate lookup, preserving explicit
-- manager-initiated replacement of another lecturer's work.
-- This stable capability helper uses its transaction-time snapshot; the mutating
-- acceptance below checks actual post-lock time before any allocation release.
create or replace function private.check_substitution_claim(p_claim uuid) returns public.job_claims
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
 if c.lecturer_id=auth.uid() and (select min(starts_at) from public.assignment_sessions where claim_id=c.id)<now()+interval '168 hours' then
  raise exception 'Short-notice withdrawal requires a reviewed application' using errcode='22023';end if;
 return c;
end;$$;

-- Preserve the latest current-authority and immutable accepted-receipt behavior;
-- only proposer locking and the pending short-notice release guard are additive.
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
 perform 1 from public.profiles where id in(actor,original.lecturer_id,offer.proposed_by) order by id for share;
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
  -- Historical ownership does not retain a revoked lecturer capability.
  -- The profile lock above serializes this check with role/activation edits.
  if not private.lecturer_actor() then return jsonb_build_object('status','not_eligible');end if;
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
 -- A non-source proposer necessarily passed jobs.manage+MFA in the existing
 -- proposal RPC: immutable proposed_by is server-written and the table has no
 -- client INSERT grant. Recheck that manager's current authority, under their
 -- sorted profile lock above, before a short-notice transfer releases the source.
 -- An own lecturer proposal created earlier cannot become a withdrawal bypass
 -- when time passes into this window. Completed receipt retries returned above.
 if (select min(starts_at) from public.assignment_sessions where claim_id=original.id)<clock_timestamp()+interval '168 hours'
 and (offer.proposed_by=original.lecturer_id or not exists(
  select 1 from public.profiles p join public.user_roles ur on ur.user_id=p.id
   join public.role_permissions rp on rp.role=ur.role
   where p.id=offer.proposed_by and p.active and rp.permission='jobs.manage')) then
  raise exception 'Short-notice withdrawal requires a reviewed application' using errcode='22023';
 end if;
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

-- Apply the same boundary to the independent replacement marketplace,
-- retaining its actual consent, capacity, atomic handover and receipt behavior.
create or replace function private.request_replacement(p_claim_id uuid,p_reason text,p_mode text,p_invited_user_ids uuid[],p_emergency boolean,p_request_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare c public.job_claims; j public.jobs; prior private.replacement_requests; payload jsonb; result uuid; recipient uuid;
begin
 if not private.actor_active() then raise exception 'Active account required' using errcode='42501';end if;
 perform 1 from public.profiles where id=auth.uid() and active for share;
 if not found or not private.actor_active() then raise exception 'Active account required' using errcode='42501';end if;
 if p_request_id is null or p_reason is null or length(trim(p_reason)) not between 5 and 1000
 or p_mode is null or p_mode not in('open','selected') or p_invited_user_ids is null or p_emergency is null
 or cardinality(p_invited_user_ids)>50 or (p_mode='selected' and cardinality(p_invited_user_ids)=0)
 or (p_mode='open' and cardinality(p_invited_user_ids)<>0)
 or exists(select 1 from unnest(p_invited_user_ids) u where u is null)
 or cardinality(p_invited_user_ids)<>(select count(distinct u) from unnest(p_invited_user_ids)u) then raise exception 'Invalid replacement request' using errcode='22023';end if;
 payload=jsonb_build_object('action','request','claim',p_claim_id,'reason',trim(p_reason),'mode',p_mode,'invited',p_invited_user_ids,'emergency',p_emergency);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('replacement:'||auth.uid()::text||p_request_id::text,0));
 select * into c from public.job_claims where id=p_claim_id;
 if c.id is null or not (c.lecturer_id=auth.uid() and private.lecturer_actor() or private.has_permission('jobs.manage')) then raise exception 'Assignment access denied' using errcode='42501';end if;
 select * into prior from private.replacement_requests where actor_id=auth.uid() and request_id=p_request_id;
 if found then if prior.payload<>payload then raise exception 'Replacement idempotency conflict' using errcode='22023';end if;return (prior.result->>'id')::uuid;end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(c.lecturer_id::text,0));
 select * into j from public.jobs where id=c.job_id for update;
 select * into c from public.job_claims where id=p_claim_id for update;
 if c.status<>'confirmed' or j.status='archived' or exists(select 1 from public.invoice_items where claim_id=c.id)
 or not exists(select 1 from public.job_sessions where job_id=j.id)
 or exists(select 1 from public.job_sessions where job_id=j.id and starts_at<=clock_timestamp()) then raise exception 'Started or invoiced work requires management amendment' using errcode='22023';end if;
 -- Opening a marketplace offer is also an attempt to release this lecturer's
 -- claim. A current manager may still organise another lecturer's replacement.
 if c.lecturer_id=auth.uid() and (select min(starts_at) from public.assignment_sessions where claim_id=c.id)<clock_timestamp()+interval '168 hours' then
  raise exception 'Short-notice withdrawal requires a reviewed application' using errcode='22023';end if;
 if exists(select 1 from private.replacement_offers where original_claim_id=c.id and status='open') then raise exception 'Replacement already open' using errcode='22023';end if;
 if exists(select 1 from unnest(p_invited_user_ids) u where u=c.lecturer_id or not private.lecturer_user(u)) then raise exception 'Invalid invited lecturer' using errcode='22023';end if;
 insert into private.replacement_offers(original_claim_id,requested_by,reason,mode,invited_user_ids,emergency,job_version)
 values(c.id,auth.uid(),trim(p_reason),p_mode,p_invited_user_ids,p_emergency,j.lifecycle_version) returning id into result;
 if p_mode='selected' and exists(select 1 from unnest(p_invited_user_ids) u where not private.replacement_eligible(result,u)) then raise exception 'Invited lecturer is not currently eligible' using errcode='22023';end if;
 insert into public.audit_events(actor_id,action,resource_id,details) values(auth.uid(),'replacement.opened',result,jsonb_build_object('claim_id',c.id,'mode',p_mode));
 for recipient in select p.id from public.profiles p where private.replacement_eligible(result,p.id) loop
  insert into public.notifications(user_id,kind,resource_id) values(recipient,'replacement_available',result) on conflict do nothing;
 end loop;
 insert into private.replacement_requests values(auth.uid(),p_request_id,payload,jsonb_build_object('id',result));return result;
end;$$;

create or replace function private.claim_replacement(p_offer_id uuid,p_expected_version integer,p_terms_version integer,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o private.replacement_offers; c public.job_claims; j public.jobs; prior private.replacement_requests; payload jsonb; result jsonb; target uuid; room record;
begin
 if not private.actor_active() then raise exception 'Active account required' using errcode='42501';end if;
 if not private.lecturer_actor() then return jsonb_build_object('status','not_eligible');end if;
 if p_request_id is null or p_expected_version is null or p_terms_version is null then raise exception 'Invalid replacement request' using errcode='22023';end if;
 payload=jsonb_build_object('action','claim','offer',p_offer_id,'version',p_expected_version,'terms_version',p_terms_version);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('replacement:'||auth.uid()::text||p_request_id::text,0));
 -- A request-gate wait may outlive suspension or role withdrawal. Hold the
 -- current profile before disclosing a retained receipt or beginning handover;
 -- administrative role/status mutations serialize on this same row.
 perform 1 from public.profiles where id=auth.uid() and active for share;
 if not found or not private.actor_active() then raise exception 'Active account required' using errcode='42501';end if;
 if not private.lecturer_actor() then return jsonb_build_object('status','not_eligible');end if;
 select * into prior from private.replacement_requests where actor_id=auth.uid() and request_id=p_request_id;
 if found then
  if prior.payload<>payload then raise exception 'Replacement idempotency conflict' using errcode='22023';end if;
  select * into c from public.job_claims where id=(prior.result->>'claim_id')::uuid and lecturer_id=auth.uid();
  return jsonb_set(prior.result,'{status}',to_jsonb(coalesce(c.status,'unavailable')));
 end if;
 select claimed.* into c from public.job_claims claimed join private.replacement_offers r on r.original_claim_id=claimed.id where r.id=p_offer_id;
 if c.id is null then return jsonb_build_object('status','unavailable');end if;
 -- The immutable server-written requested_by differs from the source only
 -- when the original request RPC enforced management and MFA. Lock that profile
 -- with the source/recipient before business locks, then recheck current authority.
 select * into o from private.replacement_offers where id=p_offer_id;
 -- Consistent sorted profile/lecturer locks, then job, claim, offer, room.
 perform 1 from public.profiles where id in(auth.uid(),c.lecturer_id,o.requested_by) order by id for share;
 for target in select id from public.profiles where id in(auth.uid(),c.lecturer_id) order by id loop
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target::text,0));
 end loop;
 select * into j from public.jobs where id=c.job_id for update;
 select * into c from public.job_claims where id=c.id for update;
 select * into o from private.replacement_offers where id=p_offer_id for update;
 -- A transaction may have started before teaching and waited on these locks.
 -- Actual post-wait time, rather than its old transaction timestamp, decides.
 if exists(select 1 from public.job_sessions where job_id=j.id and starts_at<=clock_timestamp()) then return jsonb_build_object('status','unavailable');end if;
 if o.status<>'open' or o.version<>p_expected_version then return jsonb_build_object('status','unavailable');end if;
 -- A source-created offer that ages into the protected window cannot
 -- bypass the withdrawal decision. Already committed receipts returned above.
 if (select min(starts_at) from public.assignment_sessions where claim_id=c.id)<clock_timestamp()+interval '168 hours'
 and (o.requested_by=c.lecturer_id or not exists(
  select 1 from public.profiles p join public.user_roles ur on ur.user_id=p.id
   join public.role_permissions rp on rp.role=ur.role
   where p.id=o.requested_by and p.active and rp.permission='jobs.manage')) then
  raise exception 'Short-notice withdrawal requires a reviewed application' using errcode='22023';end if;
 if not private.replacement_eligible(o.id,auth.uid()) then return jsonb_build_object('status','not_eligible');end if;
 if private.replacement_quote(j.id) is null then return jsonb_build_object('status','prerequisite_missing');end if;
 if (private.replacement_quote(j.id)->>'terms_version')::integer<>p_terms_version then return jsonb_build_object('status','terms_changed');end if;
 begin
  -- Any rejection below raises into this subtransaction: the original remains
  -- confirmed with every allocation and chat membership exactly as before.
  update public.job_claims set status='cancelled' where id=c.id;
  update public.assignment_sessions set released_at=clock_timestamp() where claim_id=c.id and released_at is null;
  -- The original vacancy's deadline governed its original claim. This new
  -- authorised replacement remains valid until teaching starts; never publish
  -- a claimable-looking offer that its old recruitment deadline always rejects.
  update public.jobs set status='published',claim_deadline=null where id=j.id;
  result=private.claim_job(j.id,p_request_id,p_terms_version);
  if result->>'status'<>'confirmed' then raise exception using errcode='PZ001',message='Replacement handover rejected',detail=result::text;end if;
  if (result->>'claim_id')::uuid=c.id or not exists(select 1 from public.job_claims where id=(result->>'claim_id')::uuid and lecturer_id=auth.uid() and job_id=j.id and status='confirmed') then result=jsonb_build_object('status','idempotency_conflict');raise exception using errcode='PZ001',message='Invalid replacement confirmation';end if;
  -- A personal replacement does not authorise reopening another paused slot.
  if j.status='draft' then update public.jobs set status='draft',claim_deadline=j.claim_deadline where id=j.id;
  elsif j.claim_deadline is not null then update public.jobs set claim_deadline=j.claim_deadline where id=j.id;end if;
  -- Participant rooms belong to a run and have no job_id. Transfer both room
  -- kinds in the room-before-member order used by membership management.
  -- Another accepted assignment or genuine enrolment retains its own rights;
  -- the cancelled source claim itself never keeps participant-room access.
  for room in select r.id,r.kind,r.owner_id from public.chat_rooms r where
   (r.job_id=j.id and r.kind='lecturer_course')
   or (j.course_run_id is not null and r.course_run_id=j.course_run_id and r.kind='participant_course')
   order by r.id for update loop
   if room.kind='lecturer_course' or (
    not exists(select 1 from public.jobs other join public.job_claims retained on retained.job_id=other.id
     where other.course_run_id=j.course_run_id and retained.lecturer_id=c.lecturer_id and retained.status='confirmed')
    and not exists(select 1 from public.course_enrolments e where e.course_run_id=j.course_run_id
     and e.user_id=c.lecturer_id and e.status in('enrolled','completed'))) then
    update public.chat_members set removed_at=clock_timestamp()
     where room_id=room.id and user_id=c.lecturer_id and removed_at is null;
   end if;
   insert into public.chat_members(room_id,user_id) values(room.id,auth.uid())
    on conflict(room_id,user_id) do update set removed_at=null,joined_at=clock_timestamp();
   if room.owner_id=c.lecturer_id then update public.chat_rooms set owner_id=auth.uid() where id=room.id;end if;
  end loop;
  insert into public.claim_events(claim_id,actor_id,event_type) values(c.id,auth.uid(),'cancelled');
  insert into public.audit_events(actor_id,action,resource_id,details) values(auth.uid(),'replacement.completed',o.id,jsonb_build_object('original_claim_id',c.id,'replacement_claim_id',result->>'claim_id'));
  insert into public.notifications(user_id,kind,resource_id) values(c.lecturer_id,'replacement_completed',o.id) on conflict do nothing;
  update private.replacement_offers set status='completed',version=version+1,replacement_claim_id=(result->>'claim_id')::uuid,completed_at=clock_timestamp() where id=o.id;
  insert into private.replacement_requests values(auth.uid(),p_request_id,payload,result);
  return result;
 exception when sqlstate 'PZ001' then
  -- Nested business/trigger failures must never reuse an earlier confirmed
  -- variable after the subtransaction rolled every write back.
  if result->>'status'='confirmed' then raise;end if;
  return coalesce(result,jsonb_build_object('status','unavailable'));
 end;
end;$$;

create or replace function private.replacement_assignments() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.actor_active() then raise exception 'Active account required' using errcode='42501';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('claim_id',c.id,'job_id',j.id,'title',j.title,'lecturer',p.display_name)
  order by j.title,c.id) from public.job_claims c join public.jobs j on j.id=c.job_id join public.profiles p on p.id=c.lecturer_id
  where c.status='confirmed' and (c.lecturer_id=auth.uid() or private.has_permission('jobs.manage'))
  and (c.lecturer_id<>auth.uid() or (select min(starts_at) from public.assignment_sessions where claim_id=c.id)>=now()+interval '168 hours')
  and not exists(select 1 from public.invoice_items where claim_id=c.id)
  and exists(select 1 from public.job_sessions where job_id=j.id)
  and not exists(select 1 from public.job_sessions where job_id=j.id and starts_at<=now())
  and not exists(select 1 from private.replacement_offers where original_claim_id=c.id and status='open')),'[]'::jsonb);
end;$$;

commit;
