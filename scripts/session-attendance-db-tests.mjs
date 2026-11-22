/** Current course roles, versioned register and exact checked PDF evidence. */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {quoteSql as q, withTestDatabase} from "./testing/database.mjs";
import {assertLmsResponse} from "./testing/premium-lms-contract.mjs";

await withTestDatabase("session_attendance", async ({sql, actor}) => {
    const [admin, teacher, company, participant, outsider] = Array.from({length: 5}, randomUUID);
    const [org, template, run, session, future, job, claim, historicSession, association] = Array.from({length: 9}, randomUUID);
    await sql(`insert into auth.users(id,email,email_confirmed_at) values
      ${[admin,teacher,company,participant,outsider].map((id) => `(${q(id)},${q(id+"@example.invalid")},now())`).join(",")};
      insert into public.user_roles(user_id,role) values
      (${q(admin)},'admin'),(${q(teacher)},'lecturer'),(${q(company)},'client'),
      (${q(participant)},'participant'),(${q(outsider)},'lecturer');
      update public.profiles set display_name='Fictional Learner' where id=${q(participant)};
      insert into public.organisations(id,name) values(${q(org)},'Fictional course company');
      insert into public.client_organisation_memberships(user_id,organisation_id)
        values(${q(company)},${q(org)});
      insert into public.course_templates(id,title,syllabus)
        values(${q(template)},'Fictional attendance class','Safe lab');
      insert into public.course_runs(id,template_id,organisation_id,time_zone)
        values(${q(run)},${q(template)},${q(org)},'Europe/Berlin');
      insert into public.course_sessions(id,course_run_id,starts_at,ends_at) values
        (${q(session)},${q(run)},now()-interval '2 hours',now()-interval '1 hour'),
        (${q(historicSession)},${q(run)},now()-interval '4 hours',now()-interval '3 hours'),
        (${q(future)},${q(run)},now()+interval '1 day',now()+interval '1 day 1 hour');
      insert into public.jobs(id,course_run_id,title,customer_name,delivery_type,status,amount,currency,rate_unit,total_amount,terms)
        values(${q(job)},${q(run)},'Fictional job','Fictional company','online','filled',100,'EUR','fixed_total',100,'Fictional terms');
      insert into public.job_claims(id,job_id,lecturer_id,idempotency_key,amount,currency,rate_unit,total_amount,terms,terms_version)
        values(${q(claim)},${q(job)},${q(teacher)},${q(randomUUID())},100,'EUR','fixed_total',100,'Fictional terms',1);
      insert into public.course_enrolments(course_run_id,user_id,status,enrolled_by)
        values(${q(run)},${q(participant)},'enrolled',${q(admin)});
      insert into private.company_participant_link_requests(
        id,organisation_id,requested_by,request_id,luminovia_user_id,target_user_id,status,expires_at)
        values(${q(association)},${q(org)},${q(admin)},${q(randomUUID())},
          (select luminovia_user_id from public.profiles where id=${q(participant)}),
          ${q(participant)},'accepted',now()+interval '14 days');
      insert into private.company_participant_memberships(
        organisation_id,user_id,status,link_request_id,invited_by,joined_at,version)
        values(${q(org)},${q(participant)},'active',${q(association)},${q(admin)},now(),1);
      -- A retained pre-register correction predates register status, times and notes.
      insert into private.course_attendance_audit(session_id,user_id,actor_id,old_state,new_state,reason)
        values(${q(historicSession)},${q(participant)},${q(teacher)},
          jsonb_build_object('session_id',${q(historicSession)},'user_id',${q(participant)},
            'state','reported','minutes',0,'version',1,'updated_at',now()-interval '4 hours'),
          jsonb_build_object('state','attended','minutes',60),'Fictional retained verification');`);
    const rpc = async (who, name, args) => JSON.parse(await actor(who,
        `select to_jsonb(public.${name}(${args.join(",")}))`,"aal1"));
    await rpc(admin,"set_company_premium",[q(org),"true","0",q(randomUUID())]);
    const register = async (who, target=session) => {
        const result = await rpc(who,"course_session_register",[q(run),q(target)]);
        assertLmsResponse("course_session_register",result);
        return result;
    };
    const save = (who,status,version,extra={}) => rpc(who,"save_course_session_attendance",[
        q(run),q(extra.session ?? session),q(extra.user ?? participant),q(status),
        extra.arrival ?? "null",extra.departure ?? "null",q(extra.note ?? ""),
        q(extra.reason ?? ""),String(version),
    ]);
    assert.equal((await register(admin)).rows.length,1);
    assert.equal((await register(company)).rows[0].name.length>0,true);
    assert.equal((await register(teacher)).time_zone,"Europe/Berlin");
    await assert.rejects(register(participant),/42501/);
    await assert.rejects(register(outsider),/42501/);
    await assert.rejects(register(admin,randomUUID()),/42501/);
    await assert.rejects(save(participant,"present",0),/42501/);
    await assert.rejects(save(outsider,"present",0),/42501/);
    await assert.rejects(save(admin,"present",0,{user:outsider}),/42501/);
    await assert.rejects(save(admin,"present",0,{session:future}),/42501/);
    const first = await save(teacher,"present",0,{note:"Arrived on time"});
    assert.equal(first.version,1);
    assert.equal(first.minutes,60);
    const firstHistory = (await register(teacher)).history[0];
    assert.deepEqual(firstHistory.old_state,{
        session_id:null,user_id:null,state:null,minutes:null,version:null,updated_at:null,
        register_status:null,arrival_at:null,departure_at:null,staff_note:null,
    });
    assert.equal(firstHistory.new_state.staff_note,"Arrived on time");
    assert.equal(firstHistory.actor_id,teacher);
    await assert.rejects(save(company,"absent",0,{reason:"Corrected"}),/PT409/);
    await assert.rejects(save(company,"excused",1,{reason:""}),/22023/);
    const corrected = await save(company,"excused",1,{reason:"Medical excuse"});
    assert.equal(corrected.version,2);
    assert.equal(corrected.minutes,0);
    assert.equal((await register(admin)).rows[0].status,"excused");
    assert.equal(await sql(`select state from private.course_attendance
      where session_id=${q(session)} and user_id=${q(participant)}`),"absent");
    assert.equal((await register(company)).history.length,2);
    await rpc(teacher,"course_workspace_action",[q(run),q("attendance_verify"),
        q(JSON.stringify({session_id:session,user_id:participant,state:"attended",minutes:60,reason:"Legacy correction"})),"2"]);
    assert.equal((await register(company)).rows[0].status,"present");
    const late = await save(admin,"present",3,{arrival:"now()-interval '1 hour 30 minutes'",reason:"Late arrival"});
    assert.equal(late.minutes,30);
    assert.equal((await register(company)).rows[0].version,4);
    const [historic] = (await register(teacher,historicSession)).history;
    assert.equal(historic.old_state.state,"reported");
    assert.equal(Object.hasOwn(historic.old_state,"staff_note"),false);
    assert.deepEqual(historic.new_state,{state:"attended",minutes:60});
    const staffWorkspace = await rpc(teacher,"course_workspace",[q(run)]);
    assertLmsResponse("course_workspace",staffWorkspace);
    assert.equal(staffWorkspace.attendance_history.length,5);
    assert.ok(staffWorkspace.attendance_history.every((entry) => !Object.hasOwn(entry,"actor_id")));
    for (const viewer of [participant,company]) {
        const workspace = await rpc(viewer,"course_workspace",[q(run)]);
        assertLmsResponse("course_workspace",workspace);
        assert.deepEqual(workspace.attendance_history,[]);
        if (viewer === participant) assert.deepEqual(workspace.roster,[]);
    }
    await assert.rejects(register(participant,historicSession),/42501/);
    await assert.rejects(actor(participant, "set local request.path='/rpc/course_session_register'; select public.require_portal_access()"), /42501/);
    console.log("PASS Published OpenAPI accepts current and retained attendance receipts; learner responses disclose no correction history");
    const [document,version,foreignDocument,foreignVersion] = Array.from({length:4},randomUUID);
    await sql(`insert into public.documents(id,owner_id,uploaded_by,scope,kind,original_name,mime_type,size_bytes,status,client_id)
      values(${q(document)},${q(teacher)},${q(teacher)},'personal','material','Roster.pdf','application/pdf',10,'clean',${q(randomUUID())}),
      (${q(foreignDocument)},${q(outsider)},${q(outsider)},'personal','material','Foreign.pdf','application/pdf',10,'clean',${q(randomUUID())});
      insert into public.document_versions(id,document_id,uploaded_by,client_id,version,object_path,original_name,mime_type,size_bytes,sha256,status)
      values(${q(version)},${q(document)},${q(teacher)},${q(randomUUID())},1,'attendance/fictional.pdf','Roster.pdf','application/pdf',10,repeat('a',64),'clean'),
      (${q(foreignVersion)},${q(foreignDocument)},${q(outsider)},${q(randomUUID())},1,'attendance/foreign.pdf','Foreign.pdf','application/pdf',10,repeat('b',64),'clean');
      update public.documents set current_version_id=case id
        when ${q(document)}::uuid then ${q(version)}::uuid else ${q(foreignVersion)}::uuid end
        where id in (${q(document)},${q(foreignDocument)});`);
    await sql(`update public.document_versions set mime_type='text/plain' where id=${q(version)}`);
    await assert.rejects(rpc(teacher,"attach_course_session_evidence",[q(run),q(session),q(version)]),/42501/);
    await sql(`update public.document_versions set mime_type='application/pdf' where id=${q(version)}`);
    await assert.rejects(rpc(teacher,"attach_course_session_evidence",[q(run),q(session),q(foreignVersion)]),/42501/);
    await assert.rejects(rpc(participant,"attach_course_session_evidence",[q(run),q(session),q(version)]),/42501/);
    const attached = await rpc(teacher,"attach_course_session_evidence",[q(run),q(session),q(version)]);
    assert.equal(attached.version_id,version);
    assert.equal((await rpc(teacher,"attach_course_session_evidence",[q(run),q(session),q(version)])).id,attached.id);
    assert.equal(await sql(`select count(*) from public.audit_events
      where action='course.attendance_evidence_attached' and resource_id=${q(session)}`),"1");
    assert.equal((await register(company)).evidence[0].resource_id,attached.resource_id);
    await assert.rejects(sql(`update public.documents set deleted_at=now()
      where id=${q(document)}`),/Retained attendance evidence cannot be deleted/);
    await assert.rejects(sql(`update private.course_resources set removed_at=now()
      where id=${q(attached.resource_id)}`),/Retained attendance evidence cannot be unshared/);
    await assert.rejects(rpc(participant,"course_document_access",[q("resource"),q(attached.resource_id)]),/42501/);
    assert.equal((await rpc(company,"course_document_access",[q("resource"),q(attached.resource_id)])).sha256,repeat("a",64));
    const beforeImport = (await register(company)).rows[0];
    const importRow = {user_id:participant,status:"present",arrival_at:null,departure_at:null,
        note:"Fictional CSV correction",reason:"Paper register confirmed",expected_version:beforeImport.version};
    const importRows = (who, rows) => rpc(who,"import_course_session_attendance",[q(run),q(session),q(JSON.stringify(rows))]);
    await assert.rejects(importRows(participant,[importRow]),/42501/);
    await assert.rejects(importRows(company,[importRow,importRow]),/22023/);
    await assert.rejects(importRows(company,[{...importRow,arrival_at:"2026-11-20T02:30"}]),/22023/);
    await assert.rejects(importRows(company,[importRow,{...importRow,user_id:outsider,expected_version:0}]),/42501/);
    assert.deepEqual((await register(company)).rows[0],beforeImport);
    assert.deepEqual(await importRows(company,[importRow]),{saved:1});
    assert.equal((await register(company)).rows[0].note,"Fictional CSV correction");
    await assert.rejects(importRows(company,[importRow]),/PT409/);
    const exportSession = (who, target = session) =>
        rpc(who, "course_document_access", [q("attendance_session"), q(target)]);
    const report = await exportSession(company);
    assert.equal(report.report_scope, "session");
    assert.equal(report.id, run);
    for (const who of [teacher, admin]) assert.deepEqual(await exportSession(who), report);
    assert.deepEqual(report.sessions.map((record) => record.id), [session]);
    assert.equal(report.roster[0].sessions[0].status, "present");
    assert.equal(report.roster[0].sessions[0].minutes, 60);
    assert.doesNotMatch(JSON.stringify(report), /Fictional CSV correction|Roster\.pdf|Paper register confirmed/);
    assert.equal((await exportSession(company, historicSession)).roster[0].sessions[0].status, null);
    for (const who of [participant, outsider]) await assert.rejects(exportSession(who), /42501/);
    await assert.rejects(exportSession(company, run), /42501/);
    const legacy = await rpc(admin, "course_document_access", [q("attendance"), q(run)]);
    assert.equal(legacy.sessions.length, 3);
    console.log("PASS internal exact-session export preserves the existing course report and denies non-staff access");
    const toggle = actor(admin, `select public.set_company_premium(${q(org)},false,1,${q(randomUUID())});select pg_sleep(0.7)`);
    let holdsPremiumLock = false;
    for (let index = 0; index < 30 && !holdsPremiumLock; index++) {
        holdsPremiumLock = await sql(`select exists(select 1 from pg_stat_activity
          where datname=current_database() and pid<>pg_backend_pid() and wait_event='PgSleep')`) === "t";
        if (!holdsPremiumLock) await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(holdsPremiumLock, true);
    const lateSave = assert.rejects(save(teacher,"present",4,{reason:"Concurrent edit"}), /42501/);
    await Promise.all([toggle, lateSave]);
    await assert.rejects(register(company),/42501/);
    await assert.rejects(exportSession(company),/42501/);
    await assert.rejects(save(teacher,"present",4,{reason:"Retest"}),/42501/);
    await assert.rejects(rpc(company,"course_document_access",[q("resource"),q(attached.resource_id)]),/42501/);
});

function repeat(value, count) { return value.repeat(count); }
