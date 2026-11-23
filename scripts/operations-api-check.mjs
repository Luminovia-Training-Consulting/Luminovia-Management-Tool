/**
 * Real Auth/HTTP checks for private customer data, reusable courses and actual course runs.
 * Separate fictional identities verify actual API results and denied access; responses are not browser mocks.
 */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {withApiFixture} from "./testing/api.mjs";
import {quoteSql as q} from "./testing/database.mjs";
import {enablePremiumAndLinkParticipant} from "./testing/company-participant.mjs";

await withApiFixture(async ({actor, checked, defer, passwordOnly, service, sql}) => {
    const orgs = [];
    const templates = [];
    const runs = [];
    const jobs = [];
    const tag = randomUUID();
    let count = 0;

    async function test(name, fn) {
        await fn();
        count++;
        console.log(`PASS ${name}`);
    }

    async function requireParticipantDenial(request) {
        const response = await request;
        assert.equal(response.status, 403);
        assert.equal(response.error?.code, "42501");
        assert.equal(response.data, null);
    }

    const admin = await actor("operations-admin", "admin"),
        lecturer = await actor("operations-lecturer", "lecturer"),
        participant = await actor("operations-participant", "participant"),
        company = await actor("operations-company", "client");
    defer(() => cleanupOperationFixtures({
        service, checked, sql, jobs, runs, templates, orgs,
        companyId: company.id, participantId: participant.id,
    }));
    await passwordOnly(admin.client);
    const base = {
        name: `Fictional operations ${tag}`,
        country: "DE",
        time_zone: "Europe/Berlin",
        city: "Fiktivstadt",
        industry: "Training",
        tags: ["Linux", "Python"],
        private_notes: `Private customer note ${tag}`,
        archived: false,
    };
    await test("Password-only lecturers cannot mutate customers/courses", async () => {
        assert.ok(
            (
                await lecturer.client.rpc("save_course_template", {
                    p_id: null,
                    p_payload: {title: "Forged"},
                })
            ).error,
        );
        assert.ok(
            (
                await lecturer.client.rpc("save_organisation", {
                    p_id: null,
                    p_payload: base,
                })
            ).error,
        );
    });
    let org, contact, template, run, copyRun, job;
    await test("Password-only admin creates organisation, private notes and business contact", async () => {
        org = await checked(
            admin.client.rpc("save_organisation", {p_id: null, p_payload: base}),
            "Create organisation",
        );
        orgs.push(org);
        contact = await checked(
            admin.client.rpc("save_organisation_contact", {
                p_id: null,
                p_organisation_id: org,
                p_payload: {
                    name: "Fiktive Ansprechperson",
                    position: "Kursplanung",
                    email: "contact@example.invalid",
                    phone: "+490000000",
                    notes: `Private contact ${tag}`,
                },
            }),
            "Create private contact",
        );
        const saved = await checked(
            admin.client
                .from("organisation_private_details")
                .select("private_notes")
                .eq("organisation_id", org)
                .single(),
            "Read authorised notes",
        );
        assert.equal(saved.private_notes, base.private_notes);
    });
    await test("Invalid timezone/contact cannot partially commit", async () => {
        assert.ok(
            (
                await admin.client.rpc("save_organisation", {
                    p_id: null,
                    p_payload: {
                        ...base,
                        name: `Bad timezone ${tag}`,
                        time_zone: "Invalid/Zone",
                    },
                })
            ).error,
        );
        assert.equal(
            (
                await checked(
                    service
                        .from("organisations")
                        .select("id")
                        .eq("name", `Bad timezone ${tag}`),
                    "Check rollback",
                )
            ).length,
            0,
        );
        assert.ok(
            (
                await admin.client.rpc("save_organisation_contact", {
                    p_id: null,
                    p_organisation_id: org,
                    p_payload: {name: "Bad", email: "javascript:invalid"},
                })
            ).error,
        );
    });
    const topic = (
        await checked(
            service.from("topics").select("id").limit(1),
            "Read fixture topic",
        )
    )[0]?.id;
    const course = {
        title: `Fictional course ${tag}`,
        description: "Reusable course description",
        syllabus: 'echo "<script>text only</script>"',
        prerequisites: "Shell basics",
        topic_ids: topic ? [topic] : [],
        archived: false,
    };
    await test("Reusable course template persists syllabus and dynamic topics", async () => {
        template = await checked(
            admin.client.rpc("save_course_template", {
                p_id: null,
                p_payload: course,
            }),
            "Create course template",
        );
        templates.push(template);
        const saved = await checked(
            admin.client
                .from("course_templates")
                .select("syllabus,course_template_topics(*)")
                .eq("id", template)
                .single(),
            "Read template",
        );
        assert.equal(saved.syllabus, course.syllabus);
        assert.equal(saved.course_template_topics.length, course.topic_ids.length);
    });
    const first = new Date(Date.now() + 80 * 86400000);
    first.setUTCHours(8, 0, 0, 0);
    const sessions = [0, 1].map((day) => ({
        starts_at: new Date(+first + day * 86400000).toISOString(),
        ends_at: new Date(+first + day * 86400000 + 5 * 3600000).toISOString(),
    }));
    const runPayload = {
        template_id: template,
        organisation_id: org,
        time_zone: "Europe/Berlin",
        delivery_type: "online",
        venue: "Private course access supplied separately",
        published: false,
        archived: false,
        sessions,
    };
    await test("Draft run, sessions and template denied to unassigned lecturer and participant", async () => {
        run = await checked(
            admin.client.rpc("save_course_run", {
                p_id: null,
                p_payload: runPayload,
            }),
            "Create actual run",
        );
        runs.push(run);
        const directCourseRows = (who) => [
            who.client.from("course_runs").select("id").eq("id", run),
            who.client.from("course_templates").select("id").eq("id", template),
            who.client.from("course_sessions").select("id").eq("course_run_id", run),
        ];
        for (const request of directCourseRows(lecturer))
            assert.deepEqual(await checked(request, "Draft course RLS"), []);
        for (const request of directCourseRows(participant))
            await requireParticipantDenial(request);
    });
    const directCompanyRows = (who) => [
        who.client.from("organisation_contacts").select("id").eq("organisation_id", org),
        who.client.from("organisation_private_details").select("organisation_id").eq("organisation_id", org),
    ];
    await test("Legacy course visibility remains private before assignment", async () => {
        await checked(
            admin.client.rpc("set_course_visibility", {
                p_id: run,
                p_published: true,
                p_archived: false,
            }),
            "Publish course",
        );
        assert.equal(
            (
                await checked(
                    admin.client
                        .from("course_runs")
                        .select("*,course_sessions(*)")
                        .eq("id", run)
                        .single(),
                    "Admin reads the course schedule",
                )
            ).course_sessions.length,
            2,
        );
        assert.deepEqual(
            await checked(
                lecturer.client.from("course_runs").select("id").eq("id", run),
                "Legacy visibility grants no lecturer preview",
            ),
            [],
        );
        for (const request of directCompanyRows(lecturer))
            assert.deepEqual(await checked(request, "Private company data"), []);
        for (const request of directCompanyRows(participant))
            await requireParticipantDenial(request);
        await requireParticipantDenial(participant.client.rpc("course_workspace", {p_run_id: run}));
    });
    await test("Safe template/run copies omit assignments, contracts and chat members", async () => {
        const copyTemplate = await checked(
            admin.client.rpc("duplicate_course_template", {
                p_id: template,
                p_title: `Safe copy ${tag}`,
            }),
            "Duplicate template",
        );
        templates.push(copyTemplate);
        assert.equal(
            (
                await checked(
                    service
                        .from("course_templates")
                        .select("syllabus")
                        .eq("id", copyTemplate)
                        .single(),
                    "Read template copy",
                )
            ).syllabus,
            course.syllabus,
        );
        copyRun = await checked(
            admin.client.rpc("duplicate_course_run", {p_id: run}),
            "Duplicate run",
        );
        runs.push(copyRun);
        const copied = await checked(
            service
                .from("course_runs")
                .select("published,course_sessions(*)")
                .eq("id", copyRun)
                .single(),
            "Read unpublished run copy",
        );
        assert.equal(copied.published, false);
        assert.equal(copied.course_sessions.length, 2);
        assert.equal(
            (
                await checked(
                    service.from("jobs").select("id").eq("course_run_id", copyRun),
                    "No copied jobs",
                )
            ).length,
            0,
        );
        assert.equal(
            (
                await checked(
                    lecturer.client.from("course_runs").select("id").eq("id", copyRun),
                    "Unpublished copy privacy",
                )
            ).length,
            0,
        );
    });
    await test("Overlapping sessions roll back the entire existing schedule change", async () => {
        const before = await checked(
            service
                .from("course_sessions")
                .select("id,starts_at,ends_at")
                .eq("course_run_id", copyRun)
                .order("starts_at"),
            "Read complete schedule",
        );
        assert.ok(
            (
                await admin.client.rpc("save_course_run", {
                    p_id: copyRun,
                    p_payload: {...runPayload, sessions: [sessions[0], sessions[0]]},
                })
            ).error,
        );
        const after = await checked(
            service
                .from("course_sessions")
                .select("id,starts_at,ends_at")
                .eq("course_run_id", copyRun)
                .order("starts_at"),
            "Read rolled-back schedule",
        );
        assert.deepEqual(after, before);
    });
    await test("Confirmed assignment freezes linked course schedule and accepted commercial deal", async () => {
        job = randomUUID();
        jobs.push(job);
        await checked(
            service.from("jobs").insert({
                id: job,
                course_run_id: run,
                title: `Bound assignment ${tag}`,
                description: "Fictional accepted assignment",
                customer_name: base.name,
                delivery_type: "online",
                location: "Online",
                time_zone: "Europe/Berlin",
                status: "published",
                amount: 500,
                total_amount: 1000,
                currency: "EUR",
                rate_unit: "per_day",
                terms: "Fixed accepted terms",
                terms_version: 1,
                requires_contract: false,
                created_by: admin.id,
            }),
            "Create scoped job",
        );
        const courseSessions = await checked(
            service.from("course_sessions").select("*").eq("course_run_id", run),
            "Get bound sessions",
        );
        await checked(
            service.from("job_sessions").insert(
                courseSessions.map((s) => ({
                    job_id: job,
                    course_session_id: s.id,
                    starts_at: s.starts_at,
                    ends_at: s.ends_at,
                })),
            ),
            "Link job sessions",
        );
        const claim = await checked(
            lecturer.client.rpc("claim_job", {
                p_job_id: job,
                p_idempotency_key: randomUUID(),
                p_terms_version: 1,
            }),
            "Claim full block",
        );
        assert.equal(claim.status, "confirmed");
        const assignedCourse = () =>
            lecturer.client
                .from("course_runs")
                .select("venue,course_sessions(id,starts_at,ends_at)")
                .eq("id", run)
                .order("starts_at", {referencedTable: "course_sessions"})
                .single();
        const assigned = await checked(
            assignedCourse(),
            "Assigned lecturer reads the course and its sessions",
        );
        assert.equal(assigned.course_sessions.length, 2);
        const customer = await checked(
            lecturer.client.from("organisations").select("name").eq("id", org).single(),
            "Assigned lecturer sees the customer identity",
        );
        assert.equal(customer.name, base.name);
        for (const request of directCompanyRows(lecturer))
            assert.deepEqual(await checked(request, "Private company data after assignment"), []);
        assert.equal(
            (
                await admin.client.rpc("save_course_run", {
                    p_id: run,
                    p_payload: {...runPayload, sessions: sessions.slice(0, 1)},
                })
            ).error?.message,
            "course_locked",
        );
        const venue = "Updated fictional course access details";
        assert.equal(
            await checked(
                admin.client.rpc("save_course_run", {
                    p_id: run,
                    p_payload: {...runPayload, published: true, venue},
                }),
                "Update the assigned course venue",
            ),
            run,
        );
        assert.deepEqual(
            await checked(assignedCourse(), "Course venue update preserves the booked sessions"),
            {...assigned, venue},
        );
        assert.equal(
            (
                await admin.client.rpc("save_course_template", {
                    p_id: template,
                    p_payload: {...course, title: "Silently altered course"},
                })
            ).error?.message,
            "course_locked",
        );
        assert.ok(
            (
                await admin.client.rpc("set_course_visibility", {
                    p_id: run,
                    p_published: false,
                    p_archived: true,
                })
            ).error,
        );
        const saved = await checked(
            lecturer.client
                .from("job_claims")
                .select("total_amount,terms")
                .eq("id", claim.claim_id)
                .single(),
            "Check immutable accepted offer",
        );
        assert.equal(Number(saved.total_amount), 1000);
        assert.equal(saved.terms, "Fixed accepted terms");
    });
    await test("An enrolled participant gets course and chat scope through Premium and loses both on removal", async () => {
        const roomTitle = `Participant ${tag}`;
        const roomArgs = {
            p_title: roomTitle,
            p_member_ids: [participant.id],
            p_kind: "participant_course",
            p_job_id: job,
        };
        await requireParticipantDenial(admin.client.rpc("create_chat_group", roomArgs));
        await checked(admin.client.rpc("manage_client_organisation", {
            p_user_id: company.id,
            p_organisation_id: org,
            p_remove: false,
        }), "Link the actual customer actor");
        await enablePremiumAndLinkParticipant({
            admin, company, learner: participant, organisation: org, service, checked,
        });
        const enrol = (status) => admin.client.rpc("manage_course_enrolment", {
            p_course_run_id: run,
            p_user_id: participant.id,
            p_status: status,
        });
        await checked(enrol("enrolled"), "Enrol the consenting participant in the assigned course");
        const room = await checked(admin.client.rpc("create_chat_group", roomArgs), "Create the scoped course channel");
        const workspace = (id) => participant.client.rpc("course_workspace", {p_run_id: id});
        const own = await checked(workspace(run), "Read enrolled course through the participant projection");
        assert.equal(own.id, run);
        assert.equal(own.access.learner, true);
        await requireParticipantDenial(workspace(copyRun));
        await requireParticipantDenial(participant.client.from("course_runs").select("id").eq("id", run));
        await requireParticipantDenial(participant.client.from("jobs").select("id").eq("id", job));
        const courseRooms = () => participant.client.rpc("course_chat_rooms", {p_run_id: run});
        assert.deepEqual(await checked(courseRooms()), [{id: room, title: roomTitle, can_post: true}]);
        await checked(enrol("removed"), "Revoke the exact participant enrolment");
        await requireParticipantDenial(workspace(run));
        await requireParticipantDenial(courseRooms());
    });
    await test("Contact updates/archive and organisation archive are recoverable and audited", async () => {
        await checked(
            admin.client.rpc("save_organisation_contact", {
                p_id: contact,
                p_organisation_id: org,
                p_payload: {
                    name: "Updated contact",
                    position: "Planning",
                    email: "updated@example.invalid",
                    phone: "",
                    notes: "Updated private note",
                    archived: true,
                },
            }),
            "Archive contact",
        );
        assert.ok(
            (
                await checked(
                    admin.client
                        .from("organisation_contacts")
                        .select("archived_at")
                        .eq("id", contact)
                        .single(),
                    "Read archive",
                )
            ).archived_at,
        );
        await checked(
            admin.client.rpc("save_organisation", {
                p_id: org,
                p_payload: {...base, archived: true},
            }),
            "Archive directory entity",
        );
        await checked(
            admin.client.rpc("save_organisation", {
                p_id: org,
                p_payload: {...base, archived: false},
            }),
            "Restore directory entity",
        );
        assert.equal(
            (
                await checked(
                    admin.client
                        .from("organisations")
                        .select("archived_at")
                        .eq("id", org)
                        .single(),
                    "Read restored",
                )
            ).archived_at,
            null,
        );
        const audit = await checked(
            service
                .from("audit_events")
                .select("action,details")
                .eq("actor_id", admin.id),
            "Read operation audit",
        );
        assert.ok(audit.length >= 9);
        assert.ok(
            !JSON.stringify(audit).includes(base.private_notes),
            "Audit metadata does not duplicate private note text",
        );
    });
    console.log(
        `PASS: ${count} real password-only operations API cases; private customer/contact boundaries, reusable content, safe copies, publication/enrolment/revocation and immutable accepted course blocks.`,
    );
});

async function cleanupOperationFixtures({service, checked, sql, jobs, runs, templates, orgs, companyId, participantId}) {
    if (jobs.length) {
        const claims = await checked(
            service.from("job_claims").select("id").in("job_id", jobs),
            "Find temporary claims",
        );
        const ids = claims.map((c) => c.id);
        if (ids.length) {
            await checked(
                service.from("assignment_sessions").delete().in("claim_id", ids),
                "Delete only QA allocations",
            );
            await checked(
                service.from("claim_events").delete().in("claim_id", ids),
                "Delete only QA claim events",
            );
            await checked(
                service.from("notifications").delete().in("resource_id", ids),
                "Delete only QA notifications",
            );
            await checked(
                service.from("job_claims").delete().in("id", ids),
                "Delete only QA claims",
            );
        }
        const rooms = await checked(
            service.from("chat_rooms").select("id").in("job_id", jobs),
            "Find temporary course rooms",
        );
        if (rooms.length) {
            await checked(
                service
                    .from("chat_members")
                    .delete()
                    .in(
                        "room_id",
                        rooms.map((r) => r.id),
                    ),
                "Delete QA memberships",
            );
            await checked(
                service
                    .from("chat_rooms")
                    .delete()
                    .in(
                        "id",
                        rooms.map((r) => r.id),
                    ),
                "Delete QA rooms",
            );
        }
        await checked(
            service.from("job_sessions").delete().in("job_id", jobs),
            "Delete QA job sessions",
        );
        await checked(
            service.from("jobs").delete().in("id", jobs),
            "Delete QA jobs",
        );
    }
    if (runs.length) {
        const extraRooms = await checked(
            service.from("chat_rooms").select("id").in("course_run_id", runs),
            "Find scoped participant rooms",
        );
        if (extraRooms.length) {
            await checked(
                service
                    .from("chat_members")
                    .delete()
                    .in(
                        "room_id",
                        extraRooms.map((r) => r.id),
                    ),
                "Delete only scoped participant memberships",
            );
            await checked(
                service
                    .from("chat_rooms")
                    .delete()
                    .in(
                        "id",
                        extraRooms.map((r) => r.id),
                    ),
                "Delete scoped participant rooms",
            );
        }
        await checked(
            service.from("course_enrolments").delete()
                .eq("user_id", participantId).in("course_run_id", runs),
            "Delete exact fictional participant enrolment history",
        );
        await checked(
            service.from("course_sessions").delete().in("course_run_id", runs),
            "Delete QA course sessions",
        );
        await checked(
            service.from("course_runs").delete().in("id", runs),
            "Delete QA course runs",
        );
    }
    if (templates.length)
        await checked(
            service.from("course_templates").delete().in("id", templates),
            "Delete QA templates",
        );
    if (orgs.length) {
        await sql(`delete from private.company_premium_audit where organisation_id in(${orgs.map(q).join(",")});`);
        await checked(
            service.from("client_organisation_memberships").delete()
                .eq("user_id", companyId).in("organisation_id", orgs),
            "Delete exact fictional company memberships",
        );
        await checked(
            service.from("organisations").delete().in("id", orgs),
            "Delete QA organisations",
        );
    }
}
