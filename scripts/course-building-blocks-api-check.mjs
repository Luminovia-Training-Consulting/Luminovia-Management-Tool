/**
 * Real Auth/HTTP checks for course templates with source provenance and jobs planned from them.
 * Separate fictional identities verify actual API results and denied access; responses are not browser mocks.
 */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {withApiFixture} from "./testing/api.mjs";
import {quoteSql as q} from "./testing/database.mjs";
import {enablePremiumAndLinkParticipant} from "./testing/company-participant.mjs";
import {assertLmsResponse} from "./testing/premium-lms-contract.mjs";

await withApiFixture(
    async ({service, actor, passwordOnly, sql, defer, checked}) => {
        const admin = await actor("course-admin", "admin"),
            manager = await actor("course-manager", "management"),
            teacher = await actor("course-teacher", "lecturer"),
            learner = await actor("course-participant", "participant"),
            client = await actor("course-client", "client");
        const runs = [],
            templates = [],
            orgs = [];
        // Cleanup is scoped to the IDs created below; canonical catalogue rows and
        // unrelated fixtures are retained. Auth deletion follows dependency cleanup.
        defer(async () => {
            if (runs.length) {
                const owned = runs.map(q).join(",");
                await sql(`
   delete from private.claim_revenue_ledger where job_id in(select id from public.jobs where course_run_id in(${owned}));
   delete from public.assignment_sessions where claim_id in(select c.id from public.job_claims c join public.jobs j on j.id=c.job_id where j.course_run_id in(${owned}));
   delete from public.claim_events where claim_id in(select c.id from public.job_claims c join public.jobs j on j.id=c.job_id where j.course_run_id in(${owned}));
   delete from public.notifications where user_id=${q(teacher.id)};
   delete from public.chat_members where room_id in(select r.id from public.chat_rooms r join public.jobs j on j.id=r.job_id where j.course_run_id in(${owned}));
   delete from public.chat_rooms where job_id in(select id from public.jobs where course_run_id in(${owned}));
   delete from public.job_claims where job_id in(select id from public.jobs where course_run_id in(${owned}));
   delete from private.course_run_job_requests where course_run_id in(${owned});
   delete from private.client_course_requests where job_id in(select id from public.jobs where course_run_id in(${owned}));
   delete from private.job_commission_offers where job_id in(select id from public.jobs where course_run_id in(${owned}));
   delete from public.job_requirements where job_id in(select id from public.jobs where course_run_id in(${owned}));
   delete from public.job_sessions where job_id in(select id from public.jobs where course_run_id in(${owned}));
   delete from public.jobs where course_run_id in(${owned});
   delete from public.course_enrolments where course_run_id in(${owned});
   delete from public.course_sessions where course_run_id in(${owned});
   delete from public.course_runs where id in(${owned});`);
            }
            if (templates.length)
                await sql(
                    `delete from public.course_template_topics where template_id in(${templates.map(q).join(",")});delete from public.course_templates where id in(${templates.map(q).join(",")});`,
                );
            if (orgs.length)
                await sql(
                    `delete from private.company_premium_audit where organisation_id in(${orgs.map(q).join(",")});delete from public.client_organisation_memberships where organisation_id in(${orgs.map(q).join(",")});delete from public.organisation_private_details where organisation_id in(${orgs.map(q).join(",")});delete from public.organisations where id in(${orgs.map(q).join(",")});`,
                );
        });
        const catalogue = await checked(
            teacher.client
                .from("building_blocks")
                .select("id,code,default_template_id,building_block_sources(*)")
                .order("code"),
        );
        assert.equal(catalogue.length, 22);
        assert.equal(
            catalogue.flatMap((row) => row.building_block_sources).length,
            24,
        );
        const block = catalogue.find((row) => row.code === "LPC3"),
            primary = block.building_block_sources.find(
                (row) => row.is_primary,
            );
        assert.equal(primary.file_name, "Bausteinbeschreibung-LPIC3.pdf");
        assert.deepEqual(
            await checked(client.client.from("building_blocks").select("id")),
            [],
            "An unlinked client sees no building blocks",
        );
        assert.equal(
            (await learner.client.from("building_blocks").select("id")).error
                ?.code,
            "42501",
            "Unenrolled participants cannot read the operational building-block catalogue",
        );
        assert.ok(
            (
                await admin.client.rpc("course_run_job_defaults", {
                    p_course_run_id: randomUUID(),
                })
            ).error,
        );
        await passwordOnly(admin.client);
        await passwordOnly(manager.client);
        const templatePayload = {title: "Fictional ordinary authoring template", topic_ids: []};
        const unauthorizedTemplate = await teacher.client.rpc("save_course_template", {
            p_id: null, p_payload: templatePayload,
        });
        assert.equal(unauthorizedTemplate.status, 403);
        const authored = await checked(admin.client.rpc("save_course_template", {
            p_id: null, p_payload: templatePayload,
        }));
        templates.push(authored);
        assertLmsResponse("save_course_template", authored);
        await checked(
            admin.client.rpc("save_lecturer_compensation", {
                p_user_id: teacher.id,
                p_mode: "percent",
                p_percent: 31,
                p_daily_rate: 200,
                p_currency: "EUR",
                p_expected_version: 1,
            }),
            "Set fictional course-building-block lecturer quote",
        );
        const org = await checked(
            admin.client.rpc("save_organisation", {
                p_id: null,
                p_payload: {
                    name: `Fictional course building-block API ${randomUUID()}`,
                    time_zone: "Europe/Berlin",
                },
            }),
        );
        orgs.push(org);
        await checked(
            admin.client.rpc("manage_client_organisation", {
                p_user_id: client.id,
                p_organisation_id: org,
                p_remove: false,
            }),
        );
        await enablePremiumAndLinkParticipant({
            admin,
            company: client,
            learner,
            organisation: org,
            service,
            checked,
        });
        const template = await checked(
            admin.client.rpc("duplicate_course_template", {
                p_id: block.default_template_id,
                p_title: `Fictional course building-block API ${randomUUID()}`,
            }),
        );
        templates.push(template);
        /** Creates controlled fictional session intervals to test whole-block offers. */
        const sessions = (offset) =>
            [0, 1].map((day) => ({
                starts_at: `2037-07-${String(6 + offset + day).padStart(2, "0")}T08:00:00Z`,
                ends_at: `2037-07-${String(6 + offset + day).padStart(2, "0")}T14:00:00Z`,
            }));
        /** Plans the concrete run with controlled dates from the selected course template. */
        const runPayload = (offset = 0) => ({
            template_id: template,
            organisation_id: org,
            time_zone: "Europe/Berlin",
            delivery_type: "online",
            venue: "Fictional course building-block access",
            published: false,
            sessions: sessions(offset),
        });
        /** Plans a real course run from the referenced template rather than merely setting a screen state. */
        const createRun = async (offset = 0) => {
            const id = await checked(
                admin.client.rpc("save_course_run", {
                    p_id: null,
                    p_payload: runPayload(offset),
                }),
            );
            runs.push(id);
            return id;
        };
        const run = await createRun();
        const before = await checked(
            admin.client.rpc("course_run_job_defaults", {p_course_run_id: run}),
        );
        /** Binds the fee draft to the source revision already read; gross and net stay explicit variants. */
        const fee = (revision, gross = true) => ({
            source_revision: revision,
            ...(gross
                ? {gross_amount: 100.01, gross_total_amount: 200.02}
                : {amount: 50, total_amount: 100}),
            currency: "EUR",
            rate_unit: "per_day",
            terms: "Fictional run-backed complete teaching assignment",
            requires_contract: false,
            status: "published",
        });
        await checked(
            admin.client.rpc("save_course_run", {
                p_id: run,
                p_payload: runPayload(1),
            }),
        );
        const stale = await admin.client.rpc("create_course_run_job", {
            p_course_run_id: run,
            p_payload: fee(before.source_revision),
            p_client_id: randomUUID(),
        });
        assert.equal(stale.status, 400);
        assert.match(stale.error.message, /course_run_source_changed/);
        assert.equal(
            (
                await checked(
                    service.from("jobs").select("id").eq("course_run_id", run),
                )
            ).length,
            0,
        );
        const preview = await checked(
            admin.client.rpc("course_run_job_defaults", {p_course_run_id: run}),
        );
        assertLmsResponse("course_run_job_defaults", preview);
        assert.equal(preview.building_block_source_id, primary.id);
        assert.notEqual(before.source_revision, preview.source_revision);
        assert.ok(
            (
                await teacher.client.rpc("create_course_run_job", {
                    p_course_run_id: run,
                    p_payload: fee(preview.source_revision),
                    p_client_id: randomUUID(),
                })
            ).error,
        );
        assert.ok(
            (
                await admin.client.rpc("create_course_run_job", {
                    p_course_run_id: run,
                    p_payload: {...fee(preview.source_revision), sessions: []},
                    p_client_id: randomUUID(),
                })
            ).error,
        );
        const request = randomUUID(),
            payload = fee(preview.source_revision);
        const job = await checked(
            admin.client.rpc("create_course_run_job", {
                p_course_run_id: run,
                p_payload: payload,
                p_client_id: request,
            }),
        );
        assertLmsResponse("create_course_run_job", job);
        assert.equal(
            await checked(
                admin.client.rpc("create_course_run_job", {
                    p_course_run_id: run,
                    p_payload: payload,
                    p_client_id: request,
                }),
            ),
            job,
        );
        const optionalPayload = Object.fromEntries(
            Object.entries(payload).filter(([key]) => key !== "terms"),
        );
        const another = await checked(admin.client.rpc("create_course_run_job", {
            p_course_run_id: run,
            p_payload: optionalPayload,
            p_client_id: randomUUID(),
        }));
        assert.notEqual(another, job);
        const actual = await checked(
            teacher.client
                .from("jobs")
                .select("*,job_sessions(*)")
                .eq("id", job)
                .single(),
        );
        assert.equal(actual.course_run_id, run);
        assert.equal(actual.amount, 0);
        assert.equal(actual.total_amount, 0);
        const quote = (await checked(teacher.client.rpc("job_offers"))).find(
            (row) => row.id === job,
        );
        assert.equal(quote.amount, 31);
        assert.equal(quote.total_amount, 62.01);
        assert.equal(actual.job_sessions.length, 2);
        assert.deepEqual(
            actual.job_sessions.map((row) => row.course_session_id).sort(),
            preview.sessions.map((row) => row.source_course_session_id).sort(),
        );
        assert.ok(!JSON.stringify(actual).includes("gross_amount"));
        assert.ok(!JSON.stringify(actual).includes("platform_percent"));
        const source = await checked(
            teacher.client.rpc("job_building_block_reference", {p_job_id: job}),
        );
        assertLmsResponse("job_building_block_reference", source);
        assert.equal(source.source_id, primary.id);
        assert.ok(
            (
                await learner.client.rpc("job_building_block_reference", {
                    p_job_id: job,
                })
            ).error,
        );
        const requests = await checked(client.client.rpc("client_requests"));
        assert.equal(
            requests.find((row) => row.job_id === job).gross_total_amount,
            200.02,
        );
        const managerRun = await createRun(5),
            managerPreview = await checked(
                manager.client.rpc("course_run_job_defaults", {
                    p_course_run_id: managerRun,
                }),
            );
        assert.ok(
            (
                await manager.client.rpc("create_course_run_job", {
                    p_course_run_id: managerRun,
                    p_payload: fee(managerPreview.source_revision),
                    p_client_id: randomUUID(),
                })
            ).error,
        );
        const managerJob = await checked(
            manager.client.rpc("create_course_run_job", {
                p_course_run_id: managerRun,
                p_payload: fee(managerPreview.source_revision, false),
                p_client_id: randomUUID(),
            }),
        );
        const report = await checked(admin.client.rpc("commission_report"));
        const legacy = report.find((row) => row.job_id === managerJob);
        assert.equal(legacy.pricing_model, "legacy_net");
        assert.equal(legacy.gross_total_amount, null);
        assert.ok(
            !(await checked(client.client.rpc("client_requests"))).some(
                (row) => row.job_id === managerJob,
            ),
        );
        const raceRun = await createRun(10),
            racePreview = await checked(
                admin.client.rpc("course_run_job_defaults", {
                    p_course_run_id: raceRun,
                }),
            );
        // Real simultaneous publication requests use the same source revision; sequential calls would not prove concurrency.
        const race = await Promise.all([
            admin.client.rpc("create_course_run_job", {
                p_course_run_id: raceRun,
                p_payload: fee(racePreview.source_revision),
                p_client_id: randomUUID(),
            }),
            manager.client.rpc("create_course_run_job", {
                p_course_run_id: raceRun,
                p_payload: fee(racePreview.source_revision, false),
                p_client_id: randomUUID(),
            }),
        ]);
        assert.equal(race.filter((row) => !row.error).length, 2);
        assert.equal(
            (
                await checked(
                    service
                        .from("jobs")
                        .select("id")
                        .eq("course_run_id", raceRun),
                )
            ).length,
            2,
        );
        await checked(
            admin.client.rpc("manage_course_enrolment", {
                p_course_run_id: run,
                p_user_id: learner.id,
                p_status: "enrolled",
            }),
        );
        const workspace = await checked(
            learner.client.rpc("course_workspace", {p_run_id: run}),
        );
        assert.equal(workspace.id, run);
        assert.equal(workspace.access.learner, true);
        assert.equal(
            (await learner.client.from("building_blocks").select("id")).error
                ?.code,
            "42501",
        );
        await checked(
            admin.client.rpc("manage_course_enrolment", {
                p_course_run_id: run,
                p_user_id: learner.id,
                p_status: "removed",
            }),
        );
        assert.equal(
            (await learner.client.rpc("course_workspace", {p_run_id: run}))
                .error?.code,
            "42501",
            "Enrolment removal revokes the same participant's scoped workspace",
        );
        assert.equal(
            (await learner.client.from("building_blocks").select("id")).error
                ?.code,
            "42501",
        );
        const claim = await checked(
            teacher.client.rpc("claim_job", {
                p_job_id: job,
                p_idempotency_key: randomUUID(),
                p_terms_version: quote.terms_version,
            }),
        );
        assert.equal(claim.status, "confirmed");
        assert.equal(
            (
                await checked(
                    teacher.client
                        .from("assignment_sessions")
                        .select("id")
                        .eq("claim_id", claim.claim_id),
                )
            ).length,
            2,
        );
        assert.equal(
            (await checked(client.client.rpc("client_requests"))).find(
                (row) => row.job_id === job,
            ).assigned_lecturer_id,
            teacher.id,
        );
        assert.ok(
            (
                await admin.client.rpc("set_job_commission", {
                    p_job_id: job,
                    p_gross_amount: 200,
                    p_gross_total_amount: 400,
                })
            ).error,
        );
        const alias = block.building_block_sources.find(
            (row) => !row.is_primary,
        );
        const sourceWrite = await service
            .from("course_templates")
            .update({building_block_source_id: alias.id})
            .eq("id", template);
        assert.equal(sourceWrite.error.code, "23514");
        await checked(
            admin.client.rpc("set_user_active", {
                p_user_id: teacher.id,
                p_active: false,
            }),
        );
        assert.ok(
            (
                await teacher.client.rpc("job_building_block_reference", {
                    p_job_id: job,
                })
            ).error,
        );
        assert.equal(
            (await teacher.client.from("building_blocks").select("id")).error
                ?.code,
            "42501",
            "Suspended staff are denied at the authenticated request boundary",
        );
        await checked(
            admin.client.rpc("manage_client_organisation", {
                p_user_id: client.id,
                p_organisation_id: org,
                p_remove: true,
            }),
        );
        assert.deepEqual(
            await checked(client.client.rpc("client_requests")),
            [],
        );
        console.log(
            "PASS: actual Auth/password-only authentication/REST course building-block catalogue, exact PDF provenance, stale-source denial, run/session identity, gross/net isolation, idempotency/atomic competing offers, real whole-block claim, source freeze, scoped learner/client revocation and suspension.",
        );
    },
);
