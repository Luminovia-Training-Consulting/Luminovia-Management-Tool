/** Exercise signed package changes on both dedicated editions using isolated fixtures. */
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { z } from "zod";
import { academyOpenApi } from "../src/features/developer-api/academy-contract.ts";
import { prepareAcademyInstallation } from "./academy-installation.mjs";
import { signAcademyLicence } from "./academy-licence.mjs";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

const instant = (offset) =>
  new Date(Date.now() + offset * 86400000).toISOString();
const json = (value) => q(JSON.stringify(value));

for (const edition of ["customer-self-hosted", "customer-managed"]) {
  await withTestDatabase("academy_lms_packages", async ({ sql, actor }) => {
    const [
      installation,
      manager,
      learner,
      outsider,
      contact,
      org,
      other,
      template,
      course,
      session,
      link,
    ] = Array.from({ length: 11 }, randomUUID);
    const terms = {
      installation_id: installation,
      release_commit: "bb".repeat(20),
      edition,
      issued_at: instant(-10),
      starts_at: instant(-9),
      expires_at: instant(30),
      grace_until: instant(40),
      modules: ["lms-standard"],
      limits: {
        seat_count: 30,
        storage_bytes: 5000000,
        api_requests_per_minute: 60,
      },
    };
    const keys = generateKeyPairSync("ed25519");
    const apply = (overrides = {}) => {
      const current = { ...terms, ...overrides };
      return prepareAcademyInstallation(
        {
          envelope: signAcademyLicence(current, keys.privateKey),
          publicKey: keys.publicKey,
          expected: current,
        },
        sql,
      );
    };
    await apply();
    await sql(
      `select private.configure_academy_course_access(${q(installation)},${q(terms.release_commit)},true);`,
    );
    await sql(`insert into auth.users(id,email,email_confirmed_at) values
      ${[manager, learner, outsider, contact].map((id) => `(${q(id)},${q(id + "@example.invalid")},now())`).join(",")};
      insert into public.user_roles(user_id,role) values
        (${q(manager)},'admin'),(${q(learner)},'participant'),(${q(outsider)},'participant'),(${q(contact)},'client');
      insert into public.organisations(id,name) values (${q(org)},'Example training'),(${q(other)},'Other fictional company');
      insert into public.client_organisation_memberships(user_id, organisation_id) values (${q(contact)},${q(other)});
      insert into public.course_templates(id,title,owner_organisation_id) values (${q(template)},'Fictional practical course',${q(org)});
      insert into public.course_runs(id,template_id,organisation_id,published) values (${q(course)},${q(template)},${q(org)},true);
      insert into public.course_sessions(id,course_run_id,starts_at,ends_at)
        values (${q(session)},${q(course)},now()-interval '2 days',now()-interval '47 hours');
      insert into private.company_participant_link_requests
        (id,organisation_id,requested_by,request_id,luminovia_user_id,target_user_id,status,expires_at)
        select ${q(link)},${q(org)},${q(manager)},${q(randomUUID())},luminovia_user_id,id,'accepted',now()+interval '2 days'
        from public.profiles where id=${q(learner)};
      insert into private.company_participant_memberships
        (organisation_id,user_id,status,link_request_id,invited_by,joined_at)
        values (${q(org)},${q(learner)},'active',${q(link)},${q(manager)},now());`);

    const api = academyOpenApi("https://example.invalid", {
      name: "Example",
      edition,
      installationId: installation,
    });
    const capabilitySchema = z.fromJSONSchema(
      api.paths["/rest/v1/rpc/installation_capabilities"].get.responses["200"]
        .content["application/json"].schema,
    );
    const capabilities = async () =>
      capabilitySchema.parse(
        JSON.parse(
          await sql(
            "begin;set local role anon;select public.installation_capabilities();commit;",
          ),
        ),
      );
    const invoke = (who, operation, args, request = "POST") =>
      actor(
        who,
        `set local request.path=${q("/rpc/" + operation)};set local request.method=${q(request)};
       select public.require_portal_access();select public.${operation}(${args});`,
      );
    const workspace = (who, courseId = course) =>
      invoke(who, "course_workspace", q(courseId), "GET").then(JSON.parse);
    const setExam = (expected = 0) =>
      invoke(
        manager,
        "set_course_exam_required",
        `${q(course)},true,${expected}`,
      ).then(JSON.parse);
    const action = (who, name, payload, expected = 0) =>
      invoke(
        who,
        "academy_learning_action",
        `${q(course)},${q(name)},${json(payload)},${expected}`,
      ).then(JSON.parse);
    const quiz = {
      questions: [
        { prompt: "Fictional quiz", options: ["First", "Second"], correct: 0 },
      ],
      published: true,
      pass_percent: 80,
      max_attempts: 2,
    };

    assert.equal((await capabilities()).academy_standard_only, true);
    assert.equal((await workspace(manager)).lms_enabled, false);
    await invoke(
      manager,
      "manage_course_enrolment",
      `${q(course)},${q(learner)},'enrolled'`,
    );
    const standard = await workspace(learner);
    assert.equal(standard.access.learner, true);
    assert.equal(standard.lms_enabled, false);
    assert.equal(standard.sessions[0].id, session);
    assert.equal(standard.learner_status, "enrolled");
    const [document, version, target] = Array.from({ length: 3 }, randomUUID);
    const sha = "d".repeat(64);
    await sql(`insert into public.documents(id,owner_id,uploaded_by,scope,kind,original_name,mime_type,size_bytes,status,client_id)
       values (${q(document)},${q(manager)},${q(manager)},'personal','material','Example.pdf','application/pdf',10,'clean',${q(randomUUID())});
      insert into public.document_versions(id,document_id,uploaded_by,client_id,version,object_path,original_name,mime_type,size_bytes,status,sha256,scanner_version)
       values (${q(version)},${q(document)},${q(manager)},${q(randomUUID())},1,'fixtures/example.pdf','Example.pdf','application/pdf',10,'clean',${q(sha)},'fictional scanner');
      update public.documents set current_version_id=${q(version)} where id=${q(document)};
      insert into private.academy_course_material_intake(version_id,run_id,release_commit,expected_sha256)
       values (${q(version)},${q(course)},${q(terms.release_commit)},${q(sha)});
      insert into public.course_runs(id,template_id,organisation_id) values (${q(target)},${q(template)},${q(org)});`);
    const material = await invoke(
      manager,
      "academy_course_material_action",
      `${q(course)},'resource_share',${q(version)},'participants','material'`,
    ).then(JSON.parse);
    const resource = material.id;
    assert.equal((await workspace(learner)).resources[0].version_id, version);
    assert.equal(
      (
        await actor(
          learner,
          `select public.course_document_access('resource',${q(resource)})`,
        ).then(JSON.parse)
      ).id,
      version,
    );
    await assert.rejects(
      actor(
        outsider,
        `select public.course_document_access('resource',${q(resource)})`,
      ),
      /42501/,
    );
    const title = "Example Standard material";
    assert.equal(
      await invoke(
        manager,
        "set_course_material_metadata",
        `${q(resource)},0,${json({
          title,
          description: "",
          subject: "",
          licence: "",
          language: "",
          tags: [],
        })}`,
      ),
      "1",
    );
    const copied = await invoke(
      manager,
      "reuse_course_material",
      `${q(resource)},${q(target)},true`,
    );
    assert.equal((await workspace(manager, target)).resources[0]?.id, copied);

    await assert.rejects(workspace(outsider), /42501/);
    await assert.rejects(workspace(contact), /42501/);
    await assert.rejects(setExam(), /42501/);
    await assert.rejects(
      actor(
        manager,
        `select public.set_course_exam_required(${q(course)},true,0)`,
      ),
      /42501/,
    );
    await assert.rejects(action(manager, "quiz_config", quiz), /42501/);
    await assert.rejects(action(learner, "completion_issue", {}), /42501/);
    await assert.rejects(
      invoke(manager, "course_gradebook", q(course), "GET"),
      /42501/,
    );
    await assert.rejects(
      actor(manager, `select public.course_gradebook(${q(course)})`),
      /42501/,
    );

    await apply({
      issued_at: instant(-8),
      starts_at: instant(-7),
      modules: ["lms"],
    });
    assert.equal((await capabilities()).academy_standard_only, undefined);
    assert.equal((await workspace(learner)).lms_enabled, true);
    assert.deepEqual(await setExam(), { required: true, version: 1 });
    await action(manager, "quiz_config", quiz);
    const attempt = await action(
      learner,
      "quiz_attempt",
      { answers: [0], request_id: randomUUID() },
      1,
    );
    assert.equal(attempt.score, 100);
    assert.equal(attempt.passed, true);
    await sql(`update public.course_enrolments set status='completed' where course_run_id=${q(course)} and user_id=${q(learner)};
      insert into private.course_attendance(session_id,user_id,state,minutes)
       values (${q(session)},${q(learner)},'attended',60);`);
    const completion = await action(learner, "completion_issue", {});
    assert.ok(completion.id);

    await apply({ issued_at: instant(-6), starts_at: instant(-5) });
    assert.equal((await workspace(learner)).learner_status, "completed");
    await assert.rejects(setExam(1), /42501/);
    await assert.rejects(action(learner, "completion_issue", {}), /42501/);
    assert.equal(
      await sql(
        `select count(*) from private.course_completion_records where id=${q(completion.id)} and revoked_at is null`,
      ),
      "1",
    );
    assert.equal(
      await sql(
        `select score from private.course_quiz_attempts where id=${q(attempt.id)}`,
      ),
      "100",
    );

    // Exercise verified renewal through the same ingestion path and leave the
    // exact release and approved roles unchanged.
    await apply({
      issued_at: instant(-4),
      starts_at: instant(-3),
      modules: ["lms"],
    });
    assert.deepEqual(await action(learner, "completion_issue", {}), completion);
    assert.equal((await workspace(learner)).lms_enabled, true);
    await sql(
      `select private.apply_verified_installation_licence(${json({
        ...terms,
        issued_at: instant(-2),
        starts_at: instant(-2),
        expires_at: instant(-1),
        grace_until: instant(1),
      })});`,
    );
    assert.equal((await capabilities()).licence_status, "grace");
    assert.equal((await workspace(learner)).learner_status, "completed");
    await assert.rejects(
      invoke(
        manager,
        "manage_course_enrolment",
        `${q(course)},${q(learner)},'removed'`,
      ),
      /42501/,
    );
    await sql(
      `select private.apply_verified_installation_licence(${json({
        ...terms,
        issued_at: instant(-1.8),
        starts_at: instant(-1.7),
        expires_at: instant(-1.6),
        grace_until: instant(-1.5),
      })});`,
    );
    assert.equal((await capabilities()).licence_status, "expired");
    await assert.rejects(workspace(learner), /42501/);

    console.log(
      `PASS ${edition} signed LMS packages, assessed attempts, retained evidence, reactivation, grace and expiry`,
    );
  });
}
