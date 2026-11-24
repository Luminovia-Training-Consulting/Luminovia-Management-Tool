import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {quoteSql as q, withTestDatabase} from "./testing/database.mjs";

await withTestDatabase("course_closeout", async ({sql, actor}) => {
    const [admin, staff, learner, organisation, course, template, session] =
        Array.from({length: 7}, randomUUID);
    await sql(`insert into auth.users(id,email,email_confirmed_at) values
      (${q(admin)},'closeout-admin@example.invalid',now()),
      (${q(staff)},'closeout-manager@example.invalid',now()),
      (${q(learner)},'closeout-learner@example.invalid',now());
      insert into public.user_roles(user_id,role) values
      (${q(admin)},'admin'),(${q(staff)},'management'),(${q(learner)},'participant');
      insert into public.organisations(id,name) values (${q(organisation)},'Fictional Academy');
      insert into public.course_templates(id,title) values (${q(template)},'Fictional closeout');
      insert into public.course_runs(id,template_id,organisation_id,published)
      values (${q(course)},${q(template)},${q(organisation)},true);`);
    await actor(admin, `select public.set_company_premium(${q(organisation)},true,0,${q(randomUUID())})`);
    await sql(`insert into public.course_sessions(id,course_run_id,starts_at,ends_at)
      values (${q(session)},${q(course)},now()-interval '5 days',now()-interval '4 days');
      insert into public.course_enrolments(course_run_id,user_id,enrolled_by)
      values (${q(course)},${q(learner)},${q(admin)});
      insert into private.course_submission_settings values(${q(course)},true);
      insert into private.course_timed_exams(run_id,title,visible_from,starts_at,ends_at,pass_percent)
      values (${q(course)},'Fictional exam',now()-interval '6 days',now()-interval '4 days',now()-interval '3 days',60);`);
    const preview = async (who = admin) => JSON.parse(await actor(who, `select public.course_closeout(${q(course)})`));
    const confirm = async (token, assignments, who = admin) => JSON.parse(await actor(who,
        `select public.confirm_course_closeout(${q(course)},${q(token)}, ${q(JSON.stringify(assignments))}::jsonb)`));

    await assert.rejects(preview(learner), /42501/);
    const original = await preview();
    assert.equal(original.can_close, true);
    assert.deepEqual(original.items.map((item) => item.kind), ["attendance","grade","submission"]);
    await assert.rejects(confirm(original.review_token, {attendance: staff}), /22023/);
    await sql(`insert into private.course_attendance(session_id,user_id,state,register_status)
      values(${q(session)},${q(learner)},'attended','present');`);
    await assert.rejects(confirm(original.review_token, {attendance: staff,grade: staff,submission: staff}), /40001/);
    const current = await preview();
    assert.deepEqual(current.items.map((item) => item.kind), ["grade","submission"]);
    await assert.rejects(confirm(current.review_token, {grade: staff,submission: staff}, learner), /42501/);
    const closed = await confirm(current.review_token, {grade: staff,submission: staff});
    assert.ok(closed.confirmed_at);
    assert.deepEqual(Object.keys(closed.followups).sort(), ["grade", "submission"]);
    assert.deepEqual((await confirm(current.review_token, {grade: staff,submission: staff})).followups, closed.followups);
    assert.equal(await sql(`select count(*) from private.work_tasks where assignee_id=${q(staff)}`), "2");
    const followUp = closed.followups.grade.task_id;
    const task = JSON.parse(await actor(staff,
        `select public.course_closeout_followup(${q(followUp)})`));
    assert.equal(task.course_run_id, course);
    assert.equal(task.state, "open");
    const change = (who, state, version) => actor(who,
        `select public.set_course_closeout_followup_state(${q(followUp)},${q(state)},${version})`);
    await assert.rejects(change(learner, "done", task.version), /42501/);
    const done = JSON.parse(await change(staff, "done", task.version));
    assert.equal(done.state, "done");
    assert.deepEqual(JSON.parse(await change(staff, "done", task.version)), done);
    await assert.rejects(change(staff, "doing", task.version), /40001/);
    assert.equal((await preview()).followups.grade.state, "done");
    await actor(admin, `select public.set_company_premium(${q(organisation)},false,1,${q(randomUUID())})`);
    await assert.rejects(preview(), /42501/);
    console.log("PASS Closeout detects real missing evidence, requires named work, and remains atomic and retry-safe");
});
