/** Verify course delivery inheritance, venue snapshots and sensitive projections in PostgreSQL. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { quoteSql, withTestDatabase } from "./testing/database.mjs";

const ids = Object.fromEntries(
  [
    "admin",
    "lecturer",
    "org",
    "other",
    "template",
    "run",
    "one",
    "two",
    "job",
    "slot",
  ].map((key) => [key, randomUUID()]),
);
const id = (key) => quoteSql(ids[key]);
const wire = (value) => `${quoteSql(JSON.stringify(value))}::jsonb`;
const publicVenue = {
  name: "Training Hall",
  city: "Brisbane",
  country: "Australia",
  time_zone: "Australia/Brisbane",
  room: "A",
};
await withTestDatabase("training_delivery", async ({ sql, actor }) => {
  await sql(`
    insert into auth.users(id,email) values
      (${id("admin")},'delivery-admin@example.invalid'),(${id("lecturer")},'delivery-lecturer@example.invalid');
    insert into public.user_roles(user_id,role) values (${id("admin")},'admin'),(${id("lecturer")},'lecturer');
    insert into public.organisations(id,name) values (${id("org")},'Example Training'),(${id("other")},'Other training');
    insert into public.course_templates(id,title) values (${id("template")},'Fictional course');
    insert into public.course_runs(id,template_id,organisation_id) values (${id("run")},${id("template")},${id("org")});
    insert into public.course_sessions(id,course_run_id,starts_at,ends_at) values
      (${id("one")},${id("run")},now()+interval '1 day',now()+interval '1 day 1 hour'),
      (${id("two")},${id("run")},now()+interval '2 days',now()+interval '2 days 1 hour');
  `);
  const call = (statement, who = "admin") =>
    actor(ids[who], `select ${statement}`, "aal2");
  const venueInput = (details, is_default = false) =>
    wire({ details, archived: false, is_default });
  const createVenue = (org, details) =>
    call(
      `public.save_training_venue(${id(org)},null,0,${venueInput(details, true)})`,
    );
  const first = await createVenue("org", publicVenue);
  const foreign = await createVenue("other", {
    ...publicVenue,
    name: "Foreign",
  });
  const save = (
    revision,
    defaults,
    overrides_enabled = false,
    overrides = {},
  ) =>
    call(
      `public.save_training_delivery(${id("run")},${revision},${wire({ defaults, overrides_enabled, overrides })})`,
    ).then(JSON.parse);
  const room = {
    mode: "hybrid",
    venue_id: first,
    meeting_platform: "teams",
    meeting_url: "https://meet.example.invalid/course",
    meeting_access: "private test access",
  };
  await assert.rejects(save(0, { ...room, venue_id: foreign }), /22023/);
  await assert.rejects(
    call(`public.training_venue_directory(${id("org")})`, "lecturer"),
    /42501/,
  );
  await assert.rejects(createVenue("org", publicVenue), /23505/);
  const draft = await save(0, room, true, { [ids.two]: { mode: "online" } });
  assert.equal(draft.mode, "mixed");
  assert.equal(draft.sessions[1].effective.meeting_url, room.meeting_url);
  const paused = await save(1, room, false);
  assert.equal(paused.mode, "hybrid");
  assert.equal(paused.sessions[1].override.mode, "online");
  await assert.rejects(save(1, room, true), /PT409/);
  await call(
    `public.save_training_venue(${id("org")},${quoteSql(first)},1,${venueInput({ ...publicVenue, city: "Logan" })})`,
  );
  const resumed = await save(2, room, true);
  assert.equal(resumed.sessions[0].effective.venue.city, "Brisbane");
  assert.equal(resumed.mode, "mixed");
  await save(3, { ...room, meeting_url: null }, true);
  await assert.rejects(
    sql(`update public.course_runs set published=true where id=${id("run")}`),
    /Complete each effective delivery/,
  );
  await save(4, room, true);
  await sql(`
    insert into public.jobs(id,course_run_id,title,customer_name,delivery_type,amount,currency,rate_unit,total_amount,terms,created_by)
    values (${id("job")},${id("run")},'Fictional offer','Example Training','online',60,'AUD','fixed_total',60,'Fictional terms',${id("admin")});
    insert into public.job_sessions(id,job_id,course_session_id,starts_at,ends_at)
      select ${id("slot")},${id("job")},id,starts_at,ends_at from public.course_sessions where id=${id("one")};
    update public.jobs set status='published' where id=${id("job")};
  `);
  const preview = JSON.parse(
    await call(`public.training_offer_delivery(${id("job")})`, "lecturer"),
  );
  assert.deepEqual(preview, {
    mode: "hybrid",
    locations: [{ city: "Brisbane", country: "Australia" }],
  });
  await assert.rejects(save(5, room), /PT409/);
  const accepted = JSON.parse(
    await call(
      `public.claim_job(${id("job")},${quoteSql(randomUUID())},1)`,
      "lecturer",
    ),
  );
  assert.equal(accepted.status, "confirmed");
  const snapshot = JSON.parse(
    await sql(
      `select sessions from private.training_assignment_delivery where claim_id=${quoteSql(accepted.claim_id)}`,
    ),
  );
  assert.equal(snapshot[0].config.venue.city, "Brisbane");
  assert.equal(snapshot[0].config.mode, "hybrid");
  const detail = JSON.parse(
    await call(`public.training_delivery_view(${id("run")})`, "lecturer"),
  );
  assert.equal(detail.sessions[0].effective.meeting_url, room.meeting_url);
  assert.equal(detail.sessions[1].effective.meeting_url, null);
  console.log(
    "PASS foreign venues, scoped metadata, explicit inheritance, revision conflicts, retained venue snapshots and effective delivery publication checks",
  );
});
