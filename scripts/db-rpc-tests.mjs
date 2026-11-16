/** Real PostgreSQL security/transaction tests in a disposable database inside the LOCAL stack.
 * Uses real RLS roles and auth.uid()/jwt() compatible test stubs, not Auth HTTP token validation.
 * No production connection or database URL is accepted. No dependency beyond Node + Docker.
 */
import { spawn } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
const container =
  process.env.PORTAL_DB_CONTAINER ?? "supabase_db_luminovia-portal";
if (!/^supabase_db_luminovia-portal(?:-test-[a-f0-9]+|-test)?$/.test(container))
  throw new Error(
    "Only this project or its isolated test container is allowed.",
  );
const database = `portal_test_${randomUUID().replaceAll("-", "")}`;
/** Starts the test program with explicit arguments and preserves its failure status. */
function command(args, input = "") {
  return new Promise((resolve, reject) => {
    const p = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
    let out = "",
      err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("exit", (code) =>
      code === 0 ? resolve(out.trim()) : reject(new Error(err || out)),
    );
    p.stdin.end(input);
  });
}
/** Sends SQL to the owned test database and makes every psql error fail the run. */
const sql = (text, db = database) =>
  command(
    [
      "exec",
      "-i",
      container,
      "psql",
      "-U",
      "postgres",
      "-d",
      db,
      "-X",
      "-qAt",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    text,
  );
/** Quotes controlled fixture SQL literals; identifiers have separate validation. */
const quote = (s) => `'${String(s).replaceAll("'", "''")}'`;
/** Sets the role and JWT claims inside the test transaction for one specific caller. */
function actorSql(id, text, aal = "aal1") {
  return `begin; set local role authenticated; set local request.jwt.claims=${quote(JSON.stringify({ sub: id, aal, role: "authenticated" }))}; ${text}; commit;`;
}
/** Executes real SQL with the test transaction's controlled identity and MFA claims. */
const as = (id, text, aal) => sql(actorSql(id, text, aal));
/** Calls the business database API under the fixture's controlled identity/MFA claims. */
const rpc = (id, job, key = randomUUID(), version = 1) =>
  as(id, `select public.claim_job('${job}','${key}',${version})`).then(
    JSON.parse,
  );
let checks = 0;
/** Runs a named assertion group; any failed assertion must stop the run. */
const test = async (name, fn) => {
  await fn();
  checks++;
  console.log(`PASS ${name}`);
};
const users = Array.from({ length: 55 }, () => randomUUID());
const admin = randomUUID(),
  participant = randomUUID(),
  topic = randomUUID();
const start = new Date(Date.now() + 60 * 86400000);
start.setUTCHours(8, 0, 0, 0);
const sessions = Array.from({ length: 5 }, (_, i) => ({
  starts_at: new Date(+start + i * 86400000).toISOString(),
  ends_at: new Date(+start + i * 86400000 + 6 * 3600000).toISOString(),
}));
/** Creates a complete fictional multi-day job for targeted positive and negative variants. */
const jobPayload = (overrides = {}) => ({
  title: "Fictional five-day test course",
  description: "Database isolation test only",
  customer_name: "Fictional Test Customer",
  delivery_type: "online",
  location: "",
  time_zone: "Europe/Berlin",
  status: "published",
  amount: 500,
  currency: "EUR",
  rate_unit: "per_day",
  total_amount: 2500,
  terms: "Test terms v1",
  requires_contract: false,
  sessions,
  topic_ids: [],
  ...overrides,
});
/** Creates a fictional job with controlled sessions and terms for the following assertions. */
async function job(overrides = {}) {
  return as(
    admin,
    `select public.create_job(${quote(JSON.stringify(jobPayload(overrides)))}::jsonb)`,
    "aal2",
  );
}
try {
  await sql(`create database ${database}`, "postgres");
  await sql(`create schema auth; create schema extensions;
 create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$ select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;`);
  await sql(
    `create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$; grant usage on schema auth to authenticated,anon,service_role; grant execute on all functions in schema auth to authenticated,anon,service_role;`,
  );
  for (const file of (
    await readdir(new URL("../supabase/migrations/", import.meta.url))
  )
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await sql(
      await readFile(
        new URL("../supabase/migrations/" + file, import.meta.url),
        "utf8",
      ),
    );
  await sql(`insert into auth.users(id) values ${[...users, admin, participant].map((x) => `('${x}')`).join(",")};
 insert into public.user_roles(user_id,role) values ${users.map((x) => `('${x}','lecturer')`).join(",")},('${admin}','admin'),('${participant}','participant');
 insert into public.topics(id,label_de,label_en,kind) values('${topic}','Testkompetenz','Test skill','topic');
 insert into public.lecturer_topics(user_id,topic_id,verified) values ${users
   .slice(0, 50)
   .map((x) => `('${x}','${topic}',true)`)
   .join(",")};`);
  const target = await job({ topic_ids: [topic] });
  const keys = users.slice(0, 50).map(() => randomUUID());
  let results;
  await test("50 parallel eligible claimants: exactly one winner, 49 filled", async () => {
    results = await Promise.all(
      users.slice(0, 50).map((id, i) => rpc(id, target, keys[i])),
    );
    assert.equal(results.filter((r) => r.status === "confirmed").length, 1);
    assert.equal(results.filter((r) => r.status === "filled").length, 49);
  });
  const wi = results.findIndex((r) => r.status === "confirmed"),
    winner = users[wi],
    claim = results[wi].claim_id;
  await test("All five allocations + exactly one notification, audit and membership commit together", async () => {
    const result = JSON.parse(
      await sql(
        `select json_build_array((select count(*) from public.assignment_sessions where claim_id='${claim}'),(select count(*) from public.job_claims where job_id='${target}'),(select count(*) from public.notifications where resource_id='${claim}'),(select count(*) from public.claim_events where claim_id='${claim}'),(select count(*) from public.chat_members m join public.chat_rooms r on r.id=m.room_id where r.job_id='${target}'))`,
      ),
    );
    assert.deepEqual(result, [5, 1, 1, 1, 1]);
  });
  await test("Winner retry is idempotent; no repeated notifications", async () => {
    assert.deepEqual(await rpc(winner, target, keys[wi]), results[wi]);
    assert.equal(
      await sql(
        `select count(*) from public.notifications where resource_id='${claim}'`,
      ),
      "1",
    );
  });
  const overlap = await job();
  await test("Confirmed multi-day allocation blocks second overlapping job without partial rows", async () => {
    assert.equal((await rpc(winner, overlap)).status, "conflict");
    assert.equal(
      await sql(
        `select count(*) from public.job_claims where job_id='${overlap}'`,
      ),
      "0",
    );
  });
  await test("Idempotency key cannot be reused for another job", async () =>
    assert.equal(
      (await rpc(winner, overlap, keys[wi])).status,
      "idempotency_conflict",
    ));
  await test("Two concurrent different jobs for same lecturer cannot double-book", async () => {
    const a = await job(),
      b = await job();
    const r = await Promise.all([rpc(users[50], a), rpc(users[50], b)]);
    assert.deepEqual(r.map((x) => x.status).sort(), ["confirmed", "conflict"]);
  });
  await test("Unverified expertise rejected", async () =>
    assert.equal(
      (await rpc(users[51], await job({ topic_ids: [topic] }))).status,
      "not_eligible",
    ));
  await test("Missing or expired executed contract rejected", async () => {
    const j = await job({ requires_contract: true });
    assert.equal((await rpc(users[52], j)).status, "prerequisite_missing");
    await sql(
      `insert into public.contracts(user_id,status,effective_from,expires_at,version) values('${users[52]}','expired',now()-interval '1 year',now()-interval '1 day',1)`,
    );
    assert.equal((await rpc(users[52], j)).status, "prerequisite_missing");
  });
  await test("Qualification validity must cover all five days; valid contract version linked", async () => {
    await sql(
      `insert into public.lecturer_topics(user_id,topic_id,verified,valid_until) values('${users[53]}','${topic}',true,now()+interval '1 day')`,
    );
    assert.equal(
      (await rpc(users[53], await job({ topic_ids: [topic] }))).status,
      "not_eligible",
    );
    await sql(
      `insert into public.contracts(user_id,status,effective_from,expires_at,version) values('${users[52]}','active',now()-interval '1 day',now()+interval '1 year',2)`,
    );
    const r = await rpc(users[52], await job({ requires_contract: true }));
    assert.equal(r.status, "confirmed");
    assert.equal(
      await sql(
        `select c.version from public.contracts c join public.job_claims jc on jc.contract_id=c.id where jc.id='${r.claim_id}'`,
      ),
      "2",
    );
  });
  await test("Concurrent private appointment versus claim cannot bypass conflict checking", async () => {
    const j = await job();
    const r = await Promise.allSettled([
      rpc(users[51], j),
      as(
        users[51],
        `insert into public.personal_events(user_id,title,starts_at,ends_at) values('${users[51]}','Concurrent private',${quote(sessions[0].starts_at)},${quote(sessions[0].ends_at)})`,
      ),
    ]);
    assert.equal(r[0].status, "fulfilled");
    if (r[0].value.status === "confirmed")
      assert.equal(r[1].status, "rejected");
    else {
      assert.equal(r[0].value.status, "conflict");
      assert.equal(r[1].status, "fulfilled");
    }
  });
  await test("Old terms version rejected and original accepted fee/terms immutable", async () => {
    const j = await job();
    await sql(
      `update public.jobs set amount=999,total_amount=4995,terms='Changed terms' where id in ('${j}','${target}')`,
    );
    assert.equal((await rpc(users[53], j)).status, "terms_changed");
    assert.equal(
      await sql(
        `select amount::text || '|' || terms from public.job_claims where id='${claim}'`,
      ),
      "500.00|Test terms v1",
    );
    await assert.rejects(
      sql(`update public.job_claims set amount=999 where id='${claim}'`),
      /immutable/,
    );
  });
  let event;
  await test("Private appointment blocks claims; appointment creation over confirmed work fails", async () => {
    event = await as(
      users[54],
      `insert into public.personal_events(user_id,title,starts_at,ends_at) values('${users[54]}','Private',${quote(sessions[0].starts_at)},${quote(sessions[0].ends_at)}) returning id`,
    );
    assert.equal((await rpc(users[54], await job())).status, "conflict");
    await assert.rejects(
      as(
        winner,
        `insert into public.personal_events(user_id,title,starts_at,ends_at) values('${winner}','Private',${quote(sessions[0].starts_at)},${quote(sessions[0].ends_at)})`,
      ),
      /conflicts/,
    );
  });
  await test("RLS denies other profiles, claims and private calendar even to admin", async () => {
    assert.equal(
      await as(
        users[53],
        `select count(*) from public.profiles where id='${winner}'`,
      ),
      "0",
    );
    assert.equal(
      await as(
        users[53],
        `select count(*) from public.job_claims where id='${claim}'`,
      ),
      "0",
    );
    assert.equal(
      await as(
        admin,
        `select count(*) from public.personal_events where id='${event}'`,
        "aal2",
      ),
      "0",
    );
    assert.equal(
      await as(
        users[53],
        `select count(*) from public.personal_events where id='${event}'`,
      ),
      "0",
    );
  });
  await test("Forged owner IDs, role updates, activation and qualification verification denied", async () => {
    await assert.rejects(
      as(
        users[53],
        `insert into public.personal_events(user_id,title,starts_at,ends_at) values('${winner}','Forged',now(),now()+interval '1 hour')`,
      ),
      /row-level security|owner mismatch/,
    );
    await assert.rejects(
      as(
        users[53],
        `insert into public.user_roles values('${users[53]}','admin')`,
      ),
      /permission denied/,
    );
    await assert.rejects(
      as(
        users[53],
        `update public.profiles set active=true where id='${users[53]}'`,
      ),
      /permission denied/,
    );
    await assert.rejects(
      as(
        users[53],
        `insert into public.lecturer_topics(user_id,topic_id,verified) values('${users[53]}','${topic}',true)`,
      ),
      /permission denied/,
    );
    await assert.rejects(
      as(
        users[53],
        `insert into public.job_claims(job_id,lecturer_id,idempotency_key,amount,currency,rate_unit,total_amount,terms,terms_version) values('${overlap}','${users[53]}','${randomUUID()}',1,'EUR','fixed_total',1,'forged',1)`,
      ),
      /permission denied/,
    );
  });
  await test("Participant cannot view jobs or claim; user_metadata cannot elevate permissions", async () => {
    assert.equal(
      await as(participant, "select count(*) from public.jobs"),
      "0",
    );
    assert.equal((await rpc(participant, overlap)).status, "not_eligible");
    const claims = {
      sub: users[53],
      aal: "aal2",
      role: "authenticated",
      user_metadata: { role: "admin" },
    };
    assert.equal(
      await sql(
        `begin;set local role authenticated;set local request.jwt.claims=${quote(JSON.stringify(claims))};select cardinality(public.get_my_permissions());commit;`,
      ),
      "0",
    );
  });
  await test("Inactive user has zero table access and cannot claim", async () => {
    await sql(
      `update public.profiles set active=false where id='${users[53]}'`,
    );
    assert.equal(
      await as(users[53], "select count(*) from public.topics"),
      "0",
    );
    assert.equal(
      await as(users[53], "select count(*) from public.profiles"),
      "0",
    );
    await assert.rejects(rpc(users[53], overlap), /Authentication required/);
  });
  await test("Admin management RPC requires MFA; successful create preserves course/run/session relation", async () => {
    await assert.rejects(
      as(
        admin,
        `select public.create_job(${quote(JSON.stringify(jobPayload()))}::jsonb)`,
      ),
      /MFA required/,
    );
    const j = await job();
    assert.equal(
      await as(
        admin,
        `select count(*) from public.job_sessions where job_id='${j}'`,
        "aal2",
      ),
      "5",
    );
    assert.equal(
      await sql(
        `select count(*) from public.course_sessions cs join public.jobs j on j.course_run_id=cs.course_run_id where j.id='${j}'`,
      ),
      "5",
    );
    assert.ok(
      JSON.parse(
        await as(admin, "select to_json(public.get_my_permissions())", "aal2"),
      ).includes("jobs.manage"),
    );
  });
  await test("Published global events only; inactive/private ownership remains enforced", async () => {
    await sql(
      `insert into public.global_events(title,starts_at,ends_at,published) values('Visible',now(),now()+interval '1 hour',true),('Draft',now(),now()+interval '1 hour',false)`,
    );
    assert.equal(
      await as(users[54], "select count(*) from public.global_events"),
      "1",
    );
  });
  await test("Anon cannot execute claim RPC and every exposed table has RLS", async () => {
    await assert.rejects(
      sql(
        `set role anon;select public.claim_job('${overlap}','${randomUUID()}',1)`,
      ),
      /permission denied/,
    );
    assert.equal(
      await sql(
        `select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity`,
      ),
      "0",
    );
  });
  await test("Invitation reservation requires admin MFA; idempotency prevents duplicate sends", async () => {
    const key = randomUUID();
    await assert.rejects(
      as(
        admin,
        `select public.reserve_invitation('invite1@example.test','${key}')`,
      ),
      /MFA required/,
    );
    await assert.rejects(
      as(
        users[54],
        `select public.reserve_invitation('invite1@example.test','${key}')`,
        "aal2",
      ),
      /MFA required/,
    );
    const r = JSON.parse(
      await as(
        admin,
        `select public.reserve_invitation('invite1@example.test','${key}')`,
        "aal2",
      ),
    );
    assert.equal(r.status, "reserved");
    const retry = JSON.parse(
      await as(
        admin,
        `select public.reserve_invitation('invite1@example.test','${key}')`,
        "aal2",
      ),
    );
    assert.equal(retry.status, "in_progress");
    assert.equal(retry.invitation_id, r.invitation_id);
    assert.equal(
      JSON.parse(
        await as(
          admin,
          `select public.reserve_invitation('different@example.test','${key}')`,
          "aal2",
        ),
      ).status,
      "idempotency_conflict",
    );
    assert.equal(
      JSON.parse(
        await as(
          admin,
          `select public.reserve_invitation('invite1@example.test','${randomUUID()}')`,
          "aal2",
        ),
      ).status,
      "in_progress",
    );
    await assert.rejects(
      as(
        admin,
        `select public.complete_invitation('${r.invitation_id}',null,'Fake',true)`,
        "aal2",
      ),
      /permission denied/,
    );
    const invited = randomUUID();
    await sql(`insert into auth.users(id) values('${invited}')`);
    await sql(
      `begin;set local role service_role;select public.complete_invitation('${r.invitation_id}','${invited}','Fictional invitee',true);commit;`,
    );
    assert.equal(
      await as(invited, "select role from public.user_roles"),
      "lecturer",
    );
    assert.equal(
      JSON.parse(
        await as(
          admin,
          `select public.reserve_invitation('invite1@example.test','${key}')`,
          "aal2",
        ),
      ).status,
      "already_sent",
    );
    assert.equal(
      await as(users[54], "select count(*) from public.invitation_requests"),
      "0",
    );
  });
  await test("Invitation rate limit permits five requests per actor in15minutes", async () => {
    for (let i = 2; i <= 5; i++)
      assert.equal(
        JSON.parse(
          await as(
            admin,
            `select public.reserve_invitation('invite${i}@example.test','${randomUUID()}')`,
            "aal2",
          ),
        ).status,
        "reserved",
      );
    assert.equal(
      JSON.parse(
        await as(
          admin,
          `select public.reserve_invitation('invite6@example.test','${randomUUID()}')`,
          "aal2",
        ),
      ).status,
      "throttled",
    );
  });
  await test("Management attests only self-selected expertise, MFA and future expiry required", async () => {
    await assert.rejects(
      as(
        admin,
        `select public.verify_lecturer_topic('${users[54]}','${topic}',true,null)`,
      ),
      /MFA required/,
    );
    await assert.rejects(
      as(
        users[54],
        `select public.verify_lecturer_topic('${users[54]}','${topic}',true,null)`,
        "aal2",
      ),
      /MFA required/,
    );
    await assert.rejects(
      as(
        admin,
        `select public.verify_lecturer_topic('${users[54]}','${topic}',true,null)`,
        "aal2",
      ),
      /select this expertise first/,
    );
    await as(
      users[54],
      `insert into public.lecturer_topics(user_id,topic_id) values('${users[54]}','${topic}')`,
    );
    await assert.rejects(
      as(
        admin,
        `select public.verify_lecturer_topic('${users[54]}','${topic}',true,now()-interval '1 hour')`,
        "aal2",
      ),
      /in the future/,
    );
    await as(
      admin,
      `select public.verify_lecturer_topic('${users[54]}','${topic}',true,now()+interval '1 year')`,
      "aal2",
    );
    assert.equal(
      await as(
        users[54],
        `select verified from public.lecturer_topics where topic_id='${topic}'`,
      ),
      "t",
    );
    assert.equal(
      await sql(
        `select details->>'basis' from public.audit_events where action='qualification.attested' and resource_id='${users[54]}' order by created_at desc limit 1`,
      ),
      "management_attestation",
    );
    const later = sessions.map((x) => ({
      starts_at: new Date(+new Date(x.starts_at) + 20 * 86400000).toISOString(),
      ends_at: new Date(+new Date(x.ends_at) + 20 * 86400000).toISOString(),
    }));
    assert.equal(
      (await rpc(users[54], await job({ topic_ids: [topic], sessions: later })))
        .status,
      "confirmed",
    );
    await as(
      admin,
      `select public.verify_lecturer_topic('${users[54]}','${topic}',false,null)`,
      "aal2",
    );
    assert.equal(
      await as(
        users[54],
        `select verified::text||'|'||(valid_until is null)::text from public.lecturer_topics where topic_id='${topic}'`,
      ),
      "false|true",
    );
    assert.equal(
      (await rpc(users[54], await job({ topic_ids: [topic], sessions: later })))
        .status,
      "not_eligible",
    );
    await assert.rejects(
      as(
        admin,
        `select public.verify_lecturer_topic('${participant}','${topic}',true,null)`,
        "aal2",
      ),
      /active lecturer/,
    );
  });
  await test("Account suspension needs MFA; immediately denies existing-session data and claiming", async () => {
    await assert.rejects(
      as(
        users[54],
        `select public.set_user_active('${users[54]}',true)`,
        "aal2",
      ),
      /MFA required/,
    );
    await assert.rejects(
      as(admin, `select public.set_user_active('${users[54]}',false)`),
      /MFA required/,
    );
    await as(
      admin,
      `select public.set_user_active('${users[54]}',false)`,
      "aal2",
    );
    assert.equal(
      await as(users[54], "select count(*) from public.topics"),
      "0",
    );
    await assert.rejects(
      rpc(users[54], await job()),
      /Authentication required/,
    );
    assert.equal(
      await sql(
        `select details->>'active' from public.audit_events where action='user.deactivated' and resource_id='${users[54]}' order by created_at desc limit 1`,
      ),
      "false",
    );
    await as(
      admin,
      `select public.set_user_active('${users[54]}',true)`,
      "aal2",
    );
    assert.equal(
      await as(users[54], "select count(*) from public.topics"),
      "1",
    );
  });
  await test("Self-deactivation and subordinate authority cannot remove the sole active administrator", async () => {
    await assert.rejects(
      as(admin, `select public.set_user_active('${admin}',false)`, "aal2"),
      /Self-deactivation/,
    );
    const manager = randomUUID();
    await sql(
      `insert into auth.users(id) values('${manager}');insert into public.user_roles(user_id,role) values('${manager}','management')`,
    );
    await assert.rejects(
      as(manager, `select public.set_user_active('${admin}',false)`, "aal2"),
      /Only subordinate account activation may be changed/,
    );
    assert.equal(
      await sql(`select active from public.profiles where id='${admin}'`),
      "t",
    );
    assert.equal(
      await sql(
        "select count(distinct r.user_id) from public.user_roles r join public.profiles p on p.id=r.user_id where r.role in ('admin','owner') and p.active",
      ),
      "1",
    );
  });
  await test("Concurrent equal administrators cannot suspend either protected account", async () => {
    const a = randomUUID(),
      b = randomUUID();
    await sql(
      `insert into auth.users(id) values('${a}'),('${b}');insert into public.user_roles(user_id,role) values('${a}','admin'),('${b}','admin')`,
    );
    const r = await Promise.allSettled([
      as(a, `select public.set_user_active('${b}',false)`, "aal2"),
      as(b, `select public.set_user_active('${a}',false)`, "aal2"),
    ]);
    assert.equal(r.filter((x) => x.status === "fulfilled").length, 0);
    assert.equal(r.filter((x) => x.status === "rejected").length, 2);
    for (const result of r)
      assert.match(
        result.reason.message,
        /Only subordinate account activation may be changed/,
      );
    assert.equal(
      await sql(
        `select count(*) from public.profiles where id in ('${a}','${b}') and active`,
      ),
      "2",
    );
    assert.equal(
      await sql(
        `select count(*) from public.audit_events where resource_id in ('${a}','${b}') and action='user.deactivated'`,
      ),
      "0",
    );
  });
  console.log(
    `\n${checks} PostgreSQL tests passed (including 50 genuinely parallel transactions).`,
  );
} finally {
  await sql(`drop database if exists ${database} with (force)`, "postgres");
}
