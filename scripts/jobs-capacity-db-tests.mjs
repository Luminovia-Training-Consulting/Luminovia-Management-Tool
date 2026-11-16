/** Real PostgreSQL slot/currency/budget/concurrency checks. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { quoteSql, withTestDatabase } from "./testing/database.mjs";
let checks = 0;
await withTestDatabase("job_capacity", async ({ sql, actor }) => {
  const manager = randomUUID(),
    client = randomUUID(),
    teachers = Array.from({ length: 12 }, () => randomUUID());
  await sql(
    `insert into auth.users(id,email) values('${manager}','capacity-admin@example.invalid'),('${client}','capacity-client@example.invalid'),${teachers.map((id, i) => `('${id}','capacity-${i}@example.invalid')`).join(",")};insert into public.user_roles(user_id,role) values('${manager}','admin'),('${client}','client'),${teachers.map((id) => `('${id}','lecturer')`).join(",")}`,
  );
  let day = 0;
  /** Creates a controlled job with an explicit currency and gross/net pricing variant. */
  const body = (gross = false, currency = "EUR") => {
    day += 3;
    return {
      title: "Fictional per-position teaching offer",
      description: "One entire multi-day block per lecturer position",
      customer_name: "Fictional position academy",
      delivery_type: "online",
      time_zone: "Europe/Berlin",
      status: "published",
      currency,
      rate_unit: "fixed_total",
      terms: "Immutable fictional position agreement",
      requires_contract: false,
      ...(gross
        ? { gross_amount: 100.01, gross_total_amount: 100.01 }
        : { amount: 50, total_amount: 50 }),
      sessions: [0, 1].map((n) => ({
        starts_at: new Date(Date.UTC(2042, 0, day + n, 8)).toISOString(),
        ends_at: new Date(Date.UTC(2042, 0, day + n, 9)).toISOString(),
      })),
    };
  };
  /** Creates the complete multi-position offer through create_capacity_job with controlled capacity, pricing and retry identity. */
  const create = async (
    capacity = 3,
    gross = false,
    key = randomUUID(),
    payload = body(gross),
  ) =>
    actor(
      manager,
      `select public.create_capacity_job(${quoteSql(JSON.stringify(payload))}::jsonb,${capacity},'${key}')`,
      "aal2",
    );
  /** Reads the current versioned management projection at the specified MFA level. */
  const meta = async (job, who = manager, aal = "aal2") =>
    JSON.parse(await actor(who, `select public.job_lifecycle('${job}')`, aal));
  /** Calls the actual claim RPC; only the database result confirms whole-block allocation. */
  const claim = async (job, who, key = randomUUID()) => {
    const version = await sql(
      `select terms_version from public.jobs where id='${job}'`,
    );
    return JSON.parse(
      await actor(who, `select public.claim_job('${job}','${key}',${version})`),
    );
  };
  /** Cancels an accepted position through the business contract rather than directly editing claim rows. */
  const cancel = async (claimId, who) =>
    actor(
      who,
      `select public.cancel_job_assignment('${claimId}','Fictional position cancellation','${randomUUID()}')`,
    );
  /** Explicitly reopens a cancelled job; free positions alone must not permit a replacement claim. */
  const reopen = async (job) =>
    actor(
      manager,
      `select public.manage_job_offer('${job}','reopen',${(await meta(job)).version},'${randomUUID()}', '{"reason":"Fictional replacement position required"}')`,
      "aal2",
    );
  /** Counts and reports a case only after all of its assertions have completed successfully. */
  const check = async (name, run) => {
    await run();
    checks++;
    console.log("PASS " + name);
  };
  await check(
    "New explicitly per-position creation is atomic/idempotent and rejects invalid capacity or missing MFA",
    async () => {
      for (const capacity of [0, 21])
        await assert.rejects(create(capacity), /22023/);
      await assert.rejects(
        actor(
          manager,
          `select public.create_capacity_job('${JSON.stringify(body())}'::jsonb,3,'${randomUUID()}')`,
        ),
        /42501/,
      );
      const payload = body(),
        key = randomUUID(),
        job = await create(3, false, key, payload);
      assert.equal(await create(3, false, key, payload), job);
      await assert.rejects(
        create(2, false, key, payload),
        /idempotency conflict/,
      );
      const state = await meta(job);
      assert.equal(state.capacity, 3);
      assert.equal(state.confirmed_count, 0);
      assert.equal(state.open_positions, 3);
    },
  );
  await check(
    "Legacy and customer-originated totals retain single-position meaning",
    async () => {
      const payload = body(),
        job = await actor(
          manager,
          `select public.create_job(${quoteSql(JSON.stringify(payload))}::jsonb)`,
          "aal2",
        );
      assert.equal((await meta(job)).capacity, 1);
      assert.equal((await meta(job)).capacity_basis, "single_position");
      await assert.rejects(
        actor(
          manager,
          `select public.set_job_capacity('${job}',3,${(await meta(job)).version},'${randomUUID()}')`,
          "aal2",
        ),
        /Only new explicitly/,
      );
      await assert.rejects(
        sql(`update public.jobs set capacity=3 where id='${job}'`),
        /jobs_capacity_basis_matches/,
      );
    },
  );
  await check(
    "Fifty calls fill exactly three positions with three different lecturers and complete allocations",
    async () => {
      const job = await create();
      const results = await Promise.all(
        Array.from({ length: 50 }, (_, i) =>
          claim(job, teachers[i % teachers.length]),
        ),
      );
      assert.equal(results.filter((r) => r.status === "confirmed").length, 3);
      assert.ok(
        results.every((r) =>
          ["confirmed", "filled", "already_assigned"].includes(r.status),
        ),
      );
      assert.equal(
        await sql(
          `select count(distinct lecturer_id) from public.job_claims where job_id='${job}' and status='confirmed'`,
        ),
        "3",
      );
      assert.equal(
        await sql(
          `select count(*) from public.assignment_sessions a join public.job_claims c on c.id=a.claim_id where c.job_id='${job}' and a.released_at is null`,
        ),
        "6",
      );
      assert.equal(
        await sql(`select status from public.jobs where id='${job}'`),
        "filled",
      );
      assert.equal((await meta(job)).open_positions, 0);
    },
  );
  await check(
    "One lecturer cannot consume two positions; exclusion checks retain all-or-nothing conflicts",
    async () => {
      const job = await create();
      assert.equal((await claim(job, teachers[0])).status, "confirmed");
      assert.equal((await claim(job, teachers[0])).status, "already_assigned");
      const state = await meta(job);
      assert.equal(state.confirmed_count, 1);
      assert.equal(state.open_positions, 2);
      assert.equal(
        await sql(`select status from public.jobs where id='${job}'`),
        "published",
      );
      await actor(
        teachers[1],
        `insert into public.personal_events(title,starts_at,ends_at) select 'Fictional position conflict',starts_at,ends_at from public.job_sessions where job_id='${job}' order by starts_at limit 1`,
      );
      assert.equal((await claim(job, teachers[1])).status, "conflict");
      assert.equal((await meta(job)).confirmed_count, 1);
    },
  );
  await check(
    "Versioned capacity edits work only before acceptance and preserve monetary quotes",
    async () => {
      const job = await create(2);
      const initial = await meta(job);
      await actor(
        manager,
        `select public.set_job_capacity('${job}',3,${initial.version},'${randomUUID()}')`,
        "aal2",
      );
      assert.equal((await meta(job)).capacity, 3);
      await assert.rejects(
        actor(
          manager,
          `select public.set_job_capacity('${job}',4,${initial.version},'${randomUUID()}')`,
          "aal2",
        ),
        /40001/,
      );
      const c = await claim(job, teachers[2]);
      assert.equal(c.status, "confirmed");
      await assert.rejects(
        actor(
          manager,
          `select public.set_job_capacity('${job}',4,${(await meta(job)).version},'${randomUUID()}')`,
          "aal2",
        ),
        /Only new explicitly/,
      );
      assert.equal(
        await sql(
          `select total_amount from public.job_claims where id='${c.claim_id}'`,
        ),
        "50.00",
      );
    },
  );
  await check(
    "Gross budgets multiply positions once; accepted revenue and client course counts remain exact",
    async () => {
      const job = await create(3, true);
      const org = await sql(
        `select organisation_id from private.job_commission_offers where job_id='${job}'`,
      );
      await actor(
        manager,
        `select public.manage_client_organisation('${client}','${org}')`,
        "aal2",
      );
      const claimed = [];
      for (const who of teachers.slice(0, 3))
        claimed.push(await claim(job, who));
      assert.ok(claimed.every((x) => x.status === "confirmed"));
      assert.equal(Number((await meta(job)).gross_budget), 300.03);
      assert.equal((await meta(job, teachers[0], "aal1")).gross_budget, null);
      /** Captures actual retained state before and after a concurrent or rejected action. */
      const summary = async () =>
        JSON.parse(
          await actor(
            client,
            `select to_jsonb(s) from public.client_spend_summary() s where organisation_id='${org}'`,
          ),
        );
      let total = await summary();
      assert.equal(Number(total.request_count), 1);
      assert.equal(Number(total.assigned_count), 1);
      assert.equal(Number(total.gross_total_amount), 300.03);
      assert.equal(Number(total.gross_assigned_amount), 300.03);
      assert.equal(total.teachers.length, 3);
      let requests = JSON.parse(
        await actor(
          client,
          `select jsonb_agg(to_jsonb(r)) from public.client_requests('${org}')r`,
        ),
      );
      assert.equal(requests.length, 1);
      assert.equal(requests[0].assigned_lecturers.length, 3);
      assert.equal(Number(requests[0].gross_total_amount), 300.03);
      const snapshot = await sql(
        `select to_jsonb(l) from private.claim_revenue_ledger l where claim_id='${claimed[0].claim_id}'`,
      );
      await cancel(claimed[0].claim_id, teachers[0]);
      assert.equal(
        await sql(
          `select to_jsonb(l) from private.claim_revenue_ledger l where claim_id='${claimed[0].claim_id}'`,
        ),
        snapshot,
      );
      assert.equal((await meta(job)).confirmed_count, 2);
      assert.equal((await meta(job)).open_positions, 0);
      total = await summary();
      assert.equal(Number(total.gross_assigned_amount), 200.02);
      assert.equal(Number(total.request_count), 1);
      await reopen(job);
      assert.equal((await meta(job)).open_positions, 1);
      assert.equal((await claim(job, teachers[4])).status, "confirmed");
      assert.equal((await meta(job)).confirmed_count, 3);
      total = await summary();
      assert.equal(Number(total.gross_assigned_amount), 300.03);
      assert.equal(total.teachers.length, 3);
      assert.ok(!total.teachers.some((t) => t.id === teachers[0]));
      requests = JSON.parse(
        await actor(
          client,
          `select jsonb_agg(to_jsonb(r)) from public.client_requests('${org}')r`,
        ),
      );
      assert.equal(requests.length, 1);
      assert.equal(requests[0].assigned_lecturers.length, 3);
    },
  );
  await check(
    "Cancelled owners transfer only to usable confirmed members; explicit management owners and future ownership stay usable",
    async () => {
      const job = await create(3),
        accepted = [];
      for (const who of teachers.slice(0, 3))
        accepted.push(await claim(job, who));
      const room = await sql(
        `select id from public.chat_rooms where job_id='${job}' and kind='lecturer_course'`,
      );
      assert.equal(
        await sql(`select owner_id from public.chat_rooms where id='${room}'`),
        teachers[0],
      );
      // A confirmed lecturer's chat membership may have been explicitly removed.
      // Their accepted allocation must not silently restore that access on election.
      await actor(
        teachers[0],
        `select public.manage_chat_member('${room}','${teachers[1]}',true)`,
      );
      await cancel(accepted[0].claim_id, teachers[0]);
      assert.equal(
        await sql(`select owner_id from public.chat_rooms where id='${room}'`),
        teachers[2],
      );
      await actor(
        teachers[2],
        `select public.manage_chat_member('${room}','${teachers[6]}',false)`,
      );
      assert.ok(
        await actor(
          teachers[2],
          `select public.send_message('${room}','Fictional usable replacement owner','${randomUUID()}')`,
        ),
      );
      for (const excluded of teachers.slice(0, 2)) {
        await assert.rejects(
          actor(excluded, `select * from public.chat_messages('${room}')`),
          /access denied/i,
        );
        await assert.rejects(
          actor(
            excluded,
            `select public.manage_chat_member('${room}','${teachers[7]}',false)`,
          ),
          /management denied/i,
        );
      }
      assert.equal(
        await sql(
          `select count(*) from public.job_claims where job_id='${job}' and status='confirmed'`,
        ),
        "2",
      );
      const managed = await create(3),
        first = await claim(managed, teachers[3]);
      await claim(managed, teachers[4]);
      const managedRoom = await sql(
        `select id from public.chat_rooms where job_id='${managed}' and kind='lecturer_course'`,
      );
      await actor(
        teachers[3],
        `select public.manage_chat_member('${managedRoom}','${manager}',false)`,
      );
      // Fixture represents an explicitly assigned manager owner, whose authority
      // must survive another lecturer's cancellation without an admin bypass.
      await sql(
        `update public.chat_rooms set owner_id='${manager}' where id='${managedRoom}'`,
      );
      await cancel(first.claim_id, teachers[3]);
      assert.equal(
        await sql(
          `select owner_id from public.chat_rooms where id='${managedRoom}'`,
        ),
        manager,
      );
      await actor(
        manager,
        `select public.manage_chat_member('${managedRoom}','${teachers[8]}',false)`,
        "aal2",
      );
      const lastJob = await create(3),
        last = await claim(lastJob, teachers[5]);
      const lastRoom = await sql(
        `select id from public.chat_rooms where job_id='${lastJob}' and kind='lecturer_course'`,
      );
      await cancel(last.claim_id, teachers[5]);
      assert.equal(
        await sql(
          `select owner_id is null from public.chat_rooms where id='${lastRoom}'`,
        ),
        "t",
      );
      await reopen(lastJob);
      assert.equal((await claim(lastJob, teachers[9])).status, "confirmed");
      assert.equal(
        await sql(
          `select owner_id from public.chat_rooms where id='${lastRoom}'`,
        ),
        teachers[9],
      );
      await actor(
        teachers[9],
        `select public.manage_chat_member('${lastRoom}','${teachers[10]}',false)`,
      );
      assert.ok(
        await actor(
          teachers[9],
          `select public.send_message('${lastRoom}','Fictional reopened owner','${randomUUID()}')`,
        ),
      );
    },
  );
  await check(
    "Board metadata is management/MFA-only and accepted rows cannot transition by dragging or legacy API",
    async () => {
      await assert.rejects(
        actor(teachers[0], "select public.job_board()"),
        /42501/,
      );
      await assert.rejects(
        actor(manager, "select public.job_board()"),
        /42501/,
      );
      const board = JSON.parse(
        await actor(manager, "select public.job_board()", "aal2"),
      );
      assert.ok(board.some((row) => row.can_transition === false));
      assert.ok(
        board.every(
          (row) => row.capacity >= 1 && row.confirmed_count <= row.capacity,
        ),
      );
      const row = board.find((x) => x.confirmed_count > 0);
      await assert.rejects(
        actor(
          manager,
          `select public.manage_job_offer('${row.id}','published',${row.version},'${randomUUID()}')`,
          "aal2",
        ),
        /Cancel confirmed/,
      );
      await assert.rejects(
        actor(
          manager,
          `select public.set_job_status('${row.id}','published')`,
          "aal2",
        ),
        /frozen/,
      );
    },
  );
});
console.log(`${checks} job capacity PostgreSQL checks passed.`);
