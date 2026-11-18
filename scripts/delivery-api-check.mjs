/** Actual Auth/password-only authentication/REST delivery, independent review and customer isolation. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { withApiFixture } from "./testing/api.mjs";
import { quoteSql as q } from "./testing/database.mjs";

await withApiFixture(async ({ actor, checked, sql, defer, service }) => {
  const teacher = await actor("delivery-teacher", "lecturer"),
    peer = await actor("delivery-peer", "lecturer"),
    manager = await actor("delivery-manager", "admin"),
    customer = await actor("delivery-customer", "client"),
    outsider = await actor("delivery-outsider", "client");
  const ids = Array.from({ length: 7 }, randomUUID),
    [org, otherOrg, template, run, job, claim, session] = ids;
  const users = [teacher.id, peer.id, manager.id, customer.id, outsider.id]
    .map(q)
    .join(",");
  // Only this canonical disposable API stack permits privileged fixture cleanup.
  // Transaction-local replica mode removes our immutable test evidence; it never
  // changes a trigger definition or grants a product mutation bypass.
  defer(async () => {
    await sql(`begin;set local session_replication_role=replica;
    delete from private.delivery_operations where actor_id in(${users});
    delete from private.delivery_events where session_id=${q(session)};
    delete from private.delivery_submissions where session_id=${q(session)};
    delete from private.delivery_records where session_id=${q(session)};
    delete from public.notifications where user_id in(${users});
    delete from public.assignment_sessions where id=${q(session)};
    delete from public.job_claims where id=${q(claim)};
    delete from public.jobs where id=${q(job)};
    delete from public.course_runs where id=${q(run)};
    delete from public.course_templates where id=${q(template)};
    delete from public.client_organisation_memberships where user_id in(${users});
    delete from public.organisations where id in(${q(org)},${q(otherOrg)});commit;`);
  });
  await sql(`insert into public.organisations(id,name) values(${q(org)},'Fictional delivery API customer'),(${q(otherOrg)},'Fictional delivery API outsider');
    insert into public.client_organisation_memberships(user_id,organisation_id) values(${q(customer.id)},${q(org)}),(${q(outsider.id)},${q(otherOrg)});
    insert into public.course_templates(id,title) values(${q(template)},'Fictional API delivery template');
    insert into public.course_runs(id,template_id,organisation_id,time_zone) values(${q(run)},${q(template)},${q(org)},'Europe/Berlin');
    insert into public.jobs(id,course_run_id,title,customer_name,delivery_type,status,location,amount,currency,rate_unit,total_amount,terms) values(${q(job)},${q(run)},'Fictional API delivery block','Fictional API delivery customer','online','filled','https://example.invalid/class',125,'AUD','fixed_total',125,'Fictional immutable fee');
    insert into public.job_claims(id,job_id,lecturer_id,idempotency_key,amount,currency,rate_unit,total_amount,terms,terms_version) values(${q(claim)},${q(job)},${q(teacher.id)},${q(randomUUID())},125,'AUD','fixed_total',125,'Fictional immutable fee',1);
    insert into public.assignment_sessions(id,claim_id,lecturer_id,starts_at,ends_at) values(${q(session)},${q(claim)},${q(teacher.id)},'2001-01-01T09:00:00Z','2001-01-01T10:00:00Z');`);
  const call = (who, name, args) => checked(who.client.rpc(name, args), name);
  const args = {
    p_session_id: session,
    p_expected_version: 0,
    p_payload: {
      outcome: "partial",
      actual_start: "2001-01-01T09:00:00Z",
      actual_end: "2001-01-01T09:30:00Z",
      time_zone: "Europe/Berlin",
      notes: "Fictional internal connection interruption",
      correction_reason: "",
    },
    p_request_id: randomUUID(),
  };
  assert.equal(
    (await peer.client.rpc("delivery_session", { p_session_id: session })).error
      ?.code,
    "42501",
  );
  assert.equal(
    (await call(teacher, "delivery_sessions", { p_scope: "own" })).items[0]
      .session_id,
    session,
  );
  const draft = await call(teacher, "save_delivery_draft", args);
  assert.equal(draft.version, 1);
  const submitArgs = {
    p_session_id: session,
    p_expected_version: 1,
    p_request_id: randomUUID(),
  };
  const submitted = await call(teacher, "submit_delivery", submitArgs);
  assert.equal(submitted.status, "submitted");
  assert.deepEqual(
    await call(teacher, "submit_delivery", submitArgs),
    submitted,
  );
  const decision = {
    p_session_id: session,
    p_expected_version: 2,
    p_action: "confirm",
    p_note: "Reviewed fictional evidence",
    p_request_id: randomUUID(),
  };
  const results = await Promise.all([
    manager.client.rpc("review_delivery", decision),
    manager.client.rpc("review_delivery", {
      ...decision,
      p_request_id: randomUUID(),
    }),
  ]);
  assert.equal(results.filter((r) => !r.error).length, 1);
  assert.equal(results.find((r) => r.error).error.code, "40001");
  const clientRows = await call(customer, "delivery_sessions", {
    p_scope: "customer",
  });
  assert.equal(clientRows.items.length, 1);
  assert.equal(clientRows.items[0].submission.notes, null);
  assert.equal(clientRows.items[0].invoice_id, null);
  assert.equal(
    (await call(outsider, "delivery_sessions", { p_scope: "customer" })).items
      .length,
    0,
  );
  assert.equal(
    (
      await outsider.client.rpc("confirm_customer_delivery", {
        p_session_id: session,
        p_expected_version: 3,
        p_request_id: randomUUID(),
      })
    ).error?.code,
    "42501",
  );
  await call(customer, "confirm_customer_delivery", {
    p_session_id: session,
    p_expected_version: 3,
    p_request_id: randomUUID(),
  });
  await call(manager, "review_delivery", {
    ...decision,
    p_expected_version: 4,
    p_action: "request_correction",
    p_note: "Please explain fictional missing minutes",
    p_request_id: randomUUID(),
  });
  await call(teacher, "save_delivery_draft", {
    ...args,
    p_expected_version: 5,
    p_payload: {
      ...args.p_payload,
      actual_end: "2001-01-01T09:45:00Z",
      correction_reason: "Corrected fictional interruption duration",
    },
    p_request_id: randomUUID(),
  });
  const corrected = await call(teacher, "submit_delivery", {
    ...submitArgs,
    p_expected_version: 6,
    p_request_id: randomUUID(),
  });
  assert.equal(corrected.actual_minutes, 45);
  assert.equal(corrected.submission.revision, 2);
  const history = await call(teacher, "delivery_history", {
    p_session_id: session,
  });
  assert.equal(history.submissions.length, 2);
  assert.equal(history.submissions[1].actual_end, "2001-01-01T09:30:00+00:00");
  assert.ok(history.events.some((e) => e.action === "customer_confirmed"));
  assert.equal(
    (await customer.client.rpc("delivery_history", { p_session_id: session }))
      .error?.code,
    "42501",
  );
  const before = await checked(
    service
      .from("job_claims")
      .select("amount,currency,total_amount,terms,terms_version")
      .eq("id", claim)
      .single(),
  );
  assert.deepEqual(before, {
    amount: 125,
    currency: "AUD",
    total_amount: 125,
    terms: "Fictional immutable fee",
    terms_version: 1,
  });
  await checked(
    service.from("profiles").update({ active: false }).eq("id", teacher.id),
  );
  assert.equal(
    (await teacher.client.rpc("delivery_history", { p_session_id: session }))
      .error?.code,
    "42501",
  );
  console.log(
    "PASS actual Auth/REST delivery: own sessions, persisted partial draft, idempotent submit, independent password-only authentication/concurrent review, isolated client confirmation, immutable correction history, preserved AUD agreement and suspended-token denial.",
  );
});
