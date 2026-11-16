begin;
alter table public.global_events add column description text not null default '',add column link_url text not null default '',add column archived_at timestamptz,add column version integer not null default 1 check(version>0),add column updated_at timestamptz not null default clock_timestamp();
create index global_events_range on public.global_events(starts_at,id) where published and archived_at is null;
create index global_events_admin_cursor on public.global_events(updated_at desc,id desc);
create table private.global_event_requests(actor_id uuid not null references public.profiles(id) on delete cascade,request_id uuid not null,payload jsonb not null,result jsonb not null,primary key(actor_id,request_id));
alter table private.global_event_requests enable row level security;
revoke all on private.global_event_requests from public,anon,authenticated;
create function private.valid_global_event_link(p_url text) returns boolean language plpgsql immutable set search_path='' as $$
declare host text;
begin
 if p_url is null or length(p_url)>2000 then return false;end if;
 if p_url='' then return true;end if;
 if p_url ~ '[[:space:][:cntrl:]\\]' or p_url !~ '^https://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{1,5})?([/?#].*)?$' then return false;end if;
 host=substring(p_url from '^https://([^/:?#]+)');
 if length(host)>253 or exists(select 1 from unnest(string_to_array(host,'.')) label where length(label) not between 1 and 63 or label !~ '^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?$') then return false;end if;
 if host ~ '^[0-9.]+$' then
  if host !~ '^[0-9]{1,3}(\.[0-9]{1,3}){3}$' then return false;end if;
  begin perform host::inet;exception when others then return false;end;
 end if;
 return substring(p_url from '^https://[^/:?#]+:([0-9]+)') is null or substring(p_url from '^https://[^/:?#]+:([0-9]+)')::integer between 1 and 65535;
end;$$;
-- Ordinary direct reads keep the original publication policy and additionally
-- exclude archives; management has no access to anybody's personal events.
alter policy global_read on public.global_events using((select private.actor_active()) and ((published and archived_at is null) or (select private.has_permission('courses.manage'))));
create function private.global_calendar_events(p_from timestamptz,p_to timestamptz,p_manage boolean default false,p_search text default '',p_before_at timestamptz default null,p_before_id uuid default null,p_limit int default 50) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare items jsonb;more boolean;cursor jsonb;
begin
 if not private.actor_active() or p_manage is null or (p_manage and not private.has_permission('courses.manage')) then raise exception 'Calendar access denied' using errcode='42501';end if;
 if p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to) or p_to<=p_from or p_to-p_from>interval '93 days' or p_search is null or length(p_search)>160 or p_limit is null or p_limit not between 1 and 100 or (p_before_at is null)<>(p_before_id is null) or (p_before_at is not null and not isfinite(p_before_at)) then raise exception 'Invalid calendar range or page' using errcode='22023';end if;
 with chosen as(select e.*,row_number() over(order by updated_at desc,id desc) rn from public.global_events e where e.starts_at<p_to and e.ends_at>p_from and (p_manage or(e.published and e.archived_at is null)) and strpos(lower(e.title||' '||e.description),lower(p_search))>0 and (p_before_at is null or(e.updated_at,e.id)<(p_before_at,p_before_id)) order by updated_at desc,id desc limit p_limit+1)
 select coalesce(jsonb_agg(to_jsonb(chosen)-'rn' order by rn) filter(where rn<=p_limit),'[]'),coalesce(bool_or(rn>p_limit),false),(jsonb_agg(jsonb_build_object('at',updated_at,'id',id) order by rn) filter(where rn<=p_limit))->(least(p_limit,count(*) filter(where rn<=p_limit))::int-1) into items,more,cursor from chosen;
 return jsonb_build_object('items',items,'has_more',more,'next_cursor',case when more then cursor end);
end;$$;
create function public.global_calendar_events(p_from timestamptz,p_to timestamptz,p_manage boolean default false,p_search text default '',p_before_at timestamptz default null,p_before_id uuid default null,p_limit int default 50) returns jsonb language sql stable security invoker set search_path='' as $$select private.global_calendar_events(p_from,p_to,p_manage,p_search,p_before_at,p_before_id,p_limit);$$;
create function private.manage_global_event(p_id uuid,p_action text,p_expected_version int,p_request_id uuid,p_payload jsonb default '{}') returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare e public.global_events;previous private.global_event_requests;parameters jsonb;starts timestamptz;ends timestamptz;k text;result jsonb;
begin
 perform 1 from public.profiles where id=auth.uid() for share;
 if not found or not private.has_permission('courses.manage') then raise exception 'Calendar management and MFA required' using errcode='42501';end if;
 if p_action is null or p_action not in('save','publish','unpublish','archive','recover') or p_expected_version is null or p_expected_version<0 or p_request_id is null or jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Invalid calendar operation' using errcode='22023';end if;
 parameters=jsonb_build_object('id',p_id,'action',p_action,'version',p_expected_version,'payload',p_payload);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('global-event:'||auth.uid()::text||p_request_id::text,0));
 select * into previous from private.global_event_requests where actor_id=auth.uid() and request_id=p_request_id;
 if found then if previous.payload<>parameters then raise exception 'Calendar request conflict' using errcode='22023';end if;return previous.result;end if;
 if p_id is null and(p_action<>'save' or p_expected_version<>0) then raise exception 'Create a draft first' using errcode='22023';end if;
 if p_id is not null then select * into e from public.global_events where id=p_id for update;
  if not found then raise exception 'Calendar event unavailable' using errcode='42501';end if;
  if e.version<>p_expected_version then raise exception 'Calendar event changed; reload' using errcode='40001';end if;
 end if;
 if p_action='save' then
  if e.archived_at is not null then raise exception 'Recover before editing' using errcode='22023';end if;
  if(select count(*) from jsonb_object_keys(p_payload))<>6 or exists(select 1 from jsonb_object_keys(p_payload) key where key not in('title','description','link_url','starts_at','ends_at','time_zone')) then raise exception 'Invalid event fields' using errcode='22023';end if;
  foreach k in array array['title','description','link_url','starts_at','ends_at','time_zone'] loop if jsonb_typeof(p_payload->k) is distinct from 'string' then raise exception 'Event strings required' using errcode='22023';end if;end loop;
  if length(trim(p_payload->>'title')) not between 1 and 200 or length(p_payload->>'description')>8000 or not private.valid_global_event_link(p_payload->>'link_url') or not exists(select 1 from pg_catalog.pg_timezone_names where name=p_payload->>'time_zone') or p_payload->>'starts_at' !~ '^[0-9]{4}-' or p_payload->>'ends_at' !~ '^[0-9]{4}-' or p_payload->>'starts_at' !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' or p_payload->>'ends_at' !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' then raise exception 'Invalid event content or zone' using errcode='22023';end if;
  begin starts=(p_payload->>'starts_at')::timestamptz;ends=(p_payload->>'ends_at')::timestamptz;exception when others then raise exception 'Invalid instants' using errcode='22023';end;
  if not isfinite(starts) or not isfinite(ends) or ends<=starts then raise exception 'Invalid event interval' using errcode='22023';end if;
  if p_id is null then insert into public.global_events(title,description,link_url,starts_at,ends_at,time_zone) values(trim(p_payload->>'title'),p_payload->>'description',p_payload->>'link_url',starts,ends,p_payload->>'time_zone') returning * into e;
  else update public.global_events set title=trim(p_payload->>'title'),description=p_payload->>'description',link_url=p_payload->>'link_url',starts_at=starts,ends_at=ends,time_zone=p_payload->>'time_zone',published=false,version=version+1,updated_at=clock_timestamp() where id=p_id returning * into e;end if;
 else
  if p_payload<>'{}' then raise exception 'Unexpected payload' using errcode='22023';end if;
  if p_action in('publish','unpublish') and e.archived_at is not null then raise exception 'Recover archived event first' using errcode='22023';end if;
  if p_action='publish' and(length(trim(e.title)) not between 1 and 200 or length(e.description)>8000 or not isfinite(e.starts_at) or not isfinite(e.ends_at) or e.ends_at<=e.starts_at or not private.valid_global_event_link(e.link_url) or not exists(select 1 from pg_catalog.pg_timezone_names where name=e.time_zone)) then raise exception 'Invalid legacy event; edit first' using errcode='22023';end if;
  if (p_action='publish' and e.published) or(p_action='unpublish' and not e.published) or(p_action='archive' and e.archived_at is not null) or(p_action='recover' and e.archived_at is null) then raise exception 'Event state changed; reload' using errcode='40001';end if;
  update public.global_events set published=(p_action='publish'),archived_at=case when p_action='archive' then clock_timestamp() when p_action='recover' then null else archived_at end,version=version+1,updated_at=clock_timestamp() where id=e.id returning * into e;
 end if;
 result=to_jsonb(e);
 insert into private.global_event_requests(actor_id,request_id,payload,result) values(auth.uid(),p_request_id,parameters,result);
 insert into public.audit_events(actor_id,action,resource_id) values(auth.uid(),'calendar.global_'||p_action,e.id);
 return result;
end;$$;
create function public.manage_global_event(p_id uuid,p_action text,p_expected_version int,p_request_id uuid,p_payload jsonb default '{}') returns jsonb language sql volatile security invoker set search_path='' as $$select private.manage_global_event(p_id,p_action,p_expected_version,p_request_id,p_payload);$$;
revoke all on function private.valid_global_event_link(text) from public,anon,authenticated;
revoke all on function private.global_calendar_events(timestamptz,timestamptz,boolean,text,timestamptz,uuid,int),public.global_calendar_events(timestamptz,timestamptz,boolean,text,timestamptz,uuid,int),private.manage_global_event(uuid,text,int,uuid,jsonb),public.manage_global_event(uuid,text,int,uuid,jsonb) from public,anon;
grant execute on function private.global_calendar_events(timestamptz,timestamptz,boolean,text,timestamptz,uuid,int),public.global_calendar_events(timestamptz,timestamptz,boolean,text,timestamptz,uuid,int),private.manage_global_event(uuid,text,int,uuid,jsonb),public.manage_global_event(uuid,text,int,uuid,jsonb) to authenticated;
create or replace function private.admin_audit_actions() returns text[] language sql immutable set search_path='' as $$
 select array[
 'account.roles_changed','user.activated','user.deactivated','invitation.reserved','invitation.sent','invitation.failed','qualification.attested',
 'client.membership_added','client.membership_removed','client.request_submitted','client.request_published','client.request_cancelled','organisation.saved','organisation.contact.saved',
 'course.template.saved','course.template.duplicated','course.run.saved','course.run.duplicated','course.visibility.changed','course.run_offer_created','course.enrolment.changed',
 'job.created.draft','job.created.published','job.created.archived','job.status.draft','job.status.published','job.status.archived','job.commission_configured',
 'job.lifecycle.draft','job.lifecycle.published','job.lifecycle.archived','job.lifecycle.reopen','job.lifecycle.edit','job.lifecycle.duplicate','job.capacity_created','job.capacity_changed','claim.cancelled',
 'taxonomy.created','taxonomy.updated','taxonomy.archived','taxonomy.restored','announcement.draft_saved','announcement.published','announcement.archived','announcement.recovered','calendar.global_save','calendar.global_publish','calendar.global_unpublish','calendar.global_archive','calendar.global_recover'
 ]::text[];
$$;

revoke all on function private.admin_audit_actions() from public,anon,authenticated;
commit;
