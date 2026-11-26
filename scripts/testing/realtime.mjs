import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as wait } from "node:timers/promises";

/** Wait for the server to register the Postgres Changes filter before writing a test event. */
export async function subscribeToRoom(client, room, table, eventTypes, events) {
  const channel = client.channel(`qa-room-${randomUUID()}`, {
    config: { postgres_changes_options: { wait: true, timeout: 15000 } },
  });
  for (const event of eventTypes) {
    channel.on(
      "postgres_changes",
      { event, schema: "public", table, filter: `room_id=eq.${room}` },
      (payload) => events.push(payload.new),
    );
  }
  let timeout;
  await new Promise((resolve, reject) => {
    timeout = setTimeout(
      () => reject(new Error(`Realtime subscription timeout: ${table}`)),
      25_000,
    );
    // The fixture owns teardown. Phoenix can emit CLOSED from inside
    // unsubscribe, so removing a channel in this callback can re-enter cleanup.
    channel.subscribe((status, error) => {
      if (status === "SUBSCRIBED") {
        resolve();
      } else if (
        status === "CHANNEL_ERROR" ||
        status === "TIMED_OUT" ||
        status === "CLOSED"
      ) {
        reject(error ?? new Error(status));
      }
    });
  }).finally(() => clearTimeout(timeout));
}

/** Fail if a real event has not arrived before the test's bounded deadline. */
export async function eventually(predicate, label, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await wait(50);
  }
  assert.fail(label);
}
