begin;

-- This capability authorises support records only. It never grants contracts,
-- financial records, private calendars or membership in an existing chat.
insert into public.role_permissions(role,permission)
select r,'support.manage' from unnest(array['admin','owner','management']) r on conflict do nothing;

create table private.support_tickets (
 id uuid primary key default gen_random_uuid(),
 requester_id uuid not null references public.profiles(id),
 category text not null check(category in ('technical','account','assignment','scheduling','documents','contract','invoice','general','feature')),
 title text not null check(length(title) between 1 and 200),
 description text not null check(length(description) between 1 and 12000),
 status text not null default 'open' check(status in ('open','in_progress','waiting_for_user','resolved','closed')),
 priority text not null default 'normal' check(priority in ('low','normal','high','urgent')),
 assigned_to uuid references public.profiles(id),
 course_run_id uuid references public.course_runs(id),
 claim_id uuid references public.job_claims(id),
 organisation_id uuid references public.organisations(id),
 version integer not null default 1 check(version>0),
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 resolved_at timestamptz,
 closed_at timestamptz
);
create index support_ticket_owner_cursor on private.support_tickets(requester_id,updated_at desc,id desc);
create index support_ticket_status_cursor on private.support_tickets(status,updated_at desc,id desc);
create table private.support_messages (
 id uuid primary key default gen_random_uuid(),
 ticket_id uuid not null references private.support_tickets(id),
 author_id uuid not null references public.profiles(id),
 body text not null check(length(body) between 1 and 12000),
 internal boolean not null default false,
 created_at timestamptz not null default clock_timestamp()
);
create index support_message_ticket on private.support_messages(ticket_id,created_at,id);
create table private.support_events (
 id uuid primary key default gen_random_uuid(),
 ticket_id uuid not null references private.support_tickets(id),
 actor_id uuid not null references public.profiles(id),
 action text not null,
 reason text not null default '' check(length(reason)<=2000),
 previous_status text,
 new_status text,
 internal boolean not null default false,
 created_at timestamptz not null default clock_timestamp()
);
create index support_event_ticket on private.support_events(ticket_id,created_at,id);
create table private.support_requests (
 actor_id uuid not null references public.profiles(id),
 request_id uuid not null,
 signature jsonb not null,
 ticket_id uuid not null references private.support_tickets(id),
 created_at timestamptz not null default clock_timestamp(),
 primary key(actor_id,request_id)
);
create table private.support_attachments (
 id uuid primary key default gen_random_uuid(),
 ticket_id uuid not null references private.support_tickets(id),
 document_id uuid not null unique references public.documents(id),
 version_id uuid not null unique references public.document_versions(id),
 attached_by uuid not null references public.profiles(id),
 internal boolean not null default false,
 created_at timestamptz not null default clock_timestamp()
);
alter table private.support_tickets enable row level security;
alter table private.support_messages enable row level security;
alter table private.support_events enable row level security;
alter table private.support_requests enable row level security;
alter table private.support_attachments enable row level security;
revoke all on private.support_tickets,private.support_messages,private.support_events,private.support_requests,private.support_attachments from public,anon,authenticated;

-- Dedicated ticket evidence cannot also be a course resource. The optional
-- learning workspace has a separate registry, so checking only document scope
-- or its ordinary download predicate would miss that independent access path.
-- Include removed registry history: previous recipients may already know the
-- exact version. The caller holds the document row before this check.
create function private.support_document_has_course_reference(p_document uuid) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare registry regclass:=to_regclass('private.course_resources'); referenced boolean;
begin
 if registry is null then return false;end if;
 execute format('select exists(select 1 from %s r join public.document_versions v on v.id=r.version_id where v.document_id=$1)',registry)
  into referenced using p_document;
 return referenced;
end;$$;
-- Serialize the reverse registration order on the same document row. A course
-- registry insert must wait for an in-flight ticket attachment and then refuse
-- that dedicated version, including for its original uploader.
create function private.support_course_resource_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare document uuid;
begin
 select document_id into document from public.document_versions where id=new.version_id;
 if document is null then return new;end if;
 perform 1 from public.documents where id=document for update;
 if exists(select 1 from private.support_attachments a where a.document_id=document) then
  raise exception 'Dedicated support evidence cannot be shared as course material' using errcode='42501';
 end if;
 return new;
end;$$;
do $$begin
 if to_regclass('private.course_resources') is not null then
  execute 'create trigger support_course_resource_guard before insert or update of version_id on private.course_resources for each row execute function private.support_course_resource_guard()';
 end if;
end;$$;
revoke all on function private.support_document_has_course_reference(uuid),private.support_course_resource_guard() from public,anon,authenticated,service_role;

create function private.can_read_support(p_ticket_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select private.actor_active() and exists(select 1 from private.support_tickets t where t.id=p_ticket_id
  and (t.requester_id=auth.uid() or private.has_permission('support.manage')));
$$;
create function private.support_context() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare manager boolean:=private.has_permission('support.manage'); staff jsonb:='[]'::jsonb; report jsonb:='[]'::jsonb; courses jsonb; claims jsonb; organisations jsonb;
begin
 if not private.actor_active() then raise exception 'Support access denied' using errcode='42501'; end if;
 if manager then
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.display_name) order by p.display_name,p.id),'[]'::jsonb) into staff
   from public.profiles p where p.active and exists(select 1 from public.user_roles ur join public.role_permissions rp on rp.role=ur.role where ur.user_id=p.id and rp.permission='support.manage');
  select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into report from (
   select category,count(*) total,count(*) filter(where status not in ('resolved','closed')) outstanding,
    round(avg(extract(epoch from resolved_at-created_at))/3600,2) resolution_hours
    from private.support_tickets group by category order by category) r;
 end if;
 select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into courses from (
  select c.id,t.title label from public.course_runs c join public.course_templates t on t.id=c.template_id where private.can_read_course_run(c.id) order by c.created_at desc limit 200) r;
 select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into claims from (
  select c.id,j.title label from public.job_claims c join public.jobs j on j.id=c.job_id where c.lecturer_id=auth.uid() or private.has_permission('courses.manage') order by c.created_at desc limit 200) r;
 select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into organisations from (
  select o.id,o.name label from public.organisations o where private.has_permission('organisations.manage') or private.client_has_organisation(o.id) order by o.name limit 200) r;
 return jsonb_build_object('can_manage',manager,'staff',staff,'report',report,'courses',courses,'claims',claims,'organisations',organisations);
end;$$;
create function public.support_context() returns jsonb language sql stable security invoker set search_path='' as $$select private.support_context();$$;

create function private.support_tickets(p_search text default '',p_status text default '',p_before_at timestamptz default null,p_before_id uuid default null,p_limit integer default 40) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare items jsonb; last_row jsonb; more boolean;
begin
 if not private.actor_active() then raise exception 'Support access denied' using errcode='42501'; end if;
 if p_search is null or length(p_search)>200 or p_status is null or p_status not in ('','open','in_progress','waiting_for_user','resolved','closed')
 or p_limit is null or p_limit not between 1 and 100 or (p_before_at is null)<>(p_before_id is null) or (p_before_at is not null and not isfinite(p_before_at)) then raise exception 'Invalid support filter' using errcode='22023'; end if;
 select coalesce(jsonb_agg(to_jsonb(r) order by r.updated_at desc,r.id desc),'[]'::jsonb) into items from (
  select t.id,t.title,t.category,t.status,t.priority,t.version,t.created_at,t.updated_at,p.display_name requester_name,
   a.display_name assigned_name,t.requester_id=auth.uid() mine
  from private.support_tickets t join public.profiles p on p.id=t.requester_id left join public.profiles a on a.id=t.assigned_to
  where private.can_read_support(t.id) and (p_status='' or t.status=p_status)
   and (p_search='' or position(lower(trim(p_search)) in lower(t.title||' '||t.description))>0)
   and (p_before_at is null or (t.updated_at,t.id)<(p_before_at,p_before_id))
  order by t.updated_at desc,t.id desc limit p_limit+1
 ) r;
 more:=jsonb_array_length(items)>p_limit;
 if more then items:=items-(jsonb_array_length(items)-1); end if;
 last_row:=items->(jsonb_array_length(items)-1);
 return jsonb_build_object('items',items,'has_more',more,'next_cursor',case when more then jsonb_build_object('at',last_row->>'updated_at','id',last_row->>'id') else null end);
end;$$;
create function public.support_tickets(p_search text default '',p_status text default '',p_before_at timestamptz default null,p_before_id uuid default null,p_limit integer default 40) returns jsonb
language sql stable security invoker set search_path='' as $$select private.support_tickets(p_search,p_status,p_before_at,p_before_id,p_limit);$$;

create function private.support_ticket(p_ticket_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare ticket private.support_tickets; manager boolean:=private.has_permission('support.manage'); messages jsonb; events jsonb; files jsonb;
begin
 if not private.can_read_support(p_ticket_id) then raise exception 'Support access denied' using errcode='42501'; end if;
 select * into ticket from private.support_tickets where id=p_ticket_id;
 select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'author_name',p.display_name,'body',m.body,'internal',m.internal,'created_at',m.created_at) order by m.created_at,m.id),'[]'::jsonb)
 into messages from private.support_messages m join public.profiles p on p.id=m.author_id where m.ticket_id=p_ticket_id and (not m.internal or manager);
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'actor_name',p.display_name,'action',e.action,'reason',e.reason,'previous_status',e.previous_status,'new_status',e.new_status,'created_at',e.created_at) order by e.created_at,e.id),'[]'::jsonb)
 into events from private.support_events e join public.profiles p on p.id=e.actor_id where e.ticket_id=p_ticket_id and (not e.internal or manager);
 select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'document_id',a.document_id,'version_id',a.version_id,'name',v.original_name,'internal',a.internal,'created_at',a.created_at) order by a.created_at,a.id),'[]'::jsonb)
 into files from private.support_attachments a join public.document_versions v on v.id=a.version_id where a.ticket_id=p_ticket_id and (not a.internal or manager);
 return jsonb_build_object('id',ticket.id,'title',ticket.title,'description',ticket.description,'category',ticket.category,'status',ticket.status,'priority',ticket.priority,
  'version',ticket.version,'created_at',ticket.created_at,'updated_at',ticket.updated_at,'resolved_at',ticket.resolved_at,'closed_at',ticket.closed_at,
  'requester_name',(select display_name from public.profiles where id=ticket.requester_id),'assigned_to',ticket.assigned_to,
  'assigned_name',(select display_name from public.profiles where id=ticket.assigned_to),'can_manage',manager,'mine',ticket.requester_id=auth.uid(),
  'can_reopen',ticket.status in ('resolved','closed') and (manager or ticket.closed_at is null or ticket.closed_at>now()-interval '30 days'),
  'course_run_id',case when private.can_read_course_run(ticket.course_run_id) then ticket.course_run_id else null end,
  'claim_id',case when manager and private.has_permission('courses.manage') or exists(select 1 from public.job_claims where id=ticket.claim_id and lecturer_id=auth.uid()) then ticket.claim_id else null end,
  'organisation_id',case when private.has_permission('organisations.manage') or private.client_has_organisation(ticket.organisation_id) then ticket.organisation_id else null end,
  'messages',messages,'events',events,'attachments',files);
end;$$;
create function public.support_ticket(p_ticket_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$select private.support_ticket(p_ticket_id);$$;

create function private.support_validate_links(p_course uuid,p_claim uuid,p_organisation uuid) returns void
language plpgsql stable security definer set search_path='' as $$
begin
 if p_course is not null and not private.can_read_course_run(p_course) then raise exception 'Related resource access denied' using errcode='42501'; end if;
 if p_claim is not null and not exists(select 1 from public.job_claims c where c.id=p_claim and (c.lecturer_id=auth.uid() or private.has_permission('courses.manage'))) then raise exception 'Related resource access denied' using errcode='42501'; end if;
 if p_organisation is not null and not ((private.has_permission('organisations.manage') and exists(select 1 from public.organisations where id=p_organisation)) or private.client_has_organisation(p_organisation)) then raise exception 'Related resource access denied' using errcode='42501'; end if;
end;$$;

create function private.create_support_ticket(p_payload jsonb,p_request_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare existing private.support_requests; ticket uuid; course uuid; claim uuid; organisation uuid;
begin
 if not private.actor_active() then raise exception 'Support access denied' using errcode='42501'; end if;
 if p_request_id is null or p_payload is null or jsonb_typeof(p_payload)<>'object'
 or exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('title','description','category','course_run_id','claim_id','organisation_id'))
 or jsonb_typeof(p_payload->'title') is distinct from 'string' or length(trim(p_payload->>'title')) not between 1 and 200
 or jsonb_typeof(p_payload->'description') is distinct from 'string' or length(trim(p_payload->>'description')) not between 1 and 12000
 or p_payload->>'category' is null or p_payload->>'category' not in ('technical','account','assignment','scheduling','documents','contract','invoice','general','feature') then raise exception 'Invalid support ticket' using errcode='22023'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('support:'||auth.uid()::text,0));
 select * into existing from private.support_requests where actor_id=auth.uid() and request_id=p_request_id;
 if found then
  if existing.signature<>jsonb_build_object('action','create','payload',p_payload) then raise exception 'Support retry conflict' using errcode='22023'; end if;
  return existing.ticket_id;
 end if;
 if (select count(*) from private.support_tickets where requester_id=auth.uid() and created_at>now()-interval '15 minutes')>=10 then raise exception 'Support rate limit' using errcode='54000'; end if;
 course:=nullif(p_payload->>'course_run_id','')::uuid; claim:=nullif(p_payload->>'claim_id','')::uuid; organisation:=nullif(p_payload->>'organisation_id','')::uuid;
 perform private.support_validate_links(course,claim,organisation);
 insert into private.support_tickets(requester_id,title,description,category,course_run_id,claim_id,organisation_id)
 values(auth.uid(),trim(p_payload->>'title'),trim(p_payload->>'description'),p_payload->>'category',course,claim,organisation) returning id into ticket;
 insert into private.support_events(ticket_id,actor_id,action) values(ticket,auth.uid(),'created');
 insert into private.support_requests values(auth.uid(),p_request_id,jsonb_build_object('action','create','payload',p_payload),ticket,clock_timestamp());
 insert into public.audit_events(actor_id,action,resource_id) values(auth.uid(),'support.created',ticket);
 insert into public.notifications(user_id,kind,resource_id) select distinct p.id,'support_update',ticket from public.profiles p join public.user_roles ur on ur.user_id=p.id join public.role_permissions rp on rp.role=ur.role where p.active and rp.permission='support.manage' and p.id<>auth.uid() on conflict do nothing;
 return ticket;
end;$$;
create function public.create_support_ticket(p_payload jsonb,p_request_id uuid) returns uuid language sql security invoker set search_path='' as $$select private.create_support_ticket(p_payload,p_request_id);$$;

create function private.update_support_ticket(p_ticket_id uuid,p_action text,p_payload jsonb,p_expected_version integer,p_request_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare ticket private.support_tickets; existing private.support_requests; manager boolean:=private.has_permission('support.manage'); signature jsonb; target uuid; target_status text; reason text; internal boolean:=false; d public.documents; v public.document_versions;
begin
 if not private.can_read_support(p_ticket_id) then raise exception 'Support access denied' using errcode='42501'; end if;
 if p_request_id is null or p_action is null or p_action not in ('reply','internal_note','status','assign','priority','reopen','links','attach') or p_payload is null or jsonb_typeof(p_payload)<>'object' or p_expected_version is null then raise exception 'Invalid support action' using errcode='22023'; end if;
 signature:=jsonb_build_object('ticket',p_ticket_id,'action',p_action,'payload',p_payload,'version',p_expected_version);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('support:'||auth.uid()::text,0));
 select * into ticket from private.support_tickets where id=p_ticket_id for update;
 select * into existing from private.support_requests where actor_id=auth.uid() and request_id=p_request_id;
 if found then
  if existing.signature<>signature then raise exception 'Support retry conflict' using errcode='22023'; end if;
  return existing.ticket_id;
 end if;
 if ticket.version<>p_expected_version then raise exception 'Support ticket changed; reload' using errcode='40001'; end if;
 if ticket.version=2147483647 then raise exception 'Support version limit' using errcode='54000'; end if;
 if (select count(*) from private.support_requests where actor_id=auth.uid() and created_at>now()-interval '1 minute')>=30 then raise exception 'Support rate limit' using errcode='54000'; end if;
 if p_action in ('internal_note','status','assign','priority','links') and not manager then raise exception 'Support management required' using errcode='42501'; end if;
 if p_action in ('reply','internal_note') then
  if exists(select 1 from jsonb_object_keys(p_payload) k where k<>'body') or jsonb_typeof(p_payload->'body') is distinct from 'string' or length(trim(p_payload->>'body')) not between 1 and 12000 then raise exception 'Invalid support message' using errcode='22023'; end if;
  if ticket.status in ('resolved','closed') then raise exception 'Reopen ticket before replying' using errcode='22023'; end if;
  internal:=p_action='internal_note';
  insert into private.support_messages(ticket_id,author_id,body,internal) values(ticket.id,auth.uid(),trim(p_payload->>'body'),internal);
 elsif p_action in ('status','reopen') then
  if exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('status','reason')) or jsonb_typeof(p_payload->'reason') is distinct from 'string' or length(trim(p_payload->>'reason')) not between 1 and 2000 then raise exception 'Support change reason required' using errcode='22023'; end if;
  reason:=trim(p_payload->>'reason'); target_status:=case when p_action='reopen' then 'open' else p_payload->>'status' end;
  if p_action='reopen' then
   if ticket.status not in ('resolved','closed') or (not manager and ticket.closed_at is not null and ticket.closed_at<=now()-interval '30 days') then raise exception 'Ticket cannot be reopened' using errcode='22023'; end if;
  elsif not ((ticket.status='open' and target_status='in_progress') or (ticket.status='in_progress' and target_status in ('waiting_for_user','resolved')) or (ticket.status='waiting_for_user' and target_status in ('in_progress','resolved')) or (ticket.status='resolved' and target_status='closed')) then raise exception 'Invalid support status transition' using errcode='22023'; end if;
  update private.support_tickets set status=target_status,resolved_at=case when target_status='resolved' then clock_timestamp() when target_status='open' then null else resolved_at end,closed_at=case when target_status='closed' then clock_timestamp() when target_status='open' then null else closed_at end where id=ticket.id;
 elsif p_action='assign' then
  if exists(select 1 from jsonb_object_keys(p_payload) k where k<>'user_id') then raise exception 'Invalid support assignee' using errcode='22023'; end if;
  target:=nullif(p_payload->>'user_id','')::uuid;
  if target is not null and not exists(select 1 from public.profiles p join public.user_roles ur on ur.user_id=p.id join public.role_permissions rp on rp.role=ur.role where p.id=target and p.active and rp.permission='support.manage') then raise exception 'Support assignee unavailable' using errcode='22023'; end if;
  update private.support_tickets set assigned_to=target where id=ticket.id;
 elsif p_action='priority' then
  if exists(select 1 from jsonb_object_keys(p_payload) k where k<>'priority') or p_payload->>'priority' is null or p_payload->>'priority' not in ('low','normal','high','urgent') then raise exception 'Invalid support priority' using errcode='22023'; end if;
  update private.support_tickets set priority=p_payload->>'priority' where id=ticket.id;
 elsif p_action='links' then
  if exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('course_run_id','claim_id','organisation_id')) then raise exception 'Invalid support links' using errcode='22023'; end if;
  perform private.support_validate_links(nullif(p_payload->>'course_run_id','')::uuid,nullif(p_payload->>'claim_id','')::uuid,nullif(p_payload->>'organisation_id','')::uuid);
  update private.support_tickets set course_run_id=nullif(p_payload->>'course_run_id','')::uuid,claim_id=nullif(p_payload->>'claim_id','')::uuid,organisation_id=nullif(p_payload->>'organisation_id','')::uuid where id=ticket.id;
  internal:=true;
 elsif p_action='attach' then
  if exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('document_id','internal')) or jsonb_typeof(p_payload->'internal') is distinct from 'boolean' then raise exception 'Invalid support attachment' using errcode='22023'; end if;
  if ticket.status in ('resolved','closed') then raise exception 'Reopen ticket before attaching' using errcode='22023'; end if;
  internal:=(p_payload->>'internal')::boolean;
  if internal and not manager then raise exception 'Support management required' using errcode='42501'; end if;
  select * into d from public.documents where id=(p_payload->>'document_id')::uuid for update;
  if not found or d.owner_id<>auth.uid() or d.uploaded_by<>auth.uid() or d.scope<>'personal' or d.kind<>'material' or d.status<>'clean' or d.deleted_at is not null then raise exception 'Dedicated clean attachment required' using errcode='42501'; end if;
  if private.support_document_has_course_reference(d.id) then raise exception 'Course resources cannot become dedicated support evidence' using errcode='42501';end if;
  select * into v from public.document_versions where id=d.current_version_id;
  if not found or v.status<>'clean' or v.sha256 is null or v.version<>1 or (select count(*) from public.document_versions where document_id=d.id)<>1 then raise exception 'Dedicated clean attachment required' using errcode='42501'; end if;
  insert into private.support_attachments(ticket_id,document_id,version_id,attached_by,internal) values(ticket.id,d.id,v.id,auth.uid(),internal);
 end if;
 update private.support_tickets set version=version+1,updated_at=clock_timestamp() where id=ticket.id;
 insert into private.support_events(ticket_id,actor_id,action,reason,previous_status,new_status,internal)
 values(ticket.id,auth.uid(),p_action,coalesce(reason,''),case when p_action in ('status','reopen') then ticket.status else null end,target_status,internal);
 insert into private.support_requests values(auth.uid(),p_request_id,signature,ticket.id,clock_timestamp());
 insert into public.audit_events(actor_id,action,resource_id) values(auth.uid(),'support.'||p_action,ticket.id);
 -- Internal notes never wake the requester or place note text in any inbox.
 if not internal then
  insert into public.notifications(user_id,kind,resource_id)
   select recipient,'support_update',ticket.id from (select ticket.requester_id recipient union select ticket.assigned_to
    union select p.id from public.profiles p where ticket.assigned_to is null and p.active and exists(select 1 from public.user_roles ur join public.role_permissions rp on rp.role=ur.role where ur.user_id=p.id and rp.permission='support.manage')) recipients
   where recipient is not null and recipient<>auth.uid()
   on conflict(user_id,kind,resource_id) do update set read_at=null,created_at=clock_timestamp();
 end if;
 return ticket.id;
end;$$;
create function public.update_support_ticket(p_ticket_id uuid,p_action text,p_payload jsonb,p_expected_version integer,p_request_id uuid) returns uuid
language sql security invoker set search_path='' as $$select private.update_support_ticket(p_ticket_id,p_action,p_payload,p_expected_version,p_request_id);$$;

-- A support attachment is a dedicated scanned upload, never a link to a CV,
-- contract, invoice, old document history, existing room or financial record.
-- Clone the exact already-installed private document gate, including stricter
-- evidence/accounting extensions. Replacing the helper in place preserves its
-- OID and every existing RLS policy dependency. Only its definer owner may call
-- the clone, so ticket checks cannot be bypassed through a second entry point.
do $$declare original text;begin
 select prosrc into original from pg_proc where oid='private.can_access_document(uuid)'::regprocedure;
 execute format('create function private.can_access_document_before_support(p_id uuid) returns boolean language plpgsql stable security definer set search_path='''' as %L',original);
end;$$;
revoke execute on function private.can_access_document_before_support(uuid) from public,anon,authenticated,service_role;
create or replace function private.can_access_document(p_id uuid) returns boolean language plpgsql stable security definer set search_path='' as $$
begin
 if not private.actor_active() or not exists(select 1 from public.documents where id=p_id and deleted_at is null) then return false;end if;
 if exists(select 1 from private.support_attachments where document_id=p_id) then
  -- Ticket authority is final even for its uploader. Denied internal evidence
  -- must never fall back to the personal-document ownership permission.
  return exists(select 1 from private.support_attachments a where a.document_id=p_id and private.can_read_support(a.ticket_id)
   and (not a.internal or private.has_permission('support.manage')));
 end if;
 return private.can_access_document_before_support(p_id);
end;$$;
create function private.freeze_support_attachment() returns trigger language plpgsql security definer set search_path='' as $$
declare document uuid;
begin
 if tg_table_name='documents' then document:=old.id; else document:=case when tg_op='INSERT' then new.document_id else old.document_id end; end if;
 if exists(select 1 from private.support_attachments where document_id=document) then raise exception 'Support attachment evidence is immutable' using errcode='22023'; end if;
 if tg_table_name='document_versions' and tg_op='UPDATE' then
  if exists(select 1 from private.support_attachments where document_id=new.document_id) then raise exception 'Support attachment evidence is immutable' using errcode='22023'; end if;
 end if;
 if tg_op='DELETE' then return old; else return new; end if;
end;$$;
create trigger support_attachment_document_immutable before update or delete on public.documents for each row execute function private.freeze_support_attachment();
create trigger support_attachment_version_immutable before insert or update or delete on public.document_versions for each row execute function private.freeze_support_attachment();

create function private.support_notification_target(p_kind text,p_resource uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('href',case when p_kind='support_update' and private.can_read_support(p_resource) then '/support/'||p_resource else null end,
  'title',case when p_kind='support_update' and private.can_read_support(p_resource) then (select title from private.support_tickets where id=p_resource) else '' end);
$$;

revoke all on function private.can_read_support(uuid),private.support_context(),private.support_tickets(text,text,timestamptz,uuid,integer),private.support_ticket(uuid),private.support_validate_links(uuid,uuid,uuid),private.create_support_ticket(jsonb,uuid),private.update_support_ticket(uuid,text,jsonb,integer,uuid),private.freeze_support_attachment(),private.support_notification_target(text,uuid) from public,anon,authenticated;
revoke all on function public.support_context(),public.support_tickets(text,text,timestamptz,uuid,integer),public.support_ticket(uuid),public.create_support_ticket(jsonb,uuid),public.update_support_ticket(uuid,text,jsonb,integer,uuid) from public,anon,authenticated;
grant execute on function private.support_context(),private.support_tickets(text,text,timestamptz,uuid,integer),private.support_ticket(uuid),private.create_support_ticket(jsonb,uuid),private.update_support_ticket(uuid,text,jsonb,integer,uuid),public.support_context(),public.support_tickets(text,text,timestamptz,uuid,integer),public.support_ticket(uuid),public.create_support_ticket(jsonb,uuid),public.update_support_ticket(uuid,text,jsonb,integer,uuid) to authenticated;

commit;
