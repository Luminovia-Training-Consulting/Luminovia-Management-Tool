begin;
-- Original allocations stay committed until a replacement claim and handover
-- commit together. Accepted prices and original allocation rows are never erased.
create table private.replacement_offers (
 id uuid primary key default pg_catalog.gen_random_uuid(),
 original_claim_id uuid not null references public.job_claims(id),
 requested_by uuid not null references public.profiles(id),
 reason text not null check(length(reason) between 5 and 1000),
 mode text not null check(mode in ('open','selected')),
 invited_user_ids uuid[] not null default '{}', emergency boolean not null default false,
 status text not null default 'open' check(status in ('open','cancelled','completed')),
 job_version integer not null, version integer not null default 1,
 replacement_claim_id uuid references public.job_claims(id),
 created_at timestamptz not null default clock_timestamp(), completed_at timestamptz,
 check((status='completed')=(replacement_claim_id is not null))
);
create unique index one_open_replacement on private.replacement_offers(original_claim_id) where status='open';
create table private.replacement_requests (
 actor_id uuid not null references public.profiles(id), request_id uuid not null,
 payload jsonb not null, result jsonb not null, primary key(actor_id,request_id)
);
alter table private.replacement_offers enable row level security;
alter table private.replacement_requests enable row level security;
revoke all on private.replacement_offers,private.replacement_requests from public,anon,authenticated;

-- No personal appointment, other lecturer's contract or rejection reason is
-- returned. Eligibility is recomputed, never a browser-submitted flag.
create function private.replacement_eligible(p_offer uuid,p_user uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.replacement_offers o
 join public.job_claims c on c.id=o.original_claim_id join public.jobs j on j.id=c.job_id
 where o.id=p_offer and o.status='open' and c.status='confirmed' and c.lecturer_id<>p_user
 and j.lifecycle_version=o.job_version and private.lecturer_user(p_user)
 and (o.mode='open' or p_user=any(o.invited_user_ids))
 and not exists(select 1 from public.invoice_items where claim_id=c.id)
 and exists(select 1 from public.job_sessions where job_id=j.id)
 and not exists(select 1 from public.job_sessions where job_id=j.id and starts_at<=now())
 and not exists(select 1 from public.job_claims where job_id=j.id and lecturer_id=p_user and status='confirmed')
 and not exists(select 1 from public.job_requirements r where r.job_id=j.id and not exists(
  select 1 from public.lecturer_topics lt where lt.user_id=p_user and lt.topic_id=r.topic_id and lt.verified
  and (lt.valid_until is null or lt.valid_until>=(select max(ends_at) from public.job_sessions where job_id=j.id))))
 and (not j.requires_contract or private.current_contract_for_interval(p_user,
  (select min(starts_at) from public.job_sessions where job_id=j.id),
  (select max(ends_at) from public.job_sessions where job_id=j.id)) is not null)
 and not exists(select 1 from public.job_sessions s join public.assignment_sessions a on a.lecturer_id=p_user and a.released_at is null
  and tstzrange(a.starts_at,a.ends_at,'[)')&&tstzrange(s.starts_at,s.ends_at,'[)') where s.job_id=j.id)
 and not exists(select 1 from public.job_sessions s join public.personal_events e on e.user_id=p_user
  and tstzrange(e.starts_at,e.ends_at,'[)')&&tstzrange(s.starts_at,s.ends_at,'[)') where s.job_id=j.id)
 and not exists(select 1 from public.job_sessions s join public.lecturer_availability a on a.user_id=p_user and a.kind='unavailable'
  and tstzrange(a.starts_at,a.ends_at,'[)')&&tstzrange(s.starts_at,s.ends_at,'[)') where s.job_id=j.id));
$$;
revoke execute on function private.replacement_eligible(uuid,uuid) from public,anon,authenticated;

-- Reuse the private role-pricing API when the independently owned pricing
-- migration has landed. Legacy offers retain their exact existing net quote.
create function private.replacement_quote(p_job uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare j public.jobs; amount numeric; total numeric; token integer; mode text;
begin
 select * into j from public.jobs where id=p_job;
 amount=j.amount; total=j.total_amount; token=j.terms_version;
 select to_jsonb(o)->>'pricing_mode' into mode from private.job_commission_offers o where o.job_id=j.id;
 if mode='role_split' then
  if not private.lecturer_actor() then return null;end if;
  execute 'select private.role_net(o.gross_amount,$1,o.job_id),private.role_net(o.gross_total_amount,$1,o.job_id),private.role_quote_version($2,$1) from private.job_commission_offers o where o.job_id=$3'
   into amount,total,token using auth.uid(),j.terms_version,j.id;
 end if;
 return jsonb_build_object('amount',amount,'total_amount',total,'currency',j.currency,'rate_unit',j.rate_unit,'terms',j.terms,'terms_version',token);
end;$$;
revoke execute on function private.replacement_quote(uuid) from public,anon,authenticated;

create function private.replacement_marketplace() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not private.actor_active() then raise exception 'Active account required' using errcode='42501';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'job_id',j.id,'title',j.title,'time_zone',j.time_zone,
  'status',o.status,'mode',o.mode,'emergency',o.emergency,'version',o.version,'created_at',o.created_at,
  'can_cancel',o.status='open' and (c.lecturer_id=auth.uid() or private.has_permission('jobs.manage')),
  'can_claim',private.replacement_eligible(o.id,auth.uid()),
  'reason',case when c.lecturer_id=auth.uid() or private.has_permission('jobs.manage') then o.reason end,
  'quote',case when private.replacement_eligible(o.id,auth.uid()) then private.replacement_quote(j.id) end,
  'sessions',(select jsonb_agg(jsonb_build_object('starts_at',starts_at,'ends_at',ends_at) order by starts_at) from public.job_sessions where job_id=j.id))
  order by o.emergency desc,o.created_at desc,o.id) from (
  select o.* from private.replacement_offers o join public.job_claims c on c.id=o.original_claim_id
  where private.has_permission('jobs.manage') or c.lecturer_id=auth.uid()
   or private.replacement_eligible(o.id,auth.uid())
   or exists(select 1 from public.job_claims winner where winner.id=o.replacement_claim_id and winner.lecturer_id=auth.uid())
  order by o.created_at desc,o.id limit 200)o
 join public.job_claims c on c.id=o.original_claim_id join public.jobs j on j.id=c.job_id),'[]'::jsonb);
end;$$;
create function public.replacement_marketplace() returns jsonb language sql stable security invoker set search_path='' as $$select private.replacement_marketplace();$$;

create function private.request_replacement(p_claim_id uuid,p_reason text,p_mode text,p_invited_user_ids uuid[],p_emergency boolean,p_request_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare c public.job_claims; j public.jobs; prior private.replacement_requests; payload jsonb; result uuid; recipient uuid;
begin
 if not private.actor_active() then raise exception 'Active account required' using errcode='42501';end if;
 perform 1 from public.profiles where id=auth.uid() and active for share;
 if p_request_id is null or p_reason is null or length(trim(p_reason)) not between 5 and 1000
 or p_mode is null or p_mode not in('open','selected') or p_invited_user_ids is null or p_emergency is null
 or cardinality(p_invited_user_ids)>50 or (p_mode='selected' and cardinality(p_invited_user_ids)=0)
 or (p_mode='open' and cardinality(p_invited_user_ids)<>0)
 or exists(select 1 from unnest(p_invited_user_ids) u where u is null)
 or cardinality(p_invited_user_ids)<>(select count(distinct u) from unnest(p_invited_user_ids)u) then raise exception 'Invalid replacement request' using errcode='22023';end if;
 payload=jsonb_build_object('action','request','claim',p_claim_id,'reason',trim(p_reason),'mode',p_mode,'invited',p_invited_user_ids,'emergency',p_emergency);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('replacement:'||auth.uid()::text||p_request_id::text,0));
 select * into prior from private.replacement_requests where actor_id=auth.uid() and request_id=p_request_id;
 if found then if prior.payload<>payload then raise exception 'Replacement idempotency conflict' using errcode='22023';end if;return (prior.result->>'id')::uuid;end if;
 select * into c from public.job_claims where id=p_claim_id;
 if c.id is null or not (c.lecturer_id=auth.uid() and private.lecturer_actor() or private.has_permission('jobs.manage')) then raise exception 'Assignment access denied' using errcode='42501';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(c.lecturer_id::text,0));
 select * into j from public.jobs where id=c.job_id for update;
 select * into c from public.job_claims where id=p_claim_id for update;
 if c.status<>'confirmed' or exists(select 1 from public.invoice_items where claim_id=c.id)
 or not exists(select 1 from public.job_sessions where job_id=j.id)
 or exists(select 1 from public.job_sessions where job_id=j.id and starts_at<=clock_timestamp()) then raise exception 'Started or invoiced work requires management amendment' using errcode='22023';end if;
 if exists(select 1 from private.replacement_offers where original_claim_id=c.id and status='open') then raise exception 'Replacement already open' using errcode='22023';end if;
 if exists(select 1 from unnest(p_invited_user_ids) u where u=c.lecturer_id or not private.lecturer_user(u)) then raise exception 'Invalid invited lecturer' using errcode='22023';end if;
 insert into private.replacement_offers(original_claim_id,requested_by,reason,mode,invited_user_ids,emergency,job_version)
 values(c.id,auth.uid(),trim(p_reason),p_mode,p_invited_user_ids,p_emergency,j.lifecycle_version) returning id into result;
 if p_mode='selected' and exists(select 1 from unnest(p_invited_user_ids) u where not private.replacement_eligible(result,u)) then raise exception 'Invited lecturer is not currently eligible' using errcode='22023';end if;
 insert into public.audit_events(actor_id,action,resource_id,details) values(auth.uid(),'replacement.opened',result,jsonb_build_object('claim_id',c.id,'mode',p_mode));
 for recipient in select p.id from public.profiles p where private.replacement_eligible(result,p.id) loop
  insert into public.notifications(user_id,kind,resource_id) values(recipient,'replacement_available',result) on conflict do nothing;
 end loop;
 insert into private.replacement_requests values(auth.uid(),p_request_id,payload,jsonb_build_object('id',result));return result;
end;$$;
create function public.request_replacement(p_claim_id uuid,p_reason text,p_mode text,p_invited_user_ids uuid[],p_emergency boolean,p_request_id uuid) returns uuid
language sql security invoker set search_path='' as $$select private.request_replacement(p_claim_id,p_reason,p_mode,p_invited_user_ids,p_emergency,p_request_id);$$;

create function private.cancel_replacement(p_offer_id uuid,p_expected_version integer,p_request_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare o private.replacement_offers; prior private.replacement_requests; payload jsonb;
begin
 if not private.actor_active() then raise exception 'Active account required' using errcode='42501';end if;
 if p_request_id is null or p_expected_version is null then raise exception 'Invalid replacement request' using errcode='22023';end if;
 payload=jsonb_build_object('action','cancel','offer',p_offer_id,'version',p_expected_version);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('replacement:'||auth.uid()::text||p_request_id::text,0));
 select * into prior from private.replacement_requests where actor_id=auth.uid() and request_id=p_request_id;
 if found then if prior.payload<>payload then raise exception 'Replacement idempotency conflict' using errcode='22023';end if;return p_offer_id;end if;
 select * into o from private.replacement_offers where id=p_offer_id for update;
 if o.id is null or not(exists(select 1 from public.job_claims where id=o.original_claim_id and lecturer_id=auth.uid()) or private.has_permission('jobs.manage')) then raise exception 'Replacement access denied' using errcode='42501';end if;
 if o.version<>p_expected_version or o.status<>'open' then raise exception 'Replacement changed; reload' using errcode='40001';end if;
 update private.replacement_offers set status='cancelled',version=version+1 where id=o.id;
 insert into public.audit_events(actor_id,action,resource_id) values(auth.uid(),'replacement.cancelled',o.id);
 insert into private.replacement_requests values(auth.uid(),p_request_id,payload,jsonb_build_object('id',o.id));return o.id;
end;$$;
create function public.cancel_replacement(p_offer_id uuid,p_expected_version integer,p_request_id uuid) returns uuid
language sql security invoker set search_path='' as $$select private.cancel_replacement(p_offer_id,p_expected_version,p_request_id);$$;

create function private.claim_replacement(p_offer_id uuid,p_expected_version integer,p_terms_version integer,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o private.replacement_offers; c public.job_claims; j public.jobs; prior private.replacement_requests; payload jsonb; result jsonb; target uuid;
begin
 if not private.actor_active() then raise exception 'Active account required' using errcode='42501';end if;
 if p_request_id is null or p_expected_version is null or p_terms_version is null then raise exception 'Invalid replacement request' using errcode='22023';end if;
 payload=jsonb_build_object('action','claim','offer',p_offer_id,'version',p_expected_version,'terms_version',p_terms_version);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('replacement:'||auth.uid()::text||p_request_id::text,0));
 select * into prior from private.replacement_requests where actor_id=auth.uid() and request_id=p_request_id;
 if found then if prior.payload<>payload then raise exception 'Replacement idempotency conflict' using errcode='22023';end if;return prior.result;end if;
 select claimed.* into c from public.job_claims claimed join private.replacement_offers r on r.original_claim_id=claimed.id where r.id=p_offer_id;
 if c.id is null then return jsonb_build_object('status','unavailable');end if;
 -- Consistent sorted profile/lecturer locks, then job, claim, offer, room.
 perform 1 from public.profiles where id in(auth.uid(),c.lecturer_id) order by id for share;
 for target in select id from public.profiles where id in(auth.uid(),c.lecturer_id) order by id loop
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target::text,0));
 end loop;
 select * into j from public.jobs where id=c.job_id for update;
 select * into c from public.job_claims where id=c.id for update;
 select * into o from private.replacement_offers where id=p_offer_id for update;
 if o.status<>'open' or o.version<>p_expected_version then return jsonb_build_object('status','unavailable');end if;
 if not private.replacement_eligible(o.id,auth.uid()) then return jsonb_build_object('status','not_eligible');end if;
 if (private.replacement_quote(j.id)->>'terms_version')::integer<>p_terms_version then return jsonb_build_object('status','terms_changed');end if;
 begin
  -- Any rejection below raises into this subtransaction: the original remains
  -- confirmed with every allocation and chat membership exactly as before.
  update public.job_claims set status='cancelled' where id=c.id;
  update public.assignment_sessions set released_at=clock_timestamp() where claim_id=c.id and released_at is null;
  -- The original vacancy's deadline governed its original claim. This new
  -- authorised replacement remains valid until teaching starts; never publish
  -- a claimable-looking offer that its old recruitment deadline always rejects.
  update public.jobs set status='published',claim_deadline=null where id=j.id;
  result=private.claim_job(j.id,p_request_id,p_terms_version);
  if result->>'status'<>'confirmed' then raise exception using errcode='P0002',message='Replacement handover rejected',detail=result::text;end if;
  if (result->>'claim_id')::uuid=c.id or not exists(select 1 from public.job_claims where id=(result->>'claim_id')::uuid and lecturer_id=auth.uid() and job_id=j.id and status='confirmed') then result=jsonb_build_object('status','idempotency_conflict');raise exception using errcode='P0002',message='Invalid replacement confirmation';end if;
  if j.claim_deadline is not null then update public.jobs set claim_deadline=j.claim_deadline where id=j.id;end if;
  perform 1 from public.chat_rooms where job_id=j.id and kind='lecturer_course' for update;
  update public.chat_members m set removed_at=clock_timestamp() from public.chat_rooms r
   where r.job_id=j.id and r.kind='lecturer_course' and m.room_id=r.id and m.user_id=c.lecturer_id and m.removed_at is null;
  update public.chat_rooms set owner_id=auth.uid() where job_id=j.id and kind='lecturer_course' and owner_id=c.lecturer_id;
  insert into public.claim_events(claim_id,actor_id,event_type) values(c.id,auth.uid(),'cancelled');
  insert into public.audit_events(actor_id,action,resource_id,details) values(auth.uid(),'replacement.completed',o.id,jsonb_build_object('original_claim_id',c.id,'replacement_claim_id',result->>'claim_id'));
  insert into public.notifications(user_id,kind,resource_id) values(c.lecturer_id,'replacement_completed',o.id) on conflict do nothing;
  update private.replacement_offers set status='completed',version=version+1,replacement_claim_id=(result->>'claim_id')::uuid,completed_at=clock_timestamp() where id=o.id;
  insert into private.replacement_requests values(auth.uid(),p_request_id,payload,result);
  return result;
 exception when no_data_found then
  return coalesce(result,jsonb_build_object('status','unavailable'));
 end;
end;$$;
create function public.claim_replacement(p_offer_id uuid,p_expected_version integer,p_terms_version integer,p_request_id uuid) returns jsonb
language sql security invoker set search_path='' as $$select private.claim_replacement(p_offer_id,p_expected_version,p_terms_version,p_request_id);$$;

revoke execute on function private.replacement_marketplace(),public.replacement_marketplace(),
 private.request_replacement(uuid,text,text,uuid[],boolean,uuid),public.request_replacement(uuid,text,text,uuid[],boolean,uuid),
 private.cancel_replacement(uuid,integer,uuid),public.cancel_replacement(uuid,integer,uuid),
 private.claim_replacement(uuid,integer,integer,uuid),public.claim_replacement(uuid,integer,integer,uuid) from public,anon;
grant execute on function private.replacement_marketplace(),public.replacement_marketplace(),
 private.request_replacement(uuid,text,text,uuid[],boolean,uuid),public.request_replacement(uuid,text,text,uuid[],boolean,uuid),
 private.cancel_replacement(uuid,integer,uuid),public.cancel_replacement(uuid,integer,uuid),
 private.claim_replacement(uuid,integer,integer,uuid),public.claim_replacement(uuid,integer,integer,uuid) to authenticated;

create function private.replacement_assignments() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.actor_active() then raise exception 'Active account required' using errcode='42501';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('claim_id',c.id,'job_id',j.id,'title',j.title,'lecturer',p.display_name)
  order by j.title,c.id) from public.job_claims c join public.jobs j on j.id=c.job_id join public.profiles p on p.id=c.lecturer_id
  where c.status='confirmed' and (c.lecturer_id=auth.uid() or private.has_permission('jobs.manage'))
  and not exists(select 1 from public.invoice_items where claim_id=c.id)
  and exists(select 1 from public.job_sessions where job_id=j.id)
  and not exists(select 1 from public.job_sessions where job_id=j.id and starts_at<=now())
  and not exists(select 1 from private.replacement_offers where original_claim_id=c.id and status='open')),'[]'::jsonb);
end;$$;
create function public.replacement_assignments() returns jsonb language sql stable security invoker set search_path='' as $$select private.replacement_assignments();$$;
revoke execute on function private.replacement_assignments(),public.replacement_assignments() from public,anon;
grant execute on function private.replacement_assignments(),public.replacement_assignments() to authenticated;
commit;
