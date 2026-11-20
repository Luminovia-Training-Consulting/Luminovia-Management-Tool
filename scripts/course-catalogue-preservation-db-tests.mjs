/** Real upgrade rehearsal: neutral catalogue labels preserve authored/history data. */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import {applyPasswordOnlyPermissionPolicy, quoteSql as q, withTestDatabase,} from "./testing/database.mjs";
import {cataloguePath, originalCatalogue} from "./course-catalogue.mjs";

const catalogue = JSON.parse(readFileSync(cataloguePath, "utf8"));
const original = originalCatalogue();
const migration = readFileSync(
    new URL(
        "../supabase/migrations/20261116032005_customer_neutral_course_catalogue.sql",
        import.meta.url,
    ),
    "utf8",
);
let checks = 0;
const check = async (name, run) => {
    await run();
    checks++;
    console.log(`PASS ${name}`);
};
await withTestDatabase(
    "course_catalogue_upgrade",
    async ({sql, actor}) => {
        const admin = randomUUID(),
            teacher = randomUUID(),
            clients = [randomUUID(), randomUUID()];
        await sql(`insert into auth.users(id, email)
                   values ${[admin, teacher, ...clients].map((id) => `(${q(id)},${q(`${id}@example.invalid`)})`).join(",")};
    insert into public.user_roles(user_id,role) values(${q(admin)},'admin'),(${q(teacher)},'lecturer'),${clients.map((id) => `(${q(id)},'client')`).join(",")};`);
        await applyPasswordOnlyPermissionPolicy(sql);
        const rpc = async (id, name, args = [], aal = "aal1") => {
            const result = await actor(
                id,
                `select public.${name}(${args.map((value) => (value === null ? "null" : typeof value === "number" ? String(value) : q(typeof value === "object" ? JSON.stringify(value) : value))).join(",")})`,
                aal,
            );
            try {
                return JSON.parse(result);
            } catch {
                return result;
            }
        };
        const tableSnapshot = (table) =>
            sql(
                `select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from ${table} t`,
            );
        await check(
            "Upgrade starts with the original complete canonical catalogue",
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
                    await sql("select provider from public.building_blocks limit 1"),
                    original.provider,
                );
            },
        );
        // Each kind of authored edit prevents replacement of the entire template.
        const edited = catalogue.blocks
            .slice(0, 7)
            .map((block) => block.default_template_id);
        await sql(`update public.course_templates set title='Fictional authored title' where id=${q(edited[0])};
    update public.course_templates set description='Fictional authored description' where id=${q(edited[1])};
    update public.course_templates set syllabus='Fictional authored syllabus' where id=${q(edited[2])};
    update public.course_templates set prerequisites='Fictional authored prerequisites' where id=${q(edited[3])};
    update public.course_templates set archived_at=now() where id=${q(edited[4])};
    insert into public.audit_events(actor_id,action,resource_id,details) values(${q(admin)},'course.template.saved',${q(edited[5])},'{}');
    insert into public.topics(id,label_de,label_en,kind) values('c5500000-0000-4000-a000-000000000001','Fiktives Kursthema','Fictional course topic','topic');
    insert into public.course_template_topics(template_id,topic_id) values(${q(edited[6])},'c5500000-0000-4000-a000-000000000001');`);
        const copy = await rpc(admin, "duplicate_course_template", [
            catalogue.blocks[8].default_template_id,
            "Fictional authored copy",
        ]);
        edited.push(copy);
        const editedBefore = await sql(
            `select jsonb_agg(to_jsonb(t) order by id) from public.course_templates t where id in(${edited.map(q).join(",")})`,
        );
        const usedTemplate = catalogue.blocks.find(
            (block) => block.code === "LPC3",
        );
        const pristine = catalogue.blocks.find((block) => block.code === "LPC4");
        const offers = [];
        for (let index = 0; index < 2; index++) {
            const organisation = randomUUID();
            await sql(`insert into public.organisations(id,name) values(${q(organisation)},${q(`Fictional independent customer ${index + 1}`)});
      insert into public.client_organisation_memberships(user_id,organisation_id) values(${q(clients[index])},${q(organisation)});`);
            const run = await rpc(admin, "save_course_run", [
                null,
                {
                    template_id: usedTemplate.default_template_id,
                    organisation_id: organisation,
                    time_zone: "Europe/Berlin",
                    delivery_type: "online",
                    venue: "Fictional classroom",
                    published: false,
                    sessions: [
                        {
                            starts_at: `2044-07-${10 + index}T08:00:00Z`,
                            ends_at: `2044-07-${10 + index}T14:00:00Z`,
                        },
                    ],
                },
            ]);
            const preview = await rpc(admin, "course_run_job_defaults", [run]);
            assert.equal(preview.organisation_id, organisation);
            offers.push(
                await rpc(admin, "create_course_run_job", [
                    run,
                    {
                        source_revision: preview.source_revision,
                        gross_amount: 100,
                        gross_total_amount: 100,
                        currency: "EUR",
                        rate_unit: "per_day",
                        terms: "Fictional accepted terms",
                        requires_contract: false,
                        status: "published",
                    },
                    50,
                    randomUUID(),
                ]),
            );
        }
        await check(
            "One reusable template produces independent offers for two freely added customers",
            async () => {
                assert.equal(
                    await sql(
                        `select count(distinct organisation_id) from public.course_runs where template_id=${q(usedTemplate.default_template_id)}`,
                    ),
                    "2",
                );
                for (let index = 0; index < 2; index++) {
                    const rows = JSON.parse(
                        await actor(
                            clients[index],
                            "select coalesce(jsonb_agg(t),'[]'::jsonb) from public.client_requests() t",
                        ),
                    );
                    assert.deepEqual(
                        rows.map((row) => row.job_id),
                        [offers[index]],
                    );
                }
            },
        );
        const quote = Number(
            await actor(
                teacher,
                `select terms_version from public.jobs where id=${q(offers[0])}`,
            ),
        );
        assert.equal(
            (
                await rpc(
                    teacher,
                    "claim_job",
                    [offers[0], randomUUID(), quote],
                    "aal1",
                )
            ).status,
            "confirmed",
        );
        const usedBefore = await sql(
            `select to_jsonb(t) from public.course_templates t where id=${q(usedTemplate.default_template_id)}`,
        );
        const unchangedTables = [
            "public.building_block_sources",
            "public.organisations",
            "public.profiles",
            "public.user_roles",
            "public.client_organisation_memberships",
            "public.course_runs",
            "public.course_sessions",
            "public.jobs",
            "public.job_sessions",
            "public.job_claims",
            "public.assignment_sessions",
            "private.claim_revenue_ledger",
            "private.course_run_job_requests",
            "private.client_course_requests",
            "private.job_commission_offers",
        ];
        const before = new Map();
        for (const table of unchangedTables)
            before.set(table, await tableSnapshot(table));
        await sql(migration);
        await check(
            "Upgrade changes pristine labels and keeps all exact source revisions",
            async () => {
                assert.equal(
                    await sql(
                        "select count(*) from public.building_blocks where provider='course-catalogue'",
                    ),
                    "22",
                );
                assert.equal(
                    await sql(
                        `select title from public.course_templates where id=${q(pristine.default_template_id)}`,
                    ),
                    `${pristine.code} · ${pristine.title}`,
                );
                assert.equal(
                    await sql(
                        `select description from public.course_templates where id=${q(pristine.default_template_id)}`,
                    ),
                    pristine.description,
                );
                assert.equal(
                    await sql(
                        `select to_jsonb(t) from public.course_templates t where id=${q(usedTemplate.default_template_id)}`,
                    ),
                    usedBefore,
                );
                for (const table of unchangedTables)
                    assert.equal(
                        await tableSnapshot(table),
                        before.get(table),
                        `${table} changed`,
                    );
            },
        );
        await check(
            "Every authored edit, archived/audited template and copy survives byte-for-byte",
            async () => {
                assert.equal(
                    await sql(
                        `select jsonb_agg(to_jsonb(t) order by id) from public.course_templates t where id in(${edited.map(q).join(",")})`,
                    ),
                    editedBefore,
                );
            },
        );
        await check(
            "Catalogue provenance supports another neutral namespace without customer restrictions",
            async () => {
                const newId = randomUUID();
                await sql(
                    `insert into public.building_blocks select (jsonb_populate_record(null::public.building_blocks,to_jsonb(b)||jsonb_build_object('id',${q(newId)},'provider','fictional-curriculum-2','default_template_id',null))).* from public.building_blocks b where b.id=${q(pristine.id)}`,
                );
                assert.equal(
                    await sql(
                        `select count(*) from public.building_blocks where code=${q(pristine.code)}`,
                    ),
                    "2",
                );
                await assert.rejects(
                    sql(
                        `update public.building_blocks set provider=' ' where id=${q(newId)}`,
                    ),
                    /23514/,
                );
                await assert.rejects(
                    sql(
                        `update public.building_blocks set provider=repeat('a',81) where id=${q(newId)}`,
                    ),
                    /23514/,
                );
            },
        );
    },
    {migrationsThrough: "20261115213550"},
);
console.log(
    `\n${checks} course catalogue upgrade and independent-customer PostgreSQL checks passed.`,
);