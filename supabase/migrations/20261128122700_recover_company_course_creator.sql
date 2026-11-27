begin;

-- Apply the same company-owned template scope to unfinished snapshots as to
-- final creation. The completed receipt is scoped to its actual course.
create function private.company_course_creator_source(p_run jsonb) returns boolean
language sql stable security invoker set search_path = '' as $$
  select exists (
    select 1 from public.course_templates template
    where template.id = case when pg_input_is_valid(p_run->>'template_id','uuid')
      then (p_run->>'template_id')::uuid end
      and template.owner_organisation_id::text = p_run->>'organisation_id'
      and template.archived_at is null
      and private.client_has_organisation(template.owner_organisation_id)
  )
$$;

create function private.company_course_creator_receipt(p_row private.course_creator_drafts) returns boolean
language sql stable security invoker set search_path = '' as $$
  select p_row.enquiry_id is null and (
    (p_row.state = 'editing' and private.company_course_creator_source(p_row.payload->'run'))
    or (p_row.state = 'created' and p_row.next_action = 'course' and exists (
      select 1 from public.course_runs run
      where run.id = p_row.course_run_id and private.client_has_organisation(run.organisation_id)
    ))
  )
$$;

revoke all on function private.company_course_creator_source(jsonb),
  private.company_course_creator_receipt(private.course_creator_drafts)
  from public, anon, authenticated, service_role;

create or replace function private.require_course_creator_access() returns void
language plpgsql stable security invoker set search_path = '' as $$
begin
  if auth.uid() is null then raise insufficient_privilege; end if;
  if (select edition from private.installation_identity) = 'internal' then
    if not private.has_permission('courses.manage')
      and not (private.actor_active() and private.has_role(array['client'])) then
      raise insufficient_privilege;
    end if;
  elsif not private.has_permission('courses.manage')
     or private.academy_course_access_status() is distinct from 'active'
     or not private.learning_actor() then
    raise insufficient_privilege;
  end if;
end;
$$;

do $migration$
declare
  patch record;
  definition text;
begin
  for patch in select * from (values
    ('private.course_creator_drafts(uuid)',
     $old$and (p_draft_id is null or draft.id = p_draft_id)$old$,
     $new$and (p_draft_id is null or draft.id = p_draft_id)
        and (private.has_permission('courses.manage') or private.company_course_creator_receipt(draft))$new$),
    ('private.course_creator_draft_action(text,uuid,integer,jsonb)',
     $old$  actor uuid := auth.uid();$old$,
     $new$  actor uuid := auth.uid();
  company_author boolean := not private.has_permission('courses.manage');
  company_scope uuid;$new$),
    ('private.course_creator_draft_action(text,uuid,integer,jsonb)',
     $old$  if p_action='start_enquiry' then$old$,
     $new$  if company_author then
    if p_action = 'start_enquiry'
       or (entry.id is not null and not private.company_course_creator_receipt(entry))
       or (p_action = 'save' and not private.company_course_creator_source(p_payload->'run')) then
      raise insufficient_privilege;
    end if;
    if entry.id is not null then
      if entry.state = 'created' then
        select organisation_id into company_scope from public.course_runs where id = entry.course_run_id;
      else
        company_scope := (entry.payload#>>'{run,organisation_id}')::uuid;
      end if;
    elsif p_action = 'save' then
      company_scope := (p_payload#>>'{run,organisation_id}')::uuid;
    end if;
    perform private.lock_company_course_author(company_scope);
    if p_action = 'save' and p_payload#>>'{run,organisation_id}' <> company_scope::text then
      raise insufficient_privilege;
    end if;
    if p_action = 'create_course' and entry.state = 'editing' and (
      p_payload->>'next_action' is distinct from 'course'
      or jsonb_typeof(p_payload->'content') is distinct from 'null'
      or p_payload#>>'{run,organisation_id}' is distinct from company_scope::text
      or p_payload#>>'{run,template_id}' is distinct from entry.payload#>>'{run,template_id}'
      or (p_payload->'run') ? 'operational_preset'
    ) then
      raise insufficient_privilege;
    end if;
  end if;
  if p_action='start_enquiry' then$new$)
  ) as patches(signature, existing, replacement) loop
    definition := pg_catalog.pg_get_functiondef(patch.signature::regprocedure);
    if cardinality(string_to_array(definition, patch.existing)) <> 2 then
      raise exception 'Expected company course creator integration point in %', patch.signature;
    end if;
    execute replace(definition, patch.existing, patch.replacement);
  end loop;
end;
$migration$;

notify pgrst, 'reload schema';
commit;
