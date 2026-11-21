/** Verify isolated role grants against actual PostgreSQL claims and invoice routes. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

await withTestDatabase("lecturer_role_boundary", async ({ sql, actor }) => {
    const accounts = Object.fromEntries(
        [
            "owner",
            "admin",
            "management",
            "client",
            "participant",
            "lecturer",
            "senior_lecturer",
            "client_lecturer",
            "manager_lecturer",
        ].map((role) => [role, randomUUID()]),
    );
    const grants = {
        owner: ["owner"],
        admin: ["admin"],
        management: ["management"],
        client: ["client"],
        participant: ["participant"],
        lecturer: ["lecturer"],
        senior_lecturer: ["senior_lecturer"],
        client_lecturer: ["client", "lecturer"],
        manager_lecturer: ["management", "lecturer"],
    };
    await sql(`insert into auth.users(id,email,email_confirmed_at) values ${Object.entries(
        accounts,
    )
        .map(([name, id]) => `(${q(id)},${q(name + "@example.invalid")},now())`)
        .join(",")};
        insert into public.user_roles(user_id,role) values ${Object.entries(
            grants,
        )
            .flatMap(([name, roles]) =>
                roles.map((role) => `(${q(accounts[name])},${q(role)})`),
            )
            .join(",")};`);

    const assignedCourse = randomUUID();
    const template = randomUUID();
    const courseCompany = randomUUID();
    const companyLecturer = accounts.client_lecturer;
    await sql(`insert into public.organisations(id,name) values (${q(courseCompany)},'Fictional course company');
          insert into public.course_templates(id,title) values (${q(template)},'Assigned instruction');
          insert into public.course_runs(id,template_id,organisation_id,delivery_type,time_zone)
          values (${q(assignedCourse)},${q(template)},${q(courseCompany)},'online','UTC');`);
    const offer = randomUUID();
    await sql(`insert into public.jobs(id,title,customer_name,delivery_type,status,amount,total_amount,currency,rate_unit,terms,capacity,capacity_basis,requires_contract,course_run_id)
        values (${q(offer)},'Fictional instruction','Fictional company','online','published',200,200,'EUR','fixed_total','Fictional terms',5,'per_position',false,${q(assignedCourse)});
        insert into public.job_sessions(job_id, starts_at, ends_at)
        values (${q(offer)},now()+interval '2 days',now()+interval '2 days 1 hour');`);

    const claim = async (who) =>
        JSON.parse(
            await actor(
                who,
                `select public.claim_job(${q(offer)},${q(randomUUID())},1)`,
            ),
        );
    const invoiceCall = (key, owner = null, mime = "application/pdf") =>
        `public.reserve_document('Fictional invoice.pdf',${q(mime)},128,'personal','invoice',null,null,${q(key)},null,${owner ? q(owner) : "null"})`;
    const reserve = async (who, key, owner = null) =>
        JSON.parse(await actor(who, `select ${invoiceCall(key, owner)}`));
    const eligibility = async (who) =>
        JSON.parse(await actor(who, `select public.commercial_access()`));
    const service = (body) =>
        sql(`begin;set local role service_role;${body};commit;`);

    for (const role of [
        "owner",
        "admin",
        "management",
        "client",
        "participant",
    ]) {
        const who = accounts[role];
        if (role === "participant") {
            await assert.rejects(claim(who), /42501/);
        } else {
            assert.equal((await claim(who)).status, "not_eligible", role);
            assert.equal(
                (await eligibility(who)).can_submit_invoice,
                false,
                role,
            );
        }
        await assert.rejects(reserve(who, randomUUID()), /42501/, role);
    }
    assert.equal(
        await sql(
            `select count(*) from public.job_claims where job_id = ${q(offer)}`,
        ),
        "0",
    );
    assert.equal(
        await sql(
            `select count(*) from public.documents where kind = 'invoice'`,
        ),
        "0",
    );
    for (const role of ["owner", "admin", "management"]) {
        assert.equal(
            (await eligibility(accounts[role])).can_manage_finance,
            true,
            role,
        );
    }

    await assert.rejects(
        actor(
            accounts.client,
            `select ${invoiceCall(randomUUID(), accounts.lecturer)}`,
        ),
        /42501/,
    );
    await assert.rejects(
        actor(
            accounts.management,
            `select ${invoiceCall(randomUUID(), accounts.participant)}`,
        ),
        /42501/,
    );
    const onBehalf = await reserve(
        accounts.management,
        randomUUID(),
        accounts.lecturer,
    );
    assert.equal(
        await sql(
            `select owner_id from public.documents where id = ${q(onBehalf.document_id)}`,
        ),
        accounts.lecturer,
    );
    assert.equal(
        await sql(
            `select uploaded_by from public.document_versions where id = ${q(onBehalf.version_id)}`,
        ),
        accounts.management,
    );

    for (const role of [
        "lecturer",
        "senior_lecturer",
        "client_lecturer",
        "manager_lecturer",
    ]) {
        const who = accounts[role];
        assert.equal((await claim(who)).status, "confirmed", role);
        assert.equal((await eligibility(who)).can_submit_invoice, true, role);
        assert.equal(
            (await reserve(who, randomUUID())).status,
            "quarantined",
            role,
        );
    }
    await assert.rejects(
        actor(
            accounts.lecturer,
            `select ${invoiceCall(randomUUID(), null, "text/plain")}`,
        ),
        /22023/,
    );
    console.log(
        "PASS actual lecturer and senior lecturer grants permit own claims and invoice PDFs; company and management roles add no teaching rights",
    );

    const courses = async () =>
      JSON.parse(
        await actor(companyLecturer, "select public.my_course_workspaces()"),
      );
    assert.equal((await courses())[0].id, assignedCourse);
    await sql(
      `delete from public.user_roles where user_id = ${q(companyLecturer)} and role = 'lecturer'`,
    );
    assert.deepEqual(await courses(), []);
    await assert.rejects(
      actor(
        companyLecturer,
        `select public.course_workspace(${q(assignedCourse)})`,
      ),
      /42501/,
    );
    assert.equal(
      await sql(
        `select count(*) from public.job_claims where job_id = ${q(offer)} and lecturer_id = ${q(companyLecturer)} and status = 'confirmed'`,
      ),
      "1",
    );
    console.log(
      "PASS revoking teaching access hides a retained assignment from an unrelated company role",
    );

    const who = accounts.manager_lecturer;
    const idempotency = randomUUID();
    const { document_id: document, version_id: version } = await reserve(
        who,
        idempotency,
    );
    const uploadAuthority = (actorId) =>
        actor(
            actorId,
            `select public.can_finalize_invoice_upload(${q(document)},${q(version)})`,
        );
    assert.equal(await uploadAuthority(who), "t");
    assert.equal(await uploadAuthority(accounts.management), "f");
    assert.equal(await uploadAuthority(accounts.lecturer), "f");
    const lease =
        await service(`select public.deletion_upload_begin(${q(document)},${q(version)});
        update public.document_versions set status='scanning' where id=${q(version)};
        update public.documents set status='scanning' where id=${q(document)}`);
    const completeCall = (token) =>
        `public.complete_invoice_upload(${q(document)},${q(version)},${q(token)},${q("a".repeat(64))},'Fictional scanner')`;
    await assert.rejects(actor(who, `select ${completeCall(lease)}`), /42501/);
    await assert.rejects(
        service(`select ${completeCall(randomUUID())}`),
        /42501/,
    );

    // Leaving management assigned keeps the same authenticated actor active.
    await sql(
        `delete from public.user_roles where user_id = ${q(who)} and role = 'lecturer'`,
    );
    assert.equal(await uploadAuthority(who), "f");
    await assert.rejects(reserve(who, idempotency), /42501/);
    await assert.rejects(service(`select ${completeCall(lease)}`), /42501/);
    assert.equal(
        await sql(
            `select status from public.document_versions where id = ${q(version)}`,
        ),
        "scanning",
    );
    assert.equal(
        await sql(
            `select count(*) from public.audit_events where action = 'document.scan_clean' and resource_id = ${q(document)}`,
        ),
        "0",
    );
    await sql(
        `insert into public.user_roles(user_id,role) values (${q(who)},'lecturer')`,
    );
    await service(
        `select ${completeCall(lease)};select public.deletion_upload_end(${q(lease)})`,
    );
    assert.equal(
        await sql(
            `select status from public.documents where id = ${q(document)}`,
        ),
        "clean",
    );
    assert.equal(
        await sql(
            `select count(*) from public.audit_events where action = 'document.scan_clean' and resource_id = ${q(document)}`,
        ),
        "1",
    );
    console.log(
        "PASS current roles protect exact reservation retries and scanning completion, with no false clean state or audit after revocation",
    );

    const pastJob = randomUUID(),
        pastClaim = randomUUID();
    await sql(`insert into public.jobs(id,title,customer_name,delivery_type,status,amount,total_amount,currency,rate_unit,terms,requires_contract)
        values (${q(pastJob)},'Completed instruction','Fictional company','online','filled',200,200,'EUR','fixed_total','Fictional terms',false);
        insert into public.job_sessions(job_id,starts_at,ends_at) values (${q(pastJob)},now()-interval '2 days',now()-interval '2 days'+interval '1 hour');
        insert into public.job_claims(id,job_id,lecturer_id,idempotency_key,status,amount,total_amount,currency,rate_unit,terms,terms_version)
        values (${q(pastClaim)},${q(pastJob)},${q(who)},${q(randomUUID())},'confirmed',200,200,'EUR','fixed_total','Fictional terms',1);
        insert into public.assignment_sessions(claim_id,lecturer_id,starts_at,ends_at)
        select ${q(pastClaim)},${q(who)},starts_at,ends_at from public.job_sessions where job_id=${q(pastJob)}`);
    const receipt = randomUUID();
    const submit = (user) =>
        actor(
            user,
            `select public.submit_invoice('FICTIONAL-1',array[${q(pastClaim)}::uuid],${q(version)},current_date,null,${q(receipt)})`,
        );
    await assert.rejects(submit(accounts.client), /42501/);
    await assert.rejects(submit(accounts.management), /42501/);
    await assert.rejects(submit(accounts.lecturer), /42501/);
    const invoice = await submit(who);
    assert.equal(await submit(who), invoice);
    await sql(
        `delete from public.user_roles where user_id = ${q(who)} and role = 'lecturer'`,
    );
    await assert.rejects(submit(who), /42501/);
    assert.equal(
        await actor(
            who,
            `select count(*) from public.invoices where id = ${q(invoice)} and user_id = ${q(who)}`,
        ),
        "1",
    );
    assert.equal(
        await actor(
            accounts.management,
            `select count(*) from public.invoices where id = ${q(invoice)}`,
        ),
        "1",
    );
    assert.equal(
        await actor(
            accounts.client,
            `select count(*) from public.invoices where id = ${q(invoice)}`,
        ),
        "0",
    );
    console.log(
        "PASS own invoice submission and exact retry obey the teaching role; history, staff review and company isolation stay intact",
    );
});
