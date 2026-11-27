begin;

-- Own in-progress form state and immutable creation receipts. No browser role
-- has table privileges; all operations recheck the live internal entitlement.
create table private.course_creator_drafts (
  id uuid primary key,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  revision integer not null default 1 check (revision > 0),
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 196608),
  updated_at timestamptz not null default now(),
  state text not null default 'editing' check (state in ('editing', 'created', 'discarded')),
  course_run_id uuid references public.course_runs(id) on delete set null,
  next_action text check (next_action in ('course', 'offer')),
  check ((state = 'created') = (next_action is not null))
);
create index course_creator_drafts_owner_recent_idx
  on private.course_creator_drafts (owner_id, updated_at desc, id)
  where state <> 'discarded';
create index course_creator_drafts_course_idx
  on private.course_creator_drafts (course_run_id)
  where course_run_id is not null;
alter table private.course_creator_drafts enable row level security;
revoke all on private.course_creator_drafts from public, anon, authenticated, service_role;

create function private.require_course_creator_access() returns void
language plpgsql stable security invoker set search_path = '' as $$
begin
  if auth.uid() is null or not private.has_permission('courses.manage')
     or not exists (select 1 from private.installation_identity where edition = 'internal') then
    raise insufficient_privilege;
  end if;
end;
$$;

create function private.course_creator_draft_receipt(
  p_row private.course_creator_drafts, p_include_payload boolean
) returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'id', p_row.id, 'revision', p_row.revision, 'updated_at', p_row.updated_at,
    'title', coalesce(nullif(btrim(p_row.payload#>>'{content,title}'), ''),
      (select title from public.course_templates
       where id = case when pg_catalog.pg_input_is_valid(p_row.payload#>>'{run,template_id}', 'uuid')
         then (p_row.payload#>>'{run,template_id}')::uuid end),
      (select template.title from public.course_runs run join public.course_templates template
       on template.id = run.template_id where run.id = p_row.course_run_id), ''),
    'state', p_row.state, 'course_run_id', p_row.course_run_id, 'next_action', p_row.next_action,
    'payload', case when p_include_payload and p_row.state = 'editing' then p_row.payload else null end
  );
$$;

create function private.course_creator_drafts(p_draft_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_course_creator_access();
  return coalesce((
    select jsonb_agg(private.course_creator_draft_receipt(item, p_draft_id is not null)
      order by (item.state = 'editing') desc, item.updated_at desc, item.id)
    from (
      select * from private.course_creator_drafts draft
      where draft.owner_id = auth.uid() and draft.state <> 'discarded'
        and (draft.state = 'editing' or draft.course_run_id is not null)
        and (p_draft_id is null or draft.id = p_draft_id)
      order by (draft.state = 'editing') desc, draft.updated_at desc, draft.id limit 120
    ) item
  ), '[]'::jsonb);
end;
$$;

create function private.course_creator_draft_action(
  p_action text, p_draft_id uuid, p_expected_revision integer, p_payload jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  entry private.course_creator_drafts;
  duplicate_entry private.course_creator_drafts;
  new_id uuid;
  selected_template uuid;
  selected_organisation uuid;
  created_course uuid;
  next_step text;
  run_payload jsonb;
  content_payload jsonb;
begin
  perform private.require_course_creator_access();
  if p_action is null or p_action not in ('save', 'duplicate', 'discard', 'create_course')
    or p_draft_id is null or p_expected_revision is null or p_expected_revision < 0
    or jsonb_typeof(p_payload) is distinct from 'object'
    or octet_length(p_payload::text) > 196608 then
    raise exception 'Invalid course creator request' using errcode = '22023';
  end if;

  -- Serialize writes from this owner, including first saves and quota checks.
  perform pg_advisory_xact_lock(hashtextextended('course-creator:' || actor::text, 0));
  perform private.require_course_creator_access();
  select * into entry from private.course_creator_drafts
  where id = p_draft_id and owner_id = actor for update;

  if p_action = 'save' then
    if (p_payload - array['run', 'content']) <> '{}'::jsonb
       or jsonb_typeof(p_payload->'run') is distinct from 'object'
       or jsonb_typeof(p_payload->'content') is distinct from 'object'
       or char_length(coalesce(p_payload#>>'{content,title}', '')) > 200 then
      raise exception 'Invalid course creator draft' using errcode = '22023';
    end if;
    if entry.id is null then
      if p_expected_revision <> 0 then raise insufficient_privilege; end if;
      if (select count(*) from private.course_creator_drafts where owner_id = actor and state = 'editing') >= 100 then
        raise exception 'Course creator draft limit reached' using errcode = '54000';
      end if;
      insert into private.course_creator_drafts(id, owner_id, payload)
      values (p_draft_id, actor, p_payload) on conflict do nothing returning * into entry;
      if entry.id is null then raise insufficient_privilege; end if;
      return private.course_creator_draft_receipt(entry, true);
    end if;
  end if;

  if entry.id is null then raise insufficient_privilege; end if;
  if p_action = 'create_course' and entry.state = 'created'
     and p_expected_revision in (entry.revision, entry.revision - 1) then
    -- A lost response can be retried against the same revision and draft id.
    return private.course_creator_draft_receipt(entry, false);
  end if;
  if p_action = 'discard' and entry.state = 'discarded'
     and p_expected_revision in (entry.revision, entry.revision - 1) then
    return private.course_creator_draft_receipt(entry, false);
  end if;
  if entry.state <> 'editing' then
    raise exception 'Course creator draft has already been closed' using errcode = '40001';
  end if;
  if p_action = 'save' and entry.payload = p_payload
     and p_expected_revision in (entry.revision, entry.revision - 1) then
    return private.course_creator_draft_receipt(entry, true);
  end if;
  if entry.revision <> p_expected_revision then
    raise exception 'Course creator draft has changed' using errcode = '40001';
  end if;

  if p_action = 'save' then
    update private.course_creator_drafts set payload = p_payload, revision = revision + 1, updated_at = now()
    where id = entry.id returning * into entry;
  elsif p_action = 'discard' then
    update private.course_creator_drafts set payload = '{}', state = 'discarded', revision = revision + 1, updated_at = now()
    where id = entry.id returning * into entry;
  elsif p_action = 'duplicate' then
    if (p_payload - 'new_id') <> '{}'::jsonb then
      raise exception 'Invalid course creator duplicate' using errcode = '22023';
    end if;
    new_id := nullif(p_payload->>'new_id', '')::uuid;
    if new_id is null or new_id = entry.id then
      raise exception 'Invalid course creator duplicate identifier' using errcode = '22023';
    end if;
    select * into duplicate_entry from private.course_creator_drafts where id = new_id and owner_id = actor;
    if duplicate_entry.id is not null and duplicate_entry.state = 'editing'
       and duplicate_entry.revision = 1 and duplicate_entry.payload = entry.payload then
      return private.course_creator_draft_receipt(duplicate_entry, true);
    end if;
    if (select count(*) from private.course_creator_drafts where owner_id = actor and state = 'editing') >= 100 then
      raise exception 'Course creator draft limit reached' using errcode = '54000';
    end if;
    insert into private.course_creator_drafts(id, owner_id, payload)
    values (new_id, actor, entry.payload) on conflict do nothing returning * into entry;
    if entry.id is null then raise insufficient_privilege; end if;
  else
    run_payload := p_payload->'run';
    content_payload := p_payload->'content';
    next_step := p_payload->>'next_action';
    if (p_payload - array['run', 'content', 'next_action']) <> '{}'::jsonb
       or jsonb_typeof(run_payload) is distinct from 'object'
       or (run_payload - array['template_id', 'organisation_id', 'time_zone', 'delivery_type', 'venue', 'sessions']) <> '{}'::jsonb
       or next_step is null or next_step not in ('course', 'offer') then
      raise exception 'Invalid course creator confirmation' using errcode = '22023';
    end if;
    selected_organisation := nullif(run_payload->>'organisation_id', '')::uuid;
    if next_step = 'offer' and (not private.has_permission('jobs.manage') or selected_organisation is null) then
      raise exception 'Offer preparation requires jobs.manage and an organisation' using errcode = '42501';
    end if;
    if selected_organisation is not null then
      perform 1 from public.organisations where id = selected_organisation and archived_at is null for share;
      if not found then raise exception 'Course organisation unavailable' using errcode = '22023'; end if;
    end if;
    selected_template := nullif(run_payload->>'template_id', '')::uuid;
    if selected_template is null then
      if jsonb_typeof(content_payload) is distinct from 'object'
         or (content_payload - array['title', 'description', 'syllabus', 'prerequisites', 'topic_ids']) <> '{}'::jsonb then
        raise exception 'Invalid course creator template' using errcode = '22023';
      end if;
      selected_template := private.save_course_template(null, content_payload ||
        jsonb_build_object('owner_organisation_id', selected_organisation));
    else
      perform 1 from public.course_templates where id = selected_template and archived_at is null for share;
      if not found then raise exception 'Course template unavailable' using errcode = '22023'; end if;
    end if;
    -- Template, course, session writes and recovery receipt commit together.
    created_course := private.save_course_run(null, run_payload ||
      jsonb_build_object('template_id', selected_template, 'published', false, 'archived', false));
    update private.course_creator_drafts
    set payload = '{}', state = 'created', course_run_id = created_course,
        next_action = next_step, revision = revision + 1, updated_at = now()
    where id = entry.id returning * into entry;
  end if;
  return private.course_creator_draft_receipt(entry, true);
end;
$$;

create function public.course_creator_drafts(p_draft_id uuid default null) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select private.course_creator_drafts(p_draft_id);
$$;
create function public.course_creator_draft_action(
  p_action text, p_draft_id uuid, p_expected_revision integer, p_payload jsonb
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.course_creator_draft_action(p_action, p_draft_id, p_expected_revision, p_payload);
$$;

revoke all on function private.require_course_creator_access(),
  private.course_creator_draft_receipt(private.course_creator_drafts, boolean),
  private.course_creator_drafts(uuid), public.course_creator_drafts(uuid),
  private.course_creator_draft_action(text, uuid, integer, jsonb),
  public.course_creator_draft_action(text, uuid, integer, jsonb)
from public, anon, authenticated, service_role;
grant execute on function private.course_creator_drafts(uuid), public.course_creator_drafts(uuid),
  private.course_creator_draft_action(text, uuid, integer, jsonb),
  public.course_creator_draft_action(text, uuid, integer, jsonb) to authenticated;

commit;
