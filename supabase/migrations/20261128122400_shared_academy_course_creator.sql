begin;

-- Use the existing owned, revisioned draft store in licensed installations.
create or replace function private.require_course_creator_access() returns void
language plpgsql stable security invoker set search_path = '' as $$
begin
  if auth.uid() is null or not private.has_permission('courses.manage') then
    raise insufficient_privilege;
  end if;
  if (select edition from private.installation_identity) is distinct from 'internal'
     and (private.academy_course_access_status() is distinct from 'active'
          or not private.learning_actor()) then
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
    ('private.require_academy_course_access()',
     $old$  licence_status := private.academy_course_access_status();$old$,
     $new$  licence_status := private.academy_course_access_status();
  if licence_status = 'active' and request_method = 'POST'
    and request_path in ('/rpc/course_creator_drafts', '/rpc/course_creator_draft_action') then return; end if;$new$),
    ('private.course_creator_drafts(uuid)',
     $old$and (draft.enquiry_id is null or private.has_permission('organisations.manage'))$old$,
     $new$and (draft.enquiry_id is null or (
          (select edition from private.installation_identity) = 'internal'
          and private.has_permission('organisations.manage')))
        and (draft.next_action is distinct from 'offer'
          or (select edition from private.installation_identity) = 'internal')$new$),
    ('private.course_creator_draft_action(text,uuid,integer,jsonb)',
     $old$  perform pg_advisory_xact_lock(hashtextextended('course-creator:' || actor::text, 0));$old$,
     $new$  perform pg_advisory_xact_lock(hashtextextended('course-creator:' || actor::text, 0));
  if (select edition from private.installation_identity) is distinct from 'internal' then
    perform private.lock_academy_course_access();
    perform 1 from public.profiles where id = actor and active for share;
    if not found then raise insufficient_privilege; end if;
    perform 1 from public.user_roles where user_id = actor order by role for share;
    if p_action = 'start_enquiry' then raise insufficient_privilege; end if;
  end if;$new$),
    ('private.course_creator_draft_action(text,uuid,integer,jsonb)',
     $old$where id = p_draft_id and owner_id = actor for update;$old$,
     $new$where id = p_draft_id and owner_id = actor
    and ((enquiry_id is null and next_action is distinct from 'offer')
      or (select edition from private.installation_identity) = 'internal')
  for update;$new$),
    ('private.course_creator_draft_action(text,uuid,integer,jsonb)',
     $old$    selected_organisation := nullif(run_payload->>'organisation_id', '')::uuid;$old$,
     $new$    selected_organisation := nullif(run_payload->>'organisation_id', '')::uuid;
    if (select edition from private.installation_identity) is distinct from 'internal' then
      if next_step <> 'course' or run_payload ? 'operational_preset' then raise insufficient_privilege; end if;
      if selected_organisation is null or not exists (
        select 1 from pg_timezone_names where name = run_payload->>'time_zone'
      ) then raise invalid_parameter_value; end if;
    end if;$new$),
    ('private.academy_course_draft_options(text,text)',
     $old$where archived_at is null and strpos(lower(name),lower(btrim(p_organisation_query))) > 0$old$,
     $new$where archived_at is null and (
        id::text = p_organisation_query or strpos(lower(name),lower(btrim(p_organisation_query))) > 0
      )$new$),
    ('private.academy_course_draft_options(text,text)',
     $old$jsonb_agg(to_jsonb(item) order by item.title,item.id)$old$,
     $new$jsonb_agg(jsonb_strip_nulls(to_jsonb(item)) order by item.title,item.id)$new$),
    ('private.academy_course_draft_options(text,text)',
     $old$select id,title from public.course_templates$old$,
     $new$select id,title,owner_organisation_id from public.course_templates$new$),
    ('private.academy_course_draft_options(text,text)',
     $old$where archived_at is null and strpos(lower(title),lower(btrim(p_template_query))) > 0$old$,
     $new$where archived_at is null and (
        id::text = p_template_query or strpos(lower(title),lower(btrim(p_template_query))) > 0
      )$new$)
  ) as patches(signature, existing, replacement) loop
    definition := pg_catalog.pg_get_functiondef(patch.signature::regprocedure);
    if cardinality(string_to_array(definition, patch.existing)) <> 2 then
      raise exception 'Expected Academy course creator integration point in %', patch.signature;
    end if;
    execute replace(definition, patch.existing, patch.replacement);
  end loop;
end;
$migration$;

notify pgrst, 'reload schema';
commit;
