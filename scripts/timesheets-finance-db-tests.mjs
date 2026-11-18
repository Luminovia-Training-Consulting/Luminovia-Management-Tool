/** Real PostgreSQL evidence: hours, immutable fee facts and scoped operations. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  applyPasswordOnlyPermissionPolicy,
  withTestDatabase,
  quoteSql as q,
} from "./testing/database.mjs";

await withTestDatabase(
  "timesheets_finance",
  async ({ sql, actor }) => {
    await applyPasswordOnlyPermissionPolicy(sql);
    const [teacher, peer, manager, admin] = Array.from(
      { length: 4 },
      randomUUID,
    );
    await sql(`insert into auth.users(id,email) values${[teacher, peer, manager, admin].map((id) => `(${q(id)},${q(`${id}@example.invalid`)})`).join(",")};
  insert into public.user_roles(user_id,role) values(${q(teacher)},'lecturer'),(${q(peer)},'lecturer'),(${q(manager)},'management'),(${q(admin)},'admin');
  update public.profiles set display_name='Fictional finance actor',time_zone='UTC';`);
    const rpc = (who, name, args = [], aal = "aal1") =>
      actor(who, `select public.${name}(${args.join(",")})`, aal).then(
        JSON.parse,
      );
    const call = (who, name, args = [], aal = "aal1") =>
      actor(who, `select public.${name}(${args.join(",")})`, aal);
    const range = [q("2020-01-01"), q("2020-02-01")];
    let checks = 0;
    const check = async (name, run) => {
      await run();
      checks++;
      console.log(`PASS ${name}`);
    };
    const fixture = async (who, day, currency = "EUR", amount = 300) => {
      const job = randomUUID(),
        claim = randomUUID(),
        session = randomUUID(),
        start = `2020-01-${String(day).padStart(2, "0")}T08:00:00Z`,
        end = `2020-01-${String(day).padStart(2, "0")}T16:00:00Z`;
      await sql(`insert into public.jobs(id,title,customer_name,delivery_type,status,amount,total_amount,currency,rate_unit,terms) values(${q(job)},'Fictional time ledger course','Fictional academy','online','filled',${amount},${amount},${q(currency)},'fixed_total','Immutable accepted compensation regardless of actual hours');
   insert into public.job_claims(id,job_id,lecturer_id,idempotency_key,amount,total_amount,currency,rate_unit,terms,terms_version) values(${q(claim)},${q(job)},${q(who)},${q(randomUUID())},${amount},${amount},${q(currency)},'fixed_total','Immutable accepted compensation regardless of actual hours',1);
   insert into public.assignment_sessions(id,claim_id,lecturer_id,starts_at,ends_at) values(${q(session)},${q(claim)},${q(who)},${q(start)},${q(end)});`);
      return { job, claim, session, start, end };
    };
    const first = await fixture(teacher, 3),
      foreign = await fixture(peer, 3, "AUD", 401);
    const payload = (f, changes = {}) => ({
      session_id: f.session,
      starts_at: f.start,
      ends_at: f.end,
      break_minutes: 30,
      note: "Fictional completed teaching",
      ...changes,
    });
    const save = (who, id, f, version = 0, changes = {}) =>
      rpc(who, "save_timesheet", [
        q(id),
        q(JSON.stringify(payload(f, changes))),
        version,
      ]);
    const manage = (
      who,
      id,
      action,
      version,
      key = randomUUID(),
      reason = "",
      aal = "aal1",
    ) =>
      rpc(
        who,
        "manage_timesheet",
        [q(id), q(action), version, q(key), q(reason)],
        aal,
      );
    const invoice = async (claims) => {
      const document = randomUUID(),
        version = randomUUID(),
        key = randomUUID();
      await sql(`insert into public.documents(id,owner_id,uploaded_by,scope,kind,original_name,mime_type,size_bytes,status,client_id) values(${q(document)},${q(teacher)},${q(teacher)},'personal','invoice','Fictional time invoice.pdf','application/pdf',100,'clean',${q(key)});
   insert into public.document_versions(id,document_id,uploaded_by,client_id,version,object_path,original_name,mime_type,size_bytes,sha256,status) values(${q(version)},${q(document)},${q(teacher)},${q(key)},1,${q(`${teacher}/${document}/${version}`)},'Fictional time invoice.pdf','application/pdf',100,${q("1".repeat(64))},'clean');update public.documents set current_version_id=${q(version)} where id=${q(document)};`);
      return call(teacher, "submit_invoice", [
        q(`Fictional time ${randomUUID()}`),
        `array[${claims.map((id) => q(id) + "::uuid").join(",")}]`,
        q(version),
        "current_date",
        "current_date+7",
        q(randomUUID()),
      ]);
    };
    let id = randomUUID(),
      current;
    await check(
      "Only own completed accepted sessions accept exact time fields; future, foreign, nonfinite and invented authority are denied",
      async () => {
        for (const changes of [
          { ends_at: "infinity" },
          { starts_at: "2019-12-31T00:00:00Z" },
          { break_minutes: 480 },
          { break_minutes: 1.5 },
          { lecturer_id: peer },
          { state: "approved" },
        ])
          await assert.rejects(save(teacher, id, first, 0, changes), /22023/);
        await assert.rejects(save(peer, id, first), /42501/);
        await assert.rejects(save(teacher, randomUUID(), foreign), /42501/);
        current = await save(teacher, id, first);
        assert.equal(current.minutes, 450);
        assert.equal(current.version, 1);
        assert.equal(current.state, "draft");
        assert.deepEqual(await save(teacher, id, first), current);
        await assert.rejects(
          actor(admin, "select * from private.teaching_timesheets", "aal1"),
          /permission denied/,
        );
      },
    );
    await check(
      "CAS edits have one real concurrent winner and cannot create a second timesheet for a session",
      async () => {
        const replies = await Promise.allSettled([
          save(teacher, id, first, 1, { note: "Fictional edit A" }),
          save(teacher, id, first, 1, { note: "Fictional edit B" }),
        ]);
        assert.equal(
          replies.filter((x) => x.status === "fulfilled").length,
          1,
          replies
            .filter((x) => x.status === "rejected")
            .map((x) => x.reason.message)
            .join("\n"),
        );
        assert.match(
          replies.find((x) => x.status === "rejected").reason.message,
          /40001/,
        );
        current = replies.find((x) => x.status === "fulfilled").value;
        assert.equal(current.version, 2);
        await assert.rejects(save(teacher, randomUUID(), first), /23505/);
      },
    );
    await check(
      "Submit/review require current actor/permission and exact version, with idempotent action receipts",
      async () => {
        const key = randomUUID();
        current = await manage(teacher, id, "submit", current.version, key);
        assert.equal(current.state, "submitted");
        assert.deepEqual(await manage(teacher, id, "submit", 2, key), current);
        await assert.rejects(
          manage(teacher, id, "approve", current.version),
          /42501/,
        );
        await assert.rejects(
          manage(peer, id, "submit", current.version),
          /42501/,
        );
        current = await manage(
          manager,
          id,
          "approve",
          current.version,
          randomUUID(),
          "Fictional reviewed hours",
          "aal1",
        );
        assert.equal(current.state, "approved");
        await assert.rejects(
          save(teacher, id, first, current.version, {
            note: "Forbidden approved edit",
          }),
          /22023/,
        );
        const history = await rpc(teacher, "timesheet_history", [q(id)]);
        assert.equal(history.filter((h) => h.action === "submit").length, 1);
        assert.equal(history.at(-1).after_state.state, "approved");
      },
    );
    await check(
      "Approved corrections require explicit finance reason and retain the original approval evidence",
      async () => {
        const approved = await rpc(teacher, "timesheet_history", [q(id)]);
        await assert.rejects(
          manage(
            manager,
            id,
            "request_correction",
            current.version,
            randomUUID(),
            "bad",
            "aal1",
          ),
          /22023/,
        );
        current = await manage(
          manager,
          id,
          "request_correction",
          current.version,
          randomUUID(),
          "Fictional documented correction required",
          "aal1",
        );
        assert.equal(current.state, "rejected");
        current = await save(teacher, id, first, current.version, {
          break_minutes: 45,
          note: "Corrected actual break",
        });
        assert.equal(current.minutes, 435);
        const history = await rpc(teacher, "timesheet_history", [q(id)]);
        assert.deepEqual(
          history.filter((h) => h.action === "approve"),
          approved.filter((h) => h.action === "approve"),
        );
        await assert.rejects(rpc(peer, "timesheet_history", [q(id)]), /42501/);
      },
    );
    await check(
      "Own and finance scopes stay separate; a saved time change never reprices accepted compensation",
      async () => {
        const own = await rpc(teacher, "timesheets", [...range, "false"]);
        assert.equal(own.items.length, 1);
        assert.equal(own.items[0].lecturer_id, teacher);
        assert.equal(
          (await rpc(peer, "timesheets", [...range, "false"])).items.length,
          0,
        );
        await assert.rejects(
          rpc(admin, "timesheets", [...range, "true"]),
          /42501/,
        );
        const all = await rpc(
          manager,
          "timesheets",
          [...range, "true"],
          "aal1",
        );
        assert.equal(all.items.length, 1);
        assert.equal(
          await sql(
            `select total_amount from public.job_claims where id=${q(first.claim)}`,
          ),
          "300.00",
        );
        assert.ok(!JSON.stringify(all).includes("platform_percent"));
      },
    );
    await check(
      "Printable assignment and earnings facts are stable-hashed, owned and original-currency separated",
      async () => {
        const confirmation = await rpc(teacher, "assignment_confirmation", [
          q(first.claim),
        ]);
        assert.match(confirmation.hash, /^[a-f0-9]{64}$/);
        assert.deepEqual(
          await rpc(teacher, "assignment_confirmation", [q(first.claim)]),
          confirmation,
        );
        assert.equal(confirmation.data.total_amount, 300);
        assert.equal(confirmation.data.sessions.length, 1);
        await assert.rejects(
          rpc(peer, "assignment_confirmation", [q(first.claim)]),
          /42501/,
        );
        await assert.rejects(
          rpc(admin, "assignment_confirmation", [q(first.claim)]),
          /42501/,
        );
        assert.equal(
          (
            await rpc(
              admin,
              "assignment_confirmation",
              [q(first.claim)],
              "aal1",
            )
          ).hash,
          confirmation.hash,
        );
        const own = await rpc(teacher, "finance_statement", [
          ...range,
          "false",
        ]);
        assert.equal(own.data.claims.length, 1);
        assert.equal(own.data.totals[0].currency, "EUR");
        assert.ok(!JSON.stringify(own).includes("gross"));
        assert.deepEqual(
          await rpc(teacher, "finance_statement", [...range, "false"]),
          own,
        );
        const all = await rpc(
          manager,
          "finance_statement",
          [...range, "true"],
          "aal1",
        );
        assert.deepEqual(
          new Set(all.data.totals.map((t) => t.currency)),
          new Set(["EUR", "AUD"]),
        );
        assert.ok(!JSON.stringify(all).includes("platform_percent"));
      },
    );
    await check(
      "Invoiced work is frozen even after cancellation of the invoice, while approved summaries remain evidence only",
      async () => {
        current = await manage(teacher, id, "submit", current.version);
        current = await manage(
          manager,
          id,
          "approve",
          current.version,
          randomUUID(),
          "Fictional corrected approval",
          "aal1",
        );
        const statement = await rpc(teacher, "finance_statement", [
          ...range,
          "false",
        ]);
        assert.equal(statement.data.approved_minutes[0].minutes, 435);
        const inv = await invoice([first.claim]);
        await assert.rejects(
          manage(
            manager,
            id,
            "request_correction",
            current.version,
            randomUUID(),
            "Fictional too late correction",
            "aal1",
          ),
          /22023/,
        );
        await sql(
          `update public.invoice_items set active=false where invoice_id=${q(inv)};update public.invoices set status='cancelled' where id=${q(inv)}`,
        );
        await assert.rejects(
          manage(
            manager,
            id,
            "request_correction",
            current.version,
            randomUUID(),
            "Still must not rewrite invoice history",
            "aal1",
          ),
          /22023/,
        );
        assert.equal(
          (await rpc(teacher, "timesheets", [...range, "false"])).items[0]
            .state,
          "approved",
        );
      },
    );
    await check(
      "Invoice payments allocate exact original-currency cents without rounding drift or hidden conversion",
      async () => {
        const parts = await Promise.all(
          [8, 9, 10].map((day) => fixture(teacher, day, "EUR", 1)),
        );
        const inv = await invoice(parts.map((f) => f.claim));
        await call(
          manager,
          "review_invoice",
          [q(inv), q("approved"), q("Fictional original-currency approval")],
          "aal1",
        );
        await call(
          manager,
          "record_invoice_payment",
          [
            q(inv),
            "0.01",
            "now()",
            q("Fictional one-cent partial payment"),
            q(randomUUID()),
          ],
          "aal1",
        );
        const allocations = await Promise.all(
          parts.map((f) =>
            sql(`select private.claim_paid_amount(${q(f.claim)})`),
          ),
        );
        assert.equal(
          allocations.reduce(
            (sum, value) => sum + Math.round(Number(value) * 100),
            0,
          ),
          1,
        );
        assert.ok(
          allocations.every((value) => [0, 0.01].includes(Number(value))),
        );
        const statement = await rpc(teacher, "finance_statement", [
          ...range,
          "false",
        ]);
        assert.equal(
          statement.data.totals.find((t) => t.currency === "EUR").paid,
          0.01,
        );
      },
    );
    await check(
      "Forecast requires finance permission, separates known costs/gross and labels lecturer payment records",
      async () => {
        await assert.rejects(
          rpc(teacher, "finance_forecast", [...range, "0.5"]),
          /42501/,
        );
        await assert.rejects(
          rpc(admin, "finance_forecast", [...range, "0.5"]),
          /42501/,
        );
        const limited = await rpc(
          manager,
          "finance_forecast",
          [...range, "0.5"],
          "aal1",
        );
        assert.equal(limited.gross_authorized, false);
        assert.ok(limited.months.every((m) => m.accepted_gross_known === null));
        assert.equal(limited.payment_basis, "lecturer_invoice_payment_records");
        const full = await rpc(
          admin,
          "finance_forecast",
          [...range, "0.5"],
          "aal1",
        );
        assert.equal(full.gross_authorized, true);
        assert.ok(full.months.some((m) => m.currency === "AUD"));
        assert.ok(full.months.some((m) => m.unknown_gross_claims > 0));
        for (const probability of ["-1", "2", q("NaN")])
          await assert.rejects(
            rpc(admin, "finance_forecast", [...range, probability], "aal1"),
            /22023/,
          );
      },
    );
    await check(
      "Control Center uses current management scope and never bypasses private task/message ownership",
      async () => {
        const privateTask = randomUUID(),
          shared = randomUUID();
        await sql(`insert into private.work_tasks(id,creator_id,assignee_id,scope,title,state,due_at,client_id,request_payload) values
   (${q(privateTask)},${q(peer)},${q(peer)},'private','PRIVATE peer calendar-derived task','open','2020-01-15T10:00:00Z',${q(randomUUID())},'{}'),
   (${q(shared)},${q(manager)},${q(manager)},'operations','Fictional shared overdue task','open','2020-01-15T10:00:00Z',${q(randomUUID())},'{}');`);
        await assert.rejects(rpc(teacher, "control_center", range), /42501/);
        await assert.rejects(rpc(admin, "control_center", range), /42501/);
        const center = await rpc(manager, "control_center", range, "aal1");
        assert.ok(center.overdue_tasks.some((t) => t.id === shared));
        assert.ok(!JSON.stringify(center).includes(privateTask));
        assert.ok(!JSON.stringify(center).includes("PRIVATE"));
        assert.ok(Array.isArray(center.preparation));
        assert.ok(Array.isArray(center.quality));
      },
    );
    await check(
      "An independent database exclusion prevents overlapping hours even outside the RPC form",
      async () => {
        const other = await fixture(teacher, 5);
        await assert.rejects(
          sql(
            `insert into private.teaching_timesheets(id,session_id,lecturer_id,starts_at,ends_at) values(${q(randomUUID())},${q(other.session)},${q(teacher)},${q(first.start)},${q(first.end)})`,
          ),
          /23P01/,
        );
      },
    );
    await check(
      "Original-currency future scenario probability changes known open costs without inventing gross prices",
      async () => {
        const job = randomUUID();
        await sql(
          `insert into public.jobs(id,title,customer_name,delivery_type,status,amount,total_amount,currency,rate_unit,terms) values(${q(job)},'Fictional open scenario','Fictional client','online','published',201,201,'EUR','fixed_total','Fictional offer');insert into public.job_sessions(job_id,starts_at,ends_at) values(${q(job)},now()+interval '7 days',now()+interval '7 days 6 hours')`,
        );
        const dates = [
          q(await sql("select current_date::text")),
          q(await sql("select (current_date+30)::text")),
        ];
        const zero = await rpc(
            manager,
            "finance_forecast",
            [...dates, "0"],
            "aal1",
          ),
          scenario = await rpc(
            manager,
            "finance_forecast",
            [...dates, "0.25"],
            "aal1",
          );
        assert.equal(
          zero.months.reduce(
            (sum, m) => sum + m.pipeline_lecturer_cost_known,
            0,
          ),
          0,
        );
        assert.equal(
          scenario.months.reduce(
            (sum, m) => sum + m.pipeline_lecturer_cost_known,
            0,
          ),
          50.25,
        );
        assert.ok(
          scenario.months.every((m) => m.pipeline_gross_known === null),
        );
      },
    );
    await check(
      "Quality aggregates hide averages below three replies and never expose feedback text or identity",
      async () => {
        const template = randomUUID(),
          run = randomUUID();
        await sql(`insert into public.course_templates(id,title) values(${q(template)},'Fictional quality course');insert into public.course_runs(id,template_id) values(${q(run)},${q(template)});insert into public.course_sessions(course_run_id,starts_at,ends_at) values(${q(run)},'2020-01-20T08:00:00Z','2020-01-20T16:00:00Z');
          insert into private.course_feedback(run_id,user_id,kind,rating,comment) values(${q(run)},${q(teacher)},'participant',4,'PRIVATE fictional feedback A'),(${q(run)},${q(peer)},'participant',4,'PRIVATE fictional feedback B');`);
        const hidden = (
          await rpc(manager, "control_center", range, "aal1")
        ).quality.find((row) => row.run_id === run);
        assert.equal(hidden.responses, 2);
        assert.equal(hidden.average_rating, null);
        await sql(
          `insert into private.course_feedback(run_id,user_id,kind,rating,comment) values(${q(run)},${q(admin)},'participant',4,'PRIVATE fictional feedback C')`,
        );
        const visible = (
          await rpc(manager, "control_center", range, "aal1")
        ).quality.find((row) => row.run_id === run);
        assert.equal(visible.average_rating, 4);
        assert.ok(!JSON.stringify(visible).includes("PRIVATE"));
        assert.ok(!JSON.stringify(visible).includes(teacher));
      },
    );
    await check(
      "All financial periods are finite, exclusive and bounded; anonymous/inactive actors stay denied",
      async () => {
        for (const dates of [
          [q("2020-01-01"), q("2020-01-01")],
          [q("-infinity"), q("2020-02-01")],
          [q("2020-01-01"), q("2021-01-01")],
        ])
          await assert.rejects(
            rpc(teacher, "finance_statement", [...dates, "false"]),
            /22023/,
          );
        assert.equal(
          (
            await rpc(teacher, "timesheets", [
              q("2020-01-04"),
              q("2020-01-05"),
              "false",
            ])
          ).items.length,
          0,
        );
        assert.equal(
          await sql(
            "select has_function_privilege('anon','public.finance_statement(date,date,boolean)','execute')",
          ),
          "f",
        );
        await sql(
          `update public.profiles set active=false where id=${q(teacher)}`,
        );
        await assert.rejects(
          rpc(teacher, "finance_statement", [...range, "false"]),
          /42501/,
        );
        await assert.rejects(
          rpc(teacher, "timesheets", [...range, "false"]),
          /42501/,
        );
      },
    );
    console.log(
      `${checks} timesheet/finance/control-center PostgreSQL groups passed.`,
    );
  },
  { migrationsThrough: "20261116091017" },
);
