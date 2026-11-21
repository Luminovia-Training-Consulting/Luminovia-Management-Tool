/** Exercises the offline signed first-admin flow and its durable one-time receipt. */
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { prepareAcademyInstallation } from "./academy-installation.mjs";
import { signAcademyLicence } from "./academy-licence.mjs";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

const bootstrap = (installation, release, administrator) =>
  `select private.bootstrap_academy_first_administrator(${q(installation)},${q(release)},${q(administrator)})`;

/** Build fictional signed terms without using any vendor keys or existing tenant state. */
function fixture(edition) {
  const now = Date.now();
  const date = (days) => new Date(now + days * 86400000).toISOString();
  const expected = {
    installation_id: randomUUID(),
    edition,
    release_commit: "a5".repeat(20),
    issued_at: date(-4),
    starts_at: date(-3),
    expires_at: date(2),
    grace_until: date(4),
    modules: ["lms"],
    limits: {
      seat_count: 10,
      storage_bytes: 100000,
      api_requests_per_minute: 20,
    },
  };
  const key = generateKeyPairSync("ed25519");
  return {
    expected,
    now,
    envelope: signAcademyLicence(expected, key.privateKey),
    publicKey: key.publicKey,
  };
}

for (const edition of ["customer-managed", "customer-self-hosted"]) {
  await withTestDatabase("academy_first_admin", async ({ sql, actor }) => {
    const options = fixture(edition);
    const { installation_id: installation, release_commit: release } =
      options.expected;
    const [first, other, unconfirmed, suspended, participant] = Array.from(
      { length: 5 },
      randomUUID,
    );
    const selectAdmin = (administrator) =>
      bootstrap(installation, release, administrator);
    const prepareAdmin = (administrator) =>
      prepareAcademyInstallation(
        { ...options, firstAdministrator: administrator },
        sql,
      );

    // The internal database and the as-yet unlicensed dedicated edition cannot grant a role.
    await assert.rejects(sql(selectAdmin(first)), /55000/);
    await sql(
      `select private.provision_customer_installation(${q(installation)},${q(edition)})`,
    );
    await assert.rejects(sql(selectAdmin(first)), /55000/);
    await prepareAcademyInstallation(options, sql);
    await assert.rejects(sql(selectAdmin(first)), /55000/);

    await sql(`
      insert into auth.users(id,email,email_confirmed_at) values
        ${[first, other, unconfirmed, suspended, participant]
          .map(
            (id) =>
              `(${q(id)},${q(id + "@example.invalid")},${id === unconfirmed ? "null" : "now()"})`,
          )
          .join(",")};
      update public.profiles set active = false where id = ${q(suspended)};
      insert into public.user_roles(user_id,role) values (${q(participant)}, 'participant');
    `);
    await assert.rejects(sql(bootstrap(randomUUID(), release, first)), /55000/);
    await assert.rejects(
      sql(bootstrap(installation, "c9".repeat(20), first)),
      /55000/,
    );
    for (const id of [unconfirmed, suspended, participant])
      await assert.rejects(prepareAdmin(id), /roles/);
    await assert.rejects(actor(first, selectAdmin(first)), /42501/);
    for (const role of ["anon", "service_role"])
      await assert.rejects(
        sql(`begin; set local role ${role}; ${selectAdmin(first)}; commit;`),
        /42501/,
      );
    await assert.rejects(
      actor(first, "select * from private.academy_first_administrator"),
      /42501/,
    );

    await sql(
      `insert into public.user_roles(user_id, role) values (${q(other)}, 'admin')`,
    );
    await assert.rejects(prepareAdmin(first), /55000/);
    await sql(`delete from public.user_roles where user_id = ${q(other)}`);

    // Two operators can race. There is still exactly one administrator and receipt.
    const results = await Promise.allSettled([
      prepareAdmin(first),
      prepareAdmin(other),
    ]);
    const confirmed = results.filter(({ status }) => status === "fulfilled");
    assert.equal(confirmed.length, 1);
    assert.equal(
      results.filter(({ status }) => status === "rejected").length,
      1,
    );
    const result = confirmed[0].value;
    const winner = result.first_administrator;
    const loser = winner === first ? other : first;
    assert.ok([first, other].includes(winner));
    assert.equal(result.customer_ready, false);
    assert.deepEqual(await prepareAdmin(winner), result);
    await assert.rejects(prepareAdmin(loser), /55000/);
    assert.equal(
      await sql("select user_id from public.user_roles where role='admin'"),
      winner,
    );
    assert.equal(
      await sql(
        "select administrator_id from private.academy_first_administrator",
      ),
      winner,
    );

    // Later suspension or directory deletion does not restore the bootstrap entry point.
    await sql(
      `update public.profiles set active = false where id = ${q(winner)}`,
    );
    await assert.rejects(prepareAdmin(winner), /55000/);
    await sql(`delete from auth.users where id = ${q(winner)}`);
    await assert.rejects(prepareAdmin(loser), /55000/);
    assert.equal(
      await sql(
        "select administrator_id from private.academy_first_administrator",
      ),
      winner,
    );
    console.log(
      `PASS ${edition}: signed first-admin preparation, concurrent operators, receipts and role isolation`,
    );
  });
}
