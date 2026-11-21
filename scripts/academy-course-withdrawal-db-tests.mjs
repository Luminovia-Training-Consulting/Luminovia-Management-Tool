/** Verify the real dedicated deadline, retained roster and immediate access revocation. */
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { courseWithdrawalWindowSchema } from "../src/features/learning/course-withdrawal-schema.ts";
import { prepareAcademyInstallation } from "./academy-installation.mjs";
import { signAcademyLicence } from "./academy-licence.mjs";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

for (const edition of ["customer-self-hosted", "customer-managed"]) {
  await withTestDatabase(
    "academy_course_withdrawal",
    async ({ sql, actor }) => {
      const [
        installation,
        manager,
        teacher,
        learner,
        other,
        org,
        template,
        retained,
        late,
        unscheduled,
        completed,
        graceCourse,
        scheduleRace,
        document,
        version,
        share,
      ] = Array.from({ length: 16 }, randomUUID);
      const now = Date.now();
      const date = (days) => new Date(now + days * 86_400_000).toISOString();
      const key = generateKeyPairSync("ed25519");
      const licence = {
        installation_id: installation,
        edition,
        release_commit: "ab".repeat(20),
        issued_at: date(-9),
        starts_at: date(-5),
        expires_at: date(5),
        grace_until: date(6),
        modules: ["lms"],
        limits: {
          seat_count: 20,
          storage_bytes: 2_000_000,
          api_requests_per_minute: 60,
        },
      };
      await prepareAcademyInstallation(
        {
          envelope: signAcademyLicence(licence, key.privateKey),
          publicKey: key.publicKey,
          expected: licence,
          now,
        },
        sql,
      );
      const configure = (enabled) =>
        sql(
          `select private.configure_academy_course_access(${q(installation)},${q(licence.release_commit)},${enabled})`,
        );
      const renew = (change) =>
        sql(
          `select private.apply_verified_installation_licence(${q(JSON.stringify({ ...licence, ...change }))}::jsonb)`,
        );
      const rpc = (who, endpoint, args = "", method = "POST") =>
        actor(
          who,
          `set local request.path=${q("/rpc/" + endpoint)}; set local request.method=${q(method)};
       select public.require_portal_access(); select public.${endpoint}(${args});`,
        );
      const accounts = [
        [manager, "admin"],
        [teacher, "lecturer"],
        [learner, "participant"],
        [other, "participant"],
      ];
      await sql(`insert into auth.users(id,email,email_confirmed_at) values
      ${accounts.map(([actorId]) => `(${q(actorId)},${q(actorId + "@example.invalid")},now())`).join(",")};
      insert into public.user_roles(user_id,role) values
      ${accounts.map(([actorId, role]) => `(${q(actorId)},${q(role)})`).join(",")};
      insert into public.organisations(id,name) values (${q(org)},'Fictional withdrawal academy');
      insert into public.course_templates(id,title) values (${q(template)},'Fictional course');
      insert into public.course_runs(id,organisation_id,template_id) values
        ${[retained, late, unscheduled, completed, graceCourse, scheduleRace].map((id) => `(${q(id)},${q(org)},${q(template)})`).join(",")};
      insert into public.course_sessions(course_run_id,starts_at,ends_at) values
        (${q(retained)},${q(date(9))},${q(date(10))}),
        (${q(late)},${q(date(6))},${q(date(7))}),
        (${q(late)},${q(date(10))},${q(date(11))}),
        (${q(completed)},${q(date(-12))},${q(date(-11))}),
        (${q(graceCourse)},${q(date(10))},${q(date(11))}),
        (${q(scheduleRace)},${q(date(8))},${q(date(9))});`);
      for (const member of [learner, other]) {
        const link = randomUUID();
        await sql(`insert into private.company_participant_link_requests(id,organisation_id,requested_by,request_id,luminovia_user_id,target_user_id,status,expires_at)
        select ${q(link)},${q(org)},${q(manager)},${q(randomUUID())},luminovia_user_id,id,'accepted',now()+interval '2 days'
        from public.profiles where id=${q(member)};
        insert into private.company_participant_memberships(organisation_id,user_id,status,link_request_id,invited_by,joined_at)
          values(${q(org)},${q(member)},'active',${q(link)},${q(manager)},now());`);
      }
      await configure(true);
      const window = (who, course, method) =>
        rpc(who, "course_withdrawal_window", q(course), method)
          .then(JSON.parse)
          .then((value) => courseWithdrawalWindowSchema.parse(value));
      const withdraw = (who, course, method) =>
        rpc(who, "cancel_own_course_enrolment", q(course), method);
      const enrol = (course, who = learner, status = "enrolled") =>
        rpc(
          manager,
          "manage_course_enrolment",
          `${q(course)},${q(who)},${q(status)}`,
        );
      const courseWorkspace = (who, course) =>
        rpc(who, "course_workspace", q(course)).then(JSON.parse);
      const rosterStatus = (course, who = learner) =>
        sql(
          `select status from public.course_enrolments where course_run_id=${q(course)} and user_id=${q(who)}`,
        );
      const createRoom = (course) =>
        rpc(manager, "academy_ensure_course_chat", q(course));
      const history = (who, room) =>
        rpc(who, "course_chat_messages", q(room)).then(JSON.parse);
      const send = (who, room) =>
        rpc(
          who,
          "send_course_chat_message",
          `${q(room)},'Fictional retained message',${q(randomUUID())}`,
        );
      const documents = (who) =>
        rpc(who, "course_document_access", `'resource',${q(share)}`).then(
          JSON.parse,
        );
      for (const id of [retained, late, unscheduled, graceCourse, scheduleRace])
        await enrol(id);
      await enrol(completed, learner, "completed");

      const payload = {
        time_zone: "Australia/Brisbane",
        delivery_type: "online",
        venue: "",
        sessions: [
          { starts_at: date(8), ends_at: date(8.1) },
          { starts_at: date(9), ends_at: date(9.1) },
        ],
      };
      const { course_run_id: course } = await rpc(
        manager,
        "academy_create_course_draft",
        `${q(randomUUID())},${q(org)},${q(template)},null,${q(JSON.stringify(payload))}`,
      ).then(JSON.parse);
      await rpc(
        manager,
        "academy_assign_course_instructor",
        `${q(course)},${q(teacher)},${q(randomUUID())}`,
      );
      await rpc(manager, "academy_publish_course", `${q(course)},1`);
      await enrol(course);
      await assert.rejects(enrol(course, other), /PT409/);
      const room = await createRoom(course);
      const legacyRoom = await createRoom(retained);
      const retainedMessage = await send(learner, room);
      await send(learner, legacyRoom);
      await sql(`update private.participant_chat_origins set assignment=false,unknown=true
      where room_id=${q(legacyRoom)} and user_id=${q(learner)};
      insert into public.documents(id,owner_id,uploaded_by,scope,kind,original_name,mime_type,size_bytes,status,client_id)
        values(${q(document)},${q(manager)},${q(manager)},'personal','material','fictional handbook.pdf','application/pdf',25,'clean',${q(randomUUID())});
      insert into public.document_versions(id,document_id,uploaded_by,client_id,version,object_path,original_name,mime_type,size_bytes,status,sha256,scanner_version)
        values(${q(version)},${q(document)},${q(manager)},${q(randomUUID())},1,'fictional/handbook.pdf','fictional handbook.pdf','application/pdf',25,'clean',${q("a".repeat(64))},'ClamAV fictional');
      insert into private.course_resources(id,run_id,version_id,audience,category,created_by)
        values(${q(share)},${q(course)},${q(version)},'participants','material',${q(manager)});`);
      const scope = await window(learner, course, "GET");
      assert.equal(scope.can_withdraw, true);
      assert.equal(new Date(scope.deadline_at).toISOString(), date(1));
      assert.equal((await history(learner, room))[0].id, retainedMessage);
      assert.equal((await documents(learner)).id, version);
      await assert.rejects(window(other, course), /42501/);
      await assert.rejects(withdraw(other, course), /42501/);
      await assert.rejects(withdraw(manager, course), /42501/);
      await assert.rejects(withdraw(learner, course, "GET"), /42501/);
      for (const unavailable of [late, unscheduled, completed]) {
        assert.equal((await window(learner, unavailable)).can_withdraw, false);
        await assert.rejects(
          withdraw(learner, unavailable),
          unavailable === completed ? /42501/ : /22023/,
        );
      }
      // Re-evaluate the first date after the shared course lock, never from a
      // previously loaded withdrawal window.
      assert.equal((await window(learner, scheduleRace)).can_withdraw, true);
      const reschedule = sql(`begin;
      select 1 from public.course_runs where id=${q(scheduleRace)} for update;
      update public.course_sessions set starts_at=${q(date(6))},ends_at=${q(date(7))}
      where course_run_id=${q(scheduleRace)};
      select pg_sleep(0.6); commit;`);
      let holdsCourse = false;
      for (let attempt = 0; attempt < 25 && !holdsCourse; attempt++) {
        holdsCourse =
          (await sql(`select exists(select 1 from pg_stat_activity where datname=current_database()
        and pid<>pg_backend_pid() and wait_event='PgSleep')`)) === "t";
        if (!holdsCourse)
          await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.equal(holdsCourse, true);
      await Promise.all([
        reschedule,
        assert.rejects(withdraw(learner, scheduleRace), /22023/),
      ]);
      assert.equal(await rosterStatus(scheduleRace), "enrolled");

      // A concurrent confirmation can succeed only once. The removed roster
      // row remains and the published course has one place again.
      const attempts = await Promise.allSettled([
        withdraw(learner, course),
        withdraw(learner, course),
      ]);
      assert.equal(
        attempts.filter((result) => result.status === "fulfilled").length,
        1,
      );
      assert.match(
        attempts.find((result) => result.status === "rejected").reason.message,
        /42501/,
      );
      assert.equal(await rosterStatus(course), "removed");
      assert.equal(
        await sql(`select count(*) from public.audit_events where actor_id=${q(learner)}
      and resource_id=${q(course)} and action='course.enrolment.changed' and details->>'self_cancelled'='true'`),
        "1",
      );
      assert.equal(
        await sql(
          `select count(*) from public.course_sessions where course_run_id=${q(course)}`,
        ),
        "2",
      );
      await assert.rejects(
        rpc(
          manager,
          "academy_save_draft_schedule",
          `${q(course)},1,${q(JSON.stringify(payload))}`,
        ),
        /PT409/,
      );
      assert.equal(
        await sql(
          `select count(*) from public.chat_members where room_id=${q(room)} and user_id=${q(learner)} and removed_at is not null`,
        ),
        "1",
      );
      assert.equal(
        await sql(
          `select count(*) from public.messages where id=${q(retainedMessage)} and deleted_at is null`,
        ),
        "1",
      );
      await assert.rejects(courseWorkspace(learner, course), /42501/);
      await assert.rejects(history(learner, room), /42501/);
      await assert.rejects(send(learner, room), /42501/);
      await assert.rejects(documents(learner), /42501/);
      assert.equal((await courseWorkspace(learner, retained)).id, retained);
      assert.equal((await history(manager, room))[0].id, retainedMessage);
      await enrol(course, other);
      assert.equal(await rosterStatus(course, other), "enrolled");

      await withdraw(learner, retained);
      assert.equal(await rosterStatus(retained), "removed");
      assert.equal(
        await sql(
          `select count(*) from public.chat_members where room_id=${q(legacyRoom)} and user_id=${q(learner)} and removed_at is null`,
        ),
        "1",
      );
      await assert.rejects(history(learner, legacyRoom), /42501/);
      assert.equal(await rosterStatus(late), "enrolled");

      await configure(false);
      await assert.rejects(window(learner, graceCourse), /42501/);
      await assert.rejects(
        actor(
          learner,
          `select public.cancel_own_course_enrolment(${q(graceCourse)})`,
        ),
        /42501/,
      );
      await configure(true);
      await renew({ issued_at: date(-8), expires_at: date(-1) });
      const graceWindow = await window(learner, graceCourse);
      assert.equal(graceWindow.can_withdraw, false);
      assert.equal(new Date(graceWindow.deadline_at).toISOString(), date(3));
      await assert.rejects(withdraw(learner, graceCourse), /42501/);
      await assert.rejects(
        actor(
          learner,
          `select public.cancel_own_course_enrolment(${q(graceCourse)})`,
        ),
        /42501/,
      );
      assert.equal(await rosterStatus(graceCourse), "enrolled");
      await renew({
        issued_at: date(-7),
        expires_at: date(-2),
        grace_until: date(-1),
      });
      await assert.rejects(window(learner, graceCourse), /42501/);
      console.log(
        `PASS ${edition} whole-course withdrawal: current deadline, single audit, freed capacity, immediate protected course/chat/material revocation, retained messages and independent origins, grace`,
      );
    },
  );
}
