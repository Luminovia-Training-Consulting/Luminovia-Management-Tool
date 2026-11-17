/** Upgrade accepted Main before adding deletion: preserve real helper identities,
 * dedicated evidence and stricter installed rules. Random PostgreSQL only; native
 * Auth/Storage acceptance remains the separate complete pipeline. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

const directory = new URL("../supabase/migrations/", import.meta.url);
const migrations = (await readdir(directory))
  .filter((name) => /^\d{14}_.+\.sql$/.test(name))
  .sort();
const suffixes = [
  "permanent_resource_deletion.sql",
  "company_job_deletion_authority.sql",
  "deletion_smart_operations_dependencies.sql",
];
const upgrades = suffixes.map((suffix) => {
  const matches = migrations.filter((name) => name.slice(15) === suffix);
  assert.equal(
    matches.length,
    1,
    `One unaccepted deletion migration owns ${suffix}`,
  );
  return matches[0];
});
assert.deepEqual(
  upgrades,
  [...upgrades].sort(),
  "Deletion migrations preserve dependency order",
);
const firstUpgrade = migrations.indexOf(upgrades[0]);
assert(firstUpgrade > 0, "An accepted predecessor must exist before deletion");
assert.deepEqual(
  migrations.slice(firstUpgrade),
  upgrades,
  "Every accepted migration precedes all three unaccepted deletion migrations",
);
const prefix = migrations.slice(0, firstUpgrade);
const ceiling = prefix.at(-1).slice(0, 14);
let checks = 0;
await withTestDatabase(
  "deletion_upgrade_composition",
  async ({ sql, actor }) => {
    const check = async (name, run) => {
      await run();
      console.log(`PASS ${name}`);
      checks++;
    };
    const metadata = (signature) =>
      sql(
        `select jsonb_build_object('oid',p.oid,'source',p.prosrc,'acl',p.proacl::text,'owner',p.proowner,'definer',p.prosecdef,'config',p.proconfig) from pg_catalog.pg_proc p where p.oid=${q(signature)}::regprocedure`,
      ).then(JSON.parse);
    const originalSupport = await metadata("private.can_access_document(uuid)");
    assert(originalSupport.source.includes("private.support_attachments"));
    assert(
      originalSupport.source.includes(
        "private.can_access_document_before_support",
      ),
    );
    const notification = await metadata(
      "private.notification_target(text,uuid)",
    );
    const enquiry = prefix.some((name) =>
      name.endsWith("_website_enquiry_intake.sql"),
    )
      ? await metadata("private.enquiry_notification_target(text,uuid)")
      : null;
    const teacher = randomUUID(),
      formerStaff = randomUUID(),
      staff = randomUUID(),
      job = randomUUID(),
      ticket = randomUUID();
    await sql(`insert into auth.users(id,email) values ${[teacher, formerStaff, staff].map((id) => `(${q(id)},${q(`${id}@example.invalid`)})`).join(",")};
      insert into public.user_roles(user_id,role) values(${q(teacher)},'lecturer'),(${q(formerStaff)},'participant'),(${q(staff)},'participant');
      insert into public.role_permissions(role,permission) values('participant','support.manage') on conflict do nothing;
      insert into public.jobs(id,title,customer_name,delivery_type,status,amount,total_amount,currency,rate_unit,terms) values(${q(job)},'Fictional retained assignment','Fictional organisation','online','archived',50,50,'EUR','fixed_total','Fictional accepted terms');
      insert into public.job_claims(job_id,lecturer_id,idempotency_key,status,amount,total_amount,currency,rate_unit,terms,terms_version) values(${q(job)},${q(teacher)},${q(randomUUID())},'confirmed',50,50,'EUR','fixed_total','Fictional accepted terms',1);
      insert into private.support_tickets(id,requester_id,category,title,description) values(${q(ticket)},${q(teacher)},'technical','Fictional private evidence','Fictional support description');`);
    const file = async (owner, kind = "material", scope = "personal") => {
      const document = randomUUID(),
        version = randomUUID();
      await sql(`insert into public.documents(id,owner_id,uploaded_by,scope,kind,job_id,original_name,mime_type,size_bytes,status,client_id) values(${q(document)},${q(owner)},${q(owner)},${q(scope)},${q(kind)},${scope === "personal" ? "null" : q(job)},'Fictional document.pdf','application/pdf',100,'clean',${q(randomUUID())});
        insert into public.document_versions(id,document_id,uploaded_by,client_id,version,object_path,original_name,mime_type,size_bytes,status,sha256) values(${q(version)},${q(document)},${q(owner)},${q(randomUUID())},1,${q(`${owner}/${document}/${version}`)},'Fictional document.pdf','application/pdf',100,'clean',repeat('a',64));
        update public.documents set current_version_id=${q(version)} where id=${q(document)};`);
      return { document, version };
    };
    const own = await file(formerStaff);
    const internal = await file(formerStaff);
    const contract = await file(formerStaff, "contract");
    const jobFile = await file(staff, "material", "job_after");
    await sql(
      `insert into private.support_attachments(ticket_id,document_id,version_id,attached_by,internal) values(${q(ticket)},${q(internal.document)},${q(internal.version)},${q(formerStaff)},true);`,
    );
    const allowed = (who, document, aal = "aal2") =>
      actor(who, `select private.can_access_document(${q(document)})`, aal);

    // An independently stricter predecessor is legal installed state. Keep this
    // fixture-only rule through the real upgrade rather than replacing the
    // accepted implementation with a generic reconstructed document policy.
    await sql(`do $$declare original text;begin
      select prosrc into original from pg_catalog.pg_proc where oid='private.can_access_document_before_support(uuid)'::regprocedure;
      execute format('create function private.fixture_document_predecessor(p_id uuid) returns boolean language plpgsql stable security definer set search_path='''' as %L',original);
      end;$$;
      revoke all on function private.fixture_document_predecessor(uuid) from public,anon,authenticated,service_role;
      create or replace function private.can_access_document_before_support(p_id uuid) returns boolean language plpgsql stable security definer set search_path='' as $$begin
        if p_id=${q(contract.document)}::uuid then return false;end if;
        return private.fixture_document_predecessor(p_id);
      end;$$;`);
    const predecessor = await metadata(
      "private.can_access_document_before_support(uuid)",
    );
    await check(
      "Accepted support evidence and independently stricter contract access establish real pre-upgrade behavior",
      async () => {
        assert.equal(await allowed(formerStaff, own.document), "t");
        assert.equal(await allowed(formerStaff, contract.document), "f");
        assert.equal(await allowed(formerStaff, internal.document), "t");
        assert.equal(await allowed(staff, internal.document), "t");
        assert.equal(await allowed(teacher, internal.document), "f");
        assert.equal(await allowed(teacher, jobFile.document), "t");
      },
    );
    for (const migration of upgrades)
      await sql(await readFile(new URL(migration, directory), "utf8"));
    await check(
      "Accepted job briefing records enter the reviewed deletion scope",
      async () => {
        const briefingJob = randomUUID();
        const request = randomUUID();
        await sql(`insert into public.jobs(id,title,customer_name,delivery_type,status,amount,total_amount,currency,rate_unit,terms) values(${q(briefingJob)},'Fictional briefing job','Fictional organisation','online','archived',50,50,'EUR','fixed_total','Fictional terms');
        insert into private.job_briefings(job_id,version,contact_name) values(${q(briefingJob)},1,'Fictional contact');
        insert into private.job_briefing_requests(actor_id,request_id,job_id,expected_version,request_payload,saved_version) values(${q(staff)},${q(request)},${q(briefingJob)},0,'{}'::jsonb,1);`);
        const snapshot = JSON.parse(
          await sql(
            `select private.deletion_snapshot('job',${q(briefingJob)})`,
          ),
        );
        assert.equal(snapshot.counts["private.job_briefings"], 1);
        assert.equal(snapshot.counts["private.job_briefing_requests"], 1);
        assert(
          !snapshot.blockers.some((entry) =>
            ["private.job_briefings", "private.job_briefing_requests"].includes(
              entry.kind,
            ),
          ),
        );
        await sql(
          `update private.job_briefings set contact_name='Changed fictional contact' where job_id=${q(briefingJob)}`,
        );
        const changed = JSON.parse(
          await sql(
            `select private.deletion_snapshot('job',${q(briefingJob)})`,
          ),
        );
        assert.notEqual(
          snapshot.hashes["private.job_briefings"],
          changed.hashes["private.job_briefings"],
        );
      },
    );
    await check(
      "Forward upgrade preserves support and notification source/OID/ACL and clones the exact accepted document gate",
      async () => {
        assert.deepEqual(
          await metadata("private.can_access_document_before_support(uuid)"),
          predecessor,
        );
        assert.deepEqual(
          await metadata("private.notification_target(text,uuid)"),
          notification,
        );
        if (enquiry)
          assert.deepEqual(
            await metadata("private.enquiry_notification_target(text,uuid)"),
            enquiry,
          );
        const upgraded = await metadata("private.can_access_document(uuid)");
        assert.notEqual(upgraded.source, originalSupport.source);
        assert.deepEqual(
          { ...upgraded, source: originalSupport.source },
          originalSupport,
        );
        const clone = await metadata(
          "private.can_access_document_before_deletion(uuid)",
        );
        assert.equal(clone.source, originalSupport.source);
        assert.equal(clone.definer, true);
        assert.deepEqual(clone.config, ['search_path=""']);
        for (const role of ["anon", "authenticated", "service_role"])
          assert.equal(
            await sql(
              `select has_function_privilege(${q(role)},'private.can_access_document_before_deletion(uuid)','execute')`,
            ),
            "f",
          );
        const publicExecute = await sql(
          "select count(*) from pg_catalog.pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid='private.can_access_document_before_deletion(uuid)'::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE'",
        );
        assert.equal(publicExecute, "0");
      },
    );
    await check(
      "Dedicated internal evidence cannot fall back to uploader ownership after authority loss; current support and personal material remain intact",
      async () => {
        assert.equal(await allowed(formerStaff, internal.document), "t");
        await sql(
          `delete from public.user_roles where user_id=${q(formerStaff)};insert into public.user_roles(user_id,role) values(${q(formerStaff)},'lecturer');`,
        );
        assert.equal(await allowed(formerStaff, internal.document), "f");
        assert.equal(await allowed(staff, internal.document), "t");
        assert.equal(await allowed(staff, internal.document, "aal1"), "f");
        assert.equal(await allowed(teacher, internal.document), "f");
        assert.equal(await allowed(formerStaff, own.document), "t");
        assert.equal(await allowed(formerStaff, contract.document), "f");
        assert.equal(await allowed(staff, own.document), "f");
      },
    );
    await check(
      "Historical lecturer claims cannot grant job attachment access to a current client; current lecturer access returns without rewriting accepted history",
      async () => {
        assert.equal(await allowed(teacher, jobFile.document), "t");
        const claim = await sql(
          `select to_jsonb(c) from public.job_claims c where job_id=${q(job)}`,
        );
        await sql(
          `delete from public.user_roles where user_id=${q(teacher)};insert into public.user_roles(user_id,role) values(${q(teacher)},'client');`,
        );
        assert.equal(await allowed(teacher, jobFile.document), "f");
        await sql(
          `delete from public.user_roles where user_id=${q(teacher)};insert into public.user_roles(user_id,role) values(${q(teacher)},'lecturer');`,
        );
        assert.equal(await allowed(teacher, jobFile.document), "t");
        assert.equal(
          await sql(
            `select to_jsonb(c) from public.job_claims c where job_id=${q(job)}`,
          ),
          claim,
        );
      },
    );
  },
  { migrationsThrough: ceiling },
);
console.log(`PASS all ${checks} deletion upgrade composition groups`);
