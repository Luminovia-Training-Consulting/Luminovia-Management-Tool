begin;

-- The link owns sharing rights separately from the personal document used by
-- the existing scanner/versioned Storage pipeline. Older staff shares stay staff-owned.
alter table private.course_resources
  add column ownership_kind text not null default 'staff'
    check (ownership_kind in ('staff', 'company', 'lecturer'));

create function private.keep_course_resource_owner()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.ownership_kind is distinct from old.ownership_kind or
     new.created_by is distinct from old.created_by then
    raise exception 'Course resource ownership is immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger keep_course_resource_owner
before update of ownership_kind, created_by on private.course_resources
for each row execute function private.keep_course_resource_owner();
revoke all on function private.keep_course_resource_owner()
  from public, anon, authenticated, service_role;

-- Only the Premium-locked action boundary below invokes this helper. The
-- caller's current course role, document ownership and exact clean version are
-- checked again after locks, never inferred from a submitted owner field.
create function private.course_resource_command(
  p_run_id uuid, p_action text, p_payload jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  context jsonb;
  actor_id uuid := auth.uid();
  v_version_id uuid;
  document_id uuid;
  document_row public.documents%rowtype;
  resource_row private.course_resources%rowtype;
  owner_kind text;
  v_audience text;
  v_category text;
begin
  perform 1 from public.profiles where id = actor_id and active for share;
  if not found then raise exception 'Active course account required' using errcode = '42501'; end if;
  context := private.course_workspace_context(p_run_id);
  if not coalesce((context->>'lms_enabled')::boolean, false) then
    raise exception 'company_premium_lms_off' using errcode = '42501';
  end if;

  if p_action = 'resource_share' then
    if not ((context->>'manager')::boolean or (context->>'teacher')::boolean or
            (context->>'client')::boolean) then
      raise exception 'Course sharing permission required' using errcode = '42501';
    end if;
    v_audience := p_payload->>'audience';
    v_category := p_payload->>'category';
    if v_audience is null or v_audience not in ('staff', 'client', 'participants', 'all') or
       v_category is null or v_category not in ('material', 'report') then
      raise exception 'Invalid course resource audience or category' using errcode = '22023';
    end if;
    v_version_id := (p_payload->>'version_id')::uuid;
    select version.document_id into document_id
    from public.document_versions version where version.id = v_version_id;
    select * into document_row from public.documents
    where id = document_id for update;
    if not found then raise exception 'Course document unavailable' using errcode = '42501'; end if;
    perform 1 from public.document_versions version
    where version.id = v_version_id and version.document_id = document_row.id and
          version.status = 'clean' and version.sha256 is not null for share;
    if not found or document_row.deleted_at is not null or
       document_row.kind <> 'material' or
       private.course_document_is_dedicated(document_row.id) then
      raise exception 'Reviewed course material required' using errcode = '42501';
    end if;
    -- A document lock may have waited while roles changed. Re-read authority
    -- after that wait before publishing any new or revived link.
    context := private.course_workspace_context(p_run_id);
    if not coalesce((context->>'lms_enabled')::boolean, false) or
       not ((context->>'manager')::boolean or (context->>'teacher')::boolean or
            (context->>'client')::boolean) then
      raise exception 'Course sharing permission required' using errcode = '42501';
    end if;
    -- A lecturer/company member may publish only their own uploaded material.
    -- Staff retain the existing same-course job-material selection.
    if not ((document_row.scope = 'personal' and document_row.owner_id = actor_id) or
            ((context->>'manager')::boolean and exists (
              select 1 from public.jobs job
              where job.id = document_row.job_id and job.course_run_id = p_run_id
            ))) then
      raise exception 'Own or authorised course material required' using errcode = '42501';
    end if;
    owner_kind := case when (context->>'manager')::boolean then 'staff'
                       when (context->>'client')::boolean then 'company'
                       else 'lecturer' end;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'course-resource:' || p_run_id || ':' || v_version_id || ':' || v_audience, 0));
    select * into resource_row from private.course_resources
    where run_id = p_run_id and version_id = v_version_id and audience = v_audience
    for update;
    if found then
      if not (context->>'manager')::boolean and
         (resource_row.ownership_kind <> owner_kind or
          resource_row.created_by <> actor_id) then
        raise exception 'Resource owner required' using errcode = '42501';
      end if;
      update private.course_resources set removed_at = null, category = v_category
      where id = resource_row.id returning * into resource_row;
    else
      insert into private.course_resources
        (run_id, version_id, audience, category, created_by, ownership_kind)
      values (p_run_id, v_version_id, v_audience, v_category, actor_id, owner_kind)
      returning * into resource_row;
    end if;
  elsif p_action = 'resource_remove' then
    select * into resource_row from private.course_resources
    where id = (p_payload->>'id')::uuid and run_id = p_run_id and removed_at is null
    for update;
    if not found then raise exception 'Course resource unavailable' using errcode = '42501'; end if;
    context := private.course_workspace_context(p_run_id);
    if not ((context->>'manager')::boolean or
            ((context->>'client')::boolean and resource_row.ownership_kind = 'company') or
            ((context->>'teacher')::boolean and resource_row.ownership_kind = 'lecturer' and
             resource_row.created_by = actor_id)) then
      raise exception 'Resource owner required' using errcode = '42501';
    end if;
    update private.course_resources set removed_at = now()
    where id = resource_row.id returning * into resource_row;
  else
    raise exception 'Unsupported course resource command' using errcode = '22023';
  end if;
  insert into public.audit_events(actor_id, action, resource_id, details)
  values (actor_id, 'course.' || p_action, resource_row.id,
          jsonb_build_object('run_id', p_run_id, 'ownership_kind', resource_row.ownership_kind,
                             'version_id', resource_row.version_id));
  return jsonb_build_object('id', resource_row.id);
end;
$$;
revoke all on function private.course_resource_command(uuid, text, jsonb)
  from public, anon, authenticated, service_role;

create or replace function private.course_workspace_action(
  p_run_id uuid, p_action text, p_payload jsonb,
  p_expected_version integer default 0
) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.lock_course_premium(p_run_id);
  if p_action in ('resource_share', 'resource_remove') then
    return private.course_resource_command(p_run_id, p_action, p_payload);
  end if;
  return private.course_workspace_action_before_premium(
    p_run_id, p_action, p_payload, p_expected_version
  );
end;
$$;

-- Keep the original current-Premium read gate, then annotate already-authorised
-- visible rows with immutable ownership and current command affordance.
create or replace function private.course_workspace(p_run_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  context jsonb;
  result jsonb;
  resources jsonb;
begin
  context := private.course_workspace_context(p_run_id);
  if not coalesce((context->>'lms_enabled')::boolean, false) then
    raise exception 'company_premium_lms_off' using errcode = '42501';
  end if;
  result := private.course_workspace_before_premium(p_run_id);
  select coalesce(jsonb_agg(entry.value || jsonb_build_object(
    'ownership_kind', resource.ownership_kind,
    'can_remove', (context->>'manager')::boolean or
      ((context->>'client')::boolean and resource.ownership_kind = 'company') or
      ((context->>'teacher')::boolean and resource.ownership_kind = 'lecturer' and
       resource.created_by = auth.uid())
  ) order by entry.ordinality), '[]'::jsonb) into resources
  from jsonb_array_elements(result->'resources') with ordinality as entry(value, ordinality)
  join private.course_resources resource on resource.id = (entry.value->>'id')::uuid;
  return jsonb_set(result || jsonb_build_object('lms_enabled', true, 'exams', private.course_exams(p_run_id)),
                   '{resources}', resources);
end;
$$;

commit;
