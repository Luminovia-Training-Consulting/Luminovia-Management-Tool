/** Real Auth/REST personal dashboard, checklist and account boundaries. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { withApiFixture } from "./testing/api.mjs";
import { quoteSql as q } from "./testing/database.mjs";

await withApiFixture(async ({ actor, checked, sql, defer, service }) => {
  const owner = await actor("dashboard-personal-owner", "lecturer"),
    peer = await actor("dashboard-personal-peer", "lecturer"),
    admin = await actor("dashboard-personal-admin", "admin");
  const job = randomUUID(),
    claim = randomUUID(),
    session = randomUUID();
  defer(async () => {
    await sql(`delete from private.teaching_preparation where claim_id=${q(claim)};
      delete from public.notifications where user_id in(${q(owner.id)},${q(peer.id)},${q(admin.id)});
      delete from public.assignment_sessions where claim_id=${q(claim)};
      delete from public.job_claims where id=${q(claim)};
      delete from public.jobs where id=${q(job)};`);
  });
  const defaultLayout = await checked(
    owner.client.rpc("dashboard_preferences"),
  );
  assert.equal(defaultLayout.version, 0);
  const payload = {
    widget_order: [...defaultLayout.widget_order].reverse(),
    hidden_widgets: ["files"],
  };
  const results = await Promise.all(
    [1, 2].map(() =>
      owner.client.rpc("save_dashboard_preferences", {
        p_payload: payload,
        p_expected_version: 0,
      }),
    ),
  );
  assert.equal(results.filter((r) => !r.error).length, 1);
  assert.equal(results.find((r) => r.error).error.code, "40001");
  assert.deepEqual(await checked(owner.client.rpc("dashboard_preferences")), {
    ...payload,
    version: 1,
  });
  for (const who of [peer, admin])
    assert.deepEqual(
      (await checked(who.client.rpc("dashboard_preferences"))).hidden_widgets,
      [],
    );
  const forged = await owner.client.rpc("save_dashboard_preferences", {
    p_payload: { ...payload, user_id: peer.id },
    p_expected_version: 1,
  });
  assert.equal(forged.error?.code, "22023");
  const day =
    "((now() at time zone 'Europe/Berlin')::date::timestamp at time zone 'Europe/Berlin')";
  await sql(`insert into public.jobs(id,title,customer_name,delivery_type,status,location,amount,currency,rate_unit,total_amount,terms) values(${q(job)},'Fictional API teaching day','Fictional API academy','online','filled','https://example.invalid/class',100,'EUR','fixed_total',100,'Fictional API terms');
    insert into public.job_claims(id,job_id,lecturer_id,idempotency_key,amount,currency,rate_unit,total_amount,terms,terms_version) values(${q(claim)},${q(job)},${q(owner.id)},${q(randomUUID())},100,'EUR','fixed_total',100,'Fictional API terms',1);
    insert into public.assignment_sessions(id,claim_id,lecturer_id,starts_at,ends_at) values(${q(session)},${q(claim)},${q(owner.id)},${day}+interval '9 hours',${day}+interval '10 hours');`);
  const today = await checked(owner.client.rpc("teaching_day"));
  assert.equal(today.sessions.length, 1);
  assert.equal(today.sessions[0].id, session);
  assert.equal(today.sessions[0].title, "Fictional API teaching day");
  for (const who of [peer, admin])
    assert.equal(
      (await checked(who.client.rpc("teaching_day"))).sessions.length,
      0,
    );
  const args = {
    p_claim_id: claim,
    p_item: "materials_ready",
    p_done: true,
    p_expected_version: 0,
  };
  const readiness = await checked(
    owner.client.rpc("save_teaching_preparation", args),
  );
  assert.equal(readiness.materials_ready, true);
  assert.equal(readiness.version, 1);
  for (const who of [peer, admin])
    assert.equal(
      (await who.client.rpc("save_teaching_preparation", args)).error?.code,
      "42501",
    );
  assert.equal(
    (await owner.client.rpc("save_teaching_preparation", args)).error?.code,
    "40001",
  );
  await checked(
    service
      .from("profiles")
      .update({ time_zone: "Australia/Brisbane" })
      .eq("id", owner.id),
  );
  assert.equal(
    (await checked(owner.client.rpc("teaching_day"))).time_zone,
    "Australia/Brisbane",
  );
  await sql(
    `update public.assignment_sessions set released_at=now() where id=${q(session)};update public.job_claims set status='cancelled' where id=${q(claim)};`,
  );
  assert.equal(
    (await checked(owner.client.rpc("teaching_day"))).sessions.length,
    0,
  );
  assert.equal(
    (
      await owner.client.rpc("save_teaching_preparation", {
        ...args,
        p_expected_version: 1,
      })
    ).error?.code,
    "42501",
  );
  await checked(
    service.from("profiles").update({ active: false }).eq("id", owner.id),
  );
  assert.equal(
    (await owner.client.rpc("dashboard_preferences")).error?.code,
    "42501",
  );
  assert.equal((await owner.client.rpc("teaching_day")).error?.code, "42501");
  console.log(
    "PASS: actual Auth/REST private dashboard saved order, concurrent CAS, forged identity denial, own teaching day/readiness, peer/admin isolation, current profile zone, cancellation and inactive-token denial.",
  );
});
