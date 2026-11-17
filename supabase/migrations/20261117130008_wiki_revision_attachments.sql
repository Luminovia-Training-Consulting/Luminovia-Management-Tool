begin;
-- A wiki share pins exact bytes but never changes the underlying personal-document ACL.
create table private.wiki_revision_attachments (
 id uuid primary key default gen_random_uuid(),
 page_id uuid not null,
 revision integer not null,
 version_id uuid not null references public.document_versions(id),
 added_by uuid not null references public.profiles(id),
 created_at timestamptz not null default clock_timestamp(),
 foreign key(page_id,revision) references public.wiki_revisions(page_id,version) on delete cascade,
 unique(page_id,revision,version_id)
);
alter table private.wiki_revision_attachments enable row level security;
revoke all on private.wiki_revision_attachments from public,anon,authenticated;
grant all on private.wiki_revision_attachments to service_role;

-- A subsequent draft or publication receives the previous revision's exact links;
-- modifying draft links never mutates an already published revision.
create function private.copy_wiki_revision_attachments() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 insert into private.wiki_revision_attachments(page_id,revision,version_id,added_by)
 select new.page_id,new.version,a.version_id,a.added_by from private.wiki_revision_attachments a
 where a.page_id=new.page_id and a.revision=new.version-1;
 return new;
end $$;
revoke all on function private.copy_wiki_revision_attachments() from public,anon,authenticated,service_role;
create trigger copy_wiki_revision_attachments after insert on public.wiki_revisions
for each row execute function private.copy_wiki_revision_attachments();

create function private.wiki_attachment_visible(p_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.wiki_revision_attachments a join public.wiki_pages p on p.id=a.page_id
 join public.document_versions v on v.id=a.version_id join public.documents d on d.id=v.document_id
 where a.id=p_id and private.can_read_wiki(p.id)
 and a.revision=case when p.owner_id=auth.uid() or private.has_permission('wiki.manage') then p.current_version else p.published_version end
 and d.scope='personal' and d.kind='material' and d.deleted_at is null and d.status='clean'
 and v.status='clean' and v.sha256 is not null and not private.course_document_is_dedicated(d.id));
$$;
create function private.wiki_attachments(p_page_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not private.can_read_wiki(p_page_id) then raise exception 'Wiki access denied' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'version_id',v.id,'name',v.original_name) order by v.original_name,a.id)
 from private.wiki_revision_attachments a join public.document_versions v on v.id=a.version_id
 where a.page_id=p_page_id and private.wiki_attachment_visible(a.id)),'[]'::jsonb);
end $$;
create function public.wiki_attachments(p_page_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$select private.wiki_attachments(p_page_id);$$;

-- Changes are limited to the editable current draft. A published revision can
-- only be changed by saving a new draft, preserving old readers' snapshots.
create function private.manage_wiki_attachment(p_page_id uuid,p_revision integer,p_version_id uuid,p_remove boolean) returns void
language plpgsql volatile security definer set search_path='' as $$
declare page public.wiki_pages; d public.documents;
begin
 if not private.knowledge_staff() or p_remove is null then raise exception 'Wiki access denied' using errcode='42501'; end if;
 select * into page from public.wiki_pages where id=p_page_id for update;
 if not found or (page.owner_id<>auth.uid() and not private.has_permission('wiki.manage')) or page.archived then raise exception 'Wiki edit denied' using errcode='42501';end if;
 if page.current_version is distinct from p_revision or page.published_version is not distinct from page.current_version then raise exception 'Save a new draft before changing attachments' using errcode='40001';end if;
 if p_remove then
  delete from private.wiki_revision_attachments where page_id=p_page_id and revision=p_revision and version_id=p_version_id;
  return;
 end if;
 select doc.* into d from public.documents doc join public.document_versions v on v.document_id=doc.id where v.id=p_version_id for update of doc;
 if not found or d.owner_id<>auth.uid() or d.scope<>'personal' or d.kind<>'material' or d.deleted_at is not null or d.status<>'clean' or private.course_document_is_dedicated(d.id) or not exists(select 1 from public.document_versions v where v.id=p_version_id and v.document_id=d.id and v.status='clean' and v.sha256 is not null) then raise exception 'Own clean material required' using errcode='42501';end if;
 if (select count(*) from private.wiki_revision_attachments where page_id=p_page_id and revision=p_revision)>=20 and not exists(select 1 from private.wiki_revision_attachments where page_id=p_page_id and revision=p_revision and version_id=p_version_id) then raise exception 'Attachment limit reached' using errcode='54000';end if;
 insert into private.wiki_revision_attachments(page_id,revision,version_id,added_by) values(p_page_id,p_revision,p_version_id,auth.uid()) on conflict(page_id,revision,version_id) do nothing;
end $$;
create function public.manage_wiki_attachment(p_page_id uuid,p_revision integer,p_version_id uuid,p_remove boolean) returns void language sql volatile security invoker set search_path='' as $$select private.manage_wiki_attachment(p_page_id,p_revision,p_version_id,p_remove);$$;

create function private.wiki_attachment_access(p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.wiki_attachment_visible(p_id) then raise exception 'Wiki attachment unavailable' using errcode='42501';end if;
 return (select jsonb_build_object('id',a.id,'version_id',v.id,'sha256',v.sha256,'mime_type',v.mime_type,'name',v.original_name)
 from private.wiki_revision_attachments a join public.document_versions v on v.id=a.version_id where a.id=p_id);
end $$;
create function public.wiki_attachment_access(p_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$select private.wiki_attachment_access(p_id);$$;
-- Storage paths are resolved only by the trusted gateway after caller-scoped
-- authorization. Browser callers never receive owner UUID-bearing paths.
create function private.wiki_attachment_storage_path(p_id uuid,p_version_id uuid) returns text
language sql stable security definer set search_path='' as $$
 select v.object_path from private.wiki_revision_attachments a
 join public.document_versions v on v.id=a.version_id join public.documents d on d.id=v.document_id
 where a.id=p_id and v.id=p_version_id and v.status='clean' and v.sha256 is not null
 and d.deleted_at is null and d.status='clean' and d.scope='personal' and d.kind='material'
 and not private.course_document_is_dedicated(d.id);
$$;
create function public.wiki_attachment_storage_path(p_id uuid,p_version_id uuid) returns text
language sql stable security invoker set search_path='' as $$select private.wiki_attachment_storage_path(p_id,p_version_id);$$;
revoke all on function private.wiki_attachment_storage_path(uuid,uuid),public.wiki_attachment_storage_path(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function private.wiki_attachment_storage_path(uuid,uuid),public.wiki_attachment_storage_path(uuid,uuid) to service_role;

revoke all on function private.wiki_attachment_visible(uuid),private.wiki_attachments(uuid),public.wiki_attachments(uuid),private.manage_wiki_attachment(uuid,integer,uuid,boolean),public.manage_wiki_attachment(uuid,integer,uuid,boolean),private.wiki_attachment_access(uuid),public.wiki_attachment_access(uuid) from public,anon,authenticated;
grant execute on function private.wiki_attachments(uuid),public.wiki_attachments(uuid),private.manage_wiki_attachment(uuid,integer,uuid,boolean),public.manage_wiki_attachment(uuid,integer,uuid,boolean),private.wiki_attachment_access(uuid),public.wiki_attachment_access(uuid) to authenticated;

-- Include child links in the reviewed deletion scope of their wiki page.
alter function private.deletion_scope(text,uuid) rename to deletion_scope_before_wiki_attachments;
create function private.deletion_scope(p_kind text,p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb:=private.deletion_scope_before_wiki_attachments(p_kind,p_id);
begin
 if p_kind='wiki_page' then
  result=private.deletion_add_scope(result,'private.wiki_revision_attachments',format('x.page_id=%L::uuid',p_id));
 end if;
 return result;
end $$;
revoke all on function private.deletion_scope_before_wiki_attachments(text,uuid),private.deletion_scope(text,uuid) from public,anon,authenticated;
commit;
