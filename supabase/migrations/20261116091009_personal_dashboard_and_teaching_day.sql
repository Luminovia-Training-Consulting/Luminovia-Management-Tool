begin;

-- Personal presentation choices never grant access to the selected resources.
create table private.dashboard_preferences (
 user_id uuid primary key references public.profiles(id) on delete cascade,
 widget_order text[] not null default array['teaching_day','activity','contracts','files','followups'],
 hidden_widgets text[] not null default '{}',
 version integer not null default 0 check(version>=0),
 updated_at timestamptz not null default now()
);
alter table private.dashboard_preferences enable row level security;
revoke all on private.dashboard_preferences from public,anon,authenticated;

create function private.dashboard_preferences() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not private.actor_active() then raise exception 'Active account required' using errcode='42501';end if;
 select jsonb_build_object('widget_order',p.widget_order,'hidden_widgets',p.hidden_widgets,'version',p.version)
 into result from private.dashboard_preferences p where p.user_id=auth.uid();
 return coalesce(result,jsonb_build_object('widget_order',array['teaching_day','activity','contracts','files','followups'],'hidden_widgets',array[]::text[],'version',0));
end;$$;
create function public.dashboard_preferences() returns jsonb language sql stable security invoker set search_path='' as $$select private.dashboard_preferences();$$;

create function private.save_dashboard_preferences(p_payload jsonb,p_expected_version integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p private.dashboard_preferences; ordering text[]; hidden text[];
 allowed text[]:=array['teaching_day','activity','contracts','files','followups'];
begin
 if not private.actor_active() then raise exception 'Active account required' using errcode='42501';end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or (select count(*) from jsonb_object_keys(p_payload))<>2
 or jsonb_typeof(p_payload->'widget_order') is distinct from 'array' or jsonb_typeof(p_payload->'hidden_widgets') is distinct from 'array'
 or exists(select 1 from jsonb_each(p_payload) x where x.key not in('widget_order','hidden_widgets'))
 or exists(select 1 from jsonb_array_elements(p_payload->'widget_order') x where jsonb_typeof(x)<>'string')
 or exists(select 1 from jsonb_array_elements(p_payload->'hidden_widgets') x where jsonb_typeof(x)<>'string') then
  raise exception 'Invalid dashboard preferences' using errcode='22023';end if;
 ordering:=array(select jsonb_array_elements_text(p_payload->'widget_order'));
 hidden:=array(select jsonb_array_elements_text(p_payload->'hidden_widgets'));
 if cardinality(ordering)<>5 or not ordering @> allowed or not ordering <@ allowed
 or not hidden <@ allowed or cardinality(hidden)<>(select count(distinct x) from unnest(hidden) x) then
  raise exception 'Invalid dashboard widgets' using errcode='22023';end if;
 insert into private.dashboard_preferences(user_id) values(auth.uid()) on conflict do nothing;
 select * into p from private.dashboard_preferences where user_id=auth.uid() for update;
 if p_expected_version is distinct from p.version then raise exception 'Dashboard changed; reload' using errcode='40001';end if;
 update private.dashboard_preferences set widget_order=ordering,hidden_widgets=hidden,version=version+1,updated_at=now() where user_id=auth.uid();
 return private.dashboard_preferences();
end;$$;
create function public.save_dashboard_preferences(p_payload jsonb,p_expected_version integer) returns jsonb language sql security invoker set search_path='' as $$select private.save_dashboard_preferences(p_payload,p_expected_version);$$;

-- A lecturer's own preparation notes, not a customer-visible completion claim.
create table private.teaching_preparation (
 claim_id uuid primary key references public.job_claims(id) on delete cascade,
 materials_ready boolean not null default false,
 location_ready boolean not null default false,
 contact_ready boolean not null default false,
 version integer not null default 0 check(version>=0),
 updated_at timestamptz not null default now()
);
alter table private.teaching_preparation enable row level security;
revoke all on private.teaching_preparation from public,anon,authenticated;

create function private.teaching_day() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare zone text; day date; begins timestamptz; ends timestamptz; result jsonb;
begin
 if not private.actor_active() then raise exception 'Active account required' using errcode='42501';end if;
 select p.time_zone into zone from public.profiles p where p.id=auth.uid();
 day:=(now() at time zone zone)::date;
 begins:=day::timestamp at time zone zone;ends:=(day+1)::timestamp at time zone zone;
 select coalesce(jsonb_agg(x.item order by x.starts_at,x.id),'[]'::jsonb) into result from (
  select s.starts_at,s.id,jsonb_build_object('id',s.id,'claim_id',c.id,'job_id',j.id,'title',j.title,
   'customer_name',j.customer_name,'starts_at',s.starts_at,'ends_at',s.ends_at,'time_zone',j.time_zone,
   'delivery_type',j.delivery_type,'location',j.location,
   'documents',(select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'name',d.original_name) order by d.created_at,d.id),'[]'::jsonb)
     from (select d.* from public.documents d where d.job_id=j.id and d.kind='material' and d.status='clean'
       and d.deleted_at is null and private.can_access_document(d.id) order by d.created_at,d.id limit 20) d),
   'preparation',jsonb_build_object('materials_ready',coalesce(p.materials_ready,false),'location_ready',coalesce(p.location_ready,false),
    'contact_ready',coalesce(p.contact_ready,false),'version',coalesce(p.version,0))) item
  from public.assignment_sessions s join public.job_claims c on c.id=s.claim_id join public.jobs j on j.id=c.job_id
   left join private.teaching_preparation p on p.claim_id=c.id
  where c.lecturer_id=auth.uid() and s.lecturer_id=auth.uid() and c.status='confirmed' and s.released_at is null
   and s.starts_at<ends and s.ends_at>begins and private.can_read_job(j.id)
  order by s.starts_at,s.id limit 100
 ) x;
 return jsonb_build_object('day',day,'time_zone',zone,'sessions',result);
end;$$;
create function public.teaching_day() returns jsonb language sql stable security invoker set search_path='' as $$select private.teaching_day();$$;

create function private.save_teaching_preparation(p_claim_id uuid,p_item text,p_done boolean,p_expected_version integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p private.teaching_preparation;
begin
 if not private.actor_active() then raise exception 'Active account required' using errcode='42501';end if;
 if p_item is null or p_item not in('materials_ready','location_ready','contact_ready') or p_done is null then
  raise exception 'Invalid preparation item' using errcode='22023';end if;
 -- Lock the accepted assignment before its personal checklist. Cancellation
 -- cannot interleave with a successful checklist write on a stale assignment.
 perform 1 from public.job_claims c where c.id=p_claim_id and c.lecturer_id=auth.uid() and c.status='confirmed'
  and exists(select 1 from public.assignment_sessions s where s.claim_id=c.id and s.lecturer_id=auth.uid() and s.released_at is null)
  for update;
 if not found then raise exception 'Own confirmed assignment required' using errcode='42501';end if;
 insert into private.teaching_preparation(claim_id) values(p_claim_id) on conflict do nothing;
 select * into p from private.teaching_preparation where claim_id=p_claim_id for update;
 if p_expected_version is distinct from p.version then raise exception 'Preparation changed; reload' using errcode='40001';end if;
 update private.teaching_preparation set materials_ready=case when p_item='materials_ready' then p_done else materials_ready end,
  location_ready=case when p_item='location_ready' then p_done else location_ready end,
  contact_ready=case when p_item='contact_ready' then p_done else contact_ready end,
  version=version+1,updated_at=now() where claim_id=p_claim_id returning * into p;
 return jsonb_build_object('materials_ready',p.materials_ready,'location_ready',p.location_ready,'contact_ready',p.contact_ready,'version',p.version);
end;$$;
create function public.save_teaching_preparation(p_claim_id uuid,p_item text,p_done boolean,p_expected_version integer) returns jsonb language sql security invoker set search_path='' as $$select private.save_teaching_preparation(p_claim_id,p_item,p_done,p_expected_version);$$;

revoke execute on function private.dashboard_preferences(),public.dashboard_preferences(),private.save_dashboard_preferences(jsonb,integer),public.save_dashboard_preferences(jsonb,integer),private.teaching_day(),public.teaching_day(),private.save_teaching_preparation(uuid,text,boolean,integer),public.save_teaching_preparation(uuid,text,boolean,integer) from public,anon,authenticated;
grant execute on function private.dashboard_preferences(),public.dashboard_preferences(),private.save_dashboard_preferences(jsonb,integer),public.save_dashboard_preferences(jsonb,integer),private.teaching_day(),public.teaching_day(),private.save_teaching_preparation(uuid,text,boolean,integer),public.save_teaching_preparation(uuid,text,boolean,integer) to authenticated;
commit;
