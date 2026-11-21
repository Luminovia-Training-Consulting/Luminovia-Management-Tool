/** Confirm the licensed exam decision while both editions keep retained PDFs private. */
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { z } from "zod";
import { academyOpenApi } from "../src/features/developer-api/academy-contract.ts";
import { prepareAcademyInstallation } from "./academy-installation.mjs";
import { signAcademyLicence } from "./academy-licence.mjs";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

const gate = (name, method = "POST") =>
  `set local request.path=${q("/rpc/" + name)};set local request.method=${q(method)};select public.require_portal_access();`;
const endpoint = "set_course_exam_required";

for (const edition of ["customer-self-hosted", "customer-managed"]) {
  await withTestDatabase("academy_exam_requirement", async ({ sql, actor }) => {
    const [
      installation,
      manager,
      teacher,
      client,
      stranger,
      learner,
      outside,
      org,
      otherOrg,
      template,
      run,
      otherRun,
      consent,
      document,
      answer,
      paper,
      answerShare,
      paperShare,
    ] = Array.from({ length: 18 }, randomUUID);
    const key = generateKeyPairSync("ed25519");
    const now = Date.now();
    const date = (offset) => new Date(now + offset * 86400000).toISOString();
    const terms = {
      installation_id: installation,
      edition,
      release_commit: "ab".repeat(20),
      issued_at: date(-8),
      starts_at: date(-5),
      expires_at: date(20),
      grace_until: date(25),
      modules: ["lms"],
      limits: {
        seat_count: 15,
        storage_bytes: 1_000_000,
        api_requests_per_minute: 60,
      },
    };
    await prepareAcademyInstallation(
      {
        envelope: signAcademyLicence(terms, key.privateKey),
        publicKey: key.publicKey,
        expected: terms,
        now,
      },
      sql,
    );
    const { paths } = academyOpenApi("https://academy.example.invalid", {
      name: "Fictional Exam Academy",
      installationId: installation,
      edition,
    });
    const response = (name, value) => {
      const schema =
        paths["/rest/v1/rpc/" + name].post.responses["200"].content[
          "application/json"
        ].schema;
      const parsed = z.fromJSONSchema(schema).safeParse(value);
      assert.ok(parsed.success, parsed.error?.message);
      return value;
    };
    const users = [
      [manager, "admin"],
      [teacher, "lecturer"],
      [client, "client"],
      [stranger, "client"],
      [learner, "participant"],
      [outside, "lecturer"],
    ];
    await sql(`insert into auth.users(id,email,email_confirmed_at) values
      ${users.map(([id]) => `(${q(id)},${q(id + "@example.invalid")},now())`).join(",")};
      insert into public.user_roles(user_id,role) values
      ${users.map(([id, role]) => `(${q(id)},${q(role)})`).join(",")};
      insert into public.organisations(id,name) values
        (${q(org)},'Fictional Academy'),(${q(otherOrg)},'Fictional Other Academy');
      insert into public.client_organisation_memberships(user_id,organisation_id)
        values(${q(client)},${q(org)}),(${q(stranger)},${q(otherOrg)});
      insert into public.course_templates(id,title) values(${q(template)},'Fictional exam course');
      insert into public.course_runs(id,template_id,organisation_id) values
        (${q(run)},${q(template)},${q(org)}),(${q(otherRun)},${q(template)},${q(otherOrg)});
      insert into public.course_sessions(course_run_id,starts_at,ends_at) values
        (${q(run)},now()+interval '1 day',now()+interval '25 hours');
      insert into private.company_participant_link_requests
        (id,organisation_id,requested_by,request_id,luminovia_user_id,target_user_id,status,expires_at)
        select ${q(consent)},${q(org)},${q(manager)},${q(randomUUID())},luminovia_user_id,id,'accepted',now()+interval '2 days'
        from public.profiles where id=${q(learner)};
      insert into private.company_participant_memberships
        (organisation_id,user_id,status,link_request_id,invited_by,joined_at)
        values(${q(org)},${q(learner)},'active',${q(consent)},${q(manager)},now());
      insert into public.course_enrolments(course_run_id,user_id,enrolled_by,status)
        values(${q(run)},${q(learner)},${q(manager)},'enrolled');
      insert into public.documents (id,owner_id,uploaded_by,scope,kind,original_name,mime_type,size_bytes,status,client_id)
        values(${q(document)},${q(teacher)},${q(teacher)},'personal','material','fixture.pdf','application/pdf',24,'clean',${q(randomUUID())});
      insert into public.document_versions
        (id,document_id,uploaded_by,client_id,version,object_path,original_name,mime_type,size_bytes,status,sha256)
        values (${q(answer)},${q(document)},${q(teacher)},${q(randomUUID())},1,'fictional/answer.pdf','fictional answer key.pdf','application/pdf',24,'clean',${q("a".repeat(64))}),
          (${q(paper)},${q(document)},${q(teacher)},${q(randomUUID())},2,'fictional/paper.pdf','fictional student paper.pdf','application/pdf',24,'clean',${q("b".repeat(64))});
      insert into private.course_exam_documents(id,run_id,version_id,audience,created_by)
        values(${q(answerShare)},${q(run)},${q(answer)},'exam_staff',${q(teacher)}),
          (${q(paperShare)},${q(run)},${q(paper)},'students',${q(teacher)});`);
    const workspace = (who, course = run) =>
      actor(
        who,
        gate("course_workspace", "GET") +
          `select public.course_workspace(${q(course)})`,
      )
        .then(JSON.parse)
        .then((value) => response("course_workspace", value));
    const write = (required, previous, course = run) =>
      `select public.set_course_exam_required(${q(course)},${required},${previous})`;
    const set = (who, required, previous, course) =>
      actor(who, gate(endpoint) + write(required, previous, course))
        .then(JSON.parse)
        .then((value) => response(endpoint, value));
    const setProfile = (enabled, release = terms.release_commit) =>
      sql(
        `select private.configure_academy_course_access(${q(installation)},${q(release)},${enabled})`,
      );
    const renew = (change) =>
      sql(
        `select private.apply_verified_installation_licence(${q(JSON.stringify({ ...terms, ...change }))}::jsonb)`,
      );
    const projection = (required, version, can_edit) => ({
      required,
      version,
      can_edit,
      documents: [],
    });

    await assert.rejects(workspace(manager), /42501/);
    await assert.rejects(actor(manager, write(true, 0)), /42501/);
    await setProfile(true);
    for (const who of [teacher, learner, stranger, outside]) {
      await assert.rejects(set(who, true, 0), /42501/);
    }
    assert.deepEqual(
      (await workspace(client)).exams,
      projection(false, 0, true),
    );
    assert.deepEqual(
      (await workspace(learner)).exams,
      projection(false, null, false),
    );
    const assigned = await actor(
      manager,
      gate("academy_assign_course_instructor") +
        `select public.academy_assign_course_instructor(${q(run)},${q(teacher)},${q(randomUUID())})`,
    ).then(JSON.parse);
    assert.equal(assigned.status, "confirmed");
    assert.deepEqual(
      (await workspace(teacher)).exams,
      projection(false, 0, true),
    );
    for (const method of ["GET", "HEAD", "PATCH"]) {
      await assert.rejects(actor(teacher, gate(endpoint, method)), /42501/);
    }
    await assert.rejects(
      sql("set role service_role;" + gate(endpoint)),
      /42501/,
    );
    await assert.rejects(set(client, true, 0, otherRun), /42501/);
    assert.deepEqual(await set(teacher, true, 0), {
      required: true,
      version: 1,
    });
    assert.deepEqual(
      (await workspace(learner)).exams,
      projection(true, null, false),
    );
    assert.doesNotMatch(
      JSON.stringify(await workspace(learner)),
      /fictional answer key|fictional student paper/,
    );
    assert.deepEqual(
      (await workspace(manager)).exams,
      projection(true, 1, true),
    );
    for (const who of [learner, teacher, manager, client]) {
      for (const selected of [answerShare, paperShare]) {
        await assert.rejects(
          actor(
            who,
            gate("course_document_access") +
              `select public.course_document_access('exam',${q(selected)})`,
          ),
          /42501/,
        );
        await assert.rejects(
          actor(
            who,
            gate("course_document_access") +
              `select public.course_document_access('resource',${q(selected)})`,
          ),
          /42501/,
        );
      }
    }
    await assert.rejects(
      actor(teacher, gate("course_workspace_action")),
      /42501/,
    );
    await actor(teacher, gate("remove_course_exam_pdf"));
    await assert.rejects(
      actor(
        learner,
        gate("remove_course_exam_pdf") +
          `select public.remove_course_exam_pdf(${q(run)},${q(answerShare)})`,
      ),
      /42501/,
    );
    const attempts = await Promise.allSettled([
      set(teacher, false, 1),
      set(client, true, 1),
    ]);
    assert.equal(
      attempts.filter((attempt) => attempt.status === "fulfilled").length,
      1,
    );
    assert.match(
      attempts.find((attempt) => attempt.status === "rejected").reason.message,
      /PT409/,
    );
    assert.deepEqual(await set(client, false, 2), {
      required: false,
      version: 3,
    });
    assert.deepEqual(
      (await workspace(learner)).exams,
      projection(false, null, false),
    );
    assert.deepEqual(await set(teacher, true, 3), {
      required: true,
      version: 4,
    });
    assert.equal(
      await sql(
        `select status from public.course_enrolments where course_run_id=${q(run)} and user_id=${q(learner)}`,
      ),
      "enrolled",
    );

    await sql(
      `update public.client_organisation_memberships set removed_at=now() where user_id=${q(client)} and organisation_id=${q(org)}`,
    );
    await assert.rejects(set(client, false, 4), /42501/);
    await actor(
      manager,
      gate("academy_release_course_instructor") +
        `select public.academy_release_course_instructor(${q(run)},${q(assigned.claim_id)},'Fictional teaching change',${q(randomUUID())})`,
    );
    await assert.rejects(set(teacher, false, 4), /42501/);

    const nextRelease = "cd".repeat(20);
    await renew({ release_commit: nextRelease, issued_at: date(-7) });
    await assert.rejects(workspace(manager), /42501/);
    await setProfile(true, nextRelease);
    await renew({
      release_commit: nextRelease,
      issued_at: date(-6),
      expires_at: date(-2),
    });
    assert.deepEqual(
      (await workspace(manager)).exams,
      projection(true, 4, false),
    );
    assert.deepEqual(
      (await workspace(learner)).exams,
      projection(true, null, false),
    );
    await assert.rejects(set(manager, false, 4), /42501/);
    await assert.rejects(actor(manager, write(false, 4)), /42501/);
    await renew({
      release_commit: nextRelease,
      issued_at: date(-5),
      expires_at: date(-2),
      grace_until: date(-1),
    });
    await assert.rejects(workspace(learner), /42501/);
    await assert.rejects(set(manager, false, 4), /42501/);
    assert.equal(
      await sql(
        `select required::text || ':' || version from private.course_exam_settings where run_id=${q(run)}`,
      ),
      "true:4",
    );
    assert.equal(
      await sql(
        `select count(*) from private.course_exam_documents where run_id=${q(run)} and removed_at is null`,
      ),
      "2",
    );
    assert.equal(
      await sql(
        `select count(*) from public.audit_events where resource_id=${q(run)} and action='course.exam_requirement_changed'`,
      ),
      "4",
    );
    console.log(
      `PASS ${edition} versioned exam requirement, learner status, retained answers, role revocation and grace`,
    );
  });
}
