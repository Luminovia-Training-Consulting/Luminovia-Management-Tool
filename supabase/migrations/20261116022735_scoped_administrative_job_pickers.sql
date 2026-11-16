begin;
-- Metadata for a concrete administrative action, not a lecturer marketplace.
-- The two purposes mirror reserve_document and create_chat_group respectively.
create function private.job_picker_candidates(p_purpose text,p_search text)
returns table(key_id uuid,created_at timestamptz,id uuid,title text,customer_name text,course_run_id uuid,time_zone text)
language sql stable security definer set search_path='' as $$
 select j.id,j.created_at,j.id,j.title,j.customer_name,j.course_run_id,j.time_zone
 from public.jobs j where p_purpose='job_attachment'
 and (p_search='' or strpos(lower(j.title||' '||j.customer_name),lower(p_search))>0)
 union all
 select r.id,r.created_at,representative.id,t.title,coalesce(o.name,''),r.id,r.time_zone
 from public.course_runs r join public.course_templates t on t.id=r.template_id left join public.organisations o on o.id=r.organisation_id
 cross join lateral(select j.id from public.jobs j where j.course_run_id=r.id order by j.created_at,j.id limit 1)representative
 where p_purpose='participant_course'
 and (p_search='' or strpos(lower(t.title||' '||coalesce(o.name,'')),lower(p_search))>0);
$$;
create function private.job_picker(p_purpose text,p_search text default '',p_cursor jsonb default null,p_limit integer default 40,p_selected_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare fingerprint text;before_at timestamptz;before_id uuid;items jsonb;more boolean;cursor jsonb;selected jsonb;
begin
 if not private.actor_active() then raise exception 'Active account required'using errcode='42501';end if;
 if p_purpose is null or p_purpose not in('job_attachment','participant_course') then raise exception 'Invalid picker purpose'using errcode='22023';end if;
 if not private.has_permission(case p_purpose when 'job_attachment' then 'jobs.manage' else 'courses.manage' end) then raise exception 'Current purpose permission and MFA required'using errcode='42501';end if;
 if p_search is null or length(p_search)>160 or p_limit is null or p_limit not between 1 and 100 then raise exception 'Invalid picker search or limit'using errcode='22023';end if;
 fingerprint=md5(jsonb_build_array(p_purpose,lower(p_search))::text);
 if p_cursor is not null then
  if jsonb_typeof(p_cursor)<>'object' or (select count(*)from jsonb_object_keys(p_cursor))<>3
   or exists(select 1 from jsonb_object_keys(p_cursor)k where k not in('at','id','fingerprint'))
   or jsonb_typeof(p_cursor->'at')is distinct from 'string' or jsonb_typeof(p_cursor->'id')is distinct from 'string'
   or p_cursor->>'at'!~'(Z|[+-][0-9]{2}:[0-9]{2})$'
   or p_cursor->>'id'!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   or p_cursor->>'fingerprint' is distinct from fingerprint then raise exception 'Invalid picker cursor'using errcode='22023';end if;
  begin before_at=(p_cursor->>'at')::timestamptz;before_id=(p_cursor->>'id')::uuid;exception when invalid_datetime_format or datetime_field_overflow then raise exception 'Invalid picker cursor'using errcode='22023';end;
  if not isfinite(before_at)then raise exception 'Invalid picker cursor'using errcode='22023';end if;
 end if;
 with page as materialized(
  select *from private.job_picker_candidates(p_purpose,p_search)candidate
  where before_at is null or(candidate.created_at,candidate.key_id)<(before_at,before_id)
  order by created_at desc,key_id desc limit p_limit+1
 ),visible as(select *from page order by created_at desc,key_id desc limit p_limit)
 select coalesce((select jsonb_agg(jsonb_build_object('id',id,'title',title,'customer_name',customer_name,'course_run_id',course_run_id,'time_zone',time_zone,'starts_at',case when p_purpose='job_attachment' then(select min(s.starts_at)from public.job_sessions s where s.job_id=visible.id)else(select min(s.starts_at)from public.course_sessions s where s.course_run_id=visible.course_run_id)end)order by created_at desc,key_id desc)from visible),'[]'::jsonb),
 (select count(*)>p_limit from page),
 (select jsonb_build_object('at',created_at,'id',key_id,'fingerprint',fingerprint)from visible order by created_at,key_id limit 1)
 into items,more,cursor;
 -- Resolve just the existing selected identity in the same authorized request.
 -- A course representative remains a real job UUID accepted by the legacy API.
 if p_purpose='job_attachment' then
  select jsonb_build_object('id',j.id,'title',j.title,'customer_name',j.customer_name,'course_run_id',j.course_run_id,'time_zone',j.time_zone,'starts_at',(select min(s.starts_at)from public.job_sessions s where s.job_id=j.id))into selected from public.jobs j where j.id=p_selected_id;
 else
  select jsonb_build_object('id',j.id,'title',t.title,'customer_name',coalesce(o.name,''),'course_run_id',r.id,'time_zone',r.time_zone,'starts_at',(select min(s.starts_at)from public.course_sessions s where s.course_run_id=r.id))into selected
  from public.jobs j join public.course_runs r on r.id=j.course_run_id join public.course_templates t on t.id=r.template_id left join public.organisations o on o.id=r.organisation_id where j.id=p_selected_id;
 end if;
 return jsonb_build_object('items',items,'has_more',more,'next_cursor',case when more then cursor else null end,'selected',selected);
end;$$;
create function public.job_picker(p_purpose text,p_search text default '',p_cursor jsonb default null,p_limit integer default 40,p_selected_id uuid default null)
returns jsonb language sql stable security invoker set search_path='' as $$select private.job_picker(p_purpose,p_search,p_cursor,p_limit,p_selected_id);$$;
create index jobs_course_picker on public.jobs(course_run_id,created_at,id)where course_run_id is not null;
create index course_sessions_picker_start on public.course_sessions(course_run_id,starts_at);
create index course_runs_picker_cursor on public.course_runs(created_at desc,id desc);
revoke all on function private.job_picker_candidates(text,text)from public,anon,authenticated;
revoke all on function private.job_picker(text,text,jsonb,integer,uuid),public.job_picker(text,text,jsonb,integer,uuid)from public,anon,authenticated;
grant execute on function private.job_picker(text,text,jsonb,integer,uuid),public.job_picker(text,text,jsonb,integer,uuid)to authenticated;
commit;
