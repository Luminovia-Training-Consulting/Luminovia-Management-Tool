/** Own-day shared-course projection against complete disposable SQL history; fictional contacts/files only. */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {quoteSql as q, withTestDatabase} from "./testing/database.mjs";

await withTestDatabase("teaching_day_course", async ({sql, actor}) => {
    const [
        teacher,
        peer,
        client,
        org,
        otherOrg,
        contact,
        foreignContact,
        template,
        run,
        job,
        claim,
        session,
        doc,
        version,
        later,
    ] = Array.from({length: 15}, randomUUID);
    await sql(
        `insert into auth.users(id,email)values ${[teacher, peer, client].map((id) => `(${q(id)},${q(id + "@example.invalid")})`).join(",")};insert into public.user_roles(user_id,role)values(${q(teacher)},'lecturer'),(${q(peer)},'lecturer'),(${q(client)},'client');insert into public.organisations(id,name)values(${q(org)},'Fictional teaching academy'),(${q(otherOrg)},'Other private academy');insert into public.organisation_contacts(id,organisation_id,name,email,phone,notes)values(${q(contact)},${q(org)},'Explicit course contact','course@example.invalid','+49 40 123','Private internal note never returned'),(${q(foreignContact)},${q(otherOrg)},'Private foreign contact','secret@example.invalid','','Secret other organisation');insert into public.course_templates(id,title)values(${q(template)},'Fictional daily course');insert into public.course_runs(id,template_id,organisation_id)values(${q(run)},${q(template)},${q(org)});insert into public.jobs(id,course_run_id,title,customer_name,delivery_type,status,amount,currency,rate_unit,total_amount,terms)values(${q(job)},${q(run)},'Fictional current day','Fictional academy','online','filled',100,'EUR','fixed_total',100,'Fictional terms');insert into public.job_claims(id,job_id,lecturer_id,idempotency_key,amount,currency,rate_unit,total_amount,terms,terms_version)values(${q(claim)},${q(job)},${q(teacher)},${q(randomUUID())},100,'EUR','fixed_total',100,'Fictional accepted terms',1);insert into public.assignment_sessions(id,claim_id,lecturer_id,starts_at,ends_at)values(${q(session)},${q(claim)},${q(teacher)},date_trunc('day',now())+interval '10 hours',date_trunc('day',now())+interval '11 hours');update public.profiles set time_zone='UTC' where id=${q(teacher)};insert into private.course_preparation_items(run_id,label,done)values(${q(run)},'Shared completed item',true),(${q(run)},'Shared missing item',false);`,
    );
    const day = async (who = teacher) =>
        JSON.parse(await actor(who, "select public.teaching_day()"));
    let count = 0;
    const check = async (name, fn) => {
        await fn();
        count++;
        console.log("PASS " + name);
    };
    await check(
        "Current assignment exposes a real nonarchived course and shared count, but no implicit first contact",
        async () => {
            const d = (await day()).sessions[0];
            assert.equal(d.course_run_id, run);
            assert.equal(d.course_contact, null);
            assert.deepEqual(d.shared_preparation, {done: 1, total: 2});
            assert.equal(d.preparation.contact_ready, false);
            assert.equal((await day(peer)).sessions.length, 0);
            assert.equal((await day(client)).sessions.length, 0);
        },
    );
    await check(
        "Only the explicitly selected same-organisation active contact is projected, without notes or private fields",
        async () => {
            await sql(
                `insert into private.course_workspace_settings(run_id,contact_id)values(${q(run)},${q(contact)})`,
            );
            assert.deepEqual((await day()).sessions[0].course_contact, {
                name: "Explicit course contact",
                email: "course@example.invalid",
                phone: "+49 40 123",
            });
            assert.ok(!JSON.stringify(await day()).includes("Private internal"));
            await sql(
                `update private.course_workspace_settings set contact_id=${q(foreignContact)} where run_id=${q(run)}`,
            );
            assert.equal((await day()).sessions[0].course_contact, null);
            await sql(
                `update private.course_workspace_settings set contact_id=${q(contact)} where run_id=${q(run)};update public.organisation_contacts set archived_at=now() where id=${q(contact)}`,
            );
            assert.equal((await day()).sessions[0].course_contact, null);
            await sql(
                `update public.organisation_contacts set archived_at=null where id=${q(contact)}`,
            );
        },
    );
    await sql(
        `insert into public.documents(id,owner_id,uploaded_by,scope,kind,original_name,mime_type,size_bytes,status,client_id)values(${q(doc)},${q(peer)},${q(peer)},'personal','material','Agreed old.pdf','application/pdf',10,'clean',${q(randomUUID())});insert into public.document_versions(id,document_id,uploaded_by,client_id,version,object_path,original_name,mime_type,size_bytes,status,sha256)values(${q(version)},${q(doc)},${q(peer)},${q(randomUUID())},1,'fictional/old.pdf','Agreed old.pdf','application/pdf',10,'clean',${q("a".repeat(64))}),(${q(later)},${q(doc)},${q(peer)},${q(randomUUID())},2,'fictional/new.pdf','Private replacement.pdf','application/pdf',10,'clean',${q("b".repeat(64))});update public.documents set current_version_id=${q(later)} where id=${q(doc)};`,
    );
    const resources = Array.from({length: 12}, randomUUID);
    for (const id of resources) {
        const d = randomUUID(),
            v = randomUUID();
        await sql(
            `insert into public.documents(id,owner_id,uploaded_by,scope,kind,original_name,mime_type,size_bytes,status,client_id)values(${q(d)},${q(peer)},${q(peer)},'personal','material','Fictional resource.pdf','application/pdf',10,'clean',${q(randomUUID())});insert into public.document_versions(id,document_id,uploaded_by,client_id,version,object_path,original_name,mime_type,size_bytes,status,sha256)values(${q(v)},${q(d)},${q(peer)},${q(randomUUID())},1,${q("fictional/" + v)},'Fictional resource.pdf','application/pdf',10,'clean',${q("c".repeat(64))});insert into private.course_resources(id,run_id,version_id,audience,category,created_by)values(${q(id)},${q(run)},${q(v)},'staff','material',${q(peer)});`,
        );
    }
    // Staff can still inspect assigned schedule facts while Premium is OFF.
    // Course bytes and counts remain gated until this fictional company opts in.
    await check("Teaching Day shows the assignment while Premium withholds shared files", async () => {
        const d = (await day()).sessions[0];
        assert.equal(d.course_run_id, run);
        assert.deepEqual(d.course_resources, []);
        assert.equal(d.course_resource_count, 0);
        await sql(`insert into private.company_premium_settings(organisation_id,enabled,version)
            values(${q(org)},true,1) on conflict(organisation_id) do update set enabled=true,version=1`);
    });
    await check(
        "Exact reviewed versions, removal and preview counts preserve private document RLS",
        async () => {
            const shared = randomUUID(),
                hidden = randomUUID();
            await sql(
                `insert into private.course_resources(id,run_id,version_id,audience,category,created_by,created_at,removed_at)values(${q(shared)},${q(run)},${q(version)},'staff','report',${q(peer)},now()-interval '1 day',null),(${q(hidden)},${q(run)},${q(later)},'client','material',${q(peer)},now(),now());`,
            );
            let d = (await day()).sessions[0];
            assert.equal(d.course_resources.length, 10);
            assert.equal(d.course_resource_count, 13);
            assert.equal(d.course_resources[0].id, shared);
            assert.equal(d.course_resources[0].version_id, version);
            assert.equal(d.course_resources[0].name, "Agreed old.pdf");
            assert.ok(!JSON.stringify(d.course_resources).includes("object_path"));
            assert.ok(
                !JSON.stringify(d.course_resources).includes("Private replacement"),
            );
            assert.equal(
                await actor(
                    teacher,
                    `select count(*) from public.documents where id=${q(doc)}`,
                ),
                "0",
            );
            await sql(
                `update private.course_resources set removed_at=now() where id=${q(shared)}`,
            );
            d = (await day()).sessions[0];
            assert.equal(d.course_resource_count, 12);
            assert.ok(d.course_resources.every((r) => r.id !== shared));
        },
    );
    await check(
        "Archived course hides shared context and archived organisation supplies no contact",
        async () => {
            await sql(
                `update public.course_runs set archived_at=now() where id=${q(run)}`,
            );
            let d = (await day()).sessions[0];
            assert.equal(d.course_run_id, null);
            assert.equal(d.course_contact, null);
            assert.equal(d.shared_preparation, null);
            assert.equal(d.course_resources.length, 0);
            await sql(
                `update public.course_runs set archived_at=null where id=${q(run)};update public.organisations set archived_at=now() where id=${q(org)}`,
            );
            assert.equal((await day()).sessions[0].course_contact, null);
            await sql(
                `update public.organisations set archived_at=null where id=${q(org)}`,
            );
        },
    );
    await check(
        "Role withdrawal and transferred/cancelled intervals cannot retain shared teaching-day context",
        async () => {
            await sql(`delete from public.user_roles where user_id=${q(teacher)}`);
            await assert.rejects(day(), /Active account required/);
            await sql(
                `insert into public.user_roles(user_id,role)values(${q(teacher)},'lecturer');update public.assignment_sessions set released_at=now() where id=${q(session)};update public.job_claims set status='cancelled' where id=${q(claim)}`,
            );
            assert.equal((await day()).sessions.length, 0);
        },
    );
    console.log(`${count} real teaching-day course projection groups passed.`);
});