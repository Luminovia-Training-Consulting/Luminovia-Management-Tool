/** Verify real database calculations, permission boundaries and acknowledgement isolation. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { quoteSql, withTestDatabase } from "./testing/database.mjs";

const fixture = Object.fromEntries(
  ["admin", "second", "lecturer", "template", "course"].map((key) => [
    key,
    randomUUID(),
  ]),
);
const id = (key) => quoteSql(fixture[key]);
const report =
  "select public.training_control_center(current_date-2,current_date+5)";
await withTestDatabase("training_control", async ({ actor, sql }) => {
  await sql(`
    insert into auth.users(id,email) values
      (${id("admin")},'training-control-admin@example.invalid'),
      (${id("second")},'training-control-second@example.invalid'),
      (${id("lecturer")},'training-control-lecturer@example.invalid');
    insert into public.user_roles(user_id,role) values
      (${id("admin")},'admin'),(${id("second")},'admin'),(${id("lecturer")},'lecturer');
    insert into public.course_templates(id,title) values
      (${id("template")},'Fictional metrics class');
    insert into public.course_runs(id,template_id,published) values
      (${id("course")},${id("template")},true);
    insert into public.course_sessions(course_run_id,starts_at,ends_at)
      values (${id("course")},now()+interval '1 day',now()+interval '1 day 90 minutes');
    insert into public.lecturer_availability(id,user_id,kind,starts_at,ends_at,share_with_management,notes)
    values (gen_random_uuid(),${id("lecturer")},'available',now()+interval '1 day',now()+interval '1 day 4 hours',true,'private availability note'),
      (gen_random_uuid(),${id("lecturer")},'unavailable',now()+interval '1 day 1 hour',now()+interval '1 day 2 hours',true,'private absence note');
  `);

  const fetch = async (who) =>
    JSON.parse(await actor(fixture[who], report, "aal2"));
  const initial = await fetch("admin");
  assert.equal(initial.operations.upcoming, 1);
  assert.equal(initial.operations.unstaffed, 1);
  assert.equal(initial.operations.assigned_minutes, 0);
  assert.equal(initial.operations.unassigned_minutes, 90);
  assert.equal(initial.operations.attention, 1);
  const staffing = initial.operations.issues.find(
    (item) => item.code === "staffing",
  );
  assert.ok(staffing && !staffing.acknowledged);
  assert.equal(
    initial.operations.issues.filter((item) => item.code === "preparation")
      .length,
    1,
  );
  assert.equal(
    initial.operations.issues.some((item) => "meeting_url" in item),
    false,
  );
  assert.deepEqual(initial.receivables, { currencies: [], overdue: [] });
  assert.equal(
    initial.capacity.weeks.reduce((sum, week) => sum + week.free_minutes, 0),
    180,
  );
  assert.equal(initial.capacity.absences.length, 1);
  assert.equal(JSON.stringify(initial.capacity).includes("private"), false);

  const write = (value) =>
    actor(
      fixture.admin,
      `select public.acknowledge_training_issue(${id("course")},'staffing',${quoteSql(staffing.fingerprint)},${value})`,
      "aal2",
    );
  await write(true);
  await write(true);
  assert.equal(
    (await fetch("admin")).operations.issues.find(
      (item) => item.code === "staffing",
    ).acknowledged,
    true,
  );
  assert.equal(
    (await fetch("second")).operations.issues.find(
      (item) => item.code === "staffing",
    ).acknowledged,
    false,
  );
  await write(false);
  assert.equal(
    (await fetch("admin")).operations.issues.find(
      (item) => item.code === "staffing",
    ).acknowledged,
    false,
  );
  await assert.rejects(
    actor(fixture.lecturer, report, "aal2"),
    /permission|privilege/i,
  );
  await assert.rejects(
    actor(
      fixture.admin,
      "select public.training_control_center(current_date,current_date+120)",
      "aal2",
    ),
    /93 days/,
  );
  console.log(
    "PASS training period, coverage, deduplicated exceptions, scoped acknowledgements and authorisation",
  );
});
