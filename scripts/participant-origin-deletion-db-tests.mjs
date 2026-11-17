/** Exercise participant provenance in actual scoped deletion previews and worker transactions. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";
let checks = 0;
await withTestDatabase(
  "participant_origin_deletion",
  async ({ sql, actor }) => {
    const admin = randomUUID(),
      member = randomUUID(),
      other = randomUUID(),
      roomA = randomUUID(),
      roomB = randomUUID(),
      message = randomUUID();
    await sql(`insert into auth.users(id,email) values (${q(admin)},'fixture-admin@example.invalid'),(${q(member)},'fixture-member@example.invalid'),(${q(other)},'fixture-other@example.invalid');
   insert into public.user_roles(user_id,role) values (${q(admin)},'admin'),(${q(member)},'lecturer'),(${q(other)},'lecturer');
   insert into public.chat_rooms(id,kind,title,owner_id) values (${q(roomA)},'participant_course','Fictional A',${q(admin)}),(${q(roomB)},'participant_course','Fictional B',${q(admin)});
   insert into public.chat_members(room_id,user_id) values (${q(roomA)},${q(admin)}),(${q(roomA)},${q(member)}),(${q(roomB)},${q(admin)}),(${q(roomB)},${q(other)});
   insert into private.participant_chat_origins(room_id,user_id,manual) values (${q(roomA)},${q(admin)},true),(${q(roomA)},${q(member)},true),(${q(roomB)},${q(admin)},true),(${q(roomB)},${q(other)},true);
   insert into public.messages(id,room_id,sender_id,client_id,request_hash,body) values(${q(message)},${q(roomB)},${q(admin)},${q(randomUUID())},'fixture','Fictional text');
   insert into private.chat_hidden_messages(user_id,message_id) values (${q(other)},${q(message)});
   create schema storage; create table storage.objects(bucket_id text,name text,primary key(bucket_id,name));
   create trigger permanent_deletion_storage_fence before insert or update on storage.objects for each row execute function private.guard_deleted_storage_path();`);
    const call = (name, args) =>
      actor(admin, `select public.${name}(${args})`, "aal2").then(JSON.parse);
    const service = (name, args) =>
      sql(
        `begin;set local role service_role;set local request.jwt.claims='{"role":"service_role"}';select public._deletion_${name}(${args});commit;`,
      ).then(JSON.parse);
    const preview = (kind, id) =>
      call("deletion_preview", `${q(kind)},${q(id)}`);
    const confirm = (plan) =>
      call(
        "deletion_confirm",
        `${q(plan.plan_id)},${q(randomUUID())},'DELETE'`,
      );
    const apply = async (plan) => {
      const operation = await confirm(plan);
      const permit = await call(
        "deletion_execution",
        q(operation.operation_id),
      );
      const keys = `${q(operation.operation_id)},${q(permit.permit_id)}`;
      await service("apply", keys);
      if (plan.kind === "account") {
        await assert.rejects(
          service("complete", `${keys},true,true`),
          /Auth deletion pending/,
        );
        // SQL-only fixture emulates native Auth deletion after the separate service step.
        await sql(`delete from auth.users where id=${q(plan.id)}`);
      }
      await service("complete", `${keys},true,true`);
    };
    const check = async (name, run) => {
      await run();
      checks++;
      console.log(`PASS ${name}`);
    };
    await check(
      "Room and account previews include only matching provenance rows and existing hidden-message scope",
      async () => {
        const a = await preview("account", member),
          r = await preview("chat_room", roomB);
        assert.equal(a.can_confirm, true);
        assert.equal(a.counts["private.participant_chat_origins"], 1);
        assert.equal(r.can_confirm, true);
        assert.equal(r.counts["private.participant_chat_origins"], 2);
        assert.equal(r.counts["private.chat_hidden_messages"], 1);
        const wiki = JSON.parse(
          await sql(
            `select private.deletion_scope('wiki_page',${q(randomUUID())})`,
          ),
        );
        assert.ok(
          wiki.some(
            (entry) => entry.table === "private.wiki_revision_attachments",
          ),
        );
      },
    );
    await check(
      "Changed provenance invalidates reviewed deletion before confirmation",
      async () => {
        const a = await preview("account", member),
          r = await preview("chat_room", roomB);
        await sql(
          `update private.participant_chat_origins set manual=false,unknown=true where room_id=${q(roomA)} and user_id=${q(member)}; update private.participant_chat_origins set manual=false,unknown=true where room_id=${q(roomB)} and user_id=${q(other)};`,
        );
        await assert.rejects(confirm(a), /scope changed/i);
        await assert.rejects(confirm(r), /scope changed/i);
      },
    );
    await check(
      "Confirmed account deletion removes only its own origins",
      async () => {
        await apply(await preview("account", member));
        assert.equal(
          await sql(
            `select count(*) from private.participant_chat_origins where user_id=${q(member)}`,
          ),
          "0",
        );
        assert.equal(
          await sql(
            `select count(*) from private.participant_chat_origins where room_id=${q(roomA)}`,
          ),
          "1",
        );
      },
    );
    await check(
      "Confirmed room deletion removes its provenance and hidden rows, preserving other rooms",
      async () => {
        await apply(await preview("chat_room", roomB));
        assert.equal(
          await sql(
            `select count(*) from private.participant_chat_origins where room_id=${q(roomB)}`,
          ),
          "0",
        );
        assert.equal(
          await sql(
            `select count(*) from private.chat_hidden_messages where message_id=${q(message)}`,
          ),
          "0",
        );
        assert.equal(
          await sql(
            `select count(*) from private.participant_chat_origins where room_id=${q(roomA)}`,
          ),
          "1",
        );
      },
    );
  },
);
console.log(`${checks} participant origin deletion checks passed`);
