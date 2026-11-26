/** Check both dedicated editions through the real request gate and the direct RPC. */
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import {
  configureAcademyCourseAccess,
  prepareAcademyInstallation,
} from "./academy-installation.mjs";
import { signAcademyLicence } from "./academy-licence.mjs";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

for (const edition of ["customer-self-hosted", "customer-managed"]) {
  await withTestDatabase("academy_question_bank", async ({ sql, actor }) => {
    const [
      installation,
      admin,
      absentTeacher,
      learner,
      company,
      template,
      run,
      id,
      linkRequest,
    ] = Array.from({ length: 9 }, randomUUID);
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
    const read = async (who, method = "POST") => {
      const result = await actor(
        who,
        gate("course_question_bank", method) +
          `select public.course_question_bank(${q(run)})`,
      );
      return JSON.parse(result.trim());
    };
    const command = (action, payload, version) =>
      `select public.course_question_bank_action(${q(run)},${q(action)},${q(JSON.stringify(payload))},${version})`;
    const write = async (action, payload, version) => {
      const result = await actor(
        admin,
        gate("course_question_bank_action", "POST") +
          command(action, payload, version),
      );
      return JSON.parse(result.trim());
    };
    const question = {
      id,
      topic: "Fictional topic",
      difficulty: "intermediate",
      content: { prompt: "Select option B", options: ["A", "B"], correct: 1 },
    };

    await assert.rejects(read(absentTeacher), /42501/);
    assert.deepEqual((await read(admin, "GET")).items, []);
    assert.equal((await write("save", question, 0)).version, 1);
    assert.equal((await read(admin)).items[0].can_edit, true);
    const policy = {
      entries: [{ question_id: id, revision: 1 }],
      pass_percent: 80,
      max_attempts: 3,
      published: true,
      shuffle: false,
    };
    assert.equal((await write("configure", policy, 0)).version, 1);
    assert.equal(
      await sql(
        `select questions->0->>'prompt' from private.course_quiz_versions where run_id=${q(run)}`,
      ),
      question.content.prompt,
    );

    const attemptId = randomUUID();
    const draft = (version, answers) =>
      `select public.save_course_quiz_draft(${q(run)},1,1,${q(attemptId)},${version},${q(JSON.stringify(answers))})`;
    const readDraft = async () => {
      const result = await actor(
        learner,
        gate("course_workspace", "GET") +
          `select public.course_workspace(${q(run)})`,
      );
      return JSON.parse(result.trim()).quiz.draft;
    };
    assert.equal(
      (
        await actor(
          learner,
          gate("save_course_quiz_draft", "POST") + draft(0, [1]),
        )
      ).trim(),
      "1",
    );
    assert.deepEqual(await readDraft(), {
      request_id: attemptId,
      revision: 1,
      answers: [1],
    });

    await sql(`update private.installation_verified_licence set expires_at=now()-interval '1 second'
      where installation_id=${q(installation)}`);
    assert.equal((await read(admin)).items[0].can_edit, false);
    await assert.rejects(write("save", question, 1), /42501/);
    await assert.rejects(
      actor(admin, command("configure", policy, 1)),
      /42501/,
    );
    assert.equal((await readDraft()).revision, 1);
    await assert.rejects(
      actor(learner, gate("save_course_quiz_draft", "POST") + draft(1, [0])),
      /42501/,
    );
    await assert.rejects(actor(learner, draft(1, [0])), /42501/);
    await sql(`update private.installation_verified_licence set grace_until=now()-interval '1 second'
      where installation_id=${q(installation)}`);
    await assert.rejects(read(admin), /42501/);
    await assert.rejects(
      actor(admin, `select public.course_question_bank(${q(run)})`),
      /42501/,
    );
    console.log(
      `PASS ${edition} question-bank and answer draft active, grace and expired rights`,
    );
  });
}
