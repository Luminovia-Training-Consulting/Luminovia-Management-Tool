/** Chat permission and transaction tests on actual PostgreSQL, in a disposable DB.
 * Auth helpers are compatible stubs here; the separate chat-api-check uses real JWTs/realtime.
 */
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
const database = `chat_test_${randomUUID().replaceAll("-", "")}`;
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
/** Calls the public RPC as the test identity and returns its scalar database value. */
const value = (id, fn, args = [], aal) =>
  actor(
    id,
    `select public.${fn}(${args.map((x) => (x === null ? "null" : typeof x === "boolean" ? String(x) : quote(x))).join(",")})`,
    aal,
  );
const a = randomUUID(),
  b = randomUUID(),
  c = randomUUID(),
  admin = randomUUID(),
  participant = randomUUID(),
  outsider = randomUUID();
let checks = 0;
/** Counts and reports a case only after all of its assertions have completed successfully. */
const check = async (name, fn) => {
  await fn();
  checks++;
  console.log(`PASS ${name}`);
};
try {
  await sql(`create database ${database}`, "postgres");
  await sql(`create schema auth;create schema extensions;create table auth.users(id uuid primary key);
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
  await sql(`insert into auth.users(id) values ${[a, b, c, admin, participant, outsider].map((id) => `('${id}')`).join(",")};
 insert into public.user_roles(user_id,role) values('${a}','lecturer'),('${b}','lecturer'),('${c}','senior_lecturer'),('${admin}','admin'),('${participant}','participant'),('${outsider}','participant');
 update public.profiles set display_name=case id when '${a}' then 'Fictional Alpha' when '${b}' then 'Fictional Beta' else 'Fictional Other' end;`);
  const group = await actor(
    a,
    `select public.create_chat_group('Original',array['${b}'::uuid],'topic',null)`,
  );
  await check(
    "Owner edits and member reads group settings without audit text",
    async () => {
      assert.equal(
        await value(a, "update_chat_group_settings", [
          group,
          "  New title  ",
          "  Private description  ",
          1,
        ]),
        "2",
      );
      assert.deepEqual(
        JSON.parse(await value(b, "chat_group_settings", [group])),
        { title: "New title", description: "Private description", version: 2 },
      );
      assert.equal(
        await sql(
          `select count(*) from public.audit_events where action='chat.settings_updated' and resource_id='${group}' and details::text like '%Private description%'`,
        ),
        "0",
      );
    },
  );
  await check(
    "Foreign, nonowner, suspended and removed users are denied",
    async () => {
      await assert.rejects(
        value(b, "update_chat_group_settings", [group, "Bad", "bad", 2]),
        /denied/,
      );
      await assert.rejects(
        value(admin, "chat_group_settings", [group]),
        /denied/,
      );
      await assert.rejects(
        value(admin, "update_chat_group_settings", [group, "Bad", "bad", 2]),
        /denied/,
      );
      await value(a, "manage_chat_member", [group, b, true]);
      await assert.rejects(value(b, "chat_group_settings", [group]), /denied/);
      await sql(`update public.profiles set active=false where id='${a}'`);
      await assert.rejects(
        value(a, "update_chat_group_settings", [group, "Bad", "bad", 2]),
        /denied/,
      );
      await sql(`update public.profiles set active=true where id='${a}'`);
    },
  );
  await check(
    "Version conflict and invalid values preserve previous data",
    async () => {
      await assert.rejects(
        value(a, "update_chat_group_settings", [group, "Old", "overwrite", 1]),
        /changed/,
      );
      await assert.rejects(
        value(a, "update_chat_group_settings", [group, "   ", "bad", 2]),
        /Invalid/,
      );
      assert.deepEqual(
        JSON.parse(await value(a, "chat_group_settings", [group])),
        { title: "New title", description: "Private description", version: 2 },
      );
    },
  );
  await check(
    "Parallel edits with one revision have exactly one winner",
    async () => {
      const attempts = await Promise.allSettled([
        value(a, "update_chat_group_settings", [group, "First", "one", 2]),
        value(a, "update_chat_group_settings", [group, "Second", "two", 2]),
      ]);
      assert.equal(attempts.filter((x) => x.status === "fulfilled").length, 1);
      assert.equal(attempts.filter((x) => x.status === "rejected").length, 1);
    },
  );
  await check("Anonymous cannot execute settings RPC", async () => {
    await assert.rejects(
      sql(`set role anon;select public.chat_group_settings('${group}')`),
      /permission denied/,
    );
  });
  console.log(`${checks} group settings SQL checks passed`);
} finally {
  await sql(`drop database if exists ${database} with(force)`, "postgres");
}
