import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {quoteSql as q, withTestDatabase} from "./testing/database.mjs";
import {assertLmsResponse as assertRpcResponse} from "./testing/premium-lms-contract.mjs";

await withTestDatabase("calendar_export", async ({sql, actor}) => {
    const [teacher, peer, admin] = Array.from({length: 3}, randomUUID);
    await sql(`insert into auth.users(id, email)
               values ${[teacher, peer, admin].map((id) => `(${q(id)},${q(`${id}@example.invalid`)})`).join(",")};
    insert into public.user_roles(user_id,role) values(${q(teacher)},'lecturer'),(${q(peer)},'lecturer'),(${q(admin)},'admin');`);
    const starts = "2026-10-25T00:30:00Z",
        ends = "2026-10-25T01:30:00Z";
    const from = "2026-10-01T00:00:00Z",
        until = "2026-11-01T00:00:00Z";
    const exportFor = async (who, include = false, start = from, end = until) => {
        const result = JSON.parse(
            await actor(
                who,
                `select public.export_my_calendar(${q(start)},${q(end)},${include})`,
            ),
        );
        assertRpcResponse("export_my_calendar", result);
        return result;
    };

    async function assignment(who, {cancelled = false, released = false} = {}) {
        const job = randomUUID(),
            claim = randomUUID(),
            session = randomUUID();
        await sql(`insert into public.jobs(id,title,customer_name,delivery_type,status,amount,currency,rate_unit,total_amount,terms) values(${q(job)},'Fictional DST course','Fictional Client','online','filled',100,'EUR','fixed_total',100,'Private accepted deal');
      insert into public.job_claims(id,job_id,lecturer_id,idempotency_key,status,amount,currency,rate_unit,total_amount,terms,terms_version) values(${q(claim)},${q(job)},${q(who)},${q(randomUUID())},${q(cancelled ? "cancelled" : "confirmed")},100,'EUR','fixed_total',100,'Private accepted deal',1);
      insert into public.assignment_sessions(id,claim_id,lecturer_id,starts_at,ends_at,released_at) values(${q(session)},${q(claim)},${q(who)},${q(starts)},${q(ends)},${released ? "now()" : "null"});`);
        return session;
    }

    const own = await assignment(teacher);
    await assignment(peer);
    const cancelled = await assignment(teacher, {
        cancelled: true,
        released: true,
    });
    const privateId = randomUUID();
    await sql(`insert into public.personal_events(id,user_id,title,starts_at,ends_at,time_zone) values
    (${q(privateId)},${q(teacher)},'Private appointment',${q(ends)},'2026-10-25T02:30:00Z','Europe/Berlin'),
    (${q(randomUUID())},${q(peer)},'Foreign private appointment',${q(ends)},'2026-10-25T02:30:00Z','Europe/Berlin');`);
    const inserted = await actor(
        teacher,
        `insert into public.personal_events(user_id,title,starts_at,ends_at,description,meeting_url) values(${q(teacher)},'Fictional separate appointment','2037-01-01T08:00Z','2037-01-01T09:00Z','Note','https://meet.example.invalid/ok') returning id`,
    );
    assert.ok(inserted);
    await actor(
        teacher,
        `delete from public.personal_events where id=${q(inserted)}`,
    );
    await actor(
        teacher,
        `update public.personal_events set description='Private note café',meeting_url='https://meet.example.invalid/room?x=1' where id=${q(privateId)}`,
    );
    assert.equal(
        await actor(
            teacher,
            `select description from public.personal_events where id=${q(privateId)}`,
        ),
        "Private note café",
    );
    for (const who of [peer, admin]) {
        assert.equal(
            await actor(
                who,
                `select count(*) from public.personal_events where id=${q(privateId)}`,
                who === admin ? "aal2" : "aal1",
            ),
            "0",
        );
        assert.equal(
            await actor(
                who,
                `with changed as (update public.personal_events set description='forged' where id=${q(privateId)} returning id) select count(*) from changed`,
                who === admin ? "aal2" : "aal1",
            ),
            "0",
        );
    }
    for (const url of [
        "http://example.invalid",
        "https://user:pass@example.invalid",
        "javascript:alert(1)",
        "https://example.invalid:99999/path",
        "https://example.invalid:0/path",
        "https://example.invalid/with space",
    ]) {
        await assert.rejects(
            actor(
                teacher,
                `update public.personal_events set meeting_url=${q(url)} where id=${q(privateId)}`,
            ),
            /23514/,
        );
    }
    await assert.rejects(
        actor(
            teacher,
            `update public.personal_events set description=repeat('x',10001) where id=${q(privateId)}`,
        ),
        /23514/,
    );
    const snapshot = JSON.stringify(await exportFor(teacher, true));
    assert.ok(!snapshot.includes("Private note café"));
    assert.ok(!snapshot.includes("meet.example.invalid"));
    console.log(
        "PASS Private notes and HTTPS links remain owner-only, validate on the database and stay out of the existing export projection",
    );
    const result = await exportFor(teacher);
    assert.deepEqual(
        result.map((e) => e.id),
        [own],
    );
    assert.equal(result[0].time_zone, "Europe/Berlin");
    assert.ok(!JSON.stringify(result).includes("Private accepted deal"));
    assert.ok(!JSON.stringify(result).includes("amount"));
    assert.ok(!result.some((e) => e.id === cancelled));
    assert.deepEqual(
        (await exportFor(teacher, true)).map((e) => e.id),
        [own, privateId],
    );
    assert.deepEqual(await exportFor(admin, true), []);
    console.log(
        "PASS Fixed current-owner projection excludes foreign/admin, cancelled and private entries by default; no commercial snapshots",
    );
    assert.deepEqual(await exportFor(teacher, false, ends, until), []);
    assert.deepEqual(await exportFor(teacher, false, from, starts), []);
    for (const [start, end] of [
        [from, from],
        [until, from],
        ["-infinity", until],
        [from, "infinity"],
        [from, "2027-10-01T00:00:00Z"],
    ])
        await assert.rejects(exportFor(teacher, false, start, end), /22023/);
    assert.equal(
        await sql(
            "select has_function_privilege('anon','public.export_my_calendar(timestamptz,timestamptz,boolean)','execute')",
        ),
        "f",
    );
    console.log(
        "PASS Precise overlap boundaries, finite93daybounds and anonymous denial",
    );
    await sql(`insert into public.personal_events(user_id,title,starts_at,ends_at,time_zone)
    select ${q(teacher)},'Fictional busy event',${q(ends)}::timestamptz,'2026-10-25T02:30:00Z','Europe/Berlin' from generate_series(1,500);`);
    await assert.rejects(exportFor(teacher, true), /54000/);
    console.log("PASS More than500events fails explicitly instead of truncating");
    await sql(`update public.profiles set active=false where id=${q(teacher)}`);
    await assert.rejects(exportFor(teacher), /42501/);
    console.log("PASS Current account suspension revokes export");
    console.log("5 calendar export PostgreSQL groups passed");
});
