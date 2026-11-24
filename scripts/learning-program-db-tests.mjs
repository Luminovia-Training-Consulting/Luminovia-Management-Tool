/** Exercise programme authority and progress through the actual course transactions. */
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { learningProgramsResult } from "../src/features/learning/learning-program-schema.ts";
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
      ] = Array.from({ length: 17 }, randomUUID);
      const roles = [
        [admin, "admin"],
        [company, "client"],
        [otherCompany, "client"],
        [learner, "participant"],
        [otherLearner, "participant"],
        [colleague, "participant"],
      ];
      const internal = edition === "internal";
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
    `);
      if (internal)
        await actor(
          admin,
          `select public.set_company_premium(${q(org)},true,0,${q(randomUUID())});`,
        );
      const gateway = (name, verb) => `
      set local request.path=${q("/rpc/" + name)};set local request.method=${q(verb)};
      set local request.headers='{}';select public.require_portal_access();
    `;
      const invoke = (who, name, args, verb = "POST") =>
        actor(who, gateway(name, verb) + `select public.${name}(${args});`);
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

      await assert.rejects(save(otherCompany), /42501/);
      await assert.rejects(save(company, { ids: [first, otherRun] }), /42501/);
      await assert.rejects(save(company, { ids: [first, draft] }), /42501/);
      await assert.rejects(save(company, { ids: [first, first] }), /22023/);
      assert.equal(await save(company), program);
      assert.equal(await save(company), program);
      assert.equal((await view(company)).detail.version, 1);
      assert.equal((await view(otherCompany, null)).programs.length, 0);
      await assert.rejects(view(otherCompany), /42501/);
      await assert.rejects(view(learner), /42501/);
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
      assert.equal((await progress()).steps[1].receipt_id, secondReceipt);
      assert.ok((await progress()).completed_at);
      assert.equal(
        (await view(company)).detail.roster[0].progress.completed,
        2,
      );
      await invoke(
        admin,
        lessonAction,
        `${q(second)},'completion_revoke',${q(JSON.stringify({ id: secondReceipt, reason: "Fictional review" }))},0`,
      );
      assert.equal((await progress()).completed_at, null);
      assert.equal((await progress()).completed, 1);
      console.log(
        `PASS ${edition} canonical attendance and completion unlock the next module, and revocation withdraws the programme proof`,
      );

      await save(company, { archive: true, version: 1 });
      assert.equal((await view(learner)).detail.archived, true);
      await assert.rejects(enrol(company, colleague), /PT409/);
      await sql(`update private.company_participant_memberships set status='removed',removed_at=now()
      where organisation_id=${q(org)} and user_id=${q(learner)}`);
      await assert.rejects(view(learner), /42501/);
      if (internal) {
        await actor(
          admin,
          `select public.set_company_premium(${q(org)},false,1,${q(randomUUID())});`,
        );
        await assert.rejects(view(company), /42501/);
      }
      assert.equal(
        await sql(
          `select has_function_privilege('anon','public.learning_programs(uuid,uuid,text)','EXECUTE')`,
        ),
        "f",
      );
      console.log(
        `PASS ${edition} archive, membership removal, Premium entitlement and anonymous grants`,
      );
    }),
  ),
);
