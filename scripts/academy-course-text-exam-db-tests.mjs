/** Verify current Academy exam access and the read-only licence grace boundary. */
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import {
  configureAcademyCourseAccess,
  prepareAcademyInstallation,
} from "./academy-installation.mjs";
import { signAcademyLicence } from "./academy-licence.mjs";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

for (const edition of ["customer-self-hosted", "customer-managed"]) {
  await withTestDatabase("academy_text_exam", async ({ sql, actor }) => {
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
    const read = async (who) =>
      JSON.parse(
        (
          await actor(
            who,
            gate("course_text_exam", "GET") +
              `select public.course_text_exam(${q(run)})`,
          )
        ).trim(),
      );
    const command = (name, revision, expected, payload) =>
      `select public.course_text_exam_action(${q(run)},${q(name)},${revision},${expected},${q(JSON.stringify(payload))})`;
    const action = (who, sql) =>
      actor(who, gate("course_text_exam_action", "POST") + sql);
    const paper = {
      title: "Fictional Academy exam",
      opens_at: new Date(now + 1_800_000).toISOString(),
      closes_at: new Date(now + 3_600_000).toISOString(),
      pass_percent: 70,
      questions: [{ prompt: "Explain a default route.", max_points: 10 }],
    };
    await action(admin, command("save_exam", "null", 0, paper));
    await action(admin, command("publish", "null", 1, {}));
    await assert.rejects(() => read(absentTeacher), /42501/);
    const extraTime = (expected, extra_minutes) =>
      command("set_extra_time", 1, expected, {
        learner_id: learner,
        extra_minutes,
      });
    assert.equal((await read(learner)).time_allowances, null);
    assert.equal((await read(admin)).time_allowances.rows[0].revision, 0);
    await assert.rejects(() => action(learner, extraTime(0, 30)), /42501/);
    await assert.rejects(
      () => action(absentTeacher, extraTime(0, 30)),
      /42501/,
    );
    assert.equal((await action(admin, extraTime(0, 30))).trim(), "1");
    assert.equal(
      Date.parse((await read(learner)).exam.deadline),
      Date.parse(paper.closes_at) + 30 * 60_000,
    );
    await sql(`update private.installation_verified_licence set expires_at=now()-interval '1 second'
      where installation_id=${q(installation)}`);
    assert.equal((await read(admin)).time_allowances, null);
    await assert.rejects(() => action(admin, extraTime(1, 40)), /42501/);
    await assert.rejects(() => actor(admin, extraTime(1, 40)), /42501/);
    await sql(`update private.installation_verified_licence set expires_at=${q(date(2))}
      where installation_id=${q(installation)};
      update private.course_text_exam_versions set opens_at=clock_timestamp()-interval '1 minute'
      where run_id=${q(run)} and revision=1`);
    await assert.rejects(() => action(admin, extraTime(1, 40)), /PT409/);
    assert.equal(
      (await read(learner)).exam.questions[0].prompt,
      paper.questions[0].prompt,
    );
    const save = command("save_answers", 1, 0, {
      answers: ["It forwards otherwise unmatched traffic."],
    });
    assert.equal((await action(learner, save)).trim(), "1");
    await action(
      learner,
      command("submit", 1, 1, {
        answers: ["It forwards otherwise unmatched traffic."],
      }),
    );
    await sql(`update private.course_text_exam_versions set opens_at=now()-interval '32 minutes', closes_at=now()-interval '31 minutes'
      where run_id=${q(run)} and revision=1`);
    const reviewed = (revision, points) =>
      command("import_reviews", 1, 0, {
        rows: [
          {
            learner_id: learner,
            expected_revision: revision,
            points: [points],
          },
        ],
      });
    assert.deepEqual((await read(admin)).submissions[0].import_draft, {
      revision: 0,
      points: null,
    });
    assert.equal((await action(admin, reviewed(0, 8))).trim(), "1");
    assert.equal((await read(learner)).review, null);
    assert.deepEqual((await read(admin)).submissions[0].import_draft, {
      revision: 1,
      points: [8],
    });

    const gradeExport = async (who, revision = 1) =>
      JSON.parse(
        await actor(
          who,
          gate("course_text_exam_grade_export", "GET") +
            `select public.course_text_exam_grade_export(${q(run)},${revision})`,
        ),
      );
    assert.deepEqual((await gradeExport(admin)).rows, []);
    await assert.rejects(gradeExport(learner), /42501/);
    await assert.rejects(gradeExport(absentTeacher), /42501/);
    await action(admin, command("release", 1, 1, { learner_id: learner }));
    const released = await gradeExport(admin);
    assert.equal(released.rows[0].score, 8);
    assert.equal(released.rows[0].learner_id, learner);
    assert.ok(!JSON.stringify(released).includes("unmatched traffic"));
    await assert.rejects(gradeExport(admin, 2), /42501/);
    await sql(`update private.installation_verified_licence set expires_at=now()-interval '1 second'
      where installation_id=${q(installation)}`);
    assert.equal((await read(learner)).can_write, false);
    assert.equal((await read(admin)).can_author, false);
    assert.equal((await read(learner)).attempt.revision, 2);
    assert.equal((await read(admin)).submissions[0].import_draft, null);
    assert.deepEqual((await gradeExport(admin)).rows, released.rows);
    await assert.rejects(() => action(admin, reviewed(1, 9)), /42501/);
    await assert.rejects(() => actor(admin, reviewed(1, 9)), /42501/);
    await assert.rejects(() => action(learner, save), /42501/);
    await assert.rejects(() => actor(learner, save), /42501/);
    await sql(`update private.installation_verified_licence set grace_until=now()-interval '1 second'
      where installation_id=${q(installation)}`);
    await assert.rejects(() => read(learner), /42501/);
    await assert.rejects(gradeExport(admin), /42501/);
    await assert.rejects(
      () => actor(learner, `select public.course_text_exam(${q(run)})`),
      /42501/,
    );
    console.log(
      `PASS ${edition} current text exam access, read-only grace and expired licence`,
    );
  });
}
