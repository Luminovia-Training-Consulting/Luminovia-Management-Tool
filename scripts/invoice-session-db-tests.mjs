/** Isolated PostgreSQL invoice boundary tests for accepted session time and cancelled/partial review routing. */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {quoteSql as q, withTestDatabase} from "./testing/database.mjs";

let checks = 0;

/** Count one result only after every database assertion in its group succeeds. */
async function check(name, run) {
    await run();
    checks++;
    console.log(`PASS ${name}`);
}

await withTestDatabase("invoice_session_test", async ({sql, actor}) => {
    const lecturer = randomUUID(), otherLecturer = randomUUID(), manager = randomUUID();
    await sql(
        `insert into auth.users(id,email) values('${lecturer}','invoice-owner@example.invalid'),('${otherLecturer}','other-invoice-owner@example.invalid'),('${manager}','invoice-manager@example.invalid');insert into public.user_roles(user_id,role) values('${lecturer}','lecturer'),('${otherLecturer}','lecturer'),('${manager}','management');`,
    );
    /** Invoke a public invoice RPC under the requested identity claim. */
    const rpc = (who, name, args = []) => {
        const inputs = args.map((value) => {
            if (value === null) return "null";
            if (Array.isArray(value)) return q(`{${value.join(",")}}`);
            if (typeof value === "boolean" || typeof value === "number") return String(value);
            return q(typeof value === "object" ? JSON.stringify(value) : value);
        }).join(",");
        const call = `public.${name}(${inputs})`;
        const result = ["invoice_review_cases", "my_invoice_review_candidates"].includes(name)
            ? `select coalesce(jsonb_agg(result), '[]'::jsonb) from ${call} result`
            : `select to_jsonb(${call})`;
        return actor(who, result).then((value) => value ? JSON.parse(value) : null);
    };

    const futureClaim = randomUUID(),
        completedClaim = randomUUID(),
        partialClaim = randomUUID(),
        cancelledClaim = randomUUID(),
        otherClaim = randomUUID();
    const futureJob = randomUUID(),
        completedJob = randomUUID(),
        partialJob = randomUUID(),
        cancelledJob = randomUUID(),
        otherJob = randomUUID();
    const futureSession = randomUUID(),
        completedSession = randomUUID(),
        partialSessionA = randomUUID(),
        partialSessionB = randomUUID(),
        cancelledSession = randomUUID(),
        otherSession = randomUUID();
    const dates = {
        futureStart: new Date(Date.now() + 86400000).toISOString(),
        futureEnd: new Date(Date.now() + 90000000).toISOString(),
        pastStart: new Date(Date.now() - 4 * 86400000).toISOString(),
        pastEnd: new Date(Date.now() - 4 * 86400000 + 3600000).toISOString(),
        partialStartA: new Date(Date.now() - 3 * 86400000).toISOString(),
        partialEndA: new Date(Date.now() - 3 * 86400000 + 3600000).toISOString(),
        partialStartB: new Date(Date.now() - 2 * 86400000).toISOString(),
        partialEndB: new Date(Date.now() - 2 * 86400000 + 3600000).toISOString(),
    };
    await sql(
        `insert into public.jobs(id, title, customer_name, delivery_type, status, amount, total_amount, currency, rate_unit, terms, created_by)
         values ('${futureJob}', 'Future invoice fixture', 'Fictional academy', 'online', 'filled', 200, 200, 'EUR', 'fixed_total', 'Accepted terms', '${manager}'),
                ('${completedJob}', 'Completed invoice fixture', 'Fictional academy', 'online', 'filled', 200, 200, 'EUR', 'fixed_total', 'Accepted terms', '${manager}'),
                ('${partialJob}', 'Partial invoice fixture', 'Fictional academy', 'online', 'filled', 400, 400, 'EUR', 'fixed_total', 'Accepted terms', '${manager}'),
                ('${cancelledJob}', 'Cancelled invoice fixture', 'Fictional academy', 'online', 'draft', 200, 200, 'EUR', 'fixed_total', 'Accepted terms', '${manager}'),
                ('${otherJob}', 'Other invoice fixture', 'Fictional academy', 'online', 'filled', 200, 200, 'EUR', 'fixed_total', 'Accepted terms', '${manager}');
        insert into public.job_sessions(id, job_id, starts_at, ends_at)
        values ('${futureSession}', '${futureJob}', '${dates.futureStart}', '${dates.futureEnd}'),
               ('${completedSession}', '${completedJob}', '${dates.pastStart}', '${dates.pastEnd}'),
               ('${partialSessionA}', '${partialJob}', '${dates.partialStartA}', '${dates.partialEndA}'),
               ('${partialSessionB}', '${partialJob}', '${dates.partialStartB}', '${dates.partialEndB}'),
               ('${cancelledSession}', '${cancelledJob}', '${dates.pastStart}', '${dates.pastEnd}'),
               ('${otherSession}', '${otherJob}', '${dates.pastStart}', '${dates.pastEnd}');
        insert into public.job_claims(id, job_id, lecturer_id, idempotency_key, status, amount, currency, rate_unit, total_amount, terms, terms_version)
        values ('${futureClaim}', '${futureJob}', '${lecturer}', '${randomUUID()}', 'confirmed', 200, 'EUR', 'fixed_total', 200, 'Accepted terms', 1),
               ('${completedClaim}', '${completedJob}', '${lecturer}', '${randomUUID()}', 'confirmed', 200, 'EUR', 'fixed_total', 200, 'Accepted terms', 1),
               ('${partialClaim}', '${partialJob}', '${lecturer}', '${randomUUID()}', 'confirmed', 400, 'EUR', 'fixed_total', 400, 'Accepted terms', 1),
               ('${cancelledClaim}', '${cancelledJob}', '${lecturer}', '${randomUUID()}', 'cancelled', 200, 'EUR', 'fixed_total', 200, 'Accepted terms', 1),
               ('${otherClaim}', '${otherJob}', '${otherLecturer}', '${randomUUID()}', 'confirmed', 200, 'EUR', 'fixed_total', 200, 'Accepted terms', 1);
        insert into public.assignment_sessions(id, claim_id, lecturer_id, starts_at, ends_at, released_at)
        values ('${futureSession}', '${futureClaim}', '${lecturer}', '${dates.futureStart}', '${dates.futureEnd}', null),
               ('${completedSession}', '${completedClaim}', '${lecturer}', '${dates.pastStart}', '${dates.pastEnd}', null),
               ('${partialSessionA}', '${partialClaim}', '${lecturer}', '${dates.partialStartA}', '${dates.partialEndA}', null),
               ('${partialSessionB}', '${partialClaim}', '${lecturer}', '${dates.partialStartB}', '${dates.partialEndB}', now()),
               ('${otherSession}', '${otherClaim}', '${otherLecturer}', '${dates.pastStart}', '${dates.pastEnd}', null);`,
    );
    const document = randomUUID(), version = randomUUID(), client = randomUUID();
    await sql(
        `insert into public.documents(id,owner_id,uploaded_by,scope,kind,original_name,mime_type,size_bytes,status,client_id) values('${document}','${lecturer}','${lecturer}','personal','invoice','Fictional invoice.pdf','application/pdf',100,'clean','${client}');insert into public.document_versions(id,document_id,uploaded_by,client_id,version,object_path,original_name,mime_type,size_bytes,sha256,status) values('${version}','${document}','${lecturer}','${client}',1,'${lecturer}/${document}/${version}','Fictional invoice.pdf','application/pdf',100,'${"a".repeat(64)}','clean');update public.documents set current_version_id='${version}' where id='${document}'`,
    );
    const issued = new Date().toISOString().slice(0, 10),
        defaultDue = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

    await check(
        "Invoice eligibility uses the final scheduled assignment session, not attendance or quizzes",
        async () => {
            await assert.rejects(
                rpc(lecturer, "submit_invoice", [
                    "FUTURE-1",
                    [futureClaim],
                    version,
                    issued,
                    null,
                    randomUUID(),
                ]),
                /invoice_not_ready/,
            );
            const invoice = await rpc(lecturer, "submit_invoice", [
                "COMPLETED-1",
                [completedClaim],
                version,
                issued,
                null,
                randomUUID(),
            ]);
            const dates = await sql(
                `select issued_on::text||'|'||due_on::text from public.invoices where id='${invoice}'`,
            );
            assert.equal(dates, `${issued}|${defaultDue}`);
            assert.equal(
                await sql(`select count(*) from public.invoice_items where claim_id='${completedClaim}'`),
                "1",
            );
        },
    );

    await check(
        "Cancelled and partial blocks require a scoped human review, never a direct invoice",
        async () => {
            await assert.rejects(
                rpc(lecturer, "submit_invoice", [
                    "PARTIAL-1",
                    [partialClaim],
                    version,
                    issued,
                    null,
                    randomUUID(),
                ]),
                /invoice_review_required/,
            );
            await assert.rejects(
                rpc(lecturer, "submit_invoice", [
                    "CANCELLED-1",
                    [cancelledClaim],
                    version,
                    issued,
                    null,
                    randomUUID(),
                ]),
                /invoice_review_required/,
            );
            await assert.rejects(
                rpc(lecturer, "submit_invoice", [
                    "FOREIGN-1",
                    [otherClaim],
                    version,
                    issued,
                    null,
                    randomUUID(),
                ]),
                /42501/,
            );
            assert.equal(
                await sql(
                    `select count(*) from public.invoice_items where claim_id in ('${partialClaim}','${cancelledClaim}','${otherClaim}')`,
                ),
                "0",
            );
        },
    );

    await check(
        "Invoice review requests are idempotent, lecturer-scoped and separately resolved by finance",
        async () => {
            const requestId = randomUUID(),
                reviewId = await rpc(lecturer, "request_invoice_review", [
                    partialClaim,
                    requestId,
                ]);
            assert.equal(
                await rpc(lecturer, "request_invoice_review", [partialClaim, requestId]),
                reviewId,
            );
            await assert.rejects(
                rpc(otherLecturer, "request_invoice_review", [partialClaim, randomUUID()]),
                /Own accepted claim required/,
            );
            await assert.rejects(rpc(lecturer, "invoice_review_cases"), /42501/);
            const managerCases = await rpc(manager, "invoice_review_cases");
            assert.equal(managerCases.length, 1);
            assert.equal(managerCases[0].id, reviewId);
            assert.equal(managerCases[0].reason, "partial_delivery");
            await rpc(manager, "resolve_invoice_review_request", [
                reviewId,
                "Fictional finance review recorded for this accepted block.",
            ]);
            const requester = await rpc(lecturer, "my_invoice_review_candidates");
            assert.equal(
                requester.find((item) => item.claim_id === partialClaim).review_status,
                "resolved",
            );
            assert.equal(await rpc(manager, "invoice_review_cases").then((rows) => rows.length), 0);
            assert.equal(
                await sql(
                    `select count(*) from public.invoice_items where claim_id in ('${partialClaim}','${cancelledClaim}')`,
                ),
                "0",
            );
        },
    );
});

console.log(`PASS: ${checks} isolated invoice session/review database groups.`);