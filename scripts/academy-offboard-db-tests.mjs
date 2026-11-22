/** Validate the portable export's actual SQL projection against a disposable migration replay. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

const exportSql = await readFile(
  new URL("../deploy/academy/offboard.sql", import.meta.url),
  "utf8",
);

function sections(output) {
  const result = new Map();
  let key;
  for (const line of output.split("\n")) {
    if (line.startsWith("@")) {
      key = line.slice(1);
      assert.equal(result.has(key), false);
      result.set(key, []);
    } else {
      result.get(key).push(JSON.parse(line));
    }
  }
  return result;
}

await withTestDatabase("academy_offboard", async ({ sql }) => {
  const [
    instance,
    organisation,
    template,
    course,
    session,
    admin,
    participant,
    unrelated,
    share,
    cleanFile,
    personalFile,
    quarantineFile,
    cleanVersion,
    personalVersion,
    quarantineVersion,
    evidenceFile,
    evidenceVersion,
    evidenceId,
    cohort,
  ] = Array.from({ length: 19 }, randomUUID);
  const roster = Buffer.from("%PDF-1.4\nFictional roster\x00\xff\n");
  const rosterHash = createHash("sha256").update(roster).digest("hex");
  const edition = "customer-managed";
  const commit = "ab".repeat(20);
  const now = Date.now();
  const date = (days) => new Date(now + days * 86400000).toISOString();
  const terms = {
    installation_id: instance,
    edition,
    release_commit: commit,
    issued_at: date(-30),
    starts_at: date(-25),
    expires_at: date(-7),
    grace_until: date(-1),
    modules: ["lms"],
    limits: {
      seat_count: 20,
      storage_bytes: 20000000,
      api_requests_per_minute: 60,
    },
  };
  assert.deepEqual(sections(await sql(exportSql)).get("metadata"), []);
  await sql(`
    select private.provision_customer_installation(${q(instance)},${q(edition)});
    select private.apply_verified_installation_licence(${q(JSON.stringify(terms))}::jsonb);
    alter table auth.users add encrypted_password text;
    insert into auth.users(id,email,email_confirmed_at,encrypted_password) values
      (${q(admin)},'admin@example.invalid',now(),'fixture-password-hash'),
      (${q(participant)},'learner@example.invalid',now(),'fixture-password-hash'),
      (${q(unrelated)},'unrelated@example.invalid',now(),'fixture-password-hash');
    insert into public.user_roles(user_id,role) values
      (${q(admin)},'admin'),(${q(participant)},'participant'),(${q(unrelated)},'lecturer');
    insert into public.organisations(id,name) values(${q(organisation)},'Fictional academy');
    insert into public.course_templates(id,title,syllabus)
      values(${q(template)},'Practical fixture','Line 1 & Ä\nLine 2');
    insert into public.course_runs(id,template_id,organisation_id)
      values(${q(course)},${q(template)},${q(organisation)});
    insert into public.course_sessions(id,course_run_id,starts_at,ends_at)
      values(${q(session)},${q(course)},now()-interval '24 hours',now()-interval '23 hours');
    insert into private.course_classes(id,organisation_id,name)
      values(${q(cohort)},${q(organisation)},'Fictional group');
    insert into private.course_class_assignments(course_id,organisation_id,class_id,version)
      values(${q(course)},${q(organisation)},${q(cohort)},1);
    insert into public.course_enrolments(course_run_id,user_id,status,enrolled_by)
      values(${q(course)},${q(participant)},'completed',${q(admin)});
    insert into private.course_attendance(session_id,user_id,state,minutes,register_status,staff_note)
      values(${q(session)},${q(participant)},'attended',60,'present','fixture-staff-internal-note');
    insert into private.course_notebooks(run_id,user_id,body)
      values(${q(course)},${q(participant)},'fixture-private-notebook');
    insert into public.documents(id,owner_id,uploaded_by,scope,kind,original_name,mime_type,size_bytes,status,client_id)
      values
        (${q(cleanFile)},${q(admin)},${q(admin)},'personal','material','Shared.pdf','application/pdf',25,'clean',gen_random_uuid()),
        (${q(personalFile)},${q(admin)},${q(admin)},'personal','material','Unshared.pdf','application/pdf',25,'clean',gen_random_uuid()),
        (${q(quarantineFile)},${q(admin)},${q(admin)},'personal','material','Held.pdf','application/pdf',25,'quarantined',gen_random_uuid());
    insert into public.document_versions(
      id,document_id,uploaded_by,client_id,version,object_path,original_name,mime_type,size_bytes,sha256,status
    )
    values
      (${q(cleanVersion)},${q(cleanFile)},${q(admin)},gen_random_uuid(),1,${q(`${admin}/${cleanFile}/${cleanVersion}`)},'Shared.pdf','application/pdf',25,repeat('a',64),'clean'),
      (${q(personalVersion)},${q(personalFile)},${q(admin)},gen_random_uuid(),1,${q(`${admin}/${personalFile}/${personalVersion}`)},'Unshared.pdf','application/pdf',25,repeat('b',64),'clean'),
      (${q(quarantineVersion)},${q(quarantineFile)},${q(admin)},gen_random_uuid(),1,${q(`${admin}/${quarantineFile}/${quarantineVersion}`)},'Held.pdf','application/pdf',25,null,'quarantined');
    insert into private.course_resources(id,run_id,version_id,audience,category,created_by)
      values(${q(share)},${q(course)},${q(cleanVersion)},'participants','material',${q(admin)});
    insert into public.documents(id,owner_id,uploaded_by,scope,kind,original_name,mime_type,size_bytes,status,client_id)
      values(${q(evidenceFile)},${q(admin)},${q(admin)},'personal','material','Direct roster.pdf','application/pdf',${roster.length},'clean',gen_random_uuid());
    insert into public.document_versions(
      id,document_id,uploaded_by,client_id,version,object_path,original_name,mime_type,size_bytes,sha256,status,scanner_version
    ) values (
      ${q(evidenceVersion)},${q(evidenceFile)},${q(admin)},gen_random_uuid(),1,
      ${q(`${admin}/${evidenceFile}/${evidenceVersion}`)},'Direct roster.pdf','application/pdf',${roster.length},
      ${q(rosterHash)},'clean','ClamAV fictional'
    );
    update public.documents set current_version_id=${q(evidenceVersion)} where id=${q(evidenceFile)};
    insert into private.academy_course_material_intake(version_id,run_id,release_commit,expected_sha256,purpose,session_id)
      values(${q(evidenceVersion)},${q(course)},${q(commit)},${q(rosterHash)},'attendance_evidence',${q(session)});
    insert into private.course_attendance_evidence(id,session_id,version_id,attached_by,source)
      values(${q(evidenceId)},${q(session)},${q(evidenceVersion)},${q(admin)},'academy_scan');
  `);

  assert.equal(
    JSON.parse(await sql("select public.installation_capabilities()"))
      .licence_status,
    "expired",
  );
  await assert.rejects(sql(`set role authenticated;\n${exportSql}`), /42501/);
  await assert.rejects(sql(`set role service_role;\n${exportSql}`), /42501/);
  const output = await sql(exportSql);
  const records = sections(output);
  const [metadata] = records.get("metadata");
  assert.equal(metadata.installation_id, instance);
  assert.equal(metadata.edition, edition);
  assert.equal(metadata.release, commit);
  assert.deepEqual(
    records.get("participants").map(({ id, email }) => ({ id, email })),
    [{ id: participant, email: "learner@example.invalid" }],
  );
  assert.equal(records.get("courses")[0].id, course);
  assert.deepEqual(
    records.get("templates").map(({ id, syllabus }) => ({ id, syllabus })),
    [{ id: template, syllabus: "Line 1 & Ä\nLine 2" }],
  );
  assert.equal(records.get("enrolments")[0].status, "completed");
  assert.equal(records.get("attendance")[0].session_id, session);
  assert.equal(records.get("classes")[0].id, cohort);
  assert.equal(records.get("class_assignments")[0].class_id, cohort);
  assert.deepEqual(
    new Set(records.get("files").map(({ id }) => id)),
    new Set([cleanVersion, evidenceVersion]),
  );
  const [evidence] = records.get("attendance_evidence");
  assert.equal(evidence.id, evidenceId);
  assert.equal(evidence.version_id, evidenceVersion);
  assert.equal(evidence.resource_id, null);
  assert.equal(evidence.source, "academy_scan");
  const directFile = records
    .get("files")
    .find(({ id }) => id === evidenceVersion);
  assert.equal(directFile.sha256, rosterHash);
  assert.equal(directFile.size_bytes, roster.length);
  assert.deepEqual(
    records.get("file_links").map(({ version_id }) => version_id),
    [cleanVersion],
  );
  assert.deepEqual(records.get("complete"), []);
  for (const excluded of [
    "fixture-password-hash",
    "fixture-private-notebook",
    "fixture-staff-internal-note",
    "Unshared.pdf",
    "Held.pdf",
    "admin@example.invalid",
    "unrelated@example.invalid",
  ]) {
    assert.equal(output.includes(excluded), false);
  }
  assert.equal(await sql("select count(*) from public.document_versions"), "4");
  console.log(
    "PASS expired Academy retains a database-operator export of scoped records and approved files",
  );
});
