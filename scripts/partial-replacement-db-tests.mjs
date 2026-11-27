/** Real isolation and atomic selected-slot checks in a disposable database. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";
assert.equal(process.env.PORTAL_TEST_MODE, "1");
assert.match(
  process.env.PORTAL_DB_CONTAINER ?? "",
  /^supabase_db_luminovia-portal-test-[a-f0-9]+$/,
);
const json = (value) => JSON.parse(value);
const sqlState = (state) => new RegExp("ERROR:\\s+" + state + ":");

await withTestDatabase("partial_replacement", async ({ sql, actor }) => {
  const manager = randomUUID(),
    owner = randomUUID(),
    target = randomUUID(),
    unrelated = randomUUID();
  const contract = randomUUID(),
    approval = randomUUID();
  const job = randomUUID(),
    claim = randomUUID(),
    alreadyPast = randomUUID();
  const selected = randomUUID(),
    remaining = randomUUID();
  const identities = [
    [manager, "management"],
    [owner, "lecturer"],
    [target, "lecturer"],
    [unrelated, "lecturer"],
  ];
  await sql(
    "insert into auth.users(id,email,email_confirmed_at) values " +
      identities
        .map(
          ([id]) => "(" + q(id) + "," + q(id + "@example.invalid") + ",now())",
        )
        .join(",") +
      "; insert into public.user_roles(user_id,role) values " +
      identities
        .map(([id, role]) => "(" + q(id) + "," + q(role) + ")")
        .join(",") +
      " on conflict do nothing;" +
      "insert into public.jobs(id,title,customer_name,delivery_type,status,amount,currency,rate_unit,total_amount,terms) values (" +
      q(job) +
      ",'Fictional mixed date course','Fictional customer','online','filled',600.00,'EUR','fixed_total',600.00,'Fictional source contract terms');" +
      "insert into public.job_claims(id,job_id,lecturer_id,idempotency_key,amount,currency,rate_unit,total_amount,terms,terms_version) values (" +
      q(claim) +
      "," +
      q(job) +
      "," +
      q(owner) +
      "," +
      q(randomUUID()) +
      ",600.00,'EUR','fixed_total',600.00,'Fictional source contract terms',1);",
  );
  for (const [slot, days] of [
    [alreadyPast, -1],
    [selected, 10],
    [remaining, 12],
  ]) {
    const start = "now() + interval " + q(days + " days");
    await sql(
      "insert into public.assignment_sessions(id,claim_id,lecturer_id,starts_at,ends_at) values (" +
        q(slot) +
        "," +
        q(claim) +
        "," +
        q(owner) +
        "," +
        start +
        "," +
        start +
        " + interval '3 hours');" +
        "insert into public.job_sessions(job_id,starts_at,ends_at) select " +
        q(job) +
        ",starts_at,ends_at from public.assignment_sessions where id=" +
        q(slot) +
        ";",
    );
  }
  const version = await sql(
    "select lifecycle_version from public.jobs where id=" + q(job),
  );
  const options = await actor(
    manager,
    "select public.partial_replacement_options(" + q(claim) + ")",
  ).then(json);
  assert.equal(options.currency, "EUR");
  assert.deepEqual(
    options.sessions.map((slot) => slot.id),
    [selected, remaining],
  );
  await assert.rejects(
    actor(owner, "select public.partial_replacement_options(" + q(claim) + ")"),
    sqlState("42501"),
  );

  const replace = (who, ids, key = randomUUID(), fee = "220.42") =>
    actor(
      who,
      "select public.replace_teaching_sessions(" +
        [
          q(claim),
          version,
          "array[" + ids.map(q).join(",") + "]::uuid[]",
          q(target),
          q(fee),
          q("Fictional reviewed cover agreement"),
          q("Fictional operational handover"),
          q(key),
        ].join(",") +
        ")",
    ).then(json);
  assert.equal((await replace(manager, [alreadyPast])).status, "unavailable");
  assert.equal((await replace(manager, [randomUUID()])).status, "unavailable");
  await assert.rejects(replace(owner, [selected]), sqlState("42501"));
  await sql(
    `insert into public.contracts(id,user_id,status,effective_from,version) values (${q(contract)},${q(owner)},'draft',now(),1);
    insert into private.invoice_series_approvals(id,claim_id,contract_id,contract_version,kind,currency,gross_amount,credit_amount,due_on,basis,note,approved_by,client_id)
    values (${q(approval)},${q(claim)},${q(contract)},1,'interim','EUR',100,0,current_date + 30,'{}','Fictional invoice reservation',${q(manager)},${q(randomUUID())});`,
  );
  assert.equal((await replace(manager, [selected])).status, "unavailable");
  assert.equal(
    await sql(
      `select gross_amount::text from private.invoice_series_approvals where id=${q(approval)} and revoked_at is null`,
    ),
    "100.00",
  );
  await sql(
    `update private.invoice_series_approvals set revoked_at=now(),revoked_by=${q(manager)},revocation_note='Fictional reservation withdrawal' where id=${q(approval)}`,
  );

  await sql(
    "insert into public.personal_events(user_id,title,starts_at,ends_at) select " +
      q(target) +
      ",'Fictional private booking',starts_at,ends_at from public.assignment_sessions where id=" +
      q(selected),
  );
  assert.equal((await replace(manager, [selected])).status, "conflict");
  assert.equal(
    await sql(
      "select (released_at is null)::text from public.assignment_sessions where id=" +
        q(selected),
    ),
    "true",
  );
  assert.equal(
    await sql("select count(*) from private.partial_teaching_replacements"),
    "0",
  );
  assert.equal(
    await sql(
      "select count(*) from public.notifications where user_id in (" +
        q(owner) +
        "," +
        q(target) +
        ") and kind in ('partial_teaching_replacement','claim_confirmed')",
    ),
    "0",
  );
  await sql("delete from public.personal_events where user_id=" + q(target));
  const key = randomUUID();
  const [result, replay] = await Promise.all([
    replace(manager, [selected], key),
    replace(manager, [selected], key),
  ]);
  assert.deepEqual(result, replay);
  assert.equal(result.status, "confirmed");
  await assert.rejects(
    replace(manager, [selected], key, "221.42"),
    sqlState("PT409"),
  );
  const kept = await sql(
    "select count(*) from public.assignment_sessions where claim_id=" +
      q(claim) +
      " and released_at is null",
  );
  assert.equal(kept, "2");
  assert.equal(
    await sql(
      "select total_amount::text from public.job_claims where id=" + q(claim),
    ),
    "600.00",
  );
  const cover = await sql(
    "select total_amount::text from public.job_claims where id=" +
      q(result.claim_id),
  );
  assert.equal(cover, "220.42");
  assert.equal(
    await sql(
      "select count(*) from public.assignment_sessions s join public.assignment_sessions o on s.starts_at=o.starts_at and s.ends_at=o.ends_at where s.claim_id=" +
        q(result.claim_id) +
        " and o.id=" +
        q(selected) +
        " and s.released_at is null",
    ),
    "1",
  );
  assert.equal(
    await sql(
      "select count(*) from public.notifications where user_id in (" +
        q(owner) +
        "," +
        q(target) +
        ") and kind in ('partial_teaching_replacement','claim_confirmed')",
    ),
    "2",
  );
  const lifecycle = await actor(
    manager,
    "select public.job_lifecycle(" + q(job) + ")",
  ).then(json);
  assert.ok(lifecycle.partial_replaceable_claim_ids.includes(claim));
  console.log(
    "PASS future-only allocation, conflict rollback, exact retained terms, notices and idempotent selected-session replacement",
  );
});
