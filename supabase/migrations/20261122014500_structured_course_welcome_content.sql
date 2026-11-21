begin;

alter table private.course_welcome_revisions
  add column heading text not null default '' check (char_length(heading) <= 120),
  add column welcome_message text not null default '' check (char_length(welcome_message) <= 4000),
  add column schedule_information text not null default '' check (char_length(schedule_information) <= 4000),
  add column contact_instructions text not null default '' check (char_length(contact_instructions) <= 4000),
  add column protect_instructions boolean not null default false,
  add column attachment_ids uuid[] not null default '{}'::uuid[] check (cardinality(attachment_ids) <= 12);

-- Store references to existing shares. Selecting an attachment grants no access to the file.
create function private.course_welcome_attachment_eligible(p_run_id uuid, p_resource_id uuid)
returns boolean language sql stable security invoker set search_path = ''
as $$
  select exists (
    select 1
    from private.course_resources resource
    join public.document_versions version on version.id = resource.version_id
    join public.documents document on document.id = version.document_id
    where resource.id = p_resource_id and resource.run_id = p_run_id
      and resource.removed_at is null and resource.category = 'material'
      and resource.audience in ('all', 'participants')
      and version.status = 'clean' and version.sha256 ~ '^[0-9a-f]{64}$'
      and document.deleted_at is null
      and not private.deletion_document_fenced(document.id)
      and not private.course_document_is_dedicated(document.id)
  );
$$;

create or replace function private.course_welcome_content(p_run_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  context jsonb := private.course_workspace_context(p_run_id);
  content jsonb;
begin
  if (context->>'lms_enabled')::boolean is not true then
    raise exception 'Course welcome unavailable' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'version', revision.version,
    'description', revision.description,
    'objectives', revision.objectives,
    'joining_instructions', revision.joining_instructions,
    'heading', revision.heading,
    'welcome_message', revision.welcome_message,
    'schedule_information', revision.schedule_information,
    'contact_instructions', revision.contact_instructions,
    'protect_instructions', revision.protect_instructions,
    'attachment_ids', coalesce((
      select jsonb_agg(attachment.id order by attachment.position)
      from unnest(revision.attachment_ids) with ordinality as attachment(id, position)
      where private.course_welcome_attachment_eligible(p_run_id, attachment.id)
        and private.course_resource_allowed(attachment.id)
    ), '[]'::jsonb),
    'published_at', revision.published_at
  )
  into content from private.course_welcome_revisions revision
  where revision.course_run_id = p_run_id
  order by revision.version desc limit 1;

  return coalesce(content, jsonb_build_object(
    'version', 0, 'description', '', 'objectives', '', 'joining_instructions', '',
    'heading', '', 'welcome_message', '', 'schedule_information', '', 'contact_instructions', '',
    'protect_instructions', false, 'attachment_ids', '[]'::jsonb, 'published_at', null
  ));
end;
$$;

-- Both wire formats reach one version check and one authorisation decision.
create function private.write_course_welcome_content(
  p_run_id uuid, p_payload jsonb, p_expected_version integer, p_legacy boolean
)
returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
  context jsonb;
  current_revision private.course_welcome_revisions%rowtype;
  current_version integer;
  can_protect boolean;
  new_heading text;
  new_welcome text;
  new_schedule text;
  new_contact text;
  new_joining text;
  new_protection boolean;
  attachments uuid[];
  retained_attachments uuid[];
  visible_attachments uuid[];
  hidden_attachments uuid[];
  description_fields constant text[] := array['description', 'objectives', 'joining_instructions'];
  additional_fields constant text[] :=
    array['heading', 'welcome_message', 'schedule_information', 'contact_instructions'];
begin
  context := private.course_workspace_context(p_run_id);
  if ((context->>'staff')::boolean or (context->>'client')::boolean) is not true then
    raise exception 'Course welcome editor required' using errcode = '42501';
  end if;

  if (select edition from private.installation_identity) = 'internal' then
    perform private.lock_course_premium(p_run_id);
  else
    perform private.lock_academy_course_access();
    perform 1 from public.course_runs run
    join public.organisations organisation on organisation.id = run.organisation_id
    where run.id = p_run_id and run.archived_at is null and organisation.archived_at is null
    for no key update of run for share of organisation;
    if not found then raise insufficient_privilege; end if;
  end if;

  context := private.course_workspace_context(p_run_id);
  if ((context->>'staff')::boolean or (context->>'client')::boolean) is not true
    or (context->>'lms_enabled')::boolean is not true then
    raise exception 'Course welcome editor required' using errcode = '42501';
  end if;
  can_protect := (context->>'manager')::boolean or (context->>'client')::boolean;

  if p_expected_version is null or p_expected_version < 0
    or jsonb_typeof(p_payload) is distinct from 'object'
    or exists (
      select 1 from unnest(description_fields) as field(name)
      where jsonb_typeof(p_payload->field.name) is distinct from 'string'
        or char_length(p_payload->>field.name) > 4000
    ) then
    raise exception 'Invalid course welcome content' using errcode = '22023';
  end if;

  -- Course locks serialise all publishers, including callers using the old format.
  select * into current_revision from private.course_welcome_revisions
  where course_run_id = p_run_id order by version desc limit 1;
  current_version := coalesce(current_revision.version, 0);
  if current_version <> p_expected_version then
    raise exception 'Course welcome changed' using errcode = 'PT409';
  end if;
  if current_version = 2147483647 then
    raise exception 'Course welcome version limit reached' using errcode = 'PT409';
  end if;

  new_joining := btrim(p_payload->>'joining_instructions');
  if p_legacy then
    new_heading := coalesce(current_revision.heading, '');
    new_welcome := coalesce(current_revision.welcome_message, '');
    new_schedule := coalesce(current_revision.schedule_information, '');
    new_contact := coalesce(current_revision.contact_instructions, '');
    new_protection := coalesce(current_revision.protect_instructions, false);
    attachments := coalesce(current_revision.attachment_ids, '{}'::uuid[]);
  else
    if p_payload - (description_fields || additional_fields || array['protect_instructions', 'attachment_ids']) <> '{}'::jsonb
      or exists (
        select 1 from unnest(additional_fields) as field(name)
        where jsonb_typeof(p_payload->field.name) is distinct from 'string'
          or char_length(p_payload->>field.name) > case when field.name = 'heading' then 120 else 4000 end
      )
      or jsonb_typeof(p_payload->'protect_instructions') is distinct from 'boolean'
      or jsonb_typeof(p_payload->'attachment_ids') is distinct from 'array' then
      raise exception 'Invalid course welcome content' using errcode = '22023';
    end if;
    new_heading := btrim(p_payload->>'heading');
    new_welcome := btrim(p_payload->>'welcome_message');
    new_schedule := btrim(p_payload->>'schedule_information');
    new_contact := btrim(p_payload->>'contact_instructions');
    new_protection := (p_payload->>'protect_instructions')::boolean;
  end if;

  if not can_protect and (
    new_protection is distinct from coalesce(current_revision.protect_instructions, false)
    or (current_revision.protect_instructions and (
      new_joining is distinct from current_revision.joining_instructions
      or new_schedule is distinct from current_revision.schedule_information
      or new_contact is distinct from current_revision.contact_instructions
    ))
  ) then
    raise exception 'Protected course welcome instructions require course management' using errcode = '42501';
  end if;

  if not p_legacy then
    if jsonb_array_length(p_payload->'attachment_ids') > 12 or exists (
      select 1 from jsonb_array_elements_text(p_payload->'attachment_ids') as attachment(id)
      where (attachment.id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') is not true
    ) then
      raise exception 'Invalid course welcome attachments' using errcode = '22023';
    end if;
    select coalesce(array_agg(attachment.id::uuid order by attachment.position), '{}'::uuid[])
      into attachments from jsonb_array_elements_text(p_payload->'attachment_ids')
        with ordinality as attachment(id, position);
    if cardinality(attachments) <> (select count(distinct id) from unnest(attachments) as attachment(id)) then
      raise exception 'Duplicate course welcome attachments' using errcode = '22023';
    end if;

    if exists (
      select 1 from unnest(attachments) as attachment(id)
      where not private.course_welcome_attachment_eligible(p_run_id, attachment.id)
        or not private.course_resource_allowed(attachment.id)
    ) then
      raise exception 'Course welcome attachment unavailable' using errcode = '42501';
    end if;

    -- Company callers may edit the welcome without seeing learner-only shares.
    -- Keep the learner's attachment order when the editor has not changed their selection.
    select
      coalesce(array_agg(prior.id order by prior.position), '{}'::uuid[]),
      coalesce(array_agg(prior.id order by prior.position) filter (where prior.visible), '{}'::uuid[]),
      coalesce(array_agg(prior.id order by prior.position) filter (where not prior.visible), '{}'::uuid[])
    into retained_attachments, visible_attachments, hidden_attachments
    from (
      select attachment.id, attachment.position, private.course_resource_allowed(attachment.id) as visible
      from unnest(current_revision.attachment_ids) with ordinality as attachment(id, position)
      where private.course_welcome_attachment_eligible(p_run_id, attachment.id)
    ) prior;
    if attachments = visible_attachments then
      attachments := retained_attachments;
    else
      attachments := attachments || hidden_attachments;
    end if;
    if cardinality(attachments) > 12 then
      raise exception 'Course welcome attachment limit reached' using errcode = '22023';
    end if;
  end if;

  insert into private.course_welcome_revisions(
    course_run_id, version, description, objectives, joining_instructions,
    heading, welcome_message, schedule_information, contact_instructions,
    protect_instructions, attachment_ids, published_by
  ) values (
    p_run_id, current_version + 1, btrim(p_payload->>'description'), btrim(p_payload->>'objectives'),
    new_joining, new_heading, new_welcome, new_schedule, new_contact,
    new_protection, attachments, auth.uid()
  );

  return private.course_welcome_content(p_run_id);
end;
$$;

create or replace function private.publish_course_welcome_content(
  p_run_id uuid, p_description text, p_objectives text,
  p_joining_instructions text, p_expected_version integer
)
returns jsonb language sql security definer set search_path = ''
as $$
  select private.write_course_welcome_content(p_run_id, jsonb_build_object(
    'description', p_description, 'objectives', p_objectives,
    'joining_instructions', p_joining_instructions
  ), p_expected_version, true);
$$;

create function private.publish_course_welcome_content(p_run_id uuid, p_payload jsonb, p_expected_version integer)
returns jsonb language sql security definer set search_path = ''
as $$
  select private.write_course_welcome_content(p_run_id, p_payload, p_expected_version, false);
$$;

create function public.publish_course_welcome_content(p_run_id uuid, p_payload jsonb, p_expected_version integer)
returns jsonb language sql security invoker set search_path = ''
as $$
  select private.publish_course_welcome_content(p_run_id, p_payload, p_expected_version);
$$;

revoke all on function private.course_welcome_attachment_eligible(uuid, uuid),
  private.write_course_welcome_content(uuid, jsonb, integer, boolean),
  private.publish_course_welcome_content(uuid, jsonb, integer),
  public.publish_course_welcome_content(uuid, jsonb, integer)
from public, anon, authenticated, service_role;
grant execute on function private.publish_course_welcome_content(uuid, jsonb, integer),
  public.publish_course_welcome_content(uuid, jsonb, integer)
to authenticated;

notify pgrst, 'reload schema';
commit;
