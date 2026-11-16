/** Real isolated PostgreSQL checks for reviewed course building-block sources and run-backed offers. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { withTestDatabase, quoteSql as q } from "./testing/database.mjs";
import { renderCatalogueSql } from "./course-catalogue.mjs";

const catalogue = JSON.parse(
  readFileSync(new URL("../data/course-building-blocks.json", import.meta.url)),
);
await withTestDatabase("course_test", async ({ sql, actor }) => {
  const ids = Object.fromEntries(
    [
      "admin",
      "management",
      "lecturer",
      "participant",
      "client",
      "stranger",
    ].map((name) => [name, randomUUID()]),
  );
  await sql(`insert into auth.users(id,email) values ${Object.entries(ids)
    .map(([name, id]) => `(${q(id)},${q(`course-${name}@example.invalid`)})`)
    .join(",")};
  insert into public.user_roles(user_id,role) values ${Object.entries(ids)
    .map(
      ([name, id]) =>
        `(${q(id)},${q(name === "stranger" ? "participant" : name)})`,
    )
    .join(",")};`);
  /** Calls the business database API under the fixture's controlled identity/MFA claims. */
  const rpc = async (who, name, args = [], aal = "aal1") => {
    const invocation = `public.${name}(${args.map((v) => (v === null ? "null" : typeof v === "number" || typeof v === "boolean" ? String(v) : q(typeof v === "object" ? JSON.stringify(v) : v))).join(",")})`;
    const value = await actor(
      ids[who],
      ["client_requests", "commission_report"].includes(name)
        ? `select coalesce(jsonb_agg(x),'[]'::jsonb) from ${invocation} x`
        : `select ${invocation}`,
      aal,
    );
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  };
  await rpc("admin", "configure_compensation_policy", [31, 73, 0], "aal2");
  let count = 0;
  /** Counts and reports a case only after all of its assertions have completed successfully. */
  const check = async (name, action) => {
    await action();
    count++;
    console.log(`PASS ${name}`);
  };
  const block = catalogue.blocks.find((item) => item.code === "LPC3");
  const source = block.sources.find((item) => item.is_primary);
  let template, run, job;
  const org = randomUUID();
  const sourceTemplate = block.default_template_id;
  await sql(
    `insert into public.organisations(id,name) values(${q(org)},'Fictional course building-block Academy');insert into public.client_organisation_memberships(user_id,organisation_id) values(${q(ids.client)},${q(org)});`,
  );
  /** Plans a real course run from the referenced template rather than merely setting a screen state. */
  const createRun = async (templateId = template, offset = 0) => {
    const start = new Date(Date.now() + (100 + offset) * 86400000);
    start.setUTCHours(8, 0, 0, 0);
    return rpc(
      "admin",
      "save_course_run",
      [
        null,
        {
          template_id: templateId,
          organisation_id: org,
          time_zone: "Europe/Berlin",
          delivery_type: "online",
          venue: "Fictional private access",
          published: false,
          sessions: [0, 1].map((day) => ({
            starts_at: new Date(+start + day * 86400000).toISOString(),
            ends_at: new Date(
              +start + day * 86400000 + 6 * 3600000,
            ).toISOString(),
          })),
        },
      ],
      "aal2",
    );
  };
  /** Creates terms tied to the exact source revision; the database must reject stale references. */
  const financial = (revision, gross = true) => ({
    source_revision: revision,
    ...(gross
      ? { gross_amount: 100.01, gross_total_amount: 200.02 }
      : { amount: 50, total_amount: 100 }),
    currency: "EUR",
    rate_unit: "per_day",
    terms: "Fictional complete-block terms",
    requires_contract: false,
    status: "published",
  });

  await check(
    "All 24 PDFs map to 22 distinct source-linked templates, preserving both LPC aliases",
    async () => {
      assert.equal(
        await sql("select count(*) from public.building_blocks"),
        "22",
      );
      assert.equal(
        await sql("select count(*) from public.building_block_sources"),
        "24",
      );
      assert.equal(
        await sql(
          "select count(*) from public.course_templates where building_block_id is not null",
        ),
        "22",
      );
      assert.equal(
        await sql(
          "select count(*) from public.building_block_sources where is_primary",
        ),
        "22",
      );
      assert.equal(
        await sql(
          `select file_name from public.building_block_sources where id=${q(source.id)}`,
        ),
        "Bausteinbeschreibung-LPIC3.pdf",
      );
      assert.equal(
        await sql(
          `select sha256 from public.building_block_sources where id=${q(source.id)}`,
        ),
        source.sha256,
      );
    },
  );
  await check(
    "Additive catalogue import is idempotent and never overwrites an edited template",
    async () => {
      await rpc(
        "admin",
        "save_course_template",
        [
          sourceTemplate,
          {
            title: "Fictional edited canonical template",
            description: "Edited content",
            syllabus: block.syllabus,
            prerequisites: block.prerequisites,
            topic_ids: [],
          },
        ],
        "aal2",
      );
      await sql(renderCatalogueSql(catalogue));
      assert.equal(
        await sql(
          `select title from public.course_templates where id=${q(sourceTemplate)}`,
        ),
        "Fictional edited canonical template",
      );
      assert.equal(
        await sql("select count(*) from public.building_blocks"),
        "22",
      );
      assert.equal(
        await sql("select count(*) from public.building_block_sources"),
        "24",
      );
    },
  );
  await check(
    "Staff can browse approved curriculum; unrelated learner/client/anonymous cannot",
    async () => {
      assert.equal(
        await actor(
          ids.lecturer,
          "select count(*) from public.building_blocks",
        ),
        "22",
      );
      assert.equal(
        await actor(
          ids.lecturer,
          "select count(*) from public.course_templates where building_block_id is not null",
        ),
        "22",
      );
      assert.equal(
        await actor(
          ids.participant,
          "select count(*) from public.building_blocks",
        ),
        "0",
      );
      assert.equal(
        await actor(ids.client, "select count(*) from public.building_blocks"),
        "0",
      );
      await assert.rejects(
        sql("set role anon;select * from public.building_blocks"),
        /permission denied/,
      );
      await assert.rejects(
        actor(ids.lecturer, "update public.building_blocks set title='Forged'"),
        /permission denied/,
      );
    },
  );
  await check(
    "Template copies retain exact source provenance and reject mismatched source/block IDs",
    async () => {
      template = await rpc(
        "admin",
        "duplicate_course_template",
        [sourceTemplate, "Fictional reusable course building-block course"],
        "aal2",
      );
      const copied = JSON.parse(
        await sql(
          `select to_jsonb(t) from public.course_templates t where id=${q(template)}`,
        ),
      );
      assert.equal(copied.building_block_id, block.id);
      assert.equal(copied.building_block_source_id, source.id);
      const other = catalogue.blocks.find((item) => item.code === "LPC4");
      await assert.rejects(
        sql(
          `update public.course_templates set building_block_source_id=${q(other.sources[0].id)} where id=${q(template)}`,
        ),
        /23503|source_matches_block/,
      );
      run = await createRun();
    },
  );
  await check(
    "Run defaults require actual management MFA and contain no financial values",
    async () => {
      await assert.rejects(
        rpc("admin", "course_run_job_defaults", [run]),
        /MFA required/,
      );
      await assert.rejects(
        rpc("lecturer", "course_run_job_defaults", [run], "aal2"),
        /MFA required/,
      );
      const defaults = await rpc(
        "admin",
        "course_run_job_defaults",
        [run],
        "aal2",
      );
      assert.equal(defaults.template_id, template);
      assert.equal(defaults.building_block_source_id, source.id);
      assert.equal(defaults.sessions.length, 2);
      assert.match(defaults.source_revision, /^[a-f0-9]{64}$/);
      assert.ok(!JSON.stringify(defaults).includes("gross_amount"));
      const zoned = await actor(
        ids.admin,
        `set local timezone='Australia/Brisbane';select public.course_run_job_defaults(${q(run)})->>'source_revision'`,
        "aal2",
      );
      assert.equal(zoned, defaults.source_revision);
    },
  );
  await check(
    "Changed source preview rejects creation instead of silently using edited content",
    async () => {
      const before = await rpc(
        "admin",
        "course_run_job_defaults",
        [run],
        "aal2",
      );
      await rpc(
        "admin",
        "save_course_template",
        [
          template,
          {
            title: "Fictional source updated after preview",
            description: "Changed before creating",
            syllabus: block.syllabus,
            prerequisites: block.prerequisites,
            topic_ids: [],
          },
        ],
        "aal2",
      );
      await assert.rejects(
        rpc(
          "admin",
          "create_course_run_job",
          [run, financial(before.source_revision), null, randomUUID()],
          "aal2",
        ),
        /course_run_source_changed/,
      );
      assert.equal(
        await sql(
          `select count(*) from public.jobs where course_run_id=${q(run)}`,
        ),
        "0",
      );
    },
  );
  let requestId, payload;
  await check(
    "A complete offer reuses the real run/customer/template/session IDs with private role-specific net rounding",
    async () => {
      const defaults = await rpc(
        "admin",
        "course_run_job_defaults",
        [run],
        "aal2",
      );
      const counts = await sql(
        "select (select count(*) from public.organisations)||','||(select count(*) from public.course_templates)||','||(select count(*) from public.course_runs)",
      );
      requestId = randomUUID();
      payload = financial(defaults.source_revision);
      job = await rpc(
        "admin",
        "create_course_run_job",
        [run, payload, null, requestId],
        "aal2",
      );
      assert.equal(
        await sql(`select course_run_id from public.jobs where id=${q(job)}`),
        run,
      );
      assert.equal(
        await sql(
          "select (select count(*) from public.organisations)||','||(select count(*) from public.course_templates)||','||(select count(*) from public.course_runs)",
        ),
        counts,
      );
      assert.equal(
        await sql(
          `select count(*) from public.job_sessions js join public.course_sessions cs on cs.id=js.course_session_id and cs.course_run_id=${q(run)} and cs.starts_at=js.starts_at and cs.ends_at=js.ends_at where js.job_id=${q(job)}`,
        ),
        "2",
      );
      assert.equal(
        await sql(
          `select amount||','||total_amount from public.jobs where id=${q(job)}`,
        ),
        "0.00,0.00",
      );
      assert.equal(
        await sql(
          `select count(*) from private.client_course_requests where job_id=${q(job)}`,
        ),
        "1",
      );
    },
  );
  await check(
    "Lost-response retry returns the same offer and changed operation keys cannot reuse it",
    async () => {
      assert.equal(
        await rpc(
          "admin",
          "create_course_run_job",
          [run, payload, null, requestId],
          "aal2",
        ),
        job,
      );
      await assert.rejects(
        rpc(
          "admin",
          "create_course_run_job",
          [run, { ...payload, gross_total_amount: 250 }, null, requestId],
          "aal2",
        ),
        /idempotency conflict/,
      );
      await assert.rejects(
        rpc(
          "admin",
          "create_course_run_job",
          [run, payload, null, randomUUID()],
          "aal2",
        ),
        /course_run_offer_exists/,
      );
      assert.equal(
        await sql(
          `select count(*) from public.jobs where course_run_id=${q(run)}`,
        ),
        "1",
      );
    },
  );
  await check(
    "Run/source/job linkage and exact source versions freeze after the first offer",
    async () => {
      const alias = block.sources.find((item) => !item.is_primary);
      await assert.rejects(
        sql(
          `update public.course_templates set building_block_source_id=${q(alias.id)} where id=${q(template)}`,
        ),
        /immutable/,
      );
      await assert.rejects(
        sql(
          `update public.course_runs set template_id=${q(sourceTemplate)} where id=${q(run)}`,
        ),
        /immutable/,
      );
      await assert.rejects(
        sql(`update public.jobs set course_run_id=null where id=${q(job)}`),
        /immutable/,
      );
      await assert.rejects(
        sql(
          `update public.building_block_sources set sha256=repeat('f',64) where id=${q(source.id)}`,
        ),
        /immutable/,
      );
      assert.equal(
        (await rpc("lecturer", "job_building_block_reference", [job]))
          .source_id,
        source.id,
      );
      await assert.rejects(
        rpc("participant", "job_building_block_reference", [job]),
        /unavailable/,
      );
    },
  );
  await check(
    "Client portal reports only the linked organisation full fee, never unknown net as gross",
    async () => {
      const requests = await rpc("client", "client_requests");
      assert.equal(requests.length, 1);
      assert.equal(requests[0].job_id, job);
      assert.equal(requests[0].gross_total_amount, 200.02);
      assert.equal(
        await actor(
          ids.client,
          `select count(*) from public.building_blocks where id=${q(block.id)}`,
        ),
        "0",
      );
      await sql(
        `update public.client_organisation_memberships set removed_at=now() where user_id=${q(ids.client)}`,
      );
      assert.deepEqual(await rpc("client", "client_requests"), []);
      assert.equal(
        await actor(ids.client, "select count(*) from public.building_blocks"),
        "0",
      );
    },
  );
  await check(
    "Management net offers cannot configure/read gross, and preserve unknown historical gross",
    async () => {
      const netRun = await createRun(template, 10);
      const preview = await rpc(
        "management",
        "course_run_job_defaults",
        [netRun],
        "aal2",
      );
      await assert.rejects(
        rpc(
          "management",
          "create_course_run_job",
          [netRun, financial(preview.source_revision), null, randomUUID()],
          "aal2",
        ),
        /Gross finance permission/,
      );
      const netJob = await rpc(
        "management",
        "create_course_run_job",
        [netRun, financial(preview.source_revision, false), null, randomUUID()],
        "aal2",
      );
      const report = await rpc("admin", "commission_report", [], "aal2");
      const row = report.find((item) => item.job_id === netJob);
      assert.equal(row.pricing_model, "legacy_net");
      assert.equal(row.gross_total_amount, null);
      assert.equal(row.lecturer_net_total_amount, 100);
      assert.equal(
        await sql(
          `select count(*) from private.client_course_requests where job_id=${q(netJob)}`,
        ),
        "0",
      );
      await assert.rejects(
        actor(
          ids.management,
          "select * from private.course_run_job_requests",
          "aal2",
        ),
        /permission denied/,
      );
    },
  );
  await check(
    "Two independent management actors racing one run create exactly one whole-block offer",
    async () => {
      const raceRun = await createRun(template, 20),
        preview = await rpc(
          "admin",
          "course_run_job_defaults",
          [raceRun],
          "aal2",
        );
      const attempts = await Promise.allSettled([
        rpc(
          "admin",
          "create_course_run_job",
          [raceRun, financial(preview.source_revision), null, randomUUID()],
          "aal2",
        ),
        rpc(
          "management",
          "create_course_run_job",
          [
            raceRun,
            financial(preview.source_revision, false),
            null,
            randomUUID(),
          ],
          "aal2",
        ),
      ]);
      assert.equal(
        attempts.filter((item) => item.status === "fulfilled").length,
        1,
      );
      assert.equal(
        await sql(
          `select count(*) from public.jobs where course_run_id=${q(raceRun)}`,
        ),
        "1",
      );
      assert.equal(
        await sql(
          `select count(*) from public.job_sessions where job_id in(select id from public.jobs where course_run_id=${q(raceRun)})`,
        ),
        "2",
      );
    },
  );
  await check(
    "Closed offer payload rejects forged source/schedule, malformed rates and missing/expired data",
    async () => {
      const invalidRun = await createRun(template, 30),
        preview = await rpc(
          "admin",
          "course_run_job_defaults",
          [invalidRun],
          "aal2",
        ),
        base = financial(preview.source_revision);
      for (const extra of [
        { title: "Forged source" },
        { sessions: [] },
        { source_revision: null },
        { gross_amount: "100" },
        { gross_amount: -1 },
        { currency: "USD" },
        { claim_deadline: "2037-01-01T09:00" },
        { claim_deadline: "2020-01-01T09:00:00Z" },
        { requires_contract: "false" },
      ])
        await assert.rejects(
          rpc(
            "admin",
            "create_course_run_job",
            [invalidRun, { ...base, ...extra }, null, randomUUID()],
            "aal2",
          ),
        );
      assert.equal(
        await sql(
          `select count(*) from public.jobs where course_run_id=${q(invalidRun)}`,
        ),
        "0",
      );
      await assert.rejects(
        rpc("admin", "create_course_run_job", [
          invalidRun,
          base,
          null,
          randomUUID(),
        ]),
        /MFA required/,
      );
    },
  );
  await check(
    "Enrolled learners read only their real source block and lose it on course revocation",
    async () => {
      await rpc(
        "admin",
        "manage_course_enrolment",
        [run, ids.participant, "enrolled"],
        "aal2",
      );
      assert.equal(
        await actor(
          ids.participant,
          "select count(*) from public.building_blocks",
        ),
        "1",
      );
      assert.equal(
        await actor(
          ids.stranger,
          "select count(*) from public.building_blocks",
        ),
        "0",
      );
      await rpc(
        "admin",
        "manage_course_enrolment",
        [run, ids.participant, "removed"],
        "aal2",
      );
      assert.equal(
        await actor(
          ids.participant,
          "select count(*) from public.building_blocks",
        ),
        "0",
      );
    },
  );
  await check(
    "Actual whole-block claim fixes lecturer compensation independently of later offer values",
    async () => {
      const version = Number(
        await actor(ids.lecturer, `select item->>'terms_version' from jsonb_array_elements(public.job_offers()) item where item->>'id'=${q(job)}`),
      );
      const claim = await rpc("lecturer", "claim_job", [
        job,
        randomUUID(),
        version,
      ]);
      assert.equal(claim.status, "confirmed");
      assert.equal(
        await sql(
          `select count(*) from public.assignment_sessions where claim_id=${q(claim.claim_id)}`,
        ),
        "2",
      );
      assert.equal(
        await sql(
          `select gross_total_amount||','||lecturer_net_total_amount from private.claim_revenue_ledger where claim_id=${q(claim.claim_id)}`,
        ),
        "200.02,62.01",
      );
      await sql(
        `update public.jobs set amount=7,total_amount=14 where id=${q(job)}`,
      );
      assert.equal(
        await sql(
          `select total_amount from public.job_claims where id=${q(claim.claim_id)}`,
        ),
        "62.01",
      );
      await assert.rejects(
        rpc("admin", "set_job_commission", [job, 900, 1800, null], "aal2"),
        /unaccepted offers/,
      );
    },
  );
  await check(
    "Suspended sessions lose catalogue/API access and every exposed table retains RLS",
    async () => {
      await sql(
        `update public.profiles set active=false where id=${q(ids.lecturer)}`,
      );
      assert.equal(
        await actor(
          ids.lecturer,
          "select count(*) from public.building_blocks",
        ),
        "0",
      );
      await assert.rejects(
        rpc("lecturer", "job_building_block_reference", [job]),
        /unavailable/,
      );
      assert.equal(
        await sql(
          "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity",
        ),
        "0",
      );
    },
  );
  console.log(
    `\n${count} course building-block curriculum/source/run-offer PostgreSQL checks passed.`,
  );
});
