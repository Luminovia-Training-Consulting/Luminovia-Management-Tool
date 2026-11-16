/** Real PostgreSQL tests for private dashboard layout and own teaching readiness. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { withTestDatabase, quoteSql as q } from "./testing/database.mjs";

await withTestDatabase("dashboard_personal", async ({ sql, actor }) => {
  const [teacher, peer, admin] = Array.from({ length: 3 }, randomUUID);
  const widgets = [
    "teaching_day",
    "activity",
    "contracts",
    "files",
    "followups",
  ];
  const rpc = async (who, name, args = []) =>
    JSON.parse(await actor(who, `select public.${name}(${args.join(",")})`));
  let checks = 0;
  const check = async (name, run) => {
    await run();
    checks++;
    console.log(`PASS ${name}`);
  };
  await sql(`insert into auth.users(id,email) values ${[teacher, peer, admin].map((id) => `(${q(id)},${q(id + "@example.invalid")})`).join(",")};
    insert into public.user_roles(user_id,role) values(${q(teacher)},'lecturer'),(${q(peer)},'lecturer'),(${q(admin)},'admin');`);
  await check(
    "Private defaults and grants deny direct access and anonymous execution",
    async () => {
      assert.deepEqual(await rpc(teacher, "dashboard_preferences"), {
        widget_order: widgets,
        hidden_widgets: [],
        version: 0,
      });
      await assert.rejects(
        actor(teacher, "select * from private.dashboard_preferences"),
        /permission denied/,
      );
      await assert.rejects(
        actor(admin, "select * from private.teaching_preparation", "aal2"),
        /permission denied/,
      );
      assert.equal(
        await sql(
          "select has_function_privilege('anon','public.dashboard_preferences()','execute')",
        ),
        "f",
      );
      assert.equal(
        await sql(
          "select has_function_privilege('anon','public.teaching_day()','execute')",
        ),
        "f",
      );
    },
  );
  const payload = {
    widget_order: [...widgets].reverse(),
    hidden_widgets: ["contracts"],
  };
  await check(
    "Saved order survives another call while peer and administrator remain private",
    async () => {
      assert.equal(
        (
          await rpc(teacher, "save_dashboard_preferences", [
            q(JSON.stringify(payload)),
            "0",
          ])
        ).version,
        1,
      );
      assert.deepEqual(await rpc(teacher, "dashboard_preferences"), {
        ...payload,
        version: 1,
      });
      assert.deepEqual(
        (await rpc(peer, "dashboard_preferences")).hidden_widgets,
        [],
      );
      assert.deepEqual(
        (await rpc(admin, "dashboard_preferences")).widget_order,
        widgets,
      );
    },
  );
  await check(
    "Malformed sets and forged actor properties never mutate the saved layout",
    async () => {
      for (const bad of [
        { ...payload, user_id: peer },
        {
          ...payload,
          widget_order: ["files", "files", "files", "files", "files"],
        },
        { ...payload, hidden_widgets: ["unknown"] },
        { ...payload, hidden_widgets: ["files", "files"] },
        { ...payload, hidden_widgets: [42] },
      ]) {
        await assert.rejects(
          rpc(teacher, "save_dashboard_preferences", [
            q(JSON.stringify(bad)),
            "1",
          ]),
          /22023/,
        );
      }
      assert.equal((await rpc(teacher, "dashboard_preferences")).version, 1);
    },
  );
  await check(
    "Actual concurrent writes produce exactly one CAS winner",
    async () => {
      const results = await Promise.allSettled([
        rpc(teacher, "save_dashboard_preferences", [
          q(JSON.stringify(payload)),
          "1",
        ]),
        rpc(teacher, "save_dashboard_preferences", [
          q(JSON.stringify({ ...payload, hidden_widgets: [] })),
          "1",
        ]),
      ]);
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      assert.match(
        results.find((r) => r.status === "rejected").reason.message,
        /40001/,
      );
      assert.equal((await rpc(teacher, "dashboard_preferences")).version, 2);
    },
  );
  const day =
    "((now() at time zone 'Europe/Berlin')::date::timestamp at time zone 'Europe/Berlin')";
  const fixtures = [];
  async function assignment(
    who,
    title,
    starts,
    ends,
    { released = false, cancelled = false } = {},
  ) {
    const job = randomUUID(),
      claim = randomUUID(),
      session = randomUUID();
    await sql(`insert into public.jobs(id,title,customer_name,delivery_type,status,location,amount,currency,rate_unit,total_amount,terms) values(${q(job)},${q(title)},'Fictional teaching client','online','filled','https://example.invalid/class',100,'EUR','fixed_total',100,'Fictional terms');
      insert into public.job_claims(id,job_id,lecturer_id,idempotency_key,status,amount,currency,rate_unit,total_amount,terms,terms_version) values(${q(claim)},${q(job)},${q(who)},${q(randomUUID())},${q(cancelled ? "cancelled" : "confirmed")},100,'EUR','fixed_total',100,'Fictional terms',1);
      insert into public.assignment_sessions(id,claim_id,lecturer_id,starts_at,ends_at,released_at) values(${q(session)},${q(claim)},${q(who)},${starts},${ends},${released ? "now()" : "null"});`);
    const result = { job, claim, session };
    fixtures.push(result);
    return result;
  }
  const current = await assignment(
    teacher,
    "Own current course",
    `${day}+interval '9 hours'`,
    `${day}+interval '10 hours'`,
  );
  const crossing = await assignment(
    teacher,
    "Own midnight course",
    `${day}+interval '23 hours 30 minutes'`,
    `${day}+interval '24 hours 30 minutes'`,
  );
  await assignment(
    teacher,
    "Ends exactly at day start",
    `${day}-interval '2 hours'`,
    day,
  );
  await assignment(
    teacher,
    "Starts exactly next day",
    `${day}+interval '25 hours'`,
    `${day}+interval '26 hours'`,
  );
  const released = await assignment(
    teacher,
    "Released course",
    `${day}+interval '11 hours'`,
    `${day}+interval '12 hours'`,
    { released: true },
  );
  const cancelled = await assignment(
    teacher,
    "Cancelled course",
    `${day}+interval '13 hours'`,
    `${day}+interval '14 hours'`,
    { cancelled: true },
  );
  await assignment(
    peer,
    "Foreign private course",
    `${day}+interval '9 hours'`,
    `${day}+interval '10 hours'`,
  );
  await sql(`insert into public.documents(owner_id,uploaded_by,scope,kind,job_id,original_name,mime_type,size_bytes,status,client_id) values
    (${q(teacher)},${q(teacher)},'job_after','material',${q(current.job)},'Permitted handout.pdf','application/pdf',1,'clean',${q(randomUUID())}),
    (${q(teacher)},${q(teacher)},'job_after','material',${q(current.job)},'Quarantined handout.pdf','application/pdf',1,'quarantined',${q(randomUUID())});`);
  await check(
    "Teaching day returns only own committed active sessions and permitted clean files",
    async () => {
      const today = await rpc(teacher, "teaching_day");
      assert.equal(today.time_zone, "Europe/Berlin");
      assert.equal(
        today.day,
        await sql("select (now() at time zone 'Europe/Berlin')::date"),
      );
      assert.deepEqual(
        today.sessions.map((s) => s.id),
        [current.session, crossing.session],
      );
      assert.deepEqual(
        today.sessions[0].documents.map((d) => d.name),
        ["Permitted handout.pdf"],
      );
      assert.ok(!JSON.stringify(today).includes("amount"));
      assert.ok(!JSON.stringify(today).includes("contacts"));
      assert.equal((await rpc(admin, "teaching_day")).sessions.length, 0);
    },
  );
  await check(
    "Personal checklist persists without granting a peer or admin assignment access",
    async () => {
      assert.equal(
        (
          await rpc(teacher, "save_teaching_preparation", [
            q(current.claim),
            q("materials_ready"),
            "true",
            "0",
          ])
        ).materials_ready,
        true,
      );
      const item = (await rpc(teacher, "teaching_day")).sessions[0];
      assert.equal(item.preparation.version, 1);
      assert.equal(item.preparation.materials_ready, true);
      for (const who of [peer, admin])
        await assert.rejects(
          rpc(who, "save_teaching_preparation", [
            q(current.claim),
            q("materials_ready"),
            "false",
            "1",
          ]),
          /42501/,
        );
      await assert.rejects(
        rpc(teacher, "save_teaching_preparation", [
          q(current.claim),
          q("materials_ready"),
          "false",
          "0",
        ]),
        /40001/,
      );
      await assert.rejects(
        rpc(teacher, "save_teaching_preparation", [
          q(current.claim),
          q("arbitrary"),
          "true",
          "1",
        ]),
        /22023/,
      );
    },
  );
  await check(
    "Released history and cancelled claims cannot receive new preparation acknowledgements",
    async () => {
      for (const fixture of [released, cancelled]) {
        await assert.rejects(
          rpc(teacher, "save_teaching_preparation", [
            q(fixture.claim),
            q("materials_ready"),
            "true",
            "0",
          ]),
          /42501/,
        );
        assert.equal(
          await sql(
            `select count(*) from private.teaching_preparation where claim_id=${q(fixture.claim)}`,
          ),
          "0",
        );
      }
    },
  );
  await check(
    "Profile time zone controls day boundaries without exposing private calendar events",
    async () => {
      await sql(
        `update public.profiles set time_zone='Australia/Brisbane' where id=${q(teacher)}`,
      );
      const today = await rpc(teacher, "teaching_day");
      assert.equal(today.time_zone, "Australia/Brisbane");
      assert.equal(
        today.day,
        await sql("select (now() at time zone 'Australia/Brisbane')::date"),
      );
      assert.ok(!JSON.stringify(today).includes("personal_events"));
    },
  );
  await check(
    "Inactive current identity cannot read or mutate personal dashboard or preparation",
    async () => {
      await sql(
        `update public.profiles set active=false where id=${q(teacher)}`,
      );
      for (const call of [
        () => rpc(teacher, "dashboard_preferences"),
        () => rpc(teacher, "teaching_day"),
        () =>
          rpc(teacher, "save_teaching_preparation", [
            q(current.claim),
            q("materials_ready"),
            "false",
            "1",
          ]),
      ])
        await assert.rejects(call, /42501/);
    },
  );
  console.log(`Passed ${checks} personal dashboard PostgreSQL groups.`);
});
