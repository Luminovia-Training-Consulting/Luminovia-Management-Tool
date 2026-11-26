/** Verify the exact active SCORM lesson scope and state writes in Internal and both Academy editions. */
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
  await withTestDatabase("course_scorm_runtime", async ({ sql, actor }) => {
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
    const { version_id: version } = JSON.parse(
      await actor(
        admin,
        gate("reserve_course_scorm_package", "POST") +
          `select public.reserve_course_scorm_package(${q(run)},'fixture-active.zip',420,${q(randomUUID())},${q(digest)})`,
      ),
    );
    await sql(`
      update public.document_versions set status='clean', sha256=${q(digest)}, scanner_version='ClamAV fixture'
        where id=${q(version)};
      update public.documents set status='clean', current_version_id=${q(version)}
        where id=(select document_id from public.document_versions where id=${q(version)});
    `);
    const command = (who, action, payload) =>
      actor(
        who,
        gate("course_scorm_action", "POST") +
          `select public.course_scorm_action(${q(run)},${q(version)},${q(action)},${q(JSON.stringify(payload))})`,
      );
    const read = (who, item = "first", selectedRun = run) =>
      actor(
        who,
        gate("read_course_scorm_runtime", "GET") +
          `select public.read_course_scorm_runtime(${q(selectedRun)},${q(version)},${q(item)})`,
      ).then(JSON.parse);
    const save = (who, session, revision, values) =>
      actor(
        who,
        gate("save_course_scorm_runtime", "POST") +
          `select public.save_course_scorm_runtime(${q(run)},${q(version)},'first',${q(session)},${revision},${q(JSON.stringify(values))})`,
      ).then(Number);
    await assert.rejects(read(learner), /42501/);
    await command(admin, "publish", {
      playback: "runtime",
      sha256: digest,
      title: "Fixture active",
      lessons: [
        { id: "first", title: "First lesson" },
        { id: "second", title: "Second lesson" },
      ],
    });
    const cmi = {
      "cmi.core.lesson_location": "Page 2",
      "cmi.core.lesson_status": "incomplete",
      "cmi.suspend_data": "fictional resumable answers",
      "cmi.core.exit": "suspend",
      "cmi.core.score.raw": "",
      "cmi.core.score.min": "0",
      "cmi.core.score.max": "100",
      "cmi.core.session_time": "0000:08:05.30",
    };
    const session = randomUUID();
    const baseline = await read(learner);
    assert.equal(baseline.revision, 0);
    assert.match(baseline.student_id, /^[a-f0-9]{64}$/);
    assert.equal(baseline.can_write, true);
    assert.deepEqual(await read(admin), {
      cmi: {},
      can_write: false,
      revision: 0,
      student_id: "preview",
      total_elapsed_cs: 0,
    });
    await assert.rejects(read(absentTeacher), /42501/);
    await assert.rejects(read(learner, "foreign"), /42501/);
    await assert.rejects(read(learner, "first", randomUUID()), /42501/);
    await assert.rejects(save(admin, session, 0, cmi), /42501/);
    await assert.rejects(
      command(learner, "complete", { item_id: "first" }),
      /22023/,
    );
    await assert.rejects(
      save(learner, session, 0, { ...cmi, extraneous: "unsupported" }),
      /22023/,
    );
    assert.equal(await save(learner, session, 0, cmi), 1);
    const stored = await read(learner);
    assert.equal(stored.cmi["cmi.core.lesson_location"], "Page 2");
    assert.equal(stored.total_elapsed_cs, 48530);
    assert.equal(stored.student_id, baseline.student_id);
    assert.equal((await read(learner, "second")).revision, 0);
    await assert.rejects(save(learner, session, 0, cmi), /PT409/);
    assert.equal(
      await save(learner, session, 1, {
        ...cmi,
        "cmi.core.lesson_status": "completed",
      }),
      2,
    );
    assert.equal((await read(learner)).total_elapsed_cs, 48530);
    const projection = JSON.parse(
      await actor(
        learner,
        gate("course_scorm_packages", "GET") +
          `select public.course_scorm_packages(${q(run)})`,
      ),
    );
    assert.deepEqual(projection.packages[0].completed, ["first"]);
    assert.equal(projection.packages[0].playback, "runtime");
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
      (entry) => entry.object.id.includes("/scorm/"),
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
      await sql(`update private.installation_verified_licence set expires_at=now()-interval '1 second'
        where installation_id=${q(installation)}`);
      assert.equal((await read(learner)).can_write, false);
      await assert.rejects(save(learner, session, 2, cmi), /42501/);
      await sql(`update private.installation_verified_licence set grace_until=now()-interval '1 second'
        where installation_id=${q(installation)}`);
    } else {
      await command(admin, "withdraw", {});
    }
    await assert.rejects(read(learner), /42501/);
    console.log(
      `PASS ${edition} SCORM active state, revision, scope and progress.`,
    );
  });
}
