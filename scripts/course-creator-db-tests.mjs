/** Exercise the actual RPC permissions, revisions and all-or-nothing course creation. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

await withTestDatabase("course_creator", async ({ sql, actor }) => {
  const [owner, other, learner, org, draft, copy] = Array.from({ length: 6 }, randomUUID);
  await sql(`
    insert into auth.users(id,email,email_confirmed_at)
    values ${[owner, other, learner].map((id) => `(${q(id)},${q(id + "@example.invalid")},now())`).join(",")};
    insert into public.user_roles(user_id,role) values
      (${q(owner)},'admin'),(${q(other)},'admin'),(${q(learner)},'participant');
    insert into public.organisations(id,name) values (${q(org)},'Fictional training organisation');
  `);

  const read = async (who, id = null) => JSON.parse(await actor(who,
    `select public.course_creator_drafts(${id ? q(id) : "null"})`));
  const action = async (who, requested, id, revision, body) => JSON.parse(await actor(who,
    `select public.course_creator_draft_action(${q(requested)},${q(id)},${revision},${q(JSON.stringify(body))}::jsonb)`));
  const snapshot = {
    run: {
      template_id: "", organisation_id: org, time_zone: "Australia/Brisbane",
      delivery_type: "online", venue: "", archived: false,
      sessions: [{ starts_at: "", ends_at: "" }],
    },
    content: {
      title: "Fictional creator course", description: "", syllabus: "",
      prerequisites: "", topic_ids: [], archived: false,
    },
  };

  await assert.rejects(() => read(learner), /42501/);
  assert.equal((await action(owner, "save", draft, 0, snapshot)).revision, 1);
  assert.equal((await action(owner, "save", draft, 0, snapshot)).revision, 1, "transport retry retains revision");
  assert.deepEqual(await read(other, draft), []);
  assert.equal((await read(owner))[0].payload, null, "listing does not expose full payload");
  assert.deepEqual((await read(owner, draft))[0].payload, snapshot);
  await assert.rejects(() => action(other, "save", draft, 0, snapshot), /42501/);
  await assert.rejects(() => actor(owner, "select * from private.course_creator_drafts"), /42501/);

  const changed = { ...snapshot, content: { ...snapshot.content, title: "Fictional revised title" } };
  assert.equal((await action(owner, "save", draft, 1, changed)).revision, 2);
  await assert.rejects(() => action(owner, "save", draft, 1, snapshot), /40001/);
  assert.equal((await action(owner, "duplicate", draft, 2, { new_id: copy })).id, copy);
  assert.equal((await action(owner, "duplicate", draft, 2, { new_id: copy })).id, copy);
  assert.deepEqual((await read(owner, copy))[0].payload, changed);
  await action(owner, "discard", copy, 1, {});
  assert.deepEqual(await read(owner, copy), []);

  const run = { ...changed.run };
  delete run.archived;
  const content = { ...changed.content };
  delete content.archived;
  const confirmation = { run, content, next_action: "offer" };
  await assert.rejects(() => action(owner, "create_course", draft, 2, confirmation), /22007|22023/);
  assert.equal(await sql(`select count(*) from public.course_templates where title = ${q(content.title)}`), "0",
    "failed course confirmation rolls back its template");
  assert.equal((await read(owner, draft))[0].state, "editing");
  run.sessions = [{ starts_at: "2037-11-19T09:00:00+10:00", ends_at: "2037-11-19T16:00:00+10:00" }];
  const completed = await action(owner, "create_course", draft, 2, confirmation);
  assert.equal(completed.state, "created");
  assert.equal(completed.next_action, "offer");
  assert.equal(completed.payload, null);
  assert.equal((await action(owner, "create_course", draft, 2, confirmation)).course_run_id, completed.course_run_id);
  assert.equal((await read(owner, draft))[0].course_run_id, completed.course_run_id);
  assert.equal(await sql(`select count(*) from public.course_sessions where course_run_id = ${q(completed.course_run_id)}`), "1");
  assert.equal(await sql(`select count(*) from public.jobs where course_run_id = ${q(completed.course_run_id)}`), "0",
    "the existing separate offer review still governs marketplace publication");
  assert.equal(await sql(`select published from public.course_runs where id = ${q(completed.course_run_id)}`), "f");
  const [
    companyActor,
    foreignActor,
    foreignOrg,
    companyTemplate,
    foreignTemplate,
    companyDraft,
  ] = Array.from({ length: 6 }, randomUUID);
  await sql(`
    insert into auth.users(id,email,email_confirmed_at)
    values ${[companyActor, foreignActor].map((id) => `(${q(id)},${q(id + "@example.invalid")},now())`).join(",")};
    insert into public.user_roles(user_id,role) values (${q(companyActor)},'client'),(${q(foreignActor)},'client');
    insert into public.organisations(id,name) values (${q(foreignOrg)},'Another fictional organisation');
    insert into public.client_organisation_memberships(user_id,organisation_id)
      values (${q(companyActor)},${q(org)}),(${q(foreignActor)},${q(foreignOrg)});
    insert into public.course_templates(id,title,owner_organisation_id)
      values (${q(companyTemplate)},'Company template',${q(org)}),(${q(foreignTemplate)},'Foreign template',${q(foreignOrg)});
  `);
  const companySnapshot = {
    ...snapshot,
    run: { ...snapshot.run, template_id: companyTemplate },
  };
  const foreignSnapshot = {
    ...snapshot,
    run: {
      ...snapshot.run,
      template_id: foreignTemplate,
      organisation_id: foreignOrg,
    },
  };
  await assert.rejects(
    action(companyActor, "save", companyDraft, 0, foreignSnapshot),
    /42501/,
  );
  const companyProgress = await action(
    companyActor,
    "save",
    companyDraft,
    0,
    companySnapshot,
  );
  assert.equal(companyProgress.course_run_id, null);
  assert.deepEqual(
    (await read(companyActor, companyDraft))[0].payload,
    companySnapshot,
  );
  assert.deepEqual(await read(foreignActor, companyDraft), []);
  await assert.rejects(
    action(foreignActor, "discard", companyDraft, 1, {}),
    /42501/,
  );
  const companyConfirmation = {
    run: { ...run, template_id: companyTemplate },
    content: null,
    next_action: "course",
  };
  await assert.rejects(
    action(companyActor, "create_course", companyDraft, 1, {
      ...companyConfirmation,
      next_action: "offer",
    }),
    /42501/,
  );
  await assert.rejects(
    action(companyActor, "create_course", companyDraft, 1, {
      ...companyConfirmation,
      content,
    }),
    /42501/,
  );
  const companyCourse = await action(
    companyActor,
    "create_course",
    companyDraft,
    1,
    companyConfirmation,
  );
  assert.deepEqual(
    await action(
      companyActor,
      "create_course",
      companyDraft,
      1,
      companyConfirmation,
    ),
    companyCourse,
  );
  assert.equal(
    await sql(
      `select published from public.course_runs where id = ${q(companyCourse.course_run_id)}`,
    ),
    "f",
  );
  assert.equal(
    await sql(
      `select count(*) from public.jobs where course_run_id = ${q(companyCourse.course_run_id)}`,
    ),
    "0",
  );
  await sql(
    `update public.client_organisation_memberships set removed_at = now() where user_id = ${q(companyActor)}`,
  );
  assert.deepEqual(await read(companyActor, companyDraft), []);
  await assert.rejects(
    action(companyActor, "create_course", companyDraft, 1, companyConfirmation),
    /42501/,
  );
  console.log("Course creator SQL checks passed.");
});
