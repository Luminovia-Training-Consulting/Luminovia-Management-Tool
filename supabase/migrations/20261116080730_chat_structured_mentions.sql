begin;
-- Additive APIs preserve the published headless send/edit/history interfaces.
alter table public.messages add column content_version integer not null default 1 check(content_version>0);
create table private.chat_content_versions(
 message_id uuid not null references public.messages(id) on delete cascade,
 version integer not null check(version>0),created_at timestamptz not null default clock_timestamp(),
 primary key(message_id,version)
);
insert into private.chat_content_versions(message_id,version) select id,content_version from public.messages;
create table private.chat_mention_versions(
 message_id uuid not null,version integer not null,user_id uuid not null references public.profiles(id),
 primary key(message_id,version,user_id),
 foreign key(message_id,version) references private.chat_content_versions(message_id,version) on delete cascade
);
create index chat_mention_first_target on private.chat_mention_versions(message_id,user_id);
create table private.chat_mention_requests(
 actor_id uuid not null references public.profiles(id) on delete cascade,request_id uuid not null,
 payload jsonb not null,result jsonb not null,created_at timestamptz not null default clock_timestamp(),
 primary key(actor_id,request_id)
);
do $$declare t text;begin
 foreach t in array array['chat_content_versions','chat_mention_versions','chat_mention_requests'] loop
  execute format('alter table private.%I enable row level security',t);
  execute format('revoke all on private.%I from public,anon,authenticated',t);
 end loop;
end;$$;

create function private.bump_chat_content_version() returns trigger language plpgsql set search_path='' as $$
begin
 if new.body is distinct from old.body or new.edited_at is distinct from old.edited_at or new.deleted_at is distinct from old.deleted_at then new.content_version=old.content_version+1;
 else new.content_version=old.content_version;end if;
 return new;
end;$$;
create trigger chat_content_revision before update on public.messages for each row execute function private.bump_chat_content_version();
create function private.record_chat_content_version() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into private.chat_content_versions(message_id,version) values(new.id,new.content_version) on conflict do nothing;
 return new;
end;$$;
create trigger chat_content_history after insert or update on public.messages for each row execute function private.record_chat_content_version();

create function private.chat_mention_member(p_room_id uuid,p_user_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.chat_members m join public.profiles p on p.id=m.user_id join public.chat_rooms r on r.id=m.room_id
 where m.room_id=p_room_id and m.user_id=p_user_id and m.removed_at is null and p.active
 and (r.kind not in('general','topic','lecturer_course')
 or (r.kind='general' and exists(select 1 from public.user_roles ur where ur.user_id=p.id and ur.role in('owner','admin','lecturer','senior_lecturer')))
 or (r.kind in('topic','lecturer_course') and private.chat_staff(p.id))));
$$;
create function private.prepare_chat_mentions(p_room_id uuid,p_ids uuid[]) returns uuid[] language plpgsql security definer set search_path='' as $$
declare normalized uuid[];
begin
 if p_ids is null or coalesce(array_ndims(p_ids),1)<>1 or cardinality(p_ids)>20 then raise exception 'Invalid mention selection' using errcode='22023';end if;
 if array_position(p_ids,null) is not null or auth.uid()=any(p_ids) then raise exception 'Invalid mention selection' using errcode='22023';end if;
 select coalesce(array_agg(distinct id order by id),'{}'::uuid[]) into normalized from unnest(p_ids) id;
 if cardinality(normalized)<>cardinality(p_ids) then raise exception 'Unique mention targets required' using errcode='22023';end if;
 -- The existing membership editor locks room before members. Profile/role locks
 -- keep target suspension/role removal from racing a committed mention.
 perform 1 from public.profiles where id=any(normalized||array[auth.uid()]) order by id for share;
 perform 1 from public.user_roles where user_id=any(normalized||array[auth.uid()]) order by user_id,role for share;
 perform 1 from public.chat_rooms where id=p_room_id for share;
 perform 1 from public.chat_members where room_id=p_room_id and user_id=any(normalized||array[auth.uid()]) order by user_id for share;
 if not private.can_access_chat_room(p_room_id) or exists(select 1 from unnest(normalized) id where not private.chat_mention_member(p_room_id,id)) then raise exception 'Current room membership required' using errcode='42501';end if;
 return normalized;
end;$$;
create function private.record_chat_mentions(p_message_id uuid,p_version integer,p_ids uuid[]) returns void language plpgsql security definer set search_path='' as $$
declare target uuid;first_mention boolean;
begin
 foreach target in array p_ids loop
  first_mention=not exists(select 1 from private.chat_mention_versions where message_id=p_message_id and user_id=target);
  insert into private.chat_mention_versions(message_id,version,user_id) values(p_message_id,p_version,target);
  if first_mention then
   -- One row per message/recipient. A first explicit mention may renew a read
   -- ordinary notice and override room mute, never global category/quiet filters:
   -- BEFORE INSERT still runs before an ON CONFLICT UPDATE.
   insert into public.notifications(user_id,kind,resource_id) values(target,'chat_message',p_message_id)
   on conflict(user_id,kind,resource_id) do update set read_at=null,created_at=clock_timestamp();
  end if;
 end loop;
end;$$;

create function private.send_message_with_mentions(p_room_id uuid,p_body text,p_client_id uuid,p_document_id uuid default null,p_mention_ids uuid[] default '{}') returns uuid language plpgsql security definer set search_path='' as $$
declare targets uuid[];parameters jsonb;prior private.chat_mention_requests;message uuid;version integer;
begin
 if not private.can_access_chat_room(p_room_id) then raise exception 'Room access denied' using errcode='42501';end if;
 if p_client_id is null then raise exception 'Request key required' using errcode='22023';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('chat-send:'||auth.uid()::text,0));
 targets=private.prepare_chat_mentions(p_room_id,p_mention_ids);
 parameters=jsonb_build_object('action','send','room',p_room_id,'body',p_body,'document',p_document_id,'mentions',targets);
 select * into prior from private.chat_mention_requests where actor_id=auth.uid() and request_id=p_client_id;
 if found then if prior.payload<>parameters then raise exception 'Mention request idempotency conflict' using errcode='22023';end if;return (prior.result->>'id')::uuid;end if;
 if exists(select 1 from public.messages where sender_id=auth.uid() and client_id=p_client_id) then raise exception 'Legacy request key already used' using errcode='22023';end if;
 message=private.send_message(p_room_id,p_body,p_client_id,p_document_id);
 select content_version into version from public.messages where id=message;
 perform private.record_chat_mentions(message,version,targets);
 insert into private.chat_mention_requests(actor_id,request_id,payload,result) values(auth.uid(),p_client_id,parameters,jsonb_build_object('id',message,'version',version));
 return message;
end;$$;
create function public.send_message_with_mentions(p_room_id uuid,p_body text,p_client_id uuid,p_document_id uuid default null,p_mention_ids uuid[] default '{}') returns uuid language sql security invoker set search_path='' as $$select private.send_message_with_mentions(p_room_id,p_body,p_client_id,p_document_id,p_mention_ids);$$;

create function private.edit_message_with_mentions(p_message_id uuid,p_body text,p_expected_version integer,p_client_id uuid,p_mention_ids uuid[] default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare msg public.messages;targets uuid[];parameters jsonb;prior private.chat_mention_requests;result jsonb;
begin
 select * into msg from public.messages where id=p_message_id;
 if msg.id is null or msg.sender_id<>auth.uid() or not private.can_access_chat_room(msg.room_id) then raise exception 'Message edit denied' using errcode='42501';end if;
 if p_client_id is null or p_expected_version is null then raise exception 'Request key and version required' using errcode='22023';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('chat-send:'||auth.uid()::text,0));
 targets=private.prepare_chat_mentions(msg.room_id,p_mention_ids);
 parameters=jsonb_build_object('action','edit','id',p_message_id,'body',p_body,'version',p_expected_version,'mentions',targets);
 select * into prior from private.chat_mention_requests where actor_id=auth.uid() and request_id=p_client_id;
 if found then if prior.payload<>parameters then raise exception 'Mention request idempotency conflict' using errcode='22023';end if;return prior.result;end if;
 select * into msg from public.messages where id=p_message_id for update;
 if msg.content_version<>p_expected_version then raise exception 'Message changed; refresh before editing' using errcode='40001';end if;
 if (select count(*) from private.chat_mention_requests where actor_id=auth.uid() and created_at>clock_timestamp()-interval '1 minute')>=30 then raise exception 'Message rate limit reached' using errcode='P0001';end if;
 perform private.edit_message(p_message_id,p_body);
 select * into msg from public.messages where id=p_message_id;
 perform private.record_chat_mentions(msg.id,msg.content_version,targets);
 result=jsonb_build_object('id',msg.id,'version',msg.content_version);
 insert into private.chat_mention_requests(actor_id,request_id,payload,result) values(auth.uid(),p_client_id,parameters,result);
 return result;
end;$$;
create function public.edit_message_with_mentions(p_message_id uuid,p_body text,p_expected_version integer,p_client_id uuid,p_mention_ids uuid[] default '{}') returns jsonb language sql security invoker set search_path='' as $$select private.edit_message_with_mentions(p_message_id,p_body,p_expected_version,p_client_id,p_mention_ids);$$;

create function private.chat_mention_candidates(p_room_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.can_access_chat_room(p_room_id) then raise exception 'Room access denied' using errcode='42501';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('user_id',p.id,'display_name',p.display_name) order by p.display_name,p.id)
 from public.profiles p where p.id<>auth.uid() and private.chat_mention_member(p_room_id,p.id)),'[]'::jsonb);
end;$$;
create function public.chat_mention_candidates(p_room_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$select private.chat_mention_candidates(p_room_id);$$;

create function private.chat_messages_with_mentions(p_room_id uuid,p_before_at timestamptz default null,p_before_id uuid default null,p_search text default '',p_limit int default 50)
returns table(id uuid,room_id uuid,sender_id uuid,sender_name text,body text,document_id uuid,created_at timestamptz,edited_at timestamptz,deleted_at timestamptz,reactions jsonb,content_version integer,mentions jsonb,can_moderate boolean)
language plpgsql stable security definer set search_path='' as $$
begin
 return query select original.*,m.content_version,
 case when m.deleted_at is not null then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('user_id',p.id,'display_name',p.display_name) order by p.display_name,p.id)
 from private.chat_mention_versions mention join public.profiles p on p.id=mention.user_id where mention.message_id=m.id and mention.version=m.content_version and private.chat_mention_member(m.room_id,p.id)),'[]'::jsonb) end,
 room.kind<>'dm' and (coalesce(room.owner_id=auth.uid(),false) or private.has_permission('chat.moderate'))
 from private.chat_messages(p_room_id,p_before_at,p_before_id,p_search,p_limit) original join public.messages m on m.id=original.id join public.chat_rooms room on room.id=m.room_id;
end;$$;
create function public.chat_messages_with_mentions(p_room_id uuid,p_before_at timestamptz default null,p_before_id uuid default null,p_search text default '',p_limit int default 50)
returns table(id uuid,room_id uuid,sender_id uuid,sender_name text,body text,document_id uuid,created_at timestamptz,edited_at timestamptz,deleted_at timestamptz,reactions jsonb,content_version integer,mentions jsonb,can_moderate boolean)
language sql stable security invoker set search_path='' as $$select * from private.chat_messages_with_mentions(p_room_id,p_before_at,p_before_id,p_search,p_limit);$$;

revoke all on function private.bump_chat_content_version(),private.record_chat_content_version(),private.chat_mention_member(uuid,uuid),private.prepare_chat_mentions(uuid,uuid[]),private.record_chat_mentions(uuid,int,uuid[]) from public,anon,authenticated;
revoke all on function private.send_message_with_mentions(uuid,text,uuid,uuid,uuid[]),public.send_message_with_mentions(uuid,text,uuid,uuid,uuid[]),private.edit_message_with_mentions(uuid,text,int,uuid,uuid[]),public.edit_message_with_mentions(uuid,text,int,uuid,uuid[]),private.chat_mention_candidates(uuid),public.chat_mention_candidates(uuid),private.chat_messages_with_mentions(uuid,timestamptz,uuid,text,int),public.chat_messages_with_mentions(uuid,timestamptz,uuid,text,int) from public,anon;
grant execute on function private.send_message_with_mentions(uuid,text,uuid,uuid,uuid[]),public.send_message_with_mentions(uuid,text,uuid,uuid,uuid[]),private.edit_message_with_mentions(uuid,text,int,uuid,uuid[]),public.edit_message_with_mentions(uuid,text,int,uuid,uuid[]),private.chat_mention_candidates(uuid),public.chat_mention_candidates(uuid),private.chat_messages_with_mentions(uuid,timestamptz,uuid,text,int),public.chat_messages_with_mentions(uuid,timestamptz,uuid,text,int) to authenticated;
commit;
