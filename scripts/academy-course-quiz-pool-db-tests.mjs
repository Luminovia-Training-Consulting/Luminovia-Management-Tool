/** Verify that Academy pool starts require an active licence and private scopes. */
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import {
  configureAcademyCourseAccess,
  prepareAcademyInstallation,
} from "./academy-installation.mjs";
import { signAcademyLicence } from "./academy-licence.mjs";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

for (const edition of ["customer-self-hosted", "customer-managed"]) {
  await withTestDatabase("academy_quiz_pool", async ({ sql, actor }) => {
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
    const bank = async (action, payload) =>
      JSON.parse(
        (
          await actor(
            admin,
            gate("course_question_bank_action", "POST") +
              `select public.course_question_bank_action(${q(run)},${q(action)},${q(JSON.stringify(payload))},0)`,
          )
        ).trim(),
      );
    const ids = [randomUUID(), randomUUID()];
    for (const [index, id] of ids.entries()) {
      await bank("save", {
        id,
        topic: "Fictional Quiz Pool",
        difficulty: "introductory",
        content: {
          prompt: `Fictional question ${index + 1}`,
          options: ["A", "B"],
          correct: index,
        },
      });
    }
    await bank("configure", {
      entries: ids.map((question_id) => ({ question_id, revision: 1 })),
      draw_count: 1,
      pass_percent: 80,
      max_attempts: 2,
      published: true,
      shuffle: false,
    });
    const read = async (who) =>
      JSON.parse(
        (
          await actor(
            who,
            gate("course_workspace", "GET") +
              `select public.course_workspace(${q(run)})`,
          )
        ).trim(),
      ).quiz;
    const start = `select public.start_course_quiz_pool(${q(run)},1)`;
    const startThroughGate = (who) =>
      actor(who, gate("start_course_quiz_pool", "POST") + start);
    await assert.rejects(startThroughGate(admin), /42501/);
    await assert.rejects(startThroughGate(absentTeacher), /42501/);
    assert.deepEqual((await read(learner)).questions, []);
    const opened = JSON.parse((await startThroughGate(learner)).trim());
    assert.equal(opened.attempt_number, 1);
    const drawn = await read(learner);
    assert.equal(drawn.questions.length, 1);
    assert.equal(drawn.pool.request_id, opened.request_id);
    assert.equal((await read(admin)).pool.request_id, null);

    await sql(`update private.installation_verified_licence set expires_at=now()-interval '1 second'
      where installation_id=${q(installation)}`);
    assert.deepEqual((await read(learner)).questions, drawn.questions);
    await assert.rejects(startThroughGate(learner), /42501/);
    await assert.rejects(actor(learner, start), /42501/);
    await sql(`update private.installation_verified_licence set grace_until=now()-interval '1 second'
      where installation_id=${q(installation)}`);
    await assert.rejects(read(learner), /42501/);
    console.log(
      `PASS ${edition} current pool draw access, read-only grace and expired licence`,
    );
  });
}
