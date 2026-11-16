begin;
-- Personal organisation is separate from shared document metadata. Even an
-- administrator's labels/folder do not become another account's annotations.
create table private.document_organisation (
 user_id uuid not null references public.profiles(id) on delete cascade,
 document_id uuid not null references public.documents(id) on delete cascade,
 tags text[] not null default '{}',
 folder text not null default '' check(length(folder)<=80),
 version integer not null default 1 check(version>0),
 updated_at timestamptz not null default now(),
 primary key(user_id,document_id)
);
alter table private.document_organisation enable row level security;
create policy own_document_organisation on private.document_organisation for select to authenticated using((select private.actor_active()) and user_id=(select auth.uid()) and private.can_access_document(document_id));
revoke all on private.document_organisation from public,anon,authenticated;
grant all on private.document_organisation to service_role;
create index documents_discovery_cursor on public.documents(created_at desc,id desc) where deleted_at is null;
create index document_organisation_folder on private.document_organisation(user_id,lower(folder),document_id);

create function private.document_discovery(p_search text default '',p_tag text default '',p_folder text default null,
 p_owner uuid default null,p_kind text default '',p_job uuid default null,p_before_at timestamptz default null,p_before_id uuid default null,p_limit integer default 40)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare rows jsonb;more boolean;cursor jsonb;
begin
 if not private.actor_active() then raise exception 'Active account required' using errcode='42501';end if;
 if p_search is null or length(p_search)>160 or p_tag is null or length(p_tag)>60 or (p_folder is not null and length(p_folder)>80)
  or p_kind is null or p_kind not in('','material','chat','cv','certificate','contract','invoice','avatar')
  or p_limit is null or p_limit not between 1 and 100 or ((p_before_at is null)<>(p_before_id is null))
  or (p_before_at is not null and not isfinite(p_before_at)) then raise exception 'Invalid document filter or cursor' using errcode='22023';end if;
 with page as materialized(
  select d.*,coalesce(o.tags,'{}'::text[]) personal_tags,coalesce(o.folder,'') personal_folder,coalesce(o.version,0) personal_version
  from public.documents d left join private.document_organisation o on o.document_id=d.id and o.user_id=auth.uid()
  where d.deleted_at is null and private.can_access_document(d.id)
   and (p_owner is null or d.owner_id=p_owner) and (p_kind='' or d.kind=p_kind) and (p_job is null or d.job_id=p_job)
   and (p_search='' or strpos(lower(d.original_name),lower(p_search))>0)
   and (p_tag='' or exists(select 1 from unnest(o.tags)tag where lower(tag)=lower(p_tag)))
   and (p_folder is null or (p_folder='' and (o.document_id is null or o.folder='')) or (p_folder<>'' and lower(o.folder)=lower(p_folder)))
   and (p_before_at is null or (d.created_at,d.id)<(p_before_at,p_before_id))
  order by d.created_at desc,d.id desc limit p_limit+1
 ),visible as(select * from page order by created_at desc,id desc limit p_limit)
 select coalesce((select jsonb_agg(to_jsonb(v) order by v.created_at desc,v.id desc) from visible v),'[]'::jsonb),
  (select count(*)>p_limit from page),
  (select jsonb_build_object('at',v.created_at,'id',v.id) from visible v order by v.created_at,v.id limit 1)
 into rows,more,cursor;
 return jsonb_build_object('items',rows,'has_more',more,'next_cursor',case when more then cursor else null end);
end;$$;
create function public.document_discovery(p_search text default '',p_tag text default '',p_folder text default null,
 p_owner uuid default null,p_kind text default '',p_job uuid default null,p_before_at timestamptz default null,p_before_id uuid default null,p_limit integer default 40)
returns jsonb language sql stable security invoker set search_path='' as $$select private.document_discovery(p_search,p_tag,p_folder,p_owner,p_kind,p_job,p_before_at,p_before_id,p_limit);$$;

create function private.save_document_organisation(p_document_id uuid,p_payload jsonb,p_expected_version integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();labels text[];folder_name text;previous private.document_organisation;result private.document_organisation;
begin
 if not private.actor_active() then raise exception 'Active account required' using errcode='42501';end if;
 if p_document_id is null or p_expected_version is null or p_expected_version<0 or p_payload is null or jsonb_typeof(p_payload)<>'object'
  or (select count(*) from jsonb_object_keys(p_payload))<>2
  or exists(select 1 from jsonb_object_keys(p_payload)k where k not in('tags','folder'))
  or jsonb_typeof(p_payload->'tags') is distinct from 'array' or jsonb_typeof(p_payload->'folder') is distinct from 'string' then raise exception 'Invalid personal organisation' using errcode='22023';end if;
 labels:=private.profile_labels(p_payload->'tags',20,60);folder_name:=trim(p_payload->>'folder');
 if length(folder_name)>80 or folder_name~'[[:cntrl:]]' then raise exception 'Invalid virtual folder label' using errcode='22023';end if;
 perform 1 from public.profiles where id=actor and active for share;
 if not found then raise exception 'Active account required' using errcode='42501';end if;
 -- Serialize with document archive/replacement, then with this account's own
 -- annotation writers. No other account's annotation row is read or changed.
 perform 1 from public.documents where id=p_document_id for share;
 if not found or not private.can_access_document(p_document_id) then raise exception 'Document access denied' using errcode='42501';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('document-organisation:'||actor::text||p_document_id::text,0));
 select * into previous from private.document_organisation where user_id=actor and document_id=p_document_id for update;
 if coalesce(previous.version,0)<>p_expected_version then raise exception 'Personal organisation changed; reload' using errcode='40001';end if;
 insert into private.document_organisation(user_id,document_id,tags,folder) values(actor,p_document_id,labels,folder_name)
 on conflict(user_id,document_id) do update set tags=excluded.tags,folder=excluded.folder,version=private.document_organisation.version+1,updated_at=now()
 returning * into result;
 insert into public.audit_events(actor_id,action,resource_id) values(actor,'document.personal_organisation_changed',p_document_id);
 return jsonb_build_object('tags',result.tags,'folder',result.folder,'version',result.version);
end;$$;
create function public.save_document_organisation(p_document_id uuid,p_payload jsonb,p_expected_version integer) returns jsonb
language sql security invoker set search_path='' as $$select private.save_document_organisation(p_document_id,p_payload,p_expected_version);$$;
revoke all on function private.document_discovery(text,text,text,uuid,text,uuid,timestamptz,uuid,integer),public.document_discovery(text,text,text,uuid,text,uuid,timestamptz,uuid,integer),private.save_document_organisation(uuid,jsonb,integer),public.save_document_organisation(uuid,jsonb,integer) from public,anon,authenticated;
grant execute on function private.document_discovery(text,text,text,uuid,text,uuid,timestamptz,uuid,integer),public.document_discovery(text,text,text,uuid,text,uuid,timestamptz,uuid,integer),private.save_document_organisation(uuid,jsonb,integer),public.save_document_organisation(uuid,jsonb,integer) to authenticated;
commit;
