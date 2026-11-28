begin;

-- Use the room cursor index to select one visible page before decrypting its
-- output and looking up reactions and sender names.
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
  with page as materialized (
    select stored.* from public.messages stored
    where stored.room_id = p_room_id
      -- Bound the index scan at older cursors even with a generic plan.
      and stored.created_at <= coalesce(p_before_at, 'infinity'::timestamptz)
      and (p_before_at is null or (stored.created_at, stored.id) < (p_before_at, p_before_id))
      and case
        when exists (
          select 1 from private.chat_hidden_messages hidden
          where hidden.user_id = (select auth.uid()) and hidden.message_id = stored.id
        ) then false
        when coalesce(p_search, '') = '' then true
        when stored.deleted_at is not null then false
        else strpos(lower(private.chat_decrypt_text(
          'message:' || stored.id::text || ':' || stored.room_id::text || ':body', stored.body
        )), lower(p_search)) > 0
      end
    order by stored.created_at desc, stored.id desc
    limit p_limit
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
  from page message join public.profiles person on person.id = message.sender_id
  order by message.created_at desc, message.id desc;
end;
$$;

commit;
