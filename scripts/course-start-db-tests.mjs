import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {quoteSql as q, withTestDatabase} from "./testing/database.mjs";

await withTestDatabase("course_start", async ({sql, actor}) => {
    const [owner, backup, outsider, course, template] = Array.from({length: 5}, randomUUID);
    await sql(`insert into auth.users(id,email) values
      (${q(owner)},'owner@example.invalid'),(${q(backup)},'backup@example.invalid'),
      (${q(outsider)},'outsider@example.invalid');
      insert into public.user_roles(user_id,role) values
      (${q(owner)},'admin'),(${q(backup)},'management'),(${q(outsider)},'lecturer');
      insert into public.course_templates(id,title) values (${q(template)},'Fictional start');
      insert into public.course_runs(id,template_id,published) values (${q(course)},${q(template)},true);
      insert into public.course_sessions(course_run_id,starts_at,ends_at) values
      (${q(course)},now()+interval '36 hours',now()+interval '38 hours');`);
    async function plan(who, run = course) {
        return JSON.parse(await actor(who, `select public.course_start_planning(${run ? q(run) : "null"})`));
    }
    function save(who, responsible, delegate, version) {
        return actor(who, `select public.set_course_start_responsibility(
          ${q(course)},${q(responsible)},${q(delegate)},${version})`);
    }
    const pending = (await plan(owner, null)).items[0];
    assert.equal(pending.status, "pending");
    assert.equal(pending.version, 0);
    assert.ok(pending.missing.includes("lecturer"));
    assert.ok(pending.missing.includes("delivery"));
    assert.ok(pending.missing.includes("materials"));
    await assert.rejects(plan(outsider), /42501/);
    await assert.rejects(save(outsider, owner, backup, 0), /42501/);
    await assert.rejects(save(owner, outsider, backup, 0), /22023/);
    assert.equal(await save(owner, owner, backup, 0), "1");
    assert.equal(await save(owner, owner, backup, 0), "1");
    await assert.rejects(save(owner, backup, owner, 0), /40001/);
    assert.equal((await plan(backup)).items[0].responsible_id, owner);
    assert.equal(await sql("select private.send_course_start_alerts()"), "1");
    assert.equal(await sql("select private.send_course_start_alerts()"), "0");
    assert.equal(await sql(`select user_id from public.notifications where kind='course_start_due'`), owner);

    await sql(`update public.course_sessions set starts_at=now()+interval '20 hours',
      ends_at=now()+interval '22 hours' where course_run_id=${q(course)}`);
    assert.equal((await plan(owner)).items[0].status, "overdue");
    assert.equal(await sql("select private.send_course_start_alerts()"), "1");
    assert.equal(await sql("select private.send_course_start_alerts()"), "0");
    const notice = await sql(`select resource_id from public.notifications
      where kind='course_start_escalated' and user_id=${q(backup)}`);
    assert.ok(notice);
    const inbox = JSON.parse(await actor(backup, "select public.notification_inbox()"));
    assert.ok(JSON.stringify(inbox).includes("/readiness/" + course));
    await sql(`update public.profiles set active=false where id=${q(backup)}`);
    await assert.rejects(plan(backup), /42501/);
    await assert.rejects(save(owner, owner, backup, 1), /22023/);
    const unowned = randomUUID();
    await sql(`insert into public.course_runs(id,template_id,published)
      values (${q(unowned)},${q(template)},true);
      insert into public.course_sessions(course_run_id,starts_at,ends_at)
      values (${q(unowned)},now()+interval '19 hours',now()+interval '21 hours');`);
    assert.equal(await sql("select private.send_course_start_alerts()"), "1");
    assert.equal(await sql(`select notice.user_id from public.notifications notice
      join private.course_start_alerts alert on alert.id=notice.resource_id
      where alert.course_run_id=${q(unowned)} and notice.kind='course_start_escalated'`), owner);
    assert.equal((await plan(owner, unowned)).items[0].version, 0);
    assert.equal(await sql("select has_function_privilege('authenticated','private.send_course_start_alerts()','EXECUTE')"), "f");
    console.log("PASS Course start planning uses current requirements and staff; overdue alerts route once to current backup");
});
