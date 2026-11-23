/** Real PostgreSQL proof for delegated company/class placement and consent. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

await withTestDatabase("participant_class_placement", async ({ sql, actor }) => {
  const [admin, manager, company, outsider, learner, guest, newUser, org, foreign, first, second, foreignClass] =
    Array.from({ length: 12 }, randomUUID);
  const people = [
    [admin, "admin"], [manager, "management"], [company, "client"],
    [outsider, "client"], [learner, "participant"], [guest, "guest"],
  ];
  const email = (id) => id + "@example.invalid";
  await sql(`insert into auth.users(id,email,email_confirmed_at)
    values ${people.map(([id]) => `(${q(id)},${q(email(id))},now())`).join(",")};
    insert into public.user_roles(user_id,role)
    values ${people.map(([id, role]) => `(${q(id)},${q(role)})`).join(",")};
    insert into public.organisations(id,name) values
      (${q(org)},'Fictional participant class company'),(${q(foreign)},'Fictional other company');
    insert into public.client_organisation_memberships(user_id,organisation_id)
      values (${q(company)},${q(org)}),(${q(outsider)},${q(foreign)});
    insert into private.course_classes(id,organisation_id,name) values
      (${q(first)},${q(org)},'Class A'),(${q(second)},${q(org)},'Class B'),(${q(foreignClass)},${q(foreign)},'Foreign class');`);
  const call = async (who, expression) => JSON.parse(await actor(who, "select " + expression));
  const service = (statement) =>
    sql(`begin;set local role service_role;set local request.jwt.claim.role = 'service_role';${statement};commit;`);
  await call(admin, `public.set_company_premium(${q(org)},true,0,${q(randomUUID())})`);
  const membership = async (id) =>
    JSON.parse(await sql(`select to_jsonb(m) from private.company_participant_memberships m
      where user_id=${q(id)} and organisation_id=${q(org)}`));
  const accept = async (id) => {
    const row = await membership(id);
    assert.equal(row.status, "pending");
    assert.equal(
      (await call(id, `public.accept_company_participant_invitation(${q(org)},${row.version},${q(randomUUID())})`)).status,
      "accepted",
    );
  };

  const role = (who, target, classId) => call(who,
    `public.set_roles_with_participant_company(${q(target)},array['participant'],${q(org)},${q(classId)},null)`);
  await assert.rejects(role(manager, guest, foreignClass), /42501/);
  assert.equal(await sql(`select role from public.user_roles where user_id=${q(guest)}`), "guest");
  await assert.rejects(role(company, guest, first), /42501/);
  await role(manager, guest, first);
  assert.equal((await membership(guest)).class_id, first);
  await accept(guest);

  const selectClass = (who, target, classId, version) => actor(who,
    `select public.set_company_participant_class(${q(org)},${q(target)},${classId ? q(classId) : "null"},${version})`);
  const version = (await membership(guest)).version;
  await assert.rejects(selectClass(company, guest, foreignClass, version), /42501/);
  await assert.rejects(selectClass(outsider, guest, second, version), /42501/);
  await assert.rejects(selectClass(company, learner, second, version), /42501/);
  await selectClass(company, guest, second, version);
  await assert.rejects(selectClass(company, guest, first, version), /PT409/);
  const roster = await call(company, `public.company_participants(${q(org)})`);
  assert.equal(roster[0].class_name, "Class B");
  assert.equal(roster[0].class_id, second);
  await selectClass(manager, guest, null, version + 1);
  assert.equal((await membership(guest)).class_id, null);

  const registrationKey = randomUUID();
  const register = (classId) => call(manager,
    `public.reserve_participant_account_creation(${q(email(newUser))},'Fictional learner',${q(org)},${q(classId)},${q(registrationKey)})`);
  const reserved = await register(first);
  assert.equal(reserved.status, "reserved");
  await assert.rejects(register(second), /40001/);
  await sql(`insert into auth.users(id,email,email_confirmed_at) values(${q(newUser)},${q(email(newUser))},now())`);
  await service(`select public.complete_account_creation(${q(reserved.creation_id)},${q(newUser)},true)`);
  assert.equal((await register(first)).status, "created");
  assert.equal((await membership(newUser)).class_id, first);
  await accept(newUser);

  const invited = randomUUID();
  const invitationKey = randomUUID();
  const reserveInvite = (who, classId) => call(who,
    `public.reserve_class_participant_invitation(${q(org)},${q(email(invited))},'Fictional invitation',${q(invitationKey)},${q(classId)})`);
  await assert.rejects(reserveInvite(outsider, second), /42501/);
  await assert.rejects(reserveInvite(company, foreignClass), /42501/);
  const dispatch = await reserveInvite(company, second);
  assert.equal(dispatch.status, "requested");
  assert.deepEqual(await reserveInvite(company, second), dispatch);
  await assert.rejects(reserveInvite(company, first), /40001/);
  const invitation = JSON.parse(await service(
    `select public.claim_company_participant_invitation(${q(dispatch.request_id)})`,
  ));
  assert.equal(invitation.deliver, true);
  await sql(`insert into auth.users(id,email,email_confirmed_at) values(${q(invited)},${q(email(invited))},now())`);
  await service(`select public.complete_account_invitation(${q(invitation.invitation_id)},${q(invited)},'Fictional learner',true)`);
  assert.equal((await membership(invited)).class_id, second);
  await accept(invited);
  assert.equal(await sql(`select count(*) from public.course_enrolments where user_id in(${q(guest)},${q(newUser)},${q(invited)})`), "0");

  const invitedVersion = (await membership(invited)).version;
  await call(company, `public.remove_company_participant(${q(org)},${q(invited)},${invitedVersion},${q(randomUUID())})`);
  assert.equal((await membership(invited)).class_id, null);
  await assert.rejects(selectClass(company, invited, second, invitedVersion + 1), /42501/);
});
console.log("PASS manager placement, company invitation, consent, stale writes, revocation and cross-company class denial.");
