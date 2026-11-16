/** PR suite discovery and fail-closed orchestration; no real Docker or network. */
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import test from "node:test";
import { prCheckPlan, runPrCheck, runPrSqlChecks } from "./ci-pr-check.mjs";
import { root } from "./runtime-lib.mjs";

test("PR plans include every SQL/runtime suite and Edge entry without repeating frontend quality or coverage", () => {
  const plan = prCheckPlan();
  const scripts = readdirSync(new URL("./", import.meta.url));
  assert.deepEqual(plan.sql, [
    "scripts/db-rpc-tests.mjs",
    ...scripts
      .filter((name) => name.endsWith("-db-tests.mjs"))
      .sort()
      .map((name) => `scripts/${name}`),
  ]);
  assert.deepEqual(
    plan.guards[0][1].slice(1),
    scripts
      .filter((name) => /^runtime-.*\.test\.mjs$/.test(name))
      .sort()
      .map((name) => `scripts/${name}`),
  );
  const args = plan.guards.flatMap(([, args]) => args);
  assert(args.includes("test"));
  assert(args.includes("--allow-env"));
  assert(args.includes("check"));
  assert(args.includes("--audit-level=low"));
  for (const duplicate of [
    "typecheck",
    "build",
    "test:coverage",
    "format:check",
    "./portal test",
  ])
    assert(!args.includes(duplicate), duplicate);
});

test("PR guards stop at the failing command, remove inherited backend/GitHub credentials and never start Docker", async () => {
  const calls = [];
  await assert.rejects(runPrCheck("invalid"), /Choose/);
  const previous = process.env.GH_TOKEN;
  process.env.GH_TOKEN = "fictional-token-must-not-reach-tests";
  try {
    await assert.rejects(
      runPrCheck("guards", {
        docker: () => assert.fail("guards do not need Docker"),
        run: async (file, args, options) => {
          calls.push([file, args]);
          assert.equal(options.env.GH_TOKEN, undefined);
          assert.equal(options.env.SUPABASE_SERVICE_ROLE_KEY, undefined);
          assert.equal(options.cwd, root);
          if (calls.length === 2) throw new Error("fictional Edge failure");
        },
        report: () => assert.fail("failed checks cannot report success"),
      }),
      /fictional Edge failure/,
    );
    assert.equal(calls.length, 2);
  } finally {
    if (previous === undefined) delete process.env.GH_TOKEN;
    else process.env.GH_TOKEN = previous;
  }
});

/** Simulate Docker metadata using only the token actually supplied by the runner. */
function sqlFixture({
  failSuite = false,
  foreign = false,
  cancel = false,
  failStartup,
} = {}) {
  const calls = [];
  const cancellation = new AbortController();
  let token;
  const id = "a".repeat(64);
  const run = async (file, args, options) => {
    calls.push({ file, args, options });
    if (args[0] === "run") {
      token = args[args.indexOf("--label") + 1].split("=")[1];
      assert(args.includes("none"));
      assert(!args.includes("--publish") && !args.includes("-p"));
      assert(args.includes("postgres"));
      assert.match(
        args[args.indexOf("--entrypoint") + 2],
        /@sha256:[a-f0-9]{64}$/,
      );
    }
    if (args[0] === failStartup)
      throw new Error(`fictional ${failStartup} failure`);
    if (file === process.execPath) {
      assert.equal(
        options.env.PORTAL_DB_CONTAINER,
        `supabase_db_luminovia-portal-test-${token}`,
      );
      if (cancel) cancellation.abort();
      if (failSuite || cancel) throw new Error("fictional SQL failure");
    }
    if (args[0] === "inspect") {
      assert.equal(options.signal, undefined);
      return JSON.stringify([
        {
          Id: id,
          Config: {
            Labels: { "org.luminovia.pr-sql": foreign ? "foreign" : token },
          },
        },
      ]);
    }
    if (args[0] === "rm") {
      assert.equal(options.signal, undefined);
      assert.deepEqual(args, ["rm", "--force", "--volumes", id]);
    }
    return "";
  };
  return {
    calls,
    run,
    signal: cancellation.signal,
    docker: async () => "unix:///fictional/docker.sock",
    report: () => {},
  };
}

test("PR SQL replays every existing suite in one pinned networkless image and removes its owned container", async () => {
  const fixture = sqlFixture();
  await runPrCheck("sql", fixture);
  assert.deepEqual(
    fixture.calls
      .filter(({ file }) => file === process.execPath)
      .map(({ args }) => args[0]),
    prCheckPlan().sql,
  );
  assert.equal(fixture.calls.filter(({ args }) => args[0] === "run").length, 1);
  assert.equal(fixture.calls.at(-1).args[0], "rm");
});

test("SQL failure/cancellation stops later suites but still cleans the exact owned container", async () => {
  for (const cancel of [false, true]) {
    const fixture = sqlFixture({ failSuite: true, cancel });
    await assert.rejects(runPrCheck("sql", fixture), /fictional SQL failure/);
    assert.equal(
      fixture.calls.filter(({ file }) => file === process.execPath).length,
      1,
    );
    assert.equal(fixture.calls.at(-1).args[0], "rm");
  }
});

test("SQL cleanup refuses a foreign ownership label even after failed acceptance", async () => {
  const fixture = sqlFixture({ failSuite: true, foreign: true });
  await assert.rejects(runPrCheck("sql", fixture), /ownership differs/);
  assert(!fixture.calls.some(({ args }) => args[0] === "rm"));
});

// A failed pull owns nothing; startup/readiness/role errors still enter cleanup.
test("SQL startup failures stop assertions and retain bounded owned cleanup", async () => {
  for (const failStartup of ["pull", "run", "exec"]) {
    const fixture = sqlFixture({ failStartup });
    await assert.rejects(
      runPrCheck("sql", fixture),
      new RegExp(`fictional ${failStartup} failure`),
    );
    assert(!fixture.calls.some(({ file }) => file === process.execPath));
    assert.equal(
      fixture.calls.some(({ args }) => args[0] === "rm"),
      failStartup !== "pull",
    );
  }
});

// All original suites must run exactly once across the two clusters.
test("SQL shards partition every suite exactly once with distinct owned clusters", async () => {
  const fixtures = [sqlFixture(), sqlFixture()];
  await Promise.all(
    fixtures.map((fixture, sqlShard) =>
      runPrCheck("sql", { ...fixture, sqlShard, sqlShards: 2 }),
    ),
  );
  const suites = fixtures.map((fixture) =>
    fixture.calls
      .filter(({ file }) => file === process.execPath)
      .map(({ args }) => args[0]),
  );
  assert.deepEqual(suites.flat().sort(), [...prCheckPlan().sql].sort());
  assert(!suites[0].some((suite) => suites[1].includes(suite)));
  const names = fixtures.map(
    (fixture) => fixture.calls.find(({ args }) => args[0] === "run").args,
  );
  assert.notEqual(
    names[0][names[0].indexOf("--name") + 1],
    names[1][names[1].indexOf("--name") + 1],
  );
  for (const args of names) {
    assert(args.at(-1).includes("-c jit=off"));
    assert(!/fsync|synchronous_commit|max_connections/.test(args.at(-1)));
  }
  await assert.rejects(
    runPrCheck("sql", { sqlShard: 2, sqlShards: 2 }),
    /valid SQL shards/,
  );
});

test("SQL workers overlap, abort the peer on failure and await both cleanup paths", async () => {
  const active = [];
  let peerCleaned = false;
  let releaseFirst;
  const firstStarted = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  await assert.rejects(
    runPrSqlChecks({
      worker: async (_mode, { sqlShard, signal, sqlShards }) => {
        assert.equal(sqlShards, 2);
        active.push(sqlShard);
        if (sqlShard === 0) {
          releaseFirst();
          await new Promise((resolve) =>
            signal.addEventListener("abort", resolve, { once: true }),
          );
          await Promise.resolve();
          peerCleaned = true;
          throw new Error("peer cancelled after cleanup");
        }
        await firstStarted;
        assert.deepEqual(active.sort(), [0, 1]);
        throw new Error("fictional worker failed");
      },
    }),
    AggregateError,
  );
  assert.equal(peerCleaned, true);
});

// Cancellation cannot turn a successful-looking worker outcome into acceptance.
test("SQL worker orchestration rejects pre-existing and mid-run cancellation", async () => {
  for (const alreadyAborted of [true, false]) {
    const cancellation = new AbortController();
    if (alreadyAborted) cancellation.abort();
    let completed = 0;
    await assert.rejects(
      runPrSqlChecks({
        signal: cancellation.signal,
        worker: async (_mode, { signal }) => {
          if (alreadyAborted) assert(signal.aborted);
          else cancellation.abort();
          await Promise.resolve();
          completed++;
        },
      }),
      /cancelled/,
    );
    assert.equal(completed, 2);
  }
});
