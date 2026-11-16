/**
 * Real Auth/HTTP checks for room membership, messages and access revocation.
 * Separate fictional identities verify actual API results and denied access; responses are not browser mocks.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { createClient } from "@supabase/supabase-js";
process.loadEnvFile(".env.test.local");
const url = process.env.SUPABASE_URL;
assert.ok(
  url && ["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname),
  "Chat checks only permit a loopback project.",
);
/** Creates a separate SDK client without persistent sessions or automatic session refresh. */
const make = (key) =>
  createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
const service = make(process.env.SUPABASE_SERVICE_ROLE_KEY);
const clients = [],
  users = [],
  rooms = [];
const suffix = randomUUID();
/** Requires actual SDK success before returning the response data. */
async function checked(request, label) {
  const { data, error } = await request;
  assert.equal(error, null, `${label}: ${error?.message}`);
  return data;
}
/** Creates separate fictional accounts and signs them in through Auth; their IDs belong only to the fixture. */
async function fixture(index, role) {
  const email = `chat-${index}-${suffix}@example.invalid`;
  const created = await checked(
    service.auth.admin.createUser({
      email,
      password: process.env.E2E_PASSWORD,
      email_confirm: true,
    }),
    "Create fictional temporary chat account",
  );
  users.push(created.user.id);
  await checked(
    service.from("user_roles").insert({ user_id: created.user.id, role }),
    "Set fixture role",
  );
  await checked(
    service
      .from("profiles")
      .update({ display_name: `Chat QA ${index}` })
      .eq("id", created.user.id),
    "Set fictional public name",
  );
  const client = make(process.env.SUPABASE_ANON_KEY);
  clients.push(client);
  const auth = await checked(
    client.auth.signInWithPassword({
      email,
      password: process.env.E2E_PASSWORD,
    }),
    "Actual Auth sign-in",
  );
  await client.realtime.setAuth(auth.session.access_token);
  return { client, id: created.user.id };
}
/** Connects a real Realtime subscription for this identity and waits until it is ready. */
async function subscribe(client, room, events, name) {
  const channel = client
    .channel(`qa-chat-${name}-${randomUUID()}`, {
      config: { postgres_changes_options: { wait: true, timeout: 15000 } },
    })
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "messages",
        filter: `room_id=eq.${room}`,
      },
      (payload) => events.push(payload.new),
    );
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Actual chat Realtime subscription timeout")),
      25_000,
    );
    channel.subscribe((status, error) => {
      if (status === "SUBSCRIBED") {
        clearTimeout(timeout);
        resolve();
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        clearTimeout(timeout);
        reject(error ?? new Error(status));
      }
    });
  });
  return channel;
}
/** Bounds the wait for an observable event; a timeout remains a test failure. */
async function eventually(predicate, label, ms = 10_000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await delay(50);
  }
  assert.fail(label);
}
try {
  const a = await fixture("alpha", "lecturer"),
    b = await fixture("beta", "lecturer"),
    outsider = await fixture("outsider", "lecturer"),
    admin = await fixture("admin", "admin"),
    participant = await fixture("participant", "participant");
  const contacts = await checked(
    a.client.rpc("chat_contacts"),
    "Names-only staff directory",
  );
  assert.ok(contacts.some((p) => p.id === b.id));
  assert.ok(!contacts.some((p) => p.id === participant.id));
  assert.ok(
    contacts.every((p) =>
      Object.keys(p).every((k) => ["id", "display_name", "roles"].includes(k)),
    ),
  );
  const dms = await Promise.all([
    checked(a.client.rpc("create_dm", { p_user_id: b.id }), "First DM"),
    checked(
      b.client.rpc("create_dm", { p_user_id: a.id }),
      "Concurrent reverse DM",
    ),
  ]);
  assert.equal(dms[0], dms[1]);
  rooms.push(dms[0]);
  // The membership endpoint exposes only current room members and their minimal public labels.
  const members = await checked(
    a.client.rpc("chat_room_members", { p_room_id: dms[0] }),
    "Actual private DM members",
  );
  assert.deepEqual(
    new Set(members.map((m) => m.user_id)),
    new Set([a.id, b.id]),
  );
  assert.ok(
    members.every((m) =>
      Object.keys(m).every((k) =>
        ["user_id", "display_name", "joined_at"].includes(k),
      ),
    ),
    "Membership projection contains no private profile fields",
  );
  const dm = dms[0],
    key = randomUUID();
  const message = await checked(
    a.client.rpc("send_message", {
      p_room_id: dm,
      p_body: "Actual private message",
      p_client_id: key,
    }),
    "Send actual private message",
  );
  assert.equal(
    await checked(
      a.client.rpc("send_message", {
        p_room_id: dm,
        p_body: "Actual private message",
        p_client_id: key,
      }),
      "Retry actual message",
    ),
    message,
  );
  assert.equal(
    (
      await checked(
        service.from("messages").select("id").eq("room_id", dm),
        "Check durable message row",
      )
    ).length,
    1,
  );
  for (const actor of [outsider, admin, participant]) {
    assert.equal(
      (
        await checked(
          actor.client.from("messages").select("id").eq("room_id", dm),
          "Private-message RLS",
        )
      ).length,
      0,
    );
    assert.equal(
      (await actor.client.rpc("chat_room_members", { p_room_id: dm })).error
        ?.code,
      "42501",
      "Nonmember cannot enumerate private room members",
    );
    assert.ok(
      (await actor.client.rpc("chat_messages", { p_room_id: dm })).error,
    );
    assert.ok(
      (
        await actor.client.rpc("send_message", {
          p_room_id: dm,
          p_body: "Forged",
          p_client_id: randomUUID(),
        })
      ).error,
    );
  }
  assert.ok((await participant.client.rpc("ensure_general_chat")).error);
  assert.ok(
    (
      await a.client
        .from("chat_members")
        .insert({ room_id: dm, user_id: outsider.id })
    ).error,
  );
  await checked(
    b.client.rpc("react_to_message", { p_message_id: message, p_emoji: "👍" }),
    "Add real reaction",
  );
  assert.deepEqual(
    (
      await checked(
        a.client.rpc("chat_messages", { p_room_id: dm }),
        "Read real message with reaction",
      )
    )[0].reactions,
    [{ emoji: "👍", count: 1, mine: false }],
  );
  await checked(
    b.client.rpc("mark_chat_read", { p_room_id: dm, p_message_id: message }),
    "Persist actual read state",
  );
  assert.equal(
    (await checked(b.client.rpc("chat_rooms_list"), "Unread room list")).find(
      (r) => r.id === dm,
    ).unread_count,
    0,
  );
  await checked(
    a.client.rpc("edit_message", {
      p_message_id: message,
      p_body: "Private corrected text",
    }),
    "Edit actual message",
  );
  assert.equal(
    (
      await checked(
        admin.client
          .from("chat_message_revisions")
          .select("id")
          .eq("message_id", message),
        "Private audit RLS",
      )
    ).length,
    0,
  );
  const group = await checked(
    a.client.rpc("create_chat_group", {
      p_title: "Fictional Realtime test group",
      p_member_ids: [b.id],
    }),
    "Create actual topic group",
  );
  rooms.push(group);
  assert.deepEqual(
    new Set(
      (
        await checked(
          b.client.rpc("chat_room_members", { p_room_id: group }),
          "Actual group membership",
        )
      ).map((m) => m.user_id),
    ),
    new Set([a.id, b.id]),
  );
  const ownerEvents = [],
    memberEvents = [],
    outsiderEvents = [];
  await subscribe(a.client, group, ownerEvents, "owner");
  await subscribe(b.client, group, memberEvents, "member");
  await subscribe(outsider.client, group, outsiderEvents, "outsider");
  const visible = await checked(
    a.client.rpc("send_message", {
      p_room_id: group,
      p_body: "Visible before removal",
      p_client_id: randomUUID(),
    }),
    "Send Realtime fixture",
  );
  await eventually(
    () =>
      ownerEvents.some((m) => m.id === visible) &&
      memberEvents.some((m) => m.id === visible),
    "Both actual authorised subscribers receive persisted message",
  );
  assert.equal(
    outsiderEvents.length,
    0,
    "Nonmember receives no persisted private events",
  );
  await checked(
    a.client.rpc("manage_chat_member", {
      p_room_id: group,
      p_user_id: b.id,
      p_remove: true,
    }),
    "Remove existing subscriber",
  );
  const hidden = await checked(
    a.client.rpc("send_message", {
      p_room_id: group,
      p_body: "Not visible after removal",
      p_client_id: randomUUID(),
    }),
    "Send after membership revocation",
  );
  await eventually(
    () => ownerEvents.some((m) => m.id === hidden),
    "Owner Realtime remains healthy after removal",
  );
  await delay(1200);
  assert.ok(
    !memberEvents.some((m) => m.id === hidden),
    "An already subscribed removed member receives no later message",
  );
  assert.ok((await b.client.rpc("chat_messages", { p_room_id: group })).error);
  // An existing signed-in session loses membership enumeration immediately after removal.
  assert.equal(
    (await b.client.rpc("chat_room_members", { p_room_id: group })).error?.code,
    "42501",
    "Already signed-in removed member cannot enumerate membership",
  );
  assert.deepEqual(
    (
      await checked(
        a.client.rpc("chat_room_members", { p_room_id: group }),
        "Removed member disappears from current projection",
      )
    ).map((m) => m.user_id),
    [a.id],
  );
  assert.ok(
    (
      await b.client.rpc("send_message", {
        p_room_id: group,
        p_body: "Removed member forged send",
        p_client_id: randomUUID(),
      })
    ).error,
  );
  assert.equal(
    (
      await checked(
        b.client.from("messages").select("id").eq("room_id", group),
        "Revoked direct REST read",
      )
    ).length,
    0,
  );
  await checked(
    a.client.rpc("manage_chat_member", {
      p_room_id: group,
      p_user_id: b.id,
      p_remove: false,
    }),
    "Re-add fixture member",
  );
  await checked(
    service.from("profiles").update({ active: false }).eq("id", b.id),
    "Suspend only temporary QA account",
  );
  const suspended = await checked(
    a.client.rpc("send_message", {
      p_room_id: group,
      p_body: "Not visible after suspension",
      p_client_id: randomUUID(),
    }),
    "Send after suspension",
  );
  await eventually(
    () => ownerEvents.some((m) => m.id === suspended),
    "Owner delivery remains healthy after suspension",
  );
  await delay(1200);
  assert.ok(
    !memberEvents.some((m) => m.id === suspended),
    "A subscribed suspended account receives no later persisted event",
  );
  assert.deepEqual(
    await checked(b.client.rpc("chat_rooms_list"), "Suspended room list"),
    [],
  );
  assert.equal(
    (await b.client.rpc("chat_room_members", { p_room_id: group })).error?.code,
    "42501",
    "Already signed-in suspended member cannot enumerate membership",
  );
  await checked(
    a.client.rpc("delete_message", { p_message_id: message }),
    "Delete via tombstone",
  );
  const deleted = await checked(
    a.client.rpc("chat_messages", { p_room_id: dm }),
    "Read deleted tombstone",
  );
  assert.equal(deleted[0].body, "");
  assert.ok(deleted[0].deleted_at);
  console.log(
    "PASS: actual Auth/REST and real WebSockets: race-safe private DMs, durable/idempotent messages, minimal directory, unread/reactions/edit/delete, admin/outsider/participant privacy, forged writes denied, active Realtime before removal, no later delivery after revocation or suspension.",
  );
} finally {
  for (const client of clients) await client.removeAllChannels();
  if (rooms.length) {
    const messages = await checked(
      service.from("messages").select("id").in("room_id", rooms),
      "Read only scoped QA messages for cleanup",
    );
    const ids = messages.map((m) => m.id);
    if (ids.length) {
      await checked(
        service.from("notifications").delete().in("resource_id", ids),
        "Remove only QA notifications",
      );
      await checked(
        service.from("message_reactions").delete().in("message_id", ids),
        "Remove only QA reactions",
      );
      await checked(
        service.from("chat_message_revisions").delete().in("message_id", ids),
        "Remove only QA revisions",
      );
      await checked(
        service.from("messages").delete().in("id", ids),
        "Remove only QA messages",
      );
    }
    await checked(
      service.from("chat_members").delete().in("room_id", rooms),
      "Remove only QA memberships",
    );
    await checked(
      service.from("chat_rooms").delete().in("id", rooms),
      "Remove only QA rooms",
    );
    await checked(
      service.from("audit_events").delete().in("resource_id", rooms),
      "Remove only QA group audit",
    );
  }
  for (const id of users)
    await checked(
      service.auth.admin.deleteUser(id),
      "Remove temporary QA account",
    );
}
