begin;

-- The lecturer's claim remains immediately confirmed; a company decision is a
-- separate, per-claim record. An absent explicit decision becomes accepted at
-- the database-calculated 72-hour deadline, without requiring a running worker.
create table private.company_lecturer_decisions (
 claim_id uuid primary key references public.job_claims(id) on delete cascade,
 decision text not null check (decision in ('accepted','rejected','review_required')),
 decided_by uuid not null references public.profiles(id),
 decided_at timestamptz not null default clock_timestamp()
);
alter table private.company_lecturer_decisions enable row level security;
revoke all on private.company_lecturer_decisions from public,anon,authenticated,service_role;

-- Allow the existing cancellation core to run only while the company has
-- inserted its own rejected decision in this same transaction. The table is
-- private and the row cannot commit while the claim remains confirmed. Other
-- public callers therefore cannot use this narrow capability to cancel work.
do $migration$
declare source text; patched text;
begin
 if (select pg_catalog.md5(p.prosrc) from pg_catalog.pg_proc p where p.oid='private.cancel_job_assignment_before_chat_origins(uuid,text,uuid)'::regprocedure) <> '9ef9790c2ae4e7eb3fdf9ce6b75f76c3' then raise exception 'Unexpected assignment cancellation implementation';end if;
 select pg_catalog.pg_get_functiondef('private.cancel_job_assignment_before_chat_origins(uuid,text,uuid)'::regprocedure) into source;
 patched=replace(source,
  $$c.lecturer_id=auth.uid() and private.lecturer_actor() or private.has_permission('jobs.manage')$$,
  $$c.lecturer_id=auth.uid() and private.lecturer_actor() or private.has_permission('jobs.manage') or (private.deletion_can_manage_job(c.job_id) and exists(select 1 from private.company_lecturer_decisions d where d.claim_id=c.id and d.decision='rejected'))$$);
 if patched=source then raise exception 'Unexpected assignment cancellation implementation';end if;
 execute patched;
end;$migration$;

create function private.company_lecturer_decisions(p_job_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not private.deletion_can_manage_job(p_job_id) then raise exception 'Organisation access required' using errcode='42501';end if;
 return coalesce((select jsonb_agg(jsonb_build_object(
  'claim_id',c.id,'lecturer_id',c.lecturer_id,'lecturer_name',p.display_name,
  'status',coalesce(d.decision,case when c.created_at+interval '72 hours'<=statement_timestamp() then 'auto_accepted' else 'pending' end),
  'deadline',c.created_at+interval '72 hours',
  'can_reject',(select min(s.starts_at) from public.assignment_sessions s where s.claim_id=c.id and s.released_at is null)>statement_timestamp()
 ) order by c.created_at,c.id)
 from public.job_claims c join public.profiles p on p.id=c.lecturer_id
 left join private.company_lecturer_decisions d on d.claim_id=c.id
 where c.job_id=p_job_id and c.status='confirmed'),'[]'::jsonb);
end;$$;
create function public.company_lecturer_decisions(p_job_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$select private.company_lecturer_decisions(p_job_id);$$;

create function private.decide_company_lecturer(p_claim_id uuid,p_decision text) returns void
language plpgsql security definer set search_path='' as $$
declare c public.job_claims; j public.jobs; first_start timestamptz;
begin
 if not private.actor_active() or p_decision is null or p_decision not in ('accepted','rejected') then raise exception 'Invalid decision' using errcode='42501';end if;
 select * into c from public.job_claims where id=p_claim_id;
 if c.id is null or not private.deletion_can_manage_job(c.job_id) then raise exception 'Organisation access required' using errcode='42501';end if;
 -- The existing claim/cancellation paths acquire the person lock before job.
 perform 1 from public.profiles where id=auth.uid() and active for share;
 if not found then raise exception 'Authentication required' using errcode='42501';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(c.lecturer_id::text,0));
 select * into j from public.jobs where id=c.job_id for update;
 select * into c from public.job_claims where id=p_claim_id for update;
 if not private.deletion_can_manage_job(c.job_id) then raise exception 'Organisation access required' using errcode='42501';end if;
 if exists(select 1 from private.company_lecturer_decisions where claim_id=c.id and decision=p_decision) then return;end if;
 if p_decision='accepted' and exists(select 1 from private.company_lecturer_decisions where claim_id=c.id and decision='review_required') then raise exception 'Finance review is pending' using errcode='22023';end if;
 if c.status<>'confirmed' then raise exception 'Assignment no longer active' using errcode='22023';end if;
 if p_decision='rejected' then
  select min(starts_at) into first_start from public.assignment_sessions where claim_id=c.id and released_at is null;
  if first_start is null or first_start<=clock_timestamp() then raise exception 'Started work cannot be released' using errcode='22023';end if;
  -- Do not undo an invoice or free any allocation when billing already exists.
  -- The job/claim locks serialize this check with invoice submission.
  if exists(select 1 from public.invoice_items where claim_id=c.id) then
   if exists(select 1 from private.company_lecturer_decisions where claim_id=c.id and decision='review_required') then return;end if;
   insert into private.company_lecturer_decisions(claim_id,decision,decided_by) values(c.id,'review_required',auth.uid())
   on conflict(claim_id) do update set decision='review_required',decided_by=excluded.decided_by,decided_at=clock_timestamp();
   insert into public.audit_events(actor_id,action,resource_id,details) values(auth.uid(),'company.lecturer_rejection_finance_review',c.id,jsonb_build_object('job_id',j.id));
   return;
  end if;
  if j.status not in ('published','filled') then raise exception 'Inactive offer requires management review' using errcode='22023';end if;
  -- The existing transactional cancellation owns financial checks, participant
  -- and lecturer chat origins, events, notifications and immutable snapshots.
  -- Inserting the private decision first grants only this transaction authority.
  insert into private.company_lecturer_decisions(claim_id,decision,decided_by) values(c.id,'rejected',auth.uid())
  on conflict(claim_id) do update set decision='rejected',decided_by=excluded.decided_by,decided_at=clock_timestamp();
  perform private.cancel_job_assignment_immediate(c.id,'Company rejected lecturer',pg_catalog.gen_random_uuid());
  -- The cancelled capacity must be claimable again. A past offer deadline
  -- otherwise silently prevents any replacement despite published status.
  update public.jobs set status='published',claim_deadline=case when claim_deadline<=clock_timestamp() then null else claim_deadline end where id=j.id;
 end if;
 insert into private.company_lecturer_decisions(claim_id,decision,decided_by) values(c.id,p_decision,auth.uid())
 on conflict(claim_id) do update set decision=excluded.decision,decided_by=excluded.decided_by,decided_at=clock_timestamp();
 insert into public.audit_events(actor_id,action,resource_id,details) values(auth.uid(),'company.lecturer_'||p_decision,c.id,jsonb_build_object('job_id',j.id,'expired_claim_deadline_cleared',p_decision='rejected' and j.claim_deadline is not null and j.claim_deadline<=clock_timestamp()));
end;$$;
-- Finance managers see only the minimum assignment/invoice data needed to
-- investigate a company rejection. The pending request stays visible until
-- the existing financial and assignment workflows resolve the situation.
create function private.company_invoice_reviews() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not private.has_permission('finance.manage') then raise exception 'Finance management and MFA required' using errcode='42501';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('claim_id',c.id,'job_id',j.id,'job_title',j.title,'lecturer_name',p.display_name,'requested_at',d.decided_at,'invoices',
  (select coalesce(jsonb_agg(jsonb_build_object('number',i.number,'status',i.status) order by i.created_at,i.id),'[]'::jsonb) from public.invoice_items item join public.invoices i on i.id=item.invoice_id where item.claim_id=c.id)) order by d.decided_at,c.id)
  from private.company_lecturer_decisions d join public.job_claims c on c.id=d.claim_id join public.jobs j on j.id=c.job_id join public.profiles p on p.id=c.lecturer_id where d.decision='review_required'),'[]'::jsonb);
end;$$;
create function public.company_invoice_reviews() returns jsonb language sql stable security invoker set search_path='' as $$select private.company_invoice_reviews();$$;
revoke all on function private.company_invoice_reviews(),public.company_invoice_reviews() from public,anon,authenticated,service_role;
grant execute on function private.company_invoice_reviews(),public.company_invoice_reviews() to authenticated;

create function public.decide_company_lecturer(p_claim_id uuid,p_decision text) returns void
language sql security invoker set search_path='' as $$select private.decide_company_lecturer(p_claim_id,p_decision);$$;
revoke all on function private.company_lecturer_decisions(uuid),public.company_lecturer_decisions(uuid),private.decide_company_lecturer(uuid,text),public.decide_company_lecturer(uuid,text) from public,anon,authenticated,service_role;
grant execute on function private.company_lecturer_decisions(uuid),public.company_lecturer_decisions(uuid),private.decide_company_lecturer(uuid,text),public.decide_company_lecturer(uuid,text) to authenticated;
commit;
