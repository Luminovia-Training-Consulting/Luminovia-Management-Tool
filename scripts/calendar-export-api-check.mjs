import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { withApiFixture } from "./testing/api.mjs";

await withApiFixture(async ({ actor, service, checked }) => {
  const owner = await actor("calendar-export-owner", "lecturer");
  const peer = await actor("calendar-export-peer", "lecturer");
  const admin = await actor("calendar-export-admin", "admin");
  const own = randomUUID(),
    foreign = randomUUID();
  await checked(
    service.from("personal_events").insert([
      {
        id: own,
        user_id: owner.id,
        title: "Own fictional appointment",
        starts_at: "2026-10-25T00:30:00Z",
        ends_at: "2026-10-25T01:30:00Z",
        time_zone: "Europe/Berlin",
      },
      {
        id: foreign,
        user_id: peer.id,
        title: "Foreign fictional appointment",
        starts_at: "2026-10-25T00:30:00Z",
        ends_at: "2026-10-25T01:30:00Z",
        time_zone: "Europe/Berlin",
      },
    ]),
    "Create own private export fixtures",
  );
  const args = {
    p_from: "2026-10-01T00:00:00Z",
    p_until: "2026-11-01T00:00:00Z",
    p_include_private: true,
  };
  assert.deepEqual(
    (await checked(owner.client.rpc("export_my_calendar", args))).map(
      (e) => e.id,
    ),
    [own],
  );
  assert.deepEqual(
    await checked(
      owner.client.rpc("export_my_calendar", {
        ...args,
        p_include_private: false,
      }),
    ),
    [],
  );
  assert.deepEqual(
    await checked(admin.client.rpc("export_my_calendar", args)),
    [],
  );
  assert.equal(
    (
      await owner.client.rpc("export_my_calendar", {
        ...args,
        p_until: "infinity",
      })
    ).error?.code,
    "22023",
  );
  assert.equal(
    (
      await owner.client.rpc("export_my_calendar", {
        ...args,
        p_user_id: peer.id,
      })
    ).error?.code,
    "PGRST202",
  );
  await checked(
    service.from("profiles").update({ active: false }).eq("id", owner.id),
  );
  assert.equal(
    (await owner.client.rpc("export_my_calendar", args)).error?.code,
    "42501",
  );
  console.log(
    "Actual Auth/REST calendar snapshot isolation, explicit private opt-in, bounds and immediate suspension passed.",
  );
});
