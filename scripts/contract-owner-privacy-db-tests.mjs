/** Disposable PostgreSQL/RLS checks for personal contract privacy and registration. */
import { spawn } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { withMigrationReplayLock } from "./testing/database.mjs";

const container =
  process.env.PORTAL_DB_CONTAINER ?? "supabase_db_luminovia-portal";
if (
  !/^supabase_db_luminovia-portal(?:-test(?:-[a-zA-Z0-9_-]+)?)?$/.test(
    container,
  )
)
  throw new Error(
    "Only the named local portal database container is permitted.",
  );
const database = `documents_test_${randomUUID().replaceAll("-", "")}`;
/** Starts the test program with explicit arguments and preserves its failure status. */
function command(args, input = "") {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
    let out = "",
      err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve(out.trim()) : reject(new Error(err || out)),
    );
    child.stdin.end(input);
  });
}
/** Sends SQL to the owned test database and makes every psql error fail the run. */
const sql = (text, name = database) =>
  command(
    [
      "exec",
      "-i",
      container,
      "psql",
      "-U",
      "postgres",
      "-d",
      name,
      "-X",
      "-qAt",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    text,
  );
/** Quotes controlled fixture SQL literals; identifiers have separate validation. */
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
/** Executes the check as a specific identity so administrative fixture privileges cannot mask the tested access. */
const actor = (id, statement, aal = "aal1") =>
  sql(
    `begin;set local role authenticated;set local request.jwt.claims=${quote(JSON.stringify({ sub: id, aal, role: "authenticated" }))};${statement};commit;`,
  );
const owner = randomUUID(),
  otherOwner = randomUUID(),
  manager = randomUUID(),
  manager2 = randomUUID();
/** Reserves a document version with controlled owner, size and retry context. */
const reserve = async (
  who,
  {
    subject = who,
    size = 256,
    key = randomUUID(),
    replace = null,
    name = "Fictional.pdf",
  } = {},
  aal = "aal1",
) =>
  JSON.parse(
    await actor(
      who,
      `select public.reserve_document(${quote(name)},'application/pdf',${size},'personal','contract',null,null,${quote(key)},${replace ? quote(replace) : "null"},${quote(subject)})`,
      aal,
    ),
  );
let checks = 0;
/** Counts and reports a case only after all of its assertions have completed successfully. */
const check = async (name, fn) => {
  await fn();
  checks++;
  console.log(`PASS ${name}`);
};
try {
  await sql(`create database ${database}`, "postgres");
  await sql(`create schema auth;create schema extensions;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
 grant usage on schema auth to authenticated,anon,service_role;grant execute on all functions in schema auth to authenticated,anon,service_role;`);
  await withMigrationReplayLock(container, async () => {
    for (const file of (
      await readdir(new URL("../supabase/migrations/", import.meta.url))
    )
      .filter((f) => f.endsWith(".sql"))
      .sort())
      await sql(
        await readFile(
          new URL(`../supabase/migrations/${file}`, import.meta.url),
          "utf8",
        ),
      );
  });
  await sql(
    `insert into auth.users(id) values ${[owner, otherOwner, manager, manager2].map((id) => `('${id}')`).join(",")};insert into public.user_roles(user_id,role) values('${owner}','lecturer'),('${otherOwner}','lecturer'),('${manager}','admin'),('${manager2}','management');`,
  );
  await check(
    "Owner-only contract records and restricted manager registration metadata",
    async () => {
      const contract = await reserve(owner);
      await sql(
        `update public.document_versions set status='clean',sha256='${"a".repeat(64)}' where id='${contract.version_id}'; update public.documents set status='clean' where id='${contract.document_id}'`,
      );
      for (const [who, aal, expected] of [
        [owner, "aal1", "1"],
        [otherOwner, "aal1", "0"],
        [manager, "aal1", "0"],
        [manager2, "aal1", "0"],
      ]) {
        assert.equal(
          await actor(
            who,
            `select count(*) from public.documents where id='${contract.document_id}'`,
            aal,
          ),
          expected,
        );
        assert.equal(
          await actor(
            who,
            `select count(*) from public.document_versions where id='${contract.version_id}'`,
            aal,
          ),
          expected,
        );
      }
      assert.equal(
        await actor(
          manager,
          `select count(*) from public.contract_registration_candidates('${owner}') where version_id='${contract.version_id}'`,
          "aal1",
        ),
        "1",
      );
      await assert.rejects(
        actor(
          otherOwner,
          `select * from public.contract_registration_candidates('${owner}')`,
        ),
        /required/i,
      );
      await assert.rejects(
        reserve(manager, { subject: owner }, "aal1"),
        /Only the owner/,
      );
      await assert.rejects(
        actor(
          manager,
          `select private.reserve_document_before_contract_owner('x.pdf','application/pdf',1,'personal','contract',null,null,'${randomUUID()}',null,'${owner}')`,
          "aal1",
        ),
        /permission denied/,
      );
      const legacy = randomUUID(),
        legacyVersion = randomUUID(),
        client = randomUUID();
      await sql(
        `insert into public.documents(id,owner_id,uploaded_by,scope,kind,original_name,mime_type,size_bytes,status,client_id) values('${legacy}','${owner}','${manager}','personal','contract','Legacy.pdf','application/pdf',1,'clean','${client}');insert into public.document_versions(id,document_id,uploaded_by,client_id,version,object_path,original_name,mime_type,size_bytes,status,sha256) values('${legacyVersion}','${legacy}','${manager}','${client}',1,'${owner}/${legacyVersion}','Legacy.pdf','application/pdf',1,'clean','${"b".repeat(64)}');update public.documents set current_version_id='${legacyVersion}' where id='${legacy}'`,
      );
      assert.equal(
        await actor(
          manager,
          `select count(*) from public.documents where id='${legacy}'`,
          "aal1",
        ),
        "0",
      );
      assert.equal(
        await actor(
          owner,
          `select count(*) from public.documents where id='${legacy}'`,
        ),
        "1",
      );
      // A confirmed owner deletion must hide the candidate even from a
      // privileged registration query that intentionally bypasses table RLS.
      const preview = JSON.parse(
        await actor(
          owner,
          `select public.deletion_preview('document','${contract.document_id}')`,
          "aal1",
        ),
      );
      await actor(
        owner,
        `select public.deletion_confirm('${preview.plan_id}','${randomUUID()}','DELETE')`,
        "aal1",
      );
      assert.equal(
        await actor(
          manager,
          `select count(*) from public.contract_registration_candidates('${owner}') where version_id='${contract.version_id}'`,
          "aal1",
        ),
        "0",
      );
      assert.equal(
        await actor(
          owner,
          `select private.can_access_document('${contract.document_id}')`,
          "aal1",
        ),
        "f",
      );
      await assert.rejects(
        actor(
          manager,
          `select private.can_access_document_before_contract_owner('${contract.document_id}')`,
          "aal1",
        ),
        /permission denied/,
      );
    },
  );
  console.log(`\n${checks} contract privacy database checks passed.`);
} finally {
  await sql(`drop database if exists ${database} with(force)`, "postgres");
}
