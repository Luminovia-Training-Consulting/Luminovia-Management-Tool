/** Temporary support consent exercises the Academy request gate and persisted access evidence. */
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";
import {
  configureAcademyCourseAccess,
  prepareAcademyInstallation,
} from "./academy-installation.mjs";
import { signAcademyLicence } from "./academy-licence.mjs";
import {
  academySupportReply,
  academySupportRequest,
} from "../src/features/accounts/academy-support-schema.ts";

const id = () => randomUUID();
for (const edition of ["customer-managed", "customer-self-hosted"]) {
  await withTestDatabase("academy_support_access", async ({ actor, sql }) => {
    const [admin, manager, support, outsider, learner, unconfirmed] =
      Array.from({ length: 6 }, id);
    const installation = id();
    const date = (days) =>
      new Date(Date.now() + days * 86_400_000).toISOString();
    const terms = {
      installation_id: installation,
      edition,
      release_commit: "ab".repeat(20),
      issued_at: date(-2),
      starts_at: date(-1),
      expires_at: date(7),
      grace_until: date(14),
      modules: ["lms"],
      limits: {
        seat_count: 20,
        storage_bytes: 1000000,
        api_requests_per_minute: 60,
      },
    };
    const keys = generateKeyPairSync("ed25519");
    const options = {
      envelope: signAcademyLicence(terms, keys.privateKey),
      publicKey: keys.publicKey,
      expected: terms,
      now: Date.now(),
    };
    await prepareAcademyInstallation(options, sql);
    await configureAcademyCourseAccess({ ...options, enabled: true }, sql);
    await sql(`
      -- The disposable SQL fixture has only the common Auth columns.
      alter table auth.users add column if not exists banned_until timestamptz;
      insert into auth.users(id,email,email_confirmed_at) values
        ${[admin, manager, support, outsider, learner, unconfirmed].map((user) => `(${q(user)},${q(user + "@example.invalid")},${user === unconfirmed ? "null" : "now()"})`).join(",")};
      insert into public.user_roles(user_id,role) values
        (${q(admin)},'admin'),(${q(manager)},'management'),(${q(learner)},'participant');
    `);
    const call = async (user, action, payload = {}, prelude = "") => {
      academySupportRequest.parse({ p_action: action, p_payload: payload });
      return academySupportReply.parse(
        JSON.parse(
          await actor(
            user,
            `
        set local request.path='/rpc/academy_support_access';
        set local request.method='POST';
        ${prelude}
        select public.require_portal_access();
        select public.academy_support_access(${q(action)},${q(JSON.stringify(payload))}::jsonb);
      `,
          ),
        ),
      );
    };
    const first = id();
    const consent = {
      id: first,
      recipient_email: support + "@example.invalid",
      scope: "installation",
      purpose: "Review the verified release binding",
      duration_minutes: 30,
    };
    const read = (user, grant) => call(user, "read", { id: grant });
    const audit = (user, grant) => call(user, "audit", { id: grant });
    assert.deepEqual((await call(support, "list")).grants, []);
    await assert.rejects(call(manager, "grant", consent), /42501/);
    await assert.rejects(
      call(admin, "grant", {
        ...consent,
        recipient_email: unconfirmed + "@example.invalid",
      }),
      /22023/,
    );
    await assert.rejects(
      call(admin, "grant", {
        ...consent,
        recipient_email: learner + "@example.invalid",
      }),
      /22023/,
    );
    await assert.rejects(read(support, first), /42501/);
    await assert.rejects(
      call(
        support,
        "list",
        {},
        'set local request.headers=\'{"accept-profile":"private"}\';',
      ),
      /42501/,
    );
    const receipt = await call(admin, "grant", consent);
    const before = (await call(admin, "list")).grants[0];
    assert.deepEqual(await call(admin, "grant", consent), receipt);
    assert.equal(
      (await call(admin, "list")).grants[0].expires_at,
      before.expires_at,
    );
    await assert.rejects(
      call(admin, "grant", { ...consent, duration_minutes: 60 }),
      /PT409/,
    );
    await assert.rejects(read(admin, first), /42501/);
    await assert.rejects(read(outsider, first), /42501/);
    await assert.rejects(audit(outsider, first), /42501/);
    const diagnostic = await read(support, first);
    assert.deepEqual(diagnostic.diagnostic, {
      scope: "installation",
      edition,
      release: terms.release_commit,
      licence: "active",
    });
    assert.equal(diagnostic.installation_id, installation);
    await assert.rejects(
      actor(
        support,
        `
      set local request.path='/rpc/course_workspace'; set local request.method='POST';
      select public.require_portal_access();
    `,
      ),
      /42501/,
    );
    await assert.rejects(
      actor(support, "select * from private.academy_support_grants"),
      /42501/,
    );
    assert.equal(
      await actor(support, "select count(*) from public.course_runs"),
      "0",
    );

    const stored = await audit(admin, first);
    assert.deepEqual(
      stored.events.map(({ kind, actor_id }) => [kind, actor_id]),
      [
        ["read", support],
        ["granted", admin],
      ],
    );
    await assert.rejects(call(support, "revoke", { id: first }), /42501/);
    await call(admin, "revoke", { id: first });
    await call(admin, "revoke", { id: first });
    await assert.rejects(read(support, first), /42501/);
    assert.equal(
      (await audit(admin, first)).events.filter(
        ({ kind }) => kind === "revoked",
      ).length,
      1,
    );

    const course = id();
    const organisation = id();
    const template = id();
    await sql(`
      insert into public.organisations(id,name) values(${q(organisation)},'Fictional Academy');
      insert into public.course_templates(id,title) values(${q(template)},'Private fictional title');
      insert into public.course_runs(id,template_id,organisation_id,published)
        values(${q(course)},${q(template)},${q(organisation)},true);
      insert into public.course_sessions(course_run_id,starts_at,ends_at)
        values(${q(course)},now()+interval '1 hour',now()+interval '2 hours');
    `);
    const scoped = { ...consent, id: id(), scope: "course", course_id: course };
    await call(admin, "grant", scoped);
    assert.deepEqual((await read(support, scoped.id)).diagnostic, {
      scope: "course",
      course_id: course,
      published: true,
      session_count: 1,
    });
    assert.deepEqual((await call(outsider, "list")).grants, []);
    const visible = await call(support, "list");
    assert.equal(visible.can_manage, false);
    assert.equal(visible.can_read, true);
    assert.deepEqual(
      new Set(visible.grants.map(({ id }) => id)),
      new Set([first, scoped.id]),
    );

    await sql(`update private.academy_support_grants
       set granted_at=statement_timestamp()-interval '31 minutes',
       expires_at=statement_timestamp()-interval '1 minute' where id=${q(scoped.id)};`);
    await assert.rejects(read(support, scoped.id), /42501/);
    assert.equal(
      (await audit(admin, scoped.id)).events.filter(
        ({ kind }) => kind === "expired",
      ).length,
      1,
    );
    await call(admin, "revoke", { id: scoped.id });
    assert.equal(
      (await audit(admin, scoped.id)).events.filter(
        ({ kind }) => kind === "expired",
      ).length,
      1,
    );

    const fenced = { ...consent, id: id() };
    await call(admin, "grant", fenced);
    await sql(
      `update public.profiles set active=false where id=${q(support)};`,
    );
    await assert.rejects(read(support, fenced.id), /42501/);
    await sql(`update public.profiles set active=true where id=${q(support)};`);
    await sql(
      `update auth.users set banned_until=now()+interval '1 day' where id=${q(support)};`,
    );
    await assert.rejects(read(support, fenced.id), /42501/);
    await sql(
      `update auth.users set banned_until=null where id=${q(support)};`,
    );
    await configureAcademyCourseAccess({ ...options, enabled: false }, sql);
    assert.equal((await call(support, "list")).can_read, false);
    await assert.rejects(read(support, fenced.id), /42501/);
    await assert.rejects(
      call(admin, "grant", { ...consent, id: id() }),
      /42501/,
    );
    await call(admin, "revoke", { id: fenced.id });
    console.log(
      `PASS ${edition}: named consent, exact scope, idempotency, current account and licence, expiry/revocation, audited reads and private data denial`,
    );
  });
}

await withTestDatabase("academy_support_internal", async ({ actor, sql }) => {
  const admin = id();
  await sql(`insert into auth.users(id,email,email_confirmed_at) values(${q(admin)},'admin@example.invalid',now());
  insert into public.user_roles(user_id,role) values(${q(admin)},'admin');`);
  await assert.rejects(
    actor(admin, "select public.academy_support_access('list','{}')"),
    /42501/,
  );
  console.log("PASS internal installation denies dedicated support access");
});
