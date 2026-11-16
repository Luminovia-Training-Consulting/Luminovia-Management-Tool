begin;

create table private.personal_favourites (
 user_id uuid not null references public.profiles(id) on delete cascade,
 kind text not null check(kind in('topic','organisation')),
 resource_id uuid not null,
 created_at timestamptz not null default now(),
 primary key(user_id,kind,resource_id)
);
alter table private.personal_favourites enable row level security;
revoke all on private.personal_favourites from public,anon,authenticated,service_role;

create function private.favourite_resource(p_kind text,p_id uuid) returns text
language plpgsql stable security definer set search_path='' as $$
declare result text;
begin
 if not private.actor_active() then return null;end if;
 if p_kind='topic' then select label_de into result from public.topics where id=p_id and archived_at is null;
 elsif p_kind='organisation' then
  select o.name into result from public.organisations o where o.id=p_id and o.archived_at is null and
   (private.has_permission('organisations.manage') or private.client_has_organisation(o.id)
    or exists(select 1 from public.course_runs r where r.organisation_id=o.id and private.can_read_course_run(r.id)));
 end if;
 return result;
end;$$;
create function private.my_favourites(p_search text default '') returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not private.actor_active() then raise exception 'Active account required' using errcode='42501';end if;
 if p_search is null or length(p_search)>100 then raise exception 'Invalid search' using errcode='22023';end if;
 return jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('kind',f.kind,'id',f.resource_id,'label',x.label,'created_at',f.created_at) order by f.created_at desc,f.resource_id)
  from private.personal_favourites f cross join lateral(select private.favourite_resource(f.kind,f.resource_id) label) x where f.user_id=auth.uid() and x.label is not null),'[]'::jsonb),
 'organisations',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'label',o.name) order by o.name,o.id) from
  (select * from public.organisations o where private.favourite_resource('organisation',o.id) is not null and position(lower(p_search) in lower(o.name))>0 order by o.name,o.id limit 100) o),'[]'::jsonb));
end;$$;
create function public.my_favourites(p_search text default '') returns jsonb language sql stable security invoker set search_path='' as $$select private.my_favourites(p_search);$$;
create function private.set_favourite(p_kind text,p_id uuid,p_enabled boolean) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 if not private.actor_active() then raise exception 'Active account required' using errcode='42501';end if;
 if p_kind is null or p_kind not in('topic','organisation') or p_id is null or p_enabled is null then raise exception 'Invalid favourite' using errcode='22023';end if;
 perform 1 from public.profiles where id=auth.uid() and active for share;
 if p_enabled then
  if private.favourite_resource(p_kind,p_id) is null then raise exception 'Resource unavailable' using errcode='42501';end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('favourites:'||auth.uid()::text,0));
  if (select count(*) from private.personal_favourites where user_id=auth.uid())>=200 and not exists(select 1 from private.personal_favourites where user_id=auth.uid() and kind=p_kind and resource_id=p_id) then raise exception 'Favourite limit reached' using errcode='54000';end if;
  insert into private.personal_favourites(user_id,kind,resource_id) values(auth.uid(),p_kind,p_id) on conflict do nothing;
 else delete from private.personal_favourites where user_id=auth.uid() and kind=p_kind and resource_id=p_id;
 end if;
 return p_enabled;
end;$$;
create function public.set_favourite(p_kind text,p_id uuid,p_enabled boolean) returns boolean language sql security invoker set search_path='' as $$select private.set_favourite(p_kind,p_id,p_enabled);$$;

create table private.work_tasks (
 id uuid primary key default gen_random_uuid(),
 creator_id uuid not null references public.profiles(id),
 assignee_id uuid not null references public.profiles(id),
 scope text not null check(scope in('private','operations')),
 title text not null check(length(title) between 1 and 200),
 description text not null default '' check(length(description)<=8000),
 state text not null default 'open' check(state in('open','doing','done','cancelled')),
 due_at timestamptz,
 time_zone text not null default 'Europe/Berlin',
 source_message_id uuid references public.messages(id),
 version integer not null default 1 check(version>0),
 client_id uuid not null,
 request_payload jsonb not null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(creator_id,client_id),
 check(due_at is null or isfinite(due_at))
);
create index work_tasks_assignee_due on private.work_tasks(assignee_id,state,due_at,id);
create table private.work_task_history (
 id bigint generated always as identity primary key,
 task_id uuid not null references private.work_tasks(id) on delete cascade,
 actor_id uuid not null references public.profiles(id),
 before_state jsonb,
 after_state jsonb not null,
 created_at timestamptz not null default now()
);
create table private.work_task_templates (
 id uuid primary key default gen_random_uuid(),
 creator_id uuid not null references public.profiles(id),
 title text not null check(length(title) between 1 and 200),
 shared boolean not null default false,
 items jsonb not null,
 archived boolean not null default false,
 version integer not null default 1 check(version>0),
 created_at timestamptz not null default now()
);
create table private.work_template_runs (
 user_id uuid not null references public.profiles(id),
 client_id uuid not null,
 template_id uuid not null references private.work_task_templates(id),
 template_version integer not null,
 task_ids uuid[] not null,
 primary key(user_id,client_id)
);
alter table private.work_tasks enable row level security;
alter table private.work_task_history enable row level security;
alter table private.work_task_templates enable row level security;
alter table private.work_template_runs enable row level security;
revoke all on private.work_tasks,private.work_task_history,private.work_task_templates,private.work_template_runs from public,anon,authenticated,service_role;

create function private.can_read_work_task(p_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select private.actor_active() and exists(select 1 from private.work_tasks t where t.id=p_id
  and (t.scope='private' and t.creator_id=auth.uid() or t.scope='operations' and private.chat_staff(auth.uid()) and (t.creator_id=auth.uid() or t.assignee_id=auth.uid() or private.has_permission('jobs.manage')))
  and (t.source_message_id is null or exists(select 1 from public.messages m where m.id=t.source_message_id and m.deleted_at is null and private.can_access_chat_room(m.room_id))));
$$;
create function private.work_task_json(p_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',t.id,'title',t.title,'description',t.description,'scope',t.scope,'state',t.state,'due_at',t.due_at,'time_zone',t.time_zone,'version',t.version,'creator_id',t.creator_id,'assignee_id',t.assignee_id,'assignee_name',p.display_name,
  'source_message_id',t.source_message_id,'source_room_id',(select m.room_id from public.messages m where m.id=t.source_message_id),'created_at',t.created_at,'updated_at',t.updated_at)
 from private.work_tasks t join public.profiles p on p.id=t.assignee_id where t.id=p_id and private.can_read_work_task(t.id);
$$;
create function private.work_tasks(p_before_at timestamptz default null,p_before_id uuid default null,p_limit integer default 50,p_state text default '') returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not private.actor_active() then raise exception 'Active account required' using errcode='42501';end if;
 if p_limit is null or p_limit not between 1 and 100 or (p_before_at is null)<>(p_before_id is null) or p_state is null or p_state not in('','open','doing','done','cancelled') then raise exception 'Invalid task page' using errcode='22023';end if;
 return jsonb_build_object('can_manage',private.has_permission('jobs.manage'),
 'items',coalesce((select jsonb_agg(private.work_task_json(t.id) order by t.created_at desc,t.id desc) from
  (select * from private.work_tasks t where private.can_read_work_task(t.id) and (p_state='' or t.state=p_state) and (p_before_at is null or (t.created_at,t.id)<(p_before_at,p_before_id)) order by t.created_at desc,t.id desc limit p_limit) t),'[]'::jsonb),
 'assignees',case when private.has_permission('jobs.manage') then coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.display_name) order by p.display_name,p.id) from public.profiles p where p.active and private.chat_staff(p.id)),'[]'::jsonb) else '[]'::jsonb end,
 'templates',coalesce((select jsonb_agg(jsonb_build_object('id',w.id,'title',w.title,'shared',w.shared,'items',w.items,'version',w.version,'archived',w.archived,'can_edit',w.creator_id=auth.uid() and (not w.shared or private.has_permission('jobs.manage'))) order by w.created_at desc,w.id) from private.work_task_templates w where (w.creator_id=auth.uid() or w.shared and private.chat_staff(auth.uid()))),'[]'::jsonb));
end;$$;
create function public.work_tasks(p_before_at timestamptz default null,p_before_id uuid default null,p_limit integer default 50,p_state text default '') returns jsonb language sql stable security invoker set search_path='' as $$select private.work_tasks(p_before_at,p_before_id,p_limit,p_state);$$;

create function private.save_work_task(p_id uuid,p_payload jsonb,p_expected_version integer,p_client_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t private.work_tasks; old jsonb; own_id uuid:=auth.uid(); result_id uuid; target uuid; task_scope text; due timestamptz; zone text; source_id uuid;
begin
 if not private.actor_active() then raise exception 'Active account required' using errcode='42501';end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or exists(select 1 from jsonb_object_keys(p_payload) k where k not in('title','description','state','due_at','time_zone','scope','assignee_id','source_message_id'))
 or not(p_payload ?& array['title','description','state','due_at','time_zone','scope','assignee_id','source_message_id'])
 or jsonb_typeof(p_payload->'title')<>'string' or jsonb_typeof(p_payload->'description')<>'string'
 or jsonb_typeof(p_payload->'state')<>'string' or jsonb_typeof(p_payload->'scope')<>'string' or jsonb_typeof(p_payload->'time_zone')<>'string' or jsonb_typeof(p_payload->'assignee_id')<>'string'
 or jsonb_typeof(p_payload->'due_at') not in('string','null') or jsonb_typeof(p_payload->'source_message_id') not in('string','null')
 or length(trim(p_payload->>'title')) not between 1 and 200 or length(p_payload->>'description')>8000
 or (p_payload->>'state') not in('open','doing','done','cancelled') or (p_payload->>'scope') not in('private','operations')
 or not exists(select 1 from pg_catalog.pg_timezone_names where name=p_payload->>'time_zone') then raise exception 'Invalid task data' using errcode='22023';end if;
 begin
  target=(p_payload->>'assignee_id')::uuid;source_id=(p_payload->>'source_message_id')::uuid;due=(p_payload->>'due_at')::timestamptz;
 exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then raise exception 'Invalid task value' using errcode='22023';end;
 if target is null or due is not null and (not isfinite(due) or due<'2000-01-01'::timestamptz or due>='2101-01-01'::timestamptz) then raise exception 'Invalid task target or date' using errcode='22023';end if;
 task_scope=p_payload->>'scope';zone=p_payload->>'time_zone';
 if task_scope='private' and target<>own_id or task_scope='operations' and not private.chat_staff(own_id) then raise exception 'Task scope denied' using errcode='42501';end if;
 if task_scope='operations' and not exists(select 1 from public.profiles p where p.id=target and p.active and private.chat_staff(p.id)) then raise exception 'Staff assignee required' using errcode='42501';end if;
 if source_id is not null and (task_scope<>'private' or target<>own_id or not exists(select 1 from public.messages m where m.id=source_id and m.deleted_at is null and private.can_access_chat_room(m.room_id))) then raise exception 'Message task denied' using errcode='42501';end if;
 perform 1 from public.profiles where id=own_id and active for share;
 if not found then raise exception 'Active account required' using errcode='42501';end if;
 if p_id is null then
  if p_client_id is null or p_expected_version is distinct from 0 then raise exception 'Creation identity required' using errcode='22023';end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('task:'||own_id::text,0));
  select * into t from private.work_tasks where creator_id=own_id and client_id=p_client_id;
  if found then
   if t.request_payload is distinct from p_payload then raise exception 'Task retry changed' using errcode='22023';end if;
   if not private.can_read_work_task(t.id) then raise exception 'Task access revoked' using errcode='42501';end if;
   return private.work_task_json(t.id);
  end if;
  if task_scope='operations' and not private.has_permission('jobs.manage') then raise exception 'Task delegation requires management and MFA' using errcode='42501';end if;
  if (select count(*) from private.work_tasks where creator_id=own_id)>=5000 then raise exception 'Task quota reached' using errcode='54000';end if;
  insert into private.work_tasks(creator_id,assignee_id,scope,title,description,state,due_at,time_zone,source_message_id,client_id,request_payload)
   values(own_id,target,task_scope,trim(p_payload->>'title'),p_payload->>'description',p_payload->>'state',due,zone,source_id,p_client_id,p_payload) returning id into result_id;
 else
  select * into t from private.work_tasks where id=p_id for update;
  if not found or not private.can_read_work_task(p_id) then raise exception 'Task unavailable' using errcode='42501';end if;
  if t.version is distinct from p_expected_version then raise exception 'Task changed; reload' using errcode='40001';end if;
  if source_id is distinct from t.source_message_id then raise exception 'Task source is immutable' using errcode='22023';end if;
  if (target<>t.assignee_id or task_scope<>t.scope or (t.creator_id<>own_id and (p_payload->>'title'<>t.title or p_payload->>'description'<>t.description or due is distinct from t.due_at or zone<>t.time_zone))) and not private.has_permission('jobs.manage') then raise exception 'Task delegation denied' using errcode='42501';end if;
  if task_scope='operations' and t.scope='private' then raise exception 'Private tasks cannot become shared' using errcode='42501';end if;
  old=private.work_task_json(t.id);
  update private.work_tasks set title=trim(p_payload->>'title'),description=p_payload->>'description',state=p_payload->>'state',due_at=due,time_zone=zone,scope=task_scope,assignee_id=target,version=version+1,updated_at=now() where id=t.id returning id into result_id;
 end if;
 insert into private.work_task_history(task_id,actor_id,before_state,after_state) values(result_id,own_id,old,private.work_task_json(result_id));
 if target<>own_id and (old is null or old->>'assignee_id' is distinct from target::text) then insert into public.notifications(user_id,kind,resource_id) values(target,'task_assigned',result_id) on conflict(user_id,kind,resource_id) do update set created_at=now(),read_at=null;end if;
 return private.work_task_json(result_id);
end;$$;
create function public.save_work_task(p_id uuid,p_payload jsonb,p_expected_version integer,p_client_id uuid default null) returns jsonb language sql security invoker set search_path='' as $$select private.save_work_task(p_id,p_payload,p_expected_version,p_client_id);$$;

create function private.work_task_history(p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.can_read_work_task(p_id) then raise exception 'Task unavailable' using errcode='42501';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',h.id,'at',h.created_at,'before',h.before_state,'after',h.after_state) order by h.id desc) from (select * from private.work_task_history where task_id=p_id order by id desc limit 100) h),'[]'::jsonb);
end;$$;
create function public.work_task_history(p_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$select private.work_task_history(p_id);$$;
create function private.bulk_work_task_state(p_items jsonb,p_state text) returns integer language plpgsql security definer set search_path='' as $$
declare item jsonb;t private.work_tasks;count integer:=0;payload jsonb;
begin
 if not private.actor_active() then raise exception 'Active account required' using errcode='42501';end if;
 if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 50 or p_state is null or p_state not in('open','doing','done','cancelled')
 or exists(select 1 from jsonb_array_elements(p_items) x where jsonb_typeof(x)<>'object' or (select count(*) from jsonb_object_keys(x))<>2 or not(x ?& array['id','version']))
 or (select count(distinct x->>'id') from jsonb_array_elements(p_items) x)<>jsonb_array_length(p_items) then raise exception 'Invalid task batch' using errcode='22023';end if;
 for item in select x from jsonb_array_elements(p_items) x order by x->>'id' loop
  select * into t from private.work_tasks where id=(item->>'id')::uuid for update;
  if not found or not private.can_read_work_task(t.id) then raise exception 'Task batch denied' using errcode='42501';end if;
  payload=t.request_payload||jsonb_build_object('title',t.title,'description',t.description,'state',p_state,'due_at',t.due_at,'time_zone',t.time_zone,'scope',t.scope,'assignee_id',t.assignee_id,'source_message_id',t.source_message_id);
  perform private.save_work_task(t.id,payload,(item->>'version')::integer,null);count=count+1;
 end loop;
 return count;
end;$$;
create function public.bulk_work_task_state(p_items jsonb,p_state text) returns integer language sql security invoker set search_path='' as $$select private.bulk_work_task_state(p_items,p_state);$$;

create function private.save_work_template(p_id uuid,p_payload jsonb,p_expected_version integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare w private.work_task_templates;item jsonb;
begin
 if not private.actor_active() then raise exception 'Active account required' using errcode='42501';end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or (select count(*) from jsonb_object_keys(p_payload))<>4 or not(p_payload ?& array['title','shared','archived','items'])
 or jsonb_typeof(p_payload->'title')<>'string' or length(trim(p_payload->>'title')) not between 1 and 200 or jsonb_typeof(p_payload->'shared')<>'boolean' or jsonb_typeof(p_payload->'archived')<>'boolean' or jsonb_typeof(p_payload->'items')<>'array' or jsonb_array_length(p_payload->'items') not between 1 and 30 then raise exception 'Invalid workflow template' using errcode='22023';end if;
 for item in select x from jsonb_array_elements(p_payload->'items') x loop
  if jsonb_typeof(item)<>'object' or (select count(*) from jsonb_object_keys(item))<>2 or not(item ?& array['title','days']) or jsonb_typeof(item->'title')<>'string' or length(trim(item->>'title')) not between 1 and 200 or jsonb_typeof(item->'days')<>'number' or (item->>'days')!~'^\d{1,3}$' or (item->>'days')::integer>365 then raise exception 'Invalid workflow item' using errcode='22023';end if;
 end loop;
 if (p_payload->>'shared')::boolean and not private.has_permission('jobs.manage') then raise exception 'Shared workflow requires management and MFA' using errcode='42501';end if;
 if p_id is null then
  if p_expected_version is distinct from 0 then raise exception 'Invalid new workflow version' using errcode='40001';end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('work-template:'||auth.uid()::text,0));
  if (select count(*) from private.work_task_templates where creator_id=auth.uid())>=100 then raise exception 'Workflow quota reached' using errcode='54000';end if;
  insert into private.work_task_templates(creator_id,title,shared,archived,items) values(auth.uid(),trim(p_payload->>'title'),(p_payload->>'shared')::boolean,(p_payload->>'archived')::boolean,p_payload->'items') returning * into w;
 else
  select * into w from private.work_task_templates where id=p_id for update;
  if not found or w.creator_id<>auth.uid() then raise exception 'Own workflow required' using errcode='42501';end if;
  if w.shared and not private.has_permission('jobs.manage') then raise exception 'Shared workflow requires management and MFA' using errcode='42501';end if;
  if p_expected_version is distinct from w.version then raise exception 'Workflow changed; reload' using errcode='40001';end if;
  update private.work_task_templates set title=trim(p_payload->>'title'),shared=(p_payload->>'shared')::boolean,archived=(p_payload->>'archived')::boolean,items=p_payload->'items',version=version+1 where id=w.id returning * into w;
 end if;
 return jsonb_build_object('id',w.id,'version',w.version);
end;$$;
create function public.save_work_template(p_id uuid,p_payload jsonb,p_expected_version integer) returns jsonb language sql security invoker set search_path='' as $$select private.save_work_template(p_id,p_payload,p_expected_version);$$;
create function private.apply_work_template(p_id uuid,p_expected_version integer,p_client_id uuid) returns uuid[] language plpgsql security definer set search_path='' as $$
declare w private.work_task_templates;r private.work_template_runs;item jsonb;result uuid[]:='{}';task jsonb;zone text;
begin
 if not private.actor_active() or p_client_id is null then raise exception 'Active identity and request required' using errcode='42501';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('template-run:'||auth.uid()::text,0));
 select * into r from private.work_template_runs where user_id=auth.uid() and client_id=p_client_id;
 if found then if r.template_id<>p_id or r.template_version is distinct from p_expected_version then raise exception 'Workflow retry changed' using errcode='22023';end if;return r.task_ids;end if;
 select * into w from private.work_task_templates where id=p_id for share;
 if not found or w.archived or not(w.creator_id=auth.uid() or w.shared and private.chat_staff(auth.uid())) then raise exception 'Workflow unavailable' using errcode='42501';end if;
 if w.version is distinct from p_expected_version then raise exception 'Workflow changed' using errcode='40001';end if;
 select time_zone into zone from public.profiles where id=auth.uid();
 for item in select x from jsonb_array_elements(w.items) x loop
  task=private.save_work_task(null,jsonb_build_object('title',item->>'title','description','','state','open','due_at',now()+make_interval(days=>(item->>'days')::integer),'time_zone',zone,'scope','private','assignee_id',auth.uid(),'source_message_id',null),0,gen_random_uuid());
  result=array_append(result,(task->>'id')::uuid);
 end loop;
 insert into private.work_template_runs(user_id,client_id,template_id,template_version,task_ids) values(auth.uid(),p_client_id,w.id,w.version,result);
 return result;
end;$$;
create function public.apply_work_template(p_id uuid,p_expected_version integer,p_client_id uuid) returns uuid[] language sql security invoker set search_path='' as $$select private.apply_work_template(p_id,p_expected_version,p_client_id);$$;

create function private.recommended_jobs() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.actor_active() then raise exception 'Active account required' using errcode='42501';end if;
 if not private.lecturer_actor() then return '[]'::jsonb;end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'title',x.title,'customer',x.customer_name,'starts_at',x.begins,'time_zone',x.time_zone,'topic_matches',x.topic_matches,'favourite_topic',x.favourite_topic,'favourite_customer',x.favourite_customer) order by x.score desc,x.begins,x.id)
 from (
 select j.id,j.title,j.customer_name,j.time_zone,s.begins,
  (select count(*) from public.job_requirements req join public.lecturer_topics topic on topic.topic_id=req.topic_id and topic.user_id=auth.uid() and topic.verified where req.job_id=j.id) topic_matches,
  exists(select 1 from public.job_requirements req join private.personal_favourites f on f.user_id=auth.uid() and f.kind='topic' and f.resource_id=req.topic_id where req.job_id=j.id) favourite_topic,
  exists(select 1 from public.course_runs run join private.personal_favourites f on f.user_id=auth.uid() and f.kind='organisation' and f.resource_id=run.organisation_id where run.id=j.course_run_id) favourite_customer,
  (select count(*) from public.job_requirements req join public.lecturer_topics topic on topic.topic_id=req.topic_id and topic.user_id=auth.uid() and topic.verified where req.job_id=j.id)
   +case when exists(select 1 from public.job_requirements req join private.personal_favourites f on f.user_id=auth.uid() and f.kind='topic' and f.resource_id=req.topic_id where req.job_id=j.id) then 2 else 0 end
   +case when exists(select 1 from public.course_runs run join private.personal_favourites f on f.user_id=auth.uid() and f.kind='organisation' and f.resource_id=run.organisation_id where run.id=j.course_run_id) then 2 else 0 end score
 from public.jobs j cross join lateral(select min(starts_at) begins,max(ends_at) ends from public.job_sessions where job_id=j.id) s
 where private.can_read_job(j.id) and j.status='published' and s.begins>now() and (j.claim_deadline is null or j.claim_deadline>now())
  and (select count(*) from public.job_claims c where c.job_id=j.id and c.status='confirmed')<j.capacity
  and not exists(select 1 from public.job_claims c where c.job_id=j.id and c.lecturer_id=auth.uid() and c.status='confirmed')
  and not exists(select 1 from public.job_requirements req where req.job_id=j.id and not exists(select 1 from public.lecturer_topics topic where topic.user_id=auth.uid() and topic.topic_id=req.topic_id and topic.verified and (topic.valid_until is null or topic.valid_until>=s.ends)))
  and (not j.requires_contract or private.current_contract_for_interval(auth.uid(),s.begins,s.ends) is not null)
  and not exists(select 1 from public.job_sessions js join public.assignment_sessions a on a.lecturer_id=auth.uid() and a.released_at is null and tstzrange(a.starts_at,a.ends_at,'[)')&&tstzrange(js.starts_at,js.ends_at,'[)') where js.job_id=j.id)
  and not exists(select 1 from public.job_sessions js join public.personal_events e on e.user_id=auth.uid() and tstzrange(e.starts_at,e.ends_at,'[)')&&tstzrange(js.starts_at,js.ends_at,'[)') where js.job_id=j.id)
  and not exists(select 1 from public.job_sessions js join public.lecturer_availability a on a.user_id=auth.uid() and a.kind='unavailable' and tstzrange(a.starts_at,a.ends_at,'[)')&&tstzrange(js.starts_at,js.ends_at,'[)') where js.job_id=j.id)
 order by score desc,s.begins,j.id limit 20
 ) x),'[]'::jsonb);
end;$$;
create function public.recommended_jobs() returns jsonb language sql stable security invoker set search_path='' as $$select private.recommended_jobs();$$;

revoke all on function private.favourite_resource(text,uuid),private.can_read_work_task(uuid),private.work_task_json(uuid) from public,anon,authenticated,service_role;
revoke all on function private.my_favourites(text),public.my_favourites(text),private.set_favourite(text,uuid,boolean),public.set_favourite(text,uuid,boolean),private.work_tasks(timestamptz,uuid,integer,text),public.work_tasks(timestamptz,uuid,integer,text),private.save_work_task(uuid,jsonb,integer,uuid),public.save_work_task(uuid,jsonb,integer,uuid),private.work_task_history(uuid),public.work_task_history(uuid),private.bulk_work_task_state(jsonb,text),public.bulk_work_task_state(jsonb,text),private.save_work_template(uuid,jsonb,integer),public.save_work_template(uuid,jsonb,integer),private.apply_work_template(uuid,integer,uuid),public.apply_work_template(uuid,integer,uuid) from public,anon,authenticated,service_role;
grant execute on function private.my_favourites(text),public.my_favourites(text),private.set_favourite(text,uuid,boolean),public.set_favourite(text,uuid,boolean),private.work_tasks(timestamptz,uuid,integer,text),public.work_tasks(timestamptz,uuid,integer,text),private.save_work_task(uuid,jsonb,integer,uuid),public.save_work_task(uuid,jsonb,integer,uuid),private.work_task_history(uuid),public.work_task_history(uuid),private.bulk_work_task_state(jsonb,text),public.bulk_work_task_state(jsonb,text),private.save_work_template(uuid,jsonb,integer),public.save_work_template(uuid,jsonb,integer),private.apply_work_template(uuid,integer,uuid),public.apply_work_template(uuid,integer,uuid) to authenticated;
revoke all on function private.recommended_jobs(),public.recommended_jobs() from public,anon,authenticated,service_role;
grant execute on function private.recommended_jobs(),public.recommended_jobs() to authenticated;
commit;
