/**
 * Echte Auth-/HTTP-Prüfung für eigene Meldungen, Lesestatus und Kategorieeinstellungen.
 * Fiktive getrennte Identitäten prüfen bestätigte API-Ergebnisse und negative Zugriffe; keine Browser-Mocks.
 */
/** Actual Auth/REST notification preferences, ownership, cursor and revocation. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { withApiFixture } from "./testing/api.mjs";
import { quoteSql as q } from "./testing/database.mjs";

await withApiFixture(async ({ actor, service, checked, sql, defer, url }) => {
  const owner = await actor("inbox-owner", "lecturer"),
    peer = await actor("inbox-peer", "lecturer"),
    administrator = await actor("inbox-admin", "admin");
  const users = [owner.id, peer.id, administrator.id];
  let room;
  defer(async () => {
    await checked(
      service.from("notifications").delete().in("user_id", users),
      "Remove only own notification fixtures",
    );
    if (room)
      await sql(
        `delete from public.chat_message_revisions where message_id in(select id from public.messages where room_id=${q(room)});delete from public.message_reactions where message_id in(select id from public.messages where room_id=${q(room)});delete from public.messages where room_id=${q(room)};delete from public.chat_members where room_id=${q(room)};delete from public.chat_rooms where id=${q(room)};`,
      );
  });
  // Eine fremde Inbox und mehr Datensätze als eine Seite machen Isolation und Cursorfehler beobachtbar.
  const rows = Array.from({ length: 45 }, () => ({
    id: randomUUID(),
    user_id: owner.id,
    kind: "activity",
    resource_id: randomUUID(),
  }));
  const foreign = randomUUID();
  await checked(
    service.from("notifications").insert([
      ...rows,
      {
        id: foreign,
        user_id: peer.id,
        kind: "activity",
        resource_id: randomUUID(),
      },
    ]),
    "Create scoped fictional inboxes",
  );
  const page = await checked(
    owner.client.rpc("notification_inbox", { p_limit: 20 }),
    "Read actual notification page",
  );
  assert.equal(page.items.length, 20);
  assert.equal(page.unread_count, 45);
  assert.ok(!page.items.some((item) => item.id === foreign));
  const last = page.items.at(-1);
  const next = await checked(
    owner.client.rpc("notification_inbox", {
      p_limit: 20,
      p_before_at: last.created_at,
      p_before_id: last.id,
    }),
    "Read stable next cursor",
  );
  assert.equal(
    new Set([...page.items, ...next.items].map((item) => item.id)).size,
    40,
  );
  // Ein gemischter eigener/fremder Stapel muss vollständig scheitern, ohne eigene Meldungen teilweise zu ändern.
  const forged = await owner.client.rpc("mark_notifications", {
    p_ids: [rows[0].id, foreign],
    p_read: true,
  });
  assert.equal(forged.error?.code, "42501");
  assert.equal(
    (
      await checked(
        owner.client.rpc("notification_inbox"),
        "Check rejected batch",
      )
    ).unread_count,
    45,
  );
  assert.equal(
    (
      await checked(
        administrator.client.rpc("notification_inbox"),
        "Admin still has personal inbox only",
      )
    ).items.length,
    0,
  );
  // Nach dem gelesenen as_of eintreffende Meldungen dürfen durch späteres Sammellesen nicht verschwinden.
  const late = randomUUID();
  await checked(
    service.from("notifications").insert({
      id: late,
      user_id: owner.id,
      kind: "activity",
      resource_id: randomUUID(),
    }),
    "Create later arrival",
  );
  await checked(
    owner.client.rpc("mark_notifications", {
      p_all_before: page.as_of,
      p_read: true,
    }),
    "Mark only snapshot read",
  );
  const unread = await checked(
    owner.client.rpc("notification_inbox", { p_unread_only: true }),
    "Preserve later arrival unread",
  );
  assert.deepEqual(
    unread.items.map((item) => item.id),
    [late],
  );
  await checked(
    owner.client.rpc("mark_notifications", {
      p_ids: [rows[0].id],
      p_read: false,
    }),
    "Mark own notice unread again",
  );
  const preferences = await checked(
    owner.client.rpc("notification_preferences"),
    "Actual own defaults",
  );
  const payload = {
    chat: false,
    forum: false,
    job_updates: false,
    reminders: true,
  };
  // Zwei echte gleichzeitige Updates benutzen dieselbe Version: genau eines muss gewinnen.
  const saves = await Promise.all(
    [1, 2].map(() =>
      owner.client.rpc("save_notification_preferences", {
        p_payload: payload,
        p_expected_version: preferences.version,
      }),
    ),
  );
  assert.equal(saves.filter((result) => !result.error).length, 1);
  assert.equal(saves.find((result) => result.error)?.error.code, "40001");
  assert.equal(
    (
      await checked(
        peer.client.rpc("notification_preferences"),
        "Other account remains unchanged",
      )
    ).chat,
    true,
  );
  const current = await checked(
    owner.client.rpc("notification_preferences"),
    "Read updated version",
  );
  assert.equal(
    (
      await owner.client.rpc("save_notification_preferences", {
        p_payload: { ...payload, user_id: peer.id },
        p_expected_version: current.version,
      })
    ).error?.code,
    "22023",
  );
  await checked(
    service.from("notifications").insert({
      user_id: owner.id,
      kind: "chat_message",
      resource_id: randomUUID(),
    }),
    "Insert optional disabled event",
  );
  assert.ok(
    !(
      await checked(
        owner.client.rpc("notification_inbox"),
        "Read filtered future events",
      )
    ).items.some((item) => item.kind === "chat_message"),
  );
  room = await checked(
    owner.client.rpc("create_dm", { p_user_id: peer.id }),
    "Create actual private chat",
  );
  await checked(
    owner.client.rpc("send_message", {
      p_room_id: room,
      p_body: "Fictional notification message",
      p_client_id: randomUUID(),
    }),
    "Send actual chat event",
  );
  const messageNotice = (
    await checked(peer.client.rpc("notification_inbox"), "Current chat link")
  ).items.find((item) => item.kind === "chat_message");
  assert.equal(messageNotice.href, `/chats?room=${room}`);
  await checked(
    service
      .from("chat_members")
      .update({ removed_at: new Date().toISOString() })
      .eq("room_id", room)
      .eq("user_id", peer.id),
    "Revoke own fixture chat access",
  );
  const revoked = (
    await checked(
      peer.client.rpc("notification_inbox"),
      "Revalidate old chat notification",
    )
  ).items.find((item) => item.id === messageNotice.id);
  assert.equal(revoked.href, null);
  assert.equal(revoked.title, "");
  assert.ok(
    Number.isInteger(
      await checked(
        owner.client.rpc("refresh_my_notifications"),
        "Run actual scoped reminder check",
      ),
    ),
  );
  assert.equal(
    await checked(
      owner.client.rpc("refresh_my_notifications"),
      "Reminder retry is idempotent",
    ),
    0,
  );
  await checked(
    service.from("profiles").update({ active: false }).eq("id", peer.id),
    "Suspend only own API fixture",
  );
  assert.equal(
    (await peer.client.rpc("notification_inbox")).error?.code,
    "42501",
  );
  const anonymous = createClient(url, process.env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const denied = await anonymous.rpc("notification_inbox");
  assert.ok(denied.error);
  assert.equal(denied.data, null);
  console.log(
    "PASS: actual Auth/REST notification inbox, total count/cursor, personal admin boundary, atomic forged-batch denial, snapshot read state, concurrent preferences, optional categories, current/revoked chat links, reminder retry and old-token/anonymous denial.",
  );
});
