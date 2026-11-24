import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { portalOpenApi } from "../src/features/developer-api/contract.ts";
import { z } from "zod";
import { prepareAcademyInstallation } from "./academy-installation.mjs";
import { signAcademyLicence } from "./academy-licence.mjs";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

const editions = ["internal", "customer-self-hosted", "customer-managed"];
const selected = process.env.PORTAL_COURSE_SERIES_EDITION;
if (selected) assert.ok(editions.includes(selected));
const instant = (days, hours = 0) =>
  new Date(Date.now() + (days * 24 + hours) * 3600000).toISOString();

for (const edition of selected ? [selected] : editions) {
  await withTestDatabase("course_series", async ({ sql, actor }) => {
    const [
      installation,
      admin,
      company,
      outsider,
      participant,
      org,
      otherOrg,
      template,
      otherTemplate,
      a,
      b,
      foreign,
    ] = Array.from({ length: 12 }, randomUUID);
    const internal = edition === "internal";
    const api = portalOpenApi("https://academy.example.invalid/backend", true, {
      name: "Practice Academy",
      edition,
      installationId: installation,
    });
    const response = (endpoint, method) =>
      z.fromJSONSchema(
        api.paths[`/rest/v1/rpc/${endpoint}`][method].responses["200"].content[
          "application/json"
        ].schema,
      );
    const request = z.fromJSONSchema(
      api.paths["/rest/v1/rpc/plan_course_series"].post.requestBody.content[
        "application/json"
      ].schema,
    );
    if (!internal) {
      const terms = {
        installation_id: installation,
        edition,
        release_commit: "ae".repeat(20),
        issued_at: instant(-2),
        starts_at: instant(-1),
        expires_at: instant(4),
        grace_until: instant(8),
        limits: {
          seat_count: 20,
          storage_bytes: 2000000,
          api_requests_per_minute: 60,
        },
        modules: ["lms"],
      };
      const key = generateKeyPairSync("ed25519");
      await prepareAcademyInstallation(
        {
          envelope: signAcademyLicence(terms, key.privateKey),
          publicKey: key.publicKey,
          expected: terms,
        },
        sql,
      );
      await sql(
        `select private.configure_academy_course_access(${q(installation)}, ${q(terms.release_commit)}, true)`,
      );
    }
    await sql(`insert into auth.users(id,email,email_confirmed_at) values ${[admin, company, outsider, participant].map((id) => `(${q(id)},${q(id + "@example.invalid")},now())`).join(",")};
      insert into public.user_roles(user_id,role) values (${q(admin)},'admin'), (${q(company)},'client'), (${q(outsider)},'client'), (${q(participant)},'participant');
      insert into public.organisations(id,name) values (${q(org)},'Fictional Training'), (${q(otherOrg)},'Other Fictional Training');
      insert into public.client_organisation_memberships(user_id,organisation_id) values (${q(company)},${q(org)}), (${q(outsider)},${q(otherOrg)});
      insert into public.course_templates(id,title,owner_organisation_id) values
        (${q(template)},'Fictional course',${q(org)}), (${q(otherTemplate)},'Other fictional course',${q(otherOrg)});
      insert into private.course_classes(id,organisation_id,name) values
        (${q(a)},${q(org)},'Class A'), (${q(b)},${q(org)},'Class B'), (${q(foreign)},${q(otherOrg)},'Foreign class');`);

    const invoke = (who, endpoint, args, method = "POST") =>
      actor(
        who,
        `set local request.method=${q(method)}; set local request.path=${q("/rpc/" + endpoint)};
      select public.require_portal_access(); select public.${endpoint}(${args});`,
      );
    const classes = async (who) =>
      response("course_series_classes", "get").parse(
        JSON.parse(await invoke(who, "course_series_classes", q(org), "GET")),
      );
    const starts = instant(12);
    const ends = new Date(Date.parse(starts) + 3600000).toISOString();
    const run = (classId, venue, starts_at = starts, ends_at = ends) => ({
      delivery_type: "onsite",
      class_id: classId,
      venue,
      sessions: [{ starts_at, ends_at }],
    });
    const valid = [run(a, "Room A"), run(b, "Room B")];
    const plan = async (
      who,
      runs = valid,
      id = null,
      chosenTemplate = template,
    ) => {
      request.parse({
        p_organisation_id: org,
        p_template_id: chosenTemplate,
        p_time_zone: "Europe/Berlin",
        p_runs: runs,
        p_request_id: id,
      });
      return response("plan_course_series", "post").parse(
        JSON.parse(
          await invoke(
            who,
            "plan_course_series",
            [
              q(org),
              q(chosenTemplate),
              q("Europe/Berlin"),
              q(JSON.stringify(runs)),
              id ? q(id) : "null",
            ].join(","),
          ),
        ),
      );
    };
    const planner = internal ? company : admin;
    assert.deepEqual(await classes(planner), [
      { id: a, name: "Class A" },
      { id: b, name: "Class B" },
    ]);
    await assert.rejects(classes(outsider), /42501/);
    await assert.rejects(plan(participant), /42501/);
    await assert.rejects(plan(outsider), /42501/);
    await assert.rejects(plan(planner, valid, null, otherTemplate), /42501/);
    await assert.rejects(
      plan(planner, [valid[0], run(foreign, "Other")]),
      /42501/,
    );
    assert.deepEqual(await plan(planner), { run_ids: [], conflicts: [] });
    assert.deepEqual(
      (await plan(planner, [valid[0], run(a, "Room C")])).conflicts,
      [1, 2].map((run_no) => ({ run_no, session_no: 1, reason: "class" })),
    );
    assert.deepEqual(
      (await plan(planner, [valid[0], run(b, " room a ")])).conflicts,
      [1, 2].map((run_no) => ({ run_no, session_no: 1, reason: "room" })),
    );
    assert.equal(
      (
        await plan(planner, [
          {
            ...valid[0],
            sessions: [...valid[0].sessions, ...valid[0].sessions],
          },
          valid[1],
        ])
      ).conflicts.length,
      2,
    );
    assert.equal(await sql("select count(*) from public.course_runs"), "0");

    const id = randomUUID();
    const [first, retry] = await Promise.all([
      plan(planner, valid, id),
      plan(planner, valid, id),
    ]);
    assert.equal(first.run_ids.length, 2);
    assert.deepEqual(retry, first);
    assert.equal(
      await sql(
        "select count(*) from public.course_runs where not published and archived_at is null",
      ),
      "2",
    );
    assert.equal(
      await sql("select count(*) from private.course_class_assignments"),
      "2",
    );
    assert.equal(
      await sql("select count(*) from public.course_enrolments"),
      "0",
    );
    await assert.rejects(
      plan(planner, [valid[0], run(b, "Room C")], id),
      /PT409/,
    );
    const lateConflict = await plan(planner, valid, randomUUID());
    assert.deepEqual(
      lateConflict.conflicts,
      [1, 2].map((run_no) => ({ run_no, session_no: 1, reason: "class" })),
    );
    assert.deepEqual(lateConflict.run_ids, []);
    assert.equal(await sql("select count(*) from public.course_runs"), "2");
    const extra = [run(null, "Room D"), run(null, "Room E")];
    const approvals = await Promise.all([
      plan(planner, extra, randomUUID()),
      plan(planner, extra, randomUUID()),
    ]);
    assert.deepEqual(
      approvals.map((item) => item.run_ids.length).sort(),
      [0, 2],
    );
    assert.equal(await sql("select count(*) from public.course_runs"), "4");
    console.log(
      `PASS ${edition}: organisation, role and class scope, exact conflict previews, atomic retry and contested writes`,
    );
  });
}
