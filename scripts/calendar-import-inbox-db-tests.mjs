/** Real database checks for atomic private imports and current-authority finance inbox links. */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {quoteSql as q, withTestDatabase} from "./testing/database.mjs";
import {assertLmsResponse as assertRpcResponse} from "./testing/premium-lms-contract.mjs";

await withTestDatabase("calendar_import_inbox", async ({sql, actor}) => {
    const owner = randomUUID(),
        peer = randomUUID(),
        inactive = randomUUID();
    await sql(
        `insert into auth.users(id,email) values(${q(owner)},'import-owner@example.invalid'),(${q(peer)},'import-peer@example.invalid'),(${q(inactive)},'inactive-import@example.invalid');insert into public.user_roles(user_id,role) values(${q(owner)},'lecturer'),(${q(peer)},'lecturer'),(${q(inactive)},'lecturer');update public.profiles set active=false where id=${q(inactive)}`,
    );
    const appointment = {
        uid: "fictional-stable-import\n2040-01-02T09:00:00Z",
        title: "Fictional imported appointment",
        description: "Private details",
        starts_at: "2040-01-02T09:00:00Z",
        ends_at: "2040-01-02T10:00:00Z",
        time_zone: "Europe/Berlin",
    };
    const call = (who, events) =>
        actor(
            who,
            `select public.import_my_calendar(${q(JSON.stringify(events))}::jsonb)`,
        );
    const first = JSON.parse(await call(owner, [appointment]));
    const retried = JSON.parse(await call(owner, [appointment]));
    assertRpcResponse("import_my_calendar", first);
    assertRpcResponse("import_my_calendar", retried);
    assert.deepEqual(first, {
        created: 1,
        skipped: 0,
    });
    assert.deepEqual(retried, {
        created: 0,
        skipped: 1,
    });
    assert.equal(
        await actor(peer, "select count(*) from public.personal_events"),
        "0",
    );
    assert.deepEqual(JSON.parse(await call(peer, [appointment])), {
        created: 1,
        skipped: 0,
    });
    assert.equal(await sql("select count(*) from public.personal_events"), "2");
    console.log(
        "PASS import identities are idempotent and private per authenticated owner",
    );
    await assert.rejects(call(inactive, [appointment]), /42501/);
    await assert.rejects(call(owner, null), /22023/);
    await assert.rejects(
        call(owner, [{...appointment, uid: "infinite", ends_at: "infinity"}]),
        /22023/,
    );
    const before = await sql("select count(*) from public.personal_events");
    await assert.rejects(
        call(owner, [
            {...appointment, uid: "rollback-first"},
            {
                ...appointment,
                uid: "invalid-second",
                ends_at: "2039-01-01T00:00:00Z",
            },
        ]),
        /22023/,
    );
    assert.equal(
        await sql("select count(*) from public.personal_events"),
        before,
    );
    console.log(
        "PASS inactive/invalid batches denied and a failed import rolls back every event",
    );
    const batch = Array.from({length: 500}, (_, index) => ({
        ...appointment,
        uid: `fictional-batch-${index}`,
        time_zone: index % 2 ? "Etc/UTC" : "Australia/Brisbane",
    }));
    batch[499] = {...batch[0], title: "Fictional later duplicate"};
    assert.deepEqual(JSON.parse(await call(owner, batch)), {created: 499, skipped: 1});
    assert.deepEqual(JSON.parse(await call(owner, batch)), {created: 0, skipped: 500});
    assert.equal(await sql("select count(*) from public.personal_events where title='Fictional later duplicate'"), "0");
    await assert.rejects(call(owner, [{...batch[0], time_zone: "Unknown/Zone"}]), /22023/);
    await assert.rejects(call(owner, [
        {...batch[0], uid: "valid-first-event"},
        {...batch[1], uid: "invalid-time-zone", time_zone: "Unknown/Zone"},
    ]), /22023/);
    assert.equal(await sql("select count(*) from public.personal_events"), "501");
    console.log("PASS maximum batch keeps first duplicate and validates all IANA zones before writing");

    await assert.rejects(actor(owner, `insert into public.personal_events(title,starts_at,ends_at,time_zone) values
      ('Fictional direct first','2042-01-01 09:00Z','2042-01-01 10:00Z','Etc/UTC'),
      ('Fictional direct second','2042-01-01 10:00Z','2042-01-01 11:00Z','Unknown/Zone')`), /22023/);
    assert.equal(await sql("select count(*) from public.personal_events"), "501");
    await actor(owner, "update public.personal_events set time_zone='Etc/UTC' where time_zone='Europe/Berlin'");
    await assert.rejects(actor(owner, "update public.personal_events set time_zone='Unknown/Zone'"), /22023/);
    assert.equal(await sql("select count(*) from public.personal_events where time_zone='Unknown/Zone'"), "0");
    console.log("PASS ordinary calendar INSERT and UPDATE retain atomic IANA validation");

    const job = randomUUID(),
        claim = randomUUID();
    await sql(
        `insert into public.jobs(id,title,customer_name,delivery_type,status,amount,total_amount,currency,rate_unit,terms) values(${q(job)},'Fictional reserved job','Fictional company','online','filled',100,100,'EUR','fixed_total','Fictional');insert into public.job_claims(id,job_id,lecturer_id,idempotency_key,amount,total_amount,currency,rate_unit,terms,terms_version) values(${q(claim)},${q(job)},${q(owner)},${q(randomUUID())},100,100,'EUR','fixed_total','Fictional',1);insert into public.assignment_sessions(claim_id,lecturer_id,starts_at,ends_at) values(${q(claim)},${q(owner)},'2041-01-01 09:00Z','2041-01-01 10:00Z')`,
    );
    await assert.rejects(
        call(owner, [
            {
                ...appointment,
                uid: "assignment-conflict",
                starts_at: "2041-01-01T09:00:00Z",
                ends_at: "2041-01-01T10:00:00Z",
            },
        ]),
        /23P01/,
    );
    console.log("PASS confirmed assignment overlap prevents import");
    const reserved = JSON.parse(
        await actor(
            owner,
            `select public.reserve_document('Fictional invoice.pdf','application/pdf',100,'personal','invoice',null,null,${q(randomUUID())},null,null)`,
        ),
    );
    const invoice = randomUUID();
    await sql(
        `update public.document_versions set status='clean',sha256=repeat('b',64) where id=${q(reserved.version_id)};update public.documents set status='clean' where id=${q(reserved.document_id)};insert into public.invoices(id,user_id,number,issued_on,due_on,currency,total_amount,document_version_id,status,client_id) values(${q(invoice)},${q(owner)},'Fictional-ICS-test',current_date,current_date+30,'EUR',100,${q(reserved.version_id)},'submitted',${q(randomUUID())});update public.invoices set status='approved' where id=${q(invoice)}`,
    );
    assert.equal(
        await sql(
            `select count(*) from public.notifications where resource_id=${q(invoice)} and user_id=${q(owner)} and kind in('invoice_submitted','invoice_approved')`,
        ),
        "2",
    );
    const own = JSON.parse(
        await actor(owner, "select public.notification_inbox()"),
    );
    assert.ok(
        own.items.some(
            (item) =>
                item.kind === "invoice_approved" &&
                item.href === "/finance" &&
                item.title === "Fictional-ICS-test",
        ),
    );
    await sql(
        `insert into public.notifications(user_id,kind,resource_id) values(${q(peer)},'invoice_approved',${q(invoice)})`,
    );
    const foreign = JSON.parse(
        await actor(peer, "select public.notification_inbox()"),
    );
    const hidden = foreign.items.find((item) => item.kind === "invoice_approved");
    assert.equal(hidden.href, null);
    assert.equal(hidden.title, "");
    await sql(`update public.profiles set active=false where id=${q(owner)}`);
    await assert.rejects(
        actor(owner, "select public.notification_inbox()"),
        /42501/,
    );
    console.log(
        "PASS finance activity stays in own inbox and current resource permissions govern title/link",
    );
});
