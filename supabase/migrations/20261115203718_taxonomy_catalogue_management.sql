-- Reuse topic IDs everywhere: archived entries remain valid historical references.
begin;
alter table public.topics
 add column archived_at timestamptz,
 add column version integer not null default 1 check(version>0),
 add column description_de text not null default '' check(length(description_de)<=4000),
 add column description_en text not null default '' check(length(description_en)<=4000);
create index topics_parent_id on public.topics(parent_id);
create index topics_active_kind_label on public.topics(kind,label_de,id) where archived_at is null;
insert into public.role_permissions(role,permission)
 select r,'taxonomy.manage' from unnest(array['owner','admin','management']) r on conflict do nothing;

-- A hierarchy mutation locks this small catalogue before row locks. This also
-- prevents two concurrent valid moves from committing a combined parent cycle.
create function private.validate_taxonomy_hierarchy() returns trigger language plpgsql security definer set search_path='' as $$
begin
 lock table public.topics in share row exclusive mode;
 if new.parent_id is not null then
  if new.parent_id=new.id or exists(
   with recursive ancestors(id,parent_id,path) as (
    select t.id,t.parent_id,array[t.id] from public.topics t where t.id=new.parent_id
    union all
    select t.id,t.parent_id,a.path||t.id from public.topics t join ancestors a on t.id=a.parent_id where not t.id=any(a.path)
   ) select 1 from ancestors where id=new.id
  ) then raise exception 'Taxonomy parent cycle' using errcode='23514';end if;
  if new.archived_at is null and exists(select 1 from public.topics t where t.id=new.parent_id and t.archived_at is not null) then raise exception 'Archived taxonomy parent' using errcode='23514';end if;
 end if;
 if new.archived_at is not null and exists(select 1 from public.topics t where t.parent_id=new.id and t.archived_at is null) then raise exception 'Archive active children first' using errcode='23514';end if;
 return new;
end;$$;
-- Refuse invalid legacy hierarchy atomically; never repair someone's tree silently.
do $$begin
 if exists(with recursive walk(id,parent_id,path,cycle) as (
  select id,parent_id,array[id],false from public.topics
  union all select t.id,t.parent_id,w.path||t.id,t.id=any(w.path) from public.topics t join walk w on t.id=w.parent_id where not w.cycle
 ) select 1 from walk where cycle) then raise exception 'Existing taxonomy parent cycle requires review' using errcode='23514';end if;
end;$$;
create trigger topics_valid_hierarchy before insert or update of parent_id,archived_at on public.topics for each row execute function private.validate_taxonomy_hierarchy();

create function private.require_active_topic_reference() returns trigger language plpgsql security definer set search_path='' as $$
declare archived timestamptz;
begin
 if tg_op='UPDATE' and new.topic_id=old.topic_id then return new;end if;
 -- Row locking orders new selections against a concurrent archive operation.
 select archived_at into archived from public.topics where id=new.topic_id for share;
 if not found then raise exception 'Unknown taxonomy entry' using errcode='23503';end if;
 if archived is not null then raise exception 'Archived taxonomy entry cannot be newly selected' using errcode='23514';end if;
 return new;
end;$$;
create trigger lecturer_topic_active before insert or update of topic_id on public.lecturer_topics for each row execute function private.require_active_topic_reference();
create trigger template_topic_active before insert or update of topic_id on public.course_template_topics for each row execute function private.require_active_topic_reference();
create trigger job_topic_active before insert or update of topic_id on public.job_requirements for each row execute function private.require_active_topic_reference();

create function private.taxonomy_catalogue(p_search text default '',p_kind text default '',p_include_archived boolean default false) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.actor_active() then raise exception 'Active login required' using errcode='42501';end if;
 if length(coalesce(p_search,''))>120 or p_kind is null or p_kind not in('','topic','tool','language') or p_include_archived is null then raise exception 'Invalid catalogue filters' using errcode='22023';end if;
 if p_include_archived and not private.has_permission('taxonomy.manage') then raise exception 'taxonomy.manage and MFA required' using errcode='42501';end if;
 return coalesce((select jsonb_agg(to_jsonb(x) order by x.label_de,x.id) from (
  select t.*,coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'title',c.title) order by c.title,c.id)
   from public.course_template_topics ct join public.course_templates c on c.id=ct.template_id
   where ct.topic_id=t.id and (private.can_read_course_template(c.id) or exists(select 1 from public.course_runs r join public.course_enrolments e on e.course_run_id=r.id where r.template_id=c.id and e.user_id=auth.uid() and e.status in('enrolled','completed')))),'[]'::jsonb) related_courses
  from public.topics t where (p_include_archived or t.archived_at is null) and (p_kind='' or t.kind=p_kind)
  and (coalesce(p_search,'')='' or strpos(lower(t.label_de),lower(p_search))>0 or strpos(lower(t.label_en),lower(p_search))>0 or exists(select 1 from unnest(t.aliases) a where strpos(lower(a),lower(p_search))>0))
  order by t.label_de,t.id limit 500
 ) x),'[]'::jsonb);
end;$$;
create function public.taxonomy_catalogue(p_search text default '',p_kind text default '',p_include_archived boolean default false) returns jsonb language sql security invoker set search_path='' as $$select private.taxonomy_catalogue(p_search,p_kind,p_include_archived);$$;

create function private.save_taxonomy_topic(p_id uuid,p_payload jsonb,p_version integer default 0) returns uuid language plpgsql security definer set search_path='' as $$
declare previous public.topics;target uuid:=coalesce(p_id,gen_random_uuid());selected_aliases text[];parent uuid;de text;en text;selected_kind text;description_german text;description_english text;
begin
 if not private.has_permission('taxonomy.manage') then raise exception 'taxonomy.manage and MFA required' using errcode='42501';end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or exists(select 1 from jsonb_object_keys(p_payload) k where k not in('label_de','label_en','kind','parent_id','aliases','description_de','description_en')) then raise exception 'Invalid taxonomy payload' using errcode='22023';end if;
 if jsonb_typeof(p_payload->'label_de') is distinct from 'string' or jsonb_typeof(p_payload->'label_en') is distinct from 'string' or jsonb_typeof(p_payload->'kind') is distinct from 'string' then raise exception 'Taxonomy labels and kind required' using errcode='22023';end if;
 de:=trim(p_payload->>'label_de');en:=trim(p_payload->>'label_en');selected_kind:=p_payload->>'kind';
 if length(de) not between 1 and 120 or length(en) not between 1 and 120 or de~'[[:cntrl:]]' or en~'[[:cntrl:]]' or selected_kind not in('topic','tool','language') then raise exception 'Invalid taxonomy labels or kind' using errcode='22023';end if;
 if (p_payload?'parent_id' and jsonb_typeof(p_payload->'parent_id') not in('string','null')) or (p_payload?'description_de' and jsonb_typeof(p_payload->'description_de')<>'string') or (p_payload?'description_en' and jsonb_typeof(p_payload->'description_en')<>'string') then raise exception 'Invalid taxonomy metadata' using errcode='22023';end if;
 parent:=nullif(p_payload->>'parent_id','')::uuid;
 description_german:=coalesce(p_payload->>'description_de','');description_english:=coalesce(p_payload->>'description_en','');
 if length(description_german)>4000 or length(description_english)>4000 then raise exception 'Taxonomy description too long' using errcode='22023';end if;
 selected_aliases:=private.profile_labels(coalesce(p_payload->'aliases','[]'::jsonb),20,120);
 lock table public.topics in share row exclusive mode;
 if parent is not null and not exists(select 1 from public.topics where id=parent and archived_at is null) then raise exception 'Active taxonomy parent required' using errcode='23514';end if;
 if exists(select 1 from public.topics where kind=selected_kind and lower(trim(label_de))=lower(de) and id<>target) then raise exception 'Duplicate taxonomy label' using errcode='23505';end if;
 if p_id is null then
  if p_version is distinct from 0 then raise exception 'Stale taxonomy version' using errcode='40001';end if;
  insert into public.topics(id,label_de,label_en,kind,parent_id,aliases,description_de,description_en) values(target,de,en,selected_kind,parent,selected_aliases,description_german,description_english);
 else
  select * into previous from public.topics where id=p_id for update;
  if not found then raise exception 'Taxonomy entry not found' using errcode='P0002';end if;
  if previous.version is distinct from p_version then raise exception 'Stale taxonomy version' using errcode='40001';end if;
  if previous.archived_at is not null then raise exception 'Restore taxonomy entry before editing' using errcode='23514';end if;
  update public.topics set label_de=de,label_en=en,kind=selected_kind,parent_id=parent,aliases=selected_aliases,description_de=description_german,description_en=description_english,version=version+1 where id=p_id;
 end if;
 insert into public.audit_events(actor_id,action,resource_id,details) values(auth.uid(),case when p_id is null then 'taxonomy.created' else 'taxonomy.updated' end,target,jsonb_build_object('previous_version',p_version));
 return target;
end;$$;
create function public.save_taxonomy_topic(p_id uuid,p_payload jsonb,p_version integer default 0) returns uuid language sql security invoker set search_path='' as $$select private.save_taxonomy_topic(p_id,p_payload,p_version);$$;

create function private.set_taxonomy_topic_archived(p_id uuid,p_archived boolean,p_version integer) returns void language plpgsql security definer set search_path='' as $$
declare previous public.topics;
begin
 if not private.has_permission('taxonomy.manage') then raise exception 'taxonomy.manage and MFA required' using errcode='42501';end if;
 if p_archived is null then raise exception 'Archive state required' using errcode='22023';end if;
 lock table public.topics in share row exclusive mode;
 select * into previous from public.topics where id=p_id for update;
 if not found then raise exception 'Taxonomy entry not found' using errcode='P0002';end if;
 if previous.version is distinct from p_version then raise exception 'Stale taxonomy version' using errcode='40001';end if;
 if (previous.archived_at is not null)=p_archived then return;end if;
 update public.topics set archived_at=case when p_archived then now() end,version=version+1 where id=p_id;
 insert into public.audit_events(actor_id,action,resource_id,details) values(auth.uid(),case when p_archived then 'taxonomy.archived' else 'taxonomy.restored' end,p_id,jsonb_build_object('previous_version',p_version));
end;$$;
create function public.set_taxonomy_topic_archived(p_id uuid,p_archived boolean,p_version integer) returns void language sql security invoker set search_path='' as $$select private.set_taxonomy_topic_archived(p_id,p_archived,p_version);$$;

revoke all on function private.taxonomy_catalogue(text,text,boolean),public.taxonomy_catalogue(text,text,boolean),private.save_taxonomy_topic(uuid,jsonb,integer),public.save_taxonomy_topic(uuid,jsonb,integer),private.set_taxonomy_topic_archived(uuid,boolean,integer),public.set_taxonomy_topic_archived(uuid,boolean,integer) from public,anon,authenticated;
grant execute on function private.taxonomy_catalogue(text,text,boolean),public.taxonomy_catalogue(text,text,boolean),private.save_taxonomy_topic(uuid,jsonb,integer),public.save_taxonomy_topic(uuid,jsonb,integer),private.set_taxonomy_topic_archived(uuid,boolean,integer),public.set_taxonomy_topic_archived(uuid,boolean,integer) to authenticated;
commit;
