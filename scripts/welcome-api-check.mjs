/** Actual Auth/REST progress persistence; no normal development project writes. */
import assert from "node:assert/strict";
import { withApiFixture } from "./testing/api.mjs";
await withApiFixture(async ({ service, actor, checked }) => {
  const first = await actor("welcome-first", "lecturer"),
    peer = await actor("welcome-peer", "lecturer"),
    admin = await actor("welcome-admin", "admin");
  const read = (who) => checked(who.client.rpc("get_welcome_progress"));
  const save = (who, step, status, version) =>
    who.client.rpc("save_welcome_progress", {
      p_step: step,
      p_status: status,
      p_expected_version: version,
    });
  assert.deepEqual(await read(first), {
    step: "welcome",
    status: "active",
    version: 0,
  });
  assert.deepEqual(await checked(save(first, "profile", "active", 0)), {
    step: "profile",
    status: "active",
    version: 1,
  });
  assert.equal(
    (await save(first, "security", "paused", 1)).error?.code,
    "22023",
  );
  assert.deepEqual(await read(first), {
    step: "profile",
    status: "active",
    version: 1,
  });
  assert.deepEqual(await read(peer), {
    step: "welcome",
    status: "active",
    version: 0,
  });
  assert.deepEqual(await read(admin), {
    step: "welcome",
    status: "active",
    version: 0,
  });
  assert.equal((await save(first, "files", "active", 0)).error?.code, "40001");
  assert.ok(
    (
      await first.client.rpc("save_welcome_progress", {
        p_step: "files",
        p_status: "active",
        p_expected_version: 1,
        p_user_id: peer.id,
      })
    ).error,
  );
  assert.ok((await peer.client.from("welcome_progress").select("*")).error);
  assert.ok((await admin.client.from("welcome_progress").select("*")).error);
  await checked(
    service.from("profiles").update({ active: false }).eq("id", first.id),
  );
  assert.equal(
    (await first.client.rpc("get_welcome_progress")).error?.code,
    "42501",
  );
  assert.equal(
    (await save(first, "finish", "completed", 1)).error?.code,
    "42501",
  );
  console.log(
    "PASS Actual Auth/REST welcome progress persists, isolates peers/admin, rejects stale/forged/direct access and blocks suspended sessions.",
  );
});
