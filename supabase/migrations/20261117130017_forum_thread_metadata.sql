begin;
alter table public.forum_threads add column metadata_version integer not null default 1 check(metadata_version>0);
-- Retain the existing current-actor forum projection and append only the metadata CAS version.
alter function private.forum_thread(uuid) rename to forum_thread_before_metadata;
revoke all on function private.forum_thread_before_metadata(uuid) from public,anon,authenticated,service_role;
create function private.forum_thread(p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 result:=private.forum_thread_before_metadata(p_id);
 return result||jsonb_build_object('metadata_version',(select metadata_version from public.forum_threads where id=p_id));
end;$$;
create or replace function public.forum_thread(p_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$select private.forum_thread(p_id);$$;
revoke all on function private.forum_thread(uuid) from public,anon,authenticated,service_role;
grant execute on function private.forum_thread(uuid) to authenticated;
create function private.edit_forum_thread_metadata(p_thread_id uuid,p_title text,p_category_id uuid,p_expected_version integer) returns integer
language plpgsql security definer set search_path='' as $$
declare thread public.forum_threads; moderator boolean; next_version integer;
begin
 -- Serialize against account suspension/role withdrawal before authorizing.
 perform 1 from public.profiles where id=auth.uid() and active for share;
 if not found then raise exception 'Forum access denied' using errcode='42501';end if;
 perform 1 from public.user_roles where user_id=auth.uid() order by role for share;
 select * into thread from public.forum_threads where id=p_thread_id for update;
 if not found or not private.can_read_forum(p_thread_id) then raise exception 'Forum access denied' using errcode='42501';end if;
 moderator:=private.has_permission('forum.moderate');
 if not moderator and (thread.owner_id<>auth.uid() or thread.locked or thread.archived) then raise exception 'Forum edit denied' using errcode='42501';end if;
 if p_expected_version is null or p_expected_version<1 or p_title is null or length(trim(p_title)) not between 1 and 200 then raise exception 'Invalid forum metadata' using errcode='22023';end if;
 perform 1 from public.knowledge_categories where id=p_category_id and kind='forum' and not archived for share;
 if not found then raise exception 'Active forum category required' using errcode='22023';end if;
 if thread.metadata_version<>p_expected_version then raise exception 'Forum metadata changed' using errcode='40001';end if;
 update public.forum_threads set title=trim(p_title),category_id=p_category_id,metadata_version=metadata_version+1,updated_at=clock_timestamp() where id=p_thread_id returning metadata_version into next_version;
 insert into public.audit_events(actor_id,action,resource_id,details) values(auth.uid(),'forum.thread_metadata_updated',p_thread_id,jsonb_build_object('version',next_version,'category_changed',thread.category_id<>p_category_id));
 return next_version;
end;$$;
create function public.edit_forum_thread_metadata(p_thread_id uuid,p_title text,p_category_id uuid,p_expected_version integer) returns integer language sql security invoker set search_path='' as $$select private.edit_forum_thread_metadata(p_thread_id,p_title,p_category_id,p_expected_version);$$;
revoke all on function private.edit_forum_thread_metadata(uuid,text,uuid,integer),public.edit_forum_thread_metadata(uuid,text,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function private.edit_forum_thread_metadata(uuid,text,uuid,integer),public.edit_forum_thread_metadata(uuid,text,uuid,integer) to authenticated;
commit;
