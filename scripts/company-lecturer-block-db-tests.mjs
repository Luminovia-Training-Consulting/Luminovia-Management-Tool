/** Exact local migration replay, scoped roles, receipt races and new assignment guards. */
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import {
  academyCompanyLecturerBlockPaths,
  companyLecturerBlockPaths,
} from "../src/features/developer-api/company-lecturer-block-contract.ts";
import {
  configureAcademyCourseAccess,
  prepareAcademyInstallation,
} from "./academy-installation.mjs";
import { signAcademyLicence } from "./academy-licence.mjs";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

const list = "company_lecturer_blocks";
const write = "set_company_lecturer_block";
const directory = "academy_lecturer_block_organisations";
const endpoint = (name) => `/rest/v1/rpc/${name}`;
const gate = (name, method) => `set local request.path=${q(`/rpc/${name}`)};
  set local request.method=${q(method)}; select public.require_portal_access();`;

for (const edition of [
  "internal",
  "customer-self-hosted",
  "customer-managed",
]) {
  await withTestDatabase("company_lecturer_block", async ({ sql, actor }) => {
    const [
      org,
      other,
      course,
      outsideCourse,
      nextCourse,
      template,
      teacher,
      otherTeacher,
      staff,
      contact,
      foreign,
      learner,
      job,
      outsideJob,
      nextJob,
      companyRequest,
      requestJob,
      requestOnlyJob,
      unlinkedJob,
      chatRoom,
      courseChatRoom,
      loungeRoom,
      requestId,
    ] = Array.from({ length: 23 }, randomUUID);
    const academy = edition !== "internal";
    const docs = academy
      ? academyCompanyLecturerBlockPaths
      : companyLecturerBlockPaths;
    const now = Date.now();
    const date = (afterDays) =>
      new Date(now + afterDays * 86400000).toISOString();
    const claims = {
      installation_id: randomUUID(),
      edition,
      release_commit: "2a".repeat(20),
      issued_at: date(-2),
      starts_at: date(-1),
      expires_at: date(2),
      grace_until: date(5),
      modules: ["lms"],
      limits: {
        seat_count: 12,
        storage_bytes: 1000000,
        api_requests_per_minute: 100,
      },
    };
    if (academy) {
      const keys = generateKeyPairSync("ed25519");
      const options = {
        envelope: signAcademyLicence(claims, keys.privateKey),
        publicKey: keys.publicKey,
        expected: claims,
        now,
      };
      await prepareAcademyInstallation(options, sql);
      await configureAcademyCourseAccess({ ...options, enabled: true }, sql);
    }
    const users = [
      [teacher, "lecturer", "Instructor One"],
      [otherTeacher, "lecturer", "Instructor Two"],
      [staff, "management", "Course Manager"],
      [contact, "client", "Company Contact"],
      [foreign, "client", "Other Contact"],
      [learner, "participant", "Enrolled Learner"],
    ];
    await sql(`
      insert into auth.users(id,email,email_confirmed_at) values ${users.map(([id]) => `(${q(id)},${q(id + "@example.invalid")},now())`).join(",")};
      insert into public.user_roles(user_id,role) values ${users.map(([id, role]) => `(${q(id)},${q(role)})`).join(",")};
      ${users.map(([id, , name]) => `update public.profiles set display_name=${q(name)} where id=${q(id)};`).join("\n")}
      insert into public.organisations(id,name) values (${q(org)},'Fixture Company'),(${q(other)},'Separate Company');
      insert into public.client_organisation_memberships(user_id,organisation_id) values(${q(contact)},${q(org)}),(${q(foreign)},${q(other)});
      insert into public.course_templates(id,title) values(${q(template)},'Course template');
      insert into public.course_runs(id,template_id,organisation_id,published)
      values (${q(course)},${q(template)},${q(org)},true),(${q(nextCourse)},${q(template)},${q(org)},true),(${q(outsideCourse)},${q(template)},${q(other)},true);
      insert into public.course_sessions(course_run_id,starts_at,ends_at)
      values ${[course, nextCourse, outsideCourse].map((id, i) => `(${q(id)},${q(date(i + 6))},${q(date(i + 6.1))})`).join(",")};
    `);
    const argumentsFor = (courseId, key) =>
      [courseId, teacher, key].map(q).join(",");
    const call = async (who, name, args = "", method = "POST") =>
      JSON.parse(
        await actor(
          who,
          `${gate(name, method)} select to_jsonb(public.${name}(${args}));`,
        ),
      );
    const readBlocks = (who, company = org, search = "") =>
      call(who, list, [company, search].map(q).join(","), "GET");
    const setBlock = (who, wanted, version, company = org, target = teacher) =>
      call(who, write, `${q(company)},${q(target)},${wanted},${version}`);
    const discoverJobs = (filters) =>
      call(teacher, "job_discovery", q(JSON.stringify({
        customer: "Fixture Company",
        currency: "EUR",
        unit: "per_day",
        include_history: true,
        ...filters,
      })));
    const assertSchema = (name, method, data) =>
      z
        .fromJSONSchema(
          docs[endpoint(name)][method].responses["200"].content[
            "application/json"
          ].schema,
        )
        .parse(data);
    let originalClaim;
    if (academy) {
      const assignment = await call(
        staff,
        "academy_assign_course_instructor",
        argumentsFor(course, requestId),
      );
      assert.equal(assignment.status, "confirmed");
      originalClaim = assignment.claim_id;
      const outside = await call(
        staff,
        "academy_assign_course_instructor",
        argumentsFor(outsideCourse, randomUUID()),
      );
      assert.equal(outside.status, "confirmed");
      const choices = await actor(
        contact,
        `${gate(directory, "GET")} select coalesce(jsonb_agg(to_jsonb(item)),'[]'::jsonb) from public.${directory}() item;`,
      );
      assert.deepEqual(assertSchema(directory, "get", JSON.parse(choices)), [
        { id: org, name: "Fixture Company" },
      ]);
      await assert.rejects(
        actor(
          contact,
          `${gate(directory, "POST")} select * from public.${directory}();`,
        ),
        /42501/,
      );
    } else {
      const makeJob = (id, run = null) =>
        `(${q(id)},${run ? q(run) : "null"},'Fixture offer','Fixture Company','online','published',1,100,100,'EUR','per_day','Test terms')`;
      originalClaim = randomUUID();
      await sql(`
        insert into private.company_premium_settings(organisation_id,enabled) values(${q(org)},true),(${q(other)},true);
        insert into public.jobs(id,course_run_id,title,customer_name,delivery_type,status,capacity,amount,total_amount,currency,rate_unit,terms)
        values ${[makeJob(job, course), makeJob(nextJob, nextCourse), makeJob(outsideJob, outsideCourse), makeJob(requestJob), makeJob(requestOnlyJob), makeJob(unlinkedJob)].join(",")};
        insert into private.client_course_requests(id,organisation_id,requested_by,client_id,payload,creation_options,job_id)
          values(${q(companyRequest)},${q(org)},${q(contact)},${q(randomUUID())},'{}','{}',${q(requestOnlyJob)});
        insert into private.job_commission_offers(job_id,organisation_id,gross_amount,gross_total_amount,platform_total_amount,
          lecturer_net_amount,lecturer_net_total_amount,currency,pricing_mode,regular_percent,senior_percent,policy_version)
          values(${q(requestJob)},${q(org)},100,100,0,0,0,'EUR','role_split',50,50,1);
        insert into private.lecturer_compensation(user_id,mode,currency,version) values(${q(teacher)},'daily','AUD',2);
        insert into public.job_sessions(job_id,starts_at,ends_at)
        values (${q(nextJob)},${q(date(7))},${q(date(7.1))}),(${q(outsideJob)},${q(date(8))},${q(date(8.1))});
        insert into public.job_claims(id,job_id,lecturer_id,idempotency_key,amount,total_amount,currency,rate_unit,terms,terms_version)
        values(${q(originalClaim)},${q(job)},${q(teacher)},${q(randomUUID())},100,100,'EUR','per_day','Test terms',1);
        insert into public.assignment_sessions(claim_id,lecturer_id,starts_at,ends_at)
        values(${q(originalClaim)},${q(teacher)},${q(date(6))},${q(date(6.1))});
        insert into public.chat_rooms(id,job_id) values(${q(chatRoom)},${q(job)});
        insert into public.chat_rooms(id,kind,owner_id,course_run_id)
        values(${q(courseChatRoom)},'participant_course',${q(staff)},${q(course)});
        insert into public.chat_members(room_id,user_id) values(${q(courseChatRoom)},${q(teacher)})
        on conflict do nothing;
        insert into public.chat_rooms(id,kind) values(${q(loungeRoom)},'general')
        on conflict do nothing;
        insert into public.chat_members(room_id,user_id)
        select id,${q(teacher)} from public.chat_rooms where kind='general'
        on conflict do nothing;
        update public.chat_members set removed_at=null where room_id=${q(chatRoom)} and user_id=${q(teacher)};
        insert into public.chat_members(room_id,user_id) values(${q(chatRoom)},${q(teacher)}) on conflict do nothing;
      `);
      assert.equal(
        (
          await call(
            teacher,
            "claim_job",
            `${q(requestJob)},${q(randomUUID())},1`,
          )
        ).status,
        "quote_unavailable",
      );
      const sorted = await discoverJobs({ sort: "rate_asc" });
      const knownUnpricedOffer = sorted.items.find(
        (item) => item.id === requestJob,
      );
      assert.ok(
        knownUnpricedOffer,
        "Price sorting retains an authorized offer with no quote",
      );
      assert.equal(knownUnpricedOffer.amount, null);
      assert.equal(knownUnpricedOffer.total_amount, null);
      const priceBound = await discoverJobs({ sort: "rate_asc", min_rate: 0 });
      assert.ok(!priceBound.items.some((item) => item.id === requestJob));
    }
    const initial = assertSchema(list, "get", await readBlocks(contact));
    const entry = (blocked, version) => ({
      lecturer_id: teacher,
      display_name: "Instructor One",
      blocked,
      version,
    });
    assert.deepEqual(initial, {
      organisation_id: org,
      can_write: true,
      rows: [entry(false, 0)],
      more: false,
    });
    assert.deepEqual((await readBlocks(contact, org, "no match")).rows, []);
    assert.equal((await readBlocks(staff)).rows.length, 2);
    await assert.rejects(readBlocks(foreign), /42501/);
    await assert.rejects(readBlocks(teacher), /42501/);
    await assert.rejects(readBlocks(learner), /42501/);
    await assert.rejects(
      setBlock(contact, true, 0, org, otherTeacher),
      /42501/,
    );
    await assert.rejects(setBlock(foreign, true, 0), /42501/);
    await assert.rejects(
      actor(contact, "select * from private.company_lecturer_blocks"),
      /42501/,
    );
    assert.equal(
      (await call(teacher, "course_workspace", q(course))).access.teacher,
      true,
    );

    const group = academy
      ? await call(staff, "academy_ensure_course_chat", q(course))
      : courseChatRoom;
    const sendCourseMessage = () =>
      call(
        teacher,
        "send_course_chat_message",
        [group, "Fictional protected course message", randomUUID()]
          .map(q)
          .join(","),
      );
    const ownHistory = () => call(teacher, "course_chat_messages", q(group));
    const originalMessage = await sendCourseMessage();
    assert.ok((await ownHistory()).some(({ id }) => id === originalMessage));
    const activityCount = () =>
      actor(
        teacher,
        `select count(*) from public.course_chat_activity where room_id=${q(group)};`,
      );
    assert.equal(await activityCount(), "1");

    const repetitions = await Promise.all(
      Array.from({ length: 5 }, () => setBlock(contact, true, 0)),
    );
    repetitions.forEach((value) =>
      assert.deepEqual(assertSchema(write, "post", value), entry(true, 1)),
    );
    assert.deepEqual((await readBlocks(staff)).rows[0], entry(true, 1));
    assert.equal(
      await sql(
        "select count(*) from public.audit_events where action='company.lecturer_blocked'",
      ),
      "1",
    );
    assert.equal(
      await sql(
        `select status from public.job_claims where id=${q(originalClaim)}`,
      ),
      "confirmed",
    );
    await assert.rejects(call(teacher, "course_workspace", q(course)), /42501/);
    await assert.rejects(ownHistory(), /42501/);
    await assert.rejects(sendCourseMessage(), /42501/);
    assert.equal(await activityCount(), "0");
    assert.equal(
      (await call(teacher, "my_course_workspaces")).some(
        (item) => item.id === course,
      ),
      false,
    );
    assert.equal(
      (await call(staff, "course_workspace", q(course))).access.manager,
      true,
    );

    // Separate courses and independent company roles survive the restriction.
    const outsideView = await call(teacher, "my_course_workspaces");
    assert.equal(
      outsideView.some((item) => item.id === outsideCourse),
      academy,
    );
    await sql(`insert into public.user_roles(user_id,role) values(${q(teacher)},'client');
      insert into public.client_organisation_memberships(user_id,organisation_id) values(${q(teacher)},${q(org)});`);
    const combined = await call(teacher, "course_workspace", q(course));
    assert.equal(combined.access.client, true);
    assert.equal(combined.access.teacher, false);
    if (!academy) {
      assert.ok((await ownHistory()).some(({ id }) => id === originalMessage));
      assert.equal(await activityCount(), "1");
      assert.equal(
        await actor(
          teacher,
          "select count(*) from public.chat_rooms where kind='general';",
        ),
        "1",
      );
    }
    await sql(`update public.client_organisation_memberships set removed_at=clock_timestamp()
      where user_id=${q(teacher)} and organisation_id=${q(org)};`);
    await assert.rejects(call(teacher, "course_workspace", q(course)), /42501/);

    if (academy) {
      assert.deepEqual(
        await call(
          staff,
          "academy_assign_course_instructor",
          argumentsFor(course, requestId),
        ),
        { status: "confirmed", claim_id: originalClaim },
      );
      assert.equal(
        (
          await call(
            staff,
            "academy_assign_course_instructor",
            argumentsFor(nextCourse, randomUUID()),
          )
        ).status,
        "not_eligible",
      );
      const candidates = await call(
        staff,
        "academy_course_instructor_candidates",
        `${q(nextCourse)},''`,
      );
      assert.equal(
        candidates.some((candidate) => candidate.id === teacher),
        false,
      );
    } else {
      assert.equal(
        await actor(
          teacher,
          `select count(*) from public.jobs where id in (${q(job)},${q(nextJob)},${q(requestJob)},${q(requestOnlyJob)});`,
        ),
        "0",
      );
      for (const sort of ["newest", "rate_asc"]) {
        const discovery = await discoverJobs({ sort });
        assert.deepEqual(
          new Set(discovery.items.map((item) => item.id)),
          new Set([outsideJob, unlinkedJob]),
        );
      }
      assert.equal(
        await actor(
          teacher,
          `select count(*) from public.jobs where id=${q(outsideJob)};`,
        ),
        "1",
      );
      assert.equal(
        await actor(
          teacher,
          `select count(*) from public.course_runs where id=${q(course)};`,
        ),
        "0",
      );
      assert.equal(
        await actor(
          teacher,
          `select count(*) from public.assignment_sessions where claim_id=${q(originalClaim)};`,
        ),
        "0",
      );
      assert.deepEqual(
        await call(
          teacher,
          "assignment_calendar_metadata",
          `array[${q(job)}::uuid]`,
        ),
        [],
      );
      assert.equal(
        (await call(teacher, "assignment_confirmation", q(originalClaim))).data
          .claim_id,
        originalClaim,
      );
      await assert.rejects(call(teacher, "job_waitlist", q(nextJob)), /42501/);
      assert.equal(
        (
          await call(
            teacher,
            "claim_job",
            `${q(requestJob)},${q(randomUUID())},1`,
          )
        ).status,
        "not_eligible",
      );
      assert.equal(
        await actor(
          teacher,
          `select private.can_access_chat_room(${q(chatRoom)});`,
        ),
        "f",
      );
      assert.equal(
        (await call(teacher, "claim_job", `${q(nextJob)},${q(randomUUID())},1`))
          .status,
        "not_eligible",
      );
      assert.equal(
        (
          await call(
            staff,
            "manual_assign_job",
            `${q(nextJob)},${q(teacher)},1,1,${q(randomUUID())}`,
          )
        ).status,
        "not_eligible",
      );
      await assert.rejects(
        sql(`insert into public.job_claims(job_id,lecturer_id,idempotency_key,amount,total_amount,currency,rate_unit,terms,terms_version)
        values(${q(nextJob)},${q(teacher)},${q(randomUUID())},100,100,'EUR','per_day','Test terms',1);`),
        /42501/,
      );
    }

    await assert.rejects(setBlock(staff, false, 0), /PT409/);
    assert.deepEqual(await setBlock(staff, false, 1), entry(false, 2));
    assert.deepEqual(await setBlock(staff, false, 1), entry(false, 2));
    assert.equal(
      (await call(teacher, "course_workspace", q(course))).access.teacher,
      true,
    );
    assert.ok((await ownHistory()).some(({ id }) => id === originalMessage));
    assert.equal(await activityCount(), "1");
    assert.ok(await sendCourseMessage());
    assert.equal(
      await sql(
        "select count(*) from public.audit_events where action='company.lecturer_unblocked'",
      ),
      "1",
    );
    if (academy) {
      const grace = {
        ...claims,
        issued_at: date(-1),
        starts_at: date(-0.9),
        expires_at: date(-0.5),
      };
      await sql(
        `select private.apply_verified_installation_licence(${q(JSON.stringify(grace))}::jsonb)`,
      );
      assert.equal((await readBlocks(contact)).can_write, false);
      await assert.rejects(setBlock(contact, true, 2), /42501/);
    } else {
      // Wait until the block transaction owns the same lecturer lock used by
      // claiming. The concurrent claim must observe the committed restriction.
      const blocking = actor(
        contact,
        `${gate(write, "POST")}
        select public.${write}(${q(org)},${q(teacher)},true,2);
        select pg_sleep(1);`,
      );
      let held = false;
      for (let attempt = 0; attempt < 20 && !held; attempt++) {
        held =
          (await sql(
            `select not pg_try_advisory_xact_lock(hashtextextended(${q(teacher)},0));`,
          )) === "t";
        if (!held) await delay(25);
      }
      assert.equal(held, true);
      const attempt = call(
        teacher,
        "claim_job",
        `${q(nextJob)},${q(randomUUID())},1`,
      );
      await blocking;
      assert.equal((await attempt).status, "not_eligible");
      assert.deepEqual(await setBlock(staff, false, 3), entry(false, 4));
    }
    await sql(
      `update public.client_organisation_memberships set removed_at=clock_timestamp() where user_id=${q(contact)} and organisation_id=${q(org)};`,
    );
    await assert.rejects(readBlocks(contact), /42501/);
    console.log(
      `PASS ${edition}: scoped company and management restrictions, retry, mixed roles, assignment denials, retention and unblock.`,
    );
  });
}
