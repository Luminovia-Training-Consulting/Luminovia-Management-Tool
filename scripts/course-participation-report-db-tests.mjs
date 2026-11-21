/** Confirm role, licence, history and paging boundaries for the real report RPC. */
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { z } from "zod";
import { academyOpenApi } from "../src/features/developer-api/academy-contract.ts";
import { courseParticipationReportSchema } from "../src/features/learning/course-participation-report-schema.ts";
import {
  configureAcademyCourseAccess,
  prepareAcademyInstallation,
} from "./academy-installation.mjs";
import { signAcademyLicence } from "./academy-licence.mjs";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

for (const edition of [
  "internal",
  "customer-managed",
  "customer-self-hosted",
]) {
  await withTestDatabase(
    "academy_course_participation_report",
    async ({ sql, actor }) => {
      const [admin, company, foreign, learner, second, removed, instructor] =
        Array.from({ length: 7 }, randomUUID);
      const [org, other, template, run, unrelated, first, last, outside] =
        Array.from({ length: 8 }, randomUUID);
      const roles = {
        [admin]: "admin",
        [company]: "client",
        [foreign]: "client",
        [learner]: "participant",
        [second]: "participant",
        [removed]: "participant",
        [instructor]: "lecturer",
      };
      const epoch = Date.now();
      const date = (days) => new Date(epoch + days * 86_400_000).toISOString();
      const terms = {
        installation_id: randomUUID(),
        edition,
        release_commit: "d2".repeat(20),
        issued_at: date(-5),
        starts_at: date(-4),
        expires_at: date(15),
        grace_until: date(30),
        modules: ["lms"],
        limits: {
          seat_count: 25,
          storage_bytes: 1_000_000,
          api_requests_per_minute: 100,
        },
      };
      if (edition !== "internal") {
        const key = generateKeyPairSync("ed25519");
        const licence = {
          envelope: signAcademyLicence(terms, key.privateKey),
          publicKey: key.publicKey,
          expected: terms,
          now: epoch,
        };
        await prepareAcademyInstallation(licence, sql);
        await configureAcademyCourseAccess({ ...licence, enabled: true }, sql);
      }
      await sql(`
      insert into auth.users(id,email,email_confirmed_at) values
        ${Object.keys(roles)
          .map((id) => `(${q(id)},${q(id + "@example.invalid")},now())`)
          .join(",")};
      insert into public.user_roles(user_id,role) values
        ${Object.entries(roles)
          .map(([id, role]) => `(${q(id)},${q(role)})`)
          .join(",")};
      update public.profiles set display_name='Fictional report learner' where id=${q(learner)};
      insert into public.organisations(id,name)
        values (${q(org)},'Fictional reporting academy'),(${q(other)},'Unrelated academy');
      insert into public.client_organisation_memberships(user_id,organisation_id)
        values (${q(company)},${q(org)}),(${q(foreign)},${q(other)});
      insert into public.course_templates(id,title) values (${q(template)},'Fictional course');
      insert into public.course_runs(id,template_id,organisation_id,time_zone)
        values (${q(run)},${q(template)},${q(org)},'Europe/Berlin'),
               (${q(unrelated)},${q(template)},${q(other)},'UTC');
      insert into public.course_sessions(id,course_run_id,starts_at,ends_at)
        values (${q(first)},${q(run)},now()-interval '4 hours',now()-interval '3 hours'),
               (${q(last)},${q(run)},now()-interval '2 hours',now()-interval '1 hour'),
               (${q(outside)},${q(unrelated)},now()-interval '2 hours',now()-interval '1 hour');
      insert into public.course_enrolments(course_run_id,user_id,status,enrolled_by)
        values (${q(run)},${q(learner)},'completed',${q(admin)}),
               (${q(run)},${q(second)},'enrolled',${q(admin)}),
               (${q(run)},${q(removed)},'removed',${q(admin)}),
               (${q(unrelated)},${q(learner)},'completed',${q(admin)});
      insert into private.course_attendance(session_id,user_id,state,register_status,staff_note)
        values (${q(first)},${q(learner)},'attended',null,'Private arrival note'),
               (${q(last)},${q(learner)},'absent','excused','Private excuse'),
               (${q(outside)},${q(learner)},'absent','absent','Other course'),
               (${q(first)},${q(second)},'reported',null,'Unverified presence');
      insert into private.course_completion_records(run_id,user_id,snapshot,revoked_at)
        values (${q(run)},${q(learner)},'{"private":"completion snapshot"}',null),
               (${q(run)},${q(second)},'{}',now());
    `);
      if (edition === "internal") {
        await actor(
          admin,
          `select public.set_company_premium(${q(org)},true,0,${q(randomUUID())})`,
        );
      }
      const { paths } = academyOpenApi("https://academy.example.invalid", {
        name: "Fictional Academy",
        installationId: terms.installation_id,
        edition,
      });
      const responseSchema = z.fromJSONSchema(
        paths["/rest/v1/rpc/academy_course_participation_report"].post
          .responses["200"].content["application/json"].schema,
      );
      const call = async (
        who,
        { after = null, limit = 100, target = run } = {},
      ) => {
        const value = await actor(
          who,
          `set local request.path='/rpc/academy_course_participation_report';
          set local request.method='POST';
          select public.require_portal_access();
          select public.academy_course_participation_report(${q(target)},${after ? q(after) : "null"},${limit})`,
        );
        const payload = JSON.parse(value);
        responseSchema.parse(payload);
        return courseParticipationReportSchema.parse(payload);
      };
      if (edition === "internal") {
        await assert.rejects(call(admin), /42501/);
        console.log(
          "PASS internal Premium does not use the dedicated participation report API",
        );
        return;
      }
      const full = await call(admin);
      assert.equal(full.course_id, run);
      assert.equal(full.session_count, 2);
      assert.deepEqual(await call(company), full);
      assert.deepEqual(
        full.rows.map(({ user_id }) => user_id).sort(),
        [learner, second].sort(),
      );
      assert.deepEqual(
        full.rows.find(({ user_id }) => user_id === learner),
        {
          user_id: learner,
          participant_id: await sql(
            `select luminovia_user_id from public.profiles where id=${q(learner)}`,
          ),
          name: "Fictional report learner",
          enrolment: "completed",
          present: 1,
          absent: 0,
          excused: 1,
          completion: "issued",
        },
      );
      assert.equal(
        full.rows.find(({ user_id }) => user_id === second).completion,
        "revoked",
      );
      assert.equal(
        full.rows.find(({ user_id }) => user_id === second).present,
        0,
      );
      const firstPage = await call(company, { limit: 1 });
      assert.equal(firstPage.next_after, firstPage.rows[0].user_id);
      const secondPage = await call(company, {
        after: firstPage.next_after,
        limit: 1,
      });
      assert.deepEqual([...firstPage.rows, ...secondPage.rows], full.rows);
      assert.equal(secondPage.next_after, null);
      assert.deepEqual(
        (await call(company, { after: secondPage.rows[0].user_id })).rows,
        [],
      );
      await assert.rejects(call(admin, { limit: 201 }), /22023/);
      for (const who of [learner, foreign, instructor])
        await assert.rejects(call(who), /42501/);
      await assert.rejects(call(company, { target: unrelated }), /42501/);

      const assignedCourse = randomUUID();
      await sql(`insert into public.course_runs(id,template_id,organisation_id,time_zone)
        values(${q(assignedCourse)},${q(template)},${q(org)},'UTC');
        insert into public.course_sessions(course_run_id,starts_at,ends_at)
        values(${q(assignedCourse)},now()+interval '2 days',now()+interval '2 days 1 hour');`);
      const assignment = JSON.parse(
        await actor(
          admin,
          `select public.academy_assign_course_instructor(${q(assignedCourse)},${q(instructor)},${q(randomUUID())})`,
        ),
      );
      assert.equal(assignment.status, "confirmed");
      assert.deepEqual(await call(instructor, { target: assignedCourse }), {
        course_id: assignedCourse,
        session_count: 1,
        rows: [],
        next_after: null,
      });
      await sql(
        `delete from public.user_roles where user_id=${q(instructor)} and role='lecturer'`,
      );
      await assert.rejects(
        call(instructor, { target: assignedCourse }),
        /42501/,
      );

      await sql(`update public.client_organisation_memberships set removed_at=now()
      where user_id=${q(company)} and organisation_id=${q(org)}`);
      await assert.rejects(
        call(company, { after: firstPage.next_after }),
        /42501/,
      );
      const grace = {
        ...terms,
        issued_at: date(-1.4),
        starts_at: date(-1.3),
        expires_at: date(-0.5),
        grace_until: date(3),
      };
      await sql(
        `select private.apply_verified_installation_licence(${q(JSON.stringify(grace))}::jsonb)`,
      );
      assert.deepEqual(await call(admin), full);
      const expired = {
        ...grace,
        issued_at: date(-1.2),
        starts_at: date(-1.1),
        grace_until: date(-0.1),
      };
      await sql(
        `select private.apply_verified_installation_licence(${q(JSON.stringify(expired))}::jsonb)`,
      );
      await assert.rejects(call(admin), /42501/);
      console.log(
        `PASS ${edition} exact course participation, scoped identity, attendance, completion and cursor revocation`,
      );
    },
  );
}
