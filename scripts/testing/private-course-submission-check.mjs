/** Real Auth/REST/Edge/ClamAV/Storage witness for the private submission flow. */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {portalJsonResponse} from "./openapi-contract.mjs";

/** Use the canonical workspace fixture and restore the learner's original completed state. */
export async function checkPrivateCourseSubmissions({
    admin, teacher, learner, client, peer, run, otherRun, checked, url, headers, download, bytes,
}) {
    const submissionList = (who) => checked(who.client.rpc("course_submissions", {p_run_id: run}));
    const uploadSubmission = async (clientId) => {
        const form = new FormData();
        form.set("course_run_id", run);
        form.set("client_id", clientId);
        form.set("file", new File([bytes], "Fictional-lab-submission.txt", {type: "text/plain"}));
        return await fetch(`${url}/functions/v1/files?mode=course-submission`, {
            method: "POST",
            headers: await headers(learner),
            body: form,
            signal: AbortSignal.timeout(90000),
        });
    };
    const learnerStatus = (p_status) => checked(admin.client.rpc("manage_course_enrolment", {
        p_course_run_id: run, p_user_id: learner.id, p_status,
    }));
    const submissionKey = randomUUID();
    assert.equal((await submissionList(learner)).enabled, false);
    assert.equal((await uploadSubmission(submissionKey)).status, 403);
    await checked(client.client.rpc("set_course_submissions", {p_run_id: run, p_enabled: true}));
    assert.equal((await uploadSubmission(submissionKey)).status, 403, "Completed learners cannot submit new files");
    await learnerStatus("enrolled");
    const submitted = await uploadSubmission(submissionKey);
    const receipt = await submitted.json();
    assert.equal(submitted.status, 200, JSON.stringify(receipt));
    const submittedDocument = portalJsonResponse("/functions/v1/files", submitted.status, receipt).document;
    assert.equal(submittedDocument.kind, "participant_submission");
    assert.equal(submittedDocument.status, "clean");
    const submittedVersion = submittedDocument.current_version_id;
    const repeated = await uploadSubmission(submissionKey);
    assert.equal(repeated.status, 200);
    assert.equal((await repeated.json()).document.current_version_id, submittedVersion);
    for (const reader of [learner, teacher, client, admin]) {
        const entries = (await submissionList(reader)).entries;
        assert.deepEqual(entries.map((entry) => entry.version_id), [submittedVersion]);
        const file = await download(reader, "participant_submission", run, {version_id: submittedVersion});
        assert.equal(file.status, 200);
        assert.deepEqual(new Uint8Array(await file.arrayBuffer()), bytes);
    }
    assert.equal((await download(peer, "participant_submission", run, {version_id: submittedVersion})).status, 403);
    assert.equal((await download(teacher, "participant_submission", otherRun, {version_id: submittedVersion})).status, 403);
    const ordinaryFile = await fetch(`${url}/functions/v1/files`, {
        method: "POST",
        headers: {...await headers(admin), "Content-Type": "application/json"},
        body: JSON.stringify({action: "download", id: submittedDocument.id, version_id: submittedVersion}),
        signal: AbortSignal.timeout(30000),
    });
    assert.equal(ordinaryFile.status, 403);
    await checked(learner.client.rpc("withdraw_course_submission", {p_run_id: run, p_version_id: submittedVersion}));
    assert.deepEqual((await submissionList(teacher)).entries, []);
    assert.equal((await download(teacher, "participant_submission", run, {version_id: submittedVersion})).status, 403);
    await checked(client.client.rpc("set_course_submissions", {p_run_id: run, p_enabled: false}));
    await learnerStatus("completed");
}
