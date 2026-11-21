/** Verify confirmed publication and write serialization in both dedicated LMS editions. */
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { z } from "zod";
import { prepareAcademyInstallation } from "./academy-installation.mjs";
import { signAcademyLicence } from "./academy-licence.mjs";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";
import { academyOpenApi } from "../src/features/developer-api/academy-contract.ts";

for (const edition of ["customer-self-hosted", "customer-managed"]) {
  await withTestDatabase("academy_publication", async ({ sql, actor }) => {
    const [
      installation,
      manager,
      teacher,
      first,
      second,
      foreign,
      org,
      template,
    ] = Array.from({ length: 8 }, randomUUID);
    const accounts = [
      [manager, "admin"],
      [teacher, "lecturer"],
      [first, "participant"],
      [second, "participant"],
      [foreign, "participant"],
    ];
    const keys = generateKeyPairSync("ed25519");
    const time = (days) =>
      new Date(Date.now() + days * 86_400_000).toISOString();
    const terms = {
      installation_id: installation,
      edition,
      release_commit: "ab".repeat(20),
      issued_at: time(-7),
      starts_at: time(-6),
      expires_at: time(3),
      grace_until: time(4),
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
    await sql(`insert into auth.users(id,email,email_confirmed_at) values
      ${accounts.map(([id]) => `(${q(id)},${q(id + "@example.invalid")},now())`).join(",")};
      insert into public.user_roles(user_id,role) values ${accounts.map(([id, role]) => `(${q(id)},${q(role)})`).join(",")};
      insert into public.organisations(id,name) values(${q(org)},'Fictional Academy');
      insert into public.course_templates(id,title) values(${q(template)},'Fictional workshop');`);
    for (const learner of [first, second]) {
      const link = randomUUID();
      await sql(`insert into private.company_participant_link_requests(id,organisation_id,requested_by,request_id,luminovia_user_id,target_user_id,status,expires_at)
        select ${q(link)},${q(org)},${q(manager)},${q(randomUUID())},luminovia_user_id,id,'accepted',now()+interval '1 day' from public.profiles where id=${q(learner)};
        insert into private.company_participant_memberships(organisation_id,user_id,status,link_request_id,invited_by,joined_at)
        values(${q(org)},${q(learner)},'active',${q(link)},${q(manager)},now());`);
    }
    const rpc = (who, endpoint, args = "", method = "POST") =>
      actor(
        who,
        `set local request.path=${q("/rpc/" + endpoint)}; set local request.method=${q(method)};
       select public.require_portal_access(); select public.${endpoint}(${args});`,
      );
    const draftPayload = {
      time_zone: "Australia/Brisbane",
      delivery_type: "online",
      venue: "",
      sessions: [{ starts_at: time(1), ends_at: time(2) }],
    };
    const { course_run_id: course } = JSON.parse(
      await rpc(
        manager,
        "academy_create_course_draft",
        `${q(randomUUID())},${q(org)},${q(template)},null,${q(JSON.stringify(draftPayload))}`,
      ),
    );
    const catalogue = academyOpenApi(
      "https://academy.example.invalid/backend",
      { installationId: installation, name: "Fictional Academy", edition },
    );
    const checked = (endpoint, result) =>
      z
        .fromJSONSchema(
          catalogue.paths["/rest/v1/rpc/" + endpoint].post.responses["200"]
            .content["application/json"].schema,
        )
        .parse(JSON.parse(result));
    const state = (who = manager) =>
      rpc(who, "academy_course_publication", q(course)).then((result) =>
        checked("academy_course_publication", result),
      );
    const publish = (who, capacity) =>
      rpc(who, "academy_publish_course", `${q(course)},${capacity}`).then(
        (result) => checked("academy_publish_course", result),
      );
    const enrol = (learner, status = "enrolled") =>
      rpc(
        manager,
        "manage_course_enrolment",
        `${q(course)},${q(learner)},${q(status)}`,
      );
    const open = (learner) =>
      rpc(learner, "course_workspace", q(course)).then(JSON.parse);

    assert.deepEqual(await state(), { published: false, capacity: null });
    await assert.rejects(state(first), /42501/);
    await assert.rejects(publish(first, 1), /42501/);
    await assert.rejects(publish(teacher, 1), /42501/);
    await assert.rejects(publish(manager, 0), /22023/);
    await assert.rejects(publish(manager, 1), /PT409/);
    await assert.rejects(enrol(first), /PT409/);
    await assert.rejects(open(first), /42501/);
    await rpc(
      manager,
      "academy_assign_course_instructor",
      `${q(course)},${q(teacher)},${q(randomUUID())}`,
    );
    await assert.rejects(
      rpc(manager, "academy_publish_course", `${q(course)},1`, "GET"),
      /42501/,
    );
    await sql(`update public.profiles set active=false where id=${q(teacher)}`);
    await assert.rejects(publish(manager, 1), /PT409/);
    await sql(`update public.profiles set active=true where id=${q(teacher)}`);
    const published = { published: true, capacity: 1 };
    const attempts = await Promise.all([
      publish(manager, 1),
      publish(manager, 1),
    ]);
    assert.deepEqual(attempts, [published, published]);
    await assert.rejects(publish(manager, 2), /PT409/);
    assert.deepEqual(await state(), published);
    assert.equal(
      await sql(
        `select count(*) from public.audit_events where action='academy.course.published' and resource_id=${q(course)}`,
      ),
      "1",
    );
    assert.equal(
      await sql(
        `select count(*) from public.jobs where course_run_id=${q(course)} and status='published'`,
      ),
      "0",
    );
    await assert.rejects(enrol(foreign), /42501/);

    const candidates = [first, second];
    const enrolments = await Promise.allSettled(
      candidates.map((candidate) => enrol(candidate)),
    );
    assert.equal(
      enrolments.filter(({ status }) => status === "fulfilled").length,
      1,
    );
    const failed = enrolments.findIndex(({ status }) => status === "rejected");
    assert.match(String(enrolments[failed].reason), /PT409/);
    const winner = candidates[1 - failed],
      waiting = candidates[failed];
    assert.equal((await open(winner)).access.learner, true);
    await assert.rejects(open(waiting), /42501/);
    await enrol(winner);
    await enrol(winner, "removed");
    await enrol(waiting);
    await assert.rejects(open(winner), /42501/);
    assert.equal((await open(waiting)).access.learner, true);

    await sql(
      `select private.apply_verified_installation_licence(${q(JSON.stringify({ ...terms, issued_at: time(-5), starts_at: time(-4), expires_at: time(-1) }))})`,
    );
    assert.deepEqual(await state(), published);
    await assert.rejects(publish(manager, 1), /42501/);
    await assert.rejects(enrol(waiting, "removed"), /42501/);
    await configure(false);
    await assert.rejects(state(), /42501/);
    assert.equal(
      await sql(
        `select count(*) from public.course_enrolments where course_run_id=${q(course)}`,
      ),
      "2",
    );
    console.log(
      `PASS ${edition}: scoped publication, current teacher, idempotency, concurrent capacity, learner access and retention`,
    );
  });
}
