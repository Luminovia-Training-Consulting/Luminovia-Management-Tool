/** Commercial permission and snapshot tests on actual PostgreSQL, in a disposable DB.
 * Auth helpers are compatible stubs here; the separate chat-api-check uses real JWTs/realtime.
 */
import {spawn} from "node:child_process";
import {readdir, readFile} from "node:fs/promises";
import {withMigrationReplayLock} from "./testing/database.mjs";
import {randomUUID} from "node:crypto";
import assert from "node:assert/strict";
import {assertLmsResponse as assertRpcResponse} from "./testing/premium-lms-contract.mjs";

const container =
    process.env.PORTAL_DB_CONTAINER ?? "supabase_db_luminovia-portal";
if (
    !/^supabase_db_luminovia-portal(?:-test(?:-[a-zA-Z0-9_-]+)?)?$/.test(
        container,
    )
)
    throw new Error(
        "Only the named local portal database container is permitted.",
    );
const database = `commercial_test_${randomUUID().replaceAll("-", "")}`;

/** Starts the test program with explicit arguments and preserves its failure status. */
function command(args, input = "") {
    return new Promise((resolve, reject) => {
        const child = spawn("docker", args, {stdio: ["pipe", "pipe", "pipe"]});
        let out = "",
            err = "";
        child.stdout.on("data", (d) => (out += d));
        child.stderr.on("data", (d) => (err += d));
        child.on("error", reject);
        child.on("exit", (code) =>
            code === 0 ? resolve(out.trim()) : reject(new Error(err || out)),
        );
        child.stdin.end(input);
    });
}

/** Sends SQL to the owned test database and makes every psql error fail the run. */
const sql = (text, name = database) =>
    command(
        [
            "exec",
            "-i",
            container,
            "psql",
            "-U",
            "postgres",
            "-d",
            name,
            "-X",
            "-qAt",
            "-v",
            "ON_ERROR_STOP=1",
        ],
        text,
    );
/** Quotes controlled fixture SQL literals; identifiers have separate validation. */
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
/** Executes the check as a specific identity so administrative fixture privileges cannot mask the tested access. */
const actor = (id, statement, aal = "aal1") =>
    sql(
        `begin;set local role authenticated;set local request.jwt.claims=${quote(JSON.stringify({sub: id, aal, role: "authenticated"}))};${statement};commit;`,
    );
/** Calls the public RPC as the test identity and returns its scalar database value. */
const value = (id, fn, args = [], aal) =>
    actor(
        id,
        `select public.${fn}(${args.map((x) => (x === null ? "null" : typeof x === "boolean" ? String(x) : quote(x))).join(",")})`,
        aal,
    ).then((result) => {
        if (fn === "record_invoice_payment") assertRpcResponse(fn, result);
        return result;
    });
/** Aggregates public RPC rows into JSON under the checked caller identity. */
const rows = (id, fn, args = [], aal) =>
    actor(
        id,
        `select coalesce(json_agg(x),'[]') from public.${fn}(${args.map((x) => (x === null ? "null" : typeof x === "number" || typeof x === "boolean" ? String(x) : quote(x))).join(",")}) x`,
        aal,
    ).then((raw) => {
        const result = JSON.parse(raw);
        if (["contract_records", "invoice_records", "invoice_payments"].includes(fn))
            assertRpcResponse(fn, result);
        return result;
    });
const a = randomUUID(),
    b = randomUUID(),
    admin = randomUUID(),
    admin2 = randomUUID(),
    participant = randomUUID();
let checks = 0;
/** Counts and reports a case only after all of its assertions have completed successfully. */
const check = async (name, fn) => {
    await fn();
    checks++;
    console.log(`PASS ${name}`);
};
const start = new Date(Date.now() + 90 * 86400000),
    expiry = new Date(Date.now() + 365 * 86400000).toISOString(),
    effective = "2026-01-01T00:00:00Z";
const sha = "1".repeat(64);

/** Creates a controlled PDF version with ownership and scan status for SQL-only contract tests. */
async function file(owner, kind = "contract", clean = true) {
    const id = randomUUID(),
        version = randomUUID(),
        client = randomUUID();
    await sql(
        `insert into public.documents(id,owner_id,uploaded_by,scope,kind,original_name,mime_type,size_bytes,status,client_id) values('${id}','${owner}','${kind === "contract" ? admin : owner}','personal','${kind}','Fictional.pdf','application/pdf',100,'${clean ? "clean" : "quarantined"}','${client}');insert into public.document_versions(id,document_id,uploaded_by,client_id,version,object_path,original_name,mime_type,size_bytes,sha256,status) values('${version}','${id}','${kind === "contract" ? admin : owner}','${client}',1,'${owner}/${id}/${version}','Fictional.pdf','application/pdf',100,'${sha}','${clean ? "clean" : "quarantined"}');update public.documents set current_version_id='${version}' where id='${id}'`,
    );
    return {id, version};
}

/** Registers the exact executed document version at the controlled permission level and with its own retry identity. */
const register = (
    owner,
    document,
    title = "Executed fictional contract",
    kind = "master",
    parent = null,
    ends = expiry,
    key = randomUUID(),
    aal = "aal1",
) =>
    value(
        admin,
        "register_executed_contract",
        [owner, title, document.version, effective, ends, kind, parent, key],
        aal,
    );

/** Creates a fictional job with controlled sessions and terms for the following assertions. */
async function job(day, fee, currency = "EUR", requires = false) {
    const begins = new Date(+start + day * 86400000),
        ends = new Date(+begins + 3600000);
    const payload = {
        title: `Fictional commercial job ${day}`,
        customer_name: "Fictional finance customer",
        description: "test",
        delivery_type: "online",
        time_zone: "Europe/Berlin",
        status: "published",
        amount: fee,
        total_amount: fee,
        currency,
        rate_unit: "fixed_total",
        terms: "Immutable commercial fixture",
        requires_contract: requires,
        sessions: [
            {starts_at: begins.toISOString(), ends_at: ends.toISOString()},
        ],
        topic_ids: [],
    };
    return actor(
        admin,
        `select public.create_job(${quote(JSON.stringify(payload))}::jsonb)`,
        "aal1",
    );
}

/** Calls the actual claim RPC; only the database result confirms whole-block allocation. */
const claim = (who, id) =>
    value(who, "claim_job", [id, randomUUID(), 1]).then(JSON.parse);
let master,
    masterFile,
    addendum,
    claim1,
    claim2,
    claimAud,
    otherClaim,
    invoice,
    invoiceFile;
try {
    await sql(`create database ${database}`, "postgres");
    await sql(
        `create schema auth;create schema extensions;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz default now(),created_at timestamptz default clock_timestamp());create function auth.uid() returns uuid language sql stable as $$select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;grant usage on schema auth to authenticated,anon,service_role;grant execute on all functions in schema auth to authenticated,anon,service_role;`,
    );
    await withMigrationReplayLock(container, async () => {
        for (const name of (
            await readdir(new URL("../supabase/migrations/", import.meta.url))
        )
            .filter((f) => f.endsWith(".sql"))
            .sort())
            await sql(
                await readFile(
                    new URL(`../supabase/migrations/${name}`, import.meta.url),
                    "utf8",
                ),
            );
    });
    await sql(
        `insert into auth.users(id) values('${a}'),('${b}'),('${admin}'),('${admin2}'),('${participant}');insert into public.user_roles(user_id,role) values('${a}','lecturer'),('${b}','senior_lecturer'),('${admin}','admin'),('${admin2}','admin'),('${participant}','participant');update public.profiles set display_name='Fictional commercial user'`,
    );
    await check(
        "Executed agreement registration requires management permission and a clean PDF of the correct owner",
        async () => {
            masterFile = await file(a);
            await assert.rejects(register(b, masterFile), /owned by the lecturer/);
            const quarantine = await file(a, "contract", false);
            await assert.rejects(register(a, quarantine), /clean executed-contract/);
            const key = randomUUID();
            master = await register(
                a,
                masterFile,
                "Executed master",
                "master",
                null,
                expiry,
                key,
            );
            assert.equal(
                await register(
                    a,
                    masterFile,
                    "Executed master",
                    "master",
                    null,
                    expiry,
                    key,
                ),
                master,
            );
            assert.equal((await rows(a, "contract_records"))[0].sha256, sha);
        },
    );
    await check(
        "Other lecturers, seniors and AAL1 managers cannot read personal contracts or forge receipt signatures",
        async () => {
            assert.deepEqual(await rows(b, "contract_records"), []);
            await assert.rejects(
                rows(b, "contract_records", [true], "aal1"),
                /required/i,
            );
            assert.equal(
                (await rows(admin, "contract_records", [true], "aal1")).length,
                1,
            );
            await assert.rejects(
                value(b, "acknowledge_contract", [master, sha, randomUUID()]),
                /exact contract/,
            );
            await assert.rejects(
                value(a, "acknowledge_contract", [
                    master,
                    "0".repeat(64),
                    randomUUID(),
                ]),
                /exact contract/,
            );
        },
    );
    await check(
        "Receipt acknowledgement is exact-version, immutable and idempotent, not a legal signature record",
        async () => {
            const key = randomUUID(),
                id = await value(a, "acknowledge_contract", [master, sha, key]);
            assert.equal(
                await value(a, "acknowledge_contract", [master, sha, key]),
                id,
            );
            assert.equal(
                await sql(
                    `select kind from public.contract_acceptances where id='${id}'`,
                ),
                "receipt_acknowledgement",
            );
            await assert.rejects(
                sql(
                    `update public.contract_acceptances set document_sha256='${"2".repeat(64)}' where id='${id}'`,
                ),
                /immutable/,
            );
            await assert.rejects(
                sql(
                    `update public.contracts set document_sha256='${"2".repeat(64)}' where id='${master}'`,
                ),
                /immutable/,
            );
        },
    );
    await check(
        "Newest expired replacement never falls back to an older active contract",
        async () => {
            const short = await file(a);
            await register(
                a,
                short,
                "Shorter replacement",
                "master",
                null,
                new Date(Date.now() + 30 * 86400000).toISOString(),
            );
            const j = await job(0, 100, "EUR", true);
            assert.equal((await claim(a, j)).status, "prerequisite_missing");
            masterFile = await file(a);
            master = await register(a, masterFile, "Renewed executed master");
            const amendmentFile = await file(a);
            addendum = await register(
                a,
                amendmentFile,
                "Executed addendum",
                "addendum",
                master,
            );
            const result = await claim(a, j);
            assert.equal(result.status, "confirmed");
            claim1 = result.claim_id;
            assert.equal(
                await sql(
                    `select contract_id from public.job_claims where id='${claim1}'`,
                ),
                addendum,
            );
        },
    );
    await check(
        "Explicit parent revocation blocks addenda without changing previously accepted assignments",
        async () => {
            await value(admin, "set_contract_status", [master, "expired"], "aal1");
            const next = await job(1, 200, "EUR", true);
            assert.equal((await claim(a, next)).status, "prerequisite_missing");
            await value(admin, "set_contract_status", [master, "active"], "aal1");
            claim2 = (await claim(a, next)).claim_id;
            assert.ok(claim2);
            assert.equal(
                await sql(
                    `select contract_id from public.job_claims where id='${claim1}'`,
                ),
                addendum,
            );
            claimAud = (await claim(a, await job(2, 300, "AUD"))).claim_id;
            otherClaim = (await claim(b, await job(3, 900, "EUR"))).claim_id;
        },
    );
    await check(
        "Personal earnings preserve original EUR/AUD snapshots and derive expected/completed states",
        async () => {
            let records = await rows(a, "finance_earnings");
            assert.equal(records.length, 3);
            assert.ok(records.every((r) => r.stage === "expected"));
            assert.deepEqual(
                new Set(records.map((r) => r.currency)),
                new Set(["EUR", "AUD"]),
            );
            await sql(
                `update public.assignment_sessions set starts_at=now()-interval '2 days',ends_at=now()-interval '1 day' where claim_id='${claim1}'`,
            );
            records = await rows(a, "finance_earnings");
            assert.equal(
                records.find((r) => r.claim_id === claim1).stage,
                "completed",
            );
            await assert.rejects(
                rows(b, "finance_earnings", [true], "aal1"),
                /required/i,
            );
            assert.equal((await rows(b, "finance_earnings")).length, 1);
            assert.equal(
                (await rows(admin, "finance_earnings", [true], "aal1")).length,
                4,
            );
        },
    );
    await check(
        "Invoice submission rejects mixed currencies, someone else’s claims and unscanned/wrong-owner PDFs",
        async () => {
            // Keep the earlier future/complete earnings witness intact, then
            // finish the remaining fictional blocks before invoice checks.
            await sql(`update public.assignment_sessions set starts_at=now()-interval '4 days',
                ends_at=now()-interval '3 days' where claim_id='${claimAud}';
                update public.assignment_sessions set starts_at=now()-interval '6 days',
                ends_at=now()-interval '5 days' where claim_id='${claim2}';`);
            invoiceFile = await file(a, "invoice");
            const today = "2026-11-15",
                due = "2026-12-15";
            await assert.rejects(
                value(a, "submit_invoice", [
                    "Mixed",
                    `{${claim1},${claimAud}}`,
                    invoiceFile.version,
                    today,
                    due,
                    randomUUID(),
                ]),
                /one original currency/,
            );
            await assert.rejects(
                value(a, "submit_invoice", [
                    "Foreign",
                    `{${otherClaim}}`,
                    invoiceFile.version,
                    today,
                    due,
                    randomUUID(),
                ]),
                /Only own accepted/,
            );
            const wrong = await file(b, "invoice");
            await assert.rejects(
                value(a, "submit_invoice", [
                    "Wrong PDF",
                    `{${claim1}}`,
                    wrong.version,
                    today,
                    due,
                    randomUUID(),
                ]),
                /Own clean invoice/,
            );
            const dirty = await file(a, "invoice", false);
            await assert.rejects(
                value(a, "submit_invoice", [
                    "Dirty PDF",
                    `{${claim1}}`,
                    dirty.version,
                    today,
                    due,
                    randomUUID(),
                ]),
                /Own clean invoice/,
            );
        },
    );
    await check(
        "Amounts derive from immutable accepted claims and retries cannot duplicate an active invoice",
        async () => {
            const key = randomUUID(),
                args = [
                    "INV-001",
                    `{${claim1},${claim2}}`,
                    invoiceFile.version,
                    "2026-11-15",
                    "2026-12-15",
                    key,
                ];
            invoice = await value(a, "submit_invoice", args);
            assert.equal(await value(a, "submit_invoice", args), invoice);
            let record = (await rows(a, "invoice_records"))[0];
            assert.equal(Number(record.total_amount), 300);
            assert.equal(record.currency, "EUR");
            assert.equal(Number(record.paid_amount), 0);
            assert.equal(record.paid_at, null);
            await assert.rejects(
                value(a, "submit_invoice", [
                    "Duplicate",
                    `{${claim1}}`,
                    invoiceFile.version,
                    "2026-11-15",
                    "2026-12-15",
                    randomUUID(),
                ]),
                /active invoice/,
            );
            await sql(
                `update public.jobs set total_amount=999,amount=999 where id in (select job_id from public.job_claims where id in ('${claim1}','${claim2}'))`,
            );
            record = (await rows(a, "invoice_records"))[0];
            assert.equal(Number(record.total_amount), 300);
            await assert.rejects(
                sql(
                    `update public.invoices set total_amount=999 where id='${invoice}'`,
                ),
                /immutable/,
            );
        },
    );
    await check(
        "Invoice RLS and management exports deny horizontal access and forged direct writes",
        async () => {
            assert.deepEqual(await rows(b, "invoice_records"), []);
            await assert.rejects(
                rows(b, "invoice_records", [true], "aal1"),
                /required/i,
            );
            assert.equal(
                await actor(
                    b,
                    `select count(*) from public.invoices where id='${invoice}'`,
                ),
                "0",
            );
            await assert.rejects(
                rows(b, "invoice_payments", [invoice]),
                /access denied/,
            );
            await assert.rejects(
                actor(
                    a,
                    `update public.invoices set status='paid' where id='${invoice}'`,
                ),
                /permission denied/,
            );
            assert.equal(
                (await rows(admin, "invoice_records", [true], "aal1")).length,
                1,
            );
        },
    );
    await check(
        "permission review and partial payment ledger derive paid status without overpayment or duplicate records",
        async () => {
            await value(
                admin,
                "review_invoice",
                [invoice, "approved", "Reviewed"],
                "aal1",
            );
            const paidAt = new Date(Date.now() - 1000).toISOString(),
                earlierPaidAt = new Date(Date.parse(paidAt) - 60000).toISOString(),
                key = randomUUID();
            const payment = await value(
                admin,
                "record_invoice_payment",
                [invoice, 100, paidAt, "Payment reference", key],
                "aal1",
            );
            assert.equal(
                await value(
                    admin,
                    "record_invoice_payment",
                    [invoice, 100, paidAt, "Payment reference", key],
                    "aal1",
                ),
                payment,
            );
            let record = (await rows(a, "invoice_records"))[0];
            assert.equal(Number(record.paid_amount), 100);
            assert.equal(Date.parse(record.paid_at), Date.parse(paidAt));
            assert.equal(record.status, "approved");
            await assert.rejects(
                value(
                    admin,
                    "record_invoice_payment",
                    [invoice, 201, paidAt, "Overpaid", randomUUID()],
                    "aal1",
                ),
                /exceed/,
            );
            await assert.rejects(
                value(
                    admin,
                    "review_invoice",
                    [invoice, "cancelled", "Cannot erase paid work"],
                    "aal1",
                ),
                /partially paid/,
            );
            await value(
                admin,
                "record_invoice_payment",
                [invoice, 200, earlierPaidAt, "Final payment", randomUUID()],
                "aal1",
            );
            record = (await rows(a, "invoice_records"))[0];
            assert.equal(record.status, "paid");
            assert.equal(Number(record.paid_amount), 300);
            assert.equal(Date.parse(record.paid_at), Date.parse(paidAt));
            assert.equal(
                (await rows(a, "finance_earnings")).find((r) => r.claim_id === claim1)
                    .stage,
                "paid",
            );
            await assert.rejects(
                sql(`update public.payment_records set amount=2 where id='${payment}'`),
                /immutable/,
            );
            await value(
                admin,
                "void_invoice_payment",
                [payment, "Corrected tracking entry"],
                "aal1",
            );
            record = (await rows(a, "invoice_records"))[0];
            assert.equal(record.status, "approved");
            assert.equal(Number(record.paid_amount), 200);
            assert.equal(Date.parse(record.paid_at), Date.parse(earlierPaidAt));
            assert.equal(
                (await rows(a, "invoice_payments", [invoice])).filter(
                    (r) => r.voided_at,
                ).length,
                1,
            );
        },
    );
    await check(
        "Invoice pages preserve stable order and scopes beyond the REST cap",
        async () => {
            const pdf = await file(b, "invoice");
            await sql(
                `insert into public.invoices(user_id,number,issued_on,due_on,currency,total_amount,document_version_id,client_id,created_at)
                 select '${b}', 'FICT-PAGED-'||seq, '2026-11-01', '2026-12-01', 'EUR', 100, '${pdf.version}',
                   gen_random_uuid(), '2026-11-15T14:30:00.123456Z'
                 from generate_series(1,1001) seq;`,
            );
            const legacy = await rows(b, "invoice_records");
            assert.equal(legacy.length, 1001);
            const received = [];
            let cursor = null;
            for (let page = 0; page < 5; page++) {
                const batch = await rows(b, "invoice_records", [false, 250, cursor?.created_at ?? null, cursor?.id ?? null]);
                assert.equal(batch.length, page === 4 ? 1 : 250);
                received.push(...batch);
                cursor = batch.at(-1);
            }
            assert.deepEqual(received, legacy);
            assert.deepEqual(
                await rows(b, "invoice_records", [false, 250, cursor.created_at, cursor.id]),
                [],
            );
            assert.equal((await rows(a, "invoice_records", [false, 250])).length, 1);
            assert.equal((await rows(admin, "invoice_records", [true, 250])).length, 250);
            await assert.rejects(rows(b, "invoice_records", [true, 250]), /required/i);
            for (const args of [
                [false, null],
                [false, 0],
                [false, 251],
                [false, 10, cursor.created_at, null],
                [false, 10, null, cursor.id],
            ]) {
                await assert.rejects(rows(b, "invoice_records", args), /Invalid invoice page/);
            }
        },
    );
    await check(
        "Commercial file references retain the exact original version while replacements remain independent",
        async () => {
            await assert.rejects(
                value(a, "rename_document", [invoiceFile.id, "Deleted.pdf", true]),
                /retained by a contract or invoice/,
            );
            await assert.rejects(
                value(a, "rename_document", [masterFile.id, "Deleted.pdf", true]),
                /retained by a contract or invoice/,
            );
            await assert.rejects(
                sql(
                    `update public.document_versions set sha256='${"2".repeat(64)}' where id='${invoiceFile.version}'`,
                ),
                /immutable/,
            );
            const newVersion = randomUUID(),
                newClient = randomUUID();
            await sql(
                `insert into public.document_versions(id,document_id,uploaded_by,client_id,version,object_path,original_name,mime_type,size_bytes,status) values('${newVersion}','${invoiceFile.id}','${a}','${newClient}',2,'replacement/${newVersion}','Replacement.pdf','application/pdf',100,'quarantined');update public.documents set current_version_id='${newVersion}',status='quarantined' where id='${invoiceFile.id}'`,
            );
            assert.equal(
                (await rows(a, "invoice_records"))[0].document_version_id,
                invoiceFile.version,
            );
        },
    );
    await check(
        "Rejected invoices release claims; restoring cannot double invoice claims already re-submitted elsewhere",
        async () => {
            const pdf = await file(a, "invoice");
            const args = [
                "AUD-001",
                `{${claimAud}}`,
                pdf.version,
                "2026-11-15",
                "2026-12-15",
                randomUUID(),
            ];
            const rejected = await value(a, "submit_invoice", args);
            await value(
                admin,
                "review_invoice",
                [rejected, "rejected", "Needs review"],
                "aal1",
            );
            assert.equal(
                (await rows(a, "finance_earnings")).find((r) => r.claim_id === claimAud)
                    .stage,
                "completed",
            );
            const another = await value(a, "submit_invoice", [
                "AUD-002",
                `{${claimAud}}`,
                pdf.version,
                "2026-11-15",
                "2026-12-15",
                randomUUID(),
            ]);
            assert.ok(another);
            await assert.rejects(
                value(
                    admin,
                    "review_invoice",
                    [rejected, "approved", "Cannot duplicate"],
                    "aal1",
                ),
                /duplicate key|unique/,
            );
        },
    );
    await check(
        "Two independent finance managers cannot race into duplicate full payments",
        async () => {
            const target = (await rows(a, "invoice_records")).find(
                (i) => i.number === "AUD-002",
            );
            await value(
                admin,
                "review_invoice",
                [target.id, "approved", "Ready"],
                "aal1",
            );
            const date = new Date(Date.now() - 1000).toISOString();
            const results = await Promise.allSettled([
                value(
                    admin,
                    "record_invoice_payment",
                    [target.id, 300, date, "A", randomUUID()],
                    "aal1",
                ),
                value(
                    admin2,
                    "record_invoice_payment",
                    [target.id, 300, date, "B", randomUUID()],
                    "aal1",
                ),
            ]);
            assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
            assert.equal(results.filter((r) => r.status === "rejected").length, 1);
            assert.equal(
                Number(
                    (await rows(a, "invoice_records")).find((i) => i.id === target.id)
                        .paid_amount,
                ),
                300,
            );
        },
    );
    await check(
        "Suspended and anonymous actors lose all personal commercial access immediately",
        async () => {
            await sql(`update public.profiles set active=false where id='${a}'`);
            await assert.rejects(rows(a, "contract_records"), /Active login/);
            await assert.rejects(rows(a, "invoice_records"), /required/i);
            assert.equal(await actor(a, "select count(*) from public.invoices"), "0");
            assert.equal(
                await actor(a, "select count(*) from public.contract_acceptances"),
                "0",
            );
            await assert.rejects(
                sql("set role anon;select public.finance_earnings(false)"),
                /permission denied/,
            );
        },
    );
    console.log(
        `\n${checks} commercial PostgreSQL checks passed (executed version receipts, invoice snapshots and payment races).`,
    );
} finally {
    await sql(`drop database if exists ${database} with(force)`, "postgres");
}
