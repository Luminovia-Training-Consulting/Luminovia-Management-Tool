-- TEST ONLY: minimal optional-registry metadata, not domain-module acceptance.
-- The exact enquiry public/definer RPC below is copied unchanged with provenance
-- in course-private-registry-contract.json. Other domains use document_id only.
create table private.support_attachments(document_id uuid primary key references public.documents(id));
create table private.accounting_customer_invoices(document_id uuid primary key references public.documents(id));
create table private.website_enquiries(id uuid primary key,version integer not null default 1,updated_at timestamptz default clock_timestamp());
create table private.website_enquiry_events(enquiry_id uuid,actor_id uuid,action text,reason text);
create table private.website_enquiry_attachments(id uuid primary key default gen_random_uuid(),enquiry_id uuid not null references private.website_enquiries(id),document_id uuid not null unique references public.documents(id),version_id uuid not null unique references public.document_versions(id),label text,attached_by uuid,attached_at timestamptz default clock_timestamp());
create table private.website_enquiry_attachment_requests(actor_id uuid,request_id uuid,signature jsonb,attachment_id uuid,primary key(actor_id,request_id));
revoke all on private.support_attachments,private.accounting_customer_invoices,private.website_enquiries,private.website_enquiry_events,private.website_enquiry_attachments,private.website_enquiry_attachment_requests from public,anon,authenticated,service_role;
create function private.attach_enquiry_document(p_enquiry_id uuid,p_version_id uuid,p_label text,p_expected_version integer,p_request_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare enquiry private.website_enquiries; previous private.website_enquiry_attachment_requests; d public.documents; v public.document_versions;
 signature jsonb; result uuid; document uuid; shared_resource boolean:=false; course_registry regclass;
begin
 perform 1 from public.profiles where id=auth.uid() and active for share;
 if not found or not private.has_permission('organisations.manage') then raise exception 'Enquiry management permission required' using errcode='42501';end if;
 if p_enquiry_id is null or p_version_id is null or p_request_id is null or p_expected_version is null
 or p_label is null or length(trim(p_label)) not between 1 and 200 then raise exception 'Reviewed enquiry, exact clean version, document purpose and request key required' using errcode='22023';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('enquiry-actor:'||auth.uid()::text,0));
 select * into enquiry from private.website_enquiries where id=p_enquiry_id for update;
 if not found or not private.has_permission('organisations.manage') then raise exception 'Enquiry management permission required' using errcode='42501';end if;
 signature=jsonb_build_object('enquiry',p_enquiry_id,'version',p_version_id,'label',trim(p_label),'expected',p_expected_version);
 select * into previous from private.website_enquiry_attachment_requests where actor_id=auth.uid() and request_id=p_request_id;
 if found then
  if previous.signature<>signature then raise exception 'Enquiry attachment retry conflict' using errcode='22023';end if;
  return previous.attachment_id;
 end if;
 if enquiry.version<>p_expected_version then raise exception 'Enquiry changed; reload' using errcode='40001';end if;
 if enquiry.version=2147483647 then raise exception 'Enquiry version limit' using errcode='54000';end if;
 select document_id into document from public.document_versions where id=p_version_id;
 select * into d from public.documents where id=document for update;
 select * into v from public.document_versions where id=p_version_id for share;
 course_registry=to_regclass('private.course_resources');
 if course_registry is not null then
  execute format('select exists(select 1 from %s r join public.document_versions v on v.id=r.version_id where v.document_id=$1)',course_registry)
   into shared_resource using d.id;
 end if;
 -- Only a new single-version upload can be dedicated. A contract, invoice,
 -- certificate, room file or document with previous versions cannot be reused.
 if d.id is null or v.id is null or v.document_id<>d.id or d.current_version_id is distinct from v.id
 or d.owner_id<>auth.uid() or d.uploaded_by<>auth.uid() or v.uploaded_by<>auth.uid()
 or d.scope<>'personal' or d.kind<>'material' or d.status<>'clean' or d.deleted_at is not null
 or v.status<>'clean' or v.sha256 is null or v.version<>1
 or (select count(*) from public.document_versions where document_id=d.id)<>1
 or exists(select 1 from private.support_attachments where document_id=d.id)
 or exists(select 1 from private.website_enquiry_attachments where document_id=d.id) or shared_resource then
  raise exception 'A dedicated own current scanned material upload is required' using errcode='42501';
 end if;
 insert into private.website_enquiry_attachments(enquiry_id,document_id,version_id,label,attached_by)
 values(enquiry.id,d.id,v.id,trim(p_label),auth.uid()) returning id into result;
 update private.website_enquiries set version=version+1,updated_at=clock_timestamp() where id=enquiry.id;
 insert into private.website_enquiry_attachment_requests values(auth.uid(),p_request_id,signature,result);
 insert into private.website_enquiry_events(enquiry_id,actor_id,action,reason) values(enquiry.id,auth.uid(),'document_attached',trim(p_label));
 insert into public.audit_events(actor_id,action,resource_id,details) values(auth.uid(),'enquiry.document_attached',enquiry.id,jsonb_build_object('attachment_id',result));
 return result;
end;$$;
create function public.attach_enquiry_document(p_enquiry_id uuid,p_version_id uuid,p_label text,p_expected_version integer,p_request_id uuid) returns uuid
language sql security invoker set search_path='' as $$select private.attach_enquiry_document(p_enquiry_id,p_version_id,p_label,p_expected_version,p_request_id);$$;

revoke all on function private.attach_enquiry_document(uuid,uuid,text,integer,uuid),public.attach_enquiry_document(uuid,uuid,text,integer,uuid) from public,anon,authenticated,service_role;
grant execute on function private.attach_enquiry_document(uuid,uuid,text,integer,uuid),public.attach_enquiry_document(uuid,uuid,text,integer,uuid) to authenticated;
