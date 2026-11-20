/** Real PostgreSQL impact/worker tests for explicit owned account and organisation cascades. */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {withTestDatabase} from "./testing/database.mjs";

await withTestDatabase("owned_cascade", async ({sql, actor}) => {
    const scopeDefinition = await sql(
        `select pg_catalog.pg_get_functiondef('private.deletion_scope_before_wiki_course_templates(text,uuid)'::regprocedure)`,
    );
    assert.match(scopeDefinition, /processed oid\[\]\s*:=\s*array\[\]::oid\[\]/);
    console.log(
        "PASS owned-cascade visited-constraint array is explicitly typed",
    );
    const privateDoc = randomUUID(),
        privateVersion = randomUUID();
    const admin = randomUUID(),
        teacher = randomUUID(),
        peer = randomUUID(),
        contract = randomUUID(),
        job = randomUUID(),
        claim = randomUUID(),
        otherClaim = randomUUID();
    await sql(
        `insert into auth.users(id,email) values('${admin}','cascade-admin@example.invalid'),('${teacher}','cascade-teacher@example.invalid'),('${peer}','cascade-peer@example.invalid');insert into public.user_roles(user_id,role) values('${admin}','admin'),('${teacher}','lecturer'),('${peer}','lecturer');insert into public.documents(id,owner_id,uploaded_by,scope,kind,original_name,mime_type,size_bytes,status,client_id) values('${privateDoc}','${teacher}','${teacher}','personal','contract','Fictional private contract.pdf','application/pdf',100,'clean','${randomUUID()}');insert into public.document_versions(id,document_id,uploaded_by,client_id,version,object_path,original_name,mime_type,size_bytes,status,sha256) values('${privateVersion}','${privateDoc}','${teacher}','${randomUUID()}',1,'fictional-cascade-contract','Fictional private contract.pdf','application/pdf',100,'clean',repeat('a',64));update public.documents set current_version_id='${privateVersion}' where id='${privateDoc}';insert into public.contracts(id,user_id,status,effective_from,version,document_version_id,document_sha256) values('${contract}','${teacher}','active',now()-interval '1 day',1,'${privateVersion}',repeat('a',64));insert into public.personal_events(user_id,title,starts_at,ends_at) values('${teacher}','Own calendar',now()+interval '2 day',now()+interval '3 day');insert into public.jobs(id,title,customer_name,delivery_type,time_zone,status,amount,total_amount,currency,rate_unit,terms,capacity,capacity_basis) values('${job}','Shared job','Fictional company','online','Europe/Berlin','filled',100,100,'EUR','fixed_total','Fictional',2,'per_position');insert into public.job_claims(id,job_id,lecturer_id,idempotency_key,amount,total_amount,currency,rate_unit,terms,terms_version,contract_id) values('${claim}','${job}','${teacher}','${randomUUID()}',100,100,'EUR','fixed_total','Fictional',1,'${contract}'),('${otherClaim}','${job}','${peer}','${randomUUID()}',100,100,'EUR','fixed_total','Fictional',1,null);insert into public.assignment_sessions(claim_id,lecturer_id,starts_at,ends_at) values('${claim}','${teacher}',now()+interval '2 day',now()+interval '3 day'),('${otherClaim}','${peer}',now()+interval '2 day',now()+interval '3 day');`,
    );
    const room = randomUUID();
    await sql(
        `insert into public.chat_rooms(id,job_id,kind,owner_id,title) values('${room}','${job}','lecturer_course','${teacher}','Shared course room');insert into public.chat_members(room_id,user_id) values('${room}','${teacher}'),('${room}','${peer}');`,
    );
    await assert.rejects(
        actor(peer, `select public.deletion_preview('account','${teacher}')`),
        /42501/,
    );
    const preview = JSON.parse(
        await actor(
            admin,
            `select public.deletion_preview('account','${teacher}')`,
        ),
    );
    console.log("ACCOUNT BLOCKERS", JSON.stringify(preview.blockers));
    assert.equal(preview.can_confirm, true);
    assert.equal(preview.counts["public.contracts"], 1);
    assert.equal(preview.counts["public.job_claims"], 1);
    const op = JSON.parse(
        await actor(
            admin,
            `select public.deletion_confirm('${preview.plan_id}','${randomUUID()}','DELETE')`,
        ),
    );
    const permit = JSON.parse(
        await actor(
            admin,
            `select public.deletion_execution('${op.operation_id}')`,
        ),
    );
    await sql(
        `begin;set local role service_role;select public._deletion_apply('${op.operation_id}','${permit.permit_id}');commit;`,
    );
    assert.equal(
        await sql(`select count(*) from public.documents where id='${privateDoc}'`),
        "0",
    );
    assert.equal(
        await sql(
            `select count(*) from public.document_versions where id='${privateVersion}'`,
        ),
        "0",
    );
    assert.equal(
        await sql(`select count(*) from public.contracts where id='${contract}'`),
        "0",
    );
    assert.equal(
        await sql(
            `select count(*) from public.assignment_sessions where lecturer_id='${teacher}'`,
        ),
        "0",
    );
    assert.equal(
        await sql(
            `select count(*) from public.personal_events where user_id='${teacher}'`,
        ),
        "0",
    );
    assert.equal(
        await sql(
            `select count(*) from public.job_claims where id='${otherClaim}'`,
        ),
        "1",
    );
    assert.equal(
        await sql(`select status from public.jobs where id='${job}'`),
        "published",
    );
    assert.equal(
        await sql(`select owner_id from public.chat_rooms where id='${room}'`),
        peer,
    );
    assert.equal(
        await sql(
            `select count(*) from public.chat_members where room_id='${room}' and user_id='${peer}'`,
        ),
        "1",
    );
    console.log(
        "PASS lecturer contracts/calendar/claims removed and shared job reopened with peer claim retained",
    );
    const org = randomUUID(),
        template = randomUUID(),
        run = randomUUID(),
        orgJob = randomUUID();
    await sql(
        `insert into public.organisations(id,name) values('${org}','Fictional cascade organisation');insert into public.course_templates(id,title) values('${template}','Reusable template');insert into public.course_runs(id,template_id,organisation_id,published) values('${run}','${template}','${org}',false);insert into public.course_sessions(course_run_id,starts_at,ends_at) values('${run}',now()+interval '4 day',now()+interval '5 day');insert into public.jobs(id,course_run_id,title,customer_name,delivery_type,time_zone,status,amount,total_amount,currency,rate_unit,terms) values('${orgJob}','${run}','Organisation job','Fictional company','online','Europe/Berlin','draft',100,100,'EUR','fixed_total','Fictional');`,
    );
    const companyContractDoc = randomUUID(),
        companyContractVersion = randomUUID(),
        companyContract = randomUUID();
    await sql(
        `insert into public.documents(id,owner_id,uploaded_by,scope,kind,original_name,mime_type,size_bytes,status,client_id) values('${companyContractDoc}','${peer}','${peer}','personal','contract','Fictional org-specific contract.pdf','application/pdf',100,'clean','${randomUUID()}');insert into public.document_versions(id,document_id,uploaded_by,client_id,version,object_path,original_name,mime_type,size_bytes,status,sha256) values('${companyContractVersion}','${companyContractDoc}','${peer}','${randomUUID()}',1,'fictional-cascade-org-contract','Fictional org-specific contract.pdf','application/pdf',100,'clean',repeat('c',64));update public.documents set current_version_id='${companyContractVersion}' where id='${companyContractDoc}';insert into public.contracts(id,user_id,status,effective_from,version,document_version_id,document_sha256) values('${companyContract}','${peer}','active',now()-interval '1 day',1,'${companyContractVersion}',repeat('c',64));`,
    );
    const companyDoc = randomUUID(),
        companyVersion = randomUUID(),
        companyClaim = randomUUID();
    await sql(
        `insert into public.job_claims(id,job_id,lecturer_id,idempotency_key,amount,total_amount,currency,rate_unit,terms,terms_version,contract_id) values('${companyClaim}','${orgJob}','${peer}','${randomUUID()}',100,100,'EUR','fixed_total','Historic fictional',1,'${companyContract}');insert into public.assignment_sessions(claim_id,lecturer_id,starts_at,ends_at) values('${companyClaim}','${peer}',now()+interval '4 day',now()+interval '5 day');insert into public.documents(id,owner_id,uploaded_by,scope,kind,job_id,original_name,mime_type,size_bytes,status,client_id) values('${companyDoc}','${peer}','${peer}','job_after','material','${orgJob}','Fictional company history.txt','text/plain',100,'clean','${randomUUID()}');insert into public.document_versions(id,document_id,uploaded_by,client_id,version,object_path,original_name,mime_type,size_bytes,status,sha256) values('${companyVersion}','${companyDoc}','${peer}','${randomUUID()}',1,'fictional-cascade-company','Fictional company history.txt','text/plain',100,'clean',repeat('b',64));update public.documents set current_version_id='${companyVersion}' where id='${companyDoc}';`,
    );
    const orgPreview = JSON.parse(
        await actor(
            admin,
            `select public.deletion_preview('organisation','${org}')`,
        ),
    );
    console.log("ORG BLOCKERS", JSON.stringify(orgPreview.blockers));
    assert.equal(orgPreview.can_confirm, true);
    await sql(
        `insert into public.course_sessions(course_run_id,starts_at,ends_at) values('${run}',now()-interval '5 day',now()-interval '4 day')`,
    );
    await assert.rejects(
        actor(
            admin,
            `select public.deletion_confirm('${orgPreview.plan_id}','${randomUUID()}','DELETE')`,
        ),
        /40001/,
    );
    const refreshed = JSON.parse(
        await actor(
            admin,
            `select public.deletion_preview('organisation','${org}')`,
        ),
    );
    const orgOp = JSON.parse(
        await actor(
            admin,
            `select public.deletion_confirm('${refreshed.plan_id}','${randomUUID()}','DELETE')`,
        ),
    );
    const orgPermit = JSON.parse(
        await actor(
            admin,
            `select public.deletion_execution('${orgOp.operation_id}')`,
        ),
    );
    await sql(
        `begin;set local role service_role;select public._deletion_apply('${orgOp.operation_id}','${orgPermit.permit_id}');commit;`,
    );
    assert.equal(
        await sql(`select count(*) from public.course_runs where id='${run}'`),
        "0",
    );
    assert.equal(
        await sql(`select count(*) from public.jobs where id='${orgJob}'`),
        "0",
    );
    assert.equal(
        await sql(`select count(*) from public.organisations where id='${org}'`),
        "0",
    );
    assert.equal(
        await sql(
            `select count(*) from public.course_templates where id='${template}'`,
        ),
        "1",
    );
    assert.equal(
        await sql(`select count(*) from public.jobs where id='${job}'`),
        "1",
    );
    assert.equal(
        await sql(`select count(*) from public.documents where id='${companyDoc}'`),
        "0",
    );
    assert.equal(
        await sql(
            `select count(*) from public.assignment_sessions where claim_id='${companyClaim}'`,
        ),
        "0",
    );
    assert.equal(
        await sql(`select count(*) from public.profiles where id='${peer}'`),
        "1",
    );
    assert.equal(
        await sql(
            `select count(*) from public.documents where id='${companyContractDoc}'`,
        ),
        "0",
    );
    assert.equal(
        await sql(
            `select count(*) from public.contracts where id='${companyContract}'`,
        ),
        "0",
    );
    console.log(
        "PASS organisation run/sessions/jobs removed, reusable template and unrelated job retained",
    );
});