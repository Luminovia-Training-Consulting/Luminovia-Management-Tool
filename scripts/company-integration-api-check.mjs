/** Native HTTP check for isolated company keys and their separate credential boundary. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { withApiFixture } from "./testing/api.mjs";

await withApiFixture(async ({ actor, checked, defer, sql, url }) => {
  const admin = await actor("integration-admin", "admin");
  const blocked = await actor("integration-lecturer", "lecturer");
  const [companyA, companyB, template, courseA, courseB] = Array.from(
    { length: 5 },
    randomUUID,
  );
  defer(() =>
    sql(`
    delete from public.course_runs where id in ('${courseA}','${courseB}');
    delete from public.course_templates where id='${template}';
    delete from public.organisations where id in ('${companyA}','${companyB}');
  `),
  );
  await sql(`
    insert into public.organisations(id,name) values
      ('${companyA}','Fictional integration A'),('${companyB}','Fictional integration B');
    insert into public.course_templates(id,title) values('${template}','Fictional course listing');
    insert into public.course_runs(id,template_id,organisation_id,published) values
      ('${courseA}','${template}','${companyA}',true),
      ('${courseB}','${template}','${companyB}',true);
  `);

  const issue = (client, previous = null) =>
    client.rpc("issue_company_integration_key", {
      p_organisation_id: companyA,
      p_label: "Fictional server-only key",
      p_expires_at: new Date(Date.now() + 3600_000).toISOString(),
      p_rotate_id: previous?.id ?? null,
      p_expected_version: previous?.version ?? null,
    });
  assert.equal((await issue(blocked.client)).error?.code, "42501");
  const initial = await checked(
    issue(admin.client),
    "Issue fictional organisation key",
  );
  const endpoint = new URL("/functions/v1/company-integration?limit=1", url);
  const request = (credential, headers = {}) =>
    fetch(endpoint, {
      method: "GET",
      headers: { Authorization: `Bearer ${credential}`, ...headers },
    });
  const first = await request(initial.credential);
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("cache-control"), "no-store");
  assert.deepEqual(await first.json(), {
    items: [
      {
        id: courseA,
        title: "Fictional course listing",
        time_zone: "Europe/Berlin",
      },
    ],
    next_cursor: null,
  });
  assert.equal(
    (await request(initial.credential, { Origin: "http://127.0.0.1:5273" }))
      .status,
    403,
  );
  const rotated = await checked(
    issue(admin.client, initial),
    "Rotate fictional organisation key",
  );
  assert.equal((await request(initial.credential)).status, 401);
  assert.equal((await request(rotated.credential)).status, 200);
  await checked(
    admin.client.rpc("revoke_company_integration_key", {
      p_id: rotated.id,
      p_expected_version: rotated.version,
    }),
    "Revoke fictional organisation key",
  );
  assert.equal((await request(rotated.credential)).status, 401);
  console.log(
    "PASS integration HTTP rejects browser use and retired keys and returns only the selected company's public course projection",
  );
});
