/** Real isolated PostgreSQL checks for self-service whole-course cancellation. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

await withTestDatabase("participant_cancel", async ({ sql, actor }) => {
  const [
    admin,
    learner,
    other,
    template,
    early,
    late,
    unscheduled,
    manualRoom,
    derivedRoom,
  ] = Array.from({ length: 9 }, randomUUID);
  await sql(`insert into auth.users(id,email) values ${[admin, learner, other].map((id) => `(${q(id)},${q(id + "@example.invalid")})`).join(",")};
  insert into public.user_roles(user_id,role) values(${q(admin)},'admin'),(${q(learner)},'participant'),(${q(other)},'participant');
  insert into public.course_templates(id,title) values(${q(template)},'Fictional course');
  insert into public.course_runs(id,template_id) values(${q(early)},${q(template)}),(${q(late)},${q(template)}),(${q(unscheduled)},${q(template)});
  insert into public.course_sessions(course_run_id,starts_at,ends_at) values
   (${q(early)},clock_timestamp()+interval '8 days',clock_timestamp()+interval '8 days 1 hour'),
   (${q(early)},clock_timestamp()+interval '9 days',clock_timestamp()+interval '9 days 1 hour'),
   (${q(late)},clock_timestamp()+interval '6 days',clock_timestamp()+interval '6 days 1 hour');
  insert into public.course_enrolments(course_run_id,user_id,enrolled_by) values
   (${q(early)},${q(learner)},${q(admin)}),(${q(late)},${q(learner)},${q(admin)}),(${q(unscheduled)},${q(learner)},${q(admin)});
  insert into public.chat_rooms(id,kind,course_run_id,owner_id,title) values
   (${q(manualRoom)},'participant_course',${q(early)},${q(admin)},'Fictional course room');
  insert into public.chat_members(room_id,user_id) values(${q(manualRoom)},${q(learner)});
  insert into private.participant_chat_origins(room_id,user_id,manual) values(${q(manualRoom)},${q(learner)},true);`);
  await assert.rejects(() =>
    actor(other, `select public.cancel_own_course_enrolment(${q(early)})`),
  );
  await assert.rejects(() =>
    actor(learner, `select public.cancel_own_course_enrolment(${q(late)})`),
  );
  await assert.rejects(() =>
    actor(
      learner,
      `select public.cancel_own_course_enrolment(${q(unscheduled)})`,
    ),
  );
  assert.equal(
    await sql(
      `select status from public.course_enrolments where course_run_id=${q(late)} and user_id=${q(learner)}`,
    ),
    "enrolled",
  );
  await actor(
    learner,
    `select public.cancel_own_course_enrolment(${q(early)})`,
  );
  assert.equal(
    await sql(
      `select status from public.course_enrolments where course_run_id=${q(early)} and user_id=${q(learner)}`,
    ),
    "removed",
  );
  assert.equal(
    await sql(
      `select count(*) from public.course_sessions where course_run_id=${q(early)}`,
    ),
    "2",
  );
  assert.equal(
    await sql(
      `select count(*) from public.chat_members where room_id=${q(manualRoom)} and user_id=${q(learner)} and removed_at is null`,
    ),
    "1",
  );
  assert.equal(
    await sql(
      `select count(*) from public.audit_events where resource_id=${q(early)} and actor_id=${q(learner)} and details->>'self_cancelled'='true'`,
    ),
    "1",
  );
  await assert.rejects(() =>
    actor(learner, `select public.cancel_own_course_enrolment(${q(early)})`),
  );
  // Exercise both sides of the seven-day boundary without relying on a stale UI clock.
  const [justOpen, justClosed] = [randomUUID(), randomUUID()];
  await sql(`insert into public.course_runs(id,template_id) values(${q(justOpen)},${q(template)}),(${q(justClosed)},${q(template)});
   insert into public.course_sessions(course_run_id,starts_at,ends_at) values
    (${q(justOpen)},clock_timestamp()+interval '7 days 10 seconds',clock_timestamp()+interval '7 days 1 hour'),
    (${q(justClosed)},clock_timestamp()+interval '6 days 23 hours 59 minutes 59 seconds',clock_timestamp()+interval '7 days 1 hour');
   insert into public.course_enrolments(course_run_id,user_id,enrolled_by) values(${q(justOpen)},${q(learner)},${q(admin)}),(${q(justClosed)},${q(learner)},${q(admin)});`);
  await assert.rejects(() =>
    actor(
      learner,
      `select public.cancel_own_course_enrolment(${q(justClosed)})`,
    ),
  );
  await actor(
    learner,
    `select public.cancel_own_course_enrolment(${q(justOpen)})`,
  );
  const derivedRun = randomUUID();
  await sql(`insert into public.course_runs(id,template_id) values(${q(derivedRun)},${q(template)});
   insert into public.course_sessions(course_run_id,starts_at,ends_at) values(${q(derivedRun)},now()+interval '8 days',now()+interval '8 days 1 hour');
   insert into public.course_enrolments(course_run_id,user_id,enrolled_by) values(${q(derivedRun)},${q(learner)},${q(admin)});
   insert into public.chat_rooms(id,kind,course_run_id,owner_id,title) values(${q(derivedRoom)},'participant_course',${q(derivedRun)},${q(admin)},'Fictional derived room');
   insert into public.chat_members(room_id,user_id) values(${q(derivedRoom)},${q(learner)});
   insert into private.participant_chat_origins(room_id,user_id,assignment) values(${q(derivedRoom)},${q(learner)},true);`);
  await actor(
    learner,
    `select public.cancel_own_course_enrolment(${q(derivedRun)})`,
  );
  assert.equal(
    await sql(
      `select count(*) from public.chat_members where room_id=${q(derivedRoom)} and user_id=${q(learner)} and removed_at is not null`,
    ),
    "1",
  );
  console.log(
    "PASS participant course cancellation: ownership, deadline, unscheduled, complete block, audit and chat origins",
  );
});
