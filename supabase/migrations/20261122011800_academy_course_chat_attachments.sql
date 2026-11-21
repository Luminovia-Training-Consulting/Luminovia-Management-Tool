begin;

-- Scope one immutable scanner reservation to the exact participant channel.
alter table private.academy_course_material_intake
  add column room_id uuid references public.chat_rooms(id),
  drop constraint academy_course_material_intake_purpose_check,
  add constraint academy_course_material_intake_purpose_check check (
    purpose in ('material', 'student_exam', 'exam_staff', 'course_chat')
    and ((purpose = 'course_chat') = (room_id is not null))
  );

-- The caller and scanner use the same predicate. The worker gets the actor
-- from the reserved version. A company contact, moderator or administrator
-- does not acquire access merely through their role or the course ID.
create function private.academy_course_chat_actor_member(p_room_id uuid, p_actor_id uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select coalesce(private.academy_course_access_status() in ('active', 'grace'), false) and exists (
    select 1 from public.chat_rooms room
    join public.course_runs run on run.id = room.course_run_id
    join public.chat_members member on member.room_id = room.id
    join public.profiles profile on profile.id = member.user_id and profile.active
    where room.id = p_room_id and room.kind = 'participant_course'
      and run.archived_at is null and private.course_lms_read_enabled(run.organisation_id)
      and member.user_id = p_actor_id and member.removed_at is null
      and (
        exists (
          select 1 from public.user_roles role
          join public.role_permissions permission using (role)
          where role.user_id = p_actor_id and permission.permission = 'courses.manage'
            and role.role in ('owner', 'admin', 'management', 'lecturer', 'senior_lecturer', 'client')
        )
        or (private.lecturer_user(p_actor_id) and private.academy_course_teacher(run.id, p_actor_id))
        or (private.active_company_participant(p_actor_id, run.organisation_id)
          and exists (select 1 from auth.users identity where identity.id = p_actor_id and identity.email_confirmed_at is not null)
          and exists (
            select 1 from public.course_enrolments enrolment
            where enrolment.course_run_id = run.id and enrolment.user_id = p_actor_id
              and enrolment.status in ('enrolled', 'completed')
          )
        )
      )
  );
$$;
revoke all on function private.academy_course_chat_actor_member(uuid, uuid) from public, anon, authenticated, service_role;

create or replace function private.academy_course_chat_member(p_room_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.academy_course_chat_actor_member(p_room_id, auth.uid());
$$;

create function private.lock_academy_course_chat_actor(p_room_id uuid, p_actor_id uuid)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  course_id uuid;
  company_id uuid;
begin
  perform private.lock_academy_course_access();
  perform 1 from public.profiles where id = p_actor_id and active for share;
  if not found then raise insufficient_privilege; end if;
  perform 1 from public.user_roles where user_id = p_actor_id order by role for share;
  select run.id, org.id into course_id, company_id
  from public.chat_rooms room
  join public.course_runs run on run.id = room.course_run_id
  join public.organisations org on org.id = run.organisation_id
  where room.id = p_room_id and room.kind = 'participant_course'
    and run.archived_at is null and org.archived_at is null
  for no key update of run for share of org;
  if not found then raise insufficient_privilege; end if;
  if exists (select 1 from public.user_roles where user_id = p_actor_id and role = 'participant')
    and not exists (select 1 from public.user_roles where user_id = p_actor_id and role <> 'participant') then
    perform 1 from private.company_participant_memberships
    where organisation_id = company_id and user_id = p_actor_id and status = 'active' for share;
    if not found then raise insufficient_privilege; end if;
    perform 1 from public.course_enrolments
    where course_run_id = course_id and user_id = p_actor_id and status in ('enrolled', 'completed') for share;
    if not found then raise insufficient_privilege; end if;
  end if;
  perform 1 from public.chat_rooms
  where id = p_room_id and course_run_id = course_id and kind = 'participant_course' for share;
  if not found then raise insufficient_privilege; end if;
  perform 1 from public.chat_members
  where room_id = p_room_id and user_id = p_actor_id and removed_at is null for share;
  if not found or private.academy_course_chat_actor_member(p_room_id, p_actor_id) is not true then
    raise insufficient_privilege;
  end if;
  return course_id;
end;
$$;
revoke all on function private.lock_academy_course_chat_actor(uuid, uuid) from public, anon, authenticated, service_role;

create or replace function private.lock_academy_course_chat_poster(p_room_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.lock_academy_course_chat_actor(p_room_id, auth.uid());
end;
$$;

-- This condition is used inside the private allocator only for an unowned,
-- non-replacement room/chat allocation. Broader internal wrappers retain
-- their existing checks and no public general allocation route is opened.
create function private.academy_course_chat_allocation_allowed(
  p_scope text, p_kind text, p_room_id uuid, p_job_id uuid, p_replace_id uuid, p_owner_id uuid
) returns boolean language sql stable security invoker set search_path = '' as $$
  select coalesce(p_scope = 'room' and p_kind = 'chat'
    and p_job_id is null and p_replace_id is null and p_owner_id is null
    and coalesce(private.academy_course_access_status() = 'active', false)
    and private.academy_course_chat_member(p_room_id), false);
$$;
revoke all on function private.academy_course_chat_allocation_allowed(text, text, uuid, uuid, uuid, uuid)
  from public, anon, authenticated, service_role;

do $$
declare
  definition text := pg_catalog.pg_get_functiondef('private.reserve_document_before_contract_owner(text,text,bigint,text,text,uuid,uuid,uuid,uuid,uuid)'::regprocedure);
  actor_anchor constant text := 'if not private.actor_active() and not (';
  retry_anchor constant text := 'private.can_access_document(d.id) or (';
  room_anchor constant text := 'not private.can_access_chat_room(p_room_id) then';
  scope_check constant text := 'private.academy_course_chat_allocation_allowed(p_scope, p_kind, p_room_id, p_job_id, p_replace_id, p_owner_id)';
begin
  if cardinality(string_to_array(definition, actor_anchor)) <> 2
    or cardinality(string_to_array(definition, retry_anchor)) <> 2
    or cardinality(string_to_array(definition, room_anchor)) <> 2 then
    raise exception 'Expected an exact learner/room document allocator';
  end if;
  definition := replace(definition, actor_anchor, 'if not private.actor_active() and not ' || scope_check || ' and not (');
  definition := replace(definition, retry_anchor, 'private.can_access_document(d.id) or (' || scope_check ||
    ' and private.course_chat_upload_status(p_room_id, d.id, existing_v.id) is not null) or (');
  execute replace(definition, room_anchor, 'not (private.can_access_chat_room(p_room_id) or ' || scope_check || ') then');
end;
$$;

create function private.reserve_academy_course_chat_file(
  p_room_id uuid, p_name text, p_mime text, p_size bigint, p_client_id uuid, p_sha256 text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  course_id uuid;
  release text;
  existing_version uuid;
  result jsonb;
begin
  course_id := private.lock_academy_course_chat_actor(p_room_id, actor_id);
  release := (select release_commit from private.academy_course_access);
  if p_client_id is null or p_size is null or p_size not between 1 and 10485760
    or not coalesce(p_sha256 ~ '^[0-9a-f]{64}$', false) then raise invalid_parameter_value; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('documents-global-quota', 0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('documents:' || actor_id::text, 0));
  select id into existing_version from public.document_versions
    where uploaded_by = actor_id and client_id = p_client_id;
  if found then
    if not exists (select 1 from private.academy_course_material_intake
      where version_id = existing_version and run_id = course_id and room_id = p_room_id
        and release_commit = release and expected_sha256 = p_sha256 and purpose = 'course_chat') then
      raise exception 'Course chat attachment reservation conflicts with this upload' using errcode = 'PT409';
    end if;
  elsif (select coalesce(sum(size_bytes), 0) from public.document_versions) + p_size >
      (select (terms #>> '{limits,storage_bytes}')::bigint from private.installation_verified_licence) then
    raise exception 'Academy storage quota reached' using errcode = '54000';
  end if;
  result := private.reserve_document_before_contract_owner(
    p_name, p_mime, p_size, 'room', 'chat', p_room_id, null, p_client_id, null, null
  );
  if existing_version is null then
    update public.documents set message_only = true where id = (result->>'document_id')::uuid;
    insert into private.academy_course_material_intake
      (version_id, run_id, release_commit, expected_sha256, purpose, room_id)
    values ((result->>'version_id')::uuid, course_id, release, p_sha256, 'course_chat', p_room_id);
  end if;
  return result;
end;
$$;

create function public.reserve_academy_course_chat_file(
  p_room_id uuid, p_name text, p_mime text, p_size bigint, p_client_id uuid, p_sha256 text
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.reserve_academy_course_chat_file(p_room_id, p_name, p_mime, p_size, p_client_id, p_sha256);
$$;
revoke all on function private.reserve_academy_course_chat_file(uuid, text, text, bigint, uuid, text),
  public.reserve_academy_course_chat_file(uuid, text, text, bigint, uuid, text) from public, anon, authenticated, service_role;
grant execute on function private.reserve_academy_course_chat_file(uuid, text, text, bigint, uuid, text),
  public.reserve_academy_course_chat_file(uuid, text, text, bigint, uuid, text) to authenticated;

-- Read status only for the caller's own current version on the matching
-- release. This never returns a Storage locator.
do $$
declare
  definition text := pg_catalog.pg_get_functiondef('private.course_chat_upload_status(uuid,uuid,uuid)'::regprocedure);
  anchor constant text := 'and private.can_access_chat_room(room.id);';
begin
  if cardinality(string_to_array(definition, anchor)) <> 2 then
    raise exception 'Expected exact course chat upload status authority';
  end if;
  execute replace(definition, anchor, $scope$and case when (select edition from private.installation_identity) = 'internal'
    then private.can_access_chat_room(room.id)
    else v.uploaded_by = auth.uid() and private.academy_course_access_status() = 'active'
      and private.academy_course_chat_member(room.id) and exists (
        select 1 from private.academy_course_material_intake intake
        join private.academy_course_access profile on profile.release_commit = intake.release_commit
        where intake.version_id = v.id and intake.purpose = 'course_chat' and intake.room_id = room.id
          and intake.run_id = room.course_run_id
          and (v.status <> 'clean' or intake.expected_sha256 = v.sha256)
      ) end;$scope$);
end;
$$;

-- Reuse the same exact-version lease, hash and scanner result transaction.
-- Ending a lease still settles the held write after a membership revocation.
do $$
declare
  definition text := pg_catalog.pg_get_functiondef('private.academy_course_material_scan(uuid,uuid,text,uuid,text,text)'::regprocedure);
  member_anchor constant text := 'private.lock_academy_file_intake(intake.run_id, version.uploaded_by, intake.purpose) is distinct from intake.release_commit';
  shape_anchor constant text := 'document.scope = ''personal'' and document.kind = ''material''';
begin
  if cardinality(string_to_array(definition, member_anchor)) <> 2
    or cardinality(string_to_array(definition, shape_anchor)) <> 2 then
    raise exception 'Expected exact scoped current uploader and scan target';
  end if;
  definition := replace(definition, member_anchor, $scope$(case when intake.purpose = 'course_chat'
    then private.lock_academy_course_chat_actor(intake.room_id, version.uploaded_by) = intake.run_id
      and (select release_commit from private.academy_course_access) = intake.release_commit
    else private.lock_academy_file_intake(intake.run_id, version.uploaded_by, intake.purpose) = intake.release_commit
  end) is not true$scope$);
  execute replace(definition, shape_anchor, $scope$(case when intake.purpose = 'course_chat'
      then document.scope = 'room' and document.kind = 'chat' and document.message_only and document.room_id = intake.room_id
      else document.scope = 'personal' and document.kind = 'material' end)$scope$);
end;
$$;

-- A draft is not a publication. Match the immutable uploaded file and current
-- role before the existing idempotent message transaction and notifications.
do $$
declare
  attachment_definition text := pg_catalog.pg_get_functiondef('private.send_course_chat_attachment(uuid,text,uuid,uuid,uuid)'::regprocedure);
  message_definition text := pg_catalog.pg_get_functiondef('private.send_message(uuid,text,uuid,uuid)'::regprocedure);
  poster_anchor constant text := 'perform private.lock_course_chat_poster(p_room_id);';
  dedicated_anchor constant text := '  if p_document_id is not null then raise insufficient_privilege; end if;';
  attachment_anchor constant text := 'not private.can_attach_chat_document(p_document_id,p_room_id)';
begin
  if cardinality(string_to_array(attachment_definition, poster_anchor)) <> 2
    or cardinality(string_to_array(message_definition, dedicated_anchor)) <> 2
    or cardinality(string_to_array(message_definition, attachment_anchor)) <> 2 then
    raise exception 'Expected exact course chat posting authority';
  end if;
  execute replace(attachment_definition, poster_anchor, $scope$if (select edition from private.installation_identity) = 'internal' then
    perform private.lock_course_chat_poster(p_room_id);
  else
    perform private.lock_academy_course_chat_poster(p_room_id);
  end if;$scope$);
  execute replace(replace(message_definition, dedicated_anchor, ''), attachment_anchor,
    $scope$not (case when (select edition from private.installation_identity) = 'internal'
      then private.can_attach_chat_document(p_document_id,p_room_id)
      else exists (
        select 1 from public.documents document
        join public.document_versions version on version.id = document.current_version_id
        where document.id = p_document_id and version.status = 'clean'
          and version.sha256 ~ '^[0-9a-f]{64}$' and version.scanner_version like 'ClamAV %'
          and (private.course_chat_upload_status(p_room_id, document.id, version.id)->'document'->>'status') = 'clean'
      ) end)$scope$);
end;
$$;

-- Publish safe attachment metadata to the existing room audience only. The
-- resolver matches the exact message and version before and after Storage.
do $$
declare
  selector text := pg_catalog.pg_get_functiondef('private.course_chat_attachment(uuid)'::regprocedure);
  projection text := pg_catalog.pg_get_functiondef('private.course_chat_messages(uuid,timestamptz,uuid,integer)'::regprocedure);
  resolver text := pg_catalog.pg_get_functiondef('private.course_chat_attachment_access(uuid,uuid,uuid,text)'::regprocedure);
  metadata_anchor constant text := 'and v.version = 1 and v.status = ''clean'' and v.sha256 is not null;';
  visibility_start constant text := '''attachment'', case when internal_edition then (';
  visibility_end constant text := '    ) end) order by message.created_at, message.id)';
  resolver_anchor constant text := '  if p_organisation_id is not null or p_reason is not null then';
begin
  if cardinality(string_to_array(selector, metadata_anchor)) <> 2
    or cardinality(string_to_array(projection, visibility_start)) <> 2
    or cardinality(string_to_array(projection, visibility_end)) <> 2
    or cardinality(string_to_array(resolver, resolver_anchor)) <> 2 then
    raise exception 'Expected exact course chat attachment projection and authority';
  end if;
  execute replace(selector, metadata_anchor, $scope$and v.version = 1 and v.status = 'clean' and v.sha256 is not null
    and ((select edition from private.installation_identity) = 'internal' or (
      v.sha256 ~ '^[0-9a-f]{64}$' and v.scanner_version like 'ClamAV %'
      and d.uploaded_by = m.sender_id and v.uploaded_by = m.sender_id and d.owner_id = m.sender_id
      and exists (select 1 from private.academy_course_material_intake intake
        where intake.version_id = v.id and intake.purpose = 'course_chat' and intake.room_id = room.id
          and intake.run_id = room.course_run_id and intake.expected_sha256 = v.sha256)
    ));$scope$);
  execute replace(replace(projection, visibility_start, '''attachment'', ('), visibility_end,
    '    )) order by message.created_at, message.id)');
  execute replace(resolver, resolver_anchor, $scope$  if (select edition from private.installation_identity) is distinct from 'internal' then
    if p_organisation_id is not null or p_reason is not null or not private.academy_course_chat_member(room_id)
      or exists (select 1 from private.chat_hidden_messages h where h.message_id = p_message_id and h.user_id = auth.uid()) then
      raise insufficient_privilege;
    end if;
    select * into attachment from private.course_chat_attachment(p_message_id) a where a.version_id = p_version_id;
    if not found then raise insufficient_privilege; end if;
    return to_jsonb(attachment);
  end if;
$scope$ || resolver_anchor);
end;
$$;

-- Only exact RPC paths for scanner-bound course chat files are opened.
do $$
declare
  definition text := pg_catalog.pg_get_functiondef('private.require_academy_course_access()'::regprocedure);
  read_anchor constant text := 'and request_path = ''/rpc/course_document_access''';
  write_anchor constant text := '''/rpc/send_course_chat_message''';
begin
  if cardinality(string_to_array(definition, read_anchor)) <> 2
    or cardinality(string_to_array(definition, write_anchor)) <> 2 then
    raise exception 'Expected exact academy course chat whitelist';
  end if;
  execute replace(replace(definition, read_anchor,
    'and request_path in (''/rpc/course_document_access'', ''/rpc/course_chat_attachment_access'')'), write_anchor,
    write_anchor || ', ''/rpc/reserve_academy_course_chat_file'', ''/rpc/course_chat_upload_status'', ''/rpc/send_course_chat_attachment''');
end;
$$;

notify pgrst, 'reload schema';
commit;
