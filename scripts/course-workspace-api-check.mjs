/** Actual Auth/password-only authentication/REST/ClamAV/Storage/Edge course and completion flows. */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {withApiFixture} from "./testing/api.mjs";
import {quoteSql as q} from "./testing/database.mjs";
import {eventually, subscribeToRoom} from "./testing/realtime.mjs";
import {setTimeout as delay} from "node:timers/promises";
import {portalJsonResponse} from "./testing/openapi-contract.mjs";

await withApiFixture(
    async ({actor, passwordOnly, checked, service, sql, defer, url}) => {
        const admin = await actor("course-workspace-admin", "admin"),
            teacher = await actor("course-workspace-teacher", "lecturer"),
            learner = await actor("course-workspace-learner", "participant"),
            peer = await actor("course-workspace-peer", "lecturer"),
            client = await actor("course-workspace-client", "client");
        await passwordOnly(admin.client);
        await checked(
            service
                .from("profiles")
                .update({display_name: "Fictional Müller Μαρία Мария"})
                .eq("id", learner.id),
        );
        const org = randomUUID(),
            template = randomUUID(),
            run = randomUUID(),
            session = randomUUID(),
            job = randomUUID(),
            claim = randomUUID(),
            contact = randomUUID();
        let room;
        const users = [admin.id, teacher.id, learner.id, peer.id, client.id];
        defer(async () => {
            if (room) {
                await sql(
                    `delete from public.messages where room_id = ${q(room)};
                     delete from public.chat_members where room_id = ${q(room)};`,
                );
            }
            await sql(`delete from private.course_resources where run_id = ${q(run)};`);
            const uploads = await checked(
                service.from("documents").select("id").in("owner_id", users),
                "Read only documents owned by the course fixture",
            );
            for (const document of uploads) {
                const versions = await checked(
                    service
                        .from("document_versions")
                        .select("object_path")
                        .eq("document_id", document.id),
                );
                const paths = versions.map((v) => v.object_path);
                if (paths.length) {
                    await checked(service.storage.from("portal-clean").remove(paths));
                    await checked(service.storage.from("portal-quarantine").remove(paths));
                }
                await checked(
                    service
                        .from("documents")
                        .update({current_version_id: null})
                        .eq("id", document.id),
                );
                await checked(
                    service.from("document_versions").delete().eq("document_id", document.id),
                );
                await checked(service.from("documents").delete().eq("id", document.id));
            }
            if (room) await sql(`delete from public.chat_rooms where id = ${q(room)};`);
            await sql(
                `delete
           from private.company_premium_commands
           where organisation_id = ${q(org)};
          delete
          from private.company_premium_settings
          where organisation_id = ${q(org)};
          delete
          from private.company_premium_audit
          where organisation_id = ${q(org)};
          delete
          from private.course_completion_records
          where run_id = ${q(run)};
          delete
          from private.course_quiz_attempts
          where run_id = ${q(run)};
          delete
          from private.course_quiz_versions
          where run_id = ${q(run)};
          delete
          from private.course_quizzes
          where run_id = ${q(run)};
          delete
          from private.course_attendance_audit
          where session_id = ${q(session)};
          delete
          from private.course_attendance
          where session_id = ${q(session)};
          delete
          from public.course_enrolments
          where course_run_id = ${q(run)};
          delete
          from public.notifications
          where user_id in (${users.map(q).join(",")});
          delete
          from public.job_claims
          where id = ${q(claim)};
          delete
          from public.jobs
          where id = ${q(job)};
          delete
          from public.course_sessions
          where course_run_id = ${q(run)};
          delete
          from public.course_runs
          where id = ${q(run)};
          delete
          from public.course_templates
          where id = ${q(template)};
          delete
          from public.client_organisation_memberships
          where organisation_id = ${q(org)};
          delete
          from public.organisation_contacts
          where organisation_id = ${q(org)};
          delete
          from public.organisations
          where id = ${q(org)};`,
            );
        });
        await sql(
            `insert into public.organisations(id, name)
             values (${q(org)}, 'Fictional workspace academy');
            insert into public.organisation_contacts(id, organisation_id, name, email, phone, notes)
            values (${q(contact)}, ${q(org)}, 'Agreed course contact', 'course@example.invalid', '+49 40 123', 'Private customer note');
            insert into public.course_templates(id, title)
            values (${q(template)}, 'Fictional Linux completion');
            insert into public.course_runs(id, template_id, organisation_id, time_zone, venue)
            values (${q(run)}, ${q(template)}, ${q(org)}, 'Europe/Berlin', 'https://example.invalid/teaching');
            insert into public.course_sessions(id, course_run_id, starts_at, ends_at)
            values (${q(session)}, ${q(run)}, now() - interval '2 days 1 hour', now() - interval '2 days');
            insert into public.jobs(id, course_run_id, title, customer_name, delivery_type, status, amount, currency, rate_unit, total_amount, terms)
            values (${q(job)}, ${q(run)}, 'Fictional workspace job', 'Fictional workspace academy', 'online', 'filled', 100, 'EUR', 'fixed_total', 100, 'Fictional accepted terms');
            insert into public.job_claims(id, job_id, lecturer_id, idempotency_key, amount, currency, rate_unit, total_amount, terms, terms_version)
            values (${q(claim)}, ${q(job)}, ${q(teacher.id)}, ${q(randomUUID())}, 100, 'EUR', 'fixed_total', 100, 'Fictional accepted terms', 1);`,
        );
        await checked(
            admin.client.rpc("set_company_premium", {
                p_organisation_id: org,
                p_enabled: true,
                p_expected_version: 0,
                p_request_id: randomUUID(),
            }),
        );
        await checked(
            admin.client.rpc("manage_client_organisation", {
                p_user_id: client.id,
                p_organisation_id: org,
                p_remove: false,
            }),
        );
        const learnerReference = await checked(
            service
                .from("profiles")
                .select("luminovia_user_id")
                .eq("id", learner.id)
                .single(),
            {requireData: true},
        );
        await checked(
            client.client.rpc("request_company_participant_link", {
                p_organisation_id: org,
                p_luminovia_user_id: learnerReference.luminovia_user_id,
                p_request_id: randomUUID(),
            }),
        );
        const pendingMemberships = await checked(
            learner.client.rpc("my_company_participant_invitations"),
            {requireData: true},
        );
        const companyInvitation = pendingMemberships.find(
            (invitation) => invitation.organisation_id === org,
        );
        assert.ok(companyInvitation);
        await checked(
            learner.client.rpc("accept_company_participant_invitation", {
                p_organisation_id: org,
                p_expected_version: companyInvitation.version,
                p_request_id: randomUUID(),
            }),
        );
        await checked(
            admin.client.rpc("manage_course_enrolment", {
                p_course_run_id: run,
                p_user_id: learner.id,
                p_status: "completed",
            }),
        );
        const action = (who, name, payload = {}, version = 0) =>
            checked(
                who.client.rpc("course_workspace_action", {
                    p_run_id: run,
                    p_action: name,
                    p_payload: payload,
                    p_expected_version: version,
                }),
            );
        const workspace = (who) =>
            checked(who.client.rpc("course_workspace", {p_run_id: run}));
        const item = (
            await action(admin, "preparation_create", {
                label: "Prepare lab accounts",
                client_visible: true,
            })
        ).id;
        await action(teacher, "preparation_toggle", {id: item, done: true}, 1);
        assert.equal((await workspace(client)).preparation[0].done, true);
        await action(admin, "contact_select", {contact_id: contact});
        assert.equal(
            (await workspace(learner)).contact.email,
            "course@example.invalid",
        );
        assert.ok(
            !JSON.stringify((await workspace(learner)).contact).includes("notes"),
        );
        const bytes = new TextEncoder().encode(
            "Fictional agreed, malware-scanned course material.",
        );
        const origin = new URL(process.env.E2E_BASE_URL).origin;

        async function headers(who) {
            const session = (await who.client.auth.getSession()).data.session;
            return {
                Origin: origin,
                Authorization: `Bearer ${session.access_token}`,
                apikey: process.env.SUPABASE_ANON_KEY,
            };
        }

        const form = new FormData();
        form.set(
            "file",
            new File([bytes], "Agreed-course-material.txt", {type: "text/plain"}),
        );
        form.set("scope", "personal");
        form.set("kind", "material");
        form.set("client_id", randomUUID());
        const uploaded = await fetch(`${url}/functions/v1/files`, {
            method: "POST",
            headers: await headers(admin),
            body: form,
            signal: AbortSignal.timeout(90000),
        });
        const body = await uploaded.json();
        assert.equal(uploaded.status, 200);
        const {document} = portalJsonResponse("/functions/v1/files", uploaded.status, body);
        assert.equal(document.status, "clean");
        const resource = (
            await action(admin, "resource_share", {
                version_id: document.current_version_id,
                audience: "participants",
                category: "material",
            })
        ).id;

        async function download(who, kind, id, options = {}) {
            return await fetch(`${url}/functions/v1/course-documents`, {
                method: "POST",
                headers: {
                    ...(await headers(who)),
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ kind, id, ...options }),
                signal: AbortSignal.timeout(30000),
            });
        }

        const material = await download(learner, "resource", resource);
        assert.equal(material.status, 200);
        assert.equal(material.headers.get("cache-control"), "no-store, private");
        assert.equal(material.headers.get("x-content-type-options"), "nosniff");
        assert.match(material.headers.get("content-disposition"), /^attachment;/);
        assert.match(material.headers.get("content-type"), /^text\/plain(?:;|$)/i);
        assert.deepEqual(new Uint8Array(await material.arrayBuffer()), bytes);
        const originDenial = await fetch(`${url}/functions/v1/course-documents`, {
            method: "POST",
            headers: {
                ...(await headers(learner)),
                Origin: "https://untrusted.example.invalid",
                "Content-Type": "application/json",
            },
            body: JSON.stringify({kind: "resource", id: resource}),
            signal: AbortSignal.timeout(30_000),
        });
        assert.equal(originDenial.status, 403);
        assert.deepEqual(
            portalJsonResponse("/functions/v1/course-documents", originDenial.status, await originDenial.json()),
            {error: "origin_not_allowed"},
        );
        const clientDenial = await download(client, "resource", resource);
        assert.equal(clientDenial.status, 403);
        assert.deepEqual(
            portalJsonResponse("/functions/v1/course-documents", clientDenial.status, await clientDenial.json()),
            {error: "document_unavailable"},
        );
        assert.equal(
            (await download(learner, "resource", resource, { unknown: true })).status,
            400,
        );
        assert.equal((await download(peer, "resource", resource)).status, 403);
        const replacement = new FormData();
        replacement.set(
            "file",
            new File(
                [
                    new TextEncoder().encode(
                        "A newer private draft has not been shared.",
                    ),
                ],
                "Agreed-course-material.txt",
                {type: "text/plain"},
            ),
        );
        replacement.set("scope", "personal");
        replacement.set("kind", "material");
        replacement.set("client_id", randomUUID());
        replacement.set("replace_id", document.id);
        const replaced = await fetch(`${url}/functions/v1/files`, {
            method: "POST",
            headers: await headers(admin),
            body: replacement,
            signal: AbortSignal.timeout(90000),
        });
        assert.equal(replaced.status, 200);
        const stillReviewed = await download(learner, "resource", resource);
        assert.equal(stillReviewed.status, 200);
        assert.deepEqual(new Uint8Array(await stillReviewed.arrayBuffer()), bytes);
        const directDocument = await learner.client
            .from("documents")
            .select("id")
            .eq("id", document.id);
        assert.equal(directDocument.status, 403);
        assert.equal(directDocument.error?.code, "42501");
        assert.equal(directDocument.data, null);
        await action(learner, "resource_acknowledge", {id: resource});
        assert.equal((await workspace(learner)).resources[0].acknowledged, true);
        await action(learner, "notebook", {body: "Private learner preparation"});
        assert.equal((await workspace(admin)).notebook.body, "");
        const question = (
            await action(learner, "question", {
                body: "Which permission protects a file?",
            })
        ).id;
        await action(
            teacher,
            "answer",
            {id: question, answer: "Apply least privilege and ownership."},
            1,
        );
        assert.match((await workspace(learner)).questions[0].answer, /ownership/);
        assert.equal(
            (
                await learner.client.rpc("course_workspace_action", {
                    p_run_id: run,
                    p_action: "completion_issue",
                    p_payload: {},
                    p_expected_version: 0,
                })
            ).error?.code,
            "22023",
        );
        await action(teacher, "attendance_verify", {
            session_id: session,
            user_id: learner.id,
            state: "attended",
            minutes: 60,
            reason: "Verified against the fictional session register",
        });
        await action(teacher, "quiz_config", {
            questions: [
                {prompt: "Read a directory?", options: ["ls", "rm"], correct: 0},
            ],
            pass_percent: 80,
            max_attempts: 2,
            published: true,
        });
        assert.equal(
            Object.hasOwn((await workspace(learner)).quiz.questions[0], "correct"),
            false,
        );
        assert.equal(
            (
                await action(
                    learner,
                    "quiz_attempt",
                    {answers: [0], request_id: randomUUID()},
                    1,
                )
            ).passed,
            true,
        );
        const completion = (await action(learner, "completion_issue")).id;
        const pdf = await download(learner, "completion", completion);
        assert.equal(pdf.status, 200);
        assert.match(pdf.headers.get("content-type"), /application\/pdf/);
        assert.match(pdf.headers.get("cache-control"), /no-store/);
        const pdfBytes = new Uint8Array(await pdf.arrayBuffer());
        assert.equal(new TextDecoder().decode(pdfBytes.slice(0, 5)), "%PDF-");
        assert.ok(pdfBytes.length > 10000);
        const again = await download(learner, "completion", completion);
        assert.deepEqual(new Uint8Array(await again.arrayBuffer()), pdfBytes);
        assert.equal((await download(peer, "completion", completion)).status, 403);
        const report = await download(client, "attendance", run);
        assert.equal(report.status, 200);
        assert.equal(
            new TextDecoder().decode(
                new Uint8Array(await report.arrayBuffer()).slice(0, 5),
            ),
            "%PDF-",
        );
        await action(learner, "feedback", {
            rating: 5,
            comment: "Fictional practical course feedback",
        });
        assert.equal((await workspace(teacher)).feedback_summary.average, null);
        await action(teacher, "completion_revoke", {
            id: completion,
            reason: "Fictional verification correction",
        });
        assert.equal(
            (await download(learner, "completion", completion)).status,
            403,
        );
        room = await checked(
            admin.client.rpc("create_chat_group", {
                p_title: "Fictional participant transport",
                p_member_ids: [],
                p_kind: "participant_course",
                p_job_id: job,
            }),
            "Open an actual Premium participant room",
        );
        assert.ok(room);
        assert.ok(
            (
                await checked(
                    learner.client.rpc("course_chat_rooms", { p_run_id: run }),
                )
            ).some((entry) => entry.id === room),
        );
        const teacherEvents = [],
            learnerEvents = [],
            peerEvents = [];
        for (const [who, events] of [
            [teacher, teacherEvents],
            [learner, learnerEvents],
            [peer, peerEvents],
        ]) {
            const { session } = await checked(who.client.auth.getSession());
            await who.client.realtime.setAuth(session.access_token);
            await subscribeToRoom(
                who.client,
                room,
                "course_chat_activity",
                ["INSERT", "UPDATE"],
                events,
            );
        }
        const attachmentForm = new FormData();
        attachmentForm.set(
            "file",
            new File([bytes], "Course-chat-note.txt", { type: "text/plain" }),
        );
        attachmentForm.set("scope", "room");
        attachmentForm.set("kind", "chat");
        attachmentForm.set("room_id", room);
        attachmentForm.set("message_only", "true");
        attachmentForm.set("course_chat", "true");
        attachmentForm.set("client_id", randomUUID());
        const attachmentUpload = await fetch(`${url}/functions/v1/files`, {
            method: "POST",
            headers: await headers(teacher),
            body: attachmentForm,
            signal: AbortSignal.timeout(90_000),
        });
        const attachmentReceipt = await attachmentUpload.json();
        assert.equal(
            attachmentUpload.status,
            200,
            JSON.stringify(attachmentReceipt),
        );
        const {document: attachment} = portalJsonResponse(
            "/functions/v1/files", attachmentUpload.status, attachmentReceipt,
        );
        assert.equal(attachment.room_id, room);
        assert.equal(
            teacherEvents.length,
            0,
            "An unpublished draft emits no course activity",
        );
        const message = await checked(
            teacher.client.rpc("send_course_chat_attachment", {
                p_room_id: room,
                p_body: "Fictional course note",
                p_client_id: randomUUID(),
                p_document_id: attachment.id,
                p_version_id: attachment.current_version_id,
            }),
        );
        await eventually(
            () => teacherEvents.length === 1 && learnerEvents.length === 1,
            "Teacher and enrolled learner receive the committed opaque update",
        );
        const firstActivity = teacherEvents[0];
        assert.deepEqual(learnerEvents[0], firstActivity);
        assert.deepEqual(Object.keys(firstActivity).sort(), [
            "id",
            "revision",
            "room_id",
        ]);
        assert.equal(firstActivity.room_id, room);
        assert.equal(peerEvents.length, 0);
        const chatVersion = { version_id: attachment.current_version_id };
        const publishedFile = await download(
            learner,
            "course_chat_attachment",
            message,
            chatVersion,
        );
        assert.equal(publishedFile.status, 200);
        assert.deepEqual(new Uint8Array(await publishedFile.arrayBuffer()), bytes);
        assert.equal(
            (await download(peer, "course_chat_attachment", message, chatVersion))
                .status,
            403,
        );
        assert.equal(
            (
                await download(learner, "course_chat_attachment", message, {
                    version_id: randomUUID(),
                })
            ).status,
            403,
        );
        await checked(
            admin.client.rpc("manage_course_enrolment", {
                p_course_run_id: run,
                p_user_id: learner.id,
                p_status: "removed",
            }),
        );
        assert.equal((await download(learner, "resource", resource)).status, 403);
        assert.equal(
            (await download(learner, "course_chat_attachment", message, chatVersion))
                .status,
            403,
        );
        assert.equal(
            (await learner.client.rpc("course_chat_messages", { p_room_id: room }))
                .error?.code,
            "42501",
        );
        await checked(
            teacher.client.rpc("send_course_chat_message", {
                p_room_id: room,
                p_body: "Fictional note sent after withdrawal",
                p_client_id: randomUUID(),
            }),
        );
        await eventually(
            () =>
                teacherEvents.some(
                    (event) => event.revision !== firstActivity.revision,
                ),
            "Teacher's existing Realtime channel receives the next revision",
        );
        await delay(1200);
        assert.deepEqual(
            learnerEvents,
            [firstActivity],
            "The previously connected learner receives no new event",
        );
        assert.deepEqual(peerEvents, []);
    },
);
console.log(
    "PASS: actual Auth/REST/Edge/ClamAV/Storage/Realtime: reviewed material bytes, protected Unicode PDFs, private attachments, opaque activity, and revocation of both existing live subscriptions and exact-version download rights.",
);
