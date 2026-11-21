/** Exercises dedicated academy licence, course access and assignments on disposable databases. */
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { z } from "zod";
import { academyOpenApi } from "../src/features/developer-api/academy-contract.ts";
import { signAcademyLicence } from "./academy-licence.mjs";
import { prepareAcademyInstallation } from "./academy-installation.mjs";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

const gate = (name, method = "POST", headers = {}) =>
  `set local request.path=${q(`/rpc/${name}`)}; set local request.method=${q(method)};
    set local request.headers=${q(JSON.stringify(headers))}; select public.require_portal_access();`;
const configure = (id, release, enabled = true) =>
  `select private.configure_academy_course_access(${q(id)},${q(release)},${enabled})`;

const checkCourseAccess = async ({ sql, actor }, edition) => {
  const [
    installation,
    org,
    template,
    run,
    conflictingRun,
    admin,
    teacher,
    participant,
    guest,
    foreign,
    membership,
  ] = Array.from({ length: 11 }, randomUUID);
  const { paths } = academyOpenApi("https://academy.example.invalid", {
    name: "Practice Academy",
    installationId: installation,
    edition,
  });
  const responseSchemas = new Map(
    // Authoring, material, attendance and exam transports have their own fixtures.
    Object.entries(paths)
      .filter(
        ([path]) =>
          ![
            "/functions/v1/files",
            "/functions/v1/course-documents",
            "/functions/v1/accounts/v1/academy/users",
            "/rest/v1/rpc/academy_administration",
            "/rest/v1/rpc/academy_create_organisation",
            "/rest/v1/rpc/academy_set_member_active",
            "/rest/v1/rpc/academy_set_management",
            "/rest/v1/rpc/academy_course_material_action",
            "/rest/v1/rpc/course_session_register",
            "/rest/v1/rpc/save_course_session_attendance",
            "/rest/v1/rpc/import_course_session_attendance",
            "/rest/v1/rpc/set_course_exam_required",
            "/rest/v1/rpc/academy_student_exam_pdf_options",
            "/rest/v1/rpc/share_course_exam_pdf",
            "/rest/v1/rpc/remove_course_exam_pdf",
            "/rest/v1/rpc/academy_course_draft_options",
            "/rest/v1/rpc/academy_create_course_draft",
            "/rest/v1/rpc/academy_draft_schedule",
            "/rest/v1/rpc/academy_save_draft_schedule",
            "/rest/v1/rpc/academy_course_publication",
            "/rest/v1/rpc/academy_publish_course",
            "/rest/v1/rpc/academy_learning_action",
            "/rest/v1/rpc/academy_timetable",
            "/rest/v1/rpc/notification_inbox",
            "/rest/v1/rpc/mark_notifications",
          ].includes(path),
      )
      .map(([path, operations]) => {
        const operation = operations.get ?? operations.post;
        return [
          path.split("/").at(-1),
          z.fromJSONSchema(
            operation.responses["200"].content["application/json"].schema,
          ),
        ];
      }),
  );
  const testedContracts = new Set();
  const checkResponse = (endpoint, payload) => {
    const result = responseSchemas.get(endpoint).safeParse(payload);
    assert.ok(result.success, `${endpoint} response: ${result.error?.message}`);
    testedContracts.add(endpoint);
    return payload;
  };
  const key = generateKeyPairSync("ed25519");
  const now = Date.now();
  const date = (days) => new Date(now + days * 86_400_000).toISOString();
  const terms = {
    installation_id: installation,
    edition,
    release_commit: "ab".repeat(20),
    issued_at: date(-8),
    starts_at: date(-1),
    expires_at: date(20),
    grace_until: date(25),
    limits: {
      seat_count: 20,
      storage_bytes: 20000000,
      api_requests_per_minute: 60,
    },
    modules: ["lms"],
  };
  const signed = signAcademyLicence(terms, key.privateKey);
  const prepared = await prepareAcademyInstallation(
    {
      envelope: signed,
      publicKey: key.publicKey,
      expected: terms,
      now,
    },
    sql,
  );
  assert.equal(prepared.licence_status, "active");
  const capability = async () =>
    checkResponse(
      "installation_capabilities",
      JSON.parse(
        await sql(`begin;set local role anon;${gate("installation_capabilities", "GET")}
      select public.installation_capabilities();commit;`),
      ),
    );
  assert.deepEqual(await capability(), prepared);
  assert.equal(prepared.customer_ready, false);
  assert.deepEqual(
    await prepareAcademyInstallation(
      {
        envelope: signed,
        publicKey: key.publicKey,
        expected: terms,
        now,
      },
      sql,
    ),
    prepared,
  );

  // The provider still uses the ordinary migrated actor and scheduling tables.
  await sql(`insert into auth.users(id,email,email_confirmed_at) values
      (${q(admin)},'academy-admin@example.invalid',now()),
      (${q(teacher)},'academy-teacher@example.invalid',now()),
      (${q(participant)},'academy-learner@example.invalid',now()),
      (${q(guest)},'academy-guest@example.invalid',now()),
      (${q(foreign)},'academy-other-learner@example.invalid',now());
    update public.profiles set display_name='Fictional instructor' where id=${q(teacher)};
    insert into public.user_roles(user_id,role) values
      (${q(admin)},'admin'),(${q(teacher)},'lecturer'),(${q(participant)},'participant'),
      (${q(guest)},'guest'),(${q(foreign)},'participant');
    insert into public.organisations(id,name) values(${q(org)},'Fictional academy');
    insert into public.course_templates(id,title) values(${q(template)},'Practical training');
    insert into public.course_runs(id,template_id,organisation_id)
      values(${q(run)},${q(template)},${q(org)}),(${q(conflictingRun)},${q(template)},${q(org)});
    insert into public.course_sessions(course_run_id,starts_at,ends_at)
      values(${q(run)},now()+interval '1 day',now()+interval '25 hours'),
        (${q(run)},now()+interval '2 days',now()+interval '49 hours'),
        (${q(conflictingRun)},now()+interval '1 day',now()+interval '26 hours');
    insert into private.company_participant_link_requests(
      id,organisation_id,requested_by,request_id,luminovia_user_id,target_user_id,status,expires_at
    ) select ${q(membership)},${q(org)},${q(admin)},${q(randomUUID())},luminovia_user_id,id,'accepted',now()+interval '2 days'
      from public.profiles where id=${q(participant)};
    insert into private.company_participant_memberships(
      organisation_id,user_id,status,link_request_id,invited_by,joined_at
    ) values(${q(org)},${q(participant)},'active',${q(membership)},${q(admin)},now());`);
  const call = async (who, endpoint, args = [], method = "POST") => {
    const value = await actor(
      who,
      `${gate(endpoint, method)} select public.${endpoint}(${args.map(q).join(",")})`,
    );
    if (responseSchemas.has(endpoint)) {
      const payload = [
        "academy_ensure_course_chat",
        "send_course_chat_message",
      ].includes(endpoint)
        ? value
        : JSON.parse(value);
      checkResponse(endpoint, payload);
    }
    return value;
  };
  const workspace = (who, course) =>
    call(who, "course_workspace", [course], "GET").then(JSON.parse);
  const workspaces = (who) =>
    call(who, "my_course_workspaces").then(JSON.parse);
  const enrol = (who, target, status = "enrolled") =>
    call(who, "manage_course_enrolment", [run, target, status]);
  const initialLink = "https://example.invalid/academy-room?code=fictional";
  const updatedLink = "https://example.invalid/renewed-room";
  const meetingWrite = (url, version, course = run) =>
    `select public.set_course_meeting_link(${q(course)},${url === null ? "null" : q(url)},${version})`;
  const meeting = (who, url, version, course) =>
    actor(
      who,
      `${gate("set_course_meeting_link")} ${meetingWrite(url, version, course)}`,
    ).then((value) =>
      checkResponse("set_course_meeting_link", JSON.parse(value)),
    );
  // Simulate direct RPC execution, independently of the HTTP pre-request hook.
  const directMeeting = (who, url, version) =>
    actor(who, meetingWrite(url, version));
  const initialWelcome = [
    "Bring your notebook",
    "Practise the basics",
    "Open the course workspace",
  ];
  const welcome = (who, course = run) =>
    call(who, "course_welcome_content", [course], "GET").then(JSON.parse);
  const publishWelcome = (
    who,
    version,
    content = initialWelcome,
    course = run,
  ) =>
    call(who, "publish_course_welcome_content", [
      course,
      ...content,
      version,
    ]).then(JSON.parse);
  const directWelcome = (who, version) =>
    actor(
      who,
      `select public.publish_course_welcome_content(${[run, ...initialWelcome, version].map(q).join(",")})`,
    );
  const rooms = (who, course = run) =>
    call(who, "course_chat_rooms", [course], "GET").then(JSON.parse);
  const openChat = (who, course = run) =>
    call(who, "academy_ensure_course_chat", [course]);
  const readChat = (who, room) =>
    call(who, "course_chat_messages", [room], "GET").then(JSON.parse);
  const postChat = (who, room, text, key = randomUUID()) =>
    call(who, "send_course_chat_message", [room, text, key]);
  const marker = (who, room) =>
    actor(
      who,
      `select revision from public.course_chat_activity where room_id=${q(room)}`,
    );
  const candidateConfiguration = configure(installation, terms.release_commit);
  await assert.rejects(actor(admin, candidateConfiguration), /42501/);
  await assert.rejects(
    sql(`set role service_role;${candidateConfiguration}`),
    /42501/,
  );
  await assert.rejects(
    sql(configure(randomUUID(), terms.release_commit)),
    /55000/,
  );
  await assert.rejects(sql(configure(installation, "ee".repeat(20))), /55000/);
  await assert.rejects(workspace(admin, run), /42501/);
  await assert.rejects(enrol(admin, participant), /42501/);
  await assert.rejects(meeting(admin, initialLink, 0), /42501/);
  await assert.rejects(directMeeting(admin, initialLink, 0), /42501/);
  await assert.rejects(welcome(admin), /42501/);
  await assert.rejects(rooms(admin), /42501/);
  await assert.rejects(openChat(admin), /42501/);
  await assert.rejects(publishWelcome(admin, 0), /42501/);
  await assert.rejects(directWelcome(admin, 0), /42501/);
  await assert.rejects(
    actor(
      admin,
      `select public.manage_course_enrolment(${q(run)},${q(participant)},'enrolled')`,
    ),
    /42501/,
  );
  const requestId = randomUUID();
  const assign = async (who, course, target, id = requestId) =>
    call(who, "academy_assign_course_instructor", [course, target, id]).then(
      JSON.parse,
    );
  await assert.rejects(assign(admin, run, teacher), /42501/);
  await sql(candidateConfiguration);
  await sql(candidateConfiguration);
  assert.deepEqual(
    JSON.parse(await sql("select public.installation_capabilities()")),
    prepared,
  );
  const assertDocumentedGate = async (grace = false) => {
    for (const [path, operations] of Object.entries(paths)) {
      if (!path.startsWith("/rest/v1/rpc/")) continue;
      const method = operations.get ? "GET" : "POST";
      const endpoint = path.split("/").at(-1);
      const request = actor(admin, gate(endpoint, method));
      if (grace && operations.post?.["x-portal-licence"] === "active") {
        await assert.rejects(request, /42501/);
      } else {
        await request;
      }
    }
  };
  await assertDocumentedGate();
  await assert.rejects(workspaces(guest), /42501/);
  for (const role of ["anon", "service_role"]) {
    await assert.rejects(
      sql(
        `begin;set local role ${role};${gate("my_course_workspaces")};commit;`,
      ),
      /42501/,
    );
  }
  for (const endpoint of [
    "set_company_premium",
    "company_premium_settings",
    "commission_report",
    "search_portal",
    "course_workspace_action",
    "repeat_client_request",
    "send_message",
    "send_course_chat_attachment",
    "edit_message",
    "company_course_webhook_subscribe",
    "account_me",
  ]) {
    await assert.rejects(actor(admin, gate(endpoint)), /42501/);
  }
  for (const [path, method] of [
    ["/jobs", "GET"],
    ["/profiles", "GET"],
    ["/", "GET"],
    ["/rpc/course_workspace/", "GET"],
    ["/rpc/course_workspace", "PATCH"],
    ["/rpc/academy_assign_course_instructor", "GET"],
    ["/rpc/set_course_meeting_link", "GET"],
    ["/rpc/set_course_meeting_link", "HEAD"],
    ["/rpc/course_document_access", "GET"],
    ["/rpc/course_document_access", "HEAD"],
    ["/rpc/publish_course_welcome_content", "GET"],
    ["/rpc/publish_course_welcome_content", "HEAD"],
    ["/rpc/academy_ensure_course_chat", "GET"],
    ["/rpc/send_course_chat_message", "GET"],
    ["/course_chat_activity", "GET"],
    ["/messages", "GET"],
  ]) {
    await assert.rejects(
      actor(
        admin,
        `set local request.path=${q(path)};set local request.method=${q(method)};select public.require_portal_access()`,
      ),
      /42501/,
    );
  }
  for (const header of ["accept-profile", "content-profile"]) {
    await assert.rejects(
      actor(
        admin,
        gate("course_workspace", "POST", { [header]: "graphql_public" }),
      ),
      /42501/,
    );
  }
  await assert.rejects(assign(teacher, run, teacher), /42501/);
  assert.equal((await assign(admin, run, participant)).status, "not_eligible");

  const candidates = await call(
    admin,
    "academy_course_instructor_candidates",
    [run, "fictional"],
    "GET",
  ).then(JSON.parse);
  assert.deepEqual(candidates, [
    { id: teacher, name: "Fictional instructor", assignment_id: null },
  ]);
  assert.equal(
    await sql(`select private.company_premium_enabled(${q(org)})`),
    "f",
  );
  const adminView = await workspace(admin, run);
  assert.equal(adminView.lms_enabled, true);
  assert.deepEqual(adminView.meeting_link, {
    url: null,
    can_edit: true,
    version: 0,
  });
  assert.deepEqual(await rooms(admin), []);
  await assert.rejects(openChat(teacher), /42501/);
  await assert.rejects(openChat(participant), /42501/);
  const [room, replayedRoom] = await Promise.all([
    openChat(admin),
    openChat(admin),
  ]);
  assert.match(room, /^[0-9a-f-]{36}$/);
  assert.equal(replayedRoom, room);
  assert.deepEqual(await rooms(admin), [
    { id: room, title: "Practical training", can_post: true },
  ]);
  assert.equal(
    await sql(`select count(*) from public.audit_events
    where resource_id=${q(room)} and action='course.chat.opened'`),
    "1",
  );
  await assert.rejects(readChat(teacher, room), /42501/);
  await assert.rejects(
    postChat(participant, room, "Before enrolment"),
    /42501/,
  );
  await assert.rejects(meeting(teacher, initialLink, 0), /42501/);
  await assert.rejects(workspace(teacher, run), /42501/);
  await assert.rejects(publishWelcome(teacher, 0), /42501/);
  await assert.rejects(welcome(participant), /42501/);
  await assert.rejects(workspace(participant, run), /42501/);
  await assert.rejects(enrol(teacher, participant), /42501/);
  await assert.rejects(enrol(admin, foreign), /42501/);
  assert.deepEqual(
    (
      await call(admin, "course_enrolment_candidates", [run], "GET").then(
        JSON.parse,
      )
    ).map(({ user_id }) => user_id),
    [participant],
  );
  await enrol(admin, participant);
  const participantView = await workspace(participant, run);
  assert.equal(participantView.access.learner, true);
  assert.equal(participantView.access.staff, false);
  assert.deepEqual(participantView.roster, []);
  assert.equal(participantView.repeat_request, null);
  assert.equal(participantView.meeting_link.can_edit, false);
  assert.deepEqual(
    (await rooms(participant)).map(({ id }) => id),
    [room],
  );
  assert.deepEqual(await readChat(participant, room), []);
  await assert.rejects(readChat(foreign, room), /42501/);
  const messageKey = randomUUID();
  const message = await postChat(
    participant,
    room,
    "Fictional welcome",
    messageKey,
  );
  assert.equal(
    await postChat(participant, room, "Fictional welcome", messageKey),
    message,
  );
  await assert.rejects(
    postChat(participant, room, "Different text", messageKey),
    /22023/,
  );
  const firstMarker = await marker(participant, room);
  assert.match(firstMarker, /^[0-9a-f-]{36}$/);
  assert.equal(await marker(foreign, room), "");
  assert.equal(
    await actor(
      participant,
      `select count(*) from public.messages where id=${q(message)}`,
    ),
    "0",
  );
  const history = await readChat(admin, room);
  assert.equal(history.length, 1);
  assert.equal(history[0].id, message);
  assert.equal(history[0].body, "Fictional welcome");
  assert.equal(history[0].attachment, null);

  await assert.rejects(meeting(participant, initialLink, 0), /42501/);
  await assert.rejects(meeting(foreign, initialLink, 0), /42501/);
  assert.deepEqual(await welcome(participant), {
    version: 0,
    description: "",
    objectives: "",
    joining_instructions: "",
    published_at: null,
  });
  await assert.rejects(welcome(foreign), /42501/);
  await assert.rejects(publishWelcome(participant, 0), /42501/);
  await assert.rejects(
    publishWelcome(admin, 0, ["x".repeat(4001), "", ""]),
    /22023/,
  );
  await assert.rejects(meeting(admin, "http://example.invalid", 0), /22023/);
  assert.deepEqual(
    (await workspaces(participant)).map(({ id }) => id),
    [run],
  );
  assert.deepEqual(await workspaces(foreign), []);
  await assert.rejects(workspace(participant, conflictingRun), /42501/);
  await assert.rejects(
    call(participant, "course_enrolments", [run], "GET"),
    /42501/,
  );
  assert.deepEqual(
    (await call(admin, "course_enrolments", [run], "GET").then(JSON.parse)).map(
      ({ user_id }) => user_id,
    ),
    [participant],
  );
  await enrol(admin, participant, "removed");
  await assert.rejects(workspace(participant, run), /42501/);
  await assert.rejects(readChat(participant, room), /42501/);
  await assert.rejects(postChat(participant, room, "After removal"), /42501/);
  assert.equal(await marker(participant, room), "");

  await enrol(admin, participant);
  const result = await assign(admin, run, teacher);
  assert.equal(result.status, "confirmed");
  assert.equal((await workspace(teacher, run)).access.teacher, true);
  assert.equal((await rooms(teacher))[0].can_post, true);
  const teacherMessage = await postChat(
    teacher,
    room,
    "Fictional instructor message",
  );
  assert.notEqual(await marker(participant, room), firstMarker);
  assert.equal((await readChat(participant, room)).at(-1).id, teacherMessage);
  await assert.rejects(readChat(guest, room), /42501/);

  await assert.rejects(
    publishWelcome(teacher, 0, initialWelcome, conflictingRun),
    /42501/,
  );
  const welcomeV1 = await publishWelcome(teacher, 0);
  assert.deepEqual(await welcome(participant), welcomeV1);
  assert.deepEqual(Object.keys(welcomeV1).sort(), [
    "description",
    "joining_instructions",
    "objectives",
    "published_at",
    "version",
  ]);
  assert.equal(welcomeV1.version, 1);
  assert.equal(welcomeV1.joining_instructions, initialWelcome[2]);
  const concurrentRevisions = await Promise.allSettled([
    publishWelcome(teacher, 1, ["Read chapter one", "", ""]),
    publishWelcome(admin, 1, ["Read chapter two", "", ""]),
  ]);
  assert.equal(
    concurrentRevisions.filter(({ status }) => status === "fulfilled").length,
    1,
  );
  const staleRevision = concurrentRevisions.find(
    ({ status }) => status === "rejected",
  );
  assert.match(String(staleRevision?.reason), /PT409/);
  const currentWelcome = await welcome(participant);
  assert.equal(currentWelcome.version, 2);
  assert.deepEqual(await meeting(teacher, initialLink, 0), {
    url: initialLink,
    version: 1,
    can_edit: true,
  });
  assert.deepEqual((await workspace(participant, run)).meeting_link, {
    url: initialLink,
    version: 1,
    can_edit: false,
  });
  await assert.rejects(meeting(teacher, updatedLink, 0), /PT409/);
  await assert.rejects(
    meeting(teacher, updatedLink, 0, conflictingRun),
    /42501/,
  );
  assert.deepEqual(await meeting(admin, updatedLink, 1), {
    url: updatedLink,
    version: 2,
    can_edit: true,
  });
  assert.deepEqual(
    (await workspaces(teacher)).map(({ id }) => id),
    [run],
  );
  await assert.rejects(workspace(teacher, conflictingRun), /42501/);
  assert.deepEqual(await assign(admin, run, teacher), result);
  assert.equal(
    (await assign(admin, conflictingRun, teacher)).status,
    "idempotency_conflict",
  );
  assert.equal(
    (await assign(admin, conflictingRun, teacher, randomUUID())).status,
    "conflict",
  );
  assert.equal(
    await sql("select count(*) from public.jobs where status='filled'"),
    "1",
  );
  assert.equal(
    await sql("select count(*) from public.jobs where status='published'"),
    "0",
  );
  assert.equal(
    await sql("select count(*) from public.assignment_sessions"),
    "2",
  );
  assert.equal(
    await sql("select count(*) from private.claim_revenue_ledger"),
    "0",
  );
  assert.equal(
    await sql(
      `select count(*) from public.job_claims where id=${q(result.claim_id)} and contract_id is null and amount=0 and total_amount=0`,
    ),
    "1",
  );
  const releaseKey = randomUUID();
  const release = (who, course, request = releaseKey) =>
    call(who, "academy_release_course_instructor", [
      course,
      result.claim_id,
      "Fictional scheduling change",
      request,
    ]).then(JSON.parse);
  await assert.rejects(release(teacher, run), /42501/);
  await assert.rejects(release(admin, conflictingRun), /42501/);
  assert.deepEqual(await release(admin, run), {
    status: "cancelled",
    claim_id: result.claim_id,
  });
  assert.deepEqual(await release(admin, run), {
    status: "cancelled",
    claim_id: result.claim_id,
  });
  await assert.rejects(workspace(teacher, run), /42501/);
  await assert.rejects(meeting(teacher, initialLink, 2), /42501/);
  assert.deepEqual(await workspaces(teacher), []);
  assert.equal(
    await sql("select count(*) from public.jobs where status='archived'"),
    "1",
  );
  assert.equal(
    await sql("select count(*) from public.jobs where status='published'"),
    "0",
  );
  assert.equal(
    await sql(
      "select count(*) from public.assignment_sessions where released_at is not null",
    ),
    "2",
  );
  assert.deepEqual(await assign(admin, run, teacher), {
    status: "cancelled",
    claim_id: result.claim_id,
  });
  assert.equal(
    (await assign(admin, run, teacher, randomUUID())).status,
    "confirmed",
  );
  const renew = (changes) => {
    const renewal = { ...terms, ...changes };
    return sql(
      `select private.apply_verified_installation_licence(${q(JSON.stringify(renewal))}::jsonb)`,
    );
  };
  // Apply successively issued fixtures, exercising the actual release binding.
  const nextRelease = "11".repeat(20);
  await renew({ release_commit: nextRelease, issued_at: date(-7) });
  await assert.rejects(workspaces(admin), /42501/);
  await assert.rejects(directMeeting(admin, initialLink, 2), /42501/);
  await sql(configure(installation, nextRelease));
  await sql(configure(installation, terms.release_commit, false));
  assert.equal((await workspace(participant, run)).access.learner, true);
  await renew({
    release_commit: nextRelease,
    issued_at: date(-6),
    starts_at: date(-5),
    expires_at: date(-2),
  });
  await assertDocumentedGate(true);
  assert.equal((await workspace(participant, run)).access.learner, true);
  assert.deepEqual((await workspace(teacher, run)).meeting_link, {
    url: updatedLink,
    version: 2,
    can_edit: false,
  });
  await assert.rejects(meeting(admin, null, 2), /42501/);
  assert.deepEqual(await welcome(participant), currentWelcome);
  await assert.rejects(publishWelcome(admin, 2), /42501/);
  assert.equal((await rooms(participant))[0].can_post, false);
  assert.equal((await readChat(participant, room)).length, 2);
  await assert.rejects(postChat(participant, room, "Read-only grace"), /42501/);
  await assert.rejects(
    actor(
      participant,
      `select public.send_message(${q(room)},'Raw send',${q(randomUUID())})`,
    ),
    /42501/,
  );
  assert.notEqual(await marker(participant, room), "");

  await assert.rejects(directWelcome(teacher, 2), /42501/);
  await assert.rejects(directMeeting(teacher, null, 2), /42501/);
  await assert.rejects(assign(admin, run, teacher), /42501/);
  await assert.rejects(enrol(admin, participant, "removed"), /42501/);
  await assert.rejects(sql(configure(installation, nextRelease)), /55000/);
  await assert.rejects(
    actor(
      admin,
      `select public.manage_course_enrolment(${q(run)},${q(participant)},'removed')`,
    ),
    /42501/,
  );
  await renew({
    release_commit: nextRelease,
    issued_at: date(-5),
    starts_at: date(-4),
    expires_at: date(-2),
    grace_until: date(-1),
  });
  await assert.rejects(workspaces(participant), /42501/);
  await assert.rejects(workspace(admin, run), /42501/);
  await assert.rejects(directMeeting(admin, null, 2), /42501/);
  await assert.rejects(welcome(participant), /42501/);
  await assert.rejects(rooms(participant), /42501/);
  await assert.rejects(readChat(participant, room), /42501/);
  assert.equal(await marker(participant, room), "");
  assert.equal(
    await sql(`select count(*) from public.messages where room_id=${q(room)}`),
    "2",
  );

  assert.equal(
    await sql(
      `select count(*) from private.course_welcome_revisions where course_run_id=${q(run)}`,
    ),
    "2",
  );
  assert.equal(
    await sql(
      `select url from private.course_meeting_links where course_run_id=${q(run)}`,
    ),
    updatedLink,
  );
  assert.equal(
    await sql(
      "select count(*) from public.course_enrolments where status='enrolled'",
    ),
    "1",
  );
  assert.equal(
    await sql(
      "select count(*) from private.academy_course_instructors where released_at is null",
    ),
    "1",
  );
  await renew({ release_commit: nextRelease, issued_at: date(-4) });
  assert.deepEqual(await welcome(participant), currentWelcome);
  assert.equal((await workspace(participant, run)).access.learner, true);
  assert.deepEqual(await meeting(admin, null, 2), {
    url: null,
    version: 3,
    can_edit: true,
  });
  await sql(configure(installation, nextRelease, false));
  await assert.rejects(workspace(admin, run), /42501/);
  assert.equal((await capability()).customer_ready, false);
  assert.deepEqual(testedContracts, new Set(responseSchemas.keys()));
  console.log(
    `PASS ${edition} course scope, assignments, enrolments, welcome revisions, meeting links, text chat, marker RLS, release binding, grace/read-only, expiry and dormant browser`,
  );
};

for (const edition of ["customer-self-hosted", "customer-managed"]) {
  await withTestDatabase("academy_instructor", (db) =>
    checkCourseAccess(db, edition),
  );
}
