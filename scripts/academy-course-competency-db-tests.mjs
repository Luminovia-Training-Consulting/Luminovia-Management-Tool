/** Check competency decisions through the dedicated Academy role and licence gates. */
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import {
  configureAcademyCourseAccess,
  prepareAcademyInstallation,
} from "./academy-installation.mjs";
import { signAcademyLicence } from "./academy-licence.mjs";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

for (const edition of ["customer-self-hosted", "customer-managed"]) {
  await withTestDatabase("academy_competencies", async ({ sql, actor }) => {
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
    const read = async (who, withGate = true) =>
      JSON.parse(
        (
          await actor(
            who,
            (withGate ? gate("course_competencies", "GET") : "") +
              `select public.course_competencies(${q(run)})`,
          )
        ).trim(),
      );
    const command = (action, payload, revision) =>
      `select public.course_competency_action(${q(run)},${q(action)},${q(JSON.stringify(payload))},${revision})`;
    const write = async (action, payload, revision) =>
      JSON.parse(
        (
          await actor(
            admin,
            gate("course_competency_action", "POST") +
              command(action, payload, revision),
          )
        ).trim(),
      );
    const readCompletionPolicy = (who, withGate = true) =>
      actor(
        who,
        (withGate ? gate("course_completion_policy", "GET") : "") +
          `select public.course_completion_policy(${q(run)})`,
      ).then(JSON.parse);
    const policyPayload = {
      attendance_percent: 65,
      assignment_id: null,
      competency_pin: null,
      competency_id: null,
      minimum_level_id: null,
      lecturer_verification: true,
      target_at: null,
    };
    const publishCompletionPolicy = (revision, withGate = true) =>
      actor(
        admin,
        (withGate ? gate("course_completion_policy_action", "POST") : "") +
          `select public.course_completion_policy_action(${q(run)},'publish',${q(JSON.stringify(policyPayload))},${revision})`,
      );
    const [training, independent, item] = Array.from({ length: 3 }, randomUUID);
    const frame = {
      id,
      content: {
        title: "Fictional framework",
        levels: [
          { id: training, title: "Training" },
          { id: independent, title: "Independent" },
        ],
        competencies: [{ id: item, code: "NET", title: "Read a subnet chart" }],
      },
    };
    const decision = {
      pin_revision: 1,
      user_id: learner,
      competency_id: item,
      level_id: training,
      evidence_note: "Reviewed the network chart with guidance",
      include_quiz: false,
    };

    assert.equal((await read(admin)).can_manage, true);
    await assert.rejects(read(absentTeacher), /42501/);
    assert.equal((await readCompletionPolicy(admin)).can_manage, true);
    await assert.rejects(readCompletionPolicy(absentTeacher), /42501/);
    await assert.rejects(readCompletionPolicy(learner), /42501/);
    assert.equal(await publishCompletionPolicy(0), "1");
    assert.equal((await write("save_framework", frame, 0)).revision, 1);
    assert.equal(
      (await write("pin", { framework_id: id, framework_revision: 1 }, 0))
        .revision,
      1,
    );
    assert.equal((await write("assess", decision, 0)).revision, 1);
    const own = await read(learner);
    assert.equal(own.decisions[0].evidence_note, decision.evidence_note);
    assert.deepEqual(own.frameworks, []);
    assert.equal(own.can_assess, false);

    await sql(`update private.installation_verified_licence set expires_at=now()-interval '1 second'
      where installation_id=${q(installation)}`);
    assert.equal((await read(admin)).can_manage, false);
    assert.equal((await readCompletionPolicy(admin)).can_manage, false);
    assert.equal(
      (await readCompletionPolicy(admin)).head.attendance_percent,
      65,
    );
    await assert.rejects(publishCompletionPolicy(1), /42501/);
    await assert.rejects(publishCompletionPolicy(1, false), /42501/);
    assert.deepEqual((await read(learner)).decisions, own.decisions);
    await assert.rejects(
      write("assess", { ...decision, level_id: independent }, 1),
      /42501/,
    );
    await assert.rejects(
      actor(admin, command("save_framework", frame, 1)),
      /42501/,
    );
    await sql(`update private.installation_verified_licence set grace_until=now()-interval '1 second'
      where installation_id=${q(installation)}`);
    await assert.rejects(read(admin), /42501/);
    await assert.rejects(read(learner, false), /42501/);
    await assert.rejects(readCompletionPolicy(admin), /42501/);
    await assert.rejects(readCompletionPolicy(admin, false), /42501/);
    console.log(
      `PASS ${edition} competency mapping and own decisions across active, grace and expired licence`,
    );
  });
}
