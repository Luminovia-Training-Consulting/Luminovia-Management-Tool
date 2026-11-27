/** Prove multi-assignment selection, exact original amounts and privilege boundaries in PostgreSQL. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

assert.equal(process.env.PORTAL_TEST_MODE, "1");
assert.match(
  process.env.PORTAL_DB_CONTAINER ?? "",
  /^supabase_db_luminovia-portal-test-[a-f0-9]+$/,
);

await withTestDatabase("assignment_finance_export", async ({ sql, actor }) => {
  const finance = randomUUID();
  const admin = randomUUID();
  const teacher = randomUUID();
  const customer = randomUUID();
  const organisation = randomUUID();
  const fixtures = [
    [
      "EUR",
      "35.79",
      [
        ["2026-06-07 13:30Z", "2026-06-07 14:30Z"],
        ["2026-06-08 03:00Z", "2026-06-08 04:00Z"],
      ],
    ],
    ["AUD", "20.20", [["2026-06-08 01:00Z", "2026-06-08 02:00Z", true]]],
    ["CHF", "11.05", []],
    ["USD", "99.09", [["2026-06-08 14:00Z", "2026-06-08 15:00Z"]]],
  ].map(([currency, amount, sessions]) => ({
    currency,
    amount,
    sessions,
    job: randomUUID(),
    claim: randomUUID(),
  }));
  const identities = [
    [finance, "management"],
    [admin, "admin"],
    [teacher, "lecturer"],
    [customer, "client"],
  ];
  await sql(`
    insert into auth.users(id,email,email_confirmed_at) values ${identities.map(([id]) => `(${q(id)},${q(id + "@example.invalid")},now())`).join(",")};
    insert into public.user_roles(user_id,role) values ${identities.map(([id, role]) => `(${q(id)},${q(role)})`).join(",")};
    update public.profiles set time_zone='Australia/Brisbane' where id in (${q(finance)},${q(admin)});
    insert into public.organisations(id,name) values (${q(organisation)},'Fictional finance organisation');
  `);
  for (const { currency, amount, sessions, job, claim } of fixtures) {
    await sql(`
      insert into public.jobs(id,title,customer_name,delivery_type,amount,currency,rate_unit,total_amount,terms)
      values (${q(job)},${q(`Fictional ${currency} course`)},'Fictional finance organisation','online',${amount},${q(currency)},'fixed_total',${amount},'Fictional terms');
      insert into public.job_claims(id,job_id,lecturer_id,idempotency_key,amount,currency,rate_unit,total_amount,terms,terms_version,created_at)
      values (${q(claim)},${q(job)},${q(teacher)},${q(randomUUID())},${amount},${q(currency)},'fixed_total',${amount},'Fictional terms',1,'2026-06-08 10:00Z');
      ${sessions
        .map(
          ([
            from,
            to,
            released,
          ]) => `insert into public.assignment_sessions(id,claim_id,lecturer_id,starts_at,ends_at,released_at)
        values (gen_random_uuid(),${q(claim)},${q(teacher)},${q(from)},${q(to)},${released ? "'2026-06-07T08:00Z'" : "null"});`,
        )
        .join("\n")}
    `);
  }
  const [euro] = fixtures;
  await sql(`
    insert into private.claim_revenue_ledger(claim_id,job_id,organisation_id,lecturer_id,gross_amount,gross_total_amount,
      platform_percent,platform_total_amount,lecturer_net_amount,lecturer_net_total_amount,currency)
    values (${q(euro.claim)},${q(euro.job)},${q(organisation)},${q(teacher)},50.80,50.80,29.55,15.01,35.79,35.79,'EUR')
  `);
  const read = (id, from = "2026-06-08", through = from) =>
    actor(
      id,
      `select public.assignment_finance_export(${q(from)},${q(through)})`,
      "aal2",
    ).then(JSON.parse);

  await assert.rejects(read(teacher), /42501/);
  await assert.rejects(read(customer), /42501/);
  await assert.rejects(read(finance, "2026-04-01", "2026-08-01"), /22023/);
  await assert.rejects(read(finance, "2026-06-09", "2026-06-08"), /22023/);
  assert.deepEqual((await read(finance, "2026-06-10")).assignments, []);

  const report = await read(finance);
  assert.equal(report.schema_version, 1);
  assert.equal(report.time_zone, "Australia/Brisbane");
  assert.equal(report.through, "2026-06-08");
  assert.deepEqual(
    report.assignments.map(({ finance }) => [
      finance.currency,
      finance.agreed_lecturer,
    ]),
    [
      ["AUD", "20.20"],
      ["CHF", "11.05"],
      ["EUR", "35.79"],
    ],
  );
  for (const entry of report.assignments) {
    assert.equal(entry.finance.agreed_customer, null);
    assert.deepEqual(
      entry.finance,
      JSON.parse(
        await actor(
          finance,
          `select public.assignment_finance_reconciliation(${q(entry.claim_id)})`,
          "aal2",
        ),
      ),
    );
  }
  const gross = (await read(admin)).assignments.find(
    (entry) => entry.claim_id === euro.claim,
  ).finance;
  assert.equal(gross.agreed_customer, "50.80");
  assert.equal(gross.contract_margin, "15.01");
  console.log(
    "PASS export spans dates and claims once, keeps original currencies and respects finance tiers",
  );
});
