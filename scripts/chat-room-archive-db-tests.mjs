/** Personal archive stays bound to current room membership and never alters shared data. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";
await withTestDatabase("chat_personal_archive", async ({ sql, actor }) => {
  const [a, b, stranger, course] = Array.from({ length: 4 }, randomUUID);
  await sql(`insert into auth.users(id,email) values ${[a, b, stranger].map((id) => `(${q(id)},${q(id + "@example.invalid")})`).join(",")};
 insert into public.user_roles(user_id,role) values(${q(a)},'lecturer'),(${q(b)},'lecturer'),(${q(stranger)},'lecturer');`);
  const topic = await actor(
    a,
    `select public.create_chat_group('Fictional group',array[${q(b)}::uuid],'topic',null)`,
  );
  const dm = await actor(a, `select public.create_dm(${q(b)})`);
  await sql(
    `insert into public.chat_rooms(id,kind,title) values(${q(course)},'lecturer_course','Fictional course');insert into public.chat_members(room_id,user_id) values(${q(course)},${q(a)});`,
  );
  const set = (who, id, flag) =>
    actor(who, `select public.set_chat_personal_archive(${q(id)},${flag})`);
  const list = async (who) =>
    JSON.parse(
      await actor(who, `select to_json(public.chat_personal_archives())`),
    );
  await set(a, topic, "true");
  await set(a, dm, "true");
  assert.deepEqual((await list(a)).sort(), [topic, dm].sort());
  assert.deepEqual(await list(b), []);
  assert.equal(
    await actor(
      b,
      `select count(*) from public.chat_rooms_list() where id=${q(topic)}`,
    ),
    "1",
  );
  await actor(
    a,
    `select public.send_message(${q(topic)},'Fictional retained access',${q(randomUUID())},null)`,
  );
  assert.equal(
    await actor(
      b,
      `select count(*) from public.chat_messages(${q(topic)}) where body='Fictional retained access'`,
    ),
    "1",
  );
  assert.equal(
    await actor(
      a,
      `select count(*) from public.chat_rooms_list() where id in (${q(topic)},${q(dm)})`,
    ),
    "2",
  );
  await assert.rejects(set(stranger, topic, "true"), /42501/);
  await assert.rejects(set(a, course, "true"), /22023/);
  await assert.rejects(set(a, topic, "null"), /22023/);
  await assert.rejects(
    actor(
      a,
      `update public.chat_members set personal_archived=true where room_id=${q(topic)} and user_id=${q(b)}`,
    ),
    /42501/,
  );
  await set(a, topic, "false");
  assert.deepEqual(await list(a), [dm]);
  await sql(
    `update public.chat_members set removed_at=clock_timestamp() where room_id=${q(dm)} and user_id=${q(a)}`,
  );
  assert.deepEqual(await list(a), []);
  await assert.rejects(set(a, dm, "false"), /42501/);
  await sql(`update public.profiles set active=false where id=${q(a)}`);
  await assert.rejects(set(a, topic, "true"), /42501/);
  await assert.rejects(
    sql(`set role anon;select public.chat_personal_archives()`),
    /42501/,
  );
  console.log(
    "PASS personal archive/restore, isolation, course exclusion, forgery, removal and suspension",
  );
});
