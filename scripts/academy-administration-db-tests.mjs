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
    const [admin, manager, lecturer, learner, owner] = Array.from(
      { length: 5 },
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
    await sql(`
      insert into auth.users(id,email,email_confirmed_at) values
        ${[admin, manager, lecturer, learner, owner].map((id) => `(${q(id)},${q(id + "@example.invalid")},now())`).join(",")};
      insert into public.user_roles(user_id,role) values
        (${q(admin)},'admin'),(${q(manager)},'management'),(${q(lecturer)},'lecturer'),(${q(learner)},'participant'),(${q(owner)},'owner');`);
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
    assert.equal(directory.can_create_management, true);
    assert.equal(
      (await rpc(manager, "academy_administration")).can_create_management,
      false,
    );
    assert.equal(await rpc(lecturer, "academy_administration"), null);
    assert.equal(await rpc(learner, "academy_administration"), null);
    assert.equal(await rpc(owner, "academy_administration"), null);
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
      management_delegated: false,
      management_version: 0,
      can_set_active: true,
      can_set_management: false,
    });

    const newManagerEmail = "new-manager@example.invalid";
    await assert.rejects(
      reserve(
        manager,
        randomUUID(),
        newManagerEmail,
        "management",
        null,
        "password",
      ),
      /42501/,
    );
    const managerRequest = await reserve(
      admin,
      randomUUID(),
      newManagerEmail,
      "management",
      null,
      "password",
    );
    const newManager = randomUUID();
    await sql(`insert into auth.users(id,email,email_confirmed_at)
      values(${q(newManager)},${q(newManagerEmail)},now())`);
    assert.deepEqual(
      await finish(managerRequest.creation_id, newManager, "complete"),
      { status: "created", user_id: newManager },
    );
    assert.equal(
      (await rpc(newManager, "academy_administration")).can_create_management,
      false,
    );

    const delegation = (who, target, enabled, version) =>
      rpc(
        who,
        "academy_set_management",
        [q(target), enabled, version].join(","),
      );
    const activation = (who, target, enabled, expected) =>
      rpc(
        who,
        "academy_set_member_active",
        [q(target), enabled, expected].join(","),
      );
    await assert.rejects(delegation(manager, lecturer, true, 0), /42501/);
    await assert.rejects(delegation(owner, lecturer, true, 0), /42501/);
    await assert.rejects(delegation(admin, learner, true, 0), /42501/);
    await sql(
      `update auth.users set email_confirmed_at=null where id=${q(admin)}`,
    );
    await assert.rejects(delegation(admin, lecturer, true, 0), /42501/);
    await sql(
      `update auth.users set email_confirmed_at=now() where id=${q(admin)}`,
    );
    const granted = await delegation(admin, lecturer, true, 0);
    assert.equal(granted.role, "management");
    assert.equal(granted.management_delegated, true);
    assert.equal(granted.management_version, 1);
    assert.equal(
      (await rpc(lecturer, "academy_administration")).can_create_management,
      false,
    );
    assert.equal(
      await sql(
        `select string_agg(role,',' order by role) from public.user_roles where user_id=${q(lecturer)}`,
      ),
      "lecturer,management",
    );
    await assert.rejects(delegation(admin, lecturer, true, 0), /PT409/);
    await assert.rejects(activation(manager, lecturer, false, true), /42501/);
    await assert.rejects(activation(admin, admin, false, true), /42501/);
    assert.equal(
      (await activation(admin, lecturer, false, true)).active,
      false,
    );
    await assert.rejects(rpc(lecturer, "academy_administration"), /42501/);
    const revoked = await delegation(admin, lecturer, false, 1);
    assert.equal(revoked.role, "lecturer");
    assert.equal(revoked.management_version, 2);
    assert.equal((await activation(admin, lecturer, true, false)).active, true);
    assert.equal(await rpc(lecturer, "academy_administration"), null);
    assert.equal(
      await sql(`select count(*) from auth.users where id=${q(lecturer)}`),
      "1",
    );

    const [template, run] = Array.from({ length: 2 }, randomUUID);
    await sql(`insert into public.course_templates(id,title) values(${q(template)},'Retained local course');
      insert into public.course_runs(id,template_id,organisation_id) values(${q(run)},${q(template)},${q(org.id)});
      insert into public.course_enrolments(course_run_id,user_id,status,enrolled_by)
        values(${q(run)},${q(user)},'enrolled',${q(admin)});
      update auth.users set email_confirmed_at=now() where id=${q(user)}`);
    assert.equal(
      (await activation(newManager, user, false, true)).active,
      false,
    );
    await assert.rejects(rpc(user, "academy_administration"), /42501/);
    assert.equal(
      (await activation(newManager, user, true, false)).active,
      true,
    );
    assert.equal(await rpc(user, "academy_administration"), null);
    assert.equal(
      await sql(
        `select status from public.course_enrolments where course_run_id=${q(run)} and user_id=${q(user)}`,
      ),
      "enrolled",
    );
    assert.equal(
      await sql(
        `select status from private.company_participant_memberships where organisation_id=${q(org.id)} and user_id=${q(user)}`,
      ),
      "active",
    );
    await assert.rejects(activation(newManager, manager, false, true), /42501/);

    const contactEmail = "company-contact@example.invalid";
    await assert.rejects(
      reserve(
        newManager,
        randomUUID(),
        contactEmail,
        "client",
        org.id,
        "invite",
      ),
      /42501/,
    );
    const contactRequest = await reserve(
      admin,
      randomUUID(),
      contactEmail,
      "client",
      org.id,
      "invite",
    );
    const contact = randomUUID();
    await sql(
      `insert into auth.users(id,email,email_confirmed_at) values(${q(contact)},${q(contactEmail)},now())`,
    );
    assert.equal(
      (await finish(contactRequest.creation_id, contact, "complete")).status,
      "created",
    );
    assert.equal(
      await sql(
        `select count(*) from public.client_organisation_memberships where user_id=${q(contact)} and organisation_id=${q(org.id)} and removed_at is null`,
      ),
      "1",
    );
    assert.equal(
      (await rpc(admin, "academy_administration")).accounts.find(
        (item) => item.id === contact,
      )?.role,
      "client",
    );
    assert.equal(
      (await rpc(newManager, "academy_administration")).accounts.some(
        (item) => item.id === contact,
      ),
      false,
    );
    await assert.rejects(activation(newManager, contact, false, true), /42501/);

    const [foreignCompany, foreignRun] = Array.from({ length: 2 }, randomUUID);
    await sql(`insert into public.organisations(id,name) values(${q(foreignCompany)},'Unrelated training company');
      insert into public.course_runs(id,template_id,organisation_id) values(${q(foreignRun)},${q(template)},${q(foreignCompany)});`);
    const companyCommand = (creator, request, address, course) =>
      `public.reserve_academy_company_invitation(${q(creator)},${q(request)},${q(address)},'Fictional invited learner',${q(course)})`;
    const companyInvite = async (creator, request, address, course = run) =>
      JSON.parse(
        await sql(`
      begin; set local role service_role; set local request.path='/rpc/reserve_academy_company_invitation';
      set local request.method='POST'; select public.require_portal_access();
      select ${companyCommand(creator, request, address, course)}; commit;`),
      );
    const companyRequest = randomUUID(),
      companyLearnerEmail = "company-learner@example.invalid";
    await assert.rejects(
      actor(
        contact,
        `select ${companyCommand(contact, companyRequest, companyLearnerEmail, run)}`,
      ),
      /42501/,
    );
    await assert.rejects(
      companyInvite(contact, companyRequest, companyLearnerEmail, foreignRun),
      /42501/,
    );
    await assert.rejects(
      companyInvite(lecturer, companyRequest, companyLearnerEmail),
      /42501/,
    );
    await assert.rejects(
      reserve(
        contact,
        companyRequest,
        companyLearnerEmail,
        "participant",
        org.id,
        "invite",
      ),
      /42501/,
    );
    const signedCompanyRequest = await companyInvite(
      contact,
      companyRequest,
      companyLearnerEmail,
    );
    assert.equal(signedCompanyRequest.status, "reserved");
    assert.equal(
      (await companyInvite(contact, companyRequest, companyLearnerEmail))
        .status,
      "in_progress",
    );
    assert.deepEqual(
      await companyInvite(contact, randomUUID(), companyLearnerEmail),
      { status: "requested" },
    );
    await assert.rejects(
      companyInvite(contact, companyRequest, "changed@example.invalid"),
      /PT409/,
    );
    const phoneLearner = randomUUID();
    await sql(
      `insert into auth.users(id,email) values(${q(phoneLearner)},${q(companyLearnerEmail)})`,
    );
    assert.equal(
      (await finish(signedCompanyRequest.creation_id, phoneLearner, "complete"))
        .status,
      "created",
    );
    assert.equal(
      await sql(
        `select count(*) from private.company_participant_memberships where user_id=${q(phoneLearner)} and organisation_id=${q(org.id)} and status='active'`,
      ),
      "1",
    );
    assert.equal(
      await sql(
        `select count(*) from public.course_enrolments where user_id=${q(phoneLearner)}`,
      ),
      "0",
    );
    const pendingCompanyEmail = "company-revoked@example.invalid";
    const pendingCompany = await companyInvite(
      contact,
      randomUUID(),
      pendingCompanyEmail,
    );
    const pendingLearner = randomUUID();
    await sql(`insert into auth.users(id,email) values(${q(pendingLearner)},${q(pendingCompanyEmail)});
      update public.client_organisation_memberships set removed_at=now() where user_id=${q(contact)} and organisation_id=${q(org.id)}`);
    await assert.rejects(
      finish(pendingCompany.creation_id, pendingLearner, "complete"),
      /42501/,
    );
    assert.equal(
      (await finish(pendingCompany.creation_id, pendingLearner, "cleanup"))
        .status,
      "cleanup",
    );
    await sql(`delete from auth.users where id=${q(pendingLearner)};
      update public.client_organisation_memberships set removed_at=null where user_id=${q(contact)} and organisation_id=${q(org.id)};
      update private.academy_account_requests set created_at=now()-interval '16 minutes' where email=${q(contactEmail)};`);
    assert.equal(
      (await finish(pendingCompany.creation_id, pendingLearner, "discard"))
        .status,
      "failed",
    );

    const revokedAdmin = randomUUID();
    const revokedManager = randomUUID();
    const managerToCreate = "reserved-management@example.invalid";
    await sql(`insert into auth.users(id,email,email_confirmed_at)
      values(${q(revokedAdmin)},'revoked-admin@example.invalid',now());
      insert into public.user_roles(user_id,role)
        values(${q(revokedAdmin)},'admin'),(${q(revokedAdmin)},'management')`);
    const pendingManager = await reserve(
      revokedAdmin,
      randomUUID(),
      managerToCreate,
      "management",
      null,
      "password",
    );
    await sql(`delete from public.user_roles where user_id=${q(revokedAdmin)} and role='admin';
      insert into auth.users(id,email,email_confirmed_at) values(${q(revokedManager)},${q(managerToCreate)},now())`);
    await assert.rejects(
      finish(pendingManager.creation_id, revokedManager, "complete"),
      /42501/,
    );
    assert.deepEqual(
      await finish(pendingManager.creation_id, revokedManager, "cleanup"),
      { status: "cleanup", user_id: revokedManager },
    );
    await sql(`delete from auth.users where id=${q(revokedManager)}`);
    assert.deepEqual(
      await finish(pendingManager.creation_id, revokedManager, "discard"),
      { status: "failed" },
    );

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

    const invite = (email) =>
      reserve(admin, randomUUID(), email, "lecturer", null, "invite");
    for (let index = 1; index <= 4; index++) {
      const address = `budget-${index}@example.invalid`;
      assert.equal((await invite(address)).status, "reserved");
      await sql(
        `update private.academy_account_requests set status='failed' where email=${q(address)}`,
      );
      if (index === 1) await assert.rejects(invite(address), /PT429/);
    }
    await assert.rejects(invite("over-actor-budget@example.invalid"), /PT429/);
    await sql(`update private.academy_account_requests set created_at=now()-interval '16 minutes' where mode='invite';
      insert into private.academy_account_requests(installation_id,actor_id,request_id,email,display_name,role,mode,status)
      select ${q(terms.installation_id)},gen_random_uuid(),gen_random_uuid(),'budget-peer-'||number||'@example.invalid',
        'Fictional previous invitation','lecturer','invite','failed' from generate_series(1,20) number;`);
    await assert.rejects(
      invite("over-installation-budget@example.invalid"),
      /PT429/,
    );

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
      companyInvite(contact, randomUUID(), "grace-invite@example.invalid"),
      /42501/,
    );
    await assert.rejects(activation(admin, newManager, false, true), /42501/);
    await assert.rejects(delegation(admin, lecturer, true, 2), /42501/);
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
      `PASS ${edition} local administration, current management authority, retained identity and membership, deactivation and reactivation, licence grace and revocation cleanup`,
    );
  });
}
