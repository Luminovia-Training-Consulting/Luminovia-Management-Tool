begin;
-- A financial reviewer can release an assignment only after every historical
-- invoice was explicitly rejected/cancelled and all payments were voided by
-- the existing financial workflows. This record is evidence, not a credit note.
create table private.company_rejection_finance_resolutions (
 claim_id uuid primary key references public.job_claims(id),
 reviewer_id uuid not null references public.profiles(id),
 note text not null check (length(btrim(note)) between 10 and 1000),
 resolved_at timestamptz not null default clock_timestamp()
);
alter table private.company_rejection_finance_resolutions enable row level security;
revoke all on private.company_rejection_finance_resolutions from public,anon,authenticated,service_role;

-- Rejected/cancelled invoices retain immutable items. Prevent an old invoice
-- from being reactivated for a cancelled claim through the existing review API.
create function private.invoice_item_requires_confirmed_claim() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.active and not exists(select 1 from public.job_claims c where c.id=new.claim_id and c.status='confirmed') then
  raise exception 'Only confirmed assignments may have an active invoice' using errcode='22023';
 end if;
 return new;
end;$$;
create trigger invoice_item_active_claim before insert or update of active,claim_id on public.invoice_items
for each row execute function private.invoice_item_requires_confirmed_claim();
revoke all on function private.invoice_item_requires_confirmed_claim() from public,anon,authenticated,service_role;

-- Keep the shared cancellation routine and its chat, notification and audit
-- semantics. A private resolution record, current MFA finance permission and a
-- pending company request are all required for this one controlled exception.
do $migration$
declare source text; patched text; previous text;
begin
 select pg_catalog.pg_get_functiondef('private.cancel_job_assignment_before_chat_origins(uuid,text,uuid)'::regprocedure) into source;
 previous := $$private.deletion_can_manage_job(c.job_id) and exists(select 1 from private.company_lecturer_decisions d where d.claim_id=c.id and d.decision='rejected')$$;
 patched := replace(source,previous,previous || $$ or (private.has_permission('finance.manage') and exists(select 1 from private.company_rejection_finance_resolutions f join private.company_lecturer_decisions d on d.claim_id=f.claim_id where f.claim_id=c.id and f.reviewer_id=auth.uid() and d.decision='review_required'))$$);
 if patched=source then raise exception 'Unexpected cancellation authority';end if;
 source:=patched;
 previous := $$if exists(select 1 from public.invoice_items where claim_id=c.id) then raise exception 'Invoiced work requires financial review' using errcode='22023';end if;$$;
 patched:=replace(source,previous,$$if exists(select 1 from public.invoice_items where claim_id=c.id) and not (private.has_permission('finance.manage') and exists(select 1 from private.company_rejection_finance_resolutions f join private.company_lecturer_decisions d on d.claim_id=f.claim_id where f.claim_id=c.id and f.reviewer_id=auth.uid() and d.decision='review_required')) then raise exception 'Invoiced work requires financial review' using errcode='22023';end if;$$);
 if patched=source then raise exception 'Unexpected cancellation financial guard';end if;
 execute patched;
end;$migration$;

-- Rejecting a future assignment also works on a draft or archived job. Preserve
-- its prior visibility rather than publishing it as a side effect.
do $migration$
declare source text; patched text; previous text;
begin
 select pg_catalog.pg_get_functiondef('private.decide_company_lecturer(uuid,text)'::regprocedure) into source;
 previous:=$$if j.status not in ('published','filled') then raise exception 'Inactive offer requires management review' using errcode='22023';end if;$$;
 patched:=replace(source,previous,'');
 if patched=source then raise exception 'Unexpected company decision status guard';end if;
 source:=patched;
 previous:=$$update public.jobs set status='published',claim_deadline=case when claim_deadline<=clock_timestamp() then null else claim_deadline end where id=j.id;$$;
 patched:=replace(source,previous,$$update public.jobs set status=case when j.status in ('published','filled') then 'published' else j.status end,claim_deadline=case when j.status in ('published','filled') and claim_deadline<=clock_timestamp() then null else claim_deadline end where id=j.id;$$);
 if patched=source then raise exception 'Unexpected company decision publication';end if;
 execute patched;
end;$migration$;

create function private.resolve_company_invoice_rejection(p_claim uuid,p_note text) returns void
language plpgsql security definer set search_path='' as $$
declare c public.job_claims; j public.jobs; current_decision text;
begin
 if not private.has_permission('finance.manage') then raise exception 'Finance management and MFA required' using errcode='42501';end if;
 if p_note is null or length(btrim(p_note)) not between 10 and 1000 then raise exception 'Review note required' using errcode='22023';end if;
 select * into c from public.job_claims where id=p_claim;
 if c.id is null then raise exception 'Pending review required' using errcode='22023';end if;
 perform 1 from public.profiles where id=auth.uid() and active for share;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(c.lecturer_id::text,0));
 select * into j from public.jobs where id=c.job_id for update;
 select * into c from public.job_claims where id=p_claim for update;
 select decision into current_decision from private.company_lecturer_decisions where claim_id=p_claim for update;
 if current_decision='rejected' and c.status='cancelled' and exists(select 1 from private.company_rejection_finance_resolutions where claim_id=p_claim) then return; end if;
 if current_decision is distinct from 'review_required' or c.status<>'confirmed' then raise exception 'Pending review required' using errcode='22023';end if;
 if not exists(select 1 from public.assignment_sessions where claim_id=p_claim and released_at is null)
 or exists(select 1 from public.assignment_sessions where claim_id=p_claim and released_at is null and starts_at<=clock_timestamp()) then
  raise exception 'Started or inactive assignment requires separate review' using errcode='22023';end if;
 -- Lock every invoice so review/payment changes cannot race this decision.
 perform 1 from public.invoices i join public.invoice_items item on item.invoice_id=i.id where item.claim_id=p_claim order by i.id for update of i;
 if not exists(select 1 from public.invoice_items where claim_id=p_claim)
 or exists(select 1 from public.invoice_items item join public.invoices i on i.id=item.invoice_id where item.claim_id=p_claim and (item.active or i.status not in ('rejected','cancelled') or exists(select 1 from public.payment_records p where p.invoice_id=i.id and p.voided_at is null))) then
  raise exception 'Reject or cancel every invoice and resolve active payments first' using errcode='22023';end if;
 insert into private.company_rejection_finance_resolutions(claim_id,reviewer_id,note) values(p_claim,auth.uid(),btrim(p_note));
 perform private.cancel_job_assignment_immediate(p_claim,'Company rejection after financial review',pg_catalog.gen_random_uuid());
 update private.company_lecturer_decisions set decision='rejected' where claim_id=p_claim;
 update public.jobs set status=case when j.status in ('published','filled') then 'published' else j.status end,claim_deadline=case when j.status in ('published','filled') and claim_deadline<=clock_timestamp() then null else claim_deadline end where id=j.id;
 insert into public.audit_events(actor_id,action,resource_id,details) values(auth.uid(),'company.rejection_finance_resolved',p_claim,jsonb_build_object('job_id',j.id,'note',btrim(p_note)));
end;$$;
create function public.resolve_company_invoice_rejection(p_claim uuid,p_note text) returns void
language sql security invoker set search_path='' as $$select private.resolve_company_invoice_rejection(p_claim,p_note);$$;
revoke all on function private.resolve_company_invoice_rejection(uuid,text),public.resolve_company_invoice_rejection(uuid,text) from public,anon,authenticated,service_role;
grant execute on function private.resolve_company_invoice_rejection(uuid,text),public.resolve_company_invoice_rejection(uuid,text) to authenticated;
commit;
