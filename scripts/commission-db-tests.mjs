/** Commission/client isolation on a disposable real PostgreSQL database. */
import {spawn} from "node:child_process";
import {readdir, readFile} from "node:fs/promises";
import {randomUUID} from "node:crypto";
import assert from "node:assert/strict";
import {withMigrationReplayLock} from "./testing/database.mjs";
import {rpcResponse} from "./testing/openapi-contract.mjs";

const parseCommissionAccess = rpcResponse("commission_access");
const parseCommercialAccess = rpcResponse("commercial_access");
const parseOfferPolicy = rpcResponse("commission_offer_policy");
const parseSpend = rpcResponse("client_spend_summary");

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
const database = `commission_test_${randomUUID().replaceAll("-", "")}`;

/** Starts the test program with explicit arguments and preserves its failure status. */
function command(args, input = "") {
    return new Promise((resolve, reject) => {
        const child = spawn("docker", args, {stdio: ["pipe", "pipe", "pipe"]});
        let out = "",
            err = "";
        child.stdout.on("data", (d) => (out += d));
        child.stderr.on("data", (d) => (err += d));
        child.on("error", reject);
        child.on("close", (code) =>
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
    );
/** Aggregates public RPC rows into JSON under the checked caller identity. */
const rows = (id, fn, args = [], aal) =>
    actor(
        id,
        `select coalesce(json_agg(x),'[]') from public.${fn}(${args.map((x) => (x === null ? "null" : typeof x === "number" || typeof x === "boolean" ? String(x) : quote(x))).join(",")}) x`,
        aal,
    ).then(JSON.parse);
const admin = randomUUID(),
    owner = randomUUID(),
    management = randomUUID(),
    client = randomUUID(),
    otherClient = randomUUID(),
    lecturer = randomUUID(),
    senior = randomUUID(),
    org = randomUUID(),
    otherOrg = randomUUID();
const candidates = Array.from({length: 10}, () => randomUUID());
let checks = 0;
/** Counts and reports a case only after all of its assertions have completed successfully. */
const check = async (name, fn) => {
    await fn();
    checks++;
    console.log(`PASS ${name}`);
};
/** Creates this module's fictional inputs; authoritative validation remains on the server. */
const payload = (day = 0, gross = 100.01, currency = "EUR") => ({
    title: `Fictional commissioned course ${day}`,
    description: "Safe authored course text",
    delivery_type: "online",
    location: "",
    time_zone: "Europe/Berlin",
    gross_amount: gross,
    gross_total_amount: gross,
    currency,
    rate_unit: "fixed_total",
    sessions: [
        {
            starts_at: new Date(Date.now() + (90 + day) * 86400000).toISOString(),
            ends_at: new Date(
                Date.now() + (90 + day) * 86400000 + 3600000,
            ).toISOString(),
        },
    ],
    topic_ids: [],
});
/** Sends the actual test request as the selected identity; its response is asserted separately. */
const request = (who, organisation, body, key = randomUUID()) =>
    value(who, "create_client_request", [
        organisation,
        JSON.stringify(body),
        key,
    ]);
/** Creates the commission-backed job through its business RPC; the server calculates the actual net share. */
const commissionJob = (
    day,
    gross = 100.01,
    currency = "EUR",
    who = admin,
    extra = {},
) =>
    value(
        who,
        "create_commission_job",
        [
            org,
            JSON.stringify({
                ...payload(day, gross, currency),
                terms: "Immutable net compensation",
                requires_contract: false,
                ...extra,
            }),
            null,
            randomUUID(),
        ],
        "aal1",
    );
/** Read the actual actor-visible offer; a filled offer may legitimately be absent. */
const quoteOffer = (who, job) =>
    value(who, "job_offers")
        .then(JSON.parse)
        .then((rows) => rows.find((row) => row.id === job));
/** Capture validated actor-specific consent before claims race; never invent a fallback token. */
const reviewedOffer = async (who, job) => {
    const offer = await quoteOffer(who, job);
    assert.ok(offer, "A current authorised offer must supply its consent");
    assert.equal(offer.id, job);
    assert.ok(
        Number.isSafeInteger(offer.terms_version) && offer.terms_version > 0,
        "A visible offer must supply a positive integer consent version",
    );
    return offer;
};
/** Calls the actual claim RPC; only the database result confirms whole-block allocation. */
const claim = async (who, job, version) =>
    value(who, "claim_job", [
        job,
        randomUUID(),
        version ?? (await reviewedOffer(who, job)).terms_version,
    ]).then(JSON.parse);
let r, job, winner, accepted;
try {
    await sql(`create database ${database}`, "postgres");
    await sql(
        `create schema auth;create schema extensions;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz default now(),created_at timestamptz default clock_timestamp());create function auth.uid() returns uuid language sql stable as $$select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;grant usage on schema auth to authenticated,anon,service_role;grant execute on all functions in schema auth to authenticated,anon,service_role;`,
    );
    await withMigrationReplayLock(container, async () => {
        for (const file of (
            await readdir(new URL("../supabase/migrations/", import.meta.url))
        )
            .filter((f) => f.endsWith(".sql"))
            .sort())
            await sql(
                await readFile(
                    new URL(`../supabase/migrations/${file}`, import.meta.url),
                    "utf8",
                ),
            );
    });
    await sql(
        `insert into auth.users(id) values ${[admin, owner, management, client, otherClient, lecturer, senior, ...candidates].map((id) => `('${id}')`).join(",")};insert into public.user_roles(user_id,role) values('${admin}','admin'),('${owner}','owner'),('${management}','management'),('${client}','client'),('${otherClient}','client'),('${lecturer}','lecturer'),('${senior}','senior_lecturer'),${candidates.map((id) => `('${id}','lecturer')`).join(",")};insert into public.organisations(id,name) values('${org}','Fictional customer A'),('${otherOrg}','Fictional customer B');update public.profiles set display_name='Fictional safe name';`,
    );
    assert.deepEqual(parseCommissionAccess(await value(admin, "commission_access")), {
        can_manage_gross: true,
        can_manage_client_memberships: true,
        can_request: true,
        policy_configured: false,
        regular_lecturer_percent: null,
        senior_lecturer_percent: null,
        policy_version: 0,
    });
    assert.equal(
        parseOfferPolicy(await actor(admin, `select coalesce(public.commission_offer_policy(${quote(randomUUID())}), 'null'::jsonb)`)),
        null,
    );
    await value(admin, "configure_compensation_policy", [31, 73, 0], "aal1");
    await check(
        "Owner inherits administrative capabilities while management/senior never receive private gross access",
        async () => {
            for (const who of [admin, owner]) {
                const permissions = JSON.parse(
                    await actor(
                        who,
                        "select to_json(public.get_my_permissions())",
                        "aal1",
                    ),
                );
                assert.ok(permissions.includes("finance.gross.read"));
                assert.ok(permissions.includes("users.roles.manage"));
                const access = parseCommissionAccess(await value(who, "commission_access"));
                assert.equal(access.policy_configured, true);
                assert.equal(access.regular_lecturer_percent, 31);
                assert.equal(access.senior_lecturer_percent, 73);
            }
            for (const who of [management, senior, lecturer])
                assert.equal(
                    parseCommissionAccess(await value(who, "commission_access", [], "aal1"))
                        .can_manage_gross,
                    false,
                );
            await assert.rejects(
                rows(management, "commission_report", [], "aal1"),
                /Gross finance permission/,
            );
        },
    );
    await check(
        "Client memberships are permission-managed and freshly scoped by active role/organisation",
        async () => {
            await assert.rejects(
                value(
                    management,
                    "manage_client_organisation",
                    [admin, org, false],
                    "aal1",
                ),
                /Only subordinate client memberships/,
            );
            await value(
                admin,
                "manage_client_organisation",
                [client, org, false],
                "aal1",
            );
            await value(
                owner,
                "manage_client_organisation",
                [otherClient, otherOrg, false],
                "aal1",
            );
            assert.deepEqual(
                (await rows(client, "client_organisations")).map((x) => x.id),
                [org],
            );
            assert.deepEqual(
                (await rows(otherClient, "client_organisations")).map((x) => x.id),
                [otherOrg],
            );
            assert.deepEqual(await rows(lecturer, "client_organisations"), []);
            await assert.rejects(
                actor(
                    client,
                    `insert into public.client_organisation_memberships(user_id,organisation_id) values('${client}','${otherOrg}')`,
                ),
                /permission denied/,
            );
        },
    );
    await check(
        "Clients submit only own-org gross course requests, retries persist once and no public job exists before publication",
        async () => {
            const body = payload(),
                key = randomUUID();
            r = await request(client, org, body, key);
            assert.equal(await request(client, org, body, key), r);
            assert.equal((await rows(client, "client_requests")).length, 1);
            assert.deepEqual(await rows(otherClient, "client_requests", [org]), []);
            await assert.rejects(
                request(client, otherOrg, body),
                /Organisation access required/,
            );
            await assert.rejects(
                request(client, org, {...body, gross_total_amount: 200}, key),
                /Invalid original-currency fee|idempotency conflict/,
            );
            assert.equal(
                await actor(client, "select count(*) from public.jobs"),
                "0",
            );
            await assert.rejects(
                value(client, "publish_client_request", [
                    r,
                    null,
                    "Terms",
                    false,
                    null,
                ]),
                /Gross finance permission/,
            );
        },
    );
    await check(
        "Request validators reject hidden commercial/status fields, fractional cents, mixed currency and overlapping sessions",
        async () => {
            for (const invalid of [
                {...payload(), amount: 999},
                {...payload(), status: "published"},
                {...payload(), gross_amount: 100.001, gross_total_amount: 100.001},
                {...payload(), currency: "GBP"},
                {
                    ...payload(),
                    sessions: [payload().sessions[0], payload().sessions[0]],
                },
            ])
                await assert.rejects(
                    request(client, org, invalid),
                    /Unsupported|Invalid|Overlapping/,
                );
        },
    );
    await check(
        "Publication applies the fixture’s private 31 percent rate and residual-conserving rounding without readable public rates",
        async () => {
            job = await value(
                admin,
                "publish_client_request",
                [r, null, "Immutable net compensation", false, null],
                "aal1",
            );
            assert.equal(
                await value(
                    admin,
                    "publish_client_request",
                    [r, null, "Immutable net compensation", false, null],
                    "aal1",
                ),
                job,
            );
            const publicJob = JSON.parse(
                await actor(
                    lecturer,
                    `select row_to_json(j) from public.jobs j where id='${job}'`,
                ),
            );
            assert.equal(Number(publicJob.amount), 0);
            assert.equal(Number(publicJob.total_amount), 0);
            assert.equal(
                Number((await quoteOffer(lecturer, job)).total_amount),
                31,
            );
            assert.ok(
                !Object.keys(publicJob).some((k) =>
                    /gross|commission|platform/.test(k),
                ),
            );
            const report = (await rows(owner, "commission_report", [], "aal1")).find(
                (x) => x.job_id === job,
            );
            assert.equal(Number(report.gross_total_amount), 100.01);
            assert.equal(Number(report.platform_total_amount), 69.01);
            assert.equal(Number(report.lecturer_net_total_amount), 31);
            for (const who of [client, otherClient, lecturer, senior, management])
                await assert.rejects(
                    rows(who, "commission_report", [], "aal1"),
                    /Gross finance permission/,
                );
            await assert.rejects(
                actor(lecturer, "select * from private.job_commission_offers"),
                /permission denied/,
            );
            assert.equal(
                await actor(
                    client,
                    `select count(*) from public.jobs where id='${job}'`,
                ),
                "0",
            );
        },
    );
    await check(
        "Commission changes before acceptance require fresh terms and clients see final own-org gross only",
        async () => {
            await value(owner, "set_job_commission", [job, 120, 120, null], "aal1");
            assert.equal((await claim(lecturer, job, 2)).status, "terms_changed");
            assert.equal(
                Number((await rows(client, "client_requests"))[0].gross_total_amount),
                120,
            );
            const result = await claim(lecturer, job);
            assert.equal(result.status, "confirmed");
            accepted = result.claim_id;
            assert.equal(
                await sql(
                    `select total_amount from public.job_claims where id='${accepted}'`,
                ),
                "37.20",
            );
            await assert.rejects(
                value(admin, "set_job_commission", [job, 500, 500, null], "aal1"),
                /Only unaccepted/,
            );
            await assert.rejects(
                sql(
                    `update private.claim_revenue_ledger set gross_total_amount=999 where claim_id='${accepted}'`,
                ),
                /immutable/,
            );
        },
    );
    await check(
        "Filled offers disappear for late readers while captured consent preserves accepted snapshots",
        async () => {
            const sessions = [...payload(30).sessions, ...payload(31).sessions];
            const filledJob = await commissionJob(30, 300, "EUR", admin, {
                sessions,
            });
            const [first, late] = candidates;
            const [firstOffer, lateOffer] = await Promise.all([
                reviewedOffer(first, filledJob),
                reviewedOffer(late, filledJob),
            ]);
            const confirmed = await claim(first, filledJob, firstOffer.terms_version);
            assert.equal(confirmed.status, "confirmed");
            assert.equal(await quoteOffer(late, filledJob), undefined);
            const snapshot = async () =>
                JSON.parse(
                    await sql(`select jsonb_build_object(
            'job',(select to_jsonb(j) from public.jobs j where j.id=${quote(filledJob)}),
            'claims',(select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]'::jsonb) from public.job_claims c where c.job_id=${quote(filledJob)}),
            'revenue',(select coalesce(jsonb_agg(to_jsonb(r) order by r.claim_id),'[]'::jsonb) from private.claim_revenue_ledger r where r.job_id=${quote(filledJob)}),
            'allocations',(select coalesce(jsonb_agg(to_jsonb(a) order by a.id),'[]'::jsonb) from public.assignment_sessions a join public.job_claims c on c.id=a.claim_id where c.job_id=${quote(filledJob)})
          )::text`),
                );
            const before = await snapshot();
            assert.equal(before.job.status, "filled");
            assert.equal(before.claims.length, 1);
            assert.equal(before.claims[0].id, confirmed.claim_id);
            assert.equal(before.claims[0].lecturer_id, first);
            assert.equal(Number(before.claims[0].total_amount), 93);
            assert.equal(before.claims[0].terms, "Immutable net compensation");
            assert.equal(before.revenue.length, 1);
            assert.equal(Number(before.revenue[0].gross_total_amount), 300);
            assert.equal(Number(before.revenue[0].lecturer_net_total_amount), 93);
            assert.equal(Number(before.revenue[0].platform_total_amount), 207);
            assert.equal(before.revenue[0].currency, "EUR");
            assert.equal(before.allocations.length, sessions.length);
            assert.equal(
                await sql(`select count(*) from (
          select starts_at,ends_at from public.job_sessions where job_id=${quote(filledJob)}
          except all
          select a.starts_at,a.ends_at from public.assignment_sessions a join public.job_claims c on c.id=a.claim_id where c.job_id=${quote(filledJob)}
        ) missing`),
                "0",
            );
            assert.equal(
                (await claim(late, filledJob, lateOffer.terms_version)).status,
                "filled",
            );
            assert.deepEqual(await snapshot(), before);
            assert.equal(await quoteOffer(late, filledJob), undefined);
        },
    );
    await check(
        "Concurrent instant claims create exactly one immutable revenue snapshot and complete allocation",
        async () => {
            const concurrentJob = await commissionJob(1, 300);
            // Every actor captures its actual validated quote before the first claim;
            // later discovery reads may legitimately omit the already filled offer.
            const reviewedQuotes = await Promise.all(
                candidates.map((id) => reviewedOffer(id, concurrentJob)),
            );
            const results = await Promise.all(
                candidates.map((id, index) =>
                    claim(id, concurrentJob, reviewedQuotes[index].terms_version),
                ),
            );
            assert.equal(results.filter((x) => x.status === "confirmed").length, 1);
            assert.equal(results.filter((x) => x.status === "filled").length, 9);
            winner = candidates[results.findIndex((x) => x.status === "confirmed")];
            // Deterministically reproduce a late losing reader after the race: the
            // offer disappears, but its previously reviewed token still reaches the
            // real claim RPC and produces filled without another accepted snapshot.
            const losingIndex = results.findIndex(
                (result) => result.status === "filled",
            );
            const loser = candidates[losingIndex];
            assert.equal(
                JSON.parse(await value(loser, "job_offers")).some(
                    (offer) => offer.id === concurrentJob,
                ),
                false,
                "A losing actor no longer sees the filled offer in a later list read",
            );
            assert.equal(
                (
                    await claim(
                        loser,
                        concurrentJob,
                        reviewedQuotes[losingIndex].terms_version,
                    )
                ).status,
                "filled",
                "Previously reviewed consent reaches the server after visibility changes",
            );
            assert.equal(
                await sql(
                    `select count(*) from private.claim_revenue_ledger where job_id='${concurrentJob}'`,
                ),
                "1",
            );
            assert.equal(
                await sql(
                    `select count(*) from public.assignment_sessions a join public.job_claims c on c.id=a.claim_id where c.job_id='${concurrentJob}'`,
                ),
                "1",
            );
            const conflicting = await commissionJob(1, 300);
            assert.equal((await claim(winner, conflicting)).status, "conflict");
            assert.equal(
                await sql(
                    `select count(*) from private.claim_revenue_ledger where job_id='${conflicting}'`,
                ),
                "0",
            );
        },
    );
    await check(
        "Spend and assigned-teacher summaries keep original currencies and cross-organisation privacy",
        async () => {
            const aud = await commissionJob(2, 200, "AUD");
            assert.deepEqual(parseOfferPolicy(await value(admin, "commission_offer_policy", [aud])), {
                regular_lecturer_percent: 31,
                senior_lecturer_percent: 73,
                policy_version: 1,
            });
            await assert.rejects(value(client, "commission_offer_policy", [aud]), /Gross finance permission/);
            assert.equal((await claim(senior, aud)).status, "confirmed");
            const summary = parseSpend(JSON.stringify(await rows(client, "client_spend_summary")));
            assert.deepEqual(
                new Set(summary.map((x) => x.currency)),
                new Set(["EUR", "AUD"]),
            );
            assert.ok(summary.every((x) => x.organisation_id === org));
            assert.ok(
                summary
                    .find((x) => x.currency === "EUR")
                    .teachers.some((x) => x.id === lecturer),
            );
            assert.deepEqual(await rows(otherClient, "client_spend_summary"), []);
            const json = await actor(
                management,
                "select coalesce(json_agg(x),'[]') from public.audit_events x",
                "aal1",
            );
            assert.ok(
                !/gross_amount|gross_total_amount|platform_percent|platform_total/.test(
                    json,
                ),
            );
        },
    );
    await check(
        "Legacy net jobs and accepted snapshots receive no fabricated commission or retroactive repricing",
        async () => {
            const legacy = await value(
                admin,
                "create_job",
                [
                    JSON.stringify({
                        ...payload(3),
                        amount: 375,
                        total_amount: 375,
                        customer_name: "Legacy net customer",
                        terms: "Legacy net terms",
                        status: "published",
                    }),
                ],
                "aal1",
            );
            const result = await claim(lecturer, legacy, 1);
            assert.equal(result.status, "confirmed");
            assert.equal(
                await sql(
                    `select total_amount from public.job_claims where id='${result.claim_id}'`,
                ),
                "375.00",
            );
            assert.equal(
                await sql(
                    `select count(*) from private.claim_revenue_ledger where claim_id='${result.claim_id}'`,
                ),
                "0",
            );
            await assert.rejects(
                value(admin, "set_job_commission", [legacy, 750, 750, null], "aal1"),
                /Only unaccepted/,
            );
        },
    );
    await check(
        "Admin and owner can claim eligible offers and invoice their net after an explicit lecturer grant",
        async () => {
            for (const [index, who] of [admin, owner].entries()) {
                const id = await commissionJob(4 + index, 400);
                assert.equal(
                    parseCommercialAccess(await value(who, "commercial_access")).can_submit_invoice,
                    false,
                );
                assert.equal((await claim(who, id)).status, "not_eligible");
                await sql(`insert into public.user_roles(user_id,role) values (${quote(who)},'lecturer')`);
                assert.equal(
                    parseCommercialAccess(await value(who, "commercial_access")).can_submit_invoice,
                    true,
                );
                const result = await claim(who, id);
                assert.equal(result.status, "confirmed");
                assert.ok(
                    (await rows(who, "finance_earnings")).some(
                        (x) => x.job_id === id && Number(x.total_amount) === 124,
                    ),
                );
                const doc = randomUUID(),
                    version = randomUUID(),
                    key = randomUUID();
                await sql(
                    `insert into public.documents(id,owner_id,uploaded_by,scope,kind,original_name,mime_type,size_bytes,status,client_id) values('${doc}','${who}','${who}','personal','invoice','Invoice.pdf','application/pdf',100,'clean','${key}');insert into public.document_versions(id,document_id,uploaded_by,client_id,version,object_path,original_name,mime_type,size_bytes,status,sha256) values('${version}','${doc}','${who}','${key}',1,'${who}/${version}','Invoice.pdf','application/pdf',100,'clean','${"1".repeat(64)}');update public.documents set current_version_id='${version}' where id='${doc}'`,
                );
                await sql(`update public.assignment_sessions set starts_at=now()-interval '2 days',
                    ends_at=now()-interval '1 day' where claim_id='${result.claim_id}'`);
                const invoice = await value(who, "submit_invoice", [
                    `OWN-NET-${index}`,
                    `{${result.claim_id}}`,
                    version,
                    "2026-11-16",
                    "2026-12-16",
                    randomUUID(),
                ]);
                assert.equal(
                    Number(
                        (await rows(who, "invoice_records")).find((x) => x.id === invoice)
                            .total_amount,
                    ),
                    124,
                );
            }
            assert.equal(
                JSON.parse(await value(management, "commercial_access"))
                    .can_submit_invoice,
                false,
            );
        },
    );
    await check(
        "Invoice labels trim/deduplicate for owners and permission finance operations without changing accepted amounts",
        async () => {
            const invoice = (await rows(owner, "invoice_records"))[0];
            await value(owner, "set_invoice_labels", [
                invoice.id,
                "{ Teaching ,Teaching,Reviewed}",
            ]);
            assert.deepEqual((await rows(owner, "invoice_records"))[0].labels, [
                "Reviewed",
                "Teaching",
            ]);
            await assert.rejects(
                value(senior, "set_invoice_labels", [invoice.id, "{Foreign}"]),
                /Invoice access/,
            );
            await value(
                management,
                "set_invoice_labels",
                [invoice.id, "{Finance}"],
                "aal1",
            );
            await assert.rejects(
                value(owner, "set_invoice_labels", [invoice.id, "{}"], undefined).then(
                    () =>
                        value(owner, "set_invoice_labels", [
                            invoice.id,
                            `{${Array.from({length: 11}, (_, i) => "L" + i).join(",")}}`,
                        ]),
                ),
                /ten labels/,
            );
            await assert.rejects(
                value(owner, "set_invoice_labels", [invoice.id, '{""}']),
                /ten labels/,
            );
            assert.equal(
                Number((await rows(owner, "invoice_records"))[0].total_amount),
                124,
            );
            await assert.rejects(
                actor(
                    owner,
                    `update public.invoices set labels='{Forged}' where id='${invoice.id}'`,
                ),
                /permission denied/,
            );
        },
    );
    await check(
        "Functional owner still needs declared expertise and executed contract prerequisites; private DM/calendar remain private",
        async () => {
            const topic = randomUUID();
            await sql(
                `insert into public.topics(id,label_de,label_en,kind) values('${topic}','Fictional ownership qualification','Fictional ownership qualification','topic');insert into public.lecturer_topics(user_id,topic_id) values('${owner}','${topic}')`,
            );
            const job = await commissionJob(8, 400, "EUR", admin, {
                topic_ids: [topic],
                requires_contract: true,
            });
            assert.equal((await claim(owner, job)).status, "prerequisite_missing");
            await value(
                admin,
                "verify_lecturer_topic",
                [owner, topic, true, null],
                "aal1",
            );
            assert.equal((await claim(owner, job)).status, "prerequisite_missing");
            const doc = randomUUID(),
                version = randomUUID(),
                key = randomUUID(),
                hash = "2".repeat(64);
            await sql(
                `insert into public.documents(id,owner_id,uploaded_by,scope,kind,original_name,mime_type,size_bytes,status,client_id) values('${doc}','${owner}','${admin}','personal','contract','Executed.pdf','application/pdf',100,'clean','${key}');insert into public.document_versions(id,document_id,uploaded_by,client_id,version,object_path,original_name,mime_type,size_bytes,status,sha256) values('${version}','${doc}','${admin}','${key}',1,'${owner}/${version}','Executed.pdf','application/pdf',100,'clean','${hash}');update public.documents set current_version_id='${version}' where id='${doc}'`,
            );
            await value(
                admin,
                "register_executed_contract",
                [
                    owner,
                    "Executed owner agreement",
                    version,
                    new Date(Date.now() - 86400000).toISOString(),
                    null,
                    "master",
                    null,
                    randomUUID(),
                ],
                "aal1",
            );
            assert.equal((await claim(owner, job)).status, "confirmed");
            const dm = await value(lecturer, "create_dm", [senior]);
            await value(lecturer, "send_message", [
                dm,
                "Private peers",
                randomUUID(),
                null,
            ]);
            await assert.rejects(
                rows(owner, "chat_messages", [dm], "aal1"),
                /access denied/,
            );
            const event = await actor(
                lecturer,
                `insert into public.personal_events(user_id,title,starts_at,ends_at) values('${lecturer}','Private peer event','2047-01-01T08:00:00Z','2047-01-01T09:00:00Z') returning id`,
            );
            assert.equal(
                await actor(
                    owner,
                    `select count(*) from public.personal_events where id='${event}'`,
                    "aal1",
                ),
                "0",
            );
        },
    );
    await check(
        "Admin atomic gross creation preserves draft/status and operation retry identity",
        async () => {
            const body = {
                    ...payload(6, 222),
                    customer_name: "New fictional inline customer",
                    status: "draft",
                    terms: "Draft net terms",
                    requires_contract: false,
                },
                key = randomUUID();
            const id = await value(
                owner,
                "create_commission_job",
                [null, JSON.stringify(body), null, key],
                "aal1",
            );
            assert.equal(
                await value(
                    owner,
                    "create_commission_job",
                    [null, JSON.stringify(body), null, key],
                    "aal1",
                ),
                id,
            );
            assert.equal(
                await sql(`select status from public.jobs where id='${id}'`),
                "draft",
            );
            const draftOrg = await sql(
                `select organisation_id from public.course_runs where id=(select course_run_id from public.jobs where id='${id}')`,
            );
            let summary = (
                await rows(owner, "client_spend_summary", [], "aal1")
            ).find((row) => row.organisation_id === draftOrg);
            assert.equal(Number(summary.request_count), 1);
            assert.equal(
                Number(summary.published_count),
                0,
                "A converted draft is not a published offer",
            );
            assert.equal(Number(summary.assigned_count), 0);
            assert.equal(
                await actor(
                    lecturer,
                    `select count(*) from public.jobs where id='${id}'`,
                ),
                "0",
            );
            await assert.rejects(
                value(
                    owner,
                    "create_commission_job",
                    [null, JSON.stringify({...body, status: "published"}), null, key],
                    "aal1",
                ),
                /idempotency conflict/,
            );
            await value(owner, "set_job_status", [id, "published"], "aal1");
            summary = (await rows(owner, "client_spend_summary", [], "aal1")).find(
                (row) => row.organisation_id === draftOrg,
            );
            assert.equal(
                Number(summary.published_count),
                1,
                "Only actual publication changes the published counter",
            );
        },
    );
    await check(
        "Client requests and individual compensation preserve CHF",
        async () => {
            const submitted = await request(client, org, payload(48, 123.45, "CHF"));
            assert.equal(
                (await rows(client, "client_requests")).find((row) => row.id === submitted)?.currency,
                "CHF",
            );
            await value(admin, "save_lecturer_compensation", [
                lecturer, "daily", 50, 123.45, "CHF", 1,
            ]);
            const compensation = JSON.parse(await value(admin, "lecturer_compensation", [lecturer]));
            assert.equal(compensation.currency, "CHF");
        },
    );
    await check(
        "Membership removal, role removal and suspension revoke existing-token client/gross access",
        async () => {
            await value(
                admin,
                "manage_client_organisation",
                [client, org, true],
                "aal1",
            );
            assert.deepEqual(await rows(client, "client_requests"), []);
            assert.deepEqual(await rows(client, "client_spend_summary"), []);
            await assert.rejects(
                request(client, org, payload(9)),
                /Organisation access required/,
            );
            await value(
                admin,
                "manage_client_organisation",
                [client, org, false],
                "aal1",
            );
            await sql(
                `delete from public.user_roles where user_id='${client}' and role='client'`,
            );
            assert.deepEqual(await rows(client, "client_requests"), []);
            await sql(`update public.profiles set active=false where id='${owner}'`);
            await assert.rejects(
                rows(owner, "commission_report", [], "aal1"),
                /Gross finance permission/,
            );
            await assert.rejects(
                sql("set role anon;select public.client_requests()"),
                /permission denied/,
            );
        },
    );
    console.log(
        `\n${checks} commission PostgreSQL checks passed (private gross, client scope, immutable net/revenue and role/concurrency regressions).`,
    );
} finally {
    await sql(`drop database if exists ${database} with(force)`, "postgres");
}
