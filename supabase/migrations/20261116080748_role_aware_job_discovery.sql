begin;
-- Depends on delegated_roles_and_private_role_pricing. Released M7 SQL stays
-- byte-identical; only the latest discovery projections change here.
-- Prospective compensation uses each offer's captured private policy. A role
-- without lecturer eligibility receives no alternate prospective quote.
create function private.job_discovery_quote(p_job_id uuid)
returns table(amount numeric,total_amount numeric,terms_version integer)
language sql stable security definer set search_path='' as $$
 select
 case when o.pricing_mode='role_split' then case when private.lecturer_actor() then private.role_net(o.gross_amount,auth.uid(),j.id) end else j.amount end,
 case when o.pricing_mode='role_split' then case when private.lecturer_actor() then private.role_net(o.gross_total_amount,auth.uid(),j.id) end else j.total_amount end,
 case when o.pricing_mode='role_split' and private.lecturer_actor() then private.role_quote_version(j.terms_version,auth.uid()) else j.terms_version end
 from public.jobs j left join private.job_commission_offers o on o.job_id=j.id
 where j.id=p_job_id and private.actor_active() and private.can_read_job(j.id);
$$;
-- Cursor context is server-derived before filtering. A role/tier or policy
-- revision invalidates old monetary order; no policy percentages leave SQL.
create function private.job_discovery_quote_context() returns text
language sql stable security definer set search_path='' as $$
 select md5(auth.uid()::text||':'||case when private.lecturer_actor() then private.role_quote_version(1,auth.uid())::text else 'manager' end||':'||coalesce((select version::text from private.compensation_policy),'unconfigured'));
$$;
revoke execute on function private.job_discovery_quote(uuid),private.job_discovery_quote_context() from public,anon,authenticated,service_role;

-- Unknown quotes remain NULL in returned items and never pass price bounds.
-- Money ordering places them last with an internal non-price cursor sentinel.
create or replace function private.job_discovery_candidates(f jsonb)
returns table(job_id uuid,sort_number numeric,sort_text text) language sql stable security definer set search_path='' as $$
 select j.id,
 case f->>'sort' when 'newest' then extract(epoch from j.created_at) when 'oldest' then extract(epoch from j.created_at)
 when 'soonest' then coalesce(s.first_start,1e20) when 'total_asc' then coalesce(quote.total_amount,1e20) when 'total_desc' then coalesce(quote.total_amount,-1e20) when 'rate_asc' then coalesce(quote.amount,1e20) when 'rate_desc' then coalesce(quote.amount,-1e20) when 'duration_asc' then s.seconds else 0 end,
 lower(j.title)
 from public.jobs j left join lateral private.job_discovery_quote(j.id) quote on true cross join lateral(select min(extract(epoch from js.starts_at))first_start,coalesce(sum(extract(epoch from js.ends_at-js.starts_at)),0)seconds from public.job_sessions js where js.job_id=j.id)s
 where private.can_read_job(j.id)
 and (f->>'q'='' or strpos(lower(j.title||' '||j.description||' '||j.customer_name||' '||j.location),lower(f->>'q'))>0 or exists(select 1 from public.job_requirements r join public.topics t on t.id=r.topic_id where r.job_id=j.id and strpos(lower(t.label_de||' '||t.label_en||' '||array_to_string(t.aliases,' ')),lower(f->>'q'))>0))
 and (f->>'customer'='' or strpos(lower(j.customer_name),lower(f->>'customer'))>0)
 and (f->>'delivery'='' or j.delivery_type=f->>'delivery') and(f->>'status'='' or j.status=f->>'status')
 and(f->>'currency'='' or j.currency=f->>'currency')and(f->>'unit'='' or j.rate_unit=f->>'unit')
 and not exists(select 1 from jsonb_array_elements_text(f->'topic_ids')t where not exists(select 1 from public.job_requirements r where r.job_id=j.id and r.topic_id=t::uuid))
 and((f->>'from'='' and f->>'to'='')or exists(select 1 from public.job_sessions js where js.job_id=j.id and(f->>'from'='' or js.ends_at>(nullif(f->>'from','')::date::timestamp at time zone(f->>'zone')))and(f->>'to'='' or js.starts_at<((nullif(f->>'to','')::date+1)::timestamp at time zone(f->>'zone')))))
 and(f->>'min_total' is null or quote.total_amount>=(f->>'min_total')::numeric)and(f->>'max_total' is null or quote.total_amount<=(f->>'max_total')::numeric)
 and(f->>'min_rate' is null or quote.amount>=(f->>'min_rate')::numeric)and(f->>'max_rate' is null or quote.amount<=(f->>'max_rate')::numeric)
 and(f->>'min_hours' is null or s.seconds>=(f->>'min_hours')::numeric*3600)and(f->>'max_hours' is null or s.seconds<=(f->>'max_hours')::numeric*3600)
 and(not(f->>'available_only')::boolean or (j.status='published' and(j.claim_deadline is null or j.claim_deadline>now())
 and exists(select 1 from public.job_sessions where job_id=j.id)and not exists(select 1 from public.job_sessions where job_id=j.id and starts_at<=now())
 and(select count(*)from public.job_claims c where c.job_id=j.id and c.status='confirmed')<j.capacity
 and not exists(select 1 from public.job_sessions js where js.job_id=j.id and(
 exists(select 1 from public.personal_events e where e.user_id=auth.uid()and tstzrange(e.starts_at,e.ends_at,'[)')&&tstzrange(js.starts_at,js.ends_at,'[)'))
 or exists(select 1 from public.assignment_sessions a where a.lecturer_id=auth.uid()and a.released_at is null and tstzrange(a.starts_at,a.ends_at,'[)')&&tstzrange(js.starts_at,js.ends_at,'[)'))
 or exists(select 1 from public.lecturer_availability a where a.user_id=auth.uid()and a.kind='unavailable'and tstzrange(a.starts_at,a.ends_at,'[)')&&tstzrange(js.starts_at,js.ends_at,'[)'))))))
$$;

-- Detail and dashboard suggestions reuse the same currently authorized quote.
create or replace function private.job_discovery_item(p_job_id uuid)returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',j.id,'title',j.title,'description',j.description,'customer_name',j.customer_name,'delivery_type',j.delivery_type,'location',j.location,'time_zone',j.time_zone,'status',j.status,'amount',quote.amount,'total_amount',quote.total_amount,'currency',j.currency,'rate_unit',j.rate_unit,'terms',j.terms,'terms_version',quote.terms_version,'requires_contract',j.requires_contract,'claim_deadline',j.claim_deadline,'capacity',j.capacity,'capacity_basis',j.capacity_basis,'created_at',j.created_at,
 'job_sessions',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'job_id',s.job_id,'starts_at',s.starts_at,'ends_at',s.ends_at)order by s.starts_at,s.id)from public.job_sessions s where s.job_id=j.id),'[]'::jsonb),
 'job_requirements',coalesce((select jsonb_agg(jsonb_build_object('topic_id',r.topic_id)order by r.topic_id)from public.job_requirements r where r.job_id=j.id),'[]'::jsonb),
 'confirmed_count',(select count(*)from public.job_claims c where c.job_id=j.id and c.status='confirmed'),
 'open_positions',case when j.status='published'then greatest(0,j.capacity-(select count(*)from public.job_claims c where c.job_id=j.id and c.status='confirmed'))else 0 end)
 from public.jobs j left join lateral private.job_discovery_quote(j.id) quote on true where j.id=p_job_id and private.can_read_job(j.id)
$$;

-- Preserve bounded keyset paging while binding it to current quote context.
create or replace function private.job_discovery(p_filters jsonb default '{}'::jsonb,p_cursor jsonb default null,p_limit integer default 50)returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare f jsonb;descending boolean;fingerprint text;items jsonb;last_item jsonb;more boolean;num numeric;txt text;cursor_id uuid;
begin
 if not private.actor_active() or not(private.lecturer_actor()or private.has_permission('jobs.manage'))then raise exception 'Job discovery access denied' using errcode='42501';end if;
 f=private.job_discovery_filters(p_filters);descending=f->>'sort'in('newest','total_desc','rate_desc');fingerprint=md5(f::text||':'||private.job_discovery_quote_context());
 if p_limit is null or p_limit not between 1 and 100 then raise exception 'Invalid page size' using errcode='22023';end if;
 if p_cursor is not null then
  if jsonb_typeof(p_cursor)<>'object' or(select count(*)from jsonb_object_keys(p_cursor))<>4 or p_cursor->>'fingerprint' is distinct from fingerprint or jsonb_typeof(p_cursor->'id')is distinct from'string'or jsonb_typeof(p_cursor->'number')is distinct from'string'or jsonb_typeof(p_cursor->'text')is distinct from'string' then raise exception 'Invalid discovery cursor' using errcode='22023';end if;
  begin cursor_id=(p_cursor->>'id')::uuid;num=(p_cursor->>'number')::numeric;txt=p_cursor->>'text';exception when others then raise exception 'Invalid discovery cursor' using errcode='22023';end;
  if num is null or num::text in('NaN','Infinity','-Infinity')or length(txt)>200 then raise exception 'Invalid discovery cursor' using errcode='22023';end if;
 end if;
 with candidates as(select *from private.job_discovery_candidates(f)c where p_cursor is null or case when f->>'sort'='title'then(c.sort_text collate "C",c.job_id)>(txt collate "C",cursor_id)when descending then(c.sort_number,c.job_id)<(num,cursor_id)else(c.sort_number,c.job_id)>(num,cursor_id)end),
 ranked as(select c.*,row_number()over(order by case when descending then c.sort_number end desc,case when not descending and f->>'sort'<>'title'then c.sort_number end asc,case when f->>'sort'='title'then c.sort_text end collate "C" asc,case when descending then c.job_id end desc,case when not descending then c.job_id end asc)rn from candidates c),
 page as(select *from ranked order by rn limit p_limit+1)
 select coalesce(jsonb_agg(private.job_discovery_item(job_id)order by rn)filter(where rn<=p_limit),'[]'::jsonb),coalesce(bool_or(rn>p_limit),false),(jsonb_agg(jsonb_build_object('id',job_id,'number',sort_number::text,'text',sort_text,'fingerprint',fingerprint)order by rn)filter(where rn<=p_limit))->(least(p_limit,count(*)filter(where rn<=p_limit))::int-1)
 into items,more,last_item from page;
 return jsonb_build_object('items',items,'has_more',more,'next_cursor',case when more then last_item end,'as_of',now(),'filters',f);
end;$$;
commit;
