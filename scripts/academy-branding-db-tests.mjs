/** Validate the public projection and the licence, role and revision boundaries. */
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { z } from "zod";
import { academyOpenApi } from "../src/features/developer-api/academy-contract.ts";
import { academyBrandLinkSettings } from "../src/features/branding/academy-brand-links-schema.ts";
import { academyBrandingSettings } from "../src/features/branding/academy-branding-schema.ts";
import {
  configureAcademyCourseAccess,
  prepareAcademyInstallation,
} from "./academy-installation.mjs";
import { signAcademyLicence } from "./academy-licence.mjs";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

for (const edition of ["customer-self-hosted", "customer-managed"]) {
  await withTestDatabase("academy_branding", async ({ sql, actor }) => {
    const admin = randomUUID();
    const manager = randomUUID();
    const participant = randomUUID();
    const now = Date.now();
    const date = (days) => new Date(now + days * 86_400_000).toISOString();
    const terms = {
      installation_id: randomUUID(),
      edition,
      release_commit: "4b".repeat(20),
      issued_at: date(-2),
      starts_at: date(-1),
      expires_at: date(4),
      grace_until: date(5),
      modules: ["lms"],
      limits: {
        seat_count: 5,
        storage_bytes: 1_000_000,
        api_requests_per_minute: 60,
      },
    };
    const key = generateKeyPairSync("ed25519");
    const options = {
      envelope: signAcademyLicence(terms, key.privateKey),
      publicKey: key.publicKey,
      expected: terms,
      now,
    };
    const publicRead = (
      method = "GET",
      profile = "public",
      name = "academy_public_branding",
    ) =>
      sql(
        "begin; set local role anon;" +
          `set local request.path=${q(`/rpc/${name}`)};` +
          "set local request.method=" +
          q(method) +
          ";" +
          "set local request.headers=" +
          q(JSON.stringify({ "accept-profile": profile })) +
          ";" +
          `select public.require_portal_access(); select public.${name}(); commit;`,
      );
    assert.equal(await publicRead(), "");
    await prepareAcademyInstallation(options, sql);
    await configureAcademyCourseAccess({ ...options, enabled: true }, sql);
    await sql(
      "insert into auth.users(id,email,email_confirmed_at) values " +
        [admin, manager, participant]
          .map(
            (id) => "(" + q(id) + "," + q(id + "@example.invalid") + ",now())",
          )
          .join(",") +
        "; insert into public.user_roles(user_id,role) values " +
        [
          [admin, "admin"],
          [manager, "management"],
          [participant, "participant"],
        ]
          .map(([id, role]) => "(" + q(id) + "," + q(role) + ")")
          .join(",") +
        ";",
    );
    const defaults = {
      installation_id: terms.installation_id,
      version: 0,
      name: null,
      short_name: null,
      theme_color: null,
    };
    const { paths } = academyOpenApi("https://academy.example.invalid", {
      name: "Fictional Academy",
      installationId: terms.installation_id,
      edition,
    });
    const readContract = z.fromJSONSchema(
      paths["/rest/v1/rpc/academy_public_branding"].get.responses["200"]
        .content["application/json"].schema,
    );
    const saveContract = z.fromJSONSchema(
      paths["/rest/v1/rpc/save_academy_public_branding"].post.responses["200"]
        .content["application/json"].schema,
    );
    const read = async () => {
      const value = JSON.parse(await publicRead());
      readContract.parse(value);
      return academyBrandingSettings.parse(value);
    };
    const save = async (
      who,
      version,
      name = "  Fictional Lernakademie  ",
      shortName = "Lernakademie",
      color = "#21B097",
    ) => {
      const args = [version, name, shortName, color]
        .map((item) => (item === null ? "null" : q(String(item))))
        .join(",");
      const value = JSON.parse(
        await actor(
          who,
          "set local request.path='/rpc/save_academy_public_branding';" +
            "set local request.method='POST'; select public.require_portal_access();" +
            "select public.save_academy_public_branding(" +
            args +
            ");",
        ),
      );
      saveContract.parse(value);
      return academyBrandingSettings.parse(value);
    };
    assert.deepEqual(await read(), defaults);
    await assert.rejects(publicRead("POST"), /42501/);
    await assert.rejects(publicRead("GET", "private"), /42501/);
    await assert.rejects(
      sql(
        "begin; set local role anon; select public.save_academy_public_branding(0,'x','y','#000000'); commit;",
      ),
      /42501/,
    );
    for (const who of [manager, participant]) {
      await assert.rejects(save(who, 0), /42501/);
    }
    await assert.rejects(save(admin, 0, "<b>Fictional</b>"), /23514/);
    await assert.rejects(save(admin, 0, "Fictional\u202eAcademy"), /23514/);
    await assert.rejects(save(admin, 0, "Fictional", null), /23514/);
    await assert.rejects(
      save(admin, 0, "Fictional", "Academy", "#1234"),
      /23514/,
    );
    const saved = {
      ...defaults,
      version: 1,
      name: "Fictional Lernakademie",
      short_name: "Lernakademie",
      theme_color: "#21b097",
    };
    assert.deepEqual(await save(admin, 0), saved);
    assert.deepEqual(await read(), saved);
    await assert.rejects(save(admin, 0), /PT409/);
    const attempts = await Promise.allSettled([
      save(admin, 1, "First valid update"),
      save(admin, 1, "Second valid update"),
    ]);
    assert.equal(
      attempts.filter(({ status }) => status === "fulfilled").length,
      1,
    );
    const losing = attempts.find(({ status }) => status === "rejected");
    assert.match(String(losing.reason), /PT409/);
    assert.equal((await read()).version, 2);

    await sql(
      "delete from public.user_roles where role='admin' and user_id=" +
        q(admin),
    );
    await assert.rejects(save(admin, 2), /42501/);
    await sql(
      "insert into public.user_roles(user_id,role) values (" +
        q(admin) +
        ",'admin')",
    );
    assert.deepEqual(await save(admin, 2, null, null, null), {
      ...defaults,
      version: 3,
    });

    const emptyLinks = {
      installation_id: terms.installation_id,
      version: 0,
      support_url: null,
      privacy_url: null,
      legal_url: null,
      terms_url: null,
    };
    const publishedLinks = {
      ...emptyLinks,
      version: 1,
      support_url: "https://help.example.invalid/contact?language=de#mail",
      privacy_url: "https://a-2.example.invalid/datenschutz",
      legal_url: "https://example.invalid/imprint",
      terms_url: "https://example.invalid/terms",
    };
    const linksRoute = "academy_public_brand_links";
    const saveLinksRoute = "save_academy_public_brand_links";
    const linkSchema = z.fromJSONSchema(
      paths[`/rest/v1/rpc/${linksRoute}`].get.responses["200"].content[
        "application/json"
      ].schema,
    );
    const savedLinkSchema = z.fromJSONSchema(
      paths[`/rest/v1/rpc/${saveLinksRoute}`].post.responses["200"].content[
        "application/json"
      ].schema,
    );
    const readLinks = async () => {
      const result = JSON.parse(await publicRead("GET", "public", linksRoute));
      linkSchema.parse(result);
      return academyBrandLinkSettings.parse(result);
    };
    const writeBody = (version, values) =>
      `select public.${saveLinksRoute}(${[
        version,
        values.support_url,
        values.privacy_url,
        values.legal_url,
        values.terms_url,
      ]
        .map((value) => (value === null ? "null" : q(String(value))))
        .join(",")});`;
    const saveLinks = async (who, version, values = publishedLinks) => {
      const result = JSON.parse(
        await actor(
          who,
          `set local request.path=${q(`/rpc/${saveLinksRoute}`)}; set local request.method='POST';
            select public.require_portal_access(); ${writeBody(version, values)}`,
        ),
      );
      savedLinkSchema.parse(result);
      return result;
    };
    assert.deepEqual(await readLinks(), emptyLinks);
    await assert.rejects(publicRead("POST", "public", linksRoute), /42501/);
    await assert.rejects(publicRead("GET", "private", linksRoute), /42501/);
    await assert.rejects(
      sql(
        `begin; set local role anon; ${writeBody(0, publishedLinks)} commit;`,
      ),
      /42501/,
    );
    await assert.rejects(saveLinks(manager, 0), /42501/);
    await assert.rejects(saveLinks(participant, 0), /42501/);
    for (const support_url of [
      "http://example.invalid/contact",
      "javascript:alert(1)",
      "https://admin@support.example.invalid",
      "https://support.example.invalid\\other.example.invalid",
      "https://support.example.invalid/line\n",
      "https://127.0.0.1/contact",
      "https://support.example.invalid/" + "x".repeat(500),
    ]) {
      const malformed = { ...publishedLinks, support_url };
      assert.equal(
        academyBrandLinkSettings.safeParse(malformed).success,
        false,
      );
      await assert.rejects(saveLinks(admin, 0, malformed), /23514/);
    }
    assert.deepEqual(await saveLinks(admin, 0), publishedLinks);
    assert.deepEqual(await readLinks(), publishedLinks);
    await assert.rejects(saveLinks(admin, 0), /PT409/);
    const clearAttempts = await Promise.allSettled([
      saveLinks(admin, 1, emptyLinks),
      saveLinks(admin, 1, emptyLinks),
    ]);
    assert.equal(
      clearAttempts.filter((attempt) => attempt.status === "fulfilled").length,
      1,
    );
    assert.match(
      String(
        clearAttempts.find((attempt) => attempt.status === "rejected")?.reason,
      ),
      /PT409/,
    );
    assert.deepEqual(await readLinks(), { ...emptyLinks, version: 2 });
    await sql(
      "delete from public.user_roles where role='admin' and user_id=" +
        q(admin),
    );
    await assert.rejects(saveLinks(admin, 2), /42501/);
    await sql(
      "insert into public.user_roles(user_id,role) values (" +
        q(admin) +
        ",'admin')",
    );
    const retained = { ...publishedLinks, version: 3 };
    assert.deepEqual(await saveLinks(admin, 2), retained);

    const grace = {
      ...terms,
      issued_at: date(-1),
      starts_at: date(-0.9),
      expires_at: date(-0.5),
    };
    await sql(
      "select private.apply_verified_installation_licence(" +
        q(JSON.stringify(grace)) +
        "::jsonb)",
    );
    assert.deepEqual(await read(), { ...defaults, version: 3 });
    await assert.rejects(save(admin, 3), /42501/);
    assert.deepEqual(await readLinks(), retained);
    await assert.rejects(saveLinks(admin, 3), /42501/);
    assert.deepEqual(
      JSON.parse(
        await sql(`select jsonb_agg(details order by (details->>'version')::int)
        from public.audit_events where action='academy.brand_links.changed'`),
      ),
      [{ version: 1 }, { version: 2 }, { version: 3 }],
    );
    assert.equal(
      await sql(
        "select count(*) from public.audit_events where action='academy.branding.changed'",
      ),
      "3",
    );
    console.log(
      "PASS",
      edition,
      "public branding and legal/support links, trusted local admin, input validation, atomic revision conflicts, role withdrawal, defaults and licence grace",
    );
  });
}
