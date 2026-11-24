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
    await sql(`set role service_role;
    select public.human_login_profile_active(${q(admin)})`),
    "t",
  );
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
    const serviceRequest = (
      operation,
      statement = "",
      method = "POST",
      headers = {},
    ) =>
      sql(`begin;set local role service_role;
        set local request.headers=${q(JSON.stringify(headers))};
        ${request(`/rpc/${operation}`, method)} ${statement};commit;`);
    const loginOperations = [
      "reserve_login_attempt",
      "human_login_profile_active",
    ];
    const assertLoginGate = async (enabled) => {
      for (const operation of loginOperations) {
        const attempt = serviceRequest(operation, "select 1");
        if (enabled) assert.equal(await attempt, "1");
        else await assert.rejects(attempt, /42501/);
      }
    };
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
        assert.deepEqual(
          JSON.parse(await sql(`set role ${role}; ${capability}`)),
          expected,
        );
        await assert.rejects(
          sql(
            `set role ${role}; select * from private.installation_verified_licence`,
          ),
          /42501/,
        );
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
    await assertLoginGate(false);

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
    await assertLoginGate(false);

    const active = terms(-13, -2, 2, 4);
    await sql(install(active));
    await assert.rejects(sql(install(scheduled)), /40001/);
    await assert.rejects(
      sql(install({ ...active, release_commit: "f".repeat(40) })),
      /40001/,
    );
    await sql(install(active));
    await assertCapabilities("active");
    await assertLoginGate(false);
    const configure = (release, enabled = true) =>
      sql(
        `select private.configure_academy_course_access(${q(id)},${q(release)},${enabled})`,
      );
    await configure(active.release_commit);
    await assertLoginGate(true);
    const grace = terms(-12, -7, -2, 2);

    await sql(install(grace));
    await assertCapabilities("grace");
    await assertLoginGate(true);
    await sql(install(terms(-11, -6, -4, -1)));
    await assertCapabilities("expired");
    await assertLoginGate(false);
    const renewed = { ...terms(-6, -1, 3, 6), release_commit: "f".repeat(40) };
    await sql(install(renewed));
    await assertCapabilities("active");
    await assertLoginGate(false);

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
    await assert.rejects(
      actor(
        admin,
        "select public.accounting_settlement_journal('2020-02-01','2020-02-01')",
      ),
      /42501/,
    );

    for (const [path, method] of [
      ["/rpc/commission_report", "POST"],
      ["/rpc/accounting_settlement_journal", "POST"],
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

    await configure(renewed.release_commit);
    const confirmed = randomUUID();
    const suspended = randomUUID();
    await sql(`insert into auth.users(id,email,email_confirmed_at) values
      (${q(confirmed)},'confirmed@example.invalid',now()),
      (${q(suspended)},'suspended@example.invalid',now());
      update public.profiles set active=false where id=${q(suspended)};
      insert into private.user_login_aliases(user_id,username) values(${q(confirmed)},'training.lead');`);
    const lookup = (identity) =>
      `select public.human_login_profile_active(${q(identity)})`;
    assert.equal(
      await serviceRequest("human_login_profile_active", lookup(confirmed)),
      "t",
    );
    for (const identity of [admin, suspended, randomUUID()]) {
      assert.equal(
        await serviceRequest("human_login_profile_active", lookup(identity)),
        "f",
      );
    }
    const statements = [
      "select public.reserve_login_attempt(repeat('f',64))",
      lookup(confirmed),
    ];
    assert.equal(await serviceRequest(loginOperations[0], statements[0]), "t");
    assert.equal(await serviceRequest(loginOperations[1], statements[1]), "t");
    for (const [index, operation] of loginOperations.entries()) {
      for (const method of ["GET", "HEAD", "PATCH"]) {
        await assert.rejects(
          serviceRequest(operation, "select 1", method),
          /42501/,
        );
      }
      for (const name of ["accept-profile", "content-profile"]) {
        await assert.rejects(
          serviceRequest(operation, "select 1", "POST", { [name]: "private" }),
          /42501/,
        );
      }
      await assert.rejects(
        actor(admin, request(`/rpc/${operation}`, "POST")),
        /42501/,
      );
      for (const role of ["anon", "authenticated"]) {
        await assert.rejects(
          sql(`set role ${role}; ${statements[index]}`),
          /42501/,
        );
      }
    }
    await assert.rejects(
      serviceRequest("human_login_profile_active/", "select 1"),
      /42501/,
    );
    await assert.rejects(
      serviceRequest("course_workspace", "select 1"),
      /42501/,
    );
    await assert.rejects(
      sql(`begin;set local role service_role;
      ${request("/profiles", "GET")} select 1;commit;`),
      /42501/,
    );
    await configure(renewed.release_commit, false);
    await assertLoginGate(false);
    console.log(
      `PASS ${edition} pins its identity, checks bound licence transitions and permits only the scoped service login transport`,
    );
  });
}
