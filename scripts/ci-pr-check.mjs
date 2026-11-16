/**
 * Bounded PR acceptance without duplicating the quality/coverage jobs or the
 * complete main-only Auth/browser/retention rehearsal. SQL uses the existing
 * pinned PostgreSQL image and real suites, with Auth helpers emulated by them.
 */
import { randomBytes } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertLocalDocker,
  cleanEnvironment,
  command,
  root,
} from "./runtime-lib.mjs";

/** Discover maintained suites on each invocation so new files are not omitted. */
export function prCheckPlan(cwd = root) {
  const scripts = readdirSync(join(cwd, "scripts")).sort();
  const functions = join(cwd, "supabase/functions");
  const handlers = [];
  const entries = [];
  const visit = (directory) => {
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, item.name);
      if (item.isDirectory()) visit(path);
      else if (item.name.endsWith("_test.ts")) handlers.push(path);
      else if (item.name === "index.ts") entries.push(path);
    }
  };
  visit(functions);
  const deno = join(cwd, "node_modules/deno/bin.cjs");
  return {
    guards: [
      [
        process.execPath,
        [
          "--test",
          ...scripts
            .filter((name) => /^runtime-.*\.test\.mjs$/.test(name))
            .map((name) => `scripts/${name}`),
        ],
      ],
      [
        process.execPath,
        [
          deno,
          "lint",
          "--rules-exclude=no-import-prefix,no-control-regex",
          "--ignore=**/*_test.ts",
          functions,
        ],
      ],
      [
        process.execPath,
        [
          deno,
          "lint",
          "--rules-exclude=no-import-prefix,no-control-regex,require-await",
          ...handlers.sort(),
        ],
      ],
      [process.execPath, [deno, "test", "--allow-env", ...handlers]],
      ...entries
        .sort()
        .map((entry) => [process.execPath, [deno, "check", entry]]),
      ["npm", ["audit", "--omit=dev", "--audit-level=low"]],
    ],
    sql: [
      "scripts/db-rpc-tests.mjs",
      ...scripts
        .filter((name) => name.endsWith("-db-tests.mjs"))
        .map((name) => `scripts/${name}`),
    ],
  };
}

/** Run one explicit PR mode. Dependency injection exercises failure/cleanup
 * without Docker; normal execution refuses remote engines and uses no host port.
 */
export async function runPrCheck(
  mode,
  {
    cwd = root,
    run = command,
    docker = assertLocalDocker,
    signal,
    report = console.log,
  } = {},
) {
  if (!["guards", "sql"].includes(mode))
    throw new Error("Choose guards or sql.");
  const plan = prCheckPlan(cwd);
  let env = cleanEnvironment();
  // Neither mode needs a GitHub write/read token, hosted credentials or secrets.
  delete env.GH_TOKEN;
  delete env.GITHUB_TOKEN;
  const step = (file, args, options = {}) =>
    run(file, args, {
      cwd,
      env,
      timeoutMs: 600000,
      signal,
      ...options,
    });
  if (mode === "guards") {
    for (const [file, args] of plan.guards) await step(file, args);
    if (signal?.aborted) throw new Error("PR checks cancelled.");
    report(
      "PR runtime/Edge/audit checks passed; full acceptance runs on main/manual.",
    );
    return;
  }
  env.DOCKER_HOST = await docker();
  delete env.DOCKER_CONTEXT;
  const token = randomBytes(16).toString("hex");
  const name = `supabase_db_luminovia-portal-test-${token}`;
  env.PORTAL_DB_CONTAINER = name;
  const lock = JSON.parse(
    readFileSync(
      join(cwd, "deploy/hostinger/supabase/images.lock.json"),
      "utf8",
    ),
  );
  const image = lock.images.find((item) =>
    item.image.startsWith("supabase/postgres:"),
  )?.pinned;
  if (!/^supabase\/postgres:[^@\s]+@sha256:[a-f0-9]{64}$/.test(image || ""))
    throw new Error("A digest-pinned PostgreSQL image is required.");
  // Pull before claiming ownership; cleanup never targets an existing container
  // just because its name resembles a test project.
  await step("docker", ["pull", image]);
  /** Confirm the exact random ownership label before bounded container removal. */
  const cleanup = async () => {
    // Ignore an already-aborted test signal for bounded ownership/cleanup.
    const options = { quiet: true, signal: undefined, timeoutMs: 30000 };
    const owned = JSON.parse(await step("docker", ["inspect", name], options));
    if (
      owned.length !== 1 ||
      owned[0].Config?.Labels?.["org.luminovia.pr-sql"] !== token ||
      !/^[a-f0-9]{64}$/.test(owned[0].Id)
    )
      throw new Error("PR SQL cleanup refused: container ownership differs.");
    await step("docker", ["rm", "--force", "--volumes", owned[0].Id], options);
  };
  let attempted = false;
  let failure;
  try {
    attempted = true;
    await step("docker", [
      "run",
      "--detach",
      "--name",
      name,
      "--label",
      `org.luminovia.pr-sql=${token}`,
      "--network",
      "none",
      "--user",
      "postgres",
      "--env",
      "PGHOST=/tmp",
      "--entrypoint",
      "/bin/sh",
      image,
      "-ec",
      "initdb -D /tmp/portal-pr-data -U postgres --auth=trust >/dev/null; exec postgres -D /tmp/portal-pr-data -c listen_addresses='' -c unix_socket_directories=/tmp",
    ]);
    await step(
      "docker",
      [
        "exec",
        name,
        "sh",
        "-ec",
        "for attempt in $(seq 1 150); do if pg_isready -U postgres -d postgres >/dev/null 2>&1; then exit 0; fi; sleep 0.2; done; exit 1",
      ],
      { timeoutMs: 40000 },
    );
    await step("docker", [
      "exec",
      name,
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-X",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      "create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;",
    ]);
    for (const suite of plan.sql) await step(process.execPath, [suite]);
  } catch (error) {
    failure = error;
  } finally {
    if (attempted) {
      try {
        await cleanup();
      } catch (error) {
        failure = failure
          ? new AggregateError(
              [failure, error],
              `${failure.message}; cleanup: ${error.message}`,
            )
          : error;
      }
    }
  }
  if (failure) throw failure;
  if (signal?.aborted) throw new Error("PR checks cancelled.");
  report(
    "PR PostgreSQL migration/RLS/race suites passed; native Auth/Storage/retention runs on main/manual.",
  );
}

// Importing the runner in tests has no side effects. Cancellation terminates the
// owned child command, then the SQL finally block removes only its own container.
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const cancellation = new AbortController();
  const cancel = () => cancellation.abort();
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  try {
    await runPrCheck(process.argv[2], { signal: cancellation.signal });
  } finally {
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
  }
}
