/** Exercise private revisioned assignment drafts and their atomic offer receipt in PostgreSQL. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

await withTestDatabase("offer_creator", async ({ actor, sql }) => {
  const manager = randomUUID();
  const other = randomUUID();
  const lecturer = randomUUID();
  const draft = randomUUID();
  const copy = randomUUID();
  await sql(`
    insert into auth.users(id,email) values
    (${q(manager)},'fictional-draft-manager@example.invalid'),
    (${q(other)},'fictional-second-draft-manager@example.invalid'),
    (${q(lecturer)},'fictional-draft-lecturer@example.invalid');
    insert into public.user_roles(user_id,role)
    values (${q(manager)},'management'),(${q(other)},'management'),(${q(lecturer)},'lecturer')
  `);
  const json = (value) => q(JSON.stringify(value)) + "::jsonb";
  const action = (uid, action, revision, payload, id = draft) =>
    actor(
      uid,
      `select public.training_offer_creator_draft_action(null,${q(id)},${revision},${q(action)},${json(payload)})`,
      "aal2",
    ).then(JSON.parse);
  const read = (uid, id = draft) =>
    actor(
      uid,
      `select public.training_offer_creator_drafts(null,${q(id)})`,
      "aal2",
    ).then(JSON.parse);
  const snapshot = {
    values: { title: "Fictional draft" },
    source_revision: null,
  };
  const first = await action(manager, "save", 0, snapshot);
  assert.equal(first.revision, 1);
  assert.deepEqual(await action(manager, "save", 0, snapshot), first);
  assert.deepEqual(await read(other), []);
  await assert.rejects(read(lecturer), /permission|privilege/i);
  await assert.rejects(
    action(other, "save", 0, snapshot),
    /permission|privilege/i,
  );
  assert.deepEqual((await read(manager))[0].payload, snapshot);
  const changed = {
    ...snapshot,
    values: { title: "Fictional reviewed assignment" },
  };
  assert.equal((await action(manager, "save", 1, changed)).revision, 2);
  await assert.rejects(action(manager, "save", 1, snapshot), /draft changed/i);
  assert.equal(
    (await action(manager, "duplicate", 2, { new_id: copy })).id,
    copy,
  );
  assert.equal(
    (await action(manager, "duplicate", 2, { new_id: copy })).id,
    copy,
  );
  assert.equal(
    (await action(manager, "discard", 1, {}, copy)).state,
    "discarded",
  );
  assert.deepEqual(await read(manager, copy), []);
  const confirmation = {
    capacity: 1,
    offer: {
      title: changed.values.title,
      description: "Fictional teaching offer",
      customer_name: "Fictional training customer",
      delivery_type: "online",
      time_zone: "Europe/Berlin",
      status: "draft",
      currency: "EUR",
      rate_unit: "fixed_total",
      terms: "Fictional reviewed terms",
      requires_contract: false,
      amount: 75,
      total_amount: 75,
      sessions: [
        { starts_at: "2042-01-01T08:00:00Z", ends_at: "2042-01-01T09:00:00Z" },
      ],
    },
  };
  assert.equal(await sql("select count(*) from public.jobs"), "0");
  const [receipt, replay] = await Promise.all([
    action(manager, "commit", 2, confirmation),
    action(manager, "commit", 2, confirmation),
  ]);
  assert.deepEqual(receipt, replay);
  assert.equal(receipt.state, "created");
  assert.equal(receipt.payload, null);
  assert.equal((await read(manager))[0].job_id, receipt.job_id);
  await assert.rejects(
    action(manager, "commit", 2, { ...confirmation, capacity: 2 }),
    /draft changed/i,
  );
  assert.equal(await sql("select count(*) from public.jobs"), "1");
  assert.equal(
    await sql(`select status from public.jobs where id=${q(receipt.job_id)}`),
    "draft",
  );
  const deletion = JSON.parse(
    await sql(`select private.deletion_snapshot('job',${q(receipt.job_id)})`),
  );
  assert.equal(deletion.counts["private.training_offer_creator_drafts"], 1);
  assert.equal(
    deletion.blockers.some(
      (item) => item.kind === "private.training_offer_creator_drafts",
    ),
    false,
  );
  console.log(
    "PASS exclusive draft ownership, exact revisions, duplication, discard and atomic offer receipt",
  );
});
