begin;
insert into public.role_permissions(role,permission) values('admin','contracts.manage'),('management','contracts.manage'),('admin','finance.manage'),('management','finance.manage') on conflict do nothing;
alter table public.contracts add column title text not null default '' check(length(title)<=200);
alter table public.contracts add column kind text not null default 'master' check(kind in ('master','addendum'));
alter table public.contracts add column parent_contract_id uuid references public.contracts(id);
alter table public.contracts add column document_version_id uuid references public.document_versions(id);
alter table public.contracts add column document_sha256 text check(document_sha256 is null or document_sha256~'^[a-f0-9]{64}$');
alter table public.contracts add column registered_by uuid references public.profiles(id);
alter table public.contracts add column client_id uuid;
alter table public.contracts add column created_at timestamptz not null default clock_timestamp();
alter table public.contracts add column revoked_at timestamptz;
alter table public.contracts add constraint contract_version_file_pair check((document_version_id is null)=(document_sha256 is null));
alter table public.contracts add constraint contract_parent_kind check((kind='addendum')=(parent_contract_id is not null));
alter table public.contracts add constraint contract_client_request unique(registered_by,client_id);
create table public.contract_acceptances (
 id uuid primary key default gen_random_uuid(),contract_id uuid not null references public.contracts(id),user_id uuid not null references public.profiles(id),
 document_sha256 text not null,kind text not null default 'receipt_acknowledgement' check(kind='receipt_acknowledgement'),
 client_id uuid not null,created_at timestamptz not null default clock_timestamp(),unique(contract_id,user_id),unique(user_id,client_id)
);
-- These rows record externally executed agreements. A portal receipt acknowledgement
-- is not an electronic signature and does not assert legal enforceability.
create function private.immutable_contract_version() returns trigger language plpgsql set search_path='' as $$
begin
 if (to_jsonb(new)-'status'-'revoked_at') is distinct from (to_jsonb(old)-'status'-'revoked_at') then raise exception 'Executed contract versions are immutable; register a new version' using errcode='23514';end if;
 return new;
end;$$;
create trigger contract_snapshot_immutable before update on public.contracts for each row execute function private.immutable_contract_version();

create table public.invoices (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles(id),number text not null check(length(trim(number)) between 1 and 80),
 issued_on date not null,due_on date not null check(due_on>=issued_on),currency text not null check(currency in ('EUR','AUD')),total_amount numeric(12,2) not null check(total_amount>0),
 document_version_id uuid not null references public.document_versions(id),status text not null default 'submitted' check(status in ('submitted','approved','paid','rejected','cancelled')),
 note text not null default '' check(length(note)<=2000),client_id uuid not null,created_at timestamptz not null default clock_timestamp(),
 reviewed_by uuid references public.profiles(id),reviewed_at timestamptz,unique(user_id,number),unique(user_id,client_id)
);
create table public.invoice_items (
 invoice_id uuid not null references public.invoices(id),claim_id uuid not null references public.job_claims(id),active boolean not null default true,
 primary key(invoice_id,claim_id)
);
create unique index one_active_invoice_per_claim on public.invoice_items(claim_id) where active;
create table public.payment_records (
 id uuid primary key default gen_random_uuid(),invoice_id uuid not null references public.invoices(id),amount numeric(12,2) not null check(amount>0),currency text not null check(currency in ('EUR','AUD')),
 paid_at timestamptz not null,reference text not null default '' check(length(reference)<=200),recorded_by uuid not null references public.profiles(id),client_id uuid not null,
 created_at timestamptz not null default clock_timestamp(),voided_at timestamptz,voided_by uuid references public.profiles(id),void_reason text,
 unique(recorded_by,client_id),check((voided_at is null)=(voided_by is null))
);
create index invoice_owner_created on public.invoices(user_id,created_at desc);
create index invoice_items_invoice on public.invoice_items(invoice_id);
create index payments_invoice on public.payment_records(invoice_id) where voided_at is null;
create index contract_acceptance_user on public.contract_acceptances(user_id,created_at desc);
create function private.can_read_invoice(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.actor_active() and exists(select 1 from public.invoices i where i.id=p_id and (i.user_id=auth.uid() or private.has_permission('finance.manage')));
$$;

do $$declare t text;begin
 foreach t in array array['contract_acceptances','invoices','invoice_items','payment_records'] loop
  execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from anon,authenticated',t);execute format('grant select on public.%I to authenticated',t);execute format('grant all on public.%I to service_role',t);
 end loop;
end;$$;
create policy contract_acceptance_read on public.contract_acceptances for select to authenticated using((select private.actor_active()) and (user_id=(select auth.uid()) or (select private.has_permission('contracts.read')) or (select private.has_permission('contracts.manage'))));
create policy invoice_read on public.invoices for select to authenticated using(private.can_read_invoice(id));
create policy invoice_items_read on public.invoice_items for select to authenticated using(private.can_read_invoice(invoice_id));
create policy payments_read on public.payment_records for select to authenticated using(private.can_read_invoice(invoice_id));

-- Documents used as executed-contract/invoice evidence retain their exact old binary
-- version. Replacing the current document is allowed; hiding or mutating the linked
-- historical evidence through ordinary file operations is not.
create function private.protect_commercial_document() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.deleted_at is null and new.deleted_at is not null and
 (exists(select 1 from public.document_versions v join public.contracts c on c.document_version_id=v.id where v.document_id=old.id)
 or exists(select 1 from public.document_versions v join public.invoices i on i.document_version_id=v.id where v.document_id=old.id)) then raise exception 'This file is retained by a contract or invoice record' using errcode='23514';end if;
 return new;
end;$$;
create trigger retained_commercial_document before update on public.documents for each row execute function private.protect_commercial_document();
create function private.protect_commercial_version() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if to_jsonb(new) is distinct from to_jsonb(old) and (exists(select 1 from public.contracts where document_version_id=old.id) or exists(select 1 from public.invoices where document_version_id=old.id)) then raise exception 'Linked commercial file versions are immutable' using errcode='23514';end if;
 return new;
end;$$;
create trigger retained_commercial_version before update on public.document_versions for each row execute function private.protect_commercial_version();

create function private.commercial_access() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('can_manage_contracts',private.has_permission('contracts.manage'),'can_manage_finance',private.has_permission('finance.manage'),'can_submit_invoice',private.has_role(array['lecturer','senior_lecturer']));
$$;
create function public.commercial_access() returns jsonb language sql stable security invoker set search_path='' as $$ select private.commercial_access(); $$;
create function private.commercial_people() returns table(id uuid,display_name text) language sql stable security definer set search_path='' as $$
 select p.id,p.display_name from public.profiles p where private.actor_active() and ((p.id=auth.uid()) or ((private.has_permission('contracts.manage') or private.has_permission('finance.manage') or private.has_permission('contracts.read')) and p.active and exists(select 1 from public.user_roles r where r.user_id=p.id and r.role in ('lecturer','senior_lecturer')))) order by p.display_name,p.id;
$$;
create function public.commercial_people() returns table(id uuid,display_name text) language sql stable security invoker set search_path='' as $$ select * from private.commercial_people(); $$;
create function private.contract_records(p_all boolean default false)
returns table(id uuid,user_id uuid,user_name text,title text,kind text,parent_contract_id uuid,status text,effective_from timestamptz,expires_at timestamptz,version int,document_version_id uuid,document_id uuid,sha256 text,acknowledged_at timestamptz,created_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
begin
 if not private.actor_active() then raise exception 'Active login required' using errcode='42501';end if;
 if p_all and not (private.has_permission('contracts.manage') or private.has_permission('contracts.read')) then raise exception 'Contract management and MFA required' using errcode='42501';end if;
 return query select c.id,c.user_id,p.display_name,c.title,c.kind,c.parent_contract_id,c.status,c.effective_from,c.expires_at,c.version,c.document_version_id,v.document_id,c.document_sha256,
 (select min(a.created_at) from public.contract_acceptances a where a.contract_id=c.id and a.user_id=c.user_id),c.created_at
 from public.contracts c join public.profiles p on p.id=c.user_id left join public.document_versions v on v.id=c.document_version_id where p_all or c.user_id=auth.uid() order by c.created_at desc,c.version desc;
end;$$;
create function public.contract_records(p_all boolean default false)
returns table(id uuid,user_id uuid,user_name text,title text,kind text,parent_contract_id uuid,status text,effective_from timestamptz,expires_at timestamptz,version int,document_version_id uuid,document_id uuid,sha256 text,acknowledged_at timestamptz,created_at timestamptz)
language sql stable security invoker set search_path='' as $$ select * from private.contract_records(p_all); $$;
create function private.register_executed_contract(p_user_id uuid,p_title text,p_document_version_id uuid,p_effective_from timestamptz,p_expires_at timestamptz,p_kind text default 'master',p_parent_id uuid default null,p_client_id uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare version public.document_versions; document public.documents; previous public.contracts; result uuid; next_version int;
begin
 if not private.has_permission('contracts.manage') then raise exception 'contracts.manage and MFA required' using errcode='42501';end if;
 if p_client_id is null or p_user_id is null or p_document_version_id is null or p_title is null or length(trim(p_title)) not between 1 and 200 or p_effective_from is null or (p_expires_at is not null and p_expires_at<=p_effective_from) or p_kind not in ('master','addendum') or p_kind is null or (p_kind='addendum')<>(p_parent_id is not null) then raise exception 'Invalid executed contract data' using errcode='22023';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text,0));
 select * into previous from public.contracts c where c.registered_by=auth.uid() and c.client_id=p_client_id;
 if found then
  if previous.user_id<>p_user_id or previous.document_version_id<>p_document_version_id or previous.title<>trim(p_title) or previous.effective_from<>p_effective_from or previous.expires_at is distinct from p_expires_at or previous.kind<>p_kind or previous.parent_contract_id is distinct from p_parent_id then raise exception 'Contract idempotency conflict' using errcode='22023';end if;return previous.id;
 end if;
 if not exists(select 1 from public.profiles p join public.user_roles r on r.user_id=p.id where p.id=p_user_id and p.active and r.role in ('lecturer','senior_lecturer')) then raise exception 'An active lecturer is required' using errcode='22023';end if;
 select * into version from public.document_versions where id=p_document_version_id;
 select * into document from public.documents where id=version.document_id;
 if document.id is null or document.deleted_at is not null or document.owner_id<>p_user_id or document.kind<>'contract' or document.scope<>'personal' or version.status<>'clean' or version.mime_type<>'application/pdf' or version.sha256 is null then raise exception 'A clean executed-contract PDF owned by the lecturer is required' using errcode='42501';end if;
 if p_parent_id is not null and not exists(select 1 from public.contracts c where c.id=p_parent_id and c.user_id=p_user_id and c.document_version_id is not null) then raise exception 'A prior executed version for this lecturer is required' using errcode='22023';end if;
 select coalesce(max(c.version),0)+1 into next_version from public.contracts c where c.user_id=p_user_id;
 insert into public.contracts(user_id,status,effective_from,expires_at,version,title,kind,parent_contract_id,document_version_id,document_sha256,registered_by,client_id)
 values(p_user_id,case when p_expires_at<=clock_timestamp() then 'expired' else 'active' end,p_effective_from,p_expires_at,next_version,trim(p_title),p_kind,p_parent_id,p_document_version_id,version.sha256,auth.uid(),p_client_id) returning id into result;
 insert into public.audit_events(actor_id,action,resource_id,details) values(auth.uid(),'contract.executed_version_registered',result,jsonb_build_object('user_id',p_user_id,'version',next_version,'document_version_id',p_document_version_id,'basis','externally_executed_document'));
 insert into public.notifications(user_id,kind,resource_id) values(p_user_id,'contract_available',result);return result;
end;$$;
create function public.register_executed_contract(p_user_id uuid,p_title text,p_document_version_id uuid,p_effective_from timestamptz,p_expires_at timestamptz,p_kind text default 'master',p_parent_id uuid default null,p_client_id uuid default null)
returns uuid language sql security invoker set search_path='' as $$ select private.register_executed_contract(p_user_id,p_title,p_document_version_id,p_effective_from,p_expires_at,p_kind,p_parent_id,p_client_id); $$;
create function private.acknowledge_contract(p_contract_id uuid,p_sha256 text,p_client_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare contract public.contracts; result public.contract_acceptances;
begin
 if not private.actor_active() or p_client_id is null then raise exception 'Active login and request id required' using errcode='42501';end if;
 select * into contract from public.contracts where id=p_contract_id;
 if not found or contract.user_id<>auth.uid() or contract.document_version_id is null or contract.document_sha256 is distinct from p_sha256 then raise exception 'Own exact contract version and hash required' using errcode='42501';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('contract-receipt:'||auth.uid()::text,0));
 select * into result from public.contract_acceptances where user_id=auth.uid() and client_id=p_client_id;
 if found then if result.contract_id<>p_contract_id or result.document_sha256<>p_sha256 then raise exception 'Receipt idempotency conflict' using errcode='22023';end if;return result.id;end if;
 select * into result from public.contract_acceptances where contract_id=p_contract_id and user_id=auth.uid();if found then return result.id;end if;
 insert into public.contract_acceptances(contract_id,user_id,document_sha256,client_id) values(p_contract_id,auth.uid(),p_sha256,p_client_id) returning * into result;
 insert into public.audit_events(actor_id,action,resource_id,details) values(auth.uid(),'contract.receipt_acknowledged',p_contract_id,jsonb_build_object('kind','receipt_acknowledgement','version',contract.version));return result.id;
end;$$;
create function public.acknowledge_contract(p_contract_id uuid,p_sha256 text,p_client_id uuid) returns uuid language sql security invoker set search_path='' as $$ select private.acknowledge_contract(p_contract_id,p_sha256,p_client_id); $$;
create function private.set_contract_status(p_contract_id uuid,p_status text) returns void language plpgsql security definer set search_path='' as $$
declare target uuid;
begin
 if not private.has_permission('contracts.manage') then raise exception 'contracts.manage and MFA required' using errcode='42501';end if;
 if p_status='active' and exists(select 1 from public.contracts where id=p_contract_id and expires_at<=clock_timestamp()) then raise exception 'Expired agreements require a new executed version' using errcode='22023';end if;
 select user_id into target from public.contracts where id=p_contract_id;if target is null or p_status not in ('active','expired') or p_status is null then raise exception 'Valid contract status required' using errcode='22023';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target::text,0));
 update public.contracts set status=p_status,revoked_at=case when p_status='expired' then clock_timestamp() else null end where id=p_contract_id;
 insert into public.audit_events(actor_id,action,resource_id,details) values(auth.uid(),'contract.status_changed',p_contract_id,jsonb_build_object('status',p_status));
end;$$;
create function public.set_contract_status(p_contract_id uuid,p_status text) returns void language sql security invoker set search_path='' as $$ select private.set_contract_status(p_contract_id,p_status); $$;

create function private.current_contract_for_interval(p_user_id uuid,p_starts_at timestamptz,p_ends_at timestamptz) returns uuid language plpgsql stable security definer set search_path='' as $$
declare contract public.contracts;
begin
 -- Select the newest applicable version first, THEN validate status/coverage. An
 -- expired/revoked replacement cannot silently fall back to an older active row.
 select * into contract from public.contracts c where c.user_id=p_user_id and c.effective_from<=p_starts_at order by c.version desc limit 1;
 if not found or contract.status<>'active' or contract.revoked_at is not null or (contract.expires_at is not null and contract.expires_at<p_ends_at) then return null;end if;
 if exists(with recursive chain as (select c.id,c.parent_contract_id,c.revoked_at from public.contracts c where c.id=contract.id union all select parent.id,parent.parent_contract_id,parent.revoked_at from public.contracts parent join chain on parent.id=chain.parent_contract_id) select 1 from chain where revoked_at is not null) then return null;end if;
 return contract.id;
end;$$;

-- Preserve atomic claiming; only contract-version selection and active-profile locking change.
create or replace function private.claim_job(p_job_id uuid,p_idempotency_key uuid,p_terms_version integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 actor uuid:=auth.uid(); j public.jobs; c public.job_claims; v_contract uuid; v_claim uuid; v_room uuid;
begin
 if not private.actor_active() then raise exception 'Authentication required' using errcode='42501'; end if;
 perform 1 from public.profiles where id=actor and active for share;
 if not found then raise exception 'Authentication required' using errcode='42501';end if;
 if p_idempotency_key is null or p_terms_version is null then raise exception 'Missing claim data' using errcode='22023'; end if;
 if not private.has_role(array['lecturer','senior_lecturer']) then return jsonb_build_object('status','not_eligible'); end if;
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
 if exists(select 1 from public.job_sessions js join public.assignment_sessions a on a.lecturer_id=actor and tstzrange(a.starts_at,a.ends_at,'[)') && tstzrange(js.starts_at,js.ends_at,'[)') where js.job_id=j.id)
 or exists(select 1 from public.job_sessions js join public.personal_events e on e.user_id=actor and tstzrange(e.starts_at,e.ends_at,'[)') && tstzrange(js.starts_at,js.ends_at,'[)') where js.job_id=j.id)
 then return jsonb_build_object('status','conflict'); end if;
 insert into public.job_claims(job_id,lecturer_id,idempotency_key,amount,currency,rate_unit,total_amount,terms,terms_version,contract_id)
 values(j.id,actor,p_idempotency_key,j.amount,j.currency,j.rate_unit,j.total_amount,j.terms,j.terms_version,v_contract) returning id into v_claim;
 insert into public.assignment_sessions(claim_id,lecturer_id,starts_at,ends_at) select v_claim,actor,starts_at,ends_at from public.job_sessions where job_id=j.id;
 update public.jobs set status='filled' where id=j.id;
 insert into public.claim_events(claim_id,actor_id,event_type) values(v_claim,actor,'confirmed');
 insert into public.notifications(user_id,kind,resource_id) values(actor,'claim_confirmed',v_claim);
 insert into public.chat_rooms(job_id) values(j.id) on conflict(job_id) do update set job_id=excluded.job_id returning id into v_room;
 insert into public.chat_members(room_id,user_id) values(v_room,actor) on conflict do nothing;
 return jsonb_build_object('status','confirmed','claim_id',v_claim);
exception when exclusion_violation then
 -- PL/pgSQL exception subtransaction rolls back EVERY preceding write.
 return jsonb_build_object('status','conflict');
end;$$;

create function private.finance_earnings(p_all boolean default false)
returns table(claim_id uuid,job_id uuid,lecturer_id uuid,lecturer_name text,title text,customer_name text,starts_at timestamptz,ends_at timestamptz,amount numeric,rate_unit text,total_amount numeric,currency text,stage text,invoice_id uuid)
language plpgsql stable security definer set search_path='' as $$
begin
 if not private.actor_active() or (p_all and not private.has_permission('finance.manage')) then raise exception 'Own earnings or finance management and MFA required' using errcode='42501';end if;
 return query select c.id,c.job_id,c.lecturer_id,p.display_name,j.title,j.customer_name,(select min(s.starts_at) from public.assignment_sessions s where s.claim_id=c.id),(select max(s.ends_at) from public.assignment_sessions s where s.claim_id=c.id),c.amount,c.rate_unit,c.total_amount,c.currency,
 case when i.status='paid' then 'paid' when i.id is not null then 'invoiced' when (select max(s.ends_at) from public.assignment_sessions s where s.claim_id=c.id)<=now() then 'completed' else 'expected' end,i.id
 from public.job_claims c join public.profiles p on p.id=c.lecturer_id join public.jobs j on j.id=c.job_id left join public.invoice_items item on item.claim_id=c.id and item.active left join public.invoices i on i.id=item.invoice_id
 where c.status='confirmed' and (p_all or c.lecturer_id=auth.uid()) order by c.created_at desc,c.id;
end;$$;
create function public.finance_earnings(p_all boolean default false)
returns table(claim_id uuid,job_id uuid,lecturer_id uuid,lecturer_name text,title text,customer_name text,starts_at timestamptz,ends_at timestamptz,amount numeric,rate_unit text,total_amount numeric,currency text,stage text,invoice_id uuid)
language sql stable security invoker set search_path='' as $$ select * from private.finance_earnings(p_all); $$;
create function private.invoice_records(p_all boolean default false)
returns table(id uuid,user_id uuid,user_name text,number text,issued_on date,due_on date,currency text,total_amount numeric,paid_amount numeric,status text,document_id uuid,document_version_id uuid,claim_ids uuid[],created_at timestamptz,note text,paid_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
begin
 if not private.actor_active() or (p_all and not private.has_permission('finance.manage')) then raise exception 'Own invoices or finance management and MFA required' using errcode='42501';end if;
 return query select i.id,i.user_id,p.display_name,i.number,i.issued_on,i.due_on,i.currency,i.total_amount,
 coalesce((select sum(r.amount) from public.payment_records r where r.invoice_id=i.id and r.voided_at is null),0),i.status,v.document_id,i.document_version_id,
 coalesce((select array_agg(item.claim_id order by item.claim_id) from public.invoice_items item where item.invoice_id=i.id),'{}'::uuid[]),i.created_at,i.note,(select max(r.paid_at) from public.payment_records r where r.invoice_id=i.id and r.voided_at is null)
 from public.invoices i join public.profiles p on p.id=i.user_id join public.document_versions v on v.id=i.document_version_id where p_all or i.user_id=auth.uid() order by i.created_at desc,i.id;
end;$$;
create function public.invoice_records(p_all boolean default false)
returns table(id uuid,user_id uuid,user_name text,number text,issued_on date,due_on date,currency text,total_amount numeric,paid_amount numeric,status text,document_id uuid,document_version_id uuid,claim_ids uuid[],created_at timestamptz,note text,paid_at timestamptz)
language sql stable security invoker set search_path='' as $$ select * from private.invoice_records(p_all); $$;

create function private.submit_invoice(p_number text,p_claim_ids uuid[],p_document_version_id uuid,p_issued_on date,p_due_on date,p_client_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare previous public.invoices; version public.document_versions; document public.documents; normalized uuid[]; result uuid; currencies int; total numeric; original_currency text;
begin
 if not private.has_role(array['lecturer','senior_lecturer']) then raise exception 'Active lecturer required' using errcode='42501';end if;
 if p_client_id is null or p_number is null or length(trim(p_number)) not between 1 and 80 or cardinality(p_claim_ids) not between 1 and 50 or p_claim_ids is null or p_issued_on is null or p_due_on is null or p_due_on<p_issued_on then raise exception 'Invalid invoice metadata' using errcode='22023';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('invoice:'||auth.uid()::text,0));
 select array_agg(distinct x order by x) into normalized from unnest(p_claim_ids) x;
 if cardinality(normalized)<>cardinality(p_claim_ids) or array_position(normalized,null) is not null then raise exception 'Unique claim IDs required' using errcode='22023';end if;
 select * into previous from public.invoices where user_id=auth.uid() and client_id=p_client_id;
 if found then
  if previous.number<>trim(p_number) or previous.document_version_id<>p_document_version_id or previous.issued_on<>p_issued_on or previous.due_on<>p_due_on or normalized is distinct from (select array_agg(claim_id order by claim_id) from public.invoice_items where invoice_id=previous.id) then raise exception 'Invoice idempotency conflict' using errcode='22023';end if;return previous.id;
 end if;
 if exists(select 1 from unnest(normalized) selected where not exists(select 1 from public.job_claims c where c.id=selected and c.lecturer_id=auth.uid() and c.status='confirmed')) then raise exception 'Only own accepted claims can be invoiced' using errcode='42501';end if;
 if exists(select 1 from public.invoice_items where claim_id=any(normalized) and active) then raise exception 'A claim already has an active invoice' using errcode='23505';end if;
 select count(distinct c.currency),sum(c.total_amount),min(c.currency) into currencies,total,original_currency from public.job_claims c where c.id=any(normalized);
 if currencies<>1 or total<=0 then raise exception 'Invoice must use one original currency and positive accepted compensation' using errcode='22023';end if;
 select * into version from public.document_versions where id=p_document_version_id;
 select * into document from public.documents where id=version.document_id;
 if document.id is null or document.owner_id<>auth.uid() or document.deleted_at is not null or document.kind<>'invoice' or document.scope<>'personal' or version.status<>'clean' or version.mime_type<>'application/pdf' or version.sha256 is null then raise exception 'Own clean invoice PDF required' using errcode='42501';end if;
 insert into public.invoices(user_id,number,issued_on,due_on,currency,total_amount,document_version_id,client_id) values(auth.uid(),trim(p_number),p_issued_on,p_due_on,original_currency,total,p_document_version_id,p_client_id) returning id into result;
 insert into public.invoice_items(invoice_id,claim_id) select result,x from unnest(normalized) x;
 insert into public.audit_events(actor_id,action,resource_id,details) values(auth.uid(),'invoice.submitted',result,jsonb_build_object('currency',original_currency,'accepted_compensation',total));return result;
end;$$;
create function public.submit_invoice(p_number text,p_claim_ids uuid[],p_document_version_id uuid,p_issued_on date,p_due_on date,p_client_id uuid) returns uuid language sql security invoker set search_path='' as $$ select private.submit_invoice(p_number,p_claim_ids,p_document_version_id,p_issued_on,p_due_on,p_client_id); $$;
create function private.review_invoice(p_invoice_id uuid,p_status text,p_note text) returns void language plpgsql security definer set search_path='' as $$
declare invoice public.invoices;
begin
 if not private.has_permission('finance.manage') then raise exception 'finance.manage and MFA required' using errcode='42501';end if;
 if p_status not in ('approved','rejected','cancelled') or p_status is null or p_note is null or length(p_note)>2000 then raise exception 'Invalid invoice decision' using errcode='22023';end if;
 select * into invoice from public.invoices where id=p_invoice_id for update;
 if not found or invoice.status='paid' or exists(select 1 from public.payment_records where invoice_id=p_invoice_id and voided_at is null) then raise exception 'Paid or partially paid invoices cannot be reclassified' using errcode='22023';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('invoice:'||invoice.user_id::text,0));
 update public.invoice_items set active=p_status='approved' where invoice_id=p_invoice_id;
 update public.invoices set status=p_status,note=p_note,reviewed_by=auth.uid(),reviewed_at=clock_timestamp() where id=p_invoice_id;
 insert into public.audit_events(actor_id,action,resource_id,details) values(auth.uid(),'invoice.reviewed',p_invoice_id,jsonb_build_object('status',p_status));
end;$$;
create function public.review_invoice(p_invoice_id uuid,p_status text,p_note text) returns void language sql security invoker set search_path='' as $$ select private.review_invoice(p_invoice_id,p_status,p_note); $$;
create function private.record_invoice_payment(p_invoice_id uuid,p_amount numeric,p_paid_at timestamptz,p_reference text,p_client_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare invoice public.invoices; previous public.payment_records; result uuid; paid numeric;
begin
 if not private.has_permission('finance.manage') then raise exception 'finance.manage and MFA required' using errcode='42501';end if;
 if p_client_id is null or p_amount is null or p_amount<=0 or round(p_amount,2)<>p_amount or p_paid_at is null or p_paid_at>clock_timestamp()+interval '5 minutes' or p_reference is null or length(p_reference)>200 then raise exception 'Invalid payment record' using errcode='22023';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('payment:'||auth.uid()::text,0));
 select * into previous from public.payment_records where recorded_by=auth.uid() and client_id=p_client_id;
 if found then if previous.invoice_id<>p_invoice_id or previous.amount<>p_amount or previous.paid_at<>p_paid_at or previous.reference<>p_reference then raise exception 'Payment idempotency conflict' using errcode='22023';end if;return previous.id;end if;
 select * into invoice from public.invoices where id=p_invoice_id for update;
 if not found or invoice.status<>'approved' then raise exception 'An approved unpaid invoice is required' using errcode='22023';end if;
 select coalesce(sum(amount),0) into paid from public.payment_records where invoice_id=p_invoice_id and voided_at is null;
 if paid+p_amount>invoice.total_amount then raise exception 'Payment would exceed the accepted compensation' using errcode='22023';end if;
 insert into public.payment_records(invoice_id,amount,currency,paid_at,reference,recorded_by,client_id) values(p_invoice_id,p_amount,invoice.currency,p_paid_at,p_reference,auth.uid(),p_client_id) returning id into result;
 if paid+p_amount=invoice.total_amount then update public.invoices set status='paid' where id=p_invoice_id;end if;
 insert into public.audit_events(actor_id,action,resource_id,details) values(auth.uid(),'invoice.payment_recorded',result,jsonb_build_object('invoice_id',p_invoice_id,'amount',p_amount,'currency',invoice.currency));return result;
end;$$;
create function public.record_invoice_payment(p_invoice_id uuid,p_amount numeric,p_paid_at timestamptz,p_reference text,p_client_id uuid) returns uuid language sql security invoker set search_path='' as $$ select private.record_invoice_payment(p_invoice_id,p_amount,p_paid_at,p_reference,p_client_id); $$;
create function private.invoice_payments(p_invoice_id uuid)
returns table(id uuid,amount numeric,currency text,paid_at timestamptz,reference text,recorded_by_name text,created_at timestamptz,voided_at timestamptz,void_reason text)
language plpgsql stable security definer set search_path='' as $$
begin
 if not private.can_read_invoice(p_invoice_id) then raise exception 'Invoice access denied' using errcode='42501';end if;
 return query select r.id,r.amount,r.currency,r.paid_at,r.reference,p.display_name,r.created_at,r.voided_at,r.void_reason from public.payment_records r join public.profiles p on p.id=r.recorded_by where r.invoice_id=p_invoice_id order by r.created_at,r.id;
end;$$;
create function public.invoice_payments(p_invoice_id uuid)
returns table(id uuid,amount numeric,currency text,paid_at timestamptz,reference text,recorded_by_name text,created_at timestamptz,voided_at timestamptz,void_reason text)
language sql stable security invoker set search_path='' as $$ select * from private.invoice_payments(p_invoice_id); $$;
create function private.void_invoice_payment(p_payment_id uuid,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare payment public.payment_records; invoice public.invoices;
begin
 if not private.has_permission('finance.manage') then raise exception 'finance.manage and MFA required' using errcode='42501';end if;
 if p_reason is null or length(trim(p_reason)) not between 1 and 2000 then raise exception 'A correction reason is required' using errcode='22023';end if;
 select * into payment from public.payment_records where id=p_payment_id;
 if not found then raise exception 'Payment record not found' using errcode='22023';end if;
 select * into invoice from public.invoices where id=payment.invoice_id for update;
 update public.payment_records set voided_at=clock_timestamp(),voided_by=auth.uid(),void_reason=trim(p_reason) where id=p_payment_id and voided_at is null;
 if found then update public.invoices set status='approved' where id=invoice.id;insert into public.audit_events(actor_id,action,resource_id,details) values(auth.uid(),'invoice.payment_voided',p_payment_id,jsonb_build_object('reason',trim(p_reason)));end if;
end;$$;
create function public.void_invoice_payment(p_payment_id uuid,p_reason text) returns void language sql security invoker set search_path='' as $$ select private.void_invoice_payment(p_payment_id,p_reason); $$;

-- Browser users cannot change submitted commercial snapshots by direct table writes.
create function private.immutable_invoice_snapshot() returns trigger language plpgsql set search_path='' as $$
begin
 if (to_jsonb(new)-'status'-'note'-'reviewed_by'-'reviewed_at') is distinct from (to_jsonb(old)-'status'-'note'-'reviewed_by'-'reviewed_at') then raise exception 'Submitted invoice snapshots are immutable' using errcode='23514';end if;return new;
end;$$;
create trigger invoice_snapshot_immutable before update on public.invoices for each row execute function private.immutable_invoice_snapshot();
create function private.immutable_invoice_item() returns trigger language plpgsql set search_path='' as $$
begin
 if new.invoice_id is distinct from old.invoice_id or new.claim_id is distinct from old.claim_id then raise exception 'Invoice claim references are immutable' using errcode='23514';end if;return new;
end;$$;
create trigger invoice_item_snapshot_immutable before update on public.invoice_items for each row execute function private.immutable_invoice_item();
create function private.immutable_contract_receipt() returns trigger language plpgsql set search_path='' as $$
begin
 if to_jsonb(new) is distinct from to_jsonb(old) then raise exception 'Contract receipt records are immutable' using errcode='23514';end if;return new;
end;$$;
create trigger contract_receipt_immutable before update on public.contract_acceptances for each row execute function private.immutable_contract_receipt();

create function private.immutable_payment_snapshot() returns trigger language plpgsql set search_path='' as $$
begin
 if (to_jsonb(new)-'voided_at'-'voided_by'-'void_reason') is distinct from (to_jsonb(old)-'voided_at'-'voided_by'-'void_reason') then raise exception 'Payment records are immutable; void an erroneous entry' using errcode='23514';end if;return new;
end;$$;
create trigger payment_snapshot_immutable before update on public.payment_records for each row execute function private.immutable_payment_snapshot();

do $$declare item record;begin
 for item in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.proname in ('can_read_invoice','commercial_access','commercial_people','contract_records','register_executed_contract','acknowledge_contract','set_contract_status','finance_earnings','invoice_records','submit_invoice','review_invoice','record_invoice_payment','invoice_payments','void_invoice_payment') loop
  execute format('revoke execute on function %s from public,anon,authenticated',item.signature);execute format('grant execute on function %s to authenticated',item.signature);
 end loop;
end;$$;
revoke execute on function private.immutable_contract_version(),private.protect_commercial_document(),private.protect_commercial_version(),private.current_contract_for_interval(uuid,timestamptz,timestamptz),private.immutable_invoice_snapshot(),private.immutable_invoice_item(),private.immutable_contract_receipt(),private.immutable_payment_snapshot() from public,anon,authenticated;
commit;
