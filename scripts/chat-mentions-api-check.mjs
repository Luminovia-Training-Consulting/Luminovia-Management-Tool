/** Actual password sessions, MFA and HTTP APIs. Only the canonical disposable stack. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { withApiFixture } from "./testing/api.mjs";
import { quoteSql as q } from "./testing/database.mjs";

await withApiFixture(async ({ actor, mfa, sql, defer, checked }) => {
  const author = await actor("mention-author", "lecturer"),
    target = await actor("mention-target", "lecturer"),
    peer = await actor("mention-peer", "lecturer"),
    outsider = await actor("mention-outsider", "lecturer"),
    admin = await actor("mention-admin", "admin");
  const users = [author, target, peer, outsider, admin].map((user) => user.id),
    rooms = [];
  defer(async () => {
    const people = users.map(q).join(",");
    await sql(`delete from public.notifications where user_id in(${people});`);
    if (rooms.length) {
      const owned = rooms.map(q).join(",");
      await sql(
        `begin;delete from public.message_reactions where message_id in(select id from public.messages where room_id in(${owned}));delete from public.chat_message_revisions where message_id in(select id from public.messages where room_id in(${owned}));delete from public.messages where room_id in(${owned});delete from public.chat_members where room_id in(${owned});delete from public.chat_rooms where id in(${owned});commit;`,
      );
    }
  });
  const room = await checked(
    author.client.rpc("create_chat_group", {
      p_title: "Fictional actual mention team",
      p_member_ids: [target.id, peer.id],
      p_kind: "topic",
    }),
    "Create real member-owned group",
  );
  rooms.push(room);
  const args = (body, ids = [], key = randomUUID()) => ({
    p_room_id: room,
    p_body: body,
    p_document_id: null,
    p_client_id: key,
    p_mention_ids: ids,
  });
  const history = () =>
    checked(
      author.client.rpc("chat_messages_with_mentions", { p_room_id: room }),
      "Read current authorized structured history",
    );
  const inbox = async () =>
    checked(
      target.client.rpc("notification_inbox", { p_limit: 100 }),
      "Read actual recipient inbox",
    );
  // Select by scoped message resource through the recipient's own RLS, not by a
  // title that may be redacted or collide with another committed group message.
  const notification = (message) =>
    checked(
      target.client
        .from("notifications")
        .select("*")
        .eq("resource_id", message)
        .eq("kind", "chat_message")
        .maybeSingle(),
      "Read own exact message notice",
    );
  let checks = 0;
  const pass = (name) => {
    checks++;
    console.log("PASS " + name);
  };
  const candidates = await checked(
    author.client.rpc("chat_mention_candidates", { p_room_id: room }),
    "Actual current-member picker",
  );
  assert.deepEqual(
    new Set(candidates.map((member) => member.user_id)),
    new Set([target.id, peer.id]),
  );
  assert.equal(
    (await outsider.client.rpc("chat_mention_candidates", { p_room_id: room }))
      .error?.code,
    "42501",
  );
  assert.equal(
    (
      await author.client.rpc(
        "send_message_with_mentions",
        args("Forbidden foreign target", [outsider.id]),
      )
    ).error?.code,
    "42501",
  );
  assert.equal(
    (
      await author.client.rpc(
        "send_message_with_mentions",
        args("Forbidden duplicate", [target.id, target.id]),
      )
    ).error?.code,
    "22023",
  );
  const sendArgs = args("Fictional actual <script> mention", [target.id]);
  const first = await checked(
    author.client.rpc("send_message_with_mentions", sendArgs),
    "Actually send structured mention",
  );
  assert.equal(
    await checked(
      author.client.rpc("send_message_with_mentions", sendArgs),
      "Retry actual send",
    ),
    first,
  );
  assert.equal(
    (
      await author.client.rpc("send_message_with_mentions", {
        ...sendArgs,
        p_mention_ids: [peer.id],
      })
    ).error?.code,
    "22023",
  );
  let row = (await history()).find((message) => message.id === first);
  assert.equal(row.content_version, 1);
  assert.deepEqual(
    row.mentions.map((member) => member.user_id),
    [target.id],
  );
  const firstNotice = await notification(first);
  assert.ok(firstNotice);
  pass(
    "actual Auth/current-member picker, structured send and exact retry binding",
  );

  const ordinary = await checked(
    author.client.rpc("send_message", {
      p_room_id: room,
      p_body: "Fictional ordinary before first mention",
      p_client_id: randomUUID(),
    }),
    "Existing headless send remains functional",
  );
  const initial = await notification(ordinary);
  await checked(
    target.client.rpc("mark_notifications", {
      p_ids: [initial.id],
      p_read: true,
    }),
    "Actually read general chat notice",
  );
  const read = await notification(ordinary);
  assert.ok(read.read_at);
  await checked(
    target.client.rpc("mark_chat_read", { p_room_id: room, p_muted: true }),
    "Mute room through actual API",
  );
  const editArgs = {
    p_message_id: ordinary,
    p_body: "Fictional first explicit revision mention",
    p_expected_version: 1,
    p_client_id: randomUUID(),
    p_mention_ids: [target.id],
  };
  const edited = await checked(
    author.client.rpc("edit_message_with_mentions", editArgs),
    "First mention renews read notice in muted room",
  );
  const renewed = await notification(ordinary);
  assert.equal(renewed.id, initial.id);
  assert.equal(renewed.read_at, null);
  assert.ok(Date.parse(renewed.created_at) >= Date.parse(initial.created_at));
  await checked(
    target.client.rpc("mark_notifications", {
      p_ids: [initial.id],
      p_read: true,
    }),
    "Read first actual mention once",
  );
  const once = await notification(ordinary);
  assert.deepEqual(
    await checked(
      author.client.rpc("edit_message_with_mentions", editArgs),
      "Retry exact edit",
    ),
    edited,
  );
  assert.deepEqual(await notification(ordinary), once);
  let version = 2;
  for (const ids of [[target.id], [], [target.id]]) {
    const result = await checked(
      author.client.rpc("edit_message_with_mentions", {
        ...editArgs,
        p_body: `Fictional revision ${version}`,
        p_expected_version: version,
        p_client_id: randomUUID(),
        p_mention_ids: ids,
      }),
      "Committed repeat/removal/re-add never renews again",
    );
    version = result.version;
    assert.deepEqual(await notification(ordinary), once);
  }
  assert.equal(
    (
      await author.client.rpc("edit_message_with_mentions", {
        ...editArgs,
        p_client_id: randomUUID(),
      })
    ).error?.code,
    "40001",
  );
  assert.equal(
    (
      await peer.client.rpc("edit_message_with_mentions", {
        ...editArgs,
        p_client_id: randomUUID(),
      })
    ).error?.code,
    "42501",
  );
  pass(
    "real first-general-read to first-mention renewal, preserved read state on retry/edit/remove-readd and exact CAS/ownership denials",
  );

  const preferences = await checked(
    target.client.rpc("notification_preferences"),
    "Read actual category preferences",
  );
  await checked(
    target.client.rpc("save_notification_preferences", {
      p_expected_version: preferences.version,
      p_payload: {
        chat: false,
        forum: preferences.forum,
        job_updates: preferences.job_updates,
        reminders: preferences.reminders,
      },
    }),
    "Disable global optional chat notices",
  );
  const suppressed = await checked(
    author.client.rpc(
      "send_message_with_mentions",
      args("Fictional suppressed explicit mention", [target.id]),
    ),
    "Send is persisted while recipient notices are disabled",
  );
  assert.equal(await notification(suppressed), null);
  assert.equal(
    (await history()).find((message) => message.id === suppressed).mentions
      .length,
    1,
  );
  pass(
    "room mute does not suppress explicit mention but global chat opt-out suppresses notice",
  );

  await checked(
    author.client.rpc("manage_chat_member", {
      p_room_id: room,
      p_user_id: target.id,
      p_remove: true,
    }),
    "Remove current mention recipient",
  );
  assert.equal(
    (
      await target.client.rpc("chat_messages_with_mentions", {
        p_room_id: room,
      })
    ).error?.code,
    "42501",
  );
  assert.equal(
    (await author.client.rpc("send_message_with_mentions", sendArgs)).error
      ?.code,
    "42501",
  );
  assert.ok(
    !(
      await checked(
        author.client.rpc("chat_mention_candidates", { p_room_id: room }),
        "Fresh candidates after removal",
      )
    ).some((member) => member.user_id === target.id),
  );
  row = (await history()).find((message) => message.id === first);
  assert.deepEqual(row.mentions, []);
  const dm = await checked(
    author.client.rpc("create_dm", { p_user_id: peer.id }),
    "Existing profile-DM API remains connected",
  );
  rooms.push(dm);
  await checked(
    author.client.rpc("send_message_with_mentions", {
      ...args("Fictional private mention", [peer.id]),
      p_room_id: dm,
    }),
    "Real private direct message mention",
  );
  await mfa(admin.client);
  assert.equal(
    (await admin.client.rpc("chat_messages_with_mentions", { p_room_id: dm }))
      .error?.code,
    "42501",
  );
  assert.ok(
    (
      await checked(
        author.client.rpc("chat_messages_with_mentions", { p_room_id: dm }),
        "Private DM has no moderation bypass",
      )
    ).every((message) => message.can_moderate === false),
  );
  pass(
    "actual old-token revocation and MFA administrator isolation from foreign direct messages",
  );

  const peerMessage = await checked(
    peer.client.rpc(
      "send_message_with_mentions",
      args("Fictional moderator-removable group contribution", []),
    ),
    "Peer posts to owned group",
  );
  assert.equal(
    (await history()).find((message) => message.id === peerMessage)
      .can_moderate,
    true,
  );
  await checked(
    author.client.rpc("delete_message", { p_message_id: peerMessage }),
    "Existing authorized owner moderation API",
  );
  const deleted = (await history()).find(
    (message) => message.id === peerMessage,
  );
  assert.equal(deleted.body, "");
  assert.deepEqual(deleted.mentions, []);
  assert.ok(deleted.deleted_at);
  assert.ok(
    (
      await outsider.client
        .schema("private")
        .from("chat_mention_versions")
        .select("*")
    ).error,
  );
  const redacted = (await inbox()).items.find(
    (item) => item.id === firstNotice.id,
  );
  assert.ok(redacted);
  assert.equal(redacted.href, null);
  assert.equal(redacted.title, "");
  pass(
    "visible moderation metadata agrees with the real delete policy and private mention history stays inaccessible",
  );
  console.log(
    `${checks} actual Auth/MFA/REST structured mention groups passed.`,
  );
});
