/** Actor isolation, retry safety, review and recipient notification on a replayed schema. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

await withTestDatabase("removal_appeals", async ({ sql, actor }) => {
  const [manager, lecturer, stranger, job, claim] = Array.from(
    { length: 5 },
    randomUUID,
  );
  const users = [manager, lecturer, stranger];
  await sql(`
    insert into auth.users(id,email,email_confirmed_at)
      values ${users.map((id) => `(${q(id)},${q(id + "@example.invalid")},now())`).join(",")};
    insert into public.user_roles(user_id,role)
      values (${q(manager)},'admin'),(${q(lecturer)},'lecturer'),(${q(stranger)},'lecturer');
    insert into public.jobs(id,title,customer_name,delivery_type,status,amount,total_amount,currency,rate_unit,terms)
      values (${q(job)},'Fictional training block','Fictional College','online','draft',100,100,'EUR','fixed_total','Fictional allocation terms');
    insert into public.job_claims(id,job_id,lecturer_id,status,idempotency_key,amount,total_amount,currency,rate_unit,terms,terms_version)
      values (${q(claim)},${q(job)},${q(lecturer)},'cancelled',${q(randomUUID())},100,100,'EUR','fixed_total','Fictional terms',1);
    insert into public.audit_events(actor_id,action,resource_id,details)
      values (${q(manager)},'claim.cancelled',${q(claim)},'{"reason":"Fictional schedule changed"}');
    insert into public.notifications(user_id,kind,resource_id,read_at)
      values (${q(lecturer)},'claim_cancelled',${q(claim)},now());
  `);

  const submit = (user, reason) =>
    actor(
      user,
      `select public.submit_assignment_removal_appeal(${q(claim)},${q(reason)})`,
    );
  const review = (user, approved, reason) =>
    actor(
      user,
      `select public.review_assignment_removal_appeal(${q(claim)},${approved},${q(reason)})`,
    );
  const queue = async (user, pending) =>
    JSON.parse(
      await actor(user, `select public.assignment_removal_appeals(${pending})`),
    );
  const notice = async (user) =>
    JSON.parse(
      await actor(user, "select public.notification_inbox()"),
    ).items.find((item) => item.kind === "claim_cancelled");

  assert.equal((await notice(lecturer)).appeal_status, "available");
  assert.equal(await notice(stranger), undefined);
  await assert.rejects(() => submit(stranger, "Please review this"), /42501/);
  await assert.rejects(() => queue(lecturer, true), /42501/);
  await submit(lecturer, "Please review this");
  await submit(lecturer, "Please review this");
  await assert.rejects(() => submit(lecturer, "Different grounds"), /PT409/);
  assert.equal((await notice(lecturer)).appeal_status, "pending");
  const managerInbox = JSON.parse(
    await actor(manager, "select public.notification_inbox()"),
  );
  assert.equal(
    managerInbox.items.find(
      (item) => item.kind === "course_assignment_removal_appeal",
    )?.href,
    "/admin/assignments?view=appeals",
  );
  assert.equal(
    (await queue(manager, true))[0].removal_reason,
    "Fictional schedule changed",
  );
  await assert.rejects(
    () => review(lecturer, true, "Decision reason"),
    /42501/,
  );
  await review(manager, true, "Decision reason");
  await review(manager, true, "Decision reason");
  await assert.rejects(
    () => review(manager, false, "Different decision"),
    /PT409/,
  );
  assert.deepEqual(await queue(manager, true), []);
  assert.equal((await queue(manager, false))[0].decision, true);
  const decision = await notice(lecturer);
  assert.equal(decision.appeal_status, "approved");
  assert.equal(decision.appeal_decision_reason, "Decision reason");
  assert.equal(decision.read_at, null);
  assert.equal(decision.href, null);
  assert.equal(
    await sql(`select status from public.job_claims where id=${q(claim)}`),
    "cancelled",
  );
});
