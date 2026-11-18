/** Actual Auth/password-only authentication/REST time evidence and stable permissioned printable facts. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { withApiFixture } from "./testing/api.mjs";
import { quoteSql as q } from "./testing/database.mjs";

await withApiFixture(async ({ actor, service, checked, sql, defer, passwordOnly }) => {
  const owner = await actor("timesheet-owner", "lecturer"),
    peer = await actor("timesheet-peer", "lecturer"),
    manager = await actor("timesheet-reviewer", "management");
  const ids = [owner.id, peer.id, manager.id],
    job = randomUUID(),
    claim = randomUUID(),
    session = randomUUID(),
    time = randomUUID();
  defer(async () => {
    await sql(`delete from private.teaching_timesheet_history where timesheet_id=${q(time)};
   delete from private.teaching_timesheet_requests where actor_id in(${ids.map(q).join(",")});
   delete from private.teaching_timesheets where id=${q(time)};
   delete from public.notifications where user_id in(${ids.map(q).join(",")});
   delete from public.assignment_sessions where claim_id=${q(claim)};
   delete from public.job_claims where id=${q(claim)};
   delete from public.jobs where id=${q(job)};`);
  });
  await checked(
    service.from("profiles").update({ time_zone: "UTC" }).in("id", ids),
  );
  await checked(
    service.from("jobs").insert({
      id: job,
      title: "Fictional actual time evidence",
      customer_name: "Fictional time API academy",
      delivery_type: "online",
      status: "filled",
      amount: 301,
      total_amount: 301,
      currency: "EUR",
      rate_unit: "fixed_total",
      terms: "Immutable fee independent of recorded hours",
    }),
  );
  await checked(
    service.from("job_claims").insert({
      id: claim,
      job_id: job,
      lecturer_id: owner.id,
      idempotency_key: randomUUID(),
      amount: 301,
      total_amount: 301,
      currency: "EUR",
      rate_unit: "fixed_total",
      terms: "Immutable fee independent of recorded hours",
      terms_version: 1,
    }),
  );
  await checked(
    service.from("assignment_sessions").insert({
      id: session,
      claim_id: claim,
      lecturer_id: owner.id,
      starts_at: "2020-01-06T08:00:00Z",
      ends_at: "2020-01-06T16:00:00Z",
    }),
  );
  const args = { p_from: "2020-01-01", p_until: "2020-02-01", p_all: false };
  const payload = {
    session_id: session,
    starts_at: "2020-01-06T08:00:00Z",
    ends_at: "2020-01-06T16:00:00Z",
    break_minutes: 30,
    note: "Fictional completed teaching evidence",
  };
  assert.equal(
    (
      await peer.client.rpc("save_timesheet", {
        p_id: time,
        p_payload: payload,
        p_expected_version: 0,
      })
    ).error?.code,
    "42501",
  );
  assert.equal(
    (
      await owner.client.rpc("save_timesheet", {
        p_id: time,
        p_payload: { ...payload, state: "approved" },
        p_expected_version: 0,
      })
    ).error?.code,
    "22023",
  );
  let current = await checked(
    owner.client.rpc("save_timesheet", {
      p_id: time,
      p_payload: payload,
      p_expected_version: 0,
    }),
  );
  assert.equal(current.minutes, 450);
  assert.equal(current.state, "draft");
  assert.equal(current.version, 1);
  assert.deepEqual(
    await checked(
      owner.client.rpc("save_timesheet", {
        p_id: time,
        p_payload: payload,
        p_expected_version: 0,
      }),
    ),
    current,
  );
  const saves = await Promise.all(
    [1, 2].map((n) =>
      owner.client.rpc("save_timesheet", {
        p_id: time,
        p_payload: { ...payload, note: `Fictional exact version ${n}` },
        p_expected_version: 1,
      }),
    ),
  );
  assert.equal(saves.filter((r) => !r.error).length, 1);
  assert.equal(saves.find((r) => r.error)?.error.code, "40001");
  current = saves.find((r) => !r.error).data;
  assert.equal(
    (await checked(peer.client.rpc("timesheets", args))).items.length,
    0,
  );
  const managementTimesheets = await checked(
    manager.client.rpc("timesheets", { ...args, p_all: true }),
  );
  assert.equal(managementTimesheets.can_review, true);
  assert.ok(managementTimesheets.items.some((item) => item.id === time));
  const submit = {
    p_id: time,
    p_action: "submit",
    p_expected_version: current.version,
    p_request_id: randomUUID(),
    p_reason: "",
  };
  current = await checked(owner.client.rpc("manage_timesheet", submit));
  assert.equal(current.state, "submitted");
  assert.deepEqual(
    await checked(owner.client.rpc("manage_timesheet", submit)),
    current,
  );
  const review = {
    p_id: time,
    p_action: "approve",
    p_expected_version: current.version,
    p_request_id: randomUUID(),
    p_reason: "Fictional reviewed hours",
  };
  assert.equal(
    (await owner.client.rpc("manage_timesheet", review)).error?.code,
    "42501",
  );
  assert.equal(
    (await manager.client.rpc("manage_timesheet", review)).error?.code,
    "42501",
  );
  await passwordOnly(manager.client);
  current = await checked(manager.client.rpc("manage_timesheet", review));
  assert.equal(current.state, "approved");
  assert.equal(
    (
      await owner.client.rpc("save_timesheet", {
        p_id: time,
        p_payload: payload,
        p_expected_version: current.version,
      })
    ).error?.code,
    "22023",
  );
  assert.equal(
    (await peer.client.rpc("timesheet_history", { p_id: time })).error?.code,
    "42501",
  );
  const history = await checked(
    owner.client.rpc("timesheet_history", { p_id: time }),
  );
  assert.equal(history.filter((entry) => entry.action === "submit").length, 1);
  assert.equal(history.at(-1).after_state.state, "approved");
  const confirmation = await checked(
    owner.client.rpc("assignment_confirmation", { p_claim_id: claim }),
  );
  assert.match(confirmation.hash, /^[0-9a-f]{64}$/);
  assert.equal(confirmation.data.total_amount, 301);
  assert.deepEqual(
    await checked(
      owner.client.rpc("assignment_confirmation", { p_claim_id: claim }),
    ),
    confirmation,
  );
  assert.equal(
    (await peer.client.rpc("assignment_confirmation", { p_claim_id: claim }))
      .error?.code,
    "42501",
  );
  const statement = await checked(owner.client.rpc("finance_statement", args));
  assert.equal(statement.data.claims.length, 1);
  assert.equal(statement.data.totals[0].currency, "EUR");
  assert.equal(statement.data.approved_minutes[0].minutes, 450);
  assert.ok(!JSON.stringify(statement).includes("gross"));
  assert.deepEqual(
    await checked(owner.client.rpc("finance_statement", args)),
    statement,
  );
  assert.equal(
    (
      await checked(
        manager.client.rpc("finance_statement", { ...args, p_all: true }),
      )
    ).data.claims.length,
    1,
  );
  const forecast = await checked(
    manager.client.rpc("finance_forecast", {
      p_from: args.p_from,
      p_until: args.p_until,
      p_pipeline_probability: 0.25,
    }),
  );
  assert.equal(forecast.gross_authorized, false);
  assert.ok(
    forecast.months.every((month) => month.accepted_gross_known === null),
  );
  assert.equal(
    (
      await owner.client.rpc("control_center", {
        p_from: args.p_from,
        p_until: args.p_until,
      })
    ).error?.code,
    "42501",
  );
  const center = await checked(
    manager.client.rpc("control_center", {
      p_from: args.p_from,
      p_until: args.p_until,
    }),
  );
  assert.ok(Array.isArray(center.overdue_tasks));
  assert.equal(
    (
      await owner.client.rpc("finance_statement", {
        ...args,
        p_until: "infinity",
      })
    ).error?.code,
    "22023",
  );
  assert.equal(
    (
      await checked(
        service
          .from("job_claims")
          .select("total_amount,terms")
          .eq("id", claim)
          .single(),
      )
    ).total_amount,
    301,
  );
  await checked(
    service.from("profiles").update({ active: false }).eq("id", owner.id),
  );
  assert.equal(
    (await owner.client.rpc("timesheets", args)).error?.code,
    "42501",
  );
  assert.equal(
    (await owner.client.rpc("assignment_confirmation", { p_claim_id: claim }))
      .error?.code,
    "42501",
  );
  console.log(
    "PASS real Auth/REST/password-only authentication own completed time, exact fields and CAS, idempotent submit, current financial review, immutable approval/history, stable owned facts/hash, unchanged compensation, original-currency/gross separation and active-token revocation.",
  );
});
