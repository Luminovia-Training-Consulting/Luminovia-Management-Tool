import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

await withTestDatabase("accounting_credit_notes", async ({ sql, actor }) => {
  const [finance, secondFinance, teacher, manager, customer, org] = Array.from(
    { length: 6 },
    randomUUID,
  );
  const accounts = [
    [finance, "admin"],
    [secondFinance, "admin"],
    [teacher, "lecturer"],
    [manager, "management"],
    [customer, "client"],
  ];
  await sql(`
    insert into auth.users(id,email) values ${accounts.map(([id]) => `(${q(id)},${q(id + "@example.invalid")})`).join(",")};
    insert into public.user_roles(user_id,role) values ${accounts.map(([id, role]) => `(${q(id)},${q(role)})`).join(",")};
    insert into public.organisations(id,name) values(${q(org)},'Fictional credit note customer');
    insert into public.client_organisation_memberships(user_id,organisation_id) values (${q(customer)},${q(org)});
  `);
  async function rpc(who, name, args = []) {
    return JSON.parse(
      await actor(who, `select public.${name}(${args.join(",")})`),
    );
  }
  async function pdf(owner, status = "clean", sameHash) {
    const document = randomUUID(),
      version = randomUUID(),
      key = randomUUID();
    const sha = sameHash ?? createHash("sha256").update(document).digest("hex");
    await sql(`
      insert into public.documents(id,owner_id,uploaded_by,scope,kind,original_name,mime_type,size_bytes,status,client_id)
        values(${q(document)},${q(owner)},${q(owner)},'personal','material','Fictional evidence.pdf','application/pdf',100,${q(status)},${q(key)});
      insert into public.document_versions(id,document_id,uploaded_by,client_id,version,object_path,original_name,mime_type,size_bytes,sha256,status)
        values(${q(version)},${q(document)},${q(owner)},${q(key)},1,${q(owner + "/" + version)},'Fictional evidence.pdf','application/pdf',100,${q(sha)},${q(status)});
      update public.documents set current_version_id=${q(version)} where id=${q(document)};
    `);
    return { document, version, sha };
  }
  async function invoice(number) {
    const job = randomUUID(),
      claim = randomUUID(),
      evidence = await pdf(finance);
    await sql(`
      insert into public.jobs(id,title,customer_name,delivery_type,status,amount,total_amount,currency,rate_unit,terms)
        values(${q(job)},'Fictional contract','Fictional credit note customer','online','filled',50.00,50.00,'AUD','fixed_total','Confirmed fictional terms');
      insert into public.job_claims(id,job_id,lecturer_id,idempotency_key,amount,total_amount,currency,rate_unit,terms,terms_version)
        values(${q(claim)},${q(job)},${q(teacher)},${q(randomUUID())},50.00,50.00,'AUD','fixed_total','Confirmed fictional terms',1);
      insert into private.claim_revenue_ledger(claim_id,job_id,organisation_id,lecturer_id,gross_amount,gross_total_amount,platform_percent,
        platform_total_amount,lecturer_net_amount,lecturer_net_total_amount,currency)
        values(${q(claim)},${q(job)},${q(org)},${q(teacher)},100.00,100.00,50,50.00,50.00,50.00,'AUD');
    `);
    const receipt = await rpc(finance, "register_customer_invoice", [
      q(
        JSON.stringify({
          claim_ids: [claim],
          number,
          issued_on: "2020-02-01",
          due_on: "2020-03-01",
          currency: "AUD",
          total_amount: "100.00",
          document_version_id: evidence.version,
          difference_reason: "",
        }),
      ),
      q(randomUUID()),
    ]);
    return { ...receipt, evidence, claim };
  }
  const original = await invoice("Fictional INV-01");
  const other = await invoice("Fictional INV-02");
  const payload = (file, extra = {}) => ({
    reference: "Fictional CR-01",
    issued_on: "2020-03-20",
    currency: "AUD",
    amount: "12.03",
    reason: "Fictional issued adjustment",
    document_version_id: file.version,
    issued_and_reviewed: true,
    ...extra,
  });
  const register = (who, input, key = randomUUID(), id = original.id) =>
    rpc(who, "register_customer_credit_note", [
      q(id),
      q(JSON.stringify(input)),
      q(key),
    ]);
  const history = (who, id = original.id, cursor = ["null", "null", "40"]) =>
    rpc(who, "accounting_customer_credit_notes", [q(id), ...cursor]);
  const getExport = () =>
    rpc(finance, "create_accounting_export", [
      q("customer"),
      `array[${q(original.id)}]::uuid[]`,
      q(randomUUID()),
    ]);
  const acceptedCharge = () =>
    sql(
      `select to_jsonb(ledger) from private.claim_revenue_ledger ledger where claim_id=${q(original.claim)}`,
    );
  const privatePdf = await pdf(finance);
  for (const who of [teacher, manager, customer]) {
    await assert.rejects(history(who), /42501/);
    await assert.rejects(register(who, payload(privatePdf)), /42501/);
  }
  await assert.rejects(history(finance, randomUUID()), /42501/);
  assert.equal(
    await sql(
      `select has_function_privilege('anon','public.register_customer_credit_note(uuid,jsonb,uuid)','execute')`,
    ),
    "f",
  );
  assert.equal(
    await sql(
      `select relrowsecurity from pg_class where oid='private.accounting_customer_credit_notes'::regclass`,
    ),
    "t",
  );
  await assert.rejects(
    actor(teacher, "select * from private.accounting_customer_credit_notes"),
    /permission denied/,
  );
  console.log(
    "PASS invoice and PDF evidence commands require current gross-finance authority",
  );

  for (const invalid of [
    { issued_and_reviewed: false },
    { amount: "0.00" },
    { amount: "12.034" },
    { amount: 12.03 },
    { currency: "EUR" },
    { issued_on: "2019-12-01" },
    { issued_on: "2020-02-31" },
    { issued_on: "2999-01-01" },
    { reason: "" },
    { document_version_id: "wrong" },
    { bank_ref: "must not be accepted" },
  ]) {
    await assert.rejects(
      register(finance, payload(privatePdf, invalid)),
      /22023/,
    );
  }
  await assert.rejects(
    register(finance, payload(await pdf(finance, "quarantined"))),
    /42501/,
  );
  await assert.rejects(
    register(finance, payload(await pdf(secondFinance))),
    /42501/,
  );
  await assert.rejects(register(finance, payload(original.evidence)), /42501/);
  await assert.rejects(
    register(
      finance,
      payload(await pdf(finance, "clean", original.evidence.sha)),
    ),
    /cannot be reused/,
  );
  const attached = await pdf(finance);
  const course = randomUUID(),
    template = randomUUID();
  await sql(`
    insert into public.course_templates(id,title) values(${q(template)},'Fictional booklet');
    insert into public.course_runs(id,template_id,organisation_id) values(${q(course)},${q(template)},${q(org)});
    insert into private.course_resources(run_id,version_id,audience,category,created_by)
      values(${q(course)},${q(attached.version)},'all','material',${q(finance)});
  `);
  await assert.rejects(
    register(finance, payload(attached)),
    /previous attachments/,
  );
  console.log(
    "PASS only positive original-currency evidence with an exact dedicated clean PDF is registerable",
  );

  await rpc(finance, "record_customer_invoice_payment", [
    q(original.id),
    q("100.00"),
    q("2020-03-01T00:00:00Z"),
    q("Fictional payment"),
    q(randomUUID()),
  ]);
  const before = await getExport(),
    accepted = await acceptedCharge();
  const key = randomUUID();
  const first = await register(finance, payload(privatePdf), key);
  assert.deepEqual(await register(finance, payload(privatePdf), key), first);
  await assert.rejects(
    register(
      finance,
      payload(privatePdf, { reason: "A different filed reason" }),
      key,
    ),
    /request key conflict/,
  );
  const record = (await history(secondFinance)).items[0];
  assert.equal(record.id, first.id);
  assert.equal(record.invoice_id, original.id);
  assert.equal(record.currency, "AUD");
  assert.equal(record.amount, "12.03");
  assert.equal(record.document_version_id, privatePdf.version);
  assert.equal(record.document_sha256, privatePdf.sha);
  assert.equal(await acceptedCharge(), accepted);
  assert.deepEqual(await getExport(), before);
  assert.equal(before.invoices[0].paid_total, "100.00");
  assert.equal(before.invoices[0].outstanding_total, "0.00");
  assert.equal(before.invoices[0].credit_note_reference, null);
  assert.equal(
    await sql(
      `select count(*) from public.audit_events where action='accounting.customer_credit_note_registered' and resource_id=${q(first.id)}`,
    ),
    "1",
  );
  console.log(
    "PASS evidence can link a paid invoice without changing balances, exports, taxes or accepted charges",
  );

  await assert.rejects(
    register(
      finance,
      payload(await pdf(finance), { reference: "fictional cr-01" }),
      randomUUID(),
      other.id,
    ),
    /23505/,
  );
  const jobs = await Promise.all([pdf(finance), pdf(secondFinance)]);
  const attempts = await Promise.allSettled(
    jobs.map((file, index) =>
      register(
        index === 0 ? finance : secondFinance,
        payload(file, {
          reference: `Fictional concurrent ${index}`,
          amount: "60.00",
        }),
      ),
    ),
  );
  assert.equal(
    attempts.filter((result) => result.status === "fulfilled").length,
    1,
  );
  assert.match(
    attempts.find((result) => result.status === "rejected").reason.message,
    /exceed the original/,
  );
  const page = await history(finance, original.id, ["null", "null", "1"]);
  assert.equal(page.has_more, true);
  const next = await history(finance, original.id, [
    q(page.items[0].created_at),
    q(page.items[0].id),
    "1",
  ]);
  assert.equal(next.items[0].id, first.id);
  assert.equal(next.has_more, false);
  await assert.rejects(
    history(finance, original.id, ["null", q(first.id), "1"]),
    /Invalid customer credit note page cursor/,
  );
  console.log(
    "PASS concurrent credits cannot exceed the invoice total and reference/cursor boundaries hold",
  );

  assert.equal(
    await actor(
      secondFinance,
      `select count(*) from public.document_versions where id=${q(privatePdf.version)}`,
    ),
    "1",
  );
  for (const who of [teacher, manager, customer]) {
    assert.equal(
      await actor(
        who,
        `select count(*) from public.document_versions where id=${q(privatePdf.version)}`,
      ),
      "0",
    );
  }
  await assert.rejects(
    sql(
      `update public.documents set original_name='changed.pdf' where id=${q(privatePdf.document)}`,
    ),
    /immutable/,
  );
  await assert.rejects(
    sql(
      `update public.document_versions set sha256=${q("b".repeat(64))} where id=${q(privatePdf.version)}`,
    ),
    /immutable/,
  );
  await assert.rejects(
    sql(
      `delete from private.accounting_customer_credit_notes where id=${q(first.id)}`,
    ),
    /immutable/,
  );
  assert.equal(
    await sql(
      `select private.course_document_is_dedicated(${q(privatePdf.document)})`,
    ),
    "t",
  );
  await sql(
    `delete from public.user_roles where user_id=${q(finance)} and role='admin'`,
  );
  assert.equal(
    await actor(
      finance,
      `select count(*) from public.document_versions where id=${q(privatePdf.version)}`,
    ),
    "0",
  );
  await assert.rejects(register(finance, payload(privatePdf), key), /42501/);
  await assert.rejects(history(finance), /42501/);
  console.log(
    "PASS current permission, exact-version ACL and immutable receipts prevent document reassignment",
  );
});
