/** Test the public request handler against the dedicated backend's real transaction and grants. */
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { createCompanyIntegrationHandler } from "../supabase/functions/company-integration/handler.ts";
import {
  configureAcademyCourseAccess,
  prepareAcademyInstallation,
} from "./academy-installation.mjs";
import { signAcademyLicence } from "./academy-licence.mjs";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

for (const edition of ["customer-managed", "customer-self-hosted"]) {
  await withTestDatabase("academy_course_index", async ({ actor, sql }) => {
    const [admin, manager, org, foreign, template, first, second, third] =
      Array.from({ length: 8 }, randomUUID);
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
        (${q(manager)},'fictional-index-manager@example.invalid',now());
      insert into public.user_roles(user_id,role) values (${q(admin)},'admin'),(${q(manager)},'management');
      insert into public.organisations(id,name) values
        (${q(org)},'Fictional training organisation'),(${q(foreign)},'Different training organisation');
      insert into public.course_templates(id,title) values(${q(template)},'Published training');
      insert into public.course_runs(id,template_id,organisation_id,published,time_zone) values
        (${q(first)},${q(template)},${q(org)},true,'UTC'),
        (${q(second)},${q(template)},${q(org)},false,'UTC'),
        (${q(third)},${q(template)},${q(foreign)},true,'UTC');
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
    const handler = createCompanyIntegrationHandler(dispatch);
    const request = (credential, query = "") =>
      handler(
        new Request(
          "https://academy.example.invalid/functions/v1/company-integration" +
            query,
          { headers: { Authorization: "Bearer " + credential } },
        ),
      );

    await assert.rejects(listKeys(manager), /42501/);
    await assert.rejects(issue(manager), /42501/);
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
    const result = await request(created.credential, "?limit=1");
    assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), {
      items: [{ id: first, title: "Published training", time_zone: "UTC" }],
      next_cursor: null,
    });
    assert.equal((await request(created.credential, "?limit=500")).status, 400);
    assert.equal(
      (await request("lvi_" + webhookKeyId + "_" + webhook.signing_secret))
        .status,
      401,
    );
    await assert.rejects(issue(admin, created.id, 1, foreign), /PT409/);
    const rotated = await issue(admin, created.id, 1);
    assert.equal(rotated.version, 2);
    assert.equal((await request(created.credential)).status, 401);
    await assert.rejects(issue(admin, created.id, 1), /PT409/);
    assert.equal((await request(rotated.credential)).status, 200);
    await sql(
      `delete from public.user_roles where user_id=${q(admin)} and role='admin'`,
    );
    assert.equal((await request(rotated.credential)).status, 401);
    console.log(
      `PASS ${edition} organisation course index, administration, exact service boundary, one-time rotation and issuer role loss`,
    );
  });
}
