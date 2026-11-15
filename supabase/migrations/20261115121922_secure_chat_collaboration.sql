begin;

-- Chat access is current membership, never a blanket administrator capability.
alter table public.chat_rooms alter column job_id drop not null;
alter table public.chat_rooms drop constraint chat_rooms_kind_check;
alter table public.chat_rooms add constraint chat_rooms_kind_check check(kind in ('dm','general','topic','lecturer_course','participant_course'));
alter table public.chat_rooms add column title text not null default '' check(length(title)<=160);
alter table public.chat_rooms add column owner_id uuid references public.profiles(id);
alter table public.chat_rooms add column course_run_id uuid references public.course_runs(id);
alter table public.chat_rooms add column dm_key text unique;
alter table public.chat_rooms add column created_at timestamptz not null default clock_timestamp();
alter table public.chat_rooms add constraint dm_pair_required check((kind='dm')=(dm_key is not null));
create unique index one_lecturers_general_room on public.chat_rooms(kind) where kind='general';
create unique index one_participant_channel_per_run on public.chat_rooms(course_run_id) where kind='participant_course';
alter table public.chat_members add column joined_at timestamptz not null default clock_timestamp();
alter table public.chat_members add column removed_at timestamptz;
alter table public.chat_members add column last_read_at timestamptz not null default 'epoch';
alter table public.chat_members add column last_read_message_id uuid not null default '00000000-0000-0000-0000-000000000000';
alter table public.chat_members add column muted boolean not null default false;

create table public.messages (
 id uuid primary key default gen_random_uuid(),
 room_id uuid not null references public.chat_rooms(id),
 sender_id uuid not null references public.profiles(id),
 client_id uuid not null,
 request_hash text not null,
 body text not null check(length(body)<=8000),
 document_id uuid,
 created_at timestamptz not null default clock_timestamp(),
 edited_at timestamptz,
 deleted_at timestamptz,
 unique(sender_id,client_id),
 check(deleted_at is not null or length(trim(body))>0 or document_id is not null),
 check(deleted_at is null or (body='' and document_id is null))
);
create table public.message_reactions (
 message_id uuid not null references public.messages(id),
 user_id uuid not null references public.profiles(id),
 emoji text not null check(emoji in ('👍','❤️','🎉','💡','👀','✅')),
 removed_at timestamptz,
 created_at timestamptz not null default clock_timestamp(),
 primary key(message_id,user_id,emoji)
);
-- Private edits are retained under the same room access boundary, not in the
-- company-wide audit table where they would reveal DM content to administrators.
create table public.chat_message_revisions (
 id uuid primary key default gen_random_uuid(),
 message_id uuid not null references public.messages(id),
 actor_id uuid not null references public.profiles(id),
 action text not null check(action in ('edited','deleted')),
 previous_body text not null,
 created_at timestamptz not null default clock_timestamp()
);
create index messages_room_cursor on public.messages(room_id,created_at desc,id desc);
create index messages_sender_rate on public.messages(sender_id,created_at desc);
create index messages_text_search on public.messages using gin(to_tsvector('simple',body));
create index active_chat_members_user on public.chat_members(user_id,room_id) where removed_at is null;
create index reactions_message on public.message_reactions(message_id) where removed_at is null;
create index chat_revisions_message on public.chat_message_revisions(message_id);

create function private.chat_staff(p_user_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p join public.user_roles r on r.user_id=p.id where p.id=p_user_id and p.active and r.role in ('admin','management','senior_lecturer','lecturer'));
$$;
-- The assigned lecturer owns their course discussion; participant channels remain separate.
update public.chat_rooms r set owner_id=c.lecturer_id from public.job_claims c where r.job_id=c.job_id and r.kind='lecturer_course' and c.status='confirmed' and r.owner_id is null;
create function private.assign_course_chat_owner() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.kind='lecturer_course' and new.owner_id is null and private.chat_staff(auth.uid()) then new.owner_id=auth.uid(); end if;
 return new;
end;$$;
create trigger course_chat_owner before insert on public.chat_rooms for each row execute function private.assign_course_chat_owner();
revoke execute on function private.assign_course_chat_owner() from public,anon,authenticated;

create function private.can_access_chat_room(p_room_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.actor_active() and exists(select 1 from public.chat_members m join public.chat_rooms r on r.id=m.room_id where m.room_id=p_room_id and m.user_id=auth.uid() and m.removed_at is null
 and (r.kind not in ('general','topic','lecturer_course') or (r.kind='general' and private.has_role(array['lecturer','senior_lecturer'])) or (r.kind in ('topic','lecturer_course') and private.chat_staff(auth.uid()))));
$$;
-- The scanned-documents integration migration replaces this deny-by-default adapter.
create function private.can_attach_chat_document(p_document_id uuid,p_room_id uuid) returns boolean language sql stable security definer set search_path='' as $$ select false; $$;
create function private.can_chat_contact(p_user_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.actor_active() and p_user_id<>auth.uid()
 and exists(select 1 from public.profiles p join public.user_roles r on r.user_id=p.id where p.id=p_user_id and p.active and r.role in ('admin','management','senior_lecturer','lecturer','participant'))
 and ((private.chat_staff(auth.uid()) and private.chat_staff(p_user_id))
 or private.has_permission('courses.manage')
 or exists(select 1 from public.chat_members a join public.chat_members b on b.room_id=a.room_id join public.chat_rooms r on r.id=a.room_id where a.user_id=auth.uid() and b.user_id=p_user_id and a.removed_at is null and b.removed_at is null and r.kind='participant_course'));
$$;

alter table public.messages enable row level security;
alter table public.message_reactions enable row level security;
alter table public.chat_message_revisions enable row level security;
revoke all on public.messages,public.message_reactions,public.chat_message_revisions from anon,authenticated;
grant select on public.messages,public.message_reactions,public.chat_message_revisions to authenticated;
grant all on public.messages,public.message_reactions,public.chat_message_revisions to service_role;
drop policy room_read on public.chat_rooms;
create policy room_read on public.chat_rooms for select to authenticated using(private.can_access_chat_room(id));
drop policy membership_read on public.chat_members;
-- Keeping one's revoked membership readable allows immediate client cache clearing;
-- it does not authorise the room or any message after revocation.
create policy membership_read on public.chat_members for select to authenticated using((select private.actor_active()) and user_id=(select auth.uid()));
create policy messages_read on public.messages for select to authenticated using(private.can_access_chat_room(room_id));
create policy reactions_read on public.message_reactions for select to authenticated using(exists(select 1 from public.messages m where m.id=message_id and private.can_access_chat_room(m.room_id)));
create policy revisions_read on public.chat_message_revisions for select to authenticated using(exists(select 1 from public.messages m where m.id=message_id and private.can_access_chat_room(m.room_id)));

create function private.chat_contacts() returns table(id uuid,display_name text,roles text[]) language sql stable security definer set search_path='' as $$
 select p.id,p.display_name,array_agg(distinct r.role order by r.role) from public.profiles p join public.user_roles r on r.user_id=p.id
 where private.can_chat_contact(p.id) group by p.id,p.display_name order by p.display_name,p.id;
$$;
create function public.chat_contacts() returns table(id uuid,display_name text,roles text[]) language sql stable security invoker set search_path='' as $$ select * from private.chat_contacts(); $$;

create function private.ensure_general_chat() returns uuid language plpgsql security definer set search_path='' as $$
declare room uuid;
begin
 if not private.has_role(array['lecturer','senior_lecturer']) then raise exception 'Lecturer role required' using errcode='42501'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('chat-general',0));
 select id into room from public.chat_rooms where kind='general';
 if room is null then insert into public.chat_rooms(kind,title) values('general','Luminovia · Dozierende / Lecturers') returning id into room; end if;
 insert into public.chat_members(room_id,user_id) values(room,auth.uid()) on conflict(room_id,user_id) do update set removed_at=null;
 return room;
end;$$;
create function public.ensure_general_chat() returns uuid language sql security invoker set search_path='' as $$ select private.ensure_general_chat(); $$;

create function private.create_dm(p_user_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare pair text; room uuid;
begin
 if not private.can_chat_contact(p_user_id) then raise exception 'Contact is not available' using errcode='42501'; end if;
 pair=least(auth.uid()::text,p_user_id::text)||':'||greatest(auth.uid()::text,p_user_id::text);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('dm:'||pair,0));
 select id into room from public.chat_rooms where dm_key=pair;
 if room is null then
  insert into public.chat_rooms(kind,dm_key) values('dm',pair) returning id into room;
  insert into public.chat_members(room_id,user_id) values(room,auth.uid()),(room,p_user_id);
 end if;
 return room;
end;$$;
create function public.create_dm(p_user_id uuid) returns uuid language sql security invoker set search_path='' as $$ select private.create_dm(p_user_id); $$;

create function private.chat_rooms_list() returns table(id uuid,kind text,title text,job_id uuid,owner_id uuid,unread_count bigint,last_message_at timestamptz,muted boolean) language sql stable security definer set search_path='' as $$
 select r.id,r.kind,case when r.kind='dm' then coalesce((select p.display_name from public.chat_members other join public.profiles p on p.id=other.user_id where other.room_id=r.id and other.user_id<>auth.uid() limit 1),'') else coalesce(nullif(r.title,''),j.title,'') end,
 r.job_id,r.owner_id,
 (select count(*) from public.messages msg where msg.room_id=r.id and msg.sender_id<>auth.uid() and msg.deleted_at is null and (msg.created_at,msg.id)>(me.last_read_at,me.last_read_message_id)),
 (select max(msg.created_at) from public.messages msg where msg.room_id=r.id),me.muted
 from public.chat_rooms r join public.chat_members me on me.room_id=r.id and me.user_id=auth.uid() and me.removed_at is null left join public.jobs j on j.id=r.job_id
 where private.can_access_chat_room(r.id) order by coalesce((select max(msg.created_at) from public.messages msg where msg.room_id=r.id),r.created_at) desc,r.id;
$$;
create function public.chat_rooms_list() returns table(id uuid,kind text,title text,job_id uuid,owner_id uuid,unread_count bigint,last_message_at timestamptz,muted boolean) language sql stable security invoker set search_path='' as $$ select * from private.chat_rooms_list(); $$;

create function private.create_chat_group(p_title text,p_member_ids uuid[],p_kind text default 'topic',p_job_id uuid default null) returns uuid language plpgsql security definer set search_path='' as $$
declare room uuid; member uuid; course uuid; normalized uuid[];
begin
 if not private.actor_active() then raise exception 'Authentication required' using errcode='42501'; end if;
 if p_kind not in ('topic','participant_course') or p_kind is null or length(trim(coalesce(p_title,''))) not between 1 and 160 or cardinality(p_member_ids)>100 then raise exception 'Invalid group data' using errcode='22023'; end if;
 if p_kind='topic' and not private.chat_staff(auth.uid()) then raise exception 'Staff role required' using errcode='42501'; end if;
 if p_kind='participant_course' then
  if not private.has_permission('courses.manage') then raise exception 'courses.manage and MFA required' using errcode='42501'; end if;
  select course_run_id into course from public.jobs where public.jobs.id=p_job_id;
  if course is null then raise exception 'A real course run is required' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('participant-course:'||course::text,0));
  if exists(select 1 from public.chat_rooms where kind='participant_course' and course_run_id=course) then raise exception 'Participant channel already exists' using errcode='23505'; end if;
 end if;
 select array_agg(distinct x) into normalized from unnest(coalesce(p_member_ids,'{}')||array[auth.uid()]) x;
 foreach member in array normalized loop
  if not exists(select 1 from public.profiles p join public.user_roles ur on ur.user_id=p.id where p.id=member and p.active and ur.role in ('admin','management','senior_lecturer','lecturer','participant')) or (p_kind='topic' and not private.chat_staff(member)) then raise exception 'Invalid group member' using errcode='22023'; end if;
 end loop;
 insert into public.chat_rooms(kind,title,owner_id,course_run_id) values(p_kind,trim(p_title),auth.uid(),course) returning id into room;
 insert into public.chat_members(room_id,user_id) select room,x from unnest(normalized) x;
 insert into public.audit_events(actor_id,action,resource_id,details) values(auth.uid(),'chat.group_created',room,jsonb_build_object('kind',p_kind,'member_count',cardinality(normalized)));
 return room;
end;$$;
create function public.create_chat_group(p_title text,p_member_ids uuid[],p_kind text default 'topic',p_job_id uuid default null) returns uuid language sql security invoker set search_path='' as $$ select private.create_chat_group(p_title,p_member_ids,p_kind,p_job_id); $$;

create function private.chat_room_members(p_room_id uuid) returns table(user_id uuid,display_name text,joined_at timestamptz) language plpgsql stable security definer set search_path='' as $$
begin
 if not private.can_access_chat_room(p_room_id) then raise exception 'Room access denied' using errcode='42501'; end if;
 return query select m.user_id,p.display_name,m.joined_at from public.chat_members m join public.profiles p on p.id=m.user_id where m.room_id=p_room_id and m.removed_at is null order by p.display_name,p.id;
end;$$;
create function public.chat_room_members(p_room_id uuid) returns table(user_id uuid,display_name text,joined_at timestamptz) language sql stable security invoker set search_path='' as $$ select * from private.chat_room_members(p_room_id); $$;

create function private.manage_chat_member(p_room_id uuid,p_user_id uuid,p_remove boolean) returns void language plpgsql security definer set search_path='' as $$
declare room public.chat_rooms;
begin
 select * into room from public.chat_rooms where id=p_room_id for update;
 if not found or not private.can_access_chat_room(p_room_id) or room.kind in ('dm','general') then raise exception 'Membership management denied' using errcode='42501'; end if;
 if room.owner_id is distinct from auth.uid() and not (room.kind in ('participant_course','lecturer_course') and private.has_permission('courses.manage')) then raise exception 'Only the group owner may manage members' using errcode='42501'; end if;
 if p_remove is null or p_user_id=room.owner_id then raise exception 'The owner must remain a member' using errcode='22023'; end if;
 if p_remove then
  update public.chat_members set removed_at=clock_timestamp() where room_id=p_room_id and user_id=p_user_id and removed_at is null;
 else
  if not exists(select 1 from public.profiles p join public.user_roles ur on ur.user_id=p.id where p.id=p_user_id and p.active and ur.role in ('admin','management','senior_lecturer','lecturer','participant')) or (room.kind in ('topic','lecturer_course') and not private.chat_staff(p_user_id)) then raise exception 'Invalid group member' using errcode='22023'; end if;
  insert into public.chat_members(room_id,user_id) values(p_room_id,p_user_id) on conflict(room_id,user_id) do update set removed_at=null,joined_at=clock_timestamp();
 end if;
 insert into public.audit_events(actor_id,action,resource_id,details) values(auth.uid(),case when p_remove then 'chat.member_removed' else 'chat.member_added' end,p_room_id,jsonb_build_object('user_id',p_user_id));
end;$$;
create function public.manage_chat_member(p_room_id uuid,p_user_id uuid,p_remove boolean) returns void language sql security invoker set search_path='' as $$ select private.manage_chat_member(p_room_id,p_user_id,p_remove); $$;

create function private.chat_messages(p_room_id uuid,p_before_at timestamptz default null,p_before_id uuid default null,p_search text default '',p_limit int default 50)
returns table(id uuid,room_id uuid,sender_id uuid,sender_name text,body text,document_id uuid,created_at timestamptz,edited_at timestamptz,deleted_at timestamptz,reactions jsonb)
language plpgsql stable security definer set search_path='' as $$
begin
 if not private.can_access_chat_room(p_room_id) then raise exception 'Room access denied' using errcode='42501'; end if;
 if p_limit not between 1 and 100 or p_limit is null or length(coalesce(p_search,''))>200 then raise exception 'Invalid page' using errcode='22023'; end if;
 if (p_before_at is null)<>(p_before_id is null) then raise exception 'Complete cursor required' using errcode='22023'; end if;
 return query select m.id,m.room_id,m.sender_id,p.display_name,m.body,m.document_id,m.created_at,m.edited_at,m.deleted_at,
 coalesce((select jsonb_agg(jsonb_build_object('emoji',r.emoji,'count',r.n,'mine',r.mine) order by r.emoji) from
 (select mr.emoji,count(*) n,bool_or(mr.user_id=auth.uid()) mine from public.message_reactions mr where mr.message_id=m.id and mr.removed_at is null group by mr.emoji) r),'[]'::jsonb)
 from public.messages m join public.profiles p on p.id=m.sender_id
 where m.room_id=p_room_id and (p_before_at is null or (m.created_at,m.id)<(p_before_at,p_before_id))
 and (coalesce(p_search,'')='' or (m.deleted_at is null and strpos(lower(m.body),lower(p_search))>0))
 order by m.created_at desc,m.id desc limit p_limit;
end;$$;
create function public.chat_messages(p_room_id uuid,p_before_at timestamptz default null,p_before_id uuid default null,p_search text default '',p_limit int default 50)
returns table(id uuid,room_id uuid,sender_id uuid,sender_name text,body text,document_id uuid,created_at timestamptz,edited_at timestamptz,deleted_at timestamptz,reactions jsonb)
language sql stable security invoker set search_path='' as $$ select * from private.chat_messages(p_room_id,p_before_at,p_before_id,p_search,p_limit); $$;

create function private.send_message(p_room_id uuid,p_body text,p_client_id uuid,p_document_id uuid default null) returns uuid language plpgsql security definer set search_path='' as $$
declare previous public.messages; result uuid; signature text; actor uuid:=auth.uid();
begin
 if not private.can_access_chat_room(p_room_id) then raise exception 'Room access denied' using errcode='42501'; end if;
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
create function public.send_message(p_room_id uuid,p_body text,p_client_id uuid,p_document_id uuid default null) returns uuid language sql security invoker set search_path='' as $$ select private.send_message(p_room_id,p_body,p_client_id,p_document_id); $$;

create function private.edit_message(p_message_id uuid,p_body text) returns void language plpgsql security definer set search_path='' as $$
declare msg public.messages;
begin
 select * into msg from public.messages where id=p_message_id for update;
 if not found or not private.can_access_chat_room(msg.room_id) or msg.sender_id<>auth.uid() or msg.deleted_at is not null then raise exception 'Message edit denied' using errcode='42501'; end if;
 if msg.created_at<clock_timestamp()-interval '15 minutes' then raise exception 'The edit window has closed' using errcode='22023'; end if;
 if p_body is null or length(p_body)>8000 or (length(trim(p_body))=0 and msg.document_id is null) then raise exception 'Invalid message' using errcode='22023'; end if;
 insert into public.chat_message_revisions(message_id,actor_id,action,previous_body) values(msg.id,auth.uid(),'edited',msg.body);
 update public.messages set body=p_body,edited_at=clock_timestamp() where id=msg.id;
end;$$;
create function public.edit_message(p_message_id uuid,p_body text) returns void language sql security invoker set search_path='' as $$ select private.edit_message(p_message_id,p_body); $$;

create function private.delete_message(p_message_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare msg public.messages; room public.chat_rooms;
begin
 select * into msg from public.messages where id=p_message_id for update;
 if not found or not private.can_access_chat_room(msg.room_id) then raise exception 'Message delete denied' using errcode='42501'; end if;
 select * into room from public.chat_rooms where id=msg.room_id;
 if msg.sender_id<>auth.uid() and (room.kind='dm' or not (coalesce(room.owner_id=auth.uid(),false) or private.has_permission('chat.moderate'))) then raise exception 'Message delete denied' using errcode='42501'; end if;
 if msg.deleted_at is not null then return; end if;
 insert into public.chat_message_revisions(message_id,actor_id,action,previous_body) values(msg.id,auth.uid(),'deleted',msg.body);
 update public.messages set body='',document_id=null,deleted_at=clock_timestamp() where id=msg.id;
 update public.message_reactions set removed_at=clock_timestamp() where message_id=msg.id and removed_at is null;
end;$$;
create function public.delete_message(p_message_id uuid) returns void language sql security invoker set search_path='' as $$ select private.delete_message(p_message_id); $$;

create function private.react_to_message(p_message_id uuid,p_emoji text,p_remove boolean default false) returns void language plpgsql security definer set search_path='' as $$
declare room uuid;
begin
 select room_id into room from public.messages where id=p_message_id and deleted_at is null;
 if not private.can_access_chat_room(room) then raise exception 'Message access denied' using errcode='42501'; end if;
 if p_emoji not in ('👍','❤️','🎉','💡','👀','✅') or p_emoji is null or p_remove is null then raise exception 'Invalid reaction' using errcode='22023'; end if;
 insert into public.message_reactions(message_id,user_id,emoji,removed_at) values(p_message_id,auth.uid(),p_emoji,case when p_remove then clock_timestamp() else null end)
 on conflict(message_id,user_id,emoji) do update set removed_at=case when p_remove then clock_timestamp() else null end;
end;$$;
create function public.react_to_message(p_message_id uuid,p_emoji text,p_remove boolean default false) returns void language sql security invoker set search_path='' as $$ select private.react_to_message(p_message_id,p_emoji,p_remove); $$;

create function private.mark_chat_read(p_room_id uuid,p_message_id uuid default null,p_muted boolean default null) returns void language plpgsql security definer set search_path='' as $$
declare stamp timestamptz; message_id uuid;
begin
 if not private.can_access_chat_room(p_room_id) then raise exception 'Room access denied' using errcode='42501'; end if;
 if p_muted is not null then update public.chat_members set muted=p_muted where room_id=p_room_id and user_id=auth.uid(); end if;
 if p_message_id is null and p_muted is not null then return; end if;
 if p_message_id is null then select m.created_at,m.id into stamp,message_id from public.messages m where m.room_id=p_room_id order by m.created_at desc,m.id desc limit 1;
 else select m.created_at,m.id into stamp,message_id from public.messages m where m.id=p_message_id and m.room_id=p_room_id; if stamp is null then raise exception 'Message is not in this room' using errcode='22023'; end if; end if;
 if stamp is not null then update public.chat_members set last_read_at=stamp,last_read_message_id=message_id where room_id=p_room_id and user_id=auth.uid() and (last_read_at,last_read_message_id)<(stamp,message_id); end if;
end;$$;
create function public.mark_chat_read(p_room_id uuid,p_message_id uuid default null,p_muted boolean default null) returns void language sql security invoker set search_path='' as $$ select private.mark_chat_read(p_room_id,p_message_id,p_muted); $$;

insert into public.role_permissions(role,permission) values('admin','chat.moderate'),('management','chat.moderate') on conflict do nothing;
-- Only explicit wrappers and helpers needed by policies/storage are executable.
do $$declare item record; begin
 for item in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.proname in ('chat_staff','can_access_chat_room','can_attach_chat_document','can_chat_contact','chat_contacts','ensure_general_chat','create_dm','chat_rooms_list','create_chat_group','chat_room_members','manage_chat_member','chat_messages','send_message','edit_message','delete_message','react_to_message','mark_chat_read') loop
  execute format('revoke execute on function %s from public,anon,authenticated',item.signature);
  execute format('grant execute on function %s to authenticated',item.signature);
 end loop;
end;$$;
revoke execute on function private.chat_staff(uuid),private.can_chat_contact(uuid),private.can_attach_chat_document(uuid,uuid) from authenticated;
-- Real-time INSERT/UPDATE permissions are evaluated per changed row through RLS.
-- DELETE is avoided for messages, memberships and reactions; tombstones revoke safely.
do $$begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  alter publication supabase_realtime add table public.messages,public.message_reactions,public.chat_members;
 end if;
end;$$;
commit;
