begin;

create table private.course_content_revisions (
  course_run_id uuid not null references public.course_runs(id) on delete restrict,
  version integer not null check (version > 0),
  content jsonb not null,
  published_by uuid references public.profiles(id) on delete set null,
  published_at timestamptz not null default now(),
  primary key (course_run_id, version)
);

create table private.course_content_drafts (
  course_run_id uuid primary key references public.course_runs(id) on delete restrict,
  base_version integer not null check (base_version >= 0),
  version integer not null check (version > 0),
  content jsonb not null,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table private.course_content_revisions enable row level security;
alter table private.course_content_drafts enable row level security;
revoke all on private.course_content_revisions, private.course_content_drafts
  from public, anon, authenticated, service_role;

alter table public.course_enrolments add column course_content_version integer;
alter table public.course_enrolments add constraint course_enrolments_content_revision_fk
  foreign key (course_run_id, course_content_version)
  references private.course_content_revisions(course_run_id, version);
create index course_content_revisions_history
  on private.course_content_revisions(course_run_id, published_at desc);

create function private.course_authoring_document_valid(p_document jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  valid boolean;
begin
  if p_document is null or jsonb_typeof(p_document) is distinct from 'object' then
    return false;
  end if;
  if p_document->>'type' is distinct from 'doc'
     or jsonb_typeof(p_document->'content') is distinct from 'array'
     or octet_length(p_document::text) > 200000 then
    return false;
  end if;
  if exists (
    select 1 from jsonb_object_keys(p_document) key where key not in ('type', 'content')
  ) then
    return false;
  end if;

  with recursive nodes(value, depth) as (
    select p_document, 0
    union all
    select child.value, nodes.depth + 1
    from nodes
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(nodes.value->'content') = 'array'
        then nodes.value->'content' else '[]'::jsonb end
    ) child(value)
  )
  select coalesce(bool_and(
    depth <= 16
    and jsonb_typeof(value) = 'object'
    and value->>'type' is not null
    and value->>'type' in (
      'doc', 'paragraph', 'text', 'heading', 'bulletList', 'orderedList',
      'listItem', 'blockquote', 'codeBlock', 'hardBreak', 'horizontalRule'
    )
    and not exists (
      select 1 from jsonb_object_keys(
        case when jsonb_typeof(value) = 'object' then value else '{}'::jsonb end
      ) key
      where key not in ('type', 'content', 'text', 'attrs', 'marks')
    )
    and (not value ? 'content' or jsonb_typeof(value->'content') = 'array')
    and (value->>'type' <> 'text' or (
      jsonb_typeof(value->'text') is not distinct from 'string'
      and char_length(value->>'text') <= 20000
    ))
    and (not value ? 'text' or value->>'type' = 'text')
    and (not value ? 'attrs' or (
      value->>'type' in ('heading', 'codeBlock') and jsonb_typeof(value->'attrs') = 'object'
    ))
    and (value->>'type' <> 'heading' or (
      jsonb_typeof(value->'attrs') is not distinct from 'object'
      and value->'attrs' ? 'level'
      and coalesce(value->'attrs'->>'level' in ('1', '2', '3'), false)
      and not exists (
        select 1 from jsonb_object_keys(
          case when jsonb_typeof(value->'attrs') = 'object'
            then value->'attrs' else '{}'::jsonb end
        ) key where key <> 'level'
      )
    ))
    and (value->>'type' <> 'codeBlock' or (
      not coalesce(value->'attrs' ? 'language', false) or (
        jsonb_typeof(value->'attrs'->'language') is not distinct from 'string'
        and coalesce((value->'attrs'->>'language') ~ '^[a-zA-Z0-9_+-]{0,30}$', false)
      )
    )) and (value->>'type' <> 'codeBlock' or not exists (
      select 1 from jsonb_object_keys(
        case when jsonb_typeof(value->'attrs') = 'object'
          then value->'attrs' else '{}'::jsonb end
      ) key where key <> 'language'
    ))
    and (not value ? 'marks' or jsonb_typeof(value->'marks') = 'array')
  ), false) into valid from nodes;

  if not valid or exists (
    with recursive nodes(value) as (
      select p_document
      union all
      select child.value
      from nodes
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(nodes.value->'content') = 'array'
          then nodes.value->'content' else '[]'::jsonb end
      ) child(value)
    )
    select 1 from nodes
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(nodes.value->'marks') = 'array'
        then nodes.value->'marks' else '[]'::jsonb end
    ) mark(value)
    where jsonb_typeof(mark.value) is distinct from 'object'
      or mark.value->>'type' is null
      or mark.value->>'type' not in ('bold', 'italic', 'strike', 'code', 'link')
      or exists (
        select 1 from jsonb_object_keys(
          case when jsonb_typeof(mark.value) = 'object' then mark.value else '{}'::jsonb end
        ) key
        where key not in ('type', 'attrs')
      )
      or (mark.value->>'type' = 'link' and (
        jsonb_typeof(mark.value->'attrs') is distinct from 'object'
        or jsonb_typeof(mark.value->'attrs'->'href') is distinct from 'string'
        or (mark.value->'attrs'->>'href') ~ '[[:space:][:cntrl:]\\]'
        or not (
          (mark.value->'attrs'->>'href') ~* '^https?://'
          or (mark.value->'attrs'->>'href') ~* '^mailto:[^[:cntrl:]]+$'
          or (left(mark.value->'attrs'->>'href', 1) = '/' and
              left(mark.value->'attrs'->>'href', 2) <> '//')
        )
        or exists (
          select 1 from jsonb_object_keys(
            case when jsonb_typeof(mark.value->'attrs') = 'object'
              then mark.value->'attrs' else '{}'::jsonb end
          ) key where key not in ('href', 'target', 'rel')
        )
        or (mark.value->'attrs' ? 'target' and mark.value->'attrs'->>'target' is distinct from '_blank')
        or (mark.value->'attrs' ? 'rel' and mark.value->'attrs'->>'rel' is distinct from 'noopener noreferrer')
      ))
      or (mark.value->>'type' <> 'link' and mark.value ? 'attrs')
  ) then
    return false;
  end if;
  return true;
end;
$$;

create function private.course_authoring_content_valid(p_content jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  module jsonb;
  lesson jsonb;
  id_count integer;
  unique_id_count integer;
begin
  if p_content is null or jsonb_typeof(p_content) is distinct from 'object' then
    return false;
  end if;
  if jsonb_typeof(p_content->'modules') is distinct from 'array'
     or octet_length(p_content::text) > 500000 then
    return false;
  end if;
  if jsonb_array_length(p_content->'modules') > 40 or exists (
    select 1 from jsonb_object_keys(p_content) key where key <> 'modules'
  ) then
    return false;
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_content->'modules') item(value)
    where jsonb_typeof(value) is distinct from 'object'
      or jsonb_typeof(value->'id') is distinct from 'string'
      or (value->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or jsonb_typeof(value->'title') is distinct from 'string'
      or char_length(btrim(value->>'title')) not between 1 and 150
      or jsonb_typeof(value->'description') is distinct from 'string'
      or char_length(value->>'description') > 1000
      or jsonb_typeof(value->'lessons') is distinct from 'array'
      or case when jsonb_typeof(value->'lessons') = 'array'
        then jsonb_array_length(value->'lessons') > 100 else false end
      or exists (
        select 1 from jsonb_object_keys(value) key
        where key not in ('id', 'title', 'description', 'lessons')
      )
  ) then
    return false;
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_content->'modules') module(value)
    cross join lateral jsonb_array_elements(module.value->'lessons') lesson(value)
    where jsonb_typeof(lesson.value) is distinct from 'object'
      or jsonb_typeof(lesson.value->'id') is distinct from 'string'
      or (lesson.value->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or jsonb_typeof(lesson.value->'title') is distinct from 'string'
      or char_length(btrim(lesson.value->>'title')) not between 1 and 150
      or jsonb_typeof(lesson.value->'objectives') is distinct from 'string'
      or char_length(lesson.value->>'objectives') > 1000
      or jsonb_typeof(lesson.value->'duration_minutes') is distinct from 'number'
      or (lesson.value->>'duration_minutes') !~ '^(0|[1-9][0-9]{0,3})$'
      or case when (lesson.value->>'duration_minutes') ~ '^(0|[1-9][0-9]{0,3})$'
        then (lesson.value->>'duration_minutes')::integer > 1440 else false end
      or not private.course_authoring_document_valid(lesson.value->'body')
      or exists (
        select 1 from jsonb_object_keys(lesson.value) key
        where key not in ('id', 'title', 'objectives', 'duration_minutes', 'body')
      )
  ) then
    return false;
  end if;

  select count(*), count(distinct id) into id_count, unique_id_count
  from (
    select lower(value->>'id') id from jsonb_array_elements(p_content->'modules') module(value)
    union all
    select lower(lesson.value->>'id')
    from jsonb_array_elements(p_content->'modules') module(value)
    cross join lateral jsonb_array_elements(module.value->'lessons') lesson(value)
  ) all_ids;
  if id_count <> unique_id_count then return false; end if;

  for module in select value from jsonb_array_elements(p_content->'modules') item(value) loop
    for lesson in select value from jsonb_array_elements(module->'lessons') item(value) loop
      if not private.course_authoring_document_valid(lesson->'body') then
        return false;
      end if;
    end loop;
  end loop;
  return true;
end;
$$;

alter table private.course_content_revisions
  add constraint course_content_revisions_valid check (private.course_authoring_content_valid(content));
alter table private.course_content_drafts
  add constraint course_content_drafts_valid check (private.course_authoring_content_valid(content));

create function private.pin_course_content_version()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (tg_op = 'INSERT' and new.status in ('enrolled', 'completed')) or
     (tg_op = 'UPDATE' and old.status = 'removed' and new.status = 'enrolled'
       and old.course_content_version is null) then
    select max(version) into new.course_content_version
    from private.course_content_revisions revision
    where revision.course_run_id = new.course_run_id;
  end if;
  return new;
end;
$$;
create trigger course_enrolment_pin_content_version
before insert or update of status on public.course_enrolments
for each row execute function private.pin_course_content_version();

create function private.course_content_studio(p_run_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  context jsonb;
  latest_version integer;
  visible_version integer;
  visible_content jsonb;
  visible_at timestamptz;
  draft private.course_content_drafts%rowtype;
  enrolment public.course_enrolments%rowtype;
begin
  context := private.course_workspace_context(p_run_id);
  if (context->>'lms_enabled')::boolean is not true or
     (context->>'staff')::boolean is not true and (context->>'learner')::boolean is not true then
    raise exception 'Course curriculum unavailable' using errcode = '42501';
  end if;
  select max(version) into latest_version
  from private.course_content_revisions where course_run_id = p_run_id;

  if (context->>'staff')::boolean then
    visible_version := coalesce(latest_version, 0);
  else
    select * into enrolment from public.course_enrolments
    where course_run_id = p_run_id and user_id = auth.uid()
      and status in ('enrolled', 'completed');
    if not found then raise insufficient_privilege; end if;
    visible_version := coalesce(enrolment.course_content_version, 0);
  end if;

  select revision.content, revision.published_at
  into visible_content, visible_at
  from private.course_content_revisions revision
  where revision.course_run_id = p_run_id and revision.version = visible_version;

  if (context->>'staff')::boolean then
    select * into draft from private.course_content_drafts
    where course_run_id = p_run_id;
    return jsonb_build_object(
      'can_edit', true,
      'published_version', coalesce(latest_version, 0),
      'published_content', coalesce(visible_content, jsonb_build_object('modules', '[]'::jsonb)),
      'published_at', visible_at,
      'draft_version', coalesce(draft.version, 0),
      'draft_base_version', coalesce(draft.base_version, coalesce(latest_version, 0)),
      'draft_content', draft.content,
      'versions', coalesce((
        select jsonb_agg(jsonb_build_object(
          'version', revision.version, 'published_at', revision.published_at,
          'module_count', jsonb_array_length(revision.content->'modules')
        ) order by revision.version desc)
        from private.course_content_revisions revision
        where revision.course_run_id = p_run_id
      ), '[]'::jsonb)
    );
  end if;

  return jsonb_build_object(
    'can_edit', false,
    'published_version', visible_version,
    'published_content', coalesce(visible_content, jsonb_build_object('modules', '[]'::jsonb)),
    'published_at', visible_at,
    'draft_version', 0,
    'draft_base_version', 0,
    'draft_content', null,
    'versions', '[]'::jsonb
  );
end;
$$;

create function private.course_content_action(p_run_id uuid, p_action text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  context jsonb;
  actor_id uuid := auth.uid();
  course_org_id uuid;
  current_version integer;
  current_draft private.course_content_drafts%rowtype;
  source_revision private.course_content_revisions%rowtype;
  target_user uuid;
  target_version integer;
  expected_version integer;
  expected_draft integer;
begin
  context := private.course_workspace_context(p_run_id);
  if (context->>'staff')::boolean is not true then
    raise exception 'Assigned course author required' using errcode = '42501';
  end if;
  if p_action is null or p_action not in ('save_draft', 'publish', 'restore', 'migrate') or
     p_payload is null or jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception 'Invalid course authoring action' using errcode = '22023';
  end if;

  if (select edition from private.installation_identity) = 'internal' then
    perform private.lock_course_premium(p_run_id);
  else
    perform private.lock_academy_course_access();
    perform 1 from public.profiles where id = actor_id and active for share;
    if not found then raise insufficient_privilege; end if;
    perform 1 from public.user_roles where user_id = actor_id order by role for share;
    select organisation.id into course_org_id
    from public.course_runs run
    join public.organisations organisation on organisation.id = run.organisation_id
    where run.id = p_run_id and run.archived_at is null and organisation.archived_at is null
    for no key update of run for share of organisation;
    if not found then raise insufficient_privilege; end if;
    perform 1 from public.client_organisation_memberships membership
    where membership.organisation_id = course_org_id and membership.user_id = actor_id
    for share;
    perform 1 from public.job_claims claim
    join public.jobs job on job.id = claim.job_id
    where job.course_run_id = p_run_id and claim.lecturer_id = actor_id
      and claim.status = 'confirmed'
    for share of claim;
  end if;
  context := private.course_workspace_context(p_run_id);
  if (context->>'lms_enabled')::boolean is not true or
     (context->>'staff')::boolean is not true then
    raise exception 'Assigned course author required' using errcode = '42501';
  end if;

  select coalesce(max(version), 0) into current_version
  from private.course_content_revisions where course_run_id = p_run_id;
  if p_action in ('save_draft', 'publish', 'restore') then
    if jsonb_typeof(p_payload->'published_version') is distinct from 'number'
       or (p_payload->>'published_version') !~ '^(0|[1-9][0-9]{0,8})$'
       or jsonb_typeof(p_payload->'draft_version') is distinct from 'number'
       or (p_payload->>'draft_version') !~ '^(0|[1-9][0-9]{0,8})$' then
      raise exception 'Invalid course revision version' using errcode = '22023';
    end if;
    expected_version := (p_payload->>'published_version')::integer;
    expected_draft := (p_payload->>'draft_version')::integer;
    if current_version <> expected_version then
      raise exception 'Published course content changed' using errcode = 'PT409';
    end if;
    select * into current_draft from private.course_content_drafts
    where course_run_id = p_run_id for update;
    if coalesce(current_draft.version, 0) <> expected_draft or
       (found and current_draft.base_version <> current_version) then
      raise exception 'Course draft changed' using errcode = 'PT409';
    end if;
  end if;

  if p_action = 'save_draft' then
    if not private.course_authoring_content_valid(p_payload->'content') then
      raise exception 'Invalid course curriculum' using errcode = '22023';
    end if;
    insert into private.course_content_drafts(
      course_run_id, base_version, version, content, updated_by
    ) values (
      p_run_id, current_version, 1, p_payload->'content', auth.uid()
    ) on conflict (course_run_id) do update set
      version = private.course_content_drafts.version + 1,
      content = excluded.content,
      updated_by = auth.uid(),
      updated_at = now();
  elsif p_action = 'publish' then
    if not found then
      raise exception 'Save a course draft before publishing' using errcode = '22023';
    end if;
    if not private.course_authoring_content_valid(current_draft.content) then
      raise exception 'Invalid course curriculum' using errcode = '22023';
    end if;
    insert into private.course_content_revisions(
      course_run_id, version, content, published_by
    ) values (p_run_id, current_version + 1, current_draft.content, auth.uid());
    delete from private.course_content_drafts where course_run_id = p_run_id;
    update public.course_enrolments set course_content_version = current_version + 1
    where course_run_id = p_run_id and status = 'enrolled' and course_content_version is null;
    insert into public.audit_events(actor_id, action, resource_id)
    values (auth.uid(), 'course.content.published', p_run_id);
  elsif p_action = 'restore' then
    if jsonb_typeof(p_payload->'source_version') is distinct from 'number'
       or (p_payload->>'source_version') !~ '^[1-9][0-9]{0,8}$' then
      raise exception 'Invalid source revision' using errcode = '22023';
    end if;
    select * into source_revision from private.course_content_revisions
    where course_run_id = p_run_id and version = (p_payload->>'source_version')::integer;
    if not found then raise exception 'Course revision unavailable' using errcode = '42501'; end if;
    insert into private.course_content_drafts(
      course_run_id, base_version, version, content, updated_by
    ) values (
      p_run_id, current_version, 1, source_revision.content, auth.uid()
    ) on conflict (course_run_id) do update set
      version = private.course_content_drafts.version + 1,
      base_version = current_version,
      content = excluded.content,
      updated_by = auth.uid(),
      updated_at = now();
  elsif p_action = 'migrate' then
    if (context->>'manager')::boolean is not true then
      raise exception 'Course management required for participant migration' using errcode = '42501';
    end if;
    if jsonb_typeof(p_payload->'target_version') is distinct from 'number'
       or (p_payload->>'target_version') !~ '^[1-9][0-9]{0,8}$'
       or jsonb_typeof(p_payload->'user_id') is distinct from 'string'
       or (p_payload->>'user_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Invalid participant content migration' using errcode = '22023';
    end if;
    target_version := (p_payload->>'target_version')::integer;
    target_user := (p_payload->>'user_id')::uuid;
    if target_version > current_version or not exists (
      select 1 from private.course_content_revisions
      where course_run_id = p_run_id and version = target_version
    ) then
      raise exception 'Target course revision unavailable' using errcode = '42501';
    end if;
    select enrolment.course_content_version into expected_version
    from public.course_enrolments enrolment
    where course_run_id = p_run_id and user_id = target_user and status = 'enrolled'
    for update;
    if not found then raise exception 'Active course enrolment required' using errcode = '42501'; end if;
    if expected_version = target_version then return private.course_content_studio(p_run_id); end if;
    if expected_version > target_version then
      raise exception 'Target revision must be newer than the current revision' using errcode = '22023';
    end if;
    update public.course_enrolments set course_content_version = target_version
    where course_run_id = p_run_id and user_id = target_user;
    insert into public.audit_events(actor_id, action, resource_id)
    values (
      auth.uid(),
      format('course.content.participant_migrated:%s:revision_%s', target_user, target_version),
      p_run_id
    );
  end if;
  return private.course_content_studio(p_run_id);
end;
$$;

create function public.course_content_studio(p_run_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.course_content_studio(p_run_id);
$$;
create function public.course_content_action(p_run_id uuid, p_action text, p_payload jsonb)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.course_content_action(p_run_id, p_action, p_payload);
$$;

revoke all on function private.course_authoring_document_valid(jsonb),
  private.course_authoring_content_valid(jsonb), private.pin_course_content_version(),
  private.course_content_studio(uuid), private.course_content_action(uuid, text, jsonb),
  public.course_content_studio(uuid), public.course_content_action(uuid, text, jsonb)
from public, anon, authenticated, service_role;
grant execute on function private.course_authoring_document_valid(jsonb),
  private.course_authoring_content_valid(jsonb), private.course_content_studio(uuid),
  private.course_content_action(uuid, text, jsonb),
  public.course_content_studio(uuid), public.course_content_action(uuid, text, jsonb)
to authenticated;

do $$
declare
  definition text := pg_catalog.pg_get_functiondef(
    'private.require_academy_course_access()'::regprocedure
  );
  read_path constant text := '''/rpc/course_session_register''';
  read_paths constant text := '''/rpc/course_session_register'', ''/rpc/course_content_studio''';
  write_path constant text := '''/rpc/save_course_session_attendance''';
  write_paths constant text := '''/rpc/save_course_session_attendance'', ''/rpc/course_content_action''';
begin
  if cardinality(string_to_array(definition, read_path)) <> 2 or
     cardinality(string_to_array(definition, write_path)) <> 2 then
    raise exception 'Expected one Academy course read and write allowlist boundary';
  end if;
  execute replace(
    replace(definition, read_path, read_paths),
    write_path,
    write_paths
  );
end;
$$;

alter function private.require_portal_access()
  rename to require_portal_access_before_course_content;
create function private.require_portal_access()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if current_setting('request.path', true) = '/rpc/course_content_studio'
     and current_setting('request.method', true) in ('GET', 'HEAD', 'POST')
     and (select edition from private.installation_identity) = 'internal'
     and private.participant_actor() then
    return;
  end if;
  perform private.require_portal_access_before_course_content();
end;
$$;
revoke all on function private.require_portal_access_before_course_content(),
  private.require_portal_access()
from public, anon, authenticated, service_role;
grant execute on function private.require_portal_access() to authenticated;

notify pgrst, 'reload schema';
commit;