/** Confirm the licensed exam decision while both editions keep retained PDFs private. */
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import { z } from "zod";
import { academyOpenApi } from "../src/features/developer-api/academy-contract.ts";
import { createCourseDocumentHandler } from "../supabase/functions/course-documents/handler.ts";
import { prepareAcademyInstallation } from "./academy-installation.mjs";
import { signAcademyLicence } from "./academy-licence.mjs";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

const gate = (name, method = "POST") =>
  `set local request.path=${q("/rpc/" + name)};set local request.method=${q(method)};select public.require_portal_access();`;
const endpoint = "set_course_exam_required";

for (const edition of ["customer-self-hosted", "customer-managed"]) {
  await withTestDatabase("academy_student_exam_pdf", async ({ sql, actor }) => {
    const [
      installation,
      manager,
      teacher,
      client,
      stranger,
      learner,
      outside,
      org,
      otherOrg,
      template,
      run,
      otherRun,
      consent,
      document,
      answer,
      paper,
      answerShare,
      paperShare,
    ] = Array.from({ length: 18 }, randomUUID);
    const key = generateKeyPairSync("ed25519");
    const now = Date.now();
    const date = (offset) => new Date(now + offset * 86400000).toISOString();
    const terms = {
      installation_id: installation,
      edition,
      release_commit: "ab".repeat(20),
      issued_at: date(-8),
      starts_at: date(-5),
      expires_at: date(20),
      grace_until: date(25),
      modules: ["lms"],
      limits: {
        seat_count: 15,
        storage_bytes: 1_000_000,
        api_requests_per_minute: 60,
      },
    };
    await prepareAcademyInstallation(
      {
        envelope: signAcademyLicence(terms, key.privateKey),
        publicKey: key.publicKey,
        expected: terms,
        now,
      },
      sql,
    );
    const { paths } = academyOpenApi("https://academy.example.invalid", {
      name: "Fictional Exam Academy",
      installationId: installation,
      edition,
    });
    const response = (name, value) => {
      const schema =
        paths["/rest/v1/rpc/" + name].post.responses["200"].content[
          "application/json"
        ].schema;
      const parsed = z.fromJSONSchema(schema).safeParse(value);
      assert.ok(parsed.success, parsed.error?.message);
      return value;
    };
    const users = [
      [manager, "admin"],
      [teacher, "lecturer"],
      [client, "client"],
      [stranger, "client"],
      [learner, "participant"],
      [outside, "lecturer"],
    ];
    await sql(`insert into auth.users(id,email,email_confirmed_at) values
      ${users.map(([id]) => `(${q(id)},${q(id + "@example.invalid")},now())`).join(",")};
      insert into public.user_roles(user_id,role) values
      ${users.map(([id, role]) => `(${q(id)},${q(role)})`).join(",")};
      insert into public.organisations(id,name) values
        (${q(org)},'Fictional Academy'),(${q(otherOrg)},'Fictional Other Academy');
      insert into public.client_organisation_memberships(user_id,organisation_id)
        values(${q(client)},${q(org)}),(${q(stranger)},${q(otherOrg)});
      insert into public.course_templates(id,title) values(${q(template)},'Fictional exam course');
      insert into public.course_runs(id,template_id,organisation_id) values
        (${q(run)},${q(template)},${q(org)}),(${q(otherRun)},${q(template)},${q(otherOrg)});
      insert into public.course_sessions(course_run_id,starts_at,ends_at) values
        (${q(run)},now()+interval '1 day',now()+interval '25 hours');
      insert into private.company_participant_link_requests
        (id,organisation_id,requested_by,request_id,luminovia_user_id,target_user_id,status,expires_at)
        select ${q(consent)},${q(org)},${q(manager)},${q(randomUUID())},luminovia_user_id,id,'accepted',now()+interval '2 days'
        from public.profiles where id=${q(learner)};
      insert into private.company_participant_memberships
        (organisation_id,user_id,status,link_request_id,invited_by,joined_at)
        values(${q(org)},${q(learner)},'active',${q(consent)},${q(manager)},now());
      insert into public.course_enrolments(course_run_id,user_id,enrolled_by,status)
        values(${q(run)},${q(learner)},${q(manager)},'enrolled');
      insert into public.documents (id,owner_id,uploaded_by,scope,kind,original_name,mime_type,size_bytes,status,client_id)
        values(${q(document)},${q(teacher)},${q(teacher)},'personal','material','fixture.pdf','application/pdf',24,'clean',${q(randomUUID())});
      insert into public.document_versions
        (id,document_id,uploaded_by,client_id,version,object_path,original_name,mime_type,size_bytes,status,sha256)
        values (${q(answer)},${q(document)},${q(teacher)},${q(randomUUID())},1,'fictional/answer.pdf','fictional answer key.pdf','application/pdf',24,'clean',${q("a".repeat(64))}),
          (${q(paper)},${q(document)},${q(teacher)},${q(randomUUID())},2,'fictional/paper.pdf','fictional student paper.pdf','application/pdf',24,'clean',${q("b".repeat(64))});
      insert into private.course_exam_documents(id,run_id,version_id,audience,created_by)
        values(${q(answerShare)},${q(run)},${q(answer)},'exam_staff',${q(teacher)}),
          (${q(paperShare)},${q(run)},${q(paper)},'students',${q(teacher)});`);
    const workspace = (who, course = run) =>
      actor(
        who,
        gate("course_workspace", "GET") +
          `select public.course_workspace(${q(course)})`,
      )
        .then(JSON.parse)
        .then((value) => response("course_workspace", value));
    const write = (required, previous, course = run) =>
      `select public.set_course_exam_required(${q(course)},${required},${previous})`;
    const set = (who, required, previous, course) =>
      actor(who, gate(endpoint) + write(required, previous, course))
        .then(JSON.parse)
        .then((value) => response(endpoint, value));
    const setProfile = (enabled, release = terms.release_commit) =>
      sql(
        `select private.configure_academy_course_access(${q(installation)},${q(release)},${enabled})`,
      );
    const renew = (change) =>
      sql(
        `select private.apply_verified_installation_licence(${q(JSON.stringify({ ...terms, ...change }))}::jsonb)`,
      );
    const projection = (required, version, can_edit) => ({
      required,
      version,
      can_edit,
      documents: [],
    });

    await setProfile(true);
    await actor(
      manager,
      gate("academy_assign_course_instructor") +
        `select public.academy_assign_course_instructor(${q(run)},${q(teacher)},${q(randomUUID())})`,
    );
    const optionsPath = "academy_student_exam_pdf_options";
    const list = (who) =>
      actor(
        who,
        gate(optionsPath) +
          `select public.academy_student_exam_pdf_options(${q(run)})`,
      )
        .then(JSON.parse)
        .then((value) => response(optionsPath, value));
    const share = (who, version, audience = "students") =>
      actor(
        who,
        gate("share_course_exam_pdf") +
          `select public.share_course_exam_pdf(${q(run)},${q(version)},${q(audience)})`,
      ).then((value) => response("share_course_exam_pdf", value));
    const facts = (who, shareId, kind = "exam") =>
      actor(
        who,
        gate("course_document_access") +
          `select public.course_document_access(${q(kind)},${q(shareId)})`,
      ).then(JSON.parse);
    const bytes = new TextEncoder().encode(
      "%PDF-1.7 fictional scanned student paper",
    );
    const digest = createHash("sha256").update(bytes).digest("hex");
    const objectPath = "fictional/student-exact-v1.pdf";
    const [
      own,
      version,
      latest,
      companyDoc,
      companyVersion,
      genericShare,
      unsafeShare,
    ] = Array.from({ length: 7 }, randomUUID);
    const scanner = "ClamAV fictional receipt";
    await sql(`insert into public.documents(id,owner_id,uploaded_by,scope,kind,original_name,mime_type,size_bytes,status,client_id)
      values(${q(own)},${q(teacher)},${q(teacher)},'personal','material','latest.pdf','application/pdf',32,'clean',${q(randomUUID())}),
        (${q(companyDoc)},${q(client)},${q(client)},'personal','material','company.pdf','application/pdf',32,'clean',${q(randomUUID())});
      insert into public.document_versions(id,document_id,uploaded_by,client_id,version,object_path,original_name,mime_type,size_bytes,status,sha256,scanner_version)
      values(${q(version)},${q(own)},${q(teacher)},${q(randomUUID())},1,${q(objectPath)},'exact first paper.pdf','application/pdf',${bytes.length},'clean',${q(digest)},${q(scanner)}),
        (${q(latest)},${q(own)},${q(teacher)},${q(randomUUID())},2,'fictional/latest.pdf','latest.pdf','application/pdf',32,'clean',${q("c".repeat(64))},${q(scanner)}),
        (${q(companyVersion)},${q(companyDoc)},${q(client)},${q(randomUUID())},1,'fictional/company.pdf','company.pdf','application/pdf',32,'clean',${q("d".repeat(64))},${q(scanner)});
      update public.documents set current_version_id=${q(latest)} where id=${q(own)};
      update public.document_versions set scanner_version=${q(scanner)} where id=${q(answer)};
      insert into private.course_resources(id,run_id,version_id,audience,category,created_by)
        values(${q(genericShare)},${q(run)},${q(latest)},'participants','material',${q(teacher)});
      -- A conflicting historical link predating the dedicated exam fence.
      alter table private.course_resources disable trigger guard_course_dedicated_document;
      insert into private.course_resources(id,run_id,version_id,audience,category,created_by)
        values(${q(unsafeShare)},${q(run)},${q(answer)},'participants','material',${q(teacher)});
      alter table private.course_resources enable trigger guard_course_dedicated_document;`);

    const reserveName = "reserve_academy_student_exam_pdf";
    const statusName = "academy_course_material_status";
    const scanName = "academy_course_material_scan";
    const reserve = (
      who,
      key = randomUUID(),
      course = run,
      sha = digest,
      name = "fresh paper.pdf",
      reserveEndpoint = reserveName,
    ) =>
      actor(
        who,
        gate(reserveEndpoint) +
          `select public.${reserveEndpoint}(${q(course)},${q(name)},${bytes.length},${q(key)},${q(sha)})`,
      ).then(JSON.parse);
    const reserveKey = (who, key, course = run) =>
      reserve(
        who,
        key,
        course,
        digest,
        "Staff-only marking guide.pdf",
        "reserve_academy_answer_key_pdf",
      );
    const withdraw = (who, publication, course = run) =>
      actor(
        who,
        gate("remove_course_exam_pdf") +
          `select public.remove_course_exam_pdf(${q(course)},${q(publication)})`,
      );
    const releaseTeacher = (released) =>
      sql(
        `update private.academy_course_instructors set released_at=${released ? "now()" : "null"} where course_id=${q(run)} and instructor_id=${q(teacher)}`,
      );
    const uploadStatus = (who, file, course = run) =>
      actor(
        who,
        gate(statusName) +
          `select public.academy_course_material_status(${q(course)},${q(file.document_id)},${q(file.version_id)})`,
      ).then((value) => (value ? JSON.parse(value) : null));
    const scannerCall = (file, action, lease, sha, receipt) =>
      `select public.academy_course_material_scan(${[file.document_id, file.version_id, action, lease, sha, receipt].map((value) => (value == null ? "null" : q(value))).join(",")})`;
    const worker = (file, action, lease, sha, receipt) =>
      sql(
        "begin;set local role service_role;" +
          gate(scanName) +
          scannerCall(file, action, lease, sha, receipt) +
          ";commit;",
      );
    const materialShare = (who, file) =>
      actor(
        who,
        gate("academy_course_material_action") +
          `select public.academy_course_material_action(${q(run)},'resource_share',${q(file.version_id)},'participants','material')`,
      );

    await assert.rejects(list(teacher), /42501/);
    await assert.rejects(share(teacher, version), /42501/);
    await assert.rejects(reserve(teacher), /42501/);
    await assert.rejects(reserveKey(teacher), /42501/);
    await set(teacher, true, 0);
    assert.deepEqual(await list(teacher), []);
    assert.deepEqual(
      (await list(client)).map(({ id }) => id),
      [companyVersion],
    );
    await assert.rejects(share(teacher, version), /42501/);
    await assert.rejects(share(teacher, answer), /42501/);
    await assert.rejects(share(teacher, paper), /42501/);
    await assert.rejects(share(client, version), /42501/);
    await assert.rejects(share(learner, version), /42501/);
    await assert.rejects(list(learner), /42501/);
    await assert.rejects(list(outside), /42501/);
    await assert.rejects(facts(learner, unsafeShare, "resource"), /42501/);
    assert.doesNotMatch(
      JSON.stringify(await workspace(learner)),
      /fictional answer key/,
    );
    await assert.rejects(facts(teacher, answerShare), /42501/);
    await assert.rejects(facts(learner, paperShare), /42501/);
    await sql(
      `update private.course_resources set removed_at=now() where id=${q(genericShare)}`,
    );
    assert.deepEqual(
      new Set((await list(teacher)).map(({ id }) => id)),
      new Set([version, latest]),
    );
    await assert.rejects(share(teacher, version, "exam_staff"), /42501/);
    await assert.rejects(share(teacher, version), /42501/);
    // Represent an existing publication migrated from before timed exams.
    await sql(`update private.course_exam_settings set allow_untimed_papers=true where run_id=${q(run)}`);
    const published = await share(teacher, version);
    assert.equal(await share(teacher, version), published);
    const companyLegacyShare = await share(client, companyVersion);
    assert.ok(companyLegacyShare);
    await assert.rejects(share(stranger, version), /42501/);
    assert.deepEqual(
      (await list(teacher)).map(({ id }) => id),
      [latest],
    );
    await assert.rejects(
      actor(
        teacher,
        gate("academy_course_material_action") +
          `select public.academy_course_material_action(${q(run)},'resource_share',${q(latest)},'participants','material')`,
      ),
      /42501/,
    );
    await assert.rejects(facts(learner, published, "resource"), /42501/);
    await assert.rejects(facts(outside, published), /42501/);
    assert.deepEqual(await facts(learner, published), {
      id: version,
      document_id: own,
      name: "exact first paper.pdf",
      mime_type: "application/pdf",
      object_path: objectPath,
      sha256: digest,
    });
    assert.equal(
      (await workspace(learner)).exams.documents.find(
        (entry) => entry.id === published,
      ).version_id,
      version,
    );
    assert.doesNotMatch(
      JSON.stringify(await workspace(learner)),
      /latest\.pdf|fictional answer key/,
    );

    // Scoped intake uses the same immutable native worker and clean-version lease.
    for (const who of [learner, stranger, outside])
      await assert.rejects(reserve(who), /42501/);
    await assert.rejects(reserve(client, undefined, otherRun), /42501/);
    await assert.rejects(
      reserve(teacher, undefined, run, digest, "exam.txt"),
      /22023/,
    );
    await assert.rejects(actor(teacher, gate(reserveName, "GET")), /42501/);
    const uploadKey = randomUUID();
    const newPaper = await reserve(teacher, uploadKey);
    assert.equal(newPaper.status, "quarantined");
    assert.deepEqual(await reserve(teacher, uploadKey), newPaper);
    await assert.rejects(
      reserve(teacher, uploadKey, run, "f".repeat(64)),
      /PT409/,
    );
    await assert.rejects(
      actor(
        teacher,
        gate("reserve_academy_course_material") +
          `select public.reserve_academy_course_material(${q(run)},'fresh paper.pdf','application/pdf',${bytes.length},${q(uploadKey)},${q(digest)})`,
      ),
      /PT409/,
    );
    for (const who of [manager, client])
      assert.equal((await reserve(who)).status, "quarantined");
    for (const who of [learner, client, manager])
      assert.equal(await uploadStatus(who, newPaper), null);
    await assert.rejects(share(teacher, newPaper.version_id), /42501/);
    await assert.rejects(
      actor(
        teacher,
        gate(scanName) + scannerCall(newPaper, "begin", null, digest),
      ),
      /42501/,
    );
    await assert.rejects(
      worker(newPaper, "begin", null, "e".repeat(64)),
      /42501/,
    );
    const lease = await worker(newPaper, "begin", null, digest);
    await assert.rejects(
      worker(newPaper, "clean", randomUUID(), digest, scanner),
      /42501/,
    );
    await worker(newPaper, "clean", lease, digest, scanner);
    await worker(newPaper, "end", lease);
    const clean = await uploadStatus(teacher, newPaper);
    assert.equal(clean.document.status, "clean");
    assert.equal(clean.document.current_version_id, newPaper.version_id);
    assert.equal(clean.sha256, digest);
    await assert.rejects(materialShare(teacher, newPaper), /42501/);
    await assert.rejects(
      share(teacher, newPaper.version_id, "exam_staff"),
      /42501/,
    );
    const freshShare = await share(teacher, newPaper.version_id);
    assert.equal(await share(teacher, newPaper.version_id), freshShare);
    assert.equal((await facts(learner, freshShare)).id, newPaper.version_id);
    await assert.rejects(facts(learner, freshShare, "resource"), /42501/);

    const companyPaper = await reserve(client);
    const companyLease = await worker(companyPaper, "begin", null, digest);
    await sql(
      `update public.client_organisation_memberships set removed_at=now() where user_id=${q(client)} and organisation_id=${q(org)}`,
    );
    assert.equal(await uploadStatus(client, companyPaper), null);
    await assert.rejects(
      worker(companyPaper, "clean", companyLease, digest, scanner),
      /42501/,
    );
    await worker(companyPaper, "end", companyLease);
    await sql(
      `update public.client_organisation_memberships set removed_at=null where user_id=${q(client)} and organisation_id=${q(org)}`,
    );
    await assert.rejects(
      worker(companyPaper, "clean", companyLease, digest, scanner),
      /42501/,
    );
    const currentLease = await worker(companyPaper, "begin", null, digest);
    await worker(companyPaper, "clean", currentLease, digest, scanner);
    await worker(companyPaper, "end", currentLease);
    const companyShare = await share(client, companyPaper.version_id);
    assert.equal(
      (await facts(learner, companyShare)).id,
      companyPaper.version_id,
    );

    for (const who of [learner, client, stranger, outside])
      await assert.rejects(reserveKey(who), /42501/);
    assert.equal((await reserveKey(manager)).status, "quarantined");
    await assert.rejects(reserveKey(teacher, uploadKey), /PT409/);
    await assert.rejects(reserveKey(teacher, undefined, otherRun), /42501/);
    const answerKey = await reserveKey(teacher);
    const keyLease = await worker(answerKey, "begin", null, digest);
    await releaseTeacher(true);
    assert.equal(await uploadStatus(teacher, answerKey), null);
    await assert.rejects(
      worker(answerKey, "clean", keyLease, digest, scanner),
      /42501/,
    );
    await worker(answerKey, "end", keyLease);
    await releaseTeacher(false);
    const authorizedLease = await worker(answerKey, "begin", null, digest);
    await worker(answerKey, "clean", authorizedLease, digest, scanner);
    await worker(answerKey, "end", authorizedLease);
    assert.equal(
      (await uploadStatus(teacher, answerKey)).document.current_version_id,
      answerKey.version_id,
    );
    assert.equal(await uploadStatus(manager, answerKey), null);
    assert.equal(await uploadStatus(client, answerKey), null);
    assert.ok(
      !(await list(teacher)).some(({ id }) => id === answerKey.version_id),
    );
    await assert.rejects(share(teacher, answerKey.version_id), /42501/);
    await assert.rejects(materialShare(teacher, answerKey), /42501/);
    await assert.rejects(
      share(client, answerKey.version_id, "exam_staff"),
      /42501/,
    );
    await assert.rejects(
      share(manager, answerKey.version_id, "exam_staff"),
      /42501/,
    );
    const keyShare = await share(teacher, answerKey.version_id, "exam_staff");
    assert.equal(
      await share(teacher, answerKey.version_id, "exam_staff"),
      keyShare,
    );
    for (const who of [learner, client, stranger, outside])
      await assert.rejects(facts(who, keyShare), /42501/);
    assert.equal((await facts(manager, keyShare)).id, answerKey.version_id);
    assert.equal((await facts(teacher, keyShare)).id, answerKey.version_id);
    await assert.rejects(facts(teacher, keyShare, "resource"), /42501/);
    for (const who of [learner, client]) {
      const exams = JSON.stringify((await workspace(who)).exams);
      for (const secret of [
        answerKey.version_id,
        keyShare,
        "Staff-only marking guide.pdf",
        "exam_staff",
      ])
        assert.ok(!exams.includes(secret));
    }
    assert.equal(
      (await workspace(teacher)).exams.documents.find(
        ({ id }) => id === keyShare,
      ).can_remove,
      true,
    );
    assert.equal(
      (await workspace(manager)).exams.documents.find(
        ({ id }) => id === keyShare,
      ).can_remove,
      false,
    );
    await assert.rejects(withdraw(manager, keyShare), /42501/);
    await assert.rejects(withdraw(teacher, keyShare, otherRun), /42501/);
    await releaseTeacher(true);
    await assert.rejects(facts(teacher, keyShare), /42501/);
    await assert.rejects(withdraw(teacher, keyShare), /42501/);
    assert.equal((await facts(manager, keyShare)).id, answerKey.version_id);
    await releaseTeacher(false);
    const racingKeyDownload = createCourseDocumentHandler({
      origins: ["https://academy.example.invalid"],
      authenticate: async () => true,
      rpc: async (_token, _name, args) =>
        facts(teacher, args.p_id, args.p_kind).then(
          (data) => ({ data, error: null }),
          (error) => ({ data: null, error }),
        ),
      download: async (path) => {
        assert.equal(path, (await facts(manager, keyShare)).object_path);
        await releaseTeacher(true);
        return bytes;
      },
      render: () => {
        throw new Error("Unexpected generated answer key");
      },
    });
    const raced = await racingKeyDownload(
      new Request("https://backend.example.invalid/course-documents", {
        method: "POST",
        headers: {
          Origin: "https://academy.example.invalid",
          Authorization: "Bearer fictional-teacher",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ kind: "exam", id: keyShare }),
      }),
    );
    assert.equal(raced.status, 403);
    assert.equal((await raced.json()).error, "document_changed_or_revoked");
    assert.equal(raced.headers.has("content-disposition"), false);
    await releaseTeacher(false);
    await withdraw(teacher, freshShare);
    await assert.rejects(facts(learner, freshShare), /42501/);

    const offPaper = await reserve(teacher);
    const offLease = await worker(offPaper, "begin", null, digest);
    const origin = "https://academy.example.invalid";
    let switchOff = false;
    const handler = createCourseDocumentHandler({
      origins: [origin],
      authenticate: async () => true,
      rpc: async (_token, name, args) => {
        assert.equal(name, "course_document_access");
        return facts(learner, args.p_id, args.p_kind).then(
          (data) => ({ data, error: null }),
          (error) => ({ data: null, error }),
        );
      },
      download: async (path) => {
        assert.equal(path, objectPath);
        if (switchOff)
          assert.deepEqual(await set(teacher, false, 1), {
            required: false,
            version: 2,
          });
        return bytes;
      },
      render: () => {
        throw new Error("Unexpected generated exam");
      },
    });
    const download = () =>
      handler(
        new Request("https://backend.example.invalid/course-documents", {
          method: "POST",
          headers: {
            Origin: origin,
            Authorization: "Bearer fictional-learner",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ kind: "exam", id: published }),
        }),
      );
    const first = await download();
    assert.equal(first.status, 200);
    assert.deepEqual(new Uint8Array(await first.arrayBuffer()), bytes);
    switchOff = true;
    const revoked = await download();
    assert.equal(revoked.status, 403);
    assert.equal((await revoked.json()).error, "document_changed_or_revoked");
    assert.equal(revoked.headers.has("content-disposition"), false);
    assert.deepEqual(
      (await workspace(learner)).exams,
      projection(false, null, false),
    );
    await assert.rejects(list(teacher), /42501/);
    await assert.rejects(share(teacher, version), /42501/);
    await assert.rejects(facts(learner, published), /42501/);
    assert.equal(await uploadStatus(teacher, offPaper), null);
    await assert.rejects(
      worker(offPaper, "clean", offLease, digest, scanner),
      /42501/,
    );
    await worker(offPaper, "end", offLease);
    assert.equal((await facts(teacher, keyShare)).id, answerKey.version_id);
    assert.ok(
      (await workspace(teacher)).exams.documents.some(
        ({ id }) => id === keyShare,
      ),
    );
    await assert.rejects(facts(learner, keyShare), /42501/);
    await withdraw(teacher, keyShare);
    await assert.rejects(facts(teacher, keyShare), /42501/);
    await assert.rejects(facts(manager, keyShare), /42501/);
    assert.equal(
      await sql(
        `select status from public.document_versions where id=${q(answerKey.version_id)}`,
      ),
      "clean",
    );
    await set(teacher, true, 2);
    assert.equal(
      await share(teacher, answerKey.version_id, "exam_staff"),
      keyShare,
    );

    await sql(
      `update public.course_enrolments set status='removed' where course_run_id=${q(run)} and user_id=${q(learner)}`,
    );
    await assert.rejects(facts(learner, published), /42501/);
    await sql(
      `update public.course_enrolments set status='enrolled' where course_run_id=${q(run)} and user_id=${q(learner)}`,
    );
    assert.equal((await facts(learner, published)).id, version);
    await assert.rejects(
      actor(teacher, gate("remove_course_exam_pdf", "GET")),
      /42501/,
    );

    const updatedCompanyVersion = randomUUID();
    await sql(`insert into public.document_versions
      (id,document_id,uploaded_by,client_id,version,object_path,original_name,mime_type,size_bytes,status,sha256,scanner_version)
      values(${q(updatedCompanyVersion)},${q(companyDoc)},${q(client)},${q(randomUUID())},
        2,'fictional/company-updated.pdf','company-updated.pdf','application/pdf',32,'clean',${q("e".repeat(64))},${q(scanner)});
      update public.documents set current_version_id=${q(updatedCompanyVersion)} where id=${q(companyDoc)};`);
    const learnerPublications = async () =>
      (await workspace(learner)).exams.documents.map(({ id }) => id);
    assert.equal((await facts(learner, companyLegacyShare)).id, companyVersion);
    const updatedCompanyShare = await share(client, updatedCompanyVersion);
    assert.equal(
      (await facts(learner, updatedCompanyShare)).id,
      updatedCompanyVersion,
    );
    assert.equal((await facts(learner, published)).id, version);
    assert.equal((await facts(client, companyLegacyShare)).id, companyVersion);
    assert.ok(!(await learnerPublications()).includes(companyLegacyShare));
    await assert.rejects(facts(learner, companyLegacyShare), /42501/);
    await set(client, false, 3);
    assert.deepEqual(await learnerPublications(), []);
    await assert.rejects(facts(learner, updatedCompanyShare), /42501/);
    await set(teacher, true, 4);
    assert.ok((await learnerPublications()).includes(updatedCompanyShare));
    assert.ok(!(await learnerPublications()).includes(companyLegacyShare));
    await withdraw(client, updatedCompanyShare);
    await assert.rejects(facts(learner, companyLegacyShare), /42501/);
    await assert.rejects(facts(learner, updatedCompanyShare), /42501/);
    assert.ok((await learnerPublications()).includes(published));
    assert.equal(
      await sql(
        `select status from public.document_versions where id=${q(companyVersion)}`,
      ),
      "clean",
    );

    const nextRelease = "cd".repeat(20);
    await renew({ release_commit: nextRelease, issued_at: date(-7) });
    await assert.rejects(facts(learner, published), /42501/);
    await setProfile(true, nextRelease);
    await renew({
      release_commit: nextRelease,
      issued_at: date(-6),
      expires_at: date(-2),
    });
    assert.equal((await facts(learner, published)).id, version);
    assert.equal((await workspace(teacher)).exams.can_edit, false);
    assert.equal((await facts(teacher, keyShare)).id, answerKey.version_id);
    assert.equal(
      (await workspace(teacher)).exams.documents.find(
        ({ id }) => id === keyShare,
      ).can_remove,
      false,
    );
    await assert.rejects(facts(learner, keyShare), /42501/);
    await assert.rejects(withdraw(teacher, keyShare), /42501/);
    await assert.rejects(reserveKey(teacher), /42501/);
    await assert.rejects(share(teacher, latest), /42501/);
    await assert.rejects(list(teacher), /42501/);
    await assert.rejects(reserve(teacher), /42501/);
    await renew({
      release_commit: nextRelease,
      issued_at: date(-5),
      expires_at: date(-2),
      grace_until: date(-1),
    });
    await assert.rejects(facts(learner, published), /42501/);
    await assert.rejects(facts(teacher, keyShare), /42501/);
    assert.equal(
      await sql(
        `select count(*) from private.course_exam_documents where run_id=${q(run)} and removed_at is null`,
      ),
      "6",
    );
    console.log(
      `PASS ${edition} exam intake and both audiences, lesson reassignment, scoped withdrawal, exact learner/staff downloads, retention and grace`,
    );
  });
}
