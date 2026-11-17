/**
 * Bounded PR acceptance without duplicating the quality/coverage jobs or the
 * complete main-only Auth/browser/retention rehearsal. SQL uses the existing
 * pinned PostgreSQL image and real suites, with Auth helpers emulated by them.
 */
import { randomBytes } from "node:crypto";
import { availableParallelism } from "node:os";
import { appendFileSync, readFileSync, readdirSync } from "node:fs";
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
      [
        process.execPath,
        [
          deno,
          "test",
          "--allow-env",
          `--allow-read=${join(functions, "course-documents/assets")}`,
          ...handlers,
        ],
      ],
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

/** Keep separate PostgreSQL workers within the resources actually granted to this runner. */
export function prSqlShardCount(cpuCount = availableParallelism()) {
  if (!Number.isInteger(cpuCount) || cpuCount < 1)
    throw new Error("A positive integer CPU count is required.");
  return Math.min(4, cpuCount);
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
    sqlShard = 0,
    sqlShards = 1,
    recordTiming = () => {},
  } = {},
) {
  if (!["guards", "sql"].includes(mode))
    throw new Error("Choose guards or sql.");
  if (
    !Number.isInteger(sqlShard) ||
    !Number.isInteger(sqlShards) ||
    sqlShards < 1 ||
    sqlShards > 4 ||
    sqlShard < 0 ||
    sqlShard >= sqlShards
  )
    throw new Error("Use one to four valid SQL shards.");
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
  env.PORTAL_TEST_MODE = "1";
  env.PORTAL_TEST_DB_TEMPLATE = `portal_test_template_${token.slice(0, 8)}`;
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
      "initdb -D /tmp/portal-pr-data -U postgres --auth=trust >/dev/null; exec postgres -D /tmp/portal-pr-data -c listen_addresses='' -c unix_socket_directories=/tmp -c jit=off",
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
      // Strict diagnostic and safeupdate-LOAD suites use the same explicit
      // local operator as the native image. This isolated Unix-socket cluster
      // grants no operator capability to the ordinary tested API roles.
      "create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; create role supabase_admin login superuser;",
    ]);
    await step(process.execPath, [
      "scripts/testing/prepare-database-template.mjs",
    ]);
    // Each worker has its own PostgreSQL cluster and connection limit. Never
    // overlap independent 50-claim races inside one shared 100-connection cluster.
    for (const suite of plan.sql.filter(
      (_, index) => index % sqlShards === sqlShard,
    )) {
      const started = performance.now();
      await step(process.execPath, [suite]);
      const seconds = ((performance.now() - started) / 1000).toFixed(2);
      report(`[PR SQL ${sqlShard + 1}/${sqlShards}] ${suite}: ${seconds}s`);
      recordTiming({
        suite,
        seconds,
        worker: sqlShard + 1,
        workers: sqlShards,
      });
    }
  } catch (error) {
    failure = error;
  } finally {
    if (attempted) {
      try {
        await step(
          process.execPath,
          ["scripts/testing/prepare-database-template.mjs", "--drop"],
          { quiet: true, signal: undefined, timeoutMs: 30000 },
        );
      } catch (error) {
        failure = failure
          ? new AggregateError(
              [failure, error],
              `${failure.message}; SQL template cleanup: ${error.message}`,
            )
          : error;
      }
    }
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

/** Run exhaustive SQL shards in separate owned clusters. Failure stops the
 * peer's commands, and all cleanup settles before a combined failure is reported.
 * Injectable workers let tests prove concurrency and membership without Docker.
 */
export async function runPrSqlChecks({
  worker = runPrCheck,
  signal,
  sqlShards = prSqlShardCount(),
  ...options
} = {}) {
  if (!Number.isInteger(sqlShards) || sqlShards < 1 || sqlShards > 4)
    throw new Error("Use one to four valid SQL shards.");
  const cancellation = new AbortController();
  const cancel = () => cancellation.abort();
  if (signal?.aborted) cancel();
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    const results = await Promise.allSettled(
      Array.from({ length: sqlShards }, async (_, sqlShard) => {
        try {
          await worker("sql", {
            ...options,
            signal: cancellation.signal,
            sqlShard,
            sqlShards,
          });
        } catch (error) {
          cancellation.abort();
          throw error;
        }
      }),
    );
    const failures = results
      .filter((result) => result.status === "rejected")
      .map((result) => result.reason);
    if (failures.length)
      throw new AggregateError(
        failures,
        "PR SQL workers failed; owned cleanup completed or its errors are included.",
      );
    if (cancellation.signal.aborted)
      throw new Error("PR SQL checks cancelled.");
  } finally {
    signal?.removeEventListener("abort", cancel);
  }
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
    if (process.argv[2] === "sql")
      await runPrSqlChecks({
        signal: cancellation.signal,
        recordTiming: ({ suite, seconds, worker, workers }) => {
          if (process.env.GITHUB_STEP_SUMMARY)
            appendFileSync(
              process.env.GITHUB_STEP_SUMMARY,
              `- SQL worker ${worker}/${workers}: ${suite} — ${seconds}s\n`,
            );
        },
      });
    else await runPrCheck(process.argv[2], { signal: cancellation.signal });
  } finally {
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
  }
}
