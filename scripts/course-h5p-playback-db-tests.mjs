/** Exercise scan-bound H5P publication, progress and scope in all installation editions. */
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import {
  configureAcademyCourseAccess,
  prepareAcademyInstallation,
} from "./academy-installation.mjs";
import { signAcademyLicence } from "./academy-licence.mjs";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

for (const edition of [
  "internal",
  "customer-self-hosted",
  "customer-managed",
]) {
  await withTestDatabase("course_hfivep_runtime", async ({ sql, actor }) => {
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
    if (edition !== "internal") {
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
    }
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
    if (edition === "internal")
      await actor(
        admin,
        `select public.set_company_premium(${q(company)},true,0,${q(randomUUID())})`,
      );
    const digest = "ab".repeat(32);
    const clientId = randomUUID();
    const reserve = (who, hash = digest) =>
      actor(
        who,
        gate("reserve_course_h5p_package", "POST") +
          `select public.reserve_course_h5p_package(${q(run)},'fictional-activity.h5p',420,${q(clientId)},${q(hash)})`,
      ).then(JSON.parse);
    const read = (who) =>
      actor(
        who,
        gate("course_h5p_packages", "GET") +
          `select public.course_h5p_packages(${q(run)})`,
      ).then(JSON.parse);
    await assert.rejects(reserve(learner), /42501/);
    await assert.rejects(reserve(absentTeacher), /42501/);
    const reservation = await reserve(admin);
    assert.deepEqual(await reserve(admin), reservation);
    await assert.rejects(reserve(admin, "cd".repeat(32)), /PT409/);
    const { document_id: document, version_id: version } = reservation;
    const status = (who) =>
      actor(
        who,
        gate("course_h5p_upload_status", "POST") +
          `select public.course_h5p_upload_status(${q(run)},${q(document)},${q(version)})`,
      ).then(JSON.parse);
    const download = (who) =>
      actor(
        who,
        gate("course_h5p_download", "POST") +
          `select public.course_h5p_download(${q(run)},${q(version)})`,
      ).then(JSON.parse);
    const command = (who, action, payload) =>
      actor(
        who,
        gate("course_h5p_action", "POST") +
          `select public.course_h5p_action(${q(run)},${q(version)},${q(action)},${q(JSON.stringify(payload))})`,
      );
    const publication = { title: "Fictional activity", sha256: digest };
    assert.equal((await status(admin)).sha256, digest);
    await assert.rejects(status(learner), /42501/);
    assert.deepEqual((await read(learner)).packages, []);
    await assert.rejects(download(admin), /42501/);
    await assert.rejects(command(admin, "publish", publication), /42501/);
    await sql(`
      update public.document_versions set status='clean', sha256=${q(digest)}, scanner_version=${q(edition === "internal"
        ? "ClamAV fixture"
        : "Academy file validation v1 (no malware scan)")}
        where id=${q(version)};
      update public.documents set status='clean', current_version_id=${q(version)}
        where id=${q(document)};
    `);
    await assert.rejects(command(learner, "publish", publication), /42501/);
    await assert.rejects(
      command(admin, "publish", { ...publication, sha256: "cd".repeat(32) }),
      /22023/,
    );
    assert.equal(await command(admin, "publish", publication), "t");
    assert.equal(await command(admin, "publish", publication), "t");
    await assert.rejects(
      command(admin, "publish", { ...publication, title: "Changed title" }),
      /PT409/,
    );
    assert.equal((await download(learner)).version_id, version);
    await assert.rejects(download(absentTeacher), /42501/);
    await assert.rejects(
      command(admin, "progress", { completed: true, score: 1 }),
      /42501/,
    );
    await assert.rejects(
      command(learner, "progress", { completed: true, score: 1.1 }),
      /22023/,
    );
    assert.equal(
      await command(learner, "progress", { completed: true, score: 0.8 }),
      "t",
    );
    assert.equal(
      await command(learner, "progress", { completed: false, score: 0.2 }),
      "t",
    );
    assert.deepEqual((await read(learner)).packages[0].progress, {
      completed: true,
      score: 0.8,
    });
    assert.equal((await read(admin)).packages[0].progress, null);
    const exportCompletion = async (who) =>
      JSON.parse(
        await actor(
          who,
          gate("course_xapi_statements", "GET") +
            `select public.course_xapi_statements(${q(run)}, now()-interval '1 hour', now()+interval '1 hour')`,
        ),
      );
    await assert.rejects(exportCompletion(learner), /42501/);
    const completion = (await exportCompletion(admin)).statements.filter(
      (entry) => entry.object.id.includes("/h5p/"),
    );
    assert.equal(completion.length, 1);
    assert.equal(
      completion[0].verb.id,
      "http://adlnet.gov/expapi/verbs/completed",
    );
    assert.deepEqual(completion[0].result, { completion: true });
    assert.equal(JSON.stringify(completion).includes(learner), false);
    assert.equal(JSON.stringify(completion).includes(version), false);
    assert.deepEqual(
      (await exportCompletion(admin)).statements.find(
        (entry) => entry.id === completion[0].id,
      ),
      completion[0],
    );

    if (edition !== "internal") {
      await sql(
        `update private.installation_verified_licence set expires_at=now()-interval '1 second' where installation_id=${q(installation)}`,
      );
      assert.equal((await read(admin)).can_publish, false);
      assert.equal((await read(learner)).can_complete, false);
      assert.equal((await download(learner)).version_id, version);
      await assert.rejects(
        command(learner, "progress", { completed: true, score: 1 }),
        /42501/,
      );
      await assert.rejects(command(admin, "withdraw", {}), /42501/);
      await sql(
        `update private.installation_verified_licence set grace_until=now()-interval '1 second' where installation_id=${q(installation)}`,
      );
      await assert.rejects(read(learner), /42501/);
      await assert.rejects(download(learner), /42501/);
      await sql(
        `update private.installation_verified_licence set expires_at=now()+interval '1 day',grace_until=now()+interval '2 days' where installation_id=${q(installation)}`,
      );
    }
    assert.equal(await command(admin, "withdraw", {}), "t");
    assert.equal(await command(admin, "withdraw", {}), "t");
    assert.deepEqual((await read(learner)).packages, []);
    await assert.rejects(download(learner), /42501/);
    await assert.rejects(
      command(learner, "progress", { completed: true, score: 1 }),
      /42501/,
    );
    console.log(
      `PASS ${edition} H5P scan-bound publication, exact downloads, private progress, licence and withdrawal`,
    );
  });
}
