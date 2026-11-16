/** Prove reviewed updater SQL/history atomicity in an owned disposable database.
 * No live deployment, SMTP, Docker service lifecycle or physical restore is
 * simulated as acceptance here; controller/lock/recovery policy has unit tests.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { withTestDatabase, quoteSql as q } from "./testing/database.mjs";

const updaterPath = fileURLToPath(
  new URL("../deploy/hostinger/updates/updater.py", import.meta.url),
);

/** Run the real controller's SQL envelope over stdin, without a shell. */
function migrationCommand(source, version, reviewed = true) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "python3",
      [
        "-c",
        `import importlib.util,json,sys
spec=importlib.util.spec_from_file_location('reviewed_controller',sys.argv[1])
u=importlib.util.module_from_spec(spec);spec.loader.exec_module(u)
r=json.load(sys.stdin)
try:
 print(u.migration_sql(r['source'],r['version'],'reviewed_fixture',operator_reviewed=r['reviewed']),end='')
except u.UpdateError as error:
 print(str(error),file=sys.stderr);sys.exit(2)`,
        updaterPath,
      ],
      {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
      },
    );
    let out = "",
      err = "";
    child.stdout.on("data", (data) => (out += data));
    child.stderr.on("data", (data) => (err += data));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve(out) : reject(new Error(err || out)),
    );
    child.stdin.end(JSON.stringify({ source, version, reviewed }));
  });
}

await withTestDatabase(
  "reviewed_updater",
  async ({ sql }) => {
    // Skip application schema replay: these fixtures exercise the actual PG
    // transaction/history boundary independently of current product features.
    await sql(`create schema supabase_migrations;
create table supabase_migrations.schema_migrations(version text primary key,name text,statements text[]);
create table public.reviewed_fixture(id integer primary key,value integer not null);
insert into public.reviewed_fixture values(1,0);`);
    let checks = 0;
    const check = async (name, run) => {
      await run();
      checks++;
      console.log(`PASS ${name}`);
    };
    const counter = async () =>
      Number(await sql("select value from public.reviewed_fixture where id=1"));
    const history = async (version) =>
      Number(
        await sql(
          `select count(*) from supabase_migrations.schema_migrations where version=${q(version)}`,
        ),
      );

    await check(
      "Unattended policy rejects the same top-level rewrite",
      async () => {
        await assert.rejects(
          migrationCommand(
            "BEGIN;\nUPDATE public.reviewed_fixture SET value=value+1;\nCOMMIT;\n",
            "20261116120000",
            false,
          ),
          /migration_requires_operator_review/,
        );
        assert.equal(await counter(), 0);
        assert.equal(await history("20261116120000"), 0);
      },
    );

    await check(
      "Reviewed SQL and byte-exact CRLF history commit together",
      async () => {
        const source =
          "-- Fictional state rewrite; 'COMMIT;' remains authored text.\r\nBEGIN;\r\nUPDATE public.reviewed_fixture SET value=value+1;\r\nDO $$ BEGIN PERFORM 'ROLLBACK;'; END $$;\r\nCOMMIT;\r\n";
        await sql(await migrationCommand(source, "20261116120000"));
        assert.equal(await counter(), 1);
        assert.equal(
          await sql(
            `select statements[1]=${q(source)} from supabase_migrations.schema_migrations where version='20261116120000'`,
          ),
          "t",
        );
      },
    );

    await check(
      "A later SQL failure rolls back data and exact source history",
      async () => {
        const source =
          "BEGIN;\nUPDATE public.reviewed_fixture SET value=999;\nSELECT 1/0;\nCOMMIT;\n";
        await assert.rejects(
          sql(await migrationCommand(source, "20261116120100")),
          /22012|division by zero/,
        );
        assert.equal(await counter(), 1);
        assert.equal(await history("20261116120100"), 0);
      },
    );

    await check(
      "A concealed transaction command inside DO cannot escape the envelope",
      async () => {
        const source =
          "BEGIN;\nUPDATE public.reviewed_fixture SET value=999;\nDO $$ BEGIN COMMIT; END $$;\nCOMMIT;\n";
        await assert.rejects(
          sql(await migrationCommand(source, "20261116120200")),
          /2D000|invalid transaction termination/,
        );
        assert.equal(await counter(), 1);
        assert.equal(await history("20261116120200"), 0);
      },
    );

    await check(
      "Concurrent duplicate history rolls back the losing rewrite",
      async () => {
        const source =
          "BEGIN;\nUPDATE public.reviewed_fixture SET value=value+1;\nSELECT pg_sleep(0.05);\nCOMMIT;\n";
        const command = await migrationCommand(source, "20261116120300");
        const attempts = await Promise.allSettled([sql(command), sql(command)]);
        assert.equal(
          attempts.filter((result) => result.status === "fulfilled").length,
          1,
        );
        assert.match(
          attempts.find((result) => result.status === "rejected").reason
            .message,
          /23505|duplicate key/,
        );
        assert.equal(await counter(), 2);
        assert.equal(await history("20261116120300"), 1);
      },
    );

    console.log(`${checks} reviewed updater PostgreSQL groups passed.`);
  },
  { migrationsThrough: "00000000000000" },
);
