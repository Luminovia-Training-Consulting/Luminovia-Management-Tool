/** Tests issued scopes, retained-data boundaries and revocation on a fresh SQL replay. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { portalOpenApi } from "../src/features/developer-api/contract.ts";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

const paths = portalOpenApi("https://portal.example.invalid").paths;

function assertResponse(name, value) {
  const schema =
    paths[`/rest/v1/rpc/${name}`].post.responses["200"].content[
      "application/json"
    ].schema;
  const result = z.fromJSONSchema(schema).safeParse(value);
  assert.ok(result.success, `${name} differs from its OpenAPI response schema`);
}

await withTestDatabase("company_integrations", async ({ sql, actor }) => {
  const [
    admin,
    staff,
    client,
    outsider,
    a,
    b,
    template,
    courseA,
    courseA2,
    courseB,
    unpublished,
    archived,
  ] = Array.from({ length: 12 }, randomUUID);
  await sql(`
        insert into auth.users(id,email,email_confirmed_at) values
          (${q(admin)},'admin@example.invalid',now()),(${q(staff)},'staff@example.invalid',now()),
          (${q(client)},'company@example.invalid',now()),(${q(outsider)},'outsider@example.invalid',now());
        insert into public.user_roles(user_id,role) values
          (${q(admin)},'admin'),(${q(staff)},'management'),(${q(client)},'client'),(${q(outsider)},'lecturer');
        insert into public.organisations(id,name) values (${q(a)},'Fictional A'),(${q(b)},'Fictional B');
        insert into public.client_organisation_memberships(user_id,organisation_id) values(${q(client)},${q(a)});
        insert into public.course_templates(id,title,description) values
          (${q(template)},'Fictional title','Fictional restricted description');
        insert into public.course_runs(id,template_id,organisation_id,published,archived_at) values
          (${q(courseA)},${q(template)},${q(a)},true,null),
          (${q(courseA2)},${q(template)},${q(a)},true,null),
          (${q(courseB)},${q(template)},${q(b)},true,null),
          (${q(unpublished)},${q(template)},${q(a)},false,null),
          (${q(archived)},${q(template)},${q(a)},true,now());
    `);
  const gateway = (rpc) => `set local request.path=${q("/rpc/" + rpc)};
    set local request.method='POST'; select public.require_portal_access();`;
  const issue = (
    who = admin,
    organisation = a,
    reference = null,
    version = null,
    expiry = "now()+interval '30 days'",
  ) =>
    actor(
      who,
      gateway("issue_company_integration_key") +
        `select public.issue_company_integration_key(${q(organisation)},'Fictional integration',
            ${expiry},${reference === null ? "null" : q(reference)},${version})`,
    );
  const list = (who = admin, organisation = a) =>
    actor(
      who,
      gateway("company_integration_keys") +
        `select public.company_integration_keys(${q(organisation)})`,
    );
  const revoke = (who, key) =>
    actor(
      who,
      gateway("revoke_company_integration_key") +
        `select public.revoke_company_integration_key(${q(key.id)},${key.version})`,
    );
  const lookup = (record, limit = 50, next = null) =>
    `select public.integration_course_index(${q(record.id)},${q(createHash("sha256").update(record.credential.split("_")[2]).digest("hex"))},${limit},${next === null ? "null" : q(next)})`;
  const read = async (...request) =>
    JSON.parse(await sql(`set role service_role; ${lookup(...request)}`));

  await assert.rejects(issue(outsider), /42501/);
  await assert.rejects(list(outsider), /42501/);
  await assert.rejects(list(client, b), /42501/);
  await assert.rejects(issue(client, b), /42501/);
  assert.deepEqual(JSON.parse(await list(staff)), []);
  assert.deepEqual(JSON.parse(await list(client)), []);
  assertResponse("company_integration_keys", JSON.parse(await list()));
  const original = JSON.parse(await issue());
  assertResponse("issue_company_integration_key", original);
  assert.match(original.credential, /^lvi_[0-9a-f-]{36}_[a-f0-9]{64}$/);
  await assert.rejects(actor(admin, lookup(original)), /42501/);
  await assert.rejects(
    sql(
      `set role service_role; select secret_hash from private.company_integration_keys`,
    ),
    /42501/,
  );
  const keyList = JSON.parse(await list());
  assertResponse("company_integration_keys", keyList);
  assert.equal(keyList.length, 1);
  assert.equal(keyList[0].label, "Fictional integration");
  assert.equal(Object.hasOwn(keyList[0], "secret_hash"), false);
  assert.equal(Object.hasOwn(keyList[0], "credential"), false);
  assert.equal(keyList[0].last_used_at, null);
  assert.equal(keyList[0].webhook_eligible, true);

  const page1 = await read(original, 1);
  assert.equal(page1.status, "ok");
  assert.equal(page1.items.length, 1);
  assert.equal(page1.next_cursor, page1.items[0].id);
  const page2 = await read(original, 1, page1.next_cursor);
  assert.equal(page2.next_cursor, null);
  assert.deepEqual(
    [page1.items[0].id, page2.items[0].id].sort(),
    [courseA, courseA2].sort(),
  );
  assert.deepEqual(Object.keys(page1.items[0]).sort(), [
    "id",
    "time_zone",
    "title",
  ]);
  assert.equal(Boolean(JSON.parse(await list())[0].last_used_at), true);
  assert.deepEqual(
    await read({
      ...original,
      credential: `lvi_${original.id}_${"f".repeat(64)}`,
    }),
    { status: "denied" },
  );

  await assert.rejects(issue(admin, b, original.id, 1), /PT409/);
  const rotated = JSON.parse(await issue(admin, a, original.id, 1));
  assertResponse("issue_company_integration_key", rotated);
  await assert.rejects(issue(admin, a, original.id, 1), /PT409/);
  assert.equal(rotated.version, 2);
  assert.deepEqual(await read(original), { status: "denied" });
  assert.equal((await read(rotated)).status, "ok");
  await assert.rejects(
    actor(
      admin,
      `select public.revoke_company_integration_key(${q(original.id)},1)`,
    ),
    /PT409/,
  );

  await sql(`update private.company_integration_keys set window_requests=60,window_started_at=clock_timestamp()
        where id=${q(rotated.id)}`);
  assert.deepEqual(await read(rotated), { status: "rate_limited" });
  await sql(`update private.company_integration_keys set window_started_at=clock_timestamp()-interval '2 minutes'
        where id=${q(rotated.id)}`);
  assert.equal((await read(rotated)).status, "ok");
  await actor(
    admin,
    `select public.revoke_company_integration_key(${q(rotated.id)},2)`,
  );
  await assert.rejects(
    actor(
      admin,
      `select public.revoke_company_integration_key(${q(rotated.id)},2)`,
    ),
    /PT409/,
  );
  assertResponse("company_integration_keys", JSON.parse(await list()));
  assert.deepEqual(await read(rotated), { status: "denied" });

  const expiring = JSON.parse(await issue());
  await sql(
    `update private.company_integration_keys set expires_at=now()-interval '1 second' where id=${q(expiring.id)}`,
  );
  assert.deepEqual(await read(expiring), { status: "denied" });
  const archivedCompany = JSON.parse(await issue());
  await sql(
    `update public.organisations set archived_at=now() where id=${q(a)}`,
  );
  assert.deepEqual(await read(archivedCompany), { status: "denied" });
  const suspendedIssuer = JSON.parse(await issue(admin, b));
  await sql(`update public.profiles set active=false where id=${q(admin)}`);
  assert.deepEqual(await read(suspendedIssuer), { status: "denied" });
  assert.equal(
    await sql(
      `select count(*) from public.audit_events where action like 'integration.%'`,
    ),
    "6",
  );
  console.log(
    "PASS company-scoped credential lifecycle, rotation, paging, rate limit, expiry and source revocation",
  );

  await sql(
    `update public.organisations set archived_at=null where id=${q(a)}`,
  );
  const own = JSON.parse(await issue(client, a, null, null, "null"));
  const managed = JSON.parse(await issue(staff, b, null, null, "null"));
  const ownList = JSON.parse(await list(client));
  assertResponse("company_integration_keys", ownList);
  const ownMetadata = ownList.find((key) => key.id === own.id);
  assert.equal(ownMetadata.expires_at, null);
  assert.equal(Object.hasOwn(ownMetadata, "webhook_eligible"), false);
  await sql(`update public.profiles set active=true where id=${q(admin)}`);
  assert.equal(
    JSON.parse(await list()).find((key) => key.id === own.id).webhook_eligible,
    false,
  );
  assert.ok(
    ownList.every((key) => key.id !== managed.id && !("credential" in key)),
  );
  const ownIndex = await read(own);
  assert.equal(ownIndex.status, "ok");
  assert.deepEqual(
    ownIndex.items.map(({ id }) => id).sort(),
    [courseA, courseA2].sort(),
  );
  assert.deepEqual(
    (await read(managed)).items.map(({ id }) => id),
    [courseB],
  );
  await assert.rejects(
    issue(client, a, managed.id, managed.version, "null"),
    /PT409/,
  );
  await assert.rejects(revoke(client, managed), /42501/);
  await assert.rejects(
    issue(client, a, null, null, "'infinity'::timestamptz"),
    /22023/,
  );
  await assert.rejects(
    issue(client, a, null, null, "now()+interval '181 days'"),
    /22023/,
  );
  const renewed = JSON.parse(
    await issue(client, a, own.id, own.version, "null"),
  );
  assert.deepEqual(await read(own), { status: "denied" });
  assert.equal((await read(renewed)).status, "ok");
  await sql(`update public.client_organisation_memberships set removed_at=now()
    where user_id=${q(client)} and organisation_id=${q(a)}`);
  assert.deepEqual(await read(renewed), { status: "denied" });
  await assert.rejects(list(client), /42501/);
  await assert.rejects(revoke(client, renewed), /42501/);
  await revoke(staff, renewed);
  await sql(`update public.client_organisation_memberships set removed_at=null
    where user_id=${q(client)} and organisation_id=${q(a)}`);
  assert.deepEqual(await read(renewed), { status: "denied" });
  await sql(
    `delete from public.user_roles where user_id=${q(staff)} and role='management'`,
  );
  assert.deepEqual(await read(managed), { status: "denied" });
  assert.equal(
    await sql(`select count(*) from public.audit_events
    where action in ('integration.created','integration.rotated') and details->'expires_at'='null'::jsonb`),
    "3",
  );
  console.log(
    "PASS permanent scoped keys, company isolation, management delegation and live issuer revocation",
  );
});
