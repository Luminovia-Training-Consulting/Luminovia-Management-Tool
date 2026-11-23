/** Drive the Academy integration handler over loopback HTTP into migrated PostgreSQL. */
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtempDisposable, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
import { z } from "zod";
import { academyOpenApi } from "../src/features/developer-api/academy-contract.ts";
import { createCompanyIntegrationHandler } from "../supabase/functions/company-integration/handler.ts";
import { academyClientAssets } from "./academy-client-assets.mjs";
import {
  configureAcademyCourseAccess,
  prepareAcademyInstallation,
} from "./academy-installation.mjs";
import { signAcademyLicence } from "./academy-licence.mjs";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

const indexPath = "/functions/v1/company-integration";
const legacyOpenApi = JSON.parse(
  gunzipSync(
    await readFile(
      new URL(
        "./testing/fixtures/academy-openapi-1.36.0.json.gz",
        import.meta.url,
      ),
    ),
  ).toString("utf8"),
);

async function loadGeneratedClient(directory, name, document) {
  const path = join(directory, name + ".ts");
  await writeFile(path, academyClientAssets(document).get("api/client.ts"));
  return import(pathToFileURL(path).href);
}

for (const edition of ["customer-managed", "customer-self-hosted"]) {
  await withTestDatabase("academy_course_index", async ({ actor, sql }) => {
    const [
      admin,
      manager,
      org,
      foreign,
      template,
      first,
      second,
      third,
      nextPublished,
      learner,
    ] = Array.from({ length: 10 }, randomUUID);
    const now = Date.now();
    const date = (days) => new Date(now + days * 86_400_000).toISOString();
    const terms = {
      installation_id: randomUUID(),
      edition,
      release_commit: "5d".repeat(20),
      issued_at: date(-3),
      starts_at: date(-2),
      expires_at: date(4),
      grace_until: date(6),
      modules: ["lms"],
      limits: {
        seat_count: 10,
        storage_bytes: 1_000_000,
        api_requests_per_minute: 100,
      },
    };
    async function contractResponse(
      relativePath,
      method,
      response,
      status,
      contract = document,
    ) {
      assert.equal(response.status, status);
      const schema =
        contract.paths[relativePath][method].responses[status].content[
          "application/json"
        ].schema;
      return z.fromJSONSchema(schema).parse(await response.json());
    }
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const setup = {
      envelope: signAcademyLicence(terms, privateKey),
      publicKey,
      expected: terms,
      now,
    };
    await prepareAcademyInstallation(setup, sql);
    await configureAcademyCourseAccess({ ...setup, enabled: true }, sql);
    await sql(`
      insert into auth.users(id,email,email_confirmed_at) values
        (${q(admin)},'fictional-index-admin@example.invalid',now()),
        (${q(manager)},'fictional-index-manager@example.invalid',now()),
        (${q(learner)},'fictional-index-learner@example.invalid',now());
      insert into public.user_roles(user_id,role) values
        (${q(admin)},'admin'),(${q(manager)},'management'),(${q(learner)},'participant');
      insert into public.organisations(id,name) values
        (${q(org)},'Fictional training organisation'),(${q(foreign)},'Different training organisation');
      insert into public.course_templates(id,title) values(${q(template)},'Published training');
      insert into public.course_runs(id,template_id,organisation_id,published,time_zone) values
        (${q(first)},${q(template)},${q(org)},true,'UTC'),
        (${q(second)},${q(template)},${q(org)},false,'UTC'),
        (${q(third)},${q(template)},${q(foreign)},true,'UTC'),
        (${q(nextPublished)},${q(template)},${q(org)},true,'UTC');
    `);
    const gateway = (name, verb = "POST", profile = "public") =>
      `set local request.path=${q("/rpc/" + name)}; set local request.method=${q(verb)};
       set local request.headers=${q(JSON.stringify({ "content-profile": profile }))};
       select public.require_portal_access();`;
    const call = async (who, name, params) =>
      JSON.parse(
        await actor(who, gateway(name) + `select public.${name}(${params});`),
      );
    const listKeys = (who) => call(who, "company_integration_keys", q(org));
    const issue = (who, key = null, version = null, company = org) =>
      call(
        who,
        "issue_company_integration_key",
        `${q(company)},'External course index',${q(date(3))},${key ? q(key) : "null"},${version ?? "null"}`,
      );
    const dispatch = async ({ p_id, p_secret_hash, p_limit, p_after }) =>
      JSON.parse(
        await sql(`begin; set local role service_role;
        ${gateway("integration_course_index")}
        select public.integration_course_index(${q(p_id)},${q(p_secret_hash)},${p_limit},${p_after ? q(p_after) : "null"}); commit;`),
      );
    const handler = createCompanyIntegrationHandler(dispatch, async (args) =>
      JSON.parse(
        await sql(`begin; set local role service_role;
        ${gateway("integration_course_operation")}
        select public.integration_course_operation(
          ${q(args.p_id)},${q(args.p_secret_hash)},${q(args.p_action)},${q(args.p_course_id)},
          ${args.p_participant_id ? q(args.p_participant_id) : "null"}); commit;`),
      ),
    );
    await using server = createServer(async (incoming, outgoing) => {
      try {
        const request = new Request(base + incoming.url, {
          headers: incoming.headers,
          method: incoming.method,
          ...(incoming.method === "POST"
            ? { body: Readable.toWeb(incoming), duplex: "half" }
            : {}),
        });
        const response = await handler(request);
        outgoing.writeHead(
          response.status,
          Object.fromEntries(response.headers),
        );
        outgoing.end(Buffer.from(await response.arrayBuffer()));
      } catch {
        outgoing.writeHead(500).end();
      }
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const base = `http://127.0.0.1:${server.address().port}`;
    const document = academyOpenApi(base, {
      name: "Fictional integration Academy",
      installationId: terms.installation_id,
      edition,
    });
    await using directory = await mkdtempDisposable(
      join(tmpdir(), "academy-index-http-"),
    );
    const client = await loadGeneratedClient(
      directory.path,
      "current",
      document,
    );
    const legacy = await loadGeneratedClient(directory.path, "legacy", {
      ...legacyOpenApi,
      servers: document.servers,
      "x-portal-installation": document["x-portal-installation"],
    });
    const request = (integrationKey, query, sender = client) =>
      sender.request("integrationCourseIndex", {
        credentials: { integrationKey },
        query,
      });
    const rawRequest = (path, credential, init) =>
      fetch(base + path, {
        ...init,
        headers: { Authorization: "Bearer " + credential, ...init?.headers },
      });

    await assert.rejects(listKeys(manager), /42501/);
    await assert.rejects(issue(manager), /42501/);
    await assert.rejects(
      call(
        admin,
        "issue_company_integration_key",
        `${q(org)},'No expiry on internal installs only',null,null,null`,
      ),
      /22023/,
    );
    await assert.rejects(
      actor(admin, gateway("integration_course_index")),
      /42501/,
    );
    await assert.rejects(
      sql(`begin;set local role service_role;
      ${gateway("integration_course_index", "POST", "private")} commit;`),
      /42501/,
    );

    const webhook = await call(
      admin,
      "academy_subscribe_course_webhook",
      `${q(org)},'reviewed-callback'`,
    );
    assert.deepEqual(await listKeys(admin), []);
    const webhookKeyId = await sql(
      `select integration_id from private.company_course_webhooks where id=${q(webhook.id)}`,
    );
    await assert.rejects(
      actor(
        admin,
        `select public.revoke_company_integration_key(${q(webhookKeyId)},1)`,
      ),
      /PT409/,
    );
    const created = await issue(admin);
    assert.equal((await listKeys(admin)).length, 1);
    assert.equal(
      Object.hasOwn((await listKeys(admin))[0], "credential"),
      false,
    );
    const [pageOne, pageTwo] = [first, nextPublished].sort();
    const row = (id) => ({ id, title: "Published training", time_zone: "UTC" });
    const firstPage = await contractResponse(
      indexPath,
      "get",
      await request(created.credential, { limit: 1 }),
      200,
    );
    assert.deepEqual(firstPage, {
      items: [row(pageOne)],
      next_cursor: pageOne,
    });
    const secondPage = await contractResponse(
      indexPath,
      "get",
      await request(created.credential, {
        after: firstPage.next_cursor,
        limit: 1,
      }),
      200,
    );
    assert.deepEqual(secondPage, { items: [row(pageTwo)], next_cursor: null });
    assert.deepEqual(
      await contractResponse(
        indexPath,
        "get",
        await request(created.credential, { limit: 1 }, legacy),
        200,
        legacyOpenApi,
      ),
      firstPage,
    );
    assert.deepEqual(
      await contractResponse(
        indexPath,
        "get",
        await request(created.credential, { after: pageTwo }),
        200,
      ),
      { items: [], next_cursor: null },
    );
    for (const query of [
      "?limit=51",
      "?limit=1&limit=2",
      "?after=invalid",
      "?page=2",
    ]) {
      await contractResponse(
        indexPath,
        "get",
        await rawRequest(indexPath + query, created.credential),
        400,
      );
    }
    const wrongMethod = await rawRequest(indexPath, created.credential, {
      method: "DELETE",
    });
    assert.equal(wrongMethod.headers.get("Allow"), "GET");
    await contractResponse(indexPath, "get", wrongMethod, 405);
    await contractResponse(
      indexPath,
      "get",
      await rawRequest(indexPath, created.credential, {
        headers: { Origin: base },
      }),
      403,
    );
    await contractResponse(
      indexPath,
      "get",
      await request("lvi_" + webhookKeyId + "_" + webhook.signing_secret),
      401,
    );
    await assert.rejects(issue(admin, created.id, 1, foreign), /PT409/);
    const rotation = await Promise.allSettled([
      issue(admin, created.id, 1),
      issue(admin, created.id, 1),
    ]);
    const acceptedRotation = rotation.filter(
      ({ status }) => status === "fulfilled",
    );
    const refusedRotation = rotation.filter(
      ({ status }) => status === "rejected",
    );
    assert.equal(acceptedRotation.length, 1);
    assert.equal(refusedRotation.length, 1);
    assert.match(refusedRotation[0].reason.message, /PT409/);
    const rotated = acceptedRotation[0].value;
    assert.equal(rotated.version, 2);
    await contractResponse(
      indexPath,
      "get",
      await request(created.credential),
      401,
    );
    await contractResponse(
      indexPath,
      "get",
      await request(rotated.credential),
      200,
    );
    const limited = await issue(admin);
    // Place the owned fixture just below its current per-key minute quota. Parallel
    // HTTP requests still authenticate, acquire the database lock and consume it.
    await sql(`update private.company_integration_keys
      set window_started_at=clock_timestamp(),window_requests=58 where id=${q(limited.id)}`);
    const batch = await Promise.all(
      Array.from({ length: 4 }, () => request(limited.credential)),
    );
    assert.deepEqual(
      batch.map(({ status }) => status).sort(),
      [200, 200, 429, 429],
    );
    for (const response of batch) {
      if (response.status === 429)
        assert.equal(response.headers.get("Retry-After"), "60");
      assert.equal(response.headers.get("Cache-Control"), "no-store");
      await contractResponse(indexPath, "get", response, response.status);
    }
    assert.equal(
      await sql(`select window_requests from private.company_integration_keys
      where id=${q(limited.id)}`),
      "60",
    );
    await sql(`update private.company_integration_keys
      set window_started_at=clock_timestamp()-interval '61 seconds' where id=${q(limited.id)}`);
    await contractResponse(
      indexPath,
      "get",
      await request(limited.credential),
      200,
    );
    await actor(
      admin,
      gateway("revoke_company_integration_key") +
        `select public.revoke_company_integration_key(${q(limited.id)},1);`,
    );
    await contractResponse(
      indexPath,
      "get",
      await request(limited.credential),
      401,
    );
    const issueScope = (scope) =>
      call(
        admin,
        "issue_scoped_company_integration_key",
        `${q(org)},'Fictional scoped client',${q(date(3))},null,null,${q(scope)}`,
      );
    const writer = await issueScope("enrolments.write");
    const reader = await issueScope("reports.read");
    assert.equal(
      (await listKeys(admin)).filter(({ id }) => id !== limited.id).length,
      3,
    );
    const participant = await sql(
      `select luminovia_user_id from public.profiles where id=${q(learner)}`,
    );
    const enrol = (key, course = first, sender = client) =>
      sender.request("integrationEnrolParticipant", {
        credentials: { integrationKey: key.credential },
        body: { course_id: course, participant_id: participant },
      });
    const report = (key, course = first, sender = client) =>
      sender.request("integrationCourseParticipation", {
        credentials: { integrationKey: key.credential },
        query: { course_id: course },
      });
    const enrolmentsPath = indexPath + "/enrolments";
    const reportPath = indexPath + "/participation";
    await contractResponse(enrolmentsPath, "post", await enrol(reader), 401);
    await contractResponse(enrolmentsPath, "post", await enrol(writer), 404);
    await contractResponse(reportPath, "get", await report(reader, third), 404);
    await contractResponse(
      reportPath,
      "get",
      await report(reader, second),
      404,
    );
    await sql(`
      with accepted as (
        insert into private.company_participant_link_requests(
          organisation_id,requested_by,request_id,luminovia_user_id,target_user_id,status,expires_at
        ) values (${q(org)},${q(admin)},gen_random_uuid(),${q(participant)},${q(learner)},'accepted',now()+interval '1 day')
        returning id
      )
      insert into private.company_participant_memberships(organisation_id,user_id,status,link_request_id,invited_by,joined_at)
      select ${q(org)},${q(learner)},'active',id,${q(admin)},now() from accepted;`);
    // Two separate writer keys must still serialize one enrolment for the course.
    const legacyWriter = await issueScope("enrolments.write");
    const [currentReply, legacyReply] = await Promise.all([
      enrol(writer),
      enrol(legacyWriter, first, legacy),
    ]);
    const [receipt, repeated] = await Promise.all([
      contractResponse(enrolmentsPath, "post", currentReply, 200),
      contractResponse(enrolmentsPath, "post", legacyReply, 200, legacyOpenApi),
    ]);
    assert.deepEqual(receipt, {
      course_id: first,
      participant_id: participant,
      status: "enrolled",
    });
    assert.deepEqual(repeated, receipt);
    assert.deepEqual(
      await contractResponse(enrolmentsPath, "post", await enrol(writer), 200),
      receipt,
    );
    assert.equal(
      await sql(`select count(*) from public.course_enrolments
      where course_run_id=${q(first)} and user_id=${q(learner)}`),
      "1",
    );
    assert.equal(
      await sql(`select count(*) from public.audit_events
      where action='course.enrolment.changed' and resource_id=${q(first)}
        and details->>'integration_key_id' in (${q(writer.id)},${q(legacyWriter.id)})`),
      "1",
    );
    assert.deepEqual(
      await contractResponse(
        reportPath,
        "get",
        await report(reader, first, legacy),
        200,
        legacyOpenApi,
      ),
      {
        course_id: first,
        session_count: 0,
        enrolled_count: 1,
        completed_count: 0,
      },
    );
    await actor(
      admin,
      gateway("manage_course_enrolment") +
        `select public.manage_course_enrolment(${q(first)},${q(learner)},'removed');`,
    );
    await contractResponse(enrolmentsPath, "post", await enrol(writer), 409);
    assert.equal(
      await sql(`select status from public.course_enrolments
      where course_run_id=${q(first)} and user_id=${q(learner)}`),
      "removed",
    );
    await assert.rejects(
      actor(admin, gateway("integration_course_operation")),
      /42501/,
    );
    await configureAcademyCourseAccess({ ...setup, enabled: false }, sql);
    await contractResponse(
      indexPath,
      "get",
      await request(rotated.credential),
      401,
    );
    await contractResponse(reportPath, "get", await report(reader), 401);
    await contractResponse(enrolmentsPath, "post", await enrol(writer), 401);
    await configureAcademyCourseAccess({ ...setup, enabled: true }, sql);
    await contractResponse(
      indexPath,
      "get",
      await request(rotated.credential),
      200,
    );
    await sql(
      `delete from public.user_roles where user_id=${q(admin)} and role='admin'`,
    );
    await contractResponse(
      indexPath,
      "get",
      await request(rotated.credential),
      401,
    );
    await contractResponse(reportPath, "get", await report(reader), 401);
    await contractResponse(enrolmentsPath, "post", await enrol(writer), 401);
    console.log(
      `PASS ${edition} loopback HTTP and native PostgreSQL: current and 1.36 clients, scoped pagination, schemas, quota, concurrent key rotation and enrolment, no replay after removal, disabled profile, issuer role loss, and exact service boundary`,
    );
  });
}
