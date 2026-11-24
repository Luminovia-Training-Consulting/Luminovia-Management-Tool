/** Real isolated PostgreSQL checks for reviewed course building-block sources and run-backed offers. */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import {setTimeout as delay} from "node:timers/promises";
import {quoteSql as q, withTestDatabase} from "./testing/database.mjs";
import {renderCatalogueSql} from "./course-catalogue.mjs";
import {assertLmsResponse} from "./testing/premium-lms-contract.mjs";
import {portalOpenApi} from "../src/features/developer-api/contract.ts";
import {z} from "zod";

const wire = portalOpenApi("https://portal.example.invalid").paths;
const reviewedArguments = {
    save_course_template: ([p_id, p_payload]) => ({p_id, p_payload}),
    course_run_job_defaults: ([p_course_run_id]) => ({p_course_run_id}),
    course_offer_publication_preview: ([p_job_id]) => ({p_job_id}),
    create_course_run_job: ([p_course_run_id, p_payload, p_platform_percent, p_client_id]) =>
        ({p_course_run_id, p_payload, p_platform_percent, p_client_id}),
    job_building_block_reference: ([p_job_id]) => ({p_job_id}),
};

const catalogue = JSON.parse(
    readFileSync(new URL("../data/course-building-blocks.json", import.meta.url)),
);
await withTestDatabase("course_test", async ({sql, actor}) => {
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
    await sql(`insert into auth.users(id, email)
               values ${Object.entries(ids)
        .map(([name, id]) => `(${q(id)},${q(`course-${name}@example.invalid`)})`)
        .join(",")};
  insert into public.user_roles(user_id,role) values ${Object.entries(ids)
        .map(
            ([name, id]) =>
                `(${q(id)},${q(name === "stranger" ? "participant" : name)})`,
        )
        .join(",")};`);
    /** Calls the business database API under the fixture's controlled identity/permission claims. */
    const rpc = async (who, name, args = [], aal = "aal1") => {
        const invocation = `public.${name}(${args.map((v) => (v === null ? "null" : typeof v === "number" || typeof v === "boolean" ? String(v) : q(typeof v === "object" ? JSON.stringify(v) : v))).join(",")})`;
        const value = await actor(
            ids[who],
            ["client_requests", "commission_report"].includes(name)
                ? `select coalesce(jsonb_agg(x),'[]'::jsonb) from ${invocation} x`
                : Object.hasOwn(reviewedArguments, name)
                    ? `select coalesce(to_jsonb(${invocation}), 'null'::jsonb)`
                    : `select ${invocation}`,
            aal,
        );
        if (Object.hasOwn(reviewedArguments, name)) {
            const result = JSON.parse(value);
            const schema = wire[`/rest/v1/rpc/${name}`].post.requestBody.content["application/json"].schema;
            const parsed = z.fromJSONSchema(schema).safeParse(reviewedArguments[name](args));
            assert.ok(parsed.success, `${name} successful request: ${parsed.error?.message}`);
            assertLmsResponse(name, result);
            return result;
        }
        try {
            return JSON.parse(value);
        } catch {
            return value;
        }
    };
    await rpc("admin", "configure_compensation_policy", [31, 73, 0], "aal1");
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
    await rpc("admin", "set_company_premium", [org, true, 0, randomUUID()]);
    /** Plans a real course run from the referenced template rather than merely setting a screen state. */
    const createRun = async (templateId = template, offset = 0, author = "admin") => {
        const start = new Date(Date.now() + (100 + offset) * 86400000);
        start.setUTCHours(8, 0, 0, 0);
        return rpc(
            author,
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
            "aal1",
        );
    };
    /** Creates terms tied to the exact source revision; the database must reject stale references. */
    const financial = (revision, gross = true) => ({
        source_revision: revision,
        ...(gross
            ? {gross_amount: 100.01, gross_total_amount: 200.02}
            : {amount: 50, total_amount: 100}),
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
                "aal1",
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
        "Only course managers can browse the full reusable curriculum",
        async () => {
            assert.equal(
                await actor(
                    ids.management,
                    "select count(*) from public.building_blocks",
                ),
                "22",
            );
            assert.equal(
                await actor(
                    ids.management,
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
                "aal1",
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
        "Run defaults require actual management permission and contain no financial values",
        async () => {
            await assert.rejects(
                rpc("lecturer", "course_run_job_defaults", [run], "aal1"),
                /required/i,
            );
            const defaults = await rpc(
                "admin",
                "course_run_job_defaults",
                [run],
                "aal1",
            );
            assert.equal(defaults.template_id, template);
            assert.equal(defaults.building_block_source_id, source.id);
            assert.equal(defaults.sessions.length, 2);
            assert.match(defaults.source_revision, /^[a-f0-9]{64}$/);
            assert.ok(!JSON.stringify(defaults).includes("gross_amount"));
            const zoned = await actor(
                ids.admin,
                `set local timezone='Australia/Brisbane';select public.course_run_job_defaults(${q(run)})->>'source_revision'`,
                "aal1",
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
                "aal1",
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
                "aal1",
            );
            await assert.rejects(
                rpc(
                    "admin",
                    "create_course_run_job",
                    [run, financial(before.source_revision), null, randomUUID()],
                    "aal1",
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
                "aal1",
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
                "aal1",
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
        "Identical retries reuse the offer, and a fresh key creates another offer without terms",
        async () => {
            assert.equal(
                await rpc(
                    "admin",
                    "create_course_run_job",
                    [run, payload, null, requestId],
                    "aal1",
                ),
                job,
            );
            await assert.rejects(
                rpc(
                    "admin",
                    "create_course_run_job",
                    [run, {...payload, gross_total_amount: 250}, null, requestId],
                    "aal1",
                ),
                /idempotency conflict/,
            );
            const optionalPayload = Object.fromEntries(
                Object.entries(payload).filter(([key]) => key !== "terms"),
            );
            const anotherId = randomUUID();
            const another = await rpc(
                "admin", "create_course_run_job", [run, optionalPayload, null, anotherId], "aal1",
            );
            assert.notEqual(another, job);
            assert.equal(await sql(`select length(terms) from public.jobs where id=${q(another)}`), "0");
            assert.equal(
                await rpc("admin", "create_course_run_job", [run, optionalPayload, null, anotherId], "aal1"),
                another,
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
    await check("Linked run venue and visibility can change while job and session references stay intact", async () => {
        const before = await rpc("admin", "course_run_job_defaults", [run], "aal1");
        const runPayload = {
            template_id: template,
            organisation_id: org,
            time_zone: before.time_zone,
            delivery_type: before.delivery_type,
            venue: "Updated fictional course access",
            published: true,
            sessions: before.sessions.map(({starts_at, ends_at}) => ({starts_at, ends_at})),
        };
        assert.equal(await rpc("admin", "save_course_run", [run, runPayload], "aal1"), run);
        const after = await rpc("admin", "course_run_job_defaults", [run], "aal1");
        assert.equal(after.location, runPayload.venue);
        assert.deepEqual(after.sessions, before.sessions);
        assert.equal(await sql(`select location from public.jobs where id=${q(job)}`), before.location);
        await assert.rejects(
            rpc("admin", "save_course_run", [run, {...runPayload, sessions: runPayload.sessions.slice(0, 1)}], "aal1"),
            /course_locked/,
        );
        await assert.rejects(
            rpc("admin", "save_course_run", [run, {...runPayload, archived: true}], "aal1"),
            /course_locked/,
        );
    });
    await check("Company template library exposes only its own drafts and rejects foreign run links", async () => {
        const otherOrg = randomUUID();
        const otherClient = randomUUID();
        await sql(`insert into public.organisations(id,name) values(${q(otherOrg)},'Fictional second company');
          insert into auth.users(id,email) values(${q(otherClient)},'template-peer@example.invalid');
          insert into public.user_roles(user_id,role) values(${q(otherClient)},'client');
          insert into public.client_organisation_memberships(user_id,organisation_id)
          values(${q(otherClient)},${q(otherOrg)});`);
        const own = await rpc("admin", "save_course_template", [
            null, {title: "Fictional company-only template", owner_organisation_id: org},
        ], "aal1");
        const countTemplates = (user) => actor(user, `select count(*) from public.course_templates where id=${q(own)}`);
        assert.equal(await countTemplates(ids.client), "1");
        assert.equal(await countTemplates(otherClient), "0");
        assert.equal(await countTemplates(ids.management), "1");
        const plannedRun = await createRun(own, 14);
        const readDraft = (user) => actor(user, `select count(*) from public.course_runs
            where id=${q(plannedRun)} and organisation_id=${q(org)} and not published`);
        assert.equal(await readDraft(ids.admin), "1");
        assert.equal(await readDraft(ids.management), "1");
        assert.equal(await readDraft(ids.client), "1");
        assert.equal(await readDraft(otherClient), "0");
        const companyRun = await createRun(own, 15, "client");
        const readOrigin = (user, course) =>
            actor(user, `select creation_origin from public.course_runs where id=${q(course)}`);
        assert.equal(await readOrigin(ids.management, plannedRun), "staff");
        assert.equal(await readOrigin(ids.management, companyRun), "company");
        assert.equal(await readOrigin(ids.admin, companyRun), "company");
        assert.equal(await readOrigin(otherClient, companyRun), "");
        await sql(`update public.course_runs set creation_origin='staff' where id=${q(companyRun)}`);
        assert.equal(await readOrigin(ids.admin, companyRun), "company");
        await assert.rejects(
            sql(`insert into public.course_runs(template_id,organisation_id) values(${q(own)},${q(otherOrg)})`),
            /belongs to another company/,
        );
    });
    await check(
        "Client portal sees the linked course and original company fee until membership is withdrawn",
        async () => {
            const requests = await rpc("client", "client_requests");
            assert.equal(requests.length, 2);
            assert.equal(requests.find((request) => request.job_id === job).gross_total_amount, 200.02);
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
                "aal1",
            );
            await assert.rejects(
                rpc(
                    "management",
                    "create_course_run_job",
                    [netRun, financial(preview.source_revision), null, randomUUID()],
                    "aal1",
                ),
                /Gross finance permission/,
            );
            const netJob = await rpc(
                "management",
                "create_course_run_job",
                [netRun, financial(preview.source_revision, false), null, randomUUID()],
                "aal1",
            );
            const report = await rpc("admin", "commission_report", [], "aal1");
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
                    "aal1",
                ),
                /permission denied/,
            );
        },
    );
    await check(
        "Management sets a scoped explicit price on an own offer linked to an existing run",
        async () => {
            const ownRun = await createRun(template, 17);
            const preview = await rpc("management", "course_run_job_defaults", [ownRun]);
            const key = randomUUID();
            const ownPayload = financial(preview.source_revision);
            const made = await rpc("management", "create_course_run_job", [
                ownRun, ownPayload, 25.5, key,
            ]);
            assert.equal(await rpc("management", "create_course_run_job", [
                ownRun, ownPayload, 25.5, key,
            ]), made);
            const pricing = await rpc("management", "commission_offer_policy", [made]);
            assert.equal(pricing.platform_percent_override, 25.5);
            assert.equal(pricing.gross_total_amount, ownPayload.gross_total_amount);
            await assert.rejects(rpc("management", "commission_offer_policy", [job]), /42501/);
            const lectureOffer = (await rpc("lecturer", "job_offers")).find(({id}) => id === made);
            assert.equal(lectureOffer.total_amount, 149.01);
            await rpc("management", "set_job_commission", [made, 100, 200, 20]);
            assert.equal((await rpc("management", "commission_offer_policy", [made])).platform_percent_override, 20);
        },
    );
    await check("One active course draft survives concurrent saves and remains editable", async () => {
        const draftRun = await createRun(template, 82);
        const preview = await rpc("admin", "course_run_job_defaults", [draftRun]);
        const requests = [
            ["admin", {...financial(preview.source_revision), status: "draft"}, randomUUID()],
            ["management", {...financial(preview.source_revision, false), status: "draft"}, randomUUID()],
        ];
        const create = ([who, settings, key]) =>
            rpc(who, "create_course_run_job", [draftRun, settings, null, key]);
        const attempts = await Promise.allSettled(requests.map(create));
        const winner = attempts.findIndex(({status}) => status === "fulfilled");
        assert.notEqual(winner, -1);
        const saved = attempts[winner].value;
        assert.equal(attempts[1 - winner].status, "rejected");
        assert.match(attempts[1 - winner].reason.message, /course_run_draft_exists/);
        assert.equal(await create(requests[winner]), saved);
        await assert.rejects(create(["admin", financial(preview.source_revision), randomUUID()]), /course_run_draft_exists/);
        await assert.rejects(sql(`insert into public.jobs (
            course_run_id,title,customer_name,delivery_type,amount,total_amount,currency,rate_unit,terms
          ) values (${q(draftRun)},'Second draft','Fictional academy','online',10,10,'EUR','fixed_total','')`),
        /jobs_one_course_draft_idx/);
        const version = await sql(`select lifecycle_version from public.jobs where id=${q(saved)}`);
        await rpc("admin", "manage_job_offer", [saved, "published", version, randomUUID(), {}]);
        const next = await create(requests[1 - winner]);
        assert.notEqual(next, saved);
        assert.equal(await sql(`select count(*) from public.jobs where course_run_id=${q(draftRun)} and status='draft'`), "1");
        const currentVersion = await sql(`select lifecycle_version from public.jobs where id=${q(saved)}`);
        await assert.rejects(
            rpc("admin", "manage_job_offer", [saved, "draft", currentVersion, randomUUID(), {}]),
            /jobs_one_course_draft_idx/,
        );
    });
    await check(
        "Two independent management actors can publish separate whole-block offers for one run",
        async () => {
            const raceRun = await createRun(template, 20),
                preview = await rpc(
                    "admin",
                    "course_run_job_defaults",
                    [raceRun],
                    "aal1",
                );
            const attempts = await Promise.allSettled([
                rpc(
                    "admin",
                    "create_course_run_job",
                    [raceRun, financial(preview.source_revision), null, randomUUID()],
                    "aal1",
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
                    "aal1",
                ),
            ]);
            assert.equal(
                attempts.filter((item) => item.status === "fulfilled").length,
                2,
            );
            assert.equal(
                await sql(
                    `select count(*) from public.jobs where course_run_id=${q(raceRun)}`,
                ),
                "2",
            );
            assert.equal(
                await sql(
                    `select count(*) from public.job_sessions where job_id in(select id from public.jobs where course_run_id=${q(raceRun)})`,
                ),
                "4",
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
                    "aal1",
                ),
                base = financial(preview.source_revision);
            for (const extra of [
                {template_id: randomUUID()},
                {sessions: []},
                {source_revision: null},
                {gross_amount: "100"},
                {gross_amount: -1},
                {currency: "GBP"},
                {claim_deadline: "2037-01-01T09:00"},
                {claim_deadline: "2020-01-01T09:00:00Z"},
                {requires_contract: "false"},
            ])
                await assert.rejects(
                    rpc(
                        "admin",
                        "create_course_run_job",
                        [invalidRun, {...base, ...extra}, null, randomUUID()],
                        "aal1",
                    ),
                );
            assert.equal(
                await sql(
                    `select count(*) from public.jobs where course_run_id=${q(invalidRun)}`,
                ),
                "0",
            );
            const chfOffer = await rpc("admin", "create_course_run_job", [
                invalidRun, {...base, currency: "CHF", status: "draft"}, null, randomUUID(),
            ], "aal1");
            assert.equal(
                await sql(`select currency from public.jobs where id=${q(chfOffer)}`),
                "CHF",
            );
        },
    );
    await check(
        "A plain unlinked preview has no catalogue or customer record and only its linked offer can be created",
        async () => {
            const plainTemplate = await rpc("admin", "save_course_template", [
                null, {title: "Fictional ordinary template"},
            ]);
            const start = new Date(Date.now() + 160 * 86400000);
            const plainRun = await rpc("admin", "save_course_run", [
                null,
                {template_id: plainTemplate, sessions: [{
                    starts_at: start.toISOString(),
                    ends_at: new Date(+start + 3600000).toISOString(),
                }]},
            ]);
            const preview = await rpc("admin", "course_run_job_defaults", [plainRun]);
            assert.equal(preview.organisation_id, null);
            assert.equal(preview.customer_name, "");
            assert.equal(preview.building_block_id, null);
            assert.equal(preview.building_block_source_id, null);
            await assert.rejects(
                rpc("admin", "create_course_run_job", [
                    plainRun, financial(preview.source_revision), null, randomUUID(),
                ]),
                /course_run_customer_required/,
            );
            const linkedRun = await createRun(plainTemplate, 65);
            const current = await rpc("management", "course_run_job_defaults", [linkedRun]);
            const linkedJob = await rpc("management", "create_course_run_job", [
                linkedRun, financial(current.source_revision, false), null, randomUUID(),
            ]);
            assert.equal(await rpc("management", "job_building_block_reference", [linkedJob]), null);
        },
    );
    await check(
        "Participant accounts cannot access source blocks even when historical enrolment remains",
        async () => {
            const participantId = await sql(
                `update auth.users set email_confirmed_at=now() where id=${q(ids.participant)};
                 select luminovia_user_id from public.profiles where id=${q(ids.participant)};`,
            );
            await rpc("admin", "request_company_participant_link", [org, participantId, randomUUID()]);
            await rpc("participant", "accept_company_participant_invitation", [org, 1, randomUUID()]);
            await rpc(
                "admin",
                "manage_course_enrolment",
                [run, ids.participant, "enrolled"],
                "aal1",
            );
            assert.equal(
                await actor(
                    ids.participant,
                    "select count(*) from public.building_blocks",
                ),
                "0",
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
                "aal1",
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
                await actor(
                    ids.lecturer,
                    `select item->>'terms_version' from jsonb_array_elements(public.job_offers()) item where item->>'id'=${q(job)}`,
                ),
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
            // The fixture configures a 31% lecturer share. Round the accepted
            // full-block charge of 200.02 EUR once and persist that exact quote.
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
                rpc("admin", "set_job_commission", [job, 900, 1800, null], "aal1"),
                /unaccepted offers/,
            );
        },
    );
    await check(
        "Assigning a company retains exact session IDs when the schedule has not changed",
        async () => {
            const draft = {
                template_id: template,
                organisation_id: null,
                time_zone: "UTC",
                delivery_type: "online",
                venue: "",
                published: false,
                sessions: [
                    {starts_at: "2060-02-01T10:00:00Z", ends_at: "2060-02-01T14:00:00Z"},
                    {starts_at: "2060-02-02T10:00:00Z", ends_at: "2060-02-02T14:00:00Z"},
                ],
            };
            const target = await rpc("admin", "save_course_run", [null, draft]);
            const read = () => rpc("admin", "course_run_job_defaults", [target]);
            const before = await read();
            const assigned = {
                ...draft,
                organisation_id: org,
                time_zone: "Europe/Berlin",
                venue: "Fictional course room",
                sessions: [
                    {starts_at: "2060-02-02T11:00:00+01:00", ends_at: "2060-02-02T15:00:00+01:00"},
                    {starts_at: "2060-02-01T11:00:00+01:00", ends_at: "2060-02-01T15:00:00+01:00"},
                ],
            };
            await rpc("admin", "save_course_run", [target, assigned]);
            const updated = await read();
            assert.equal(updated.organisation_id, org);
            assert.equal(updated.time_zone, assigned.time_zone);
            assert.equal(updated.location, assigned.venue);
            assert.deepEqual(updated.sessions, before.sessions);

            await assert.rejects(rpc("admin", "save_course_run", [target, {
                ...assigned,
                venue: "Invalid save must roll back",
                sessions: [assigned.sessions[0], assigned.sessions[0]],
            }]), /Invalid or overlapping sessions/);
            assert.deepEqual(await read(), updated);

            await rpc("admin", "save_course_run", [target, {
                ...assigned,
                sessions: [
                    {...assigned.sessions[0], ends_at: "2060-02-02T16:00:00+01:00"},
                    assigned.sessions[1],
                ],
            }]);
            const rescheduled = await read();
            assert.notEqual(rescheduled.sessions[1].ends_at, updated.sessions[1].ends_at);
            const oldSessionIds = new Set(updated.sessions.map(({source_course_session_id}) => source_course_session_id));
            assert.ok(rescheduled.sessions.every(({source_course_session_id}) =>
                !oldSessionIds.has(source_course_session_id)));
        },
    );
    await check(
        "Marketplace copy is independent of course content and editable only before a claim",
        async () => {
            const copyRun = await createRun(template, 81);
            const preview = await rpc("admin", "course_run_job_defaults", [copyRun]);
            const settings = {...financial(preview.source_revision), status: "draft"};
            const create = (payload, key = randomUUID(), who = "admin") =>
                rpc(who, "create_course_run_job", [copyRun, payload, null, key]);
            for (const bad of [
                {title: null},
                {title: " \t "},
                {title: "x".repeat(201)},
                {description: false},
                {description: "x".repeat(12001)},
                {sessions: []},
                {organisation_id: randomUUID()},
            ]) {
                await assert.rejects(create({...settings, ...bad}), /22023/);
            }
            const draftCopy = {...settings, title: "  Fictional marketplace listing  ", description: ""};
            await assert.rejects(create(draftCopy, randomUUID(), "lecturer"), /42501/);
            const key = randomUUID();
            const listing = await create(draftCopy, key);
            assert.equal(await create(draftCopy, key), listing);
            await assert.rejects(create({...draftCopy, title: "Changed retry"}, key), /idempotency conflict/i);
            const stored = async () =>
                JSON.parse(await sql(
                    `select jsonb_build_object('title',title,'description',description,'status',status,'version',lifecycle_version)
                     from public.jobs where id=${q(listing)}`,
                ));
            const {title, description, status} = await stored();
            assert.deepEqual(
                {title, description, status},
                {title: "Fictional marketplace listing", description: "", status: "draft"},
            );
            assert.deepEqual(
                await rpc("admin", "course_run_job_defaults", [copyRun]),
                preview,
            );
            const sourceRequest = JSON.parse(await sql(
                `select payload from private.client_course_requests where job_id=${q(listing)}`,
            ));
            assert.equal(sourceRequest.title, preview.title);
            assert.equal(sourceRequest.description, preview.description);
            await assert.rejects(rpc("lecturer", "job_detail", [listing]), /42501/);

            const edit = {title: "Fictional published training offer", description: "x".repeat(12000)};
            const initialVersion = (await stored()).version;
            const manage = (action, version, changes = {}, who = "admin") =>
                rpc(who, "manage_job_offer", [listing, action, version, randomUUID(), changes]);
            await assert.rejects(manage("edit", initialVersion, edit, "lecturer"), /42501/);
            await manage("edit", initialVersion, edit);
            await assert.rejects(manage("published", initialVersion), /40001/);
            await manage("published", (await stored()).version);
            const published = await rpc("lecturer", "job_detail", [listing]);
            assert.equal(published.title, edit.title);
            assert.equal(published.description, edit.description);
            assert.equal(
                await sql(
                    `select count(*) from public.job_sessions js
                     join public.course_sessions cs on cs.id=js.course_session_id
                     where js.job_id=${q(listing)} and cs.course_run_id=${q(copyRun)}
                       and cs.starts_at=js.starts_at and cs.ends_at=js.ends_at`,
                ),
                "2",
            );
            assert.equal(
                (await rpc("lecturer", "claim_job", [listing, randomUUID(), published.terms_version])).status,
                "confirmed",
            );
            await assert.rejects(
                manage("edit", (await stored()).version, {title: "Attempt to rewrite accepted listing"}),
                /Cancel confirmed work|accepted history/i,
            );
            assert.equal((await stored()).title, edit.title);
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
    await check("Direct internal staffing is scoped per offer, with an aggregate versioned publication preview", async () => {
        const ownTemplate = await rpc("admin", "save_course_template", [null, {
            title: "Fictional internal staffing", topic_ids: [],
        }]);
        const ownRun = await createRun(ownTemplate, 91);
        const defaults = await rpc("admin", "course_run_job_defaults", [ownRun]);
        assert.equal(defaults.has_company_lecturers, false);
        const position = { source_revision: defaults.source_revision, own_lecturers_only: true, status: "draft" };
        await assert.rejects(rpc("admin", "create_course_run_job", [ownRun, position, null, randomUUID()]), /course_offer_roster_required/);
        const assigned = randomUUID();
        await sql(`insert into auth.users(id,email) values(${q(assigned)},'staffing-linked@example.invalid');
          insert into public.user_roles(user_id,role) values(${q(assigned)},'lecturer');`);
        await rpc("admin", "set_company_lecturer", [org, assigned, false]);
        const request = randomUUID();
        const internal = await rpc("admin", "create_course_run_job", [ownRun, position, null, request]);
        assert.equal(await rpc("admin", "create_course_run_job", [ownRun, position, null, request]), internal);
        const before = await rpc("admin", "course_offer_publication_preview", [internal]);
        assert.deepEqual(before, {
            version: Number(await sql(`select lifecycle_version from public.jobs where id=${q(internal)}`)),
            audience: "company", billable: false, eligible: true, ready: true,
        });
        await assert.rejects(actor(assigned, `select public.course_offer_publication_preview(${q(internal)})`), /42501/);
        // A claim may already hold the lecturer lock while publication has
        // the job row. A waiting roster update must leave the company unlocked.
        const advisory = `pg_catalog.hashtextextended(${q(assigned)},0)`;
        const claimLock = sql(`begin; select pg_advisory_xact_lock(${advisory}); select pg_sleep(3); commit;`);
        let remove;
        const waitFor = async (condition) => {
            const deadline = Date.now() + 2000;
            while (Date.now() < deadline) {
                if (await sql(condition) === "t") return;
                await delay(20);
            }
            assert.fail("Expected staffing lock was not observed");
        };
        try {
            await waitFor(`select not pg_try_advisory_xact_lock(${advisory})`);
            remove = rpc("admin", "set_company_lecturer", [org, assigned, true]);
            await waitFor(`select exists(select 1 from pg_stat_activity
              where wait_event_type='Lock' and wait_event='advisory'
                and strpos(query, ${q(assigned)}) > 0
                and strpos(query, 'public.set_company_lecturer') > 0)`);
            assert.equal(await sql(`begin; select id from public.organisations
              where id=${q(org)} for share nowait; rollback;`), org);
        } finally {
            await Promise.all([claimLock, remove]);
        }
        const removed = await rpc("admin", "course_offer_publication_preview", [internal]);
        assert.deepEqual(removed, {...before, eligible: false, ready: false});
        await assert.rejects(rpc("admin", "manage_job_offer", [internal, "published", before.version, randomUUID(), {}]), /course_offer_roster_required/);
        await rpc("admin", "set_company_lecturer", [org, assigned, false]);
        await rpc("admin", "manage_job_offer", [internal, "published", before.version, randomUUID(), {}]);
        const external = await rpc("admin", "create_course_run_job", [ownRun,
            {...financial(defaults.source_revision), status: "published", requires_contract: false}, null, randomUUID()]);
        const outsider = randomUUID();
        await sql(`insert into auth.users(id,email) values(${q(outsider)},'staffing-outsider@example.invalid');
          insert into public.user_roles(user_id,role) values(${q(outsider)},'lecturer');`);
        assert.equal(await actor(outsider, `select count(*) from public.jobs where id in (${q(internal)},${q(external)})`), "1");
        assert.equal(await actor(outsider, `select count(*) from public.jobs where id = ${q(external)}`), "1");
        assert.equal(await sql(`select count(*) from private.job_commission_offers where job_id = ${q(internal)}`), "0");
    });
    console.log(
        `\n${count} course building-block curriculum/source/run-offer PostgreSQL checks passed.`,
    );
});

await withTestDatabase("course_draft_upgrade", async ({sql}) => {
    const [template, run, otherRun, old, newest, other, published] =
        Array.from({length: 7}, randomUUID);
    await sql(`
        insert into public.course_templates(id,title) values (${q(template)},'Fictional course');
        insert into public.course_runs(id,template_id)
        values (${q(run)},${q(template)}), (${q(otherRun)},${q(template)});
        insert into public.jobs(id,course_run_id,title,customer_name,delivery_type,
                                amount,total_amount,currency,rate_unit,terms,status,created_at)
        values
          (${q(old)},${q(run)},'Earlier text','Fictional academy','online',10,10,'EUR','fixed_total','Original terms','draft','2026-06-01'),
          (${q(newest)},${q(run)},'Latest text','Fictional academy','online',12,12,'EUR','fixed_total','Updated terms','draft','2026-06-02'),
          (${q(other)},${q(otherRun)},'Other course','Fictional academy','online',10,10,'EUR','fixed_total','','draft','2026-06-01'),
          (${q(published)},${q(run)},'Listed','Fictional academy','online',20,20,'EUR','fixed_total','','published','2026-06-01');
    `);
    await sql(readFileSync(new URL(
        "../supabase/migrations/20261123085923_single_active_course_offer_draft.sql",
        import.meta.url,
    ), "utf8"));
    const rows = JSON.parse(await sql(`
        select jsonb_object_agg(id, jsonb_build_array(status,title,terms,lifecycle_version))
        from public.jobs where id in (${[old, newest, other, published].map(q).join(",")})
    `));
    assert.deepEqual(rows, {
        [old]: ["archived", "Earlier text", "Original terms", 2],
        [newest]: ["draft", "Latest text", "Updated terms", 1],
        [other]: ["draft", "Other course", "", 1],
        [published]: ["published", "Listed", "", 1],
    });
    console.log("PASS Existing duplicate drafts are archived without losing text and terms or changing other jobs.");
}, {migrationsThrough: "20261123073248"});
