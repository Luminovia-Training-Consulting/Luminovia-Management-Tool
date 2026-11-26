/** Check private peer participation through both dedicated Academy licence gates. */
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import {
  configureAcademyCourseAccess,
  prepareAcademyInstallation,
} from "./academy-installation.mjs";
import { signAcademyLicence } from "./academy-licence.mjs";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

for (const edition of ["customer-self-hosted", "customer-managed"]) {
  await withTestDatabase("academy_peer_feedback", async ({ sql, actor }) => {
    const [
      installation,
      admin,
      absentTeacher,
      learner,
      company,
      template,
      run,
      linkRequest,
    ] = Array.from({ length: 8 }, randomUUID);
    const now = Date.now();
    const date = (offset) => new Date(now + offset * 86_400_000).toISOString();
    const terms = {
      installation_id: installation,
      edition,
      release_commit: "bb".repeat(20),
      issued_at: date(-3),
      starts_at: date(-2),
      expires_at: date(2),
      grace_until: date(5),
      modules: ["lms"],
      limits: {
        seat_count: 10,
        storage_bytes: 10_000_000,
        api_requests_per_minute: 60,
      },
    };
    const key = generateKeyPairSync("ed25519");
    const licence = {
      envelope: signAcademyLicence(terms, key.privateKey),
      publicKey: key.publicKey,
      expected: terms,
      now,
    };
    await prepareAcademyInstallation(licence, sql);
    await configureAcademyCourseAccess({ ...licence, enabled: true }, sql);
    await sql(`
      insert into auth.users(id,email,email_confirmed_at) values
        (${q(admin)},'manager@example.invalid',now()), (${q(absentTeacher)},'lecturer@example.invalid',now()),
        (${q(learner)},'participant@example.invalid',now());
      insert into public.user_roles(user_id,role) values
        (${q(admin)},'admin'), (${q(absentTeacher)},'lecturer'), (${q(learner)},'participant');
      insert into public.organisations(id,name) values (${q(company)},'Fictional Academy');
      insert into public.course_templates(id,title) values (${q(template)},'Fictional Academy course');
      insert into public.course_runs(id,template_id,organisation_id,published)
        values (${q(run)},${q(template)},${q(company)},true);
      insert into public.course_sessions(course_run_id,starts_at,ends_at)
        values (${q(run)},now()-interval '2 hours',now()-interval '1 hour');
      insert into private.company_participant_link_requests
        (id,organisation_id,requested_by,request_id,luminovia_user_id,target_user_id,status,expires_at)
        select ${q(linkRequest)},${q(company)},${q(admin)},${q(randomUUID())},luminovia_user_id,id,'accepted',now()+interval '1 day'
        from public.profiles where id=${q(learner)};
      insert into private.company_participant_memberships(organisation_id,user_id,status,link_request_id,invited_by,joined_at)
        values (${q(company)},${q(learner)},'active',${q(linkRequest)},${q(admin)},now());
      insert into public.course_enrolments(course_run_id,user_id,status,enrolled_by)
        values (${q(run)},${q(learner)},'enrolled',${q(admin)});
    `);
    const gate = (path, method) =>
      `set local request.path=${q("/rpc/" + path)};
       set local request.method=${q(method)};
       set local request.headers='{"accept-profile":"public","content-profile":"public"}';
       select public.require_portal_access();`;
    const read = async (who, withGate = true) =>
      JSON.parse(
        (
          await actor(
            who,
            (withGate ? gate("course_peer_feedback", "GET") : "") +
              `select public.course_peer_feedback(${q(run)})`,
          )
        ).trim(),
      );
    const write = (who, action, payload, withGate = true) =>
      actor(
        who,
        (withGate ? gate("course_peer_feedback_action", "POST") : "") +
          `select public.course_peer_feedback_action(${q(run)},${q(action)},${q(JSON.stringify(payload))})`,
      );
    await assert.rejects(read(absentTeacher), /42501/);
    assert.equal(
      (
        await write(admin, "open", {
          body: "Write an anonymised problem report.",
        })
      ).trim(),
      "t",
    );
    assert.equal(
      (
        await write(learner, "entry", {
          revision: 0,
          body: "My fictional report",
        })
      ).trim(),
      "t",
    );
    const learnerEntry = (await read(learner)).own_entry;
    assert.equal(learnerEntry.body, "My fictional report");
    assert.equal((await read(admin)).entries.length, 1);
    assert.deepEqual((await read(learner)).entries, []);
    const sha = "a".repeat(64);
    const scormRead = (who) =>
      actor(
        who,
        gate("course_scorm_packages", "GET") +
          `select public.course_scorm_packages(${q(run)})`,
      ).then(JSON.parse);
    const reserve = () =>
      actor(
        admin,
        gate("reserve_course_scorm_package", "POST") +
          `select public.reserve_course_scorm_package(${q(run)},'example.zip',120,${q(randomUUID())},${q(sha)})`,
      ).then(JSON.parse);
    const reservation = await reserve();
    const scormWrite = (who, action, payload) =>
      actor(
        who,
        gate("course_scorm_action", "POST") +
          `select public.course_scorm_action(${q(run)},${q(reservation.version_id)},${q(action)},${q(JSON.stringify(payload))})`,
      );
    const scormDownload = (who) =>
      actor(
        who,
        gate("course_scorm_download", "POST") +
          `select public.course_scorm_download(${q(run)},${q(reservation.version_id)})`,
      ).then(JSON.parse);
    const publish = {
      title: "A fictional package",
      sha256: sha,
      lessons: [{ id: "first", title: "First lesson" }],
    };
    assert.equal((await scormRead(learner)).packages.length, 0);
    await assert.rejects(scormWrite(admin, "publish", publish), /42501/);
    // Seed the already-scanned fixture state here. Native Chromium exercises the scanner.
    await sql(`
      update public.document_versions set status='clean', sha256=${q(sha)}, scanner_version='ClamAV fixture'
        where id=${q(reservation.version_id)};
      update public.documents set status='clean', current_version_id=${q(reservation.version_id)}
        where id=(select document_id from public.document_versions where id=${q(reservation.version_id)});
    `);
    assert.equal((await scormWrite(admin, "publish", publish)).trim(), "t");
    await assert.rejects(scormRead(absentTeacher), /42501/);
    assert.equal(
      (await scormDownload(learner)).version_id,
      reservation.version_id,
    );
    await assert.rejects(
      scormWrite(learner, "complete", { item_id: "unknown" }),
      /22023/,
    );
    assert.equal(
      (await scormWrite(learner, "complete", { item_id: "first" })).trim(),
      "t",
    );
    assert.deepEqual((await scormRead(learner)).packages[0].completed, [
      "first",
    ]);
    assert.deepEqual((await scormRead(admin)).packages[0].completed, []);
    await sql(`update private.installation_verified_licence set expires_at=now()-interval '1 second'
      where installation_id=${q(installation)}`);
    assert.equal((await read(admin)).can_moderate, false);
    assert.equal((await scormRead(admin)).can_publish, false);
    assert.deepEqual((await scormRead(learner)).packages[0].completed, [
      "first",
    ]);
    await assert.rejects(scormWrite(admin, "withdraw", {}), /42501/);
    assert.deepEqual((await read(learner)).own_entry, learnerEntry);
    await assert.rejects(write(learner, "withdraw", { revision: 1 }), /42501/);
    await assert.rejects(
      write(learner, "withdraw", { revision: 1 }, false),
      /42501/,
    );
    await sql(`update private.installation_verified_licence set grace_until=now()-interval '1 second'
      where installation_id=${q(installation)}`);
    await assert.rejects(read(admin), /42501/);
    await assert.rejects(scormRead(learner), /42501/);
    await assert.rejects(read(learner, false), /42501/);
    console.log(
      `PASS ${edition} peer moderation and own entry in active, grace and expired licence`,
    );
  });
}
