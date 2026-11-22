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
});
