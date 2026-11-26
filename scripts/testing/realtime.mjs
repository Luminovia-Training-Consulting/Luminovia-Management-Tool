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
  try {
    await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (error) reject(error);
        else resolve();
      };
      const timeout = setTimeout(
        () => finish(new Error(`Realtime subscription timeout: ${table}`)),
        25_000,
      );
      channel.subscribe((status, error) => {
        if (status === "SUBSCRIBED") {
          finish();
        } else if (
          status === "CHANNEL_ERROR" ||
          status === "TIMED_OUT" ||
          status === "CLOSED"
        ) {
          finish(error ?? new Error(status));
        }
      });
    });
  } catch (error) {
    // Unsubscribing fires CLOSED, including during ordinary fixture teardown.
    // Do it outside the status callback and only for a failed initial join.
    await client.removeChannel(channel);
    throw error;
  }
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
