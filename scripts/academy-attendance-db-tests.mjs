/** Verify the exact leased academy register and learner privacy for both editions. */
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { z } from "zod";
import { academyOpenApi } from "../src/features/developer-api/academy-contract.ts";
import { prepareAcademyInstallation } from "./academy-installation.mjs";
import { signAcademyLicence } from "./academy-licence.mjs";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

const gate = (name, method = "POST") =>
  `set local request.path=${q("/rpc/" + name)};set local request.method=${q(method)}; select public.require_portal_access();`;
const read = "course_session_register";
const write = "save_course_session_attendance";
const importWrite = "import_course_session_attendance";

for (const edition of ["customer-self-hosted", "customer-managed"]) {
  await withTestDatabase("academy_session_register", async ({ sql, actor }) => {
    const [
      installation,
      manager,
      teacher,
      client,
      foreignClient,
      outside,
      learner,
      peer,
      org,
      foreignOrg,
      template,
      run,
      foreignRun,
      session,
      future,
      foreignSession,
      consent,
      peerConsent,
      document,
      version,
      share,
    ] = Array.from({ length: 21 }, randomUUID);
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
      name: "Fictional Attendance Academy",
      installationId: installation,
      edition,
    });
    const response = (name, value) => {
      const responseSchema =
        paths["/rest/v1/rpc/" + name].post.responses["200"].content[
          "application/json"
        ].schema;
      const parsed = z.fromJSONSchema(responseSchema).safeParse(value);
      assert.ok(parsed.success, parsed.error?.message);
      return value;
    };
    const users = [
      [manager, "admin"],
      [teacher, "lecturer"],
      [client, "client"],
      [foreignClient, "client"],
      [outside, "lecturer"],
      [learner, "participant"],
      [peer, "participant"],
    ];
    await sql(`insert into auth.users(id,email,email_confirmed_at) values
      ${users.map(([id]) => `(${q(id)},${q(id + "@example.invalid")},now())`).join(",")};
      insert into public.user_roles(user_id,role) values
      ${users.map(([id, role]) => `(${q(id)},${q(role)})`).join(",")};
      update public.profiles set display_name='Fictional learner' where id=${q(learner)};
      update public.profiles set display_name='Fictional other learner' where id=${q(peer)};
      insert into public.organisations(id,name) values
        (${q(org)},'Fictional Academy'),(${q(foreignOrg)},'Fictional Partner');
      insert into public.client_organisation_memberships(user_id,organisation_id)
        values(${q(client)},${q(org)}),(${q(foreignClient)},${q(foreignOrg)});
      insert into public.course_templates(id,title) values(${q(template)},'Fictional exact register');
      insert into public.course_runs(id,template_id,organisation_id,time_zone)
        values(${q(run)},${q(template)},${q(org)},'Australia/Brisbane'),
          (${q(foreignRun)},${q(template)},${q(foreignOrg)},'Australia/Brisbane');
      insert into public.course_sessions(id,course_run_id,starts_at,ends_at) values
        (${q(session)},${q(run)},now()+interval '1 day',now()+interval '25 hours'),
        (${q(future)},${q(run)},now()+interval '2 days',now()+interval '49 hours'),
        (${q(foreignSession)},${q(foreignRun)},now()+interval '3 days',now()+interval '73 hours');
      ${[
        [learner, consent],
        [peer, peerConsent],
      ]
        .map(
          ([member, association]) => `
      insert into private.company_participant_link_requests
        (id,organisation_id,requested_by,request_id,luminovia_user_id,target_user_id,status,expires_at)
        select ${q(association)},${q(org)},${q(manager)},${q(randomUUID())},luminovia_user_id,id,'accepted',now()+interval '2 days'
        from public.profiles where id=${q(member)};
      insert into private.company_participant_memberships
        (organisation_id,user_id,status,link_request_id,invited_by,joined_at)
        values(${q(org)},${q(member)},'active',${q(association)},${q(manager)},now());
      insert into public.course_enrolments(course_run_id,user_id,enrolled_by,status)
        values(${q(run)},${q(member)},${q(manager)},'enrolled');`,
        )
        .join("")}`);

    const register = (who, exact = session, course = run, method = "POST") =>
      actor(
        who,
        gate(read, method) +
          `select public.course_session_register(${q(course)},${q(exact)})`,
      )
        .then(JSON.parse)
        .then((value) => response(read, value));
    const saveSql = (
      status,
      expected,
      {
        exact = session,
        target = learner,
        note = "",
        reason = "",
        arrival = "null",
      } = {},
    ) =>
      `select public.save_course_session_attendance(${q(run)},${q(exact)},${q(target)},${q(status)},${arrival},null,${q(note)},${q(reason)},${expected})`;
    const save = (who, status, expected, options = {}) =>
      actor(who, gate(write) + saveSql(status, expected, options))
        .then(JSON.parse)
        .then((value) => response(write, value));
    const importSql = (rows, exact, course) =>
      `select public.import_course_session_attendance(${q(course)},${q(exact)},${q(JSON.stringify(rows))}::jsonb)`;
    const importRows = (who, rows, exact = session, course = run) =>
      actor(who, gate(importWrite) + importSql(rows, exact, course))
        .then(JSON.parse)
        .then((value) => response(importWrite, value));
    const report = (who, exact = session) =>
      actor(
        who,
        gate("course_document_access") +
          `select public.course_document_access('attendance',${q(exact)})`,
      ).then(JSON.parse);
    const importedEntry = (userId, expectedVersion) => ({
      user_id: userId,
      expected_version: expectedVersion,
      status: "excused",
      arrival_at: null,
      departure_at: null,
      note: "Fictional imported register entry",
      reason: "Confirmed structured record",
    });
    const row = (register, id = learner) =>
      register.rows.find((entry) => entry.user_id === id);
    const setProfile = (enabled, release = terms.release_commit) =>
      sql(
        `select private.configure_academy_course_access(${q(installation)},${q(release)},${enabled})`,
      );
    const renew = (change) =>
      sql(
        `select private.apply_verified_installation_licence(${q(JSON.stringify({ ...terms, ...change }))}::jsonb)`,
      );
    await assert.rejects(register(manager), /42501/);
    await assert.rejects(report(manager), /42501/);
    await assert.rejects(actor(manager, saveSql("present", 0)), /42501/);
    await assert.rejects(
      actor(manager, importSql([importedEntry(learner, 0)], session, run)),
      /42501/,
    );
    await setProfile(true);
    for (const who of [learner, peer, foreignClient, teacher, outside]) {
      await assert.rejects(register(who), /42501/);
      await assert.rejects(save(who, "absent", 0), /42501/);
      await assert.rejects(
        importRows(who, [importedEntry(learner, 0)]),
        /42501/,
      );
    }
    const assignment = await actor(
      manager,
      gate("academy_assign_course_instructor") +
        `select public.academy_assign_course_instructor(${q(run)},${q(teacher)},${q(randomUUID())})`,
    ).then(JSON.parse);
    assert.equal(assignment.status, "confirmed");
    assert.equal((await register(client, session, run, "GET")).rows.length, 2);
    assert.equal((await register(teacher)).time_zone, "Australia/Brisbane");
    for (const who of [learner, peer, foreignClient, outside]) {
      await assert.rejects(report(who), /42501/);
    }
    await assert.rejects(report(teacher, foreignSession), /42501/);
    await assert.rejects(report(client, foreignSession), /42501/);
    await assert.rejects(report(manager, run), /42501/);
    await assert.rejects(register(teacher, foreignSession), /42501/);
    await assert.rejects(register(client, foreignSession, foreignRun), /42501/);
    await assert.rejects(save(teacher, "present", 0), /42501/);
    await assert.rejects(
      importRows(teacher, [importedEntry(learner, 0)]),
      /42501/,
    );
    for (const blocked of [
      "course_workspace_action",
      "attach_course_session_evidence",
    ]) {
      await assert.rejects(actor(manager, gate(blocked)), /42501/);
    }
    await assert.rejects(actor(teacher, gate(write, "GET")), /42501/);
    await assert.rejects(actor(teacher, gate(write, "HEAD")), /42501/);
    await assert.rejects(actor(teacher, gate(importWrite, "GET")), /42501/);
    await assert.rejects(actor(teacher, gate(importWrite, "HEAD")), /42501/);
    await assert.rejects(sql("set role service_role; " + gate(read)), /42501/);
    await assert.rejects(
      sql("set role service_role; " + gate(importWrite)),
      /42501/,
    );

    // Move the first fixture session across its start for register acceptance.
    // Leave the technical allocation pending so its ordinary release is tested below.
    await sql(`update public.course_sessions set starts_at=now()-interval '2 hours',ends_at=now()-interval '1 hour' where id=${q(session)};
      insert into public.documents (id,owner_id,uploaded_by,scope,kind,original_name,mime_type,size_bytes,status,client_id)
      values(${q(document)},${q(teacher)},${q(teacher)},'personal','material','private attendance.pdf','application/pdf',25,'clean',${q(randomUUID())});
      insert into public.document_versions (id,document_id,uploaded_by,client_id,version,object_path,original_name,mime_type,size_bytes,status,sha256)
      values(${q(version)},${q(document)},${q(teacher)},${q(randomUUID())},1,'fictional/attendance.pdf','private attendance.pdf','application/pdf',25,'clean',${q("b".repeat(64))});
      insert into private.course_resources(id,run_id,version_id,audience,category,created_by)
      values(${q(share)},${q(run)},${q(version)},'client','report',${q(teacher)});
      insert into private.course_attendance_evidence(session_id,resource_id,version_id,attached_by)
      values(${q(session)},${q(share)},${q(version)},${q(teacher)});`);
    assert.deepEqual((await register(teacher)).evidence, []);
    await assert.rejects(
      save(teacher, "present", 0, { target: outside }),
      /42501/,
    );
    const initial = await save(teacher, "present", 0, {
      note: "Fictional private comment",
      arrival: "now()-interval '90 minutes'",
    });
    assert.deepEqual(initial, { status: "present", version: 1, minutes: 30 });
    const initialReport = await report(client);
    const registered = await register(teacher);
    assert.deepEqual(await report(teacher), initialReport);
    assert.equal(initialReport.report_scope, "session");
    assert.equal(initialReport.id, run);
    assert.equal(initialReport.time_zone, "Australia/Brisbane");
    assert.deepEqual(initialReport.sessions, [
      {
        id: session,
        starts_at: registered.starts_at,
        ends_at: registered.ends_at,
      },
    ]);
    assert.deepEqual(
      initialReport.roster,
      registered.rows.map((entry) => ({
        user_id: entry.user_id,
        name: entry.name,
        sessions: [
          {
            session_id: session,
            status: entry.status,
            arrival_at: entry.arrival_at,
            departure_at: entry.departure_at,
            minutes: entry.status === "present" ? 30 : null,
          },
        ],
      })),
    );
    assert.doesNotMatch(
      JSON.stringify(initialReport),
      /Fictional private comment|private attendance.pdf|staff_note|object_path/,
    );
    assert.deepEqual(
      (await report(teacher, future)).roster.map(
        (entry) => entry.sessions[0].status,
      ),
      [null, null],
    );
    await assert.rejects(save(client, "absent", 1), /22023/);
    await assert.rejects(save(client, "absent", 0), /PT409/);
    const attempts = await Promise.allSettled([
      save(client, "excused", 1, { reason: "Scanned instructor correction" }),
      save(manager, "present", 1, { reason: "Manual manager correction" }),
    ]);
    assert.equal(
      attempts.filter((value) => value.status === "fulfilled").length,
      1,
    );
    assert.match(
      attempts.find((value) => value.status === "rejected").reason.message,
      /PT409/,
    );
    const committed = await register(manager);
    assert.equal(row(committed).version, 2);
    assert.equal(row(committed, peer).version, 0);
    assert.equal(committed.history.length, 2);
    assert.equal(
      committed.history[1].new_state.staff_note,
      "Fictional private comment",
    );
    const learnerWorkspace = await actor(
      learner,
      gate("course_workspace") + `select public.course_workspace(${q(run)})`,
    ).then(JSON.parse);
    assert.deepEqual(learnerWorkspace.roster, []);
    assert.deepEqual(learnerWorkspace.attendance_history, []);
    assert.equal(
      learnerWorkspace.sessions.find((item) => item.id === session).version,
      2,
    );
    assert.doesNotMatch(
      JSON.stringify(learnerWorkspace),
      /private comment|Scanned instructor correction|Manual manager correction|Fictional other learner/,
    );

    const batch = [importedEntry(learner, 2), importedEntry(peer, 0)].sort(
      (left, right) => left.user_id.localeCompare(right.user_id),
    );
    await assert.rejects(importRows(teacher, [batch[0], batch[0]]), /22023/);
    await assert.rejects(
      importRows(teacher, [batch[0], importedEntry(outside, 0)]),
      /42501/,
    );
    await assert.rejects(importRows(teacher, batch, foreignSession), /42501/);
    await assert.rejects(
      importRows(client, batch, foreignSession, foreignRun),
      /42501/,
    );
    await assert.rejects(importRows(learner, batch), /42501/);
    // The first row sorts before the stale second row and must roll back with it.
    await assert.rejects(
      importRows(teacher, [
        batch[0],
        {
          ...batch[1],
          expected_version: batch[1].expected_version + 1,
        },
      ]),
      /PT409/,
    );
    assert.deepEqual(await register(manager), committed);
    assert.equal(
      await sql(`select count(*) from public.audit_events
      where action='course.attendance_imported' and resource_id=${q(session)}`),
      "0",
    );
    assert.deepEqual(await importRows(client, batch), { saved: 2 });
    const retainedRegister = await register(manager);
    assert.equal(row(retainedRegister).version, 3);
    assert.equal(row(retainedRegister, peer).version, 1);
    assert.equal(row(retainedRegister).status, "excused");
    assert.equal(
      row(retainedRegister, peer).note,
      "Fictional imported register entry",
    );
    assert.equal(retainedRegister.history.length, 4);
    const retainedReport = await report(manager);
    assert.deepEqual(
      retainedReport.roster.map((entry) => entry.sessions[0].status),
      ["excused", "excused"],
    );
    assert.doesNotMatch(
      JSON.stringify(retainedReport),
      /Fictional imported register entry|Confirmed structured record/,
    );
    await assert.rejects(importRows(teacher, batch), /PT409/);
    assert.equal(
      await sql(`select count(*) from public.audit_events
      where action='course.attendance_imported' and actor_id=${q(client)} and resource_id=${q(session)}
        and (details->>'saved')::integer=2`),
      "1",
    );

    const learnerAfterImport = await actor(
      learner,
      gate("course_workspace") + `select public.course_workspace(${q(run)})`,
    ).then(JSON.parse);
    assert.equal(
      learnerAfterImport.sessions.find((item) => item.id === session).version,
      3,
    );
    assert.doesNotMatch(
      JSON.stringify(learnerAfterImport),
      /Fictional imported register entry|Confirmed structured record|Fictional other learner/,
    );

    await sql(
      `update public.client_organisation_memberships set removed_at=now() where user_id=${q(client)} and organisation_id=${q(org)}`,
    );
    await assert.rejects(register(client), /42501/);
    await assert.rejects(report(client), /42501/);
    await assert.rejects(importRows(client, batch), /42501/);
    await assert.rejects(
      save(client, "excused", 2, { reason: "Revoked contact" }),
      /42501/,
    );
    await actor(
      manager,
      gate("academy_release_course_instructor") +
        `select public.academy_release_course_instructor(${q(run)},${q(assignment.claim_id)},'Fictional teaching change',${q(randomUUID())})`,
    );
    await assert.rejects(register(teacher), /42501/);
    await assert.rejects(report(teacher), /42501/);
    await assert.rejects(importRows(teacher, batch), /42501/);
    await assert.rejects(
      save(teacher, "present", 2, { reason: "Released teacher" }),
      /42501/,
    );

    const newRelease = "cd".repeat(20);
    await renew({ issued_at: date(-7), release_commit: newRelease });
    await assert.rejects(register(manager), /42501/);
    await setProfile(true, newRelease);
    await renew({
      issued_at: date(-6),
      release_commit: newRelease,
      expires_at: date(-2),
    });
    assert.deepEqual(await register(manager), retainedRegister);
    assert.deepEqual(await report(manager), retainedReport);
    await assert.rejects(report(learner), /42501/);
    await assert.rejects(importRows(manager, batch), /42501/);
    await assert.rejects(
      actor(manager, importSql(batch, session, run)),
      /42501/,
    );
    await assert.rejects(
      save(manager, "absent", 2, { reason: "Grace is read-only" }),
      /42501/,
    );
    await assert.rejects(
      actor(manager, saveSql("absent", 2, { reason: "Grace is read-only" })),
      /42501/,
    );
    await renew({
      issued_at: date(-5),
      release_commit: newRelease,
      expires_at: date(-2),
      grace_until: date(-1),
    });
    await assert.rejects(register(manager), /42501/);
    await assert.rejects(report(manager), /42501/);
    await assert.rejects(importRows(manager, batch), /42501/);
    await assert.rejects(
      save(manager, "present", 2, { reason: "Licence expired" }),
      /42501/,
    );
    assert.equal(
      await sql(
        `select count(*) from private.course_attendance_audit where session_id=${q(session)}`,
      ),
      "4",
    );
    console.log(
      `PASS ${edition} exact register roles, private learner, single winning correction, atomic import, licence grace and retained audits`,
    );
  });
}
