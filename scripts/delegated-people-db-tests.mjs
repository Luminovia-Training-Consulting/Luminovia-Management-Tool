/** Exercise the live role, company and qualification boundaries with migrated PostgreSQL. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

const json = (value) => q(JSON.stringify(value)) + "::jsonb";

await withTestDatabase("delegated_people", async ({ sql, actor }) => {
  const roles = [
    "admin",
    "management",
    "client",
    "client",
    "lecturer",
    "participant",
  ];
  const users = roles.map(() => randomUUID());
  const [admin, manager, company, otherCompany, lecturer, learner] = users;
  const [org, foreignOrg, topic] = Array.from({ length: 3 }, randomUUID);
  await sql(`
    insert into auth.users(id,email,email_confirmed_at) values
      ${users.map((id) => `(${q(id)},${q(id + "@example.invalid")},now())`).join(",")};
    insert into public.user_roles(user_id,role) values
      ${users.map((id, i) => `(${q(id)},${q(roles[i])})`).join(",")};
    update public.profiles set display_name='Initial learner' where id=${q(learner)};
    insert into public.organisations(id,name) values
      (${q(org)},'Fictional company'),(${q(foreignOrg)},'Other fictional company');
    insert into public.client_organisation_memberships(user_id,organisation_id) values
      (${q(company)},${q(org)}),(${q(otherCompany)},${q(foreignOrg)});
    insert into public.topics(id,label_de,label_en,kind) values
      (${q(topic)},'Beispielthema','Fictional topic','topic');
  `);
  const call = (who, expression) => actor(who, `select public.${expression}`);
  const expertise = (who, target, add) =>
    call(who, `set_lecturer_expertise(${q(target)},${q(topic)},${add})`);
  const review = () =>
    call(manager, `qualification_review(${q(lecturer)},${q(topic)})`).then(
      JSON.parse,
    );
  const attest = (who, verified, version) =>
    call(
      who,
      `attest_qualification(${q(lecturer)},${q(topic)},${verified},null,null,${version},${q(randomUUID())})`,
    );
  await assert.rejects(expertise(company, lecturer, true), /42501/);
  await assert.rejects(expertise(manager, learner, true), /22023/);
  await expertise(manager, lecturer, true);
  await expertise(admin, lecturer, true);
  assert.equal((await review()).verified, false);
  await attest(manager, true, 0);
  await assert.rejects(expertise(admin, lecturer, false), /PT409/);
  await attest(admin, false, 1);
  await expertise(manager, lecturer, false);
  await assert.rejects(review(), /22023/);
  assert.equal(
    await sql(
      `select count(*) from private.qualification_events where user_id=${q(lecturer)}`,
    ),
    "3",
  );
  await sql(`update public.topics set archived_at=now() where id=${q(topic)}`);
  await assert.rejects(expertise(admin, lecturer, true), /22023/);
  console.log(
    "PASS staff assign expertise independently of verification and preserve the review trail",
  );

  const identify = (who, orgId = org) =>
    call(who, `company_participant_profile(${q(learner)},${q(orgId)})`).then(
      JSON.parse,
    );
  const save = (who, edit, previous) =>
    call(
      who,
      `save_company_participant_profile(${q(learner)},${q(org)},${json(edit)},${json(previous)})`,
    ).then(JSON.parse);
  const premium = (orgId, enabled, version) =>
    call(
      admin,
      `set_company_premium(${q(orgId)},${enabled},${version},${q(randomUUID())})`,
    );
  const publicId = await sql(
    `select luminovia_user_id from public.profiles where id=${q(learner)}`,
  );
  const link = (who, orgId) =>
    call(
      who,
      `request_company_participant_link(${q(orgId)},${q(publicId)},${q(randomUUID())})`,
    );
  const accept = (orgId) =>
    call(
      learner,
      `accept_company_participant_invitation(${q(orgId)},1,${q(randomUUID())})`,
    );

  await premium(org, true, 0);
  await premium(foreignOrg, true, 0);
  await link(company, org);
  await assert.rejects(identify(company), /42501/);
  await accept(org);
  const original = await identify(company);
  const update = {
    display_name: "Fictional learner",
    locale: "en",
    time_zone: "Australia/Brisbane",
  };
  await assert.rejects(identify(otherCompany), /42501/);
  await assert.rejects(save(otherCompany, update, original), /42501/);
  await assert.rejects(
    save(company, { ...update, email: "fake@example.invalid" }, original),
    /22023/,
  );
  assert.deepEqual(await save(company, update, original), update);
  await assert.rejects(save(company, original, original), /40001/);
  assert.equal(
    await sql(`select count(*) from public.audit_events where
    actor_id=${q(company)} and action='account.profile_updated' and resource_id=${q(learner)}
    and details->>'organisation_id'=${q(org)}`),
    "1",
  );
  console.log(
    "PASS company updates only permitted basic fields with a current membership and snapshot",
  );

  await link(otherCompany, foreignOrg);
  await accept(foreignOrg);
  await assert.rejects(identify(company), /42501/);
  await assert.rejects(save(company, original, update), /42501/);
  await assert.rejects(identify(otherCompany, foreignOrg), /42501/);
  assert.deepEqual(await save(manager, original, update), original);
  assert.deepEqual(await save(admin, update, original), update);
  const clientAccount = JSON.parse(
    await call(manager, `managed_profile(${q(company)})`),
  );
  const companyAccountUpdate = {
    ...clientAccount,
    display_name: "Fictional company contact",
  };
  assert.deepEqual(
    JSON.parse(
      await call(
        manager,
        `save_managed_profile(${q(company)},${json(companyAccountUpdate)},${json(clientAccount)})`,
      ),
    ),
    companyAccountUpdate,
  );
  await premium(org, false, 1);
  await assert.rejects(identify(manager), /42501/);
  console.log(
    "PASS shared profiles require staff authority and Premium revocation denies scoped reads",
  );
});
