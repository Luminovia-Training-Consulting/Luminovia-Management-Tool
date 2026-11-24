/** Validate personal recurrence through the deployed SQL entry points and existing RLS. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

await withTestDatabase("personal_series", async ({ sql, actor }) => {
  const [owner, admin, inactive, removable] = Array.from(
    { length: 4 },
    randomUUID,
  );
  await sql(`
    insert into auth.users(id,email) values
      (${q(owner)},'series-owner@example.invalid'),
      (${q(admin)},'series-admin@example.invalid'),
      (${q(inactive)},'series-inactive@example.invalid'),
      (${q(removable)},'series-removable@example.invalid');
    insert into public.user_roles(user_id,role) values
      (${q(owner)},'lecturer'),(${q(admin)},'admin'),
      (${q(inactive)},'lecturer'),(${q(removable)},'lecturer');
    update public.profiles set active=false where id=${q(inactive)};
  `);
  const at = (shift, hour) => {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() + shift);
    date.setUTCHours(hour, 0, 0, 0);
    return date.toISOString();
  };
  const occurrence = (shift) => ({
    starts_at: at(shift, 9),
    ends_at: at(shift, 10),
  });
  const now = Date.now();
  const started = {
    starts_at: new Date(now - 30 * 60_000).toISOString(),
    ends_at: new Date(now + 30 * 60_000).toISOString(),
  };
  const valid = [occurrence(-7), started, occurrence(7), occurrence(14)];
  const create = (
    who,
    request,
    slots = valid,
    { zone = "Europe/Berlin", title = "Fictional personal series" } = {},
  ) =>
    actor(
      who,
      `select public.create_my_personal_event_series(
      ${q(request)}, ${q(title)}, 'Private note', 'https://calendar.example.invalid/meeting',
      ${q(zone)}, ${q(JSON.stringify(slots))}::jsonb
    )`,
    );
  const cancel = (who, series) =>
    actor(who, `select public.cancel_my_future_personal_events(${q(series)})`);

  const request = randomUUID();
  const twoCalls = await Promise.all([
    create(owner, request),
    create(owner, request),
  ]);
  const receipt = JSON.parse(twoCalls[0]);
  assert.deepEqual(receipt, { series_id: receipt.series_id, created: 4 });
  assert.equal(typeof receipt.series_id, "string");
  assert.deepEqual(JSON.parse(twoCalls[1]), receipt);
  await assert.rejects(
    create(owner, request, valid, { title: "Changed" }),
    /PT409/,
  );
  await assert.rejects(create(inactive, request), /42501/);
  assert.equal(
    await actor(owner, "select count(*) from public.personal_events"),
    "4",
  );
  assert.equal(
    await actor(admin, "select count(*) from public.personal_events"),
    "0",
  );
  await assert.rejects(cancel(admin, receipt.series_id), /42501/);
  await assert.rejects(
    actor(owner, `select * from private.personal_event_series`),
    /42501/,
  );
  await assert.rejects(
    actor(owner, `update public.personal_events set recurrence_series_id=null`),
    /42501/,
  );
  console.log(
    "PASS same-request concurrency creates exactly one private series; actor and ACL remain server-authoritative",
  );

  const latest = valid.at(-1);
  assert.equal(
    await actor(
      owner,
      `with changed as (
    update public.personal_events set title='One occurrence only'
    where starts_at=${q(latest.starts_at)} returning id
  ) select count(*) from changed`,
    ),
    "1",
  );
  const future = await cancel(owner, receipt.series_id);
  assert.equal(future, "2");
  assert.equal(await cancel(owner, receipt.series_id), "0");
  assert.deepEqual(JSON.parse(await create(owner, request)), receipt);
  assert.equal(
    await actor(owner, "select count(*) from public.personal_events"),
    "2",
  );
  assert.equal(
    await sql(
      `select count(*) from public.personal_events where starts_at=${q(valid[0].starts_at)}`,
    ),
    "1",
  );
  console.log(
    "PASS per-occurrence edits, future-only cancellation, and original retries preserve past appointments",
  );

  for (const slots of [
    [null],
    [],
    [occurrence(29), occurrence(29)],
    [{ ...occurrence(30), ends_at: "infinity" }],
    Array.from({ length: 53 }, (_, i) => occurrence(32 + i)),
  ]) {
    await assert.rejects(create(owner, randomUUID(), slots), /22023/);
  }
  await assert.rejects(
    create(owner, randomUUID(), valid, { zone: "Unknown/Zone" }),
    /22023/,
  );
  const job = randomUUID();
  const claim = randomUUID();
  await sql(`
    insert into public.jobs(id,title,customer_name,delivery_type,status,amount,total_amount,currency,rate_unit,terms)
    values(${q(job)},'Fictional confirmed assignment','Fictional company','online','filled',100,100,'EUR','fixed_total','Fictional');
    insert into public.job_claims(id,job_id,lecturer_id,idempotency_key,amount,total_amount,currency,rate_unit,terms,terms_version)
    values(${q(claim)},${q(job)},${q(owner)},${q(randomUUID())},100,100,'EUR','fixed_total','Fictional',1);
    insert into public.assignment_sessions(claim_id,lecturer_id,starts_at,ends_at)
    values(${q(claim)},${q(owner)},${q(at(34, 9))},${q(at(34, 10))});
  `);
  const retriable = randomUUID();
  await assert.rejects(
    create(owner, retriable, [occurrence(33), occurrence(34)]),
    /23P01/,
  );
  assert.equal(await sql("select count(*) from public.personal_events"), "2");
  assert.equal(
    await sql("select count(*) from private.personal_event_series"),
    "1",
  );
  const retried = JSON.parse(
    await create(owner, retriable, [occurrence(33), occurrence(35)]),
  );
  assert.equal(retried.created, 2);
  assert.equal(await sql("select count(*) from public.personal_events"), "4");
  console.log(
    "PASS invalid and conflicting occurrences roll back every row and receipt, and repaired input succeeds",
  );

  await create(removable, randomUUID(), [occurrence(70), occurrence(71)]);
  const ownCalendar = await actor(
    removable,
    "select id from public.personal_events limit 1",
  );
  await assert.rejects(
    actor(
      admin,
      `select public.deletion_preview('personal_event', ${q(ownCalendar)})`,
    ),
    /42501/,
  );
  const plan = JSON.parse(
    await actor(
      admin,
      `select public.deletion_preview('account', ${q(removable)})`,
    ),
  );
  assert.equal(plan.can_confirm, true, JSON.stringify(plan.blockers));
  assert.equal(plan.counts["public.personal_events"], 2);
  assert.equal(plan.counts["private.personal_event_series"], 1);
  assert.ok(!JSON.stringify(plan).includes("Private note"));
  const operation = JSON.parse(
    await actor(
      admin,
      `select public.deletion_confirm(
    ${q(plan.plan_id)}, ${q(randomUUID())}, 'DELETE'
  )`,
    ),
  );
  const permit = JSON.parse(
    await actor(
      admin,
      `select public.deletion_execution(${q(operation.operation_id)})`,
    ),
  );
  await sql(`begin; set local role service_role; set local request.jwt.claims='{"role":"service_role"}';
    select public._deletion_apply(${q(operation.operation_id)}, ${q(permit.permit_id)});
    commit;`);
  assert.equal(
    await sql(
      `select count(*) from private.personal_event_series where user_id=${q(removable)}`,
    ),
    "0",
  );
  assert.equal(
    await sql(
      `select count(*) from public.personal_events where user_id=${q(removable)}`,
    ),
    "0",
  );
  assert.equal(
    await sql(
      `select count(*) from public.personal_events where user_id=${q(owner)}`,
    ),
    "4",
  );
  console.log(
    "PASS eligible account deletion includes only its own series receipts and appointments; no private payload is exposed",
  );
});
