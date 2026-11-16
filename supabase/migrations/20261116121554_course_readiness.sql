begin;

-- Readiness is a projection of operational records. No writable percentage or
-- readiness state exists. Settings/tasks/receipts stay outside the Data API.
create table private.course_readiness_settings (
 course_run_id uuid primary key references public.course_runs(id),
 version integer not null default 0 check(version>=0),
 materials_required boolean not null default true,
 customer_required boolean not null default true,
 contact_required boolean not null default true,
 agreement_required boolean not null default true,
 instructions_required boolean not null default false,
 instructions text not null default '' check(length(instructions)<=20000),
 instruction_version integer not null default 1 check(instruction_version>0),
 meeting_url text not null default '' check(length(meeting_url)<=2000),
 preparation_deadline timestamptz check(preparation_deadline is null or isfinite(preparation_deadline)),
 confirmed_schedule text,
 confirmed_by uuid references public.profiles(id),
 confirmed_at timestamptz,
 updated_at timestamptz not null default clock_timestamp()
);
create table private.course_readiness_tasks (
 id uuid primary key default gen_random_uuid(),
 course_run_id uuid not null references public.course_runs(id),
 title text not null check(length(trim(title)) between 1 and 500),
 responsible_user_id uuid not null references public.profiles(id),
 required boolean not null default true,
 due_at timestamptz check(due_at is null or isfinite(due_at)),
 version integer not null default 1 check(version>0),
 completed_at timestamptz,
 completed_by uuid references public.profiles(id),
 archived_at timestamptz,
 created_at timestamptz not null default clock_timestamp(),
 check((completed_at is null)=(completed_by is null))
);
create index readiness_tasks_run on private.course_readiness_tasks(course_run_id,created_at,id);
create table private.course_instruction_receipts (
 id uuid primary key default gen_random_uuid(),
 course_run_id uuid not null references public.course_runs(id),
 instruction_version integer not null check(instruction_version>0),
 user_id uuid not null references public.profiles(id),
 created_at timestamptz not null default clock_timestamp(),
 unique(course_run_id,instruction_version,user_id)
);
create table private.course_readiness_requests (
 actor_id uuid not null references public.profiles(id),
 request_id uuid not null,
 payload jsonb not null,
 result uuid not null,
 created_at timestamptz not null default clock_timestamp(),
 primary key(actor_id,request_id)
);
create table private.course_readiness_events (
 id bigint generated always as identity primary key,
 course_run_id uuid not null references public.course_runs(id),
 actor_id uuid not null references public.profiles(id),
 action text not null,
 details jsonb not null default '{}',
 created_at timestamptz not null default clock_timestamp()
);
create index readiness_events_run on private.course_readiness_events(course_run_id,created_at,id);
do $$declare t text;begin
 foreach t in array array['course_readiness_settings','course_readiness_tasks','course_instruction_receipts','course_readiness_requests','course_readiness_events'] loop
  execute format('alter table private.%I enable row level security',t);
  execute format('revoke all on private.%I from public,anon,authenticated',t);
 end loop;
end;$$;

create function private.readiness_access(p_run uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select private.actor_active() and exists(select 1 from public.course_runs r where r.id=p_run and (
  private.has_permission('courses.manage') or (private.lecturer_actor() and exists(
   select 1 from public.jobs j join public.job_claims c on c.job_id=j.id
   where j.course_run_id=r.id and c.lecturer_id=auth.uid() and c.status='confirmed'
  ))
 ));
$$;

create function private.readiness_schedule(p_run uuid) returns text
language sql stable security definer set search_path='' as $$
 select md5(coalesce(string_agg(s.id::text||':'||s.starts_at::text||':'||s.ends_at::text,'|' order by s.id),''))
 from public.course_sessions s where s.course_run_id=p_run;
$$;

create function private.readiness_https_url(p_value text) returns boolean
language sql immutable set search_path='' as $$
 select coalesce(length(p_value)<=2000 and p_value~'^https://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{1,5})?([/?#][^[:space:]<>"\\]*)?$'
 and p_value!~'[[:cntrl:]]'
 and coalesce(substring(p_value from '^https://[^/:?#]+:([0-9]{1,5})(?:[/?#]|$)')::integer between 1 and 65535,true),false);
$$;

-- This evaluates a document for its intended lecturer, rather than the viewing
-- manager. A manager-only contract/private file cannot satisfy teaching material.
create function private.readiness_material_access(p_document uuid,p_lecturer uuid,p_job uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.documents d join public.document_versions v on v.id=d.current_version_id
 where d.id=p_document and d.deleted_at is null and d.kind in ('material','chat')
 and d.status='clean' and v.status='clean' and v.sha256 is not null
 and ((d.scope in ('job_before','job_after') and d.job_id=p_job)
 or (d.scope='room' and exists(select 1 from public.chat_rooms r join public.chat_members m on m.room_id=r.id
  where r.id=d.room_id and r.job_id=p_job and r.kind='lecturer_course'
  and m.user_id=p_lecturer and m.removed_at is null)))
 and exists(select 1 from public.profiles p where p.id=p_lecturer and p.active)
 and private.lecturer_user(p_lecturer));
$$;

create function private.readiness_snapshot(p_run uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
 r public.course_runs; cfg private.course_readiness_settings; checks jsonb; tasks jsonb; people jsonb;
 start_at timestamptz; finish_at timestamptz; assignment_ok boolean; agreement_ok boolean; qualification_ok boolean;
 material_ok boolean; customer_ok boolean; contact_ok boolean; delivery_ok boolean; sessions_ok boolean;
 instruction_ok boolean; task_ok boolean; qualification_required boolean; agreement_required boolean;
 applicable integer; done integer; blocked boolean; state text; meeting text; management boolean;
begin
 if not private.readiness_access(p_run) then raise exception 'Course preparation access denied' using errcode='42501';end if;
 select * into r from public.course_runs where id=p_run;
 select * into cfg from private.course_readiness_settings where course_run_id=p_run;
 if not found then
  cfg.course_run_id=p_run;cfg.version=0;cfg.materials_required=true;cfg.customer_required=true;cfg.contact_required=true;
  cfg.agreement_required=true;cfg.instructions_required=false;cfg.instructions='';cfg.instruction_version=1;cfg.meeting_url='';
 end if;
 management=private.has_permission('courses.manage');
 select min(starts_at),max(ends_at) into start_at,finish_at from public.course_sessions where course_run_id=r.id;

 -- All scheduled sessions and every offered position must have a live, active
 -- lecturer allocation matching the source interval. Partial blocks never pass.
 assignment_ok=start_at is not null and not exists(
  select 1 from public.course_sessions s where s.course_run_id=r.id and not exists(
   select 1 from public.job_sessions js join public.jobs j on j.id=js.job_id
   where j.course_run_id=r.id and j.status<>'archived' and js.course_session_id=s.id
   and js.starts_at=s.starts_at and js.ends_at=s.ends_at and
   (select count(*) from public.job_claims c join public.profiles p on p.id=c.lecturer_id
    where c.job_id=j.id and c.status='confirmed' and p.active and private.lecturer_user(p.id)
    and exists(select 1 from public.assignment_sessions a where a.claim_id=c.id and a.released_at is null
     and a.starts_at=s.starts_at and a.ends_at=s.ends_at))>=j.capacity
  )
 ) and not exists(select 1 from public.jobs j where j.course_run_id=r.id and j.status<>'archived' and (
  not exists(select 1 from public.job_sessions js where js.job_id=j.id)
  or (select count(*) from public.job_claims c join public.profiles p on p.id=c.lecturer_id
    where c.job_id=j.id and c.status='confirmed' and p.active and private.lecturer_user(p.id))<j.capacity
  or exists(select 1 from public.job_sessions js where js.job_id=j.id and not exists(
   select 1 from public.course_sessions s where s.id=js.course_session_id and s.course_run_id=r.id and s.starts_at=js.starts_at and s.ends_at=js.ends_at))
 ));
 agreement_required=cfg.agreement_required or exists(select 1 from public.jobs where course_run_id=r.id and status<>'archived' and requires_contract);
 agreement_ok=assignment_ok and not exists(
  select 1 from public.job_claims c join public.jobs j on j.id=c.job_id
  where j.course_run_id=r.id and c.status='confirmed' and (cfg.agreement_required or j.requires_contract) and not exists(
   select 1 from public.contracts contract join public.document_versions v on v.id=contract.document_version_id
   join public.documents d on d.id=v.document_id
   where contract.id=private.current_contract_for_interval(c.lecturer_id,(select min(starts_at) from public.job_sessions where job_id=j.id),(select max(ends_at) from public.job_sessions where job_id=j.id))
   and contract.user_id=c.lecturer_id and contract.status='active' and contract.revoked_at is null
   and contract.document_sha256=v.sha256 and v.status='clean' and d.deleted_at is null
  )
 );
 qualification_required=exists(select 1 from public.jobs j join public.job_requirements q on q.job_id=j.id where j.course_run_id=r.id and j.status<>'archived');
 qualification_ok=assignment_ok and not exists(
  select 1 from public.job_claims c join public.jobs j on j.id=c.job_id join public.job_requirements q on q.job_id=j.id
  where j.course_run_id=r.id and c.status='confirmed' and not exists(select 1 from public.lecturer_topics lt
   where lt.user_id=c.lecturer_id and lt.topic_id=q.topic_id and lt.verified and (lt.valid_until is null or lt.valid_until>=(select max(ends_at) from public.job_sessions where job_id=j.id)))
 );
 material_ok=assignment_ok and not exists(select 1 from public.job_claims c join public.jobs j on j.id=c.job_id
  where j.course_run_id=r.id and c.status='confirmed' and not exists(select 1 from public.documents d
   where private.readiness_material_access(d.id,c.lecturer_id,j.id)));
 customer_ok=exists(select 1 from public.organisations o where o.id=r.organisation_id and o.archived_at is null and length(trim(o.name))>0);
 contact_ok=customer_ok and exists(select 1 from public.organisation_contacts c where c.organisation_id=r.organisation_id
  and c.archived_at is null and length(trim(c.name))>0 and (length(trim(c.email))>0 or length(trim(c.phone))>0));
 meeting=case when private.readiness_https_url(cfg.meeting_url) then cfg.meeting_url when private.readiness_https_url(r.venue) then r.venue else '' end;
 delivery_ok=case r.delivery_type when 'online' then meeting<>'' else length(trim(r.venue))>0 end;
 sessions_ok=start_at is not null and cfg.confirmed_schedule=private.readiness_schedule(r.id);
 instruction_ok=length(trim(cfg.instructions))>0 and assignment_ok and not exists(
  select 1 from public.job_claims c join public.jobs j on j.id=c.job_id where j.course_run_id=r.id and c.status='confirmed'
  and not exists(select 1 from private.course_instruction_receipts a where a.course_run_id=r.id and a.user_id=c.lecturer_id and a.instruction_version=cfg.instruction_version));
 task_ok=not exists(select 1 from private.course_readiness_tasks task where task.course_run_id=r.id and task.archived_at is null and task.required
  and (task.completed_at is null or not exists(select 1 from public.profiles p where p.id=task.responsible_user_id and p.active)));
 checks=jsonb_build_array(
  jsonb_build_object('code','lecturer','applicable',true,'complete',assignment_ok,'blocking',true,'responsible','management','href','/courses?run='||r.id),
  jsonb_build_object('code','agreement','applicable',agreement_required,'complete',coalesce(agreement_ok,false),'blocking',true,'responsible','management','href',case when management then '/contracts' else null end),
  jsonb_build_object('code','qualification','applicable',qualification_required,'complete',coalesce(qualification_ok,false),'blocking',true,'responsible','management','href',case when management then '/admin/people' else '/profile' end),
  jsonb_build_object('code','materials','applicable',cfg.materials_required,'complete',coalesce(material_ok,false),'blocking',false,'responsible','management','href','/files'),
  jsonb_build_object('code','delivery','applicable',true,'complete',delivery_ok,'blocking',true,'responsible','management','href','/courses?run='||r.id),
  jsonb_build_object('code','customer','applicable',cfg.customer_required or cfg.contact_required,'complete',customer_ok,'blocking',true,'responsible','management','href',case when management then '/clients' else null end),
  jsonb_build_object('code','contact','applicable',cfg.contact_required,'complete',contact_ok,'blocking',false,'responsible','management','href',case when management then '/clients' else null end),
  jsonb_build_object('code','sessions','applicable',true,'complete',coalesce(sessions_ok,false),'blocking',true,'responsible','management','href','/calendar'),
  jsonb_build_object('code','instructions','applicable',cfg.instructions_required,'complete',coalesce(instruction_ok,false),'blocking',false,'responsible','lecturer','href',null),
  jsonb_build_object('code','tasks','applicable',exists(select 1 from private.course_readiness_tasks task where task.course_run_id=r.id and task.archived_at is null and task.required),'complete',task_ok,'blocking',false,'responsible','assignee','href',null)
 );
 select count(*),count(*) filter(where (item->>'complete')::boolean),coalesce(bool_or((item->>'blocking')::boolean and not (item->>'complete')::boolean),false)
 into applicable,done,blocked from jsonb_array_elements(checks) item where (item->>'applicable')::boolean;
 blocked=blocked or (done<applicable and (coalesce(cfg.preparation_deadline,start_at)<=now() or exists(
  select 1 from private.course_readiness_tasks task where task.course_run_id=r.id and task.archived_at is null and task.required and task.completed_at is null and task.due_at<=now())));
 state=case when done=applicable and finish_at<=now() then 'completed' when done=applicable then 'ready' when blocked then 'blocked' else 'attention_required' end;
 select coalesce(jsonb_agg(jsonb_build_object('id',task.id,'title',task.title,'required',task.required,
  'responsible_user_id',task.responsible_user_id,'responsible_name',p.display_name,'due_at',task.due_at,
  'completed_at',task.completed_at,'version',task.version,'can_complete',management or task.responsible_user_id=auth.uid()) order by task.due_at nulls last,task.created_at,task.id),'[]'::jsonb)
 into tasks from private.course_readiness_tasks task join public.profiles p on p.id=task.responsible_user_id
 where task.course_run_id=r.id and task.archived_at is null;
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'display_name',p.display_name,'acknowledged',exists(
  select 1 from private.course_instruction_receipts a where a.course_run_id=r.id and a.instruction_version=cfg.instruction_version and a.user_id=p.id)) order by p.display_name,p.id),'[]'::jsonb)
 into people from public.profiles p where p.id in(select c.lecturer_id from public.job_claims c join public.jobs j on j.id=c.job_id where j.course_run_id=r.id and c.status='confirmed');
 return jsonb_build_object('id',r.id,'title',(select title from public.course_templates where id=r.template_id),
  'organisation_name',(select name from public.organisations where id=r.organisation_id),'time_zone',r.time_zone,
  'delivery_type',r.delivery_type,'venue',case when r.delivery_type='onsite' then r.venue else '' end,'meeting_url',meeting,
  'starts_at',start_at,'ends_at',finish_at,'status',state,'percentage',round(100.0*done/greatest(applicable,1)),
  'applicable_count',applicable,'completed_count',done,'can_manage',management,
  'can_acknowledge',exists(select 1 from public.job_claims c join public.jobs j on j.id=c.job_id where j.course_run_id=r.id and c.status='confirmed' and c.lecturer_id=auth.uid()),
  'settings',jsonb_build_object('version',cfg.version,'materials_required',cfg.materials_required,'customer_required',cfg.customer_required,
   'contact_required',cfg.contact_required,'agreement_required',cfg.agreement_required,'instructions_required',cfg.instructions_required,
   'instructions',cfg.instructions,'instruction_version',cfg.instruction_version,'meeting_url',cfg.meeting_url,
   'preparation_deadline',cfg.preparation_deadline,'sessions_confirmed',coalesce(sessions_ok,false)),
  'checks',checks,'tasks',tasks,'lecturers',people,
  'responsible_people',case when management then people||jsonb_build_array(jsonb_build_object('id',auth.uid(),'display_name',(select display_name from public.profiles where id=auth.uid()))) else '[]'::jsonb end,
  'documents',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'name',d.original_name,'job_id',j.id) order by d.created_at desc,d.id)
   from public.documents d join public.jobs j on j.course_run_id=r.id where private.can_access_document(d.id)
   and d.deleted_at is null and d.status='clean' and (d.job_id=j.id or exists(select 1 from public.chat_rooms room where room.id=d.room_id and room.job_id=j.id))),'[]'::jsonb),
  'jobs',coalesce((select jsonb_agg(jsonb_build_object('id',j.id,'title',j.title) order by j.created_at,j.id) from public.jobs j where j.course_run_id=r.id and private.can_read_job(j.id)),'[]'::jsonb),
  'as_of',now());
end;$$;

create function private.course_readiness(p_course_run_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not private.actor_active() then raise exception 'Active login required' using errcode='42501';end if;
 if p_course_run_id is not null then return jsonb_build_array(private.readiness_snapshot(p_course_run_id));end if;
 return coalesce((select jsonb_agg(private.readiness_snapshot(candidate.id) order by candidate.starts_at nulls first,candidate.id)
 from (select r.id,(select min(starts_at) from public.course_sessions where course_run_id=r.id) starts_at
  from public.course_runs r where r.archived_at is null and private.readiness_access(r.id)
  and not exists(select 1 from public.course_sessions old where old.course_run_id=r.id group by old.course_run_id having max(old.ends_at)<now()-interval '30 days')
  order by starts_at nulls first,r.id limit 250) candidate),'[]'::jsonb);
end;$$;
create function public.course_readiness(p_course_run_id uuid default null) returns jsonb
language sql stable security invoker set search_path='' as $$select private.course_readiness(p_course_run_id);$$;

create function private.readiness_retry(p_request uuid,p_payload jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare prior private.course_readiness_requests;
begin
 if p_request is null then raise exception 'Request ID required' using errcode='22023';end if;
 select * into prior from private.course_readiness_requests where actor_id=auth.uid() and request_id=p_request;
 if not found then return null;end if;
 if prior.payload is distinct from p_payload then raise exception 'Preparation retry conflict' using errcode='22023';end if;
 return prior.result;
end;$$;
create function private.readiness_record(p_run uuid,p_request uuid,p_payload jsonb,p_result uuid,p_action text,p_details jsonb default '{}') returns uuid
language plpgsql security definer set search_path='' as $$
begin
 insert into private.course_readiness_requests(actor_id,request_id,payload,result) values(auth.uid(),p_request,p_payload,p_result);
 insert into private.course_readiness_events(course_run_id,actor_id,action,details) values(p_run,auth.uid(),p_action,p_details);
 insert into public.audit_events(actor_id,action,resource_id) values(auth.uid(),'course.preparation.'||p_action,p_run);
 return p_result;
end;$$;

create function private.save_readiness_settings(p_course_run_id uuid,p_payload jsonb,p_expected_version integer,p_request_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare cfg private.course_readiness_settings; payload jsonb; result uuid; key text; deadline timestamptz; meeting text;
begin
 if not private.has_permission('courses.manage') then raise exception 'Course management and MFA required' using errcode='42501';end if;
 perform 1 from public.profiles where id=auth.uid() and active for share;
 if not found or not private.has_permission('courses.manage') then raise exception 'Course management and MFA required' using errcode='42501';end if;
 -- Match schedule amendments and confirmation: run first, readiness lock second.
 -- An INSERT's course FK must not invert that order through KEY SHARE later.
 perform 1 from public.course_runs where id=p_course_run_id for share;
 if not found then raise exception 'Course unavailable' using errcode='42501';end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'Invalid preparation settings' using errcode='22023';end if;
 for key in select jsonb_object_keys(p_payload) loop
  if key not in ('materials_required','customer_required','contact_required','agreement_required','instructions_required','instructions','meeting_url','preparation_deadline') then raise exception 'Unsupported preparation setting' using errcode='22023';end if;
 end loop;
 if (select count(*) from jsonb_object_keys(p_payload))<>8 or exists(select 1 from jsonb_each(p_payload) item where item.key like '%_required' and jsonb_typeof(item.value)<>'boolean')
 or jsonb_typeof(p_payload->'instructions')<>'string' or length(p_payload->>'instructions')>20000
 or jsonb_typeof(p_payload->'meeting_url')<>'string' then raise exception 'Invalid preparation settings' using errcode='22023';end if;
 meeting=trim(p_payload->>'meeting_url');
 if meeting<>'' and not private.readiness_https_url(meeting) then raise exception 'HTTPS meeting URL required' using errcode='22023';end if;
 deadline=nullif(p_payload->>'preparation_deadline','')::timestamptz;
 if deadline is not null and not isfinite(deadline) then raise exception 'Finite preparation deadline required' using errcode='22023';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('course-readiness:'||p_course_run_id::text,0));
 payload=jsonb_build_object('action','settings','run',p_course_run_id,'values',p_payload,'version',p_expected_version);
 result=private.readiness_retry(p_request_id,payload);if result is not null then return result;end if;
 insert into private.course_readiness_settings(course_run_id) values(p_course_run_id) on conflict do nothing;
 select * into cfg from private.course_readiness_settings where course_run_id=p_course_run_id for update;
 if cfg.version is distinct from p_expected_version then raise exception 'Preparation settings changed; reload' using errcode='40001';end if;
 update private.course_readiness_settings set version=version+1,materials_required=(p_payload->>'materials_required')::boolean,
  customer_required=(p_payload->>'customer_required')::boolean,contact_required=(p_payload->>'contact_required')::boolean,
  agreement_required=(p_payload->>'agreement_required')::boolean,instructions_required=(p_payload->>'instructions_required')::boolean,
  instruction_version=instruction_version+case when instructions is distinct from p_payload->>'instructions' or instructions_required is distinct from (p_payload->>'instructions_required')::boolean then 1 else 0 end,
  instructions=p_payload->>'instructions',meeting_url=meeting,preparation_deadline=deadline,updated_at=clock_timestamp() where course_run_id=p_course_run_id;
 return private.readiness_record(p_course_run_id,p_request_id,payload,p_course_run_id,'settings_saved',jsonb_build_object('before',to_jsonb(cfg),'after',(select to_jsonb(s) from private.course_readiness_settings s where s.course_run_id=p_course_run_id)));
end;$$;
create function public.save_readiness_settings(p_course_run_id uuid,p_payload jsonb,p_expected_version integer,p_request_id uuid) returns uuid
language sql security invoker set search_path='' as $$select private.save_readiness_settings(p_course_run_id,p_payload,p_expected_version,p_request_id);$$;

create function private.confirm_course_sessions(p_course_run_id uuid,p_expected_version integer,p_request_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare cfg private.course_readiness_settings; payload jsonb; result uuid;
begin
 if not private.has_permission('courses.manage') then raise exception 'Course management and MFA required' using errcode='42501';end if;
 -- Serialize current caller authority with role/suspension changes before
 -- waiting on course state or returning an earlier successful request.
 perform 1 from public.profiles where id=auth.uid() and active for share;
 if not found or not private.has_permission('courses.manage') then raise exception 'Course management and MFA required' using errcode='42501';end if;
 perform 1 from public.course_runs where id=p_course_run_id for share;
 if not found then raise exception 'Course unavailable' using errcode='42501';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('course-readiness:'||p_course_run_id::text,0));
 payload=jsonb_build_object('action','sessions_confirmed','run',p_course_run_id,'version',p_expected_version);
 result=private.readiness_retry(p_request_id,payload);if result is not null then return result;end if;
 if not exists(select 1 from public.course_sessions where course_run_id=p_course_run_id) then raise exception 'Sessions required' using errcode='22023';end if;
 insert into private.course_readiness_settings(course_run_id) values(p_course_run_id) on conflict do nothing;
 select * into cfg from private.course_readiness_settings where course_run_id=p_course_run_id for update;
 if cfg.version is distinct from p_expected_version then raise exception 'Preparation settings changed; reload' using errcode='40001';end if;
 update private.course_readiness_settings set version=version+1,confirmed_schedule=private.readiness_schedule(p_course_run_id),confirmed_by=auth.uid(),confirmed_at=clock_timestamp(),updated_at=clock_timestamp() where course_run_id=p_course_run_id;
 return private.readiness_record(p_course_run_id,p_request_id,payload,p_course_run_id,'sessions_confirmed',jsonb_build_object('schedule',private.readiness_schedule(p_course_run_id)));
end;$$;
create function public.confirm_course_sessions(p_course_run_id uuid,p_expected_version integer,p_request_id uuid) returns uuid
language sql security invoker set search_path='' as $$select private.confirm_course_sessions(p_course_run_id,p_expected_version,p_request_id);$$;

create function private.save_readiness_task(p_course_run_id uuid,p_task_id uuid,p_payload jsonb,p_expected_version integer,p_request_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare task private.course_readiness_tasks; payload jsonb; result uuid; responsible uuid; due timestamptz;
begin
 if not private.has_permission('courses.manage') then raise exception 'Course management and MFA required' using errcode='42501';end if;
 -- Serialize current caller authority with role/suspension changes before
 -- waiting on course state or returning an earlier successful request.
 perform 1 from public.profiles where id=auth.uid() and active for share;
 if not found or not private.has_permission('courses.manage') then raise exception 'Course management and MFA required' using errcode='42501';end if;
 perform 1 from public.course_runs where id=p_course_run_id for share;
 if not found then raise exception 'Course unavailable' using errcode='42501';end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or (select count(*) from jsonb_object_keys(p_payload))<>5
 or exists(select 1 from jsonb_object_keys(p_payload) key where key not in ('title','responsible_user_id','required','due_at','archived'))
 or jsonb_typeof(p_payload->'title')<>'string' or length(trim(p_payload->>'title')) not between 1 and 500
 or jsonb_typeof(p_payload->'required')<>'boolean' or jsonb_typeof(p_payload->'archived')<>'boolean' then raise exception 'Invalid preparation task' using errcode='22023';end if;
 responsible=(p_payload->>'responsible_user_id')::uuid;due=nullif(p_payload->>'due_at','')::timestamptz;
 if responsible is null or not exists(select 1 from public.profiles p where p.id=responsible and p.active and (p.id=auth.uid() or exists(
  select 1 from public.job_claims c join public.jobs j on j.id=c.job_id where j.course_run_id=p_course_run_id and c.lecturer_id=p.id and c.status='confirmed')))
 or (due is not null and not isfinite(due)) then raise exception 'An active responsible course member is required' using errcode='22023';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('course-readiness:'||p_course_run_id::text,0));
 payload=jsonb_build_object('action','task_saved','run',p_course_run_id,'task',p_task_id,'values',p_payload,'version',p_expected_version);
 result=private.readiness_retry(p_request_id,payload);if result is not null then return result;end if;
 if p_task_id is null then
  if p_expected_version is distinct from 0 or (p_payload->>'archived')::boolean then raise exception 'New task version required' using errcode='40001';end if;
  insert into private.course_readiness_tasks(course_run_id,title,responsible_user_id,required,due_at) values(p_course_run_id,trim(p_payload->>'title'),responsible,(p_payload->>'required')::boolean,due) returning id into result;
 else
  select * into task from private.course_readiness_tasks where id=p_task_id and course_run_id=p_course_run_id for update;
  if not found then raise exception 'Task unavailable' using errcode='42501';end if;
  if task.version is distinct from p_expected_version then raise exception 'Preparation task changed; reload' using errcode='40001';end if;
  update private.course_readiness_tasks set title=trim(p_payload->>'title'),responsible_user_id=responsible,required=(p_payload->>'required')::boolean,due_at=due,
   completed_at=case when title is distinct from trim(p_payload->>'title') or responsible_user_id is distinct from responsible then null else completed_at end,
   completed_by=case when title is distinct from trim(p_payload->>'title') or responsible_user_id is distinct from responsible then null else completed_by end,
   archived_at=case when (p_payload->>'archived')::boolean then coalesce(archived_at,clock_timestamp()) end,version=version+1 where id=p_task_id;
  result=p_task_id;
 end if;
 return private.readiness_record(p_course_run_id,p_request_id,payload,result,'task_saved',jsonb_build_object('before',case when task.id is not null then to_jsonb(task) else null end,'after',(select to_jsonb(t) from private.course_readiness_tasks t where t.id=result)));
end;$$;
create function public.save_readiness_task(p_course_run_id uuid,p_task_id uuid,p_payload jsonb,p_expected_version integer,p_request_id uuid) returns uuid
language sql security invoker set search_path='' as $$select private.save_readiness_task(p_course_run_id,p_task_id,p_payload,p_expected_version,p_request_id);$$;

create function private.complete_readiness_task(p_task_id uuid,p_completed boolean,p_expected_version integer,p_request_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare task private.course_readiness_tasks; payload jsonb; result uuid;
begin
 -- Read current authority after any profile-row wait and retain that grant
 -- through the course gate, including idempotent request replies.
 perform 1 from public.profiles where id=auth.uid() and active for share;
 if not found or not private.actor_active() then raise exception 'Active account required' using errcode='42501';end if;
 select * into task from private.course_readiness_tasks where id=p_task_id;
 if not found or not private.readiness_access(task.course_run_id) or not(private.has_permission('courses.manage') or task.responsible_user_id=auth.uid()) then raise exception 'Task access denied' using errcode='42501';end if;
 if p_completed is null then raise exception 'Completion decision required' using errcode='22023';end if;
 perform 1 from public.course_runs where id=task.course_run_id for share;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('course-readiness:'||task.course_run_id::text,0));
 payload=jsonb_build_object('action','task_completed','task',p_task_id,'completed',p_completed,'version',p_expected_version);
 result=private.readiness_retry(p_request_id,payload);if result is not null then return result;end if;
 select * into task from private.course_readiness_tasks where id=p_task_id for update;
 if task.version is distinct from p_expected_version or task.archived_at is not null then raise exception 'Preparation task changed; reload' using errcode='40001';end if;
 if not private.readiness_access(task.course_run_id) or not(private.has_permission('courses.manage') or task.responsible_user_id=auth.uid()) then raise exception 'Task access denied' using errcode='42501';end if;
 update private.course_readiness_tasks set completed_at=case when p_completed then clock_timestamp() end,
  completed_by=case when p_completed then auth.uid() end,version=version+1 where id=task.id;
 return private.readiness_record(task.course_run_id,p_request_id,payload,task.id,'task_completed',jsonb_build_object('task_id',task.id,'completed',p_completed,'previous_completed_at',task.completed_at));
end;$$;
create function public.complete_readiness_task(p_task_id uuid,p_completed boolean,p_expected_version integer,p_request_id uuid) returns uuid
language sql security invoker set search_path='' as $$select private.complete_readiness_task(p_task_id,p_completed,p_expected_version,p_request_id);$$;

create function private.acknowledge_course_instructions(p_course_run_id uuid,p_instruction_version integer,p_request_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare cfg private.course_readiness_settings; payload jsonb; result uuid;
begin
 -- Read current authority after any profile-row wait and retain that grant
 -- through the course gate, including idempotent request replies.
 perform 1 from public.profiles where id=auth.uid() and active for share;
 if not found or not private.actor_active() then raise exception 'Active account required' using errcode='42501';end if;
 if not private.readiness_access(p_course_run_id) or not private.lecturer_actor() then raise exception 'Assigned lecturer required' using errcode='42501';end if;
 perform 1 from public.course_runs where id=p_course_run_id for share;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('course-readiness:'||p_course_run_id::text,0));
 if not exists(select 1 from public.job_claims c join public.jobs j on j.id=c.job_id where j.course_run_id=p_course_run_id and c.status='confirmed' and c.lecturer_id=auth.uid()) then raise exception 'Assigned lecturer required' using errcode='42501';end if;
 payload=jsonb_build_object('action','instructions_acknowledged','run',p_course_run_id,'version',p_instruction_version);
 result=private.readiness_retry(p_request_id,payload);if result is not null then return result;end if;
 select * into cfg from private.course_readiness_settings where course_run_id=p_course_run_id;
 if not found or cfg.instruction_version is distinct from p_instruction_version or length(trim(cfg.instructions))=0 then raise exception 'Instructions changed; reload' using errcode='40001';end if;
 insert into private.course_instruction_receipts(course_run_id,instruction_version,user_id) values(p_course_run_id,p_instruction_version,auth.uid()) on conflict(course_run_id,instruction_version,user_id) do update set user_id=excluded.user_id returning id into result;
 return private.readiness_record(p_course_run_id,p_request_id,payload,result,'instructions_acknowledged',jsonb_build_object('instruction_version',p_instruction_version));
end;$$;
create function public.acknowledge_course_instructions(p_course_run_id uuid,p_instruction_version integer,p_request_id uuid) returns uuid
language sql security invoker set search_path='' as $$select private.acknowledge_course_instructions(p_course_run_id,p_instruction_version,p_request_id);$$;

do $$declare fn record;begin
 for fn in select p.oid::regprocedure signature,p.proname,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname in ('public','private') and p.proname in ('readiness_access','readiness_schedule','readiness_https_url','readiness_material_access','readiness_snapshot','course_readiness','readiness_retry','readiness_record','save_readiness_settings','confirm_course_sessions','save_readiness_task','complete_readiness_task','acknowledge_course_instructions') loop
  execute format('revoke all on function %s from public,anon,authenticated',fn.signature);
  if fn.proname in ('course_readiness','save_readiness_settings','confirm_course_sessions','save_readiness_task','complete_readiness_task','acknowledge_course_instructions') then execute format('grant execute on function %s to authenticated',fn.signature);end if;
 end loop;
end;$$;

-- Standalone job creation always creates a fresh run. Keep its delivery source
-- consistent at creation rather than bulk rewriting existing authored courses.
-- Preserve/reuse the current creation implementation, including any earlier
-- price/permission extension, and never copy an older implementation over it.
alter function private.create_job(jsonb) rename to create_job_before_readiness;
revoke all on function private.create_job_before_readiness(jsonb) from public,anon,authenticated;
create function private.create_job(p_payload jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
 result=private.create_job_before_readiness(p_payload);
 update public.course_runs r set delivery_type=j.delivery_type,venue=j.location
  from public.jobs j where j.id=result and r.id=j.course_run_id;
 return result;
end;$$;
create or replace function public.create_job(p_payload jsonb) returns uuid
language sql security invoker set search_path='' as $$select private.create_job(p_payload);$$;
revoke all on function private.create_job(jsonb),public.create_job(jsonb) from public,anon;
grant execute on function private.create_job(jsonb),public.create_job(jsonb) to authenticated;

commit;
