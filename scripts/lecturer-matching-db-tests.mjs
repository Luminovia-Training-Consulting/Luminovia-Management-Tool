/** Verify teaching preferences, deterministic matching and the actual two allocation guards. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

await withTestDatabase("lecturer_matching", async ({ sql, actor }) => {
  const [admin, expired, suitable, wrongLanguage, unattested, topic, job] =
    Array.from({ length: 7 }, randomUUID);
  await sql(`
    insert into auth.users(id,email,email_confirmed_at)
      values ${[admin, expired, suitable, wrongLanguage, unattested].map((id) => `(${q(id)},${q(id + "@example.invalid")},now())`).join(",")};
    insert into public.user_roles(user_id,role)
      values (${q(admin)},'admin'),(${q(expired)},'lecturer'),(${q(suitable)},'lecturer'),(${q(wrongLanguage)},'lecturer'),(${q(unattested)},'lecturer');
    update public.profiles set time_zone = 'Australia/Brisbane',
      display_name = case id when ${q(expired)} then 'A Expiring lecturer'
        when ${q(suitable)} then 'Z Suitable lecturer' else 'B Other lecturer' end
      where id in (${q(expired)},${q(suitable)},${q(wrongLanguage)});
    insert into public.topics(id,label_de,label_en,kind)
      values (${q(topic)},'Fiktive Pilotqualifikation','Fictional pilot qualification','topic');
    insert into public.lecturer_topics(user_id,topic_id,verified,valid_until)
      values (${q(expired)},${q(topic)},true,'2040-01-03 15:00Z'),
        (${q(suitable)},${q(topic)},true,'2040-01-04 01:00Z'),
        (${q(wrongLanguage)},${q(topic)},true,null),(${q(unattested)},${q(topic)},true,null);
    insert into public.jobs(id,title,customer_name,delivery_type,status,amount,total_amount,currency,rate_unit,terms,capacity,capacity_basis)
      values (${q(job)},'Fictional training block','Fictional College','online','draft',100,100,'EUR','fixed_total','Fictional allocation terms',2,'per_position');
    insert into public.job_sessions(job_id,starts_at,ends_at) values
      (${q(job)},'2040-01-02 23:00Z','2040-01-03 01:00Z'),(${q(job)},'2040-01-03 23:00Z','2040-01-04 01:00Z');
    insert into public.job_requirements(job_id,topic_id) values (${q(job)},${q(topic)});
  `);
  const rpc = async (who, name, ...args) =>
    JSON.parse(
      await actor(
        who,
        `select public.${name}(${args.map((arg) => (arg === null ? "null" : typeof arg === "number" || typeof arg === "boolean" ? String(arg) : typeof arg === "string" ? q(arg) : q(JSON.stringify(arg)) + "::jsonb")).join(",")})`,
      ),
    );
  const prefs = {
    delivery_formats: ["online"],
    teaching_languages: ["de", "en"],
    teaching_days: [2, 3],
    teaching_start: "09:00",
    teaching_end: "12:00",
    urgent_cover: true,
  };
  assert.equal(
    (await rpc(suitable, "own_lecturer_matching_preferences")).version,
    0,
  );
  assert.equal(
    (await rpc(suitable, "save_lecturer_matching_preferences", 0, prefs))
      .version,
    1,
  );
  assert.equal(
    (await rpc(expired, "save_lecturer_matching_preferences", 0, prefs))
      .version,
    1,
  );
  await assert.rejects(
    () => rpc(admin, "own_lecturer_matching_preferences"),
    /42501/,
  );
  await assert.rejects(
    () => rpc(suitable, "save_lecturer_matching_preferences", 0, prefs),
    /40001/,
  );
  assert.deepEqual(
    (await rpc(wrongLanguage, "own_lecturer_matching_preferences"))
      .teaching_languages,
    [],
  );
  await assert.rejects(
    () => actor(expired, "select * from private.lecturer_matching_preferences"),
    /42501/,
  );

  await rpc(unattested, "save_lecturer_matching_preferences", 0, prefs);
  for (const [user, expiry] of [
    [expired, "2040-01-03T15:00:00Z"],
    [suitable, "2040-01-04T01:00:00Z"],
    [wrongLanguage, null],
    [unattested, null],
  ]) {
    const [document, version] = [randomUUID(), randomUUID()];
    await sql(`
      insert into public.documents(id,owner_id,uploaded_by,scope,kind,original_name,mime_type,size_bytes,status,client_id)
      values (${q(document)},${q(user)},${q(user)},'personal','certificate','Qualification.txt','text/plain',3,'clean',${q(randomUUID())});
      insert into public.document_versions(id,document_id,uploaded_by,client_id,version,object_path,original_name,mime_type,size_bytes,status,sha256)
      values (${q(version)},${q(document)},${q(user)},${q(randomUUID())},1,${q("fixture/" + version)},'Qualification.txt','text/plain',3,'clean',repeat('a',64));
    `);
    const bound = await rpc(
      user,
      "save_qualification_evidence",
      topic,
      version,
      0,
      randomUUID(),
    );
    if (user !== unattested) {
      await rpc(
        admin,
        "attest_qualification",
        user,
        topic,
        true,
        expiry,
        bound.evidence.id,
        1,
        randomUUID(),
      );
    }
  }
  const requirement = {
    qualification_topics: [topic],
    teaching_languages: ["en"],
    document_evidence_required: true,
  };
  const before = await rpc(admin, "job_matching_requirements", job);
  await assert.rejects(
    () =>
      rpc(
        expired,
        "save_job_matching_requirements",
        job,
        before.version,
        requirement,
      ),
    /42501/,
  );
  const saved = await rpc(
    admin,
    "save_job_matching_requirements",
    job,
    before.version,
    requirement,
  );
  assert.equal(saved.version, before.version + 1);
  assert.deepEqual(saved.qualification_topics, [topic]);
  await assert.rejects(
    () =>
      rpc(
        admin,
        "save_job_matching_requirements",
        job,
        before.version,
        requirement,
      ),
    /40001/,
  );

  await sql(
    `update public.jobs set status = 'published', urgent_reopened_at = now() where id = ${q(job)}`,
  );
  const version = (await rpc(admin, "job_lifecycle", job)).version;
  await assert.rejects(
    () =>
      rpc(admin, "save_job_matching_requirements", job, version, requirement),
    /42501/,
  );
  const rows = await rpc(admin, "manual_assignment_candidates", job);
  assert.equal(
    rows[0].id,
    suitable,
    "eligible candidates rank ahead of alphabetically earlier blocked people",
  );
  assert.deepEqual(rows[0].match_reasons, [
    "subject",
    "format",
    "weekdays",
    "hours",
    "urgent",
  ]);
  assert.equal(
    rows.find((candidate) => candidate.id === expired).eligibility,
    "not_eligible",
  );
  assert.deepEqual(
    rows.find((candidate) => candidate.id === expired).match_reasons,
    [],
  );
  assert.equal(
    rows.find((candidate) => candidate.id === wrongLanguage).eligibility,
    "not_eligible",
  );
  assert.equal(
    rows.find((candidate) => candidate.id === unattested).eligibility,
    "not_eligible",
    "binding a clean document is not an attestation of that exact document",
  );
  await assert.rejects(
    () => rpc(suitable, "manual_assignment_candidates", job),
    /42501/,
  );

  assert.equal(
    (await rpc(expired, "claim_job", job, randomUUID(), 1)).status,
    "not_eligible",
    "urgent reopen does not bypass a qualification which expires before the last session ends",
  );
  assert.equal(
    (
      await rpc(
        admin,
        "manual_assign_job",
        job,
        wrongLanguage,
        1,
        version,
        randomUUID(),
      )
    ).status,
    "not_eligible",
  );
  const request = randomUUID();
  const accepted = await rpc(
    admin,
    "manual_assign_job",
    job,
    suitable,
    1,
    version,
    request,
  );
  assert.equal(accepted.status, "confirmed");
  assert.equal(
    await sql(
      `select count(*) from public.assignment_sessions where claim_id = ${q(accepted.claim_id)}`,
    ),
    "2",
  );
  // Later qualification expiry never rewrites or removes the committed claim.
  await sql(
    `update public.lecturer_topics set verified = false where user_id = ${q(suitable)} and topic_id = ${q(topic)}`,
  );
  assert.equal(
    (await rpc(admin, "manual_assign_job", job, suitable, 1, version, request))
      .claim_id,
    accepted.claim_id,
  );
  console.log("Lecturer matching SQL checks passed.");
});
