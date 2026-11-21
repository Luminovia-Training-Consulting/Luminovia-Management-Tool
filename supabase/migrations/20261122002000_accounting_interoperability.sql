-- Accounting interoperability retains original invoice/currency evidence and
-- current resource authority. New external invoices never rewrite accepted fees.
begin;

-- Reuse an early Accounting installation if one was applied before its source was
-- reverted. Existing records, constraints and migration history are retained.
create table if not exists private.accounting_customer_invoices (
 id uuid primary key default gen_random_uuid(),organisation_id uuid not null references public.organisations(id),
 registered_by uuid not null references public.profiles(id),number text not null,
 issued_on date not null,due_on date not null check(due_on>=issued_on),currency text not null check(currency in('EUR','AUD')),
 total_amount numeric(12,2) not null check(total_amount>0),accepted_charge_total numeric(12,2) not null check(accepted_charge_total>0),
 difference_reason text not null check(length(difference_reason)<=1000),claim_references jsonb not null,
 document_id uuid not null unique references public.documents(id),document_version_id uuid not null unique references public.document_versions(id),
 document_sha256 text not null check(document_sha256~'^[a-f0-9]{64}$'),
 created_at timestamptz not null default clock_timestamp(),unique(organisation_id,number)
);
create table if not exists private.accounting_customer_items (
 claim_id uuid primary key references public.job_claims(id),invoice_id uuid not null references private.accounting_customer_invoices(id)
);
create table if not exists private.accounting_customer_payments (
 id uuid primary key default gen_random_uuid(),invoice_id uuid not null references private.accounting_customer_invoices(id),
 amount numeric(12,2) not null check(amount>0),paid_at timestamptz not null,reference text not null check(length(reference)<=1000),
 reverses_id uuid unique references private.accounting_customer_payments(id),recorded_by uuid not null references public.profiles(id),created_at timestamptz not null default clock_timestamp()
);
create table if not exists private.accounting_exports (
 id uuid primary key default gen_random_uuid(),actor_id uuid not null references public.profiles(id),
 source text not null check(source in('own','lecturer_all','customer')),requires_gross boolean not null default false,
 invoice_ids uuid[] not null,records jsonb not null,sha256 text not null check(sha256~'^[a-f0-9]{64}$'),
 created_at timestamptz not null default clock_timestamp(),unique(actor_id,source,sha256)
);
create table if not exists private.accounting_operations (
 actor_id uuid not null references public.profiles(id),request_id uuid not null,payload jsonb not null,result jsonb not null,
 primary key(actor_id,request_id)
);
create index if not exists accounting_customer_org_page on private.accounting_customer_invoices(organisation_id,created_at desc,id desc);
create index if not exists accounting_customer_payment_invoice on private.accounting_customer_payments(invoice_id);
create index if not exists accounting_exports_actor on private.accounting_exports(actor_id,created_at desc,id desc);
do $$declare t text;begin foreach t in array array['accounting_customer_invoices','accounting_customer_items','accounting_customer_payments','accounting_exports','accounting_operations'] loop
 execute format('alter table private.%I enable row level security',t);
 execute format('revoke all on private.%I from public,anon,authenticated',t);
end loop;end;$$;
-- Corrections append payment reversals or new export snapshots, never mutate
-- the invoice, old payment, captured content or idempotent operation receipt.
create or replace function private.immutable_accounting_record() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Accounting evidence is immutable' using errcode='55000';end;$$;
create or replace trigger immutable_customer_invoice before update or delete on private.accounting_customer_invoices for each row execute function private.immutable_accounting_record();
create or replace trigger immutable_customer_items before update or delete on private.accounting_customer_items for each row execute function private.immutable_accounting_record();
create or replace trigger immutable_customer_payments before update or delete on private.accounting_customer_payments for each row execute function private.immutable_accounting_record();
create or replace trigger immutable_accounting_export before update or delete on private.accounting_exports for each row execute function private.immutable_accounting_record();
create or replace trigger immutable_accounting_operation before update or delete on private.accounting_operations for each row execute function private.immutable_accounting_record();

-- Only dedicated gross-finance authority or an active customer membership may
-- read external customer invoices; ordinary net-finance authority is insufficient.
create or replace function private.can_read_customer_invoice(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.actor_active() and exists(select 1 from private.accounting_customer_invoices i where i.id=p_id and (private.has_permission('finance.gross.read') or private.client_has_organisation(i.organisation_id)));
$$;

-- Preserve the exact trusted ACL installed by all earlier migrations, including
-- extensions. Existing RLS policies retain the original function OID. The clone
-- is callable only by this definer, never as a browser bypass around the wrapper.
do $$
declare predecessor text;
begin
  if to_regprocedure('private.accounting_document_access_fallback(uuid)') is null then
    select prosrc into strict predecessor
    from pg_catalog.pg_proc
    where oid = 'private.can_access_document(uuid)'::regprocedure;
    -- A distinct name also preserves the predecessor chain if it already
    -- contains the first Accounting wrapper from a historical installation.
    execute format(
      'create function private.accounting_document_access_fallback(p_id uuid) returns boolean language plpgsql stable security definer set search_path=%L as %L',
      '', predecessor
    );
  end if;
end;
$$;
revoke all on function private.accounting_document_access_fallback(uuid)
  from public, anon, authenticated, service_role;
create or replace function private.can_access_document(p_id uuid) returns boolean language plpgsql stable security definer set search_path='' as $$
declare invoice uuid;
begin
 if not private.actor_active() or private.deletion_document_fenced(p_id) then return false;end if;
 select id into invoice from private.accounting_customer_invoices where document_id=p_id;
 if found then
  return private.can_read_customer_invoice(invoice) and exists(
   select 1 from public.documents d where d.id=p_id and d.deleted_at is null and d.status='clean' and d.kind='invoice'
  );
 end if;
 return private.accounting_document_access_fallback(p_id);
end;$$;
-- Freeze the complete dedicated single-version document after registration.
-- A later upload cannot share a document-level ACL with unrelated private bytes.
create or replace function private.freeze_accounting_document() returns trigger language plpgsql security definer set search_path='' as $$
declare document uuid;
begin
 if tg_table_name='documents' then document:=old.id;
 elsif tg_op='INSERT' then document:=new.document_id;
 else document:=old.document_id;end if;
 if exists(select 1 from private.accounting_customer_invoices i where i.document_id=document) then
  raise exception 'Customer invoice PDF evidence is immutable' using errcode='23514';
 end if;
 if tg_table_name='document_versions' and tg_op='UPDATE' then
  if new.document_id is distinct from old.document_id and exists(
   select 1 from private.accounting_customer_invoices i where i.document_id=new.document_id
  ) then raise exception 'Customer invoice PDF evidence is immutable' using errcode='23514';end if;
 end if;
 if tg_op='DELETE' then return old;else return new;end if;
end;$$;
create or replace trigger retained_customer_document before update or delete on public.documents for each row execute function private.freeze_accounting_document();
create or replace trigger retained_customer_document_version before insert or update or delete on public.document_versions for each row execute function private.freeze_accounting_document();
-- A customer PDF must never be relabelled as evidence for a lecturer invoice.
create or replace function private.separate_customer_invoice_pdf() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from private.accounting_customer_invoices where document_version_id=new.document_version_id) then raise exception 'Customer invoice evidence cannot be reused for lecturer invoices' using errcode='23514';end if;return new;
end;$$;
create or replace trigger separate_customer_invoice_pdf before insert or update of document_version_id on public.invoices for each row execute function private.separate_customer_invoice_pdf();

-- The installed course-document guard looks up optional registries on every
-- share and holds the same document lock that customer registration uses.
-- The historic Accounting-specific guard may remain on an upgraded database.
-- UI capabilities are read from current authority and confer no write access.
create or replace function private.accounting_access() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.actor_active() then raise exception 'Active account required' using errcode='42501';end if;
 return jsonb_build_object('can_export_all_lecturers',private.has_permission('finance.manage'),'can_manage_customer_invoices',private.has_permission('finance.gross.read'),
 'can_export_customer',private.has_permission('finance.gross.read') or exists(select 1 from public.client_organisation_memberships m where m.user_id=auth.uid() and private.client_has_organisation(m.organisation_id)));
end;$$;
create or replace function public.accounting_access() returns jsonb language sql stable security invoker set search_path='' as $$select private.accounting_access();$$;
-- Discover only uninvoiced accepted customer charges for explicit registration.
create or replace function private.accounting_customer_claims() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.has_permission('finance.gross.read') then raise exception 'Customer finance permission required' using errcode='42501';end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('claim_id',l.claim_id,'job_id',l.job_id,'title',j.title,'organisation_id',l.organisation_id,'organisation_name',o.name,'currency',l.currency,'accepted_charge',l.gross_total_amount::text) order by l.accepted_at desc,l.claim_id),'[]'::jsonb)
  from private.claim_revenue_ledger l join public.jobs j on j.id=l.job_id join public.organisations o on o.id=l.organisation_id where not exists(select 1 from private.accounting_customer_items i where i.claim_id=l.claim_id));
end;$$;
create or replace function public.accounting_customer_claims() returns jsonb language sql stable security invoker set search_path='' as $$select private.accounting_customer_claims();$$;

-- Preserve supplied invoice values and immutable accepted-charge references.
-- Actor serialization and deterministic claim locks prevent duplicate invoices.
create or replace function private.register_customer_invoice(p_payload jsonb,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare ids uuid[];org uuid;v_currency text;accepted numeric;total numeric;version public.document_versions;document public.documents;
 refs jsonb;prior private.accounting_operations;operation jsonb;result jsonb;invoice uuid;issued date;due date;number text;difference text;
begin
 perform 1 from public.profiles p where p.id=auth.uid() and p.active for share;
 if not found or not private.has_permission('finance.gross.read') then raise exception 'Customer finance permission required' using errcode='42501';end if;
 if p_request_id is null or p_payload is null or jsonb_typeof(p_payload)<>'object' or (select count(*) from jsonb_object_keys(p_payload))<>8
 or exists(select 1 from jsonb_object_keys(p_payload) k where k not in('claim_ids','number','issued_on','due_on','currency','total_amount','document_version_id','difference_reason'))
 or jsonb_typeof(p_payload->'claim_ids') is distinct from 'array'
 or exists(select 1 from jsonb_each(p_payload) x where x.key<>'claim_ids' and jsonb_typeof(x.value)<>'string')
 or exists(select 1 from jsonb_array_elements(p_payload->'claim_ids') x where jsonb_typeof(x)<>'string') then raise exception 'Invalid customer invoice fields' using errcode='22023';end if;
 if p_payload->>'total_amount'!~'^(0|[1-9][0-9]{0,9})\.[0-9]{2}$' then raise exception 'Exact decimal invoice total required' using errcode='22023';end if;
 begin
  select array_agg(v::uuid order by v::uuid) into ids from jsonb_array_elements_text(p_payload->'claim_ids') v;
  issued:=(p_payload->>'issued_on')::date;due:=(p_payload->>'due_on')::date;
 exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then raise exception 'Invalid invoice identifiers or dates' using errcode='22023';end;
 number:=btrim(p_payload->>'number');difference:=btrim(p_payload->>'difference_reason');v_currency:=p_payload->>'currency';total:=(p_payload->>'total_amount')::numeric;
 if cardinality(ids) not between 1 and 50 or ids is null or cardinality(ids)<>(select count(distinct id) from unnest(ids) id)
  or length(number) not between 1 and 80 or length(difference)>1000 or number~'[[:cntrl:]]' or v_currency not in('EUR','AUD') or total<=0
  or issued is null or due is null or not isfinite(issued) or not isfinite(due) or due<issued then raise exception 'Invalid customer invoice metadata' using errcode='22023';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('accounting-actor:'||auth.uid()::text,0));
 operation:=jsonb_build_object('action','register_customer_invoice','payload',p_payload);
 select * into prior from private.accounting_operations where actor_id=auth.uid() and request_id=p_request_id;
 if found then if prior.payload<>operation then raise exception 'Accounting request key conflict' using errcode='22023';end if;return prior.result;end if;
 perform 1 from public.job_claims c where c.id=any(ids) order by c.id for update;
 if (select count(*) from private.claim_revenue_ledger l where l.claim_id=any(ids))<>cardinality(ids)
  or (select count(distinct l.organisation_id) from private.claim_revenue_ledger l where l.claim_id=any(ids))<>1
  or exists(select 1 from private.claim_revenue_ledger l where l.claim_id=any(ids) and l.currency<>v_currency) then raise exception 'Accepted customer agreements in one organisation and currency required' using errcode='22023';end if;
 if exists(select 1 from private.accounting_customer_items where claim_id=any(ids)) then raise exception 'A customer agreement already has an invoice' using errcode='23505';end if;
 select min(l.organisation_id::text)::uuid,sum(l.gross_total_amount),jsonb_agg(jsonb_build_object('claim_id',l.claim_id,'job_id',l.job_id,'title',j.title,'accepted_charge',l.gross_total_amount::text,'accepted_at',l.accepted_at) order by l.claim_id) into org,accepted,refs from private.claim_revenue_ledger l join public.jobs j on j.id=l.job_id where l.claim_id=any(ids);
 if total<>accepted and length(difference)<5 then raise exception 'Explain the recorded invoice difference without changing accepted charges' using errcode='22023';end if;
 select * into version from public.document_versions where id=(p_payload->>'document_version_id')::uuid;
 select * into document from public.documents where id=version.document_id for update;
 select * into version from public.document_versions where id=(p_payload->>'document_version_id')::uuid for update;
 if document.id is null or document.owner_id<>auth.uid() or document.uploaded_by<>auth.uid() or document.scope<>'personal' or document.kind<>'material' or document.deleted_at is not null
  or document.current_version_id is distinct from version.id or version.status<>'clean' or document.status<>'clean' or version.mime_type<>'application/pdf' or version.sha256 is null
  or (select count(*) from public.document_versions v where v.document_id=document.id)<>1 then raise exception 'Own dedicated clean single-version PDF required' using errcode='42501';end if;
 -- Every file registry has independent readers. While holding the same
 -- document lock as those writers, reject any earlier dedicated or shared use,
 -- including a removed course link or an older revision of a wiki page.
 if private.deletion_document_fenced(document.id) or
    private.course_document_is_dedicated(document.id) or
    exists(select 1 from private.course_resources r join public.document_versions v on v.id=r.version_id where v.document_id=document.id) or
    exists(select 1 from private.wiki_revision_attachments r join public.document_versions v on v.id=r.version_id where v.document_id=document.id) then
  raise exception 'Customer invoice PDF must have no private or shared document history' using errcode='42501';
 end if;
 -- Until this atomic transaction commits, the uploaded material is owner-only.
 -- The registered customer guard then takes precedence over ordinary invoice ACLs.
 update public.documents set kind='invoice' where id=document.id;
 insert into private.accounting_customer_invoices(organisation_id,registered_by,number,issued_on,due_on,currency,total_amount,accepted_charge_total,difference_reason,claim_references,document_id,document_version_id,document_sha256)
 values(org,auth.uid(),number,issued,due,v_currency,total,accepted,difference,refs,document.id,version.id,version.sha256) returning id into invoice;
 insert into private.accounting_customer_items(claim_id,invoice_id) select id,invoice from unnest(ids) id;
 result:=jsonb_build_object('id',invoice);
 insert into private.accounting_operations(actor_id,request_id,payload,result) values(auth.uid(),p_request_id,operation,result);
 insert into public.audit_events(actor_id,action,resource_id) values(auth.uid(),'accounting.customer_invoice_registered',invoice);
 return result;
end;$$;
create or replace function public.register_customer_invoice(p_payload jsonb,p_request_id uuid) returns jsonb language sql security invoker set search_path='' as $$select private.register_customer_invoice(p_payload,p_request_id);$$;

-- Append known payments or exact reversals under the invoice lock. No accepted
-- amount is edited and no operation invokes banking or determines tax treatment.
create or replace function private.customer_invoice_payment(p_invoice_id uuid,p_amount text,p_paid_at timestamptz,p_reference text,p_reverses_id uuid,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare invoice private.accounting_customer_invoices;previous private.accounting_customer_payments;prior private.accounting_operations;
 operation jsonb;result jsonb;amount numeric;paid numeric;payment uuid;
begin
 perform 1 from public.profiles p where p.id=auth.uid() and p.active for share;
 if not found or not private.has_permission('finance.gross.read') then raise exception 'Customer finance permission required' using errcode='42501';end if;
 if p_request_id is null or p_reference is null or length(btrim(p_reference)) not between 1 and 1000 then raise exception 'Payment reference or reversal explanation required' using errcode='22023';end if;
 if p_reverses_id is null and (p_amount is null or p_amount!~'^(0|[1-9][0-9]{0,9})\.[0-9]{2}$' or p_paid_at is null or not isfinite(p_paid_at) or p_paid_at>clock_timestamp()) then raise exception 'Exact original-currency payment required' using errcode='22023';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('accounting-actor:'||auth.uid()::text,0));
 operation:=jsonb_build_object('action','customer_payment','invoice_id',p_invoice_id,'amount',p_amount,'paid_at',p_paid_at,'reference',p_reference,'reverses_id',p_reverses_id);
 select * into prior from private.accounting_operations where actor_id=auth.uid() and request_id=p_request_id;
 if found then if prior.payload<>operation then raise exception 'Accounting request key conflict' using errcode='22023';end if;return prior.result;end if;
 select * into invoice from private.accounting_customer_invoices where id=p_invoice_id for update;
 if not found then raise exception 'Customer invoice unavailable' using errcode='42501';end if;
 if p_reverses_id is not null then
  select * into previous from private.accounting_customer_payments where id=p_reverses_id and invoice_id=invoice.id and reverses_id is null;
  if not found or exists(select 1 from private.accounting_customer_payments where reverses_id=previous.id) or length(btrim(p_reference))<5 then raise exception 'Unreversed payment and explanation required' using errcode='22023';end if;
  amount:=previous.amount;
 else
  amount:=p_amount::numeric;
  select coalesce(sum(case when p.reverses_id is null then p.amount else -p.amount end),0) into paid from private.accounting_customer_payments p where p.invoice_id=invoice.id;
  if amount<=0 or paid+amount>invoice.total_amount then raise exception 'Payment exceeds the recorded invoice total' using errcode='22023';end if;
 end if;
 insert into private.accounting_customer_payments(invoice_id,amount,paid_at,reference,reverses_id,recorded_by) values(invoice.id,amount,case when p_reverses_id is null then p_paid_at else clock_timestamp() end,btrim(p_reference),p_reverses_id,auth.uid()) returning id into payment;
 result:=jsonb_build_object('id',payment);
 insert into private.accounting_operations(actor_id,request_id,payload,result) values(auth.uid(),p_request_id,operation,result);
 insert into public.audit_events(actor_id,action,resource_id) values(auth.uid(),case when p_reverses_id is null then 'accounting.customer_payment_recorded' else 'accounting.customer_payment_reversed' end,payment);
 return result;
end;$$;
create or replace function public.record_customer_invoice_payment(p_invoice_id uuid,p_amount text,p_paid_at timestamptz,p_reference text,p_request_id uuid) returns jsonb language sql security invoker set search_path='' as $$select private.customer_invoice_payment(p_invoice_id,p_amount,p_paid_at,p_reference,null,p_request_id);$$;
create or replace function public.reverse_customer_invoice_payment(p_invoice_id uuid,p_payment_id uuid,p_reason text,p_request_id uuid) returns jsonb language sql security invoker set search_path='' as $$select private.customer_invoice_payment(p_invoice_id,null,null,p_reason,p_payment_id,p_request_id);$$;

-- Normalize authorized source records to exact decimal strings. Commercial
-- charges are kept separate from unrecorded tax net/gross/VAT information.
create or replace function private.accounting_record(p_source text,p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not private.actor_active() then raise exception 'Active account required' using errcode='42501';end if;
 if p_source in('own','lecturer_all') then
  if not private.can_read_invoice(p_id) or (p_source='lecturer_all' and not private.has_permission('finance.manage'))
   or (p_source='own' and not exists(select 1 from public.invoices where id=p_id and user_id=auth.uid())) then raise exception 'Lecturer invoice access required' using errcode='42501';end if;
  select jsonb_build_object('id',i.id,'kind','lecturer_invoice','number',i.number,'issued_on',i.issued_on,'due_on',i.due_on,'currency',i.currency,
   'recorded_total',i.total_amount::text,'paid_total',coalesce(paid.total,0)::numeric(12,2)::text,'outstanding_total',(i.total_amount-coalesce(paid.total,0))::numeric(12,2)::text,
   'status',i.status,'document_id',v.document_id,'document_version_id',v.id,'document_sha256',v.sha256,'organisation_id',null,'organisation_name',null,
   'accepted_charge_total',null,'difference_reason',null,
   'assignments',(select coalesce(jsonb_agg(jsonb_build_object('claim_id',c.id,'job_id',j.id,'title',j.title,'customer_name',j.customer_name,'active_invoice_item',x.active) order by c.id),'[]'::jsonb) from public.invoice_items x join public.job_claims c on c.id=x.claim_id join public.jobs j on j.id=c.job_id where x.invoice_id=i.id),
   'payments',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'amount',p.amount::text,'currency',p.currency,'paid_at',p.paid_at,'reference',p.reference,'voided_at',p.voided_at,'void_reason',p.void_reason,'reverses_id',null) order by p.created_at,p.id),'[]'::jsonb) from public.payment_records p where p.invoice_id=i.id),
   'tax',jsonb_build_object('status','not_recorded','net',null,'gross',null,'vat_amount',null,'vat_rate',null),'credit_note_reference',null)
  into result from public.invoices i join public.document_versions v on v.id=i.document_version_id left join lateral(select sum(p.amount) total from public.payment_records p where p.invoice_id=i.id and p.voided_at is null) paid on true where i.id=p_id;
 elsif p_source='customer' then
  if not private.can_read_customer_invoice(p_id) then raise exception 'Customer invoice access required' using errcode='42501';end if;
  select jsonb_build_object('id',i.id,'kind','customer_invoice','number',i.number,'issued_on',i.issued_on,'due_on',i.due_on,'currency',i.currency,
   'recorded_total',i.total_amount::text,'paid_total',coalesce(paid.total,0)::numeric(12,2)::text,'outstanding_total',(i.total_amount-coalesce(paid.total,0))::numeric(12,2)::text,
   'status',case when paid.total=i.total_amount then 'paid' when paid.total>0 then 'partially_paid' else 'registered' end,
   'document_id',i.document_id,'document_version_id',i.document_version_id,'document_sha256',i.document_sha256,'organisation_id',i.organisation_id,'organisation_name',o.name,
   'accepted_charge_total',case when private.has_permission('finance.gross.read') then i.accepted_charge_total::text end,
   'difference_reason',case when private.has_permission('finance.gross.read') then i.difference_reason end,
   'assignments',(select coalesce(jsonb_agg(jsonb_build_object('claim_id',case when private.has_permission('finance.gross.read') then x->>'claim_id' end,'job_id',x->>'job_id','title',x->>'title','customer_name',o.name,'active_invoice_item',true)),'[]'::jsonb) from jsonb_array_elements(i.claim_references) x),
   'payments',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'amount',p.amount::text,'currency',i.currency,'paid_at',p.paid_at,'reference',p.reference,'voided_at',null,'void_reason',null,'reverses_id',p.reverses_id) order by p.created_at,p.id),'[]'::jsonb) from private.accounting_customer_payments p where p.invoice_id=i.id),
   'tax',jsonb_build_object('status','not_recorded','net',null,'gross',null,'vat_amount',null,'vat_rate',null),'credit_note_reference',null)
  into result from private.accounting_customer_invoices i join public.organisations o on o.id=i.organisation_id left join lateral(select sum(case when p.reverses_id is null then p.amount else -p.amount end) total from private.accounting_customer_payments p where p.invoice_id=i.id) paid on true where i.id=p_id;
 else raise exception 'Invalid accounting source' using errcode='22023';end if;
 if result is null or length(btrim(result->>'number'))=0 or result->>'document_sha256' is null
  or (result->>'document_sha256')!~'^[a-f0-9]{64}$' or (result->>'paid_total')::numeric<0
  or (result->>'paid_total')::numeric>(result->>'recorded_total')::numeric
  or exists(select 1 from jsonb_array_elements(result->'payments') p where p->>'currency'<>result->>'currency') then
  raise exception 'Incomplete or inconsistent invoice cannot be exported' using errcode='22023';end if;
 return result;
end;$$;
-- Cursor discovery returns original record instants for stable pagination.
create or replace function private.accounting_invoices(p_source text default 'own',p_before_at timestamptz default null,p_before_id uuid default null,p_limit integer default 40) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;total integer;
begin
 if not private.actor_active() or (p_source='lecturer_all' and not private.has_permission('finance.manage')) then raise exception 'Accounting access required' using errcode='42501';end if;
 if p_source is null or p_source not in('own','lecturer_all','customer') or p_limit is null or p_limit not between 1 and 100 or ((p_before_at is null)<>(p_before_id is null)) or (p_before_at is not null and not isfinite(p_before_at)) then raise exception 'Invalid accounting page' using errcode='22023';end if;
 select coalesce(jsonb_agg(x.record||jsonb_build_object('created_at',x.created_at) order by x.created_at desc,x.id desc),'[]'::jsonb),count(*) into result,total from (
  select i.id,i.created_at,private.accounting_record(p_source,i.id) record from public.invoices i where p_source in('own','lecturer_all') and (p_source='lecturer_all' or i.user_id=auth.uid()) and (p_before_at is null or (i.created_at,i.id)<(p_before_at,p_before_id))
  union all
  select i.id,i.created_at,private.accounting_record('customer',i.id) from private.accounting_customer_invoices i where p_source='customer' and private.can_read_customer_invoice(i.id) and (p_before_at is null or (i.created_at,i.id)<(p_before_at,p_before_id))
  order by created_at desc,id desc limit p_limit+1
 ) x;
 return jsonb_build_object('items',case when total>p_limit then result-p_limit else result end,'has_more',total>p_limit);
end;$$;
create or replace function public.accounting_invoices(p_source text default 'own',p_before_at timestamptz default null,p_before_id uuid default null,p_limit integer default 40) returns jsonb language sql stable security invoker set search_path='' as $$select private.accounting_invoices(p_source,p_before_at,p_before_id,p_limit);$$;

-- Stored exports retain their original disclosure level: gaining narrower client
-- membership later cannot unlock a prior gross-finance snapshot.
create or replace function private.accounting_export(p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare e private.accounting_exports;invoice uuid;
begin
 select * into e from private.accounting_exports where id=p_id and actor_id=auth.uid();
 if not found or not private.actor_active() then raise exception 'Own accounting export required' using errcode='42501';end if;
 if e.requires_gross and not private.has_permission('finance.gross.read') then raise exception 'Original gross-finance disclosure is no longer authorized' using errcode='42501';end if;
 foreach invoice in array e.invoice_ids loop perform private.accounting_record(e.source,invoice);end loop;
 return jsonb_build_object('schema_version','luminovia.accounting/1','id',e.id,'source',e.source,'created_at',e.created_at,'sha256',e.sha256,'invoices',e.records);
end;$$;
create or replace function public.accounting_export(p_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$select private.accounting_export(p_id);$$;
-- Snapshot under deterministic source locks. Exact response-loss retries and
-- unchanged-content deduplication retain stable identities without stale writes.
create or replace function private.create_accounting_export(p_source text,p_invoice_ids uuid[],p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare normalized uuid[];invoice uuid;records jsonb:='[]'::jsonb;checksum text;export_id uuid;prior private.accounting_operations;operation jsonb;result jsonb;
begin
 perform 1 from public.profiles p where p.id=auth.uid() and p.active for share;
 if not found or not private.actor_active() then raise exception 'Active account required' using errcode='42501';end if;
 if p_source is null or p_source not in('own','lecturer_all','customer') or p_request_id is null or p_invoice_ids is null or cardinality(p_invoice_ids) not between 1 and 100 then raise exception 'Select one to one hundred invoices' using errcode='22023';end if;
 select array_agg(distinct id order by id) into normalized from unnest(p_invoice_ids) id;
 if cardinality(normalized)<>cardinality(p_invoice_ids) or array_position(normalized,null) is not null then raise exception 'Unique invoice identities required' using errcode='22023';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('accounting-actor:'||auth.uid()::text,0));
 -- Lock source invoices in deterministic order against concurrent payments.
 if p_source='customer' then perform 1 from private.accounting_customer_invoices where id=any(normalized) order by id for update;
 else perform 1 from public.invoices where id=any(normalized) order by id for update;end if;
 foreach invoice in array normalized loop records:=records||jsonb_build_array(private.accounting_record(p_source,invoice));end loop;
 operation:=jsonb_build_object('action','export','source',p_source,'invoice_ids',normalized);
 select * into prior from private.accounting_operations where actor_id=auth.uid() and request_id=p_request_id;
 if found then
  if prior.payload<>operation then raise exception 'Accounting request key conflict' using errcode='22023';end if;
  return private.accounting_export((prior.result->>'id')::uuid);
 end if;
 checksum:=encode(pg_catalog.sha256(convert_to(records::text,'UTF8')),'hex');
 insert into private.accounting_exports(actor_id,source,requires_gross,invoice_ids,records,sha256) values(auth.uid(),p_source,p_source='customer' and private.has_permission('finance.gross.read'),normalized,records,checksum) on conflict(actor_id,source,sha256) do nothing returning id into export_id;
 if export_id is null then select id into export_id from private.accounting_exports where actor_id=auth.uid() and source=p_source and sha256=checksum;end if;
 result:=jsonb_build_object('id',export_id);
 insert into private.accounting_operations(actor_id,request_id,payload,result) values(auth.uid(),p_request_id,operation,result);
 insert into public.audit_events(actor_id,action,resource_id,details) values(auth.uid(),'accounting.export_created',export_id,jsonb_build_object('count',cardinality(normalized),'source',p_source));
 return private.accounting_export(export_id);
end;$$;
create or replace function public.create_accounting_export(p_source text,p_invoice_ids uuid[],p_request_id uuid) returns jsonb language sql security invoker set search_path='' as $$select private.create_accounting_export(p_source,p_invoice_ids,p_request_id);$$;

revoke execute on function private.immutable_accounting_record(),private.freeze_accounting_document(),private.separate_customer_invoice_pdf() from public,anon,authenticated,service_role;
revoke execute on function private.can_read_customer_invoice(uuid),private.accounting_access(),public.accounting_access(),private.accounting_customer_claims(),public.accounting_customer_claims(),private.register_customer_invoice(jsonb,uuid),public.register_customer_invoice(jsonb,uuid),private.customer_invoice_payment(uuid,text,timestamptz,text,uuid,uuid),public.record_customer_invoice_payment(uuid,text,timestamptz,text,uuid),public.reverse_customer_invoice_payment(uuid,uuid,text,uuid),private.accounting_record(text,uuid),private.accounting_invoices(text,timestamptz,uuid,integer),public.accounting_invoices(text,timestamptz,uuid,integer),private.accounting_export(uuid),public.accounting_export(uuid),private.create_accounting_export(text,uuid[],uuid),public.create_accounting_export(text,uuid[],uuid) from public,anon,authenticated,service_role;
grant execute on function private.can_read_customer_invoice(uuid),private.accounting_access(),public.accounting_access(),private.accounting_customer_claims(),public.accounting_customer_claims(),private.register_customer_invoice(jsonb,uuid),public.register_customer_invoice(jsonb,uuid),private.customer_invoice_payment(uuid,text,timestamptz,text,uuid,uuid),public.record_customer_invoice_payment(uuid,text,timestamptz,text,uuid),public.reverse_customer_invoice_payment(uuid,uuid,text,uuid),private.accounting_record(text,uuid),private.accounting_invoices(text,timestamptz,uuid,integer),public.accounting_invoices(text,timestamptz,uuid,integer),private.accounting_export(uuid),public.accounting_export(uuid),private.create_accounting_export(text,uuid[],uuid),public.create_accounting_export(text,uuid[],uuid) to authenticated;
commit;
