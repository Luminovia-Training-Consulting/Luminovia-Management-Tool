begin;

-- Keep the current link apart from the base venue, schedules, claims and public listings.
-- Audit changes without retaining the old invitation URL or meeting passcode.
create table private.course_meeting_links (
  course_run_id uuid primary key references public.course_runs(id) on delete cascade,
  url text,
  version integer not null check (version > 0)
);
alter table private.course_meeting_links enable row level security;
revoke all on private.course_meeting_links from public, anon, authenticated, service_role;

create function private.course_workspace_with_meeting_link(p_run_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  workspace jsonb := private.course_workspace(p_run_id);
  link private.course_meeting_links%rowtype;
begin
  if workspace->>'delivery_type' <> 'online' or (workspace->>'ended')::boolean then
    return workspace || jsonb_build_object('meeting_link', null);
  end if;
  select * into link from private.course_meeting_links where course_run_id = p_run_id;
  return workspace || jsonb_build_object(
    'meeting_link', jsonb_build_object(
      'url', link.url, 'version', coalesce(link.version, 0),
      'can_edit', (workspace#>>'{access,staff}')::boolean
    )
  );
end;
$$;

create or replace function public.course_workspace(p_run_id uuid)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.course_workspace_with_meeting_link(p_run_id); $$;

create function private.set_course_meeting_link(
  p_run_id uuid, p_url text, p_expected_version integer
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  context jsonb;
  authority text;
  port text;
  link private.course_meeting_links%rowtype;
  current_version integer;
begin
  context := private.course_workspace_context(p_run_id);
  if (context->>'staff')::boolean is not true then
    raise exception 'Course meeting link editor required' using errcode = '42501';
  end if;
  -- Serialize updates with other course writes and changes to Premium.
  perform private.lock_course_premium(p_run_id);
  context := private.course_workspace_context(p_run_id);
  if (context->>'staff')::boolean is not true or
     (context->>'lms_enabled')::boolean is not true or not exists (
       select 1 from public.course_runs run
       where run.id = p_run_id and run.archived_at is null and run.delivery_type = 'online'
         and coalesce((
           select max(session.ends_at) >= now()
           from public.course_sessions session where session.course_run_id = run.id
         ), true)
     ) then
    raise exception 'Course meeting link unavailable' using errcode = '42501';
  end if;
  if p_expected_version is null or p_expected_version < 0 then
    raise exception 'Invalid course meeting link version' using errcode = '22023';
  end if;
  if p_url is not null then
    -- Use the same printable ASCII HTTPS DNS-host grammar as the browser editor.
    -- Matching the authority separately also excludes embedded credentials.
    if char_length(p_url) > 2048 or p_url collate "C" !~ '^[!-~]+$' or
       strpos(p_url, chr(92)) > 0 then
      raise exception 'Invalid HTTPS course meeting link' using errcode = '22023';
    end if;
    authority := substring(p_url from '^https://([^/?#]+)');
    if authority is null or authority collate "C" !~
      '^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?[.])+[a-zA-Z]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(:[0-9]{1,5})?$'
      or char_length(split_part(authority, ':', 1)) > 253 then
      raise exception 'Invalid HTTPS course meeting link' using errcode = '22023';
    end if;
    port := nullif(split_part(authority, ':', 2), '');
    if port is not null and port::integer not between 1 and 65535 then
      raise exception 'Invalid HTTPS course meeting link' using errcode = '22023';
    end if;
  end if;
  select * into link from private.course_meeting_links where course_run_id = p_run_id;
  current_version := coalesce(link.version, 0);
  if current_version <> p_expected_version then
    raise exception 'Course meeting link changed' using errcode = '40001';
  end if;
  if link.url is distinct from p_url then
    current_version := current_version + 1;
    insert into private.course_meeting_links(course_run_id, url, version)
      values (p_run_id, p_url, current_version)
      on conflict (course_run_id) do update set url = excluded.url, version = excluded.version;
    insert into public.audit_events(actor_id, action, resource_id, details)
      values (auth.uid(), 'course.meeting_link.updated', p_run_id,
              jsonb_build_object('version', current_version, 'configured', p_url is not null));
  end if;
  return jsonb_build_object('url', p_url, 'version', current_version, 'can_edit', true);
end;
$$;

create function public.set_course_meeting_link(
  p_run_id uuid, p_url text, p_expected_version integer
)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.set_course_meeting_link(p_run_id, p_url, p_expected_version); $$;

revoke all on function private.course_workspace_with_meeting_link(uuid),
  private.set_course_meeting_link(uuid, text, integer),
  public.set_course_meeting_link(uuid, text, integer) from public, anon, authenticated, service_role;
grant execute on function private.course_workspace_with_meeting_link(uuid),
  private.set_course_meeting_link(uuid, text, integer),
  public.set_course_meeting_link(uuid, text, integer) to authenticated;

commit;
