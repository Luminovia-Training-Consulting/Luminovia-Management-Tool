/** Directory expertise visibility on real PostgreSQL with isolated fictional roles. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";
await withTestDatabase("profile_topic_visibility", async ({ sql, actor }) => {
  const owner = randomUUID(),
    peer = randomUUID(),
    admin = randomUUID(),
    client = randomUUID(),
    topic = randomUUID();
  await sql(`insert into auth.users(id,email) values(${q(owner)},'owner@example.invalid'),(${q(peer)},'peer@example.invalid'),(${q(admin)},'admin@example.invalid'),(${q(client)},'client@example.invalid');
 insert into public.user_roles(user_id,role) values(${q(owner)},'lecturer'),(${q(peer)},'lecturer'),(${q(admin)},'admin'),(${q(client)},'client');
 insert into public.topics(id,label_de,label_en,kind) values(${q(topic)},'Fiktives Thema','Fictional topic','topic');
 insert into public.lecturer_topics(user_id,topic_id,verified) values(${q(owner)},${q(topic)},true);`);
  const call = (who, statement, aal = "aal1") =>
    actor(who, statement, aal).then(JSON.parse);
  const profile = (who, target = owner, aal = "aal1") =>
    call(who, `select public.person_profile(${q(target)})`, aal);
  const directory = (who, topicId = null, aal = "aal1") =>
    call(
      who,
      `select public.people_directory('','',${topicId ? q(topicId) : "null"})`,
      aal,
    );
  const preference = (who) =>
    call(who, "select public.profile_topic_preferences()");
  const save = (who, value, version) =>
    call(
      who,
      `select public.save_profile_topic_preferences(${value},${version})`,
    );
  assert.equal((await preference(owner)).visible, true);
  assert.equal((await profile(peer)).topics[0].id, topic);
  assert.ok((await directory(peer, topic)).some((item) => item.id === owner));
  assert.equal((await save(owner, false, 0)).version, 1);
  assert.deepEqual((await profile(peer)).topics, []);
  assert.equal(
    (await directory(peer, topic)).some((item) => item.id === owner),
    false,
  );
  const entry = (await directory(peer)).find((item) => item.id === owner);
  assert.ok(entry);
  assert.deepEqual(entry.topics, []);
  assert.equal((await profile(owner)).topics[0].id, topic);
  assert.equal((await profile(admin)).topics[0].id, topic);
  assert.deepEqual(
    (await profile(admin)).topics,
    (await profile(admin, owner, "aal2")).topics,
    "Current qualification permission applies equally to password-only and higher-assurance sessions",
  );
  assert.equal(
    await actor(
      peer,
      `select count(*) from public.lecturer_topics where user_id=${q(owner)}`,
    ),
    "0",
  );
  assert.equal(
    await actor(
      admin,
      `select count(*) from public.lecturer_topics where user_id=${q(owner)}`,
      "aal2",
    ),
    "1",
  );
  await assert.rejects(profile(client), /42501/);
  await assert.rejects(
    actor(
      peer,
      `select public.save_profile_topic_preferences(false,1,${q(owner)})`,
    ),
    /42883/,
  );
  await assert.rejects(save(owner, true, 0), /40001/);
  const concurrent = await Promise.allSettled([
    save(owner, true, 1),
    save(owner, false, 1),
  ]);
  assert.equal(concurrent.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(
    concurrent.filter(
      (r) => r.status === "rejected" && /40001/.test(String(r.reason)),
    ).length,
    1,
  );
  const saved = await preference(owner);
  assert.equal(saved.version, 2);
  assert.equal((await profile(peer)).topics.length, saved.visible ? 1 : 0);
  assert.equal(
    (await call(owner, "select public.contact_visibility_preferences()"))
      .version,
    0,
    "independent contact version",
  );
  await sql(`update public.profiles set active=false where id=${q(owner)}`);
  await assert.rejects(save(owner, false, 2), /42501/);
  await assert.rejects(preference(owner), /42501/);
  console.log(
    "PASS profile/topic privacy, filter isolation, current MFA, independent settings, forged calls, suspension and concurrent CAS",
  );
});
