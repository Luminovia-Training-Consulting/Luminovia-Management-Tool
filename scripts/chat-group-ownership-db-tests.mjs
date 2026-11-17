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
    `select public.create_chat_group('Original',array['${b}'::uuid,'${c}'::uuid],'topic',null)`,
  );
  await check(
    "Only owner can transfer to a current active member; owner cannot leave",
    async () => {
      await assert.rejects(
        value(a, "leave_topic_group", [group]),
        /Transfer ownership/,
      );
      await assert.rejects(
        value(b, "transfer_topic_group_owner", [group, c]),
        /denied/,
      );
      await assert.rejects(
        value(admin, "transfer_topic_group_owner", [group, c]),
        /denied/,
      );
      await assert.rejects(
        value(a, "transfer_topic_group_owner", [group, outsider]),
        /active member/,
      );
      await sql(`update public.profiles set active=false where id='${b}'`);
      await assert.rejects(
        value(a, "transfer_topic_group_owner", [group, b]),
        /active member/,
      );
      await sql(`update public.profiles set active=true where id='${b}'`);
      await value(a, "transfer_topic_group_owner", [group, b]);
      assert.equal(
        await sql(`select owner_id from public.chat_rooms where id='${group}'`),
        b,
      );
      await assert.rejects(
        value(b, "leave_topic_group", [group]),
        /Transfer ownership/,
      );
    },
  );
  await check(
    "Previous owner can leave and loses room, messages and settings",
    async () => {
      await value(a, "leave_topic_group", [group]);
      assert.equal(
        await sql(
          `select removed_at is not null from public.chat_members where room_id='${group}' and user_id='${a}'`,
        ),
        "t",
      );
      await assert.rejects(value(a, "chat_group_settings", [group]), /denied/);
      await assert.rejects(
        value(a, "chat_messages", [group, null, null, "", 40]),
        /denied/,
      );
      await assert.rejects(value(a, "leave_topic_group", [group]), /denied/);
    },
  );
  await check(
    "Concurrent target departure and transfer cannot leave a nonmember owner",
    async () => {
      const second = await actor(
        b,
        `select public.create_chat_group('Parallel',array['${c}'::uuid],'topic',null)`,
      );
      const outcomes = await Promise.allSettled([
        value(b, "transfer_topic_group_owner", [second, c]),
        value(c, "leave_topic_group", [second]),
      ]);
      assert.equal(outcomes.filter((x) => x.status === "fulfilled").length, 1);
      assert.equal(outcomes.filter((x) => x.status === "rejected").length, 1);
      assert.equal(
        await sql(
          `select count(*) from public.chat_rooms r join public.chat_members m on m.room_id=r.id and m.user_id=r.owner_id and m.removed_at is null where r.id='${second}'`,
        ),
        "1",
      );
    },
  );
  await check(
    "Direct and general rooms reject voluntary departure or transfer",
    async () => {
      const dm = await value(b, "create_dm", [c]);
      await assert.rejects(value(b, "leave_topic_group", [dm]), /denied/);
      await assert.rejects(
        value(b, "transfer_topic_group_owner", [dm, c]),
        /denied/,
      );
      await assert.rejects(
        sql(`set role anon;select public.leave_topic_group('${group}')`),
        /permission denied/,
      );
    },
  );
  console.log(`${checks} group ownership SQL checks passed`);
} finally {
  await sql(`drop database if exists ${database} with(force)`, "postgres");
}
