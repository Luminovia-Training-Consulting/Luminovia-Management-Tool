/** Real temporary PostgreSQL checks. Native Auth is covered separately. */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import {z} from "zod";
import {portalOpenApi} from "../src/features/developer-api/contract.ts";
import {applyPasswordOnlyPermissionPolicy, quoteSql as q, withTestDatabase,} from "./testing/database.mjs";

await withTestDatabase(
    "taxonomy_test",
    async ({sql, actor}) => {
        await applyPasswordOnlyPermissionPolicy(sql);
        const admin = randomUUID(),
            manager = randomUUID(),
            lecturer = randomUUID(),
            outsider = randomUUID();
        const template = randomUUID(),
            job = randomUUID();
        await sql(
            `insert into auth.users(id, email)
             values ${[admin, manager, lecturer, outsider].map((id) => `('${id}','${id}@example.invalid')`).join(",")};
            insert into public.user_roles(user_id, role)
            values ('${admin}', 'admin'),
                   ('${manager}', 'management'),
                   ('${lecturer}', 'lecturer'),
                   ('${outsider}', 'client');`,
        );
        const {paths} = portalOpenApi("https://portal.example.invalid");
        const topicRoutes = ["taxonomy_catalogue", "save_taxonomy_topic"];
        const schemas = new Map(topicRoutes.map((name) => [
            name,
            z.fromJSONSchema(paths[`/rest/v1/rpc/${name}`].post.responses["200"].content["application/json"].schema),
        ]));
        /** Calls the business database API under the fixture's controlled identity/permission claims. */
        const rpc = async (who, name, args = [], aal = "aal1") => {
            const result = await actor(
                who,
                `select public.${name}(${args.map((value) => (value === null ? "null" : typeof value === "boolean" || typeof value === "number" ? String(value) : q(typeof value === "object" ? JSON.stringify(value) : value))).join(",")})`,
                aal,
            );
            const response = schemas.get(name);
            if (response) return response.parse(name === "save_taxonomy_topic" ? result : JSON.parse(result));
            try {
                return JSON.parse(result);
            } catch {
                return result;
            }
        };
        /** Creates this module's fictional inputs; authoritative validation remains on the server. */
        const payload = (label, parent = null) => ({
            label_de: label,
            label_en: `EN ${label}`,
            kind: "topic",
            parent_id: parent,
            aliases: [" Alternative ", "alternative", "Second"],
            description_de: "Fiktive Beschreibung",
            description_en: "Fictional description",
        });
        /** Creates a catalogue entry with an optional parent as AAL1 management, requiring initial version 0. */
        const save = (label, parent = null) =>
            rpc(admin, "save_taxonomy_topic", [null, payload(label, parent), 0]);
        let checks = 0;
        /** Counts and reports a case only after all of its assertions have completed successfully. */
        const check = async (name, fn) => {
            await fn();
            checks++;
            console.log(`PASS ${name}`);
        };
        await check(
            "Current management permission grants password-only taxonomy access",
            async () => {
                for (const role of ["anon", "authenticated"])
                    for (const signature of [
                        "private.validate_taxonomy_hierarchy()",
                        "private.require_active_topic_reference()",
                    ])
                        assert.equal(
                            await sql(
                                `select has_function_privilege(${q(role)},${q(signature)},'execute')`,
                            ),
                            "f",
                            `${role} must not execute internal taxonomy helpers`,
                        );
                for (const [who, aal] of [
                    [lecturer, "aal1"],
                    [outsider, "aal1"],
                ])
                    await assert.rejects(
                        rpc(who, "save_taxonomy_topic", [null, payload("Denied"), 0], aal),
                        /taxonomy.manage.*required/i,
                    );
                const adminId = await rpc(admin, "save_taxonomy_topic", [
                    null,
                    payload("Administrator"),
                    0,
                ]);
                assert.match(adminId, /^[a-f0-9-]{36}$/);
                const id = await rpc(manager, "save_taxonomy_topic", [
                    null,
                    payload("Manager"),
                    0,
                ]);
                assert.match(id, /^[a-f0-9-]{36}$/);
                await assert.rejects(
                    sql("set role anon;select public.taxonomy_catalogue()"),
                    /permission denied/,
                );
            },
        );
        const trainingCatalogue = await readFile(new URL(
            "../supabase/migrations/20261123013000_shared_training_taxonomy.sql",
            import.meta.url,
        ), "utf8");
        await sql(trainingCatalogue);
        await check("Shared training entries are searchable and replay preserves edits", async () => {
            for (const [term, kind, label] of [
                ["200-301", "topic", "Cisco CCNA"],
                ["MD-102", "topic", "Microsoft 365 Endpoint Administrator Associate"],
                ["PromQL", "tool", "Prometheus"],
                ["SQL", "language", "SQL"],
            ]) {
                const matches = await rpc(lecturer, "taxonomy_catalogue", [term, kind, false]);
                assert.ok(matches.some((row) => row.label_de === label && row.label_en));
            }
            await sql("update public.topics set description_de='Locally maintained' where label_de='Cisco CCNA'");
            const before = await sql("select count(*) from public.topics");
            await sql(trainingCatalogue);
            assert.equal(await sql("select count(*) from public.topics"), before);
            assert.equal(await sql("select description_de from public.topics where label_de='Cisco CCNA'"), "Locally maintained");
        });
        const parent = await save("Fictional parent"),
            child = await save("Fictional child", parent);
        await check(
            "Bilingual labels, normalized aliases and hierarchy persist; aliases search literally",
            async () => {
                const rows = await rpc(
                    lecturer,
                    "taxonomy_catalogue",
                    ["Alternative", "", false],
                    "aal1",
                );
                assert.ok(rows.some((row) => row.id === child));
                const topic = rows.find((row) => row.id === child);
                assert.equal(topic.label_en, "EN Fictional child");
                assert.equal(topic.parent_id, parent);
                // This historical function keeps either spelling when duplicates
                // differ only in case. Its tie-break uses the database locale.
                assert.deepEqual(topic.aliases.map((alias) => alias.toLowerCase()), ["alternative", "second"]);
                assert.equal(topic.aliases[1], "Second");
                assert.deepEqual(
                    await rpc(lecturer, "taxonomy_catalogue", ["%", "", false], "aal1"),
                    [],
                );
                await assert.rejects(
                    rpc(admin, "taxonomy_catalogue", ["x".repeat(121), "", false]),
                    /Invalid catalogue filters/,
                );
                await assert.rejects(
                    rpc(admin, "taxonomy_catalogue", ["", "forged-kind", false]),
                    /Invalid catalogue filters/,
                );
            },
        );
        await check(
            "Malformed or privileged payload fields fail without partial row changes",
            async () => {
                const before = await sql("select count(*) from public.topics");
                for (const bad of [
                    {...payload("x"), role: "admin"},
                    {...payload("x"), label_de: " "},
                    {...payload("x"), aliases: ["x".repeat(121)]},
                    {...payload("x"), description_en: {}},
                    {...payload("x"), parent_id: []},
                ])
                    await assert.rejects(
                        rpc(admin, "save_taxonomy_topic", [null, bad, 0]),
                    );
                assert.equal(await sql("select count(*) from public.topics"), before);
            },
        );
        await check(
            "Self-parent and descendant-parent moves fail atomically",
            async () => {
                await assert.rejects(
                    rpc(admin, "save_taxonomy_topic", [
                        parent,
                        payload("Fictional parent", parent),
                        1,
                    ]),
                    /Taxonomy parent cycle/,
                );
                await assert.rejects(
                    rpc(admin, "save_taxonomy_topic", [
                        parent,
                        payload("Fictional parent", child),
                        1,
                    ]),
                    /Taxonomy parent cycle/,
                );
                assert.equal(
                    await sql(
                        `select parent_id is null and version = 1
                         from public.topics
                         where id = '${parent}'`,
                    ),
                    "t",
                );
            },
        );
        await check(
            "Concurrent individually valid opposite parent moves cannot commit a cycle",
            async () => {
                const a = await save("Concurrent A"),
                    b = await save("Concurrent B");
                const results = await Promise.allSettled([
                    rpc(admin, "save_taxonomy_topic", [a, payload("Concurrent A", b), 1]),
                    rpc(admin, "save_taxonomy_topic", [b, payload("Concurrent B", a), 1]),
                ]);
                assert.equal(
                    results.filter((result) => result.status === "fulfilled").length,
                    1,
                );
                assert.equal(
                    results.filter((result) => result.status === "rejected").length,
                    1,
                );
                assert.equal(
                    await sql(
                        `select count(*)
                         from public.topics a
                                  join public.topics b on a.parent_id = b.id and b.parent_id = a.id
                         where a.id in ('${a}', '${b}')`,
                    ),
                    "0",
                );
            },
        );
        await sql(
            `insert into public.lecturer_topics(user_id, topic_id, verified, valid_until)
             values ('${lecturer}', '${child}', true, '2099-01-01');
            insert into public.course_templates(id, title)
            values ('${template}', 'Private taxonomy template');
            insert into public.course_template_topics(template_id, topic_id)
            values ('${template}', '${child}');
            insert into public.jobs(id, title, customer_name, delivery_type, amount, currency, rate_unit, total_amount, terms)
            values ('${job}', 'Fictional taxonomy job', 'Fictional customer', 'online', 100, 'EUR', 'fixed_total', 100, 'Fictional terms');
            insert into public.job_requirements(job_id, topic_id)
            values ('${job}', '${child}');`,
        );
        await check(
            "Related templates follow actual course permissions rather than definer-wide visibility",
            async () => {
                const managerRows = await rpc(admin, "taxonomy_catalogue", [
                    "Fictional child",
                    "",
                    false,
                ]);
                assert.equal(managerRows[0].related_courses[0].id, template);
                const lecturerRows = await rpc(
                    lecturer,
                    "taxonomy_catalogue",
                    ["Fictional child", "", false],
                    "aal1",
                );
                assert.deepEqual(lecturerRows[0].related_courses, []);
                const enrolledRun = randomUUID();
                await sql(
                    `insert into public.user_roles(user_id, role)
                     values ('${outsider}', 'participant');
                    insert into public.course_runs(id, template_id)
                    values ('${enrolledRun}', '${template}');
                    insert into public.course_enrolments(course_run_id, user_id, enrolled_by)
                    values ('${enrolledRun}', '${outsider}', '${admin}')`,
                );
                const enrolledRows = await rpc(
                    outsider,
                    "taxonomy_catalogue",
                    ["Fictional child", "", false],
                    "aal1",
                );
                assert.equal(enrolledRows[0].related_courses[0].id, template);
                await sql(
                    `update public.course_enrolments
                     set status='removed'
                     where course_run_id = '${enrolledRun}'
                       and user_id = '${outsider}'`,
                );
                assert.deepEqual(
                    (
                        await rpc(
                            outsider,
                            "taxonomy_catalogue",
                            ["Fictional child", "", false],
                            "aal1",
                        )
                    )[0].related_courses,
                    [],
                );
            },
        );
        await check(
            "Edits are versioned and preserve exact existing qualification identity and evidence",
            async () => {
                const before = await sql(
                    `select row_to_json(x)
                     from (select * from public.lecturer_topics where user_id = '${lecturer}' and topic_id = '${child}') x`,
                );
                await rpc(admin, "save_taxonomy_topic", [
                    child,
                    payload("Renamed child", parent),
                    1,
                ]);
                await assert.rejects(
                    rpc(admin, "save_taxonomy_topic", [
                        child,
                        payload("Lost update", parent),
                        1,
                    ]),
                    /Stale taxonomy version/,
                );
                assert.equal(
                    await sql(
                        `select row_to_json(x)
                         from (select * from public.lecturer_topics where user_id = '${lecturer}' and topic_id = '${child}') x`,
                    ),
                    before,
                );
                assert.equal(
                    await sql(`select version
                               from public.topics
                               where id = '${child}'`),
                    "2",
                );
            },
        );
        await check(
            "Archive preserves links, hides default discovery, blocks every new selection and active children",
            async () => {
                await assert.rejects(
                    rpc(admin, "set_taxonomy_topic_archived", [parent, true, 1]),
                    /Archive active children first/,
                );
                await rpc(admin, "set_taxonomy_topic_archived", [child, true, 2]);
                assert.deepEqual(
                    await rpc(
                        lecturer,
                        "taxonomy_catalogue",
                        ["Renamed child", "", false],
                        "aal1",
                    ),
                    [],
                );
                await assert.rejects(
                    rpc(lecturer, "taxonomy_catalogue", ["", "", true], "aal1"),
                    /taxonomy.manage.*required/i,
                );
                const archived = await rpc(admin, "taxonomy_catalogue", [
                    "Renamed child",
                    "",
                    true,
                ]);
                assert.ok(archived[0].archived_at);
                assert.equal(archived[0].version, 3);
                assert.equal(
                    await sql(
                        `select count(*)
                         from public.lecturer_topics
                         where user_id = '${lecturer}'
                           and topic_id = '${child}'
                           and verified`,
                    ),
                    "1",
                );
                await assert.rejects(
                    sql(
                        `insert into public.lecturer_topics(user_id, topic_id)
                         values ('${manager}', '${child}')`,
                    ),
                    /Archived taxonomy entry/,
                );
                const otherTemplate = randomUUID(),
                    otherJob = randomUUID();
                await sql(
                    `insert into public.course_templates(id, title)
                     values ('${otherTemplate}', 'Other');
                    insert into public.jobs(id, title, customer_name, delivery_type, amount, currency, rate_unit, total_amount, terms)
                    values ('${otherJob}', 'Other', 'Fictional', 'online', 1, 'EUR', 'fixed_total', 1, 'Terms')`,
                );
                await assert.rejects(
                    sql(
                        `insert into public.course_template_topics(template_id, topic_id)
                         values ('${otherTemplate}', '${child}')`,
                    ),
                    /Archived taxonomy entry/,
                );
                await assert.rejects(
                    sql(
                        `insert into public.job_requirements(job_id, topic_id)
                         values ('${otherJob}', '${child}')`,
                    ),
                    /Archived taxonomy entry/,
                );
                await rpc(admin, "set_taxonomy_topic_archived", [parent, true, 1]);
                await assert.rejects(
                    rpc(admin, "set_taxonomy_topic_archived", [child, false, 3]),
                    /Archived taxonomy parent/,
                );
                await rpc(admin, "set_taxonomy_topic_archived", [parent, false, 2]);
                await rpc(admin, "set_taxonomy_topic_archived", [child, false, 3]);
            },
        );
        await check(
            "Direct actor writes, anonymous calls and old suspended tokens remain denied",
            async () => {
                await assert.rejects(
                    actor(
                        admin,
                        `update public.topics
                         set label_de='Forged'
                         where id = '${child}'`,
                        "aal1",
                    ),
                    /permission denied/,
                );
                await sql(
                    `update public.profiles
                     set active= false
                     where id = '${admin}'`,
                );
                await assert.rejects(
                    rpc(admin, "save_taxonomy_topic", [null, payload("Suspended"), 0]),
                    /taxonomy.manage.*required/i,
                );
                await assert.rejects(
                    rpc(admin, "taxonomy_catalogue"),
                    /Active login required/,
                );
                assert.equal(
                    await actor(admin, "select count(*) from public.topics", "aal1"),
                    "0",
                );
            },
        );
        console.log(`${checks} taxonomy PostgreSQL checks passed.`);
    },
    {migrationsThrough: "20261115203718"},
);

await withTestDatabase(
    "taxonomy_legacy_test",
    async ({sql}) => {
        const a = randomUUID(),
            b = randomUUID();
        await sql(
            `insert into public.topics(id,label_de,label_en,kind) values('${a}','Legacy A','Legacy A','topic'),('${b}','Legacy B','Legacy B','topic');update public.topics set parent_id='${b}' where id='${a}';update public.topics set parent_id='${a}' where id='${b}'`,
        );
        const before = await sql(
            `select jsonb_agg(to_jsonb(t) order by id) from public.topics t`,
        );
        await assert.rejects(
            sql(
                await readFile(
                    new URL(
                        "../supabase/migrations/20261115203718_taxonomy_catalogue_management.sql",
                        import.meta.url,
                    ),
                    "utf8",
                ),
            ),
            /Existing taxonomy parent cycle requires review/,
        );
        assert.equal(
            await sql(
                `select jsonb_agg(to_jsonb(t) order by id) from public.topics t`,
            ),
            before,
        );
        assert.equal(
            await sql(
                `select count(*) from information_schema.columns where table_schema='public' and table_name='topics' and column_name='version'`,
            ),
            "0",
        );
        console.log(
            "PASS Invalid historical hierarchy aborts the complete additive migration without rewriting existing data (1 legacy taxonomy check).",
        );
    },
    {migrationsThrough: "20261115180559"},
);