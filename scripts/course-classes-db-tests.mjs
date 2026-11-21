import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { z } from "zod";
import { academyClassPaths } from "../src/features/developer-api/academy-class-contract.ts";
import { prepareAcademyInstallation } from "./academy-installation.mjs";
import { signAcademyLicence } from "./academy-licence.mjs";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

const date = (days) => new Date(Date.now() + days * 86400000).toISOString();
const schema = z.fromJSONSchema(
  academyClassPaths["/rest/v1/rpc/course_class_options"].post.responses["200"]
    .content["application/json"].schema,
);

for (const edition of [
  "internal",
  "customer-self-hosted",
  "customer-managed",
]) {
  await withTestDatabase("course_classes", async ({ sql, actor }) => {
    const [
      installation,
      admin,
      client,
      learner,
      stranger,
      orgA,
      orgB,
      templateA,
      templateB,
      runA,
      runB,
      runC,
      link,
      request,
    ] = Array.from({ length: 14 }, randomUUID);
    const terms = {
      installation_id: installation,
      edition,
      release_commit: "ab".repeat(20),
      issued_at: date(-6),
      starts_at: date(-5),
      expires_at: date(4),
      grace_until: date(6),
      limits: {
        seat_count: 20,
        storage_bytes: 2000000,
        api_requests_per_minute: 60,
      },
      modules: ["lms"],
    };
    const key = generateKeyPairSync("ed25519");
    async function enable(signedTerms) {
      await prepareAcademyInstallation(
        {
          envelope: signAcademyLicence(signedTerms, key.privateKey),
          publicKey: key.publicKey,
          expected: signedTerms,
        },
        sql,
      );
    }
    if (edition !== "internal") {
      await enable(terms);
      await sql(
        `select private.configure_academy_course_access(${q(installation)}, ${q(terms.release_commit)}, true)`,
      );
    }

    await sql(`
      insert into auth.users(id,email,email_confirmed_at) values
        ${[admin, client, learner, stranger].map((id) => `(${q(id)},${q(id + "@example.invalid")},now())`).join(",")};
      insert into public.user_roles(user_id,role) values
        (${q(admin)},'admin'), (${q(client)},'client'), (${q(learner)},'participant'), (${q(stranger)},'client');
      insert into public.organisations(id,name) values (${q(orgA)},'Sample school'), (${q(orgB)},'Other school');
      insert into public.client_organisation_memberships(user_id,organisation_id) values
        (${q(client)},${q(orgA)}), (${q(stranger)},${q(orgB)});
      insert into public.course_templates(id,title) values
        (${q(templateA)},'Semester I'), (${q(templateB)},'Semester II');
      insert into public.course_runs(id,template_id,organisation_id) values
        (${q(runA)},${q(templateA)},${q(orgA)}), (${q(runB)},${q(templateB)},${q(orgA)}), (${q(runC)},${q(templateA)},${q(orgB)});
      insert into private.company_participant_link_requests(id,organisation_id,requested_by,request_id,luminovia_user_id,target_user_id,status,expires_at)
        select ${q(link)},${q(orgA)},${q(admin)},${q(request)},luminovia_user_id,id,'accepted',now()+interval '1 day' from public.profiles where id=${q(learner)};
      insert into private.company_participant_memberships(organisation_id,user_id,status,link_request_id,invited_by,joined_at)
        values(${q(orgA)},${q(learner)},'active',${q(link)},${q(admin)},now());
      insert into public.course_enrolments(course_run_id,user_id,status,enrolled_by)
        values(${q(runA)},${q(learner)},'enrolled',${q(admin)});
    `);
    if (edition === "internal") {
      await sql(`insert into private.company_premium_settings(organisation_id,enabled) values(${q(orgA)},true),(${q(orgB)},true)
        on conflict(organisation_id) do update set enabled=true`);
    }

    const rpc = (who, name, args = "") =>
      actor(
        who,
        `set local request.method='POST'; set local request.path=${q("/rpc/" + name)};
        select public.require_portal_access(); select public.${name}(${args});`,
      );
    const read = (who, course) =>
      rpc(who, "course_class_options", q(course)).then((data) =>
        schema.parse(JSON.parse(data)),
      );
    const save = (who, course, selected, name, version) =>
      rpc(
        who,
        "set_course_class",
        [
          q(course),
          selected ? q(selected) : "null",
          name ? q(name) : "null",
          version,
        ].join(","),
      ).then((data) => schema.parse(JSON.parse(data)));

    assert.equal((await read(client, runA)).can_edit, true);
    assert.equal((await read(admin, runA)).current, null);
    await assert.rejects(read(stranger, runA), /42501/);
    await assert.rejects(save(learner, runA, null, "Not allowed", 0), /42501/);
    const created = (await save(client, runA, null, "  Foundation group  ", 0))
      .current;
    assert.equal(created.name, "Foundation group");
    assert.equal(
      (await save(admin, runA, null, "foundation group", 0)).version,
      1,
    );
    const grouped = await save(client, runB, created.id, null, 0);
    assert.deepEqual(grouped.courses, [
      { id: runA, title: "Semester I" },
      { id: runB, title: "Semester II" },
    ]);
    await assert.rejects(save(stranger, runC, created.id, null, 0), /42501/);
    await assert.rejects(
      save(admin, runA, null, "Stale reassignment", 0),
      /PT409/,
    );
    await assert.rejects(
      sql(`
      insert into private.course_class_assignments(course_id,organisation_id,class_id,version)
      values(${q(runC)},${q(orgB)},${q(created.id)},1)`),
      /23503/,
    );
    assert.equal((await read(learner, runA)).current.name, "Foundation group");
    assert.deepEqual((await read(learner, runA)).courses, []);
    assert.deepEqual((await read(learner, runA)).classes, []);
    await assert.rejects(read(learner, runB), /42501/);
    assert.equal(
      await sql("select count(*) from public.course_enrolments"),
      "1",
    );
    assert.equal(
      await sql(
        "select count(*) from public.audit_events where action = 'course.class.changed'",
      ),
      "2",
    );
    const missed = await Promise.allSettled([
      save(admin, runA, null, "New group 1", 1),
      save(client, runA, null, "New group 2", 1),
    ]);
    assert.equal(
      missed.filter(({ status }) => status === "fulfilled").length,
      1,
    );
    assert.equal(
      missed.filter(
        ({ status, reason }) =>
          status === "rejected" && /PT409/.test(reason.message),
      ).length,
      1,
    );
    const cleared = await save(admin, runB, null, null, 1);
    assert.equal(cleared.version, 2);
    assert.equal(cleared.current, null);
    await assert.rejects(
      actor(admin, "select * from private.course_classes"),
      /42501/,
    );
    await sql(
      `update public.client_organisation_memberships set removed_at=now() where user_id=${q(client)}`,
    );
    await assert.rejects(read(client, runA), /42501/);

    if (edition === "internal") {
      await sql(
        `update private.company_premium_settings set enabled=false where organisation_id=${q(orgA)}`,
      );
      await assert.rejects(read(admin, runA), /42501/);
    } else {
      await sql(`update private.installation_verified_licence set expires_at=now()-interval '1 hour'
        where installation_id=${q(installation)}`);
      assert.equal((await read(admin, runA)).can_edit, false);
      await assert.rejects(save(admin, runA, null, "Grace write", 2), /42501/);
      await assert.rejects(
        actor(
          admin,
          `select public.set_course_class(${q(runA)},null,'Direct write',2)`,
        ),
        /42501/,
      );
      await sql(
        `select private.configure_academy_course_access(${q(installation)}, ${q(terms.release_commit)}, false)`,
      );
      await assert.rejects(read(admin, runA), /42501/);
    }
    console.log(
      `PASS ${edition}: private class scope, multiple courses, stale writes, audit, no implicit enrolments, and current entitlements`,
    );
  });
}
