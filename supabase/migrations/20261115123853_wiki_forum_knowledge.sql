begin;
-- Knowledge is staff-only until explicit participant/course ACLs are implemented.
-- Publishing and moderation are distinct MFA-protected capabilities, not role hierarchy.
insert into public.role_permissions(role,permission) values('admin','wiki.manage'),('management','wiki.manage'),('admin','forum.moderate'),('management','forum.moderate') on conflict do nothing;
create function private.knowledge_staff() returns boolean language sql stable security definer set search_path='' as $$ select private.chat_staff(auth.uid()); $$;
create function private.knowledge_access() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('can_author',private.knowledge_staff(),'can_publish_wiki',private.has_permission('wiki.manage'),'can_moderate_forum',private.has_permission('forum.moderate'));
$$;
create function public.knowledge_access() returns jsonb language sql stable security invoker set search_path='' as $$ select private.knowledge_access(); $$;

-- A closed Tiptap JSON vocabulary. Raw HTML/images/scripts/custom node attributes
-- are rejected; searchable text is derived by the server from the validated tree.
create function private.validate_knowledge_node(p_node jsonb,p_depth int default 0) returns table(plain_text text,node_count int) language plpgsql immutable set search_path='' as $$
declare kind text:=p_node->>'type'; attrs jsonb:=coalesce(p_node->'attrs','{}'); child jsonb; mark jsonb; k text; href text; child_text text; child_count int; total int:=1; result text:=''; child_kind text;
begin
 if p_depth>16 or jsonb_typeof(p_node)<>'object' or (p_depth=0 and kind is distinct from 'doc') or (p_depth>0 and kind='doc')
 or kind is null or kind not in ('doc','paragraph','text','heading','bulletList','orderedList','listItem','blockquote','codeBlock','hardBreak','horizontalRule') then raise exception 'Unsupported document structure' using errcode='22023'; end if;
 if p_depth=0 and octet_length(p_node::text)>200000 then raise exception 'Document is too large' using errcode='22023'; end if;
 for k in select jsonb_object_keys(p_node) loop
  if k not in ('type','attrs','marks','content','text') then raise exception 'Unsupported document property' using errcode='22023'; end if;
 end loop;
 if jsonb_typeof(attrs)<>'object' then raise exception 'Invalid node attributes' using errcode='22023'; end if;
 for k in select jsonb_object_keys(attrs) loop
  if not ((kind='heading' and k='level') or (kind='codeBlock' and k='language') or (kind='orderedList' and k in ('start','type'))) then raise exception 'Unsupported node attribute' using errcode='22023'; end if;
 end loop;
 if kind='heading' and (jsonb_typeof(attrs->'level') is distinct from 'number' or (attrs->>'level') not in ('1','2','3')) then raise exception 'Invalid heading level' using errcode='22023'; end if;
 if kind='codeBlock' and attrs->>'language' is not null and (attrs->>'language')!~'^[a-zA-Z0-9_+-]{0,30}$' then raise exception 'Invalid code language' using errcode='22023'; end if;
 if kind='orderedList' then
  if attrs?'start' and (jsonb_typeof(attrs->'start') is distinct from 'number' or (attrs->>'start')!~'^[0-9]{1,7}$' or (attrs->>'start')::int not between 1 and 1000000) then raise exception 'Invalid list start' using errcode='22023'; end if;
  if attrs->>'type' is not null and (attrs->>'type') not in ('1','a','A','i','I') then raise exception 'Invalid list type' using errcode='22023'; end if;
 end if;
 if p_node?'marks' then
  if jsonb_typeof(p_node->'marks')<>'array' or jsonb_array_length(p_node->'marks')>6 or (kind<>'text' and jsonb_array_length(p_node->'marks')>0) then raise exception 'Invalid text marks' using errcode='22023'; end if;
  for mark in select value from jsonb_array_elements(p_node->'marks') loop
   if jsonb_typeof(mark)<>'object' or mark->>'type' is null or mark->>'type' not in ('bold','italic','underline','strike','code','link') then raise exception 'Unsupported text mark' using errcode='22023'; end if;
   for k in select jsonb_object_keys(mark) loop if k not in ('type','attrs') then raise exception 'Unsupported mark property' using errcode='22023'; end if; end loop;
   if mark->>'type'='link' then
    if jsonb_typeof(mark->'attrs') is distinct from 'object' then raise exception 'Link attributes required' using errcode='22023'; end if;
    href=mark->'attrs'->>'href';
    if href is null or length(href)>2000 or href<>trim(href) or href~'[[:cntrl:]]' or strpos(href,chr(92))>0 or not (href~*'^(https?://|mailto:)' or href='/' or href~'^/[^/]') then raise exception 'Unsafe link protocol' using errcode='22023'; end if;
    for k in select jsonb_object_keys(mark->'attrs') loop if k not in ('href','target','rel','class') then raise exception 'Unsupported link attribute' using errcode='22023'; end if; end loop;
    if (mark->'attrs'->>'class') is not null or coalesce(mark->'attrs'->>'target','_blank') not in ('_blank','_self') or coalesce(mark->'attrs'->>'rel','noopener noreferrer nofollow') not in ('noopener noreferrer nofollow','noopener noreferrer') then raise exception 'Unsafe link attributes' using errcode='22023'; end if;
   elsif mark?'attrs' and mark->'attrs'<>'{}'::jsonb then raise exception 'Unsupported text attributes' using errcode='22023'; end if;
  end loop;
 end if;
 if kind='text' then
  if jsonb_typeof(p_node->'text') is distinct from 'string' or p_node?'content' then raise exception 'Text node required' using errcode='22023'; end if;
  result=p_node->>'text';
 else
  if p_node?'text' then raise exception 'Invalid block text' using errcode='22023'; end if;
  if p_node?'content' then
   if jsonb_typeof(p_node->'content')<>'array' or (kind in ('hardBreak','horizontalRule') and jsonb_array_length(p_node->'content')>0) then raise exception 'Invalid child nodes' using errcode='22023'; end if;
   if kind='listItem' and jsonb_array_length(p_node->'content')>0 and p_node->'content'->0->>'type'<>'paragraph' then raise exception 'List item must start with a paragraph' using errcode='22023'; end if;
   for child in select value from jsonb_array_elements(p_node->'content') loop
    child_kind=child->>'type';
    if (kind in ('doc','blockquote','listItem') and child_kind not in ('paragraph','heading','bulletList','orderedList','blockquote','codeBlock','horizontalRule'))
    or (kind in ('paragraph','heading') and child_kind not in ('text','hardBreak'))
    or (kind='codeBlock' and child_kind<>'text') or (kind in ('bulletList','orderedList') and child_kind<>'listItem') then raise exception 'Invalid child structure' using errcode='22023'; end if;
    select x.plain_text,x.node_count into child_text,child_count from private.validate_knowledge_node(child,p_depth+1) x;
    total=total+child_count;result=result||child_text||case when kind in ('doc','blockquote','listItem','bulletList','orderedList') then E'\n' else '' end;
    if total>1500 or length(result)>40000 then raise exception 'Document limit exceeded' using errcode='22023'; end if;
   end loop;
  end if;
  if kind in ('hardBreak','horizontalRule') then result=E'\n'; end if;
 end if;
 if length(result)>40000 then raise exception 'Document text is too long' using errcode='22023'; end if;
 return query select result,total;
end;$$;
create function private.knowledge_text(p_content jsonb) returns text language sql immutable set search_path='' as $$ select plain_text from private.validate_knowledge_node(p_content,0); $$;

create table public.knowledge_categories (
 id uuid primary key default gen_random_uuid(),kind text not null check(kind in ('wiki','forum')),
 slug text not null check(length(slug)<=80 and slug~'^[a-z0-9]+(-[a-z0-9]+)*$'),
 label_de text not null check(length(trim(label_de)) between 1 and 120),label_en text not null check(length(trim(label_en)) between 1 and 120),
 archived boolean not null default false,unique(kind,slug)
);
insert into public.knowledge_categories(kind,slug,label_de,label_en) values('wiki','general','Allgemeines','General'),('wiki','teaching','Lehrpraxis','Teaching practice'),('forum','general','Austausch','Discussion'),('forum','questions','Fragen und Antworten','Questions and answers');
create table public.wiki_pages (
 id uuid primary key default gen_random_uuid(),owner_id uuid not null references public.profiles(id),
 current_version int not null default 1,published_version int,archived boolean not null default false,
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp()
);
create table public.wiki_revisions (
 id uuid primary key default gen_random_uuid(),page_id uuid not null references public.wiki_pages(id) on delete cascade,version int not null check(version>0),
 title text not null check(length(trim(title)) between 1 and 200),locale text not null check(locale in ('de','en')),category_id uuid not null references public.knowledge_categories(id),
 content jsonb not null,content_text text not null,editor_id uuid not null references public.profiles(id),published boolean not null default false,
 created_at timestamptz not null default clock_timestamp(),unique(page_id,version)
);
alter table public.wiki_pages add constraint wiki_current_revision foreign key(id,current_version) references public.wiki_revisions(page_id,version) deferrable initially deferred;
alter table public.wiki_pages add constraint wiki_published_revision foreign key(id,published_version) references public.wiki_revisions(page_id,version) deferrable initially deferred;
create index wiki_revisions_text on public.wiki_revisions using gin(to_tsvector('simple',title||' '||content_text));
create index wiki_editor_rate on public.wiki_revisions(editor_id,created_at desc);
create function private.can_read_wiki(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.knowledge_staff() and exists(select 1 from public.wiki_pages p where p.id=p_id and (p.owner_id=auth.uid() or private.has_permission('wiki.manage') or (not p.archived and p.published_version is not null)));
$$;

create table public.forum_threads (
 id uuid primary key default gen_random_uuid(),category_id uuid not null references public.knowledge_categories(id),title text not null check(length(trim(title)) between 1 and 200),
 owner_id uuid not null references public.profiles(id),locked boolean not null default false,pinned boolean not null default false,archived boolean not null default false,
 accepted_post_id uuid,created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp()
);
create table public.forum_posts (
 id uuid primary key default gen_random_uuid(),thread_id uuid not null references public.forum_threads(id) on delete cascade,author_id uuid not null references public.profiles(id),
 client_id uuid not null,content jsonb not null,content_text text not null,request_hash text not null,version int not null default 1,
 created_at timestamptz not null default clock_timestamp(),edited_at timestamptz,deleted_at timestamptz,unique(author_id,client_id)
);
alter table public.forum_threads add constraint forum_accepted_post foreign key(accepted_post_id) references public.forum_posts(id) deferrable initially deferred;
create index forum_posts_thread on public.forum_posts(thread_id,created_at,id);
create index forum_posts_author_rate on public.forum_posts(author_id,created_at desc);
create index forum_post_search on public.forum_posts using gin(to_tsvector('simple',content_text));
create table public.forum_post_revisions (
 id uuid primary key default gen_random_uuid(),post_id uuid not null references public.forum_posts(id) on delete cascade,version int not null,
 editor_id uuid not null references public.profiles(id),previous_content jsonb not null,created_at timestamptz not null default clock_timestamp(),unique(post_id,version)
);
create index forum_revision_editor_rate on public.forum_post_revisions(editor_id,created_at desc);
create table public.forum_subscriptions (
 thread_id uuid not null references public.forum_threads(id) on delete cascade,user_id uuid not null references public.profiles(id),primary key(thread_id,user_id)
);
create table public.forum_reports (
 id uuid primary key default gen_random_uuid(),post_id uuid not null references public.forum_posts(id) on delete cascade,reporter_id uuid not null references public.profiles(id),
 reason text not null check(length(trim(reason)) between 5 and 2000),status text not null default 'open' check(status in ('open','resolved')),
 handled_by uuid references public.profiles(id),created_at timestamptz not null default clock_timestamp(),unique(post_id,reporter_id)
);
create index forum_reports_status on public.forum_reports(status,created_at);
create function private.can_read_forum(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.knowledge_staff() and exists(select 1 from public.forum_threads t where t.id=p_id and (not t.archived or t.owner_id=auth.uid() or private.has_permission('forum.moderate')));
$$;

-- No table writes from the browser: all mutation invariants live in audited RPCs.
do $$declare t text;begin
 foreach t in array array['knowledge_categories','wiki_pages','wiki_revisions','forum_threads','forum_posts','forum_post_revisions','forum_subscriptions','forum_reports'] loop
  execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from anon,authenticated',t);execute format('grant select on public.%I to authenticated',t);execute format('grant all on public.%I to service_role',t);
 end loop;
end;$$;
create policy category_read on public.knowledge_categories for select to authenticated using((select private.knowledge_staff()));
create policy wiki_page_read on public.wiki_pages for select to authenticated using(private.can_read_wiki(id));
create policy wiki_revision_read on public.wiki_revisions for select to authenticated using(private.can_read_wiki(page_id) and (published or (select private.has_permission('wiki.manage')) or exists(select 1 from public.wiki_pages p where p.id=page_id and p.owner_id=(select auth.uid()))));
create policy forum_thread_read on public.forum_threads for select to authenticated using(private.can_read_forum(id));
create policy forum_post_read on public.forum_posts for select to authenticated using(private.can_read_forum(thread_id));
create policy forum_post_revision_read on public.forum_post_revisions for select to authenticated using((select private.knowledge_staff()) and ((select private.has_permission('forum.moderate')) or exists(select 1 from public.forum_posts p where p.id=post_id and p.author_id=(select auth.uid()))));
create policy forum_subscriptions_read on public.forum_subscriptions for select to authenticated using((select private.knowledge_staff()) and user_id=(select auth.uid()));
create policy forum_report_read on public.forum_reports for select to authenticated using((select private.knowledge_staff()) and (reporter_id=(select auth.uid()) or (select private.has_permission('forum.moderate'))));

create function private.knowledge_categories(p_kind text) returns table(id uuid,kind text,slug text,label_de text,label_en text,archived boolean) language sql stable security definer set search_path='' as $$
 select c.id,c.kind,c.slug,c.label_de,c.label_en,c.archived from public.knowledge_categories c where private.knowledge_staff() and c.kind=p_kind and (not c.archived or private.has_permission(case when p_kind='wiki' then 'wiki.manage' else 'forum.moderate' end)) order by c.label_de,c.id;
$$;
create function public.knowledge_categories(p_kind text) returns table(id uuid,kind text,slug text,label_de text,label_en text,archived boolean) language sql stable security invoker set search_path='' as $$ select * from private.knowledge_categories(p_kind); $$;
create function private.save_knowledge_category(p_id uuid,p_kind text,p_slug text,p_label_de text,p_label_en text,p_archived boolean default false) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
 if p_kind not in ('wiki','forum') or not private.has_permission(case when p_kind='wiki' then 'wiki.manage' else 'forum.moderate' end) then raise exception 'Knowledge management and MFA required' using errcode='42501'; end if;
 if p_id is null then insert into public.knowledge_categories(kind,slug,label_de,label_en,archived) values(p_kind,p_slug,trim(p_label_de),trim(p_label_en),p_archived) returning id into result;
 else update public.knowledge_categories set slug=p_slug,label_de=trim(p_label_de),label_en=trim(p_label_en),archived=p_archived where id=p_id and kind=p_kind returning id into result; if result is null then raise exception 'Category not found' using errcode='22023'; end if; end if;
 insert into public.audit_events(actor_id,action,resource_id) values(auth.uid(),'knowledge.category_saved',result);return result;
end;$$;
create function public.save_knowledge_category(p_id uuid,p_kind text,p_slug text,p_label_de text,p_label_en text,p_archived boolean default false) returns uuid language sql security invoker set search_path='' as $$ select private.save_knowledge_category(p_id,p_kind,p_slug,p_label_de,p_label_en,p_archived); $$;

create function private.wiki_pages_list(p_search text default '',p_locale text default '',p_category_id uuid default null,p_include_archived boolean default false)
returns table(id uuid,title text,locale text,category_id uuid,category_label_de text,category_label_en text,owner_id uuid,owner_name text,status text,version int,published_version int,has_draft boolean,updated_at timestamptz)
language sql stable security definer set search_path='' as $$
 select p.id,r.title,r.locale,r.category_id,c.label_de,c.label_en,p.owner_id,u.display_name,case when p.archived then 'archived' when p.published_version is not null then 'published' else 'draft' end,r.version,p.published_version,
 (p.owner_id=auth.uid() or private.has_permission('wiki.manage')) and p.current_version is distinct from p.published_version,p.updated_at
 from public.wiki_pages p join public.wiki_revisions r on r.page_id=p.id and r.version=case when p.owner_id=auth.uid() or private.has_permission('wiki.manage') then p.current_version else p.published_version end
 join public.knowledge_categories c on c.id=r.category_id join public.profiles u on u.id=p.owner_id
 where private.can_read_wiki(p.id) and (not p.archived or p_include_archived) and (p_category_id is null or r.category_id=p_category_id)
 and (coalesce(p_locale,'')='' or r.locale=p_locale) and (coalesce(p_search,'')='' or strpos(lower(r.title||' '||r.content_text),lower(p_search))>0)
 order by p.updated_at desc,p.id limit 200;
$$;
create function public.wiki_pages_list(p_search text default '',p_locale text default '',p_category_id uuid default null,p_include_archived boolean default false)
returns table(id uuid,title text,locale text,category_id uuid,category_label_de text,category_label_en text,owner_id uuid,owner_name text,status text,version int,published_version int,has_draft boolean,updated_at timestamptz)
language sql stable security invoker set search_path='' as $$ select * from private.wiki_pages_list(p_search,p_locale,p_category_id,p_include_archived); $$;

create function private.wiki_page(p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; revision int;
begin
 if not private.can_read_wiki(p_id) then raise exception 'Wiki access denied' using errcode='42501'; end if;
 select case when p.owner_id=auth.uid() or private.has_permission('wiki.manage') then p.current_version else p.published_version end into revision from public.wiki_pages p where p.id=p_id;
 select jsonb_build_object('id',p.id,'title',r.title,'locale',r.locale,'category_id',r.category_id,'category_label_de',c.label_de,'category_label_en',c.label_en,'owner_id',p.owner_id,'owner_name',u.display_name,'status',case when p.archived then 'archived' when p.published_version is not null then 'published' else 'draft' end,'version',r.version,'published_version',p.published_version,'has_draft',(p.owner_id=auth.uid() or private.has_permission('wiki.manage')) and p.current_version is distinct from p.published_version,'updated_at',p.updated_at,'content',r.content) into result
 from public.wiki_pages p join public.wiki_revisions r on r.page_id=p.id and r.version=revision join public.knowledge_categories c on c.id=r.category_id join public.profiles u on u.id=p.owner_id where p.id=p_id;
 return result;
end;$$;
create function public.wiki_page(p_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$ select private.wiki_page(p_id); $$;

create function private.save_wiki_page(p_id uuid,p_title text,p_locale text,p_category_id uuid,p_content jsonb,p_status text,p_expected_version int default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare page public.wiki_pages; result uuid:=coalesce(p_id,gen_random_uuid()); plain text; next_version int;
begin
 if not private.knowledge_staff() then raise exception 'Staff knowledge access required' using errcode='42501'; end if;
 if p_status not in ('draft','published','archived') or p_status is null or p_title is null or length(trim(p_title)) not between 1 and 200 or p_locale not in ('de','en') or p_locale is null then raise exception 'Invalid wiki metadata' using errcode='22023'; end if;
 if p_status in ('published','archived') and not private.has_permission('wiki.manage') then raise exception 'Wiki publishing and MFA required' using errcode='42501'; end if;
 if not exists(select 1 from public.knowledge_categories where id=p_category_id and kind='wiki' and not archived) then raise exception 'Active wiki category required' using errcode='22023'; end if;
 plain=private.knowledge_text(p_content);
 if plain is null or (p_status='published' and length(trim(plain))=0) then raise exception 'Published wiki content required' using errcode='22023'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('knowledge-author:'||auth.uid()::text,0));
 if (select count(*) from public.wiki_revisions where editor_id=auth.uid() and created_at>clock_timestamp()-interval '1 minute')>=20 then raise exception 'Wiki rate limit reached' using errcode='54000'; end if;
 if p_id is null then
  if p_expected_version is not null then raise exception 'Unexpected new-page version' using errcode='22023'; end if;
  next_version=1;insert into public.wiki_pages(id,owner_id,current_version) values(result,auth.uid(),1) returning * into page;
 else
  select * into page from public.wiki_pages where id=p_id for update;
  if not found or (page.owner_id<>auth.uid() and not private.has_permission('wiki.manage')) then raise exception 'Wiki edit denied' using errcode='42501'; end if;
  if p_expected_version is distinct from page.current_version then raise exception 'Wiki version conflict; reload before saving' using errcode='40001'; end if;
  if page.archived and not private.has_permission('wiki.manage') then raise exception 'Archived wiki edit denied' using errcode='42501'; end if;
  next_version=page.current_version+1;
 end if;
 insert into public.wiki_revisions(page_id,version,title,locale,category_id,content,content_text,editor_id,published) values(result,next_version,trim(p_title),p_locale,p_category_id,p_content,plain,auth.uid(),p_status='published');
 update public.wiki_pages set current_version=next_version,published_version=case when p_status='published' then next_version else published_version end,archived=p_status='archived',updated_at=clock_timestamp() where id=result returning * into page;
 insert into public.audit_events(actor_id,action,resource_id,details) values(auth.uid(),'wiki.revision_saved',result,jsonb_build_object('version',next_version,'published',p_status='published','archived',p_status='archived'));
 return jsonb_build_object('page_id',result,'version',next_version,'published_version',page.published_version);
end;$$;
create function public.save_wiki_page(p_id uuid,p_title text,p_locale text,p_category_id uuid,p_content jsonb,p_status text,p_expected_version int default null) returns jsonb language sql security invoker set search_path='' as $$ select private.save_wiki_page(p_id,p_title,p_locale,p_category_id,p_content,p_status,p_expected_version); $$;
create function private.wiki_page_history(p_id uuid) returns table(version int,title text,locale text,editor_name text,created_at timestamptz,published boolean,content jsonb) language plpgsql stable security definer set search_path='' as $$
begin
 if not private.can_read_wiki(p_id) then raise exception 'Wiki history access denied' using errcode='42501'; end if;
 return query select r.version,r.title,r.locale,p.display_name,r.created_at,r.published,r.content from public.wiki_revisions r join public.profiles p on p.id=r.editor_id join public.wiki_pages page on page.id=r.page_id
 where r.page_id=p_id and (r.published or page.owner_id=auth.uid() or private.has_permission('wiki.manage')) order by r.version desc;
end;$$;
create function public.wiki_page_history(p_id uuid) returns table(version int,title text,locale text,editor_name text,created_at timestamptz,published boolean,content jsonb) language sql stable security invoker set search_path='' as $$ select * from private.wiki_page_history(p_id); $$;

create function private.forum_threads_list(p_search text default '',p_category_id uuid default null,p_include_archived boolean default false)
returns table(id uuid,title text,category_id uuid,category_label_de text,category_label_en text,owner_id uuid,owner_name text,locked boolean,pinned boolean,archived boolean,accepted_post_id uuid,post_count bigint,subscribed boolean,created_at timestamptz,updated_at timestamptz)
language sql stable security definer set search_path='' as $$
 select t.id,t.title,t.category_id,c.label_de,c.label_en,t.owner_id,p.display_name,t.locked,t.pinned,t.archived,t.accepted_post_id,
 (select count(*) from public.forum_posts fp where fp.thread_id=t.id and fp.deleted_at is null),exists(select 1 from public.forum_subscriptions s where s.thread_id=t.id and s.user_id=auth.uid()),t.created_at,t.updated_at
 from public.forum_threads t join public.knowledge_categories c on c.id=t.category_id join public.profiles p on p.id=t.owner_id
 where private.can_read_forum(t.id) and (not t.archived or p_include_archived) and (p_category_id is null or t.category_id=p_category_id)
 and (coalesce(p_search,'')='' or strpos(lower(t.title),lower(p_search))>0 or exists(select 1 from public.forum_posts fp where fp.thread_id=t.id and fp.deleted_at is null and strpos(lower(fp.content_text),lower(p_search))>0))
 order by t.pinned desc,t.updated_at desc,t.id limit 200;
$$;
create function public.forum_threads_list(p_search text default '',p_category_id uuid default null,p_include_archived boolean default false)
returns table(id uuid,title text,category_id uuid,category_label_de text,category_label_en text,owner_id uuid,owner_name text,locked boolean,pinned boolean,archived boolean,accepted_post_id uuid,post_count bigint,subscribed boolean,created_at timestamptz,updated_at timestamptz)
language sql stable security invoker set search_path='' as $$ select * from private.forum_threads_list(p_search,p_category_id,p_include_archived); $$;
create function private.forum_thread(p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not private.can_read_forum(p_id) then raise exception 'Forum access denied' using errcode='42501'; end if;
 select jsonb_build_object('id',t.id,'title',t.title,'category_id',t.category_id,'category_label_de',c.label_de,'category_label_en',c.label_en,'owner_id',t.owner_id,'owner_name',p.display_name,'locked',t.locked,'pinned',t.pinned,'archived',t.archived,'accepted_post_id',t.accepted_post_id,'post_count',(select count(*) from public.forum_posts fp where fp.thread_id=t.id and fp.deleted_at is null),'subscribed',exists(select 1 from public.forum_subscriptions s where s.thread_id=t.id and s.user_id=auth.uid()),'created_at',t.created_at,'updated_at',t.updated_at) into result
 from public.forum_threads t join public.knowledge_categories c on c.id=t.category_id join public.profiles p on p.id=t.owner_id where t.id=p_id;return result;
end;$$;
create function public.forum_thread(p_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$ select private.forum_thread(p_id); $$;
create function private.forum_posts(p_thread_id uuid) returns table(id uuid,thread_id uuid,author_id uuid,author_name text,content jsonb,created_at timestamptz,edited_at timestamptz,deleted_at timestamptz,version int) language plpgsql stable security definer set search_path='' as $$
begin
 if not private.can_read_forum(p_thread_id) then raise exception 'Forum access denied' using errcode='42501'; end if;
 return query select fp.id,fp.thread_id,fp.author_id,p.display_name,fp.content,fp.created_at,fp.edited_at,fp.deleted_at,fp.version from public.forum_posts fp join public.profiles p on p.id=fp.author_id where fp.thread_id=p_thread_id order by fp.created_at,fp.id limit 500;
end;$$;
create function public.forum_posts(p_thread_id uuid) returns table(id uuid,thread_id uuid,author_id uuid,author_name text,content jsonb,created_at timestamptz,edited_at timestamptz,deleted_at timestamptz,version int) language sql stable security invoker set search_path='' as $$ select * from private.forum_posts(p_thread_id); $$;

create function private.create_forum_thread(p_category_id uuid,p_title text,p_content jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid; plain text;
begin
 if not private.knowledge_staff() then raise exception 'Staff forum access required' using errcode='42501'; end if;
 if p_title is null or length(trim(p_title)) not between 1 and 200 or not exists(select 1 from public.knowledge_categories where id=p_category_id and kind='forum' and not archived) then raise exception 'Invalid forum metadata' using errcode='22023'; end if;
 plain=private.knowledge_text(p_content);if length(trim(coalesce(plain,'')))=0 then raise exception 'Forum content required' using errcode='22023'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('knowledge-author:'||auth.uid()::text,0));
 if (select count(*) from public.forum_posts where author_id=auth.uid() and created_at>clock_timestamp()-interval '1 minute')>=20 then raise exception 'Forum rate limit reached' using errcode='54000'; end if;
 insert into public.forum_threads(category_id,title,owner_id) values(p_category_id,trim(p_title),auth.uid()) returning id into result;
 insert into public.forum_posts(thread_id,author_id,client_id,content,content_text,request_hash) values(result,auth.uid(),gen_random_uuid(),p_content,plain,md5(p_content::text));
 insert into public.forum_subscriptions(thread_id,user_id) values(result,auth.uid());return result;
end;$$;
create function public.create_forum_thread(p_category_id uuid,p_title text,p_content jsonb) returns uuid language sql security invoker set search_path='' as $$ select private.create_forum_thread(p_category_id,p_title,p_content); $$;
create function private.add_forum_post(p_thread_id uuid,p_content jsonb,p_client_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare thread public.forum_threads; previous public.forum_posts; plain text; result uuid;
begin
 if not private.can_read_forum(p_thread_id) then raise exception 'Forum access denied' using errcode='42501'; end if;
 if p_client_id is null then raise exception 'Client request id required' using errcode='22023'; end if;
 plain=private.knowledge_text(p_content);if length(trim(coalesce(plain,'')))=0 then raise exception 'Forum content required' using errcode='22023'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('knowledge-author:'||auth.uid()::text,0));
 select * into previous from public.forum_posts where author_id=auth.uid() and client_id=p_client_id;
 if found then if previous.thread_id<>p_thread_id or previous.request_hash<>md5(p_content::text) then raise exception 'Forum idempotency conflict' using errcode='22023'; end if;return previous.id;end if;
 select * into thread from public.forum_threads where id=p_thread_id for update;
 if thread.locked or thread.archived then raise exception 'Discussion is locked or archived' using errcode='42501'; end if;
 if (select count(*) from public.forum_posts where thread_id=p_thread_id)>=500 then raise exception 'Discussion limit reached; start a new thread' using errcode='54000'; end if;
 if (select count(*) from public.forum_posts where author_id=auth.uid() and created_at>clock_timestamp()-interval '1 minute')>=20 then raise exception 'Forum rate limit reached' using errcode='54000'; end if;
 insert into public.forum_posts(thread_id,author_id,client_id,content,content_text,request_hash) values(p_thread_id,auth.uid(),p_client_id,p_content,plain,md5(p_content::text)) returning id into result;
 update public.forum_threads set updated_at=clock_timestamp() where id=p_thread_id;
 insert into public.notifications(user_id,kind,resource_id) select s.user_id,'forum_reply',p_thread_id from public.forum_subscriptions s join public.profiles p on p.id=s.user_id where s.thread_id=p_thread_id and s.user_id<>auth.uid() and p.active
 on conflict(user_id,kind,resource_id) do update set read_at=null,created_at=clock_timestamp();
 return result;
end;$$;
create function public.add_forum_post(p_thread_id uuid,p_content jsonb,p_client_id uuid) returns uuid language sql security invoker set search_path='' as $$ select private.add_forum_post(p_thread_id,p_content,p_client_id); $$;
create function private.edit_forum_post(p_post_id uuid,p_content jsonb,p_expected_version int) returns void language plpgsql security definer set search_path='' as $$
declare post public.forum_posts; thread public.forum_threads; plain text;
begin
 select * into post from public.forum_posts where id=p_post_id for update;
 if not found or not private.can_read_forum(post.thread_id) or post.author_id<>auth.uid() or post.deleted_at is not null then raise exception 'Forum edit denied' using errcode='42501'; end if;
 select * into thread from public.forum_threads where id=post.thread_id for share;
 if thread.locked or thread.archived then raise exception 'Discussion is locked or archived' using errcode='42501'; end if;
 if p_expected_version is distinct from post.version then raise exception 'Forum version conflict; reload before saving' using errcode='40001'; end if;
 plain=private.knowledge_text(p_content);if length(trim(coalesce(plain,'')))=0 then raise exception 'Forum content required' using errcode='22023'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('knowledge-author:'||auth.uid()::text,0));
 if (select count(*) from public.forum_post_revisions where editor_id=auth.uid() and created_at>clock_timestamp()-interval '1 minute')>=20 then raise exception 'Forum edit rate limit reached' using errcode='54000'; end if;
 insert into public.forum_post_revisions(post_id,version,editor_id,previous_content) values(post.id,post.version,auth.uid(),post.content);
 update public.forum_posts set content=p_content,content_text=plain,version=version+1,edited_at=clock_timestamp() where id=post.id;
 update public.forum_threads set updated_at=clock_timestamp() where id=post.thread_id;
end;$$;
create function public.edit_forum_post(p_post_id uuid,p_content jsonb,p_expected_version int) returns void language sql security invoker set search_path='' as $$ select private.edit_forum_post(p_post_id,p_content,p_expected_version); $$;
create function private.delete_forum_post(p_post_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare post public.forum_posts; thread public.forum_threads; moderator boolean:=private.has_permission('forum.moderate');
begin
 select * into post from public.forum_posts where id=p_post_id for update;
 if not found or not private.can_read_forum(post.thread_id) or (post.author_id<>auth.uid() and not moderator) then raise exception 'Forum delete denied' using errcode='42501'; end if;
 select * into thread from public.forum_threads where id=post.thread_id for update;
 if (thread.locked or thread.archived) and not moderator then raise exception 'Discussion is locked or archived' using errcode='42501'; end if;
 if post.deleted_at is not null then return; end if;
 insert into public.forum_post_revisions(post_id,version,editor_id,previous_content) values(post.id,post.version,auth.uid(),post.content);
 update public.forum_posts set content='{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb,content_text='',version=version+1,deleted_at=clock_timestamp() where id=post.id;
 update public.forum_threads set accepted_post_id=case when accepted_post_id=post.id then null else accepted_post_id end,updated_at=clock_timestamp() where id=post.thread_id;
 insert into public.audit_events(actor_id,action,resource_id,details) values(auth.uid(),'forum.post_deleted',post.id,jsonb_build_object('thread_id',post.thread_id));
end;$$;
create function public.delete_forum_post(p_post_id uuid) returns void language sql security invoker set search_path='' as $$ select private.delete_forum_post(p_post_id); $$;
create function private.moderate_forum_thread(p_thread_id uuid,p_locked boolean default null,p_pinned boolean default null,p_archived boolean default null) returns void language plpgsql security definer set search_path='' as $$
begin
 if not private.has_permission('forum.moderate') then raise exception 'Forum moderation and MFA required' using errcode='42501'; end if;
 update public.forum_threads set locked=coalesce(p_locked,locked),pinned=coalesce(p_pinned,pinned),archived=coalesce(p_archived,archived),updated_at=clock_timestamp() where id=p_thread_id;
 if not found then raise exception 'Thread not found' using errcode='22023'; end if;
 insert into public.audit_events(actor_id,action,resource_id,details) values(auth.uid(),'forum.thread_moderated',p_thread_id,jsonb_build_object('locked',p_locked,'pinned',p_pinned,'archived',p_archived));
end;$$;
create function public.moderate_forum_thread(p_thread_id uuid,p_locked boolean default null,p_pinned boolean default null,p_archived boolean default null) returns void language sql security invoker set search_path='' as $$ select private.moderate_forum_thread(p_thread_id,p_locked,p_pinned,p_archived); $$;
create function private.accept_forum_answer(p_thread_id uuid,p_post_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare thread public.forum_threads;
begin
 select * into thread from public.forum_threads where id=p_thread_id for update;
 if not found or not private.can_read_forum(p_thread_id) or (thread.owner_id<>auth.uid() and not private.has_permission('forum.moderate')) then raise exception 'Answer selection denied' using errcode='42501'; end if;
 if p_post_id is not null and not exists(select 1 from public.forum_posts p where p.id=p_post_id and p.thread_id=p_thread_id and p.deleted_at is null and p.id<>(select first.id from public.forum_posts first where first.thread_id=p_thread_id order by first.created_at,first.id limit 1)) then raise exception 'An undeleted reply in this thread is required' using errcode='22023'; end if;
 update public.forum_threads set accepted_post_id=p_post_id,updated_at=clock_timestamp() where id=p_thread_id;
 insert into public.audit_events(actor_id,action,resource_id,details) values(auth.uid(),'forum.answer_selected',p_thread_id,jsonb_build_object('post_id',p_post_id));
end;$$;
create function public.accept_forum_answer(p_thread_id uuid,p_post_id uuid) returns void language sql security invoker set search_path='' as $$ select private.accept_forum_answer(p_thread_id,p_post_id); $$;
create function private.subscribe_forum_thread(p_thread_id uuid,p_subscribed boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 if not private.can_read_forum(p_thread_id) or p_subscribed is null then raise exception 'Forum subscription denied' using errcode='42501'; end if;
 if p_subscribed then insert into public.forum_subscriptions(thread_id,user_id) values(p_thread_id,auth.uid()) on conflict do nothing;
 else delete from public.forum_subscriptions where thread_id=p_thread_id and user_id=auth.uid();end if;
end;$$;
create function public.subscribe_forum_thread(p_thread_id uuid,p_subscribed boolean) returns void language sql security invoker set search_path='' as $$ select private.subscribe_forum_thread(p_thread_id,p_subscribed); $$;
create function private.report_forum_post(p_post_id uuid,p_reason text) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid; thread uuid;
begin
 select thread_id into thread from public.forum_posts where id=p_post_id and deleted_at is null;
 if not private.can_read_forum(thread) then raise exception 'Forum reporting denied' using errcode='42501'; end if;
 if p_reason is null or length(trim(p_reason)) not between 5 and 2000 then raise exception 'Report reason required' using errcode='22023'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('knowledge-author:'||auth.uid()::text,0));
 select id into result from public.forum_reports where post_id=p_post_id and reporter_id=auth.uid();if result is not null then return result;end if;
 if (select count(*) from public.forum_reports where reporter_id=auth.uid() and created_at>clock_timestamp()-interval '1 hour')>=5 then raise exception 'Report rate limit reached' using errcode='54000'; end if;
 insert into public.forum_reports(post_id,reporter_id,reason) values(p_post_id,auth.uid(),trim(p_reason)) returning id into result;return result;
end;$$;
create function public.report_forum_post(p_post_id uuid,p_reason text) returns uuid language sql security invoker set search_path='' as $$ select private.report_forum_post(p_post_id,p_reason); $$;
create function private.forum_reports() returns table(id uuid,post_id uuid,thread_id uuid,reason text,status text,reporter_name text,created_at timestamptz) language sql stable security definer set search_path='' as $$
 select r.id,r.post_id,p.thread_id,r.reason,r.status,u.display_name,r.created_at from public.forum_reports r join public.forum_posts p on p.id=r.post_id join public.profiles u on u.id=r.reporter_id where private.knowledge_staff() and (r.reporter_id=auth.uid() or private.has_permission('forum.moderate')) order by r.created_at desc limit 200;
$$;
create function public.forum_reports() returns table(id uuid,post_id uuid,thread_id uuid,reason text,status text,reporter_name text,created_at timestamptz) language sql stable security invoker set search_path='' as $$ select * from private.forum_reports(); $$;
create function private.resolve_forum_report(p_report_id uuid,p_resolved boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 if not private.has_permission('forum.moderate') or p_resolved is null then raise exception 'Forum moderation and MFA required' using errcode='42501'; end if;
 update public.forum_reports set status=case when p_resolved then 'resolved' else 'open' end,handled_by=auth.uid() where id=p_report_id;
 if not found then raise exception 'Report not found' using errcode='22023'; end if;
 insert into public.audit_events(actor_id,action,resource_id) values(auth.uid(),'forum.report_reviewed',p_report_id);
end;$$;
create function public.resolve_forum_report(p_report_id uuid,p_resolved boolean) returns void language sql security invoker set search_path='' as $$ select private.resolve_forum_report(p_report_id,p_resolved); $$;

do $$declare item record;begin
 for item in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.proname in ('knowledge_staff','knowledge_access','validate_knowledge_node','knowledge_text','can_read_wiki','can_read_forum','knowledge_categories','save_knowledge_category','wiki_pages_list','wiki_page','save_wiki_page','wiki_page_history','forum_threads_list','forum_thread','forum_posts','create_forum_thread','add_forum_post','edit_forum_post','delete_forum_post','moderate_forum_thread','accept_forum_answer','subscribe_forum_thread','report_forum_post','forum_reports','resolve_forum_report') loop
  execute format('revoke execute on function %s from public,anon,authenticated',item.signature);execute format('grant execute on function %s to authenticated',item.signature);
 end loop;
end;$$;
revoke execute on function private.validate_knowledge_node(jsonb,int),private.knowledge_text(jsonb) from authenticated;
commit;
