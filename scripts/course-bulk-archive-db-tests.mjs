/** Verify all-or-none archive and restore against the production RPC. */
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { z } from "zod";
import { academyOpenApi } from "../src/features/developer-api/academy-contract.ts";
import {
  configureAcademyCourseAccess,
  prepareAcademyInstallation,
} from "./academy-installation.mjs";
import { signAcademyLicence } from "./academy-licence.mjs";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

await withTestDatabase("course_bulk_archive", async ({ sql, actor }) => {
  const [manager, customer, company, template, first, second, session] =
    Array.from({ length: 7 }, randomUUID);
  await sql(`insert into auth.users(id,email,email_confirmed_at) values
    (${q(manager)},'bulk-manager@example.invalid',now()),
    (${q(customer)},'bulk-company@example.invalid',now());
    insert into public.user_roles(user_id,role) values
    (${q(manager)},'management'),(${q(customer)},'client');
    insert into public.organisations(id,name) values (${q(company)},'Fictional bulk company');
    insert into public.client_organisation_memberships(user_id,organisation_id)
    values (${q(customer)},${q(company)});
    insert into public.course_templates(id,title) values (${q(template)},'Fictional archive template');
    insert into public.course_runs(id,template_id,organisation_id,time_zone,published) values
    (${q(first)},${q(template)},${q(company)},'Europe/Berlin',true),
    (${q(second)},${q(template)},${q(company)},'Australia/Brisbane',false);
    insert into public.course_sessions(id,course_run_id,starts_at,ends_at) values
    (${q(session)},${q(first)},'2030-10-28 08:00:00+00','2030-10-28 16:00:00+00');`);
  const snapshot = async () =>
    JSON.parse(
      await sql(`
    select jsonb_agg(jsonb_build_object('id', id, 'published', published,
      'archived_at', archived_at, 'organisation_id', organisation_id) order by id)
    from public.course_runs where id in (${q(first)},${q(second)})`),
    );
  const apply = (who, items, archive) =>
    actor(
      who,
      `select public.archive_course_runs(${q(JSON.stringify(items))},${archive})`,
    );
  const initial = await snapshot();
  await assert.rejects(apply(customer, initial, true), /42501/);
  await assert.rejects(apply(manager, [initial[0], initial[0]], true), /22023/);
  await assert.rejects(
    apply(
      manager,
      [initial[0], { ...initial[1], published: !initial[1].published }],
      true,
    ),
    /PT409/,
  );
  assert.deepEqual(await snapshot(), initial);
  assert.equal(await apply(manager, initial, true), "2");
  const archived = await snapshot();
  assert.ok(archived.every(({ archived_at }) => archived_at));
  await assert.rejects(apply(manager, initial, true), /PT409/);
  assert.equal(await apply(manager, archived, false), "2");
  assert.deepEqual(await snapshot(), initial);
  assert.equal(
    await sql(`select count(*) from public.course_sessions where id=${q(session)}
    and starts_at='2030-10-28 08:00:00+00' and ends_at='2030-10-28 16:00:00+00'`),
    "1",
  );
  assert.equal(
    await sql(`select count(*) from public.audit_events
    where action='course.visibility.changed' and resource_id in (${q(first)},${q(second)})`),
    "4",
  );
  console.log(
    "PASS exact reviewed state, permissions, rollback and preserved publication and sessions",
  );
});

for (const edition of ["customer-self-hosted", "customer-managed"]) {
  await withTestDatabase("academy_course_archive", async ({ sql, actor }) => {
    const [
      installation,
      manager,
      client,
      learner,
      organisation,
      inactive,
      template,
      first,
      second,
      foreign,
      session,
    ] = Array.from({ length: 11 }, randomUUID);
    const now = Date.now();
    const date = (days) => new Date(now + days * 86_400_000).toISOString();
    const terms = {
      installation_id: installation,
      edition,
      release_commit: "bd".repeat(20),
      issued_at: date(-2),
      starts_at: date(-1),
      expires_at: date(2),
      grace_until: date(4),
      modules: [edition === "customer-self-hosted" ? "lms-standard" : "lms"],
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
    await sql(`insert into auth.users(id,email,email_confirmed_at) values
      ${[manager, client, learner].map((id) => `(${q(id)},${q(id + "@example.invalid")},now())`).join(",")};
      insert into public.user_roles(user_id,role) values
        (${q(manager)},'admin'),(${q(client)},'client'),(${q(learner)},'participant');
      insert into public.organisations(id,name,archived_at) values
        (${q(organisation)},'Local organisation',null),(${q(inactive)},'Archived organisation',now());
      insert into public.client_organisation_memberships(user_id,organisation_id)
        values (${q(client)},${q(organisation)});
      insert into public.course_templates(id,title) values (${q(template)},'Local course template');
      insert into public.course_runs(id,template_id,organisation_id,time_zone,published) values
        (${q(first)},${q(template)},${q(organisation)},'Europe/Berlin',true),
        (${q(second)},${q(template)},${q(organisation)},'Australia/Brisbane',false),
        (${q(foreign)},${q(template)},${q(inactive)},'Europe/Berlin',false);
      insert into public.course_sessions(id,course_run_id,starts_at,ends_at)
        values (${q(session)},${q(first)},'2030-10-28 08:00:00+00','2030-10-28 16:00:00+00');
      insert into public.course_enrolments(course_run_id,user_id,enrolled_by)
        values (${q(first)},${q(learner)},${q(manager)});`);
    const routes = academyOpenApi("https://fixture.example.invalid", {
      name: "Course Academy",
      edition,
      installationId: installation,
    }).paths;
    const response = (endpoint) =>
      z.fromJSONSchema(
        routes["/rest/v1/rpc/" + endpoint].post.responses["200"].content[
          "application/json"
        ].schema,
      );
    const archivePage = response("academy_course_archive_runs");
    const archiveCount = response("archive_course_runs");
    const invoke = (who, rpc, args, checkGate = true) =>
      actor(
        who,
        `
      set local request.method = 'POST'; set local request.path = ${q("/rpc/" + rpc)};
      ${checkGate ? "select public.require_portal_access();" : ""}
      select public.${rpc}(${args});`,
      );
    const page = async (who, archived, offset = 0, checkGate = true) =>
      archivePage.parse(
        JSON.parse(
          await invoke(
            who,
            "academy_course_archive_runs",
            [archived, offset].join(","),
            checkGate,
          ),
        ),
      );
    const states = ({ items }) =>
      items.map(({ id, published, archived_at, organisation_id }) => ({
        id,
        published,
        archived_at,
        organisation_id,
      }));
    const apply = async (who, items, archived, checkGate = true) => {
      const result = await invoke(
        who,
        "archive_course_runs",
        [q(JSON.stringify(items)), archived].join(","),
        checkGate,
      );
      assert.equal(archiveCount.parse(Number(result)), Number(result));
      return result;
    };
    const initialPage = await page(manager, false);
    const initial = states(initialPage);
    assert.deepEqual(
      new Set(initial.map(({ id }) => id)),
      new Set([first, second]),
    );
    assert.deepEqual(await page(manager, true), { items: [], has_more: false });
    assert.deepEqual(await page(manager, false, 50), {
      items: [],
      has_more: false,
    });
    await assert.rejects(page(client, false), /42501/);
    await assert.rejects(page(learner, false), /42501/);
    await assert.rejects(apply(client, initial, true), /42501/);
    await assert.rejects(
      apply(
        manager,
        [
          initial[0],
          {
            ...initial[1],
            id: foreign,
            published: false,
            organisation_id: inactive,
          },
        ],
        true,
      ),
      /42501/,
    );
    await assert.rejects(
      apply(
        manager,
        [initial[0], { ...initial[1], published: !initial[1].published }],
        true,
      ),
      /PT409/,
    );
    assert.deepEqual(await page(manager, false), initialPage);
    assert.equal(await apply(manager, initial, true), "2");
    assert.deepEqual(await page(manager, false), {
      items: [],
      has_more: false,
    });

    const archivedPage = await page(manager, true);
    const archived = states(archivedPage);
    assert.ok(archived.every((run) => run.archived_at));
    assert.deepEqual(
      archived.map((run) => ({ ...run, archived_at: null })),
      initial,
    );
    await sql(`update private.installation_verified_licence set expires_at=${q(date(-0.2))}
      where installation_id=${q(installation)}`);
    assert.deepEqual(await page(manager, true), archivedPage);
    await assert.rejects(apply(manager, archived, false), /42501/);
    await assert.rejects(apply(manager, archived, false, false), /42501/);
    await sql(`update private.installation_verified_licence set grace_until=${q(date(-0.1))}
      where installation_id=${q(installation)}`);
    await assert.rejects(page(manager, true), /42501/);
    await assert.rejects(page(manager, true, 0, false), /42501/);
    await assert.rejects(apply(manager, archived, false), /42501/);
    await sql(`update private.installation_verified_licence
      set expires_at=${q(terms.expires_at)}, grace_until=${q(terms.grace_until)}
      where installation_id=${q(installation)}`);
    assert.equal(await apply(manager, archived, false), "2");
    assert.deepEqual(await page(manager, false), initialPage);
    assert.equal(
      await sql(`select count(*) from public.course_sessions where id=${q(session)}
        and starts_at='2030-10-28 08:00:00+00' and ends_at='2030-10-28 16:00:00+00'`),
      "1",
    );
    assert.equal(
      await sql(`select count(*) from public.course_enrolments where course_run_id=${q(first)}
        and user_id=${q(learner)} and status='enrolled'`),
      "1",
    );
    console.log(
      `PASS ${edition}: local course archive, restore, learner exclusion, and licence boundaries`,
    );
  });
}
