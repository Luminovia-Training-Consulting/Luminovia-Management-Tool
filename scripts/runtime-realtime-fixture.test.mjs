/** Protects Realtime fixture teardown from a reentrant Phoenix close signal. */
import assert from "node:assert/strict";
import test from "node:test";
import { subscribeToRoom } from "./testing/realtime.mjs";

test("a synchronous Realtime close during fixture teardown does not unsubscribe again", async () => {
  let notify;
  let removals = 0;
  const channel = {
    on() {},
    subscribe(callback) {
      notify = callback;
      notify("SUBSCRIBED");
    },
  };
  const client = {
    channel: () => channel,
    async removeChannel(ownedChannel) {
      assert.equal(ownedChannel, channel);
      removals += 1;
      // Phoenix invokes the subscribed status callback during Channel.leave.
      if (removals === 1) notify("CLOSED");
    },
  };

  await subscribeToRoom(client, "fixture-room", "messages", ["INSERT"], []);
  await client.removeChannel(channel);
  assert.equal(removals, 1);
});
