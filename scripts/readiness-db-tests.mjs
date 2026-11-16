/** Actual PostgreSQL preparation projections and authorisation. Native Auth,
 * scanned binary delivery and browser acceptance are separate gates. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { quoteSql, withTestDatabase } from "./testing/database.mjs";

const admin = "e8000000-0000-4000-8000-000000000001";
const teacher = "e8000000-0000-4000-8000-000000000002";
const peer = "e8000000-0000-4000-8000-000000000003";
const participant = "e8000000-0000-4000-8000-000000000004";
const otherCustomer = "e8000000-0000-4000-8000-000000000005";
let checks = 0;
await withTestDatabase("course_readiness", async ({ sql, actor }) => {
  await sql(
    `insert into auth.users(id,email) values('${admin}','readiness-admin@example.invalid'),('${teacher}','readiness-teacher@example.invalid'),('${peer}','readiness-peer@example.invalid'),('${participant}','readiness-participant@example.invalid'),('${otherCustomer}','readiness-client@example.invalid');insert into public.user_roles(user_id,role) values('${admin}','admin'),('${teacher}','lecturer'),('${peer}','lecturer'),('${participant}','participant'),('${otherCustomer}','client');`,
  );
  const topic = randomUUID();
  await sql(
    `insert into public.topics(id,label_de,label_en,kind) values('${topic}','Fiktive Bereitschaft','Fictional readiness','topic');insert into public.lecturer_topics(user_id,topic_id,verified) values('${teacher}','${topic}',true),('${peer}','${topic}',true)`,
  );
  const check = async (name, fn) => {
    await fn();
    checks++;
    console.log(`PASS ${name}`);
  };
  const snap = async (run, who = admin, aal = "aal2") =>
    JSON.parse(
      await actor(who, `select public.course_readiness('${run}')`, aal),
    )[0];
  const testCheck = (state, code) =>
    state.checks.find((item) => item.code === code);
  const settings = (overrides = {}) => ({
    materials_required: true,
    customer_required: true,
    contact_required: true,
    agreement_required: true,
    instructions_required: false,
    instructions: "",
    meeting_url: "https://meeting.example.invalid/fictional-room",
    preparation_deadline: null,
    ...overrides,
  });
  const save = async (
    run,
    values = settings(),
    version,
    key = randomUUID(),
    who = admin,
    aal = "aal2",
  ) =>
    actor(
      who,
      `select public.save_readiness_settings('${run}',${quoteSql(JSON.stringify(values))}::jsonb,${version ?? (await snap(run)).settings.version},'${key}')`,
      aal,
    );
  const confirm = async (run, version, key = randomUUID()) =>
    actor(
      admin,
      `select public.confirm_course_sessions('${run}',${version ?? (await snap(run)).settings.version},'${key}')`,
      "aal2",
    );
  const file = async (
    owner,
    {
      scope = "personal",
      kind = "contract",
      job = null,
      room = null,
      status = "clean",
      name = "Fictional preparation.pdf",
    } = {},
  ) => {
    const id = randomUUID(),
      version = randomUUID(),
      key = randomUUID();
    await sql(
      `insert into public.documents(id,owner_id,uploaded_by,scope,kind,job_id,room_id,original_name,mime_type,size_bytes,status,client_id) values('${id}','${owner}','${owner}',${quoteSql(scope)},${quoteSql(kind)},${job ? quoteSql(job) : "null"},${room ? quoteSql(room) : "null"},${quoteSql(name)},'application/pdf',100,${quoteSql(status)},'${key}');insert into public.document_versions(id,document_id,uploaded_by,client_id,version,object_path,original_name,mime_type,size_bytes,status,sha256) values('${version}','${id}','${owner}','${key}',1,'readiness/${version}',${quoteSql(name)},'application/pdf',100,${quoteSql(status)},repeat('a',64));update public.documents set current_version_id='${version}' where id='${id}'`,
    );
    return { id, version };
  };
  for (const who of [teacher, peer]) {
    const contractFile = await file(who);
    await actor(
      admin,
      `select public.register_executed_contract('${who}','Fictional executed agreement','${contractFile.version}','2020-01-01',null,'master',null,'${randomUUID()}')`,
      "aal2",
    );
  }
  let day = 1;
  const create = async ({
    claimed = true,
    material = true,
    contact = true,
    configured = true,
    requiresContract = true,
    topics = true,
    onsite = false,
  } = {}) => {
    const payload = {
      title: "Fictional preparation course",
      customer_name: "Fictional readiness organisation",
      delivery_type: onsite ? "onsite" : "online",
      location: onsite ? "Fictional teaching room" : "",
      time_zone: "Europe/Berlin",
      status: "published",
      amount: 101.01,
      total_amount: 202.02,
      currency: "EUR",
      rate_unit: "per_day",
      terms: "Fictional accepted immutable compensation",
      requires_contract: requiresContract,
      topic_ids: topics ? [topic] : [],
      sessions: [1, 2].map((n) => ({
        starts_at: new Date(Date.UTC(2039, 0, day + n, 8)).toISOString(),
        ends_at: new Date(Date.UTC(2039, 0, day + n, 9)).toISOString(),
      })),
    };
    day += 3;
    const job = await actor(
      admin,
      `select public.create_job(${quoteSql(JSON.stringify(payload))}::jsonb)`,
      "aal2",
    );
    const run = await sql(
      `select course_run_id from public.jobs where id='${job}'`,
    );
    await sql(
      `update public.course_runs set delivery_type=${quoteSql(onsite ? "onsite" : "online")},venue=${quoteSql(onsite ? "Fictional teaching room" : "")},published=true where id='${run}'`,
    );
    const organisation = await sql(
      `select organisation_id from public.course_runs where id='${run}'`,
    );
    if (contact)
      await sql(
        `insert into public.organisation_contacts(organisation_id,name,email,notes) values('${organisation}','Fictional private contact','private-contact@example.invalid','Fictional restricted contact note')`,
      );
    let claim;
    if (claimed) {
      const hasOffers =
        (await sql(
          "select to_regprocedure('public.job_offers()') is not null",
        )) === "t";
      const offeredVersion = await actor(
        teacher,
        hasOffers
          ? `select item->>'terms_version' from jsonb_array_elements(public.job_offers()) item where item->>'id'='${job}'`
          : `select terms_version from public.jobs where id='${job}'`,
      );
      claim = JSON.parse(
        await actor(
          teacher,
          `select public.claim_job('${job}','${randomUUID()}',${offeredVersion})`,
        ),
      );
      assert.equal(claim.status, "confirmed");
    }
    const document = material
      ? await file(admin, { scope: "job_after", kind: "material", job })
      : null;
    if (configured) {
      await save(run);
      await confirm(run);
    }
    return { job, run, organisation, claim: claim?.claim_id, document };
  };

  await check(
    "Mandatory defaults never mark an unassigned or unconfirmed course ready",
    async () => {
      const { run } = await create({
        claimed: false,
        configured: false,
        material: false,
        contact: false,
      });
      const state = await snap(run);
      assert.equal(state.status, "blocked");
      assert.ok(state.percentage < 100);
      for (const code of [
        "lecturer",
        "agreement",
        "materials",
        "delivery",
        "contact",
        "sessions",
      ])
        assert.equal(testCheck(state, code).complete, false, code);
      assert.equal(state.settings.version, 0);
      await assert.rejects(snap(run, peer, "aal1"), /42501/);
      assert.deepEqual(
        JSON.parse(await actor(peer, "select public.course_readiness()")),
        [],
      );
    },
  );
  await check(
    "Confirmed complete course reaches derived 100% with immutable accepted compensation",
    async () => {
      const { run, claim } = await create();
      const before = await sql(
        `select to_jsonb(c) from public.job_claims c where id='${claim}'`,
      );
      const state = await snap(run);
      assert.equal(state.status, "ready");
      assert.equal(state.percentage, 100);
      assert.equal(
        state.checks.filter((c) => c.applicable).length,
        state.applicable_count,
      );
      assert.equal((await snap(run, teacher, "aal1")).can_manage, false);
      assert.equal(
        await sql(
          `select to_jsonb(c) from public.job_claims c where id='${claim}'`,
        ),
        before,
      );
    },
  );
  await check(
    "Online meeting and physical venue apply according to actual delivery mode",
    async () => {
      const online = await create();
      await save(online.run, settings({ meeting_url: "" }));
      assert.equal(
        testCheck(await snap(online.run), "delivery").complete,
        false,
      );
      const onsite = await create({ onsite: true });
      await save(onsite.run, settings({ meeting_url: "" }));
      assert.equal(
        testCheck(await snap(onsite.run), "delivery").complete,
        true,
      );
      await sql(
        `update public.course_runs set venue='' where id='${onsite.run}'`,
      );
      assert.equal(
        testCheck(await snap(onsite.run), "delivery").complete,
        false,
      );
      await assert.rejects(
        save(online.run, settings({ meeting_url: "javascript:alert(1)" })),
        /22023/,
      );
      await assert.rejects(
        save(
          online.run,
          settings({ meeting_url: "https://user:password@example.invalid/" }),
        ),
        /22023/,
      );
      await assert.rejects(
        save(online.run, settings({ meeting_url: "https://?missing-host" })),
        /22023/,
      );
      await assert.rejects(
        save(
          online.run,
          settings({ meeting_url: "https://meeting.example.invalid:99999/" }),
        ),
        /22023/,
      );
      await sql(
        `update public.course_runs set venue='https://?missing-host' where id='${online.run}'`,
      );
      assert.equal(
        testCheck(await snap(online.run), "delivery").complete,
        false,
      );
    },
  );
  await check(
    "Revoked and expired qualifications change readiness without altering accepted history",
    async () => {
      const { run } = await create();
      await actor(
        admin,
        `select public.verify_lecturer_topic('${teacher}','${topic}',false,null)`,
        "aal2",
      );
      assert.equal(testCheck(await snap(run), "qualification").complete, false);
      await actor(
        admin,
        `select public.verify_lecturer_topic('${teacher}','${topic}',true,'2038-01-01')`,
        "aal2",
      );
      assert.equal(testCheck(await snap(run), "qualification").complete, false);
      await actor(
        admin,
        `select public.verify_lecturer_topic('${teacher}','${topic}',true,null)`,
        "aal2",
      );
      assert.equal(testCheck(await snap(run), "qualification").complete, true);
    },
  );
  await check(
    "Newest revoked agreement blocks readiness and no private contract identifiers leak",
    async () => {
      const { run } = await create();
      const contract = await sql(
        `select id from public.contracts where user_id='${teacher}' order by version desc limit 1`,
      );
      await actor(
        admin,
        `select public.set_contract_status('${contract}','expired')`,
        "aal2",
      );
      const state = await snap(run, teacher, "aal1");
      assert.equal(testCheck(state, "agreement").complete, false);
      assert.ok(!JSON.stringify(state).includes(contract));
      assert.ok(!JSON.stringify(state).includes("document_sha256"));
      await actor(
        admin,
        `select public.set_contract_status('${contract}','active')`,
        "aal2",
      );
      assert.equal(testCheck(await snap(run), "agreement").complete, true);
    },
  );
  await check(
    "Materials require a clean current file accessible to the assigned lecturer",
    async () => {
      const { run, job, document } = await create();
      await sql(
        `update public.documents set status='quarantined' where id='${document.id}'`,
      );
      assert.equal(testCheck(await snap(run), "materials").complete, false);
      await file(admin, { kind: "cv", name: "Fictional confidential CV.pdf" });
      assert.equal(testCheck(await snap(run), "materials").complete, false);
      await sql(
        `update public.documents set status='clean' where id='${document.id}';update public.document_versions set status='scan_error' where id='${document.version}'`,
      );
      assert.equal(testCheck(await snap(run), "materials").complete, false);
      await sql(
        `update public.document_versions set status='clean' where id='${document.version}'`,
      );
      assert.equal(testCheck(await snap(run), "materials").complete, true);
      const state = await snap(run, teacher, "aal1");
      assert.ok(!JSON.stringify(state).includes("confidential CV"));
      assert.ok(state.documents.some((d) => d.id === document.id));
      await sql(
        `update public.documents set deleted_at=now() where id='${document.id}'`,
      );
      const room = await sql(
        `select id from public.chat_rooms where job_id='${job}'`,
      );
      await file(teacher, { scope: "room", kind: "chat", room });
      assert.equal(testCheck(await snap(run), "materials").complete, true);
      await sql(
        `update public.chat_members set removed_at=now() where room_id='${room}' and user_id='${teacher}'`,
      );
      assert.equal(testCheck(await snap(run), "materials").complete, false);
    },
  );
  await check(
    "A released or mismatched session never passes complete-block assignment readiness",
    async () => {
      const { run, claim } = await create();
      const interval = await sql(
        `select id from public.assignment_sessions where claim_id='${claim}' order by starts_at limit 1`,
      );
      await sql(
        `update public.assignment_sessions set released_at=now() where id='${interval}'`,
      );
      assert.equal(testCheck(await snap(run), "lecturer").complete, false);
      await sql(
        `update public.assignment_sessions set released_at=null,ends_at=ends_at+interval '1 minute' where id='${interval}'`,
      );
      assert.equal(testCheck(await snap(run), "lecturer").complete, false);
    },
  );
  await check(
    "Schedule confirmation is versioned and automatically invalidated by changed source intervals",
    async () => {
      const { run } = await create();
      const before = await snap(run);
      assert.equal(before.settings.sessions_confirmed, true);
      await sql(
        `update public.course_sessions set ends_at=ends_at+interval '1 minute' where course_run_id='${run}'`,
      );
      assert.equal(testCheck(await snap(run), "sessions").complete, false);
      await assert.rejects(confirm(run, before.settings.version - 1), /40001/);
      await confirm(run);
      assert.equal(testCheck(await snap(run), "sessions").complete, true);
      assert.equal(testCheck(await snap(run), "lecturer").complete, false);
    },
  );
  await check(
    "Settings retries are idempotent while stale/concurrent decisions fail closed",
    async () => {
      const { run } = await create();
      const current = await snap(run),
        version = current.settings.version,
        key = randomUUID();
      const count = await sql(
        `select count(*) from private.course_readiness_events where course_run_id='${run}'`,
      );
      await Promise.all(
        Array.from({ length: 4 }, () => save(run, settings(), version, key)),
      );
      assert.equal((await snap(run)).settings.version, version + 1);
      assert.equal(
        Number(
          await sql(
            `select count(*) from private.course_readiness_events where course_run_id='${run}'`,
          ),
        ),
        Number(count) + 1,
      );
      await assert.rejects(
        save(run, settings({ instructions: "different" }), version, key),
        /retry conflict/,
      );
      const next = (await snap(run)).settings.version;
      const attempts = await Promise.allSettled([
        save(run, settings({ instructions: "Choice one" }), next),
        save(run, settings({ instructions: "Choice two" }), next),
      ]);
      assert.equal(attempts.filter((r) => r.status === "fulfilled").length, 1);
      assert.equal(attempts.filter((r) => r.status === "rejected").length, 1);
    },
  );
  await check(
    "Instruction acknowledgements bind the exact version and current assignment",
    async () => {
      const { run } = await create();
      await save(
        run,
        settings({
          instructions_required: true,
          instructions: "Fictional required safety instructions",
        }),
      );
      let state = await snap(run);
      assert.equal(testCheck(state, "instructions").complete, false);
      const version = state.settings.instruction_version,
        key = randomUUID();
      const ack = (who, v = version, k = key) =>
        actor(
          who,
          `select public.acknowledge_course_instructions('${run}',${v},'${k}')`,
        );
      await assert.rejects(ack(peer), /42501/);
      await assert.rejects(ack(admin), /42501/);
      const first = await ack(teacher);
      assert.equal(await ack(teacher), first);
      assert.equal(await ack(teacher, version, randomUUID()), first);
      assert.equal(testCheck(await snap(run), "instructions").complete, true);
      await save(
        run,
        settings({
          instructions_required: true,
          instructions: "Fictional changed instructions",
        }),
      );
      await assert.rejects(ack(teacher, version, randomUUID()), /40001/);
      assert.equal(testCheck(await snap(run), "instructions").complete, false);
      assert.equal(
        await sql(
          `select count(*) from private.course_instruction_receipts where course_run_id='${run}'`,
        ),
        "1",
      );
    },
  );
  await check(
    "Tasks enforce assignee/management permission and retain correction history",
    async () => {
      const { run } = await create();
      const values = {
        title: "Fictional prepare material",
        responsible_user_id: teacher,
        required: true,
        due_at: null,
        archived: false,
      };
      const createTask = (who = admin, aal = "aal2") =>
        actor(
          who,
          `select public.save_readiness_task('${run}',null,${quoteSql(JSON.stringify(values))},0,'${randomUUID()}')`,
          aal,
        );
      await assert.rejects(createTask(teacher, "aal1"), /42501/);
      await assert.rejects(createTask(admin, "aal1"), /42501/);
      const task = await createTask();
      let state = await snap(run);
      assert.equal(testCheck(state, "tasks").complete, false);
      const complete = (who, version, decision = true, key = randomUUID()) =>
        actor(
          who,
          `select public.complete_readiness_task('${task}',${decision},${version},'${key}')`,
        );
      await assert.rejects(complete(peer, 1), /42501/);
      await complete(teacher, 1);
      assert.equal(testCheck(await snap(run), "tasks").complete, true);
      await assert.rejects(complete(teacher, 1), /40001/);
      await complete(teacher, 2, false);
      assert.equal(testCheck(await snap(run), "tasks").complete, false);
      assert.equal(
        await sql(
          `select count(*) from private.course_readiness_events where course_run_id='${run}' and action='task_completed'`,
        ),
        "2",
      );
      state = await snap(run);
      const row = state.tasks[0];
      await actor(
        admin,
        `select public.save_readiness_task('${run}','${task}',${quoteSql(JSON.stringify({ ...values, archived: true }))},${row.version},'${randomUUID()}')`,
        "aal2",
      );
      assert.equal(testCheck(await snap(run), "tasks").applicable, false);
      assert.equal(
        await sql(
          `select count(*) from private.course_readiness_tasks where id='${task}'`,
        ),
        "1",
      );
    },
  );
  await check(
    "Private customer contact fields stay private and organisation membership does not grant preparation",
    async () => {
      const { run, organisation } = await create();
      const state = await snap(run, teacher, "aal1");
      assert.equal(testCheck(state, "contact").complete, true);
      assert.ok(
        !JSON.stringify(state).includes("private-contact@example.invalid"),
      );
      assert.ok(!JSON.stringify(state).includes("restricted contact note"));
      await actor(
        admin,
        `select public.manage_client_organisation('${otherCustomer}','${organisation}',true)`,
        "aal2",
      );
      await assert.rejects(snap(run, otherCustomer, "aal1"), /42501/);
      await sql(
        `update public.organisation_contacts set archived_at=now() where organisation_id='${organisation}'`,
      );
      assert.equal(testCheck(await snap(run), "contact").complete, false);
      await sql(
        `update public.organisations set archived_at=now() where id='${organisation}'`,
      );
      assert.equal(testCheck(await snap(run), "customer").complete, false);
    },
  );
  await check(
    "Only explicitly inapplicable requirements leave the denominator; job contracts cannot be waived",
    async () => {
      const { run } = await create({
        requiresContract: false,
        topics: false,
        material: false,
        contact: false,
      });
      await save(
        run,
        settings({
          materials_required: false,
          customer_required: false,
          contact_required: false,
          agreement_required: false,
        }),
      );
      let state = await snap(run);
      assert.equal(state.percentage, 100);
      assert.equal(state.applicable_count, 3);
      const strict = await create();
      await save(strict.run, settings({ agreement_required: false }));
      state = await snap(strict.run);
      assert.equal(testCheck(state, "agreement").applicable, true);
      const contract = await sql(
        `select id from public.contracts where user_id='${teacher}' order by version desc limit 1`,
      );
      await actor(
        admin,
        `select public.set_contract_status('${contract}','expired')`,
        "aal2",
      );
      assert.equal(
        testCheck(await snap(strict.run), "agreement").complete,
        false,
      );
      await actor(
        admin,
        `select public.set_contract_status('${contract}','active')`,
        "aal2",
      );
    },
  );
  await check(
    "Suspension immediately revokes preparation access and blocks management readiness",
    async () => {
      const { run } = await create();
      await actor(
        admin,
        `select public.set_user_active('${teacher}',false)`,
        "aal2",
      );
      await assert.rejects(snap(run, teacher, "aal1"), /42501/);
      assert.equal(testCheck(await snap(run), "lecturer").complete, false);
      await actor(
        admin,
        `select public.set_user_active('${teacher}',true)`,
        "aal2",
      );
    },
  );
  await check(
    "Cancellation removes preparation access rather than relying on published course visibility",
    async () => {
      const { run, claim } = await create();
      await actor(
        teacher,
        `select public.cancel_job_assignment('${claim}','Fictional cancellation for replacement','${randomUUID()}')`,
      );
      await assert.rejects(snap(run, teacher, "aal1"), /42501/);
      assert.equal(testCheck(await snap(run), "lecturer").complete, false);
      assert.equal(
        await actor(
          teacher,
          `select count(*) from public.course_runs where id='${run}'`,
        ),
        "1",
        "Published course itself remains discoverable; checklist does not",
      );
    },
  );
  await check(
    "No direct private ledger, anonymous function or percentage mutation bypass exists",
    async () => {
      const { run } = await create();
      await assert.rejects(
        save(run, { ...settings(), percentage: 100 }),
        /22023/,
      );
      for (const table of [
        "course_readiness_settings",
        "course_readiness_tasks",
        "course_instruction_receipts",
        "course_readiness_requests",
        "course_readiness_events",
      ]) {
        await assert.rejects(
          actor(teacher, `select * from private.${table}`),
          /42501/,
        );
        assert.equal(
          await sql(
            `select relrowsecurity from pg_class where oid='private.${table}'::regclass`,
          ),
          "t",
        );
      }
      await assert.rejects(
        sql(
          "begin;set local role anon;select public.course_readiness();commit;",
        ),
        /42501/,
      );
      await assert.rejects(
        save(run, settings(), undefined, randomUUID(), admin, "aal1"),
        /42501/,
      );
      await assert.rejects(
        save(run, settings(), undefined, randomUUID(), peer, "aal1"),
        /42501/,
      );
    },
  );
  console.log(`\n${checks} course readiness PostgreSQL groups passed.`);
});
