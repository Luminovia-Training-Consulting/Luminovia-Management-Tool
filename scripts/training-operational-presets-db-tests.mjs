/** Verify organisation scoping, revision checks and atomic adoption on real PostgreSQL. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

await withTestDatabase("operational_presets", async ({ sql, actor }) => {
  const [manager, stranger, customer, foreignCustomer, contact, venue, draft] =
    Array.from({ length: 7 }, randomUUID);
  await sql(`
    insert into auth.users(id,email,email_confirmed_at) values
      (${q(manager)},${q(manager + "@example.invalid")},now()),
      (${q(stranger)},${q(stranger + "@example.invalid")},now());
    insert into public.user_roles(user_id,role) values (${q(manager)},'admin'),(${q(stranger)},'participant');
    insert into public.organisations(id,name) values
      (${q(customer)},'Fictional operational customer'),(${q(foreignCustomer)},'Fictional unrelated customer');
    insert into public.organisation_contacts(id,organisation_id,name) values
      (${q(contact)},${q(customer)},'Fictional course contact');
    insert into private.training_venues(id,organisation_id,details) values
      (${q(venue)},${q(customer)},'{"name":"Fictional studio","city":"Hamburg","country":"DE","time_zone":"Europe/Berlin"}');
  `);
  const json = (value) => `${q(JSON.stringify(value))}::jsonb`;
  const save = (who, org, presetId, revision, payload) =>
    actor(
      who,
      `select public.save_training_operational_preset(${q(org)},${presetId ? q(presetId) : "null"},${revision},${json(payload)})`,
    ).then(JSON.parse);
  const list = (who, org) =>
    actor(who, `select public.training_operational_presets(${q(org)})`).then(
      JSON.parse,
    );
  const action = (pAction, revision, payload) =>
    actor(
      manager,
      `select public.course_creator_draft_action(${q(pAction)},${q(draft)},${revision},${json(payload)})`,
    ).then(JSON.parse);
  const input = {
    name: "Fictional hybrid delivery",
    config: {
      time_zone: "Europe/Berlin",
      starts_at: "10:00",
      ends_at: "16:00",
      contact_id: contact,
      delivery: {
        mode: "hybrid",
        venue_id: venue,
        meeting_platform: "teams",
        teaching_instructions: "Open the training room 30 minutes early.",
      },
    },
    archived: false,
  };

  await assert.rejects(() => list(stranger, customer), /42501/);
  await assert.rejects(
    () => save(manager, foreignCustomer, null, 0, input),
    /42501/,
  );
  await assert.rejects(
    () =>
      save(manager, customer, null, 0, {
        ...input,
        config: {
          ...input.config,
          delivery: {
            ...input.config.delivery,
            meeting_url: "https://example.invalid",
          },
        },
      }),
    /22023/,
  );
  const first = await save(manager, customer, null, 0, input);
  assert.equal(first.revision, 1);
  assert.deepEqual(await list(manager, foreignCustomer), []);
  await assert.rejects(
    () => save(manager, foreignCustomer, first.id, 1, input),
    /42501/,
  );

  const course = {
    template_id: "",
    organisation_id: customer,
    time_zone: "Europe/Berlin",
    delivery_type: "online",
    venue: "",
    sessions: [
      { starts_at: "2040-10-01T08:00:00Z", ends_at: "2040-10-01T14:00:00Z" },
    ],
  };
  const content = {
    title: "Fictional operational preset training",
    description: "",
    syllabus: "",
    prerequisites: "",
    topic_ids: [],
  };
  const confirm = (revision) => ({
    run: {
      ...course,
      operational_preset: { id: first.id, revision, apply_delivery: true },
    },
    content,
    next_action: "offer",
  });
  const saved = await action("save", 0, {
    run: { ...course, archived: false },
    content: { ...content, archived: false },
  });
  const revised = await save(manager, customer, first.id, 1, {
    ...input,
    name: "Fictional updated name",
  });
  assert.equal(revised.revision, 2);
  await assert.rejects(
    () => action("create_course", saved.revision, confirm(1)),
    /PT409/,
  );
  assert.equal(
    await sql(
      `select count(*) from public.course_templates where title=${q(content.title)}`,
    ),
    "0",
  );
  const created = await action("create_course", saved.revision, confirm(2));
  const retry = await action("create_course", saved.revision, confirm(2));
  assert.equal(created.course_run_id, retry.course_run_id);
  assert.equal(created.next_action, "offer");
  assert.equal(
    await sql(
      `select contact_id from private.course_workspace_settings where run_id=${q(created.course_run_id)}`,
    ),
    contact,
  );
  const defaults = JSON.parse(
    await sql(
      `select defaults from private.training_course_delivery where course_run_id=${q(created.course_run_id)}`,
    ),
  );
  assert.equal(defaults.mode, "hybrid");
  assert.equal(defaults.venue.name, "Fictional studio");
  assert.equal(defaults.meeting_platform, "teams");
  assert.equal(defaults.meeting_url, undefined);
  const template = await sql(
    `select template_id from public.course_runs where id=${q(created.course_run_id)}`,
  );
  const seriesRun = (date, applyDelivery = true) => ({
    delivery_type: "online",
    venue: "",
    class_id: null,
    operational_preset: {
      id: first.id,
      revision: 2,
      apply_delivery: applyDelivery,
    },
    sessions: [
      { starts_at: `${date}T08:00:00Z`, ends_at: `${date}T14:00:00Z` },
    ],
  });
  const series = (runs, request = null) =>
    actor(
      manager,
      `select public.plan_course_series(${q(customer)},${q(template)},'Europe/Berlin',${json(runs)},${request ? q(request) : "null"})`,
    ).then(JSON.parse);
  const roomConflict = await series([
    seriesRun("2040-10-01"),
    seriesRun("2040-10-02"),
  ]);
  assert.deepEqual(roomConflict.conflicts, [
    { run_no: 1, session_no: 1, reason: "room" },
  ]);
  const sameRoom = await series([
    seriesRun("2040-10-03"),
    seriesRun("2040-10-03"),
  ]);
  assert.equal(
    sameRoom.conflicts.filter((item) => item.reason === "room").length,
    2,
  );
  const scheduled = [seriesRun("2040-10-03"), seriesRun("2040-10-04", false)];
  const preview = await series(scheduled);
  assert.deepEqual(preview, { run_ids: [], conflicts: [] });
  const request = randomUUID();
  const confirmed = await series(scheduled, request);
  assert.equal(confirmed.run_ids.length, 2);
  const [hybrid, custom] = confirmed.run_ids;
  assert.equal(
    await sql(
      `select defaults->>'mode' from private.training_course_delivery where course_run_id=${q(hybrid)}`,
    ),
    "hybrid",
  );
  assert.equal(
    await sql(
      `select count(*) from private.training_course_delivery where course_run_id=${q(custom)}`,
    ),
    "0",
  );
  assert.equal(
    await sql(
      `select count(*) from private.course_workspace_settings where contact_id=${q(contact)} and run_id in (${q(hybrid)},${q(custom)})`,
    ),
    "2",
  );
  assert.deepEqual(await series(scheduled, request), confirmed);
  await save(manager, customer, first.id, 2, { ...input, archived: true });
  assert.deepEqual(await list(manager, customer), []);
  await assert.rejects(() => series(scheduled), /PT409/);
  assert.deepEqual(await series(scheduled, request), confirmed);
  assert.equal(
    await sql(
      `select defaults->>'mode' from private.training_course_delivery where course_run_id=${q(created.course_run_id)}`,
    ),
    "hybrid",
  );
  console.log(
    "PASS company operational preset scope, stale rollback, durable draft adoption, retained series retries and structured room conflicts",
  );
});
