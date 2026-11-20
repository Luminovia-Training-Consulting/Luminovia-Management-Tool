/** Actual Auth, password-only authentication, REST, Edge scanning and Storage for preparation. This
 * harness refuses normal, hosted or user-owned business databases. */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {withApiFixture} from "./testing/api.mjs";

await withApiFixture(
    async ({service, actor, passwordOnly, checked, sql, defer, url}) => {
        const teacher = await actor("readiness-teacher", "lecturer"),
            peer = await actor("readiness-peer", "lecturer"),
            admin = await actor("readiness-admin", "admin"),
            participant = await actor("readiness-participant", "participant");
        let job, run, organisation, template, document;
        const people = [teacher.id, peer.id, admin.id, participant.id]
            .map((id) => `'${id}'`)
            .join(",");
        defer(async () => {
            if (document) {
                const versions = await checked(
                    service
                        .from("document_versions")
                        .select("object_path")
                        .eq("document_id", document.id),
                );
                for (const bucket of ["portal-clean", "portal-quarantine"])
                    await checked(
                        service.storage
                            .from(bucket)
                            .remove(versions.map((v) => v.object_path)),
                    );
                await sql(
                    `update public.documents
                     set current_version_id=null
                     where id = '${document.id}';
                    delete
                    from public.document_versions
                    where document_id = '${document.id}';
                    delete
                    from public.documents
                    where id = '${document.id}'`,
                );
            }
            if (run)
                await sql(
                    `delete
                     from private.course_readiness_events
                     where course_run_id = '${run}';
                    delete
                    from private.course_readiness_requests
                    where actor_id in (${people});
                    delete
                    from private.course_instruction_receipts
                    where course_run_id = '${run}';
                    delete
                    from private.course_readiness_tasks
                    where course_run_id = '${run}';
                    delete
                    from private.course_readiness_settings
                    where course_run_id = '${run}'`,
                );
            if (job)
                await sql(
                    `delete
                     from public.notifications
                     where user_id in (${people});
                    delete
                    from public.chat_members
                    where room_id in (select id from public.chat_rooms where job_id = '${job}');
                    delete
                    from public.chat_rooms
                    where job_id = '${job}';
                    delete
                    from public.claim_events
                    where claim_id in (select id from public.job_claims where job_id = '${job}');
                    delete
                    from public.assignment_sessions
                    where claim_id in (select id from public.job_claims where job_id = '${job}');
                    delete
                    from private.claim_revenue_ledger
                    where job_id = '${job}';
                    delete
                    from public.job_claims
                    where job_id = '${job}';
                    delete
                    from public.job_requirements
                    where job_id = '${job}';
                    delete
                    from public.job_sessions
                    where job_id = '${job}';
                    delete
                    from public.jobs
                    where id = '${job}'`,
                );
            if (run)
                await sql(
                    `delete
                     from public.course_sessions
                     where course_run_id = '${run}';
                    delete
                    from public.course_runs
                    where id = '${run}'`,
                );
            if (template)
                await checked(
                    service.from("course_templates").delete().eq("id", template),
                );
            if (organisation)
                await sql(
                    `delete
                     from public.organisation_contacts
                     where organisation_id = '${organisation}';
                    delete
                    from public.organisations
                    where id = '${organisation}'`,
                );
        });
        const cfg = {
            materials_required: true,
            customer_required: true,
            contact_required: true,
            agreement_required: false,
            instructions_required: true,
            instructions: "Fictional course instructions; literal <script> text.",
            meeting_url: "https://meeting.example.invalid/readiness",
            preparation_deadline: null,
        };
        assert.ok(
            (
                await admin.client.rpc("save_readiness_settings", {
                    p_course_run_id: randomUUID(),
                    p_payload: cfg,
                    p_expected_version: 0,
                    p_request_id: randomUUID(),
                })
            ).error,
            "password-only authentication is authoritative",
        );
        await passwordOnly(admin.client);
        job = await checked(
            admin.client.rpc("create_job", {
                p_payload: {
                    title: "Fictional readiness API course",
                    customer_name: "Fictional readiness API organisation",
                    delivery_type: "online",
                    status: "published",
                    amount: 100,
                    total_amount: 100,
                    currency: "AUD",
                    rate_unit: "fixed_total",
                    terms: "Fictional unchanged compensation",
                    requires_contract: false,
                    sessions: [
                        {
                            starts_at: "2064-01-01T08:00:00Z",
                            ends_at: "2064-01-01T09:00:00Z",
                        },
                        {
                            starts_at: "2064-01-02T08:00:00Z",
                            ends_at: "2064-01-02T09:00:00Z",
                        },
                    ],
                },
            }),
        );
        const row = await checked(
            service
                .from("jobs")
                .select("course_run_id,terms_version")
                .eq("id", job)
                .single(),
        );
        run = row.course_run_id;
        const runRow = await checked(
            service
                .from("course_runs")
                .select("template_id,organisation_id")
                .eq("id", run)
                .single(),
        );
        template = runRow.template_id;
        organisation = runRow.organisation_id;
        await checked(
            admin.client.rpc("save_organisation_contact", {
                p_id: null,
                p_organisation_id: organisation,
                p_payload: {
                    name: "Fictional private contact",
                    email: "private-readiness@example.invalid",
                    notes: "Restricted fictional contact notes",
                },
            }),
        );
        let version = row.terms_version;
        if (
            (await sql(
                "select to_regprocedure('public.job_offers()') is not null",
            )) === "t"
        )
            version = (await checked(teacher.client.rpc("job_offers"))).find(
                (item) => item.id === job,
            ).terms_version;
        const claim = await checked(
            teacher.client.rpc("claim_job", {
                p_job_id: job,
                p_idempotency_key: randomUUID(),
                p_terms_version: version,
            }),
        );
        assert.equal(claim.status, "confirmed");
        const snapshot = async (who) =>
            (
                await checked(
                    who.client.rpc("course_readiness", {p_course_run_id: run}),
                )
            )[0];
        for (const outsider of [peer, participant])
            assert.equal(
                (
                    await outsider.client.rpc("course_readiness", {
                        p_course_run_id: run,
                    })
                ).error?.code,
                "42501",
            );
        assert.equal((await snapshot(teacher)).can_manage, false);
        const settingsArgs = {
            p_course_run_id: run,
            p_payload: cfg,
            p_expected_version: 0,
            p_request_id: randomUUID(),
        };
        await checked(admin.client.rpc("save_readiness_settings", settingsArgs));
        await checked(admin.client.rpc("save_readiness_settings", settingsArgs));
        assert.equal((await snapshot(admin)).settings.version, 1);
        await checked(
            admin.client.rpc("confirm_course_sessions", {
                p_course_run_id: run,
                p_expected_version: 1,
                p_request_id: randomUUID(),
            }),
        );
        let state = await snapshot(teacher);
        assert.equal(
            state.checks.find((item) => item.code === "materials").complete,
            false,
        );
        assert.equal(
            state.checks.find((item) => item.code === "instructions").complete,
            false,
        );
        assert.notEqual(state.status, "ready");
        const {session} = await checked(admin.client.auth.getSession());
        const form = new FormData();
        form.set(
            "file",
            new File(
                ["Fictional scanned teaching material."],
                "Fictional readiness material.txt",
                {type: "text/plain"},
            ),
        );
        form.set("scope", "job_after");
        form.set("kind", "material");
        form.set("job_id", job);
        form.set("client_id", randomUUID());
        const uploaded = await fetch(`${url}/functions/v1/files`, {
            method: "POST",
            headers: {
                Origin: new URL(process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173")
                    .origin,
                Authorization: `Bearer ${session.access_token}`,
                apikey: process.env.SUPABASE_ANON_KEY,
            },
            body: form,
        });
        const body = await uploaded.json();
        if (body.document) document = body.document;
        assert.equal(uploaded.status, 200, JSON.stringify(body));
        assert.equal(document.status, "clean");
        state = await snapshot(teacher);
        assert.equal(
            state.checks.find((item) => item.code === "materials").complete,
            true,
        );
        assert.ok(state.documents.some((d) => d.id === document.id));
        const task = await checked(
            admin.client.rpc("save_readiness_task", {
                p_course_run_id: run,
                p_task_id: null,
                p_payload: {
                    title: "Fictional confirm preparation",
                    responsible_user_id: teacher.id,
                    required: true,
                    due_at: null,
                    archived: false,
                },
                p_expected_version: 0,
                p_request_id: randomUUID(),
            }),
        );
        assert.equal(
            (
                await peer.client.rpc("complete_readiness_task", {
                    p_task_id: task,
                    p_completed: true,
                    p_expected_version: 1,
                    p_request_id: randomUUID(),
                })
            ).error?.code,
            "42501",
        );
        await checked(
            teacher.client.rpc("complete_readiness_task", {
                p_task_id: task,
                p_completed: true,
                p_expected_version: 1,
                p_request_id: randomUUID(),
            }),
        );
        await checked(
            teacher.client.rpc("acknowledge_course_instructions", {
                p_course_run_id: run,
                p_instruction_version: state.settings.instruction_version,
                p_request_id: randomUUID(),
            }),
        );
        state = await snapshot(teacher);
        assert.equal(state.status, "ready");
        assert.equal(state.percentage, 100);
        assert.ok(
            !JSON.stringify(state).includes("private-readiness@example.invalid"),
        );
        assert.ok(
            !JSON.stringify(state).includes("Restricted fictional contact notes"),
        );
        const old = state.settings.version;
        await checked(
            admin.client.rpc("save_readiness_settings", {
                ...settingsArgs,
                p_payload: {...cfg, instructions: "Fictional revised instruction"},
                p_expected_version: old,
                p_request_id: randomUUID(),
            }),
        );
        assert.equal(
            (await snapshot(teacher)).checks.find(
                (item) => item.code === "instructions",
            ).complete,
            false,
        );
        assert.equal(
            (
                await teacher.client.rpc("acknowledge_course_instructions", {
                    p_course_run_id: run,
                    p_instruction_version: state.settings.instruction_version,
                    p_request_id: randomUUID(),
                })
            ).error?.code,
            "40001",
        );
        assert.equal(
            (
                await admin.client.rpc("save_readiness_settings", {
                    ...settingsArgs,
                    p_expected_version: old,
                    p_request_id: randomUUID(),
                })
            ).error?.code,
            "40001",
        );
        await checked(
            admin.client.rpc("set_user_active", {
                p_user_id: teacher.id,
                p_active: false,
            }),
        );
        assert.equal(
            (await teacher.client.rpc("course_readiness", {p_course_run_id: run}))
                .error?.code,
            "42501",
        );
        assert.equal(
            (await snapshot(admin)).checks.find((item) => item.code === "lecturer")
                .complete,
            false,
        );
        console.log(
            "PASS Actual Auth/password-only authentication/REST/Edge/ClamAV/Storage course readiness: assignment-only privacy, clean material availability, explicit applicability, schedule confirmation, versioned instructions and tasks, 100% only after committed requirements, stale denial and immediate suspension.",
        );
    },
);