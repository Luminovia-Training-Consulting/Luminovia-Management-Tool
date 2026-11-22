/** Test caller-scoped exact course resources and licence changes in both dedicated editions. */
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
    await configure(true);
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
    const graceReservation = await reserve(teacher, randomUUID());
    const graceLease = await worker(graceReservation, "begin", null, digest);
    await renew({
      release_commit: nextRelease,
      issued_at: date(-6),
      expires_at: date(-2),
    });
    assert.deepEqual(await access(learner), exact);
    await assert.rejects(command(teacher), /42501/);
    await assert.rejects(reserve(teacher), /42501/);
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
    await assert.rejects(access(learner), /42501/);
    await assert.rejects(actor(manager, read(share)), /42501/);
    assert.equal(
      await sql(`select count(*) from private.course_resources
      where id=${q(share)} and version_id=${q(sharedVersion)} and removed_at is null`),
      "1",
    );
    console.log(
      `PASS ${edition} reserve, scan, publish/remove own exact course material, audience and retained files after expiry`,
    );
  });
}
