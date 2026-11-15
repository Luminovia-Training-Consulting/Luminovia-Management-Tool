/** Real PostgreSQL lifecycle/revenue/availability regression cases. Native
 * Auth, Storage and realtime are verified separately by the actual API suite. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { quoteSql, withTestDatabase } from "./testing/database.mjs";
const admin = "c6000000-0000-4000-8000-000000000001",
  teacher = "c6000000-0000-4000-8000-000000000002",
  peer = "c6000000-0000-4000-8000-000000000003",
  participant = "c6000000-0000-4000-8000-000000000004";
let checks = 0;
await withTestDatabase("job_lifecycle", async ({ sql, actor }) => {
  await sql(
    `insert into auth.users(id,email) values('${admin}','lifecycle-admin@example.invalid'),('${teacher}','lifecycle-teacher@example.invalid'),('${peer}','lifecycle-peer@example.invalid'),('${participant}','lifecycle-participant@example.invalid');insert into public.user_roles(user_id,role) values('${admin}','admin'),('${teacher}','lecturer'),('${peer}','lecturer'),('${participant}','participant');`,
  );
  let day = 1;
  const payload = () => ({
    title: "Fictional lifecycle teaching block",
    customer_name: "Fictional lifecycle customer",
    delivery_type: "online",
    status: "published",
    amount: 100,
    total_amount: 200,
    currency: "EUR",
    rate_unit: "per_day",
    terms: "Accepted fictional terms",
    sessions: [1, 2].map((n) => ({
      starts_at: new Date(Date.UTC(2039, 0, day + n, 8)).toISOString(),
      ends_at: new Date(Date.UTC(2039, 0, day + n, 9)).toISOString(),
    })),
  });
  const create = async () => {
    const result = await actor(
      admin,
      `select public.create_job(${quoteSql(JSON.stringify(payload()))}::jsonb)`,
      "aal2",
    );
    day += 3;
    return result;
  };
  const claim = async (job, who = teacher, key = randomUUID()) => {
    const version = await sql(
      `select terms_version from public.jobs where id='${job}'`,
    );
    return JSON.parse(
      await actor(who, `select public.claim_job('${job}','${key}',${version})`),
    );
  };
  const state = async (job, who = admin, aal = "aal2") =>
    JSON.parse(await actor(who, `select public.job_lifecycle('${job}')`, aal));
  const action = async (job, type, values = {}, key = randomUUID(), version) =>
    actor(
      admin,
      `select public.manage_job_offer('${job}',${quoteSql(type)},${version ?? (await state(job)).version},'${key}',${quoteSql(JSON.stringify(values))}::jsonb)`,
      "aal2",
    );
  const cancel = async (
    id,
    who = teacher,
    reason = "Fictional scheduling change",
    key = randomUUID(),
    aal = "aal1",
  ) =>
    actor(
      who,
      `select public.cancel_job_assignment('${id}',${quoteSql(reason)},'${key}')`,
      aal,
    );
  const check = async (name, fn) => {
    await fn();
    checks++;
    console.log("PASS " + name);
  };
  await check(
    "Only active managers with MFA can mutate offers; foreign and participant cancellation/read fail",
    async () => {
      const job = await create();
      const c = await claim(job);
      await assert.rejects(
        actor(
          admin,
          `select public.manage_job_offer('${job}','archived',1,'${randomUUID()}')`,
        ),
        /42501/,
      );
      await assert.rejects(cancel(c.claim_id, peer), /42501/);
      await assert.rejects(cancel(c.claim_id, participant), /42501/);
      await assert.rejects(state(job, participant, "aal1"), /42501/);
      await assert.rejects(cancel(c.claim_id, teacher, "no"), /22023/);
    },
  );
  await check(
    "Cancellation preserves accepted money/terms and interval rows, releases calendar and revokes course chat",
    async () => {
      const job = await create(),
        c = await claim(job);
      const before = JSON.parse(
        await sql(
          `select to_jsonb(c)::text from public.job_claims c where id='${c.claim_id}'`,
        ),
      );
      const old = await sql(
        `select jsonb_agg(to_jsonb(s)-'released_at' order by s.starts_at)::text from public.assignment_sessions s where claim_id='${c.claim_id}'`,
      );
      await cancel(c.claim_id);
      const after = JSON.parse(
        await sql(
          `select to_jsonb(c)::text from public.job_claims c where id='${c.claim_id}'`,
        ),
      );
      assert.deepEqual(after, { ...before, status: "cancelled" });
      assert.equal(
        await sql(
          `select jsonb_agg(to_jsonb(s)-'released_at' order by s.starts_at)::text from public.assignment_sessions s where claim_id='${c.claim_id}'`,
        ),
        old,
      );
      assert.equal(
        await sql(
          `select count(*) from public.assignment_sessions where claim_id='${c.claim_id}' and released_at is not null`,
        ),
        "2",
      );
      assert.equal(
        await sql(`select status from public.jobs where id='${job}'`),
        "draft",
      );
      assert.equal(
        await sql(
          `select count(*) from public.chat_members m join public.chat_rooms r on r.id=m.room_id where r.job_id='${job}' and m.user_id='${teacher}' and m.removed_at is null`,
        ),
        "0",
      );
      await actor(
        teacher,
        `insert into public.personal_events(title,starts_at,ends_at) select 'Fictional now-free interval',starts_at,ends_at from public.assignment_sessions where claim_id='${c.claim_id}' order by starts_at limit 1`,
      );
      assert.equal(
        (await state(job, teacher, "aal1")).claims[0].status,
        "cancelled",
      );
    },
  );
  await check(
    "Repeated cancellation is idempotent; changed request payload cannot reuse its key",
    async () => {
      const job = await create(),
        c = await claim(job),
        key = randomUUID();
      await Promise.all(
        Array.from({ length: 5 }, () =>
          cancel(c.claim_id, teacher, "Fictional retry reason", key),
        ),
      );
      assert.equal(
        await sql(
          `select count(*) from public.claim_events where claim_id='${c.claim_id}' and event_type='cancelled'`,
        ),
        "1",
      );
      assert.equal(
        await sql(
          `select count(*) from public.notifications where resource_id='${c.claim_id}' and kind='claim_cancelled'`,
        ),
        "1",
      );
      await assert.rejects(
        cancel(c.claim_id, teacher, "Different retry reason", key),
        /idempotency conflict/,
      );
    },
  );
  await check(
    "Reopening requires a reason and cannot edit accepted history or silently use the legacy status API",
    async () => {
      const job = await create(),
        c = await claim(job);
      await cancel(c.claim_id);
      await assert.rejects(action(job, "reopen"), /reason/);
      await assert.rejects(
        action(job, "edit", { terms: "Changed accepted terms" }),
        /frozen/,
      );
      await assert.rejects(
        actor(
          admin,
          `select public.set_job_status('${job}','published')`,
          "aal2",
        ),
        /frozen/,
      );
      await action(job, "reopen", {
        reason: "Fictional replacement lecturer required",
      });
      const replacement = await claim(job, peer);
      assert.equal(replacement.status, "confirmed");
      assert.equal(
        await sql(
          `select count(*) from public.job_claims where job_id='${job}'`,
        ),
        "2",
      );
      assert.equal(
        await sql(
          `select count(*) from public.assignment_sessions s join public.job_claims c on c.id=s.claim_id where c.job_id='${job}'`,
        ),
        "4",
      );
      assert.equal(
        await sql(
          `select count(*) from public.chat_members m join public.chat_rooms r on r.id=m.room_id where r.job_id='${job}' and m.user_id='${peer}' and m.removed_at is null`,
        ),
        "1",
      );
    },
  );
  await check(
    "Own re-claim reactivates only the new course membership and old idempotency returns cancelled history",
    async () => {
      const job = await create(),
        key = randomUUID(),
        c = await claim(job, teacher, key);
      await cancel(c.claim_id);
      await action(job, "reopen", {
        reason: "Fictional confirmed availability again",
      });
      assert.equal((await claim(job, teacher, key)).status, "cancelled");
      assert.equal((await claim(job)).status, "confirmed");
      assert.equal(
        await sql(
          `select count(*) from public.chat_members m join public.chat_rooms r on r.id=m.room_id where r.job_id='${job}' and m.user_id='${teacher}' and m.removed_at is null`,
        ),
        "1",
      );
    },
  );
  await check(
    "Fifty competing reopened claims still yield one winner and an entire two-session block",
    async () => {
      const job = await create(),
        c = await claim(job);
      await cancel(c.claim_id);
      await action(job, "reopen", {
        reason: "Fictional concurrency review complete",
      });
      const results = await Promise.all(
        Array.from({ length: 50 }, (_, i) =>
          claim(job, i % 2 ? teacher : peer),
        ),
      );
      assert.equal(results.filter((x) => x.status === "confirmed").length, 1);
      assert.equal(results.filter((x) => x.status === "filled").length, 49);
      assert.equal(
        await sql(
          `select count(*) from public.assignment_sessions s join public.job_claims c on c.id=s.claim_id where c.job_id='${job}' and c.status='confirmed' and s.released_at is null`,
        ),
        "2",
      );
    },
  );
  await check(
    "Unaccepted text/deadline editing is versioned, rejects stale/nonfinite deadlines and reconsents changed terms",
    async () => {
      const job = await create(),
        original = await state(job);
      await action(job, "draft");
      await assert.rejects(
        action(
          job,
          "edit",
          { title: "Stale write" },
          randomUUID(),
          original.version,
        ),
        /40001/,
      );
      await assert.rejects(
        action(job, "edit", { claim_deadline: "infinity" }),
        /Deadline/,
      );
      await action(job, "edit", {
        title: "Reviewed fictional offer",
        terms: "Reviewed new terms",
        claim_deadline: "2038-12-01T12:00:00Z",
      });
      assert.equal(
        await sql(`select terms_version from public.jobs where id='${job}'`),
        "2",
      );
      await action(job, "published");
      assert.equal(
        JSON.parse(
          await actor(
            teacher,
            `select public.claim_job('${job}','${randomUUID()}',1)`,
          ),
        ).status,
        "terms_changed",
      );
    },
  );
  await check(
    "Safe duplicate is an idempotent unpublished new run without claims, chat or documents",
    async () => {
      const job = await create(),
        c = await claim(job),
        key = randomUUID(),
        v = (await state(job)).version;
      const duplicate = await action(
        job,
        "duplicate",
        { title: "Fictional clean duplicate" },
        key,
        v,
      );
      assert.equal(
        await action(
          job,
          "duplicate",
          { title: "Fictional clean duplicate" },
          key,
          v,
        ),
        duplicate,
      );
      assert.notEqual(duplicate, job);
      assert.equal(
        await sql(`select status from public.jobs where id='${duplicate}'`),
        "draft",
      );
      assert.equal(
        await sql(
          `select (a.course_run_id<>b.course_run_id)::text from public.jobs a,public.jobs b where a.id='${job}' and b.id='${duplicate}'`,
        ),
        "true",
      );
      for (const table of ["job_claims", "chat_rooms", "documents"])
        assert.equal(
          await sql(
            `select count(*) from public.${table} where job_id='${duplicate}'`,
          ),
          "0",
        );
      assert.equal(
        await sql(
          `select count(*) from public.job_sessions where job_id='${duplicate}'`,
        ),
        "2",
      );
      assert.equal((await state(job)).claims[0].id, c.claim_id);
    },
  );

  await check(
    "Commission cancellation and replacement retain immutable ledger history without doubling active client spend",
    async () => {
      const { amount, total_amount, ...offer } = payload();
      day += 3;
      const job = await actor(
        admin,
        `select public.create_commission_job(null,${quoteSql(JSON.stringify({ ...offer, gross_amount: amount * 2, gross_total_amount: total_amount * 2, requires_contract: false }))}::jsonb,50,'${randomUUID()}')`,
        "aal2",
      );
      const c = await claim(job);
      const before = await sql(
        `select to_jsonb(l)::text from private.claim_revenue_ledger l where claim_id='${c.claim_id}'`,
      );
      await cancel(c.claim_id);
      assert.equal(
        await sql(
          `select to_jsonb(l)::text from private.claim_revenue_ledger l where claim_id='${c.claim_id}'`,
        ),
        before,
      );
      const org = await sql(
        `select organisation_id from private.job_commission_offers where job_id='${job}'`,
      );
      const summary = async () =>
        JSON.parse(
          await actor(
            admin,
            `select to_jsonb(s)::text from public.client_spend_summary() s where organisation_id='${org}'`,
            "aal2",
          ),
        );
      assert.equal(Number((await summary()).assigned_count), 0);
      await action(job, "reopen", { reason: "Fictional replacement approved" });
      const next = await claim(job, peer);
      assert.equal(next.status, "confirmed");
      assert.equal(
        await sql(
          `select count(*) from private.claim_revenue_ledger where job_id='${job}'`,
        ),
        "2",
      );
      assert.equal(Number((await summary()).assigned_count), 1);
      assert.equal(Number((await summary()).gross_assigned_amount), 400);
      const report = JSON.parse(
        await actor(
          admin,
          `select coalesce(jsonb_agg(to_jsonb(r)),'[]') from public.commission_report('${org}') r`,
          "aal2",
        ),
      );
      assert.equal(report.length, 1);
      assert.equal(report[0].claim_id, next.claim_id);
    },
  );
  await check(
    "Started and invoiced work cannot be cancelled through the scheduling workflow",
    async () => {
      const job = await create(),
        c = await claim(job);
      await sql(
        `update public.assignment_sessions set starts_at=starts_at-interval '20 years',ends_at=ends_at-interval '20 years' where claim_id='${c.claim_id}'`,
      );
      await assert.rejects(cancel(c.claim_id), /Started work/);
      const job2 = await create(),
        c2 = await claim(job2),
        document = randomUUID(),
        version = randomUUID(),
        key = randomUUID();
      await sql(
        `insert into public.documents(id,owner_id,uploaded_by,scope,kind,original_name,mime_type,size_bytes,status,client_id) values('${document}','${teacher}','${teacher}','personal','invoice','Fictional.pdf','application/pdf',100,'clean','${key}');insert into public.document_versions(id,document_id,uploaded_by,client_id,version,object_path,original_name,mime_type,size_bytes,sha256,status) values('${version}','${document}','${teacher}','${key}',1,'${teacher}/${document}/${version}','Fictional.pdf','application/pdf',100,'${"1".repeat(64)}','clean');update public.documents set current_version_id='${version}' where id='${document}'`,
      );
      await actor(
        teacher,
        `select public.submit_invoice('Fictional lifecycle invoice',array['${c2.claim_id}'::uuid],'${version}',current_date,current_date+7,'${randomUUID()}')`,
      );
      await assert.rejects(cancel(c2.claim_id), /Invoiced work/);
      assert.equal((await state(job2)).claims[0].can_cancel, false);
    },
  );
  await check(
    "Invoice submission serializes with cancellation after its accepted-claim check",
    async () => {
      const prepareInvoice = async (claimId) => {
        const document = randomUUID(),
          version = randomUUID(),
          key = randomUUID();
        await sql(
          `insert into public.documents(id,owner_id,uploaded_by,scope,kind,original_name,mime_type,size_bytes,status,client_id) values('${document}','${teacher}','${teacher}','personal','invoice','Fictional race.pdf','application/pdf',100,'clean','${key}');insert into public.document_versions(id,document_id,uploaded_by,client_id,version,object_path,original_name,mime_type,size_bytes,sha256,status) values('${version}','${document}','${teacher}','${key}',1,'${teacher}/${document}/${version}','Fictional race.pdf','application/pdf',100,'${"2".repeat(64)}','clean');update public.documents set current_version_id='${version}' where id='${document}'`,
        );
        return () =>
          actor(
            teacher,
            `select public.submit_invoice('Fictional race invoice',array['${claimId}'::uuid],'${version}',current_date,current_date+7,'${randomUUID()}')`,
          );
      };
      const job = await create(),
        c = await claim(job),
        submit = await prepareInvoice(c.claim_id);
      // A disposable-database-only barrier pauses AFTER submit_invoice checked
      // confirmed work. A correct shared actor lock keeps cancellation waiting.
      await sql(
        `create function public.test_invoice_barrier() returns trigger language plpgsql as $$begin perform pg_sleep(3);return new;end$$;create trigger test_invoice_barrier before insert on public.invoices for each row execute function public.test_invoice_barrier()`,
      );
      try {
        const invoice = submit();
        let paused = false;
        for (let n = 0; n < 60; n++) {
          if (
            (await sql(
              `select exists(select 1 from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid() and wait_event='PgSleep')`,
            )) === "t"
          ) {
            paused = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        assert.equal(
          paused,
          true,
          "Invoice reached the controlled post-validation barrier",
        );
        const cancellation = cancel(c.claim_id);
        const [invoiceResult, cancelResult] = await Promise.allSettled([
          invoice,
          cancellation,
        ]);
        assert.equal(invoiceResult.status, "fulfilled");
        assert.equal(cancelResult.status, "rejected");
        assert.match(cancelResult.reason.message, /Invoiced work/);
        assert.equal(
          await sql(
            `select status from public.job_claims where id='${c.claim_id}'`,
          ),
          "confirmed",
        );
        assert.equal(
          await sql(
            `select count(*) from public.invoice_items where claim_id='${c.claim_id}'`,
          ),
          "1",
        );
      } finally {
        await sql(
          `drop trigger test_invoice_barrier on public.invoices;drop function public.test_invoice_barrier()`,
        );
      }
      const otherJob = await create(),
        other = await claim(otherJob),
        laterSubmit = await prepareInvoice(other.claim_id);
      await cancel(other.claim_id);
      await assert.rejects(laterSubmit(), /confirmed|accepted|eligible/i);
      assert.equal(
        await sql(
          `select count(*) from public.invoice_items where claim_id='${other.claim_id}'`,
        ),
        "0",
      );
    },
  );
});
console.log(`${checks} job lifecycle PostgreSQL checks passed.`);
