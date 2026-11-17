/** Real disposable PostgreSQL delivery evidence, permissions and concurrency. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { withTestDatabase, quoteSql as q } from "./testing/database.mjs";

await withTestDatabase("delivery", async ({ sql, actor }) => {
  const [teacher, peer, admin, client, otherClient, suspended] = Array.from(
    { length: 6 },
    randomUUID,
  );
  const org = randomUUID(),
    foreignOrg = randomUUID();
  const rpc = async (who, name, args = [], aal = "aal1") =>
    JSON.parse(
      await actor(who, `select public.${name}(${args.join(",")})`, aal),
    );
  let checks = 0;
  const check = async (name, run) => {
    await run();
    checks++;
    console.log(`PASS ${name}`);
  };
  await sql(`insert into auth.users(id,email) values ${[teacher, peer, admin, client, otherClient, suspended].map((id) => `(${q(id)},${q(id + "@example.invalid")})`).join(",")};
    insert into public.user_roles(user_id,role) values(${q(teacher)},'lecturer'),(${q(peer)},'lecturer'),(${q(admin)},'admin'),(${q(client)},'client'),(${q(otherClient)},'client'),(${q(suspended)},'lecturer');
    insert into public.organisations(id,name) values(${q(org)},'Fictional delivery customer'),(${q(foreignOrg)},'Fictional isolated customer');
    insert into public.client_organisation_memberships(user_id,organisation_id) values(${q(client)},${q(org)}),(${q(otherClient)},${q(foreignOrg)});`);
  let day = 1;
  async function assignment(who = teacher, organisation = org, future = false) {
    const [template, run, job, claim, session] = Array.from(
      { length: 5 },
      randomUUID,
    );
    const start = new Date(
        Date.UTC(future ? 2039 : 2001, 0, day++, 9),
      ).toISOString(),
      end = new Date(new Date(start).getTime() + 3600000).toISOString();
    await sql(`insert into public.course_templates(id,title) values(${q(template)},'Fictional delivery course');
      insert into public.course_runs(id,template_id,organisation_id) values(${q(run)},${q(template)},${q(organisation)});
      insert into public.jobs(id,course_run_id,title,customer_name,delivery_type,status,location,amount,currency,rate_unit,total_amount,terms) values(${q(job)},${q(run)},'Fictional delivery block','Fictional delivery customer','online','filled','https://example.invalid/class',100,'AUD','fixed_total',100,'Immutable fictional deal');
      insert into public.job_claims(id,job_id,lecturer_id,idempotency_key,amount,currency,rate_unit,total_amount,terms,terms_version) values(${q(claim)},${q(job)},${q(who)},${q(randomUUID())},100,'AUD','fixed_total',100,'Immutable fictional deal',1);
      insert into public.assignment_sessions(id,claim_id,lecturer_id,starts_at,ends_at) values(${q(session)},${q(claim)},${q(who)},${q(start)},${q(end)});`);
    return { job, claim, session, start, end };
  }
  const a = await assignment(),
    b = await assignment(),
    foreign = await assignment(peer, foreignOrg),
    future = await assignment(teacher, org, true);
  const draft = (f, extra = {}) => ({
    outcome: "completed",
    actual_start: f.start,
    actual_end: f.end,
    time_zone: "Europe/Berlin",
    notes: "Fictional internal delivery notes",
    correction_reason: "",
    ...extra,
  });
  const save = (
    f,
    payload = draft(f),
    version = 0,
    who = teacher,
    key = randomUUID(),
  ) =>
    rpc(who, "save_delivery_draft", [
      q(f.session),
      String(version),
      q(JSON.stringify(payload)) + "::jsonb",
      q(key),
    ]);
  const submit = (f, version, key = randomUUID(), who = teacher) =>
    rpc(who, "submit_delivery", [q(f.session), String(version), q(key)]);
  const review = (
    f,
    version,
    action = "confirm",
    note = "Reviewed fictional evidence",
    who = admin,
    aal = "aal1",
    key = randomUUID(),
  ) =>
    rpc(
      who,
      "review_delivery",
      [q(f.session), String(version), q(action), q(note), q(key)],
      aal,
    );
  const list = (who = teacher, scope = "own", aal = "aal1") =>
    rpc(who, "delivery_sessions", [q(scope)], aal);

  await check(
    "Private tables, anonymous API and foreign session reads are denied",
    async () => {
      for (const table of [
        "delivery_records",
        "delivery_submissions",
        "delivery_events",
        "delivery_operations",
      ]) {
        assert.equal(
          await sql(
            `select relrowsecurity from pg_class where oid='private.${table}'::regclass`,
          ),
          "t",
        );
        await assert.rejects(
          actor(teacher, `select * from private.${table}`),
          /permission denied/,
        );
      }
      assert.equal(
        await sql(
          "select has_function_privilege('anon','public.delivery_sessions(text,timestamptz,uuid,integer)','execute')",
        ),
        "f",
      );
      await assert.rejects(
        rpc(peer, "delivery_history", [q(a.session)]),
        /42501/,
      );
      await assert.rejects(list(peer, "management"), /42501/);
      await assert.rejects(list(admin, "management"), /42501/);
      assert.equal((await list()).items.length, 3);
      assert.equal((await list(client, "customer")).items.length, 0);
    },
  );
  await check(
    "Own draft persists, forged identities/unknown fields and actual times reject",
    async () => {
      for (const payload of [
        draft(a, { user_id: peer }),
        draft(a, { actual_end: a.start }),
        draft(a, { actual_start: "infinity" }),
        draft(a, { time_zone: "Invalid/Zone" }),
        draft(a, { outcome: "partial", notes: "" }),
        draft(a, { outcome: "cancelled" }),
      ])
        await assert.rejects(save(a, payload), /22023/);
      await assert.rejects(save(a, draft(a), 0, peer), /42501/);
      const saved = await save(a);
      assert.equal(saved.version, 1);
      assert.equal(saved.draft.notes, "Fictional internal delivery notes");
    },
  );
  let submission;
  const invoice = randomUUID();
  let invoiceBefore;
  await check(
    "Immutable submission, exact response-loss retry and request-key conflict",
    async () => {
      const key = randomUUID();
      const submitted = await submit(a, 1, key);
      submission = submitted.submission.id;
      assert.equal(submitted.status, "submitted");
      assert.equal(submitted.actual_minutes, 60);
      assert.deepEqual(await submit(a, 1, key), submitted);
      await assert.rejects(submit(a, 2, key), /22023/);
      await assert.rejects(save(a, draft(a), 2), /22023/);
      await assert.rejects(
        sql(
          `update private.delivery_submissions set notes='tampered' where id=${q(submission)}`,
        ),
        /55000/,
      );
      await assert.rejects(
        sql(
          `delete from private.delivery_submissions where id=${q(submission)}`,
        ),
        /55000/,
      );
      assert.equal(
        await sql(
          `select count(*) from public.notifications where kind='delivery_submitted' and resource_id in(select id from private.delivery_events where session_id=${q(a.session)})`,
        ),
        "1",
      );
    },
  );
  await check(
    "Review requires independent current manager and permission; one simultaneous CAS winner",
    async () => {
      await assert.rejects(review(a, 2, "confirm", "", peer), /42501/);
      await assert.rejects(review(a, 2, "confirm", "", admin, "aal1"), /42501/);
      const results = await Promise.allSettled([review(a, 2), review(a, 2)]);
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      assert.match(
        results.find((r) => r.status === "rejected").reason.message,
        /40001/,
      );
      const confirmed = (await list()).items.find(
        (r) => r.session_id === a.session,
      );
      assert.equal(confirmed.status, "confirmed");
      assert.equal(confirmed.version, 3);
    },
  );
  await check(
    "Delivery links an existing immutable invoice without altering its amount or PDF",
    async () => {
      const document = randomUUID(),
        version = randomUUID(),
        request = randomUUID();
      await sql(`insert into public.documents(id,owner_id,uploaded_by,scope,kind,original_name,mime_type,size_bytes,status,client_id) values(${q(document)},${q(teacher)},${q(teacher)},'personal','invoice','Fictional invoice.pdf','application/pdf',100,'clean',${q(request)});
        insert into public.document_versions(id,document_id,uploaded_by,client_id,version,object_path,original_name,mime_type,size_bytes,sha256,status) values(${q(version)},${q(document)},${q(teacher)},${q(request)},1,${q("fictional-delivery/" + version)},'Fictional invoice.pdf','application/pdf',100,${q("b".repeat(64))},'clean');
        update public.documents set current_version_id=${q(version)} where id=${q(document)};
        insert into public.invoices(id,user_id,number,issued_on,due_on,currency,total_amount,document_version_id,client_id) values(${q(invoice)},${q(teacher)},'FICTIONAL-DELIVERY-001','2001-01-01','2001-02-01','AUD',100,${q(version)},${q(randomUUID())});
        insert into public.invoice_items(invoice_id,claim_id) values(${q(invoice)},${q(a.claim)});`);
      invoiceBefore = await sql(
        `select to_jsonb(i)::text from public.invoices i where id=${q(invoice)}`,
      );
      assert.equal(
        (await rpc(teacher, "delivery_session", [q(a.session)])).invoice_id,
        invoice,
      );
      assert.equal(
        (await rpc(client, "delivery_session", [q(a.session)])).invoice_id,
        null,
      );
    },
  );
  await check(
    "Customer confirms only own organisation without internal notes or finance",
    async () => {
      const visible = (await list(client, "customer")).items;
      assert.equal(visible.length, 1);
      assert.equal(visible[0].draft, null);
      assert.equal(visible[0].submission.notes, null);
      assert.equal(visible[0].invoice_id, null);
      assert.equal((await list(otherClient, "customer")).items.length, 0);
      await assert.rejects(
        rpc(otherClient, "confirm_customer_delivery", [
          q(a.session),
          "3",
          q(randomUUID()),
        ]),
        /42501/,
      );
      const key = randomUUID();
      const result = await rpc(client, "confirm_customer_delivery", [
        q(a.session),
        "3",
        q(key),
      ]);
      assert.equal(result.customer_confirmed, true);
      assert.equal(result.version, 4);
      assert.deepEqual(
        await rpc(client, "confirm_customer_delivery", [
          q(a.session),
          "3",
          q(key),
        ]),
        result,
      );
      const history = await rpc(client, "delivery_history", [q(a.session)]);
      assert.equal(history.submissions[0].notes, null);
      assert.ok(history.events.every((e) => e.note === null));
      assert.ok(!JSON.stringify(history).includes("internal"));
    },
  );
  await check(
    "Correction has reason, new revision and original approved evidence survives",
    async () => {
      await review(
        a,
        4,
        "request_correction",
        "Please explain fictional interruption",
      );
      await assert.rejects(save(a, draft(a), 5), /22023/);
      await save(
        a,
        draft(a, {
          outcome: "partial",
          actual_end: new Date(
            new Date(a.start).getTime() + 1800000,
          ).toISOString(),
          correction_reason: "Corrected actual teaching time",
        }),
        5,
      );
      const corrected = await submit(a, 6);
      assert.equal(corrected.submission.revision, 2);
      assert.equal(corrected.actual_minutes, 30);
      const history = await rpc(teacher, "delivery_history", [q(a.session)]);
      assert.equal(history.submissions.length, 2);
      assert.equal(history.submissions[1].id, submission);
      assert.equal(history.submissions[1].outcome, "completed");
      assert.ok(
        history.events.some(
          (e) => e.action === "confirmed" && e.submission_id === submission,
        ),
      );
      assert.equal((await list(client, "customer")).items.length, 0);
      await review(a, 7);
      assert.equal(
        (await list()).items.find((r) => r.session_id === a.session)
          .customer_confirmed,
        false,
      );
    },
  );
  await check(
    "Partial, cancelled and interrupted outcomes retain truthful actual minutes",
    async () => {
      await save(
        b,
        draft(b, {
          outcome: "cancelled",
          actual_start: null,
          actual_end: null,
          notes: "Customer cancelled fictional class",
        }),
      );
      const cancelled = await submit(b, 1);
      assert.equal(cancelled.actual_minutes, 0);
      assert.equal(cancelled.submission.outcome, "cancelled");
      await review(b, 2, "dispute", "Please verify fictional cancellation");
      await save(
        b,
        draft(b, {
          outcome: "interrupted",
          notes: "Fictional connection interruption",
          correction_reason: "Partial teaching did take place",
        }),
        3,
      );
      assert.equal((await submit(b, 4)).submission.outcome, "interrupted");
      await assert.rejects(review(b, 5, "request_correction", "x"), /22023/);
    },
  );
  await check(
    "Concurrent first drafts, stale writes and pagination are deterministic",
    async () => {
      const f = await assignment();
      const writes = await Promise.allSettled([save(f), save(f)]);
      assert.equal(writes.filter((r) => r.status === "fulfilled").length, 1);
      assert.match(
        writes.find((r) => r.status === "rejected").reason.message,
        /40001/,
      );
      const page = await rpc(teacher, "delivery_sessions", [
        q("own"),
        "null",
        "null",
        "2",
      ]);
      assert.equal(page.items.length, 2);
      assert.equal(page.has_more, true);
      const last = page.items.at(-1);
      const next = await rpc(teacher, "delivery_sessions", [
        q("own"),
        q(last.scheduled_start),
        q(last.session_id),
        "2",
      ]);
      assert.ok(
        !next.items.some((r) =>
          page.items.some((p) => p.session_id === r.session_id),
        ),
      );
      await assert.rejects(
        rpc(teacher, "delivery_sessions", [q("own"), q(a.start), "null", "2"]),
        /22023/,
      );
    },
  );
  await check(
    "Future evidence cannot be submitted; suspended actors and revoked memberships fail",
    async () => {
      await save(future);
      await assert.rejects(submit(future, 1), /22023/);
      await sql(
        `update public.client_organisation_memberships set removed_at=now() where user_id=${q(client)}`,
      );
      assert.equal((await list(client, "customer")).items.length, 0);
      await assert.rejects(
        rpc(client, "delivery_history", [q(a.session)]),
        /42501/,
      );
      await sql(
        `update public.profiles set active=false where id=${q(teacher)}`,
      );
      await assert.rejects(list(), /42501/);
      await assert.rejects(
        rpc(teacher, "delivery_history", [q(a.session)]),
        /42501/,
      );
      await sql(
        `update public.profiles set active=true where id=${q(teacher)}`,
      );
    },
  );
  await check(
    "Cancelled/released assignments retain own history and refuse new submissions",
    async () => {
      await sql(
        `update public.job_claims set status='cancelled' where id=${q(b.claim)};update public.assignment_sessions set released_at=now() where claim_id=${q(b.claim)}`,
      );
      const item = (await list()).items.find((r) => r.session_id === b.session);
      assert.equal(item.can_edit, false);
      assert.equal(
        (await rpc(teacher, "delivery_history", [q(b.session)])).submissions
          .length,
        2,
      );
      await assert.rejects(save(b, draft(b), 5), /42501/);
    },
  );
  await check(
    "Delivery never changes accepted money, currency, terms or arbitrary claim access",
    async () => {
      const c = JSON.parse(
        await sql(
          `select to_jsonb(c) from public.job_claims c where id=${q(a.claim)}`,
        ),
      );
      assert.equal(c.currency, "AUD");
      assert.equal(c.total_amount, 100);
      assert.equal(c.terms, "Immutable fictional deal");
      assert.equal(c.terms_version, 1);
      assert.equal(
        await sql(
          `select to_jsonb(i)::text from public.invoices i where id=${q(invoice)}`,
        ),
        invoiceBefore,
      );
      await assert.rejects(
        rpc(teacher, "delivery_history", [q(foreign.session)]),
        /42501/,
      );
      const managed = await list(admin, "management", "aal1");
      assert.ok(managed.items.some((r) => r.session_id === foreign.session));
      assert.ok(!JSON.stringify(managed).includes("Immutable fictional deal"));
    },
  );
  console.log(`PASS ${checks} real delivery PostgreSQL groups`);
});
