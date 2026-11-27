/** Exercise programme authority and progress through the actual course transactions. */
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import {
  learningProgramClassProgressResult,
  learningProgramCohortGrades,
  learningProgramGradeReport,
  learningProgramsResult,
} from "../src/features/learning/learning-program-schema.ts";
import {
  configureAcademyCourseAccess,
  prepareAcademyInstallation,
} from "./academy-installation.mjs";
import { signAcademyLicence } from "./academy-licence.mjs";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

const editions = ["internal", "customer-self-hosted", "customer-managed"];
const requested = process.env.PORTAL_LEARNING_PROGRAM_EDITION;
if (requested) assert.ok(editions.includes(requested));

await Promise.all(
  (requested ? [requested] : editions).map((edition) =>
    withTestDatabase("learning_program", async ({ sql, actor }) => {
      const [
        admin,
        company,
        otherCompany,
        learner,
        otherLearner,
        colleague,
        org,
        other,
        templateOne,
        templateTwo,
        first,
        second,
        otherRun,
        draft,
        sessionOne,
        sessionTwo,
        program,
        classA,
        classB,
      ] = Array.from({ length: 19 }, randomUUID);
      const roles = [
        [admin, "admin"],
        [company, "client"],
        [otherCompany, "client"],
        [learner, "participant"],
        [otherLearner, "participant"],
        [colleague, "participant"],
      ];
      const internal = edition === "internal";
      let checkGradeLicence;
      if (!internal) {
        const now = Date.now();
        const date = (days) => new Date(now + days * 86_400_000).toISOString();
        const expected = {
          installation_id: randomUUID(),
          edition,
          release_commit: "a5".repeat(20),
          issued_at: date(-3),
          starts_at: date(-2),
          expires_at: date(7),
          grace_until: date(9),
          modules: ["lms"],
          limits: {
            seat_count: 20,
            storage_bytes: 1_000_000,
            api_requests_per_minute: 100,
          },
        };
        const { publicKey, privateKey } = generateKeyPairSync("ed25519");
        const setup = {
          envelope: signAcademyLicence(expected, privateKey),
          publicKey,
          expected,
          now,
        };
        await prepareAcademyInstallation(setup, sql);
        await configureAcademyCourseAccess({ ...setup, enabled: true }, sql);
        const renew = (changes) =>
          sql(
            `select private.apply_verified_installation_licence(${q(JSON.stringify({ ...expected, ...changes }))}::jsonb);`,
          );
        checkGradeLicence = async (readOwn, readStaff, report) => {
          await renew({
            issued_at: date(-2.75),
            starts_at: date(-2.5),
            expires_at: date(-1),
          });
          assert.deepEqual(await readOwn(), report);
          assert.deepEqual(await readStaff(), report);
          await renew({
            issued_at: date(-2.5),
            starts_at: date(-2.25),
            expires_at: date(-1),
            grace_until: date(-0.5),
          });
          await assert.rejects(readOwn(), /42501/);
          await assert.rejects(readStaff(), /42501/);
          await renew({ issued_at: date(-2.25), starts_at: date(-2) });
          assert.deepEqual(await readOwn(), report);
        };
      }
      await sql(`
      insert into auth.users (id,email,email_confirmed_at) values
        ${roles.map(([id], index) => `(${q(id)}, 'program-${index}@example.invalid', now())`).join(",")};
      insert into public.user_roles(user_id,role) values ${roles.map(([id, role]) => `(${q(id)},${q(role)})`).join(",")};
      insert into public.organisations(id,name) values (${q(org)},'Fictional Programme Company'),(${q(other)},'Another Fictional Company');
      insert into public.client_organisation_memberships(user_id,organisation_id) values
        (${q(company)},${q(org)}),(${q(otherCompany)},${q(other)});
      insert into public.course_templates(id,title) values (${q(templateOne)},'Module one'),(${q(templateTwo)},'Module two');
      insert into public.course_runs(id,template_id,organisation_id,published,time_zone) values
        (${q(first)},${q(templateOne)},${q(org)},true,'UTC'),
        (${q(second)},${q(templateTwo)},${q(org)},true,'UTC'),
        (${q(otherRun)},${q(templateOne)},${q(other)},true,'UTC'),
        (${q(draft)},${q(templateTwo)},${q(org)},false,'UTC');
      insert into public.course_sessions(id,course_run_id,starts_at,ends_at) values
        (${q(sessionOne)},${q(first)},now()-interval '4 days',now()-interval '4 days' + interval '1 hour'),
        (${q(sessionTwo)},${q(second)},now()-interval '2 days',now()-interval '2 days' + interval '1 hour');
      with accepted as (
        insert into private.company_participant_link_requests(
          organisation_id,requested_by,request_id,luminovia_user_id,target_user_id,status,expires_at
        ) select member.company,${q(admin)},gen_random_uuid(),profile.luminovia_user_id,
          member.person,'accepted',now()+interval '1 day'
        from (values (${q(org)}::uuid,${q(learner)}::uuid),(${q(org)}::uuid,${q(colleague)}::uuid),
          (${q(other)}::uuid,${q(otherLearner)}::uuid)) member(company,person)
        join public.profiles profile on profile.id=member.person returning id,organisation_id,target_user_id
      )
      insert into private.company_participant_memberships(organisation_id,user_id,status,link_request_id,invited_by,joined_at)
      select organisation_id,target_user_id,'active',id,${q(admin)},now() from accepted;
      insert into private.course_classes(id,organisation_id,name) values
        (${q(classA)},${q(org)},'Fictional Class A'),(${q(classB)},${q(org)},'Fictional Class B');
      insert into private.course_class_assignments(course_id,organisation_id,class_id,version) values
        (${q(first)},${q(org)},${q(classB)},1);

    `);
      const gateway = (name, verb) => `
      set local request.path=${q("/rpc/" + name)};set local request.method=${q(verb)};
      set local request.headers='{}';select public.require_portal_access();
    `;
      const invoke = (who, name, args, verb = "POST") =>
        actor(who, gateway(name, verb) + `select public.${name}(${args});`);
      const classes = async (who = company) =>
        learningProgramClassProgressResult.parse(
          JSON.parse(
            await invoke(
              who,
              "learning_program_class_progress",
              q(program),
              "GET",
            ),
          ),
        );
      const groupA = (
        participants,
        participantsCompleted,
        modulesCompleted,
      ) => ({
        class_id: classA,
        class_name: "Fictional Class A",
        participants,
        participants_completed: participantsCompleted,
        module_slots: 2 * participants,
        modules_completed: modulesCompleted,
      });
      const place = (who, learnerId, classId, version) =>
        invoke(
          who,
          "set_company_participant_class",
          `${q(org)},${q(learnerId)},${classId === null ? "null" : q(classId)},${version}`,
        );
      await assert.rejects(place(otherCompany, learner, classA, 1), /42501/);
      await place(company, learner, classA, 1);
      await place(admin, colleague, classB, 1);
      await assert.rejects(place(company, learner, classB, 1), /PT409/);
      const view = async (who, target = program) =>
        learningProgramsResult.parse(
          JSON.parse(
            await invoke(
              who,
              "learning_programs",
              target ? q(target) : "",
              "GET",
            ),
          ),
        );
      const courses = (ids) => `array[${ids.map(q).join(",")}]::uuid[]`;
      const save = (
        who,
        {
          ids = [first, second],
          title = "Technical programme",
          version = 0,
          archive = false,
        } = {},
      ) =>
        invoke(
          who,
          "save_learning_program",
          `${q(program)},${q(org)},${q(title)},'Fictional two course programme',true,${courses(ids)},${archive},${version}`,
        );
      const enrol = (who, target = learner) =>
        invoke(who, "enrol_learning_program", `${q(program)},${q(target)},1`);
      const start = (who, course) =>
        invoke(
          who,
          "start_learning_program_course",
          `${q(program)},${q(course)}`,
        );
      const lessonAction = internal
        ? "course_workspace_action"
        : "academy_learning_action";
      const progress = async (who = learner) =>
        (await view(who)).detail.progress;
      const grades = async (who = learner, target, verb = "GET") =>
        learningProgramGradeReport.parse(
          JSON.parse(
            await invoke(
              who,
              "learning_program_grade_report",
              `${q(program)}${target ? `,${q(target)}` : ""}`,
              verb,
            ),
          ),
        );

      await assert.rejects(save(otherCompany), /42501/);
      await assert.rejects(save(company, { ids: [first, otherRun] }), /42501/);
      await assert.rejects(save(company, { ids: [first, draft] }), /42501/);
      await assert.rejects(save(company, { ids: [first, first] }), /22023/);
      assert.equal(await save(company), program);
      assert.equal(await save(company), program);
      assert.equal((await view(company)).detail.version, 1);
      assert.deepEqual(await classes(), []);
      await assert.rejects(classes(otherCompany), /42501/);
      await assert.rejects(classes(learner), /42501/);

      assert.equal((await view(otherCompany, null)).programs.length, 0);
      await assert.rejects(view(otherCompany), /42501/);
      await assert.rejects(view(learner), /42501/);
      await assert.rejects(grades(), /42501/);
      await assert.rejects(enrol(company, otherLearner), /42501/);
      console.log(
        `PASS ${edition} programme writes are retry-safe and reject foreign, draft and duplicate modules`,
      );

      await Promise.all([enrol(company), enrol(company)]);
      assert.deepEqual(
        (await progress()).steps.map((step) => step.state),
        ["in_progress", "locked"],
      );
      await assert.rejects(start(learner, second), /PT409/);
      await assert.rejects(start(colleague, first), /42501/);
      assert.equal((await view(company)).detail.roster.length, 1);
      await assert.rejects(
        save(company, { title: "Unsafe change", version: 1 }),
        /PT409/,
      );
      assert.equal(
        await sql(
          `select count(*) from public.course_enrolments where user_id=${q(learner)}`,
        ),
        "1",
      );
      console.log(
        `PASS ${edition} whole-programme enrolment creates one authorised starting course, roster scope and immutable rules`,
      );

      if (internal) {
        const workspace = JSON.parse(await invoke(learner, "course_workspace", q(first), "GET"));
        assert.equal(workspace.lms_enabled, false);
        assert.equal(workspace.access.learner, true);
        await invoke(learner, "course_content_studio", q(first), "GET");
        await assert.rejects(invoke(otherLearner, "course_content_studio", q(first), "GET"), /42501/);
        await assert.rejects(invoke(learner, "course_exam_state", q(first), "GET"), /42501/);
        await assert.rejects(invoke(learner, "course_gradebook", q(first), "GET"), /42501/);
        await invoke(admin, "manage_course_enrolment", `${q(first)},${q(learner)},'completed'`);
        const basic = await progress();
        assert.equal(basic.steps[0].state, "completed");
        assert.equal(basic.steps[0].receipt_id, null);
        assert.equal(basic.steps[1].state, "ready");
        await actor(admin, `select public.set_company_premium(${q(org)},true,0,${q(randomUUID())});`);
      }

      const complete = async (course, session) => {
        await invoke(
          admin,
          "manage_course_enrolment",
          `${q(course)},${q(learner)},'completed'`,
        );
        await invoke(
          admin,
          "save_course_session_attendance",
          `${q(course)},${q(session)},${q(learner)},'present',null,null,'','',0`,
        );
        return JSON.parse(
          await invoke(
            learner,
            lessonAction,
            `${q(course)},'completion_issue','{}',0`,
          ),
        ).id;
      };
      const firstReceipt = await complete(first, sessionOne);
      assert.deepEqual(await classes(), [groupA(1, 0, 1)]);

      assert.equal((await progress()).steps[0].receipt_id, firstReceipt);
      assert.deepEqual(
        (await progress()).steps.map((step) => step.state),
        ["completed", "ready"],
      );
      await sql(
        `insert into public.user_roles(user_id,role) values(${q(learner)},'lecturer');`,
      );
      await start(learner, second);
      await start(learner, second);
      const secondReceipt = await complete(second, sessionTwo);
      assert.deepEqual(await classes(admin), [groupA(1, 1, 2)]);
      await enrol(company, colleague);
      assert.deepEqual(await classes(), [
        groupA(1, 1, 2),
        {
          class_id: classB,
          class_name: "Fictional Class B",
          participants: 1,
          participants_completed: 0,
          module_slots: 2,
          modules_completed: 0,
        },
      ]);
      await place(company, colleague, classA, 2);
      assert.deepEqual(await classes(), [groupA(2, 1, 2)]);
      const classOptions = (await view(company)).detail;
      assert.equal(classOptions.classes.length, 2);
      assert.deepEqual(
        classOptions.roster.find((person) => person.id === colleague).placement,
        { class_id: classA, version: 3 },
      );
      assert.equal((await view(learner)).detail.classes, null);
      assert.equal((await view(learner)).detail.roster, null);

      // Retained reports use only the latest released rounded score for each
      // programme course. These frozen rows include a newer unpublished review.
      const emptyGrades = { grade_count: 0, mean_percent: null, grades: [] };
      assert.deepEqual(await grades(), emptyGrades);
      assert.equal((await view(admin)).detail.can_read_grades, true);
      assert.equal((await view(company)).detail.can_read_grades, false);
      assert.equal((await view(learner)).detail.can_read_grades, false);
      await assert.rejects(grades(company, learner), /42501/);
      await assert.rejects(grades(otherCompany, learner), /42501/);
      await assert.rejects(grades(learner, colleague), /42501/);
      await assert.rejects(grades(admin, otherLearner), /42501/);
      await sql(`
        insert into private.course_weighted_policies(run_id,version,threshold,missing_required,separate_reviewer,items,created_by)
          select run,1,70,'block',false,'[{"key":"quiz","treatment":"required","weight":100,"label":null}]',${q(admin)}
          from (values (${q(first)}::uuid),(${q(second)}::uuid)) course(run);
        insert into private.course_weighted_reviews(run_id,user_id,revision,policy_version,prior_release,fingerprint,snapshot,reason,reviewed_by)
          select course.run,${q(learner)},course.revision,1,0,repeat('f',64),
            jsonb_build_object('percent',course.mark,'passed',course.mark >= 70,
              'basis',jsonb_build_object('private','Fictional review evidence')),'Fictional staff note',${q(admin)}
          from (values (${q(first)}::uuid,1,49),(${q(first)}::uuid,2,82.25),(${q(first)}::uuid,3,99),
            (${q(second)}::uuid,1,65.50)) course(run,revision,mark);
        insert into private.course_weighted_releases(run_id,user_id,revision,review_revision,released_by)
          select course.run,${q(learner)},course.revision,course.revision,${q(admin)}
          from (values (${q(first)}::uuid,1),(${q(first)}::uuid,2),(${q(second)}::uuid,1)) course(run,revision);
      `);
      const report = await grades();
      assert.deepEqual(await grades(admin, learner, "POST"), report);
      assert.equal(report.grade_count, 2);
      assert.equal(report.mean_percent, 73.88);
      assert.deepEqual(
        report.grades.map(({ course_id, revision, percent, passed }) => [
          course_id,
          revision,
          percent,
          passed,
        ]),
        [
          [first, 2, 82.25, true],
          [second, 1, 65.5, false],
        ],
      );
      assert.deepEqual(await grades(colleague), emptyGrades);
      assert.deepEqual(await grades(admin, colleague), emptyGrades);
      const cohort = async (who, search = "", offset = 0) =>
        learningProgramCohortGrades.parse(
          JSON.parse(
            await invoke(
              who,
              "learning_program_cohort_grades",
              `${q(program)},${q(search)},${offset}`,
              "GET",
            ),
          ),
        );
      const page = await cohort(admin);
      assert.equal(page.more, false);
      assert.deepEqual(
        page.rows.find(({ participant_id }) => participant_id === learner)
          .report,
        report,
      );
      assert.deepEqual(
        page.rows.find(({ participant_id }) => participant_id === colleague)
          .report,
        emptyGrades,
      );
      assert.deepEqual(await cohort(admin, "no possible learner match"), {
        rows: [],
        more: false,
      });
      assert.deepEqual(await cohort(admin, "", 30), { rows: [], more: false });
      for (const who of [company, otherCompany, learner])
        await assert.rejects(cohort(who), /42501/);
      await sql(
        `update public.course_enrolments set status='removed' where course_run_id=${q(first)} and user_id=${q(learner)}`,
      );
      assert.deepEqual(
        (await grades()).grades.map(({ course_id }) => course_id),
        [second],
      );
      assert.deepEqual(
        (await grades(admin, learner)).grades.map(({ course_id }) => course_id),
        [second],
      );
      await sql(
        `update public.course_enrolments set status='completed' where course_run_id=${q(first)} and user_id=${q(learner)}`,
      );
      console.log(
        `PASS ${edition} programme grade reports use frozen scoped releases, exclude drafts, and hide removed enrolments`,
      );

      await place(company, colleague, null, 3);
      assert.deepEqual(await classes(), [groupA(1, 1, 2)]);
      await place(company, colleague, classA, 4);

      // Unpublishing a course removes access to its content, while a valid
      // receipt still counts in both the learner and class results.
      await sql(
        `update public.course_runs set published=false where id=${q(second)}`,
      );
      const hiddenCourseProgress = await progress();
      assert.equal(hiddenCourseProgress.steps[1].can_open, false);
      assert.deepEqual(
        (await grades()).grades.map(({ course_id }) => course_id),
        [first],
      );
      assert.equal(hiddenCourseProgress.completed, 2);
      assert.deepEqual(await classes(), [groupA(2, 1, 2)]);
      await sql(
        `update public.course_runs set published=true where id=${q(second)}`,
      );

      assert.equal((await progress()).steps[1].receipt_id, secondReceipt);
      assert.ok((await progress()).completed_at);
      assert.equal(
        (await view(company)).detail.roster.find(
          (person) => person.id === learner,
        ).progress.completed,
        2,
      );

      const electiveProgramme = randomUUID();
      const optionalRun = randomUUID();
      await sql(`insert into public.course_runs(id,template_id,organisation_id,published,time_zone)
        values (${q(optionalRun)},${q(templateTwo)},${q(org)},true,'UTC');`);
      await invoke(
        company,
        "save_learning_program",
        `${q(electiveProgramme)},${q(org)},'Required and elective programme','',true,${courses([first, second, optionalRun])},false,0`,
      );
      const curriculum = {
        overview: "Apply the foundation in one workshop",
        elective_count: 1,
        steps: {
          [first]: {
            required: true,
            objectives: "Review the foundation",
            remediation: "Repeat the practice",
          },
          [second]: {
            required: false,
            objectives: "Practise the method",
            remediation: "",
          },
          [optionalRun]: {
            required: false,
            objectives: "Try another workshop",
            remediation: "",
          },
        },
      };
      const configure = (who, content, version) =>
        invoke(
          who,
          "configure_learning_program_curriculum",
          `${q(electiveProgramme)},${q(JSON.stringify(content))}::jsonb,${version}`,
        );
      await assert.rejects(configure(learner, curriculum, 1), /42501/);
      await assert.rejects(
        configure(company, { ...curriculum, elective_count: 3 }, 1),
        /22023/,
      );
      assert.equal(await configure(company, curriculum, 1), "2");
      assert.equal(await configure(company, curriculum, 1), "2");
      await invoke(
        company,
        "enrol_learning_program",
        `${q(electiveProgramme)},${q(learner)},2`,
      );
      const electiveView = () =>
        view(learner, electiveProgramme).then(({ detail }) => detail);
      const electiveClassProgress = async () =>
        learningProgramClassProgressResult.parse(
          JSON.parse(
            await invoke(
              company,
              "learning_program_class_progress",
              q(electiveProgramme),
              "GET",
            ),
          ),
        );
      const finishedElectives = await electiveView();
      assert.deepEqual(finishedElectives.curriculum, {
        ...curriculum,
        revision: 2,
      });
      assert.equal(finishedElectives.progress.completed, 2);
      assert.equal(finishedElectives.progress.total, 2);
      assert.ok(finishedElectives.progress.completed_at);
      assert.deepEqual(await electiveClassProgress(), [groupA(1, 1, 2)]);
      assert.deepEqual(
        finishedElectives.progress.steps.map(
          (step) => step.completion_credited,
        ),
        [true, true, false],
      );
      await assert.rejects(
        configure(company, { ...curriculum, overview: "Another version" }, 2),
        /PT409/,
      );

      await invoke(
        admin,
        lessonAction,
        `${q(second)},'completion_revoke',${q(JSON.stringify({ id: secondReceipt, reason: "Fictional review" }))},0`,
      );
      const revokedElectives = (await electiveView()).progress;
      assert.equal(revokedElectives.completed_at, null);
      assert.equal(revokedElectives.completed, 1);
      assert.deepEqual(await electiveClassProgress(), [groupA(1, 0, 1)]);
      console.log(
        `PASS ${edition} versioned programme curriculum, receipt-based elective completion and revocation`,
      );
      assert.equal((await progress()).completed_at, null);
      assert.equal((await progress()).completed, 1);
      assert.deepEqual(await classes(), [groupA(2, 0, 1)]);
      console.log(
        `PASS ${edition} class progress follows current placements and valid receipts with no learner data or foreign access`,
      );
      console.log(
        `PASS ${edition} canonical attendance and completion unlock the next module, and revocation withdraws the programme proof`,
      );

      // An alternative gate uses receipt authority without making its
      // non-selected courses optional for the whole-programme certificate.
      const alternative = randomUUID();
      const last = randomUUID();
      await sql(`insert into public.course_runs(id,template_id,organisation_id,published,time_zone)
        values (${q(last)},${q(templateOne)},${q(org)},true,'UTC');`);
      const saveAlternative = (ids, version = 0) =>
        invoke(
          company,
          "save_learning_program",
          `${q(alternative)},${q(org)},'Alternative path','',true,${courses(ids)},false,${version}`,
        );
      const setGate = (who, mode, required, version) =>
        invoke(
          who,
          "set_learning_program_prerequisite",
          `${q(alternative)},3,${q(mode)},array[${required.join(",")}]::integer[],${version}`,
        );
      const activateAlternative = (who) =>
        invoke(
          who,
          "start_learning_program_course",
          `${q(alternative)},${q(last)}`,
        );
      const enrolAlternative = (who, version) =>
        invoke(
          company,
          "enrol_learning_program",
          `${q(alternative)},${q(who)},${version}`,
        );
      await saveAlternative([first, second, last]);
      await assert.rejects(setGate(otherCompany, "all", [1, 2], 1), /42501/);
      await assert.rejects(setGate(learner, "all", [1, 2], 1), /42501/);
      await assert.rejects(setGate(company, "all", [2, 3], 1), /22023/);
      await assert.rejects(setGate(company, "all", [1, 1], 1), /22023/);
      await setGate(company, "all", [2, 1], 1);
      assert.equal((await view(company, alternative)).detail.version, 2);
      await assert.rejects(setGate(company, "any", [1, 2], 1), /PT409/);
      await assert.rejects(saveAlternative([second, first, last], 2), /PT409/);
      const concurrentRules = await Promise.allSettled([
        setGate(company, "any", [2, 1], 2),
        setGate(admin, "all", [1], 2),
      ]);
      assert.equal(
        concurrentRules.filter(({ status }) => status === "fulfilled").length,
        1,
      );
      assert.match(
        concurrentRules.find(({ status }) => status === "rejected").reason
          .message,
        /PT409/,
      );
      if (concurrentRules[0].status === "rejected")
        await setGate(company, "any", [1, 2], 3);
      // An identical retry returns success without adding another revision.
      const version = (await view(company, alternative)).detail.version;
      await setGate(company, "any", [1, 2], version - 1);
      const alternativeProgramme = (await view(company, alternative)).detail;
      assert.equal(alternativeProgramme.version, version);
      assert.deepEqual(alternativeProgramme.path_rules, {
        3: { mode: "any", positions: [1, 2] },
      });
      await enrolAlternative(learner, version);
      await enrolAlternative(colleague, version);
      await assert.rejects(setGate(company, "all", [], version), /PT409/);
      const learnerPath = (await view(learner, alternative)).detail;
      assert.equal(learnerPath.path_rules, null);
      assert.equal(learnerPath.progress.completed, 1);
      assert.equal(learnerPath.progress.completed_at, null);
      assert.equal(learnerPath.progress.steps[2].state, "ready");
      const blocked = (await view(colleague, alternative)).detail.progress
        .steps[2];
      assert.equal(blocked.state, "locked");
      assert.deepEqual(blocked.prerequisites, {
        mode: "any",
        items: [
          { position: 1, title: "Module one", completed: false },
          { position: 2, title: "Module two", completed: false },
        ],
      });
      await assert.rejects(activateAlternative(colleague), /PT409/);
      const changeException = (
        who,
        active,
        expected,
        reason = "Verified learning accommodation",
      ) =>
        invoke(
          who,
          "set_learning_program_path_exception",
          `${q(alternative)},${q(colleague)},3,${active},${q(reason)},${expected}`,
        );
      await assert.rejects(changeException(company, true, 0), /42501/);
      await assert.rejects(changeException(learner, true, 0), /42501/);
      assert.equal(await changeException(admin, true, 0), "1");
      assert.equal(await changeException(admin, true, 0), "1");
      const excepted = (await view(colleague, alternative)).detail.progress;
      assert.equal(excepted.steps[2].state, "ready");
      assert.deepEqual(excepted.steps[2].prerequisite_exception, {
        active: true,
        revision: 1,
      });
      assert.equal(excepted.completed_at, null);
      assert.ok(
        !JSON.stringify(excepted).includes("Verified learning accommodation"),
      );
      await assert.rejects(changeException(admin, false, 0), /PT409/);
      assert.equal(await changeException(admin, false, 1), "2");
      assert.equal(
        (await view(colleague, alternative)).detail.progress.steps[2].state,
        "locked",
      );
      await assert.rejects(activateAlternative(colleague), /PT409/);
      await activateAlternative(learner);
      assert.equal(
        (await view(learner, alternative)).detail.progress.steps[2].state,
        "in_progress",
      );
      await invoke(
        admin,
        lessonAction,
        `${q(first)},'completion_revoke',${q(JSON.stringify({ id: firstReceipt, reason: "Fictional alternative prerequisite review" }))},0`,
      );
      assert.equal(
        (await view(learner, alternative)).detail.progress.steps[2].state,
        "locked",
      );
      await assert.rejects(activateAlternative(learner), /PT409/);
      console.log(
        `PASS ${edition} alternative prerequisites are versioned, scoped and revoked against current receipts`,
      );

      await save(company, { archive: true, version: 1 });
      assert.equal((await view(learner)).detail.archived, true);
      assert.deepEqual(await grades(), report);
      if (checkGradeLicence) {
        await checkGradeLicence(grades, () => grades(admin, learner), report);
        console.log(
          `PASS ${edition} programme grade reports are readable in grace, denied after expiry, and retained after renewal`,
        );
      }
      await assert.rejects(enrol(company, colleague), /PT409/);
      await sql(`update private.company_participant_memberships set status='removed',removed_at=now()
      where organisation_id=${q(org)} and user_id=${q(learner)}`);
      await assert.rejects(view(learner), /42501/);
      await assert.rejects(grades(), /42501/);
      await assert.rejects(grades(admin, learner), /42501/);
      assert.equal(
        await sql(
          `select count(*) from private.course_weighted_releases where user_id=${q(learner)}`,
        ),
        "3",
      );
      assert.deepEqual(await classes(), [groupA(1, 0, 0)]);
      if (internal) {
        await actor(
          admin,
          `select public.set_company_premium(${q(org)},false,1,${q(randomUUID())});`,
        );
        assert.equal((await view(company)).detail.id, program);
        assert.deepEqual(await classes(), [groupA(1, 0, 0)]);
        await assert.rejects(grades(admin, colleague), /42501/);
      }
      assert.equal(
        await sql(
          `select has_function_privilege('anon','public.learning_programs(uuid,uuid,text)','EXECUTE')`,
        ),
        "f",
      );
      assert.equal(
        await sql(
          `select has_function_privilege('anon','public.learning_program_grade_report(uuid,uuid)','EXECUTE')`,
        ),
        "f",
      );
      console.log(
        `PASS ${edition} archive, membership removal, Premium entitlement and anonymous grants`,
      );
    }),
  ),
);
