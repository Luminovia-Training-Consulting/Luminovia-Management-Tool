/** Verify multi-course assignment against migrated PostgreSQL and current role checks. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

await withTestDatabase("company_participant_batch", async ({ sql, actor }) => {
  const [admin, company, outsider, learner, unlinked, org, foreign] =
    Array.from({ length: 7 }, randomUUID);
  const users = [admin, company, outsider, learner, unlinked];
  const roles = ["admin", "client", "client", "participant", "participant"];
  const [template, literalTemplate, room] = Array.from(
    { length: 3 },
    randomUUID,
  );
  const [
    first,
    second,
    removed,
    existing,
    completed,
    draft,
    archived,
    past,
    empty,
    other,
  ] = Array.from({ length: 10 }, randomUUID);
  await sql(`insert into auth.users(id,email,email_confirmed_at)
    values ${users.map((id) => `(${q(id)},${q(id + "@example.invalid")},now())`).join(",")};
    insert into public.user_roles(user_id,role)
    values ${users.map((id, i) => `(${q(id)},${q(roles[i])})`).join(",")};
    insert into public.organisations(id,name) values
      (${q(org)},'Fictional training company'),(${q(foreign)},'Fictional unrelated company');
    insert into public.client_organisation_memberships(user_id,organisation_id)
    values (${q(company)},${q(org)}),(${q(outsider)},${q(foreign)});
    insert into public.course_templates(id,title) values
      (${q(template)},'Foundations Workshop'),(${q(literalTemplate)},'Review 100% Complete');
    insert into public.course_runs(id,organisation_id,template_id,time_zone,published,archived_at) values
      (${q(first)},${q(org)},${q(template)},'Australia/Brisbane',true,null),
      (${q(second)},${q(org)},${q(literalTemplate)},'Europe/Berlin',true,null),
      (${q(removed)},${q(org)},${q(template)},'Europe/Berlin',true,null),
      (${q(existing)},${q(org)},${q(template)},'Europe/Berlin',true,null),
      (${q(completed)},${q(org)},${q(template)},'Europe/Berlin',true,null),
      (${q(draft)},${q(org)},${q(template)},'Europe/Berlin',false,null),
      (${q(archived)},${q(org)},${q(template)},'Europe/Berlin',true,now()),
      (${q(past)},${q(org)},${q(template)},'Europe/Berlin',true,null),
      (${q(empty)},${q(org)},${q(template)},'Europe/Berlin',true,null),
      (${q(other)},${q(foreign)},${q(template)},'Europe/Berlin',true,null);
    insert into public.course_sessions(course_run_id,starts_at,ends_at)
    select run_id, now()+make_interval(days => day), now()+make_interval(days => day, hours => 1)
    from (values ${[
      [first, 2],
      [first, 5],
      [second, 3],
      [removed, 4],
      [existing, 1],
      [completed, -2],
      [draft, 1],
      [archived, 1],
      [past, -1],
      [other, 1],
    ]
      .map(([run, day]) => `(${q(run)}::uuid,${day})`)
      .join(",")}) fixture(run_id,day);
    insert into public.chat_rooms(id,kind,course_run_id,title,owner_id)
    values (${q(room)},'participant_course',${q(first)},'Fictional course room',${q(admin)});`);

  const invoke = async (who, expression) =>
    JSON.parse(await actor(who, `select ${expression}`));
  const pick = (
    who = company,
    target = learner,
    search = "",
    limit = 30,
    offset = 0,
  ) =>
    invoke(
      who,
      `public.company_participant_assignable_courses(${q(org)},${q(target)},${q(search)},${limit},${offset})`,
    );
  const assign = (who, ids, target = learner) =>
    invoke(
      who,
      `public.assign_company_participant_courses(${q(org)},${q(target)},array[${ids.map((id) => (id === null ? "null" : q(id))).join(",")}]::uuid[])`,
    );
  const setPremium = (enabled, version) =>
    invoke(
      admin,
      `public.set_company_premium(${q(org)},${enabled},${version},${q(randomUUID())})`,
    );
  const statuses = async () =>
    JSON.parse(
      await sql(`select coalesce(jsonb_object_agg(course_run_id,status),'{}')
      from public.course_enrolments where user_id=${q(learner)}`),
    );
  const changedCount = () =>
    sql(`select count(*) from private.company_participant_activity
      where organisation_id=${q(org)} and kind='course_enrolment_changed'`);

  await assert.rejects(pick(), /42501/);
  await assert.rejects(assign(company, [first]), /42501/);
  await setPremium(true, 0);
  const publicId = await sql(
    `select luminovia_user_id from public.profiles where id=${q(learner)}`,
  );
  await invoke(
    company,
    `public.request_company_participant_link(${q(org)},${q(publicId)},${q(randomUUID())})`,
  );
  await assert.rejects(pick(), /42501/);
  await invoke(
    learner,
    `public.accept_company_participant_invitation(${q(org)},1,${q(randomUUID())})`,
  );
  await sql(`insert into public.course_enrolments(course_run_id,user_id,status,enrolled_by)
    values (${q(existing)},${q(learner)},'enrolled',${q(company)}),
      (${q(completed)},${q(learner)},'completed',${q(company)}),
      (${q(removed)},${q(learner)},'removed',${q(company)});`);

  for (const who of [learner, outsider]) {
    await assert.rejects(pick(who), /42501/);
    await assert.rejects(assign(who, [first]), /42501/);
  }
  await assert.rejects(pick(company, unlinked), /42501/);
  await assert.rejects(assign(company, [first], unlinked), /42501/);
  await assert.rejects(pick(company, learner, "x".repeat(201)), /22023/);
  await assert.rejects(pick(company, learner, "", 101), /22023/);
  await assert.rejects(pick(company, learner, "", 1, -1), /22023/);
  const page = await pick(company, learner, "", 2);
  assert.equal(page.has_more, true);
  assert.deepEqual(
    page.items.map(({ run_id }) => run_id),
    [first, second],
  );
  assert.deepEqual(Object.keys(page.items[0]).sort(), [
    "ends_at",
    "run_id",
    "starts_at",
    "time_zone",
    "title",
  ]);
  assert.equal(page.items[0].time_zone, "Australia/Brisbane");
  assert.equal(
    Date.parse(page.items[0].ends_at) - Date.parse(page.items[0].starts_at),
    73 * 60 * 60 * 1000,
  );
  const lastPage = await pick(company, learner, "", 2, 2);
  assert.equal(lastPage.has_more, false);
  assert.deepEqual(
    lastPage.items.map(({ run_id }) => run_id),
    [removed],
  );
  assert.deepEqual(
    (await pick(admin, learner, "  fOuNDATiONS  ")).items.map(
      ({ run_id }) => run_id,
    ),
    [first, removed],
  );
  assert.deepEqual(
    (await pick(company, learner, "%")).items.map(({ run_id }) => run_id),
    [second],
  );
  assert.deepEqual(await pick(company, learner, "no results"), {
    items: [],
    has_more: false,
  });

  const before = await statuses();
  for (const invalid of [
    [],
    [first, first],
    [first, null],
    Array.from({ length: 51 }, randomUUID),
  ]) {
    await assert.rejects(assign(company, invalid), /22023/);
  }
  for (const stale of [draft, archived, past, empty, other, randomUUID()]) {
    await assert.rejects(
      assign(company, [first, stale]),
      /PT409.*Course selection changed/,
    );
    assert.deepEqual(await statuses(), before);
  }
  assert.equal(
    await sql(
      `select count(*) from public.chat_members where room_id=${q(room)} and user_id=${q(learner)}`,
    ),
    "0",
  );

  const activityBefore = Number(await changedCount());
  const receipts = await Promise.all([
    assign(company, [removed, first, completed, existing, second]),
    assign(admin, [second, existing, completed, first, removed]),
  ]);
  const confirmed = [first, second, removed].sort();
  assert.deepEqual(
    receipts.find(({ enrolled }) => enrolled.length),
    {
      enrolled: confirmed,
      unchanged: [completed, existing].sort(),
    },
  );
  assert.deepEqual(
    receipts.find(({ enrolled }) => !enrolled.length),
    {
      enrolled: [],
      unchanged: [completed, existing, ...confirmed].sort(),
    },
  );
  assert.deepEqual(await statuses(), {
    [completed]: "completed",
    [existing]: "enrolled",
    [first]: "enrolled",
    [second]: "enrolled",
    [removed]: "enrolled",
  });
  assert.equal(Number(await changedCount()), activityBefore + 3);
  assert.deepEqual(await pick(), { items: [], has_more: false });
  assert.equal(
    await sql(`select count(*) from public.chat_members
      where room_id=${q(room)} and user_id=${q(learner)} and removed_at is null`),
    "1",
  );

  await sql(
    `update public.course_runs set published=false where id=${q(first)};`,
  );
  assert.deepEqual(await assign(company, [first]), {
    enrolled: [],
    unchanged: [first],
  });
  await setPremium(false, 1);
  await assert.rejects(pick(), /42501/);
  await assert.rejects(assign(company, [first]), /42501/);
  for (const role of ["anon", "service_role"]) {
    for (const signature of [
      "public.company_participant_assignable_courses(uuid,uuid,text,integer,integer)",
      "public.assign_company_participant_courses(uuid,uuid,uuid[])",
    ]) {
      assert.equal(
        await sql(
          `select has_function_privilege(${q(role)},${q(signature)},'execute')`,
        ),
        "f",
      );
    }
  }
  console.log(
    "PASS company-scoped course search, atomic assignments, concurrent retries, retained completion and chat synchronization",
  );
});
