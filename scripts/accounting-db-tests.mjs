/** Real PostgreSQL accounting invariants in a UUID database that the fixture
 * creates and drops; ordinary development/hosted records are never reset. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { withTestDatabase, quoteSql as q } from "./testing/database.mjs";

await withTestDatabase("accounting", async ({ sql, actor }) => {
  const [teacher, peer, admin, manager, client, outsider] = Array.from(
    { length: 6 },
    randomUUID,
  );
  const [org, otherOrg] = Array.from({ length: 2 }, randomUUID);
  await sql(
    `insert into auth.users(id,email) values ${[teacher, peer, admin, manager, client, outsider].map((id) => `(${q(id)},${q(id + "@example.invalid")})`).join(",")};insert into public.user_roles(user_id,role) values(${q(teacher)},'lecturer'),(${q(peer)},'lecturer'),(${q(admin)},'admin'),(${q(manager)},'management'),(${q(client)},'client'),(${q(outsider)},'client');insert into public.organisations(id,name) values(${q(org)},'Fictional accounting customer'),(${q(otherOrg)},'Fictional isolated customer');insert into public.client_organisation_memberships(user_id,organisation_id) values(${q(client)},${q(org)}),(${q(outsider)},${q(otherOrg)});`,
  );
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
  /** SQL-only file metadata isolates ACL/hash immutability; the API suite also
   * uploads actual bytes through Storage and the existing scanner. */
  async function pdf(owner, kind = "material", clean = true) {
    const [id, version, key] = Array.from({ length: 3 }, randomUUID);
    await sql(
      `insert into public.documents(id,owner_id,uploaded_by,scope,kind,original_name,mime_type,size_bytes,status,client_id) values(${q(id)},${q(owner)},${q(owner)},'personal',${q(kind)},'Fictional accounting.pdf','application/pdf',100,${q(clean ? "clean" : "quarantined")},${q(key)});insert into public.document_versions(id,document_id,uploaded_by,client_id,version,object_path,original_name,mime_type,size_bytes,sha256,status) values(${q(version)},${q(id)},${q(owner)},${q(key)},1,${q(owner + "/" + version)},'Fictional accounting.pdf','application/pdf',100,${q("c".repeat(64))},${q(clean ? "clean" : "quarantined")});update public.documents set current_version_id=${q(version)} where id=${q(id)};`,
    );
    return { id, version };
  }
  /** Explicit accepted-claim/charge fixtures retain odd-cent commercial values
   * without relying on a mutable global compensation default. */
  async function claim(currency = "AUD", organisation = org) {
    const [job, id] = Array.from({ length: 2 }, randomUUID);
    await sql(
      `insert into public.jobs(id,title,customer_name,delivery_type,status,amount,total_amount,currency,rate_unit,terms) values(${q(job)},'Fictional accounting block','Fictional accounting customer','online','filled',100.01,100.01,${q(currency)},'fixed_total','Fictional accepted terms');insert into public.job_claims(id,job_id,lecturer_id,idempotency_key,amount,total_amount,currency,rate_unit,terms,terms_version) values(${q(id)},${q(job)},${q(teacher)},${q(randomUUID())},100.01,100.01,${q(currency)},'fixed_total','Fictional accepted terms',1);insert into private.claim_revenue_ledger(claim_id,job_id,organisation_id,lecturer_id,gross_amount,gross_total_amount,platform_percent,platform_total_amount,lecturer_net_amount,lecturer_net_total_amount,currency) values(${q(id)},${q(job)},${q(organisation)},${q(teacher)},200.03,200.03,50,100.02,100.01,100.01,${q(currency)});`,
    );
    return { id, job };
  }
  const accepted = await claim(),
    foreignAccepted = await claim("AUD", otherOrg),
    euro = await claim("EUR");
  const invoice = randomUUID(),
    file = await pdf(teacher, "invoice");
  await sql(
    `insert into public.invoices(id,user_id,number,issued_on,due_on,currency,total_amount,document_version_id,client_id,status) values(${q(invoice)},${q(teacher)},'=FICTIONAL-001','2001-01-01','2001-02-01','AUD',100.01,${q(file.version)},${q(randomUUID())},'approved');insert into public.invoice_items(invoice_id,claim_id) values(${q(invoice)},${q(accepted.id)});`,
  );
  const original = await sql(
    `select to_jsonb(c)::text from public.job_claims c where id=${q(accepted.id)}`,
  );
  const ownExport = (
    who = teacher,
    source = "own",
    ids = [invoice],
    key = randomUUID(),
    aal = "aal1",
  ) =>
    rpc(
      who,
      "create_accounting_export",
      [q(source), `array[${ids.map(q).join(",")}]::uuid[]`, q(key)],
      aal,
    );
  await check(
    "Private table and fallback ACL bypass denied; own original-currency invoices only",
    async () => {
      for (const table of [
        "accounting_customer_invoices",
        "accounting_customer_items",
        "accounting_customer_payments",
        "accounting_exports",
        "accounting_operations",
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
          "select has_function_privilege('authenticated','private.accounting_document_access_fallback(uuid)','execute')",
        ),
        "f",
      );
      assert.equal(
        await sql(
          "select has_function_privilege('anon','public.accounting_export(uuid)','execute')",
        ),
        "f",
      );
      const rows = await rpc(teacher, "accounting_invoices");
      assert.equal(rows.items[0].recorded_total, "100.01");
      assert.equal(rows.items[0].currency, "AUD");
      assert.equal(rows.items[0].tax.gross, null);
      assert.equal((await rpc(peer, "accounting_invoices")).items.length, 0);
      await assert.rejects(ownExport(peer), /42501/);
      assert.equal(
        (await ownExport(manager, "lecturer_all")).invoices[0].id,
        invoice,
      );
    },
  );
  let snapshot;
  await check(
    "Immutable exact-decimal snapshot, content deduplication and idempotent response-loss retry",
    async () => {
      const key = randomUUID();
      snapshot = await ownExport(teacher, "own", [invoice], key);
      assert.equal(snapshot.schema_version, "luminovia.accounting/1");
      assert.equal(snapshot.invoices[0].paid_total, "0.00");
      assert.equal(snapshot.invoices[0].outstanding_total, "100.01");
      assert.match(snapshot.sha256, /^[a-f0-9]{64}$/);
      assert.deepEqual(
        await ownExport(teacher, "own", [invoice], key),
        snapshot,
      );
      assert.equal((await ownExport()).id, snapshot.id);
      await assert.rejects(
        ownExport(teacher, "lecturer_all", [invoice], key),
        /42501/,
      );
      await assert.rejects(
        ownExport(teacher, "own", [invoice, invoice]),
        /22023/,
      );
      await assert.rejects(
        sql(
          `update private.accounting_exports set records='[]' where id=${q(snapshot.id)}`,
        ),
        /55000/,
      );
    },
  );
  await check(
    "Payment changes produce new export while old snapshots remain truthful and authorized",
    async () => {
      await actor(
        admin,
        `select public.record_invoice_payment(${q(invoice)},33.34,'2001-01-02T12:00:00Z','Fictional payment',${q(randomUUID())})`,
        "aal2",
      );
      const updated = await ownExport();
      assert.notEqual(updated.id, snapshot.id);
      assert.equal(updated.invoices[0].paid_total, "33.34");
      assert.equal(updated.invoices[0].outstanding_total, "66.67");
      assert.equal(
        (await rpc(teacher, "accounting_export", [q(snapshot.id)])).invoices[0]
          .paid_total,
        "0.00",
      );
      await assert.rejects(
        rpc(peer, "accounting_export", [q(snapshot.id)]),
        /42501/,
      );
    },
  );
  const customerFile = await pdf(admin),
    badFile = await pdf(admin, "material", false);
  const payload = {
    claim_ids: [accepted.id],
    number: "FICTIONAL-CUSTOMER-001",
    issued_on: "2001-01-01",
    due_on: "2001-02-01",
    currency: "AUD",
    total_amount: "200.03",
    document_version_id: customerFile.version,
    difference_reason: "",
  };
  const register = (
    p = payload,
    who = admin,
    key = randomUUID(),
    aal = "aal2",
  ) =>
    rpc(
      who,
      "register_customer_invoice",
      [q(JSON.stringify(p)) + "::jsonb", q(key)],
      aal,
    );
  let customerInvoice;
  await check(
    "External customer invoices require gross authority, authentic accepted references and clean PDF",
    async () => {
      for (const p of [
        { ...payload, total_amount: "200.001" },
        { ...payload, total_amount: "0.00" },
        { ...payload, total_amount: "250.00" },
        { ...payload, claim_ids: [accepted.id, foreignAccepted.id] },
        { ...payload, claim_ids: [accepted.id, euro.id] },
        { ...payload, document_version_id: badFile.version },
      ])
        await assert.rejects(register(p), /22023|42501/);
      await assert.rejects(register(payload, manager), /42501/);
      await assert.rejects(register(payload, client), /42501/);
      assert.equal(
        await actor(
          manager,
          `select private.can_access_document(${q(customerFile.id)})`,
          "aal2",
        ),
        "f",
      );
      const key = randomUUID();
      customerInvoice = (await register(payload, admin, key, "aal1")).id;
      assert.equal((await register(payload, admin, key)).id, customerInvoice);
      await assert.rejects(
        register({ ...payload, number: "DUPLICATE" }),
        /23505/,
      );
      assert.equal(
        await sql(
          `select kind from public.documents where id=${q(customerFile.id)}`,
        ),
        "invoice",
      );
    },
  );
  await check(
    "Registered PDF ACL precedes net-finance access, preserves ordinary files and freezes evidence",
    async () => {
      assert.equal(
        await actor(
          client,
          `select private.can_access_document(${q(customerFile.id)})`,
        ),
        "t",
      );
      assert.equal(
        await actor(
          outsider,
          `select private.can_access_document(${q(customerFile.id)})`,
        ),
        "f",
      );
      assert.equal(
        await actor(
          manager,
          `select private.can_access_document(${q(customerFile.id)})`,
          "aal2",
        ),
        "f",
      );
      assert.equal(
        await actor(
          admin,
          `select private.can_access_document(${q(customerFile.id)})`,
        ),
        "t",
      );
      assert.equal(
        await actor(
          teacher,
          `select private.can_access_document(${q(file.id)})`,
        ),
        "t",
      );
      await assert.rejects(
        sql(
          `update public.documents set original_name='Rewritten.pdf' where id=${q(customerFile.id)}`,
        ),
        /23514/,
      );
      await assert.rejects(
        sql(
          `update public.document_versions set sha256=${q("d".repeat(64))} where id=${q(customerFile.version)}`,
        ),
        /23514/,
      );
      await assert.rejects(
        sql(
          `insert into public.invoices(user_id,number,issued_on,due_on,currency,total_amount,document_version_id,client_id) values(${q(admin)},'FORBIDDEN','2001-01-01','2001-02-01','AUD',200.03,${q(customerFile.version)},${q(randomUUID())})`,
        ),
        /23514/,
      );
    },
  );
  await check(
    "Customer exports isolate organisations and redact internal accepted-charge/claim details",
    async () => {
      const exported = await ownExport(client, "customer", [customerInvoice]);
      assert.equal(exported.invoices[0].kind, "customer_invoice");
      assert.equal(exported.invoices[0].recorded_total, "200.03");
      assert.equal(exported.invoices[0].accepted_charge_total, null);
      assert.equal(exported.invoices[0].assignments[0].claim_id, null);
      assert.equal(exported.invoices[0].tax.net, null);
      assert.equal(
        (await rpc(outsider, "accounting_invoices", [q("customer")])).items
          .length,
        0,
      );
      await assert.rejects(
        ownExport(outsider, "customer", [customerInvoice]),
        /42501/,
      );
      await assert.rejects(
        ownExport(manager, "customer", [customerInvoice], randomUUID(), "aal2"),
        /42501/,
      );
    },
  );
  let payment;
  await check(
    "Customer payment retries, exact rounding, concurrency, overpayment and immutable reversal",
    async () => {
      const args = [
        q(customerInvoice),
        q("33.34"),
        q("2001-01-02T12:00:00Z"),
        q("Fictional remittance"),
        q(randomUUID()),
      ];
      payment = (
        await rpc(admin, "record_customer_invoice_payment", args, "aal2")
      ).id;
      assert.equal(
        (await rpc(admin, "record_customer_invoice_payment", args, "aal2")).id,
        payment,
      );
      const calls = await Promise.allSettled(
        [1, 2].map(() =>
          rpc(
            admin,
            "record_customer_invoice_payment",
            [
              q(customerInvoice),
              q("166.69"),
              q("2001-01-03T12:00:00Z"),
              q("Fictional remaining payment"),
              q(randomUUID()),
            ],
            "aal2",
          ),
        ),
      );
      assert.equal(calls.filter((r) => r.status === "fulfilled").length, 1);
      const paid = await ownExport(
        admin,
        "customer",
        [customerInvoice],
        randomUUID(),
        "aal2",
      );
      assert.equal(paid.invoices[0].paid_total, "200.03");
      assert.equal(paid.invoices[0].outstanding_total, "0.00");
      await rpc(
        admin,
        "reverse_customer_invoice_payment",
        [
          q(customerInvoice),
          q(payment),
          q("Corrected fictional payment reference"),
          q(randomUUID()),
        ],
        "aal2",
      );
      const partial = await ownExport(
        admin,
        "customer",
        [customerInvoice],
        randomUUID(),
        "aal2",
      );
      assert.equal(partial.invoices[0].paid_total, "166.69");
      assert.equal(partial.invoices[0].outstanding_total, "33.34");
      assert.equal(partial.invoices[0].payments.length, 3);
      await assert.rejects(
        sql(
          `update private.accounting_customer_payments set amount=1 where id=${q(payment)}`,
        ),
        /55000/,
      );
      await assert.rejects(
        rpc(
          admin,
          "reverse_customer_invoice_payment",
          [
            q(customerInvoice),
            q(payment),
            q("Duplicate reversal denied"),
            q(randomUUID()),
          ],
          "aal2",
        ),
        /22023/,
      );
    },
  );
  await check(
    "Current customer membership, manager privilege and active-account status gate saved exports",
    async () => {
      const clientExport = await ownExport(client, "customer", [
        customerInvoice,
      ]);
      const managed = await ownExport(
        manager,
        "lecturer_all",
        [invoice],
        randomUUID(),
        "aal2",
      );
      await sql(
        `update public.client_organisation_memberships set removed_at=now() where user_id=${q(client)};delete from public.user_roles where user_id=${q(manager)};`,
      );
      await assert.rejects(
        rpc(client, "accounting_export", [q(clientExport.id)]),
        /42501/,
      );
      await assert.rejects(
        rpc(manager, "accounting_export", [q(managed.id)], "aal2"),
        /42501/,
      );
      await sql(
        `update public.profiles set active=false where id=${q(teacher)}`,
      );
      await assert.rejects(
        rpc(teacher, "accounting_export", [q(snapshot.id)]),
        /42501/,
      );
      assert.equal(
        await sql(
          `select to_jsonb(c)::text from public.job_claims c where id=${q(accepted.id)}`,
        ),
        original,
      );
    },
  );
  await check(
    "A narrower later client role cannot retrieve an earlier gross-finance export",
    async () => {
      const gross = await ownExport(
        admin,
        "customer",
        [customerInvoice],
        randomUUID(),
        "aal2",
      );
      await sql(
        `delete from public.user_roles where user_id=${q(admin)};insert into public.user_roles(user_id,role) values(${q(admin)},'client');insert into public.client_organisation_memberships(user_id,organisation_id) values(${q(admin)},${q(org)});`,
      );
      await assert.rejects(
        rpc(admin, "accounting_export", [q(gross.id)]),
        /42501/,
      );
      const redacted = await ownExport(admin, "customer", [customerInvoice]);
      assert.equal(redacted.invoices[0].accepted_charge_total, null);
      assert.equal(redacted.invoices[0].assignments[0].claim_id, null);
    },
  );
  await check(
    "Malformed historical invoice evidence fails on the server before minting an export",
    async () => {
      await sql(
        `update public.profiles set active=true where id=${q(teacher)}`,
      );
      const broken = await pdf(teacher, "invoice"),
        id = randomUUID();
      await sql(
        `update public.document_versions set sha256=null where id=${q(broken.version)};insert into public.invoices(id,user_id,number,issued_on,due_on,currency,total_amount,document_version_id,client_id) values(${q(id)},${q(teacher)},'FICTIONAL-BROKEN','2001-01-01','2001-02-01','AUD',1,${q(broken.version)},${q(randomUUID())});`,
      );
      await assert.rejects(ownExport(teacher, "own", [id]), /22023/);
    },
  );
  console.log(`PASS ${checks} real accounting PostgreSQL groups`);
});
