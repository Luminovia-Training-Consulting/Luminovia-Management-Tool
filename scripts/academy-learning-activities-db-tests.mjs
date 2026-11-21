/** Exercise quiz privacy, graded retries and completion facts in both dedicated editions. */
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { z } from "zod";
import { academyOpenApi } from "../src/features/developer-api/academy-contract.ts";
import { prepareAcademyInstallation } from "./academy-installation.mjs";
import { signAcademyLicence } from "./academy-licence.mjs";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

for (const edition of ["customer-managed", "customer-self-hosted"]) {
  await withTestDatabase("academy_activities", async ({ sql, actor }) => {
    const [
      installation,
      org,
      template,
      course,
      session,
      manager,
      teacher,
      learner,
      peer,
    ] = Array.from({ length: 9 }, randomUUID);
    const keys = generateKeyPairSync("ed25519");
    const date = (days) =>
      new Date(Date.now() + days * 86_400_000).toISOString();
    const terms = {
      installation_id: installation,
      edition,
      release_commit: "ab".repeat(20),
      issued_at: date(-7),
      starts_at: date(-6),
      expires_at: date(3),
      grace_until: date(4),
      modules: ["lms"],
      limits: {
        seat_count: 20,
        storage_bytes: 2_000_000,
        api_requests_per_minute: 60,
      },
    };
    await prepareAcademyInstallation(
      {
        envelope: signAcademyLicence(terms, keys.privateKey),
        publicKey: keys.publicKey,
        expected: terms,
      },
      sql,
    );
    const configure = (active) =>
      sql(
        `select private.configure_academy_course_access(${q(installation)},${q(terms.release_commit)},${active})`,
      );
    await configure(true);
    const accounts = [
      [manager, "admin"],
      [teacher, "lecturer"],
      [learner, "participant"],
      [peer, "participant"],
    ];
    await sql(`insert into auth.users(id,email,email_confirmed_at) values ${accounts.map(([id]) => `(${q(id)},${q(id + "@example.invalid")},now())`).join(",")};
      insert into public.user_roles(user_id,role) values ${accounts.map(([id, role]) => `(${q(id)},${q(role)})`).join(",")};
      insert into public.organisations(id,name) values(${q(org)},'Fictional Academy');
      insert into public.course_templates(id,title) values(${q(template)},'Fictional assessed workshop');
      insert into public.course_runs(id,template_id,organisation_id) values(${q(course)},${q(template)},${q(org)});
      insert into public.course_sessions(id,course_run_id,starts_at,ends_at) values(${q(session)},${q(course)},now()+interval '1 day',now()+interval '25 hours');`);
    for (const candidate of [learner, peer]) {
      const link = randomUUID();
      await sql(`insert into private.company_participant_link_requests(id,organisation_id,requested_by,request_id,luminovia_user_id,target_user_id,status,expires_at)
        select ${q(link)},${q(org)},${q(manager)},${q(randomUUID())},luminovia_user_id,id,'accepted',now()+interval '1 day' from public.profiles where id=${q(candidate)};
        insert into private.company_participant_memberships(organisation_id,user_id,status,link_request_id,invited_by,joined_at)
        values(${q(org)},${q(candidate)},'active',${q(link)},${q(manager)},now());`);
    }
    const rpc = (who, endpoint, args = "") =>
      actor(
        who,
        `set local request.path=${q("/rpc/" + endpoint)}; set local request.method='POST';
       select public.require_portal_access(); select public.${endpoint}(${args});`,
      );
    const contract = academyOpenApi("https://academy.example.invalid/backend", {
      installationId: installation,
      name: "Fictional Academy",
      edition,
    }).paths["/rest/v1/rpc/academy_learning_action"].post;
    const response = z.fromJSONSchema(
      contract.responses["200"].content["application/json"].schema,
    );
    const payload = (who, action, input = {}, version = 0) =>
      rpc(
        who,
        "academy_learning_action",
        `${q(course)},${q(action)},${q(JSON.stringify(input))},${version}`,
      ).then((value) => response.parse(JSON.parse(value)));
    const workspace = (who) =>
      rpc(who, "course_workspace", q(course)).then(JSON.parse);
    const download = (who, id) =>
      rpc(who, "course_document_access", `'completion',${q(id)}`).then(
        JSON.parse,
      );
    await rpc(
      manager,
      "academy_assign_course_instructor",
      `${q(course)},${q(teacher)},${q(randomUUID())}`,
    );
    for (const candidate of [learner, peer])
      await rpc(
        manager,
        "manage_course_enrolment",
        `${q(course)},${q(candidate)},'enrolled'`,
      );
    const settings = {
      questions: [
        {
          prompt: "Which choice matches the fictional lesson?",
          options: ["Choice A", "Choice B"],
          correct: 1,
        },
      ],
      published: true,
      pass_percent: 80,
      max_attempts: 2,
    };
    await assert.rejects(payload(learner, "quiz_config", settings), /42501/);
    await assert.rejects(
      payload(teacher, "quiz_config", {
        ...settings,
        installation_role: "admin",
      }),
      /22023/,
    );
    await assert.rejects(
      payload(manager, "contact_select", { contact_id: null }),
      /22023/,
    );
    assert.deepEqual(
      await payload(teacher, "quiz_config", { ...settings, published: false }),
      { id: null, saved: true },
    );
    assert.equal((await workspace(learner)).quiz, null);
    await assert.rejects(payload(teacher, "quiz_config", settings), /PT409/);
    await payload(teacher, "quiz_config", settings, 1);
    assert.equal((await workspace(teacher)).quiz.questions[0].correct, 1);
    assert.equal(
      Object.hasOwn((await workspace(learner)).quiz.questions[0], "correct"),
      false,
    );
    const attempt = { answers: [1], request_id: randomUUID() };
    await assert.rejects(payload(learner, "quiz_attempt", attempt, 2), /22023/);
    await assert.rejects(
      payload(learner, "feedback", { rating: 5, comment: "Private feedback" }),
      /42501/,
    );
    await sql(
      `update public.course_sessions set starts_at=now()-interval '2 hours',ends_at=now()-interval '1 hour' where id=${q(session)};`,
    );
    assert.deepEqual(
      await payload(learner, "feedback", {
        rating: 5,
        comment: "Private feedback",
      }),
      { id: null, saved: true },
    );
    assert.equal(
      (await workspace(learner)).feedback.comment,
      "Private feedback",
    );
    assert.equal((await workspace(peer)).feedback, null);
    assert.equal((await workspace(teacher)).feedback_summary.average, null);
    await rpc(
      manager,
      "manage_course_enrolment",
      `${q(course)},${q(learner)},'completed'`,
    );
    await assert.rejects(payload(learner, "completion_issue"), /22023/);
    await rpc(
      teacher,
      "save_course_session_attendance",
      `${q(course)},${q(session)},${q(learner)},'present',null,null,'','',0`,
    );
    await assert.rejects(payload(learner, "completion_issue"), /22023/);
    const submitted = await payload(learner, "quiz_attempt", attempt, 2);
    assert.equal(submitted.score, 100);
    assert.equal(submitted.passed, true);
    assert.deepEqual(
      await payload(learner, "quiz_attempt", attempt, 2),
      submitted,
    );
    await assert.rejects(
      payload(learner, "quiz_attempt", { ...attempt, answers: [0] }, 2),
      /22023/,
    );
    const record = await payload(learner, "completion_issue");
    assert.deepEqual(await payload(learner, "completion_issue"), record);
    const facts = await download(learner, record.id);
    assert.equal(facts.verified_minutes, 60);
    assert.equal(facts.quiz_passed, true);
    assert.equal(facts.course, "Fictional assessed workshop");
    assert.equal(Object.hasOwn(facts, "object_path"), false);
    await assert.rejects(download(peer, record.id), /42501/);
    await assert.rejects(
      payload(peer, "completion_revoke", {
        id: record.id,
        reason: "Fictional reason",
      }),
      /42501/,
    );
    assert.deepEqual(await download(teacher, record.id), facts);
    const notices = (who) => rpc(who, "notification_inbox").then(JSON.parse);
    assert.equal(
      (await notices(learner)).items.find(
        ({ kind }) => kind === "course_completion_issued",
      )?.href,
      `/courses/${course}/workspace#course-learning`,
    );
    assert.ok(
      !(await notices(peer)).items.some(
        ({ kind }) => kind === "course_completion_issued",
      ),
    );
    await sql(
      `select private.apply_verified_installation_licence(${q(JSON.stringify({ ...terms, issued_at: date(-5), starts_at: date(-4), expires_at: date(-1) }))})`,
    );
    assert.deepEqual(await download(learner, record.id), facts);
    await assert.rejects(payload(learner, "completion_issue"), /42501/);
    await sql(
      `select private.apply_verified_installation_licence(${q(JSON.stringify({ ...terms, issued_at: date(-3), starts_at: date(-2) }))})`,
    );
    await payload(teacher, "completion_revoke", {
      id: record.id,
      reason: "Fictional reason",
    });
    await assert.rejects(download(learner, record.id), /42501/);
    assert.ok(
      (await notices(learner)).items.some(
        ({ kind }) => kind === "course_completion_revoked",
      ),
    );
    assert.ok(
      !(await notices(learner)).items.some(
        ({ kind }) => kind === "course_completion_issued",
      ),
    );
    await assert.rejects(payload(learner, "completion_issue"), /22023/);
    await configure(false);
    await assert.rejects(workspace(learner), /42501/);
    assert.equal(
      await sql(
        `select count(*) from private.course_completion_records where run_id=${q(course)} and revoked_at is not null`,
      ),
      "1",
    );
    assert.equal(
      await sql(
        `select count(*) from private.course_quiz_attempts where run_id=${q(course)}`,
      ),
      "1",
    );
    console.log(
      `PASS ${edition}: private quiz, exact retry, evidence-based completion, PDF scope, grace and revocation`,
    );
  });
}
