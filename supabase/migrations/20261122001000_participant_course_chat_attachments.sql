begin;

-- Course file writes serialize with the current enrolment, company switch and
-- room membership. Company readers do not gain posting or upload rights.
create function private.lock_course_chat_poster(p_room_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare run_id uuid; company_id uuid;
begin
  select room.course_run_id into run_id from public.chat_rooms room
    where room.id = p_room_id and room.kind = 'participant_course';
  if run_id is null then raise insufficient_privilege; end if;
  perform private.lock_course_premium(run_id);
  if private.participant_actor() then
    select run.organisation_id into company_id from public.course_runs run where run.id = run_id;
    perform 1 from private.company_participant_memberships membership
      where membership.organisation_id = company_id
        and membership.user_id = auth.uid() and membership.status = 'active'
      for share;
    if not found then raise insufficient_privilege; end if;
    perform 1 from public.course_enrolments enrolment
      where enrolment.course_run_id = run_id and enrolment.user_id = auth.uid()
        and enrolment.status in ('enrolled', 'completed') for share;
    if not found then raise insufficient_privilege; end if;
  end if;
  perform 1 from public.chat_rooms
    where id = p_room_id and course_run_id = run_id and kind = 'participant_course' for share;
  if not found then raise insufficient_privilege; end if;
  perform 1 from public.chat_members
    where room_id = p_room_id and user_id = auth.uid() and removed_at is null for share;
  if not found or not private.can_access_chat_room(p_room_id) then
    raise insufficient_privilege;
  end if;
end;
$$;
revoke all on function private.lock_course_chat_poster(uuid) from public, anon, authenticated, service_role;

-- Reuse the installed quota, rate, validation and version machinery. Only the
-- private allocator receives the learner exception; the general reservation
-- API independently retains its operational-actor requirement.
do $$
declare
  definition text := pg_get_functiondef('private.reserve_document_before_contract_owner(text,text,bigint,text,text,uuid,uuid,uuid,uuid,uuid)'::regprocedure);
  original_gate constant text := 'if not private.actor_active() then';
  original_retry_gate constant text := 'if not private.can_access_document(d.id) then';
begin
  if strpos(definition, original_gate) = 0 or strpos(definition, original_retry_gate) = 0 then
    raise exception 'Installed document allocator is missing its active actor gate';
  end if;
  definition := replace(definition, original_gate, $gate$if not private.actor_active() and not (
    private.participant_actor() and p_scope = 'room' and p_kind = 'chat'
    and p_replace_id is null and p_owner_id is null and p_job_id is null
    and private.can_access_chat_room(p_room_id)
  ) then$gate$);
  execute replace(definition, original_retry_gate, $retry$if not (
    private.can_access_document(d.id) or (
      private.participant_actor() and
      private.course_chat_upload_status(d.room_id, d.id, existing_v.id) is not null
    )
  ) then$retry$);
end;
$$;

do $$
declare
  definition text := pg_get_functiondef('private.reserve_document(text,text,bigint,text,text,uuid,uuid,uuid,uuid,uuid)'::regprocedure);
  original_start constant text := E'begin\n  if p_kind = ''contract''';
begin
  if strpos(definition, original_start) = 0 then
    raise exception 'Installed document reservation wrapper has changed';
  end if;
  execute replace(definition, original_start, $gate$begin
  if not private.actor_active() then
    raise insufficient_privilege;
  end if;
  -- A sent message always refers to its original scanned bytes.
  if p_replace_id is not null and exists (
    select 1 from public.documents d join public.chat_rooms room on room.id = d.room_id
    where d.id = p_replace_id and d.message_only and room.kind = 'participant_course'
  ) then
    raise exception 'Course chat attachments cannot be replaced' using errcode = '22023';
  end if;
  if p_kind = 'contract'$gate$);
end;
$$;

-- The reservation retry key is constrained to the original room, owner and
-- version. Learners cannot allocate personal or general room-shared documents.
create or replace function private.reserve_message_document(
  p_name text, p_mime text, p_size bigint, p_room_id uuid, p_client_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare existing uuid; result jsonb; course_room boolean;
begin
  if auth.uid() is null or p_client_id is null then raise insufficient_privilege; end if;
  course_room := exists (select 1 from public.chat_rooms where id = p_room_id and kind = 'participant_course');
  if course_room then
    perform private.lock_course_chat_poster(p_room_id);
  elsif not private.actor_active() then raise insufficient_privilege;
  end if;
  -- Match the allocator's global -> actor -> owner quota lock order.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('documents-global-quota', 0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('documents:' || auth.uid()::text, 0));
  select document_id into existing from public.document_versions
    where uploaded_by = auth.uid() and client_id = p_client_id;
  if existing is not null and not exists (
    select 1 from public.documents where id = existing and message_only
  ) then raise exception 'Reservation scope conflict' using errcode = '22023'; end if;
  if course_room then
    result := private.reserve_document_before_contract_owner(
      p_name, p_mime, p_size, 'room', 'chat', p_room_id, null, p_client_id, null, null
    );
  else
    result := private.reserve_document(
      p_name, p_mime, p_size, 'room', 'chat', p_room_id, null, p_client_id, null, null
    );
  end if;
  update public.documents set message_only = true where id = (result->>'document_id')::uuid;
  return result;
end;
$$;

-- The scoped gateway can reserve only in the course channel selected by
-- the caller. Participants never enter the general reserve RPC over REST.
create function private.reserve_course_chat_document(
  p_name text, p_mime text, p_size bigint, p_room_id uuid, p_client_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.chat_rooms where id = p_room_id and kind = 'participant_course') then
    raise insufficient_privilege;
  end if;
  return private.reserve_message_document(p_name, p_mime, p_size, p_room_id, p_client_id);
end;
$$;
create function public.reserve_course_chat_document(
  p_name text, p_mime text, p_size bigint, p_room_id uuid, p_client_id uuid
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.reserve_course_chat_document(p_name, p_mime, p_size, p_room_id, p_client_id);
$$;

-- The scanner only needs the owner's exact reservation status and hash.
-- The projection excludes object paths and unrelated files and is rechecked
-- by the caller-token gateway after scanning and before returning completion.
create function private.course_chat_upload_status(
  p_room_id uuid, p_document_id uuid, p_version_id uuid
) returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'document', jsonb_build_object(
      'id', d.id, 'owner_id', d.owner_id, 'uploaded_by', d.uploaded_by, 'scope', d.scope,
      'kind', d.kind, 'room_id', d.room_id, 'job_id', d.job_id, 'original_name', d.original_name,
      'mime_type', d.mime_type, 'size_bytes', d.size_bytes, 'status', d.status,
      'current_version_id', d.current_version_id, 'created_at', d.created_at, 'deleted_at', d.deleted_at
    ), 'sha256', v.sha256
  )
  from public.documents d
  join public.document_versions v on v.id = p_version_id and v.document_id = d.id
  join public.chat_rooms room on room.id = p_room_id
  where d.id = p_document_id and d.room_id = room.id and room.kind = 'participant_course'
    and d.owner_id = auth.uid() and d.uploaded_by = auth.uid()
    and d.current_version_id = v.id and v.version = 1
    and d.scope = 'room' and d.kind = 'chat' and d.message_only
    and d.deleted_at is null and not private.deletion_document_fenced(d.id)
    and private.can_access_chat_room(room.id);
$$;

create function public.course_chat_upload_status(
  p_room_id uuid, p_document_id uuid, p_version_id uuid
) returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.course_chat_upload_status(p_room_id, p_document_id, p_version_id);
$$;

-- Store the message via the established idempotency, rate and notification
-- path. Guard retries with current authority and require the exact clean draft.
create function private.send_course_chat_attachment(
  p_room_id uuid, p_body text, p_client_id uuid, p_document_id uuid, p_version_id uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
declare upload jsonb;
begin
  perform private.lock_course_chat_poster(p_room_id);
  perform 1 from public.documents where id = p_document_id for share;
  upload := private.course_chat_upload_status(p_room_id, p_document_id, p_version_id);
  if upload is null or upload->'document'->>'status' <> 'clean' or upload->>'sha256' is null then
    raise insufficient_privilege;
  end if;
  return private.send_message(p_room_id, p_body, p_client_id, p_document_id);
end;
$$;

create function public.send_course_chat_attachment(
  p_room_id uuid, p_body text, p_client_id uuid, p_document_id uuid, p_version_id uuid
) returns uuid language sql security invoker set search_path = '' as $$
  select private.send_course_chat_attachment(p_room_id, p_body, p_client_id, p_document_id, p_version_id);
$$;

create or replace function private.send_course_chat_message(
  p_room_id uuid, p_body text, p_client_id uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
begin
  perform private.lock_course_chat_poster(p_room_id);
  return private.send_message(p_room_id, p_body, p_client_id, null);
end;
$$;

-- A message only publishes its own clean, non-replaceable version. Legacy
-- documents with a mutable version history are outside this new projection.
-- This internal selector is used only behind the room or audited admin checks.
create function private.course_chat_attachment(p_message_id uuid)
returns table(version_id uuid, name text, mime_type text, size_bytes bigint, sha256 text, object_path text)
language sql stable security definer set search_path = '' as $$
  select v.id, v.original_name, v.mime_type, v.size_bytes, v.sha256, v.object_path
  from public.messages m
  join public.chat_rooms room on room.id = m.room_id
  join public.documents d on d.id = m.document_id and d.room_id = m.room_id
  join public.document_versions v on v.id = d.current_version_id and v.document_id = d.id
  where m.id = p_message_id and m.deleted_at is null and room.kind = 'participant_course'
    and d.deleted_at is null and not private.deletion_document_fenced(d.id)
    and d.scope = 'room' and d.kind = 'chat' and d.message_only and d.status = 'clean'
    and v.version = 1 and v.status = 'clean' and v.sha256 is not null;
$$;
revoke all on function private.course_chat_attachment(uuid) from public, anon, authenticated, service_role;

create or replace function private.course_chat_messages(
  p_room_id uuid, p_before_at timestamptz default null,
  p_before_id uuid default null, p_limit integer default 50
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.chat_rooms where id = p_room_id and kind = 'participant_course')
    or not (private.can_access_chat_room(p_room_id) or private.company_course_chat_reader(p_room_id)) then
    raise exception 'Course chat unavailable' using errcode = '42501';
  end if;
  if p_limit is null or p_limit not between 1 and 100
    or ((p_before_at is null) <> (p_before_id is null))
    or (p_before_at is not null and not isfinite(p_before_at)) then
    raise exception 'Invalid course chat page' using errcode = '22023';
  end if;
  return coalesce((
    select jsonb_agg(to_jsonb(message) || jsonb_build_object('attachment', (
      select jsonb_build_object('version_id', a.version_id, 'name', a.name, 'size_bytes', a.size_bytes)
      from private.course_chat_attachment(message.id) a
    )) order by message.created_at, message.id)
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

-- Downloads authorize the exact visible message/version. The gateway compares
-- its pre-fetch snapshot with a fresh authorization and checks the byte hash.
-- Administrative inspection requires a purpose and matching company and records
-- an audit entry before the gateway releases bytes, including paused courses.
create function private.course_chat_attachment_access(
  p_message_id uuid, p_version_id uuid, p_organisation_id uuid, p_reason text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare room_id uuid; course_id uuid; organisation_id uuid; attachment record;
begin
  select room.id, run.id, run.organisation_id into room_id, course_id, organisation_id
    from public.messages m
    join public.chat_rooms room on room.id = m.room_id and room.kind = 'participant_course'
    join public.course_runs run on run.id = room.course_run_id
    where m.id = p_message_id;
  if not found then raise insufficient_privilege; end if;
  if p_organisation_id is not null or p_reason is not null then
    if not private.is_company_premium_admin() or p_organisation_id is null or p_reason is null
      or organisation_id is distinct from p_organisation_id or char_length(btrim(p_reason)) not between 8 and 300 then
      raise insufficient_privilege;
    end if;
  elsif not (private.can_access_chat_room(room_id) or private.company_course_chat_reader(room_id))
    or exists (select 1 from private.chat_hidden_messages h where h.message_id = p_message_id and h.user_id = auth.uid()) then
    raise insufficient_privilege;
  end if;
  select * into attachment from private.course_chat_attachment(p_message_id) a where a.version_id = p_version_id;
  if not found then raise insufficient_privilege; end if;
  if p_organisation_id is not null then
    -- Administrative metadata and byte-path requests are themselves inspections.
    insert into public.audit_events(actor_id, action, resource_id, details)
    values (auth.uid(), 'course.chat_inspected', course_id, jsonb_build_object(
      'organisation_id', organisation_id, 'purpose', btrim(p_reason),
      'message_id', p_message_id, 'attachment_version_id', p_version_id
    ));
  end if;
  return to_jsonb(attachment);
end;
$$;

create function public.course_chat_attachment_access(
  p_message_id uuid, p_version_id uuid, p_organisation_id uuid, p_reason text
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.course_chat_attachment_access(p_message_id, p_version_id, p_organisation_id, p_reason);
$$;

-- Retained inspections include attachment-only messages and only safe metadata.
do $$
declare
  definition text := pg_get_functiondef('private.inspect_company_course_chat(uuid,uuid,text,timestamptz,uuid)'::regprocedure);
  original_column constant text := 'r.title as room_title, m.body';
  original_filter constant text := 'm.deleted_at is null and m.body <> ''''';
begin
  if strpos(definition, original_column) = 0 or strpos(definition, original_filter) = 0 then
    raise exception 'Installed course chat audit projection has changed';
  end if;
  definition := replace(definition, original_column, $columns$r.title as room_title, m.body, (
    select jsonb_build_object('version_id', a.version_id, 'name', a.name, 'size_bytes', a.size_bytes)
    from private.course_chat_attachment(m.id) a
  ) as attachment$columns$);
  execute replace(definition, original_filter, $filter$m.deleted_at is null
    and (m.body <> '' or exists(select 1 from private.course_chat_attachment(m.id)))$filter$);
end;
$$;

revoke all on function
  private.reserve_course_chat_document(text, text, bigint, uuid, uuid),
  public.reserve_course_chat_document(text, text, bigint, uuid, uuid),
  private.course_chat_upload_status(uuid, uuid, uuid), public.course_chat_upload_status(uuid, uuid, uuid),
  private.send_course_chat_attachment(uuid, text, uuid, uuid, uuid), public.send_course_chat_attachment(uuid, text, uuid, uuid, uuid),
  private.course_chat_attachment_access(uuid, uuid, uuid, text), public.course_chat_attachment_access(uuid, uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function
  private.reserve_course_chat_document(text, text, bigint, uuid, uuid),
  public.reserve_course_chat_document(text, text, bigint, uuid, uuid),
  private.course_chat_upload_status(uuid, uuid, uuid), public.course_chat_upload_status(uuid, uuid, uuid),
  private.send_course_chat_attachment(uuid, text, uuid, uuid, uuid), public.send_course_chat_attachment(uuid, text, uuid, uuid, uuid),
  private.course_chat_attachment_access(uuid, uuid, uuid, text), public.course_chat_attachment_access(uuid, uuid, uuid, text)
  to authenticated;

-- Keep the pre-request allowlist additive so old participant endpoints survive.
alter function private.require_portal_access() rename to require_portal_access_before_course_chat_files;
revoke all on function private.require_portal_access_before_course_chat_files() from public, anon, authenticated, service_role;
create function private.require_portal_access()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if current_setting('role', true) = 'authenticated'
    and coalesce(current_setting('request.path', true), '') in (
      '/rpc/reserve_course_chat_document', '/rpc/course_chat_upload_status',
      '/rpc/send_course_chat_attachment', '/rpc/course_chat_attachment_access'
    ) and private.participant_actor() then return; end if;
  perform private.require_portal_access_before_course_chat_files();
end;
$$;
revoke all on function private.require_portal_access() from public, anon, authenticated, service_role;
grant execute on function private.require_portal_access() to authenticated;

-- The existing public invoker deliberately skips the private schema for
-- anonymous and service requests. Reuse it with the extended private gate.
notify pgrst, 'reload schema';
commit;
