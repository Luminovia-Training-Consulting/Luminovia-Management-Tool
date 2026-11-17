begin;

-- A per-actor display preference, never a deletion of the shared message or file.
create table private.chat_hidden_messages (
 user_id uuid not null references public.profiles(id) on delete cascade,
 message_id uuid not null references public.messages(id) on delete cascade,
 created_at timestamptz not null default clock_timestamp(),
 primary key(user_id,message_id)
);
create index chat_hidden_messages_message_idx on private.chat_hidden_messages(message_id);
alter table private.chat_hidden_messages enable row level security;
revoke all on private.chat_hidden_messages from public,anon,authenticated;
alter table public.chat_members add column hidden_generation bigint not null default 0;

create function private.chat_message_hidden(p_message_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.chat_hidden_messages h where h.user_id=auth.uid() and h.message_id=p_message_id);
$$;
revoke all on function private.chat_message_hidden(uuid) from public,anon;
grant execute on function private.chat_message_hidden(uuid) to authenticated;

drop policy messages_read on public.messages;
create policy messages_read on public.messages for select to authenticated
 using (private.can_access_chat_room(room_id) and not private.chat_message_hidden(id));

create function private.hide_chat_message(p_message_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare room uuid; inserted int;
begin
 select m.room_id into room from public.messages m where m.id=p_message_id;
 if room is null then raise exception 'Message access denied' using errcode='42501'; end if;
 -- The membership row serializes this change against member removal and sends
 -- the already protected per-actor Realtime invalidation to other sessions.
 perform 1 from public.chat_members cm where cm.room_id=room and cm.user_id=auth.uid() for update;
 if not found or not private.can_access_chat_room(room) then
  raise exception 'Message access denied' using errcode='42501';
 end if;
 insert into private.chat_hidden_messages(user_id,message_id) values(auth.uid(),p_message_id) on conflict do nothing;
 get diagnostics inserted = row_count;
 if inserted>0 then update public.chat_members set hidden_generation=hidden_generation+1 where room_id=room and user_id=auth.uid(); end if;
end;$$;
create function public.hide_chat_message(p_message_id uuid) returns void
language sql security invoker set search_path='' as $$select private.hide_chat_message(p_message_id);$$;
revoke all on function private.hide_chat_message(uuid), public.hide_chat_message(uuid) from public,anon;
grant execute on function private.hide_chat_message(uuid), public.hide_chat_message(uuid) to authenticated;

-- Filter before LIMIT so hidden records do not cause missing pages or search hits.
create or replace function private.chat_messages(p_room_id uuid,p_before_at timestamptz default null,p_before_id uuid default null,p_search text default '',p_limit int default 50)
returns table(id uuid,room_id uuid,sender_id uuid,sender_name text,body text,document_id uuid,created_at timestamptz,edited_at timestamptz,deleted_at timestamptz,reactions jsonb)
language plpgsql stable security definer set search_path='' as $$
begin
 if not private.can_access_chat_room(p_room_id) then raise exception 'Room access denied' using errcode='42501'; end if;
 if p_limit not between 1 and 100 or p_limit is null or length(coalesce(p_search,''))>200 then raise exception 'Invalid page' using errcode='22023'; end if;
 if (p_before_at is null)<>(p_before_id is null) then raise exception 'Complete cursor required' using errcode='22023'; end if;
 return query select m.id,m.room_id,m.sender_id,p.display_name,m.body,m.document_id,m.created_at,m.edited_at,m.deleted_at,
 coalesce((select jsonb_agg(jsonb_build_object('emoji',r.emoji,'count',r.n,'mine',r.mine) order by r.emoji) from
 (select mr.emoji,count(*) n,bool_or(mr.user_id=auth.uid()) mine from public.message_reactions mr where mr.message_id=m.id and mr.removed_at is null group by mr.emoji) r),'[]'::jsonb)
 from public.messages m join public.profiles p on p.id=m.sender_id
 where m.room_id=p_room_id and not exists(select 1 from private.chat_hidden_messages h where h.user_id=auth.uid() and h.message_id=m.id)
 and (p_before_at is null or (m.created_at,m.id)<(p_before_at,p_before_id))
 and (coalesce(p_search,'')='' or (m.deleted_at is null and strpos(lower(m.body),lower(p_search))>0))
 order by m.created_at desc,m.id desc limit p_limit;
end;$$;

-- Do not count a personally hidden message as unread.
create or replace function private.chat_rooms_list() returns table(id uuid,kind text,title text,job_id uuid,owner_id uuid,unread_count bigint,last_message_at timestamptz,muted boolean) language sql stable security definer set search_path='' as $$
 select r.id,r.kind,case when r.kind='dm' then coalesce((select p.display_name from public.chat_members other join public.profiles p on p.id=other.user_id where other.room_id=r.id and other.user_id<>auth.uid() limit 1),'') else coalesce(nullif(r.title,''),j.title,'') end,
 r.job_id,r.owner_id,
 (select count(*) from public.messages msg where msg.room_id=r.id and msg.sender_id<>auth.uid() and msg.deleted_at is null and (msg.created_at,msg.id)>(me.last_read_at,me.last_read_message_id) and not exists(select 1 from private.chat_hidden_messages h where h.user_id=auth.uid() and h.message_id=msg.id)),
 (select max(msg.created_at) from public.messages msg where msg.room_id=r.id),me.muted
 from public.chat_rooms r join public.chat_members me on me.room_id=r.id and me.user_id=auth.uid() and me.removed_at is null left join public.jobs j on j.id=r.job_id
 where private.can_access_chat_room(r.id) order by coalesce((select max(msg.created_at) from public.messages msg where msg.room_id=r.id),r.created_at) desc,r.id;
$$;

-- Existing permanent-deletion previews must include these cascade rows in the
-- reviewed scope and hash for both actors and their shared message/room roots.
alter function private.deletion_scope(text,uuid) rename to deletion_scope_before_chat_hiding;
create function private.deletion_scope(p_kind text,p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb:=private.deletion_scope_before_chat_hiding(p_kind,p_id); pred text;
begin
 if p_kind='account' then pred=format('x.user_id=%L::uuid',p_id);
 elsif p_kind='message' then pred=format('x.message_id=%L::uuid',p_id);
 elsif p_kind='chat_room' then pred=format('x.message_id in(select id from public.messages where room_id=%L::uuid)',p_id);
 end if;
 if pred is not null then result=private.deletion_add_scope(result,'private.chat_hidden_messages',pred); end if;
 return result;
end;$$;
revoke all on function private.deletion_scope_before_chat_hiding(text,uuid),private.deletion_scope(text,uuid) from public,anon,authenticated;

-- Security-definer search must enforce personal visibility before paging;
-- CREATE OR REPLACE preserves its signature, owner and existing grants.
create or replace function private.unified_search(p_query text,p_kind text default '',p_after_kind text default null,p_after_title text default null,p_after_id uuid default null,p_limit integer default 40)
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
   where m.deleted_at is null and private.can_access_chat_room(m.room_id) and not private.chat_message_hidden(m.id) and position(p_query in lower(m.body))>0
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
commit;
