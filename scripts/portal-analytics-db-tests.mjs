/** Verify reports through authenticated callers on the fully migrated database. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

await withTestDatabase("portal_analytics", async ({ sql, actor }) => {
  const [instructor, other, client, outsider, manager, administrator, org, otherOrg,
    template, run, otherRun, document, version, invoice, customerInvoice, receipt, refund, contract, correction, lecturerPayment] =
    Array.from({ length: 20 }, randomUUID);
  const roles = [
    [instructor, "lecturer"], [other, "lecturer"], [client, "client"],
    [outsider, "participant"], [manager, "management"], [administrator, "admin"],
  ];

  await sql(`insert into auth.users(id,email)
    values ${roles.map(([id]) => `(${q(id)},${q(id + "@example.invalid")})`).join(",")};
    insert into public.user_roles(user_id,role)
    values ${roles.map(([id, role]) => `(${q(id)},${q(role)})`).join(",")};
    update public.profiles set time_zone='Europe/Berlin';
    insert into public.organisations(id,name,time_zone)
      values(${q(org)},'Fictional Berlin School','Europe/Berlin'),
            (${q(otherOrg)},'Fictional Brisbane School','Australia/Brisbane');
    insert into public.client_organisation_memberships(user_id,organisation_id) values(${q(client)},${q(org)});
    insert into public.course_templates(id,title) values(${q(template)},'Fictional course');
    insert into public.course_runs(id,template_id,organisation_id)
      values(${q(run)},${q(template)},${q(org)}),(${q(otherRun)},${q(template)},${q(otherOrg)});`);

  async function makeAssignment({ course = run, lecturer = instructor, currency = "EUR",
    net = 100, gross, starts, ends, state = "confirmed", released = false }) {
    const [job, claim] = [randomUUID(), randomUUID()];
    await sql(`insert into public.jobs(id,course_run_id,title,customer_name,delivery_type,status,amount,currency,rate_unit,total_amount,terms)
      values(${q(job)},${q(course)},'Fictional assignment','Fictional school','online','filled',${net},${q(currency)},'fixed_total',${net},'Fictional terms');
      insert into public.job_claims(id,job_id,lecturer_id,idempotency_key,status,amount,currency,rate_unit,total_amount,terms,terms_version)
      values(${q(claim)},${q(job)},${q(lecturer)},${q(randomUUID())},${q(state)},${net},${q(currency)},'fixed_total',${net},'Fictional terms',1);
      insert into public.assignment_sessions(claim_id,lecturer_id,starts_at,ends_at,released_at)
      values(${q(claim)},${q(lecturer)},${q(starts)},${q(ends)},${released ? "now()" : "null"});`);
    if (gross !== undefined) {
      const organisation = course === run ? org : otherOrg;
      await sql(`insert into private.claim_revenue_ledger(claim_id,job_id,organisation_id,lecturer_id,gross_amount,gross_total_amount,platform_percent,platform_total_amount,lecturer_net_amount,lecturer_net_total_amount,currency)
        values(${q(claim)},${q(job)},${q(organisation)},${q(lecturer)},${gross},${gross},50,${gross - net},${net},${net},${q(currency)});`);
    }
    return claim;
  }

  const claim = await makeAssignment({
    starts: "2026-03-31T21:30:00Z", ends: "2026-03-31T22:30:00Z", gross: 200,
  });
  await sql(`insert into public.assignment_sessions(claim_id,lecturer_id,starts_at,ends_at)
    values(${q(claim)},${q(instructor)},'2026-04-10T08:00:00Z','2026-04-10T09:00:00Z');`);
  await makeAssignment({
    course: otherRun, lecturer: other, net: 499.50, gross: 999,
    starts: "2026-04-11T08:00:00Z", ends: "2026-04-11T10:00:00Z",
  });
  await makeAssignment({ starts: "2026-04-12T08:00:00Z", ends: "2026-04-12T09:00:00Z", net: 0 });
  await makeAssignment({
    starts: "2026-04-13T08:00:00Z", ends: "2026-04-13T09:00:00Z", state: "cancelled", released: true, gross: 300,
  });
  await makeAssignment({
    starts: "2060-04-10T08:00:00Z", ends: "2060-04-10T10:00:00Z", net: 150, gross: 250, currency: "AUD",
  });
  await makeAssignment({
    starts: "2060-04-15T08:00:00Z", ends: "2060-04-15T09:00:00Z", net: 90, gross: 180, currency: "USD",
  });
  await sql(`with offer as (
    insert into public.jobs(course_run_id,title,customer_name,delivery_type,status,amount,currency,rate_unit,total_amount,terms,capacity,capacity_basis)
    values(${q(run)},'Fictional open offer','Fictional school','online','published',100,'AUD','fixed_total',100,'Fictional terms',3,'per_position')
    returning id
  )
  insert into public.job_sessions(job_id,starts_at,ends_at)
  select id,'2060-04-12T08:00:00Z','2060-04-12T10:00:00Z' from offer;

  insert into public.documents(id,owner_id,uploaded_by,scope,kind,original_name,mime_type,size_bytes,status,client_id)
    values(${q(document)},${q(instructor)},${q(instructor)},'personal','invoice','Fictional invoice.pdf','application/pdf',100,'clean',${q(randomUUID())});
  insert into public.document_versions(id,document_id,uploaded_by,client_id,version,object_path,original_name,mime_type,size_bytes,sha256,status)
    values(${q(version)},${q(document)},${q(instructor)},${q(randomUUID())},1,${q(instructor + "/" + version)},'Fictional invoice.pdf','application/pdf',100,${q("b".repeat(64))},'clean');
  insert into public.invoices(id,user_id,number,issued_on,due_on,currency,total_amount,document_version_id,client_id)
    values(${q(invoice)},${q(instructor)},'Fictional-1','2026-04-12','2026-04-30','EUR',100,${q(version)},${q(randomUUID())});
  insert into public.payment_records(id,invoice_id,amount,currency,paid_at,recorded_by,client_id,voided_at,voided_by)
    values(${q(lecturerPayment)},${q(invoice)},75,'EUR','2026-04-16T10:00Z',${q(administrator)},${q(randomUUID())},null,null),
      (${q(randomUUID())},${q(invoice)},25,'EUR','2026-04-17T10:00Z',${q(administrator)},${q(randomUUID())},now(),${q(administrator)});
  insert into private.accounting_customer_invoices(id,organisation_id,registered_by,number,issued_on,due_on,currency,total_amount,accepted_charge_total,difference_reason,claim_references,document_id,document_version_id,document_sha256)
    values(${q(customerInvoice)},${q(org)},${q(administrator)},'Fictional customer 1','2026-04-12','2026-04-30','EUR',200,200,'','[]',${q(document)},${q(version)},${q("b".repeat(64))});
  insert into private.accounting_customer_payments(id,invoice_id,amount,paid_at,reference,recorded_by)
    values(${q(receipt)},${q(customerInvoice)},60,'2026-04-18T10:00Z','Fictional receipt',${q(administrator)});
  insert into private.accounting_customer_payments(invoice_id,amount,paid_at,reference,recorded_by,reverses_id)
    values(${q(customerInvoice)},60,'2026-05-05T10:00Z','Fictional reversal',${q(administrator)},${q(receipt)});
  insert into private.accounting_customer_refunds(id,invoice_id,amount,refunded_at,reference,recorded_by)
    values(${q(refund)},${q(customerInvoice)},20,'2026-04-26T10:00Z','Fictional refund',${q(administrator)});
  insert into private.accounting_customer_refunds(invoice_id,amount,reference,recorded_by,reverses_id,created_at)
    values(${q(customerInvoice)},20,'Fictional refund reversal',${q(administrator)},${q(refund)},'2026-05-06T10:00Z');
  insert into public.contracts(id,user_id,status,effective_from,version)
    values(${q(contract)},${q(instructor)},'active','2026-01-01T00:00Z',1);
  insert into private.invoice_series_corrections(id,claim_id,contract_id,contract_version,currency,reviewed_total,credited,credited_payment_ids,basis,due_on,note,proposed_by,client_id,responded_at,accepted)
    values(${q(correction)},${q(claim)},${q(contract)},1,'EUR',65,75,array[${q(lecturerPayment)}::uuid],'{}','2026-05-31','Fictional accepted correction',${q(administrator)},${q(randomUUID())},'2026-05-01T10:00Z',true);
  insert into private.invoice_series_repayments(correction_id,amount,received_on,reference,recorded_by,client_id)
    values(${q(correction)},10,'2026-05-10','Fictional repayment',${q(administrator)},${q(randomUUID())});`);

  const call = (who, expression) =>
    actor(who, `select public.${expression}`, "aal1").then(JSON.parse);
  const access = (who) => call(who, "analytics_access()");
  const report = (who, scope, organisation = null, from = "2026-03-01", until = "2026-06-01") =>
    call(who, `analytics_report(${q(scope)},${q(from)},${q(until)},${organisation ? q(organisation) : "null"})`);

  assert.deepEqual((await access(client)).organisations.map(({ id }) => id), [org]);
  assert.equal((await access(instructor)).personal, true);
  assert.equal((await access(administrator)).personal, false);
  assert.equal((await access(manager)).staff, true);
  assert.equal((await access(outsider)).organisations.length, 0);
  await assert.rejects(report(client, "company", otherOrg), /42501/);
  await assert.rejects(report(client, "company"), /42501/);
  await assert.rejects(report(client, "staff"), /42501/);
  await assert.rejects(report(instructor, "staff"), /42501/);
  await assert.rejects(report(administrator, "personal"), /42501/);
  await assert.rejects(report(outsider, "personal"), /42501/);
  await assert.rejects(report(instructor, "personal", org), /22023/);
  await assert.rejects(report(administrator, "staff", null, "2026-01-01", "2029-01-01"), /22023/);
  assert.equal(await sql("select has_function_privilege('anon','public.analytics_report(text,date,date,uuid)','EXECUTE')"), "f");

  const own = await report(instructor, "personal");
  assert.deepEqual(own.months.map(({ past_minutes }) => past_minutes), [30, 150, 0]);
  assert.deepEqual(own.months.map(({ past_assignments }) => past_assignments), [1, 1, 0]);
  assert.deepEqual(own.months.map(({ currencies }) => currencies.EUR.past_net), [100, 0, 0]);
  assert.deepEqual(own.months.map(({ currencies }) => currencies.EUR.lecturer_cash), [0, 75, -10]);
  assert.equal(own.months[0].currencies.EUR.past_gross, null);

  const clipped = await report(instructor, "personal", null, "2026-04-01", "2026-04-02");
  assert.equal(clipped.months[0].past_minutes, 30);
  assert.equal(clipped.months[0].past_assignments, 0);

  const company = await report(client, "company", org);
  assert.deepEqual(company.months.map(({ currencies }) => currencies.EUR.past_gross), [200, 0, 0]);
  assert.deepEqual(company.months.map(({ currencies }) => currencies.EUR.customer_cash), [0, 40, -40]);
  assert.equal(company.months[1].currencies.EUR.missing_gross, 1);
  assert.equal(company.months[0].currencies.EUR.past_net, null);
  assert.equal(company.months[1].currencies.EUR.lecturer_cash, null);

  const all = await report(administrator, "staff");
  assert.equal(all.months[1].currencies.EUR.past_gross, 999);
  assert.equal(all.months[1].past_minutes, 270);
  const filtered = await report(administrator, "staff", otherOrg);
  assert.equal(filtered.months[1].currencies.EUR.past_net, 499.50);
  assert.equal(filtered.months[1].currencies.EUR.lecturer_cash, null);
  assert.ok(filtered.months.every(({ currencies }) => currencies.EUR.customer_cash === 0));

  const future = await report(administrator, "staff", org, "2060-04-01", "2060-05-01");
  assert.equal(future.months[0].open_positions, 3);
  assert.equal(future.months[0].future_minutes, 180);
  assert.equal(future.months[0].future_assignments, 2);
  assert.equal(future.months[0].currencies.AUD.future_net, 150);
  assert.equal(future.months[0].currencies.AUD.future_gross, 250);
  assert.equal(future.months[0].currencies.EUR.future_gross, 0);
  assert.equal(future.months[0].currencies.USD.future_net, 90);
  assert.equal(future.months[0].currencies.USD.future_gross, 180);

  await sql("delete from public.role_permissions where role='management' and permission in ('finance.manage','finance.gross.read')");
  const operational = await report(manager, "staff");
  assert.equal(operational.can_model_pipeline, false);
  assert.equal(operational.months[0].currencies.EUR.past_net, null);
  assert.equal(operational.months[0].currencies.EUR.past_gross, null);

  await sql(`update public.client_organisation_memberships set removed_at=now() where user_id=${q(client)}`);
  await assert.rejects(report(client, "company", org), /42501/);
  assert.deepEqual((await access(client)).organisations, []);
  console.log("PASS Role-scoped analytics, currency isolation, date clipping and recorded payments.");
});

await withTestDatabase("portal_analytics_academy", async ({ sql, actor }) => {
  const admin = randomUUID();
  await sql(`select private.provision_customer_installation(${q(randomUUID())},'customer-self-hosted');
    insert into auth.users(id,email) values(${q(admin)},'fictional-admin@example.invalid');
    insert into public.user_roles(user_id,role) values(${q(admin)},'admin');`);
  const access = JSON.parse(await actor(admin, "select public.analytics_access()"));
  assert.deepEqual(access, { personal: false, staff: false, time_zone: null, organisations: [] });
  await assert.rejects(
    actor(admin, "select public.analytics_report('staff','2026-04-01','2026-05-01')"),
    /42501/,
  );
  console.log("PASS Internal brokerage analytics are denied in the dedicated Academy edition.");
});
