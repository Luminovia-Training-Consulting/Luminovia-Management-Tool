/** Real isolated PostgreSQL checks for consented standalone assignment amendments.
 * Fixtures are fictional and created/dropped by withTestDatabase; Auth is emulated
 * only for database actor/permission checks, not native HTTP acceptance. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { withTestDatabase, quoteSql as q } from "./testing/database.mjs";

await withTestDatabase("assignment_change", async ({ sql, actor }) => {
  const [admin, manager, teacher, peer] = Array.from({ length: 4 }, randomUUID);
  await sql(`insert into auth.users(id,email) values ${[admin, manager, teacher, peer].map((id) => `(${q(id)},${q(id + "@example.invalid")})`).join(",")};
    insert into public.user_roles(user_id,role) values(${q(admin)},'admin'),(${q(manager)},'management'),(${q(teacher)},'lecturer'),(${q(peer)},'lecturer');`);
  const rpc = async (who, name, args = []) => { const value=await actor(who, `select public.${name}(${args.join(",")})`); try { return JSON.parse(value); } catch { return value; } };
  const call = (who, name, args = []) => actor(who, `select public.${name}(${args.join(",")})`);
  let seq = 0, checks = 0;
  const check = async (name, run) => { await run(); checks++; console.log(`PASS ${name}`); };
  const make = async ({ course = false, twoClaims = false } = {}) => {
    const job = randomUUID(), run = course ? randomUUID() : null, start = new Date(Date.now() + (30 + seq++ * 4) * 86400000).toISOString();
    if (course) await sql(`insert into public.course_templates(id,title) values(${q(randomUUID())},'Fictional linked course'); insert into public.course_runs(id,template_id) select ${q(run)},id from public.course_templates where title='Fictional linked course';`);
    await sql(`insert into public.jobs(id,course_run_id,title,customer_name,delivery_type,location,status,amount,currency,rate_unit,total_amount,terms,requires_contract) values(${q(job)},${run ? q(run) : "null"},'Fictional amendment teaching block','Fictional academy','online','https://example.invalid/old','published',125,'EUR','per_day',250,'Accepted fictional agreement',false);
      insert into public.job_sessions(job_id,starts_at,ends_at) values(${q(job)},${q(start)}::timestamptz,${q(start)}::timestamptz+interval '2 hours');`);
    const claim = async who => {
      const res = await rpc(who, "claim_job", [q(job), q(randomUUID()), "1"]);
      assert.equal(res.status, "confirmed"); return res.claim_id;
    };
    const c = await claim(teacher); if (twoClaims) { await sql(`update public.jobs set capacity=2,capacity_basis='per_position' where id=${q(job)}`); const second=randomUUID(); await sql(`insert into public.job_claims(id,job_id,lecturer_id,idempotency_key,status,amount,currency,rate_unit,total_amount,terms,terms_version) select ${q(second)},job_id,${q(peer)},${q(randomUUID())},'confirmed',amount,currency,rate_unit,total_amount,terms,terms_version from public.job_claims where id=${q(c)}; insert into public.assignment_sessions(claim_id,lecturer_id,starts_at,ends_at) select ${q(second)},${q(peer)},starts_at,ends_at from public.assignment_sessions where claim_id=${q(c)};`); }
    const session = await sql(`select id from public.assignment_sessions where claim_id=(select id from public.job_claims where job_id=${q(job)} and lecturer_id=${q(teacher)})`);
    return { job, start, claim: c, session };
  };
  const proposal = (f, { key = randomUUID(), start = new Date(Date.parse(f.start) + 86400000).toISOString(), location = "https://example.invalid/new" } = {}) =>
    rpc(manager, "propose_assignment_change", [q(f.job), q("Fictional date adjustment"), q(location), q(JSON.stringify([{ starts_at: start, ends_at: new Date(Date.parse(start) + 7200000).toISOString() }])), q(key)]);
  const withdraw = id => rpc(manager,"withdraw_assignment_change",[q(id)]);
  const response = (who, id, accept) => rpc(who, "respond_assignment_change", [q(id), String(accept)]);
  const applied = (id) => rpc(manager, "apply_assignment_change", [q(id)]);
  const snap = f => sql(`select jsonb_build_object('job',(select jsonb_build_object('location',location,'amount',amount,'total_amount',total_amount,'terms',terms,'lifecycle_version',lifecycle_version) from public.jobs where id=${q(f.job)}),'sessions',(select jsonb_agg(jsonb_build_object('id',id,'starts_at',starts_at,'ends_at',ends_at) order by starts_at) from public.job_sessions where job_id=${q(f.job)}),'assignments',(select jsonb_agg(jsonb_build_object('id',id,'starts_at',starts_at,'ends_at',ends_at,'released_at',released_at) order by id) from public.assignment_sessions where claim_id=${q(f.claim)}),'claims',(select jsonb_agg(jsonb_build_object('id',id,'status',status,'amount',amount,'total_amount',total_amount,'terms',terms) order by id) from public.job_claims where job_id=${q(f.job)}))`);

  await check("Projection is limited to manager and affected lecturer; private tables and anonymous execution stay closed", async () => {
    const f = await make(), id = await proposal(f);
    assert.equal(await sql(`select count(*) from public.notifications where user_id=${q(teacher)} and kind='assignment_change_proposed' and resource_id=${q(id)}`),"1");
    assert.deepEqual(JSON.parse(await actor(teacher,`select private.notification_target('assignment_change_proposed',${q(id)})`)),{href:`/jobs/${f.job}`,title:"Fictional amendment teaching block"});
    assert.equal((await rpc(teacher,"assignment_change_request",["null",q(f.job)])).length,1);
    assert.deepEqual(await rpc(peer,"assignment_change_request",["null",q(f.job)]),[]);
    assert.equal((await rpc(manager,"assignment_change_request",["null",q(f.job)]))[0].can_apply,false);
    assert.equal((await rpc(teacher,"assignment_change_request",["null","null"])).length,1);
    for (const table of ["assignment_change_requests","assignment_change_responses"]) await assert.rejects(actor(teacher,`select * from private.${table}`),/permission denied/);
    for (const fn of ["assignment_change_request(uuid,uuid)","propose_assignment_change(uuid,text,text,jsonb,uuid)","respond_assignment_change(uuid,boolean)","apply_assignment_change(uuid)","withdraw_assignment_change(uuid)"]) assert.equal(await sql(`select has_function_privilege('anon',${q("public."+fn)},'execute')`),"f");
    assert.ok(id);
  });
  await check("Retry key returns same request and rejects changed payload", async () => {
    const f=await make(), key=randomUUID(); const id=await proposal(f,{key}); assert.equal(await proposal(f,{key}),id);
    await assert.rejects(proposal(f,{key,location:"https://example.invalid/different"}),/payload conflict/);
    const g=await make(), concurrentKey=randomUUID(); const ids=await Promise.all([proposal(g,{key:concurrentKey}),proposal(g,{key:concurrentKey})]); assert.deepEqual(ids,[ids[0],ids[0]]);
  });
  await check("Rejection is irrevocable and leaves agreed job, claim and schedule unchanged", async () => {
    const f=await make(), before=await snap(f), id=await proposal(f); assert.equal(await response(teacher,id,false),"rejected");
    assert.ok(Number(await sql(`select count(*) from public.notifications where kind='assignment_change_rejected' and resource_id=${q(id)}`))>0);
    await assert.rejects(response(teacher,id,true),/no longer awaiting/); await assert.rejects(applied(id),/not accepted|stale/i);
    assert.equal(await snap(f),before);
  });
  await check("Accepted proposal applies dates and location atomically while preserving duration, claim, session identity and commercial snapshots", async () => {
    const f=await make(), before=JSON.parse(await snap(f)), id=await proposal(f); assert.equal(await response(teacher,id,true),"accepted");
    const concurrent=await Promise.allSettled([applied(id),applied(id)]); assert.equal(concurrent.filter(x=>x.status==="fulfilled").length,1); assert.equal(concurrent.find(x=>x.status==="fulfilled").value,"applied");
    assert.equal(await sql(`select count(*) from public.notifications where user_id=${q(teacher)} and kind='assignment_change_applied' and resource_id=${q(id)}`),"1");
    const after=JSON.parse(await snap(f)); assert.equal(after.job.location,"https://example.invalid/new"); assert.equal(after.job.amount,before.job.amount); assert.equal(after.job.total_amount,before.job.total_amount); assert.equal(after.job.terms,before.job.terms);
    assert.equal(after.sessions.length,1); assert.equal(after.assignments.length,1); assert.equal(after.assignments[0].id,f.session); assert.equal(after.assignments[0].released_at,null);
    assert.equal(Date.parse(after.sessions[0].ends_at)-Date.parse(after.sessions[0].starts_at),7200000); assert.equal(after.sessions[0].starts_at,after.assignments[0].starts_at);
    const request=(await rpc(teacher,"assignment_change_request",[q(id),"null"]))[0]; assert.equal(request.original_location,"https://example.invalid/old"); assert.equal(request.status,"applied");
  });
  await check("Nulls, stale consent, conflicting proposals, course-linked work and multi-claim jobs are rejected without mutation", async () => {
    const f=await make(), id=await proposal(f); await assert.rejects(rpc(manager,"propose_assignment_change",[q(f.job),"null","null","null","null"]),/Invalid amendment/);
    await assert.rejects(proposal(f),/already pending/);
    await sql(`update public.jobs set title='Concurrent edit' where id=${q(f.job)}`); await response(teacher,id,true); const before=await snap(f); await assert.rejects(applied(id),/stale/); assert.equal(await snap(f),before); assert.equal(await withdraw(id),"superseded");
    const linked=await make({course:true}); await assert.rejects(proposal(linked),/Linked course changes/);
    const multi=await make({twoClaims:true}); await assert.rejects(proposal(multi),/complete confirmed assignment set/);
  });
  await check("Source schedule mismatch at proposal and after lecturer consent blocks all mutation", async () => {
    const f=await make(); await sql(`update public.assignment_sessions set starts_at=starts_at+interval '1 minute',ends_at=ends_at+interval '1 minute' where id=${q(f.session)}`);
    await assert.rejects(proposal(f),/does not match its source job/);
    await sql(`update public.assignment_sessions set starts_at=starts_at-interval '1 minute',ends_at=ends_at-interval '1 minute' where id=${q(f.session)}`);
    const id=await proposal(f); await response(teacher,id,true);
    await sql(`update public.assignment_sessions set starts_at=starts_at+interval '1 minute',ends_at=ends_at+interval '1 minute' where id=${q(f.session)}`);
    const before=await snap(f); await assert.rejects(applied(id),/does not match its source job/); assert.equal(await snap(f),before);
  });
  await check("Started or released reservation cannot be proposed; a newly conflicting private event blocks apply", async () => {
    const started=await make(); await sql(`update public.assignment_sessions set starts_at='2026-11-15T08:00:00Z',ends_at='2026-11-15T10:00:00Z' where id=${q(started.session)}; update public.job_sessions set starts_at='2026-11-15T08:00:00Z',ends_at='2026-11-15T10:00:00Z' where job_id=${q(started.job)}`);
    await assert.rejects(proposal(started),/Started, released or invoiced/);
    const released=await make(); await sql(`update public.assignment_sessions set released_at=clock_timestamp() where id=${q(released.session)}`);
    await assert.rejects(proposal(released),/Started, released or invoiced/);
    const conflict=await make(), id=await proposal(conflict), newStart=new Date(Date.parse(conflict.start)+86400000).toISOString();
    await sql(`insert into public.personal_events(user_id,title,starts_at,ends_at,time_zone) values(${q(teacher)},'Fictional calendar conflict',${q(newStart)}::timestamptz,${q(newStart)}::timestamptz+interval '30 minutes','Europe/Berlin')`);
    await response(teacher,id,true); const before=await snap(conflict); await assert.rejects(applied(id),/conflicts with current (availability|commitments)/); assert.equal(await snap(conflict),before);
  });
  await check("Only affected lecturer decides; inactive actors cannot decide or read", async () => {
    const f=await make(), id=await proposal(f); await assert.rejects(response(peer,id,true),/42501/); await assert.rejects(call(manager,"respond_assignment_change",[q(id),"true"]),/42501/);
    await sql(`update public.profiles set active=false where id=${q(teacher)}`);
    await assert.rejects(response(teacher,id,true),/42501/); await assert.rejects(rpc(teacher,"assignment_change_request",[q(id),"null"]),/42501/);
  });
  console.log(`PASS ${checks} isolated assignment amendment database scenarios`);
});
