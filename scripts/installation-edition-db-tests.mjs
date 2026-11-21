/** Dedicated installation state and Data API boundary on disposable PostgreSQL databases. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

/** Match PostgREST's role/path/method settings without opening a service. */
const request = (path, method) =>
  `set local request.path=${q(path)}; set local request.method=${q(method)}; select public.require_portal_access();`;
const capability = "select public.installation_capabilities()";
const provision = (id, edition) =>
  `select private.provision_customer_installation(${q(id)}, ${q(edition)});`;
const install = (terms) =>
  `select private.apply_verified_installation_licence(${q(JSON.stringify(terms))}::jsonb);`;

await withTestDatabase("internal_edition", async ({ sql, actor }) => {
  const admin = randomUUID();
  const status = JSON.parse(await sql(`set role anon; ${capability}`));
  assert.equal(status.edition, "internal");
  assert.equal(status.licence_status, "not-required");
  assert.equal(status.marketplace_available, true);
  assert.equal(status.company_premium_switch_available, true);
  assert.equal(status.lms_available, true);
  assert.match(status.installation_id, /^[0-9a-f-]{36}$/);
  assert.deepEqual(JSON.parse(await sql(capability)), status);
  assert.equal(
    await sql(`select 'security_invoker=true' = any(reloptions)
      from pg_class where oid = 'public.installation_capability_state'::regclass`),
    "t",
  );
  assert.equal(
    await sql("select private.customer_installation_has_active_licence()"),
    "f",
  );

  // Existing installations are never automatically converted or locked down.
  await sql(`insert into auth.users(id,email) values (${q(admin)},'admin@example.invalid');
    insert into public.user_roles(user_id,role) values (${q(admin)},'admin');`);
  assert.equal(
    await actor(
      admin,
      `${request("/rpc/portal_access", "POST")} select public.portal_access();`,
    ),
    "t",
  );
  await assert.rejects(
    sql(provision(randomUUID(), "customer-managed")),
    /55000/,
  );
  await assert.rejects(
    actor(admin, provision(randomUUID(), "customer-self-hosted")),
    /42501/,
  );
  assert.deepEqual(JSON.parse(await sql(capability)), status);
  console.log(
    "PASS existing internal installation, actor authority and populated-instance conversion denial",
  );
});

for (const edition of ["customer-self-hosted", "customer-managed"]) {
  await withTestDatabase("customer_edition", async ({ sql, actor }) => {
    const id = randomUUID();
    const admin = randomUUID();
    const assertCapabilities = async (licence_status) => {
      const expected = {
        installation_id: id,
        edition,
        licence_status,
        customer_ready: false,
        lms_available: false,
        marketplace_available: false,
        company_premium_switch_available: false,
      };
      assert.deepEqual(
        JSON.parse(
          await sql(`begin;set local role anon;
          ${request("/rpc/installation_capabilities", "POST")}
          ${capability};commit;`),
        ),
        expected,
      );
      for (const role of ["authenticated", "service_role"]) {
        assert.deepEqual(JSON.parse(await sql(`set role ${role}; ${capability}`)), expected);
        await assert.rejects(sql(`set role ${role}; select * from private.installation_verified_licence`), /42501/);
      }
      assert.equal(
        await sql("select private.customer_installation_has_active_licence()"),
        licence_status === "active" ? "t" : "f",
      );
    };
    await assert.rejects(sql(provision(id, "internal")), /22023/);
    await sql(provision(id, edition));
    await sql(provision(id, edition));
    await assert.rejects(sql(provision(randomUUID(), edition)), /55000/);
    await assert.rejects(
      sql("delete from private.installation_identity"),
      /55000/,
    );
    await assert.rejects(
      sql("update private.installation_identity set edition='internal'"),
      /55000/,
    );
    await assertCapabilities("unlicensed");

    const now = Date.now();
    const day = 86400000;
    const at = (days) => new Date(now + day * days).toISOString();
    const limits = {
      seat_count: 50,
      storage_bytes: 2147483648,
      api_requests_per_minute: 60,
    };
    const terms = (issued, starts, expires, grace) => ({
      installation_id: id,
      edition,
      release_commit: "0123456789abcdef0123456789abcdef01234567",
      issued_at: at(issued),
      starts_at: at(starts),
      expires_at: at(expires),
      grace_until: at(grace),
      modules: ["lms"],
      limits,
    });
    const scheduled = terms(-14, 3, 8, 9);
    await assert.rejects(
      sql(install({ ...scheduled, edition: "internal" })),
      /22023/,
    );
    await assert.rejects(
      sql(install({ ...scheduled, installation_id: randomUUID() })),
      /22023/,
    );
    await assert.rejects(
      sql(install({ ...scheduled, modules: ["lms", "finance"] })),
      /22023/,
    );
    await assert.rejects(
      sql(install({ ...scheduled, grace_until: at(40) })),
      /22023/,
    );
    await assert.rejects(
      sql(install({ ...scheduled, starts_at: "infinity" })),
      /22023/,
    );
    await assert.rejects(
      sql(install({ ...scheduled, limits: { ...limits, seat_count: 1.5 } })),
      /22023/,
    );
    await sql(install(scheduled));
    await sql(install(scheduled));
    await assertCapabilities("scheduled");

    const active = terms(-13, -2, 2, 4);
    await sql(install(active));
    await assert.rejects(sql(install(scheduled)), /40001/);
    await assert.rejects(
      sql(install({ ...active, release_commit: "f".repeat(40) })),
      /40001/,
    );
    await sql(install(active));
    await assertCapabilities("active");

    await sql(install(terms(-12, -7, -2, 2)));
    await assertCapabilities("grace");
    await sql(install(terms(-11, -6, -4, -1)));
    await assertCapabilities("expired");
    await sql(install(terms(-6, -1, 3, 6)));
    await assertCapabilities("active");

    // An actor in the local administrator role cannot open any customer
    // business transport merely because the identity and licence are valid.
    await sql(`insert into auth.users(id,email) values (${q(admin)},'admin@example.invalid');
      insert into public.user_roles(user_id,role) values (${q(admin)},'admin');`);
    await assert.rejects(actor(admin, install(terms(-1, -1, 8, 9))), /42501/);
    await assert.rejects(
      actor(admin, "select * from private.installation_verified_licence"),
      /42501/,
    );
    await assert.rejects(
      sql("set role service_role; select * from private.installation_identity"),
      /42501/,
    );

    for (const [path, method] of [
      ["/rpc/commission_report", "POST"],
      ["/rpc/set_company_premium", "POST"],
      ["/rpc/company_course_webhook_subscribe", "POST"],
      ["/rpc/require_portal_access", "POST"],
      ["/rpc/course_workspace", "POST"],
      ["/rpc/installation_capabilities/", "POST"],
      ["/rpc/installation_capabilities_extra", "POST"],
      ["/rpc/installation_capabilities", "PATCH"],
      ["/installation_capability_state", "GET"],
      ["/jobs", "GET"],
    ]) {
      await assert.rejects(actor(admin, request(path, method)), /42501/);
      await assert.rejects(
        sql(`begin;set local role anon; ${request(path, method)} commit;`),
        /42501/,
      );
    }
    await assert.rejects(
      sql(
        `begin;set local role service_role;${request("/rpc/commission_report", "POST")}commit;`,
      ),
      /42501/,
    );
    await assert.rejects(
      actor(admin, "select public.require_portal_access()"),
      /42501/,
    );
    for (const method of ["GET", "HEAD", "POST"]) {
      assert.equal(
        await actor(
          admin,
          `${request("/rpc/installation_capabilities", method)}select 1`,
        ),
        "1",
      );
    }
    assert.equal(await sql("select count(*) from auth.users"), "1");
    console.log(
      `PASS ${edition} pins its identity, accepts only newer bound verified terms and keeps the dormant API closed`,
    );
  });
}
