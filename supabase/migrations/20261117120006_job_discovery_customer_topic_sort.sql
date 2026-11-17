begin;
-- The preceding validators and candidate ACL/price filtering remain authoritative.
do $$ declare body text; begin
 select prosrc into strict body from pg_catalog.pg_proc where oid='private.job_discovery_filters(jsonb)'::regprocedure;
 execute format('create function private.job_discovery_filters_before_text_sort(p_filters jsonb) returns jsonb language plpgsql stable set search_path='''' as %L',body);
 select prosrc into strict body from pg_catalog.pg_proc where oid='private.job_discovery_candidates(jsonb)'::regprocedure;
 execute format('create function private.job_discovery_candidates_before_text_sort(f jsonb) returns table(job_id uuid,sort_number numeric,sort_text text) language sql stable security definer set search_path='''' as %L',body);
end $$;
revoke all on function private.job_discovery_filters_before_text_sort(jsonb),private.job_discovery_candidates_before_text_sort(jsonb) from public,anon,authenticated,service_role;
create or replace function private.job_discovery_filters(p_filters jsonb) returns jsonb
language plpgsql stable set search_path='' as $$
declare chosen text:=p_filters->>'sort'; result jsonb;
begin
 if chosen in ('customer_asc','topic_de_asc','topic_en_asc') then
  result=private.job_discovery_filters_before_text_sort(jsonb_set(p_filters,'{sort}','"title"'::jsonb));
  return jsonb_set(result,'{sort}',to_jsonb(chosen));
 end if;
 return private.job_discovery_filters_before_text_sort(p_filters);
end $$;
create or replace function private.job_discovery_candidates(f jsonb)
returns table(job_id uuid,sort_number numeric,sort_text text)
language sql stable security definer set search_path='' as $$
 select c.job_id,c.sort_number,
 case f->>'sort'
  when 'customer_asc' then lower(j.customer_name)
  when 'topic_de_asc' then coalesce((select min(lower(t.label_de) collate "C") from public.job_requirements r join public.topics t on t.id=r.topic_id where r.job_id=j.id),'')
  when 'topic_en_asc' then coalesce((select min(lower(t.label_en) collate "C") from public.job_requirements r join public.topics t on t.id=r.topic_id where r.job_id=j.id),'')
  else c.sort_text end
 from private.job_discovery_candidates_before_text_sort(f) c join public.jobs j on j.id=c.job_id;
$$;
create or replace function private.job_discovery(p_filters jsonb default '{}'::jsonb,p_cursor jsonb default null,p_limit integer default 50)returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare f jsonb;descending boolean;text_sort boolean;fingerprint text;items jsonb;last_item jsonb;more boolean;num numeric;txt text;cursor_id uuid;
begin
 if not private.actor_active() or not(private.lecturer_actor()or private.has_permission('jobs.manage'))then raise exception 'Job discovery access denied' using errcode='42501';end if;
 f=private.job_discovery_filters(p_filters);descending=f->>'sort'in('newest','total_desc','rate_desc');text_sort=f->>'sort'in('title','customer_asc','topic_de_asc','topic_en_asc');fingerprint=md5(f::text||':'||private.job_discovery_quote_context());
 if p_limit is null or p_limit not between 1 and 100 then raise exception 'Invalid page size' using errcode='22023';end if;
 if p_cursor is not null then
  if jsonb_typeof(p_cursor)<>'object' or(select count(*)from jsonb_object_keys(p_cursor))<>4 or p_cursor->>'fingerprint' is distinct from fingerprint or jsonb_typeof(p_cursor->'id')is distinct from'string'or jsonb_typeof(p_cursor->'number')is distinct from'string'or jsonb_typeof(p_cursor->'text')is distinct from'string' then raise exception 'Invalid discovery cursor' using errcode='22023';end if;
  begin cursor_id=(p_cursor->>'id')::uuid;num=(p_cursor->>'number')::numeric;txt=p_cursor->>'text';exception when others then raise exception 'Invalid discovery cursor' using errcode='22023';end;
  if num is null or num::text in('NaN','Infinity','-Infinity')or length(txt)>200 then raise exception 'Invalid discovery cursor' using errcode='22023';end if;
 end if;
 with candidates as(select *from private.job_discovery_candidates(f)c where p_cursor is null or case when text_sort then(c.sort_text collate "C",c.job_id)>(txt collate "C",cursor_id)when descending then(c.sort_number,c.job_id)<(num,cursor_id)else(c.sort_number,c.job_id)>(num,cursor_id)end),
 ranked as(select c.*,row_number()over(order by case when descending then c.sort_number end desc,case when not descending and not text_sort then c.sort_number end asc,case when text_sort then c.sort_text end collate "C" asc,case when descending then c.job_id end desc,case when not descending then c.job_id end asc)rn from candidates c),
 page as(select *from ranked order by rn limit p_limit+1)
 select coalesce(jsonb_agg(private.job_discovery_item(job_id)order by rn)filter(where rn<=p_limit),'[]'::jsonb),coalesce(bool_or(rn>p_limit),false),(jsonb_agg(jsonb_build_object('id',job_id,'number',sort_number::text,'text',sort_text,'fingerprint',fingerprint)order by rn)filter(where rn<=p_limit))->(least(p_limit,count(*)filter(where rn<=p_limit))::int-1)
 into items,more,last_item from page;
 return jsonb_build_object('items',items,'has_more',more,'next_cursor',case when more then last_item end,'as_of',now(),'filters',f);
end;$$;
commit;
