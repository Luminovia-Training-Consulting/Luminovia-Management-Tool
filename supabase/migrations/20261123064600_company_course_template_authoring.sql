begin;

-- Pin the current account and company membership for the entire scoped write.
create function private.lock_company_course_author(p_organisation_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if (select edition from private.installation_identity) is distinct from 'internal'
     or not private.client_has_organisation(p_organisation_id) then
    raise exception 'Company course planning permission required' using errcode = '42501';
  end if;

  perform 1
  from public.client_organisation_memberships membership
  join public.organisations org on org.id = membership.organisation_id
  join public.profiles profile on profile.id = membership.user_id
  join public.user_roles account_role on account_role.user_id = profile.id
  where membership.user_id = auth.uid()
    and membership.organisation_id = p_organisation_id
    and membership.removed_at is null and org.archived_at is null
    and profile.active and account_role.role = 'client'
  for share of profile, account_role, membership, org;
  if not found then
    raise exception 'Company course planning permission required' using errcode = '42501';
  end if;
end;
$$;
revoke all on function private.lock_company_course_author(uuid) from public, anon, authenticated, service_role;

-- These scoped paths reuse the existing transactional save functions and
-- leave the management and Academy paths unchanged.
do $migration$
declare
  definition text;
  guard constant text := 'if not private.has_permission(''courses.manage'') then';
  template_guard constant text := $old$if not private.has_permission('courses.manage') then raise exception 'courses.manage and permission required' using errcode='42501';end if;$old$;
  run_guard text := $old$if not private.has_permission('courses.manage') then
    raise exception 'courses.manage and MFA required' using errcode = '42501';
  end if;$old$;
begin
  definition := pg_get_functiondef('private.save_course_template(uuid,jsonb)'::regprocedure);
  if cardinality(string_to_array(definition, template_guard)) <> 2 then
    raise exception 'Expected course template authorisation guard';
  end if;
  execute replace(definition, template_guard, $new$
  if not private.has_permission('courses.manage') then
    if jsonb_typeof(p_payload) is distinct from 'object'
       or (p_payload - array['title','description','syllabus','prerequisites','topic_ids','archived','owner_organisation_id']) <> '{}'::jsonb then
      raise exception 'Invalid company template fields' using errcode = '22023';
    end if;
    if p_id is null then
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
      end if;
      perform 1 from public.course_templates template
      where template.id = p_id and template.owner_organisation_id = owner_id
        and template.building_block_id is null and template.building_block_source_id is null
      for update;
      if not found then
        raise exception 'Company template is unavailable for editing' using errcode = '42501';
      end if;
      if exists (
        select 1 from public.course_runs run
        where run.template_id = p_id and run.published and run.archived_at is null
      ) then
        raise exception 'course_locked' using errcode = '22023';
      end if;
    end if;
  end if;$new$);

  definition := pg_get_functiondef('private.save_course_run(uuid,jsonb)'::regprocedure);
  if cardinality(string_to_array(definition, guard)) <> 2 then
    raise exception 'Expected course run authorisation guard';
  end if;
  -- The password-only migration is replayed before this grant. Accept either
  -- historic wording here because the older Academy definition was additive.
  if strpos(definition, run_guard) = 0 then
    run_guard := replace(run_guard, 'MFA required', 'permission required');
  end if;
  if cardinality(string_to_array(definition, run_guard)) <> 2 then
    raise exception 'Expected complete course run authorisation guard';
  end if;
  execute replace(definition, run_guard, $new$
  if not private.has_permission('courses.manage') then
    if p_id is not null then
      raise exception 'Company accounts can only create course drafts' using errcode = '42501';
    end if;
    if jsonb_typeof(p_payload) is distinct from 'object' or
       jsonb_typeof(p_payload->'sessions') is distinct from 'array'
       or (p_payload - array['template_id','organisation_id','time_zone','delivery_type','venue','sessions','published','archived']) <> '{}'::jsonb then
      raise exception 'Invalid company course draft fields' using errcode = '22023';
    end if;
    if coalesce(p_payload->'published','false'::jsonb) <> 'false'::jsonb
       or coalesce(p_payload->'archived','false'::jsonb) <> 'false'::jsonb then
      raise exception 'Company accounts can only create course drafts' using errcode = '42501';
    end if;
    perform private.lock_company_course_author(nullif(p_payload->>'organisation_id','')::uuid);
    perform 1 from public.course_templates template
    where template.id = (p_payload->>'template_id')::uuid
      and template.owner_organisation_id = (p_payload->>'organisation_id')::uuid
      and template.archived_at is null
    for share;
    if not found then
      raise exception 'Company template is unavailable for planning' using errcode = '42501';
    end if;
  end if;$new$);
end;
$migration$;

-- Serialize opening a run in the course catalogue with company template edits.
create trigger course_run_publication_template_owner
before update of published, archived_at on public.course_runs
for each row when (new.published and new.archived_at is null
                   and (not old.published or old.archived_at is not null))
execute function private.validate_course_template_owner();

-- A lecturer who can read the teaching offer can read its linked source
-- reference even while the corresponding run is private.
create or replace function private.can_read_building_block(p_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.actor_active()
    and (not private.has_role(array['client']) or private.has_permission('courses.manage')
         or (select edition from private.installation_identity) <> 'internal')
    and (private.has_permission('courses.manage') or exists (
      select 1
      from public.course_templates template
      join public.course_runs run on run.template_id = template.id
      where template.building_block_id = p_id and (
        private.can_read_course_run(run.id)
        or exists (
          select 1 from public.course_enrolments enrolment
          where enrolment.course_run_id = run.id and enrolment.user_id = auth.uid()
            and enrolment.status in ('enrolled', 'completed')
        )
        or (private.lecturer_actor() and exists (
          select 1 from public.jobs offer
          where offer.course_run_id = run.id and private.can_read_job(offer.id)
        ))
      )
    ));
$$;

commit;
