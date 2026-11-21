begin;

-- This record describes an externally issued document. It never creates an
-- invoice entry, cash movement, refund, tax entry or a debit/credit allocation.
create table private.accounting_customer_credit_notes (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references private.accounting_customer_invoices(id),
  organisation_id uuid not null references public.organisations(id),
  registered_by uuid not null references public.profiles(id),
  reference text not null check (length(reference) between 1 and 80),
  issued_on date not null,
  currency text not null check (currency in ('EUR','AUD')),
  amount numeric(12,2) not null check (amount > 0),
  reason text not null check (length(reason) between 5 and 1000),
  document_id uuid not null unique references public.documents(id),
  document_version_id uuid not null unique references public.document_versions(id),
  document_sha256 text not null check (document_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  unique (organisation_id, document_sha256)
);
create unique index accounting_customer_credit_note_reference
  on private.accounting_customer_credit_notes (organisation_id, lower(reference));
create index accounting_customer_credit_note_invoice
  on private.accounting_customer_credit_notes (invoice_id, created_at desc, id desc);
create index accounting_customer_credit_note_registrar
  on private.accounting_customer_credit_notes (registered_by);
alter table private.accounting_customer_credit_notes enable row level security;
revoke all on private.accounting_customer_credit_notes from public, anon, authenticated, service_role;
create trigger immutable_customer_credit_note before update or delete
  on private.accounting_customer_credit_notes for each row execute function private.immutable_accounting_record();

create function private.can_manage_customer_credit_notes()
returns boolean language sql stable security invoker set search_path = '' as $$
  select private.actor_active() and private.has_permission('finance.gross.read')
    and exists (select 1 from private.installation_identity where edition = 'internal');
$$;
revoke all on function private.can_manage_customer_credit_notes()
  from public, anon, authenticated, service_role;

create function private.register_customer_credit_note(p_invoice_id uuid, p_payload jsonb, p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  invoice private.accounting_customer_invoices;
  note_id uuid;
  document public.documents;
  version public.document_versions;
  version_id uuid;
  previous private.accounting_operations;
  command jsonb;
  result jsonb;
  note_reference text;
  issue_date date;
  note_currency text;
  note_amount numeric;
  note_reason text;
begin
  perform 1 from public.profiles profile where profile.id = auth.uid() and profile.active for share;
  if not found or not private.can_manage_customer_credit_notes() then
    raise exception 'Customer finance permission required' using errcode = '42501';
  end if;
  if p_invoice_id is null or p_request_id is null or jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception 'Invoice, credit note fields and request ID required' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_object_keys(p_payload)) <> 7
    or not (p_payload ?& array['reference','issued_on','currency','amount','document_version_id','reason','issued_and_reviewed'])
    or p_payload->'issued_and_reviewed' is distinct from 'true'::jsonb
    or exists (
      select 1 from jsonb_each(p_payload) field
      where field.key <> 'issued_and_reviewed' and jsonb_typeof(field.value) <> 'string'
    ) then
    raise exception 'Explicitly reviewed, already-issued credit note fields required' using errcode = '22023';
  end if;
  if p_payload->>'amount' !~ '^(0|[1-9][0-9]{0,9})\.[0-9]{2}$'
    or p_payload->>'issued_on' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception 'Exact decimal amount and an issue date required' using errcode = '22023';
  end if;
  begin
    issue_date := (p_payload->>'issued_on')::date;
    version_id := (p_payload->>'document_version_id')::uuid;
  exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
    raise exception 'Invalid credit note date or document identifier' using errcode = '22023';
  end;
  note_reference := btrim(p_payload->>'reference');
  note_reason := btrim(p_payload->>'reason');
  note_currency := p_payload->>'currency';
  note_amount := (p_payload->>'amount')::numeric;
  if length(note_reference) not between 1 and 80 or note_reference ~ '[[:cntrl:]]'
    or length(note_reason) not between 5 and 1000 or note_currency not in ('EUR','AUD') or note_amount <= 0
    or issue_date > (clock_timestamp() at time zone 'Pacific/Kiritimati')::date then
    raise exception 'Invalid issued credit note metadata' using errcode = '22023';
  end if;

  -- Share the existing exact accounting retry namespace and invoice row lock.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('accounting-actor:'||auth.uid()::text,0));
  command := jsonb_build_object('action','register_customer_credit_note','invoice_id',p_invoice_id,'payload',p_payload);
  select * into previous from private.accounting_operations where actor_id = auth.uid() and request_id = p_request_id;
  if found then
    if previous.payload is distinct from command then
      raise exception 'Accounting request key conflict' using errcode = '22023';
    end if;
    return previous.result;
  end if;
  select * into invoice from private.accounting_customer_invoices where id = p_invoice_id for update;
  if not found then raise exception 'Customer invoice unavailable' using errcode = '42501'; end if;
  if note_currency <> invoice.currency or issue_date < invoice.issued_on then
    raise exception 'Use the original invoice currency and a date on or after issuance' using errcode = '22023';
  end if;
  if note_amount + (select coalesce(sum(note.amount),0) from private.accounting_customer_credit_notes note
                   where note.invoice_id = invoice.id) > invoice.total_amount then
    raise exception 'Documented credits exceed the original invoice amount' using errcode = '22023';
  end if;

  select * into version from public.document_versions where id = version_id;
  select * into document from public.documents where id = version.document_id for update;
  select * into version from public.document_versions where id = version_id for update;
  if document.id is null or document.owner_id <> auth.uid() or document.uploaded_by <> auth.uid()
    or version.uploaded_by <> auth.uid() or document.scope <> 'personal' or document.kind <> 'material'
    or document.deleted_at is not null or document.current_version_id is distinct from version.id
    or document.status <> 'clean' or version.status <> 'clean' or version.mime_type <> 'application/pdf'
    or document.mime_type <> 'application/pdf' or version.sha256 is null
    or (select count(*) from public.document_versions v where v.document_id = document.id) <> 1 then
    raise exception 'Own dedicated clean single-version PDF required' using errcode = '42501';
  end if;
  if private.deletion_document_fenced(document.id) or private.course_document_is_dedicated(document.id)
    or exists (select 1 from private.course_resources resource where resource.version_id = version.id)
    or exists (select 1 from private.wiki_revision_attachments attachment where attachment.version_id = version.id)
    or exists (select 1 from public.messages where document_id = document.id)
    or exists (select 1 from public.invoices where document_version_id = version.id)
    or exists (select 1 from public.contracts where document_version_id = version.id)
    or exists (select 1 from private.qualification_evidence where document_version_id = version.id)
    or exists (select 1 from private.course_exam_documents exam where exam.version_id = version.id)
    or exists (select 1 from private.course_attendance_evidence evidence where evidence.version_id = version.id) then
    raise exception 'Credit note requires a dedicated PDF without previous attachments' using errcode = '42501';
  end if;
  if exists (
    select 1 from private.accounting_customer_invoices original
    where original.organisation_id = invoice.organisation_id and original.document_sha256 = version.sha256
  ) then
    raise exception 'An original invoice PDF cannot be reused as a credit note' using errcode = '22023';
  end if;

  update public.documents set kind = 'invoice' where id = document.id;
  insert into private.accounting_customer_credit_notes (
    invoice_id, organisation_id, registered_by, reference, issued_on, currency, amount, reason,
    document_id, document_version_id, document_sha256
  ) values (
    invoice.id, invoice.organisation_id, auth.uid(), note_reference, issue_date, invoice.currency,
    note_amount, note_reason, document.id, version.id, version.sha256
  ) returning id into note_id;
  result := jsonb_build_object('id',note_id);
  insert into private.accounting_operations(actor_id,request_id,payload,result)
    values(auth.uid(),p_request_id,command,result);
  insert into public.audit_events(actor_id,action,resource_id)
    values(auth.uid(),'accounting.customer_credit_note_registered',note_id);
  return result;
end;
$$;

create function private.accounting_customer_credit_notes(
  p_invoice_id uuid, p_before_at timestamptz default null,
  p_before_id uuid default null, p_limit integer default 40
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if not private.can_manage_customer_credit_notes() or not exists (
    select 1 from private.accounting_customer_invoices invoice where invoice.id = p_invoice_id
  ) then
    raise exception 'Customer finance permission and invoice required' using errcode = '42501';
  end if;
  if p_limit is null or p_limit not between 1 and 100 or (p_before_at is null) <> (p_before_id is null)
    or (p_before_at is not null and not isfinite(p_before_at)) then
    raise exception 'Invalid customer credit note page cursor' using errcode = '22023';
  end if;
  select jsonb_build_object(
    'items',coalesce(jsonb_agg(jsonb_build_object(
      'id',note.id,'invoice_id',note.invoice_id,'reference',note.reference,'issued_on',note.issued_on,
      'currency',note.currency,'amount',note.amount::text,'reason',note.reason,'document_id',note.document_id,
      'document_version_id',note.document_version_id,'document_sha256',note.document_sha256,'created_at',note.created_at
    ) order by note.position) filter (where note.position <= p_limit), '[]'::jsonb),
    'has_more',count(*) > p_limit
  ) into result
  from (
    select record.*, row_number() over (order by record.created_at desc, record.id desc) position
    from private.accounting_customer_credit_notes record
    where record.invoice_id = p_invoice_id and
      (p_before_at is null or (record.created_at,record.id) < (p_before_at,p_before_id))
    order by record.created_at desc, record.id desc
    limit p_limit + 1
  ) note;
  return result;
end;
$$;

create function public.register_customer_credit_note(p_invoice_id uuid, p_payload jsonb, p_request_id uuid)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.register_customer_credit_note(p_invoice_id,p_payload,p_request_id);
$$;
create function public.accounting_customer_credit_notes(
  p_invoice_id uuid, p_before_at timestamptz default null,
  p_before_id uuid default null, p_limit integer default 40
) returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.accounting_customer_credit_notes(p_invoice_id,p_before_at,p_before_id,p_limit);
$$;
revoke all on function private.register_customer_credit_note(uuid,jsonb,uuid),
  public.register_customer_credit_note(uuid,jsonb,uuid),
  private.accounting_customer_credit_notes(uuid,timestamptz,uuid,integer),
  public.accounting_customer_credit_notes(uuid,timestamptz,uuid,integer)
from public, anon, authenticated, service_role;
grant execute on function private.register_customer_credit_note(uuid,jsonb,uuid),
  public.register_customer_credit_note(uuid,jsonb,uuid),
  private.accounting_customer_credit_notes(uuid,timestamptz,uuid,integer),
  public.accounting_customer_credit_notes(uuid,timestamptz,uuid,integer)
to authenticated;

create function private.accounting_pdf_is_retained(p_document_id uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists (select 1 from private.accounting_customer_invoices i where i.document_id = p_document_id)
    or exists (select 1 from private.accounting_customer_credit_notes c where c.document_id = p_document_id);
$$;
revoke all on function private.accounting_pdf_is_retained(uuid) from public, anon, authenticated, service_role;
create or replace function private.freeze_accounting_document()
returns trigger language plpgsql security definer set search_path = '' as $$
declare document_id uuid;
begin
  if tg_table_name = 'documents' then document_id := old.id;
  elsif tg_op = 'INSERT' then document_id := new.document_id;
  else document_id := old.document_id;
  end if;
  if private.accounting_pdf_is_retained(document_id) then
    raise exception 'Customer accounting PDF evidence is immutable' using errcode = '23514';
  end if;
  if tg_table_name = 'document_versions' and tg_op = 'UPDATE' then
    if new.document_id is distinct from old.document_id and private.accounting_pdf_is_retained(new.document_id) then
      raise exception 'Customer accounting PDF evidence is immutable' using errcode = '23514';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

-- Keep existing RLS policy function identities and dedicated registry readers.
do $migration$
declare definition text; edited text;
begin
  definition := pg_catalog.pg_get_functiondef('private.can_access_document(uuid)'::regprocedure);
  edited := replace(definition,
    $old$ select id into invoice from private.accounting_customer_invoices where document_id=p_id;$old$,
    $new$ if exists (select 1 from private.accounting_customer_credit_notes credit where credit.document_id=p_id) then
  return private.can_manage_customer_credit_notes() and exists (
    select 1 from public.documents d where d.id=p_id and d.deleted_at is null and d.status='clean' and d.kind='invoice'
  );
 end if;
 select id into invoice from private.accounting_customer_invoices where document_id=p_id;$new$);
  if edited = definition then raise exception 'Credit note document access seam missing'; end if;
  execute edited;

  definition := pg_catalog.pg_get_functiondef('private.course_document_in_original_registry(uuid)'::regprocedure);
  edited := replace(definition, '''private.accounting_customer_invoices''',
    '''private.accounting_customer_invoices'',''private.accounting_customer_credit_notes''');
  if edited = definition then raise exception 'Credit note document registry seam missing'; end if;
  execute edited;

  definition := pg_catalog.pg_get_functiondef('private.separate_customer_invoice_pdf()'::regprocedure);
  edited := replace(definition,
    'exists(select 1 from private.accounting_customer_invoices where document_version_id=new.document_version_id)',
    '(exists(select 1 from private.accounting_customer_invoices where document_version_id=new.document_version_id) or
     exists(select 1 from private.accounting_customer_credit_notes where document_version_id=new.document_version_id))');
  if edited = definition then raise exception 'Credit note lecturer evidence isolation seam missing'; end if;
  execute edited;
end;
$migration$;

notify pgrst, 'reload schema';
commit;
