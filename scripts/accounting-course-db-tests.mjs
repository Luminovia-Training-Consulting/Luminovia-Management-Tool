/** Exercise current Accounting and course document registry composition using the real migrated guards. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { withTestDatabase, quoteSql as q } from "./testing/database.mjs";
import { documentRegistrationRace } from "./testing/document-registration-race.mjs";

const files = (
  await readdir(new URL("../supabase/migrations/", import.meta.url))
)
  .filter((name) => name.endsWith(".sql"))
  .sort();
const owned = files.filter((name) =>
  name.endsWith("_accounting_interoperability.sql"),
);
assert.equal(owned.length, 1);
const accounting = owned[0],
  predecessor = files.filter((name) => name < accounting).at(-1);
assert.ok(predecessor);
await withTestDatabase(
  "accounting_course_contract",
  async ({ sql, actor, container, database }) => {
    assert.equal(
      await sql("select to_regclass('private.course_resources') is not null"),
      "t",
    );
    await sql(
      await readFile(
        new URL("../supabase/migrations/" + accounting, import.meta.url),
        "utf8",
      ),
    );
    const [admin, teacher, org, template, run] = Array.from(
      { length: 5 },
      randomUUID,
    );
    await sql(
      `insert into auth.users(id,email)values(${q(admin)},${q(admin + "@example.invalid")}),(${q(teacher)},${q(teacher + "@example.invalid")});insert into public.user_roles(user_id,role)values(${q(admin)},'admin'),(${q(teacher)},'lecturer');insert into public.organisations(id,name)values(${q(org)},'Fictional accounting contract customer');insert into public.course_templates(id,title)values(${q(template)},'Fictional registry course');insert into public.course_runs(id,template_id,organisation_id)values(${q(run)},${q(template)},${q(org)});`,
    );
    let checks = 0;
    const check = async (name, fn) => {
      await fn();
      checks++;
      console.log("PASS " + name);
    };
    /** New immutable customer references per case ensure duplicate-source checks
     * cannot accidentally mask the document/registry assertion under review. */
    async function fixture() {
      const [document, version, claim, job, request] = Array.from(
        { length: 5 },
        randomUUID,
      );
      await sql(
        `insert into public.jobs(id,title,customer_name,delivery_type,status,amount,total_amount,currency,rate_unit,terms)values(${q(job)},'Fictional contract invoice assignment','Fictional accounting contract customer','online','filled',100.01,100.01,'AUD','fixed_total','Fictional immutable agreement');insert into public.job_claims(id,job_id,lecturer_id,idempotency_key,amount,total_amount,currency,rate_unit,terms,terms_version)values(${q(claim)},${q(job)},${q(teacher)},${q(randomUUID())},100.01,100.01,'AUD','fixed_total','Fictional immutable agreement',1);insert into private.claim_revenue_ledger(claim_id,job_id,organisation_id,lecturer_id,gross_amount,gross_total_amount,platform_percent,platform_total_amount,lecturer_net_amount,lecturer_net_total_amount,currency)values(${q(claim)},${q(job)},${q(org)},${q(teacher)},200.03,200.03,50,100.02,100.01,100.01,'AUD');insert into public.documents(id,owner_id,uploaded_by,scope,kind,original_name,mime_type,size_bytes,status,client_id)values(${q(document)},${q(admin)},${q(admin)},'personal','material','Fictional contract evidence.pdf','application/pdf',100,'clean',${q(request)});insert into public.document_versions(id,document_id,uploaded_by,client_id,version,object_path,original_name,mime_type,size_bytes,status,sha256)values(${q(version)},${q(document)},${q(admin)},${q(request)},1,${q("fictional/" + version)},'Fictional contract evidence.pdf','application/pdf',100,'clean',repeat('b',64));update public.documents set current_version_id=${q(version)}where id=${q(document)};`,
      );
      return {
        document,
        version,
        claim,
        payload: {
          claim_ids: [claim],
          number: "FICTIONAL-CONTRACT-" + request,
          issued_on: "2001-01-01",
          due_on: "2001-02-01",
          currency: "AUD",
          total_amount: "200.03",
          document_version_id: version,
          difference_reason: "",
        },
      };
    }
    const registerSql = (f) =>
      `select public.register_customer_invoice(${q(JSON.stringify(f.payload))}::jsonb,${q(randomUUID())})`;
    const register = (f) => actor(admin, registerSql(f), "aal2");
    // These isolated SQL fixture inserts exercise the current document registry trigger.
    const shareSql = (f) =>
      `insert into private.course_resources(run_id,version_id,audience,category,created_by)values(${q(run)},${q(f.version)},'participants','material',${q(admin)})returning id`;
    const refs = (f) =>
      sql(
        `select (select count(*)from private.accounting_customer_invoices where document_id=${q(f.document)})::text||(select count(*)from private.course_resources where version_id=${q(f.version)})::text`,
      );
    const shared = await fixture();
    let resource;
    await check(
      "Existing course history refuses customer registration without changing its original material",
      async () => {
        resource = await sql(shareSql(shared));
        await assert.rejects(register(shared), /42501/);
        assert.equal(await refs(shared), "01");
        assert.equal(
          await sql(
            `select kind from public.documents where id=${q(shared.document)}`,
          ),
          "material",
        );
      },
    );
    await check(
      "Removed historical course references remain incompatible with a dedicated financial PDF",
      async () => {
        await sql(
          `update private.course_resources set removed_at=clock_timestamp()where id=${q(resource)}`,
        );
        await assert.rejects(register(shared), /42501/);
        assert.equal(await refs(shared), "01");
        assert.equal(
          await sql(
            `select count(*)from private.course_resources where id=${q(resource)}and removed_at is not null`,
          ),
          "1",
        );
      },
    );
    await check(
      "Support and wiki document history cannot acquire company invoice visibility",
      async () => {
        const support = await fixture();
        const wiki = await fixture();
        const [ticket, page, wikiLink] = Array.from({ length: 3 }, randomUUID);
        await sql(`begin;
          insert into private.support_tickets(id,requester_id,category,title,description)
            values(${q(ticket)},${q(admin)},'invoice','Fictional support record','Fictional internal evidence');
          insert into private.support_attachments(ticket_id,document_id,version_id,attached_by,internal)
            values(${q(ticket)},${q(support.document)},${q(support.version)},${q(admin)},true);
          insert into public.wiki_pages(id,owner_id,published_version) values(${q(page)},${q(admin)},1);
          insert into public.wiki_revisions(page_id,version,title,locale,category_id,content,content_text,editor_id,published)
            values(${q(page)},1,'Fictional wiki page','en',(select id from public.knowledge_categories where kind='wiki' and slug='general'),'{}','','${admin}',true);
          insert into private.wiki_revision_attachments(id,page_id,revision,version_id,added_by)
            values(${q(wikiLink)},${q(page)},1,${q(wiki.version)},${q(admin)});
          commit;`);
        await assert.rejects(register(support), /42501/);
        await assert.rejects(register(wiki), /42501/);
        assert.equal(
          await actor(
            teacher,
            `select private.can_access_document(${q(support.document)})`,
          ),
          "f",
        );
        assert.match(
          await actor(teacher, `select public.wiki_attachments(${q(page)})`),
          new RegExp(wiki.version),
        );
      },
    );
    const financial = await fixture();
    await check(
      "Registered customer PDFs reject new and reassigned course associations through the actual trigger",
      async () => {
        await register(financial);
        await assert.rejects(sql(shareSql(financial)), /42501/);
        await assert.rejects(
          sql(
            `update private.course_resources set version_id=${q(financial.version)}where id=${q(resource)}`,
          ),
          /42501/,
        );
        assert.equal(await refs(financial), "10");
        assert.equal(
          await sql(
            `select version_id from private.course_resources where id=${q(resource)}`,
          ),
          shared.version,
        );
      },
    );
    for (const winner of ["register", "share"])
      await check(
        "Observed document-lock contract race commits only one association: " +
          winner +
          " first",
        async () => {
          const f = await fixture();
          const operations = [
            winner,
            winner === "register" ? "share" : "register",
          ].map(
            (operation) => (tag) =>
              operation === "register"
                ? actor(
                    admin,
                    `set local application_name=${q(tag)};set local statement_timeout='7s';${registerSql(f)}`,
                    "aal2",
                  )
                : sql(
                    `begin;set local application_name=${q(tag)};set local statement_timeout='7s';${shareSql(f)};commit;`,
                  ),
          );
          const [first, second] = await documentRegistrationRace({
            sql,
            container,
            database,
            document: f.document,
            operations,
          });
          assert.ok(first.value, first.error?.message);
          assert.match(second.error?.message ?? "", /42501/);
          assert.equal(await refs(f), winner === "register" ? "10" : "01");
          assert.equal(
            await sql(
              `select kind from public.documents where id=${q(f.document)}`,
            ),
            winner === "register" ? "invoice" : "material",
          );
        },
      );
    await check(
      "Real trigger diagnostics and owner-only execution remain clean for the installed registry contract",
      async () => {
        await sql("create extension plpgsql_check with schema extensions");
        const diagnostics = JSON.parse(
          await sql(
            "select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb)from extensions.plpgsql_check_function_tb('private.guard_course_dedicated_document()'::regprocedure,relid=>'private.course_resources'::regclass)t",
          ),
        );
        assert.deepEqual(diagnostics, []);
        for (const role of ["anon", "authenticated", "service_role"])
          assert.equal(
            await sql(
              `select has_function_privilege(${q(role)},'private.guard_course_dedicated_document()','execute')`,
            ),
            "f",
          );
      },
    );
    console.log(
      `\n${checks} accounting/course registry contract groups passed; actual course RPC acceptance is separate.`,
    );
  },
  { migrationsThrough: predecessor.slice(0, 14) },
);
