-- Unified search reuses each resource ACL; no administrator-wide private index.
begin;
-- Encode UTF-8 bytes without changing the exact authored filename/query.
create function private.search_url_component(p_text text) returns text language sql immutable set search_path='' as $$
 select coalesce(string_agg(case when b between 48 and 57 or b between 65 and 90 or b between 97 and 122 or b in(45,46,95,126) then chr(b) else '%'||upper(lpad(to_hex(b),2,'0')) end,'' order by pos),'')
 from(select pos,get_byte(convert_to(p_text,'UTF8'),pos) b from generate_series(0,octet_length(convert_to(p_text,'UTF8'))-1) pos) bytes;
$$;
-- Bound and keyset-page the UNION on the server, beyond REST row limits.
-- The authenticated identity is authoritative; no caller user/role is accepted.
create function private.unified_search(p_query text,p_kind text default '',p_after_kind text default null,p_after_title text default null,p_after_id uuid default null,p_limit integer default 40)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare items jsonb;
begin
 if not private.actor_active() then raise exception 'Active account required' using errcode='42501';end if;
 if p_query is null or length(trim(p_query)) not between 2 and 100 or p_kind is null or p_kind not in('','jobs','files','wiki','forum','chats','people','courses','clients','tasks','contracts','finance')
 or p_limit is null or p_limit not between 1 and 80 or (p_after_kind is null)<>(p_after_title is null) or (p_after_kind is null)<>(p_after_id is null) or length(p_after_title)>1000 then raise exception 'Invalid search page' using errcode='22023';end if;
 p_query=lower(trim(p_query));
 with available as (
  select j.id,'jobs'::text kind,j.title,j.customer_name detail,'/jobs/'||j.id url from public.jobs j
   where private.can_read_job(j.id) and position(p_query in lower(j.title||' '||j.description||' '||j.customer_name))>0
  union all
  select d.id,'files',d.original_name,''::text,'/files?q='||private.search_url_component(d.original_name) from public.documents d
   where d.deleted_at is null and d.status='clean' and private.can_access_document(d.id) and position(p_query in lower(d.original_name))>0
  union all
  select p.id,'wiki',r.title,r.locale,'/wiki?page='||p.id from public.wiki_pages p join public.wiki_revisions r on r.page_id=p.id and r.version=case when p.owner_id=auth.uid() or private.has_permission('wiki.manage') then p.current_version else p.published_version end
   where not p.archived and private.can_read_wiki(p.id) and position(p_query in lower(r.title||' '||r.content_text))>0
  union all
  select t.id,'forum',t.title,''::text,'/forum?thread='||t.id from public.forum_threads t
   where not t.archived and private.can_read_forum(t.id) and (position(p_query in lower(t.title))>0 or exists(select 1 from public.forum_posts p where p.thread_id=t.id and p.deleted_at is null and position(p_query in lower(p.content_text))>0))
  union all
  select m.id,'chats',left(m.body,150),''::text,'/chats?room='||m.room_id from public.messages m
   where m.deleted_at is null and private.can_access_chat_room(m.room_id) and position(p_query in lower(m.body))>0
  union all
  select p.id,'people',p.display_name,''::text,'/people/'||p.id from public.profiles p
   where private.profile_staff(p.id) and private.can_read_person(p.id) and position(p_query in lower(p.display_name||' '||p.bio_de||' '||p.bio_en))>0
  union all
  select r.id,'courses',t.title,coalesce(o.name,''),case when private.has_permission('courses.manage') or private.client_has_organisation(r.organisation_id) or exists(select 1 from public.course_enrolments e where e.course_run_id=r.id and e.user_id=auth.uid() and e.status in('enrolled','completed')) or exists(select 1 from public.jobs j join public.job_claims c on c.job_id=j.id where j.course_run_id=r.id and c.lecturer_id=auth.uid() and c.status='confirmed') then '/courses/'||r.id||'/workspace' else '/courses?run='||r.id end
   from public.course_runs r join public.course_templates t on t.id=r.template_id left join public.organisations o on o.id=r.organisation_id
   where r.archived_at is null and (private.can_read_course_run(r.id) or private.client_has_organisation(r.organisation_id) or exists(select 1 from public.course_enrolments e where e.course_run_id=r.id and e.user_id=auth.uid() and e.status in('enrolled','completed')))
    and position(p_query in lower(t.title||' '||t.description||' '||coalesce(o.name,'')))>0
  union all
  select o.id,'clients',o.name,''::text,case when private.has_permission('organisations.manage') then '/clients' when private.client_has_organisation(o.id) then '/client' else '/courses' end from public.organisations o
   where private.favourite_resource('organisation',o.id) is not null and position(p_query in lower(o.name))>0
  union all
  select t.id,'tasks',t.title,t.state,'/workbench?task='||t.id from private.work_tasks t
   where private.can_read_work_task(t.id) and position(p_query in lower(t.title||' '||t.description))>0
  union all
  select c.id,'contracts',c.title,''::text,'/contracts' from public.contracts c
   where (c.user_id=auth.uid() or private.has_permission('contracts.read') or private.has_permission('contracts.manage')) and position(p_query in lower(c.title))>0
  union all
  select i.id,'finance',i.number,i.currency,'/finance' from public.invoices i
   where private.can_read_invoice(i.id) and position(p_query in lower(i.number))>0
 ), page as (
 select * from available a where (p_kind='' or a.kind=p_kind)
  and (p_after_kind is null or (a.kind,lower(a.title),a.id)>(p_after_kind,p_after_title,p_after_id))
  order by a.kind,lower(a.title),a.id limit p_limit+1
 ) select coalesce(jsonb_agg(jsonb_build_object('id',id,'kind',kind,'title',title,'detail',detail,'url',url) order by kind,lower(title),id),'[]'::jsonb) into items from page;
 return jsonb_build_object('items',case when jsonb_array_length(items)>p_limit then items- p_limit else items end,'has_more',jsonb_array_length(items)>p_limit,
  'next_cursor',case when jsonb_array_length(items)>p_limit then jsonb_build_object('kind',items->(p_limit-1)->>'kind','title',lower(items->(p_limit-1)->>'title'),'id',items->(p_limit-1)->>'id') else null end);
end;$$;
-- The public API is an invoker wrapper; only the private implementation elevates.
create function public.unified_search(p_query text,p_kind text default '',p_after_kind text default null,p_after_title text default null,p_after_id uuid default null,p_limit integer default 40)
returns jsonb language sql stable security invoker set search_path='' as $$select private.unified_search(p_query,p_kind,p_after_kind,p_after_title,p_after_id,p_limit);$$;
revoke all on function private.unified_search(text,text,text,text,uuid,integer),public.unified_search(text,text,text,text,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function private.unified_search(text,text,text,text,uuid,integer),public.unified_search(text,text,text,text,uuid,integer) to authenticated;
revoke all on function private.search_url_component(text) from public,anon,authenticated,service_role;
commit;
