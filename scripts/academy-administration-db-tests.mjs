/** Dedicated local actor and account provisioning on freshly replayed databases. */
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  configureAcademyCourseAccess,
  prepareAcademyInstallation,
} from "./academy-installation.mjs";
import { signAcademyLicence } from "./academy-licence.mjs";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";
import { academyAdministrationPaths } from "../src/features/developer-api/academy-administration-contract.ts";

for (const edition of ["customer-self-hosted", "customer-managed"]) {
  await withTestDatabase("academy_administration", async ({ sql, actor }) => {
    const [admin, manager, lecturer, learner] = Array.from(
      { length: 4 },
      randomUUID,
    );
    const now = Date.now();
    const date = (days) => new Date(now + days * 86_400_000).toISOString();
    const terms = {
      installation_id: randomUUID(),
      edition,
      release_commit: "ab".repeat(20),
      issued_at: date(-2),
      starts_at: date(-1),
      expires_at: date(10),
      grace_until: date(15),
      modules: ["lms"],
      limits: {
        seat_count: 30,
        storage_bytes: 20_000_000,
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
    await sql(`alter table auth.users add column if not exists created_at timestamptz default clock_timestamp();
      insert into auth.users(id,email,email_confirmed_at) values
        ${[admin, manager, lecturer, learner].map((id) => `(${q(id)},${q(id + "@example.invalid")},now())`).join(",")};
      insert into public.user_roles(user_id,role) values
        (${q(admin)},'admin'),(${q(manager)},'management'),(${q(lecturer)},'lecturer'),(${q(learner)},'participant');`);
    const rpc = async (who, name, argumentList = "") => {
      const data = JSON.parse(
        await actor(
          who,
          `
        set local request.path=${q("/rpc/" + name)};
        set local request.method='POST';
        select public.require_portal_access();
        select coalesce(public.${name}(${argumentList})::text, 'null')`,
        ),
      );
      const schema =
        academyAdministrationPaths["/rest/v1/rpc/" + name]?.post.responses[
          "200"
        ].content["application/json"].schema;
      if (schema) z.fromJSONSchema(schema).parse(data);
      return data;
    };
    const directory = await rpc(admin, "academy_administration");
    assert.deepEqual(directory.organisations, []);
    assert.equal(directory.can_write, true);
    assert.equal(await rpc(lecturer, "academy_administration"), null);
    assert.equal(await rpc(learner, "academy_administration"), null);
    const request = randomUUID();
    const orgArgs = [
      q(request),
      "'Fictional training team'",
      "'Asia/Kathmandu'",
    ].join(",");
    const org = await rpc(manager, "academy_create_organisation", orgArgs);
    assert.ok(org.id);
    assert.equal(org.time_zone, "Asia/Kathmandu");
    assert.deepEqual(
      await rpc(manager, "academy_create_organisation", orgArgs),
      org,
    );
    await assert.rejects(
      rpc(lecturer, "academy_create_organisation", orgArgs),
      /42501/,
    );
    assert.deepEqual(
      (await rpc(admin, "academy_administration")).organisations,
      [org],
    );

    const reserve = (who, requestId, email, role, company, mode) =>
      rpc(
        who,
        "reserve_academy_account",
        [
          q(requestId),
          q(email),
          "'Fictional new learner'",
          q(role),
          company ? q(company) : "null",
          q(mode),
        ].join(","),
      );
    const finish = async (creation, user, decision) =>
      JSON.parse(
        await sql(`
        begin; set local role service_role;
        set local request.path='/rpc/finish_academy_account'; set local request.method='POST';
        select public.require_portal_access();
        select public.finish_academy_account(${q(creation)},${user ? q(user) : "null"},${q(decision)}); commit;`),
      );
    const accountRequest = randomUUID();
    const email = "new-learner@example.invalid";
    await assert.rejects(
      reserve(learner, accountRequest, email, "participant", org.id, "invite"),
      /42501/,
    );
    await assert.rejects(
      reserve(admin, accountRequest, email, "admin", null, "password"),
      /22023/,
    );
    const reservation = await reserve(
      admin,
      accountRequest,
      email,
      "participant",
      org.id,
      "invite",
    );
    assert.equal(reservation.status, "reserved");
    await assert.rejects(
      reserve(manager, randomUUID(), email, "participant", org.id, "invite"),
      /PT409/,
    );
    assert.equal(
      (
        await reserve(
          admin,
          accountRequest,
          email,
          "participant",
          org.id,
          "invite",
        )
      ).status,
      "in_progress",
    );
    const user = randomUUID();
    await sql(
      `insert into auth.users(id,email) values(${q(user)},${q(email)})`,
    );
    await assert.rejects(
      rpc(
        admin,
        "finish_academy_account",
        [q(reservation.creation_id), q(user), "'complete'"].join(","),
      ),
      /42501/,
    );
    await assert.rejects(
      finish(reservation.creation_id, learner, "complete"),
      /42501/,
    );
    assert.deepEqual(await finish(reservation.creation_id, user, "complete"), {
      status: "created",
      user_id: user,
    });
    assert.deepEqual(await finish(reservation.creation_id, user, "cleanup"), {
      status: "created",
      user_id: user,
    });
    assert.equal(
      (
        await reserve(
          admin,
          accountRequest,
          email,
          "participant",
          org.id,
          "invite",
        )
      ).user_id,
      user,
    );
    assert.equal(
      await sql(
        `select status from private.company_participant_memberships where organisation_id=${q(org.id)} and user_id=${q(user)}`,
      ),
      "active",
    );
    const row = (await rpc(admin, "academy_administration")).accounts.find(
      (account) => account.id === user,
    );
    assert.deepEqual(row, {
      id: user,
      display_name: "Fictional new learner",
      active: true,
      role: "participant",
      confirmed: false,
    });

    const lateEmail = "revoked-creator@example.invalid";
    const late = await reserve(
      manager,
      randomUUID(),
      lateEmail,
      "lecturer",
      null,
      "password",
    );
    const lateUser = randomUUID();
    await sql(`insert into auth.users(id,email,email_confirmed_at) values(${q(lateUser)},${q(lateEmail)},now());
      update public.profiles set active=false where id=${q(manager)}`);
    await assert.rejects(
      finish(late.creation_id, lateUser, "complete"),
      /42501/,
    );
    assert.deepEqual(await finish(late.creation_id, lateUser, "cleanup"), {
      status: "cleanup",
      user_id: lateUser,
    });
    await assert.rejects(
      finish(late.creation_id, lateUser, "discard"),
      /42501/,
    );
    await sql(`delete from auth.users where id=${q(lateUser)}`);
    assert.deepEqual(await finish(late.creation_id, lateUser, "discard"), {
      status: "failed",
    });

    const grace = {
      ...terms,
      issued_at: date(-1.9),
      starts_at: date(-1.8),
      expires_at: date(-0.5),
      grace_until: date(2),
    };
    await sql(
      `select private.apply_verified_installation_licence(${q(JSON.stringify(grace))}::jsonb)`,
    );
    assert.equal((await rpc(admin, "academy_administration")).can_write, false);
    await assert.rejects(
      rpc(admin, "academy_create_organisation", orgArgs),
      /42501/,
    );
    await assert.rejects(
      reserve(
        admin,
        randomUUID(),
        "grace@example.invalid",
        "lecturer",
        null,
        "password",
      ),
      /42501/,
    );
    await configureAcademyCourseAccess({ ...options, enabled: false }, sql);
    await assert.rejects(rpc(admin, "academy_administration"), /42501/);
    console.log(
      `PASS ${edition} local administration, organisation retry, exact Auth finalization, learner membership and revoked actor cleanup`,
    );
  });
}
