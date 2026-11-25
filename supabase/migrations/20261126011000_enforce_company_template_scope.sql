begin;

-- Company writes must name their company before looking up a target. The existing
-- membership lock and the subsequent owner-qualified row lock remain authoritative.
do $migration$
declare
  definition text := pg_get_functiondef('private.save_course_template(uuid,jsonb)'::regprocedure);
  previous constant text := $old$    if p_id is null then
      owner_id := (p_payload->>'owner_organisation_id')::uuid;
    else
      select template.owner_organisation_id into owner_id
      from public.course_templates template where template.id = p_id;
    end if;
    perform private.lock_company_course_author(owner_id);
    if p_id is not null then
      if p_payload ? 'owner_organisation_id'
         and (p_payload->>'owner_organisation_id')::uuid is distinct from owner_id then
        raise exception 'Course template ownership cannot be changed' using errcode = '42501';
      end if;$old$;
begin
  if cardinality(string_to_array(definition, previous)) <> 2 then
    raise exception 'Expected the existing company template write guard';
  end if;
  execute replace(definition, previous, $new$    owner_id := (p_payload->>'owner_organisation_id')::uuid;
    perform private.lock_company_course_author(owner_id);
    if p_id is not null then$new$);
end;
$migration$;

-- A run write already locks and validates its template. Guard the reverse
-- direction too, including trusted writes, without rewriting historic records.
create function private.validate_course_template_scope()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.owner_organisation_id is not distinct from old.owner_organisation_id then
    return new;
  end if;
  if old.owner_organisation_id is not null
    or old.building_block_id is not null or old.building_block_source_id is not null
    or new.building_block_id is not null or new.building_block_source_id is not null
    or exists (
      select 1 from public.course_runs run where run.template_id = old.id
        and run.organisation_id is distinct from new.owner_organisation_id
    ) then
    raise exception 'Course template ownership cannot be changed' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function private.validate_course_template_scope() from public, anon, authenticated, service_role;
create trigger course_template_scope before update of owner_organisation_id on public.course_templates
for each row execute function private.validate_course_template_scope();

-- A company grant is independent from the personal teaching/learning paths.
-- A historical mismatched run cannot serve as evidence of access to an owned template.
create or replace function private.can_read_course_template(p_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.actor_active() and exists (
    select 1 from public.course_templates template where template.id = p_id and (
      private.has_permission('courses.manage')
      or private.client_has_organisation(template.owner_organisation_id)
      or (template.owner_organisation_id is null and exists (
        select 1 from public.course_runs own_run where own_run.template_id = template.id
          and private.client_has_organisation(own_run.organisation_id)
          and not exists (
            select 1 from public.course_runs other_run where other_run.template_id = template.id
              and other_run.organisation_id is distinct from own_run.organisation_id
          )
      ))
      or exists (
        select 1 from public.course_runs run where run.template_id = template.id
          and (template.owner_organisation_id is null or run.organisation_id = template.owner_organisation_id)
          and (
            ((select edition from private.installation_identity) <> 'internal' and private.can_read_course_run(run.id))
            or (private.lecturer_actor() and (
              private.course_has_current_teacher(run.id)
              or (not private.has_role(array['client']) and private.can_read_course_run(run.id))
            ))
          )
      )
    )
  );
$$;

-- Keep the existing independent Premium enrolment path and its RLS checks.
alter policy templates_read on public.course_templates using (
  private.can_read_course_template(id) or
  ((select private.actor_active()) and exists (
    select 1 from public.course_runs run
    join public.course_enrolments enrolment on enrolment.course_run_id = run.id
    where run.template_id = course_templates.id
      and (course_templates.owner_organisation_id is null or run.organisation_id = course_templates.owner_organisation_id)
      and private.course_premium_access(run.id)
      and enrolment.user_id = (select auth.uid())
      and enrolment.status in ('enrolled', 'completed')
  ))
);

-- The wiki remains globally edited. Each company projects only its own links;
-- neutral material remains in the separate global editorial projection.
create function private.wiki_template_in_scope(p_id uuid, p_organisation_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.can_read_course_template(p_id) and exists (
    select 1 from public.course_templates template where template.id = p_id and (
      (p_organisation_id is null and (
        private.has_permission('courses.manage')
        or not private.has_role(array['client'])
        or (template.owner_organisation_id is null and (
          template.building_block_id is not null or not exists (
            select 1 from public.course_runs run where run.template_id = template.id and run.organisation_id is not null
          )
        ))
      ))
      or template.owner_organisation_id = p_organisation_id
    )
  );
$$;
revoke all on function private.wiki_template_in_scope(uuid,uuid) from public, anon, authenticated, service_role;

-- Keep the original global RPC signatures for existing internal clients; the
-- overloads carry an explicit company on both reads and draft mutations.
create function private.wiki_course_templates(p_page_id uuid, p_organisation_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare selected_revision integer;
begin
  if not private.can_read_wiki(p_page_id)
    or (p_organisation_id is not null and not private.client_has_organisation(p_organisation_id)) then
    raise exception 'Wiki access denied' using errcode = '42501';
  end if;
  select case when page.owner_id = auth.uid() or private.has_permission('wiki.manage')
    then page.current_version else page.published_version end into selected_revision
  from public.wiki_pages page where page.id = p_page_id;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'template_id', template.id, 'title', template.title, 'archived', template.archived_at is not null
    ) order by template.title, template.id)
    from private.wiki_revision_course_templates reference
    join public.course_templates template on template.id = reference.template_id
    where reference.page_id = p_page_id and reference.revision = selected_revision
      and private.wiki_template_in_scope(template.id, p_organisation_id)
  ), '[]'::jsonb);
end;
$$;
create or replace function private.wiki_course_templates(p_page_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select private.wiki_course_templates(p_page_id, null::uuid);
$$;
create function public.wiki_course_templates(p_page_id uuid, p_organisation_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select private.wiki_course_templates(p_page_id, p_organisation_id);
$$;

-- Use the same ownership and live access filter for draft choices as for saved links.
create function private.wiki_course_template_choices(p_page_id uuid, p_organisation_id uuid)
returns table(id uuid, title text) language sql stable security definer set search_path = '' as $$
  select template.id, template.title
  from public.course_templates template
  where private.knowledge_staff()
    and (p_organisation_id is null or private.client_has_organisation(p_organisation_id))
    and exists (select 1 from public.wiki_pages page where page.id = p_page_id and not page.archived
      and (page.owner_id = auth.uid() or private.has_permission('wiki.manage'))
      and page.current_version is distinct from page.published_version)
    and template.archived_at is null
    and (p_organisation_id is null or template.owner_organisation_id = p_organisation_id)
    and private.wiki_template_in_scope(template.id, p_organisation_id);
$$;
create function public.wiki_course_template_choices(p_page_id uuid, p_organisation_id uuid)
returns table(id uuid, title text) language sql stable security invoker set search_path = '' as $$
  select * from private.wiki_course_template_choices(p_page_id, p_organisation_id);
$$;

-- The wiki page lock still protects revision CAS and the shared link limit.
-- The membership and target locks keep revocation/ownership changes from racing a scoped edit.
create function private.manage_wiki_course_template(
  p_page_id uuid, p_revision integer, p_template_id uuid, p_remove boolean, p_organisation_id uuid
) returns void language plpgsql security definer set search_path = '' as $$
declare page public.wiki_pages;
begin
  if not private.knowledge_staff() or p_page_id is null or p_revision is null
    or p_template_id is null or p_remove is null then
    raise exception 'Wiki access denied' using errcode = '42501';
  end if;
  if p_organisation_id is not null then
    perform private.lock_company_course_author(p_organisation_id);
  end if;
  select * into page from public.wiki_pages where id = p_page_id for update;
  if not found or (page.owner_id <> auth.uid() and not private.has_permission('wiki.manage')) then
    raise exception 'Wiki edit denied' using errcode = '42501';
  end if;
  if page.archived then
    raise exception 'Archived wiki cannot be changed' using errcode = '42501';
  end if;
  if page.current_version is distinct from p_revision
    or page.published_version is not distinct from page.current_version then
    raise exception 'Save a new draft before changing course references' using errcode = '40001';
  end if;
  perform 1 from public.course_templates template where template.id = p_template_id
    and (p_remove or template.archived_at is null) for share;
  if not found or not private.wiki_template_in_scope(p_template_id, p_organisation_id) then
    raise exception 'Course template unavailable' using errcode = '42501';
  end if;
  if p_remove then
    delete from private.wiki_revision_course_templates
      where page_id = p_page_id and revision = p_revision and template_id = p_template_id;
    return;
  end if;
  if (select count(*) from private.wiki_revision_course_templates
      where page_id = p_page_id and revision = p_revision) >= 20
    and not exists (select 1 from private.wiki_revision_course_templates
      where page_id = p_page_id and revision = p_revision and template_id = p_template_id) then
    raise exception 'Course reference limit reached' using errcode = '54000';
  end if;
  insert into private.wiki_revision_course_templates(page_id, revision, template_id)
    values (p_page_id, p_revision, p_template_id) on conflict do nothing;
end;
$$;
create or replace function private.manage_wiki_course_template(
  p_page_id uuid, p_revision integer, p_template_id uuid, p_remove boolean
) returns void language sql security invoker set search_path = '' as $$
  select private.manage_wiki_course_template(p_page_id, p_revision, p_template_id, p_remove, null::uuid);
$$;
create function public.manage_wiki_course_template(
  p_page_id uuid, p_revision integer, p_template_id uuid, p_remove boolean, p_organisation_id uuid
) returns void language sql security invoker set search_path = '' as $$
  select private.manage_wiki_course_template(p_page_id, p_revision, p_template_id, p_remove, p_organisation_id);
$$;

revoke all on function private.wiki_course_templates(uuid,uuid), public.wiki_course_templates(uuid,uuid),
  private.wiki_course_template_choices(uuid,uuid), public.wiki_course_template_choices(uuid,uuid),
  private.manage_wiki_course_template(uuid,integer,uuid,boolean,uuid),
  public.manage_wiki_course_template(uuid,integer,uuid,boolean,uuid) from public, anon, authenticated, service_role;
grant execute on function private.wiki_course_templates(uuid,uuid), public.wiki_course_templates(uuid,uuid),
  private.wiki_course_template_choices(uuid,uuid), public.wiki_course_template_choices(uuid,uuid),
  private.manage_wiki_course_template(uuid,integer,uuid,boolean,uuid),
  public.manage_wiki_course_template(uuid,integer,uuid,boolean,uuid) to authenticated;

notify pgrst, 'reload schema';
commit;