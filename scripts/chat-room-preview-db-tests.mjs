/** Room previews follow current membership and per-actor message visibility. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

await withTestDatabase("chat_room_preview", async ({ sql, actor }) => {
  const [owner, peer, stranger] = Array.from({ length: 3 }, randomUUID);
  await sql(
    `insert into auth.users(id,email) values ${[owner, peer, stranger]
      .map((id) => `(${q(id)},${q(`${id}@example.invalid`)})`)
      .join(",")};
     insert into public.user_roles(user_id,role) values
       (${q(owner)},'lecturer'),(${q(peer)},'lecturer'),(${q(stranger)},'lecturer');`,
  );
  const room = await actor(
    owner,
    `select public.create_chat_group('Fictional preview room',array[${q(peer)}::uuid],'topic',null)`,
  );
  const older = await actor(
    owner,
    `select public.send_message(${q(room)},'Older visible message',${q(randomUUID())},null)`,
  );
  const newest = await actor(
    peer,
    `select public.send_message(${q(room)},'Newest visible message',${q(randomUUID())},null)`,
  );
  const previews = async (who) =>
    JSON.parse(
      await actor(
        who,
        "select coalesce(json_agg(row_to_json(room)),'[]'::json) from public.chat_rooms_with_manual_unread() room",
      ),
    );
  const read = async (who) =>
    (await previews(who)).find((entry) => entry.id === room);
  assert.equal(
    (await read(owner)).last_message_preview,
    "Newest visible message",
  );
  assert.equal(
    (await read(peer)).last_message_preview,
    "Newest visible message",
  );

  await actor(owner, `select public.hide_chat_message(${q(newest)})`);
  assert.equal(
    (await read(owner)).last_message_preview,
    "Older visible message",
  );
  assert.equal(
    (await read(peer)).last_message_preview,
    "Newest visible message",
  );

  await sql(
    `update public.messages set body='',deleted_at=clock_timestamp() where id=${q(newest)}`,
  );
  assert.equal((await read(peer)).last_message_preview, null);
  assert.equal(
    (await read(owner)).last_message_preview,
    "Older visible message",
  );
  assert.equal((await previews(stranger)).length, 0);

  await sql(
    `update public.chat_members set removed_at=clock_timestamp() where room_id=${q(room)} and user_id=${q(peer)}`,
  );
  assert.equal((await previews(peer)).length, 0);
  assert.equal((await read(owner)).id, room);
  assert.notEqual(older, newest);
  console.log(
    "PASS authorized preview, personal hidden-message scope, tombstone and membership revocation",
  );
});
