/** Actual UUID-database checks; no external services or default database writes. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { withTestDatabase, quoteSql as q } from "./testing/database.mjs";
let checks = 0;
await withTestDatabase("job_picker", async ({ sql, actor }) => {
  const admin = randomUUID(),
    teacher = randomUUID(),
    courseOnly = randomUUID(),
    filesOnly = randomUUID(),
    learner = randomUUID(),
    org = randomUUID(),
    template = randomUUID(),
    oldTemplate = randomUUID();
  await sql(
    `insert into auth.users(id,email)values${[admin, teacher, courseOnly, filesOnly, learner].map((id, i) => `('${id}','picker-${i}@example.invalid')`).join(",")};insert into public.user_roles(user_id,role)values('${admin}','admin'),('${teacher}','lecturer'),('${courseOnly}','participant'),('${filesOnly}','senior_lecturer'),('${learner}','client');insert into public.role_permissions(role,permission)values('participant','courses.manage'),('senior_lecturer','jobs.manage');insert into public.organisations(id,name)values('${org}','Fictional course organisation');insert into public.course_templates(id,title)values('${template}','Fictional generic course'),('${oldTemplate}','Older literal %_ course');insert into public.course_runs(id,template_id,organisation_id,created_at)select ('e8000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,case when n=1 then '${oldTemplate}'::uuid else '${template}'::uuid end,'${org}','2040-01-01T00:00:00Z'from generate_series(1,1057)n;insert into public.jobs(id,course_run_id,title,customer_name,delivery_type,status,amount,total_amount,currency,rate_unit,terms,created_at)select ('d8000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,case when n<=1057 then ('e8000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid when n>1060 then 'e8000000-0000-4000-8000-000000000001'::uuid else null end,case when n=1 then 'SECRET %_ job description'else 'Hidden commercial offer '||n end,'Hidden job customer','online',case when n%2=0 then 'draft'else 'archived'end,99,999,'EUR','fixed_total','Fictional private terms','2040-01-01T00:00:00Z'from generate_series(1,1062)n;`,
  );
  await sql(
    "insert into public.course_sessions(course_run_id,starts_at,ends_at)values('e8000000-0000-4000-8000-000000000001','2060-01-02T08:00:00Z','2060-01-02T10:00:00Z'),('e8000000-0000-4000-8000-000000000001','2060-01-01T08:00:00Z','2060-01-01T10:00:00Z');insert into public.job_sessions(job_id,starts_at,ends_at)values('d8000000-0000-4000-8000-000000000001','2060-01-01T08:00:00Z','2060-01-01T10:00:00Z')",
  );
  const picker = async (
    who,
    purpose,
    {
      search = "",
      cursor = null,
      limit = 100,
      selected = null,
      aal = "aal1",
    } = {},
  ) =>
    JSON.parse(
      await actor(
        who,
        `select public.job_picker(${q(purpose)},${q(search)},${cursor ? q(JSON.stringify(cursor)) + "::jsonb" : "null"},${limit},${selected ? q(selected) + "::uuid" : "null"})`,
        aal,
      ),
    );
  const check = async (name, run) => {
    await run();
    checks++;
    console.log("PASS " + name);
  };
  const all = async (purpose) => {
    let cursor = null,
      items = [];
    do {
      const page = await picker(admin, purpose, { cursor });
      assert.ok(page.items.length <= 100);
      assert.equal(page.has_more, Boolean(page.next_cursor));
      items.push(...page.items);
      cursor = page.next_cursor;
    } while (cursor);
    return items;
  };
  await check(
    "More than1000 equal-timestamp jobs and course runs page completely without duplicate course choices",
    async () => {
      const jobs = await all("job_attachment");
      assert.equal(jobs.length, 1062);
      assert.equal(new Set(jobs.map((j) => j.id)).size, 1062);
      assert.deepEqual(
        jobs.map((j) => j.id),
        jobs
          .map((j) => j.id)
          .sort()
          .reverse(),
      );
      const courses = await all("participant_course");
      assert.equal(courses.length, 1057);
      assert.equal(new Set(courses.map((j) => j.course_run_id)).size, 1057);
      assert.deepEqual(
        courses.map((j) => j.course_run_id),
        courses
          .map((j) => j.course_run_id)
          .sort()
          .reverse(),
      );
      assert.equal(courses.at(-1).id, "d8000000-0000-4000-8000-000000000001");
    },
  );
  await check(
    "Current purpose capability and permission govern choices independently of marketplace roles or job statuses",
    async () => {
      for (const who of [teacher, learner])
        for (const purpose of ["job_attachment", "participant_course"])
          await assert.rejects(picker(who, purpose), /42501/);
      for (const purpose of ["job_attachment", "participant_course"])
        assert.ok(
          Array.isArray((await picker(admin, purpose, { aal: "aal1" })).items),
        );
      assert.equal(
        (await picker(courseOnly, "participant_course")).items.length,
        100,
      );
      await assert.rejects(picker(courseOnly, "job_attachment"), /42501/);
      assert.equal(
        await actor(courseOnly, "select private.lecturer_actor()", "aal1"),
        "f",
      );
      assert.equal(
        (await picker(filesOnly, "job_attachment")).items.length,
        100,
      );
      await assert.rejects(picker(filesOnly, "participant_course"), /42501/);
    },
  );
  await check(
    "Course metadata never projects or searches hidden commercial job text and resolves a selected real job without N+1",
    async () => {
      const page = await picker(courseOnly, "participant_course", {
        search: "%_",
        selected: "d8000000-0000-4000-8000-000000001062",
      });
      assert.equal(page.items.length, 1);
      assert.equal(page.items[0].title, "Older literal %_ course");
      assert.equal(
        page.items[0].customer_name,
        "Fictional course organisation",
      );
      assert.equal(page.selected.id, "d8000000-0000-4000-8000-000000001062");
      assert.equal(page.selected.title, page.items[0].title);
      assert.equal(
        Date.parse(page.selected.starts_at),
        Date.parse("2060-01-01T08:00:00Z"),
      );
      assert.equal(page.selected.time_zone, "Europe/Berlin");
      assert.deepEqual(Object.keys(page.selected).sort(), [
        "course_run_id",
        "customer_name",
        "id",
        "starts_at",
        "time_zone",
        "title",
      ]);
      assert.equal(JSON.stringify(page).includes("SECRET"), false);
      assert.equal(
        (
          await picker(courseOnly, "participant_course", {
            search: "SECRET %_",
          })
        ).items.length,
        0,
      );
      assert.equal(
        (await picker(admin, "job_attachment", { search: "SECRET %_" })).items
          .length,
        1,
      );
      assert.equal(
        (await picker(admin, "job_attachment", { search: "SECRET %X" })).items
          .length,
        0,
      );
      assert.equal(
        (
          await picker(courseOnly, "participant_course", {
            selected: "d8000000-0000-4000-8000-000000001059",
          })
        ).selected,
        null,
      );
    },
  );
  await check(
    "Cursors bind literal search and purpose, complete finite tuples and bounded input",
    async () => {
      const first = await picker(admin, "job_attachment", { limit: 1 });
      await assert.rejects(
        picker(admin, "participant_course", { cursor: first.next_cursor }),
        /22023/,
      );
      await assert.rejects(
        picker(admin, "job_attachment", {
          cursor: first.next_cursor,
          search: "changed",
        }),
        /22023/,
      );
      for (const changes of [
        { id: null },
        { at: "infinity" },
        { at: "2040-01-01" },
        { unknown: true },
      ])
        await assert.rejects(
          picker(admin, "job_attachment", {
            cursor: { ...first.next_cursor, ...changes },
          }),
          /22023/,
        );
      await assert.rejects(
        picker(admin, "job_attachment", { limit: 101 }),
        /22023/,
      );
      await assert.rejects(
        picker(admin, "job_attachment", { search: "x".repeat(161) }),
        /22023/,
      );
      await assert.rejects(picker(admin, "marketplace"), /22023/);
    },
  );
  await check(
    "Selected IDs connect to existing whole upload/channel actions without weakening participant commercial privacy",
    async () => {
      const selected = (
        await picker(courseOnly, "participant_course", { search: "%_" })
      ).items[0];
      const room = await actor(
        courseOnly,
        `select public.create_chat_group('Fictional participant channel','{}'::uuid[],'participant_course','${selected.id}')`,
        "aal1",
      );
      assert.equal(
        await sql(
          `select course_run_id from public.chat_rooms where id='${room}'`,
        ),
        selected.course_run_id,
      );
      assert.equal(
        await sql(
          `select job_id is null from public.chat_rooms where id='${room}'`,
        ),
        "t",
      );
      await assert.rejects(
        actor(
          courseOnly,
          `select public.create_chat_group('Fictional duplicate','{}'::uuid[],'participant_course','d8000000-0000-4000-8000-000000001062')`,
          "aal1",
        ),
        /23505/,
      );
      const upload = JSON.parse(
        await actor(
          filesOnly,
          `select public.reserve_document('Fictional-picker.txt','text/plain',12,'job_after','material',null,'d8000000-0000-4000-8000-000000000001','${randomUUID()}',null,null)`,
          "aal1",
        ),
      );
      assert.equal(
        await sql(
          `select job_id from public.documents where id='${upload.document_id}'`,
        ),
        "d8000000-0000-4000-8000-000000000001",
      );
    },
  );
  await check(
    "Role withdrawal/suspension and anonymous/internal helper ACL remain authoritative",
    async () => {
      await actor(
        admin,
        `select public.set_account_roles('${courseOnly}',array['client'])`,
        "aal1",
      );
      await assert.rejects(picker(courseOnly, "participant_course"), /42501/);
      await actor(
        admin,
        `select public.set_user_active('${filesOnly}',false)`,
        "aal1",
      );
      await assert.rejects(picker(filesOnly, "job_attachment"), /42501/);
      assert.equal(
        await sql(
          "select has_function_privilege('authenticated','private.job_picker_candidates(text,text)','execute')",
        ),
        "f",
      );
      assert.equal(
        await sql(
          "select count(*)from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','private')and has_function_privilege('anon',p.oid,'execute') and p.oid <> to_regprocedure('public.require_portal_access()')",
        ),
        "0",
      );
    },
  );
});
console.log(`${checks} scoped job-picker PostgreSQL groups passed.`);
