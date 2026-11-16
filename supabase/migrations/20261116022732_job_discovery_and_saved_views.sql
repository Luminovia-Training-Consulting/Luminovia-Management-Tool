begin;
-- Closed, canonical filters are shared by saved views and actual discovery.
-- Money comparisons always require an explicit original currency; rate
-- comparisons additionally require one fee unit. No exchange rates are implied.
create function private.job_discovery_filters(p_filters jsonb) returns jsonb
language plpgsql stable set search_path='' as $$
declare f jsonb:=jsonb_build_object('q','','customer','','topic_ids','[]'::jsonb,'delivery','','status','','from','','to','','zone','Europe/Berlin','currency','','unit','','min_total',null,'max_total',null,'min_rate',null,'max_rate',null,'min_hours',null,'max_hours',null,'available_only',false,'sort','newest'); k text;v jsonb;d date;
begin
 if p_filters is null or jsonb_typeof(p_filters)<>'object' then raise exception 'Invalid discovery filters' using errcode='22023';end if;
 for k,v in select key,value from jsonb_each(p_filters) loop
  if not f?k then raise exception 'Unknown discovery filter' using errcode='22023';end if;
  if k in('min_total','max_total','min_rate','max_rate','min_hours','max_hours') then
   if jsonb_typeof(v) not in('number','null') or (v<>'null'::jsonb and ((v::text)::numeric<0 or (v::text)::numeric>1000000000)) then raise exception 'Invalid numeric filter' using errcode='22023';end if;
  elsif k='topic_ids' then
   if jsonb_typeof(v)<>'array' or jsonb_array_length(v)>20 then raise exception 'Invalid topics' using errcode='22023';end if;
   if exists(select 1 from jsonb_array_elements(v)x where jsonb_typeof(x)<>'string' or (x#>>'{}')!~'^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$') then raise exception 'Invalid topic identity' using errcode='22023';end if;
   if jsonb_array_length(v)<>(select count(distinct x::uuid)from jsonb_array_elements_text(v)x)then raise exception 'Duplicate topics' using errcode='22023';end if;
   select coalesce(jsonb_agg(x::uuid::text order by x::uuid),'[]'::jsonb) into v from jsonb_array_elements_text(v)x;
  elsif k='available_only' then
   if jsonb_typeof(v)<>'boolean' then raise exception 'Invalid availability filter' using errcode='22023';end if;
  elsif jsonb_typeof(v)<>'string' then raise exception 'Invalid text filter' using errcode='22023';
  end if;
  f=jsonb_set(f,array[k],v);
 end loop;
 if length(f->>'q')>160 or length(f->>'customer')>120 or not exists(select 1 from pg_catalog.pg_timezone_names where name=f->>'zone')
 or f->>'delivery' not in('','online','onsite') or f->>'status' not in('','draft','published','filled','archived')
 or f->>'currency' not in('','EUR','AUD') or f->>'unit' not in('','per_day','per_hour','per_teaching_unit','fixed_total')
 or f->>'sort' not in('newest','oldest','soonest','total_asc','total_desc','rate_asc','rate_desc','duration_asc','title') then raise exception 'Invalid filter value' using errcode='22023';end if;
 foreach k in array array['from','to'] loop
  if f->>k<>'' then
   if f->>k!~'^\d{4}-\d{2}-\d{2}$' then raise exception 'Invalid local date' using errcode='22023';end if;
   begin d=(f->>k)::date;exception when others then raise exception 'Invalid local date' using errcode='22023';end;
   if not isfinite(d) or to_char(d,'YYYY-MM-DD')<>f->>k then raise exception 'Invalid local date' using errcode='22023';end if;
  end if;
 end loop;
 if f->>'from'<>'' and f->>'to'<>'' and f->>'from'>f->>'to' then raise exception 'Reversed date filter' using errcode='22023';end if;
 foreach k in array array['total','rate','hours'] loop
  if (f->>('min_'||k))::numeric>(f->>('max_'||k))::numeric then raise exception 'Reversed numeric range' using errcode='22023';end if;
 end loop;
 if f->>'currency'='' and (f->>'min_total' is not null or f->>'max_total' is not null or f->>'min_rate' is not null or f->>'max_rate' is not null or f->>'sort' in('total_asc','total_desc','rate_asc','rate_desc')) then raise exception 'Choose one original currency' using errcode='22023';end if;
 if f->>'unit'='' and (f->>'min_rate' is not null or f->>'max_rate' is not null or f->>'sort' in('rate_asc','rate_desc')) then raise exception 'Choose one fee unit' using errcode='22023';end if;
 return f;
end;$$;

create function private.job_discovery_candidates(f jsonb)
returns table(job_id uuid,sort_number numeric,sort_text text) language sql stable security definer set search_path='' as $$
 select j.id,
 case f->>'sort' when 'newest' then extract(epoch from j.created_at) when 'oldest' then extract(epoch from j.created_at)
 when 'soonest' then coalesce(s.first_start,1e20) when 'total_asc' then j.total_amount when 'total_desc' then j.total_amount when 'rate_asc' then j.amount when 'rate_desc' then j.amount when 'duration_asc' then s.seconds else 0 end,
 lower(j.title)
 from public.jobs j cross join lateral(select min(extract(epoch from js.starts_at))first_start,coalesce(sum(extract(epoch from js.ends_at-js.starts_at)),0)seconds from public.job_sessions js where js.job_id=j.id)s
 where private.can_read_job(j.id)
 and (f->>'q'='' or strpos(lower(j.title||' '||j.description||' '||j.customer_name||' '||j.location),lower(f->>'q'))>0 or exists(select 1 from public.job_requirements r join public.topics t on t.id=r.topic_id where r.job_id=j.id and strpos(lower(t.label_de||' '||t.label_en||' '||array_to_string(t.aliases,' ')),lower(f->>'q'))>0))
 and (f->>'customer'='' or strpos(lower(j.customer_name),lower(f->>'customer'))>0)
 and (f->>'delivery'='' or j.delivery_type=f->>'delivery') and(f->>'status'='' or j.status=f->>'status')
 and(f->>'currency'='' or j.currency=f->>'currency')and(f->>'unit'='' or j.rate_unit=f->>'unit')
 and not exists(select 1 from jsonb_array_elements_text(f->'topic_ids')t where not exists(select 1 from public.job_requirements r where r.job_id=j.id and r.topic_id=t::uuid))
 and((f->>'from'='' and f->>'to'='')or exists(select 1 from public.job_sessions js where js.job_id=j.id and(f->>'from'='' or js.ends_at>(nullif(f->>'from','')::date::timestamp at time zone(f->>'zone')))and(f->>'to'='' or js.starts_at<((nullif(f->>'to','')::date+1)::timestamp at time zone(f->>'zone')))))
 and(f->>'min_total' is null or j.total_amount>=(f->>'min_total')::numeric)and(f->>'max_total' is null or j.total_amount<=(f->>'max_total')::numeric)
 and(f->>'min_rate' is null or j.amount>=(f->>'min_rate')::numeric)and(f->>'max_rate' is null or j.amount<=(f->>'max_rate')::numeric)
 and(f->>'min_hours' is null or s.seconds>=(f->>'min_hours')::numeric*3600)and(f->>'max_hours' is null or s.seconds<=(f->>'max_hours')::numeric*3600)
 and(not(f->>'available_only')::boolean or (j.status='published' and(j.claim_deadline is null or j.claim_deadline>now())
 and exists(select 1 from public.job_sessions where job_id=j.id)and not exists(select 1 from public.job_sessions where job_id=j.id and starts_at<=now())
 and(select count(*)from public.job_claims c where c.job_id=j.id and c.status='confirmed')<j.capacity
 and not exists(select 1 from public.job_sessions js where js.job_id=j.id and(
 exists(select 1 from public.personal_events e where e.user_id=auth.uid()and tstzrange(e.starts_at,e.ends_at,'[)')&&tstzrange(js.starts_at,js.ends_at,'[)'))
 or exists(select 1 from public.assignment_sessions a where a.lecturer_id=auth.uid()and a.released_at is null and tstzrange(a.starts_at,a.ends_at,'[)')&&tstzrange(js.starts_at,js.ends_at,'[)'))
 or exists(select 1 from public.lecturer_availability a where a.user_id=auth.uid()and a.kind='unavailable'and tstzrange(a.starts_at,a.ends_at,'[)')&&tstzrange(js.starts_at,js.ends_at,'[)'))))))
$$;

create function private.job_discovery_item(p_job_id uuid)returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',j.id,'title',j.title,'description',j.description,'customer_name',j.customer_name,'delivery_type',j.delivery_type,'location',j.location,'time_zone',j.time_zone,'status',j.status,'amount',j.amount,'total_amount',j.total_amount,'currency',j.currency,'rate_unit',j.rate_unit,'terms',j.terms,'terms_version',j.terms_version,'requires_contract',j.requires_contract,'claim_deadline',j.claim_deadline,'capacity',j.capacity,'capacity_basis',j.capacity_basis,'created_at',j.created_at,
 'job_sessions',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'job_id',s.job_id,'starts_at',s.starts_at,'ends_at',s.ends_at)order by s.starts_at,s.id)from public.job_sessions s where s.job_id=j.id),'[]'::jsonb),
 'job_requirements',coalesce((select jsonb_agg(jsonb_build_object('topic_id',r.topic_id)order by r.topic_id)from public.job_requirements r where r.job_id=j.id),'[]'::jsonb),
 'confirmed_count',(select count(*)from public.job_claims c where c.job_id=j.id and c.status='confirmed'),
 'open_positions',case when j.status='published'then greatest(0,j.capacity-(select count(*)from public.job_claims c where c.job_id=j.id and c.status='confirmed'))else 0 end)
 from public.jobs j where j.id=p_job_id and private.can_read_job(j.id)
$$;

create function private.job_discovery(p_filters jsonb default '{}'::jsonb,p_cursor jsonb default null,p_limit integer default 50)returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare f jsonb;descending boolean;fingerprint text;items jsonb;last_item jsonb;more boolean;num numeric;txt text;cursor_id uuid;
begin
 if not private.actor_active() or not(private.lecturer_actor()or private.has_permission('jobs.manage'))then raise exception 'Job discovery access denied' using errcode='42501';end if;
 f=private.job_discovery_filters(p_filters);descending=f->>'sort'in('newest','total_desc','rate_desc');fingerprint=md5(f::text);
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
create function public.job_discovery(p_filters jsonb default '{}'::jsonb,p_cursor jsonb default null,p_limit integer default 50)returns jsonb language sql stable security invoker set search_path='' as $$select private.job_discovery(p_filters,p_cursor,p_limit);$$;

create function private.job_detail(p_job_id uuid)returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.actor_active()or not private.can_read_job(p_job_id)then raise exception 'Job access denied'using errcode='42501';end if;
 return private.job_discovery_item(p_job_id);
end;$$;
create function public.job_detail(p_job_id uuid)returns jsonb language sql stable security invoker set search_path='' as $$select private.job_detail(p_job_id);$$;

-- These title lookups are limited to the caller's accepted assignments, so a
-- calendar never loads or truncates the entire lecturer marketplace.
create function private.assignment_job_titles(p_job_ids uuid[])returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.actor_active()then raise exception 'Account inactive'using errcode='42501';end if;
 if p_job_ids is null or cardinality(p_job_ids)>1000 or array_position(p_job_ids,null)is not null then raise exception 'Invalid assignment identities'using errcode='22023';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',j.id,'title',j.title)order by j.id)from public.jobs j where j.id=any(p_job_ids)and exists(select 1 from public.job_claims c where c.job_id=j.id and c.lecturer_id=auth.uid()and c.status='confirmed')),'[]'::jsonb);
end;$$;
create function public.assignment_job_titles(p_job_ids uuid[])returns jsonb language sql stable security invoker set search_path='' as $$select private.assignment_job_titles(p_job_ids);$$;

create function private.job_dashboard()returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not private.actor_active()or not(private.lecturer_actor()or private.has_permission('jobs.manage'))then raise exception 'Job dashboard access denied'using errcode='42501';end if;
 with visible as materialized(select j.*from public.jobs j where private.can_read_job(j.id)),
 offers as(select j.*from visible j where status='published'and(claim_deadline is null or claim_deadline>now())and exists(select 1 from public.job_sessions where job_id=j.id)and not exists(select 1 from public.job_sessions where job_id=j.id and starts_at<=now())and(select count(*)from public.job_claims c where c.job_id=j.id and c.status='confirmed')<j.capacity),
 suggestions as(select j.id,exists(select 1 from public.job_requirements where job_id=j.id)and not exists(select 1 from public.job_requirements r where r.job_id=j.id and not exists(select 1 from public.lecturer_topics t where t.user_id=auth.uid()and t.topic_id=r.topic_id and t.verified and(t.valid_until is null or t.valid_until>=(select max(ends_at)from public.job_sessions where job_id=j.id))))matching from offers j),
 chosen as(select *from suggestions order by matching desc,(select min(starts_at)from public.job_sessions where job_id=suggestions.id),id limit 2)
 select jsonb_build_object('open_count',(select count(*)from offers),'assignment_count',(select count(*)from public.job_claims where lecturer_id=auth.uid()and status='confirmed'),
 'next_session_count',(select count(*)from public.assignment_sessions s join public.job_claims c on c.id=s.claim_id where c.lecturer_id=auth.uid()and c.status='confirmed'and s.released_at is null and s.ends_at>now()),
 'matching',coalesce((select bool_or(matching)from chosen),false),'suggestions',coalesce((select jsonb_agg(private.job_discovery_item(id)order by matching desc,(select min(starts_at)from public.job_sessions where job_id=chosen.id),id)from chosen),'[]'::jsonb),
 'next_assignments',coalesce((select jsonb_agg(to_jsonb(x)order by starts_at,id)from(select s.id,s.starts_at,s.ends_at,jsonb_build_object('id',j.id,'title',j.title)job from public.assignment_sessions s join public.job_claims c on c.id=s.claim_id join public.jobs j on j.id=c.job_id where c.lecturer_id=auth.uid()and c.status='confirmed'and s.released_at is null and s.ends_at>now()order by s.starts_at,s.id limit 5)x),'[]'::jsonb),
 'management',case when private.has_permission('jobs.manage')then jsonb_build_object('drafts',(select count(*)from visible where status='draft'),'expired',(select count(*)from visible where status='published'and claim_deadline<=now()),'upcoming',(select count(*)from visible j where status='published'and exists(select 1 from public.job_sessions s where s.job_id=j.id and s.starts_at>=now()and s.starts_at<now()+interval'14 days')))else null end,'as_of',now())into result;
 return result;
end;$$;
create function public.job_dashboard()returns jsonb language sql stable security invoker set search_path='' as $$select private.job_dashboard();$$;

create table private.saved_job_views(id uuid primary key,user_id uuid not null references public.profiles(id)on delete cascade,name text not null check(length(name)between 1 and 80),filters jsonb not null,version integer not null default 1 check(version>0),created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp());
create unique index saved_job_view_name on private.saved_job_views(user_id,lower(name));
alter table private.saved_job_views enable row level security;
create policy saved_job_views_own on private.saved_job_views for select to authenticated using((select private.actor_active())and user_id=(select auth.uid()));
revoke all on private.saved_job_views from public,anon,authenticated;
grant all on private.saved_job_views to service_role;
create function private.saved_job_views()returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.actor_active()or not(private.lecturer_actor()or private.has_permission('jobs.manage'))then raise exception 'Saved view access denied'using errcode='42501';end if;
 return coalesce((select jsonb_agg(to_jsonb(v)-'user_id'order by lower(v.name),v.id)from private.saved_job_views v where user_id=auth.uid()),'[]'::jsonb);
end;$$;
create function public.saved_job_views()returns jsonb language sql stable security invoker set search_path='' as $$select private.saved_job_views();$$;
create function private.save_job_view(p_id uuid,p_name text,p_filters jsonb,p_expected_version integer)returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare previous private.saved_job_views;f jsonb;result private.saved_job_views;
begin
 -- The role editor locks this profile FOR UPDATE. Authorize in a separate
 -- statement AFTER acquiring SHARE so this VOLATILE entry sees the committed
 -- role/MFA state after waiting, before locking or mutating a saved-view row.
 perform 1 from public.profiles where id=auth.uid() for share;
 if not found then raise exception 'Account inactive'using errcode='42501';end if;
 if not private.actor_active()or not(private.lecturer_actor()or private.has_permission('jobs.manage'))then raise exception 'Saved view access denied'using errcode='42501';end if;
 if p_id is null or p_expected_version is null or p_expected_version<0 or p_name is null or length(trim(p_name))not between 1 and 80 or p_name~'[[:cntrl:]]'then raise exception 'Invalid saved view'using errcode='22023';end if;
 f=private.job_discovery_filters(p_filters);
 perform pg_advisory_xact_lock(hashtextextended('saved-job-views:'||auth.uid()::text,0));
 select *into previous from private.saved_job_views where id=p_id for update;
 if found then
  if previous.user_id<>auth.uid()then raise exception 'Saved view access denied'using errcode='42501';end if;
  if p_expected_version=0 and previous.version=1 and previous.name=trim(p_name)and previous.filters=f then return to_jsonb(previous)-'user_id';end if;
  if previous.version<>p_expected_version then raise exception 'Saved view changed'using errcode='40001';end if;
  update private.saved_job_views set name=trim(p_name),filters=f,version=version+1,updated_at=clock_timestamp()where id=p_id returning *into result;
 else
  if p_expected_version<>0 then raise exception 'Saved view access denied'using errcode='42501';end if;
  if(select count(*)from private.saved_job_views where user_id=auth.uid())>=20 then raise exception 'Twenty saved views maximum'using errcode='54000';end if;
  insert into private.saved_job_views(id,user_id,name,filters)values(p_id,auth.uid(),trim(p_name),f)returning *into result;
 end if;
 return to_jsonb(result)-'user_id';
end;$$;
create function public.save_job_view(p_id uuid,p_name text,p_filters jsonb,p_expected_version integer)returns jsonb language sql volatile security invoker set search_path='' as $$select private.save_job_view(p_id,p_name,p_filters,p_expected_version);$$;
create function private.remove_job_view(p_id uuid,p_expected_version integer)returns void language plpgsql volatile security definer set search_path='' as $$
declare prior private.saved_job_views;
begin
 -- The role editor locks this profile FOR UPDATE. Authorize in a separate
 -- statement AFTER acquiring SHARE so this VOLATILE entry sees the committed
 -- role/MFA state after waiting, before locking or mutating a saved-view row.
 perform 1 from public.profiles where id=auth.uid() for share;
 if not found then raise exception 'Account inactive'using errcode='42501';end if;
 if not private.actor_active()or not(private.lecturer_actor()or private.has_permission('jobs.manage'))then raise exception 'Saved view access denied'using errcode='42501';end if;
 select *into prior from private.saved_job_views where id=p_id for update;
 if not found or prior.user_id<>auth.uid()then raise exception 'Saved view access denied'using errcode='42501';end if;
 if p_expected_version is distinct from prior.version then raise exception 'Saved view changed'using errcode='40001';end if;
 delete from private.saved_job_views where id=p_id;
end;$$;
create function public.remove_job_view(p_id uuid,p_expected_version integer)returns void language sql volatile security invoker set search_path='' as $$select private.remove_job_view(p_id,p_expected_version);$$;

create index jobs_discovery_created on public.jobs(created_at desc,id desc);
create index jobs_discovery_currency_total on public.jobs(currency,total_amount,id);
create index jobs_discovery_currency_rate on public.jobs(currency,rate_unit,amount,id);
revoke all on function private.job_discovery_filters(jsonb),private.job_discovery_candidates(jsonb),private.job_discovery_item(uuid)from public,anon,authenticated;
revoke all on function private.assignment_job_titles(uuid[]),public.assignment_job_titles(uuid[]),private.job_dashboard(),public.job_dashboard(),private.job_discovery(jsonb,jsonb,integer),public.job_discovery(jsonb,jsonb,integer),private.job_detail(uuid),public.job_detail(uuid),private.saved_job_views(),public.saved_job_views(),private.save_job_view(uuid,text,jsonb,integer),public.save_job_view(uuid,text,jsonb,integer),private.remove_job_view(uuid,integer),public.remove_job_view(uuid,integer)from public,anon;
grant execute on function private.assignment_job_titles(uuid[]),public.assignment_job_titles(uuid[]),private.job_dashboard(),public.job_dashboard(),private.job_discovery(jsonb,jsonb,integer),public.job_discovery(jsonb,jsonb,integer),private.job_detail(uuid),public.job_detail(uuid),private.saved_job_views(),public.saved_job_views(),private.save_job_view(uuid,text,jsonb,integer),public.save_job_view(uuid,text,jsonb,integer),private.remove_job_view(uuid,integer),public.remove_job_view(uuid,integer)to authenticated;
commit;
