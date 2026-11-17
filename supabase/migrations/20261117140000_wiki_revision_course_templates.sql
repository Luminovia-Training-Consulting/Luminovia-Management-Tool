begin;

-- Pin each course-template reference to the wiki revision that introduced it.
-- A later wiki draft inherits the exact references, while published snapshots
-- remain stable and a template cannot be physically removed while referenced.
create table private.wiki_revision_course_templates (
 page_id uuid not null,
 revision integer not null,
 template_id uuid not null references public.course_templates(id) on delete restrict,
 created_at timestamptz not null default clock_timestamp(),
 foreign key(page_id,revision) references public.wiki_revisions(page_id,version) on delete cascade,
 primary key(page_id,revision,template_id)
);
alter table private.wiki_revision_course_templates enable row level security;
revoke all on private.wiki_revision_course_templates from public,anon,authenticated;
grant all on private.wiki_revision_course_templates to service_role;

-- Preserve the reference set whenever save_wiki_page creates a new immutable
-- revision. The trigger runs in the same transaction as the wiki save.
create function private.copy_wiki_revision_course_templates() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 insert into private.wiki_revision_course_templates(page_id,revision,template_id)
 select new.page_id,new.version,r.template_id
 from private.wiki_revision_course_templates r
 where r.page_id=new.page_id and r.revision=new.version-1;
 return new;
end $$;
revoke all on function private.copy_wiki_revision_course_templates() from public,anon,authenticated,service_role;
create trigger copy_wiki_revision_course_templates after insert on public.wiki_revisions
for each row execute function private.copy_wiki_revision_course_templates();

-- Return only references for the wiki revision visible to this actor and only
-- while the actor can currently read each target template. This prevents a
-- stale link from revealing a template after course permission is revoked.
create function private.wiki_course_templates(p_page_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare selected_revision integer;
begin
 if not private.can_read_wiki(p_page_id) then
  raise exception 'Wiki access denied' using errcode='42501';
 end if;
 select case when p.owner_id=auth.uid() or private.has_permission('wiki.manage')
             then p.current_version else p.published_version end
 into selected_revision
 from public.wiki_pages p where p.id=p_page_id;
 return coalesce((
  select jsonb_agg(jsonb_build_object(
   'template_id',t.id,'title',t.title,'archived',t.archived_at is not null
  ) order by t.title,t.id)
  from private.wiki_revision_course_templates r
  join public.course_templates t on t.id=r.template_id
  where r.page_id=p_page_id and r.revision=selected_revision
   and private.can_read_course_template(t.id)
 ),'[]'::jsonb);
end $$;
create function public.wiki_course_templates(p_page_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select private.wiki_course_templates(p_page_id);
$$;

-- Add or remove one reference from the author's current unpublished revision.
-- Page locking serializes reference edits with wiki saves; the revision check
-- prevents stale dialogs from changing a newer or already published snapshot.
create function private.manage_wiki_course_template(
 p_page_id uuid,p_revision integer,p_template_id uuid,p_remove boolean
) returns void language plpgsql security definer set search_path='' as $$
declare page public.wiki_pages;
begin
 if not private.knowledge_staff() or p_page_id is null or p_revision is null
  or p_template_id is null or p_remove is null then
  raise exception 'Wiki access denied' using errcode='42501';
 end if;
 select * into page from public.wiki_pages where id=p_page_id for update;
 if not found or (page.owner_id<>auth.uid() and not private.has_permission('wiki.manage')) then
  raise exception 'Wiki edit denied' using errcode='42501';
 end if;
 if page.archived then
  raise exception 'Archived wiki cannot be changed' using errcode='42501';
 end if;
 if page.current_version is distinct from p_revision
  or page.published_version is not distinct from page.current_version then
  raise exception 'Save a new draft before changing course references' using errcode='40001';
 end if;
 if not exists(
  select 1 from public.course_templates t
  where t.id=p_template_id and private.can_read_course_template(t.id)
   and (p_remove or t.archived_at is null)
 ) then
  raise exception 'Course template unavailable' using errcode='42501';
 end if;
 if p_remove then
  delete from private.wiki_revision_course_templates
   where page_id=p_page_id and revision=p_revision and template_id=p_template_id;
  return;
 end if;
 if (select count(*) from private.wiki_revision_course_templates
     where page_id=p_page_id and revision=p_revision)>=20
  and not exists(select 1 from private.wiki_revision_course_templates
   where page_id=p_page_id and revision=p_revision and template_id=p_template_id) then
  raise exception 'Course reference limit reached' using errcode='54000';
 end if;
 insert into private.wiki_revision_course_templates(page_id,revision,template_id)
 values(p_page_id,p_revision,p_template_id)
 on conflict(page_id,revision,template_id) do nothing;
end $$;
create function public.manage_wiki_course_template(
 p_page_id uuid,p_revision integer,p_template_id uuid,p_remove boolean
) returns void language sql volatile security invoker set search_path='' as $$
 select private.manage_wiki_course_template(p_page_id,p_revision,p_template_id,p_remove);
$$;

-- Permanent wiki deletion previews include these revision-owned rows so the
-- existing deletion journal accounts for every child before the cascade.
alter function private.deletion_scope(text,uuid)
 rename to deletion_scope_before_wiki_course_templates;
create function private.deletion_scope(p_kind text,p_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb:=private.deletion_scope_before_wiki_course_templates(p_kind,p_id);
begin
 if p_kind='wiki_page' then
  result=private.deletion_add_scope(result,'private.wiki_revision_course_templates',
   format('x.page_id=%L::uuid',p_id));
 end if;
 return result;
end $$;

revoke all on function private.wiki_course_templates(uuid),public.wiki_course_templates(uuid),
 private.manage_wiki_course_template(uuid,integer,uuid,boolean),public.manage_wiki_course_template(uuid,integer,uuid,boolean),
 private.deletion_scope_before_wiki_course_templates(text,uuid),private.deletion_scope(text,uuid)
 from public,anon,authenticated;
grant execute on function private.wiki_course_templates(uuid),public.wiki_course_templates(uuid),
 private.manage_wiki_course_template(uuid,integer,uuid,boolean),public.manage_wiki_course_template(uuid,integer,uuid,boolean)
 to authenticated;
commit;
