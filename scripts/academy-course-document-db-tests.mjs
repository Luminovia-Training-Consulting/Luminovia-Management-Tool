/** Test scoped course resources, gradebook access and licence changes in both dedicated editions. */
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import { z } from "zod";
import { academyOpenApi } from "../src/features/developer-api/academy-contract.ts";
import { prepareAcademyInstallation } from "./academy-installation.mjs";
import { signAcademyLicence } from "./academy-licence.mjs";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

const path = "/rpc/course_document_access";
const commandPath = "/rpc/academy_course_material_action";
const reservePath = "/rpc/reserve_academy_course_material";
const statusPath = "/rpc/academy_course_material_status";
const scanPath = "/rpc/academy_course_material_scan";
const gate = (target = path, method = "POST") =>
  `set local request.path=${q(target)};set local request.method=${q(method)};select public.require_portal_access();`;
const read = (share, kind = "resource") =>
  `select public.course_document_access(${q(kind)},${q(share)})`;

for (const edition of ["customer-self-hosted", "customer-managed"]) {
  await withTestDatabase("academy_course_document", async ({ sql, actor }) => {
    const [
      installation,
      manager,
      teacher,
      learner,
      outside,
      client,
      otherClient,
      org,
      otherOrg,
      template,
      run,
      otherRun,
      consent,
      document,
      sharedVersion,
      newerVersion,
      unhashedVersion,
      share,
      staffShare,
      clientShare,
      otherShare,
      unscannedShare,
      foreignDocument,
      foreignVersion,
    ] = Array.from({ length: 24 }, randomUUID);
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
        seat_count: 20,
        storage_bytes: 2_000_000,
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
    const v1 = "Fictional first scanned handout.";
    const v2 = "Fictional updated scanned handout.";
    const hash = (text) => createHash("sha256").update(text).digest("hex");
    const objectPath = "fictional/" + sharedVersion;
    const users = [
      [manager, "admin"],
      [teacher, "lecturer"],
      [learner, "participant"],
      [outside, "lecturer"],
      [client, "client"],
      [otherClient, "client"],
    ];
    // The trusted fixture represents retained scanner output and prior shares.
    await sql(`insert into auth.users(id,email,email_confirmed_at) values
      ${users.map(([id]) => `(${q(id)},${q(id + "@example.invalid")},now())`).join(",")};
      insert into public.user_roles(user_id,role) values
      ${users.map(([id, role]) => `(${q(id)},${q(role)})`).join(",")};
      insert into public.organisations(id,name) values
        (${q(org)},'Fictional Academy'),(${q(otherOrg)},'Fictional Other Academy');
      insert into public.client_organisation_memberships(user_id,organisation_id)
        values (${q(client)},${q(org)}),(${q(otherClient)},${q(otherOrg)});
      insert into public.course_templates(id,title) values(${q(template)},'Fictional Workshop');
      insert into public.course_runs(id,template_id,organisation_id)
        values (${q(run)},${q(template)},${q(org)}),(${q(otherRun)},${q(template)},${q(otherOrg)});
      insert into public.course_sessions(course_run_id,starts_at,ends_at)
        values (${q(run)},now()+interval '1 day',now()+interval '25 hours'),
          (${q(otherRun)},now()+interval '3 days',now()+interval '73 hours');
      insert into private.company_participant_link_requests
        (id,organisation_id,requested_by,request_id,luminovia_user_id,target_user_id,status,expires_at)
        select ${q(consent)},${q(org)},${q(manager)},${q(randomUUID())},luminovia_user_id,id,'accepted',now()+interval '1 day'
        from public.profiles where id=${q(learner)};
      insert into private.company_participant_memberships
        (organisation_id,user_id,status,link_request_id,invited_by,joined_at)
        values (${q(org)},${q(learner)},'active',${q(consent)},${q(manager)},now());
      insert into public.course_enrolments(course_run_id,user_id,enrolled_by,status)
        values (${q(run)},${q(learner)},${q(manager)},'enrolled');
      insert into public.documents
        (id,owner_id,uploaded_by,scope,kind,original_name,mime_type,size_bytes,status,client_id)
        values (${q(document)},${q(teacher)},${q(teacher)},'personal','material','current.txt','text/plain',
          ${v2.length},'clean',${q(randomUUID())}),
          (${q(foreignDocument)},${q(outside)},${q(outside)},'personal','material','outside.txt','text/plain',
            ${v1.length},'clean',${q(randomUUID())});
      insert into public.document_versions
        (id,document_id,uploaded_by,client_id,version,object_path,original_name,mime_type,size_bytes,status,sha256,scanner_version)
        values (${q(sharedVersion)},${q(document)},${q(teacher)},${q(randomUUID())},1,${q(objectPath)},
            'first.txt','text/plain',${v1.length},'clean',${q(hash(v1))},'Fictional scanner receipt'),
          (${q(newerVersion)},${q(document)},${q(teacher)},${q(randomUUID())},2,${q("fictional/" + newerVersion)},
            'current.txt','text/plain',${v2.length},'clean',${q(hash(v2))},null),
          (${q(unhashedVersion)},${q(document)},${q(teacher)},${q(randomUUID())},3,${q("fictional/" + unhashedVersion)},
            'unscanned.txt','text/plain',20,'clean',null,'Fictional scanner receipt'),
          (${q(foreignVersion)},${q(foreignDocument)},${q(outside)},${q(randomUUID())},1,${q("fictional/" + foreignVersion)},
            'outside.txt','text/plain',${v1.length},'clean',${q(hash(v1))},'Fictional scanner receipt');
      update public.documents set current_version_id=${q(newerVersion)} where id=${q(document)};
      update public.documents set current_version_id=${q(foreignVersion)} where id=${q(foreignDocument)};
      insert into private.course_resources(id,run_id,version_id,audience,category,created_by,ownership_kind)
        values (${q(share)},${q(run)},${q(sharedVersion)},'participants','material',${q(teacher)},'lecturer'),
          (${q(staffShare)},${q(run)},${q(sharedVersion)},'staff','material',${q(teacher)},'lecturer'),
          (${q(clientShare)},${q(run)},${q(sharedVersion)},'client','material',${q(teacher)},'lecturer'),
          (${q(otherShare)},${q(otherRun)},${q(sharedVersion)},'all','material',${q(manager)},'staff'),
          (${q(unscannedShare)},${q(run)},${q(unhashedVersion)},'all','material',${q(teacher)},'lecturer');`);

    const access = (who, selected = share, kind = "resource") =>
      actor(who, gate() + read(selected, kind)).then(JSON.parse);
    const searchPath = "/rpc/search_course_materials";
    const metadataPath = "/rpc/set_course_material_metadata";
    const metadata = { title: "Fictional catalogue title", description: "", subject: "", licence: "", language: "", tags: ["catalogue-fixture"] };
    const revise = (who, id = share, throughGate = true) =>
      actor(who, (throughGate ? gate(metadataPath) : "") +
        `select public.set_course_material_metadata(${q(id)},0,${q(JSON.stringify(metadata))}::jsonb)`).then(JSON.parse);
    const importPath = "/rpc/import_table_row";
    const search = (who) =>
      actor(who, gate(searchPath) +
        `select public.search_course_materials(${q(run)},null,'material',0)`).then(JSON.parse);
    const enrolmentGate = (who) => actor(who, gate(importPath));
    const shareCall = (id = sharedVersion, course = run, audience = "all") =>
      `select public.academy_course_material_action(${q(course)},'resource_share',${q(id)},${q(audience)},'material')`;
    const command = (who, write = shareCall()) =>
      actor(who, gate(commandPath) + write).then(JSON.parse);
    const removeCall = (id) =>
      `select public.academy_course_material_action(${q(run)},'resource_remove',${q(id)})`;
    const configure = (enabled, release = terms.release_commit) =>
      sql(
        `select private.configure_academy_course_access(${q(installation)},${q(release)},${enabled})`,
      );
    const renew = (changes) =>
      sql(
        `select private.apply_verified_installation_licence(${q(JSON.stringify({ ...terms, ...changes }))}::jsonb)`,
      );
    await assert.rejects(access(manager), /42501/);
    await assert.rejects(actor(manager, read(share)), /42501/);
    await assert.rejects(command(teacher), /42501/);
    await assert.rejects(actor(teacher, shareCall()), /42501/);
    await assert.rejects(search(learner), /42501/);
    await configure(true);
    assert.deepEqual((await search(learner)).map(({ id, can_upload }) => [id, can_upload]), [[share, false]]);
    assert.deepEqual((await search(client)).map(({ id, can_upload }) => [id, can_upload]), [[clientShare, true]]);
    assert.deepEqual(await search(otherClient), []);
    await enrolmentGate(manager);
    await assert.rejects(actor(manager, gate(searchPath, "GET")), /42501/);
    for (const [target, method] of [
      [path, "GET"],
      [path, "HEAD"],
      [commandPath, "GET"],
      [commandPath, "HEAD"],
      ["/documents", "GET"],
      ["/document_versions", "GET"],
      ["/rpc/course_workspace_action", "POST"],
      ["/rpc/reserve_document", "POST"],
      ["/rpc/course_chat_attachment_access", "GET"],
    ]) {
      await assert.rejects(actor(manager, gate(target, method)), /42501/);
    }
    await assert.rejects(sql("set role anon; " + read(share)), /42501/);
    await assert.rejects(
      sql("set role service_role; " + gate() + read(share)),
      /42501/,
    );
    for (const kind of [
      "exam",
      "completion",
      "attendance",
      "wiki_resource",
      "course_chat_attachment",
    ]) {
      await assert.rejects(access(manager, share, kind), /42501/);
      await assert.rejects(actor(manager, read(share, kind)), /42501/);
    }
    const assignment = await actor(
      manager,
      gate("/rpc/academy_assign_course_instructor") +
        `select public.academy_assign_course_instructor(${q(run)},${q(teacher)},${q(randomUUID())})`,
    ).then(JSON.parse);
    assert.equal(assignment.status, "confirmed");
    assert.equal((await search(teacher)).find(({id}) => id === share).can_edit_metadata, true);
    for (const who of [learner, manager, client, outside]) await assert.rejects(revise(who), /42501/);
    await assert.rejects(revise(teacher, unscannedShare), /42501/);
    assert.equal(await revise(teacher), 1);
    assert.deepEqual((await search(learner))[0].metadata, metadata);
    assert.equal((await search(teacher)).find(({id}) => id === staffShare).metadata, null);
    const incoming = "Fictional newly scanned teaching material";
    const digest = hash(incoming);
    const uploadId = randomUUID();
    const reserve = (who, id = uploadId, expected = digest, target = run) =>
      actor(
        who,
        gate(reservePath) +
          `select public.reserve_academy_course_material(${q(target)},'new.txt','text/plain',${incoming.length},${q(id)},${q(expected)})`,
      ).then(JSON.parse);
    const uploadStatus = (who, reservation, target = run) =>
      actor(
        who,
        gate(statusPath) +
          `select public.academy_course_material_status(${q(target)},${q(reservation.document_id)},${q(reservation.version_id)})`,
      ).then((value) => (value ? JSON.parse(value) : null));
    const scanCall = (reservation, action, lease, sha256, scanner) =>
      `select public.academy_course_material_scan(${q(reservation.document_id)},${q(reservation.version_id)},${q(action)},${[lease, sha256, scanner].map((value) => (value ? q(value) : "null")).join(",")})`;
    const worker = (reservation, action, lease, sha256, scanner) =>
      sql(
        "begin;set local role service_role;" +
          gate(scanPath) +
          scanCall(reservation, action, lease, sha256, scanner) +
          ";commit;",
      );
    for (const who of [learner, otherClient, outside]) {
      await assert.rejects(reserve(who), /42501/);
    }
    await assert.rejects(
      reserve(client, randomUUID(), digest, otherRun),
      /42501/,
    );
    const staging = await reserve(teacher);
    assert.equal(staging.status, "quarantined");
    assert.deepEqual(await reserve(teacher), staging);
    await assert.rejects(
      reserve(teacher, uploadId, hash("different")),
      /PT409/,
    );
    await assert.rejects(
      reserve(teacher, undefined, undefined, otherRun),
      /42501/,
    );
    assert.equal(await uploadStatus(outside, staging), null);
    assert.equal(await uploadStatus(teacher, staging, otherRun), null);
    assert.equal(
      (await uploadStatus(teacher, staging)).document.status,
      "quarantined",
    );
    await assert.rejects(
      command(teacher, shareCall(staging.version_id)),
      /42501/,
    );
    await assert.rejects(
      actor(
        teacher,
        gate(scanPath) + scanCall(staging, "begin", null, digest, null),
      ),
      /42501/,
    );
    for (const endpoint of [
      "/documents",
      "/document_versions",
      "/audit_events",
      "/rpc/deletion_upload_begin",
    ]) {
      await assert.rejects(
        sql("set role service_role;" + gate(endpoint)),
        /42501/,
      );
    }
    await assert.rejects(
      worker(staging, "begin", null, hash("different")),
      /42501/,
    );
    const fresh = "ClamAV fictional scanner receipt";
    const lease = await worker(staging, "begin", null, digest);
    assert.match(lease, /^[0-9a-f-]{36}$/);
    await assert.rejects(worker(staging, "begin", null, digest), /55000/);
    assert.equal(
      (await uploadStatus(teacher, staging)).document.status,
      "scanning",
    );
    await assert.rejects(
      worker(staging, "clean", randomUUID(), digest, fresh),
      /42501/,
    );
    await assert.rejects(
      worker(staging, "clean", lease, hash("different"), fresh),
      /42501/,
    );
    await assert.rejects(
      worker(staging, "clean", lease, digest, "untrusted"),
      /42501/,
    );
    await worker(staging, "scan_error", lease);
    await worker(staging, "end", lease);
    assert.equal(
      (await uploadStatus(teacher, staging)).document.status,
      "scan_error",
    );
    const resumed = await worker(staging, "begin", null, digest);
    await worker(staging, "clean", resumed, digest, fresh);
    await worker(staging, "end", resumed);
    const confirmed = await uploadStatus(teacher, staging);
    assert.equal(confirmed.document.status, "clean");
    assert.equal(confirmed.sha256, digest);
    const { paths } = academyOpenApi("https://academy.example.invalid", {
      name: "Fictional Academy",
      installationId: installation,
      edition,
    });
    const checkResponse = (path, response) => {
      const schema =
        paths[path].post.responses["200"].content["application/json"].schema;
      const validation = z.fromJSONSchema(schema).safeParse(response);
      assert.ok(validation.success, `${path}: ${validation.error?.message}`);
    };
    checkResponse("/functions/v1/files", { document: confirmed.document });
    const submissions = (who) =>
      actor(who, gate("/rpc/course_submissions") +
        `select public.course_submissions(${q(run)})`).then(JSON.parse);
    const setSubmissions = (who, enabled) =>
      actor(who, gate("/rpc/set_course_submissions") +
        `select to_jsonb(public.set_course_submissions(${q(run)},${enabled}))`).then(JSON.parse);
    const reserveSubmission = (who, bytes = incoming.length) =>
      actor(who, gate("/rpc/reserve_course_submission") +
        `select public.reserve_course_submission(${q(run)},'fictional-lab.txt','text/plain',${bytes},${q(randomUUID())},${q(digest)})`).then(JSON.parse);
    const submissionAccess = (who, draft) =>
      actor(who, gate("/rpc/course_submission_access") +
        `select public.course_submission_access(${q(run)},${q(draft.version_id)})`).then(JSON.parse);
    const withdrawSubmission = (who, draft) =>
      actor(who, gate("/rpc/withdraw_course_submission") +
        `select to_jsonb(public.withdraw_course_submission(${q(run)},${q(draft.version_id)}))`).then(JSON.parse);
    const submissionWorker = (draft, action, lease = null, sha = null, scanner = null) =>
      sql("begin;set local role service_role;" + gate("/rpc/course_submission_scan") +
        `select public.course_submission_scan(${[draft.document_id, draft.version_id, action, lease, sha, scanner]
          .map((item) => (item === null ? "null" : q(item))).join(",")});commit;`);
    const storagePath = (draft) =>
      sql("begin;set local role service_role;" + gate("/rpc/course_submission_storage_path") +
        `select public.course_submission_storage_path(${q(run)},${q(draft.version_id)});commit;`);
    assert.equal((await submissions(learner)).enabled, false);
    await assert.rejects(reserveSubmission(learner), /42501/);
    await assert.rejects(setSubmissions(otherClient, true), /42501/);
    await assert.rejects(setSubmissions(teacher, true), /42501/);
    const enabled = await setSubmissions(client, true);
    checkResponse("/rest/v1/rpc/set_course_submissions", enabled);
    assert.equal(enabled, true);
    await assert.rejects(reserveSubmission(client), /42501/);
    await assert.rejects(reserveSubmission(learner, 2_000_000), /54000/);
    const learnerDraft = await reserveSubmission(learner);
    const learnerLease = await submissionWorker(learnerDraft, "begin", null, digest);
    await submissionWorker(learnerDraft, "clean", learnerLease, digest, fresh);
    await submissionWorker(learnerDraft, "end", learnerLease);
    const learnerPage = await submissions(learner);
    checkResponse("/rest/v1/rpc/course_submissions", learnerPage);
    assert.equal(learnerPage.entries[0].version_id, learnerDraft.version_id);
    assert.equal(learnerPage.entries[0].participant, null);
    assert.equal((await submissions(teacher)).entries[0].version_id, learnerDraft.version_id);
    assert.equal((await submissions(client)).entries[0].version_id, learnerDraft.version_id);
    await assert.rejects(submissionAccess(outside, learnerDraft), /42501/);
    await assert.rejects(submissionAccess(otherClient, learnerDraft), /42501/);
    const expectedPath = `${learner}/${learnerDraft.document_id}/${learnerDraft.version_id}`;
    assert.equal(await storagePath(learnerDraft), expectedPath);
    assert.equal((await submissionAccess(learner, learnerDraft)).object_path, undefined);
    await assert.rejects(
      actor(teacher, gate("/rpc/course_submission_storage_path") +
        `select public.course_submission_storage_path(${q(run)},${q(learnerDraft.version_id)})`),
      /42501/,
    );
    const scannedSubmission = await actor(learner, gate("/rpc/course_submission_status") +
      `select public.course_submission_status(${q(run)},${q(learnerDraft.document_id)},${q(learnerDraft.version_id)})`
    ).then(JSON.parse);
    checkResponse("/functions/v1/files", {document: scannedSubmission.document});
    const secondSubmission = await reserveSubmission(learner);
    const secondLease = await submissionWorker(secondSubmission, "begin", null, digest);
    await submissionWorker(secondSubmission, "clean", secondLease, digest, fresh);
    await submissionWorker(secondSubmission, "end", secondLease);
    await assert.rejects(withdrawSubmission(otherClient, secondSubmission), /42501/);
    await assert.rejects(withdrawSubmission(teacher, secondSubmission), /42501/);
    const withdrawn = await withdrawSubmission(learner, secondSubmission);
    checkResponse("/rest/v1/rpc/withdraw_course_submission", withdrawn);
    assert.equal(withdrawn, true);
    await assert.rejects(submissionAccess(learner, secondSubmission), /42501/);
    assert.deepEqual((await submissions(teacher)).entries.map((entry) => entry.version_id), [learnerDraft.version_id]);
    const newlyShared = await command(teacher, shareCall(staging.version_id));
    checkResponse("/rest/v1/rpc/academy_course_material_action", newlyShared);
    assert.equal((await access(learner, newlyShared.id)).sha256, digest);
    assert.equal(
      (await access(learner, newlyShared.id)).id,
      staging.version_id,
    );
    for (const [publisher, ownerKind] of [
      [manager, "staff"],
      [client, "company"],
    ]) {
      const draft = await reserve(publisher, randomUUID());
      assert.equal(
        (await uploadStatus(publisher, draft)).document.status,
        "quarantined",
      );
      assert.equal(await uploadStatus(teacher, draft), null);
      const scan = await worker(draft, "begin", null, digest);
      await worker(draft, "clean", scan, digest, fresh);
      await worker(draft, "end", scan);
      const { document: exact } = await uploadStatus(publisher, draft);
      assert.equal(exact.current_version_id, draft.version_id);
      await assert.rejects(
        command(publisher, shareCall(draft.version_id, otherRun)),
        /42501/,
      );
      const share = await command(publisher, shareCall(draft.version_id));
      const ownership = await sql(
        `select ownership_kind from private.course_resources where id=${q(share.id)}`,
      );
      assert.equal(ownership, ownerKind);
      assert.equal((await access(learner, share.id)).id, draft.version_id);
      await assert.rejects(command(teacher, removeCall(share.id)), /42501/);
      if (publisher === client)
        await assert.rejects(command(manager, removeCall(share.id)), /42501/);
      await command(publisher, removeCall(share.id));
      await assert.rejects(access(learner, share.id), /42501/);
    }
    const fromFormerContact = await reserve(client, randomUUID());
    const contactLease = await worker(fromFormerContact, "begin", null, digest);
    await sql(
      `update public.client_organisation_memberships set removed_at=now() where user_id=${q(client)} and organisation_id=${q(org)}`,
    );
    await assert.rejects(
      worker(fromFormerContact, "clean", contactLease, digest, fresh),
      /42501/,
    );
    await worker(fromFormerContact, "end", contactLease);
    assert.equal(await uploadStatus(client, fromFormerContact), null);
    await assert.rejects(
      command(client, shareCall(fromFormerContact.version_id)),
      /42501/,
    );
    await sql(
      `update public.client_organisation_memberships set removed_at=null where user_id=${q(client)} and organisation_id=${q(org)}`,
    );
    const rejected = await reserve(teacher, randomUUID());
    const rejectedLease = await worker(rejected, "begin", null, digest);
    await worker(rejected, "rejected", rejectedLease, digest, fresh);
    await worker(rejected, "end", rejectedLease);
    assert.equal(
      (await uploadStatus(teacher, rejected)).document.status,
      "rejected",
    );
    await assert.rejects(
      command(teacher, shareCall(rejected.version_id)),
      /42501/,
    );
    const pending = await reserve(teacher, randomUUID());
    const pendingLease = await worker(pending, "begin", null, digest);
    await configure(false);
    await assert.rejects(
      worker(pending, "clean", pendingLease, digest, fresh),
      /42501/,
    );
    await worker(pending, "end", pendingLease);
    await configure(true);
    assert.equal(
      (await uploadStatus(teacher, pending)).document.status,
      "scanning",
    );
    for (const who of [manager, learner, outside, client]) {
      await assert.rejects(command(who), /42501/);
    }
    await assert.rejects(sql("set role anon; " + shareCall()), /42501/);
    await assert.rejects(sql("set role service_role; " + shareCall()), /42501/);
    for (const invalidVersion of [
      foreignVersion,
      newerVersion,
      unhashedVersion,
    ]) {
      await assert.rejects(
        command(teacher, shareCall(invalidVersion)),
        /42501/,
      );
    }
    await assert.rejects(
      command(teacher, shareCall(sharedVersion, otherRun)),
      /42501/,
    );
    await assert.rejects(
      command(teacher, shareCall(sharedVersion, run, "public")),
      /22023/,
    );
    await assert.rejects(
      command(
        teacher,
        `select public.academy_course_material_action(${q(run)},'attendance_verify',${q(sharedVersion)})`,
      ),
      /22023/,
    );
    const published = await command(teacher);
    assert.match(published.id, /^[0-9a-f-]{36}$/);
    assert.deepEqual(await command(teacher), published);
    const otherAssignment = await actor(
      manager,
      gate("/rpc/academy_assign_course_instructor") +
        `select public.academy_assign_course_instructor(${q(otherRun)},${q(teacher)},${q(randomUUID())})`,
    ).then(JSON.parse);
    assert.equal(otherAssignment.status, "confirmed");
    await assert.rejects(reserve(teacher, uploadId, digest, otherRun), /PT409/);
    await assert.rejects(
      command(teacher, shareCall(staging.version_id, otherRun)),
      /42501/,
    );
    await assert.rejects(
      actor(
        teacher,
        gate(reservePath) +
          `select public.reserve_academy_course_material(${q(run)},'oversized.txt','text/plain',2000001,${q(randomUUID())},${q(digest)})`,
      ),
      /54000/,
    );
    const exact = {
      id: sharedVersion,
      document_id: document,
      object_path: objectPath,
      name: "first.txt",
      mime_type: "text/plain",
      sha256: hash(v1),
    };
    for (const who of [manager, teacher, learner]) {
      assert.deepEqual(await access(who), exact);
    }
    assert.deepEqual(await access(teacher, staffShare), exact);
    assert.deepEqual(await access(client, clientShare), exact);
    assert.deepEqual(await access(learner, published.id), exact);
    await assert.rejects(command(manager, removeCall(published.id)), /42501/);
    await assert.rejects(command(teacher, removeCall(otherShare)), /42501/);
    assert.deepEqual(
      await command(teacher, removeCall(published.id)),
      published,
    );
    await assert.rejects(access(learner, published.id), /42501/);
    assert.deepEqual(await command(teacher), published);
    assert.deepEqual(await access(learner, published.id), exact);
    await assert.rejects(access(learner, staffShare), /42501/);
    await assert.rejects(access(learner, clientShare), /42501/);
    await assert.rejects(access(otherClient, clientShare), /42501/);
    await assert.rejects(access(client), /42501/);
    await assert.rejects(access(outside), /42501/);
    await assert.rejects(access(learner, otherShare), /42501/);
    await assert.rejects(access(manager, newerVersion), /42501/);
    await assert.rejects(access(manager, unscannedShare), /42501/);
    await sql(
      `update private.course_resources set removed_at=now() where id=${q(share)}`,
    );
    await assert.rejects(access(learner), /42501/);
    await sql(
      `update private.course_resources set removed_at=null where id=${q(share)}`,
    );
    await sql(
      `update public.documents set deleted_at=now() where id=${q(document)}`,
    );
    await assert.rejects(access(manager), /42501/);
    await sql(
      `update public.documents set deleted_at=null where id=${q(document)}`,
    );

    await actor(
      manager,
      gate("/rpc/academy_release_course_instructor") +
        `select public.academy_release_course_instructor(${q(run)},${q(assignment.claim_id)},'Fictional assignment release',${q(randomUUID())})`,
    );
    await assert.rejects(access(teacher), /42501/);
    await assert.rejects(submissionAccess(teacher, learnerDraft), /42501/);
    await assert.rejects(command(teacher), /42501/);
    await assert.rejects(command(teacher, removeCall(published.id)), /42501/);
    assert.deepEqual(await access(learner), exact);
    const nextRelease = "cd".repeat(20);
    await renew({ release_commit: nextRelease, issued_at: date(-7) });
    await assert.rejects(actor(manager, read(share)), /42501/);
    await configure(true, nextRelease);
    const replacement = await actor(
      manager,
      gate("/rpc/academy_assign_course_instructor") +
        `select public.academy_assign_course_instructor(${q(run)},${q(teacher)},${q(randomUUID())})`,
    ).then(JSON.parse);
    assert.equal(replacement.status, "confirmed");
    assert.deepEqual(await command(teacher), published);
    const nextSubmission = await reserveSubmission(learner);
    const nextSubmissionLease = await submissionWorker(nextSubmission, "begin", null, digest);
    const graceReservation = await reserve(teacher, randomUUID());
    const graceLease = await worker(graceReservation, "begin", null, digest);

    // Establish a published grade through the dedicated RPC while the licence is active.
    const gradebook = (who, course = run) =>
      actor(who, gate("/rpc/course_gradebook") +
        `select public.course_gradebook(${q(course)},0,20)`).then(JSON.parse);
    const gradebookHistory = (who, target = null, withGate = true) =>
      actor(who, (withGate ? gate("/rpc/course_gradebook_history") : "") +
        `select public.course_gradebook_history(${q(run)},${target === null ? "null" : q(target)})`).then(JSON.parse);
    const gradebookExport = (who, withGate = true) =>
      actor(who, (withGate ? gate("/rpc/course_gradebook_export") : "") +
        `select public.course_gradebook_export(${q(run)})`).then(JSON.parse);
    const completionStatus = (who, target = null, withGate = true) =>
      actor(who, (withGate ? gate("/rpc/course_completion_status") : "") +
        `select public.course_completion_status(${q(run)},${target === null ? "null" : q(target)})`).then(JSON.parse);
    const learningPath = "/rpc/academy_learning_action";
    const learningCall = (name, payload, version = 0) =>
      `select public.academy_learning_action(${q(run)},${q(name)},${q(JSON.stringify(payload))},${version})`;
    const learningAction = (who, name, payload, version = 0) =>
      actor(who, gate(learningPath) + learningCall(name, payload, version)).then(JSON.parse);
    // The dedicated assignment fixture needs a future session; quiz submissions need a started one.
    await sql(`update public.course_sessions set starts_at=now()-interval '2 hours',ends_at=now()-interval '1 hour'
      where course_run_id=${q(run)}`);
    await learningAction(teacher, "quiz_config", {
      questions: [{ prompt: "Which choice matches the lesson?", options: ["Choice A", "Choice B"], correct: 0 }],
      pass_percent: 80, max_attempts: 2, published: true,
    });
    const attempt = await learningAction(learner, "quiz_attempt", { answers: [0], request_id: randomUUID() }, 1);
    assert.equal(attempt.score, 100);
    const completion = await completionStatus(learner);
    assert.equal(completion.quiz_version, 1);
    assert.equal(completion.quiz_passed, true);
    assert.equal(completion.state, "pending");
    assert.equal(completion.verified_count, 0);
    assert.deepEqual(await completionStatus(teacher, learner), completion);
    await assert.rejects(completionStatus(learner, outside), /42501/);
    await assert.rejects(completionStatus(client, learner), /42501/);
    const policy = { scheme: "percentage", bands: [] };
    assert.equal((await learningAction(teacher, "gradebook_policy", policy)).version, 1);
    const activeGradebook = await gradebook(teacher);
    assert.equal(activeGradebook.can_manage, true);
    assert.equal(activeGradebook.policy.version, 1);
    assert.deepEqual(activeGradebook.learners.map(({ user_id }) => user_id), [learner]);
    const row = activeGradebook.learners[0];
    assert.equal(row.best_attempt.id, attempt.id);
    assert.deepEqual(row.preview, { grade_percent: 100, grade_label: null });
    assert.equal(row.grade, null);
    assert.equal((await gradebook(learner)).own_grade, null);
    for (const who of [client, outside]) await assert.rejects(gradebook(who), /42501/);
    assert.deepEqual((await gradebook(teacher, otherRun)).learners, []);
    await assert.rejects(gradebook(learner, otherRun), /42501/);
    const publish = { user_id: learner, attempt_id: row.best_attempt.id, expected_revision: 0, reason: "" };
    await assert.rejects(learningAction(learner, "gradebook_publish", publish, 1), /42501/);
    await assert.rejects(learningAction(teacher, "gradebook_publish", publish), /PT409/);
    assert.equal((await learningAction(teacher, "gradebook_publish", publish, 1)).revision, 1);
    const correct = { user_id: learner, grade_value: "90", expected_revision: 1, reason: "Fictional reviewed mark" };
    assert.equal((await learningAction(teacher, "gradebook_correct", correct, 1)).revision, 2);
    const publishedGradebook = await gradebook(teacher);
    const learnerGradebook = await gradebook(learner);
    const { reason: correctionReason, ...mark } = publishedGradebook.learners[0].grade;
    assert.equal(correctionReason, correct.reason);
    assert.equal(mark.revision, 2);
    assert.equal(mark.attempt_id, publish.attempt_id);
    assert.equal(mark.grade_percent, 90);
    assert.deepEqual(learnerGradebook, {
      can_manage: false, policy: null, learners: [], own_grade: mark, total: 0, offset: 0, limit: 20,
    });

    const staffHistory = await gradebookHistory(teacher, learner);
    const learnerHistory = await gradebookHistory(learner);
    assert.equal(staffHistory.revisions[0].reason, correct.reason);
    assert.deepEqual(learnerHistory.revisions.map(({ revision }) => revision), [2, 1]);
    assert.ok(learnerHistory.revisions.every((revision) => !Object.hasOwn(revision, "reason")));
    await assert.rejects(gradebookHistory(learner, outside), /42501/);
    await assert.rejects(gradebookHistory(client, learner), /42501/);
    const staffExport = await gradebookExport(teacher);
    assert.deepEqual(staffExport.map(({ user_id, grade }) => ({ user_id, grade })), [{ user_id: learner, grade: mark }]);
    await assert.rejects(gradebookExport(learner), /42501/);

    // The portfolio recipient is one named current instructor; licence grace is read-only.
    const portfolioEntry = randomUUID();
    const portfolio = (who, course = null, withGate = true) =>
      actor(who, (withGate ? gate("/rpc/learning_portfolio") : "") +
        `select public.learning_portfolio(${course === null ? "null" : q(course)})`).then(JSON.parse);
    const portfolioEdit = (who, operation, payload, version = 0) =>
      actor(who, gate("/rpc/learning_portfolio_command") +
        `select public.learning_portfolio_command(${q(portfolioEntry)},${q(operation)},${q(JSON.stringify(payload))},${version})`).then(JSON.parse);
    const note = {title: "Fictional private learning notes", body: "Reviewed practice exercise"};
    await portfolioEdit(learner, "save", note);
    const receipt = await portfolioEdit(learner, "share", {course_id: run, teacher_id: teacher}, 1);
    const sharedPortfolio = await portfolio(teacher, run);
    assert.equal(sharedPortfolio.shares[0].id, receipt.share_id);
    assert.equal(sharedPortfolio.shares[0].body, note.body);
    await assert.rejects(portfolio(manager, run), /42501/);
    assert.deepEqual((await portfolio(teacher)).entries, []);
    const personalPortfolio = await portfolio(learner);

    await renew({
      release_commit: nextRelease,
      issued_at: date(-6),
      expires_at: date(-2),
    });
    assert.deepEqual(await portfolio(teacher, run), sharedPortfolio);
    assert.deepEqual(await portfolio(learner), personalPortfolio);
    await assert.rejects(portfolioEdit(learner, "revoke", {share_id: receipt.share_id}), /42501/);
    await assert.rejects(portfolioEdit(learner, "archive", {state_revision: 0}, 1), /42501/);
    await assert.rejects(actor(learner,
      `select public.learning_portfolio_command(${q(portfolioEntry)},'archive','{"state_revision":0}',1)`), /42501/);
    const graceGradebook = { ...publishedGradebook, can_manage: false };
    assert.deepEqual(await gradebook(teacher), graceGradebook);
    assert.deepEqual(await gradebook(learner), learnerGradebook);
    assert.deepEqual(await gradebookHistory(teacher, learner), staffHistory);
    assert.deepEqual(await gradebookHistory(learner), learnerHistory);
    assert.deepEqual(await gradebookExport(teacher), staffExport);
    assert.deepEqual(await completionStatus(learner), completion);
    assert.deepEqual(await completionStatus(teacher, learner), completion);
    // Both the request gate and the dedicated command enforce read-only grace.
    for (const [name, payload] of [
      ["gradebook_policy", policy],
      ["gradebook_publish", { ...publish, expected_revision: 2, reason: "Reviewed again" }],
      ["gradebook_correct", { ...correct, expected_revision: 2 }],
    ]) {
      await assert.rejects(learningAction(teacher, name, payload, 1), /42501/);
      await assert.rejects(actor(teacher, learningCall(name, payload, 1)), /42501/);
    }
    assert.deepEqual(await gradebook(teacher), graceGradebook);
    assert.deepEqual(await access(learner), exact);
    await assert.rejects(command(teacher), /42501/);
    await assert.rejects(reserve(teacher), /42501/);
    const graceMaterials = await search(teacher);
    assert.ok(graceMaterials.some((row) => row.id === share));
    assert.ok(graceMaterials.every((row) => !row.can_upload));
    assert.ok(graceMaterials.every((row) => !row.can_edit_metadata));
    await assert.rejects(revise(teacher), /42501/);
    await assert.rejects(revise(teacher, share, false), /42501/);
    await assert.rejects(enrolmentGate(manager), /42501/);
    const gracePage = await submissions(learner);
    assert.equal(gracePage.can_upload, false);
    assert.equal(gracePage.entries[0].can_withdraw, false);
    assert.equal((await submissions(client)).can_manage, false);
    assert.equal((await submissionAccess(learner, learnerDraft)).sha256, digest);
    assert.equal(await storagePath(learnerDraft), expectedPath);
    await assert.rejects(setSubmissions(client, false), /42501/);
    await assert.rejects(withdrawSubmission(learner, learnerDraft), /42501/);
    await assert.rejects(reserveSubmission(learner), /42501/);
    await assert.rejects(submissionWorker(nextSubmission, "clean", nextSubmissionLease, digest, fresh), /42501/);
    await submissionWorker(nextSubmission, "end", nextSubmissionLease);
    await assert.rejects(uploadStatus(teacher, staging), /42501/);
    await assert.rejects(
      worker(graceReservation, "clean", graceLease, digest, fresh),
      /42501/,
    );
    await worker(graceReservation, "end", graceLease);
    await assert.rejects(actor(teacher, removeCall(published.id)), /42501/);
    await renew({
      release_commit: nextRelease,
      issued_at: date(-5),
      expires_at: date(-2),
      grace_until: date(-1),
    });
    await assert.rejects(portfolio(learner), /42501/);
    await assert.rejects(portfolio(teacher, run, false), /42501/);
    await assert.rejects(portfolioEdit(learner, "delete", {state_revision: 0, title: note.title}, 1), /42501/);
    await assert.rejects(access(learner), /42501/);
    await assert.rejects(search(learner), /42501/);
    await assert.rejects(submissions(learner), /42501/);
    await assert.rejects(gradebook(learner), /42501/);
    for (const withGate of [true, false]) {
      await assert.rejects(gradebookHistory(teacher, learner, withGate), /42501/);
      await assert.rejects(completionStatus(learner, null, withGate), /42501/);
      await assert.rejects(gradebookExport(teacher, withGate), /42501/);
    }
    await assert.rejects(gradebook(teacher), /42501/);
    assert.equal(await storagePath(learnerDraft), "");
    assert.equal(
      await sql(`select count(*) from private.course_submission_offboard where version_id=${q(learnerDraft.version_id)}`),
      "1",
    );
    await assert.rejects(actor(manager, read(share)), /42501/);
    assert.equal(
      await sql(`select count(*) from private.course_resources
      where id=${q(share)} and version_id=${q(sharedVersion)} and removed_at is null`),
      "1",
    );
    console.log(
      `PASS ${edition} exact course materials, private learner submissions, signed quotas, gradebook, grace and expiry`,
    );
  });
}
