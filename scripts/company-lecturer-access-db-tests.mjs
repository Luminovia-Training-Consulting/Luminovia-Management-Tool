/** Company/lecturer profiles and direct messages require a persisted assignment relationship. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

const value = (actor, name, args = []) =>
  withActor(actor, `select public.${name}(${args.map(q).join(",")})`);
const withActor = (actor, statement) => actorQuery(actor, statement);
let actorQuery;
const rows = (actor, name, args = []) =>
  withActor(
    actor,
    `select coalesce(json_agg(x),'[]'::json) from public.${name}(${args.map(q).join(",")}) x`,
  ).then(JSON.parse);

await withTestDatabase("company_lecturer_access", async ({ sql, actor }) => {
  actorQuery = actor;
  const [
    client,
    unrelatedClient,
    historicalClient,
    lecturer,
    unrelatedLecturer,
    manager,
    organisation,
    unrelatedOrganisation,
    historicalOrganisation,
    template,
    currentRun,
    historicalRun,
    currentJob,
    historicalJob,
    currentClaim,
    historicalClaim,
    staleRoom,
    staleGroup,
  ] = Array.from({ length: 18 }, randomUUID);
  const users = [
    [client, "client", "Fictional Current Company"],
    [unrelatedClient, "client", "Fictional Unrelated Company"],
    [historicalClient, "client", "Fictional Former Company"],
    [lecturer, "lecturer", "Fictional Lecturer One"],
    [unrelatedLecturer, "lecturer", "Fictional Lecturer Two"],
    [manager, "management", "Fictional Manager"],
  ];
  await sql(`
    insert into auth.users(id,email,email_confirmed_at)
      values ${users.map(([id]) => `(${q(id)},${q(`${id}@example.invalid`)},now())`).join(",")};
    insert into public.user_roles(user_id,role)
      values ${users.map(([id, role]) => `(${q(id)},${q(role)})`).join(",")};
    ${users.map(([id, , name]) => `update public.profiles set display_name=${q(name)} where id=${q(id)};`).join("\n")}
    insert into public.organisations(id,name) values
      (${q(organisation)},'Fictional Current Organisation'),
      (${q(unrelatedOrganisation)},'Fictional Unrelated Organisation'),
      (${q(historicalOrganisation)},'Fictional Historical Organisation');
    insert into public.client_organisation_memberships(user_id,organisation_id) values
      (${q(client)},${q(organisation)}),
      (${q(unrelatedClient)},${q(unrelatedOrganisation)}),
      (${q(historicalClient)},${q(historicalOrganisation)});
    insert into private.company_premium_settings(organisation_id,enabled) values
      (${q(organisation)},true),
      (${q(unrelatedOrganisation)},true),
      (${q(historicalOrganisation)},true);
    insert into public.course_templates(id,title) values (${q(template)},'Fictional Course');
    insert into public.course_runs(id,template_id,organisation_id) values
      (${q(currentRun)},${q(template)},${q(organisation)}),
      (${q(historicalRun)},${q(template)},${q(historicalOrganisation)});
    insert into public.jobs(
      id,course_run_id,title,customer_name,delivery_type,status,amount,currency,
      rate_unit,total_amount,terms
    ) values
      (${q(currentJob)},${q(currentRun)},'Fictional Current Assignment','Current Company','online','filled',0,'EUR','per_hour',0,'Terms'),
      (${q(historicalJob)},${q(historicalRun)},'Fictional Past Assignment','Former Company','online','filled',0,'EUR','per_hour',0,'Terms');
    insert into public.job_claims(
      id,job_id,lecturer_id,idempotency_key,status,amount,currency,rate_unit,
      total_amount,terms,terms_version
    ) values
      (${q(currentClaim)},${q(currentJob)},${q(lecturer)},${q(randomUUID())},'confirmed',0,'EUR','per_hour',0,'Terms',1),
      (${q(historicalClaim)},${q(historicalJob)},${q(lecturer)},${q(randomUUID())},'cancelled',0,'EUR','per_hour',0,'Terms',1);
    insert into public.chat_rooms(id,kind,dm_key)
      values (${q(staleRoom)},'dm',${q(`stale:${staleRoom}`)});
    insert into public.chat_members(room_id,user_id) values
      (${q(staleRoom)},${q(unrelatedClient)}),
      (${q(staleRoom)},${q(lecturer)});
    insert into public.chat_rooms(id,kind,course_run_id)
      values (${q(staleGroup)},'participant_course',${q(historicalRun)});
    insert into public.chat_members(room_id,user_id) values
      (${q(staleGroup)},${q(unrelatedClient)}),
      (${q(staleGroup)},${q(lecturer)});
  `);

  const currentContacts = await rows(client, "chat_contacts");
  assert.deepEqual(
    currentContacts.map((contact) => contact.id),
    [lecturer],
  );
  assert.deepEqual(await rows(unrelatedClient, "chat_contacts"), []);
  // A separate teaching role cannot turn a company account into an unscoped company contact.
  await sql(`insert into public.user_roles(user_id,role) values (${q(unrelatedClient)},'lecturer')`);
  try {
    assert.ok(!(await rows(lecturer, "chat_contacts")).some(({ id }) => id === unrelatedClient));
    assert.ok(!(await rows(unrelatedClient, "chat_contacts")).some(({ id }) => id === lecturer));
    await assert.rejects(value(unrelatedClient, "person_profile", [lecturer]), /42501/);
  } finally {
    await sql(`delete from public.user_roles where user_id=${q(unrelatedClient)} and role='lecturer'`);
  }
  assert.ok(
    !(await rows(lecturer, "chat_contacts")).some(
      (contact) => contact.id === unrelatedClient,
    ),
  );
  assert.deepEqual(
    await rows(historicalClient, "chat_contacts").then((contacts) =>
      contacts.map((contact) => contact.id),
    ),
    [lecturer],
  );
  const lecturerContacts = await rows(lecturer, "chat_contacts");
  assert.ok(lecturerContacts.some((contact) => contact.id === client));
  assert.ok(
    lecturerContacts.some((contact) => contact.id === historicalClient),
  );
  assert.ok(
    !lecturerContacts.some((contact) => contact.id === unrelatedClient),
  );
  assert.ok(
    !(await rows(manager, "chat_contacts")).some(
      (contact) => contact.id === client,
    ),
  );

  const currentProfiles = JSON.parse(await value(client, "people_directory"));
  const unrelatedProfiles = JSON.parse(
    await value(unrelatedClient, "people_directory"),
  );
  const historicalProfiles = JSON.parse(
    await value(historicalClient, "people_directory"),
  );
  assert.deepEqual(
    currentProfiles.map((profile) => profile.id),
    [lecturer],
  );
  assert.deepEqual(unrelatedProfiles, []);
  assert.deepEqual(
    historicalProfiles.map((profile) => profile.id),
    [lecturer],
  );
  await assert.rejects(
    value(client, "person_profile", [unrelatedLecturer]),
    /Profile access denied/i,
  );

  const currentRoom = await value(client, "create_dm", [lecturer]);
  const historicalRoom = await value(historicalClient, "create_dm", [lecturer]);
  const messageId = await value(client, "send_message", [
    currentRoom,
    "Fictional matched message",
    randomUUID(),
  ]);
  const historicalMessageId = await value(historicalClient, "send_message", [
    historicalRoom,
    "Fictional historical message",
    randomUUID(),
  ]);
  const historicalMessages = await rows(lecturer, "chat_messages", [
    historicalRoom,
  ]);
  const currentMessages = await rows(lecturer, "chat_messages", [currentRoom]);
  assert.equal(typeof messageId, "string");
  assert.equal(typeof historicalMessageId, "string");
  assert.ok(
    historicalMessages.some(
      (message) => message.body === "Fictional historical message",
    ),
  );
  assert.ok(
    currentMessages.some(
      (message) => message.body === "Fictional matched message",
    ),
  );
  assert.ok(
    (await rows(lecturer, "chat_rooms_list")).some(
      (room) => room.id === currentRoom,
    ),
  );
  assert.ok(
    (await rows(client, "chat_rooms_list")).some(
      (room) => room.id === currentRoom,
    ),
  );

  await assert.rejects(
    value(client, "create_dm", [unrelatedLecturer]),
    /contact|access denied|not allowed/i,
  );
  await assert.rejects(
    value(unrelatedClient, "create_dm", [lecturer]),
    /contact|access denied|not allowed/i,
  );
  await assert.rejects(
    value(manager, "create_dm", [client]),
    /contact|access denied|not allowed/i,
  );
  assert.ok(
    !(await rows(unrelatedClient, "chat_rooms_list")).some(
      (room) => room.id === staleRoom,
    ),
  );
  assert.equal(
    await actor(
      unrelatedClient,
      `select count(*) from public.chat_rooms where id=${q(staleRoom)}`,
    ),
    "0",
  );
  await assert.rejects(
    value(unrelatedClient, "chat_messages", [staleRoom]),
    /access denied/i,
  );
  await assert.rejects(
    value(unrelatedClient, "send_message", [
      staleRoom,
      "Forged contact",
      randomUUID(),
    ]),
    /access denied/i,
  );
  assert.equal(
    await sql(
      `select count(*) from public.chat_rooms where id=${q(staleRoom)}`,
    ),
    "1",
  );

  // A retained company request can be the only organisation FK for an assignment.
  // A matching free-text customer name is never a substitute for that FK.
  const standaloneJob = randomUUID();
  await sql(`
    insert into public.jobs(id,title,customer_name,delivery_type,status,amount,currency,rate_unit,total_amount,terms)
      values (${q(standaloneJob)},'Fictional Standalone Assignment','Fictional Current Organisation','online','filled',0,'EUR','per_hour',0,'Terms');
    insert into public.job_claims(job_id,lecturer_id,idempotency_key,status,amount,currency,rate_unit,total_amount,terms,terms_version)
      values (${q(standaloneJob)},${q(unrelatedLecturer)},${q(randomUUID())},'cancelled',0,'EUR','per_hour',0,'Terms',1);
  `);
  await assert.rejects(
    value(client, "create_dm", [unrelatedLecturer]),
    /contact|access denied|not allowed/i,
  );
  await sql(`insert into private.client_course_requests(organisation_id,requested_by,client_id,payload,status,job_id)
    values (${q(historicalOrganisation)},${q(historicalClient)},${q(randomUUID())},'{}','published',${q(standaloneJob)})`);
  assert.ok(
    (await rows(historicalClient, "chat_contacts")).some(
      (entry) => entry.id === unrelatedLecturer,
    ),
  );
  assert.ok(
    (await rows(unrelatedLecturer, "chat_contacts")).some(
      (entry) => entry.id === historicalClient,
    ),
  );
  assert.equal(
    JSON.parse(
      await value(historicalClient, "person_profile", [unrelatedLecturer]),
    ).id,
    unrelatedLecturer,
  );
  const standaloneRoom = await value(unrelatedLecturer, "create_dm", [
    historicalClient,
  ]);
  await value(historicalClient, "send_message", [
    standaloneRoom,
    "Fictional retained assignment",
    randomUUID(),
  ]);

  // If sources disagree, neither company inherits contact from that assignment.
  await sql(`insert into private.job_commission_offers(job_id,organisation_id,gross_amount,gross_total_amount,platform_total_amount,lecturer_net_amount,lecturer_net_total_amount,currency)
    values (${q(standaloneJob)},${q(organisation)},100,100,50,50,50,'EUR')`);
  await assert.rejects(
    value(client, "create_dm", [unrelatedLecturer]),
    /contact|access denied|not allowed/i,
  );
  await assert.rejects(
    value(historicalClient, "person_profile", [unrelatedLecturer]),
    /Profile access denied/i,
  );
  await assert.rejects(
    value(unrelatedLecturer, "chat_messages", [standaloneRoom]),
    /access denied/i,
  );

  // Removing membership revokes a previously valid relationship on the same account.
  await sql(`update public.client_organisation_memberships set removed_at=now()
    where user_id=${q(client)} and organisation_id=${q(organisation)}`);
  assert.deepEqual(await rows(client, "chat_contacts"), []);
  await assert.rejects(
    value(lecturer, "chat_messages", [currentRoom]),
    /access denied/i,
  );

  console.log(
    "PASS company/lecturer profile, directory, contact and existing-DM boundaries",
  );
});
