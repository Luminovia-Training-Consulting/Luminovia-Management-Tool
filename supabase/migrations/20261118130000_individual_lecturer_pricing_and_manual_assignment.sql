begin;
create table private.lecturer_compensation(
 user_id uuid primary key references public.profiles(id) on delete cascade,
 mode text not null check(mode in ('percent','daily')),
 percent numeric(5,2) not null default 50 check(percent between 0 and 100),
 daily_rate numeric(14,2) not null default 200 check(daily_rate between 0 and 999999999999.99),
 currency text not null default 'EUR' check(currency in ('EUR','AUD')),
 version integer not null check(version between 2 and 1999),
 updated_by uuid references public.profiles(id) on delete set null,updated_at timestamptz not null default clock_timestamp()
);
alter table private.lecturer_compensation enable row level security;
revoke all on private.lecturer_compensation from public,anon,authenticated,service_role;
create function private.lecturer_compensation(p_user_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.has_permission('finance.gross.read') then raise exception 'Compensation administration required' using errcode='42501';end if;
 if not private.lecturer_user(p_user_id) then raise exception 'Active lecturer required' using errcode='22023';end if;
 return coalesce((select jsonb_build_object('mode',mode,'percent',percent,'daily_rate',daily_rate,'currency',currency,'version',version) from private.lecturer_compensation where user_id=p_user_id),jsonb_build_object('mode','percent','percent',50,'daily_rate',200,'currency','EUR','version',1));
end;$$;
create function private.save_lecturer_compensation(p_user_id uuid,p_mode text,p_percent numeric,p_daily_rate numeric,p_currency text,p_expected_version integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare v integer;
begin
 if not private.has_permission('finance.gross.read') then raise exception 'Compensation administration required' using errcode='42501';end if;
 perform 1 from public.profiles where id=p_user_id and active for update;
 if not found or not private.lecturer_user(p_user_id) then raise exception 'Active lecturer required' using errcode='22023';end if;
 if p_mode is null or p_mode not in ('percent','daily') or p_percent is null or p_percent not between 0 and 100 or p_percent<>round(p_percent,2) or p_daily_rate is null or p_daily_rate not between 0 and 999999999999.99 or p_daily_rate<>round(p_daily_rate,2) or p_currency is null or p_currency not in ('EUR','AUD') then raise exception 'Invalid lecturer compensation' using errcode='22023';end if;
 select coalesce((select version from private.lecturer_compensation where user_id=p_user_id),1) into v;
 if v is distinct from p_expected_version then raise exception 'Compensation changed; reload before saving' using errcode='40001';end if;
 if v>=1999 then raise exception 'Compensation version requires administrative renewal' using errcode='22023';end if;
 insert into private.lecturer_compensation(user_id,mode,percent,daily_rate,currency,version,updated_by) values(p_user_id,p_mode,p_percent,p_daily_rate,p_currency,v+1,auth.uid()) on conflict(user_id) do update set mode=excluded.mode,percent=excluded.percent,daily_rate=excluded.daily_rate,currency=excluded.currency,version=excluded.version,updated_by=excluded.updated_by,updated_at=clock_timestamp();
 insert into public.audit_events(actor_id,action,resource_id,details) values(auth.uid(),'lecturer.compensation_changed',p_user_id,jsonb_build_object('version',v+1,'mode',p_mode));
 return private.lecturer_compensation(p_user_id);
end;$$;
-- One source of recipient-specific future net quotes. Legacy net advertisements
-- retain their stated fee; no customer gross or exchange rate is invented.
create function private.lecturer_job_quote(p_user_id uuid,p_job_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare cfg private.lecturer_compensation;j public.jobs;o private.job_commission_offers;n numeric;total numeric;days integer;units numeric;
begin
 select * into j from public.jobs where id=p_job_id;
 if not found or not private.lecturer_user(p_user_id) then return null;end if;
 select * into o from private.job_commission_offers where job_id=p_job_id;
 if o.job_id is null or o.pricing_mode<>'role_split' then return jsonb_build_object('amount',j.amount,'total_amount',j.total_amount,'currency',j.currency,'rate_unit',j.rate_unit);end if;
 select * into cfg from private.lecturer_compensation where user_id=p_user_id;
 if coalesce(cfg.mode,'percent')='percent' then n=round(o.gross_amount*coalesce(cfg.percent,50)/100,2);total=round(o.gross_total_amount*coalesce(cfg.percent,50)/100,2);
 else
  if cfg.currency<>j.currency then return null;end if;
  select count(distinct d::date) into days from public.job_sessions s cross join lateral generate_series((s.starts_at at time zone j.time_zone)::date,((s.ends_at-interval '1 microsecond') at time zone j.time_zone)::date,interval '1 day') d where s.job_id=j.id;
  if days<1 then return null;end if;
  total=round(cfg.daily_rate*days,2);
  units=case when j.rate_unit='fixed_total' then 1 when j.rate_unit='per_day' then days else (select sum(extract(epoch from ends_at-starts_at))/3600 from public.job_sessions where job_id=j.id) end;
  if units is null or units<=0 then return null;end if;n=round(total/units,2);
 end if;
 if n is null or total is null or n>o.gross_amount or total>o.gross_total_amount then return null;end if;
 return jsonb_build_object('amount',n,'total_amount',total,'currency',j.currency,'rate_unit',j.rate_unit);
end;$$;
-- Prices and consent must change together; the migration epoch also retires
-- old role-policy tokens. Profile locks serialize configuration and allocation.
create or replace function private.role_quote_version(p_base integer,p_user_id uuid) returns integer language plpgsql stable security definer set search_path='' as $$
declare v integer;
begin
 v=coalesce((select version from private.lecturer_compensation where user_id=p_user_id),1);
 if p_base not between 1 and 99999 or v>1999 then raise exception 'Quote version requires administrative renewal' using errcode='22023';end if;
 return v*1000000+p_base*10+case when exists(select 1 from public.user_roles where user_id=p_user_id and role='senior_lecturer') then 2 else 1 end;
end;$$;
-- Retain existing locks, ACLs and history while switching every live quote
-- consumer to the explicit amount/total projection (including hourly offers).
do $migration$
declare f record;source text;patched text;u text;
begin
 for f in select p.oid from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.prosrc like '%private.role_net(%' and p.proname not in ('role_net','replacement_quote') loop
  source=pg_catalog.pg_get_functiondef(f.oid);patched=source;
  foreach u in array array['auth.uid(),j.id','new.lecturer_id,new.job_id','p_target,c.job_id'] loop
   patched=replace(patched,'private.role_net(o.gross_amount,'||u||')','(private.lecturer_job_quote('||split_part(u,',',1)||','||split_part(u,',',2)||')->>''amount'')::numeric');
   patched=replace(patched,'private.role_net(o.gross_total_amount,'||u||')','(private.lecturer_job_quote('||split_part(u,',',1)||','||split_part(u,',',2)||')->>''total_amount'')::numeric');
  end loop;
  patched=replace(patched,'if o.policy_version is null then raise exception ''Compensation policy has not been configured'' using errcode=''22023'';end if;','');
  patched=replace(patched,'platform=case when exists(select 1 from public.user_roles where user_id=p_target and role=''senior_lecturer'') then 100-o.senior_percent else 100-o.regular_percent end;','platform=case when o.gross_total_amount=0 then 0 else round((o.gross_total_amount-net_total)/o.gross_total_amount*100,2) end;');
  if patched=source or patched like '%private.role_net(%' then raise exception 'Unexpected quote consumer %',f.oid::regprocedure;end if;
  execute patched;
 end loop;
end $migration$;
create or replace function private.replacement_quote(p_job uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare j public.jobs;o private.job_commission_offers;q jsonb;
begin
 select * into j from public.jobs where id=p_job;select * into o from private.job_commission_offers where job_id=p_job;
 if o.pricing_mode='role_split' then
  if not private.lecturer_actor() then return null;end if;q=private.lecturer_job_quote(auth.uid(),p_job);
  if q is null then return null;end if;
  return q||jsonb_build_object('terms',j.terms,'terms_version',private.role_quote_version(j.terms_version,auth.uid()));
 end if;
 return jsonb_build_object('amount',j.amount,'total_amount',j.total_amount,'currency',j.currency,'rate_unit',j.rate_unit,'terms',j.terms,'terms_version',j.terms_version);
end;$$;
-- Exact accepted rows, not a mutable rate setting, drive the revenue ledger.
create or replace function private.capture_claim_revenue() returns trigger language plpgsql security definer set search_path='' as $$
declare o private.job_commission_offers;platform numeric;
begin
 select * into o from private.job_commission_offers where job_id=new.job_id;
 if found then
  platform=case when o.gross_total_amount=0 then 0 else round((o.gross_total_amount-new.total_amount)/o.gross_total_amount*100,2) end;
  insert into private.claim_revenue_ledger(claim_id,job_id,organisation_id,lecturer_id,gross_amount,gross_total_amount,platform_percent,platform_total_amount,lecturer_net_amount,lecturer_net_total_amount,currency)
  values(new.id,new.job_id,o.organisation_id,new.lecturer_id,o.gross_amount,o.gross_total_amount,platform,o.gross_total_amount-new.total_amount,new.amount,new.total_amount,o.currency);
 end if;return new;
end;$$;
-- Policy snapshots are retained for provenance, but new offers can use the
-- explicit personal default even before an optional legacy global policy exists.
alter table private.job_commission_offers drop constraint valid_offer_policy;
alter table private.job_commission_offers add constraint valid_offer_policy check((regular_percent is null and senior_percent is null and policy_version is null) or (regular_percent is not null and senior_percent is not null and policy_version is not null and regular_percent between 0 and 100 and senior_percent>=regular_percent and senior_percent<=100 and policy_version>0));
do $migration$
declare signature text;source text;patched text;
begin
 foreach signature in array array['private.normalize_role_offer()','private.set_job_commission(uuid,numeric,numeric,numeric)'] loop
  source=pg_catalog.pg_get_functiondef(signature::regprocedure);
  patched=replace(source,'if policy.version is null then raise exception ''Compensation policy has not been configured'' using errcode=''22023'';end if;','if policy.version is null then policy.version=1;policy.regular_percent=50;policy.senior_percent=50;end if;');
  if patched=source then raise exception 'Unexpected offer-policy adapter %',signature;end if;execute patched;
 end loop;
end $migration$;
create function private.manual_assignment_candidates(p_job_id uuid,p_search text default '') returns jsonb language plpgsql stable security definer set search_path='' as $$
declare j public.jobs;
begin
 if not private.has_permission('jobs.manage') then raise exception 'Job management required' using errcode='42501';end if;
 if p_search is null or length(p_search)>200 then raise exception 'Invalid lecturer search' using errcode='22023';end if;
 select * into j from public.jobs where id=p_job_id;if not found then raise exception 'Assignment unavailable' using errcode='42501';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'name',x.display_name,'eligibility',case when j.status<>'published' then 'unavailable' when x.quote is null then 'quote_unavailable' else x.eligibility end,'terms_version',case when exists(select 1 from private.job_commission_offers where job_id=j.id and pricing_mode='role_split') then private.role_quote_version(j.terms_version,x.id) else j.terms_version end,'quote',case when private.has_permission('finance.gross.read') then x.quote end) order by x.display_name,x.id)
 from(select p.id,p.display_name,private.assignment_replacement_eligibility(j.id,p.id,null) eligibility,private.lecturer_job_quote(p.id,j.id) quote from public.profiles p where p.active and private.lecturer_user(p.id) and strpos(lower(p.display_name),lower(p_search))>0 order by p.display_name,p.id limit 50)x),'[]'::jsonb);
end;$$;
create function private.manual_assign_job(p_job_id uuid,p_lecturer_id uuid,p_terms_version integer,p_expected_job_version integer,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.jobs;c public.job_claims;q jsonb;eligibility text;target uuid;room uuid;expected integer;contract uuid;
begin
 if not private.has_permission('jobs.manage') then raise exception 'Job management required' using errcode='42501';end if;
 perform 1 from public.profiles where id=auth.uid() and active for share;
 if p_request_id is null or p_lecturer_id is null or p_terms_version is null or p_expected_job_version is null then raise exception 'Missing manual assignment data' using errcode='22023';end if;
 perform 1 from public.profiles where id=p_lecturer_id and active for share;
 if not found or not private.lecturer_user(p_lecturer_id) then return jsonb_build_object('status','not_eligible');end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_lecturer_id::text,0));
 select * into c from public.job_claims where lecturer_id=p_lecturer_id and idempotency_key=p_request_id;
 if found then
  if c.job_id<>p_job_id then return jsonb_build_object('status','idempotency_conflict');end if;
  return jsonb_build_object('status',c.status,'claim_id',c.id);
 end if;
 select * into j from public.jobs where id=p_job_id for update;
 if not found or j.status<>'published' or j.claim_deadline<=clock_timestamp() then return jsonb_build_object('status','unavailable');end if;
 if j.lifecycle_version<>p_expected_job_version then return jsonb_build_object('status','terms_changed');end if;
 if (select count(*) from public.job_claims where job_id=j.id and status='confirmed')>=j.capacity then return jsonb_build_object('status','filled');end if;
 if exists(select 1 from public.job_claims where job_id=j.id and lecturer_id=p_lecturer_id and status='confirmed') then return jsonb_build_object('status','already_assigned');end if;
 expected=case when exists(select 1 from private.job_commission_offers where job_id=j.id and pricing_mode='role_split') then private.role_quote_version(j.terms_version,p_lecturer_id) else j.terms_version end;
 if p_terms_version<>expected then return jsonb_build_object('status','terms_changed');end if;
 eligibility=private.assignment_replacement_eligibility(j.id,p_lecturer_id,null);
 if eligibility<>'eligible' then return jsonb_build_object('status',eligibility);end if;
 q=private.lecturer_job_quote(p_lecturer_id,j.id);
 if q is null then return jsonb_build_object('status','quote_unavailable');end if;
 if j.requires_contract then contract=private.current_contract_for_interval(p_lecturer_id,(select min(starts_at) from public.job_sessions where job_id=j.id),(select max(ends_at) from public.job_sessions where job_id=j.id));end if;
 insert into public.job_claims(job_id,lecturer_id,idempotency_key,amount,total_amount,currency,rate_unit,terms,terms_version,contract_id) values(j.id,p_lecturer_id,p_request_id,(q->>'amount')::numeric,(q->>'total_amount')::numeric,j.currency,j.rate_unit,j.terms,j.terms_version,contract) returning id into target;
 insert into public.assignment_sessions(claim_id,lecturer_id,starts_at,ends_at) select target,p_lecturer_id,starts_at,ends_at from public.job_sessions where job_id=j.id;
 update public.jobs set status=case when(select count(*) from public.job_claims where job_id=j.id and status='confirmed')>=j.capacity then 'filled' else 'published' end where id=j.id;
 insert into public.claim_events(claim_id,actor_id,event_type) values(target,auth.uid(),'confirmed');
 insert into public.notifications(user_id,kind,resource_id) values(p_lecturer_id,'claim_confirmed',target);
 insert into public.chat_rooms(job_id) values(j.id) on conflict(job_id) do update set job_id=excluded.job_id returning id into room;
 insert into public.chat_members(room_id,user_id) values(room,p_lecturer_id) on conflict(room_id,user_id) do update set removed_at=null,joined_at=clock_timestamp();
 update public.chat_rooms set owner_id=p_lecturer_id where id=room and owner_id is null;
 insert into public.audit_events(actor_id,action,resource_id,details) values(auth.uid(),'assignment.manually_confirmed',target,jsonb_build_object('job_id',j.id,'lecturer_id',p_lecturer_id));
 return jsonb_build_object('status','confirmed','claim_id',target);
exception when exclusion_violation then return jsonb_build_object('status','conflict');
end;$$;
create function public.lecturer_compensation(p_user_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$select private.lecturer_compensation(p_user_id);$$;
create function public.save_lecturer_compensation(p_user_id uuid,p_mode text,p_percent numeric,p_daily_rate numeric,p_currency text,p_expected_version integer) returns jsonb language sql security invoker set search_path='' as $$select private.save_lecturer_compensation(p_user_id,p_mode,p_percent,p_daily_rate,p_currency,p_expected_version);$$;
create function public.manual_assignment_candidates(p_job_id uuid,p_search text default '') returns jsonb language sql stable security invoker set search_path='' as $$select private.manual_assignment_candidates(p_job_id,p_search);$$;
create function public.manual_assign_job(p_job_id uuid,p_lecturer_id uuid,p_terms_version integer,p_expected_job_version integer,p_request_id uuid) returns jsonb language sql security invoker set search_path='' as $$select private.manual_assign_job(p_job_id,p_lecturer_id,p_terms_version,p_expected_job_version,p_request_id);$$;
revoke all on function private.lecturer_job_quote(uuid,uuid) from public,anon,authenticated,service_role;
do $$declare f record;begin
 for f in select p.oid::regprocedure signature from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname in('private','public') and p.proname in('lecturer_compensation','save_lecturer_compensation','manual_assignment_candidates','manual_assign_job') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  execute format('grant execute on function %s to authenticated',f.signature);
 end loop;
end$$;
-- Direct callers receive a clear denial if a chosen daily rate cannot fit the
-- offer's currency/budget. Idempotent accepted receipts remain replayable.
alter function private.claim_job(uuid,uuid,integer) rename to claim_job_before_personal_compensation;
revoke all on function private.claim_job_before_personal_compensation(uuid,uuid,integer) from public,anon,authenticated,service_role;
create function private.claim_job(p_job_id uuid,p_idempotency_key uuid,p_terms_version integer) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not private.actor_active() then raise exception 'Authentication required' using errcode='42501';end if;
 perform 1 from public.profiles where id=auth.uid() and active for share;
 if private.lecturer_actor() and not exists(select 1 from public.job_claims where lecturer_id=auth.uid() and idempotency_key=p_idempotency_key) and exists(select 1 from private.job_commission_offers where job_id=p_job_id and pricing_mode='role_split') and private.lecturer_job_quote(auth.uid(),p_job_id) is null then
  return jsonb_build_object('status','quote_unavailable');
 end if;
 return private.claim_job_before_personal_compensation(p_job_id,p_idempotency_key,p_terms_version);
end;$$;
revoke all on function private.claim_job(uuid,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function private.claim_job(uuid,uuid,integer) to authenticated;
-- Personal prices can range up to the gross offer, regardless of legacy rank
-- policy metadata. Expose a conservative maximum only to the existing finance ACL.
do $$declare original text;begin
 select pg_get_functiondef('private.job_lifecycle(uuid)'::regprocedure) into original;
 if strpos(original,'round(gross_total_amount*senior_percent/100,2)*j.capacity')=0 then raise exception 'Unexpected job lifecycle budget projection';end if;
 execute replace(original,'round(gross_total_amount*senior_percent/100,2)*j.capacity','gross_total_amount*j.capacity');
end$$;
notify pgrst,'reload schema';
commit;
