begin;

-- The licensed text channel uses the existing resource-specific academy request gate.
create or replace function private.require_academy_course_access()
returns void language plpgsql stable security definer set search_path = '' as $$
declare
  request_path text := current_setting('request.path', true);
  request_method text := current_setting('request.method', true);
  request_headers jsonb := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
  licence_status text;
begin
  if current_setting('role', true) is distinct from 'authenticated'
     or coalesce(request_headers->>'accept-profile', 'public') <> 'public'
     or coalesce(request_headers->>'content-profile', 'public') <> 'public'
     or not private.learning_actor() then
    raise insufficient_privilege;
  end if;

  licence_status := private.academy_course_access_status();
  if licence_status in ('active', 'grace') and request_method in ('GET', 'HEAD', 'POST') and request_path in (
    '/rpc/portal_access', '/rpc/my_course_workspaces', '/rpc/course_workspace',
    '/rpc/course_workspace_entitlement', '/rpc/course_enrolments', '/rpc/course_welcome_content',
    '/rpc/course_chat_rooms', '/rpc/course_chat_messages'
  ) then
    return;
  end if;
  if licence_status in ('active', 'grace') and request_method = 'POST'
     and request_path = '/rpc/course_document_access' then
    return;
  end if;
  if licence_status = 'active' and (
    (request_method in ('GET', 'HEAD', 'POST') and request_path in (
      '/rpc/academy_course_instructor_candidates', '/rpc/course_enrolment_candidates'
    ))
    or (request_method = 'POST' and request_path in (
      '/rpc/academy_assign_course_instructor', '/rpc/academy_release_course_instructor',
      '/rpc/manage_course_enrolment', '/rpc/set_course_meeting_link', '/rpc/save_course_run',
      '/rpc/publish_course_welcome_content', '/rpc/academy_ensure_course_chat', '/rpc/send_course_chat_message'
    ))
  ) then
    return;
  end if;

  raise exception 'Academy course operation unavailable' using errcode = '42501';
end;
$$;

-- A technical assignment, retained membership or a different course never
-- substitutes for a current role and the exact installed course profile.
create function private.academy_course_chat_member(p_room_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(private.academy_course_access_status() in ('active', 'grace'), false) and exists (
    select 1 from public.chat_rooms room
    join public.course_runs run on run.id = room.course_run_id
    join public.chat_members member on member.room_id = room.id
    where room.id = p_room_id and room.kind = 'participant_course'
      and run.archived_at is null and private.course_lms_read_enabled(run.organisation_id)
      and member.user_id = auth.uid() and member.removed_at is null
      and (
        private.has_permission('courses.manage')
        or (private.lecturer_actor() and private.course_has_current_teacher(run.id))
        or (private.participant_actor() and private.active_company_participant(auth.uid(), run.organisation_id)
          and exists (
            select 1 from public.course_enrolments enrolment
            where enrolment.course_run_id = run.id and enrolment.user_id = auth.uid()
              and enrolment.status in ('enrolled', 'completed')
          )
        )
      )
  );
$$;
revoke all on function private.academy_course_chat_member(uuid) from public, anon, authenticated, service_role;

create function private.lock_academy_course_chat_poster(p_room_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  course_id uuid;
  company_id uuid;
begin
  perform private.lock_academy_course_access();
  perform 1 from public.profiles where id = auth.uid() and active for share;
  if not found then raise insufficient_privilege; end if;
  select run.id, org.id into course_id, company_id
  from public.chat_rooms room
  join public.course_runs run on run.id = room.course_run_id
  join public.organisations org on org.id = run.organisation_id
  where room.id = p_room_id and room.kind = 'participant_course'
    and run.archived_at is null and org.archived_at is null
  for no key update of run for share of org;
  if not found then raise insufficient_privilege; end if;
  if private.participant_actor() then
    perform 1 from private.company_participant_memberships
    where organisation_id = company_id and user_id = auth.uid() and status = 'active'
    for share;
    if not found then raise insufficient_privilege; end if;
    perform 1 from public.course_enrolments
    where course_run_id = course_id and user_id = auth.uid() and status in ('enrolled', 'completed')
    for share;
    if not found then raise insufficient_privilege; end if;
  end if;
  perform 1 from public.chat_rooms
  where id = p_room_id and course_run_id = course_id and kind = 'participant_course' for share;
  if not found or private.academy_course_chat_member(p_room_id) is not true then
    raise insufficient_privilege;
  end if;
end;
$$;
revoke all on function private.lock_academy_course_chat_poster(uuid) from public, anon, authenticated, service_role;

-- One participant channel per course, without creating a marketplace position.
create function private.academy_ensure_course_chat(p_run_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  channel_id uuid;
  channel_title text;
  company_id uuid;
  member_id uuid;
begin
  if not private.has_permission('courses.manage') then raise insufficient_privilege; end if;
  perform private.lock_academy_course_access();
  perform 1 from public.profiles where id = auth.uid() and active for share;
  if not found then raise insufficient_privilege; end if;
  select template.title, org.id into channel_title, company_id
  from public.course_runs run
  join public.course_templates template on template.id = run.template_id
  join public.organisations org on org.id = run.organisation_id
  where run.id = p_run_id and run.archived_at is null and org.archived_at is null
  for no key update of run for share of org;
  if not found or not private.has_permission('courses.manage') then raise insufficient_privilege; end if;

  select id into channel_id from public.chat_rooms
  where course_run_id = p_run_id and kind = 'participant_course' for update;
  if found then
    if private.academy_course_chat_member(channel_id) is not true then raise insufficient_privilege; end if;
    return channel_id;
  end if;
  insert into public.chat_rooms(kind, title, owner_id, course_run_id)
  values ('participant_course', left(channel_title, 120), auth.uid(), p_run_id)
  returning id into channel_id;
  insert into public.chat_members(room_id, user_id) values (channel_id, auth.uid());
  insert into private.participant_chat_origins(room_id, user_id, manual) values (channel_id, auth.uid(), true);

  for member_id in
    select enrolment.user_id from public.course_enrolments enrolment
    where enrolment.course_run_id = p_run_id and enrolment.status in ('enrolled', 'completed')
      and private.active_company_participant(enrolment.user_id, company_id)
    union
    select assignment.instructor_id from private.academy_course_instructors assignment
    join public.job_claims claim on claim.id = assignment.claim_id and claim.status = 'confirmed'
    where assignment.course_id = p_run_id and assignment.released_at is null
      and private.profile_staff(assignment.instructor_id)
  loop
    perform private.participant_chat_assignment_grant(channel_id, member_id);
    insert into public.chat_members(room_id, user_id) values (channel_id, member_id);
  end loop;
  insert into public.audit_events(actor_id, action, resource_id, details)
  values (auth.uid(), 'course.chat.opened', channel_id, jsonb_build_object('run_id', p_run_id));
  return channel_id;
end;
$$;
create function public.academy_ensure_course_chat(p_run_id uuid)
returns uuid language sql security invoker set search_path = ''
as $$ select private.academy_ensure_course_chat(p_run_id); $$;
revoke all on function private.academy_ensure_course_chat(uuid), public.academy_ensure_course_chat(uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.academy_ensure_course_chat(uuid), public.academy_ensure_course_chat(uuid)
  to authenticated;

create or replace function private.send_message(p_room_id uuid,p_body text,p_client_id uuid,p_document_id uuid default null) returns uuid language plpgsql security definer set search_path='' as $$
declare previous public.messages; result uuid; signature text; actor uuid:=auth.uid();
begin
 if (select edition from private.installation_identity) = 'internal' then
  if not private.can_access_chat_room(p_room_id) then raise exception 'Room access denied' using errcode='42501'; end if;
 else
  if p_document_id is not null then raise insufficient_privilege; end if;
  perform private.lock_academy_course_chat_poster(p_room_id);
 end if;
 if p_client_id is null or p_body is null or length(p_body)>8000 or (length(trim(p_body))=0 and p_document_id is null) then raise exception 'Invalid message' using errcode='22023'; end if;
 signature=md5(p_body||'|'||coalesce(p_document_id::text,''));
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('chat-send:'||actor::text,0));
 select * into previous from public.messages where sender_id=actor and client_id=p_client_id;
 if found then
  if previous.room_id<>p_room_id or previous.request_hash<>signature then raise exception 'Idempotency key conflicts with another message' using errcode='22023'; end if;
  return previous.id;
 end if;
 if p_document_id is not null and not private.can_attach_chat_document(p_document_id,p_room_id) then raise exception 'Attachment is not available' using errcode='42501'; end if;
 if (select count(*) from public.messages where sender_id=actor and created_at>clock_timestamp()-interval '1 minute')>=30 then raise exception 'Message rate limit reached' using errcode='P0001'; end if;
 -- Lock membership against removal until this send commits. A removed user cannot
 -- queue a send after revocation and bypass the fresh membership check.
 perform 1 from public.chat_members where room_id=p_room_id and user_id=actor and removed_at is null for share;
 if not found then raise exception 'Room access denied' using errcode='42501'; end if;
 insert into public.messages(room_id,sender_id,client_id,request_hash,body,document_id) values(p_room_id,actor,p_client_id,signature,p_body,p_document_id) returning id into result;
 insert into public.notifications(user_id,kind,resource_id) select m.user_id,'chat_message',result from public.chat_members m join public.profiles p on p.id=m.user_id where m.room_id=p_room_id and m.user_id<>actor and m.removed_at is null and not m.muted and p.active on conflict do nothing;
 return result;
end;$$;

create or replace function private.send_course_chat_message(
  p_room_id uuid, p_body text, p_client_id uuid
) returns uuid language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.chat_rooms room where room.id = p_room_id and room.kind = 'participant_course') then
    raise insufficient_privilege;
  end if;
  if (select edition from private.installation_identity) = 'internal' then
    perform private.lock_course_chat_poster(p_room_id);
  end if;
  return private.send_message(p_room_id, p_body, p_client_id, null);
end;
$$;

create or replace function private.course_chat_rooms(p_run_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  context jsonb;
  internal_edition boolean := (select edition = 'internal' from private.installation_identity);
  academy_active boolean := private.academy_course_access_status() = 'active';
begin
  context := private.course_workspace_context(p_run_id);
  if not coalesce((context->>'lms_enabled')::boolean, false) then
    raise exception 'company_premium_lms_off' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', room.id, 'title', room.title, 'can_post',
      case when internal_edition then private.can_access_chat_room(room.id)
           else coalesce(academy_active, false) end
    ) order by room.title, room.id)
    from public.chat_rooms room
    where room.course_run_id=p_run_id and room.kind='participant_course'
      and case when internal_edition
        then private.can_access_chat_room(room.id) or private.company_course_chat_reader(room.id)
        else private.academy_course_chat_member(room.id) end
  ), '[]'::jsonb);
end;
$$;

create or replace function private.course_chat_messages(
  p_room_id uuid, p_before_at timestamptz default null,
  p_before_id uuid default null, p_limit integer default 50
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare internal_edition boolean := (select edition = 'internal' from private.installation_identity);
begin
  if not exists (select 1 from public.chat_rooms where id = p_room_id and kind = 'participant_course')
    or not (case when internal_edition
      then private.can_access_chat_room(p_room_id) or private.company_course_chat_reader(p_room_id)
      else private.academy_course_chat_member(p_room_id) end) then
    raise exception 'Course chat unavailable' using errcode = '42501';
  end if;
  if p_limit is null or p_limit not between 1 and 100
    or ((p_before_at is null) <> (p_before_id is null))
    or (p_before_at is not null and not isfinite(p_before_at)) then
    raise exception 'Invalid course chat page' using errcode = '22023';
  end if;
  return coalesce((
    select jsonb_agg(to_jsonb(message) || jsonb_build_object('attachment', case when internal_edition then (
      select jsonb_build_object('version_id', a.version_id, 'name', a.name, 'size_bytes', a.size_bytes)
      from private.course_chat_attachment(message.id) a
    ) end) order by message.created_at, message.id)
    from (
      select m.id, m.sender_id, p.display_name as sender_name,
        case when m.deleted_at is null then m.body end as body, m.created_at, m.deleted_at
      from public.messages m join public.profiles p on p.id = m.sender_id
      where m.room_id = p_room_id
        and not exists(select 1 from private.chat_hidden_messages hidden
          where hidden.message_id = m.id and hidden.user_id = auth.uid())
        and (p_before_at is null or (m.created_at, m.id) < (p_before_at, p_before_id))
      order by m.created_at desc, m.id desc limit p_limit
    ) message
  ), '[]'::jsonb);
end;
$$;

-- Synchronize the new member only on successful allocation, after its
-- dedicated instructor receipt is written. Exact retries keep their receipt
-- path and do not resurrect a manually removed membership.
do $migration$
declare
  definition text := pg_catalog.pg_get_functiondef(
    'private.academy_assign_course_instructor_before_access(uuid,uuid,uuid)'::regprocedure
  );
  receipt constant text := $old$
    insert into private.academy_course_instructors(course_id,instructor_id,claim_id,assigned_by,request_id)
      values(p_course_id,p_instructor_id,(v_result->>'claim_id')::uuid,auth.uid(),p_request_id);
    return v_result;$old$;
begin
  if strpos(definition, receipt) = 0 or strpos(definition, '  v_job_id uuid;') = 0 then
    raise exception 'Unexpected academy assignment receipt definition';
  end if;
  definition := replace(definition, '  v_job_id uuid;', E'  v_job_id uuid;\n  channel_id uuid;');
  execute replace(definition, receipt, $new$
    insert into private.academy_course_instructors(course_id,instructor_id,claim_id,assigned_by,request_id)
      values(p_course_id,p_instructor_id,(v_result->>'claim_id')::uuid,auth.uid(),p_request_id);
    select room.id into channel_id from public.chat_rooms room
      where room.course_run_id = p_course_id and room.kind = 'participant_course' for update;
    if found then
      perform private.participant_chat_assignment_grant(channel_id, p_instructor_id);
      insert into public.chat_members(room_id, user_id) values (channel_id, p_instructor_id)
      on conflict (room_id, user_id) do update
      set removed_at = null, joined_at = clock_timestamp()
      where public.chat_members.removed_at is not null;
    end if;
    return v_result;$new$);
end;
$migration$;

-- Only the opaque marker may traverse Realtime. The raw messages, their
-- reactions, memberships and all Storage byte routes keep their existing fences.
create or replace function private.can_read_course_chat_activity(p_room_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.chat_rooms room
    where room.id = p_room_id and room.kind = 'participant_course'
      and case when (select edition from private.installation_identity) = 'internal'
        then private.can_access_chat_room(room.id) or private.company_course_chat_reader(room.id)
        else private.academy_course_chat_member(room.id) end
  );
$$;
alter policy portal_internal_transport on public.course_chat_activity
using (
  (select coalesce((select edition = 'internal' from public.installation_capability_state), false))
  or private.can_read_course_chat_activity(room_id)
);

notify pgrst, 'reload schema';
commit;
