/** Real isolated PostgreSQL intake, permissions, idempotency and conversion. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { withTestDatabase, quoteSql as q } from "./testing/database.mjs";
await withTestDatabase("enquiries_test", async ({ sql, actor }) => {
  const manager = randomUUID(),
    admin = randomUUID(),
    lecturer = randomUUID(),
    client = randomUUID();
  await sql(
    `insert into auth.users(id,email) values ${[manager, admin, lecturer, client].map((id) => `('${id}','${id}@example.invalid')`).join(",")};insert into public.user_roles values('${manager}','management'),('${admin}','admin'),('${lecturer}','lecturer'),('${client}','client')`,
  );
  const payload = {
    company_name: "Fictional Training Company",
    contact_name: "Fictional Contact",
    email: "contact@example.invalid",
    phone: "",
    topic: "Fictional network course",
    message: "Please review this fictional enquiry. <script>literal</script>",
    preferred_dates: "Next month",
    duration: "2 days",
    delivery_type: "online",
    time_zone: "Europe/Berlin",
    locale: "en",
    privacy_notice_version: "fictional-v1",
    consent: true,
  };
  const sender = "a".repeat(64),
    otherSender = "b".repeat(64),
    submission = randomUUID();
  const receive = (body = payload, key = submission, hash = sender) =>
    sql(
      `set role service_role;select public.receive_website_enquiry(${q(hash)},'${key}',${q(JSON.stringify(body))}::jsonb)`,
    );
  const detail = (who, id, aal = "aal2") =>
    actor(who, `select public.enquiry_detail('${id}')`, aal).then(JSON.parse);
  const manage = (
    who,
    id,
    action,
    body,
    version,
    key = randomUUID(),
    aal = "aal2",
  ) =>
    actor(
      who,
      `select public.manage_enquiry('${id}',${q(action)},${q(JSON.stringify(body))}::jsonb,${version},'${key}')`,
      aal,
    );
  let checks = 0;
  const check = async (name, fn) => {
    await fn();
    checks++;
    console.log(`PASS ${name}`);
  };
  let id;
  await check(
    "Only the server integration role can receive enquiries; anonymous/authenticated direct writes deny",
    async () => {
      for (const role of ["anon", "authenticated"])
        await assert.rejects(
          sql(
            `set role ${role};select public.receive_website_enquiry('${sender}','${submission}',${q(JSON.stringify(payload))})`,
          ),
          /permission denied/,
        );
      await assert.rejects(
        actor(lecturer, "select * from private.website_enquiries"),
        /permission denied/,
      );
    },
  );
  await check(
    "Simultaneous exact retries create one request, one receipt history and one notification per manager",
    async () => {
      const results = await Promise.all([receive(), receive(), receive()]);
      assert.equal(new Set(results).size, 1);
      id = results[0];
      assert.equal(
        await sql("select count(*) from private.website_enquiries"),
        "1",
      );
      assert.equal(
        await sql("select count(*) from private.website_enquiry_events"),
        "1",
      );
      assert.equal(
        await sql(
          `select count(*) from public.notifications where resource_id='${id}'`,
        ),
        "2",
      );
      await assert.rejects(
        receive({ ...payload, message: "Changed retry" }),
        /retry conflict/,
      );
    },
  );
  await check(
    "Validation rejects unknown identity fields, malformed contacts, missing consent and invalid time zones",
    async () => {
      for (const body of [
        { ...payload, role: "admin" },
        { ...payload, consent: false },
        { ...payload, company_name: "" },
        { ...payload, email: "x\n@bad.invalid" },
        { ...payload, time_zone: "not-a-zone" },
        { ...payload, message: [] },
      ])
        await assert.rejects(
          receive(body, randomUUID()),
          /Invalid website enquiry/,
        );
    },
  );
  await check(
    "Read/search/triage require current management capability and MFA; clients cannot query internal intake",
    async () => {
      for (const who of [lecturer, client]) {
        await assert.rejects(detail(who, id), /management and MFA required/);
        await assert.rejects(
          actor(who, "select public.enquiry_inbox()", "aal2"),
          /management and MFA required/,
        );
      }
      await assert.rejects(
        detail(manager, id, "aal1"),
        /management and MFA required/,
      );
      assert.equal(
        (await detail(manager, id)).payload.message,
        payload.message,
      );
      const page = JSON.parse(
        await actor(
          manager,
          "select public.enquiry_inbox('Fictional')",
          "aal2",
        ),
      );
      assert.equal(page.items[0].id, id);
      assert.equal(JSON.stringify(page).includes(payload.email), false);
    },
  );
  await check(
    "Sender-scoped persisted limits survive retries and do not trust submitted network headers",
    async () => {
      for (let index = 1; index < 10; index++)
        await receive(
          { ...payload, topic: `Fictional ${index}` },
          randomUUID(),
        );
      await assert.rejects(
        receive({ ...payload, topic: "Overflow" }, randomUUID()),
        /rate limit/,
      );
      assert.equal(
        await receive(),
        id,
        "Exact retries do not consume another rate slot",
      );
      assert.ok(
        await receive(
          { ...payload, topic: "Independent integration sender" },
          randomUUID(),
          otherSender,
        ),
      );
    },
  );
  await check(
    "Management can create one explicit customer/contact without replacing original enquiry input",
    async () => {
      const key = randomUUID();
      await manage(manager, id, "create_customer", {}, 1, key);
      await manage(manager, id, "create_customer", {}, 1, key);
      const enquiry = await detail(manager, id);
      assert.ok(enquiry.organisation_id);
      assert.deepEqual(enquiry.payload, payload);
      assert.equal(
        await sql(
          `select count(*) from public.organisation_contacts where organisation_id='${enquiry.organisation_id}'`,
        ),
        "1",
      );
      await assert.rejects(
        manage(manager, id, "create_customer", {}, 2),
        /already linked/,
      );
      await assert.rejects(
        manage(manager, id, "assign", { user_id: lecturer }, 2),
        /assignee unavailable/,
      );
      await manage(manager, id, "assign", { user_id: admin }, 2);
      await manage(
        manager,
        id,
        "status",
        { status: "reviewing", reason: "Fictional triage accepted" },
        3,
      );
    },
  );
  const starts = new Date(Date.now() + 60 * 86400000).toISOString(),
    ends = new Date(Date.now() + 60 * 86400000 + 3600000).toISOString();
  const conversion = {
    template_id: "",
    time_zone: "Europe/Berlin",
    delivery_type: "online",
    venue: "",
    sessions: [{ starts_at: starts, ends_at: ends }],
  };
  await check(
    "Failed conversion is transactional and cannot leave a template, run or changed enquiry",
    async () => {
      const templates = await sql(
          "select count(*) from public.course_templates",
        ),
        runs = await sql("select count(*) from public.course_runs");
      await assert.rejects(
        manage(
          manager,
          id,
          "convert",
          {
            ...conversion,
            sessions: [
              { starts_at: starts, ends_at: ends },
              { starts_at: starts, ends_at: ends },
            ],
          },
          4,
        ),
        /overlapping/,
      );
      assert.equal(
        await sql("select count(*) from public.course_templates"),
        templates,
      );
      assert.equal(await sql("select count(*) from public.course_runs"), runs);
      assert.equal((await detail(manager, id)).version, 4);
    },
  );
  await check(
    "Concurrent conversions produce one complete existing course run and reject the stale approver",
    async () => {
      const firstKey = randomUUID();
      const results = await Promise.allSettled([
        manage(manager, id, "convert", conversion, 4, firstKey),
        manage(admin, id, "convert", conversion, 4),
      ]);
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      assert.equal(
        results.filter(
          (r) =>
            r.status === "rejected" && /Enquiry changed/.test(r.reason.message),
        ).length,
        1,
      );
      const enquiry = await detail(manager, id);
      assert.equal(enquiry.status, "converted");
      assert.ok(enquiry.course_run_id);
      assert.equal(
        await sql(
          `select count(*) from public.course_sessions where course_run_id='${enquiry.course_run_id}'`,
        ),
        "1",
      );
      assert.equal(
        await sql(
          `select published from public.course_runs where id='${enquiry.course_run_id}'`,
        ),
        "f",
      );
      assert.deepEqual(enquiry.payload, payload);
      assert.equal(await receive(), id);
      assert.equal(
        await sql(`select count(*) from private.client_course_requests`),
        "0",
        "No invented commercial quote or accepted client request",
      );
      await assert.rejects(
        manage(
          manager,
          id,
          "link_customer",
          { organisation_id: enquiry.organisation_id },
          5,
        ),
        /preserved/,
      );
    },
  );
  await check(
    "Reasoned closure/reopening and append-only notes retain full management history",
    async () => {
      const second = await receive(
        { ...payload, topic: "Fictional follow-up" },
        randomUUID(),
        otherSender,
      );
      await manage(
        manager,
        second,
        "status",
        { status: "closed", reason: "Fictional duplicate reviewed" },
        1,
      );
      await manage(
        manager,
        second,
        "status",
        { status: "reviewing", reason: "Fictional reopening requested" },
        2,
      );
      await manage(
        manager,
        second,
        "note",
        { note: "Fictional clarification captured." },
        3,
      );
      const enquiry = await detail(admin, second);
      assert.equal(enquiry.history.length, 4);
      assert.equal(
        enquiry.history[3].reason,
        "Fictional clarification captured.",
      );
      await assert.rejects(
        actor(
          manager,
          "update private.website_enquiry_events set reason='overwrite'",
          "aal2",
        ),
        /permission denied/,
      );
    },
  );
  await check(
    "Current permission revocation and suspension deny retained-token enquiry reads and mutations",
    async () => {
      await sql(`delete from public.user_roles where user_id='${manager}'`);
      await assert.rejects(detail(manager, id), /management and MFA required/);
      await assert.rejects(
        manage(manager, id, "note", { note: "Denied" }, 5),
        /management and MFA required/,
      );
      await sql(`update public.profiles set active=false where id='${admin}'`);
      await assert.rejects(detail(admin, id), /management and MFA required/);
      for (const table of [
        "website_enquiries",
        "website_enquiry_events",
        "website_enquiry_requests",
      ])
        assert.equal(
          await sql(
            `select relrowsecurity from pg_class where oid='private.${table}'::regclass`,
          ),
          "t",
        );
    },
  );
  await check(
    "Strict PL/pgSQL diagnostics include every new implementation with no warnings or errors",
    async () => {
      await sql("create extension plpgsql_check with schema extensions");
      const functions = JSON.parse(
        await sql(
          "select jsonb_agg(p.oid::regprocedure::text order by p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname in ('receive_website_enquiry','enquiry_context','enquiry_inbox','enquiry_detail','manage_enquiry')",
        ),
      );
      assert.equal(functions.length, 5);
      for (const signature of functions) {
        const diagnostics = JSON.parse(
          await sql(
            `select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from extensions.plpgsql_check_function_tb(${q(signature)}::regprocedure) t`,
          ),
        );
        assert.deepEqual(
          diagnostics,
          [],
          `${signature}: ${JSON.stringify(diagnostics)}`,
        );
      }
    },
  );
  console.log(`\n${checks} website-enquiry PostgreSQL groups passed.`);
});
