/** Verify live company and template boundaries in a disposable PostgreSQL database. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

await withTestDatabase("company_course_authoring", async ({ sql, actor }) => {
  const [manager, customer, peer, otherCustomer, lecturer, org, otherOrg, internal, multi] =
    Array.from({ length: 9 }, randomUUID);
  const accounts = [
    [manager, "management"],
    [customer, "client"],
    [peer, "client"],
    [otherCustomer, "client"],
    [lecturer, "lecturer"],
    [multi, "client"],
    [multi, "lecturer"],
  ];
  await sql(`
    insert into auth.users(id,email,email_confirmed_at)
      values ${[...new Set(accounts.map(([id]) => id))].map((id) => `(${q(id)},${q(id + "@example.invalid")},now())`).join(",")};
    insert into public.user_roles(user_id,role)
      values ${accounts.map(([id, role]) => `(${q(id)},${q(role)})`).join(",")};
    insert into public.organisations(id,name)
      values (${q(org)},'Fictional company'),(${q(otherOrg)},'Other fictional company');
    insert into public.client_organisation_memberships(user_id,organisation_id)
      values (${q(customer)},${q(org)}),(${q(peer)},${q(org)}),(${q(otherCustomer)},${q(otherOrg)}),
        (${q(multi)},${q(org)}),(${q(multi)},${q(otherOrg)});
    insert into public.course_templates(id,title) values (${q(internal)},'Internal template');
  `);
  const save = (user, kind, target, payload) =>
    actor(user, `select public.save_course_${kind}(${target === null ? "null" : q(target)},${q(JSON.stringify(payload))}::jsonb)`);
  const template = { title: "Fictional Linux practice day", syllabus: "Practise file permissions" };
  const forbidden = /42501/;
  const invalid = /22023/;
  const ownTemplate = await save(customer, "template", null, { ...template, owner_organisation_id: org });
  const edited = { ...template, prerequisites: "Use a practice environment" };
  const otherTemplate = await save(otherCustomer, "template", null, { ...template, owner_organisation_id: otherOrg });
  // An edit needs an explicit company. Membership in the target company is not a substitute.
  await assert.rejects(save(multi, "template", otherTemplate, edited), forbidden);
  await assert.rejects(save(multi, "template", otherTemplate, { ...edited, owner_organisation_id: org }), forbidden);
  assert.equal(await save(multi, "template", otherTemplate, { ...edited, owner_organisation_id: otherOrg }), otherTemplate);
  const ownEdit = { ...edited, owner_organisation_id: org };
  assert.equal(await save(peer, "template", ownTemplate, ownEdit), ownTemplate);
  assert.equal(
    await actor(customer, `select prerequisites from public.course_templates where id=${q(ownTemplate)}`),
    edited.prerequisites,
  );
  assert.equal(await actor(otherCustomer, `select count(*) from public.course_templates where id=${q(ownTemplate)}`), "0");
  assert.equal(await actor(customer, `select count(*) from public.course_templates where id in (${q(otherTemplate)},${q(internal)})`), "0");
  const copy = (user, id) => actor(user, `select public.duplicate_course_template(${q(id)},'Fictional copy')`);
  await assert.rejects(copy(multi, otherTemplate), forbidden);
  await assert.rejects(copy(customer, ownTemplate), forbidden);
  const ownCopy = await copy(manager, ownTemplate);
  const neutralCopy = await copy(manager, internal);
  assert.equal(await actor(customer, `select owner_organisation_id from public.course_templates where id=${q(ownCopy)}`), org);
  assert.equal(await actor(otherCustomer, `select count(*) from public.course_templates where id=${q(ownCopy)}`), "0");
  assert.equal(await sql(`select owner_organisation_id is null from public.course_templates where id=${q(neutralCopy)}`), "t");
  await assert.rejects(save(customer, "template", null, template), forbidden);
  await assert.rejects(save(customer, "template", null, { ...template, owner_organisation_id: otherOrg }), forbidden);
  await assert.rejects(save(customer, "template", ownTemplate, { ...edited, owner_organisation_id: otherOrg }), forbidden);
  await assert.rejects(save(otherCustomer, "template", ownTemplate, ownEdit), forbidden);
  await assert.rejects(save(customer, "template", internal, template), forbidden);
  await assert.rejects(save(lecturer, "template", null, { ...template, owner_organisation_id: org }), forbidden);
  await assert.rejects(save(customer, "template", ownTemplate, { ...ownEdit, building_block_id: randomUUID() }), invalid);

  const draft = {
    template_id: ownTemplate,
    organisation_id: org,
    time_zone: "Europe/Berlin",
    delivery_type: "online",
    venue: "",
    published: false,
    archived: false,
    sessions: [{ starts_at: "2030-03-26T10:00:00+01:00", ends_at: "2030-03-26T12:00:00+01:00" }],
  };
  await assert.rejects(save(customer, "run", null, { ...draft, published: true }), forbidden);
  await assert.rejects(save(customer, "run", null, { ...draft, archived: true }), forbidden);
  await assert.rejects(save(customer, "run", null, { ...draft, organisation_id: otherOrg }), forbidden);
  await assert.rejects(save(multi, "run", null, { ...draft, template_id: otherTemplate }), forbidden);
  await assert.rejects(save(customer, "run", null, { ...draft, template_id: internal }), forbidden);
  await assert.rejects(save(otherCustomer, "run", null, { ...draft, organisation_id: otherOrg }), forbidden);
  await assert.rejects(save(lecturer, "run", null, draft), forbidden);
  await assert.rejects(save(customer, "run", null, { ...draft, sessions: [] }), invalid);
  // Neither global management nor direct maintenance writes can persist a cross-company run.
  await assert.rejects(save(manager, "run", null, { ...draft, template_id: otherTemplate }), invalid);
  await assert.rejects(sql(`update public.course_templates set owner_organisation_id=${q(org)} where id=${q(otherTemplate)}`), invalid);
  assert.ok(await save(manager, "run", null, { ...draft, template_id: neutralCopy }));

  await save(customer, "template", ownTemplate, { ...ownEdit, archived: true });
  await assert.rejects(save(customer, "run", null, draft), forbidden);
  await save(customer, "template", ownTemplate, ownEdit);
  const saved = await save(customer, "run", null, draft);
  assert.equal(await actor(peer, `select published from public.course_runs where id=${q(saved)}`), "f");
  assert.equal(await actor(manager, `select published from public.course_runs where id=${q(saved)}`), "f");
  assert.equal(await actor(peer, `select count(*) from public.course_sessions where course_run_id=${q(saved)}`), "1");
  for (const user of [lecturer, otherCustomer]) {
    assert.equal(await actor(user, `select count(*) from public.course_runs where id=${q(saved)}`), "0");
    assert.equal(await actor(user, `select count(*) from public.course_sessions where course_run_id=${q(saved)}`), "0");
  }
  assert.equal(await sql(`select count(*) from public.jobs where course_run_id=${q(saved)}`), "0");
  await assert.rejects(save(customer, "run", saved, draft), forbidden);
  await assert.rejects(
    actor(customer, `select public.set_course_visibility(${q(saved)},true,false)`),
    forbidden,
  );
  await actor(manager, `select public.set_course_visibility(${q(saved)},true,false)`);
  assert.equal(await actor(lecturer, `select count(*) from public.course_runs where id=${q(saved)}`), "0");
  await assert.rejects(save(customer, "template", ownTemplate, { ...template, owner_organisation_id: org }), /course_locked/);
  assert.equal(await save(manager, "template", ownTemplate, template), ownTemplate);

  await sql(`update public.client_organisation_memberships set removed_at=now() where user_id=${q(customer)}`);
  await assert.rejects(save(customer, "template", ownTemplate, ownEdit), forbidden);
  await assert.rejects(save(customer, "run", null, draft), forbidden);
  assert.equal(await actor(customer, `select count(*) from public.course_templates where id=${q(ownTemplate)}`), "0");
  console.log("PASS company template authoring, private draft, management publication, and live membership isolation");
});
