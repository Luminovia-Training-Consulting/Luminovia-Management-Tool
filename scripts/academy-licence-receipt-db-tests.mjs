/** Administrative licence receipts use the same accounting as the dedicated allocator. */
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  configureAcademyCourseAccess,
  prepareAcademyInstallation,
} from "./academy-installation.mjs";
import { signAcademyLicence } from "./academy-licence.mjs";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";
import { academyLicencePaths } from "../src/features/developer-api/academy-licence-contract.ts";

const path = "/rest/v1/rpc/academy_licence_receipt";
const resultSchema = z.fromJSONSchema(
  academyLicencePaths[path].post.responses["200"].content["application/json"]
    .schema,
);

for (const edition of ["customer-self-hosted", "customer-managed"]) {
  await withTestDatabase("academy_licence_receipt", async ({ sql, actor }) => {
    const [
      admin,
      manager,
      teacher,
      learner,
      guest,
      inactive,
      unconfirmed,
      owner,
    ] = Array.from({ length: 8 }, randomUUID);
    const now = Date.now();
    const date = (days) => new Date(now + days * 86_400_000).toISOString();
    const terms = {
      installation_id: randomUUID(),
      edition,
      release_commit: "7a".repeat(20),
      issued_at: date(-2),
      starts_at: date(-1),
      expires_at: date(10),
      grace_until: date(15),
      modules: ["lms"],
      limits: {
        seat_count: 12,
        storage_bytes: 1_000,
        api_requests_per_minute: 75,
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
    await sql(`insert into auth.users(id,email,email_confirmed_at)
      values(${q(admin)},'first-admin@example.invalid',now())`);
    await prepareAcademyInstallation(
      { ...options, firstAdministrator: admin },
      sql,
    );
    await configureAcademyCourseAccess({ ...options, enabled: true }, sql);

    const as = (id, name, args = "", method = "POST", profile = "public") =>
      actor(
        id,
        `set local request.path=${q("/rpc/" + name)};
        set local request.method=${q(method)};
        set local request.headers=${q(JSON.stringify({ "accept-profile": profile }))};
        select public.require_portal_access();
        select public.${name}(${args});`,
      );
    const read = async (id = admin) =>
      resultSchema.parse(JSON.parse(await as(id, "academy_licence_receipt")));
    const publicBootstrap = async () =>
      JSON.parse(await sql("select public.installation_capabilities()"));
    const publicBefore = await publicBootstrap();
    assert.equal(publicBefore.customer_ready, false);
    const initial = await read();
    assert.equal(initial.state, "active");
    for (const field of ["issued_at", "starts_at", "expires_at", "grace_until"])
      assert.equal(new Date(initial[field]).toISOString(), terms[field]);
    assert.deepEqual(initial.seats, { limit: 12, occupied: 1, available: 11 });
    assert.deepEqual(initial.storage, {
      limit_bytes: 1_000,
      used_bytes: 0,
      available_bytes: 1_000,
    });
    assert.equal(initial.api_requests_per_minute, 75);
    assert.equal(
      JSON.stringify(initial).includes(terms.installation_id),
      false,
    );
    assert.equal(JSON.stringify(initial).includes(terms.release_commit), false);

    const users = [
      [manager, "management"],
      [teacher, "lecturer"],
      [learner, "participant"],
      [guest, "guest"],
      [inactive, "admin"],
      [unconfirmed, "admin"],
      [owner, "owner"],
    ];
    await sql(`insert into auth.users(id,email,email_confirmed_at) values
      ${users.map(([id]) => `(${q(id)},${q(id + "@example.invalid")},${id === unconfirmed ? "null" : "now()"})`).join(",")};
      insert into public.user_roles(user_id,role) values
      ${users.map(([id, role]) => `(${q(id)},${q(role)})`).join(",")};
      insert into public.user_roles(user_id,role) values(${q(teacher)},'management');
      update public.profiles set active=false where id=${q(inactive)};`);
    for (const [id] of users) await assert.rejects(read(id), /42501/);
    await assert.rejects(
      as(admin, "academy_licence_receipt", "", "GET"),
      /42501/,
    );
    await assert.rejects(
      as(admin, "academy_licence_receipt", "", "POST", "private"),
      /42501/,
    );
    assert.equal(
      await sql(
        "select has_function_privilege('anon','public.academy_licence_receipt()','execute')",
      ),
      "f",
    );
    assert.equal(
      await sql(
        "select has_function_privilege('service_role','public.academy_licence_receipt()','execute')",
      ),
      "f",
    );

    const held = JSON.parse(
      await as(
        admin,
        "reserve_academy_account",
        [
          q(randomUUID()),
          "'reserved@example.invalid'",
          "'Fictional account'",
          "'lecturer'",
          "null",
          "'password'",
        ].join(","),
      ),
    );
    assert.equal(held.status, "reserved");
    const [document, clientA, clientB] = Array.from({ length: 3 }, randomUUID);
    await sql(`
      insert into public.documents(id,owner_id,uploaded_by,scope,kind,original_name,mime_type,size_bytes,status,client_id,deleted_at)
      values(${q(document)},${q(teacher)},${q(teacher)},'personal','material','Private fixture.txt','text/plain',50,'clean',${q(clientA)},now());
      insert into public.document_versions(document_id,uploaded_by,client_id,version,object_path,original_name,mime_type,size_bytes,status)
      values(${q(document)},${q(teacher)},${q(clientA)},1,'fixture/retained','Private fixture.txt','text/plain',50,'clean'),
        (${q(document)},${q(teacher)},${q(clientB)},2,'fixture/pending','Pending fixture.txt','text/plain',30,'quarantined');`);
    const current = await read();
    assert.deepEqual(current.seats, { limit: 12, occupied: 8, available: 4 });
    assert.deepEqual(current.storage, {
      limit_bytes: 1_000,
      used_bytes: 80,
      available_bytes: 920,
    });
    assert.equal(
      JSON.stringify(current).includes("Private fixture.txt"),
      false,
    );
    assert.deepEqual(await publicBootstrap(), publicBefore);

    await sql(`insert into public.user_roles(user_id,role) values(${q(admin)},'management');
      delete from public.user_roles where user_id=${q(admin)} and role='admin';`);
    await assert.rejects(read(), /42501/);
    await sql(
      `insert into public.user_roles(user_id,role) values(${q(admin)},'admin');`,
    );

    const grace = {
      ...terms,
      issued_at: date(-1.9),
      starts_at: date(-1.8),
      expires_at: date(-0.5),
      grace_until: date(2),
      limits: { ...terms.limits, seat_count: 6, storage_bytes: 64 },
    };
    await sql(
      `select private.apply_verified_installation_licence(${q(JSON.stringify(grace))}::jsonb)`,
    );
    const reduced = await read();
    assert.equal(reduced.state, "grace");
    assert.deepEqual(reduced.seats, { limit: 6, occupied: 8, available: 0 });
    assert.deepEqual(reduced.storage, {
      limit_bytes: 64,
      used_bytes: 80,
      available_bytes: 0,
    });
    await configureAcademyCourseAccess({ ...options, enabled: false }, sql);
    await assert.rejects(read(), /42501/);
    console.log(
      `PASS ${edition} first-admin seat, shared occupied seats and retained/pending bytes, grace and lower limits, exact admin-only/private projection`,
    );
  });
}
