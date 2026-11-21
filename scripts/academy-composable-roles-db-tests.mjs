/** Actual PostgreSQL role-editor and current resource gates for both dedicated editions. */
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import {
  configureAcademyCourseAccess,
  prepareAcademyInstallation,
} from "./academy-installation.mjs";
import { signAcademyLicence } from "./academy-licence.mjs";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";
import { z } from "zod";
import { academyOpenApi } from "../src/features/developer-api/academy-contract.ts";

for (const edition of ["customer-self-hosted", "customer-managed"]) {
  await withTestDatabase("academy_composable_roles", async ({ actor, sql }) => {
    const [
      admin,
      manager,
      combined,
      courseTemplate,
      learningOrg,
      companyOrg,
      teachingOrg,
      learningCourse,
      companyCourse,
      teachingCourse,
    ] = Array.from({ length: 10 }, randomUUID);
    const now = Date.now();
    const date = (days) => new Date(now + days * 86_400_000).toISOString();
    const terms = {
      installation_id: randomUUID(),
      edition,
      release_commit: "ab".repeat(20),
      issued_at: date(-2),
      starts_at: date(-1),
      expires_at: date(10),
      grace_until: date(15),
      modules: ["lms"],
      limits: {
        seat_count: 3,
        storage_bytes: 20_000_000,
        api_requests_per_minute: 60,
      },
    };
    const key = generateKeyPairSync("ed25519");
    const options = {
      envelope: signAcademyLicence(terms, key.privateKey),
      publicKey: key.publicKey,
      expected: terms,
      now,
    };
    await prepareAcademyInstallation(options, sql);
    await configureAcademyCourseAccess({ ...options, enabled: true }, sql);
    await sql(`
      insert into auth.users(id,email,email_confirmed_at) values
        (${q(admin)},'admin@example.invalid',now()),(${q(manager)},'manager@example.invalid',now()),
        (${q(combined)},'local-member@example.invalid',now());
      insert into public.user_roles(user_id,role) values
        (${q(admin)},'admin'),(${q(manager)},'management'),(${q(combined)},'client');
      insert into public.organisations(id,name) values (${q(learningOrg)},'Fictional Learning'),
        (${q(companyOrg)},'Fictional Company'),(${q(teachingOrg)},'Fictional Teaching');
      insert into public.client_organisation_memberships(user_id, organisation_id) values (${q(combined)},${q(companyOrg)});
      insert into public.course_templates(id,title) values (${q(courseTemplate)},'Fictional Workshop');
      insert into public.course_runs(id,template_id,organisation_id) values
        (${q(learningCourse)},${q(courseTemplate)},${q(learningOrg)}),
        (${q(companyCourse)},${q(courseTemplate)},${q(companyOrg)}),
        (${q(teachingCourse)},${q(courseTemplate)},${q(teachingOrg)});
      insert into public.course_sessions(course_run_id,starts_at,ends_at) values
        (${q(learningCourse)},now()+interval '1 day',now()+interval '25 hours'),
        (${q(companyCourse)},now()+interval '2 days',now()+interval '49 hours'),
        (${q(teachingCourse)},now()+interval '3 days',now()+interval '73 hours');`);

    const literal = (value) =>
      value === null
        ? "null"
        : typeof value === "boolean"
          ? String(value)
          : q(value);
    const rpc = async (who, name, ...args) =>
      JSON.parse(
        (await actor(
          who,
          `
      set local request.path=${q("/rpc/" + name)}; set local request.method='POST';
      select public.require_portal_access();
      select to_jsonb(public.${name}(${args.map(literal).join(",")}));`,
        )) || "null",
      );
    const { paths } = academyOpenApi("https://academy.example.invalid", {
      name: "Practice Academy",
      installationId: terms.installation_id,
      edition,
    });
    const response = (endpoint) =>
      z.fromJSONSchema(
        paths[`/rest/v1/rpc/${endpoint}`].post.responses["200"].content[
          "application/json"
        ].schema,
      );
    const readRoles = response("academy_member_roles");
    const changeRoles = response("academy_set_member_role");
    const read = async (target = combined) =>
      readRoles.parse(await rpc(admin, "academy_member_roles", target));
    const change = async (role, scope, enabled, revision, target = combined) =>
      changeRoles.parse(
        await rpc(
          admin,
          "academy_set_member_role",
          target,
          role,
          scope,
          enabled,
          revision,
        ),
      );
    const assign = (who, target) =>
      rpc(
        who,
        "academy_assign_course_instructor",
        teachingCourse,
        target,
        randomUUID(),
      );
    const workspace = (who, course) => rpc(who, "course_workspace", course);

    const initial = await read();
    assert.deepEqual(initial.roles, [
      {
        role: "client",
        organisation_id: companyOrg,
        organisation_name: "Fictional Company",
      },
    ]);
    assert.equal(
      (await workspace(combined, companyCourse)).access.client,
      true,
    );
    await assert.rejects(workspace(combined, learningCourse), /42501/);
    assert.equal((await assign(manager, manager)).status, "not_eligible");
    assert.equal((await assign(admin, combined)).status, "not_eligible");
    await assert.rejects(assign(combined, combined), /42501/);

    for (const caller of [combined, manager]) {
      await assert.rejects(
        rpc(caller, "academy_member_roles", combined),
        /42501/,
      );
      await assert.rejects(
        rpc(
          caller,
          "academy_set_member_role",
          combined,
          "lecturer",
          null,
          true,
          initial.revision,
        ),
        /42501/,
      );
    }
    await assert.rejects(rpc(admin, "academy_member_roles", admin), /42501/);
    await assert.rejects(
      change("admin", null, true, initial.revision),
      /22023/,
    );
    await assert.rejects(
      change("client", companyOrg, false, initial.revision),
      /PT409/,
    );

    // Three explicitly different scopes remain independent on the same seat.
    const companyTeacher = await change(
      "lecturer",
      null,
      true,
      initial.revision,
    );
    await assert.rejects(
      change("participant", learningOrg, true, initial.revision),
      /PT409/,
    );
    const all = await change(
      "participant",
      learningOrg,
      true,
      companyTeacher.revision,
    );
    assert.equal(all.roles.length, 3);
    assert.equal(
      await sql("select occupied from private.academy_seat_usage()"),
      "3",
    );
    const confirmed = await assign(admin, combined);
    assert.equal(confirmed.status, "confirmed");
    assert.equal(
      (await workspace(combined, teachingCourse)).access.teacher,
      true,
    );
    assert.equal(
      (await workspace(combined, companyCourse)).access.client,
      true,
    );
    await assert.rejects(workspace(combined, learningCourse), /42501/);
    await rpc(
      admin,
      "manage_course_enrolment",
      learningCourse,
      combined,
      "enrolled",
    );
    const learnerView = await workspace(combined, learningCourse);
    assert.equal(learnerView.access.learner, true);
    assert.equal(learnerView.access.client, false);
    assert.equal(learnerView.access.teacher, false);
    const room = await rpc(admin, "academy_ensure_course_chat", learningCourse);
    const rooms = await rpc(combined, "course_chat_rooms", learningCourse);
    assert.ok(
      rooms.some(({ id, can_post }) => id === room && can_post),
      "a mixed enrolled learner can use the same scoped course room",
    );
    await rpc(
      combined,
      "send_course_chat_message",
      room,
      "Fictional classroom reply",
      randomUUID(),
    );

    const withoutLearner = await change(
      "participant",
      learningOrg,
      false,
      all.revision,
    );
    assert.deepEqual(withoutLearner.roles, companyTeacher.roles);
    assert.equal(
      await sql(
        `select status from public.course_enrolments where course_run_id=${q(learningCourse)} and user_id=${q(combined)}`,
      ),
      "removed",
    );
    await assert.rejects(workspace(combined, learningCourse), /42501/);
    await assert.rejects(
      rpc(
        combined,
        "send_course_chat_message",
        room,
        "Fictional revoked reply",
        randomUUID(),
      ),
      /42501/,
    );

    const anotherCompany = await change(
      "client",
      learningOrg,
      true,
      withoutLearner.revision,
    );
    const withoutCompany = await change(
      "client",
      companyOrg,
      false,
      anotherCompany.revision,
    );
    assert.equal(
      (await workspace(combined, learningCourse)).access.client,
      true,
    );
    await assert.rejects(workspace(combined, companyCourse), /42501/);
    const withoutTeaching = await change(
      "lecturer",
      null,
      false,
      withoutCompany.revision,
    );
    assert.equal(withoutTeaching.roles.length, 1);
    await assert.rejects(workspace(combined, teachingCourse), /42501/);
    assert.equal(
      await sql(
        `select status from public.job_claims where id=${q(confirmed.claim_id)}`,
      ),
      "confirmed",
    );
    assert.deepEqual(
      (await rpc(combined, "my_course_workspaces")).map((course) => course.id),
      [learningCourse],
    );

    const managerBefore = await read(manager);
    const managerWithTeaching = await change(
      "lecturer",
      null,
      true,
      managerBefore.revision,
      manager,
    );
    assert.deepEqual(
      managerWithTeaching.roles.map(({ role }) => role),
      ["lecturer", "management"],
    );
    assert.ok(
      (
        await rpc(
          admin,
          "academy_course_instructor_candidates",
          teachingCourse,
          "",
        )
      ).some(({ id }) => id === manager),
    );
    await change(
      "lecturer",
      null,
      false,
      managerWithTeaching.revision,
      manager,
    );
    assert.equal((await assign(manager, manager)).status, "not_eligible");

    const grace = {
      ...terms,
      issued_at: date(-1.9),
      starts_at: date(-1.8),
      expires_at: date(-0.5),
      grace_until: date(2),
    };
    await sql(
      `select private.apply_verified_installation_licence(${q(JSON.stringify(grace))}::jsonb)`,
    );
    assert.equal((await read()).can_write, false);
    await assert.rejects(
      change("lecturer", null, true, withoutTeaching.revision),
      /42501/,
    );
    console.log(
      `PASS ${edition} exact role/scope unions, local administration, seat and revocation boundaries`,
    );
  });
}
