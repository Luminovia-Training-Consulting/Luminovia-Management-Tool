/**
 * Exercises consent, immutable snapshots and invoice composition against the
 * full migration history in a disposable local database with fictional actors.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

await withTestDatabase(
  "consented_assignment_amendments",
  async ({ sql, actor }) => {
    const [
      admin,
      lecturer,
      other,
      client,
      otherClient,
      organisation,
      template,
      run,
      courseSession,
      anotherCourseSession,
      topic,
    ] = Array.from({ length: 11 }, randomUUID);
    const actors = [
      [admin, "admin"],
      [lecturer, "lecturer"],
      [other, "lecturer"],
      [client, "client"],
      [otherClient, "client"],
    ];
    await sql(`
        insert into auth.users(id,email,email_confirmed_at)
        values ${actors.map(([id, role], index) => `(${q(id)},${q(role + index + "@example.invalid")},now())`).join(",")};
        insert into public.user_roles(user_id,role)
        values ${actors.map(([id, role]) => `(${q(id)},${q(role)})`).join(",")};
        insert into public.organisations(id,name) values(${q(organisation)},'Fictional academy');
        insert into public.client_organisation_memberships(organisation_id,user_id)
          values(${q(organisation)},${q(client)}),(${q(organisation)},${q(otherClient)});
        insert into public.course_templates(id,title,description)
          values(${q(template)},'Fictional workshop','Fictional workshop description');
        insert into public.course_runs(id,template_id,organisation_id) values(${q(run)},${q(template)},${q(organisation)});
        insert into public.course_sessions(id,course_run_id,starts_at,ends_at)
          values(${q(courseSession)},${q(run)},now()+interval '10 days',now()+interval '10 days 1 hour'),
                (${q(anotherCourseSession)},${q(run)},now()+interval '11 days',now()+interval '11 days 1 hour');
        insert into public.topics(id,label_de,label_en,kind)
          values(${q(topic)},'Fiktives Thema','Fictional topic','topic');
        insert into public.lecturer_topics(user_id,topic_id,verified)
          values(${q(lecturer)},${q(topic)},false);
    `);

    /** Read or mutate exclusively using the public authenticated contracts. */
    const rpc = async (who, name, parameters = [], rows = false) => {
      const args = parameters
        .map((value) => {
          if (value === null) return "null";
          if (Array.isArray(value)) return q(`{${value.join(",")}}`);
          if (typeof value === "number" || typeof value === "boolean")
            return String(value);
          return q(typeof value === "object" ? JSON.stringify(value) : value);
        })
        .join(",");
      const call = `public.${name}(${args})`;
      const query = rows
        ? `select coalesce(jsonb_agg(result),'[]'::jsonb) from ${call} result`
        : `select to_jsonb(${call})`;
      return JSON.parse(await actor(who, query));
    };
    /** Use real claims for isolated linked and standalone offers. */
    async function offer(linked) {
      const job = randomUUID();
      await sql(`
            insert into public.jobs(id,course_run_id,title,customer_name,delivery_type,status,
              amount,total_amount,currency,rate_unit,terms,created_by)
            values(${q(job)},${linked ? q(run) : "null"},'Fictional teaching block',
              'Fictional academy','onsite','published',100,100,'AUD','fixed_total',
              'Original accepted terms',${q(admin)});
            ${
              linked
                ? `insert into public.job_sessions(job_id,course_session_id,starts_at,ends_at)
                   select ${q(job)},id,starts_at,ends_at from public.course_sessions where course_run_id=${q(run)}`
                : `insert into public.job_sessions(job_id,starts_at,ends_at)
                   values(${q(job)},now()+interval '5 days',now()+interval '5 days 1 hour')`
            };
            insert into public.job_requirements(job_id,topic_id) values(${q(job)},${q(topic)});
        `);
      if (linked) {
        // Capture a real role-based quote and accepted revenue row for the company.
        await actor(
          admin,
          `select public.set_job_commission(${q(job)},300,300,null)`,
        );
      }
      const termsVersion = Number(
        await sql(
          linked
            ? `select private.role_quote_version(terms_version,${q(lecturer)}) from public.jobs where id=${q(job)}`
            : `select terms_version from public.jobs where id=${q(job)}`,
        ),
      );
      const claim = await rpc(lecturer, "claim_job", [
        job,
        randomUUID(),
        termsVersion,
      ]);
      assert.equal(claim.status, "confirmed");
      return { job, claim: claim.claim_id };
    }
    const standalone = await offer(false);
    const linked = await offer(true);
    const draft = (who, claim, changes, key = randomUUID()) =>
      rpc(who, "save_assignment_change", [
        null,
        claim,
        { reason: "Fictional change reason", changes },
        0,
        key,
      ]);
    const current = async (id, who = admin) =>
      (await rpc(who, "assignment_changes", [id]))[0];
    const advance = async (
      id,
      action,
      who,
      { key = randomUUID(), version, note = "" } = {},
    ) =>
      rpc(who, "assignment_change_action", [
        id,
        action,
        version ?? (await current(id)).version,
        note,
        key,
      ]);

    const next = new Date(Date.now() + 7 * 86400000).toISOString();
    const nextEnd = new Date(Date.parse(next) + 3600000).toISOString();
    const changes = {
      location: "Fictional venue",
      terms: "Jointly accepted revised terms ".repeat(300).trim(),
      amount: 125,
      total_amount: 125,
      sessions: [{ starts_at: next, ends_at: nextEnd }],
    };
    const original = await sql(
      `select to_jsonb(c) from public.job_claims c where id=${q(standalone.claim)}`,
    );
    const key = randomUUID();
    const amendment = await draft(admin, standalone.claim, changes, key);
    assert.equal(await draft(admin, standalone.claim, changes, key), amendment);
    await assert.rejects(
      draft(admin, standalone.claim, { ...changes, amount: 126 }, key),
      /retry conflict/,
    );
    await assert.rejects(current(amendment, other), /42501/);
    await advance(amendment, "submit", admin);
    await advance(amendment, "accept", admin);
    await assert.rejects(
      advance(amendment, "apply", admin),
      /Independent management and lecturer acceptance/,
    );
    await advance(amendment, "accept", lecturer);
    const proofKey = randomUUID(),
      proofVersion = (await current(amendment)).version;
    assert.equal(
      await advance(amendment, "apply", admin, {
        key: proofKey,
        version: proofVersion,
      }),
      amendment,
    );
    assert.equal(
      await advance(amendment, "apply", admin, {
        key: proofKey,
        version: proofVersion,
      }),
      amendment,
    );
    assert.equal((await current(amendment)).status, "applied");
    assert.equal(
      await sql(
        `select to_jsonb(c) from public.job_claims c where id=${q(standalone.claim)}`,
      ),
      original,
    );
    assert.equal(
      await sql(`select count(*) from private.assignment_session_supersessions x
        join public.assignment_sessions s on s.id=x.session_id where s.claim_id=${q(standalone.claim)} and s.released_at is not null`),
      "1",
    );
    assert.equal(
      await sql(
        `select count(*) from public.assignment_sessions where claim_id=${q(standalone.claim)} and released_at is null and starts_at=${q(next)}`,
      ),
      "1",
    );
    console.log(
      "PASS independent consent, exact idempotency, archived sessions and original claim preservation",
    );

    const earnings = (
      await rpc(lecturer, "finance_earnings", [false], true)
    ).find((entry) => entry.claim_id === standalone.claim);
    assert.equal(earnings.total_amount, 125);
    assert.equal(earnings.currency, "AUD");
    assert.equal(earnings.invoice_review_required, false);
    assert.equal(Date.parse(earnings.invoice_eligible_at), Date.parse(nextEnd));
    const document = randomUUID(),
      version = randomUUID(),
      clientId = randomUUID(),
      invoiceKey = randomUUID();
    await sql(`
        insert into public.documents(id,owner_id,uploaded_by,scope,kind,original_name,mime_type,size_bytes,status,client_id)
          values(${q(document)},${q(lecturer)},${q(lecturer)},'personal','invoice','Fictional invoice.pdf','application/pdf',100,'clean',${q(clientId)});
        insert into public.document_versions(id,document_id,uploaded_by,client_id,version,object_path,original_name,mime_type,size_bytes,sha256,status)
          values(${q(version)},${q(document)},${q(lecturer)},${q(clientId)},1,'fixture/invoice.pdf','Fictional invoice.pdf','application/pdf',100,repeat('a',64),'clean');
        update public.documents set current_version_id=${q(version)} where id=${q(document)};
    `);
    const issued = new Date().toISOString().slice(0, 10);
    const input = [
      "AMEND-1",
      [standalone.claim],
      version,
      issued,
      null,
      invoiceKey,
    ];
    await assert.rejects(
      rpc(lecturer, "submit_invoice", input),
      /invoice_not_ready/,
    );
    // Advance only the current scheduled fixture, leaving actual superseded evidence in the future.
    await sql(`
        update public.assignment_sessions set starts_at=now()-interval '2 hours',ends_at=now()-interval '1 hour'
          where claim_id=${q(standalone.claim)} and released_at is null;
        update public.job_sessions set starts_at=now()-interval '2 hours',ends_at=now()-interval '1 hour'
          where job_id=${q(standalone.job)};
    `);
    const invoice = await rpc(lecturer, "submit_invoice", input);
    assert.equal(await rpc(lecturer, "submit_invoice", input), invoice);
    assert.equal(
      await sql(`select i.total_amount||'|'||i.currency||'|'||(i.due_on-i.issued_on)||'|'||(a.change_id=${q(amendment)})
        from public.invoices i join public.invoice_items item on item.invoice_id=i.id
        join private.assignment_amendments a on a.id=item.amendment_id where i.id=${q(invoice)}`),
      "125.00|AUD|30|true",
    );
    console.log(
      "PASS current schedule invoice eligibility, immutable amendment link, original currency and due-date default",
    );

    // A company can propose an operational change in its own course. Sibling
    // contacts never receive that request, and term/fee changes remain private.
    await assert.rejects(draft(client, linked.claim, { amount: 1 }), /42501/);
    await assert.rejects(
      draft(client, linked.claim, { sessions: changes.sessions }),
      /must keep its session count/,
    );
    const linkedRows = () =>
      sql(`
      select jsonb_agg(jsonb_build_object('offer',j.id,'course',s.id,
          'starts_at',s.starts_at,'ends_at',s.ends_at,'matched',s.starts_at=j.starts_at and s.ends_at=j.ends_at)
        order by j.starts_at)
      from public.job_sessions j join public.course_sessions s on s.id=j.course_session_id
      where j.job_id=${q(linked.job)}
    `).then(JSON.parse);
    const originals = await linkedRows();
    const moveByDay = (row) => ({
      starts_at: new Date(Date.parse(row.starts_at) + 86400000).toISOString(),
      ends_at: new Date(Date.parse(row.ends_at) + 86400000).toISOString(),
    });
    // The first destination is the old second slot. Both existing IDs must
    // survive and the immediate job-session exclusion must still be enforced.
    const moved = originals.map(moveByDay);
    const companyChange = await draft(client, linked.claim, {
      location: "Fictional company venue",
      sessions: moved,
    });
    assert.equal(
      (await current(companyChange, client)).schedule_editable,
      true,
    );
    assert.equal((await current(companyChange, client)).original.amount, null);
    assert.equal((await current(companyChange, client)).original.terms, null);
    await assert.rejects(current(companyChange, otherClient), /42501/);
    await advance(companyChange, "submit", client);
    await assert.rejects(advance(companyChange, "accept", client), /42501/);
    await advance(companyChange, "accept", lecturer);
    await advance(companyChange, "accept", admin);
    await advance(companyChange, "apply", admin);
    assert.equal(
      await sql(`select venue from public.course_runs where id=${q(run)}`),
      "Fictional company venue",
    );
    const rescheduled = await linkedRows();
    assert.deepEqual(
      rescheduled.map(({ offer, course }) => [offer, course]),
      originals.map(({ offer, course }) => [offer, course]),
    );
    assert.deepEqual(
      rescheduled.map((row) => [
        Date.parse(row.starts_at),
        Date.parse(row.ends_at),
        row.matched,
      ]),
      moved.map((row) => [
        Date.parse(row.starts_at),
        Date.parse(row.ends_at),
        true,
      ]),
    );
    assert.equal(
      await sql(`select count(*) from public.assignment_sessions s
      join private.assignment_session_supersessions x on x.session_id=s.id
      where s.claim_id=${q(linked.claim)} and s.released_at is not null`),
      "2",
    );
    console.log(
      "PASS company-scoped same-count rescheduling preserves course and job identities through a slot collision",
    );

    const delayed = await draft(admin, linked.claim, {
      sessions: rescheduled.map(moveByDay),
    });
    await advance(delayed, "submit", admin);
    await advance(delayed, "accept", admin);
    await advance(delayed, "accept", lecturer);
    await sql(`insert into private.course_attendance_audit(session_id,user_id,actor_id,new_state,reason)
      values(${q(courseSession)},${q(other)},${q(admin)},'{"state":"absent"}','Fictional retained correction')`);
    await assert.rejects(
      advance(delayed, "apply", admin),
      /dependent records or another owner/,
    );
    assert.equal((await current(delayed)).schedule_editable, false);
    assert.deepEqual(await linkedRows(), rescheduled);
    assert.equal(
      await sql(
        `select count(*) from private.course_attendance_audit where session_id=${q(courseSession)}`,
      ),
      "1",
    );
    console.log(
      "PASS evidence arriving after consent blocks the schedule move and retains its original record",
    );

    const revenueBefore = await sql(
      `select to_jsonb(r) from private.claim_revenue_ledger r where claim_id=${q(linked.claim)}`,
    );
    const excessive = await draft(lecturer, linked.claim, {
      amount: 301,
      total_amount: 301,
    });
    await advance(excessive, "submit", lecturer);
    await advance(excessive, "accept", lecturer);
    await assert.rejects(
      advance(excessive, "accept", admin),
      /exceeds the unchanged customer charge/,
    );
    const margin = await draft(lecturer, linked.claim, {
      amount: 170,
      total_amount: 170,
    });
    await advance(margin, "submit", lecturer);
    await advance(margin, "accept", lecturer);
    await advance(margin, "accept", admin);
    await advance(margin, "apply", admin);
    assert.equal(
      await sql(
        `select to_jsonb(r) from private.claim_revenue_ledger r where claim_id=${q(linked.claim)}`,
      ),
      revenueBefore,
    );
    assert.equal(
      await sql(
        `select total_amount from public.jobs where id=${q(linked.job)}`,
      ),
      "0.00",
    );
    const [report] = await rpc(
      admin,
      "commission_report",
      [organisation],
      true,
    );
    assert.equal(report.gross_total_amount, 300);
    assert.equal(report.lecturer_net_total_amount, 170);
    assert.equal(report.platform_total_amount, 130);
    const dateAfter = (days) =>
      new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
    const forecast = await rpc(admin, "finance_forecast", [
      dateAfter(8),
      dateAfter(12),
      0,
    ]);
    const [month] = forecast.months;
    assert.equal(month.accepted_lecturer_cost, 170);
    assert.equal(month.accepted_gross_known, 300);
    assert.equal(month.accepted_margin_known, 130);
    console.log(
      "PASS commissioned amendments preserve gross and raw offer prices, and feed current reporting and forecasts",
    );
  },
);
