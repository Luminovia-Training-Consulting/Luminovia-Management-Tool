/** Actual isolated Auth/password-only authentication/REST proof for optional job references and consented contacts. */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {createClient} from "@supabase/supabase-js";
import {withApiFixture} from "./testing/api.mjs";
import {quoteSql as q} from "./testing/database.mjs";

await withApiFixture(
    async ({service, actor, passwordOnly, sql, defer, checked, url}) => {
        const manager = await actor("briefing-manager", "admin"),
            teacher = await actor("briefing-teacher", "lecturer"),
            peer = await actor("briefing-peer", "lecturer"),
            learner = await actor("briefing-learner", "participant"),
            customer = await actor("briefing-client", "client");
        const users = [manager, teacher, peer, learner, customer].map(
            (user) => user.id,
        );
        const jobs = [],
            runs = [],
            templates = [],
            organisations = [];
        // Only this fixture's jobs, dependent records and fictional people are removed.
        defer(async () => {
            const actorIds = users.map(q).join(",");
            await sql(
                `delete
                 from private.job_lifecycle_requests
                 where actor_id in (${actorIds});
                delete
                from public.notifications
                where user_id in (${actorIds});`,
            );
            if (jobs.length) {
                const ids = jobs.map(q).join(",");
                await sql(
                    `delete
                     from public.notifications
                     where resource_id in (${ids});
                    delete
                    from private.claim_revenue_ledger
                    where job_id in (${ids});
                    delete
                    from public.chat_members
                    where room_id in (select id from public.chat_rooms where job_id in (${ids}));
                    delete
                    from public.chat_rooms
                    where job_id in (${ids});
                    delete
                    from public.claim_events
                    where claim_id in (select id from public.job_claims where job_id in (${ids}));
                    delete
                    from public.assignment_sessions
                    where claim_id in (select id from public.job_claims where job_id in (${ids}));
                    delete
                    from public.job_claims
                    where job_id in (${ids});
                    delete
                    from public.job_requirements
                    where job_id in (${ids});
                    delete
                    from public.job_sessions
                    where job_id in (${ids});
                    delete
                    from public.jobs
                    where id in (${ids});`,
                );
            }
            if (runs.length)
                await sql(
                    `delete
                     from public.course_sessions
                     where course_run_id in (${runs.map(q).join(",")});
                    delete
                    from public.course_runs
                    where id in (${runs.map(q).join(",")});`,
                );
            if (templates.length)
                await checked(
                    service.from("course_templates").delete().in("id", templates),
                );
            if (organisations.length)
                await checked(
                    service.from("organisations").delete().in("id", organisations),
                );
        });
        await passwordOnly(manager.client);
        // Existing atomic job creation is unchanged; optional information is added to its detail page.
        const create = async (day) => {
            const id = await checked(
                manager.client.rpc("create_job", {
                    p_payload: {
                        title: "Fictional optional job information",
                        customer_name: "Fictional briefing customer",
                        description: "Independent fictional assignment",
                        delivery_type: "online",
                        status: "published",
                        amount: 100,
                        total_amount: 100,
                        currency: "EUR",
                        rate_unit: "fixed_total",
                        terms: "Immutable accepted fictional terms",
                        requires_contract: false,
                        sessions: [
                            {
                                starts_at: `2052-01-${day}T08:00:00Z`,
                                ends_at: `2052-01-${day}T09:00:00Z`,
                            },
                        ],
                    },
                }),
            );
            jobs.push(id);
            const job = await checked(
                service.from("jobs").select("course_run_id").eq("id", id).single(),
            );
            runs.push(job.course_run_id);
            const run = await checked(
                service
                    .from("course_runs")
                    .select("template_id,organisation_id")
                    .eq("id", job.course_run_id)
                    .single(),
            );
            templates.push(run.template_id);
            organisations.push(run.organisation_id);
            return id;
        };
        const job = await create("10");
        const read = (who = teacher) =>
            checked(who.client.rpc("job_briefing", {p_job_id: job}));
        const save = (
            payload,
            version,
            request = randomUUID(),
            target = job,
            who = manager,
        ) =>
            who.client.rpc("save_job_briefing", {
                p_job_id: target,
                p_expected_version: version,
                p_request_id: request,
                p_payload: payload,
            });
        const initial = await read();
        assert.equal(initial.version, 0);
        assert.equal(initial.reference_url, "");
        assert.equal(initial.contact_email, "");
        assert.equal(initial.has_contact, false);
        const details = {
            reference_url: "https://example.invalid/assignments/course?cohort=one",
            reference_label: "Original assignment",
            reference_description:
                "Teaching according to this external brief. <script>literal text</script>",
            contact_name: "Fictional course coordination",
            contact_email: "coordination@example.invalid",
            contact_phone: "+49 (0) 40 123-456",
            contact_description: "Organisational questions only.",
            contact_visibility: "after_claim",
        };
        assert.equal(
            (await save(details, 0, randomUUID(), job, peer)).error?.code,
            "42501",
        );
        for (const who of [learner, customer])
            assert.equal(
                (await who.client.rpc("job_briefing", {p_job_id: job})).error?.code,
                "42501",
            );
        const anonymous = createClient(url, process.env.SUPABASE_ANON_KEY, {
            auth: {persistSession: false, autoRefreshToken: false},
        });
        assert.ok((await anonymous.rpc("job_briefing", {p_job_id: job})).error);
        const request = randomUUID();
        const saved = await checked(save(details, 0, request));
        assert.equal(saved.version, 1);
        assert.equal(saved.contact_visible, true);
        assert.equal(saved.contact_email, details.contact_email);
        const retries = await Promise.all(
            Array.from({length: 8}, () => save(details, 0, request)),
        );
        for (const retry of retries)
            assert.equal((await checked(Promise.resolve(retry))).version, 1);
        assert.equal(
            await sql(
                `select count(*)
                 from public.audit_events
                 where action ='job.briefing.saved' and resource_id=${q(job)}`,
            ),
            "1",
        );
        assert.equal(
            (await save({...details, contact_name: "Changed retry"}, 0, request))
                .error?.code,
            "22023",
        );
        assert.equal((await save(details, 1, request)).error?.code, "22023");
        const beforeClaim = await read();
        assert.equal(beforeClaim.reference_url, details.reference_url);
        assert.equal(
            beforeClaim.reference_description,
            details.reference_description,
        );
        assert.equal(beforeClaim.has_contact, true);
        assert.equal(beforeClaim.contact_visible, false);
        for (const key of [
            "contact_name",
            "contact_email",
            "contact_phone",
            "contact_description",
        ])
            assert.equal(beforeClaim[key], "");
        assert.ok(
            !JSON.stringify(
                await checked(
                    teacher.client.from("jobs").select("*").eq("id", job).single(),
                ),
            ).includes(details.contact_email),
        );
        for (const patch of [
            {reference_url: "javascript:alert(1)"},
            {reference_url: "https://user:password@example.invalid/x"},
            {reference_url: "https://example.invalid/\nInjected"},
            {reference_url: "https:///missing-host"},
            {reference_url: "https://[:::]/brief"},
            {reference_url: "https://example.invalid/a\\b"},
            {reference_url: "https://999.999.999.999/brief"},
            {reference_url: "https://example.invalid/a\uFEFFb"},
            {contact_email: "name\uFEFF@example.invalid"},
            {contact_email: "bad@example.invalid\r\nHeader: value"},
            {contact_phone: "123\n456"},
            {contact_name: "x".repeat(121)},
            {reference_description: "x".repeat(4001)},
            {contact_visibility: "public"},
            {actor_id: teacher.id},
            {contact_email: null},
        ])
            assert.equal(
                (await save({...details, ...patch}, 1)).error?.code,
                "22023",
            );
        assert.equal((await read(manager)).version, 1);
        await checked(save({...details, contact_visibility: "offer_viewers"}, 1));
        assert.equal((await read(peer)).contact_email, details.contact_email);
        await checked(save(details, 2));
        const race = await Promise.all(
            ["First", "Second"].map((reference_label) =>
                save({...details, reference_label}, 3),
            ),
        );
        assert.equal(race.filter((result) => !result.error).length, 1);
        assert.equal(
            race.filter((result) => result.error?.code === "40001").length,
            1,
        );
        const quote = (await checked(teacher.client.rpc("job_offers"))).find(
            (row) => row.id === job,
        );
        const claimed = await checked(
            teacher.client.rpc("claim_job", {
                p_job_id: job,
                p_idempotency_key: randomUUID(),
                p_terms_version: quote.terms_version,
            }),
        );
        assert.equal(claimed.status, "confirmed");
        assert.equal((await read()).contact_email, details.contact_email);
        const snapshot = () =>
            checked(
                service
                    .from("job_claims")
                    .select("amount,total_amount,currency,rate_unit,terms,terms_version")
                    .eq("id", claimed.claim_id)
                    .single(),
            );
        const accepted = await snapshot();
        await checked(save({...details, contact_phone: "+49 40 654321"}, 4));
        assert.deepEqual(await snapshot(), accepted);
        assert.equal((await read()).contact_phone, "+49 40 654321");
        // Existing claims do not preserve staff contacts after the current role is revoked.
        await checked(
            service.from("user_roles").delete().eq("user_id", teacher.id),
        );
        await checked(
            service.from("user_roles").insert({user_id: teacher.id, role: "guest"}),
        );
        assert.equal(
            (await teacher.client.rpc("job_briefing", {p_job_id: job})).error?.code,
            "42501",
        );
        await checked(
            service.from("user_roles").delete().eq("user_id", teacher.id),
        );
        await checked(
            service
                .from("user_roles")
                .insert({user_id: teacher.id, role: "lecturer"}),
        );
        assert.equal((await read()).contact_visible, true);
        await checked(
            teacher.client.rpc("cancel_job_assignment", {
                p_claim_id: claimed.claim_id,
                p_reason: "Fictional cancellation privacy check",
                p_request_id: randomUUID(),
            }),
        );
        assert.equal((await read()).contact_visible, false);
        assert.equal((await read()).contact_email, "");
        assert.deepEqual(await snapshot(), accepted);
        const archived = await create("12");
        const lifecycle = await checked(
            manager.client.rpc("job_lifecycle", {p_job_id: archived}),
        );
        await checked(
            manager.client.rpc("manage_job_offer", {
                p_job_id: archived,
                p_action: "archived",
                p_expected_version: lifecycle.version,
                p_request_id: randomUUID(),
                p_payload: {},
            }),
        );
        assert.ok((await save(details, 0, randomUUID(), archived)).error);
        await checked(
            service.from("profiles").update({active: false}).eq("id", teacher.id),
        );
        assert.equal(
            (await teacher.client.rpc("job_briefing", {p_job_id: job})).error?.code,
            "42501",
        );
        await checked(
            service.from("user_roles").delete().eq("user_id", manager.id),
        );
        assert.equal((await save(details, 5)).error?.code, "42501");
        console.log(
            "PASS actual Auth/password-only authentication/REST optional job briefing: exact references, strict validation, hidden/publicly consented contacts, claim/cancellation revocation, immutable accepted fees, retries/CAS races, archive and current-role boundaries.",
        );
    },
);