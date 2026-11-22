/** Replay a historical installation and verify retained data through the real updater SQL. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  quoteSql as q,
  withMigrationReplayLock,
  withTestDatabase,
} from "./testing/database.mjs";

const updaterPath = fileURLToPath(
  new URL("../deploy/hostinger/updates/updater.py", import.meta.url),
);

// Use the same inventory and transaction envelope as the installed controller.
function pendingCommands(paths, history) {
  return JSON.parse(
    execFileSync(
      "python3",
      [
        "-B",
        "-c",
        `import importlib.util,json,sys
from pathlib import Path
spec=importlib.util.spec_from_file_location('reviewed_controller',sys.argv[1])
u=importlib.util.module_from_spec(spec);spec.loader.exec_module(u)
r=json.load(sys.stdin)
manifest = {'migrations': [{'version': Path(path).name[:14], 'path': path} for path in r['paths']]}
updater = u.Updater(r['scratch'])
pending = updater.migration_inventory('/', manifest, r['history'], operator_reviewed=True)
print(json.dumps([u.migration_sql(source, version, name, operator_reviewed=True) for version, name, source in pending]))`,
        updaterPath,
      ],
      {
        input: JSON.stringify({
          paths,
          history,
          scratch: "/nonexistent-luminovia-upgrade-fixture",
        }),
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
      },
    ),
  );
}

await withTestDatabase(
  "reviewed_upgrade_retention",
  async ({ actor, sql }) => {
    const directory = new URL("../supabase/migrations/", import.meta.url);
    const files = (await readdir(directory))
      .filter((name) => /^\d{14}_[a-z0-9_]+\.sql$/.test(name))
      .sort()
      .map((name) => fileURLToPath(new URL(name, directory)));
    const baseline = files.filter(
      (file) =>
        file.slice(file.lastIndexOf("/") + 1, -4) <=
        "20261115180559_finite_schedule_intervals",
    );
    const digest = (value) => createHash("sha256").update(value).digest("hex");
    const sourceHashes = await Promise.all(
      baseline.map(async (file) => digest(await readFile(file))),
    );
    // Exact ordered source hashes of the 18 migrations in release bb322746.
    assert.equal(baseline.length, 18);
    assert.equal(
      digest(sourceHashes.join("\n") + "\n"),
      "7621e2d1dd4a530a6a9e0628701ae23b0ae4a8856272a1ea35d17c54433e4afb",
    );
    await sql(`create schema supabase_migrations;
            create table supabase_migrations.schema_migrations(version text primary key,name text,statements text[]);`);
    const history = async () =>
      JSON.parse(
        await sql(`select coalesce(
            json_object_agg(version,statements[1]), '{}'::json)
            from supabase_migrations.schema_migrations`),
      );
    const apply = async (paths) => {
      const commands = pendingCommands(paths, await history());
      await withMigrationReplayLock(
        process.env.PORTAL_DB_CONTAINER ?? "supabase_db_luminovia-portal",
        async () => {
          for (const command of commands) await sql(command);
        },
      );
      return commands.length;
    };
    assert.equal(await apply(baseline), 18);
    const teacher = q(randomUUID());
    const learner = q(randomUUID());
    const peer = q(randomUUID());
    const administrator = q(randomUUID());
    const organisation = q(randomUUID());
    const template = q(randomUUID());
    const course = q(randomUUID());
    const job = q(randomUUID());
    const claim = q(randomUUID());
    const contract = q(randomUUID());
    const invoice = q(randomUUID());
    const contractFile = q(randomUUID());
    const invoiceFile = q(randomUUID());
    await sql(`
            insert into auth.users(id,email,email_confirmed_at) values
              (${teacher},'teacher@example.invalid',now()), (${learner},'learner@example.invalid',now()),
              (${peer},'peer@example.invalid',now()), (${administrator},'admin@example.invalid',now());
            insert into public.user_roles(user_id,role) values
              (${teacher},'lecturer'),(${learner},'participant'),(${peer},'lecturer'),(${administrator},'admin');
            insert into public.organisations(id,name) values (${organisation},'Fictional Academy');
            insert into public.course_templates(id,title) values (${template},'Fictional course');
            insert into public.course_runs(id,template_id,organisation_id,time_zone,published)
              values (${course},${template},${organisation},'Australia/Brisbane',true);
            insert into public.course_sessions(course_run_id,starts_at,ends_at)
              values (${course},'2026-01-08T00:00:00Z','2026-01-08T05:00:00Z');
            insert into public.course_enrolments(course_run_id,user_id,status,enrolled_by)
              values (${course},${learner},'completed',${teacher});
            insert into public.jobs(id,course_run_id,title,customer_name,delivery_type,status,amount,currency,rate_unit,total_amount,terms)
              values (${job},${course},'Fictional course','Fictional Academy','online','filled',620,'AUD','fixed_total',620,'Retained conditions');
            with documents as (
              insert into public.documents(owner_id,uploaded_by,scope,kind,original_name,mime_type,size_bytes,status,client_id)
              select ${teacher},${teacher},'personal',kind,kind||'.pdf','application/pdf',180,'clean',gen_random_uuid()
              from (values ('contract'),('invoice')) fixture(kind) returning id,kind,original_name
            )
            insert into public.document_versions(id,document_id,uploaded_by,client_id,version,object_path,original_name,mime_type,size_bytes,sha256,status)
              select case kind when 'contract' then ${contractFile}::uuid else ${invoiceFile}::uuid end,id,${teacher},gen_random_uuid(),1,
                'fictional/'||original_name,original_name,'application/pdf',180,repeat(case kind when 'contract' then 'c' else 'b' end,64),'clean'
              from documents;
            insert into public.contracts(id,user_id,status,effective_from,version,document_version_id,document_sha256)
              values (${contract},${teacher},'active','2026-01-01T00:00:00Z',1,${contractFile},repeat('c',64));
            insert into public.job_claims(id,job_id,lecturer_id,idempotency_key,amount,currency,rate_unit,total_amount,terms,terms_version,contract_id)
              values (${claim},${job},${teacher},gen_random_uuid(),620,'AUD','fixed_total',620,'Retained conditions',1,${contract});
            insert into public.assignment_sessions(claim_id,lecturer_id,starts_at,ends_at)
              values (${claim},${teacher},'2026-01-08T00:00:00Z','2026-01-08T05:00:00Z');
            insert into public.invoices(id,user_id,number,issued_on,due_on,currency,total_amount,document_version_id,status,client_id)
              values (${invoice},${teacher},'FIX-2026-01','2026-01-09','2026-02-09','AUD',620,${invoiceFile},'approved',gen_random_uuid());
            insert into public.invoice_items(invoice_id,claim_id) values (${invoice},${claim});
            insert into public.payment_records(invoice_id,amount,currency,paid_at,recorded_by,client_id)
              values (${invoice},200,'AUD','2026-01-15T00:00:00Z',${teacher},gen_random_uuid());
            update private.document_storage_limits set total_quota_bytes=8589934592, owner_quota_bytes=536870912 where singleton;
        `);
    const asTeacher = (statement) => actor(teacher.slice(1, -1), statement);
    const room = q(await asTeacher(`select public.create_dm(${peer})`));
    const sent = q(
      await asTeacher(
        `select public.send_message(${room},'Fictional original chat message',${q(randomUUID())})`,
      ),
    );
    await asTeacher(
      `select public.edit_message(${sent},'Fictional corrected chat message')`,
    );
    await actor(
      peer.slice(1, -1),
      `select public.mark_chat_read(${room},${sent})`,
    );
    const snapshot = async () =>
      JSON.parse(
        await sql(`select jsonb_build_object(
          'accounts', (select jsonb_agg(row(id,email,email_confirmed_at) order by id) from auth.users),
          'roles', (select jsonb_agg(row(user_id,role) order by user_id,role) from public.user_roles),
          'course', (select row(id,organisation_id,time_zone,published) from public.course_runs where id=${course}),
          'enrolment', (select row(user_id,status,enrolled_by) from public.course_enrolments where course_run_id=${course}),
          'claim', (select row(lecturer_id,status,amount,total_amount,currency,terms,contract_id) from public.job_claims where id=${claim}),
          'sessions', (select row(starts_at,ends_at,lecturer_id) from public.assignment_sessions where claim_id=${claim}),
          'contract', (select row(status,document_version_id,document_sha256) from public.contracts where id=${contract}),
          'invoice', (select row(number,currency,total_amount,status,document_version_id,due_on) from public.invoices where id=${invoice}),
          'invoice_item', (select row(claim_id,active) from public.invoice_items where invoice_id=${invoice}),
          'payment', (select row(amount,currency,paid_at) from public.payment_records where invoice_id=${invoice}),
          'file_metadata', (select jsonb_agg(row(id,object_path,size_bytes,sha256) order by id)
            from public.document_versions where id in (${contractFile},${invoiceFile})),
          'chat', (select row(room_id,sender_id,client_id,body,created_at,edited_at)
            from public.messages where id=${sent}),
          'chat_revision', (select row(actor_id,action,previous_body,created_at)
            from public.chat_message_revisions where message_id=${sent}),
          'chat_members', (select jsonb_agg(row(user_id,last_read_message_id,last_read_at) order by user_id)
            from public.chat_members where room_id=${room}),
          'quota', (select row(total_quota_bytes, owner_quota_bytes) from private.document_storage_limits where singleton)
        )`),
      );
    const before = await snapshot();
    assert(Object.values(before).every((value) => value !== null));
    assert.equal(await apply(files), files.length - 18);
    assert.deepEqual(await snapshot(), before);
    assert.equal(await apply(files), 0);
    assert.deepEqual(await snapshot(), before);
    assert.equal(
      await actor(
        teacher.slice(1, -1),
        `select count(*) from public.invoices where id=${invoice}`,
      ),
      "1",
    );
    assert.equal(
      await actor(
        learner.slice(1, -1),
        `select count(*) from public.invoices where id=${invoice}`,
      ),
      "0",
    );
    assert.equal(
      await actor(
        peer.slice(1, -1),
        `select body from public.chat_messages(${room}) where id=${sent}`,
      ),
      "Fictional corrected chat message",
    );
    await assert.rejects(
      actor(
        administrator.slice(1, -1),
        `select body from public.chat_messages(${room})`,
      ),
      /42501/,
    );
    console.log(
      `PASS release bb322746 to ${files.length} migrations: retained accounts, courses, contracts, invoice and payment, private chat with revisions and read state, file metadata and selected quotas`,
    );
  },
  { migrationsThrough: "00000000000000" },
);
