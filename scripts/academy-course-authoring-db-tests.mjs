import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import {
  configureAcademyCourseAccess,
  prepareAcademyInstallation,
} from "./academy-installation.mjs";
import { signAcademyLicence } from "./academy-licence.mjs";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

for (const edition of ["customer-self-hosted", "customer-managed"]) {
  await withTestDatabase("academy_course_authoring", async ({ sql, actor }) => {
    const user = randomUUID();
    const installationId = randomUUID();
    const now = Date.now();
    const date = (days) => new Date(now + days * 86_400_000).toISOString();
    const terms = {
      installation_id: installationId,
      edition,
      release_commit: "cd".repeat(20),
      issued_at: date(-2),
      starts_at: date(-1),
      expires_at: date(2),
      grace_until: date(5),
      modules: ["lms"],
      limits: {
        seat_count: 10,
        storage_bytes: 10_000_000,
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
    await prepareAcademyInstallation(options, sql);
    await configureAcademyCourseAccess({ ...options, enabled: true }, sql);
    await sql(`
      insert into auth.users(id,email,email_confirmed_at)
      values (${q(user)},${q(user + "@example.invalid")},now());
      insert into public.user_roles(user_id,role) values (${q(user)},'participant');
    `);

    const gate = (path, method) =>
      actor(
        user,
        `set local request.path=${q(path)};
         set local request.method=${q(method)};
         set local request.headers='{"accept-profile":"public","content-profile":"public"}';
         select public.require_portal_access()`,
      );

    await gate("/rpc/course_content_studio", "GET");
    await gate("/rpc/course_content_studio", "POST");
    await gate("/rpc/course_content_action", "POST");
    await assert.rejects(
      gate("/rpc/course_content_action", "GET"),
      /42501|Academy course operation unavailable/,
    );

    await sql(`update private.installation_verified_licence
      set expires_at=now()-interval '1 second'
      where installation_id=${q(installationId)};`);
    await gate("/rpc/course_content_studio", "GET");
    await gate("/rpc/course_content_studio", "POST");
    await assert.rejects(
      gate("/rpc/course_content_action", "POST"),
      /42501|Academy course operation unavailable/,
    );

    await sql(`update private.installation_verified_licence
      set grace_until=now()-interval '1 second'
      where installation_id=${q(installationId)};`);
    await assert.rejects(
      gate("/rpc/course_content_studio", "GET"),
      /42501|Academy course operation unavailable/,
    );
    console.log(
      `PASS ${edition} course-content gateway active, grace and expiry boundaries`,
    );
  });
}
