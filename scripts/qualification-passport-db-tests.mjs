/** Real isolated PostgreSQL proves own-only passport facts, provenance and
 * revocation without changing ordinary accounts, document bytes or attestations. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";
await withTestDatabase("passport", async ({ sql, actor }) => {
  const [
    teacher,
    peer,
    admin,
    learner,
    verified,
    expired,
    unverified,
    doc,
    version,
  ] = Array.from({ length: 9 }, randomUUID);
  await sql(`insert into auth.users(id,email)values${[teacher, peer, admin, learner].map((id) => `(${q(id)},${q(id + "@example.invalid")})`).join(",")};
    insert into public.user_roles(user_id,role)values(${q(teacher)},'lecturer'),(${q(peer)},'lecturer'),(${q(admin)},'admin'),(${q(learner)},'participant');
    update public.profiles set display_name='Fictional Passport Teacher',phone='PRIVATE PHONE',time_zone='Europe/Berlin' where id=${q(teacher)};
    insert into public.topics(id,label_de,label_en,kind)values(${q(verified)},'Geprüftes Fach','Verified topic','topic'),(${q(expired)},'Abgelaufenes Fach','Expired topic','topic'),(${q(unverified)},'Eigene Auswahl','Own selection','topic');
    insert into public.lecturer_topics(user_id,topic_id,verified,valid_until)values(${q(teacher)},${q(verified)},true,null),(${q(teacher)},${q(expired)},true,now()-interval '1 day'),(${q(teacher)},${q(unverified)},false,null);
    insert into public.documents(id,owner_id,uploaded_by,scope,kind,original_name,mime_type,size_bytes,status,client_id)values(${q(doc)},${q(teacher)},${q(teacher)},'personal','certificate','Exact certificate.txt','text/plain',3,'clean',${q(randomUUID())});
    insert into public.document_versions(id,document_id,uploaded_by,client_id,version,object_path,original_name,mime_type,size_bytes,status,sha256)values(${q(version)},${q(doc)},${q(teacher)},${q(randomUUID())},1,'PRIVATE/OBJECT/PATH','Exact certificate.txt','text/plain',3,'clean',repeat('a',64));`);
  const stamp = await sql("select now()::text");
  const passport = (who = teacher, locale = "de", asOf = stamp, aal = "aal1") =>
    actor(
      who,
      `select public.own_qualification_passport(${q(locale)},${q(asOf)})`,
      aal,
    ).then(JSON.parse);
  let result = await passport();
  assert.deepEqual(
    new Set(result.data.qualifications.map((x) => x.status)),
    new Set(["verified", "expired", "unverified"]),
  );
  assert.equal(
    result.data.qualifications.find((x) => x.topic_id === verified).attestation,
    null,
  );
  assert.deepEqual(await passport(), result);
  assert.match(result.hash, /^[a-f0-9]{64}$/);
  assert.equal(
    await sql(
      `select encode(sha256(convert_to(${q(JSON.stringify(result.data))}::jsonb::text,'UTF8')),'hex')`,
    ),
    result.hash,
  );
  assert.ok(!JSON.stringify(result).includes("PRIVATE"));
  console.log(
    "PASS Exact current states, honest legacy unknown provenance, stable facts/hash and no contact/storage leakage",
  );
  for (const who of [peer, admin])
    assert.deepEqual(
      (await passport(who, "en", stamp, "aal1")).data.qualifications,
      [],
    );
  await assert.rejects(passport(learner), /42501/);
  assert.equal(
    await sql(
      "select has_function_privilege('anon','public.own_qualification_passport(text,timestamptz)','execute')",
    ),
    "f",
  );
  assert.equal(
    await sql(
      "select has_function_privilege('service_role','public.own_qualification_passport(text,timestamptz)','execute')",
    ),
    "f",
  );
  console.log(
    "PASS Peer and permission administrator export only themselves; participant, anonymous and service-role invocation denied",
  );
  const bound = JSON.parse(
    await actor(
      teacher,
      `select public.save_qualification_evidence(${q(verified)},${q(version)},0,${q(randomUUID())})`,
    ),
  );
  await actor(
    admin,
    `select public.attest_qualification(${q(teacher)},${q(verified)},true,null,${q(bound.evidence.id)},1,${q(randomUUID())})`,
    "aal1",
  );
  result = await passport();
  let entry = result.data.qualifications.find((x) => x.topic_id === verified);
  assert.equal(entry.current_evidence_status, "available");
  assert.equal(entry.current_evidence.sha256, "a".repeat(64));
  assert.equal(entry.attestation.basis, "document_evidence");
  assert.equal(entry.attestation.evidence_sha256, "a".repeat(64));
  assert.ok(entry.attestation.at);
  const prior = result.hash;
  await actor(
    teacher,
    `select public.save_qualification_evidence(${q(verified)},null,2,${q(randomUUID())})`,
  );
  result = await passport();
  entry = result.data.qualifications.find((x) => x.topic_id === verified);
  assert.equal(entry.status, "verified");
  assert.equal(entry.current_evidence_status, "none");
  assert.equal(entry.current_evidence, null);
  assert.equal(entry.attestation.evidence_withdrawn, true);
  assert.notEqual(result.hash, prior);
  console.log(
    "PASS Exact certificate provenance stays historical after withdrawal; export never silently changes verification",
  );
  await actor(
    teacher,
    `select public.save_qualification_evidence(${q(verified)},${q(version)},3,${q(randomUUID())})`,
  );
  await sql(
    `update public.document_versions set status='rejected' where id=${q(version)}`,
  );
  entry = (await passport()).data.qualifications.find(
    (x) => x.topic_id === verified,
  );
  assert.equal(entry.current_evidence_status, "unavailable");
  assert.equal(entry.current_evidence, null);
  console.log(
    "PASS Removed/rejected current evidence no longer exposes a current proof projection",
  );
  for (const [locale, asOf] of [
    ["fr", stamp],
    ["de", "2000-01-01T00:00Z"],
    ["de", "2099-01-01T00:00Z"],
    ["de", "infinity"],
  ])
    await assert.rejects(passport(teacher, locale, asOf), /22023/);
  const english = await passport(teacher, "en");
  assert.equal(english.data.locale, "en");
  await sql(`update public.profiles set active=false where id=${q(teacher)}`);
  await assert.rejects(passport(), /42501/);
  console.log(
    "PASS Bounded current server timestamp, strict DE/EN selection and immediate suspension refusal",
  );
  console.log("5 qualification passport PostgreSQL groups passed");
});
