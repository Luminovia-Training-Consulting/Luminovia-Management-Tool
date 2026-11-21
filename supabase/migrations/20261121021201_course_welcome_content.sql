begin;

create table private.course_welcome_revisions (
  course_run_id uuid not null references public.course_runs(id) on delete cascade,
  version integer not null check (version > 0),
  description text not null check (char_length(description) <= 4000),
  objectives text not null check (char_length(objectives) <= 4000),
  joining_instructions text not null check (char_length(joining_instructions) <= 4000),
  published_by uuid references public.profiles(id) on delete set null,
  published_at timestamptz not null default now(),
  primary key (course_run_id, version)
);
alter table private.course_welcome_revisions enable row level security;
revoke all on private.course_welcome_revisions from public, anon, authenticated, service_role;

create function private.course_welcome_content(p_run_id uuid)
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
    'published_at', revision.published_at
  )
  into content from private.course_welcome_revisions revision
  where revision.course_run_id = p_run_id
  order by revision.version desc limit 1;
  return coalesce(content, jsonb_build_object(
    'version', 0, 'description', '', 'objectives', '',
    'joining_instructions', '', 'published_at', null
  ));
end;
$$;

create function private.publish_course_welcome_content(
  p_run_id uuid, p_description text, p_objectives text,
  p_joining_instructions text, p_expected_version integer
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  context jsonb;
  current_version integer;
begin
  -- Reject unrelated actors before attempting to lock the company and course.
  context := private.course_workspace_context(p_run_id);
  if not ((context->>'staff')::boolean or (context->>'client')::boolean) then
    raise exception 'Course welcome editor required' using errcode = '42501';
  end if;
  perform private.lock_course_premium(p_run_id);
  context := private.course_workspace_context(p_run_id);
  if not ((context->>'staff')::boolean or (context->>'client')::boolean) then
    raise exception 'Course welcome editor required' using errcode = '42501';
  end if;
  if p_expected_version is null or p_expected_version < 0 or
    p_description is null or char_length(p_description) > 4000 or
    p_objectives is null or char_length(p_objectives) > 4000 or
    p_joining_instructions is null or char_length(p_joining_instructions) > 4000
  then
    raise exception 'Invalid course welcome content' using errcode = '22023';
  end if;
  select coalesce(max(version), 0) into current_version
    from private.course_welcome_revisions where course_run_id = p_run_id;
  if current_version <> p_expected_version then
    raise exception 'Course welcome changed' using errcode = '40001';
  end if;
  insert into private.course_welcome_revisions(
    course_run_id, version, description, objectives, joining_instructions, published_by
  ) values (
    p_run_id, current_version + 1, trim(p_description), trim(p_objectives),
    trim(p_joining_instructions), auth.uid()
  );
  return private.course_welcome_content(p_run_id);
end;
$$;

create function public.course_welcome_content(p_run_id uuid)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.course_welcome_content(p_run_id); $$;

create function public.publish_course_welcome_content(
  p_run_id uuid, p_description text, p_objectives text,
  p_joining_instructions text, p_expected_version integer
)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.publish_course_welcome_content(
  p_run_id, p_description, p_objectives, p_joining_instructions, p_expected_version
); $$;

revoke all on function private.course_welcome_content(uuid),
  private.publish_course_welcome_content(uuid, text, text, text, integer),
  public.course_welcome_content(uuid),
  public.publish_course_welcome_content(uuid, text, text, text, integer)
from public, anon, authenticated, service_role;
grant execute on function private.course_welcome_content(uuid),
  private.publish_course_welcome_content(uuid, text, text, text, integer),
  public.course_welcome_content(uuid),
  public.publish_course_welcome_content(uuid, text, text, text, integer)
to authenticated;

commit;
