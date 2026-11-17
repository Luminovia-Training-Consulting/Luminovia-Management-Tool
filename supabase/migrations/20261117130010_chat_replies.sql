begin;
-- No copied quote text: previews are resolved against current actor access and
-- the current version of the parent. Either physical deletion removes the edge.
create table private.chat_message_replies (
 message_id uuid primary key references public.messages(id) on delete cascade,
 reply_to_id uuid not null references public.messages(id) on delete cascade,
 check(message_id<>reply_to_id)
);
create index chat_reply_parent on private.chat_message_replies(reply_to_id);
create table private.chat_reply_requests (
 actor_id uuid not null references public.profiles(id) on delete cascade,
 request_id uuid not null,
 payload jsonb not null,
 reply_id uuid not null references public.messages(id) on delete cascade,
 primary key(actor_id,request_id)
);
alter table private.chat_message_replies enable row level security;
alter table private.chat_reply_requests enable row level security;
revoke all on private.chat_message_replies,private.chat_reply_requests from public,anon,authenticated;

create function private.send_chat_reply(p_room_id uuid,p_reply_to_id uuid,p_body text,p_client_id uuid,p_document_id uuid default null,p_mention_ids uuid[] default '{}') returns uuid
language plpgsql security definer set search_path='' as $$
declare parameters jsonb; prior private.chat_reply_requests; parent public.messages; created uuid;
begin
 if not private.can_access_chat_room(p_room_id) then raise exception 'Room access denied' using errcode='42501'; end if;
 if p_client_id is null or p_reply_to_id is null or p_mention_ids is null then raise exception 'Reply target and request key required' using errcode='22023'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('chat-send:'||auth.uid()::text,0));
 -- The advisory lock may have waited while access changed. Acquire the same
 -- actor/profile/role/room/member locks used by the ordinary send, and recheck
 -- current authority before even returning a prior successful receipt.
 perform private.prepare_chat_mentions(p_room_id,p_mention_ids);
 parameters=jsonb_build_object('room',p_room_id,'reply_to',p_reply_to_id,'body',p_body,'document',p_document_id,'mentions',p_mention_ids);
 select * into prior from private.chat_reply_requests where actor_id=auth.uid() and request_id=p_client_id;
 if found then
  if prior.payload<>parameters then raise exception 'Reply request idempotency conflict' using errcode='22023'; end if;
  return prior.reply_id;
 end if;
 -- Never attach reply metadata to an independently committed earlier send.
 if exists(select 1 from private.chat_mention_requests where actor_id=auth.uid() and request_id=p_client_id)
 or exists(select 1 from public.messages where sender_id=auth.uid() and client_id=p_client_id) then
  raise exception 'Message request key already used' using errcode='22023';
 end if;
 select * into parent from public.messages m where m.id=p_reply_to_id for share;
 if parent.id is null or parent.room_id<>p_room_id or parent.deleted_at is not null or private.chat_message_hidden(parent.id) then
  raise exception 'Reply target unavailable' using errcode='42501';
 end if;
 created=private.send_message_with_mentions(p_room_id,p_body,p_client_id,p_document_id,p_mention_ids);
 insert into private.chat_message_replies(message_id,reply_to_id) values(created,parent.id);
 insert into private.chat_reply_requests(actor_id,request_id,payload,reply_id) values(auth.uid(),p_client_id,parameters,created);
 return created;
end;$$;
create function public.send_chat_reply(p_room_id uuid,p_reply_to_id uuid,p_body text,p_client_id uuid,p_document_id uuid default null,p_mention_ids uuid[] default '{}') returns uuid
language sql security invoker set search_path='' as $$select private.send_chat_reply(p_room_id,p_reply_to_id,p_body,p_client_id,p_document_id,p_mention_ids);$$;

-- Return previews only for visible child rows, never parent content when removed,
-- personally hidden, in another room, or outside the current membership.
create function private.chat_reply_previews(p_room_id uuid,p_message_ids uuid[],p_versions integer[]) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not private.can_access_chat_room(p_room_id) then raise exception 'Room access denied' using errcode='42501'; end if;
 if p_message_ids is null or p_versions is null or cardinality(p_message_ids)>40
 or cardinality(p_message_ids)<>cardinality(p_versions)
 or coalesce(array_ndims(p_message_ids),1)<>1 or coalesce(array_ndims(p_versions),1)<>1
 or array_position(p_message_ids,null) is not null or array_position(p_versions,null) is not null then
  raise exception 'Invalid message selection' using errcode='22023';
 end if;
 -- The first history response and this projection are separate calls. Refuse
 -- the entire old page if any row was hidden, deleted, or edited in between.
 if exists(select 1 from unnest(p_message_ids,p_versions) expected(id,version)
  left join public.messages visible on visible.id=expected.id and visible.room_id=p_room_id
  where visible.id is null or visible.content_version<>expected.version or private.chat_message_hidden(expected.id)) then
  raise exception 'Message page changed; reload' using errcode='40001';
 end if;
 select coalesce(jsonb_object_agg(child.id::text,
  case when parent.id is null or parent.room_id<>child.room_id or parent.deleted_at is not null or private.chat_message_hidden(parent.id) then 'null'::jsonb
   else jsonb_build_object('id',parent.id,'sender_name',person.display_name,'body',left(parent.body,200)) end),'{}'::jsonb)
 into result from private.chat_message_replies edge
 join public.messages child on child.id=edge.message_id
 left join public.messages parent on parent.id=edge.reply_to_id
 left join public.profiles person on person.id=parent.sender_id
 where child.room_id=p_room_id and child.id=any(p_message_ids) and child.deleted_at is null and not private.chat_message_hidden(child.id) and private.can_access_chat_room(child.room_id);
 return result;
end;$$;
create function public.chat_reply_previews(p_room_id uuid,p_message_ids uuid[],p_versions integer[]) returns jsonb
language sql stable security invoker set search_path='' as $$select private.chat_reply_previews(p_room_id,p_message_ids,p_versions);$$;
revoke all on function private.send_chat_reply(uuid,uuid,text,uuid,uuid,uuid[]),public.send_chat_reply(uuid,uuid,text,uuid,uuid,uuid[]),private.chat_reply_previews(uuid,uuid[],integer[]),public.chat_reply_previews(uuid,uuid[],integer[]) from public,anon,authenticated,service_role;
grant execute on function private.send_chat_reply(uuid,uuid,text,uuid,uuid,uuid[]),public.send_chat_reply(uuid,uuid,text,uuid,uuid,uuid[]),private.chat_reply_previews(uuid,uuid[],integer[]),public.chat_reply_previews(uuid,uuid[],integer[]) to authenticated;

-- Include private reply edges and retry receipts in reviewed physical deletion.
alter function private.deletion_scope(text,uuid) rename to deletion_scope_before_chat_replies;
create function private.deletion_scope(p_kind text,p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb:=private.deletion_scope_before_chat_replies(p_kind,p_id); edge_pred text; req_pred text;
begin
 if p_kind='account' then req_pred=format('x.actor_id=%L::uuid',p_id);
 elsif p_kind='message' then
  edge_pred=format('x.message_id=%L::uuid or x.reply_to_id=%L::uuid',p_id,p_id);
  req_pred=format('x.reply_id=%L::uuid',p_id);
 elsif p_kind='chat_room' then
  edge_pred=format('x.message_id in(select id from public.messages where room_id=%L::uuid) or x.reply_to_id in(select id from public.messages where room_id=%L::uuid)',p_id,p_id);
  req_pred=format('x.reply_id in(select id from public.messages where room_id=%L::uuid)',p_id);
 end if;
 if edge_pred is not null then result=private.deletion_add_scope(result,'private.chat_message_replies',edge_pred); end if;
 if req_pred is not null then result=private.deletion_add_scope(result,'private.chat_reply_requests',req_pred); end if;
 return result;
end;$$;
revoke all on function private.deletion_scope_before_chat_replies(text,uuid),private.deletion_scope(text,uuid) from public,anon,authenticated,service_role;
commit;
