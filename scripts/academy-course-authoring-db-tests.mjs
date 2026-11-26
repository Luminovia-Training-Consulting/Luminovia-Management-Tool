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
    const manager = randomUUID();
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
    const [org, template, source, destination, module, lesson] = Array.from(
      { length: 6 },
      randomUUID,
    );
    const published = {
      modules: [
        {
          id: module,
          title: "Fictional module",
          description: "",
          lessons: [
            {
              id: lesson,
              title: "Fictional lesson",
              objectives: "",
              duration_minutes: 10,
              body: { type: "doc", content: [{ type: "paragraph" }] },
            },
          ],
        },
      ],
    };
    await sql(`
      insert into auth.users(id,email,email_confirmed_at)
      values (${q(user)},${q(user + "@example.invalid")},now()), (${q(manager)},${q(manager + "@example.invalid")},now());
      insert into public.user_roles(user_id,role) values (${q(user)},'participant'), (${q(manager)},'admin');
      insert into public.organisations(id,name) values (${q(org)},'Fictional Academy');
      insert into public.course_templates(id,title) values (${q(template)},'Fictional curriculum');
      insert into public.course_runs(id,template_id,organisation_id,published) values
        (${q(source)},${q(template)},${q(org)},true), (${q(destination)},${q(template)},${q(org)},true);
      insert into private.course_content_revisions(course_run_id,version,content,published_by)
        values (${q(source)},1,${q(JSON.stringify(published))},${q(manager)});
    `);

    const gate = (path, method) =>
      actor(
        user,
        `set local request.path=${q(path)};
         set local request.method=${q(method)};
         set local request.headers='{"accept-profile":"public","content-profile":"public"}';
         select public.require_portal_access()`,
      );
    const catalogue = (who, withGate = true) =>
      actor(
        who,
        (withGate
          ? "set local request.path='/rpc/course_curriculum_catalogue';set local request.method='GET';select public.require_portal_access();"
          : "") +
          `select public.course_curriculum_catalogue(${q(destination)})`,
      ).then(JSON.parse);

    await gate("/rpc/course_content_studio", "GET");
    await gate("/rpc/course_content_studio", "POST");
    await gate("/rpc/course_curriculum_catalogue", "GET");
    const currentCatalogue = await catalogue(manager);
    assert.equal(currentCatalogue.items[0].lesson_id, lesson);
    await assert.rejects(catalogue(user), /42501/);
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
    await gate("/rpc/course_curriculum_catalogue", "GET");
    assert.deepEqual(await catalogue(manager), currentCatalogue);
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
    await assert.rejects(
      gate("/rpc/course_curriculum_catalogue", "GET"),
      /42501|Academy course operation unavailable/,
    );
    await assert.rejects(catalogue(manager, false), /42501/);
    console.log(
      `PASS ${edition} course-content gateway active, grace and expiry boundaries`,
    );
  });
}
