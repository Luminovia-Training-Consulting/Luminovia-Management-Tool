/** Exercise the existing claim authority and real reviewed scheduler on isolated PostgreSQL. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

await withTestDatabase("job_publication_window", async ({ sql, actor }) => {
  const [
    admin,
    guest,
    invitee,
    outsider,
    cancelled,
    priority,
    deferred,
    stale,
    privateOnly,
    revokedPlan,
    reviewer,
  ] = Array.from({ length: 11 }, randomUUID);
  const lecturers = [invitee, outsider, cancelled];
  const jobs = [priority, deferred, stale, privateOnly, revokedPlan];
  await sql(`
    insert into auth.users(id,email,email_confirmed_at) values
      ${[admin, guest, reviewer, ...lecturers].map((id) => `(${q(id)},${q(id + "@example.invalid")},now())`).join(",")};
    insert into public.user_roles(user_id,role) values (${q(admin)},'admin'),(${q(guest)},'participant'),(${q(reviewer)},'management'),
      ${lecturers.map((id) => `(${q(id)},'lecturer')`).join(",")};
    insert into public.jobs(id,title,customer_name,delivery_type,status,amount,total_amount,currency,rate_unit,terms,capacity,capacity_basis,claim_deadline,created_by)
      values ${jobs.map((id) => `(${q(id)},'Fictional priority offer','Fictional College','online','draft',100,100,'EUR','fixed_total','Fictional assignment terms',2,'per_position','2040-01-03T01:00Z',${q(admin)})`).join(",")};
    insert into public.job_sessions(job_id,starts_at,ends_at) values
      ${jobs.map((id, index) => `(${q(id)},'2040-01-0${index + 4}T09:00Z','2040-01-0${index + 4}T10:00Z')`).join(",")};
  `);
  const rpc = async (who, name, ...args) =>
    JSON.parse(
      await actor(
        who,
        `select to_jsonb(public.${name}(${args.map((arg) => (typeof arg === "number" ? arg : typeof arg === "string" ? q(arg) : q(JSON.stringify(arg)) + "::jsonb")).join(",")}))`,
      ),
    );
  const projection = (id) => rpc(admin, "job_publication_plan", id);
  const action = (id, action, version, payload, key = randomUUID()) =>
    rpc(admin, "job_publication_action", id, action, version, key, payload);
  const request = randomUUID();
  const plan = {
    audience: "priority",
    opens_at: null,
    selection_ends_at: "2040-01-02T00:00:00Z",
    lecturer_ids: [invitee, cancelled],
  };
  assert.equal(
    (await rpc(admin, "job_publication_candidates", priority)).length,
    3,
  );
  await assert.rejects(
    () => rpc(guest, "job_publication_candidates", priority),
    /42501/,
  );
  const first = await action(priority, "schedule", 1, plan, request);
  assert.equal(first.state, "active");
  assert.deepEqual(await action(priority, "schedule", 1, plan, request), first);
  await assert.rejects(
    () =>
      action(
        priority,
        "schedule",
        1,
        { ...plan, lecturer_ids: [invitee] },
        request,
      ),
    /22023/,
  );
  const ownsOffer = async (who, job) =>
    (await rpc(who, "job_offers")).some((row) => row.id === job);
  assert.equal(await ownsOffer(invitee, priority), true);
  assert.equal(await ownsOffer(outsider, priority), false);
  assert.equal(
    (await rpc(outsider, "claim_job", priority, randomUUID(), 1)).status,
    "not_eligible",
  );
  const removed = await action(priority, "cancel_invitation", first.version, {
    lecturer_id: cancelled,
  });
  assert.equal(
    removed.invitees.find((row) => row.id === cancelled).status,
    "cancelled",
  );
  assert.equal(await ownsOffer(cancelled, priority), false);
  assert.equal(
    (await rpc(invitee, "claim_job", priority, randomUUID(), 1)).status,
    "confirmed",
  );

  const deferredInput = {
    audience: "marketplace",
    opens_at: "2039-12-30T09:00:00Z",
    selection_ends_at: null,
    lecturer_ids: [],
  };
  const scheduled = await action(deferred, "schedule", 1, deferredInput);
  assert.equal(scheduled.state, "scheduled");
  assert.equal(await ownsOffer(outsider, deferred), false);
  await assert.rejects(
    () =>
      rpc(
        admin,
        "manage_job_offer",
        deferred,
        "published",
        scheduled.version,
        randomUUID(),
        {},
      ),
    /22023/,
    "the ordinary action cannot release a future reviewed plan early",
  );
  await action(stale, "schedule", 1, deferredInput);
  await sql(`update public.jobs set title = 'Fictional changed assignment' where id = ${q(stale)};
    update private.job_publication_plans set opens_at = clock_timestamp() - interval '1 minute'
    where job_id in (${q(deferred)},${q(stale)});
    update private.job_publication_plans set opens_at = clock_timestamp() - interval '2 minutes',
      selection_ends_at = clock_timestamp() - interval '1 minute' where job_id = ${q(priority)};`);
  await assert.rejects(
    () => actor(admin, "select private.run_scheduled_job_publications()"),
    /42501/,
  );
  assert.equal(
    await sql("select private.run_scheduled_job_publications()"),
    "2",
  );
  assert.equal((await projection(stale)).state, "blocked");
  assert.equal(await ownsOffer(outsider, stale), false);
  assert.equal((await projection(deferred)).state, "released");
  assert.equal(await ownsOffer(outsider, deferred), true);
  assert.equal((await projection(priority)).state, "released");
  assert.equal(await ownsOffer(outsider, priority), true);
  assert.equal(
    await sql("select private.run_scheduled_job_publications()"),
    "0",
    "a second worker pass performs no duplicate operations",
  );

  const toCancel = await action(privateOnly, "schedule", 1, {
    ...plan,
    audience: "selected",
    opens_at: deferredInput.opens_at,
  });
  const cancellation = await action(
    privateOnly,
    "cancel",
    toCancel.version,
    {},
  );
  assert.equal(cancellation.state, "cancelled");
  const privateResult = await action(
    privateOnly,
    "schedule",
    cancellation.version,
    { ...plan, audience: "selected" },
  );
  assert.equal(privateResult.state, "active");
  await sql(`update private.job_publication_plans set opens_at = clock_timestamp() - interval '2 minutes',
    selection_ends_at = clock_timestamp() - interval '1 minute' where job_id = ${q(privateOnly)};`);
  await sql("select private.run_scheduled_job_publications()");
  assert.equal((await projection(privateOnly)).state, "expired");
  assert.equal(await ownsOffer(invitee, privateOnly), false);
  assert.equal(await ownsOffer(outsider, privateOnly), false);
  await rpc(
    reviewer,
    "job_publication_action",
    revokedPlan,
    "schedule",
    1,
    randomUUID(),
    deferredInput,
  );
  await sql(`delete from public.user_roles where user_id = ${q(reviewer)} and role = 'management';
    update private.job_publication_plans set opens_at = clock_timestamp() - interval '1 minute'
    where job_id = ${q(revokedPlan)};`);
  assert.equal(
    await sql("select private.run_scheduled_job_publications()"),
    "0",
  );
  assert.equal(
    (await projection(revokedPlan)).state,
    "blocked",
    "the worker rechecks reviewer authority",
  );
  assert.equal(await ownsOffer(outsider, revokedPlan), false);
  console.log("Reviewed publication window SQL checks passed.");
});
