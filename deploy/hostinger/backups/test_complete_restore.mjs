/**
 * Native recovery drill using a synthetic complete backup. Real age/PostgreSQL/file operations exercise recovery; normal instances and real accounts are not fixtures.
 */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createIsolatedDatabase } from "../restore-check.mjs";
import { collectCommand } from "../backup.mjs";
import { restoreComplete } from "./restore_complete.mjs";
import { installExtensionRecovery } from "./extension_recovery.mjs";
import { verifiesScram } from "./credential_recovery.mjs";
const here = dirname(fileURLToPath(import.meta.url));
const image =
  "supabase/postgres:17.12.0.000@sha256:8630950b489ecc70563300180287a98c192a4a48f5ae00b4febdaeea1abe85de";
const age = process.env.AGE_TEST_BINARY ?? "age";
const keygen = process.env.AGE_KEYGEN_TEST_BINARY ?? "age-keygen";
const privateRoot = resolve(here, "../../../.local/hostinger");
await mkdir(privateRoot, { recursive: true, mode: 0o700 });
const temporary = await mkdtemp(resolve(privateRoot, "complete-fixture-"));
let source;
try {
  const identity = resolve(temporary, "fictional.agekey");
  await collectCommand(keygen, ["-o", identity]);
  const recipient = await collectCommand(keygen, ["-y", identity]);
  const recipientFile = resolve(temporary, "recipient.txt");
  await writeFile(recipientFile, recipient + "\n", { mode: 0o600 });
  source = await createIsolatedDatabase(image);
  await source.sql("create role postgres; create role service_role;");
  const recovery = JSON.parse(
    await readFile(resolve(here, "extension-recovery.json"), "utf8"),
  );
  await installExtensionRecovery(
    source,
    recovery.versions,
    recovery,
    temporary,
  );
  await source.sql(
    "create schema extensions; create extension pgcrypto with schema extensions; create extension btree_gist with schema extensions; create extension pg_net; create extension supabase_vault; alter function net.http_get(text,jsonb,jsonb,integer) set search_path=net; alter function vault.create_secret(text,text,text,uuid) set search_path='';",
  );
  await source.sql(
    "create role fictional_reader; create role fictional_login login password 'Fictional-only-never-a-user-password!'; grant fictional_reader to fictional_login with inherit false, set true, admin false; create table public.fixture(id integer primary key, body text not null); alter table public.fixture enable row level security; create policy fixture_scope on public.fixture for select using(current_user='fictional_login'); insert into public.fixture values(1,'Fictional complete encrypted recovery'); grant select on public.fixture to fictional_reader; create database _supabase;",
  );
  const capturedPassword = await source.sql(
    "select rolpassword from pg_authid where rolname='fictional_login';",
  );
  assert(
    verifiesScram("Fictional-only-never-a-user-password!", capturedPassword),
  );
  assert(!verifiesScram("Wrong-fictional-password!", capturedPassword));
  await collectCommand(
    "docker",
    [
      "exec",
      "-i",
      source.name,
      "psql",
      "-U",
      source.operator,
      "-d",
      "_supabase",
      "-X",
      "-qAt",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    {
      input:
        "create table public.fixture_metadata(id integer primary key);insert into public.fixture_metadata values(9); grant connect on database _supabase to fictional_reader; alter database _supabase set statement_timeout='3s'; alter role fictional_login in database _supabase set search_path='public'; comment on database _supabase is 'Fictional metadata recovery';",
    },
  );
  const generated = JSON.parse(
    await collectCommand("python3", [
      resolve(here, "make_fixture.py"),
      "--container",
      source.name,
      "--directory",
      resolve(temporary, "generated"),
      "--age",
      age,
      "--recipient-file",
      recipientFile,
    ]),
  );
  assert.equal(generated.status, "complete");
  const result = await restoreComplete({
    backup: generated.backup,
    identity,
    age,
    inspectRestored: async ({ database, baseline }) => {
      assert.equal(baseline.status, "passed");
      assert.equal(
        await database.sql("select count(*) from public.fixture;"),
        "1",
      );
    },
  });
  assert.equal(result.databases, 3);
  assert.equal(
    result.sourceRolePasswordsAttributesMembershipsAndGrantorsExact,
    true,
  );
  assert.equal(
    result.allDatabaseCountsRlsPoliciesAndFunctionPermissionsExact,
    true,
  );
  assert.equal(result.privateFileBytesAndSecretConfigurationHashesExact, true);
  assert.equal(result.extensionRecoveryEmbedded, true);
  console.log(
    "PASS real complete encrypted fixture:3 PostgreSQL databases, password-bearing roles/grantors, RLS/data counts, secret config/TLS/key/mail/object hashes; only networkless owned containers/volumes/private extraction used.",
  );
} finally {
  if (source) await source.cleanup();
  await rm(temporary, { recursive: true, force: true });
}
