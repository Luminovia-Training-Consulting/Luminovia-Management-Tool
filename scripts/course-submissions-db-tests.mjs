/** Exercises the real migrations, caller grants, version locks and scanner state transitions. */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {quoteSql as q, withTestDatabase} from "./testing/database.mjs";

const denied = /42501/;
const digest = "a".repeat(64);

await withTestDatabase("course_submissions_test", async ({sql, actor}) => {
    const admin = randomUUID(), teacher = randomUUID(), client = randomUUID(), unrelated = randomUUID();
    const learner = randomUUID(), peer = randomUUID(), company = randomUUID(), otherCompany = randomUUID();
    const template = randomUUID(), run = randomUUID(), otherRun = randomUUID(), job = randomUUID();
    const claim = randomUUID();
    await sql(`
        insert into auth.users(id, email) values
          ${[admin, teacher, client, unrelated, learner, peer].map((id) => `(${q(id)},${q(id + "@example.invalid")})`).join(",")};
        update auth.users set email_confirmed_at=now() where id in (${q(learner)},${q(peer)});
        insert into public.user_roles(user_id, role) values
          (${q(admin)},'admin'),(${q(teacher)},'lecturer'),(${q(client)},'client'),
          (${q(unrelated)},'client'),(${q(learner)},'participant'),(${q(peer)},'participant');
        insert into public.organisations(id, name) values
          (${q(company)},'Fictional submissions school'),(${q(otherCompany)},'Fictional other school');
        insert into public.client_organisation_memberships(user_id, organisation_id)
          values (${q(client)},${q(company)}),(${q(unrelated)},${q(otherCompany)});
        insert into public.course_templates(id, title) values (${q(template)},'Fictional learning lab');
        insert into public.course_runs(id, template_id, organisation_id)
          values (${q(run)},${q(template)},${q(company)}),(${q(otherRun)},${q(template)},${q(otherCompany)});
        insert into public.jobs(id, course_run_id, title, customer_name, delivery_type, status, amount, currency, rate_unit, total_amount, terms)
          values (${q(job)},${q(run)},'Fictional lab teacher','Fictional school','online','filled',100,'EUR','fixed_total',100,'Fictional terms');
        insert into public.job_claims(id, job_id, lecturer_id, idempotency_key, amount, currency, rate_unit, total_amount, terms, terms_version)
          values (${q(claim)},${q(job)},${q(teacher)},${q(randomUUID())},100,'EUR','fixed_total',100,'Fictional terms',1);
        insert into public.course_enrolments(course_run_id, user_id, status, enrolled_by)
          values (${q(run)},${q(learner)},'enrolled',${q(admin)}),(${q(run)},${q(peer)},'enrolled',${q(admin)});
    `);
    for (const participant of [learner, peer]) {
        const link = randomUUID();
        await sql(`
            insert into private.company_participant_link_requests(id, organisation_id, requested_by, request_id, luminovia_user_id, target_user_id, status, expires_at)
              values (${q(link)},${q(company)},${q(admin)},${q(randomUUID())},
                (select luminovia_user_id from public.profiles where id=${q(participant)}),${q(participant)},'accepted',now()+interval '1 day');
            insert into private.company_participant_memberships(organisation_id,user_id,status,link_request_id,invited_by,joined_at,version)
              values (${q(company)},${q(participant)},'active',${q(link)},${q(admin)},now(),1);
        `);
    }
    const value = (item) => item === null ? "null" : typeof item === "string" ? q(item) : String(item);
    const call = (name, ...args) => `select to_jsonb(public.${name}(${args.map(value).join(",")}))`;
    const rpc = (who, name, ...args) => actor(who, call(name, ...args)).then(JSON.parse);
    const list = (who, runId = run) => rpc(who, "course_submissions", runId, null);
    const access = (who, version, runId = run, audit = false) => rpc(who, "course_submission_access", runId, version, audit);
    const reserve = (who, key, sha = digest, runId = run) =>
        rpc(who, "reserve_course_submission", runId, "lab.txt", "text/plain", 12, key, sha);
    const enable = (who, enabled) => rpc(who, "set_course_submissions", run, enabled);
    const scanQuery = (draft, action, lease, sha, scanner) =>
        call("course_submission_scan", draft.document_id, draft.version_id, action, lease, sha, scanner);
    const scan = (draft, action, lease = null, sha = null, scanner = null) =>
        sql(`begin;set local role service_role;${scanQuery(draft, action, lease, sha, scanner)};commit;`).then(JSON.parse);
    const withdraw = (who, draft) => rpc(who, "withdraw_course_submission", run, draft.version_id);

    await assert.rejects(list(learner), denied);
    await rpc(admin, "set_company_premium", company, true, 0, randomUUID());
    await rpc(admin, "set_company_premium", otherCompany, true, 0, randomUUID());
    assert.deepEqual(await list(learner), {enabled:false, can_manage:false, can_upload:false, next:null, entries:[]});
    await assert.rejects(reserve(learner, randomUUID()), denied);
    await assert.rejects(enable(learner, true), denied);
    await assert.rejects(enable(teacher, true), denied);
    await assert.rejects(enable(unrelated, true), denied);
    assert.equal(await enable(client, true), true);
    assert.equal((await list(learner)).can_upload, true);
    assert.equal((await list(teacher)).can_upload, false);
    await assert.rejects(reserve(teacher, randomUUID()), denied);
    await assert.rejects(reserve(client, randomUUID()), denied);
    await assert.rejects(reserve(learner, randomUUID(), digest, otherRun), denied);
    await assert.rejects(rpc(admin, "reserve_document", "lab.txt", "text/plain", 12, "personal",
        "participant_submission", null, null, randomUUID(), null, null), denied);
    console.log("PASS default-OFF course switch, active Premium, company boundary and learner-only uploads");

    // A second ordinary role must not remove a current enrolled participant's rights
    // or confer instructor review on an unassigned account.
    await sql(`insert into public.user_roles(user_id,role) values (${q(learner)},'lecturer')`);
    assert.equal((await list(learner)).can_upload, true);
    const key = randomUUID();
    const draft = await reserve(learner, key);
    assert.deepEqual(await reserve(learner, key), draft);
    await assert.rejects(reserve(learner, key, "b".repeat(64)), /PT409/);
    assert.equal((await list(learner)).entries.length, 0);
    await assert.rejects(access(learner, draft.version_id), denied);
    await assert.rejects(actor(learner, scanQuery(draft, "begin", null, digest, null)), denied);
    const lease = await scan(draft, "begin", null, digest);
    await assert.rejects(scan(draft, "clean", randomUUID(), digest, "ClamAV fixture"), denied);
    await assert.rejects(scan(draft, "clean", lease, "b".repeat(64), "ClamAV fixture"), denied);
    assert.equal(await scan(draft, "clean", lease, digest, "ClamAV fixture"), lease);
    assert.equal(await scan(draft, "end", lease), lease);
    assert.deepEqual((await list(learner)).entries.map((row) => [row.version_id, row.can_withdraw, row.participant]),
        [[draft.version_id, true, null]]);
    assert.equal((await list(teacher)).entries[0]?.version_id, draft.version_id);
    assert.equal((await list(client)).entries[0]?.version_id, draft.version_id);
    assert.equal((await list(admin)).entries[0]?.version_id, draft.version_id);
    assert.equal((await list(peer)).entries.length, 0);
    await assert.rejects(list(unrelated), denied);
    await assert.rejects(access(peer, draft.version_id), denied);
    await assert.rejects(access(client, draft.version_id, otherRun), denied);
    await assert.rejects(withdraw(peer, draft), denied);
    await assert.rejects(withdraw(teacher, draft), denied);
    const bytes = await access(teacher, draft.version_id, run, true);
    assert.equal(bytes.object_path, undefined);
    assert.equal(bytes.version_id, draft.version_id);
    assert.equal(await sql(`select 'course_submissions.review_accessed'=any(private.admin_audit_actions())`), "t");
    assert.equal(bytes.sha256, digest);
    assert.equal(await sql(`select count(*) from public.audit_events where action='course_submissions.review_accessed' and resource_id=${q(draft.version_id)}`), "1");
    for (const who of [learner, teacher, client, admin]) {
        assert.equal(await actor(who, `select count(*) from public.documents where id=${q(draft.document_id)}`), "0");
        assert.equal(await actor(who, `select count(*) from public.document_versions where id=${q(draft.version_id)}`), "0");
    }
    await assert.rejects(rpc(teacher, "deletion_preview", "document", draft.document_id), denied);
    const documentDeletion = await rpc(learner, "deletion_preview", "document", draft.document_id);
    assert.equal(documentDeletion.counts["private.course_submissions"], 1);
    assert.equal(documentDeletion.can_confirm, true);
    const courseDeletion = await rpc(admin, "deletion_preview", "course_run", run);
    assert.equal(courseDeletion.counts["private.course_submission_settings"], 1);
    assert.ok(courseDeletion.blockers.some(({kind}) => kind === "private.course_submissions"));
    assert.equal(courseDeletion.can_confirm, false);
    const emptyCourse = await rpc(admin, "deletion_preview", "course_run", otherRun);
    assert.equal(emptyCourse.can_confirm, true);
    await rpc(admin, "deletion_confirm", emptyCourse.plan_id, randomUUID(), "DELETE");
    await assert.rejects(rpc(admin, "set_course_submissions", otherRun, true), /55000/);
    console.log("PASS immutable scanned versions, idempotency, exact scope, RLS isolation and audited staff access");

    const inFlight = await reserve(learner, randomUUID());
    const inFlightLease = await scan(inFlight, "begin", null, digest);
    await enable(admin, false);
    await assert.rejects(scan(inFlight, "clean", inFlightLease, digest, "ClamAV fixture"), denied);
    assert.equal(await scan(inFlight, "end", inFlightLease), inFlightLease);
    assert.equal((await list(learner)).can_upload, false);
    assert.equal((await list(learner)).entries[0]?.can_withdraw, false);
    assert.equal((await access(learner, draft.version_id)).version_id, draft.version_id);
    await assert.rejects(withdraw(learner, draft), denied);
    await enable(admin, true);
    const removedDraft = await reserve(learner, randomUUID());
    const removedLease = await scan(removedDraft, "begin", null, digest);
    await sql(`update public.course_enrolments set status='completed' where course_run_id=${q(run)} and user_id=${q(learner)}`);
    await assert.rejects(scan(removedDraft, "clean", removedLease, digest, "ClamAV fixture"), denied);
    await scan(removedDraft, "end", removedLease);
    assert.equal((await list(learner)).can_upload, false);
    await sql(`update public.course_enrolments set status='enrolled' where course_run_id=${q(run)} and user_id=${q(learner)}`);
    assert.equal(await withdraw(learner, draft), true);
    await assert.rejects(access(teacher, draft.version_id), denied);
    assert.equal((await list(client)).entries.length, 0);
    const retry = await scan(inFlight, "begin", null, digest);
    await rpc(admin, "set_company_premium", company, false, 1, randomUUID());
    await assert.rejects(scan(inFlight, "clean", retry, digest, "ClamAV fixture"), denied);
    await scan(inFlight, "end", retry);
    await assert.rejects(list(admin), denied);
    console.log("PASS course closure, enrolment and Premium revocation during scanning, safe withdrawal and retained lease settlement");

    await actor(peer, "set local request.method='POST';set local request.path='/rpc/course_submissions';select public.require_portal_access()");
    await assert.rejects(actor(peer, "set local request.method='GET';set local request.path='/rpc/course_submissions';select public.require_portal_access()"), denied);
    await assert.rejects(actor(peer, "set local request.method='POST';set local request.path='/rpc/course_submission_scan';select public.require_portal_access()"), denied);
    await assert.rejects(sql("begin;set local role anon;select public.course_submissions(null);commit;"), denied);
    console.log("PASS allowlisted participant PostgREST methods and worker denial");

    await rpc(admin, "set_company_premium", company, true, 2, randomUUID());
    await enable(admin, false);
    const paperDocument = randomUUID(), paperVersion = randomUUID();
    await sql(`
      insert into public.course_sessions(course_run_id,starts_at,ends_at)
        values (${q(run)},now()-interval '3 hours',now()+interval '3 hours');
      insert into public.documents(id,owner_id,uploaded_by,scope,kind,original_name,mime_type,size_bytes,status,client_id)
        values (${q(paperDocument)},${q(teacher)},${q(teacher)},'personal','material','exam.pdf','application/pdf',24,'clean',${q(randomUUID())});
      insert into public.document_versions(id,document_id,uploaded_by,client_id,version,object_path,original_name,mime_type,size_bytes,status,sha256)
        values (${q(paperVersion)},${q(paperDocument)},${q(teacher)},${q(randomUUID())},1,'fictional/exam.pdf','exam.pdf','application/pdf',24,'clean',${q(digest)});
    `);
    const schedule = (who, visible, start, end, version) => actor(who,`
        select to_jsonb(public.save_course_exam_schedule(${q(run)},'Timed exam',
          now()+interval ${q(visible)},now()+interval ${q(start)},now()+interval ${q(end)},60,${version}))
    `).then(JSON.parse);
    const state = (who) => actor(who, call("course_exam_state", run)).then((raw) => raw ? JSON.parse(raw) : null);
    const examReserve = (who) => rpc(who, "reserve_course_exam_submission", run, "filled.txt", "text/plain", 12, randomUUID(), digest);
    let paperShare;
    const paperAccess = (who) => rpc(who, "course_document_access", "exam", paperShare);
    const submit = (who, exam) => rpc(who, "submit_course_exam", run, exam.version_id);
    const grades = (who, scores, version, publish) =>
        rpc(who, "save_course_exam_grades", run, JSON.stringify(scores), version, publish);
    const results = (who, participant = null, organisation = null) =>
        rpc(who, "published_course_exam_results", participant, organisation);

    await assert.rejects(schedule(teacher, "10 minutes", "20 minutes", "2 days", 0), /22023/);
    await assert.rejects(schedule(learner, "10 minutes", "20 minutes", "40 minutes", 0), denied);
    await assert.rejects(rpc(teacher, "share_course_exam_pdf", run, paperVersion, "students"), denied);
    assert.equal(await schedule(teacher, "10 minutes", "20 minutes", "40 minutes", 0), true);
    paperShare = await rpc(teacher, "share_course_exam_pdf", run, paperVersion, "students");
    assert.ok(paperShare);
    await actor(learner, "set local request.method='POST';set local request.path='/rpc/course_exam_state';select public.require_portal_access()");
    await assert.rejects(actor(peer, "set local request.method='POST';set local request.path='/rpc/save_course_exam_grades';select public.require_portal_access()"), denied);
    assert.equal(await state(learner), null);
    await assert.rejects(examReserve(learner), denied);
    await assert.rejects(paperAccess(learner), denied);
    assert.equal(await schedule(teacher, "-10 minutes", "20 minutes", "40 minutes", 1), true);
    assert.equal((await state(learner)).open, false);
    await assert.rejects(paperAccess(learner), denied);
    // The allowance is visible to management and its recipient only.
    const setTime = (who, user, minutes, revision) =>
        rpc(who, "set_course_exam_extra_time", run, user, minutes, revision);
    await assert.rejects(setTime(teacher, learner, 15, 0), denied);
    await assert.rejects(setTime(client, learner, 15, 0), denied);
    await assert.rejects(setTime(learner, learner, 15, 0), denied);
    await assert.rejects(setTime(admin, unrelated, 15, 0), denied);
    await assert.rejects(setTime(admin, learner, 481, 0), /22023/);
    assert.equal(await setTime(admin, learner, 15, 0), 1);
    assert.equal(await setTime(admin, learner, 15, 0), 1);
    await assert.rejects(setTime(admin, learner, 10, 0), /PT409/);
    assert.equal(await setTime(admin, learner, 10, 1), 2);
    assert.equal((await state(admin)).rows.find((row) => row.participant_id === learner).time_allowance.extra_minutes, 10);
    assert.equal((await state(teacher)).rows.find((row) => row.participant_id === learner).time_allowance, null);
    const learnerWindow = await state(learner);
    assert.deepEqual(learnerWindow.rows, []);
    assert.equal(Date.parse(learnerWindow.learner_ends_at) - Date.parse(learnerWindow.ends_at), 600000);
    const peerWindow = await state(peer);
    assert.equal(peerWindow.learner_ends_at, peerWindow.ends_at);

    assert.equal(await schedule(teacher, "-10 minutes", "-5 minutes", "30 minutes", 2), true);
    assert.equal((await state(learner)).can_submit, true);
    assert.ok(await paperAccess(learner));
    await assert.rejects(setTime(admin, learner, 20, 2), /PT409/);
    // The base window closes, while the paper, scanner and final submit must
    // still admit the extended learner and deny a participant without extra time.
    await sql(`update private.course_timed_exams set ends_at=clock_timestamp()-interval '1 second' where run_id=${q(run)}`);
    assert.equal((await state(teacher)).grading_open, false);
    assert.equal((await state(learner)).can_submit, true);
    assert.ok(await paperAccess(learner));
    assert.equal(await state(peer), null);
    await assert.rejects(examReserve(peer), denied);
    await assert.rejects(paperAccess(peer), denied);


    const timed = await examReserve(learner);
    await assert.rejects(submit(learner, timed), denied);
    const timedLease = await scan(timed, "begin", null, digest);
    assert.equal(await scan(timed, "clean", timedLease, digest, "ClamAV fixture"), timedLease);
    assert.equal(await scan(timed, "end", timedLease), timedLease);
    assert.equal((await state(learner)).draft.version_id, timed.version_id);
    assert.ok(!(await list(teacher)).entries.some((row) => row.version_id === timed.version_id));
    await assert.rejects(rpc(teacher, "course_submissions", run, timed.version_id), denied);
    await assert.rejects(submit(peer, timed), denied);
    await assert.rejects(access(teacher, timed.version_id), denied);
    await assert.rejects(schedule(teacher, "-10 minutes", "-5 minutes", "30 minutes", 3), /PT409/);
    await assert.rejects(grades(teacher, {[learner]: 82}, 3, false), denied);
    const submittedAt = await submit(learner, timed);
    assert.ok(submittedAt);
    assert.equal(await submit(learner, timed), submittedAt);
    assert.equal((await state(learner)).can_submit, false);
    await assert.rejects(examReserve(learner), denied);
    await assert.rejects(withdraw(learner, timed), denied);
    assert.ok(await access(teacher, timed.version_id));
    await assert.rejects(access(client, timed.version_id), denied);

    // Advance the deadline in this isolated fixture without waiting on wall time.
    await sql(`update private.course_timed_exams set visible_from=clock_timestamp()-interval '30 minutes', starts_at=clock_timestamp()-interval '25 minutes', ends_at=clock_timestamp()-interval '11 minutes' where run_id=${q(run)}`);
    assert.equal((await state(learner)).submitted_at, submittedAt);
    await assert.rejects(paperAccess(learner), denied);
    await assert.rejects(examReserve(peer), denied);
    await assert.rejects(grades(client, {[learner]: 82}, 3, false), denied);
    await assert.rejects(grades(teacher, {[learner]: 101}, 3, false), /22023/);
    await assert.rejects(grades(teacher, {}, 3, true), /22023/);
    assert.equal(await grades(teacher, {[learner]: 82}, 3, false), true);
    assert.deepEqual(await results(learner), {average: null, results: []});
    assert.deepEqual(await results(client, learner, company), {average: null, results: []});
    assert.equal(await grades(teacher, {}, 4, true), true);
    for (const result of [await results(learner), await results(teacher, learner), await results(client, learner, company)]) {
        assert.equal(result.average, 82);
        assert.equal(result.results[0]?.passed, true);
        assert.equal(result.results[0]?.score, 82);
    }
    for (const result of [await results(peer, learner), await results(unrelated, learner, company), await results(client, learner, otherCompany)]) {
        assert.deepEqual(result, {average: null, results: []});
    }
    const examRequiredVersion = Number(await sql(`select version from private.course_exam_settings where run_id=${q(run)}`));
    await rpc(teacher, "set_course_exam_required", run, false, examRequiredVersion);
    assert.equal((await state(teacher)).required, false);
    assert.deepEqual((await state(teacher)).rows, []);
    assert.deepEqual(await results(learner), {average: null, results: []});
    console.log("PASS timed exam announcement, paper window, scanned final submission, staged grades, publication and scoped averages");
});
