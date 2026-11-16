-- Additive private intake/triage ledger. Historical migrations and existing
-- customer/claim/commercial records are not rewritten by this extension.
begin;

-- Unauthenticated website input is not an authenticated customer request or a
-- financial agreement. Only the authenticated integration worker can receive it.
create table private.website_enquiries (
 id uuid primary key default gen_random_uuid(),
 sender_hash text not null check(sender_hash~'^[a-f0-9]{64}$'),
 submission_id uuid not null,
 payload jsonb not null,
 status text not null default 'received' check(status in ('received','reviewing','awaiting_customer','converted','closed')),
 responsible_id uuid references public.profiles(id),
 organisation_id uuid references public.organisations(id),
 course_run_id uuid unique references public.course_runs(id),
 version integer not null default 1 check(version>0),
 received_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 unique(sender_hash,submission_id)
);
create index website_enquiry_cursor on private.website_enquiries(updated_at desc,id desc);
create index website_enquiry_sender_rate on private.website_enquiries(sender_hash,received_at desc);
create table private.website_enquiry_events (
 id uuid primary key default gen_random_uuid(),
 enquiry_id uuid not null references private.website_enquiries(id),
 actor_id uuid references public.profiles(id),
 action text not null,
 reason text not null default '' check(length(reason)<=4000),
 created_at timestamptz not null default clock_timestamp()
);
create index website_enquiry_event_cursor on private.website_enquiry_events(enquiry_id,created_at,id);
create table private.website_enquiry_requests (
 actor_id uuid not null references public.profiles(id),
 request_id uuid not null,
 signature jsonb not null,
 enquiry_id uuid not null references private.website_enquiries(id),
 primary key(actor_id,request_id)
);
alter table private.website_enquiries enable row level security;
alter table private.website_enquiry_events enable row level security;
alter table private.website_enquiry_requests enable row level security;
revoke all on private.website_enquiries,private.website_enquiry_events,private.website_enquiry_requests from public,anon,authenticated;

-- Service-only entry point: a sender lock serialises both duplicate detection
-- and persisted rate checks, so concurrent retries cannot create extra records.
create function private.receive_website_enquiry(p_sender_hash text,p_submission_id uuid,p_payload jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare previous private.website_enquiries; target uuid;
begin
 if p_sender_hash is null or p_sender_hash!~'^[a-f0-9]{64}$' or p_submission_id is null or p_payload is null or jsonb_typeof(p_payload)<>'object'
 or exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('company_name','contact_name','email','phone','topic','message','preferred_dates','duration','delivery_type','time_zone','locale','privacy_notice_version','consent'))
 or exists(select 1 from unnest(array['company_name','contact_name','email','phone','topic','message','preferred_dates','duration','delivery_type','time_zone','locale','privacy_notice_version']) k where jsonb_typeof(p_payload->k) is distinct from 'string')
 or length(trim(p_payload->>'company_name')) not between 1 and 200 or length(trim(p_payload->>'contact_name')) not between 1 and 120
 or length(p_payload->>'email') not between 3 and 254 or p_payload->>'email' !~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
 or length(p_payload->>'phone')>60 or (p_payload->>'phone')~'[[:cntrl:]]' or length(trim(p_payload->>'topic')) not between 1 and 200
 or length(trim(p_payload->>'message')) not between 1 and 12000 or length(p_payload->>'preferred_dates')>1000 or length(p_payload->>'duration')>200
 or p_payload->>'delivery_type' not in ('online','onsite','flexible') or p_payload->>'locale' not in ('de','en')
 or not exists(select 1 from pg_catalog.pg_timezone_names where name=p_payload->>'time_zone')
 or length(p_payload->>'privacy_notice_version') not between 1 and 120 or p_payload->'consent' is distinct from 'true'::jsonb then raise exception 'Invalid website enquiry' using errcode='22023'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('website-enquiry:'||p_sender_hash,0));
 select * into previous from private.website_enquiries where sender_hash=p_sender_hash and submission_id=p_submission_id;
 if found then
  if previous.payload<>p_payload then raise exception 'Website enquiry retry conflict' using errcode='22023'; end if;
  return previous.id;
 end if;
 if (select count(*) from private.website_enquiries where sender_hash=p_sender_hash and received_at>clock_timestamp()-interval '1 minute')>=10
 or (select count(*) from private.website_enquiries where sender_hash=p_sender_hash and received_at>clock_timestamp()-interval '24 hours')>=100 then raise exception 'Website enquiry rate limit' using errcode='54000'; end if;
 insert into private.website_enquiries(sender_hash,submission_id,payload) values(p_sender_hash,p_submission_id,p_payload) returning id into target;
 insert into private.website_enquiry_events(enquiry_id,action) values(target,'received');
 -- Notification payloads retain only a reference, never contact or enquiry text.
 insert into public.notifications(user_id,kind,resource_id)
  select distinct p.id,'website_enquiry',target from public.profiles p join public.user_roles ur on ur.user_id=p.id join public.role_permissions rp on rp.role=ur.role
   where p.active and rp.permission='organisations.manage' on conflict do nothing;
 return target;
end;$$;
create function public.receive_website_enquiry(p_sender_hash text,p_submission_id uuid,p_payload jsonb) returns uuid
language sql security invoker set search_path='' as $$select private.receive_website_enquiry(p_sender_hash,p_submission_id,p_payload);$$;

-- Return only choices independently permitted by current management/MFA checks.
create function private.enquiry_context() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare organisations jsonb; templates jsonb; staff jsonb;
begin
 if not private.has_permission('organisations.manage') then raise exception 'Enquiry management and MFA required' using errcode='42501'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'label',name) order by name,id),'[]'::jsonb) into organisations from public.organisations where archived_at is null;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'label',title) order by title,id),'[]'::jsonb) into templates from public.course_templates where archived_at is null and private.has_permission('courses.manage');
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'label',p.display_name) order by p.display_name,p.id),'[]'::jsonb) into staff from public.profiles p where p.active and exists(select 1 from public.user_roles ur join public.role_permissions rp on rp.role=ur.role where ur.user_id=p.id and rp.permission='organisations.manage');
 return jsonb_build_object('organisations',organisations,'templates',templates,'staff',staff,'can_convert',private.has_permission('courses.manage'));
end;$$;
create function public.enquiry_context() returns jsonb language sql stable security invoker set search_path='' as $$select private.enquiry_context();$$;

-- Bounded tuple pagination omits contact payloads until an authorised detail read.
create function private.enquiry_inbox(p_search text default '',p_status text default '',p_before_at timestamptz default null,p_before_id uuid default null,p_limit integer default 40) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare items jsonb; more boolean; last_row jsonb;
begin
 if not private.has_permission('organisations.manage') then raise exception 'Enquiry management and MFA required' using errcode='42501'; end if;
 if p_search is null or length(p_search)>200 or p_status is null or p_status not in ('','received','reviewing','awaiting_customer','converted','closed') or p_limit is null or p_limit not between 1 and 100 or (p_before_at is null)<>(p_before_id is null) or (p_before_at is not null and not isfinite(p_before_at)) then raise exception 'Invalid enquiry filter' using errcode='22023'; end if;
 select coalesce(jsonb_agg(to_jsonb(r) order by updated_at desc,id desc),'[]'::jsonb) into items from (
  select e.id,e.payload->>'company_name' company_name,e.payload->>'topic' topic,e.status,e.version,e.received_at,e.updated_at,p.display_name responsible_name
  from private.website_enquiries e left join public.profiles p on p.id=e.responsible_id where (p_status='' or e.status=p_status)
   and (p_search='' or position(lower(trim(p_search)) in lower((e.payload->>'company_name')||' '||(e.payload->>'topic')||' '||(e.payload->>'email')))>0)
   and (p_before_at is null or (e.updated_at,e.id)<(p_before_at,p_before_id)) order by e.updated_at desc,e.id desc limit p_limit+1
 ) r;
 more:=jsonb_array_length(items)>p_limit;if more then items:=items-(jsonb_array_length(items)-1);end if;last_row:=items->(jsonb_array_length(items)-1);
 return jsonb_build_object('items',items,'has_more',more,'next_cursor',case when more then jsonb_build_object('at',last_row->>'updated_at','id',last_row->>'id') else null end);
end;$$;
create function public.enquiry_inbox(p_search text default '',p_status text default '',p_before_at timestamptz default null,p_before_id uuid default null,p_limit integer default 40) returns jsonb
language sql stable security invoker set search_path='' as $$select private.enquiry_inbox(p_search,p_status,p_before_at,p_before_id,p_limit);$$;

-- Original identity/consent and management history never have a customer/public projection.
create function private.enquiry_detail(p_enquiry_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare enquiry private.website_enquiries; history jsonb;
begin
 if not private.has_permission('organisations.manage') then raise exception 'Enquiry management and MFA required' using errcode='42501'; end if;
 select * into enquiry from private.website_enquiries where id=p_enquiry_id;if not found then raise exception 'Enquiry unavailable' using errcode='42501'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'action',e.action,'reason',e.reason,'actor_name',p.display_name,'created_at',e.created_at) order by e.created_at,e.id),'[]'::jsonb) into history from private.website_enquiry_events e left join public.profiles p on p.id=e.actor_id where e.enquiry_id=p_enquiry_id;
 return jsonb_build_object('id',enquiry.id,'payload',enquiry.payload,'status',enquiry.status,'responsible_id',enquiry.responsible_id,
  'organisation_id',enquiry.organisation_id,'course_run_id',case when private.has_permission('courses.manage') then enquiry.course_run_id else null end,
  'version',enquiry.version,'received_at',enquiry.received_at,'updated_at',enquiry.updated_at,'history',history);
end;$$;
create function public.enquiry_detail(p_enquiry_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$select private.enquiry_detail(p_enquiry_id);$$;

-- Lock order is caller request namespace then enquiry row. Retry identity is
-- checked before CAS so an already committed decision remains safely retryable.
-- Customer/contact and course conversion run in this same transaction; failures
-- roll back all derived records, while the original validated payload is untouched.
create function private.manage_enquiry(p_enquiry_id uuid,p_action text,p_payload jsonb,p_expected_version integer,p_request_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare enquiry private.website_enquiries; previous private.website_enquiry_requests; signature jsonb; target uuid; reason text:=''; run_payload jsonb; template uuid;
begin
 if not private.has_permission('organisations.manage') then raise exception 'Enquiry management and MFA required' using errcode='42501'; end if;
 if p_action is null or p_action not in ('status','assign','link_customer','create_customer','convert','note') or p_payload is null or jsonb_typeof(p_payload)<>'object' or p_expected_version is null or p_request_id is null then raise exception 'Invalid enquiry action' using errcode='22023'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('enquiry-actor:'||auth.uid()::text,0));
 select * into enquiry from private.website_enquiries where id=p_enquiry_id for update;if not found then raise exception 'Enquiry unavailable' using errcode='42501'; end if;
 signature:=jsonb_build_object('id',p_enquiry_id,'action',p_action,'payload',p_payload,'version',p_expected_version);
 select * into previous from private.website_enquiry_requests where actor_id=auth.uid() and request_id=p_request_id;
 if found then if previous.signature<>signature then raise exception 'Enquiry retry conflict' using errcode='22023';end if;return previous.enquiry_id;end if;
 if enquiry.version<>p_expected_version then raise exception 'Enquiry changed; reload' using errcode='40001'; end if;
 if enquiry.version=2147483647 then raise exception 'Enquiry version limit' using errcode='54000'; end if;
 if p_action='status' then
  reason:=trim(coalesce(p_payload->>'reason',''));
  if exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('status','reason')) or length(reason) not between 1 and 4000
   or p_payload->>'status' is null or not ((enquiry.status='received' and p_payload->>'status' in ('reviewing','closed')) or (enquiry.status='reviewing' and p_payload->>'status' in ('awaiting_customer','closed')) or (enquiry.status='awaiting_customer' and p_payload->>'status' in ('reviewing','closed')) or (enquiry.status='closed' and p_payload->>'status'='reviewing')) then raise exception 'Invalid enquiry status transition' using errcode='22023'; end if;
  update private.website_enquiries set status=p_payload->>'status' where id=enquiry.id;
 elsif p_action='note' then
  reason:=trim(coalesce(p_payload->>'note',''));
  if exists(select 1 from jsonb_object_keys(p_payload) k where k<>'note') or length(reason) not between 1 and 4000 then raise exception 'Enquiry note required' using errcode='22023';end if;
 elsif p_action='assign' then
  if exists(select 1 from jsonb_object_keys(p_payload) k where k<>'user_id') then raise exception 'Invalid enquiry assignee' using errcode='22023';end if;
  target:=nullif(p_payload->>'user_id','')::uuid;
  if target is not null and not exists(select 1 from public.profiles p where p.id=target and p.active and exists(select 1 from public.user_roles ur join public.role_permissions rp on rp.role=ur.role where ur.user_id=p.id and rp.permission='organisations.manage')) then raise exception 'Enquiry assignee unavailable' using errcode='22023';end if;
  update private.website_enquiries set responsible_id=target where id=enquiry.id;
 elsif p_action='link_customer' then
  if exists(select 1 from jsonb_object_keys(p_payload) k where k<>'organisation_id') then raise exception 'Invalid enquiry customer' using errcode='22023';end if;
  if enquiry.course_run_id is not null then raise exception 'Converted enquiry customer is preserved' using errcode='22023';end if;
  target:=nullif(p_payload->>'organisation_id','')::uuid;
  if target is null or not exists(select 1 from public.organisations where id=target and archived_at is null) then raise exception 'Enquiry customer unavailable' using errcode='22023';end if;
  update private.website_enquiries set organisation_id=target where id=enquiry.id;
 elsif p_action='create_customer' then
  if p_payload<>'{}'::jsonb or enquiry.organisation_id is not null or enquiry.course_run_id is not null then raise exception 'Enquiry customer already linked' using errcode='22023';end if;
  target:=private.save_organisation(null,jsonb_build_object('name',enquiry.payload->>'company_name','time_zone',enquiry.payload->>'time_zone'));
  perform private.save_organisation_contact(null,target,jsonb_build_object('name',enquiry.payload->>'contact_name','email',enquiry.payload->>'email','phone',enquiry.payload->>'phone'));
  update private.website_enquiries set organisation_id=target where id=enquiry.id;
 elsif p_action='convert' then
  if not private.has_permission('courses.manage') then raise exception 'Course management and MFA required' using errcode='42501';end if;
  if enquiry.organisation_id is null or enquiry.course_run_id is not null or enquiry.status not in ('received','reviewing','awaiting_customer') then raise exception 'Enquiry cannot be converted' using errcode='22023';end if;
  if exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('template_id','sessions','time_zone','delivery_type','venue')) then raise exception 'Invalid enquiry conversion' using errcode='22023';end if;
  perform 1 from public.organisations where id=enquiry.organisation_id and archived_at is null for share;if not found then raise exception 'Enquiry customer unavailable' using errcode='22023';end if;
  template:=nullif(p_payload->>'template_id','')::uuid;
  if template is null then template:=private.save_course_template(null,jsonb_build_object('title',enquiry.payload->>'topic','description',enquiry.payload->>'message','prerequisites','','topic_ids','[]'::jsonb));
  else perform 1 from public.course_templates where id=template and archived_at is null for share;if not found then raise exception 'Course template unavailable' using errcode='22023';end if;end if;
  if p_payload->>'delivery_type' is null or p_payload->>'delivery_type' not in ('online','onsite') or not exists(select 1 from pg_catalog.pg_timezone_names where name=p_payload->>'time_zone') then raise exception 'Valid delivery mode and time zone required' using errcode='22023';end if;
  run_payload:=jsonb_build_object('template_id',template,'organisation_id',enquiry.organisation_id,'sessions',p_payload->'sessions','time_zone',p_payload->>'time_zone','delivery_type',p_payload->>'delivery_type','venue',coalesce(p_payload->>'venue',''),'published',false,'archived',false);
  target:=private.save_course_run(null,run_payload);
  update private.website_enquiries set course_run_id=target,status='converted' where id=enquiry.id;
 end if;
 update private.website_enquiries set version=version+1,updated_at=clock_timestamp() where id=enquiry.id;
 insert into private.website_enquiry_requests values(auth.uid(),p_request_id,signature,enquiry.id);
 insert into private.website_enquiry_events(enquiry_id,actor_id,action,reason) values(enquiry.id,auth.uid(),p_action,reason);
 insert into public.audit_events(actor_id,action,resource_id) values(auth.uid(),'enquiry.'||p_action,enquiry.id);
 return enquiry.id;
end;$$;
create function public.manage_enquiry(p_enquiry_id uuid,p_action text,p_payload jsonb,p_expected_version integer,p_request_id uuid) returns uuid
language sql security invoker set search_path='' as $$select private.manage_enquiry(p_enquiry_id,p_action,p_payload,p_expected_version,p_request_id);$$;

-- Central inbox integration can call this under its own definer boundary;
-- it resolves a destination only under current management authority, never PII.
create function private.enquiry_notification_target(p_kind text,p_resource uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('href',case when p_kind='website_enquiry' and private.has_permission('organisations.manage') and exists(select 1 from private.website_enquiries where id=p_resource) then '/enquiries/'||p_resource else null end,'title','');
$$;

revoke all on function private.receive_website_enquiry(text,uuid,jsonb),public.receive_website_enquiry(text,uuid,jsonb),private.enquiry_context(),private.enquiry_inbox(text,text,timestamptz,uuid,integer),private.enquiry_detail(uuid),private.manage_enquiry(uuid,text,jsonb,integer,uuid),private.enquiry_notification_target(text,uuid),public.enquiry_context(),public.enquiry_inbox(text,text,timestamptz,uuid,integer),public.enquiry_detail(uuid),public.manage_enquiry(uuid,text,jsonb,integer,uuid) from public,anon,authenticated;
grant execute on function private.receive_website_enquiry(text,uuid,jsonb),public.receive_website_enquiry(text,uuid,jsonb) to service_role;
grant execute on function private.enquiry_context(),private.enquiry_inbox(text,text,timestamptz,uuid,integer),private.enquiry_detail(uuid),private.manage_enquiry(uuid,text,jsonb,integer,uuid),public.enquiry_context(),public.enquiry_inbox(text,text,timestamptz,uuid,integer),public.enquiry_detail(uuid),public.manage_enquiry(uuid,text,jsonb,integer,uuid) to authenticated;
commit;
