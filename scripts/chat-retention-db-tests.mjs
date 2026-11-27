/** Exercise permissions, concurrent configuration, and irreversible expiry against a disposable database. */
import { withTestDatabase } from "./testing/database.mjs";

await withTestDatabase("chat_retention", async ({ sql }) => {
  await sql(`
    begin;
    do $check$
    declare
      admin uuid := gen_random_uuid();
      learner uuid := gen_random_uuid();
      owner_room uuid := gen_random_uuid();
      kept_room uuid := gen_random_uuid();
      owned_message uuid := gen_random_uuid();
      kept_message uuid := gen_random_uuid();
      recent_message uuid := gen_random_uuid();
      sourced_task uuid := gen_random_uuid();
    begin
      insert into auth.users(id,email,email_confirmed_at) values
        (admin,'retention-admin@example.invalid',now()),
        (learner,'retention-learner@example.invalid',now());
      insert into public.user_roles(user_id,role) values (admin,'admin'),(learner,'participant');
      insert into public.chat_rooms(id,kind,title,owner_id) values
        (owner_room,'topic','Retention test',admin),
        (kept_room,'topic','Retention override',admin);
      insert into public.chat_members(room_id,user_id) values (owner_room,admin),(kept_room,admin);
      perform set_config('request.jwt.claims',jsonb_build_object('sub',learner,'role','authenticated')::text,true);
      begin
        perform public.set_chat_retention_policy(null,8,0);
        raise exception 'Unauthorized global edit succeeded';
      exception when insufficient_privilege then null; end;
      begin
        perform public.chat_retention_policy(owner_room);
        raise exception 'Unauthorized room read succeeded';
      exception when insufficient_privilege then null; end;
      perform set_config('request.jwt.claims',jsonb_build_object('sub',admin,'role','authenticated')::text,true);
      if (public.set_chat_retention_policy(null,8,0)->>'hours')::integer is distinct from 8 then
        raise exception 'Global policy save failed';
      end if;
      perform public.set_chat_retention_policy(kept_room,0,0);
      begin
        perform public.set_chat_retention_policy(kept_room,336,0);
        raise exception 'Stale override edit succeeded';
      exception when sqlstate 'PT409' then null; end;
      insert into public.messages(id,room_id,sender_id,client_id,request_hash,body,created_at) values
        (owned_message,owner_room,admin,gen_random_uuid(),'test','Expiry test',now()-interval '10h'),
        (kept_message,kept_room,admin,gen_random_uuid(),'test','Protected by override',now()-interval '10h'),
        (recent_message,owner_room,admin,gen_random_uuid(),'test','Still recent',now()-interval '1h');
      insert into public.chat_message_revisions(message_id,actor_id,action,previous_body)
        values(owned_message,admin,'edited','Old content');
      insert into public.message_reactions(message_id,user_id,emoji) values(owned_message,admin,'👍');
      insert into private.notification_preferences(user_id,chat) values(admin,true)
        on conflict(user_id) do update set chat=true;
      insert into public.notifications(user_id,kind,resource_id) values(admin,'chat_message',owned_message);
      if not exists(select 1 from public.notifications where resource_id=owned_message) then
        raise exception 'Test fixture did not create the chat notification';
      end if;
      insert into private.work_tasks(id,creator_id,assignee_id,scope,title,source_message_id,client_id,request_payload)
        values(sourced_task,admin,admin,'private','Independent follow-up',owned_message,gen_random_uuid(),
          jsonb_build_object('source_message_id',owned_message));
      if private.prune_chat_messages() <> 1 then raise exception 'Expected one expired message'; end if;
      if exists(select 1 from public.notifications where resource_id=owned_message)
        or exists(select 1 from public.messages where id=owned_message)
        or exists(select 1 from public.chat_message_revisions where message_id=owned_message)
        or exists(select 1 from public.message_reactions where message_id=owned_message)
        or exists(select 1 from private.chat_content_versions where message_id=owned_message) then
        raise exception 'Expired message residue';
      end if;
      if not exists(select 1 from private.work_tasks where id=sourced_task and source_message_id is null
        and request_payload->>'source_message_id' is null and version=2) then
        raise exception 'Independent task was not retained with a valid detached source';
      end if;
      if (select count(*) from public.messages where id in (recent_message,kept_message)) <> 2 then
        raise exception 'Protected or recent messages were removed';
      end if;
      if private.prune_chat_messages() <> 0 then raise exception 'Retry changed retained data'; end if;

      perform public.set_chat_retention_policy(kept_room,168,1);
      if private.prune_chat_messages() <> 0 then raise exception 'Seven-day policy expired a recent message'; end if;
      update public.messages set created_at=now()-interval '8 days' where id=kept_message;
      perform public.set_chat_retention_policy(kept_room,336,2);
      if private.prune_chat_messages() <> 0 then raise exception 'Fourteen-day policy expired an eight-day-old message'; end if;
      perform public.set_chat_retention_policy(kept_room,null,3);
      if private.prune_chat_messages() <> 1 then raise exception 'Inherited policy did not expire the eligible message'; end if;
    end
    $check$;
    rollback;
  `);
  console.log("PASS chat retention authority, precedence, expiry and dependent data");
});
