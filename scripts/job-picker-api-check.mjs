/** Auth/password-only authentication/REST proof for purpose-scoped metadata; canonical disposable stack only. */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {withApiFixture} from "./testing/api.mjs";
import {quoteSql as q} from "./testing/database.mjs";
import {enablePremiumAndLinkParticipant} from "./testing/company-participant.mjs";

await withApiFixture(
    async ({actor, passwordOnly, service, checked, sql, defer, suffix}) => {
        const admin = await actor("picker-admin", "admin"),
            teacher = await actor("picker-teacher", "lecturer"),
            learner = await actor("picker-learner", "participant"),
            client = await actor("picker-client", "client");
        const org = randomUUID(),
            template = randomUUID(),
            oldTemplate = randomUUID(),
            ids = Array.from({length: 1057}, randomUUID).sort(),
            runs = Array.from({length: 1057}, randomUUID).sort(),
            duplicate = randomUUID(),
            standalone = randomUUID();
        const label = `Fictional picker ${suffix}`,
            courseName = `${label} course`,
            needle = `${label} literal %_`,
            created = "2040-01-01T00:00:00Z";
        defer(async () => {
            await sql(
                `delete
                 from public.chat_members
                 where room_id in (select id from public.chat_rooms where owner_id = '${admin.id}');
                delete
                from public.chat_rooms
                where owner_id = '${admin.id}';
                update public.documents
                set current_version_id=null
                where owner_id = '${admin.id}';
                delete
                from public.document_versions
                where document_id in (select id from public.documents where owner_id = '${admin.id}');
                delete
                from public.documents
                where owner_id = '${admin.id}';
                delete
                from public.jobs
                where created_by = '${admin.id}';
                delete
                from public.course_enrolments
                where course_run_id = '${runs[0]}';
                delete
                from public.course_sessions
                where course_run_id in (select id from public.course_runs where organisation_id = '${org}');
                delete
                from public.course_runs
                where organisation_id = '${org}';
                delete
                from public.course_templates
                where id in ('${template}', '${oldTemplate}');
                delete
                from private.company_premium_audit
                where organisation_id = '${org}';
                delete
                from public.client_organisation_memberships
                where organisation_id = '${org}' and user_id = '${client.id}';
                delete
                from public.organisations
                where id = '${org}';`,
            );
        });
        await checked(
            service.from("organisations").insert({id: org, name: label}),
            "Create own fictional organisation",
        );
        await checked(
            service.from("course_templates").insert([
                {id: template, title: courseName},
                {id: oldTemplate, title: needle},
            ]),
            "Create owned course titles",
        );
        for (let offset = 0; offset < runs.length; offset += 100) {
            const part = runs.slice(offset, offset + 100);
            await checked(
                service.from("course_runs").insert(
                    part.map((id, i) => ({
                        id,
                        template_id: offset + i === 0 ? oldTemplate : template,
                        organisation_id: org,
                        created_at: created,
                    })),
                ),
                "Create owned course run page",
            );
            await checked(
                service.from("jobs").insert(
                    part.map((course_run_id, i) => ({
                        id: ids[offset + i],
                        course_run_id,
                        title: `Hidden commercial ${suffix} ${offset + i}`,
                        customer_name: label,
                        delivery_type: "online",
                        status: "draft",
                        amount: 25,
                        total_amount: 100,
                        currency: "EUR",
                        rate_unit: "fixed_total",
                        terms: "Fictional private terms",
                        requires_contract: false,
                        created_at: created,
                        created_by: admin.id,
                    })),
                ),
                "Create owned offer page",
            );
        }
        await checked(
            service.from("jobs").insert(
                [
                    {
                        id: duplicate,
                        course_run_id: runs[0],
                        title: `Hidden duplicate ${suffix}`,
                    },
                    {
                        id: standalone,
                        course_run_id: null,
                        title: `Hidden standalone ${suffix}`,
                    },
                ].map((row) => ({
                    ...row,
                    customer_name: label,
                    delivery_type: "online",
                    status: "draft",
                    amount: 25,
                    total_amount: 100,
                    currency: "EUR",
                    rate_unit: "fixed_total",
                    terms: "Fictional private terms",
                    requires_contract: false,
                    created_at: "2041-01-01T00:00:00Z",
                    created_by: admin.id,
                })),
            ),
            "Create duplicate-run and standalone offers",
        );
        await checked(
            service.from("course_sessions").insert({
                course_run_id: runs[0],
                starts_at: "2060-01-01T08:00:00Z",
                ends_at: "2060-01-01T10:00:00Z",
            }),
            "Create exact course schedule metadata",
        );
        for (const purpose of ["job_attachment", "participant_course"]) {
            assert.ok(
                Array.isArray(
                    (
                        await admin.client.rpc("job_picker", {p_purpose: purpose})
                    ).data?.items,
                ),
                `Current admin permission authorizes the ${purpose} picker`,
            );
            for (const who of [teacher, learner, client])
                assert.equal(
                    (await who.client.rpc("job_picker", {p_purpose: purpose})).error
                        ?.code,
                    "42501",
                );
        }
        await passwordOnly(admin.client);
        const old = await checked(
            admin.client
                .from("jobs")
                .select("id")
                .eq("created_by", admin.id)
                .order("created_at", {ascending: false})
                .order("id", {ascending: false}),
            "Reproduce actual old full-table cap",
        );
        assert.equal(old.length, 1000);
        assert.ok(!old.some((row) => row.id === ids[0]));
        const read = async (purpose, extra = {}) =>
            checked(
                admin.client.rpc("job_picker", {
                    p_purpose: purpose,
                    p_search: label,
                    p_limit: 100,
                    ...extra,
                }),
                "Read actual purpose metadata",
            );
        for (const [purpose, count] of [
            ["job_attachment", 1059],
            ["participant_course", 1057],
        ]) {
            let cursor = null,
                items = [];
            do {
                const page = await read(purpose, {p_cursor: cursor});
                assert.ok(page.items.length <= 100);
                items.push(...page.items);
                cursor = page.next_cursor;
                assert.equal(page.has_more, Boolean(cursor));
            } while (cursor);
            assert.equal(items.length, count);
            assert.equal(
                new Set(
                    items.map((row) =>
                        purpose === "participant_course" ? row.course_run_id : row.id,
                    ),
                ).size,
                count,
            );
            for (const row of items)
                assert.deepEqual(Object.keys(row).sort(), [
                    "course_run_id",
                    "customer_name",
                    "id",
                    "starts_at",
                    "time_zone",
                    "title",
                ]);
        }
        const course = await read("participant_course", {
            p_search: needle,
            p_selected_id: duplicate,
        });
        assert.equal(course.items.length, 1);
        assert.equal(course.items[0].id, ids[0]);
        assert.equal(course.items[0].title, needle);
        assert.equal(course.selected.id, duplicate);
        assert.equal(course.selected.title, needle);
        assert.equal(
            (
                await read("participant_course", {
                    p_search: `Hidden commercial ${suffix}`,
                })
            ).items.length,
            0,
        );
        const first = await read("job_attachment", {p_limit: 1});
        assert.equal(
            (
                await admin.client.rpc("job_picker", {
                    p_purpose: "participant_course",
                    p_search: label,
                    p_cursor: first.next_cursor,
                })
            ).error?.code,
            "22023",
        );
        const chatArgs = {
            p_title: label,
            p_kind: "participant_course",
            p_member_ids: [learner.id],
            p_job_id: course.items[0].id,
        };
        const withoutPremium = await admin.client.rpc("create_chat_group", chatArgs);
        assert.equal(withoutPremium.error?.code, "42501");
        assert.match(withoutPremium.error?.message ?? "", /Company Premium LMS is OFF/);
        await checked(admin.client.rpc("manage_client_organisation", {
            p_user_id: client.id,
            p_organisation_id: org,
            p_remove: false,
        }), "Link the authorised company actor for this course");
        await enablePremiumAndLinkParticipant({admin, company: client, learner, organisation: org, service, checked});
        await checked(admin.client.rpc("manage_course_enrolment", {
            p_course_run_id: runs[0],
            p_user_id: learner.id,
            p_status: "enrolled",
        }), "Enrol the consenting participant in the exact selected course");
        const room = await checked(
            admin.client.rpc("create_chat_group", chatArgs),
            "Create participant channel from selected binding",
        );
        const channel = await checked(
            service
                .from("chat_rooms")
                .select("course_run_id,job_id")
                .eq("id", room)
                .single(),
            "Read actual resulting participant scope",
        );
        assert.equal(channel.course_run_id, runs[0]);
        assert.equal(channel.job_id, null);
        assert.deepEqual(
            await checked(learner.client.rpc("course_chat_rooms", {p_run_id: runs[0]})),
            [{id: room, title: label, can_post: true}],
        );
        assert.equal(
            (
                await admin.client.rpc("create_chat_group", {
                    p_title: label,
                    p_kind: "participant_course",
                    p_member_ids: [learner.id],
                    p_job_id: duplicate,
                })
            ).error?.code,
            "23505",
        );
        const fileChoice = (
            await read("job_attachment", {p_search: label, p_selected_id: ids[0]})
        ).selected;
        assert.equal(fileChoice.id, ids[0]);
        const upload = await checked(
            admin.client.rpc("reserve_document", {
                p_name: "Fictional-picker.txt",
                p_mime: "text/plain",
                p_size: 12,
                p_scope: "job_after",
                p_kind: "material",
                p_room_id: null,
                p_job_id: fileChoice.id,
                p_client_id: randomUUID(),
            }),
            "Bind selected exact offer to actual upload reservation",
        );
        const doc = await checked(
            service
                .from("documents")
                .select("job_id,scope,status")
                .eq("id", upload.document_id)
                .single(),
            "Read actual reservation scope",
        );
        assert.equal(doc.job_id, ids[0]);
        assert.equal(doc.scope, "job_after");
        assert.equal(doc.status, "quarantined");
        // Internal administrators may toggle their own regular lecturer role.
        // Prove a denied senior lecturer self-assignment leaves roles and audit
        // history unchanged before checking existing-token suspension.
        const actualRoles = () =>
            checked(
                admin.client
                    .from("user_roles")
                    .select("role")
                    .eq("user_id", admin.id)
                    .order("role"),
                "Read current actor roles through actual RLS",
            );
        const rolesBeforeSelfWrite = await actualRoles();
        assert.deepEqual(rolesBeforeSelfWrite, [{role: "admin"}]);
        const auditBeforeSelfWrite = await sql(
            `select count(*)
             from public.audit_events
             where actor_id = ${q(admin.id)}`,
        );
        assert.equal(
            (
                await admin.client.rpc("set_account_roles", {
                    p_user_id: admin.id,
                    p_roles: ["admin", "senior_lecturer"],
                })
            ).error?.code,
            "42501",
        );
        assert.deepEqual(await actualRoles(), rolesBeforeSelfWrite);
        assert.equal(
            await sql(
                `select count(*)
                 from public.audit_events
                 where actor_id = ${q(admin.id)}`,
            ),
            auditBeforeSelfWrite,
        );
        assert.ok(
            Number(
                await sql(
                    `select count(*)
                     from private.participant_chat_origins
                     where room_id = ${q(room)}`,
                ),
            ) > 0,
            "The created participant room records its membership origins",
        );
        await sql(`delete
                   from public.chat_members
                   where room_id = ${q(room)}`);
        await sql(`delete
                   from public.chat_rooms
                   where id = ${q(room)}`);
        assert.equal(
            await sql(
                `select count(*)
                 from private.participant_chat_origins
                 where room_id = ${q(room)}`,
            ),
            "0",
            "Deleting an owned room cascades its dependent membership-origin metadata",
        );
        await sql(
            `update public.profiles
             set active= false
             where id = ${q(admin.id)}`,
        );
        assert.equal(
            (
                await admin.client.rpc("job_picker", {
                    p_purpose: "job_attachment",
                    p_selected_id: ids[0],
                })
            ).error?.code,
            "42501",
        );
        console.log(
            "PASS: actual Auth/password-only authentication/REST scoped-picker roles; unchanged1000cap→1059jobs/1057distinctruns; literal/metadata privacy/cursor; real selected upload reservation and participant channel; senior lecturer self-assignment refused without role/audit mutation; existing-token suspension.",
        );
    },
);
