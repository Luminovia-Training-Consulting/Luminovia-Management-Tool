/** Verify the exact public logo projection and role, version and licence write boundaries. */
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { z } from "zod";
import { academyPublicLogo } from "../src/features/branding/academy-logo-schema.ts";
import { academyOpenApi } from "../src/features/developer-api/academy-contract.ts";
import {
  configureAcademyCourseAccess,
  prepareAcademyInstallation,
} from "./academy-installation.mjs";
import { signAcademyLicence } from "./academy-licence.mjs";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGOQTDkBAAHfAUZ76qvRAAAAAElFTkSuQmCC",
  "base64",
);
const gate = (name, method = "POST", profile = "public") =>
  `set local request.path=${q(`/rpc/${name}`)}; set local request.method=${q(method)};
    set local request.headers=${q(JSON.stringify({ "accept-profile": profile }))};
    select public.require_portal_access();`;

for (const edition of ["customer-managed", "customer-self-hosted"]) {
  await withTestDatabase("academy_logo", async ({ sql, actor }) => {
    const [admin, learner, manager] = Array.from({ length: 3 }, randomUUID);
    const now = Date.now();
    const date = (days) => new Date(now + days * 86_400_000).toISOString();
    const terms = {
      installation_id: randomUUID(),
      edition,
      release_commit: "50".repeat(20),
      issued_at: date(-2),
      starts_at: date(-1),
      expires_at: date(4),
      grace_until: date(5),
      modules: ["lms"],
      limits: {
        seat_count: 5,
        storage_bytes: 1_000_000,
        api_requests_per_minute: 50,
      },
    };
    const vendor = generateKeyPairSync("ed25519");
    const options = {
      envelope: signAcademyLicence(terms, vendor.privateKey),
      publicKey: vendor.publicKey,
      expected: terms,
      now,
    };
    const readName = "academy_public_logo";
    const writeName = "check_academy_logo_write";
    const clearName = "clear_academy_public_logo";
    const publishName = "publish_academy_scanned_logo";
    const { paths } = academyOpenApi("https://academy.example.invalid", {
      name: "Fictional Academy",
      installationId: terms.installation_id,
      edition,
    });
    const readSchema = z.fromJSONSchema(
      paths[`/rest/v1/rpc/${readName}`].get.responses["200"].content[
        "application/json"
      ].schema,
    );
    const read = (method = "GET", profile = "public") =>
      sql(
        `begin; set local role anon; ${gate(readName, method, profile)} select public.${readName}(); commit;`,
      );
    assert.equal(await read(), "");
    await prepareAcademyInstallation(options, sql);
    await configureAcademyCourseAccess({ ...options, enabled: true }, sql);
    await sql(`
      insert into auth.users(id,email,email_confirmed_at) values ${[admin, learner, manager].map((id) => `(${q(id)},${q(id + "@example.invalid")},now())`).join(",")};
      insert into public.user_roles(user_id,role) values (${q(admin)},'admin'),(${q(learner)},'participant'),(${q(manager)},'management');
    `);

    async function current() {
      const value = academyPublicLogo.parse(JSON.parse(await read()));
      readSchema.parse(value);
      return value;
    }
    const serviceCall = (revision, bytes = png) =>
      `select public.${publishName}(${q(admin)},${revision},${q(bytes.toString("hex"))},'Fictional scanner 1');`;
    const publish = async (revision, bytes = png) => {
      const result = await sql(
        `begin; set local role service_role; ${gate(publishName)} ${serviceCall(revision, bytes)} commit;`,
      );
      return readSchema.parse(JSON.parse(result));
    };
    const clear = (who, revision) =>
      actor(who, `${gate(clearName)} select public.${clearName}(${revision});`);
    const check = (who, revision) =>
      actor(who, `${gate(writeName)} select public.${writeName}(${revision});`);
    const packageLogo = {
      installation_id: terms.installation_id,
      version: 0,
      png_base64: null,
    };
    const saved = {
      ...packageLogo,
      version: 1,
      png_base64: png.toString("base64"),
    };
    assert.deepEqual(await current(), packageLogo);
    await assert.rejects(read("POST"), /42501/);
    await assert.rejects(read("GET", "private"), /42501/);
    await assert.rejects(actor(admin, serviceCall(0)), /42501/);
    for (const who of [manager, learner]) {
      await assert.rejects(check(who, 0), /42501/);
      await assert.rejects(clear(who, 0), /42501/);
    }
    await check(admin, 0);
    await assert.rejects(publish(0, Buffer.alloc(60)), /23514/);
    await assert.rejects(publish(0, Buffer.alloc(262145)), /22023/);
    assert.deepEqual(await publish(0), saved);
    assert.deepEqual(await current(), saved);
    await assert.rejects(clear(admin, 0), /PT409/);
    const contenders = await Promise.allSettled([publish(1), clear(admin, 1)]);
    assert.equal(
      contenders.filter((item) => item.status === "fulfilled").length,
      1,
    );
    assert.match(
      String(contenders.find((item) => item.status === "rejected").reason),
      /PT409/,
    );

    await sql(
      `delete from public.user_roles where role='admin' and user_id=${q(admin)}`,
    );
    await assert.rejects(publish(2), /42501/);
    await assert.rejects(clear(admin, 2), /42501/);
    await sql(
      `insert into public.user_roles(user_id,role) values (${q(admin)},'admin')`,
    );
    assert.deepEqual(await publish(2), { ...saved, version: 3 });

    const grace = {
      ...terms,
      issued_at: date(-1),
      starts_at: date(-0.9),
      expires_at: date(-0.5),
    };
    await sql(
      `select private.apply_verified_installation_licence(${q(JSON.stringify(grace))}::jsonb)`,
    );
    assert.deepEqual(await current(), { ...saved, version: 3 });
    await assert.rejects(check(admin, 3), /42501/);
    await assert.rejects(publish(3), /42501/);
    await assert.rejects(clear(admin, 3), /42501/);
    assert.equal(
      await sql(
        "select count(*) from public.audit_events where action='academy.logo.changed'",
      ),
      "3",
    );
    console.log(
      "PASS",
      edition,
      "exact public PNG and version; private scanner path, current role, conflict and grace boundaries",
    );
  });
}
