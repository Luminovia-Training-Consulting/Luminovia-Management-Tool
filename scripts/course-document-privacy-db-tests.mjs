/** Exercises actual course RPCs against optional private-registry metadata contracts.
 * The vendored enquiry RPC is an unchanged source excerpt, not full-module acceptance.
 * Every run owns and drops its UUID database, including failed/concurrent writes.
 */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { withTestDatabase, quoteSql as q } from "./testing/database.mjs";

const migrations = new URL("../supabase/migrations/", import.meta.url);
// This provenance-checked metadata fixture deliberately models optional modules
// before their real tables exist. Keep both historical install orders before
// the operational modules; full current support/course RPC composition is
// exercised separately by support-course-registry-db-tests.mjs.
const migrationFiles = (await readdir(migrations))
  .filter((name) => name.endsWith(".sql"))
  .sort();
const operationalStart = migrationFiles.find((name) =>
  name.endsWith("_course_readiness.sql"),
);
const metadataContractThrough = migrationFiles
  .filter((name) => !operationalStart || name < operationalStart)
  .at(-1)
  ?.slice(0, 14);
assert.ok(
  metadataContractThrough,
  "The real course predecessor must be present.",
);
const fixture = await readFile(
  new URL(
    "./testing/fixtures/course-private-registry-contract.sql",
    import.meta.url,
  ),
  "utf8",
);
const provenance = JSON.parse(
  await readFile(
    new URL(
      "./testing/fixtures/course-private-registry-contract.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
assert.equal(
  createHash("sha256").update(fixture).digest("hex"),
  provenance.fixture_sha256,
);
const excerpt = fixture.slice(
  fixture.indexOf("create function private.attach_enquiry_document("),
  fixture.indexOf("revoke all on function"),
);
assert.equal(
  createHash("sha256").update(excerpt).digest("hex"),
  provenance.excerpt_sha256,
);
let count = 0;
for (const moduleFirst of [false, true]) {
  await withTestDatabase(
    "course_privacy",
    async ({ sql, actor }) => {
      // In one order the optional module predates course_resources itself. In the
      // other order the root migration must operate safely with no module present.
      if (moduleFirst) {
        await sql(fixture);
        for (const file of migrationFiles.filter(
          (file) =>
            file.slice(0, 14) > "20261116091014" &&
            file.slice(0, 14) <= metadataContractThrough,
        ))
          await sql(await readFile(new URL(file, migrations), "utf8"));
      }
      const check = async (name, fn) => {
        await fn();
        count++;
        console.log(
          `PASS ${moduleFirst ? "module-first" : "root-first"}: ${name}`,
        );
      };
      const [manager, learner, template, run, enquiry] = Array.from(
        { length: 5 },
        randomUUID,
      );
      await sql(
        `insert into auth.users(id,email) values(${q(manager)},'manager@example.invalid'),(${q(learner)},'learner@example.invalid');insert into public.user_roles values(${q(manager)},'admin'),(${q(learner)},'participant');insert into public.course_templates(id,title)values(${q(template)},'Fictional privacy course');insert into public.course_runs(id,template_id)values(${q(run)},${q(template)});insert into public.course_enrolments(course_run_id,user_id,status,enrolled_by)values(${q(run)},${q(learner)},'enrolled',${q(manager)});`,
      );
      const rpc = async (who, name, args) =>
        JSON.parse(
          await actor(
            who,
            `select to_jsonb(public.${name}(${args.join(",")}))`,
            "aal1",
          ),
        );
      const workspace = (who = manager) =>
        rpc(who, "course_workspace", [q(run)]);
      const share = (version, who = manager) =>
        rpc(who, "course_workspace_action", [
          q(run),
          q("resource_share"),
          q(
            JSON.stringify({
              version_id: version,
              audience: "participants",
              category: "material",
            }),
          ),
          "0",
        ]);
      const access = (id, who = learner) =>
        rpc(who, "course_document_access", [q("resource"), q(id)]);
      const remove = (id) =>
        rpc(manager, "course_workspace_action", [
          q(run),
          q("resource_remove"),
          q(JSON.stringify({ id })),
          "0",
        ]);
      const createDocument = async () => {
        const [id, version] = [randomUUID(), randomUUID()];
        await sql(
          `insert into public.documents(id,owner_id,uploaded_by,scope,kind,original_name,mime_type,size_bytes,status,client_id)values(${q(id)},${q(manager)},${q(manager)},'personal','material','Fictional.pdf','application/pdf',10,'clean',${q(randomUUID())});insert into public.document_versions(id,document_id,uploaded_by,client_id,version,object_path,original_name,mime_type,size_bytes,status,sha256)values(${q(version)},${q(id)},${q(manager)},${q(randomUUID())},1,${q("fictional/" + version)},'Fictional.pdf','application/pdf',10,'clean',${q("a".repeat(64))});update public.documents set current_version_id=${q(version)} where id=${q(id)};`,
        );
        return { id, version };
      };
      await check(
        "normal exact V1 personal material remains available without owner document RLS",
        async () => {
          const doc = await createDocument();
          const resource = (await share(doc.version)).id;
          assert.equal((await access(resource)).id, doc.version);
          assert.equal(
            await actor(
              learner,
              `select count(*)from public.documents where id=${q(doc.id)}`,
            ),
            "0",
          );
          assert.equal(
            (await workspace(learner)).resources[0].version_id,
            doc.version,
          );
          await remove(resource);
        },
      );
      if (!moduleFirst) await sql(fixture);
      await sql(
        `insert into private.website_enquiries(id)values(${q(enquiry)})`,
      );
      const attach = (doc, expected = 1, tag = "") =>
        actor(
          manager,
          `${tag}select public.attach_enquiry_document(${q(enquiry)},${q(doc.version)},'Fictional purpose',${expected},${q(randomUUID())})`,
          "aal1",
        );
      for (const registry of [
        "support_attachments",
        "website_enquiry_attachments",
        "accounting_customer_invoices",
      ]) {
        await check(
          `${registry}: selector, creation, old resource and gateway fail closed`,
          async () => {
            const doc = await createDocument();
            const resource = (await share(doc.version)).id;
            // This privileged metadata insert models pre-fix historical coexistence;
            // it deliberately does not claim a public domain registration permits it.
            await sql(
              registry === "website_enquiry_attachments"
                ? `insert into private.${registry}(enquiry_id,document_id,version_id,label,attached_by)values(${q(enquiry)},${q(doc.id)},${q(doc.version)},'Legacy fixture',${q(manager)})`
                : `insert into private.${registry}(document_id)values(${q(doc.id)})`,
            );
            assert.ok(
              !(await workspace()).share_options.some(
                (v) => v.id === doc.version,
              ),
            );
            assert.ok(
              !(await workspace(learner)).resources.some(
                (r) => r.id === resource,
              ),
            );
            await assert.rejects(share(doc.version), /42501/);
            await assert.rejects(access(resource), /42501/);
            await assert.rejects(
              sql(
                `insert into private.course_resources(run_id,version_id,audience,category,created_by)values(${q(run)},${q(doc.version)},'all','material',${q(manager)})`,
              ),
              /42501/,
            );
            // Withdrawing an invalid historical association remains possible, but
            // restoring it is another guarded resource registration.
            await remove(resource);
            await assert.rejects(
              sql(
                `update private.course_resources set removed_at=null where id=${q(resource)}`,
              ),
              /42501/,
            );
          },
        );
      }
      await check(
        "actual enquiry public RPC refuses active and removed course history",
        async () => {
          for (const removed of [false, true]) {
            const doc = await createDocument();
            const resource = (await share(doc.version)).id;
            if (removed) await remove(resource);
            await assert.rejects(attach(doc), /42501/);
            assert.equal(
              await sql(
                `select count(*)from private.website_enquiry_attachments where document_id=${q(doc.id)}`,
              ),
              "0",
            );
          }
        },
      );
      await check(
        "actual enquiry public RPC registration before course share is private",
        async () => {
          const doc = await createDocument();
          await attach(doc);
          await assert.rejects(share(doc.version), /42501/);
          assert.ok(
            !(await workspace()).share_options.some(
              (v) => v.id === doc.version,
            ),
          );
        },
      );
      const barrier = async (tag, condition) => {
        for (let n = 0; n < 100; n++) {
          if (
            (await sql(
              `select exists(select 1 from pg_stat_activity where datname=current_database()and application_name=${q(tag)}and ${condition})`,
            )) === "t"
          )
            return;
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        assert.fail(`Controlled ${condition} barrier not observed`);
      };
      await check(
        "enquiry registration lock commits before waiting course action is rechecked",
        async () => {
          const doc = await createDocument();
          const tag = "private_registration_" + randomUUID();
          const first = Promise.allSettled([
            attach(
              doc,
              2,
              `select set_config('application_name',${q(tag)},true);` + "",
            ).then(() => {}),
          ]);
          // The actual public operation above is sequentially proved; a second
          // operation holds its whole transaction so the waiting path is observed.
          await first;
          const other = await createDocument();
          const pending = Promise.allSettled([
            actor(
              manager,
              `select set_config('application_name',${q(tag)},true);select public.attach_enquiry_document(${q(enquiry)},${q(other.version)},'Race purpose',3,${q(randomUUID())});select pg_sleep(2)`,
              "aal1",
            ),
          ]);
          await barrier(tag, "wait_event='PgSleep'");
          const waiter = tag + "_wait";
          const waiting = Promise.allSettled([
            actor(
              manager,
              `select set_config('application_name',${q(waiter)},true);select public.course_workspace_action(${q(run)},'resource_share',${q(JSON.stringify({ version_id: other.version, audience: "participants", category: "material" }))},0)`,
              "aal1",
            ),
          ]);
          await barrier(waiter, "wait_event_type='Lock'");
          assert.equal((await pending)[0].status, "fulfilled");
          const result = (await waiting)[0];
          assert.equal(result.status, "rejected");
          assert.match(result.reason.message, /42501/);
          assert.equal(
            await sql(
              `select count(*)from private.course_resources where version_id=${q(other.version)}`,
            ),
            "0",
          );
        },
      );
      await check(
        "course share lock commits before waiting enquiry public RPC sees retained history",
        async () => {
          const doc = await createDocument();
          const tag = "course_registration_" + randomUUID();
          const pending = Promise.allSettled([
            actor(
              manager,
              `select set_config('application_name',${q(tag)},true);select public.course_workspace_action(${q(run)},'resource_share',${q(JSON.stringify({ version_id: doc.version, audience: "participants", category: "material" }))},0);select pg_sleep(2)`,
              "aal1",
            ),
          ]);
          await barrier(tag, "wait_event='PgSleep'");
          const waiter = tag + "_wait";
          const waiting = Promise.allSettled([
            attach(
              doc,
              4,
              `select set_config('application_name',${q(waiter)},true);`,
            ),
          ]);
          await barrier(waiter, "wait_event_type='Lock'");
          assert.equal((await pending)[0].status, "fulfilled");
          const result = (await waiting)[0];
          assert.equal(result.status, "rejected");
          assert.match(result.reason.message, /42501/);
          assert.equal(
            await sql(
              `select count(*)from private.website_enquiry_attachments where document_id=${q(doc.id)}`,
            ),
            "0",
          );
        },
      );
      await check(
        "new helpers are private and course wrappers keep current capability/permission",
        async () => {
          await assert.rejects(
            actor(
              manager,
              "select private.course_document_is_dedicated(null)",
              "aal1",
            ),
            /42501/,
          );
          await assert.rejects(
            actor(manager, `select public.course_workspace(${q(run)})`),
            /42501/,
          );
          await sql(
            `update public.profiles set active=false where id=${q(manager)}`,
          );
          await assert.rejects(workspace(), /42501/);
        },
      );
    },
    {
      migrationsThrough: moduleFirst
        ? "20261116091014"
        : metadataContractThrough,
    },
  );
}
console.log(
  `Passed ${count} course privacy PostgreSQL groups (metadata contract + exact enquiry RPC excerpt).`,
);
