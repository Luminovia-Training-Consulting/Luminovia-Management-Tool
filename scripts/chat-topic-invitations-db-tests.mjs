/** Fictional, isolated PostgreSQL tests of invitation consent and current authority. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";
await withTestDatabase("chat_topic_invitations", async ({ sql, actor }) => {
  const [owner, peer, other, outsider] = Array.from({ length: 4 }, randomUUID);
  await sql(
    `insert into auth.users(id,email) values ${[owner, peer, other, outsider].map((id) => `(${q(id)},${q(id + "@example.invalid")})`).join(",")}; insert into public.user_roles(user_id,role) values(${q(owner)},'lecturer'),(${q(peer)},'lecturer'),(${q(other)},'lecturer'),(${q(outsider)},'participant');`,
  );
  const call = (who, fn, args = "") =>
    actor(who, `select public.${fn}(${args})`);
  const list = (who) =>
    actor(
      who,
      "select coalesce(json_agg(x),'[]') from public.topic_invitation_inbox() x",
    ).then(JSON.parse);
  const room = await call(
    owner,
    "create_chat_group",
    `${q("Fictional topic")},array[${q(other)}]::uuid[],'topic',null`,
  );
  const invite = () =>
    call(owner, "invite_topic_member", `${q(room)},${q(peer)}`);
  await assert.rejects(
    call(other, "invite_topic_member", `${q(room)},${q(peer)}`),
    /42501/,
  );
  await assert.rejects(
    call(owner, "invite_topic_member", `${q(room)},${q(outsider)}`),
    /42501/,
  );
  const id = await invite();
  assert.equal(await invite(), id);
  assert.equal((await list(peer))[0].id, id);
  assert.equal((await list(other)).length, 0);
  assert.equal(
    await actor(
      peer,
      `select count(*) from public.chat_rooms where id=${q(room)}`,
    ),
    "0",
  );
  await assert.rejects(
    call(other, "respond_topic_invitation", `${q(id)},true`),
    /42501/,
  );
  await assert.rejects(
    actor(peer, "select * from private.chat_topic_invitations"),
    /42501/,
  );
  assert.equal(
    await call(peer, "respond_topic_invitation", `${q(id)},true`),
    room,
  );
  assert.equal(
    await call(peer, "respond_topic_invitation", `${q(id)},true`),
    room,
  );
  assert.equal(
    await actor(
      peer,
      `select count(*) from public.chat_rooms where id=${q(room)}`,
    ),
    "1",
  );
  await assert.rejects(call(owner, "revoke_topic_invitation", q(id)), /40001/);
  await call(owner, "manage_chat_member", `${q(room)},${q(peer)},true`);
  await assert.rejects(
    call(peer, "respond_topic_invitation", `${q(id)},true`),
    /42501/,
  );
  const second = await invite();
  assert.notEqual(second, id);
  assert.equal(
    await call(peer, "respond_topic_invitation", `${q(second)},false`),
    room,
  );
  assert.equal(
    await call(peer, "respond_topic_invitation", `${q(second)},false`),
    room,
  );
  await assert.rejects(
    call(peer, "respond_topic_invitation", `${q(second)},true`),
    /42501/,
  );
  const third = await invite();
  assert.notEqual(third, second);
  const result = await Promise.allSettled([
    call(peer, "respond_topic_invitation", `${q(third)},true`),
    call(peer, "respond_topic_invitation", `${q(third)},false`),
  ]);
  assert.equal(result.filter((x) => x.status === "fulfilled").length, 1);
  const transferred = await call(
    owner,
    "create_chat_group",
    `${q("Fictional transfer")},array[${q(other)}]::uuid[],'topic',null`,
  );
  const stale = await call(
    owner,
    "invite_topic_member",
    `${q(transferred)},${q(peer)}`,
  );
  await call(
    owner,
    "transfer_topic_group_owner",
    `${q(transferred)},${q(other)}`,
  );
  await assert.rejects(
    call(peer, "respond_topic_invitation", `${q(stale)},true`),
    /42501/,
  );
  assert.equal(
    (await list(peer)).some((item) => item.id === stale),
    false,
  );
  const fresh = await call(
    other,
    "invite_topic_member",
    `${q(transferred)},${q(peer)}`,
  );
  assert.notEqual(fresh, stale);
  await sql(`update public.profiles set active=false where id=${q(peer)}`);
  assert.equal(
    await actor(
      other,
      `select count(*) from public.topic_invitation_sent(${q(transferred)})`,
    ),
    "0",
  );
  await assert.rejects(
    call(peer, "respond_topic_invitation", `${q(fresh)},true`),
    /42501/,
  );
  assert.deepEqual(await list(peer), []);
  await sql(`update public.profiles set active=true where id=${q(peer)}`);
  assert.equal(
    await call(peer, "respond_topic_invitation", `${q(fresh)},true`),
    transferred,
  );
  const scope = JSON.parse(
    await sql(`select private.deletion_snapshot('chat_room',${q(room)})`),
  );
  assert.equal(scope.counts["private.chat_topic_invitations"], 1);
  const accountScope = JSON.parse(
    await sql(`select private.deletion_snapshot('account',${q(peer)})`),
  );
  assert.equal(accountScope.counts["private.chat_topic_invitations"], 2);
  await assert.rejects(
    actor(peer, `set local role anon;select public.topic_invitation_inbox()`),
    /42501|permission denied/,
  );
  console.log(
    "PASS topic invitations require owner and invitee consent, preserve isolation, bind retries, serialize decisions and enter reviewed deletion scope",
  );
});
