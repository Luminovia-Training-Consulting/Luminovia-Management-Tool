begin;

-- Delivery is evidence about accepted freelance work. It never recalculates a
-- claim, compensation snapshot, invoice or payment.
create table private.delivery_records (
 session_id uuid primary key references public.assignment_sessions(id),
 status text not null default 'draft' check(status in ('draft','submitted','confirmed','disputed','correction_requested')),
 version integer not null default 0 check(version>=0),
 draft jsonb not null default '{}'::jsonb,
 latest_submission_id uuid,
 updated_at timestamptz not null default clock_timestamp()
);
create table private.delivery_submissions (
 id uuid primary key default gen_random_uuid(),
 session_id uuid not null references private.delivery_records(session_id),
 revision integer not null check(revision>0),
 lecturer_id uuid not null references public.profiles(id),
 outcome text not null check(outcome in ('completed','partial','cancelled','interrupted')),
 actual_start timestamptz, actual_end timestamptz,
 time_zone text not null,
 notes text not null check(length(notes)<=4000),
 correction_reason text not null check(length(correction_reason)<=1000),
 scheduled_start timestamptz not null,scheduled_end timestamptz not null,
 created_at timestamptz not null default clock_timestamp(),
 unique(session_id,revision),
 check((outcome='cancelled' and actual_start is null and actual_end is null)
  or (outcome<>'cancelled' and actual_start is not null and actual_end is not null
   and isfinite(actual_start) and isfinite(actual_end) and actual_end>actual_start and actual_end-actual_start<=interval '24 hours'))
);
alter table private.delivery_records add constraint delivery_latest_submission foreign key(latest_submission_id) references private.delivery_submissions(id);
create table private.delivery_events (
 id uuid primary key default gen_random_uuid(),session_id uuid not null references private.delivery_records(session_id),
 submission_id uuid references private.delivery_submissions(id),
 actor_id uuid not null references public.profiles(id),
 action text not null check(action in ('submitted','confirmed','disputed','correction_requested','customer_confirmed')),
 note text not null default '' check(length(note)<=2000),
 created_at timestamptz not null default clock_timestamp()
);
create table private.delivery_operations (
 actor_id uuid not null references public.profiles(id),request_id uuid not null,
 payload jsonb not null,result jsonb not null,primary key(actor_id,request_id)
);
create index delivery_submissions_session on private.delivery_submissions(session_id,revision desc);
create index delivery_events_session on private.delivery_events(session_id,created_at,id);
create index assignment_delivery_page on public.assignment_sessions(starts_at desc,id desc);
alter table private.delivery_records enable row level security;
alter table private.delivery_submissions enable row level security;
alter table private.delivery_events enable row level security;
alter table private.delivery_operations enable row level security;
revoke all on private.delivery_records,private.delivery_submissions,private.delivery_events,private.delivery_operations from public,anon,authenticated;

create function private.immutable_delivery_evidence() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Submitted delivery evidence and history are immutable' using errcode='55000';end;$$;
create trigger immutable_delivery_submissions before update or delete on private.delivery_submissions for each row execute function private.immutable_delivery_evidence();
create trigger immutable_delivery_events before update or delete on private.delivery_events for each row execute function private.immutable_delivery_evidence();
create trigger immutable_delivery_operations before update or delete on private.delivery_operations for each row execute function private.immutable_delivery_evidence();

create function private.delivery_manager() returns boolean language sql stable security definer set search_path='' as $$
 select private.has_permission('courses.manage') or private.has_permission('finance.manage');
$$;
create function private.delivery_can_read(p_session_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.actor_active() and exists(
  select 1 from public.assignment_sessions s join public.job_claims c on c.id=s.claim_id
  join public.jobs j on j.id=c.job_id left join public.course_runs r on r.id=j.course_run_id
  left join private.delivery_records d on d.session_id=s.id
  where s.id=p_session_id and (c.lecturer_id=auth.uid() or private.delivery_manager()
   or (d.status='confirmed' and private.client_has_organisation(r.organisation_id))));
$$;

create function private.delivery_projection(p_session_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare item jsonb;
begin
 if not private.delivery_can_read(p_session_id) then raise exception 'Delivery access required' using errcode='42501';end if;
 select jsonb_build_object('session_id',s.id,'claim_id',c.id,'job_id',j.id,'course_run_id',j.course_run_id,
 'title',j.title,'lecturer_name',p.display_name,'scheduled_start',s.starts_at,'scheduled_end',s.ends_at,
 'time_zone',j.time_zone,'status',coalesce(d.status,'missing'),'version',coalesce(d.version,0),
 'scheduled_minutes',extract(epoch from(s.ends_at-s.starts_at))/60,
 'actual_minutes',coalesce(extract(epoch from(v.actual_end-v.actual_start))/60,0),
 'draft',case when c.lecturer_id=auth.uid() then d.draft end,
 'submission',case when v.id is not null then jsonb_build_object('id',v.id,'revision',v.revision,'outcome',v.outcome,
  'actual_start',v.actual_start,'actual_end',v.actual_end,'time_zone',v.time_zone,'created_at',v.created_at,
  'notes',case when c.lecturer_id=auth.uid() or private.delivery_manager() then v.notes end,
  'correction_reason',case when c.lecturer_id=auth.uid() or private.delivery_manager() then v.correction_reason end) end,
 'invoice_id',case when c.lecturer_id=auth.uid() or private.has_permission('finance.manage') then (select i.invoice_id from public.invoice_items i where i.claim_id=c.id and i.active limit 1) end,
 'can_edit',c.lecturer_id=auth.uid() and private.lecturer_actor() and c.status='confirmed' and s.released_at is null and coalesce(d.status,'draft') in('draft','disputed','correction_requested'),
 'can_review',private.delivery_manager() and c.lecturer_id<>auth.uid() and d.latest_submission_id is not null and d.status in('submitted','confirmed','disputed'),
 'can_customer_confirm',private.client_has_organisation(r.organisation_id) and d.status='confirmed'
  and not exists(select 1 from private.delivery_events e where e.submission_id=v.id and e.action='customer_confirmed'),
 'customer_confirmed',exists(select 1 from private.delivery_events e where e.submission_id=v.id and e.action='customer_confirmed'))
 into item from public.assignment_sessions s join public.job_claims c on c.id=s.claim_id
 join public.jobs j on j.id=c.job_id join public.profiles p on p.id=c.lecturer_id
 left join public.course_runs r on r.id=j.course_run_id
 left join private.delivery_records d on d.session_id=s.id
 left join private.delivery_submissions v on v.id=d.latest_submission_id where s.id=p_session_id;
 return item;
end;$$;

create function public.delivery_session(p_session_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$select private.delivery_projection(p_session_id);$$;

create function private.delivery_sessions(p_scope text default 'own',p_before_at timestamptz default null,p_before_id uuid default null,p_limit integer default 50) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; count_rows integer;
begin
 if not private.actor_active() or (p_scope='management' and not private.delivery_manager())
  or (p_scope='customer' and not private.has_role(array['client'])) then raise exception 'Delivery scope denied' using errcode='42501';end if;
 if p_scope is null or p_scope not in('own','management','customer') or p_limit is null or p_limit not between 1 and 100
  or ((p_before_at is null)<>(p_before_id is null)) or (p_before_at is not null and not isfinite(p_before_at)) then
  raise exception 'Invalid delivery page' using errcode='22023';end if;
 select coalesce(jsonb_agg(x.item order by x.starts_at desc,x.id desc),'[]'::jsonb),count(*) into result,count_rows from (
  select s.id,s.starts_at,private.delivery_projection(s.id) item
  from public.assignment_sessions s join public.job_claims c on c.id=s.claim_id join public.jobs j on j.id=c.job_id
  left join public.course_runs r on r.id=j.course_run_id left join private.delivery_records d on d.session_id=s.id
  where ((p_scope='own' and c.lecturer_id=auth.uid()) or p_scope='management'
   or (p_scope='customer' and d.status='confirmed' and private.client_has_organisation(r.organisation_id)))
   and (p_before_at is null or (s.starts_at,s.id)<(p_before_at,p_before_id))
  order by s.starts_at desc,s.id desc limit p_limit+1
 ) x;
 return jsonb_build_object('items',case when count_rows>p_limit then result-p_limit else result end,'has_more',count_rows>p_limit);
end;$$;
create function public.delivery_sessions(p_scope text default 'own',p_before_at timestamptz default null,p_before_id uuid default null,p_limit integer default 50) returns jsonb language sql stable security invoker set search_path='' as $$select private.delivery_sessions(p_scope,p_before_at,p_before_id,p_limit);$$;

create function private.delivery_history(p_session_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare confidential boolean;
begin
 if not private.delivery_can_read(p_session_id) then raise exception 'Delivery access required' using errcode='42501';end if;
 confidential:=private.delivery_manager() or exists(select 1 from public.assignment_sessions s join public.job_claims c on c.id=s.claim_id where s.id=p_session_id and c.lecturer_id=auth.uid());
 return jsonb_build_object('submissions',(
  select coalesce(jsonb_agg(jsonb_build_object('id',v.id,'revision',v.revision,'outcome',v.outcome,'actual_start',v.actual_start,'actual_end',v.actual_end,'time_zone',v.time_zone,
   'scheduled_start',v.scheduled_start,'scheduled_end',v.scheduled_end,'created_at',v.created_at,
   'notes',case when confidential then v.notes end,'correction_reason',case when confidential then v.correction_reason end) order by v.revision desc),'[]'::jsonb)
  from private.delivery_submissions v where v.session_id=p_session_id and (confidential or v.id=(select d.latest_submission_id from private.delivery_records d where d.session_id=p_session_id))),
  'events',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'submission_id',e.submission_id,'action',e.action,'created_at',e.created_at,
   'note',case when confidential then e.note end) order by e.created_at,e.id),'[]'::jsonb)
  from private.delivery_events e where e.session_id=p_session_id and (confidential or e.action in('confirmed','customer_confirmed'))));
end;$$;
create function public.delivery_history(p_session_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$select private.delivery_history(p_session_id);$$;

-- All writes serialize on the claim then session. Durable request receipts
-- make response-loss retries idempotent, even after a later version advances.
create function private.delivery_mutate(p_session_id uuid,p_expected_version integer,p_action text,p_payload jsonb,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.assignment_sessions;c public.job_claims;d private.delivery_records;
 operation jsonb;prior private.delivery_operations;result jsonb;submission uuid;event_id uuid;
 outcome text;actual_start timestamptz;actual_end timestamptz;zone text;notes text;reason text;note text;
 revision integer;next_state text;
begin
 perform 1 from public.profiles p where p.id=auth.uid() and p.active for share;
 if not found or not private.actor_active() then raise exception 'Active account required' using errcode='42501';end if;
 if p_session_id is null or p_expected_version is null or p_expected_version<0 or p_request_id is null
  or p_action is null or p_action not in('draft','submit','confirm','dispute','request_correction','customer_confirm')
  or p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'Invalid delivery operation' using errcode='22023';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('delivery-request:'||auth.uid()::text||':'||p_request_id::text,0));
 select * into c from public.job_claims where id=(select a.claim_id from public.assignment_sessions a where a.id=p_session_id) for update;
 if not found then raise exception 'Delivery unavailable' using errcode='42501';end if;
 select * into s from public.assignment_sessions where id=p_session_id for update;
 if not private.delivery_can_read(s.id) then raise exception 'Delivery access required' using errcode='42501';end if;
 if p_action in('draft','submit') and (c.lecturer_id<>auth.uid() or not private.lecturer_actor() or c.status<>'confirmed' or s.released_at is not null) then raise exception 'Own active assignment required' using errcode='42501';end if;
 if p_action in('confirm','dispute','request_correction') and (not private.delivery_manager() or c.lecturer_id=auth.uid()) then raise exception 'Independent delivery management and MFA required' using errcode='42501';end if;
 if p_action='customer_confirm' and not exists(select 1 from public.jobs j join public.course_runs r on r.id=j.course_run_id where j.id=c.job_id and private.client_has_organisation(r.organisation_id)) then raise exception 'Assigned customer required' using errcode='42501';end if;
 operation:=jsonb_build_object('session_id',p_session_id,'expected_version',p_expected_version,'action',p_action,'payload',p_payload);
 select * into prior from private.delivery_operations where actor_id=auth.uid() and request_id=p_request_id;
 if found then
  if prior.payload<>operation then raise exception 'Delivery request key reused with different values' using errcode='22023';end if;
  return prior.result;
 end if;
 insert into private.delivery_records(session_id) values(s.id) on conflict do nothing;
 select * into d from private.delivery_records where session_id=s.id for update;
 if p_expected_version<>d.version then raise exception 'Delivery changed; reload' using errcode='40001';end if;
 submission:=d.latest_submission_id;
 if p_action='draft' then
  if d.status not in('draft','disputed','correction_requested') then raise exception 'Submitted evidence requires an explicit correction request' using errcode='22023';end if;
  if (select count(*) from jsonb_object_keys(p_payload))<>6
   or exists(select 1 from jsonb_object_keys(p_payload) k where k not in('outcome','actual_start','actual_end','time_zone','notes','correction_reason'))
   or exists(select 1 from jsonb_each(p_payload) x where x.key in('outcome','time_zone','notes','correction_reason') and jsonb_typeof(x.value)<>'string')
   or exists(select 1 from jsonb_each(p_payload) x where x.key in('actual_start','actual_end') and jsonb_typeof(x.value) not in('string','null')) then raise exception 'Invalid delivery fields' using errcode='22023';end if;
  outcome:=p_payload->>'outcome';zone:=p_payload->>'time_zone';notes:=btrim(p_payload->>'notes');reason:=btrim(p_payload->>'correction_reason');
  if outcome not in('completed','partial','cancelled','interrupted') or zone is null
   or not exists(select 1 from pg_catalog.pg_timezone_names where name=zone)
   or notes is null or length(notes)>4000 or reason is null or length(reason)>1000
   or (outcome<>'completed' and length(notes)<5) or (d.latest_submission_id is not null and length(reason)<5) then raise exception 'Delivery outcome, times, zone and correction explanation required' using errcode='22023';end if;
  begin actual_start:=(p_payload->>'actual_start')::timestamptz;actual_end:=(p_payload->>'actual_end')::timestamptz;
  exception when invalid_datetime_format or datetime_field_overflow then raise exception 'Invalid delivery time' using errcode='22023';end;
  if (actual_start is not null and (p_payload->>'actual_start')!~'([zZ]|[+-][0-9]{2}:[0-9]{2})$')
   or (actual_end is not null and (p_payload->>'actual_end')!~'([zZ]|[+-][0-9]{2}:[0-9]{2})$') then raise exception 'Explicit delivery time offset required' using errcode='22023';end if;
  if (outcome='cancelled' and (actual_start is not null or actual_end is not null))
   or (outcome<>'cancelled' and (actual_start is null or actual_end is null or not isfinite(actual_start) or not isfinite(actual_end) or actual_end<=actual_start or actual_end-actual_start>interval '24 hours')) then raise exception 'Invalid actual delivery interval' using errcode='22023';end if;
  update private.delivery_records set draft=jsonb_build_object('outcome',outcome,'actual_start',actual_start,'actual_end',actual_end,'time_zone',zone,'notes',notes,'correction_reason',reason),status='draft',version=version+1,updated_at=clock_timestamp() where session_id=s.id;
 elsif p_action='submit' then
  if p_payload<>'{}'::jsonb or d.status<>'draft' or d.draft='{}'::jsonb then raise exception 'Saved delivery draft required' using errcode='22023';end if;
  if (d.draft->>'actual_end')::timestamptz>clock_timestamp() or (d.draft->>'outcome'<>'cancelled' and s.starts_at>clock_timestamp()) then raise exception 'Future delivery cannot be submitted' using errcode='22023';end if;
  select coalesce(max(v.revision),0)+1 into revision from private.delivery_submissions v where v.session_id=s.id;
  insert into private.delivery_submissions(session_id,revision,lecturer_id,outcome,actual_start,actual_end,time_zone,notes,correction_reason,scheduled_start,scheduled_end)
   values(s.id,revision,auth.uid(),d.draft->>'outcome',(d.draft->>'actual_start')::timestamptz,(d.draft->>'actual_end')::timestamptz,d.draft->>'time_zone',d.draft->>'notes',d.draft->>'correction_reason',s.starts_at,s.ends_at) returning id into submission;
  next_state:='submitted';
 else
  if (select count(*) from jsonb_object_keys(p_payload))<>(case when p_action='customer_confirm' then 0 else 1 end)
   or (p_action<>'customer_confirm' and (jsonb_typeof(p_payload->'note') is distinct from 'string')) then raise exception 'Invalid delivery decision' using errcode='22023';end if;
  note:=btrim(coalesce(p_payload->>'note',''));
  if length(note)>2000 or (p_action in('dispute','request_correction') and length(note)<5) then raise exception 'Decision explanation required' using errcode='22023';end if;
  if submission is null or (p_action='confirm' and d.status<>'submitted')
   or (p_action in('dispute','request_correction') and d.status not in('submitted','confirmed','disputed'))
   or (p_action='customer_confirm' and (d.status<>'confirmed' or exists(select 1 from private.delivery_events e where e.submission_id=submission and e.action='customer_confirmed'))) then raise exception 'Invalid delivery transition' using errcode='22023';end if;
  next_state:=case p_action when 'confirm' then 'confirmed' when 'dispute' then 'disputed' when 'request_correction' then 'correction_requested' else 'confirmed' end;
 end if;
 if p_action<>'draft' then
  update private.delivery_records set status=next_state,latest_submission_id=submission,version=version+1,updated_at=clock_timestamp() where session_id=s.id;
  insert into private.delivery_events(session_id,submission_id,actor_id,action,note) values(s.id,submission,auth.uid(),case p_action when 'submit' then 'submitted' when 'confirm' then 'confirmed' when 'dispute' then 'disputed' when 'request_correction' then 'correction_requested' else 'customer_confirmed' end,coalesce(note,'')) returning id into event_id;
  if p_action='submit' then
   insert into public.notifications(user_id,kind,resource_id) select distinct p.id,'delivery_submitted',event_id from public.profiles p join public.user_roles ur on ur.user_id=p.id join public.role_permissions rp on rp.role=ur.role where p.active and p.id<>auth.uid() and rp.permission in('courses.manage','finance.manage') on conflict do nothing;
  else
   insert into public.notifications(user_id,kind,resource_id) values(c.lecturer_id,'delivery_'||case p_action when 'confirm' then 'confirmed' when 'dispute' then 'disputed' when 'request_correction' then 'correction_requested' else 'customer_confirmed' end,event_id) on conflict do nothing;
  end if;
  insert into public.audit_events(actor_id,action,resource_id,details) values(auth.uid(),'delivery.'||p_action,s.id,jsonb_build_object('claim_id',c.id,'submission_id',submission,'event_id',event_id));
 end if;
 result:=private.delivery_projection(s.id);
 insert into private.delivery_operations(actor_id,request_id,payload,result) values(auth.uid(),p_request_id,operation,result);
 return result;
end;$$;

create function public.save_delivery_draft(p_session_id uuid,p_expected_version integer,p_payload jsonb,p_request_id uuid) returns jsonb language sql security invoker set search_path='' as $$select private.delivery_mutate(p_session_id,p_expected_version,'draft',p_payload,p_request_id);$$;
create function public.submit_delivery(p_session_id uuid,p_expected_version integer,p_request_id uuid) returns jsonb language sql security invoker set search_path='' as $$select private.delivery_mutate(p_session_id,p_expected_version,'submit','{}'::jsonb,p_request_id);$$;
create function public.review_delivery(p_session_id uuid,p_expected_version integer,p_action text,p_note text,p_request_id uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 if p_action is null or p_action not in('confirm','dispute','request_correction') then raise exception 'Invalid delivery review action' using errcode='22023';end if;
 return private.delivery_mutate(p_session_id,p_expected_version,p_action,jsonb_build_object('note',p_note),p_request_id);
end;$$;
create function public.confirm_customer_delivery(p_session_id uuid,p_expected_version integer,p_request_id uuid) returns jsonb language sql security invoker set search_path='' as $$select private.delivery_mutate(p_session_id,p_expected_version,'customer_confirm','{}'::jsonb,p_request_id);$$;

create function private.delivery_notification_target(p_kind text,p_event_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not private.actor_active() or p_kind not in('delivery_submitted','delivery_confirmed','delivery_disputed','delivery_correction_requested','delivery_customer_confirmed') then return jsonb_build_object('href',null,'title','');end if;
 select jsonb_build_object('href','/delivery?session='||s.id,'title',j.title) into result
  from private.delivery_events e join public.assignment_sessions s on s.id=e.session_id join public.job_claims c on c.id=s.claim_id join public.jobs j on j.id=c.job_id where e.id=p_event_id and private.delivery_can_read(s.id);
 return coalesce(result,jsonb_build_object('href',null,'title',''));
end;$$;

revoke execute on function private.immutable_delivery_evidence() from public,anon,authenticated;
revoke execute on function public.delivery_session(uuid) from public,anon,authenticated;
grant execute on function public.delivery_session(uuid) to authenticated;
revoke execute on function private.delivery_manager(),private.delivery_can_read(uuid),private.delivery_projection(uuid),private.delivery_sessions(text,timestamptz,uuid,integer),public.delivery_sessions(text,timestamptz,uuid,integer),private.delivery_history(uuid),public.delivery_history(uuid),private.delivery_mutate(uuid,integer,text,jsonb,uuid),public.save_delivery_draft(uuid,integer,jsonb,uuid),public.submit_delivery(uuid,integer,uuid),public.review_delivery(uuid,integer,text,text,uuid),public.confirm_customer_delivery(uuid,integer,uuid),private.delivery_notification_target(text,uuid) from public,anon,authenticated;
grant execute on function private.delivery_manager(),private.delivery_can_read(uuid),private.delivery_projection(uuid),private.delivery_sessions(text,timestamptz,uuid,integer),public.delivery_sessions(text,timestamptz,uuid,integer),private.delivery_history(uuid),public.delivery_history(uuid),private.delivery_mutate(uuid,integer,text,jsonb,uuid),public.save_delivery_draft(uuid,integer,jsonb,uuid),public.submit_delivery(uuid,integer,uuid),public.review_delivery(uuid,integer,text,text,uuid),public.confirm_customer_delivery(uuid,integer,uuid),private.delivery_notification_target(text,uuid) to authenticated;
commit;
