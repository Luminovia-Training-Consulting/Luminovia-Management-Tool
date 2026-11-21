/** Exercise actual company link request/consent RPCs against migrated PostgreSQL. */
import assert from "node:assert/strict";
import { assertLmsResponse } from "./testing/premium-lms-contract.mjs";
import { randomUUID } from "node:crypto";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

await withTestDatabase("company_participant_link", async ({ sql, actor }) => {
  const [admin, company, outsider, learner, stranger, staff, org, foreign] =
    Array.from({ length: 8 }, randomUUID);
  const identities = [admin, company, outsider, learner, stranger, staff];
  const roles = [
    "admin",
    "client",
    "client",
    "participant",
    "participant",
    "lecturer",
  ];
  await sql(`insert into auth.users(id,email,email_confirmed_at)
    values ${identities.map((id) => `(${q(id)},${q(id + "@example.invalid")},now())`).join(",")};
    insert into public.user_roles(user_id,role)
    values ${identities.map((id, index) => `(${q(id)},${q(roles[index])})`).join(",")};
    insert into public.organisations(id,name) values
      (${q(org)},'Fictional participant link company'),(${q(foreign)},'Fictional unrelated company');
    insert into public.client_organisation_memberships(user_id,organisation_id)
    values(${q(company)},${q(org)}),(${q(outsider)},${q(foreign)});`);

  const call = async (who, expression) =>
    JSON.parse(await actor(who, `select ${expression}`));
  const luminoviaId = (id) =>
    sql(`select luminovia_user_id from public.profiles where id=${q(id)}`);
  const learnerId = await luminoviaId(learner);
  const wrongId = await luminoviaId(staff);
  const request = (who, target, key, organisation = org) =>
    call(
      who,
      `public.request_company_participant_link(${q(organisation)},${q(target)},${q(key)})`,
    );
  const accept = (who, version, key) =>
    call(
      who,
      `public.accept_company_participant_invitation(${q(org)},${version},${q(key)})`,
    );
  const key = randomUUID();
  const consentKey = randomUUID();

  await assert.rejects(request(company, learnerId, key), /42501/);
  await call(
    admin,
    `public.set_company_premium(${q(org)},true,0,${q(randomUUID())})`,
  );
  await assert.rejects(request(outsider, learnerId, key), /42501/);

  const expected = { status: "request_submitted" };
  assert.deepEqual(await request(company, learnerId, key), expected);
  assert.deepEqual(await request(company, learnerId, key), expected);
  await assert.rejects(request(company, wrongId, key), /40001/);
  assert.deepEqual(await request(company, wrongId, randomUUID()), expected);
  assert.deepEqual(
    await request(company, "INVALID-NOT-A-USER", randomUUID()),
    expected,
  );
  assert.equal(
    await sql(
      `select count(*) from private.company_participant_memberships where organisation_id=${q(org)}`,
    ),
    "1",
  );
  assert.equal(
    await sql(
      `select count(*) from private.company_participant_link_requests where requested_by=${q(company)} and request_id=${q(key)}`,
    ),
    "1",
  );

  const invitations = await call(
    learner,
    "public.my_company_participant_invitations()",
  );
  assertLmsResponse("my_company_participant_invitations", invitations);
  assert.equal(invitations.length, 1);
  assert.equal(invitations[0].organisation_id, org);
  assert.equal(invitations[0].source, "luminovia_user_id");
  assert.deepEqual(
    await call(stranger, "public.my_company_participant_invitations()"),
    [],
  );
  await assert.rejects(
    accept(stranger, invitations[0].version, consentKey),
    /42501/,
  );
  await assert.rejects(
    accept(learner, invitations[0].version + 1, consentKey),
    /40001/,
  );
  const accepted = { status: "accepted", organisation_id: org, version: 2 };
  const verifiedAcceptance = await accept(
    learner,
    invitations[0].version,
    consentKey,
  );
  assertLmsResponse(
    "accept_company_participant_invitation",
    verifiedAcceptance,
  );
  assert.deepEqual(verifiedAcceptance, accepted);
  assert.deepEqual(
    await accept(learner, invitations[0].version, consentKey),
    accepted,
  );
  assert.deepEqual(await request(company, learnerId, key), expected);
  assert.deepEqual(
    await call(learner, "public.my_company_participant_invitations()"),
    [],
  );
  assert.equal(
    await sql(
      `select string_agg(role,',') from public.user_roles where user_id=${q(learner)}`,
    ),
    "participant",
  );
  assert.equal(
    await sql(
      `select count(*) from private.company_participant_memberships where organisation_id=${q(foreign)}`,
    ),
    "0",
  );
  assert.equal(
    await sql(
      "select has_function_privilege('authenticated','private.reserve_company_participant_link(uuid,text,uuid)','execute')",
    ),
    "f",
  );
  const removed = await call(
    company,
    `public.remove_company_participant(${q(org)},${q(learner)},2,${q(randomUUID())})`,
  );
  assertLmsResponse("remove_company_participant", removed);
  assert.deepEqual(removed, {
    status: "removed",
    organisation_id: org,
    user_id: learner,
    version: 3,
  });
  console.log(
    "PASS company link request, privacy, current authority, idempotent retry and participant consent",
  );
});
