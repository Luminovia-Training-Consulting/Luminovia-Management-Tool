/** Actual native Auth/password-only authentication/REST audit reader; canonical disposable stack only. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { withApiFixture } from "./testing/api.mjs";

await withApiFixture(async ({ actor, passwordOnly, service, checked, suffix, url }) => {
  const administrator = await actor("audit-admin", "admin"),
    owner = await actor("audit-owner", "owner"),
    manager = await actor("audit-management", "management"),
    teacher = await actor("audit-lecturer", "lecturer");
  assert.equal(
    (await administrator.client.rpc("admin_audit_events")).error?.code,
    "42501",
  );
  await passwordOnly(administrator.client);
  await passwordOnly(owner.client);
  await passwordOnly(manager.client);
  for (const who of [manager, teacher])
    assert.equal(
      (await who.client.rpc("admin_audit_events")).error?.code,
      "42501",
    );
  await checked(
    teacher.client.auth.updateUser({
      data: { role: "admin", permissions: ["audit.read"] },
    }),
    "Editable metadata fixture",
  );
  assert.equal(
    (await teacher.client.rpc("admin_audit_events")).error?.code,
    "42501",
  );
  // Identical timestamps force the second cursor component; private JSON fields are deliberately populated.
  const label = `Fictional audit ${suffix}`,
    at = new Date(Date.now() - 3600000).toISOString(),
    ids = Array.from({ length: 45 }, randomUUID),
    secret = `PRIVATE audit fixture ${suffix}`;
  await checked(
    service
      .from("profiles")
      .update({ display_name: label })
      .eq("id", teacher.id),
    "Name scoped audit actor",
  );
  await checked(
    service.from("audit_events").insert(
      ids.map((id) => ({
        id,
        actor_id: teacher.id,
        action: "taxonomy.created",
        resource_id: randomUUID(),
        created_at: at,
        details: { body: secret, gross_amount: 1000 },
      })),
    ),
    "Seed same-timestamp actual audit records",
  );
  await checked(
    service.from("audit_events").insert(
      [
        "availability.created",
        "chat.member_added",
        "contract.executed_version_registered",
        "invoice.submitted",
        "job.lifecycle.unknown",
      ].map((action) => ({
        actor_id: teacher.id,
        action,
        resource_id: randomUUID(),
        details: { body: secret },
      })),
    ),
    "Seed scoped private/unknown actions",
  );
  // The allowed projection must restrict both returned fields and the set of permitted actions.
  const first = await checked(
    administrator.client.rpc("admin_audit_events", {
      p_search: label,
      p_limit: 20,
    }),
    "Read actual reduced audit page",
  );
  assert.equal(first.items.length, 20);
  assert.equal(first.has_more, true);
  assert.ok(first.items.every((item) => item.action === "taxonomy.created"));
  assert.deepEqual(Object.keys(first.items[0]).sort(), [
    "action",
    "actor_name",
    "created_at",
    "id",
    "resource_id",
  ]);
  assert.ok(!JSON.stringify(first).includes(secret));
  const all = [...first.items];
  let page = first;
  while (page.has_more) {
    page = await checked(
      owner.client.rpc("admin_audit_events", {
        p_from: first.from,
        p_to: first.to,
        p_search: label,
        p_limit: 20,
        p_before_at: page.next_cursor.at,
        p_before_id: page.next_cursor.id,
      }),
      "Read actual owner next cursor",
    );
    all.push(...page.items);
  }
  assert.deepEqual(
    all.map((item) => item.id),
    [...ids].sort().reverse(),
  );
  assert.equal(
    (
      await checked(
        administrator.client.rpc("admin_audit_events", { p_search: secret }),
        "Private JSON never searched",
      )
    ).items.length,
    0,
  );
  assert.equal(
    (
      await administrator.client.rpc("admin_audit_events", {
        p_action: "invoice.submitted",
      })
    ).error?.code,
    "22023",
  );
  assert.equal(
    (
      await administrator.client.rpc("admin_audit_events", {
        p_from: "2000-01-01T00:00:00Z",
        p_to: "2020-01-01T00:00:00Z",
      })
    ).error?.code,
    "22023",
  );
  // Read access grants no direct write access; later role revocation must take effect with the old token.
  const rewritten = await administrator.client
    .from("audit_events")
    .update({ action: "taxonomy.archived" })
    .eq("id", ids[0]);
  assert.ok(rewritten.error);
  await checked(
    service.from("user_roles").delete().eq("user_id", owner.id),
    "Revoke only scoped owner role",
  );
  assert.equal(
    (await owner.client.rpc("admin_audit_events")).error?.code,
    "42501",
  );
  await checked(
    service
      .from("profiles")
      .update({ active: false })
      .eq("id", administrator.id),
    "Suspend only scoped admin",
  );
  assert.equal(
    (await administrator.client.rpc("admin_audit_events")).error?.code,
    "42501",
  );
  const anonymous = createClient(url, process.env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const denied = await anonymous.rpc("admin_audit_events");
  assert.ok(denied.error);
  assert.equal(denied.data, null);
  console.log(
    "PASS: actual Auth/password-only authentication/REST audit capability, role/metadata boundaries, safe exact allowlist, no private JSON, same-timestamp keyset pagination, bounded validation, no client writes and old-token revocation.",
  );
});
