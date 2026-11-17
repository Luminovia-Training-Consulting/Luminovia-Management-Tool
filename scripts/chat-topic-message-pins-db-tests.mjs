/** Real isolated PostgreSQL/RLS checks for topic-group message pins and deletion scopes. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { withTestDatabase, quoteSql as q } from "./testing/database.mjs";

await withTestDatabase("topic_message_pins", async ({ sql, actor }) => {
  const owner = randomUUID(),
    member = randomUUID(),
    admin = randomUUID(),
    foreign = randomUUID();
  await sql(`insert into auth.users(id,email) values ${[owner, member, admin, foreign].map((id) => `(${q(id)},${q(id + "@example.invalid")})`).join(",")};
   insert into public.user_roles(user_id,role) values (${q(owner)},'lecturer'),(${q(member)},'lecturer'),(${q(admin)},'admin'),(${q(foreign)},'admin');
   update public.profiles set display_name='Fictional person';`);
  const call = (who, statement, aal = "aal1") => actor(who, statement, aal);
  const room = await call(
    owner,
    `select public.create_chat_group('Fictional topic',array[${q(member)},${q(admin)}]::uuid[])`,
  );
  const msg = await call(
    member,
    `select public.send_message(${q(room)},'Fictional pinned message',${q(randomUUID())})`,
  );
  const pins = (who, aal = "aal1") =>
    call(who, `select public.chat_topic_pinned_messages(${q(room)})`, aal).then(
      JSON.parse,
    );
  const change = (who, message, pin, aal = "aal1") =>
    call(
      who,
      `select public.set_chat_topic_message_pin(${q(message)},${pin})`,
      aal,
    );
  await assert.rejects(change(member, msg, true), /42501/);
  await assert.rejects(change(foreign, msg, true, "aal2"), /42501/);
  await change(admin, msg, true);
  await Promise.all([change(owner, msg, true), change(owner, msg, true)]);
  assert.equal((await pins(member)).length, 1);
  assert.equal((await pins(member))[0].body, "Fictional pinned message");
  assert.equal(
    await sql(
      `select count(*) from public.audit_events where resource_id=${q(msg)} and action='chat.message_pinned'`,
    ),
    "1",
  );
  assert.equal(
    await sql(`select content_version from public.messages where id=${q(msg)}`),
    "1",
  );
  const messageScope = JSON.parse(
    await sql(`select private.deletion_snapshot('message',${q(msg)})`),
  );
  assert.equal(messageScope.counts["private.chat_topic_message_pins"], 1);
  console.log(
    "PASS owner, permission-based moderator and current membership determine group pins; retry and deletion scope are exact",
  );
  await change(admin, msg, false, "aal2");
  assert.equal((await pins(member)).length, 0);
  await change(admin, msg, true, "aal2");
  await call(member, `select public.hide_chat_message(${q(msg)})`);
  assert.deepEqual(await pins(member), []);
  assert.equal((await pins(owner)).length, 1);
  await call(
    owner,
    `select public.manage_chat_member(${q(room)},${q(member)},true)`,
  );
  await assert.rejects(pins(member), /42501/);
  await assert.rejects(change(member, msg, false), /42501/);
  assert.equal((await pins(owner)).length, 1);
  console.log(
    "PASS personal hiding and membership revocation never expose other participants' pinned text",
  );
  await call(admin, `select public.delete_message(${q(msg)})`, "aal2");
  assert.deepEqual(await pins(owner), []);
  assert.equal(
    await sql(
      `select count(*) from private.chat_topic_message_pins where message_id=${q(msg)}`,
    ),
    "0",
  );
  await assert.rejects(change(owner, msg, true), /42501/);
  const competing = await call(
    owner,
    `select public.send_message(${q(room)},'Concurrent pin and delete',${q(randomUUID())})`,
  );
  const outcomes = await Promise.allSettled([
    change(owner, competing, true),
    call(owner, `select public.delete_message(${q(competing)})`),
  ]);
  assert.equal(outcomes[1].status, "fulfilled");
  if (outcomes[0].status === "rejected")
    assert.match(outcomes[0].reason.message, /42501/);
  assert.equal(
    await sql(
      `select count(*) from private.chat_topic_message_pins where message_id=${q(competing)}`,
    ),
    "0",
  );
  assert.deepEqual(await pins(owner), []);
  const dm = await call(owner, `select public.create_dm(${q(admin)})`);
  const direct = await call(
    owner,
    `select public.send_message(${q(dm)},'private dm',${q(randomUUID())})`,
  );
  await assert.rejects(change(owner, direct, true), /42501/);
  await assert.rejects(
    sql(
      `begin;set local role anon;select public.chat_topic_pinned_messages(${q(room)});commit`,
    ),
    /42501|permission denied/,
  );
  console.log(
    "PASS deletion removes stale pins; DMs and anonymous access remain denied",
  );
});
