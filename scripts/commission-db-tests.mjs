/** Commission/client isolation on a disposable real PostgreSQL database. */
import { spawn } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
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
    const child = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
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
    `begin;set local role authenticated;set local request.jwt.claims=${quote(JSON.stringify({ sub: id, aal, role: "authenticated" }))};${statement};commit;`,
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
const candidates = Array.from({ length: 10 }, () => randomUUID());
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
    "aal2",
  );
/** Read actual authorised consent while the offer is visible; never invent a
 * base or fallback token after another actor has filled it. */
const quoteOffer = async (who, job) => {
  const offer = JSON.parse(await value(who, "job_offers")).find(
    (row) => row.id === job,
  );
  assert.ok(offer, "A current authorised offer must supply its consent");
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
    version ?? (await quoteOffer(who, job)).terms_version,
  ]).then(JSON.parse);
let r, job, winner, accepted;
try {
  await sql(`create database ${database}`, "postgres");
  await sql(
    `create schema auth;create schema extensions;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;grant usage on schema auth to authenticated,anon,service_role;grant execute on all functions in schema auth to authenticated,anon,service_role;`,
  );
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
  await sql(
    `insert into auth.users(id) values ${[admin, owner, management, client, otherClient, lecturer, senior, ...candidates].map((id) => `('${id}')`).join(",")};insert into public.user_roles(user_id,role) values('${admin}','admin'),('${owner}','owner'),('${management}','management'),('${client}','client'),('${otherClient}','client'),('${lecturer}','lecturer'),('${senior}','senior_lecturer'),${candidates.map((id) => `('${id}','lecturer')`).join(",")};insert into public.organisations(id,name) values('${org}','Fictional customer A'),('${otherOrg}','Fictional customer B');update public.profiles set display_name='Fictional safe name';`,
  );
  await value(admin, "configure_compensation_policy", [31, 73, 0], "aal2");
  await check(
    "Owner inherits administrative capabilities while management/senior never receive private gross access",
    async () => {
      for (const who of [admin, owner]) {
        const permissions = JSON.parse(
          await actor(
            who,
            "select to_json(public.get_my_permissions())",
            "aal2",
          ),
        );
        assert.ok(permissions.includes("finance.gross.read"));
        assert.ok(permissions.includes("users.roles.manage"));
      }
      for (const who of [management, senior, lecturer])
        assert.equal(
          JSON.parse(await value(who, "commission_access", [], "aal2"))
            .can_manage_gross,
          false,
        );
      await assert.rejects(
        rows(management, "commission_report", [], "aal2"),
        /Gross finance permission/,
      );
      await assert.rejects(rows(admin, "commission_report"), /MFA required/);
    },
  );
  await check(
    "Client memberships are MFA-managed and freshly scoped by active role/organisation",
    async () => {
      await assert.rejects(
        value(
          management,
          "manage_client_organisation",
          [admin, org, false],
          "aal2",
        ),
        /membership management/,
      );
      await assert.rejects(
        value(admin, "manage_client_organisation", [client, org, false]),
        /MFA required/,
      );
      await value(
        admin,
        "manage_client_organisation",
        [client, org, false],
        "aal2",
      );
      await value(
        owner,
        "manage_client_organisation",
        [otherClient, otherOrg, false],
        "aal2",
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
        request(client, org, { ...body, gross_total_amount: 200 }, key),
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
        { ...payload(), amount: 999 },
        { ...payload(), status: "published" },
        { ...payload(), gross_amount: 100.001, gross_total_amount: 100.001 },
        { ...payload(), currency: "USD" },
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
    "Publication derives private role-specific net and residual-conserving rounding without readable public rates",
    async () => {
      job = await value(
        admin,
        "publish_client_request",
        [r, null, "Immutable net compensation", false, null],
        "aal2",
      );
      assert.equal(
        await value(
          admin,
          "publish_client_request",
          [r, null, "Immutable net compensation", false, null],
          "aal2",
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
      assert.equal(Number((await quoteOffer(lecturer, job)).total_amount), 31);
      assert.ok(
        !Object.keys(publicJob).some((k) =>
          /gross|commission|platform/.test(k),
        ),
      );
      const report = (await rows(owner, "commission_report", [], "aal2")).find(
        (x) => x.job_id === job,
      );
      assert.equal(Number(report.gross_total_amount), 100.01);
      assert.equal(Number(report.platform_total_amount), 69.01);
      assert.equal(Number(report.lecturer_net_total_amount), 31);
      for (const who of [client, otherClient, lecturer, senior, management])
        await assert.rejects(
          rows(who, "commission_report", [], "aal2"),
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
      await value(owner, "set_job_commission", [job, 120, 120, null], "aal2");
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
        value(admin, "set_job_commission", [job, 500, 500, null], "aal2"),
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
    "Concurrent instant claims create exactly one immutable revenue snapshot and complete allocation",
    async () => {
      const concurrentJob = await commissionJob(1, 300);
      // All actors review their actual quote before the first competing claim.
      // Later authorised-list reads may correctly omit the filled offer.
      const reviewedQuotes = await Promise.all(
        candidates.map((id) => quoteOffer(id, concurrentJob)),
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
      assert.equal((await claim(senior, aud)).status, "confirmed");
      const summary = await rows(client, "client_spend_summary");
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
        "aal2",
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
        "aal2",
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
        value(admin, "set_job_commission", [legacy, 750, 750, null], "aal2"),
        /Only unaccepted/,
      );
    },
  );
  await check(
    "Admin and owner can claim their own eligible offers and invoice net without an extra lecturer role",
    async () => {
      for (const [index, who] of [admin, owner].entries()) {
        assert.equal(
          JSON.parse(await value(who, "commercial_access")).can_submit_invoice,
          true,
        );
        const id = await commissionJob(4 + index, 400);
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
    "Invoice labels trim/deduplicate for owners and MFA finance operations without changing accepted amounts",
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
      await assert.rejects(
        value(management, "set_invoice_labels", [invoice.id, "{Finance}"]),
        /Invoice access/,
      );
      await value(
        management,
        "set_invoice_labels",
        [invoice.id, "{Finance}"],
        "aal2",
      );
      await assert.rejects(
        value(owner, "set_invoice_labels", [invoice.id, "{}"], undefined).then(
          () =>
            value(owner, "set_invoice_labels", [
              invoice.id,
              `{${Array.from({ length: 11 }, (_, i) => "L" + i).join(",")}}`,
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
    "Functional owner still needs qualification and executed contract prerequisites; private DM/calendar remain private",
    async () => {
      const topic = randomUUID();
      await sql(
        `insert into public.topics(id,label_de,label_en,kind) values('${topic}','Fictional ownership qualification','Fictional ownership qualification','topic');insert into public.lecturer_topics(user_id,topic_id) values('${owner}','${topic}')`,
      );
      const job = await commissionJob(8, 400, "EUR", admin, {
        topic_ids: [topic],
        requires_contract: true,
      });
      assert.equal((await claim(owner, job)).status, "not_eligible");
      await value(
        admin,
        "verify_lecturer_topic",
        [owner, topic, true, null],
        "aal2",
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
          new Date(Date.now() + 365 * 86400000).toISOString(),
          "master",
          null,
          randomUUID(),
        ],
        "aal2",
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
        rows(owner, "chat_messages", [dm], "aal2"),
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
          "aal2",
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
        "aal2",
      );
      assert.equal(
        await value(
          owner,
          "create_commission_job",
          [null, JSON.stringify(body), null, key],
          "aal2",
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
        await rows(owner, "client_spend_summary", [], "aal2")
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
          [null, JSON.stringify({ ...body, status: "published" }), null, key],
          "aal2",
        ),
        /idempotency conflict/,
      );
      await value(owner, "set_job_status", [id, "published"], "aal2");
      summary = (await rows(owner, "client_spend_summary", [], "aal2")).find(
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
    "Membership removal, role removal and suspension revoke existing-token client/gross access",
    async () => {
      await value(
        admin,
        "manage_client_organisation",
        [client, org, true],
        "aal2",
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
        "aal2",
      );
      await sql(
        `delete from public.user_roles where user_id='${client}' and role='client'`,
      );
      assert.deepEqual(await rows(client, "client_requests"), []);
      await sql(`update public.profiles set active=false where id='${owner}'`);
      await assert.rejects(
        rows(owner, "commission_report", [], "aal2"),
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
