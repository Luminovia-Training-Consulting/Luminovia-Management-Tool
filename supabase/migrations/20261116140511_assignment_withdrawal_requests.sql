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

commit;
