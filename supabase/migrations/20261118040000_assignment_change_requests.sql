begin;

-- Formal amendments for future, standalone assignments. A request snapshots the
-- accepted schedule/location and every affected claim; decisions never mutate
-- those snapshots. Course-linked/shared schedules are rejected by every write.
create table private.assignment_change_requests (
 id uuid primary key default gen_random_uuid(),
 request_key uuid not null,
 job_id uuid not null references public.jobs(id),
 created_by uuid not null references public.profiles(id),
 request_payload jsonb not null,
 reason text not null check(length(reason) between 5 and 1000),
 original_location text not null,
 proposed_location text not null check(length(proposed_location)<=500),
 original_sessions jsonb not null check(jsonb_typeof(original_sessions)='array'),
 proposed_sessions jsonb not null check(jsonb_typeof(proposed_sessions)='array'),
 expected_job_version integer not null,
 status text not null check(status in('awaiting_response','accepted','rejected','applied','superseded')),
 created_at timestamptz not null default clock_timestamp(),
 resolved_at timestamptz,
 unique(created_by,request_key)
);
create index assignment_change_requests_job on private.assignment_change_requests(job_id,created_at desc);
create table private.assignment_change_responses (
 request_id uuid not null references private.assignment_change_requests(id),
 claim_id uuid not null references public.job_claims(id),
 lecturer_id uuid not null references public.profiles(id),
 decision text check(decision is null or decision in('accepted','rejected')),
 responded_at timestamptz,
 primary key(request_id,claim_id)
);
alter table private.assignment_change_requests enable row level security;
alter table private.assignment_change_responses enable row level security;
revoke all on private.assignment_change_requests,private.assignment_change_responses from public,anon,authenticated,service_role;

-- One projection limits each record to its manager or affected lecturer. The
-- existing capacity-one schema means a standalone job has at most one claim;
-- apply still verifies the complete current affected set against its snapshot.
create function private.assignment_change_request(p_id uuid default null,p_job uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare manager boolean:=private.has_permission('jobs.manage'); result jsonb;
begin
 if not private.actor_active() then raise exception 'Authentication required' using errcode='42501';end if;
 select jsonb_agg(jsonb_build_object('id',r.id,'job_id',r.job_id,'reason',r.reason,
  'original_location',r.original_location,'proposed_location',r.proposed_location,
  'original_sessions',r.original_sessions,'proposed_sessions',r.proposed_sessions,
  'status',r.status,'created_at',r.created_at,'resolved_at',r.resolved_at,
  'can_decide',r.status='awaiting_response' and exists(select 1 from private.assignment_change_responses x where x.request_id=r.id and x.lecturer_id=auth.uid() and x.decision is null),
  'can_apply',manager and r.status='accepted',
  'responses',(select coalesce(jsonb_agg(jsonb_build_object('claim_id',x.claim_id,'lecturer_id',x.lecturer_id,'decision',x.decision,'responded_at',x.responded_at) order by x.claim_id),'[]'::jsonb) from private.assignment_change_responses x where x.request_id=r.id)) order by r.created_at desc)
 into result from private.assignment_change_requests r
 where (p_id is null or r.id=p_id) and (p_job is null or r.job_id=p_job)
 and (manager or exists(select 1 from private.assignment_change_responses x where x.request_id=r.id and x.lecturer_id=auth.uid()));
 return coalesce(result,'[]'::jsonb);
end;$$;
create function public.assignment_change_request(p_id uuid default null,p_job uuid default null) returns jsonb language sql stable security invoker set search_path='' as $$select private.assignment_change_request(p_id,p_job);$$;

-- Management proposes an entire replacement schedule/location. Request identity
-- is the UUID; the stored before-images and expected job version prevent retries
-- or concurrent proposals from changing the accepted agreement.
create function private.propose_assignment_change(p_job uuid,p_reason text,p_location text,p_sessions jsonb,p_request uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare j public.jobs; claim public.job_claims; req uuid; old_sessions jsonb; new_sessions jsonb; n_old int; n_new int; n_assigned int; payload jsonb; prior private.assignment_change_requests;
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('portal-user-activation',0));
 if not private.actor_active() or not private.has_permission('jobs.manage') then raise exception 'Job management required' using errcode='42501';end if;
 if p_request is null or length(trim(coalesce(p_reason,'')))<5 or length(trim(p_reason))>1000 or p_sessions is null or jsonb_typeof(p_sessions) is distinct from 'array' or jsonb_array_length(p_sessions)=0 or p_location is null or length(p_location)>500 then raise exception 'Invalid amendment' using errcode='22023';end if;
 payload=jsonb_build_object('job',p_job,'reason',trim(p_reason),'location',trim(p_location),'sessions',p_sessions);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('assignment-change-request:'||auth.uid()::text||':'||p_request::text,0));
 select * into prior from private.assignment_change_requests where created_by=auth.uid() and request_key=p_request;
 if found then if prior.request_payload<>payload then raise exception 'Amendment retry payload conflict' using errcode='22023';end if; return prior.id; end if;
 select * into j from public.jobs where id=p_job for update;
 if not found or j.course_run_id is not null then raise exception 'Linked course changes require the course amendment workflow' using errcode='22023';end if;
 if exists(select 1 from public.job_sessions where job_id=j.id and course_session_id is not null) then raise exception 'Linked course changes require the course amendment workflow' using errcode='22023';end if;
 select * into claim from public.job_claims where job_id=j.id and status='confirmed' for update;
 if not found or exists(select 1 from public.job_claims where job_id=j.id and status='confirmed' and id<>claim.id) then raise exception 'A complete confirmed assignment set is required' using errcode='22023';end if;
 if exists(select 1 from public.invoice_items where claim_id=claim.id) or exists(select 1 from public.assignment_sessions where claim_id=claim.id and (released_at is not null or starts_at<=clock_timestamp())) then raise exception 'Started, released or invoiced work is not amendable' using errcode='22023';end if;
 select jsonb_agg(jsonb_build_object('id',s.id,'starts_at',s.starts_at,'ends_at',s.ends_at) order by s.starts_at,s.id),count(*) into old_sessions,n_old from public.job_sessions s where s.job_id=j.id;
 select count(*) into n_assigned from public.assignment_sessions s where s.claim_id=claim.id and s.released_at is null;
 if n_assigned<>n_old
  or exists(select 1 from public.job_sessions s where s.job_id=j.id and not exists(select 1 from public.assignment_sessions a where a.claim_id=claim.id and a.released_at is null and a.starts_at=s.starts_at and a.ends_at=s.ends_at))
  or exists(select 1 from public.assignment_sessions a where a.claim_id=claim.id and a.released_at is null and not exists(select 1 from public.job_sessions s where s.job_id=j.id and s.starts_at=a.starts_at and s.ends_at=a.ends_at)) then
  raise exception 'Confirmed assignment schedule does not match its source job' using errcode='40001';
 end if;
 select jsonb_agg(jsonb_build_object('starts_at',x.starts_at,'ends_at',x.ends_at) order by x.starts_at,x.ends_at),count(*) into new_sessions,n_new
 from jsonb_to_recordset(p_sessions) x(starts_at timestamptz,ends_at timestamptz);
 if n_old is null or n_old=0 or n_new<>n_old or exists(select 1 from jsonb_to_recordset(p_sessions) x(starts_at timestamptz,ends_at timestamptz) where x.starts_at is null or x.ends_at is null or x.starts_at<=clock_timestamp() or x.ends_at<=x.starts_at or not isfinite(x.starts_at) or not isfinite(x.ends_at)) then raise exception 'Invalid future schedule' using errcode='22023';end if;
 if exists(select 1 from (select starts_at,ends_at,row_number() over(order by starts_at,id) n from public.job_sessions where job_id=j.id) a join (select starts_at,ends_at,row_number() over(order by starts_at,ends_at) n from jsonb_to_recordset(p_sessions) x(starts_at timestamptz,ends_at timestamptz)) b using(n) where a.ends_at-a.starts_at<>b.ends_at-b.starts_at) then raise exception 'Amendment cannot change session duration' using errcode='22023';end if;
 if exists(select 1 from jsonb_to_recordset(p_sessions) a(starts_at timestamptz,ends_at timestamptz) join jsonb_to_recordset(p_sessions) b(starts_at timestamptz,ends_at timestamptz) on a.starts_at<b.starts_at and tstzrange(a.starts_at,a.ends_at,'[)')&&tstzrange(b.starts_at,b.ends_at,'[)')) then raise exception 'Proposed sessions overlap' using errcode='22023';end if;
 if exists(select 1 from private.assignment_change_requests where job_id=j.id and status='awaiting_response') then raise exception 'An amendment is already pending' using errcode='22023';end if;
 insert into private.assignment_change_requests(request_key,job_id,created_by,request_payload,reason,original_location,proposed_location,original_sessions,proposed_sessions,expected_job_version,status)
 values(p_request,j.id,auth.uid(),payload,trim(p_reason),j.location,trim(p_location),old_sessions,new_sessions,j.lifecycle_version,'awaiting_response') returning id into req;
 insert into private.assignment_change_responses(request_id,claim_id,lecturer_id,decision) values(req,claim.id,claim.lecturer_id,null);
 insert into public.notifications(user_id,kind,resource_id) values(claim.lecturer_id,'assignment_change_proposed',req) on conflict do nothing;
 return req;
end;$$;

-- The affected lecturer records one irrevocable decision. Rejection closes the
-- request without touching job, course, claim or assignment schedule rows.
create function private.respond_assignment_change(p_id uuid,p_accept boolean) returns text
language plpgsql security definer set search_path='' as $$
declare r private.assignment_change_requests; x private.assignment_change_responses;
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('portal-user-activation',0));
 if not private.actor_active() then raise exception 'Authentication required' using errcode='42501';end if;
 if p_accept is null then raise exception 'Decision required' using errcode='22023';end if;
 select * into r from private.assignment_change_requests where id=p_id for update;
 if not found or r.status<>'awaiting_response' then raise exception 'Amendment is no longer awaiting response' using errcode='22023';end if;
 select * into x from private.assignment_change_responses where request_id=p_id and lecturer_id=auth.uid() for update;
 if not found or x.decision is not null then raise exception 'Affected lecturer response required' using errcode='42501';end if;
 update private.assignment_change_responses set decision=case when p_accept then 'accepted' else 'rejected' end,responded_at=clock_timestamp() where request_id=p_id and claim_id=x.claim_id;
 update private.assignment_change_requests set status=case when p_accept then 'accepted' else 'rejected' end,resolved_at=clock_timestamp() where id=p_id;
 insert into public.audit_events(actor_id,action,resource_id,details) values(auth.uid(),case when p_accept then 'assignment.change_accepted' else 'assignment.change_rejected' end,p_id,jsonb_build_object('job_id',r.job_id,'claim_id',x.claim_id));
 insert into public.notifications(user_id,kind,resource_id)
  select distinct p.id,case when p_accept then 'assignment_change_accepted' else 'assignment_change_rejected' end,p_id
  from public.profiles p join public.user_roles role on role.user_id=p.id join public.role_permissions permission on permission.role=role.role
  where p.active and p.id<>auth.uid() and permission.permission='jobs.manage' on conflict do nothing;
 return case when p_accept then 'accepted' else 'rejected' end;
end;$$;

-- Apply locks the lecturer, job, then claim in the established order and checks
-- the exact affected claims, stale version, invoice state, qualification,
-- contract, availability and conflicts again. Exclusion constraints provide a
-- second transactional guard; failure rolls back every schedule update.
create function private.apply_assignment_change(p_id uuid) returns text
language plpgsql security definer set search_path='' as $$
declare r private.assignment_change_requests; j public.jobs; c public.job_claims; x private.assignment_change_responses; starts timestamptz; ends timestamptz; current_sessions jsonb;
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('portal-user-activation',0));
 if not private.actor_active() or not private.has_permission('jobs.manage') then raise exception 'Job management required' using errcode='42501';end if;
 select * into r from private.assignment_change_requests where id=p_id;
 if not found then raise exception 'Amendment unavailable' using errcode='42501';end if;
 select * into c from public.job_claims where job_id=r.job_id and status='confirmed';
 if not found then raise exception 'Confirmed assignment unavailable' using errcode='22023';end if;
 -- Match withdrawal/substitution lock order: lecturer advisory lock, then job,
 -- then claim. This avoids a cross-flow lock inversion with calendar writes.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(c.lecturer_id::text,0));
 perform 1 from public.jobs where id=r.job_id for update;
 select * into j from public.jobs where id=r.job_id;
 select * into c from public.job_claims where job_id=j.id and status='confirmed' for update;
 select * into r from private.assignment_change_requests where id=p_id for update;
 select * into x from private.assignment_change_responses where request_id=r.id and claim_id=c.id for update;
 if not private.actor_active() or not private.has_permission('jobs.manage') then raise exception 'Job management required' using errcode='42501';end if;
 if not found or x.lecturer_id is distinct from c.lecturer_id or x.decision is distinct from 'accepted' or r.status<>'accepted' or r.expected_job_version<>j.lifecycle_version then raise exception 'Amendment decision or job version is stale' using errcode='40001';end if;
 if j.course_run_id is not null or exists(select 1 from public.job_sessions where job_id=j.id and course_session_id is not null) then raise exception 'Linked course changes require the course amendment workflow' using errcode='22023';end if;
 select jsonb_agg(jsonb_build_object('id',s.id,'starts_at',s.starts_at,'ends_at',s.ends_at) order by s.starts_at,s.id) into current_sessions from public.job_sessions s where s.job_id=j.id;
 if j.location is distinct from r.original_location or current_sessions is distinct from r.original_sessions then raise exception 'Accepted schedule changed after proposal' using errcode='40001';end if;
 if (select count(*) from public.job_claims where job_id=j.id and status='confirmed')<>1 or exists(select 1 from public.invoice_items where claim_id=c.id) or exists(select 1 from public.assignment_sessions where claim_id=c.id and (released_at is not null or starts_at<=clock_timestamp())) then raise exception 'Affected assignment set changed or became ineligible for amendment' using errcode='22023';end if;
 if (select count(*) from public.assignment_sessions a where a.claim_id=c.id and a.released_at is null)<>(select count(*) from public.job_sessions s where s.job_id=j.id)
  or exists(select 1 from public.job_sessions s where s.job_id=j.id and not exists(select 1 from public.assignment_sessions a where a.claim_id=c.id and a.released_at is null and a.starts_at=s.starts_at and a.ends_at=s.ends_at))
  or exists(select 1 from public.assignment_sessions a where a.claim_id=c.id and a.released_at is null and not exists(select 1 from public.job_sessions s where s.job_id=j.id and s.starts_at=a.starts_at and s.ends_at=a.ends_at)) then raise exception 'Confirmed assignment schedule does not match its source job' using errcode='40001';end if;
 if exists(select 1 from jsonb_array_elements(r.proposed_sessions) s where (s->>'starts_at')::timestamptz<=clock_timestamp()) then raise exception 'Amended work must remain in the future at apply time' using errcode='22023';end if;
 select min((s->>'starts_at')::timestamptz),max((s->>'ends_at')::timestamptz) into starts,ends from jsonb_array_elements(r.proposed_sessions) s;
 if exists(select 1 from public.job_requirements q where q.job_id=j.id and not exists(select 1 from public.lecturer_topics t where t.user_id=c.lecturer_id and t.topic_id=q.topic_id and t.verified and (t.valid_until is null or t.valid_until>=ends))) then raise exception 'Lecturer qualification no longer covers amended dates' using errcode='22023';end if;
 if j.requires_contract and private.current_contract_for_interval(c.lecturer_id,starts,ends) is null then raise exception 'Current contract does not cover amended dates' using errcode='22023';end if;
 if exists(select 1 from jsonb_array_elements(r.proposed_sessions) s join public.assignment_sessions a on a.lecturer_id=c.lecturer_id and a.claim_id<>c.id and a.released_at is null and tstzrange(a.starts_at,a.ends_at,'[)')&&tstzrange((s->>'starts_at')::timestamptz,(s->>'ends_at')::timestamptz,'[)')) or exists(select 1 from jsonb_array_elements(r.proposed_sessions) s join public.personal_events e on e.user_id=c.lecturer_id and tstzrange(e.starts_at,e.ends_at,'[)')&&tstzrange((s->>'starts_at')::timestamptz,(s->>'ends_at')::timestamptz,'[)')) or exists(select 1 from jsonb_array_elements(r.proposed_sessions) s join public.lecturer_availability a on a.user_id=c.lecturer_id and a.kind='unavailable' and tstzrange(a.starts_at,a.ends_at,'[)')&&tstzrange((s->>'starts_at')::timestamptz,(s->>'ends_at')::timestamptz,'[)')) then raise exception 'Amended schedule conflicts with current availability' using errcode='23P01';end if;
 delete from public.job_sessions where job_id=j.id;
 insert into public.job_sessions(job_id,starts_at,ends_at) select j.id,(s->>'starts_at')::timestamptz,(s->>'ends_at')::timestamptz from jsonb_array_elements(r.proposed_sessions) s;
 -- Preserve session IDs referenced by draft evidence while temporarily releasing
 -- the excluded ranges inside this transaction; no observer can see the marker.
 update public.assignment_sessions set released_at=clock_timestamp() where claim_id=c.id and released_at is null;
 update public.assignment_sessions a set starts_at=(s.value->>'starts_at')::timestamptz,ends_at=(s.value->>'ends_at')::timestamptz,released_at=null
 from jsonb_array_elements(r.proposed_sessions) with ordinality s(value,n)
 join (select id,row_number() over(order by starts_at,id) n from public.assignment_sessions where claim_id=c.id) old on old.n=s.n where a.id=old.id;
 update public.jobs set location=r.proposed_location where id=j.id;
 update private.assignment_change_requests set status='applied',resolved_at=clock_timestamp() where id=r.id;
 insert into public.audit_events(actor_id,action,resource_id,details) values(auth.uid(),'assignment.change_applied',r.id,jsonb_build_object('job_id',j.id,'claim_id',c.id,'original_location',r.original_location,'proposed_location',r.proposed_location,'original_sessions',r.original_sessions,'proposed_sessions',r.proposed_sessions));
 insert into public.notifications(user_id,kind,resource_id) values(c.lecturer_id,'assignment_change_applied',r.id) on conflict do nothing;
 return 'applied';
exception when exclusion_violation then raise exception 'Amended schedule conflicts with current commitments' using errcode='23P01';
end;$$;

create function public.propose_assignment_change(p_job uuid,p_reason text,p_location text,p_sessions jsonb,p_request uuid) returns uuid language sql security invoker set search_path='' as $$select private.propose_assignment_change(p_job,p_reason,p_location,p_sessions,p_request);$$;
create function public.respond_assignment_change(p_id uuid,p_accept boolean) returns text language sql security invoker set search_path='' as $$select private.respond_assignment_change(p_id,p_accept);$$;
create function public.apply_assignment_change(p_id uuid) returns text language sql security invoker set search_path='' as $$select private.apply_assignment_change(p_id);$$;
-- A manager can close a stale pending or accepted request. This avoids a
-- permanently blocked assignment when later eligibility makes apply impossible.
create function private.withdraw_assignment_change(p_id uuid) returns text
language plpgsql security definer set search_path='' as $$
declare r private.assignment_change_requests;
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('portal-user-activation',0));
 if not private.actor_active() or not private.has_permission('jobs.manage') then raise exception 'Job management required' using errcode='42501';end if;
 select * into r from private.assignment_change_requests where id=p_id for update;
 if not found or r.status not in('awaiting_response','accepted') then raise exception 'Amendment cannot be withdrawn' using errcode='22023';end if;
 update private.assignment_change_requests set status='superseded',resolved_at=clock_timestamp() where id=r.id;
 insert into public.audit_events(actor_id,action,resource_id,details) values(auth.uid(),'assignment.change_withdrawn',r.id,jsonb_build_object('job_id',r.job_id,'prior_status',r.status));
 insert into public.notifications(user_id,kind,resource_id)
  select x.lecturer_id,'assignment_change_withdrawn',r.id from private.assignment_change_responses x where x.request_id=r.id on conflict do nothing;
 return 'superseded';
end;$$;
create function public.withdraw_assignment_change(p_id uuid) returns text language sql security invoker set search_path='' as $$select private.withdraw_assignment_change(p_id);$$;
-- Inbox deep links are resolved against current membership at read time. The
-- notification row itself contains no reason, schedule or customer data.
alter function private.notification_target(text,uuid) rename to notification_target_before_assignment_changes;
revoke all on function private.notification_target_before_assignment_changes(text,uuid) from public,anon,authenticated,service_role;
create function private.notification_target(p_kind text,p_resource uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare target uuid;heading text;
begin
 if p_kind in('assignment_change_proposed','assignment_change_accepted','assignment_change_rejected','assignment_change_applied','assignment_change_withdrawn') then
  select j.id,j.title into target,heading from private.assignment_change_requests r join public.jobs j on j.id=r.job_id
  where r.id=p_resource and private.actor_active() and private.can_read_job(j.id)
   and (private.has_permission('jobs.manage') or exists(select 1 from private.assignment_change_responses x where x.request_id=r.id and x.lecturer_id=auth.uid()));
  return jsonb_build_object('href',case when target is not null then '/jobs/'||target end,'title',coalesce(heading,''));
 end if;
 return private.notification_target_before_assignment_changes(p_kind,p_resource);
end;$$;
revoke all on function private.notification_target(text,uuid) from public,anon,authenticated,service_role;
grant execute on function private.notification_target(text,uuid) to authenticated;
revoke all on function private.assignment_change_request(uuid,uuid),private.propose_assignment_change(uuid,text,text,jsonb,uuid),private.respond_assignment_change(uuid,boolean),private.apply_assignment_change(uuid),private.withdraw_assignment_change(uuid),public.assignment_change_request(uuid,uuid),public.propose_assignment_change(uuid,text,text,jsonb,uuid),public.respond_assignment_change(uuid,boolean),public.apply_assignment_change(uuid),public.withdraw_assignment_change(uuid) from public,anon;
grant execute on function private.assignment_change_request(uuid,uuid),private.propose_assignment_change(uuid,text,text,jsonb,uuid),private.respond_assignment_change(uuid,boolean),private.apply_assignment_change(uuid),private.withdraw_assignment_change(uuid),public.assignment_change_request(uuid,uuid),public.propose_assignment_change(uuid,text,text,jsonb,uuid),public.respond_assignment_change(uuid,boolean),public.apply_assignment_change(uuid),public.withdraw_assignment_change(uuid) to authenticated;
commit;
