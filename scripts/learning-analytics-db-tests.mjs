/** Exercise the published report through the actual database access gate in each edition. */
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { z } from "zod";
import { academyOpenApi } from "../src/features/developer-api/academy-contract.ts";
import { portalOpenApi } from "../src/features/developer-api/contract.ts";
import { internalInstallationBrand } from "../src/lib/installation-brand.ts";
import {
  learningAnalyticsAccessSchema,
  learningAnalyticsReportSchema,
} from "../src/features/analytics/learning-schema.ts";
import {
  configureAcademyCourseAccess,
  prepareAcademyInstallation,
} from "./academy-installation.mjs";
import { signAcademyLicence } from "./academy-licence.mjs";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

const target = "https://academy.example.invalid";
const denied = /42501/;
const literal = (value) =>
  typeof value === "string" ? q(value) : String(value);
const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString();

for (const edition of [
  "internal",
  "customer-managed",
  "customer-self-hosted",
]) {
  await withTestDatabase("learning_analytics", async ({ sql, actor }) => {
    const [
      admin,
      manager,
      company,
      foreign,
      teacher,
      learner,
      second,
      withdrawn,
    ] = Array.from({ length: 8 }, randomUUID);
    const [
      org,
      other,
      template,
      finished,
      upcoming,
      unrelated,
      first,
      last,
      future,
      classId,
    ] = Array.from({ length: 10 }, randomUUID);
    const roles = [
      [admin, "admin"],
      [manager, "management"],
      [company, "client"],
      [foreign, "client"],
      [teacher, "lecturer"],
      [learner, "participant"],
      [second, "participant"],
      [withdrawn, "participant"],
    ];
    const terms = {
      installation_id: randomUUID(),
      edition,
      release_commit: "c7".repeat(20),
      issued_at: day(-6),
      starts_at: day(-5),
      expires_at: day(10),
      grace_until: day(20),
      modules: ["lms"],
      limits: {
        seat_count: 40,
        storage_bytes: 1_000_000,
        api_requests_per_minute: 100,
      },
    };
    if (edition !== "internal") {
      const key = generateKeyPairSync("ed25519");
      const setup = {
        envelope: signAcademyLicence(terms, key.privateKey),
        publicKey: key.publicKey,
        expected: terms,
        now: Date.now(),
      };
      await prepareAcademyInstallation(setup, sql);
      await configureAcademyCourseAccess({ ...setup, enabled: true }, sql);
    }
    await sql(`
      insert into auth.users(id,email,email_confirmed_at) values
        ${roles.map(([id]) => `(${q(id)},${q(id + "@example.invalid")},now())`).join(",")};
      insert into public.user_roles(user_id,role) values
        ${roles.map(([id, role]) => `(${q(id)},${q(role)})`).join(",")};
      update public.profiles set time_zone='Australia/Brisbane' where id=${q(company)};
      insert into public.organisations(id,name) values
        (${q(org)},'Fictional analytics academy'),(${q(other)},'Other academy');
      insert into public.client_organisation_memberships(user_id,organisation_id) values
        (${q(company)},${q(org)}),(${q(foreign)},${q(other)});
      insert into public.course_templates(id,title) values (${q(template)},'Fictional analytics course');
      insert into public.course_runs(id,template_id,organisation_id,published) values
        (${q(finished)},${q(template)},${q(org)},true),
        (${q(upcoming)},${q(template)},${q(org)},true),
        (${q(unrelated)},${q(template)},${q(other)},true);
      insert into public.course_sessions(id,course_run_id,starts_at,ends_at) values
        (${q(first)},${q(finished)},now()-interval '4 hours',now()-interval '3 hours'),
        (${q(last)},${q(finished)},now()-interval '3 hours',now()-interval '1 hour'),
        (${q(future)},${q(upcoming)},now()+interval '5 days',now()+interval '5 days 1 hour');
      insert into private.course_classes(id,organisation_id,name) values
        (${q(classId)},${q(org)},'Fictional class 100%');
      insert into private.course_class_assignments(course_id,organisation_id,class_id,version)
        values (${q(finished)},${q(org)},${q(classId)},1);
    `);
    for (const person of [learner, second, withdrawn]) {
      const link = randomUUID();
      await sql(`
        insert into private.company_participant_link_requests
          (id,organisation_id,requested_by,request_id,luminovia_user_id,target_user_id,status,expires_at)
          select ${q(link)},${q(org)},${q(admin)},${q(randomUUID())},luminovia_user_id,id,'accepted',now()+interval '1 day'
          from public.profiles where id=${q(person)};
        insert into private.company_participant_memberships
          (organisation_id,user_id,status,link_request_id,invited_by,joined_at)
          values (${q(org)},${q(person)},'active',${q(link)},${q(admin)},now());
      `);
    }
    const job = randomUUID(),
      claim = randomUUID();
    await sql(`
      insert into public.jobs(id,course_run_id,title,customer_name,delivery_type,status,amount,currency,rate_unit,total_amount,terms)
        values (${q(job)},${q(upcoming)},'Fictional assignment','Fictional academy','online','filled',100,'EUR','fixed_total',100,'Fictional terms');
      insert into public.job_claims(id,job_id,lecturer_id,idempotency_key,amount,currency,rate_unit,total_amount,terms,terms_version)
        values (${q(claim)},${q(job)},${q(teacher)},${q(randomUUID())},100,'EUR','fixed_total',100,'Fictional terms',1);
      ${
        edition === "internal"
          ? ""
          : `insert into private.academy_course_instructors(course_id,instructor_id,claim_id,assigned_by,request_id)
          values (${q(upcoming)},${q(teacher)},${q(claim)},${q(admin)},${q(randomUUID())});`
      }
      insert into public.course_enrolments(course_run_id,user_id,status,enrolled_by) values
        (${q(finished)},${q(learner)},'completed',${q(admin)}),
        (${q(finished)},${q(second)},'enrolled',${q(admin)}),
        (${q(finished)},${q(withdrawn)},'removed',${q(admin)}),
        (${q(upcoming)},${q(learner)},'enrolled',${q(admin)});
      insert into private.course_attendance(session_id,user_id,state,register_status,staff_note) values
        (${q(first)},${q(learner)},'attended',null,'Private note'),
        (${q(last)},${q(learner)},'absent','excused',''),
        (${q(first)},${q(second)},'reported',null,''),
        (${q(last)},${q(second)},'absent','absent',''),
        (${q(first)},${q(withdrawn)},'attended','present',''),
        (${q(future)},${q(learner)},'attended','present','');
      insert into private.course_completion_records(run_id,user_id,snapshot,revoked_at) values
        (${q(finished)},${q(learner)},'{"private":"completion snapshot"}',null),
        (${q(finished)},${q(second)},'{}',now());
    `);
    const spec =
      edition === "internal"
        ? portalOpenApi(target, true, internalInstallationBrand)
        : academyOpenApi(target, {
            name: "Fictional academy",
            installationId: terms.installation_id,
            edition,
          });
    const rpc = async (id, name, ...args) =>
      JSON.parse(
        await actor(
          id,
          `
      set local request.path=${q("/rpc/" + name)};
      set local request.method='POST';
      select public.require_portal_access();
      select public.${name}(${args.map(literal).join(",")})
    `,
        ),
      );
    const from = day(-10).slice(0, 10),
      until = day(15).slice(0, 10);
    const access = async (id) => {
      const result = await rpc(id, "learning_analytics_access");
      z.fromJSONSchema(
        spec.paths["/rest/v1/rpc/learning_analytics_access"].post.responses[
          "200"
        ].content["application/json"].schema,
      ).parse(result);
      return learningAnalyticsAccessSchema.parse(result);
    };
    const report = async (
      id,
      scope,
      organisation,
      status = "all",
      search = "",
      page = 1,
      end = until,
    ) => {
      const result = await rpc(
        id,
        "learning_analytics_report",
        scope,
        from,
        end,
        organisation,
        status,
        search,
        page,
      );
      z.fromJSONSchema(
        spec.paths["/rest/v1/rpc/learning_analytics_report"].post.responses[
          "200"
        ].content["application/json"].schema,
      ).parse(result);
      return learningAnalyticsReportSchema.parse(result);
    };
    if (edition === "internal") {
      assert.deepEqual((await access(company)).organisations, []);
      await assert.rejects(report(company, "company", org), denied);
      await rpc(admin, "set_company_premium", org, true, 0, randomUUID());
    }

    const actual = await report(company, "company", org);
    assert.equal(actual.time_zone, "Australia/Brisbane");
    assert.deepEqual(actual.totals, {
      courses: 2,
      upcoming: 1,
      participants: 2,
      enrolments: 3,
      completions: 1,
      certificates: 1,
      sessions: 3,
      minutes: 240,
      present: 1,
      absent: 1,
      excused: 1,
    });
    assert.deepEqual(
      actual.courses.map(({ id, status, enrolments }) => [
        id,
        status,
        enrolments,
      ]),
      [
        [upcoming, "upcoming", 1],
        [finished, "finished", 2],
      ],
    );
    assert.equal(
      actual.months.reduce((count, month) => count + month.finished, 0),
      1,
    );
    assert.equal(
      actual.months.reduce((count, month) => count + month.enrolments, 0),
      3,
    );
    assert(!JSON.stringify(actual).includes(learner));
    assert(!JSON.stringify(actual).includes("Private note"));
    assert.equal(
      (await report(company, "company", org, "all", "100%")).courses[0].id,
      finished,
    );
    assert.equal(
      (await report(company, "company", org, "all", "_")).totals.courses,
      0,
    );
    assert.equal(
      (await report(company, "company", org, "upcoming")).courses[0].id,
      upcoming,
    );
    assert.equal(
      (await report(company, "company", org, "all", "", 2)).courses.length,
      0,
    );
    await assert.rejects(
      report(company, "company", org, "all", "", 1, from),
      /22023/,
    );
    assert.deepEqual(
      (await access(company)).organisations.map((entry) => entry.id),
      [org],
    );
    assert.deepEqual((await access(teacher)).organisations, []);
    assert.equal((await access(manager)).staff, true);
    if (edition === "internal") await assert.rejects(access(learner), denied);
    else assert.equal((await access(learner)).staff, false);
    if (edition === "internal") {
      const privateClass = randomUUID();
      await sql(`insert into private.course_classes(id,organisation_id,name)
        values (${q(privateClass)},${q(org)},'Hidden analytics cohort');
        insert into private.course_class_assignments(course_id,organisation_id,class_id,version)
        values (${q(upcoming)},${q(org)},${q(privateClass)},1)`);
      const personal = await report(teacher, "personal", null);
      assert.equal(personal.courses[0].organisation, "");
      assert.equal(personal.courses[0].class_name, null);
      assert.equal(
        (
          await report(
            teacher,
            "personal",
            null,
            "all",
            "Hidden analytics cohort",
          )
        ).courses.length,
        0,
      );
      const staff = await report(
        manager,
        "staff",
        null,
        "all",
        "Hidden analytics cohort",
      );
      assert.equal(staff.courses[0].id, upcoming);
      assert.equal(
        staff.courses[0].organisation,
        "Fictional analytics academy",
      );
    }
    assert.deepEqual(
      (await report(teacher, "personal", null)).courses.map(({ id }) => id),
      [upcoming],
    );
    assert.equal(
      (await report(manager, "staff", null)).totals.courses,
      edition === "internal" ? 2 : 3,
    );
    assert.equal((await report(admin, "staff", org)).totals.courses, 2);

    // Reuse the previously withdrawn fixture as the third eligible learner.
    // Assessment facts deliberately include stale revisions and private text.
    const scores = [
      [learner, 90],
      [second, 60],
      [withdrawn, 75],
    ];
    const quizAttempts = scores.map(() => randomUUID());
    const assignment = randomUUID();
    const submissions = scores.map(() => randomUUID());
    const framework = randomUUID();
    const competency = randomUUID();
    const level = randomUUID();
    await sql(`
      begin;
      update public.course_enrolments set status = 'enrolled'
        where course_run_id = ${q(finished)} and user_id = ${q(withdrawn)};
      insert into private.course_quiz_versions(run_id,version,questions,pass_percent,max_attempts,published)
        values (${q(finished)},1,'[]',70,4,true);
      insert into private.course_quiz_attempts(id,run_id,quiz_version,user_id,request_id,answers,score,passed)
        values ${scores
          .map(
            ([id, score], index) =>
              `(${q(quizAttempts[index])},${q(finished)},1,${q(id)},${q(randomUUID())},'["Private quiz answer"]',${score},${score >= 70})`,
          )
          .join(",")},
          (${q(randomUUID())},${q(finished)},1,${q(learner)},${q(randomUUID())},'[]',40,false);
      insert into private.course_gradebook_policies(run_id,version,scheme,bands)
        values(${q(finished)},1,'percentage','[]');
      insert into private.course_gradebook_revisions
        (run_id,user_id,revision,attempt_id,quiz_version,source_score,source_passed,policy_version,grade_percent,correction_reason)
        values ${scores
          .map(
            ([id, score], index) =>
              `(${q(finished)},${q(id)},1,${q(quizAttempts[index])},1,${score},${score >= 70},1,${score},null)`,
          )
          .join(",")},
          (${q(finished)},${q(learner)},2,${q(quizAttempts[0])},1,90,true,1,84,'Private grade correction');
      insert into private.course_assignments(id,run_id,current_version,published_version)
        values (${q(assignment)},${q(finished)},1,1);
      insert into private.course_assignment_definitions(assignment_id,version,title,instructions,due_at,max_attempts,rubric)
        values (${q(assignment)},1,'Private assignment title','Private instructions',now()+interval '1 day',2,'[]');
      insert into private.course_assignment_attempts(id,assignment_id,assignment_version,user_id,attempt_no,file_name)
        values ${scores
          .map(
            ([id], index) =>
              `(${q(submissions[index])},${q(assignment)},1,${q(id)},1,'Private submission filename')`,
          )
          .join(",")};
      insert into private.course_assignment_reviews(attempt_id,version,state,scores,feedback,private_note)
        values ${submissions.map((id) => `(${q(id)},1,'released','[]','Private feedback','Private staff assessment')`).join(",")},
          (${q(submissions[0])},2,'draft','[]','Private draft','Private moderation');
      insert into private.lms_competency_frameworks(id,organisation_id,revision)
        values (${q(framework)},${q(org)},1);
      insert into private.lms_competency_framework_revisions(framework_id,revision,content,created_by)
        values (${q(framework)},1,'{"title":"Private competency framework"}',${q(admin)});
      insert into private.lms_course_competency_pins(run_id,revision,framework_id,framework_revision,created_by)
        values (${q(finished)},1,${q(framework)},1,${q(admin)}),(${q(finished)},2,${q(framework)},1,${q(admin)});
      insert into private.lms_competency_decisions
        (run_id,pin_revision,user_id,competency_id,revision,level_id,evidence_note,quiz_attempt_id,created_by)
        values ${scores
          .map(
            ([id], index) =>
              `(${q(finished)},2,${q(id)},${q(competency)},1,${q(level)},'Private competency evidence',${q(quizAttempts[index])},${q(admin)})`,
          )
          .join(",")},
          (${q(finished)},1,${q(learner)},${q(randomUUID())},1,${q(level)},'Private older pin',null,${q(admin)}),
          (${q(finished)},2,${q(learner)},${q(competency)},2,${q(level)},'Private revised decision',null,${q(admin)});
      commit;
    `);
    const assessment = (await report(manager, "staff", org, "all", "100%"))
      .assessment;
    assert.deepEqual(assessment, {
      metric_version: 1,
      minimum_learner_count: 3,
      courses: [
        {
          course_id: finished,
          quiz_learners: 3,
          quiz_attempts: 4,
          quiz_passes: 2,
          quiz_best_average: 75,
          published_grades: 3,
          published_grade_average: 73,
          submission_learners: 3,
          submission_attempts: 3,
          released_reviews: 3,
          competency_learners: 3,
          competency_decisions: 3,
        },
      ],
    });
    for (const secret of [
      ...scores.map(([id]) => id),
      ...quizAttempts,
      framework,
      competency,
      level,
      ...submissions,
      "Private",
      "file_name",
      "evidence",
    ])
      assert(!JSON.stringify(assessment).includes(secret));

    const staffUpcoming = (await report(teacher, "personal", null)).assessment;
    assert.equal(staffUpcoming.courses[0].course_id, upcoming);
    assert.equal(staffUpcoming.courses[0].quiz_attempts, null);
    const companyScope = await report(company, "company", org);
    assert.equal(Object.hasOwn(companyScope, "assessment"), false);
    await assert.rejects(report(company, "staff", org), denied);

    // A labelled correction supersedes the old numeric grade. This measure
    // must redact independently when the remaining numeric sample falls below three.
    await sql(`
      insert into private.course_gradebook_policies(run_id,version,scheme,bands)
        values(${q(finished)},2,'bands','[{"minimum":0,"label":"In development"},{"minimum":70,"label":"Competent"}]');
      insert into private.course_gradebook_revisions
        (run_id,user_id,revision,attempt_id,quiz_version,source_score,source_passed,policy_version,grade_label,correction_reason)
        values(${q(finished)},${q(learner)},3,${q(quizAttempts[0])},1,90,true,2,'Competent','Released labelled scale');
      insert into private.course_assignment_reviews(attempt_id,version,state,scores,feedback,private_note)
        values (${q(submissions[0])},3,'revision_requested','[]','Private revision request','Private note');
    `);
    const mixed = (await report(manager, "staff", org, "all", "100%"))
      .assessment.courses[0];
    assert.equal(mixed.published_grades, 3);
    assert.equal(mixed.published_grade_average, null);
    assert.equal(mixed.submission_attempts, 3);
    assert.equal(mixed.released_reviews, null);
    assert.equal(mixed.quiz_best_average, 75);

    // The same credible facts become inadmissible as soon as a current
    // participant leaves. There must be no small-cohort totals or inference via
    // direct repeated search of a single course.
    await sql(`update public.course_enrolments set status='removed'
      where course_run_id=${q(finished)} and user_id=${q(withdrawn)}`);
    const suppressed = (await report(manager, "staff", org, "all", "100%"))
      .assessment.courses[0];
    assert.equal(suppressed.course_id, finished);
    for (const [key, value] of Object.entries(suppressed)) {
      if (key !== "course_id") assert.equal(value, null);
    }

    await assert.rejects(report(foreign, "company", org), denied);
    await assert.rejects(report(company, "company", other), denied);
    await assert.rejects(report(learner, "staff", null), denied);
    await assert.rejects(report(learner, "personal", null), denied);
    await assert.rejects(report(teacher, "personal", org), denied);
    await assert.rejects(
      sql(
        "begin; set local role anon; select public.learning_analytics_access(); commit",
      ),
      denied,
    );
    await rpc(company, "set_company_lecturer_block", org, teacher, true, 0);
    assert.equal((await report(teacher, "personal", null)).totals.courses, 0);
    assert.equal((await report(company, "company", org)).totals.courses, 2);
    await rpc(manager, "set_company_lecturer_block", org, teacher, false, 1);
    assert.equal((await report(teacher, "personal", null)).totals.courses, 1);

    await sql(`
      insert into public.course_runs(template_id,organisation_id,published)
        select ${q(template)},${q(org)},false from generate_series(1,26);
    `);
    const firstPage = await report(company, "company", org, "draft");
    const secondPage = await report(company, "company", org, "draft", "", 2);
    assert.equal(firstPage.courses.length, 25);
    assert.equal(secondPage.courses.length, 1);
    assert.equal(secondPage.totals.courses, 26);
    assert.equal(
      new Set([...firstPage.courses, ...secondPage.courses].map(({ id }) => id))
        .size,
      26,
    );
    await sql(`
      delete from public.course_runs where organisation_id=${q(org)} and not published;
      update public.course_runs set archived_at=now() where id=${q(finished)};
    `);
    assert.equal(
      (await report(admin, "staff", org, "archived")).courses[0].id,
      finished,
    );
    assert.equal(
      (await report(company, "company", org, "archived")).totals.courses,
      0,
    );
    await sql(
      `update public.course_runs set archived_at=null where id=${q(finished)}`,
    );
    await sql(
      `update public.client_organisation_memberships set removed_at=now() where user_id=${q(company)}`,
    );
    await assert.rejects(report(company, "company", org), denied);
    if (edition === "internal") {
      await rpc(admin, "set_company_premium", org, false, 1, randomUUID());
      assert.equal((await report(manager, "staff", null)).totals.courses, 0);
    } else {
      const grace = {
        ...terms,
        issued_at: day(-3),
        starts_at: day(-3),
        expires_at: day(-1),
        grace_until: day(3),
      };
      await sql(
        `select private.apply_verified_installation_licence(${q(JSON.stringify(grace))}::jsonb)`,
      );
      assert.equal((await report(admin, "staff", org)).totals.courses, 2);
      const expired = {
        ...grace,
        issued_at: day(-2),
        starts_at: day(-2),
        grace_until: day(-0.1),
      };
      await sql(
        `select private.apply_verified_installation_licence(${q(JSON.stringify(expired))}::jsonb)`,
      );
      const blocked = await report(admin, "staff", org).catch((error) => {
        assert.match(error.message, denied);
        return null;
      });
      assert.equal(blocked?.totals.courses ?? 0, 0);
    }
    console.log(
      `PASS ${edition} learning analytics totals, verified attendance, role scopes, filters and entitlement changes`,
    );
  });
}
