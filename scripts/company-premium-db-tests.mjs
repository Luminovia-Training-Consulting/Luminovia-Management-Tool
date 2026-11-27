/** Isolated SQL/RLS/API checks for the admin-only company Premium flag and retained course data. */
import assert from "node:assert/strict";
import {assertLmsResponse} from "./testing/premium-lms-contract.mjs";
import {randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import {quoteSql as q, withTestDatabase} from "./testing/database.mjs";

let checks = 0;

/** Count one test gate only after all its permission and retained-data assertions pass. */
async function check(name, run) {
    await run();
    checks++;
    console.log(`PASS ${name}`);
}

await withTestDatabase("company_premium_test", async ({sql, actor}) => {
    const admin = randomUUID(), secondAdmin = randomUUID(), manager = randomUUID(),
        lecturer = randomUUID(), participant = randomUUID(), client = randomUUID(),
        owner = randomUUID();
    const companyA = randomUUID(), companyB = randomUUID(),
        template = randomUUID(), runA = randomUUID(), runB = randomUUID(),
        sessionA = randomUUID(), sessionB = randomUUID(),
        jobA = randomUUID(), claimA = randomUUID(),
        roomB = randomUUID(),
        membershipA = randomUUID(), membershipB = randomUUID();
    let roomA;
    const examPaperDocument = randomUUID(), examKeyDocument = randomUUID(),
        examPaperVersion = randomUUID(), examKeyVersion = randomUUID();
    let examPaperId, examKeyId;
    const learnerResource = randomUUID(), learnerCompletion = randomUUID();
    let learnerResourceVersion;
    let courseChatMessageId, courseChatMessageB, attachedChatMessage, attachedVersion;
    await sql(
        `insert into auth.users(id, email)
         values ${[admin, secondAdmin, manager, lecturer, participant, client, owner].map((id) => `(${q(id)},${q(`${id}@example.invalid`)})`).join(",")};
        update auth.users
        set email_confirmed_at=now()
        where id = ${q(participant)};
        insert into public.user_roles(user_id, role)
        values (${q(admin)}, 'admin'),
               (${q(secondAdmin)}, 'admin'),
               (${q(manager)}, 'management'),
               (${q(lecturer)}, 'lecturer'),
               (${q(participant)}, 'participant'),
               (${q(client)}, 'client'),
               (${q(owner)}, 'owner');
        insert into public.organisations(id, name)
        values (${q(companyA)}, 'Fictional Premium Academy A'),
               (${q(companyB)}, 'Fictional Premium Academy B');
        insert into public.client_organisation_memberships(user_id, organisation_id)
        values (${q(client)}, ${q(companyA)});
        insert into public.course_templates(id, title, syllabus)
        values (${q(template)}, 'Fictional retained LMS course', 'Fictional course syllabus');
        insert into public.course_runs(id, template_id, organisation_id)
        values (${q(runA)}, ${q(template)}, ${q(companyA)}),
               (${q(runB)}, ${q(template)}, ${q(companyB)});
        insert into public.course_sessions(id, course_run_id, starts_at, ends_at)
        values (${q(sessionA)}, ${q(runA)}, now() + interval '2 days', now() + interval '2 days 1 hour'),
               (${q(sessionB)}, ${q(runB)}, now() + interval '3 days', now() + interval '3 days 1 hour');
        insert into public.jobs(id, course_run_id, title, customer_name, delivery_type, status, amount, currency, rate_unit, total_amount, terms)
        values (${q(jobA)}, ${q(runA)}, 'Fictional Premium lecturer', 'Fictional customer', 'online', 'filled', 100, 'EUR', 'fixed_total', 100, 'Fictional terms');
        insert into public.job_claims(id, job_id, lecturer_id, idempotency_key, amount, currency, rate_unit, total_amount, terms, terms_version)
        values (${q(claimA)}, ${q(jobA)}, ${q(lecturer)}, ${q(randomUUID())}, 100, 'EUR', 'fixed_total', 100, 'Fictional terms', 1);
        insert into public.course_enrolments(course_run_id, user_id, status, enrolled_by)
        values (${q(runA)}, ${q(participant)}, 'enrolled', ${q(admin)}),
               (${q(runB)}, ${q(participant)}, 'enrolled', ${q(admin)});
        insert into public.chat_rooms(id, kind, title, owner_id, course_run_id)
        values (${q(roomB)}, 'participant_course', 'Fictional company B room', ${q(admin)}, ${q(runB)});
        insert into public.chat_members(room_id, user_id)
        values (${q(roomB)}, ${q(participant)});
        insert into private.company_participant_link_requests(id, organisation_id, requested_by, request_id, luminovia_user_id, target_user_id, status, expires_at)
        values ('${membershipA}', '${companyA}', '${admin}', '${randomUUID()}', (select luminovia_user_id from public.profiles where id = '${participant}'), '${participant}', 'accepted', now() + interval '14 days'),
               ('${membershipB}', '${companyB}', '${admin}', '${randomUUID()}', (select luminovia_user_id from public.profiles where id = '${participant}'), '${participant}', 'accepted', now() + interval '14 days');
        insert into private.company_participant_memberships(organisation_id, user_id, status, link_request_id, invited_by, joined_at, version)
        values ('${companyA}', '${participant}', 'active', '${membershipA}', '${admin}', now(), 1),
               ('${companyB}', '${participant}', 'active', '${membershipB}', '${admin}', now(), 1);`,
    );
    /** Invoke one public RPC with an authenticated fixture identity. */
    const rpc = (who, name, args = []) =>
        actor(
            who,
            `select to_jsonb(public.${name}(${args
                .map((value) =>
                    value === null
                        ? "null"
                        : Array.isArray(value)
                            ? q(`{${value.join(",")}}`)
                            : typeof value === "boolean" || typeof value === "number"
                                ? String(value)
                                : q(typeof value === "object" ? JSON.stringify(value) : value),
                )
                .join(",")}))`,
        ).then((value) => JSON.parse(value || "null"));
    const toggle = async (who, org, enabled, version, requestId = randomUUID()) => {
        const result = await rpc(who, "set_company_premium", [org, enabled, version, requestId]);
        assertLmsResponse("set_company_premium", result);
        return result;
    };

    await check(
        "Existing and new company entitlements default OFF; management may inspect but not change them",
        async () => {
            const settings = await rpc(admin, "company_premium_settings");
            assertLmsResponse("company_premium_settings", settings);
            assertLmsResponse("company_premium_settings", await rpc(manager, "company_premium_settings"));
            await assert.rejects(rpc(lecturer, "company_premium_settings"), /42501/);
            assert.deepEqual(
                settings.map((item) => [item.organisation_id, item.enabled, item.version]).sort(),
                [
                    [companyA, false, 0],
                    [companyB, false, 0],
                ].sort(),
            );
            await assert.rejects(toggle(manager, companyA, true, 0), /42501/);
            await assert.rejects(toggle(lecturer, companyA, true, 0), /42501/);
            await assert.rejects(toggle(participant, companyA, true, 0), /42501/);
            await assert.rejects(toggle(client, companyA, true, 0), /42501/);
            await assert.rejects(toggle(owner, companyA, true, 0), /42501/);
        },
    );

    await check(
        "Admin toggles are idempotent, audited and reject stale concurrent versions",
        async () => {
            const requestId = randomUUID();
            const updated = await toggle(admin, companyB, true, 0, requestId);
            assert.deepEqual(updated, {status: "updated", enabled: true, version: 1});
            assert.deepEqual(await toggle(admin, companyB, true, 0, requestId), updated);
            const stale = await toggle(admin, companyB, false, 0);
            assert.deepEqual(stale, {status: "conflict", enabled: true, version: 1});
            const concurrent = await Promise.all([
                toggle(admin, companyA, true, 0),
                toggle(secondAdmin, companyA, true, 0),
            ]);
            assert.deepEqual(
                concurrent.map((result) => result.status).sort(),
                ["conflict", "updated"],
            );
            const audit = await sql(
                `select count(*) from private.company_premium_audit where organisation_id in ('${companyA}','${companyB}')`,
            );
            assert.equal(audit, "4");
            roomA = await rpc(admin, "create_chat_group", [
                "Fictional company A room", [admin], "participant_course", jobA,
            ]);
            assert.equal(await sql(`select count(*) from public.chat_members where room_id=${q(roomA)} and user_id in (${q(participant)},${q(lecturer)}) and removed_at is null`), "2");
        },
    );

    await check(
        "Participant search reaches only scoped REST filter and live company course",
        async () => {
            assert.equal(
                await actor(
                    participant,
                    "set local request.path='/rpc/unified_search';select private.require_portal_access();select 1",
                ),
                "1",
            );
            assert.equal(
                await actor(
                    participant,
                    "set local request.path='/rpc/course_welcome_content';select private.require_portal_access();select 1",
                ),
                "1",
            );
            await assert.rejects(
                actor(
                    participant,
                    "set local request.path='/rpc/retained_company_lms';select private.require_portal_access()",
                ),
                /42501/,
            );
            await assert.rejects(
                actor(
                    participant,
                    "set local request.path='/rpc/company_participants';select private.require_portal_access()",
                ),
                /42501/,
            );
            for (const kind of ["", "clients", "finance", "people", "jobs", "files"]) {
                await assert.rejects(
                    rpc(participant, "unified_search", ["Fictional", kind, null, null, null, 40]),
                    /42501/,
                );
            }
            const result = await rpc(participant, "unified_search", [
                "Fictional retained LMS course", "courses", null, null, null, 40,
            ]);
            assert.deepEqual(result.items.map((item) => item.id).sort(), [runA, runB].sort());
        },
    );

    await check(
        "Company roster read works when Premium is ON and denies participant or other company",
        async () => {
            const roster = await rpc(client, "course_enrolments", [runA]);
            assert.deepEqual(roster.map((item) => item.user_id), [participant]);
            await assert.rejects(rpc(client, "course_enrolments", [runB]), /42501/);
            await assert.rejects(rpc(participant, "course_enrolments", [runA]), /42501/);
        },
    );

    await check(
        "Exam PDF settings and exact clean files separate learners from course editors",
        async () => {
            await sql(`insert into public.documents(id, owner_id, uploaded_by, scope, kind, original_name, mime_type, size_bytes, status, client_id)
                       values (${q(examPaperDocument)}, ${q(admin)}, ${q(admin)}, 'personal', 'material', 'Fictional exam.pdf', 'application/pdf', 20, 'clean', ${q(randomUUID())}),
                              (${q(examKeyDocument)}, ${q(admin)}, ${q(admin)}, 'personal', 'material', 'Fictional answer key.pdf', 'application/pdf', 20, 'clean', ${q(randomUUID())});
                       insert into public.document_versions(id, document_id, uploaded_by, client_id, version, object_path, original_name, mime_type, size_bytes, status, sha256)
                       values (${q(examPaperVersion)}, ${q(examPaperDocument)}, ${q(admin)}, ${q(randomUUID())}, 1, 'fictional/exam.pdf', 'Fictional exam.pdf', 'application/pdf', 20, 'clean', ${q("a".repeat(64))}),
                              (${q(examKeyVersion)}, ${q(examKeyDocument)}, ${q(admin)}, ${q(randomUUID())}, 1, 'fictional/key.pdf', 'Fictional answer key.pdf', 'application/pdf', 20, 'clean', ${q("b".repeat(64))});
                       update public.documents set current_version_id=${q(examPaperVersion)} where id=${q(examPaperDocument)};
                       update public.documents set current_version_id=${q(examKeyVersion)} where id=${q(examKeyDocument)};`);
            assert.deepEqual((await rpc(participant, "course_workspace", [runA])).exams.documents, []);
            await sql(`update public.document_versions set status='quarantined' where id=${q(examPaperVersion)}`);
            await assert.rejects(rpc(admin, "share_course_exam_pdf", [runA, examPaperVersion, "students"]), /42501/);
            await sql(`update public.document_versions set status='clean' where id=${q(examPaperVersion)}`);
            await assert.rejects(rpc(admin, "share_course_exam_pdf", [runA, examPaperVersion, "students"]), /42501/);
            // Represent a course with a student paper published before timed exams were introduced.
            await sql(`insert into private.course_exam_settings(run_id,allow_untimed_papers) values(${q(runA)},true)`);
            examPaperId = await rpc(admin, "share_course_exam_pdf", [runA, examPaperVersion, "students"]);
            examKeyId = await rpc(admin, "share_course_exam_pdf", [runA, examKeyVersion, "exam_staff"]);
            await assert.rejects(rpc(client, "share_course_exam_pdf", [runA, examKeyVersion, "exam_staff"]), /42501/);
            assert.deepEqual((await rpc(participant, "course_workspace", [runA])).exams.documents, []);
            await assert.rejects(rpc(participant, "course_document_access", ["exam", examPaperId]), /42501/);
            await assert.rejects(rpc(participant, "course_document_access", ["exam", examKeyId]), /42501/);
            await assert.rejects(rpc(participant, "set_course_exam_required", [runA, true, 0]), /42501/);
            await assert.rejects(rpc(client, "share_course_exam_pdf", [runB, examPaperVersion, "students"]), /42501/);
            assert.deepEqual(await rpc(client, "set_course_exam_required", [runA, true, 0]), {required: true, version: 1});
            await assert.rejects(rpc(admin, "set_course_exam_required", [runA, false, 0]), /PT409/);
            const learnerExams = (await rpc(participant, "course_workspace", [runA])).exams;
            assert.deepEqual(learnerExams.documents.map((item) => item.id), [examPaperId]);
            assert.equal(learnerExams.version, null);
            assert.deepEqual(
                (await rpc(client, "course_workspace", [runA])).exams.documents.map((item) => item.id),
                [examPaperId],
            );
            assert.equal((await rpc(participant, "course_document_access", ["exam", examPaperId])).id, examPaperVersion);
            await assert.rejects(rpc(participant, "course_document_access", ["exam", examKeyId]), /42501/);
            await assert.rejects(rpc(client, "course_document_access", ["exam", examKeyId]), /42501/);
            await assert.rejects(rpc(client, "remove_course_exam_pdf", [runA, examKeyId]), /42501/);
            assert.equal((await rpc(admin, "course_document_access", ["exam", examKeyId])).id, examKeyVersion);
            await sql(`update public.document_versions set status='quarantined' where id=${q(examPaperVersion)}`);
            assert.deepEqual((await rpc(participant, "course_workspace", [runA])).exams.documents, []);
            assert.equal(await rpc(participant, "course_document_access", ["exam", examPaperId]), null);
            await sql(`update public.document_versions set status='clean' where id=${q(examPaperVersion)}`);
            await rpc(admin, "remove_course_exam_pdf", [runA, examKeyId]);
            await assert.rejects(rpc(admin, "course_document_access", ["exam", examKeyId]), /42501/);
            assert.equal(await rpc(admin, "share_course_exam_pdf", [runA, examKeyVersion, "exam_staff"]), examKeyId);
            await rpc(client, "set_course_exam_required", [runA, false, 1]);
            assert.deepEqual((await rpc(participant, "course_workspace", [runA])).exams.documents, []);
            await assert.rejects(rpc(participant, "course_document_access", ["exam", examPaperId]), /42501/);
            await rpc(lecturer, "set_course_exam_required", [runA, true, 2]);
            assert.deepEqual((await rpc(lecturer, "course_workspace", [runA])).exams.documents.map((item) => item.id), [examPaperId, examKeyId]);
            await assert.rejects(rpc(lecturer, "set_course_exam_required", [runB, false, 0]), /42501/);
            const revisedPaper = randomUUID(), separatePaper = randomUUID(), separateVersion = randomUUID();
            await sql(`insert into public.documents(id,owner_id,uploaded_by,scope,kind,original_name,mime_type,size_bytes,status,client_id)
                values (${q(separatePaper)},${q(admin)},${q(admin)},'personal','material','Fictional separate paper.pdf','application/pdf',20,'clean',${q(randomUUID())});
                insert into public.document_versions(id,document_id,uploaded_by,client_id,version,object_path,original_name,mime_type,size_bytes,status,sha256)
                values (${q(revisedPaper)},${q(examPaperDocument)},${q(admin)},${q(randomUUID())},2,'fictional/revised.pdf','Fictional revised exam.pdf','application/pdf',20,'clean',${q("d".repeat(64))}),
                  (${q(separateVersion)},${q(separatePaper)},${q(admin)},${q(randomUUID())},1,'fictional/separate.pdf','Fictional separate paper.pdf','application/pdf',20,'clean',${q("e".repeat(64))});
                update public.documents set current_version_id=${q(revisedPaper)} where id=${q(examPaperDocument)};
                update public.documents set current_version_id=${q(separateVersion)} where id=${q(separatePaper)};`);
            const readPaper = (who, id) => rpc(who, "course_document_access", ["exam", id]);
            const learnerPapers = async () => new Set(
                (await rpc(participant, "course_workspace", [runA])).exams.documents.map(({id}) => id),
            );
            // Even a newer scanner-confirmed upload leaves the older published
            // bytes in place until an editor explicitly publishes the update.
            assert.equal((await readPaper(participant, examPaperId)).id, examPaperVersion);
            const revisedShare = await rpc(admin, "share_course_exam_pdf", [runA, revisedPaper, "students"]);
            const separateShare = await rpc(admin, "share_course_exam_pdf", [runA, separateVersion, "students"]);
            assert.deepEqual(await learnerPapers(), new Set([revisedShare, separateShare]));
            await assert.rejects(readPaper(participant, examPaperId), /42501/);
            assert.equal((await readPaper(admin, examPaperId)).id, examPaperVersion);
            assert.equal((await readPaper(participant, revisedShare)).id, revisedPaper);
            await rpc(client, "set_course_exam_required", [runA, false, 3]);
            assert.deepEqual(await learnerPapers(), new Set());
            await assert.rejects(readPaper(participant, revisedShare), /42501/);
            await rpc(lecturer, "set_course_exam_required", [runA, true, 4]);
            assert.deepEqual(await learnerPapers(), new Set([revisedShare, separateShare]));
            await rpc(admin, "remove_course_exam_pdf", [runA, revisedShare]);
            assert.deepEqual(await learnerPapers(), new Set([separateShare]));
            await assert.rejects(readPaper(participant, examPaperId), /42501/);
            await assert.rejects(readPaper(participant, revisedShare), /42501/);
            assert.equal(await sql(`select status from public.document_versions where id=${q(examPaperVersion)}`), "clean");
            // Reuse the fixture's scanned-byte metadata to exercise the legacy
            // learner dispatcher without sharing the exam's actual attachment.
            const document = randomUUID(), version = randomUUID();
            await sql(`insert into public.documents(id, owner_id, uploaded_by, scope, kind, original_name, mime_type, size_bytes, status, client_id)
              values (${q(document)},${q(admin)},${q(admin)},'personal','material','Fictional handout.pdf','application/pdf',20,'clean',${q(randomUUID())});
              insert into public.document_versions(id,document_id,uploaded_by,client_id,version,object_path,original_name,mime_type,size_bytes,status,sha256)
              values (${q(version)},${q(document)},${q(admin)},${q(randomUUID())},1,'fictional/handout.pdf','Fictional handout.pdf','application/pdf',20,'clean',${q("c".repeat(64))});
              update public.documents set current_version_id=${q(version)} where id=${q(document)};
              insert into private.course_resources(id,run_id,version_id,audience,category,created_by)
              values (${q(learnerResource)},${q(runA)},${q(version)},'participants','material',${q(admin)});
              insert into private.course_completion_records(id,run_id,user_id,snapshot)
              values (${q(learnerCompletion)},${q(runA)},${q(participant)},'{"course":"Fictional course"}');`);
            learnerResourceVersion = version;
            assert.equal((await rpc(participant, "course_document_access", ["resource", learnerResource])).id, version);
            assert.equal((await rpc(participant, "course_document_access", ["completion", learnerCompletion])).id, learnerCompletion);
            await assert.rejects(rpc(participant, "course_document_access", ["attendance", runA]), /42501/);
        },
    );

    await check(
        "Course chat auto-membership, text posting and closed private chat paths",
        async () => {
            await sql(`delete from public.chat_members where room_id=${q(roomA)} and user_id=${q(participant)}`);
            await rpc(admin, "manage_course_enrolment", [runA, participant, "enrolled"]);
            assert.equal(await sql(`select count(*) from public.chat_members where room_id=${q(roomA)} and user_id=${q(participant)} and removed_at is null`), "1");
            assert.deepEqual(await rpc(participant, "course_chat_rooms", [runA]), [{id: roomA, title: "Fictional company A room", can_post: true}]);
            await assert.rejects(rpc(lecturer, "course_chat_messages", [roomB, null, null, 50]), /42501/);
            await assert.rejects(rpc(participant, "course_chat_messages", [randomUUID(), null, null, 50]), /42501/);
            await assert.rejects(actor(participant,
                "set local request.path='/rpc/send_message';select private.require_portal_access()"), /42501/);
            assert.equal(await actor(participant,
                "set local request.path='/rpc/send_course_chat_message';select private.require_portal_access();select 1"), "1");
            const requestId = randomUUID();
            courseChatMessageId = await rpc(participant, "send_course_chat_message", [roomA, "Fictional course question", requestId]);
            assert.equal(await rpc(participant, "send_course_chat_message", [roomA, "Fictional course question", requestId]), courseChatMessageId);
            const messages = await rpc(participant, "course_chat_messages", [roomA, null, null, 50]);
            assert.deepEqual(messages.map((item) => [item.id, item.body]), [[courseChatMessageId, "Fictional course question"]]);
            const defaultPage = await rpc(participant, "course_chat_messages", [roomA]);
            assertLmsResponse("course_chat_messages", defaultPage);
            assert.deepEqual(defaultPage, messages);
            await assert.rejects(
                rpc(participant, "course_chat_messages", [roomA, messages[0].created_at]),
                /Invalid course chat page/,
            );
            await assert.rejects(
                rpc(participant, "send_course_chat_message", [roomA, "x".repeat(8001), randomUUID()]),
                /Invalid message/,
            );
            assert.equal("document_id" in messages[0], false);
            assert.deepEqual(await rpc(client, "course_chat_rooms", [runA]), [{id: roomA, title: "Fictional company A room", can_post: false}]);
            assert.deepEqual(await rpc(client, "course_chat_messages", [roomA, null, null, 50]), messages);
            await assert.rejects(rpc(client, "course_chat_messages", [roomB, null, null, 50]), /42501/);
            await assert.rejects(rpc(client, "send_course_chat_message", [roomA, "Rejected company post", randomUUID()]), /42501/);
            assert.equal(await actor(client, `select count(*) from public.messages where id=${q(courseChatMessageId)}`), "0");
            const learnerSearch = await rpc(participant, "unified_search", [
                "Fictional course question", "chats", null, null, null, 40,
            ]);
            assert.equal(learnerSearch.items[0].url, `/courses/${runA}/workspace#course-chat`);
            const staffSearch = await rpc(admin, "unified_search", [
                "Fictional course question", "chats", null, null, null, 40,
            ]);
            assert.equal(staffSearch.items[0].url, `/chats?room=${roomA}`);
            courseChatMessageB = await rpc(participant, "send_course_chat_message", [
                roomB, "Fictional company B safe message", randomUUID(),
            ]);
        },
    );

    await check(
        "Realtime activity carries only an opaque room revision and follows current chat scope",
        async () => {
            // Authenticate each query with the same actor claim used by Realtime's RLS check.
            const events = async (who) => JSON.parse(await actor(
                who, "select coalesce(jsonb_agg(to_jsonb(activity) order by room_id),'[]') from public.course_chat_activity activity",
            ));
            const eventFor = (entries, room) => entries.find((entry) => entry.room_id === room);
            const initial = eventFor(await events(participant), roomA);
            assert.deepEqual(Object.keys(initial).sort(), ["id", "revision", "room_id"]);
            assert.deepEqual(await events(client), [initial]);
            assert.deepEqual(await events(lecturer), [initial]);
            assert.deepEqual(await events(manager), []);
            assert.equal(await actor(client, `select count(*) from public.messages where id=${q(courseChatMessageId)}`), "0");
            await assert.rejects(
                sql("set role anon; select count(*) from public.course_chat_activity"), /42501/,
            );
            await assert.rejects(actor(participant,
                "set local request.path='/course_chat_activity';select private.require_portal_access()"), /42501/);
            await assert.rejects(actor(lecturer,
                `update public.course_chat_activity set revision=gen_random_uuid() where room_id=${q(roomA)}`), /42501/);

            // A rolled-back change cannot update a committed marker. A real edit
            // changes the revision while retaining the opaque replica identity.
            const updated = async () => eventFor(await events(participant), roomA);
            await sql(`begin; update public.messages set body='Rolled back' where id=${q(courseChatMessageId)}; rollback;`);
            assert.deepEqual(await updated(), initial);
            await sql(`update public.messages set body=body where id=${q(courseChatMessageId)};`);
            assert.equal((await updated()).id, initial.id);
            assert.notEqual((await updated()).revision, initial.revision);
            assert.equal(await sql("select relreplident from pg_class where oid='public.course_chat_activity'::regclass"), "d");

            await sql(`update public.chat_members set removed_at=now() where room_id=${q(roomA)} and user_id=${q(participant)};`);
            assert.deepEqual((await events(participant)).map((entry) => entry.room_id), [roomB]);
            assert.ok(eventFor(await events(client), roomA));
            await sql(`update public.chat_members set removed_at=null where room_id=${q(roomA)} and user_id=${q(participant)};`);

            await sql(`update public.client_organisation_memberships set removed_at=now() where organisation_id=${q(companyA)} and user_id=${q(client)};`);
            assert.deepEqual(await events(client), []);
            await sql(`update public.client_organisation_memberships set removed_at=null where organisation_id=${q(companyA)} and user_id=${q(client)};`);
            assert.ok(eventFor(await events(client), roomA));
        },
    );

    await check(
        "Course chat drafts are owner scoped; only a clean exact version can be posted and read",
        async () => {
            const ownedDraft = await rpc(lecturer, "reserve_message_document", [
                "Staff exercise.txt", "text/plain", 12, roomA, randomUUID(),
            ]);
            await assert.rejects(rpc(lecturer, "reserve_document", [
                "Replacement.txt", "text/plain", 12, "room", "chat", roomA, null,
                randomUUID(), ownedDraft.document_id, null,
            ]), /22023/);
            const key = randomUUID();
            const reserve = ["Exercise.txt", "text/plain", 12, roomA, key];
            await assert.rejects(rpc(client, "reserve_course_chat_document", reserve), /42501/);
            await assert.rejects(rpc(lecturer, "reserve_course_chat_document", [...reserve.slice(0, 3), roomB, key]), /42501/);
            await assert.rejects(rpc(participant, "reserve_document", ["Exercise.txt", "text/plain", 12, "room", "chat", roomA, null, key, null, null]), /42501/);
            for (const path of ["/documents", "/document_versions", "/rpc/reserve_message_document"]) {
                await assert.rejects(actor(participant, `set local request.path=${q(path)};select public.require_portal_access()`), /42501/);
            }
            await actor(participant, "set local request.path='/rpc/reserve_course_chat_document';select public.require_portal_access()");
            const draft = await rpc(participant, "reserve_course_chat_document", reserve);
            assert.deepEqual(await rpc(participant, "reserve_course_chat_document", reserve), draft);
            const [draftId, version] = [draft.document_id, draft.version_id];
            assert.equal(await actor(participant, `select count(*) from public.documents where id=${q(draftId)}`), "0");
            attachedVersion = version;
            assert.equal((await rpc(participant, "course_chat_upload_status", [roomA, draftId, version])).document.status, "quarantined");
            assert.equal(await rpc(lecturer, "course_chat_upload_status", [roomA, draftId, version]), null);
            const requestId = randomUUID();
            const post = [roomA, "", requestId, draftId, version];
            await assert.rejects(rpc(participant, "send_course_chat_attachment", post), /42501/);
            const hash = "d".repeat(64);
            await sql(`update public.documents set status='clean' where id=${q(draftId)};
                      update public.document_versions set status='clean', sha256=${q(hash)} where id=${q(version)};`);
            await assert.rejects(rpc(lecturer, "send_course_chat_attachment", post), /42501/);
            await assert.rejects(rpc(participant, "send_course_chat_attachment", [...post.slice(0, 4), randomUUID()]), /42501/);
            attachedChatMessage = await rpc(participant, "send_course_chat_attachment", post);
            assert.equal(await rpc(participant, "send_course_chat_attachment", post), attachedChatMessage);
            const history = await rpc(client, "course_chat_messages", [roomA, null, null, 50]);
            assert.deepEqual(history.find((message) => message.id === attachedChatMessage)?.attachment, {
                version_id: version, name: "Exercise.txt", size_bytes: 12,
            });
            const route = [attachedChatMessage, version, null, null];
            for (const who of [client, lecturer, participant]) {
                assert.equal((await rpc(who, "course_chat_attachment_access", route)).sha256, hash);
            }
            await assert.rejects(rpc(participant, "course_chat_attachment_access", [attachedChatMessage, randomUUID(), null, null]), /42501/);
            await assert.rejects(rpc(manager, "course_chat_attachment_access", route), /42501/);
            await sql(`insert into private.chat_hidden_messages(user_id,message_id) values(${q(lecturer)},${q(attachedChatMessage)})`);
            await assert.rejects(rpc(lecturer, "course_chat_attachment_access", route), /42501/);
            await sql(`update public.chat_members set removed_at=now() where room_id=${q(roomA)} and user_id=${q(participant)}`);
            await assert.rejects(rpc(participant, "send_course_chat_attachment", post), /42501/);
            await assert.rejects(rpc(participant, "course_chat_attachment_access", route), /42501/);
            assert.equal(await rpc(participant, "course_chat_upload_status", [roomA, draftId, version]), null);
            await sql(`update public.chat_members set removed_at=null where room_id=${q(roomA)} and user_id=${q(participant)}`);
        },
    );

    await check(
        "Published OpenAPI matches Premium workspaces, commands and the company roster",
        async () => {
            const config = {
                questions: [{prompt: "Select option one", options: ["One", "Two"], correct: 0}],
                pass_percent: 50,
                max_attempts: 2,
                published: true,
            };
            assertLmsResponse("course_workspace_action",
                await rpc(lecturer, "course_workspace_action", [runA, "quiz_config", config, 0]));
            assertLmsResponse("course_workspace_action",
                await rpc(participant, "course_workspace_action", [runA, "notebook", {body: "Fictional note"}, 0]));
            const learner = await rpc(participant, "course_workspace", [runA]);
            const teacher = await rpc(lecturer, "course_workspace", [runA]);
            const company = await rpc(client, "course_workspace", [runA]);
            for (const dto of [learner, teacher, company]) assertLmsResponse("course_workspace", dto);
            assert.deepEqual(learner.roster, []);
            assert.deepEqual(learner.attendance_history, []);
            assert.equal(learner.notebook.body, "Fictional note");
            assert.ok(!("correct" in learner.quiz.questions[0]));
            assert.equal(teacher.quiz.questions[0].correct, 0);
            assert.ok(!("correct" in company.quiz.questions[0]));
            assertLmsResponse("course_enrolments", await rpc(client, "course_enrolments", [runA]));
            assertLmsResponse("my_course_workspaces", await rpc(participant, "my_course_workspaces"));
        },
    );

    await check(
        "A OFF keeps Standard enrolment and workspace while scoped Premium actions are unavailable",
        async () => {
            const statusA = (await rpc(admin, "company_premium_settings")).find(
                (item) => item.organisation_id === companyA,
            );
            assert.equal(statusA.enabled, true);
            const off = await toggle(admin, companyA, false, statusA.version);
            assert.deepEqual(
                JSON.parse(await actor(participant, "select jsonb_agg(room_id) from public.course_chat_activity")),
                [roomB],
            );
            assert.equal(await actor(client, "select count(*) from public.course_chat_activity"), "0");
            assert.equal(off.enabled, false);
            await assert.rejects(rpc(client, "course_chat_rooms", [runA]), /42501/);
            await assert.rejects(rpc(client, "course_chat_messages", [roomA, null, null, 50]), /42501/);
            const standard = await rpc(participant, "course_workspace", [runA]);
            assert.equal(standard.access.learner, true);
            assert.equal(standard.lms_enabled, false);
            assert.equal(standard.quiz, null);
            assert.equal(standard.completion, null);
            await assert.rejects(rpc(participant, "course_chat_rooms", [runA]), /42501/);
            await assert.rejects(rpc(participant, "course_chat_messages", [roomA, null, null, 50]), /42501/);
            await assert.rejects(rpc(participant, "send_course_chat_message", [roomA, "blocked", randomUUID()]), /42501/);
            await assert.rejects(rpc(admin, "create_chat_group", [
                "Blocked OFF course", [admin], "participant_course", jobA,
            ]), /42501/);
            assert.deepEqual(await rpc(participant, "course_chat_rooms", [runB]), [{id: roomB, title: "Fictional company B room", can_post: true}]);
            assert.equal((await rpc(participant, "course_chat_messages", [roomB, null, null, 50])).length, 1);
            const visibleChats = await rpc(participant, "unified_search", [
                "Fictional company", "chats", null, null, null, 40,
            ]);
            assert.deepEqual(visibleChats.items.map((item) => item.id), [courseChatMessageB]);
            assert.equal(visibleChats.items[0].url, `/courses/${runB}/workspace#course-chat`);
            assert.equal(await actor(participant,
                `select count(*) from public.messages where id=${q(courseChatMessageId)}`), "0");
            await assert.rejects(rpc(admin, "inspect_company_course_chat", [companyA, runB, "Fictional audit", null, null]), /42501/);
            await assert.rejects(rpc(manager, "inspect_company_course_chat", [companyA, runA, "Fictional audit", null, null]), /42501/);
            await assert.rejects(rpc(participant, "inspect_company_course_chat", [companyA, runA, "Fictional audit", null, null]), /42501/);
            await assert.rejects(rpc(secondAdmin, "inspect_company_course_chat", [companyA, runA, "short", null, null]), /22023/);
            assert.equal(await actor(secondAdmin, `select count(*) from public.messages where id=${q(courseChatMessageId)}`), "0");
            const auditChat = await rpc(secondAdmin, "inspect_company_course_chat", [companyA, runA, "Fictional audit", null, null]);
            assert.deepEqual(auditChat.items.map((item) => item.id), [attachedChatMessage, courseChatMessageId]);
            assert.equal(auditChat.items[0].attachment.version_id, attachedVersion);
            assert.deepEqual(Object.keys(auditChat.items[0]).sort(), ["attachment", "body", "created_at", "id", "room_title", "sender_name"]);
            const auditDetail = JSON.parse(await sql(`select details from public.audit_events where action='course.chat_inspected' and resource_id=${q(runA)}`));
            assert.equal(auditDetail.purpose, "Fictional audit");
            assert.equal(auditDetail.premium_enabled, false);
            for (const who of [participant, lecturer, client]) {
                await assert.rejects(rpc(who, "course_chat_attachment_access", [attachedChatMessage, attachedVersion, null, null]), /42501/);
            }
            await assert.rejects(rpc(secondAdmin, "course_chat_attachment_access", [attachedChatMessage, attachedVersion, companyB, "Fictional audit"]), /42501/);
            assert.equal((await rpc(secondAdmin, "course_chat_attachment_access", [attachedChatMessage, attachedVersion, companyA, "Fictional audit"])).version_id, attachedVersion);
            assert.equal(await sql(`select count(*) from public.audit_events where action='course.chat_inspected'
                and resource_id=${q(runA)} and details->>'attachment_version_id'=${q(attachedVersion)}`), "1");
            await assert.rejects(rpc(participant, "course_document_access", ["exam", examPaperId]), /42501/);
            await assert.rejects(rpc(participant, "course_document_access", ["resource", learnerResource]), /42501/);
            await assert.rejects(rpc(participant, "course_document_access", ["completion", learnerCompletion]), /42501/);
            await assert.rejects(
                rpc(participant, "course_workspace_action", [runA, "quiz_submit", {answer: "fictional"}, 0]),
                /42501/,
            );
            assert.ok((await rpc(manager, "course_enrolments", [runA])).some(
                (row) => row.user_id === participant,
            ));
            await assert.rejects(
                rpc(client, "manage_course_enrolment", [runB, participant, "removed"]),
                /42501/,
            );
            await assert.rejects(
                rpc(participant, "course_document_access", ["attendance", runA]),
                /42501/,
            );
            assert.equal(
                await actor(
                    participant,
                    `select count(*) from public.chat_rooms where id='${roomA}'`,
                ),
                "0",
            );
            assert.equal(
                await actor(
                    participant,
                    `select count(*) from public.chat_rooms where id='${roomB}'`,
                ),
                "1",
            );
            const search = await rpc(participant, "unified_search", [
                "Fictional retained LMS course",
                "courses",
                null,
                null,
                null,
                40,
            ]);
            assert.deepEqual(search.items.map((item) => item.id), [runB]);
            const bWorkspace = await rpc(participant, "course_workspace", [runB]);
            assert.equal(bWorkspace.lms_enabled, true);
            assert.equal(bWorkspace.access.learner, true);
            const visible = await rpc(participant, "my_course_workspaces");
            assert.deepEqual(new Set(visible.map((course) => course.id)), new Set([runA, runB]));
            for (const who of [manager, lecturer, client]) {
                const workspace = await rpc(who, "course_workspace", [runA]);
                assertLmsResponse("course_workspace", workspace);
                assert.equal(workspace.lms_enabled, false);
                assert.equal(workspace.title, "Fictional retained LMS course");
                assert.deepEqual(workspace.sessions.map(({id}) => id), [sessionA]);
                assert.equal(workspace.sessions[0].can_verify, false);
                assert.deepEqual(workspace.resources, []);
                assert.deepEqual(workspace.exams.documents, []);
                assert.deepEqual(workspace.roster, []);
                assert.deepEqual(workspace.preparation, []);
                assert.equal(workspace.meeting_link, null);
            }
            await assert.rejects(rpc(client, "course_workspace", [runB]), /42501/);
            await assert.rejects(
                rpc(manager, "course_workspace_action", [runA, "contact_select", {}, 0]),
                /42501/,
            );
            const baseCourses = await rpc(manager, "my_course_workspaces"),
                companyRun = baseCourses.find((course) => course.id === runA);
            assert.equal(companyRun.lms_enabled, false);
            assert.equal(companyRun.title, "Fictional retained LMS course");
        },
    );

    await check(
        "Re-enable restores only current memberships; retained-data access is admin-only and audited",
        async () => {
            const version = (await rpc(admin, "company_premium_settings")).find(
                (item) => item.organisation_id === companyA,
            ).version;
            await rpc(admin, "set_company_premium", [companyA, true, version, randomUUID()]);
            assert.deepEqual(
                (await rpc(participant, "my_course_workspaces")).map((course) => course.id).sort(),
                [runA, runB].sort(),
            );
            await rpc(admin, "remove_company_participant", [
                companyA,
                participant,
                1,
                randomUUID(),
            ]);
            await assert.rejects(rpc(participant, "course_chat_messages", [roomA, null, null, 50]), /42501/);
            await assert.rejects(rpc(participant, "course_chat_attachment_access", [
                attachedChatMessage, attachedVersion, null, null,
            ]), /42501/);
            assert.equal(await actor(participant, `select count(*) from public.messages where id=${q(attachedChatMessage)}`), "0");
            let current = (await rpc(admin, "company_premium_settings")).find(
                (item) => item.organisation_id === companyA,
            ).version;
            await rpc(admin, "set_company_premium", [companyA, false, current, randomUUID()]);
            current = (await rpc(admin, "company_premium_settings")).find(
                (item) => item.organisation_id === companyA,
            ).version;
            await rpc(admin, "set_company_premium", [companyA, true, current, randomUUID()]);
            assert.deepEqual(
                (await rpc(participant, "my_course_workspaces")).map((course) => course.id),
                [runB],
            );
            const retained = await rpc(admin, "retained_company_lms", [companyA]);
            assertLmsResponse("retained_company_lms", retained);
            assert.equal(retained.premium_enabled, true);
            assert.equal(retained.course_count, 1);
            assert.equal(retained.courses[0].title, "Fictional retained LMS course");
            assert.equal("notebook" in retained.courses[0], false);
            await assert.rejects(rpc(manager, "retained_company_lms", [companyA]), /42501/);
            assert.equal(
                await sql(
                    `select count(*) from public.audit_events where actor_id='${admin}' and action='company.premium_retained_data_viewed' and resource_id='${companyA}'`,
                ),
                "1",
            );
            assert.equal(
                await sql(
                    `select count(*) from public.course_enrolments where course_run_id='${runA}' and user_id='${participant}' and status='removed'`,
                ),
                "1",
            );
        },
    );

    await check("Retained attendance reads exact recorded rows while operational access stays closed", async () => {
        const reason = "Fictional archived register review";
        const inspection = [companyA, runA, reason];
        await assert.rejects(rpc(admin, "inspect_retained_course_attendance", inspection), /42501/);

        const version = (await rpc(admin, "company_premium_settings")).find(
            (setting) => setting.organisation_id === companyA,
        ).version;
        await toggle(admin, companyA, false, version);
        const ids = Array.from({length: 50}, () => randomUUID());
        await sql(`insert into auth.users(id, email)
          values ${ids.map((id) => `(${q(id)}, ${q(`${id}@example.invalid`)})`).join(",")};
          insert into private.course_attendance(session_id,user_id,state,register_status,staff_note)
          values ${[participant, ...ids].map((id) => `(${q(sessionA)},${q(id)},'absent','excused','Fictional retained note')`).join(",")};
          insert into private.course_attendance(session_id,user_id,state,staff_note)
          values (${q(sessionB)},${q(participant)},'attended','Other company note');`);

        for (const who of [owner, manager, lecturer, client, participant])
            await assert.rejects(rpc(who, "inspect_retained_course_attendance", inspection), /42501/);
        await assert.rejects(rpc(admin, "inspect_retained_course_attendance", [companyA, runB, reason]), /42501/);
        await assert.rejects(rpc(admin, "inspect_retained_course_attendance", [companyA, runA, "short"]), /22023/);
        await assert.rejects(rpc(admin, "inspect_retained_course_attendance", [...inspection, "2026-06-01T00:00:00Z", null, null]), /22023/);
        const register = await rpc(admin, "course_session_register", [runA, sessionA]);
        assert.deepEqual(register.evidence, []);
        await assert.rejects(rpc(admin, "save_course_session_attendance", [
            runA, sessionB, participant, "present", null, null, "", "Fictional cross-course edit", 1,
        ]), /42501/);

        const page = await rpc(admin, "inspect_retained_course_attendance", inspection);
        assertLmsResponse("inspect_retained_course_attendance", page);
        assert.equal(page.items.length, 50);
        const next = page.next_cursor;
        assert.ok(next);
        const last = await rpc(admin, "inspect_retained_course_attendance", [
            ...inspection, next.starts_at, next.session_id, next.user_id,
        ]);
        assertLmsResponse("inspect_retained_course_attendance", last);
        assert.equal(last.next_cursor, null);
        assert.equal(last.items.length, 1);
        const rows = [...page.items, ...last.items];
        assert.deepEqual(rows.map((row) => row.user_id).sort(), [participant, ...ids].sort());
        assert.ok(rows.every((row) => row.session_id === sessionA && row.status === "excused" && row.note === "Fictional retained note"));

        const audit = JSON.parse(await sql(`select jsonb_agg(details order by (details->>'returned_count')::int desc) from public.audit_events
          where action='course.retained_attendance_inspected' and actor_id=${q(admin)} and resource_id=${q(runA)}`));
        assert.deepEqual(audit, [50, 1].map((returned_count) => ({organisation_id: companyA, purpose: reason, returned_count})));
    });
    await check("Retained file inspection binds current internal admin, company, course and clean exact versions", async () => {
        const reason = "Fictional file audit";
        const inspection = [companyA, runA, reason];
        const exactExam = [companyA, runA, "exam", examKeyId, examKeyVersion, reason];
        const exactMaterial = [companyA, runA, "material", learnerResource, learnerResourceVersion, reason];
        const access = (who, args, audit = false) => rpc(who, "retained_course_file_access", [...args, audit]);

        for (const who of [owner, manager, lecturer, client, participant]) {
            await assert.rejects(rpc(who, "inspect_retained_course_files", inspection), /42501/);
            await assert.rejects(access(who, exactExam), /42501/);
        }
        await sql(`update public.profiles set active=false where id=${q(secondAdmin)};`);
        await assert.rejects(access(secondAdmin, exactExam), /42501/);
        await sql(`update public.profiles set active=true where id=${q(secondAdmin)};`);
        await assert.rejects(rpc(admin, "inspect_retained_course_files", [companyA, runB, reason]), /42501/);
        await assert.rejects(rpc(admin, "inspect_retained_course_files", [...inspection, "exam"]), /22023/);
        await assert.rejects(rpc(admin, "inspect_retained_course_files", [companyA, runA, "short"]), /22023/);
        await assert.rejects(access(admin, [companyB, runB, ...exactExam.slice(2)]), /42501/);
        await assert.rejects(access(admin, [companyA, runA, "material", ...exactExam.slice(3)]), /42501/);
        await assert.rejects(access(admin, [...exactExam.slice(0, 4), examPaperVersion, reason]), /42501/);
        await assert.rejects(rpc(admin, "course_document_access", ["resource", learnerResource]), /42501/);

        await sql(`update private.course_exam_documents set removed_at=now() where id=${q(examKeyId)};
          update public.document_versions set status='quarantined' where id=${q(examPaperVersion)};`);
        const page = await rpc(admin, "inspect_retained_course_files", inspection);
        assertLmsResponse("inspect_retained_course_files", page);
        assert.equal(page.next_cursor, null);
        assert.ok(page.items.every((file) => file.version_id !== examPaperVersion));
        assert.deepEqual(page.items.find((file) => file.id === examKeyId), {
            file_kind: "exam", id: examKeyId, version_id: examKeyVersion, version: 1,
            name: "Fictional answer key.pdf", audience: "exam_staff", withdrawn: true,
        });
        assert.equal(page.items.find((file) => file.id === learnerResource).version_id, learnerResourceVersion);
        const proof = await access(admin, exactExam);
        assert.equal(proof.version_id, examKeyVersion);
        assert.equal(proof.sha256, "b".repeat(64));
        assert.equal(proof.object_path, undefined);
        assert.equal((await access(admin, exactMaterial)).version_id, learnerResourceVersion);
        assert.equal(await sql(`select count(*) from public.audit_events
          where action='course.retained_file_download_authorized' and resource_id=${q(runA)}`), "0");
        assert.deepEqual(await access(admin, exactExam, true), proof);
        const audit = JSON.parse(await sql(`select details from public.audit_events
          where action='course.retained_file_download_authorized' and actor_id=${q(admin)} and resource_id=${q(runA)}`));
        assert.deepEqual(audit, {
            organisation_id: companyA, purpose: reason, file_kind: "exam",
            file_id: examKeyId, version_id: examKeyVersion,
        });

        const fence = randomUUID();
        const scope = [{table: "public.documents", predicate: `x.id = ${q(examKeyDocument)}`}];
        await sql(`insert into private.deletion_operations(id, actor_id, request_id, plan_id, kind, target_id, scope, authority)
          values (${q(fence)}, ${q(admin)}, ${q(randomUUID())}, ${q(randomUUID())}, 'document',
            ${q(examKeyDocument)}, ${q(JSON.stringify(scope))}, 'Fictional deletion fixture')`);
        const fenced = await rpc(admin, "inspect_retained_course_files", inspection);
        assert.ok(fenced.items.every((file) => file.id !== examKeyId));
        await assert.rejects(access(admin, exactExam), /42501/);
        await assert.rejects(access(admin, exactExam, true), /42501/);
        assert.equal((await access(admin, exactMaterial)).version_id, learnerResourceVersion);
        await sql(`delete from private.deletion_operations where id=${q(fence)}`);

        const version = (await rpc(admin, "company_premium_settings"))
            .find((setting) => setting.organisation_id === companyA).version;
        await toggle(admin, companyA, true, version);
        await assert.rejects(rpc(admin, "inspect_retained_course_files", inspection), /42501/);
        await assert.rejects(access(admin, exactExam, true), /42501/);
    });

});

console.log(`PASS: ${checks} isolated company Premium database groups.`);


/** Plain SQL fixtures omit Realtime by default. Exercise the exact migration's
 * native-publication path separately without claiming WebSocket delivery. */
await withTestDatabase("course_chat_publication", async ({sql}) => {
    await sql("create publication supabase_realtime for table public.messages, public.chat_members");
    await sql(await readFile(
        new URL("../supabase/migrations/20261122007100_course_chat_activity.sql", import.meta.url),
        "utf8",
    ));
    assert.equal(await sql(`select string_agg(tablename,',' order by tablename)
        from pg_publication_tables where pubname='supabase_realtime' and schemaname='public'`),
        "chat_members,course_chat_activity,messages");
    console.log("PASS exact migration registers the metadata marker in the existing Realtime publication");
}, {migrationsThrough: "20261122007099"});
