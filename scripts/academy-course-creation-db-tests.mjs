/** Verify the existing course maker and exact-release write gate in both dedicated editions. */
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { setTimeout as wait } from "node:timers/promises";
import { z } from "zod";
import { academyOpenApi } from "../src/features/developer-api/academy-contract.ts";
import { prepareAcademyInstallation } from "./academy-installation.mjs";
import { signAcademyLicence } from "./academy-licence.mjs";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

const gate = (path, method = "POST") =>
  `set local request.path=${q(path)}; set local request.method=${q(method)};
    select public.require_portal_access();`;
const makePath = "/rpc/save_course_run";
const choicesPath = "/rpc/academy_course_draft_options";
const draftPath = "/rpc/academy_create_course_draft";

/** Wait for the configuration holder to reach its database barrier before submitting the write. */
async function waitForTransaction(sql, tag) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (
      (await sql(`select exists(select 1 from pg_stat_activity
      where datname=current_database() and application_name=${q(tag)}
        and wait_event='PgSleep')`)) === "t"
    )
      return;
    await wait(25);
  }
  throw new Error(
    "Fictional academy configuration transaction did not hold its barrier",
  );
}

for (const edition of ["customer-self-hosted", "customer-managed"]) {
  await withTestDatabase("academy_course_creation", async ({ sql, actor }) => {
    const [
      installation,
      manager,
      teacher,
      learner,
      org,
      template,
      archivedOrg,
      archivedTemplate,
    ] = Array.from({ length: 8 }, randomUUID);
    const key = generateKeyPairSync("ed25519");
    const now = Date.now();
    const date = (days) => new Date(now + days * 86400000).toISOString();
    const terms = {
      installation_id: installation,
      edition,
      release_commit: "ab".repeat(20),
      issued_at: date(-8),
      starts_at: date(-5),
      expires_at: date(20),
      grace_until: date(25),
      modules: ["lms"],
      limits: {
        seat_count: 20,
        storage_bytes: 2_000_000,
        api_requests_per_minute: 60,
      },
    };
    await prepareAcademyInstallation(
      {
        envelope: signAcademyLicence(terms, key.privateKey),
        publicKey: key.publicKey,
        expected: terms,
        now,
      },
      sql,
    );
    await sql(`insert into auth.users(id,email,email_confirmed_at) values
      (${q(manager)},'manager@example.invalid',now()),
      (${q(teacher)},'teacher@example.invalid',now()),
      (${q(learner)},'learner@example.invalid',now());
    insert into public.user_roles(user_id,role) values
      (${q(manager)},'management'),(${q(teacher)},'lecturer'),(${q(learner)},'participant');
    delete from public.role_permissions where role='management' and permission='jobs.manage';
    insert into public.organisations(id,name,archived_at) values
      (${q(org)},'Fictional Academy',null),(${q(archivedOrg)},'Archived Academy',now());
    insert into public.course_templates(id,title,archived_at) values
      (${q(template)},'Fictional Workshop',null),(${q(archivedTemplate)},'Archived Workshop',now());`);

    const sessions = [
      {
        starts_at: "2028-07-13T08:00:00+10:00",
        ends_at: "2028-07-13T09:00:00+10:00",
      },
      {
        starts_at: "2028-07-13T09:00:00+10:00",
        ends_at: "2028-07-13T10:00:00+10:00",
      },
    ];
    const payload = {
      organisation_id: org,
      template_id: template,
      time_zone: "Australia/Brisbane",
      delivery_type: "online",
      venue: "",
      sessions,
    };
    const saveSql = (changes = {}, id = null) =>
      `select public.save_course_run(${id ? q(id) : "null"}, ${q(JSON.stringify({ ...payload, ...changes }))}::jsonb)`;
    const save = (who, changes, id) =>
      actor(who, `${gate(makePath)} ${saveSql(changes, id)}`);
    const configure = (enabled, release = terms.release_commit) =>
      `select private.configure_academy_course_access(${q(installation)},${q(release)},${enabled})`;
    const renew = (changes) =>
      sql(
        `select private.apply_verified_installation_licence(${q(JSON.stringify({ ...terms, ...changes }))}::jsonb)`,
      );
    const choices = (who, orgSearch = "", templateSearch = "") =>
      actor(
        who,
        `${gate(choicesPath)} select coalesce(public.academy_course_draft_options(${q(orgSearch)},${q(templateSearch)})::text,'null')`,
      ).then(JSON.parse);
    const draftPayload = {
      time_zone: payload.time_zone,
      delivery_type: payload.delivery_type,
      venue: payload.venue,
      sessions,
    };
    const draftRequest = randomUUID();
    const draft = (
      who,
      {
        id = draftRequest,
        company = org,
        chosen = null,
        title = "Fictional reusable workshop",
        body = draftPayload,
      } = {},
    ) =>
      actor(
        who,
        `${gate(draftPath)} select public.academy_create_course_draft(${q(id)},${q(company)},${chosen === null ? "null" : q(chosen)},${title === null ? "null" : q(title)},${q(JSON.stringify(body))}::jsonb)`,
      ).then(JSON.parse);

    await assert.rejects(save(manager), /42501/);
    await assert.rejects(choices(manager), /42501/);
    await assert.rejects(draft(manager), /42501/);
    await assert.rejects(actor(manager, saveSql()), /42501/);
    await sql(configure(true));
    await assert.rejects(save(teacher), /42501/);
    await assert.rejects(save(learner), /42501/);
    await assert.rejects(actor(manager, gate(makePath, "GET")), /42501/);
    await assert.rejects(actor(manager, gate(makePath, "HEAD")), /42501/);
    await assert.rejects(actor(manager, gate("/course_runs")), /42501/);
    await assert.rejects(
      actor(manager, gate("/rpc/save_course_template")),
      /42501/,
    );
    await assert.rejects(
      actor(manager, gate("/rpc/create_course_run_job")),
      /42501/,
    );
    for (const role of ["anon", "service_role"]) {
      await assert.rejects(sql(`set role ${role}; ${saveSql()}`), /42501/);
    }

    // Input rejection rolls back the run, all previous session inserts and the audit entry.
    for (const invalid of [
      { sessions: undefined },
      { sessions: [] },
      { sessions: [sessions[0], sessions[0]] },
      { sessions: [sessions[0], { starts_at: sessions[1].starts_at }] },
      {
        sessions: [
          { starts_at: "2028-07-13T08:00:00", ends_at: sessions[0].ends_at },
        ],
      },
      { organisation_id: archivedOrg },
      { organisation_id: null },
      { template_id: archivedTemplate },
      { time_zone: "Not/AZone" },
      { published: true },
      { archived: true },
      { contact_id: randomUUID() },
    ]) {
      await assert.rejects(save(manager, invalid), /22023/);
      assert.equal(await sql("select count(*) from public.course_runs"), "0");
      assert.equal(
        await sql("select count(*) from public.course_sessions"),
        "0",
      );
    }
    const run = await save(manager);
    assert.match(run, /^[0-9a-f-]{36}$/);
    const workspace = (who) =>
      actor(
        who,
        `${gate("/rpc/course_workspace", "GET")} select public.course_workspace(${q(run)})`,
      ).then(JSON.parse);
    const saved = await workspace(manager);
    assert.equal(saved.id, run);
    assert.equal(saved.time_zone, payload.time_zone);
    assert.equal(saved.title, "Fictional Workshop");
    assert.deepEqual(
      saved.sessions.map(({ starts_at, ends_at }) => [
        Date.parse(starts_at),
        Date.parse(ends_at),
      ]),
      sessions.map(({ starts_at, ends_at }) => [
        Date.parse(starts_at),
        Date.parse(ends_at),
      ]),
    );
    await assert.rejects(workspace(teacher), /42501/);
    await assert.rejects(save(manager, {}, run), /42501/);
    await assert.rejects(actor(manager, saveSql({}, run)), /42501/);
    assert.equal(
      await sql(`select published from public.course_runs where id=${q(run)}`),
      "f",
    );
    assert.equal(await sql("select count(*) from public.jobs"), "0");
    assert.equal(
      await sql("select count(*) from private.academy_course_instructors"),
      "0",
    );
    assert.equal(
      await sql("select count(*) from public.assignment_sessions"),
      "0",
    );
    assert.equal(
      await sql("select count(*) from private.claim_revenue_ledger"),
      "0",
    );
    assert.equal(
      await sql(`select count(*) from public.audit_events
      where action='course.run.saved' and resource_id=${q(run)} and actor_id=${q(manager)}
        and details='{"created":true,"session_count":2}'::jsonb`),
      "1",
    );

    // A request can pass the REST precheck just before an operator closes the
    // profile. Hold that uncommitted closure until the writer waits on the
    // same lock, then verify the writer rechecks the configuration on wake.
    const holder = "academy-close-" + randomUUID().slice(0, 8);
    const writer = "academy-write-" + randomUUID().slice(0, 8);
    const close = sql(`begin; set local application_name=${q(holder)};
      ${configure(false)};
      do $barrier$ declare deadline timestamptz := clock_timestamp()+interval '10 seconds'; begin loop
        perform pg_stat_clear_snapshot();
        exit when exists(select 1 from pg_stat_activity where datname=current_database()
          and application_name=${q(writer)} and wait_event_type='Lock');
        if clock_timestamp()>deadline then raise exception 'Academy writer did not wait for profile lock'; end if;
        perform pg_sleep(0.03);
      end loop; end;$barrier$; commit;`);
    const rejected = close.then(
      () => null,
      (error) => error,
    );
    await waitForTransaction(sql, holder);
    await assert.rejects(
      actor(
        manager,
        `set local application_name=${q(writer)}; ${gate(makePath)} ${saveSql()}`,
      ),
      /42501/,
    );
    assert.equal(await rejected, null);
    await assert.rejects(save(manager), /42501/);
    await sql(configure(true));

    const nextRelease = "cd".repeat(20);
    await renew({ release_commit: nextRelease, issued_at: date(-7) });
    await assert.rejects(save(manager), /42501/);
    await assert.rejects(actor(manager, saveSql()), /42501/);
    await assert.rejects(choices(manager), /42501/);
    await assert.rejects(draft(manager), /42501/);
    await sql(configure(true, nextRelease));
    assert.equal((await workspace(manager)).id, run);
    await renew({
      release_commit: nextRelease,
      issued_at: date(-6),
      expires_at: date(-2),
    });
    assert.equal((await workspace(manager)).id, run);
    await assert.rejects(save(manager), /42501/);
    await assert.rejects(actor(manager, saveSql()), /42501/);
    await renew({
      release_commit: nextRelease,
      issued_at: date(-5),
      expires_at: date(-2),
      grace_until: date(-1),
    });
    await assert.rejects(save(manager), /42501/);
    await assert.rejects(workspace(manager), /42501/);
    assert.equal(await sql("select count(*) from public.course_runs"), "1");
    assert.equal(await sql("select count(*) from public.course_sessions"), "2");

    await renew({
      release_commit: nextRelease,
      issued_at: date(-4),
      starts_at: date(-3),
    });
    const specification = academyOpenApi("https://academy.example.invalid", {
      name: "Fictional Academy",
      installationId: installation,
      edition,
    });
    const validateResponse = (path, data) => {
      const schema =
        specification.paths["/rest/v1" + path].post.responses["200"].content[
          "application/json"
        ].schema;
      assert.equal(z.fromJSONSchema(schema).safeParse(data).success, true);
    };
    const catalogue = await choices(manager, "academy", "workshop");
    assert.deepEqual(catalogue, {
      organisations: [{ id: org, name: "Fictional Academy" }],
      templates: [{ id: template, title: "Fictional Workshop" }],
    });
    validateResponse(choicesPath, catalogue);
    assert.deepEqual(await choices(manager, "%", "%"), {
      organisations: [],
      templates: [],
    });
    for (const user of [learner, teacher]) {
      assert.equal(await choices(user), null);
      await assert.rejects(draft(user), /42501/);
    }
    await assert.rejects(actor(manager, gate(choicesPath, "GET")), /42501/);
    await assert.rejects(draft(manager, { company: archivedOrg }), /22023/);
    await assert.rejects(draft(manager, { chosen: template }), /22023/);
    await assert.rejects(
      draft(manager, { chosen: archivedTemplate, title: null }),
      /22023/,
    );
    await assert.rejects(
      draft(manager, {
        body: { ...draftPayload, sessions: [sessions[0], sessions[0]] },
      }),
      /22023/,
    );
    assert.equal(
      await sql(
        "select count(*) from public.course_templates where title='Fictional reusable workshop'",
      ),
      "0",
    );
    assert.equal(
      await sql("select count(*) from private.academy_course_draft_requests"),
      "0",
    );
    const [first, repeat] = await Promise.all([draft(manager), draft(manager)]);
    assert.deepEqual(repeat, first);
    validateResponse(draftPath, first);
    assert.equal(
      await sql(
        "select count(*) from public.course_templates where title='Fictional reusable workshop'",
      ),
      "1",
    );
    assert.equal(
      await sql(
        `select count(*) from public.course_sessions where course_run_id=${q(first.course_run_id)}`,
      ),
      "2",
    );
    await assert.rejects(
      draft(manager, { title: "Changed request title" }),
      /PT409/,
    );
    const fromExisting = await draft(manager, {
      id: randomUUID(),
      chosen: first.template_id,
      title: null,
    });
    assert.notEqual(fromExisting.course_run_id, first.course_run_id);
    assert.equal(fromExisting.template_id, first.template_id);
    const schedulePath = "/rpc/academy_draft_schedule";
    const revisePath = "/rpc/academy_save_draft_schedule";
    const schedule = (who = manager, course = first.course_run_id) =>
      actor(
        who,
        `${gate(schedulePath)} select coalesce(public.academy_draft_schedule(${q(course)})::text,'null')`,
      ).then(JSON.parse);
    const revise = (who, revision, changes) =>
      actor(
        who,
        `${gate(revisePath)} select public.academy_save_draft_schedule(${q(first.course_run_id)},${revision},${q(JSON.stringify(changes))}::jsonb)`,
      ).then(JSON.parse);
    const original = await schedule();
    validateResponse(schedulePath, original);
    assert.equal(original.revision, 1);
    const foreignSession = (await schedule(manager, fromExisting.course_run_id))
      .sessions[0];
    const change = {
      time_zone: "Australia/Brisbane",
      venue: "Fictional workshop room",
      delivery_type: "onsite",
      sessions: [
        {
          id: original.sessions[0].id,
          starts_at: "2028-07-14T08:00:00+10:00",
          ends_at: "2028-07-14T09:00:00+10:00",
        },
        {
          id: null,
          starts_at: "2028-07-14T10:00:00+10:00",
          ends_at: "2028-07-14T11:00:00+10:00",
        },
      ],
    };
    await assert.rejects(schedule(learner), /42501/);
    await assert.rejects(revise(teacher, 1, change), /42501/);
    await assert.rejects(
      revise(manager, 1, { ...change, sessions: [foreignSession] }),
      /22023/,
    );
    await assert.rejects(
      revise(manager, 1, {
        ...change,
        sessions: [change.sessions[0], change.sessions[0]],
      }),
      /22023/,
    );
    assert.deepEqual(await schedule(), original);
    const [updated, retry] = await Promise.all([
      revise(manager, 1, change),
      revise(manager, 1, change),
    ]);
    assert.deepEqual(retry, updated);
    assert.equal(updated.revision, 2);
    assert.equal(updated.sessions[0].id, original.sessions[0].id);
    assert.notEqual(updated.sessions[1].id, original.sessions[1].id);
    assert.equal(
      Date.parse(updated.sessions[1].starts_at),
      Date.parse(change.sessions[1].starts_at),
    );
    validateResponse(revisePath, updated);
    await assert.rejects(
      revise(manager, 1, { ...change, venue: "Conflicting room" }),
      /PT409/,
    );
    assert.equal(
      await sql(
        `select count(*) from public.audit_events where action='academy.course.schedule_updated' and resource_id=${q(first.course_run_id)}`,
      ),
      "1",
    );
    const historyPath = "/rpc/course_timeline";
    const history = (who) =>
      actor(who, `${gate(historyPath, "GET")} select public.course_timeline(${q(first.course_run_id)})`).then(JSON.parse);
    const milestones = await history(manager);
    validateResponse(historyPath, milestones);
    assert.equal(milestones.filter(({kind}) => kind === "schedule").length, 1);
    await assert.rejects(history(learner), /42501/);
    await sql(
      `update public.course_runs set published=true where id=${q(first.course_run_id)}`,
    );
    assert.equal(await schedule(), null);
    await assert.rejects(revise(manager, 2, change), /PT409/);
    assert.equal(
      await sql(
        `select venue from public.course_runs where id=${q(first.course_run_id)}`,
      ),
      change.venue,
    );
    await sql(
      `update public.course_runs set archived_at=now() where id=${q(first.course_run_id)}`,
    );
    await assert.rejects(draft(manager), /PT409/);
    assert.equal(await sql("select count(*) from public.jobs"), "0");
    console.log(
      `PASS ${edition} course creation and draft edits, stable session IDs, template reuse, exact retries, publication lock, grace and expiry`,
    );
  });
}
