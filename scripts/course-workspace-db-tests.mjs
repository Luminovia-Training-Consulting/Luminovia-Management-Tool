import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { withTestDatabase, quoteSql as q } from "./testing/database.mjs";

await withTestDatabase("course_workspace", async ({ sql, actor }) => {
  const [admin, teacher, learner, second, third, client, foreign] = Array.from(
    { length: 7 },
    randomUUID,
  );
  await sql(`insert into auth.users(id,email) values ${[admin, teacher, learner, second, third, client, foreign].map((id) => `(${q(id)},${q(id + "@example.invalid")})`).join(",")};
 insert into public.user_roles(user_id,role) values(${q(admin)},'admin'),(${q(teacher)},'lecturer'),(${q(learner)},'participant'),(${q(second)},'participant'),(${q(third)},'participant'),(${q(client)},'client'),(${q(foreign)},'lecturer');`);
  const [
    org,
    otherorg,
    template,
    run,
    current,
    session,
    currentSession,
    job,
    claim,
    contact,
    wrongcontact,
  ] = Array.from({ length: 11 }, randomUUID);
  await sql(`insert into public.organisations(id,name)values(${q(org)},'Fictional course customer'),(${q(otherorg)},'Other private customer');
 insert into public.organisation_contacts(id,organisation_id,name,email,phone,notes)values(${q(contact)},${q(org)},'Fictional course contact','course@example.invalid','+49 40 123','Never expose internal notes'),(${q(wrongcontact)},${q(otherorg)},'Foreign private contact','foreign@example.invalid','','');
 insert into public.client_organisation_memberships(user_id,organisation_id)values(${q(client)},${q(org)});
 insert into public.course_templates(id,title,syllabus)values(${q(template)},'Fictional practical Linux','Practise safe commands');
 insert into public.course_runs(id,template_id,organisation_id)values(${q(run)},${q(template)},${q(org)}),(${q(current)},${q(template)},${q(org)});
 update public.course_runs set venue='https://example.invalid/fictional-course' where id=${q(run)};
 insert into public.course_sessions(id,course_run_id,starts_at,ends_at)values(${q(session)},${q(run)},now()-interval '2 days 1 hour',now()-interval '2 days'),(${q(currentSession)},${q(current)},now()-interval '30 minutes',now()+interval '30 minutes');
 insert into public.jobs(id,course_run_id,title,customer_name,delivery_type,status,amount,currency,rate_unit,total_amount,terms)values(${q(job)},${q(run)},'Fictional assigned course','Fictional customer','online','filled',100,'EUR','fixed_total',100,'Fictional terms');
 insert into public.job_claims(id,job_id,lecturer_id,idempotency_key,amount,currency,rate_unit,total_amount,terms,terms_version)values(${q(claim)},${q(job)},${q(teacher)},${q(randomUUID())},100,'EUR','fixed_total',100,'Fictional terms',1);
 insert into public.course_enrolments(course_run_id,user_id,status,enrolled_by)values ${[learner, second, third].map((id) => `(${q(run)},${q(id)},'completed',${q(admin)})`).join(",")},(${q(current)},${q(learner)},'enrolled',${q(admin)});`);
  const rpc = async (who, name, args = []) =>
    JSON.parse(
      await actor(
        who,
        `select to_jsonb(public.${name}(${args.join(",")}))`,
        who === admin ? "aal2" : "aal1",
      ),
    );
  const workspace = (who, course = run) =>
    rpc(who, "course_workspace", [q(course)]);
  const action = (who, name, payload = {}, version = 0, course = run) =>
    rpc(who, "course_workspace_action", [
      q(course),
      q(name),
      q(JSON.stringify(payload)),
      String(version),
    ]);
  let count = 0;
  const check = async (name, fn) => {
    await fn();
    console.log("PASS " + name);
    count++;
  };
  await check(
    "Exact course/org/enrolment rights, active identity and no administrator-without-MFA bypass",
    async () => {
      const learnerWorkspace = await workspace(learner);
      assert.equal(learnerWorkspace.access.learner, true);
      assert.equal(
        learnerWorkspace.venue,
        "https://example.invalid/fictional-course",
      );
      assert.equal((await workspace(teacher)).access.teacher, true);
      assert.equal((await workspace(client)).access.client, true);
      await assert.rejects(workspace(foreign), /42501/);
      await assert.rejects(
        actor(admin, `select public.course_workspace(${q(run)})`),
        /42501/,
      );
      assert.equal((await rpc(foreign, "my_course_workspaces")).length, 0);
    },
  );
  let preparation;
  await check(
    "Shared checklist is real CAS state; learner cannot write, client sees only selected rows",
    async () => {
      preparation = (
        await action(admin, "preparation_create", {
          label: "Check lab account",
          client_visible: true,
        })
      ).id;
      await action(admin, "preparation_create", {
        label: "Private teaching note",
        client_visible: false,
      });
      assert.equal((await workspace(client)).preparation.length, 1);
      assert.equal((await workspace(learner)).preparation.length, 0);
      await assert.rejects(
        action(
          learner,
          "preparation_toggle",
          { id: preparation, done: true },
          1,
        ),
        /42501/,
      );
      await action(
        teacher,
        "preparation_toggle",
        { id: preparation, done: true },
        1,
      );
      assert.equal((await workspace(client)).preparation[0].done, true);
      await assert.rejects(
        action(
          teacher,
          "preparation_toggle",
          { id: preparation, done: false },
          1,
        ),
        /40001/,
      );
    },
  );
  await check(
    "Course contact is explicitly selected from matching organisation without private notes",
    async () => {
      assert.equal((await workspace(learner)).contact, null);
      await assert.rejects(
        action(admin, "contact_select", { contact_id: wrongcontact }),
        /42501/,
      );
      await action(admin, "contact_select", { contact_id: contact });
      const shared = (await workspace(learner)).contact;
      assert.equal(shared.email, "course@example.invalid");
      assert.ok(!JSON.stringify(shared).includes("notes"));
    },
  );
  let resource, versionId;
  await check(
    "Exact clean material version grants and receipts do not widen normal document RLS",
    async () => {
      const doc = randomUUID();
      versionId = randomUUID();
      await sql(`insert into public.documents(id,owner_id,uploaded_by,scope,kind,original_name,mime_type,size_bytes,status,client_id)values(${q(doc)},${q(admin)},${q(admin)},'personal','material','Agreed.pdf','application/pdf',10,'clean',${q(randomUUID())});
   insert into public.document_versions(id,document_id,uploaded_by,client_id,version,object_path,original_name,mime_type,size_bytes,status,sha256)values(${q(versionId)},${q(doc)},${q(admin)},${q(randomUUID())},1,'fictional/agreed.pdf','Agreed.pdf','application/pdf',10,'clean',${q("a".repeat(64))});update public.documents set current_version_id=${q(versionId)} where id=${q(doc)};`);
      resource = (
        await action(admin, "resource_share", {
          version_id: versionId,
          audience: "participants",
          category: "material",
        })
      ).id;
      assert.equal((await workspace(client)).resources.length, 0);
      assert.equal(
        (await workspace(learner)).resources[0].version_id,
        versionId,
      );
      assert.equal(
        await actor(
          learner,
          `select count(*) from public.documents where id=${q(doc)}`,
        ),
        "0",
      );
      assert.equal(
        (
          await rpc(learner, "course_document_access", [
            q("resource"),
            q(resource),
          ])
        ).id,
        versionId,
      );
      await assert.rejects(
        rpc(client, "course_document_access", [q("resource"), q(resource)]),
        /42501/,
      );
      await action(learner, "resource_acknowledge", { id: resource });
      assert.equal((await workspace(learner)).resources[0].acknowledged, true);
      await action(admin, "resource_remove", { id: resource });
      await assert.rejects(
        rpc(learner, "course_document_access", [q("resource"), q(resource)]),
        /42501/,
      );
    },
  );
  await check(
    "Personal notebook is owner-only while course Q&A admits enrolled learners and assigned teachers",
    async () => {
      await action(learner, "notebook", { body: "My private draft" });
      assert.equal(
        (await workspace(learner)).notebook.body,
        "My private draft",
      );
      assert.equal((await workspace(admin)).notebook.body, "");
      const question = (
        await action(learner, "question", { body: "How do permissions work?" })
      ).id;
      await action(
        teacher,
        "answer",
        { id: question, answer: "Use least privilege." },
        1,
      );
      assert.equal(
        (await workspace(second)).questions[0].answer,
        "Use least privilege.",
      );
      assert.equal((await workspace(client)).questions.length, 0);
    },
  );
  await check(
    "Check-in is only self-reported within the actual session window; staff verification is audited and corrected by CAS",
    async () => {
      await action(
        learner,
        "attendance_report",
        { session_id: currentSession },
        0,
        current,
      );
      assert.equal(
        (await workspace(learner, current)).sessions[0].attendance,
        "reported",
      );
      await assert.rejects(
        action(learner, "attendance_report", { session_id: session }),
        /22023/,
      );
      await assert.rejects(
        action(learner, "attendance_verify", {
          session_id: session,
          user_id: learner,
          state: "attended",
          minutes: 60,
          reason: "Self approval",
        }),
        /42501/,
      );
      await action(teacher, "attendance_verify", {
        session_id: session,
        user_id: learner,
        state: "absent",
        minutes: 0,
        reason: "Initial roll call",
      });
      await action(
        teacher,
        "attendance_verify",
        {
          session_id: session,
          user_id: learner,
          state: "attended",
          minutes: 60,
          reason: "Corrected after signed register check",
        },
        1,
      );
      const state = await workspace(teacher);
      assert.equal(state.attendance_history.length, 2);
      assert.equal(
        state.roster.find((r) => r.user_id === learner).sessions[0].version,
        2,
      );
      assert.equal((await workspace(client)).attendance_history.length, 0);
    },
  );
  await check(
    "Post-course feedback hides author identity and withholds ordinary summaries until three responses",
    async () => {
      await action(learner, "feedback", {
        rating: 5,
        comment: "Useful practical work",
      });
      assert.equal((await workspace(teacher)).feedback_summary.average, null);
      await action(second, "feedback", {
        rating: 4,
        comment: "Helpful examples",
      });
      await action(third, "feedback", {
        rating: 3,
        comment: "More time for practice",
      });
      const summary = (await workspace(teacher)).feedback_summary;
      assert.equal(summary.count, 3);
      assert.equal(Number(summary.average), 4);
      assert.ok(!JSON.stringify(summary).includes(learner));
      await assert.rejects(
        action(
          learner,
          "feedback",
          { rating: 5, comment: "Before completion" },
          0,
          current,
        ),
        /42501/,
      );
    },
  );
  await check(
    "Published mini-quiz withholds answers, caps attempts and makes accepted retries idempotent",
    async () => {
      await action(teacher, "quiz_config", {
        questions: [
          { prompt: "Read a directory?", options: ["ls", "rm"], correct: 0 },
        ],
        pass_percent: 80,
        max_attempts: 2,
        published: true,
      });
      assert.ok(
        !Object.hasOwn((await workspace(learner)).quiz.questions[0], "correct"),
      );
      const request = randomUUID();
      assert.equal(
        (
          await action(
            learner,
            "quiz_attempt",
            { answers: [1], request_id: request },
            1,
          )
        ).passed,
        false,
      );
      assert.equal(
        (
          await action(
            learner,
            "quiz_attempt",
            { answers: [1], request_id: request },
            1,
          )
        ).passed,
        false,
      );
      assert.equal(
        (
          await action(
            learner,
            "quiz_attempt",
            { answers: [0], request_id: randomUUID() },
            1,
          )
        ).passed,
        true,
      );
      await assert.rejects(
        action(
          learner,
          "quiz_attempt",
          { answers: [0], request_id: randomUUID() },
          1,
        ),
        /22023/,
      );
    },
  );
  let completion;
  await check(
    "Completion requires verified attendance, completed enrolment and quiz pass, then preserves immutable facts",
    async () => {
      await assert.rejects(action(second, "completion_issue"), /22023/);
      completion = (await action(learner, "completion_issue")).id;
      assert.equal((await action(learner, "completion_issue")).id, completion);
      const document = await rpc(learner, "course_document_access", [
        q("completion"),
        q(completion),
      ]);
      assert.equal(document.course, "Fictional practical Linux");
      assert.equal(document.verified_minutes, 60);
      assert.equal(document.quiz_passed, true);
      await assert.rejects(
        rpc(second, "course_document_access", [q("completion"), q(completion)]),
        /42501/,
      );
      await assert.rejects(
        action(
          teacher,
          "attendance_verify",
          {
            session_id: session,
            user_id: learner,
            state: "absent",
            minutes: 0,
            reason: "Correction after issue",
          },
          2,
        ),
        /22023/,
      );
      await action(teacher, "completion_revoke", {
        id: completion,
        reason: "Attendance evidence requires correction",
      });
      await assert.rejects(action(learner, "completion_issue"), /22023/);
      await assert.rejects(
        rpc(learner, "course_document_access", [
          q("completion"),
          q(completion),
        ]),
        /42501/,
      );
      await action(
        teacher,
        "attendance_verify",
        {
          session_id: session,
          user_id: learner,
          state: "absent",
          minutes: 0,
          reason: "Corrected attendance evidence",
        },
        2,
      );
      await assert.rejects(action(learner, "completion_issue"), /22023/);
      await action(
        teacher,
        "attendance_verify",
        {
          session_id: session,
          user_id: learner,
          state: "attended",
          minutes: 60,
          reason: "New documented verification after correction",
        },
        3,
      );
      const replacement = (await action(learner, "completion_issue")).id;
      assert.notEqual(replacement, completion);
    },
  );
  await check(
    "Client repeat booking creates only a fresh idempotent request with future dates and retained quote",
    async () => {
      const original = randomUUID(),
        key = randomUUID();
      const payload = {
        title: "Delivered fictional request",
        description: "Original scope",
        delivery_type: "online",
        location: "https://example.invalid/class",
        time_zone: "Europe/Berlin",
        sessions: [],
        topic_ids: [],
        gross_amount: 100,
        gross_total_amount: 100,
        currency: "EUR",
        rate_unit: "fixed_total",
      };
      await sql(
        `insert into public.job_sessions(job_id,starts_at,ends_at)values(${q(job)},now()-interval '2 days 1 hour',now()-interval '2 days');insert into private.client_course_requests(id,organisation_id,requested_by,client_id,payload,status,job_id)values(${q(original)},${q(org)},${q(client)},${q(randomUUID())},${q(JSON.stringify(payload))},'published',${q(job)});`,
      );
      const sessions = [
        {
          starts_at: new Date(Date.now() + 7 * 86400000).toISOString(),
          ends_at: new Date(Date.now() + 7 * 86400000 + 3600000).toISOString(),
        },
      ];
      const created = await rpc(client, "repeat_client_request", [
        q(original),
        q(JSON.stringify(sessions)),
        q(key),
      ]);
      assert.equal(
        await rpc(client, "repeat_client_request", [
          q(original),
          q(JSON.stringify(sessions)),
          q(key),
        ]),
        created,
      );
      const record = JSON.parse(
        await sql(
          `select jsonb_build_object('status',status,'job_id',job_id,'payload',payload)from private.client_course_requests where id=${q(created)}`,
        ),
      );
      assert.equal(record.status, "submitted");
      assert.equal(record.job_id, null);
      assert.equal(record.payload.gross_total_amount, 100);
      assert.equal(record.payload.title, payload.title);
      await assert.rejects(
        rpc(foreign, "repeat_client_request", [
          q(original),
          q(JSON.stringify(sessions)),
          q(randomUUID()),
        ]),
        /42501/,
      );
    },
  );
  await check(
    "Membership and account revocation remove course documents with existing identities",
    async () => {
      await sql(
        `update public.client_organisation_memberships set removed_at=now() where user_id=${q(client)};update public.course_enrolments set status='removed' where user_id=${q(learner)};`,
      );
      await assert.rejects(workspace(client), /42501/);
      await assert.rejects(workspace(learner), /42501/);
      await sql(
        `update public.profiles set active=false where id=${q(teacher)}`,
      );
      await assert.rejects(workspace(teacher), /42501/);
    },
  );
  console.log(`Passed ${count} real course workspace PostgreSQL groups.`);
});
