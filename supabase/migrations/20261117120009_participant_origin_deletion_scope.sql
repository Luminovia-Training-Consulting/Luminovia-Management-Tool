begin;
-- Participant-origin metadata is owned by its room/member pair and cascades
-- with either parent. Include it in the reviewed scope and hash before deletion;
-- preserve all preceding chat and wiki scope extensions through the chain.
alter function private.deletion_scope(text,uuid) rename to deletion_scope_before_participant_origins;
create function private.deletion_scope(p_kind text,p_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb:=private.deletion_scope_before_participant_origins(p_kind,p_id); predicate text;
begin
 if p_kind='account' then predicate=format('x.user_id=%L::uuid',p_id);
 elsif p_kind='chat_room' then predicate=format('x.room_id=%L::uuid',p_id);
 end if;
 if predicate is not null then result=private.deletion_add_scope(result,'private.participant_chat_origins',predicate); end if;
 return result;
end;$$;
revoke all on function private.deletion_scope_before_participant_origins(text,uuid),private.deletion_scope(text,uuid) from public,anon,authenticated,service_role;
commit;
