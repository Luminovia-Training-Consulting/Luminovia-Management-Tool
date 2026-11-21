import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { prepareAcademyInstallation } from "./academy-installation.mjs";
import { signAcademyLicence } from "./academy-licence.mjs";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

const date = (days) => new Date(Date.now() + days * 86_400_000).toISOString();

for (const edition of [
  "internal",
  "customer-self-hosted",
  "customer-managed",
]) {
  await withTestDatabase("privileged_authenticator", async ({ sql }) => {
    const [
      installation,
      admin,
      owner,
      lecturer,
      client,
      participant,
      guest,
      futureAdmin,
      adminFactor,
      ownerFactor,
      foreignFactor,
      adminSession,
      secondAdminSession,
      ownerSession,
      wrongFactorSession,
      phoneSession,
      pendingSession,
      adminPendingFactor,
      company,
      otherCompany,
      template,
      ownCourse,
      foreignCourse,
    ] = Array.from({ length: 23 }, randomUUID);

    if (edition !== "internal") {
      const terms = {
        installation_id: installation,
        edition,
        release_commit: "ac".repeat(20),
        issued_at: date(-6),
        starts_at: date(-5),
        expires_at: date(4),
        grace_until: date(6),
        limits: {
          seat_count: 20,
          storage_bytes: 2_000_000,
          api_requests_per_minute: 60,
        },
        modules: ["lms"],
      };
      const key = generateKeyPairSync("ed25519");
      await prepareAcademyInstallation(
        {
          envelope: signAcademyLicence(terms, key.privateKey),
          publicKey: key.publicKey,
          expected: terms,
        },
        sql,
      );
      await sql(
        `select private.configure_academy_course_access(${q(installation)}, ${q(terms.release_commit)}, true)`,
      );
    }

    const actors = [
      admin,
      owner,
      lecturer,
      client,
      participant,
      guest,
      futureAdmin,
    ];
    await sql(`
      insert into auth.users(id, email, email_confirmed_at) values
        ${actors.map((user) => `(${q(user)},${q(user + "@example.invalid")},now())`).join(",")};
      insert into public.user_roles(user_id, role) values (${q(admin)}, 'admin'), (${q(owner)}, 'owner'),
        (${q(lecturer)}, 'lecturer'), (${q(client)}, 'client'), (${q(participant)}, 'participant'),
        (${q(guest)}, 'guest'), (${q(futureAdmin)}, 'lecturer');
      insert into public.organisations(id, name) values (${q(company)}, 'Campus One'), (${q(otherCompany)}, 'Campus Two');
      insert into public.client_organisation_memberships(user_id, organisation_id) values (${q(client)}, ${q(company)});
      insert into public.course_templates(id, title) values (${q(template)}, 'Fictional course template');
      insert into public.course_runs(id, template_id, organisation_id) values
        (${q(ownCourse)}, ${q(template)}, ${q(company)}), (${q(foreignCourse)}, ${q(template)}, ${q(otherCompany)});
    `);
    if (edition === "internal") {
      await sql(
        `insert into private.company_premium_settings(organisation_id,enabled) values (${q(company)}, true), (${q(otherCompany)}, true)`,
      );
    }

    const run = (
      id,
      statement,
      {
        aal = "aal1",
        sessionId,
        metadata = {},
        method = "POST",
        path = "/rpc/portal_access",
      } = {},
    ) =>
      sql(`begin; set local role authenticated; set local request.method=${q(method)};
        set local request.path=${q(path)}; set local request.jwt.claims=${q(
          JSON.stringify({
            sub: id,
            aal,
            role: "authenticated",
            session_id: sessionId,
            ...metadata,
          }),
        )}; ${statement}; commit;`);
    const gate = (id, settings) =>
      run(id, "select public.require_portal_access()", settings);
    const settingsAvailable = (id, settings) =>
      run(
        id,
        "select public.require_portal_access(); select public.authenticator_settings_available()",
        { ...settings, path: "/rpc/authenticator_settings_available" },
      ).then((result) => result.trim());
    const setPolicy = (mode) =>
      sql(`select private.set_authenticator_policy(${q(mode)})`);

    await gate(admin);
    await gate(owner);
    assert.equal(await settingsAvailable(admin), "f");
    assert.equal(await settingsAvailable(client), "f");
    await assert.rejects(
      run(admin, "select private.set_authenticator_policy('required')"),
      /42501/,
    );
    await assert.rejects(
      sql(
        "set role service_role; select private.set_authenticator_policy('required')",
      ),
      /42501/,
    );
    await assert.rejects(setPolicy("unknown"), /22023/);
    await assert.rejects(setPolicy("required"), /55000/);
    assert.equal(await setPolicy("enrolment"), "enrolment");
    assert.equal(await settingsAvailable(admin), "t");
    assert.equal(await settingsAvailable(owner), "t");
    assert.equal(await settingsAvailable(lecturer), "f");

    // The generic database harness emulates Auth. Match just the provider
    // columns consumed by the gate and leave provider flows to native tests.
    await sql(`
      create table auth.mfa_factors (id uuid primary key, user_id uuid not null references auth.users(id),
        factor_type text not null, status text not null);
      create table auth.sessions (id uuid primary key, user_id uuid not null references auth.users(id),
        aal text, factor_id uuid, not_after timestamptz);
      insert into auth.mfa_factors values
        (${q(adminFactor)}, ${q(admin)}, 'totp', 'verified'), (${q(ownerFactor)}, ${q(owner)}, 'totp', 'unverified'),
        (${q(foreignFactor)}, ${q(lecturer)}, 'totp', 'verified'),
        (${q(adminPendingFactor)}, ${q(admin)}, 'totp', 'unverified');
      insert into auth.sessions values
        (${q(adminSession)}, ${q(admin)}, 'aal2', ${q(adminFactor)}, null),
        (${q(secondAdminSession)}, ${q(admin)}, 'aal1', null, null),
        (${q(ownerSession)}, ${q(owner)}, 'aal2', ${q(ownerFactor)}, null),
        (${q(wrongFactorSession)}, ${q(admin)}, 'aal2', ${q(foreignFactor)}, null),
        (${q(phoneSession)}, ${q(admin)}, 'aal2', null, null),
        (${q(pendingSession)}, ${q(admin)}, 'aal2', ${q(adminPendingFactor)}, null);
      with phone as (insert into auth.mfa_factors values (gen_random_uuid(), ${q(admin)}, 'phone', 'verified') returning id)
        update auth.sessions set factor_id = phone.id from phone where auth.sessions.id = ${q(phoneSession)};
    `);

    const adminProof = { aal: "aal2", sessionId: adminSession };
    const ownerProof = { aal: "aal2", sessionId: ownerSession };
    await assert.rejects(
      gate(admin, { sessionId: adminSession }),
      /PT412: Authenticator verification required/,
    );
    await gate(admin, adminProof);
    await gate(owner);
    await assert.rejects(setPolicy("required"), /55000/);
    await sql(
      `update auth.mfa_factors set status = 'verified' where id = ${q(ownerFactor)}`,
    );
    assert.equal(await setPolicy("required"), "required");
    await assert.rejects(gate(owner, { sessionId: ownerSession }), /PT412/);
    await gate(owner, ownerProof);
    assert.equal(await settingsAvailable(admin, adminProof), "t");

    for (const claims of [
      { aal: "aal2" },
      { aal: "aal2", sessionId: "invalid" },
      {
        aal: "aal2",
        sessionId: secondAdminSession,
        metadata: { user_metadata: { mfa_verified: true } },
      },
      { aal: "aal2", sessionId: ownerSession },
      { aal: "aal2", sessionId: wrongFactorSession },
      { aal: "aal2", sessionId: phoneSession },
      { aal: "aal2", sessionId: pendingSession },
    ]) {
      await assert.rejects(gate(admin, claims), /PT412/);
    }

    assert.equal(await run(admin, "select private.actor_active()"), "f");
    assert.equal(
      await run(
        admin,
        "select count(*) from public.profiles where id = auth.uid()",
      ),
      "0",
    );
    assert.equal(
      await run(
        admin,
        "select count(*) from public.profiles where id = auth.uid()",
        adminProof,
      ),
      "1",
    );
    await gate(lecturer);
    await gate(client);
    assert.equal(
      await run(participant, "select private.participant_actor()"),
      "t",
    );
    assert.equal(await run(guest, "select private.guest_actor()"), "t");
    await sql(
      "begin; set local role service_role; set local request.method='POST'; set local request.path='/rpc/finish_academy_account'; select public.require_portal_access(); commit;",
    );
    await sql(
      "begin; set local role anon; set local request.method='GET'; set local request.path='/rpc/installation_capabilities'; select public.require_portal_access(); commit;",
    );

    const readClass = (who, course) =>
      run(
        who,
        `select public.require_portal_access(); select public.course_class_options(${q(course)})`,
        { path: "/rpc/course_class_options" },
      );
    assert.equal(JSON.parse(await readClass(client, ownCourse)).can_edit, true);
    await assert.rejects(readClass(client, foreignCourse), /42501/);

    await assert.rejects(
      sql(
        `insert into public.user_roles(user_id, role) values (${q(futureAdmin)}, 'admin')`,
      ),
      /55000/,
    );
    await sql(`insert into auth.mfa_factors values (gen_random_uuid(), ${q(futureAdmin)}, 'totp', 'verified');
      insert into public.user_roles(user_id, role) values (${q(futureAdmin)}, 'admin')`);
    await assert.rejects(gate(futureAdmin), /PT412/);

    await sql(
      `insert into private.account_password_setup(user_id) values (${q(admin)})`,
    );
    await assert.rejects(gate(admin), /PT428/);
    await assert.rejects(gate(admin, adminProof), /PT428/);
    await sql(
      `delete from private.account_password_setup where user_id = ${q(admin)}`,
    );

    await sql(
      `update auth.sessions set not_after = now() - interval '1 second' where id = ${q(adminSession)}`,
    );
    await assert.rejects(gate(admin, adminProof), /PT412/);
    await sql(
      `update auth.sessions set not_after = null, aal = 'aal1' where id = ${q(adminSession)}`,
    );
    await assert.rejects(gate(admin, adminProof), /PT412/);
    await sql(
      `update auth.sessions set aal = 'aal2' where id = ${q(adminSession)}`,
    );
    await gate(admin, adminProof);
    await sql(`delete from auth.mfa_factors where id = ${q(adminFactor)}`);
    await assert.rejects(gate(admin, adminProof), /PT412/);
    await sql(`delete from auth.sessions where id = ${q(ownerSession)}`);
    await assert.rejects(gate(owner, ownerProof), /PT412/);
    assert.equal(await setPolicy("disabled"), "disabled");
    await gate(admin);
    assert.equal(await settingsAvailable(owner), "f");

    console.log(
      `PASS ${edition}: staged authenticator activation, current native assurance, owner/admin controls, password priority, actor and organisation boundaries`,
    );
  });
}
