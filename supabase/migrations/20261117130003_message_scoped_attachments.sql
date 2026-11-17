begin;
-- Existing room documents remain room-shared. Only explicitly reserved message
-- uploads opt in to the stricter message-reference lifetime.
alter table public.documents add column message_only boolean not null default false;
create index messages_live_document on public.messages(document_id)
 where document_id is not null and deleted_at is null;

-- Preserve the immediately preceding checks, including all dedicated registries
-- and permanent-deletion fences, without rewriting their historical migrations.
do $$ declare body text; begin
 select prosrc into strict body from pg_catalog.pg_proc where oid='private.can_access_document(uuid)'::regprocedure;
 execute format('create function private.can_access_document_before_message_scope(p_id uuid) returns boolean language plpgsql stable security definer set search_path='''' as %L',body);
end $$;
revoke all on function private.can_access_document_before_message_scope(uuid) from public,anon,authenticated,service_role;
create or replace function private.can_access_document(p_id uuid) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare d public.documents;
begin
 if not private.can_access_document_before_message_scope(p_id) then return false; end if;
 select * into d from public.documents where id=p_id;
 if not d.message_only then return true; end if;
 return d.scope='room' and d.kind='chat' and private.can_access_chat_room(d.room_id)
  and (d.owner_id=auth.uid() or exists(select 1 from public.messages m
    where m.document_id=d.id and m.room_id=d.room_id and m.deleted_at is null));
end $$;

-- Capture the distinction atomically with reservation. Same-UUID retries may
-- never silently convert a pre-existing room-shared document into private scope.
create function private.reserve_message_document(p_name text,p_mime text,p_size bigint,p_room_id uuid,p_client_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare existing uuid; result jsonb;
begin
 if auth.uid() is null or p_client_id is null then raise exception 'Active login required' using errcode='42501'; end if;
 -- Match the existing global -> actor -> owner reservation lock order.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('documents-global-quota',0));
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('documents:'||auth.uid()::text,0));
 select document_id into existing from public.document_versions where uploaded_by=auth.uid() and client_id=p_client_id;
 if existing is not null and not exists(select 1 from public.documents where id=existing and message_only) then
  raise exception 'Reservation scope conflict' using errcode='22023';
 end if;
 result=private.reserve_document(p_name,p_mime,p_size,'room','chat',p_room_id,null,p_client_id,null,null);
 update public.documents set message_only=true where id=(result->>'document_id')::uuid;
 return result;
end $$;
create function public.reserve_message_document(p_name text,p_mime text,p_size bigint,p_room_id uuid,p_client_id uuid)
returns jsonb language sql security invoker set search_path='' as $$
 select private.reserve_message_document(p_name,p_mime,p_size,p_room_id,p_client_id);
$$;
revoke all on function private.reserve_message_document(text,text,bigint,uuid,uuid),public.reserve_message_document(text,text,bigint,uuid,uuid) from public,anon,authenticated;
grant execute on function private.reserve_message_document(text,text,bigint,uuid,uuid),public.reserve_message_document(text,text,bigint,uuid,uuid) to authenticated;

-- Private chat drafts must not silently become independent course materials.
do $$ declare body text; begin
 select prosrc into strict body from pg_catalog.pg_proc where oid='private.readiness_material_access(uuid,uuid,uuid)'::regprocedure;
 execute format('create function private.readiness_material_access_before_message_scope(p_document uuid,p_lecturer uuid,p_job uuid) returns boolean language sql stable security definer set search_path='''' as %L',body);
end $$;
revoke all on function private.readiness_material_access_before_message_scope(uuid,uuid,uuid) from public,anon,authenticated,service_role;
create or replace function private.readiness_material_access(p_document uuid,p_lecturer uuid,p_job uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select not exists(select 1 from public.documents where id=p_document and message_only)
  and private.readiness_material_access_before_message_scope(p_document,p_lecturer,p_job);
$$;
commit;
