begin;

create extension if not exists pgcrypto with schema extensions;

-- Hold every chat writer until the existing text and retry receipts have been
-- transformed. This is a blocking one-time cutover, not a plaintext fallback.
lock table public.messages, public.chat_message_revisions,
  private.chat_mention_requests, private.chat_reply_requests
  in access exclusive mode;

create table private.chat_encryption_keys (
  version integer primary key check (version > 0),
  secret_id uuid not null unique,
  active boolean not null default false,
  created_at timestamptz not null default clock_timestamp()
);
create unique index chat_encryption_one_active_key
  on private.chat_encryption_keys(active) where active;
alter table private.chat_encryption_keys enable row level security;
revoke all on private.chat_encryption_keys from public, anon, authenticated, service_role;

-- Store independent installation-specific keys in Supabase Vault, not in the
-- application tables. Restoring chat therefore also requires protected Vault
-- key material that is kept separately from an ordinary database copy.
do $$
declare
  secret_id_value uuid;
begin
  select id into secret_id_value from vault.secrets
  where name = 'luminovia_chat_content_key_v1';
  if secret_id_value is null then
    secret_id_value := vault.create_secret(
      jsonb_build_object(
        'encryption_key', encode(extensions.gen_random_bytes(32), 'hex'),
        'authentication_key', encode(extensions.gen_random_bytes(32), 'hex'),
        'request_hmac_key', encode(extensions.gen_random_bytes(32), 'hex')
      )::text,
      'luminovia_chat_content_key_v1',
      'Installation-specific key material for encrypted chat text and retry fingerprints'
    );
  end if;
  insert into private.chat_encryption_keys(version, secret_id, active)
  values (1, secret_id_value, true);
end;
$$;

create function private.chat_active_encryption_version()
returns integer language sql stable security definer set search_path = '' as $$
  select version from private.chat_encryption_keys where active
$$;

create function private.chat_key_material(p_version integer, p_purpose text)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  material text;
begin
  if p_purpose not in ('encryption_key', 'authentication_key', 'request_hmac_key') or p_purpose is null then
    raise exception 'Chat key unavailable' using errcode = '55000';
  end if;
  select secret.decrypted_secret::jsonb ->> p_purpose into material
  from private.chat_encryption_keys keyring
  join vault.decrypted_secrets secret on secret.id = keyring.secret_id
  where keyring.version = p_version;
  if material is null or material !~ '^[0-9a-f]{64}$' then
    raise exception 'Chat key unavailable' using errcode = '55000';
  end if;
  return material;
end;
$$;

-- Use encrypt-then-MAC with independent keys and bind the authenticated
-- ciphertext to one row and one content purpose.
create function private.chat_encrypt_text(p_context text, p_plaintext text)
returns text language plpgsql volatile security definer set search_path = '' as $$
declare
  version_value integer;
  encrypted bytea;
  encoded text;
  tag bytea;
begin
  if p_context is null or length(p_context) not between 1 and 500 or p_plaintext is null then
    raise exception 'Chat encryption unavailable' using errcode = '55000';
  end if;
  version_value := private.chat_active_encryption_version();
  if version_value is null then
    raise exception 'Chat encryption unavailable' using errcode = '55000';
  end if;
  encrypted := extensions.pgp_sym_encrypt(
    p_context || chr(31) || p_plaintext,
    private.chat_key_material(version_value, 'encryption_key'),
    'cipher-algo=aes256, compress-algo=0'
  );
  encoded := encode(encrypted, 'hex');
  tag := extensions.hmac(
    convert_to('chat-content-auth:v1:' || version_value::text || ':' || p_context || ':' || encoded, 'UTF8'),
    decode(private.chat_key_material(version_value, 'authentication_key'), 'hex'),
    'sha256'
  );
  return 'chat-v' || version_value::text || ':' || encoded || ':' || encode(tag, 'hex');
end;
$$;

create function private.chat_decrypt_text(p_context text, p_ciphertext text)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  parts text[];
  version_value integer;
  plaintext text;
  prefix text;
  encoded text;
  expected_tag bytea;
  provided_tag bytea;
  mismatch integer := 0;
  index_value integer;
begin
  if p_context is null or length(p_context) not between 1 and 500 or p_ciphertext is null then
    raise exception 'Chat ciphertext unavailable' using errcode = '55000';
  end if;
  parts := regexp_match(p_ciphertext, '^chat-v([1-9][0-9]*):([0-9a-f]+):([0-9a-f]{64})$');
  if parts is null then
    raise exception 'Chat ciphertext unavailable' using errcode = '55000';
  end if;
  version_value := parts[1]::integer;
  encoded := parts[2];
  provided_tag := decode(parts[3], 'hex');
  expected_tag := extensions.hmac(
    convert_to('chat-content-auth:v1:' || version_value::text || ':' || p_context || ':' || encoded, 'UTF8'),
    decode(private.chat_key_material(version_value, 'authentication_key'), 'hex'),
    'sha256'
  );
  for index_value in 0..31 loop
    mismatch := mismatch | (get_byte(expected_tag, index_value) # get_byte(provided_tag, index_value));
  end loop;
  if mismatch <> 0 then
    raise exception 'Chat ciphertext unavailable' using errcode = '55000';
  end if;
  prefix := p_context || chr(31);
  plaintext := extensions.pgp_sym_decrypt(
    decode(encoded, 'hex'),
    private.chat_key_material(version_value, 'encryption_key')
  );
  if left(plaintext, length(prefix)) <> prefix then
    raise exception 'Chat ciphertext unavailable' using errcode = '55000';
  end if;
  return substr(plaintext, length(prefix) + 1);
exception when others then
  raise exception 'Chat ciphertext unavailable' using errcode = '55000';
end;
$$;

create function private.chat_encrypt_request(p_context text, p_payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
begin
  if p_payload is null then
    raise exception 'Chat retry receipt unavailable' using errcode = '55000';
  end if;
  return jsonb_build_object('ciphertext', private.chat_encrypt_text(p_context, p_payload::text));
end;
$$;

create function private.chat_decrypt_request(p_context text, p_payload jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if jsonb_typeof(p_payload) <> 'object' or p_payload - 'ciphertext' <> '{}'::jsonb
    or p_payload ->> 'ciphertext' is null then
    raise exception 'Chat retry receipt unavailable' using errcode = '55000';
  end if;
  return private.chat_decrypt_text(p_context, p_payload ->> 'ciphertext')::jsonb;
exception when others then
  raise exception 'Chat retry receipt unavailable' using errcode = '55000';
end;
$$;

create function private.chat_request_fingerprint(
  p_actor_id uuid, p_digest text, p_version integer default null
) returns text language plpgsql stable security definer set search_path = '' as $$
declare
  version_value integer := p_version;
  fingerprint bytea;
begin
  if p_actor_id is null or p_digest is null then
    raise exception 'Chat retry receipt unavailable' using errcode = '55000';
  end if;
  if version_value is null then
    version_value := private.chat_active_encryption_version();
  end if;
  fingerprint := extensions.hmac(
    convert_to('chat-message-retry:v1:' || p_actor_id::text || ':' || p_digest, 'UTF8'),
    decode(private.chat_key_material(version_value, 'request_hmac_key'), 'hex'),
    'sha256'
  );
  return 'chat-hmac-v' || version_value::text || ':' || encode(fingerprint, 'hex');
exception when others then
  raise exception 'Chat retry receipt unavailable' using errcode = '55000';
end;
$$;

revoke all on function private.chat_active_encryption_version(),
  private.chat_key_material(integer, text), private.chat_encrypt_text(text, text),
  private.chat_decrypt_text(text, text), private.chat_encrypt_request(text, jsonb),
  private.chat_decrypt_request(text, jsonb), private.chat_request_fingerprint(uuid, text, integer)
  from public, anon, authenticated, service_role;

-- Remove searchable plaintext copies before writing ciphertext.
drop index if exists public.messages_text_search;
drop index if exists public.messages_search_live_body_trgm;
alter table public.messages drop constraint if exists messages_body_check;

-- Representation-only backfill must not mint content versions or course
-- activity revisions as though users had edited messages.
alter table public.messages disable trigger chat_content_revision;
alter table public.messages disable trigger touch_course_chat_activity;
update public.messages message
set request_hash = private.chat_request_fingerprint(message.sender_id, message.request_hash, 1);
update public.messages message
set body = private.chat_encrypt_text(
      'message:' || message.id::text || ':' || message.room_id::text || ':body', message.body
    )
where message.deleted_at is null;
update public.chat_message_revisions revision
set previous_body = private.chat_encrypt_text(
  'revision:' || revision.id::text || ':' || revision.message_id::text || ':previous_body',
  revision.previous_body
);
update private.chat_mention_requests request
set payload = private.chat_encrypt_request(
  'mention-request:' || request.actor_id::text || ':' || request.request_id::text, request.payload
);
update private.chat_reply_requests request
set payload = private.chat_encrypt_request(
  'reply-request:' || request.actor_id::text || ':' || request.request_id::text, request.payload
);
alter table public.messages enable trigger chat_content_revision;
alter table public.messages enable trigger touch_course_chat_activity;

alter table public.messages add constraint messages_chat_body_ciphertext_check
  check (deleted_at is not null or body like 'chat-v%');
alter table public.chat_message_revisions add constraint chat_revisions_body_ciphertext_check
  check (previous_body like 'chat-v%');
alter table private.chat_mention_requests add constraint chat_mention_payload_ciphertext_check
  check (payload ? 'ciphertext' and payload ->> 'ciphertext' like 'chat-v%');
alter table private.chat_reply_requests add constraint chat_reply_payload_ciphertext_check
  check (payload ? 'ciphertext' and payload ->> 'ciphertext' like 'chat-v%');

create function private.protect_chat_message_body()
returns trigger language plpgsql volatile security definer set search_path = '' as $$
begin
  if new.deleted_at is not null then
    new.body := '';
  elsif tg_op = 'INSERT' then
    new.body := private.chat_encrypt_text(
      'message:' || new.id::text || ':' || new.room_id::text || ':body', new.body
    );
  elsif new.room_id is distinct from old.room_id then
    new.body := private.chat_encrypt_text(
      'message:' || new.id::text || ':' || new.room_id::text || ':body',
      private.chat_decrypt_text(
        'message:' || old.id::text || ':' || old.room_id::text || ':body', old.body
      )
    );
  elsif new.body is distinct from old.body then
    new.body := private.chat_encrypt_text(
      'message:' || new.id::text || ':' || new.room_id::text || ':body', new.body
    );
  end if;
  return new;
end;
$$;
create trigger protect_chat_message_body
before insert or update of body, room_id, deleted_at on public.messages
for each row execute function private.protect_chat_message_body();

create function private.protect_chat_revision_body()
returns trigger language plpgsql volatile security definer set search_path = '' as $$
begin
  new.previous_body := private.chat_encrypt_text(
    'revision:' || new.id::text || ':' || new.message_id::text || ':previous_body',
    new.previous_body
  );
  return new;
end;
$$;
create trigger protect_chat_revision_body
before insert or update of previous_body, message_id on public.chat_message_revisions
for each row execute function private.protect_chat_revision_body();
revoke all on function private.protect_chat_message_body(), private.protect_chat_revision_body()
  from public, anon, authenticated, service_role;

-- Keep the public interface stable while decrypting only after the current
-- room membership and per-account visibility filters have succeeded.
create or replace function private.chat_messages(
  p_room_id uuid, p_before_at timestamptz default null, p_before_id uuid default null,
  p_search text default '', p_limit int default 50
) returns table(
  id uuid, room_id uuid, sender_id uuid, sender_name text, body text, document_id uuid,
  created_at timestamptz, edited_at timestamptz, deleted_at timestamptz, reactions jsonb
) language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.can_access_chat_room(p_room_id) then
    raise exception 'Room access denied' using errcode = '42501';
  end if;
  if p_limit not between 1 and 100 or p_limit is null or length(coalesce(p_search, '')) > 200 then
    raise exception 'Invalid page' using errcode = '22023';
  end if;
  if (p_before_at is null) <> (p_before_id is null) then
    raise exception 'Complete cursor required' using errcode = '22023';
  end if;
  return query
  with visible as materialized (
    select message.* from public.messages message
    where message.room_id = p_room_id
      and not exists (
        select 1 from private.chat_hidden_messages hidden
        where hidden.user_id = auth.uid() and hidden.message_id = message.id
      )
      and (p_before_at is null or (message.created_at, message.id) < (p_before_at, p_before_id))
  )
  select message.id, message.room_id, message.sender_id, person.display_name,
    case when message.deleted_at is null then private.chat_decrypt_text(
      'message:' || message.id::text || ':' || message.room_id::text || ':body', message.body
    ) else '' end,
    message.document_id, message.created_at, message.edited_at, message.deleted_at,
    coalesce((
      select jsonb_agg(jsonb_build_object('emoji', reaction.emoji, 'count', reaction.count, 'mine', reaction.mine)
        order by reaction.emoji)
      from (
        select item.emoji, count(*) as count, bool_or(item.user_id = auth.uid()) as mine
        from public.message_reactions item
        where item.message_id = message.id and item.removed_at is null
        group by item.emoji
      ) reaction
    ), '[]'::jsonb)
  from visible message join public.profiles person on person.id = message.sender_id
  where coalesce(p_search, '') = '' or (
    message.deleted_at is null and strpos(lower(private.chat_decrypt_text(
      'message:' || message.id::text || ':' || message.room_id::text || ':body', message.body
    )), lower(p_search)) > 0
  )
  order by message.created_at desc, message.id desc
  limit p_limit;
end;
$$;

create or replace function private.send_message(
  p_room_id uuid, p_body text, p_client_id uuid, p_document_id uuid default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  previous public.messages;
  result uuid;
  signature text;
  body_digest text;
  version_value integer;
  actor uuid := auth.uid();
begin
  if (select edition from private.installation_identity) = 'internal' then
    if not private.can_access_chat_room(p_room_id) then
      raise exception 'Room access denied' using errcode = '42501';
    end if;
  else
    perform private.lock_academy_course_chat_poster(p_room_id);
  end if;
  if p_client_id is null or p_body is null or length(p_body) > 8000
    or (length(trim(p_body)) = 0 and p_document_id is null) then
    raise exception 'Invalid message' using errcode = '22023';
  end if;
  body_digest := md5(p_body || '|' || coalesce(p_document_id::text, ''));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('chat-send:' || actor::text, 0));
  select * into previous from public.messages where sender_id = actor and client_id = p_client_id;
  if found then
    if previous.request_hash !~ '^chat-hmac-v[1-9][0-9]*:[0-9a-f]{64}$'
      or previous.room_id <> p_room_id then
      raise exception 'Idempotency key conflicts with another message' using errcode = '22023';
    end if;
    version_value := substring(previous.request_hash from '^chat-hmac-v([1-9][0-9]*):')::integer;
    signature := private.chat_request_fingerprint(actor, body_digest, version_value);
    if previous.request_hash <> signature then
      raise exception 'Idempotency key conflicts with another message' using errcode = '22023';
    end if;
    return previous.id;
  end if;
  if p_document_id is not null and not (
    case when (select edition from private.installation_identity) = 'internal'
      then private.can_attach_chat_document(p_document_id, p_room_id)
      else exists (
        select 1 from public.documents document
        join public.document_versions version on version.id = document.current_version_id
        where document.id = p_document_id and version.status = 'clean'
          and version.sha256 ~ '^[0-9a-f]{64}$' and version.scanner_version like 'ClamAV %'
          and (private.course_chat_upload_status(p_room_id, document.id, version.id)->'document'->>'status') = 'clean'
      )
    end
  ) then
    raise exception 'Attachment is not available' using errcode = '42501';
  end if;
  if (select count(*) from public.messages
      where sender_id = actor and created_at > clock_timestamp() - interval '1 minute') >= 30 then
    raise exception 'Message rate limit reached' using errcode = 'P0001';
  end if;
  perform 1 from public.chat_members
  where room_id = p_room_id and user_id = actor and removed_at is null for share;
  if not found then raise exception 'Room access denied' using errcode = '42501'; end if;
  perform private.guard_course_chat_send(p_room_id, actor);
  signature := private.chat_request_fingerprint(actor, body_digest, null);
  insert into public.messages(room_id, sender_id, client_id, request_hash, body, document_id)
  values (p_room_id, actor, p_client_id, signature, p_body, p_document_id)
  returning id into result;
  insert into public.notifications(user_id, kind, resource_id)
  select member.user_id, 'chat_message', result
  from public.chat_members member join public.profiles profile on profile.id = member.user_id
  where member.room_id = p_room_id and member.user_id <> actor and member.removed_at is null
    and not member.muted and profile.active on conflict do nothing;
  return result;
end;
$$;

create or replace function private.edit_message(p_message_id uuid, p_body text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  message public.messages;
begin
  select * into message from public.messages where id = p_message_id for update;
  if not found or not private.can_access_chat_room(message.room_id)
    or message.sender_id <> auth.uid() or message.deleted_at is not null then
    raise exception 'Message edit denied' using errcode = '42501';
  end if;
  if message.created_at < clock_timestamp() - interval '15 minutes' then
    raise exception 'The edit window has closed' using errcode = '22023';
  end if;
  if p_body is null or length(p_body) > 8000
    or (length(trim(p_body)) = 0 and message.document_id is null) then
    raise exception 'Invalid message' using errcode = '22023';
  end if;
  insert into public.chat_message_revisions(message_id, actor_id, action, previous_body)
  values (
    message.id, auth.uid(), 'edited',
    private.chat_decrypt_text(
      'message:' || message.id::text || ':' || message.room_id::text || ':body', message.body
    )
  );
  update public.messages set body = p_body, edited_at = clock_timestamp() where id = message.id;
end;
$$;

create or replace function private.delete_message(p_message_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  message public.messages;
  room public.chat_rooms;
begin
  select * into message from public.messages where id = p_message_id for update;
  if not found or not private.can_access_chat_room(message.room_id) then
    raise exception 'Message delete denied' using errcode = '42501';
  end if;
  select * into room from public.chat_rooms where id = message.room_id;
  if message.sender_id <> auth.uid() and (room.kind = 'dm' or not (
    coalesce(room.owner_id = auth.uid(), false) or private.has_permission('chat.moderate')
  )) then
    raise exception 'Message delete denied' using errcode = '42501';
  end if;
  if message.deleted_at is not null then return; end if;
  insert into public.chat_message_revisions(message_id, actor_id, action, previous_body)
  values (
    message.id, auth.uid(), 'deleted',
    private.chat_decrypt_text(
      'message:' || message.id::text || ':' || message.room_id::text || ':body', message.body
    )
  );
  update public.messages set body = '', document_id = null, deleted_at = clock_timestamp()
  where id = message.id;
  update public.message_reactions set removed_at = clock_timestamp()
  where message_id = message.id and removed_at is null;
end;
$$;

create or replace function private.send_message_with_mentions(
  p_room_id uuid, p_body text, p_client_id uuid, p_document_id uuid default null,
  p_mention_ids uuid[] default '{}'
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  targets uuid[];
  parameters jsonb;
  prior private.chat_mention_requests;
  message_id uuid;
  version_value integer;
  request_context text;
begin
  if not private.can_access_chat_room(p_room_id) then
    raise exception 'Room access denied' using errcode = '42501';
  end if;
  if p_client_id is null then raise exception 'Request key required' using errcode = '22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('chat-send:' || auth.uid()::text, 0));
  targets := private.prepare_chat_mentions(p_room_id, p_mention_ids);
  parameters := jsonb_build_object('action', 'send', 'room', p_room_id, 'body', p_body,
    'document', p_document_id, 'mentions', targets);
  request_context := 'mention-request:' || auth.uid()::text || ':' || p_client_id::text;
  select * into prior from private.chat_mention_requests
  where actor_id = auth.uid() and request_id = p_client_id;
  if found then
    if private.chat_decrypt_request(request_context, prior.payload) <> parameters then
      raise exception 'Mention request idempotency conflict' using errcode = '22023';
    end if;
    return (prior.result ->> 'id')::uuid;
  end if;
  if exists(select 1 from public.messages where sender_id = auth.uid() and client_id = p_client_id) then
    raise exception 'Legacy request key already used' using errcode = '22023';
  end if;
  message_id := private.send_message(p_room_id, p_body, p_client_id, p_document_id);
  select content_version into version_value from public.messages where id = message_id;
  perform private.record_chat_mentions(message_id, version_value, targets);
  insert into private.chat_mention_requests(actor_id, request_id, payload, result)
  values (auth.uid(), p_client_id, private.chat_encrypt_request(request_context, parameters),
    jsonb_build_object('id', message_id, 'version', version_value));
  return message_id;
end;
$$;

create or replace function private.edit_message_with_mentions(
  p_message_id uuid, p_body text, p_expected_version integer, p_client_id uuid,
  p_mention_ids uuid[] default '{}'
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  message public.messages;
  targets uuid[];
  parameters jsonb;
  prior private.chat_mention_requests;
  result jsonb;
  request_context text;
begin
  select * into message from public.messages where id = p_message_id;
  if message.id is null or message.sender_id <> auth.uid()
    or not private.can_access_chat_room(message.room_id) then
    raise exception 'Message edit denied' using errcode = '42501';
  end if;
  if p_client_id is null or p_expected_version is null then
    raise exception 'Request key and version required' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('chat-send:' || auth.uid()::text, 0));
  targets := private.prepare_chat_mentions(message.room_id, p_mention_ids);
  parameters := jsonb_build_object('action', 'edit', 'id', p_message_id, 'body', p_body,
    'version', p_expected_version, 'mentions', targets);
  request_context := 'mention-request:' || auth.uid()::text || ':' || p_client_id::text;
  select * into prior from private.chat_mention_requests
  where actor_id = auth.uid() and request_id = p_client_id;
  if found then
    if private.chat_decrypt_request(request_context, prior.payload) <> parameters then
      raise exception 'Mention request idempotency conflict' using errcode = '22023';
    end if;
    return prior.result;
  end if;
  select * into message from public.messages where id = p_message_id for update;
  if message.content_version <> p_expected_version then
    raise exception 'Message changed; refresh before editing' using errcode = '40001';
  end if;
  if (select count(*) from private.chat_mention_requests
      where actor_id = auth.uid() and created_at > clock_timestamp() - interval '1 minute') >= 30 then
    raise exception 'Message rate limit reached' using errcode = 'P0001';
  end if;
  perform private.edit_message(p_message_id, p_body);
  select * into message from public.messages where id = p_message_id;
  perform private.record_chat_mentions(message.id, message.content_version, targets);
  result := jsonb_build_object('id', message.id, 'version', message.content_version);
  insert into private.chat_mention_requests(actor_id, request_id, payload, result)
  values (auth.uid(), p_client_id, private.chat_encrypt_request(request_context, parameters), result);
  return result;
end;
$$;

create or replace function private.send_chat_reply(
  p_room_id uuid, p_reply_to_id uuid, p_body text, p_client_id uuid,
  p_document_id uuid default null, p_mention_ids uuid[] default '{}'
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  parameters jsonb;
  prior private.chat_reply_requests;
  parent public.messages;
  created uuid;
  request_context text;
begin
  if not private.can_access_chat_room(p_room_id) then
    raise exception 'Room access denied' using errcode = '42501';
  end if;
  if p_client_id is null or p_reply_to_id is null or p_mention_ids is null then
    raise exception 'Reply target and request key required' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('chat-send:' || auth.uid()::text, 0));
  perform private.prepare_chat_mentions(p_room_id, p_mention_ids);
  parameters := jsonb_build_object('room', p_room_id, 'reply_to', p_reply_to_id, 'body', p_body,
    'document', p_document_id, 'mentions', p_mention_ids);
  request_context := 'reply-request:' || auth.uid()::text || ':' || p_client_id::text;
  select * into prior from private.chat_reply_requests
  where actor_id = auth.uid() and request_id = p_client_id;
  if found then
    if private.chat_decrypt_request(request_context, prior.payload) <> parameters then
      raise exception 'Reply request idempotency conflict' using errcode = '22023';
    end if;
    return prior.reply_id;
  end if;
  if exists(select 1 from private.chat_mention_requests
      where actor_id = auth.uid() and request_id = p_client_id)
    or exists(select 1 from public.messages where sender_id = auth.uid() and client_id = p_client_id) then
    raise exception 'Message request key already used' using errcode = '22023';
  end if;
  select * into parent from public.messages message
  where message.id = p_reply_to_id for share;
  if parent.id is null or parent.room_id <> p_room_id or parent.deleted_at is not null
    or private.chat_message_hidden(parent.id) then
    raise exception 'Reply target unavailable' using errcode = '42501';
  end if;
  created := private.send_message_with_mentions(p_room_id, p_body, p_client_id, p_document_id, p_mention_ids);
  insert into private.chat_message_replies(message_id, reply_to_id) values (created, parent.id);
  insert into private.chat_reply_requests(actor_id, request_id, payload, reply_id)
  values (auth.uid(), p_client_id, private.chat_encrypt_request(request_context, parameters), created);
  return created;
end;
$$;

create or replace function private.chat_reply_previews(
  p_room_id uuid, p_message_ids uuid[], p_versions integer[]
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  result jsonb;
begin
  if not private.can_access_chat_room(p_room_id) then
    raise exception 'Room access denied' using errcode = '42501';
  end if;
  if p_message_ids is null or p_versions is null or cardinality(p_message_ids) > 40
    or cardinality(p_message_ids) <> cardinality(p_versions)
    or coalesce(array_ndims(p_message_ids), 1) <> 1
    or coalesce(array_ndims(p_versions), 1) <> 1
    or array_position(p_message_ids, null) is not null
    or array_position(p_versions, null) is not null then
    raise exception 'Invalid message selection' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(p_message_ids, p_versions) expected(id, version)
    left join public.messages visible on visible.id = expected.id and visible.room_id = p_room_id
    where visible.id is null or visible.content_version <> expected.version
      or private.chat_message_hidden(expected.id)
  ) then
    raise exception 'Message page changed; reload' using errcode = '40001';
  end if;
  select coalesce(jsonb_object_agg(child.id::text,
    case when parent.id is null or parent.room_id <> child.room_id
      or parent.deleted_at is not null or private.chat_message_hidden(parent.id) then 'null'::jsonb
      else jsonb_build_object('id', parent.id, 'sender_name', person.display_name,
        'body', left(private.chat_decrypt_text(
          'message:' || parent.id::text || ':' || parent.room_id::text || ':body', parent.body
        ), 200)) end), '{}'::jsonb)
  into result
  from private.chat_message_replies edge
  join public.messages child on child.id = edge.message_id
  left join public.messages parent on parent.id = edge.reply_to_id
  left join public.profiles person on person.id = parent.sender_id
  where child.room_id = p_room_id and child.id = any(p_message_ids)
    and child.deleted_at is null and not private.chat_message_hidden(child.id)
    and private.can_access_chat_room(child.room_id);
  return result;
end;
$$;

create or replace function private.chat_topic_pinned_messages(p_room_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.can_access_chat_room(p_room_id) then
    raise exception 'Room access denied' using errcode = '42501';
  end if;
  if not exists(select 1 from public.chat_rooms where id = p_room_id and kind = 'topic') then
    raise exception 'Room access denied' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', message.id, 'sender_name', person.display_name,
      'body', private.chat_decrypt_text(
        'message:' || message.id::text || ':' || message.room_id::text || ':body', message.body
      ),
      'created_at', message.created_at
    ) order by pin.pinned_at desc, message.id)
    from private.chat_topic_message_pins pin
    join public.messages message on message.id = pin.message_id
    join public.profiles person on person.id = message.sender_id
    where message.room_id = p_room_id and message.deleted_at is null
      and not private.chat_message_hidden(message.id)
  ), '[]'::jsonb);
end;
$$;

create or replace function private.chat_rooms_with_manual_unread()
returns table(
  id uuid, kind text, title text, job_id uuid, owner_id uuid, unread_count bigint,
  last_message_at timestamptz, muted boolean, manual_unread boolean,
  last_message_preview text, personal_deleted boolean
) language sql stable security definer set search_path = '' as $$
  select rooms.id, rooms.kind, rooms.title, rooms.job_id, rooms.owner_id,
    rooms.unread_count,
    case when member.personal_history_cleared then latest.created_at else rooms.last_message_at end,
    rooms.muted, member.manual_unread_at is not null and not visibility.personal_deleted,
    case when latest.id is not null and latest.deleted_at is null then left(regexp_replace(
        private.chat_decrypt_text(
          'message:' || latest.id::text || ':' || latest.room_id::text || ':body', latest.body
        ), E'\\s+', ' ', 'g'), 160) else null end
    , visibility.personal_deleted
  from private.chat_rooms_list() with ordinality rooms
  join public.chat_members member on member.room_id = rooms.id
    and member.user_id = auth.uid() and member.removed_at is null
  left join lateral (
    select message.id, message.room_id, message.body, message.created_at, message.deleted_at
    from public.messages message
    where message.room_id = rooms.id
      and not exists(select 1 from private.chat_hidden_messages hidden
        where hidden.user_id = auth.uid() and hidden.message_id = message.id)
    order by message.created_at desc, message.id desc limit 1
  ) latest on true
  cross join lateral (
    select member.personal_history_cleared and latest.id is null as personal_deleted
  ) visibility
  order by rooms.ordinality
$$;

create or replace function private.course_chat_messages(
  p_room_id uuid, p_before_at timestamptz default null,
  p_before_id uuid default null, p_limit integer default 50
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  internal_edition boolean := (select edition = 'internal' from private.installation_identity);
begin
  if not exists (
    select 1 from public.chat_rooms room where room.id = p_room_id and room.kind = 'participant_course'
  ) or not (case when internal_edition
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
    select jsonb_agg(to_jsonb(message) || jsonb_build_object('attachment', (
      select jsonb_build_object('version_id', attachment.version_id,
        'name', attachment.name, 'size_bytes', attachment.size_bytes)
      from private.course_chat_attachment(message.id) attachment
    )) order by message.created_at, message.id)
    from (
      select message.id, message.sender_id, person.display_name as sender_name,
        case when message.deleted_at is null then private.chat_decrypt_text(
          'message:' || message.id::text || ':' || message.room_id::text || ':body', message.body
        ) end as body, message.created_at, message.deleted_at
      from (
        select stored.* from public.messages stored
        where stored.room_id = p_room_id
          and not exists(select 1 from private.chat_hidden_messages hidden
            where hidden.message_id = stored.id and hidden.user_id = auth.uid())
          and (p_before_at is null or (stored.created_at, stored.id) < (p_before_at, p_before_id))
        order by stored.created_at desc, stored.id desc limit p_limit
      ) message
      join public.profiles person on person.id = message.sender_id
    ) message
  ), '[]'::jsonb);
end;
$$;

create or replace function private.inspect_company_course_chat(
  p_organisation_id uuid, p_run_id uuid, p_reason text,
  p_before_at timestamptz, p_before_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  items jsonb;
begin
  if not private.is_company_premium_admin() or not exists (
    select 1 from public.course_runs run
    where run.id = p_run_id and run.organisation_id = p_organisation_id
  ) then raise insufficient_privilege; end if;
  if p_reason is null or char_length(btrim(p_reason)) not between 8 and 300
    or ((p_before_at is null) <> (p_before_id is null))
    or (p_before_at is not null and not isfinite(p_before_at)) then
    raise exception 'Invalid inspection purpose or cursor' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(to_jsonb(page) order by page.created_at desc, page.id desc), '[]'::jsonb)
  into items
  from (
    select message.id, message.created_at, person.display_name as sender_name,
      room.title as room_title,
      private.chat_decrypt_text(
        'message:' || message.id::text || ':' || message.room_id::text || ':body', message.body
      ) as body,
      (select jsonb_build_object('version_id', attachment.version_id,
        'name', attachment.name, 'size_bytes', attachment.size_bytes)
       from private.course_chat_attachment(message.id) attachment) as attachment
    from public.messages message
    join public.profiles person on person.id = message.sender_id
    join public.chat_rooms room on room.id = message.room_id
    where room.course_run_id = p_run_id and room.kind = 'participant_course'
      and message.deleted_at is null and message.body <> ''
      and (p_before_at is null or (message.created_at, message.id) < (p_before_at, p_before_id))
    order by message.created_at desc, message.id desc limit 51
  ) page;
  insert into public.audit_events(actor_id, action, resource_id, details)
  values (auth.uid(), 'course.chat_inspected', p_run_id, jsonb_build_object(
    'organisation_id', p_organisation_id, 'purpose', btrim(p_reason),
    'premium_enabled', private.company_premium_enabled(p_organisation_id),
    'returned_count', least(jsonb_array_length(items), 50)
  ));
  return jsonb_build_object(
    'items', case when jsonb_array_length(items) > 50 then items - 50 else items end,
    'next_cursor', case when jsonb_array_length(items) > 50 then jsonb_build_object(
      'at', items -> 49 ->> 'created_at', 'id', items -> 49 ->> 'id'
    ) end
  );
end;
$$;

-- Search has no plaintext index after the cutover. Process at most 10,000
-- currently visible rows and fail explicitly rather than returning partial hits.
create function private.chat_search_messages(p_query text, p_kind text)
returns table(id uuid, title text, url text)
language plpgsql stable security definer set search_path = '' as $$
declare
  candidate record;
  plaintext text;
  scanned integer := 0;
begin
  if p_kind not in ('', 'chats') then return; end if;
  for candidate in
    select message.id, message.room_id, message.body
    from public.messages message
    where message.deleted_at is null
      and private.can_access_chat_room(message.room_id)
      and not private.chat_message_hidden(message.id)
    order by message.created_at desc, message.id desc
    limit 10001
  loop
    scanned := scanned + 1;
    if scanned > 10000 then
      raise exception 'Global chat search exceeds the safe scan limit; search within a conversation'
        using errcode = '54000';
    end if;
    plaintext := private.chat_decrypt_text(
      'message:' || candidate.id::text || ':' || candidate.room_id::text || ':body', candidate.body
    );
    if position(p_query in lower(plaintext)) > 0 then
      id := candidate.id;
      title := left(plaintext, 150);
      url := '/chats?room=' || candidate.room_id;
      return next;
    end if;
  end loop;
end;
$$;
revoke all on function private.chat_search_messages(text, text) from public, anon, authenticated, service_role;

create or replace function private.unified_search_before_course_chat_links(
  p_query text, p_kind text default '', p_after_kind text default null,
  p_after_title text default null, p_after_id uuid default null, p_limit integer default 40
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  items jsonb;
  literal_pattern text;
begin
  if not (private.actor_active() or (coalesce(p_kind in ('courses', 'chats'), false) and private.learning_actor())) then
    raise exception 'Active account required' using errcode = '42501';
  end if;
  if p_query is null or length(trim(p_query)) not between 2 and 100
    or p_kind is null or p_kind not in ('', 'jobs', 'files', 'wiki', 'forum', 'chats', 'people', 'courses', 'clients', 'contracts', 'finance')
    or (p_after_kind is not null and p_after_kind not in ('jobs', 'files', 'wiki', 'forum', 'chats', 'people', 'courses', 'clients', 'contracts', 'finance'))
    or p_limit is null or p_limit not between 1 and 80
    or (p_after_kind is null) <> (p_after_title is null)
    or (p_after_kind is null) <> (p_after_id is null)
    or length(p_after_title) > 1000 then
    raise exception 'Invalid search page' using errcode = '22023';
  end if;
  p_query := lower(trim(p_query));
  literal_pattern := '%' || replace(replace(replace(p_query, '!', '!!'), '%', '!%'), '_', '!_') || '%';
  with available as (
    select job.id, 'jobs'::text kind, job.title, job.customer_name detail, '/jobs/' || job.id url
    from public.jobs job
    where private.can_read_job(job.id)
      and position(p_query in lower(job.title || ' ' || job.description || ' ' || job.customer_name)) > 0
    union all
    select document.id, 'files', document.original_name, ''::text,
      '/files?q=' || private.search_url_component(document.original_name)
    from public.documents document
    where document.deleted_at is null and document.status = 'clean'
      and private.can_access_document(document.id)
      and lower(document.original_name) like literal_pattern escape '!'
    union all
    select page.id, 'wiki', revision.title, revision.locale, '/wiki?page=' || page.id
    from public.wiki_pages page
    join public.wiki_revisions revision on revision.page_id = page.id and revision.version = case
      when page.owner_id = auth.uid() or private.has_permission('wiki.manage')
        then page.current_version else page.published_version end
    where not page.archived and private.can_read_wiki(page.id)
      and position(p_query in lower(revision.title || ' ' || revision.content_text)) > 0
    union all
    select thread.id, 'forum', thread.title, ''::text, '/forum?thread=' || thread.id
    from public.forum_threads thread
    where not thread.archived and private.can_read_forum(thread.id)
      and (position(p_query in lower(thread.title)) > 0 or exists (
        select 1 from public.forum_posts post
        where post.thread_id = thread.id and post.deleted_at is null
          and position(p_query in lower(post.content_text)) > 0
      ))
    union all
    select chat.id, 'chats', chat.title, ''::text, chat.url
    from private.chat_search_messages(p_query, p_kind) chat
    union all
    select profile.id, 'people', profile.display_name, ''::text, '/people/' || profile.id
    from public.profiles profile
    where private.profile_staff(profile.id) and private.can_read_person(profile.id)
      and position(p_query in lower(profile.display_name || ' ' || profile.bio_de || ' ' || profile.bio_en)) > 0
    union all
    select run.id, 'courses', template.title, coalesce(organisation.name, ''),
      case when private.course_premium_access(run.id)
        then '/courses/' || run.id || '/workspace' else '/courses?run=' || run.id end
    from public.course_runs run
    join public.course_templates template on template.id = run.template_id
    left join public.organisations organisation on organisation.id = run.organisation_id
    where run.archived_at is null
      and (private.can_read_course_run(run.id) or private.course_search_allowed(run.id))
      and position(p_query in lower(template.title || ' ' || template.description || ' ' || coalesce(organisation.name, ''))) > 0
    union all
    select organisation.id, 'clients', organisation.name, ''::text,
      case when private.has_permission('organisations.manage') then '/clients'
        when private.client_has_organisation(organisation.id) then '/client' else '/courses' end
    from public.organisations organisation
    where private.favourite_resource('organisation', organisation.id) is not null
      and position(p_query in lower(organisation.name)) > 0
    union all
    select contract.id, 'contracts', contract.title, ''::text, '/contracts'
    from public.contracts contract
    where (contract.user_id = auth.uid() or private.has_permission('contracts.read')
      or private.has_permission('contracts.manage'))
      and position(p_query in lower(contract.title)) > 0
    union all
    select invoice.id, 'finance', invoice.number, invoice.currency, '/finance'
    from public.invoices invoice
    where private.can_read_invoice(invoice.id) and position(p_query in lower(invoice.number)) > 0
  ), page as (
    select * from available item
    where (p_kind = '' or item.kind = p_kind)
      and (p_after_kind is null or (item.kind, lower(item.title), item.id) > (p_after_kind, p_after_title, p_after_id))
    order by item.kind, lower(item.title), item.id limit p_limit + 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'kind', kind, 'title', title, 'detail', detail, 'url', url
  ) order by kind, lower(title), id), '[]'::jsonb)
  into items from page;
  return jsonb_build_object(
    'items', case when jsonb_array_length(items) > p_limit then items - p_limit else items end,
    'has_more', jsonb_array_length(items) > p_limit,
    'next_cursor', case when jsonb_array_length(items) > p_limit then jsonb_build_object(
      'kind', items -> (p_limit - 1) ->> 'kind',
      'title', lower(items -> (p_limit - 1) ->> 'title'),
      'id', items -> (p_limit - 1) ->> 'id'
    ) else null end
  );
end;
$$;

-- SQL table reads must never surface encrypted revisions to portal roles.
revoke select on table public.chat_message_revisions from public, anon, authenticated;
revoke all on table vault.decrypted_secrets from public, anon, authenticated, service_role;
revoke all on function private.chat_search_messages(text, text) from public, anon, authenticated, service_role;
notify pgrst, 'reload schema';
commit;