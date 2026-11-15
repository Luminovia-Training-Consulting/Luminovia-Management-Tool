begin;
create or replace function private.can_attach_chat_document(p_document_id uuid,p_room_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.can_access_chat_room(p_room_id) and exists(
  select 1 from public.documents d join public.document_versions v on v.id=d.current_version_id
  where d.id=p_document_id and d.owner_id=auth.uid() and d.scope='room' and d.room_id=p_room_id and d.deleted_at is null and d.status='clean' and v.status='clean'
 );
$$;
alter table public.messages add constraint messages_document_fk foreign key(document_id) references public.documents(id);
revoke execute on function private.can_attach_chat_document(uuid,uuid) from public,anon,authenticated;
grant execute on function private.can_attach_chat_document(uuid,uuid) to authenticated;
commit;
