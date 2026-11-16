/** Execute the actual orchestrator with OS/service boundaries replaced only.
 * No GitHub, child process, Docker daemon or shared port is needed here.
 */
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import test from "node:test";
import { cleanEnvironment } from "./runtime-lib.mjs";
import {
  browserPlan,
  browserAcceptance,
  browserFailure,
} from "./testing/browser-evidence.mjs";
import {
  runtimeTestArguments,
  runtimeTestPhasePlan,
} from "./runtime-test-phase.mjs";

const source = readFileSync(
  new URL("./runtime-test.mjs", import.meta.url),
  "utf8",
);
const body = source.replace(/^import\s[\s\S]*?from\s"[^"\n]+";\n/gm, "");
assert.equal(/^import\s/m.test(body), false);
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

/** Stable fictional source/service boundaries preserve the runner's actual
 * discovery, ordering, argument, environment and cleanup decisions.
 */
async function runFixture({
  args = [],
  entry = "scripts/runtime-test.mjs",
  fail = () => false,
  cancelDuringCleanup = false,
  inherited = {},
} = {}) {
  const calls = [],
    reports = [],
    copies = [],
    removed = [],
    messages = [];
  const listeners = new Map();
  let locks = 0,
    released = 0,
    snapshots = 0;
  const directory = (name) => ({ name, isDirectory: () => true });
  const file = (name) => ({ name, isDirectory: () => false });
  // The CLI process boundary supplies virtual reports, while the real evidence
  // validators still run. Genuine Playwright parsing/execution is exercised by
  // runtime-browser-evidence.test.mjs and the canonical native browser stage.
  const browserReport = (path) =>
    JSON.stringify({
      config: {
        rootDir: "/owned-qa/scratch/tests/e2e",
        projects: ["desktop-chromium", "mobile-chromium"].map((name) => ({
          name,
        })),
      },
      errors: [],
      suites: [
        {
          title: "orchestration fixture",
          specs: [
            {
              file: path.includes("/pwa/") ? "pwa.spec.ts" : "workflow.spec.ts",
              title: "service-boundary fixture",
              ok: true,
              tests: ["desktop-chromium", "mobile-chromium"].map(
                (projectName) => ({
                  projectName,
                  expectedStatus: "passed",
                  status: "expected",
                  results: [
                    { status: "passed", retry: 0, duration: 0, errors: [] },
                  ],
                }),
              ),
            },
          ],
        },
      ],
      stats: { expected: 2, unexpected: 0, flaky: 0, skipped: 0, duration: 0 },
    });
  const bindings = {
    cpSync(from, to) {
      copies.push([from, to]);
      if (from === "/owned-qa/source") snapshots++;
    },
    mkdirSync() {},
    rmSync: (path) => removed.push(path),
    symlinkSync() {},
    writeFileSync() {},
    mkdtempSync: () => "/owned-qa/scratch",
    readFileSync: (path) =>
      path.endsWith("config.toml")
        ? 'project_id = "luminovia-portal"\n[api]\nport = 54321\n'
        : path.endsWith(".env.test.local")
          ? "SUPABASE_URL=http://127.0.0.1:55321\nSUPABASE_ANON_KEY=fictional-public-fixture\nE2E_PASSWORD=fictional-local-password\n"
          : path.endsWith("plan.json") || path.endsWith("report.json")
            ? browserReport(path)
            : "",
    readdirSync(path) {
      if (path.endsWith("tests/e2e"))
        return ["workflow.spec.ts", "pwa.spec.ts"];
      if (path.endsWith("scripts"))
        return [
          "runtime-safety.test.mjs",
          "alpha-db-tests.mjs",
          "alpha-api-check.mjs",
          "beta-db-tests.mjs",
          "beta-api-check.mjs",
        ];
      if (path.endsWith("supabase/functions")) return [directory("invites")];
      if (path.endsWith("supabase/functions/invites"))
        return [file("index.ts"), file("index_test.ts")];
      if (path.endsWith("deploy/hostinger"))
        return ["reviewed-migrations.test.mjs"];
      if (path.endsWith("deploy/hostinger/updates"))
        return ["package.test.mjs"];
      if (path.endsWith("deploy/hostinger/scanner")) return ["scan.test.mjs"];
      if (path.endsWith("deploy/hostinger/backups")) return ["crypto.test.mjs"];
      if (path.endsWith("deploy/hostinger/maintenance"))
        return ["candidate.test.mjs"];
      return [];
    },
    existsSync: (path) =>
      /deploy\/hostinger|supabase\/functions|playwright-report$|test-results$|coverage$|docs\/screenshots$|\.local\/runtime\.log$/.test(
        path,
      ),
    join,
    basename,
    randomBytes,
    createHash,
    browserPlan,
    browserAcceptance,
    browserFailure,
    tmpdir: () => "/owned-qa/tmp",
    root: "/owned-qa/source",
    runtimeDir: "/owned-qa/reports",
    runtimeSnapshotSource: () => true,
    runtimeTestPhasePlan,
    runtimeTestArguments,
    acquireTestLock() {
      locks++;
      return () => released++;
    },
    assertTestPortsAvailable: async () => {},
    privateDirectory() {},
    privateWrite: (path, value) => reports.push({ path, value }),
    cleanEnvironment,
    assertLocalDocker: async () => "unix:///var/run/docker.sock",
    command: async (file, args, options) => {
      const call = {
        file,
        args,
        env: { ...options.env },
        cwd: options.cwd,
        timeoutMs: options.timeoutMs,
        signal: options.signal,
      };
      calls.push(call);
      if (
        cancelDuringCleanup &&
        args[0] === "scripts/runtime-cli.mjs" &&
        args[1] === "stop"
      )
        listeners.get("SIGTERM")?.();
      if (fail(call))
        throw new Error(`Fictional stage failure: ${args.join(" ")}`);
      return args.includes("--version") ? "v1.3.2" : "";
    },
    process: {
      argv: [process.execPath, entry, ...args],
      execPath: process.execPath,
      pid: process.pid,
      env: { CI: "true", ...inherited },
      once: (event, handler) => listeners.set(event, handler),
      removeListener: (event) => listeners.delete(event),
    },
    console: { log: (text) => messages.push(text), error() {} },
  };
  let error;
  try {
    await new AsyncFunction(...Object.keys(bindings), body)(
      ...Object.values(bindings),
    );
  } catch (caught) {
    error = caught;
  }
  return {
    calls,
    reports,
    copies,
    removed,
    messages,
    error,
    locks,
    released,
    snapshots,
  };
}

/** Represent actual executed commands independently of the phase planner. */
const commands = (result) =>
  result.calls
    .filter((call) => call.timeoutMs === 1200000)
    .map(({ file, args }) => [file, args]);
const contains = (result, value) =>
  result.calls.some(({ args }) => args.includes(value));

test("no arguments remain complete; explicit phase arguments reject every unknown or partial option", () => {
  const expected = [
    "quality",
    "runtime",
    "coverage",
    "audit",
    "edge",
    "operational",
    "startup",
    "retention",
    "seed",
    "sql",
    "api",
    "invitation",
    "chromium",
    "browser",
    "build",
    "pwa-start",
    "pwa",
  ];
  assert.deepEqual(runtimeTestPhasePlan().stages, expected);
  assert.deepEqual(runtimeTestPhasePlan(["--phase", "all"]).stages, expected);
  const system = runtimeTestPhasePlan(["--phase", "system"]);
  const browser = runtimeTestPhasePlan(["--phase", "browser"]);
  assert.equal(system.system, true);
  assert.equal(system.browser, false);
  assert.equal(browser.system, false);
  assert.equal(browser.browser, true);
  assert.deepEqual(
    system.stages.filter((stage) => browser.stages.includes(stage)),
    ["startup", "retention", "seed"],
  );
  assert.deepEqual(
    [...new Set([...system.stages, ...browser.stages])].sort(),
    [...expected].sort(),
  );
  for (const args of [
    null,
    "system",
    ["--phase"],
    ["--phase", "unknown"],
    ["--phase=browser"],
    ["browser"],
    ["--phase", "browser", "extra"],
    ["--phase", "system", "--phase", "browser"],
  ])
    assert.throws(() => runtimeTestPhasePlan(args), /Use no arguments/);
});

test("actual default runner retains all quality, Edge, operational, SQL/API and browser/PWA commands", async () => {
  const all = await runFixture();
  const explicit = await runFixture({ args: ["--phase", "all"] });
  assert.ifError(all.error);
  assert.ifError(explicit.error);
  assert.deepEqual(commands(all), commands(explicit));
  for (const value of [
    "lint",
    "typecheck",
    "format:check",
    "scripts/runtime-safety.test.mjs",
    "test:coverage",
    "audit",
    "--audit-level=low",
    "--rules-exclude=no-import-prefix,no-control-regex",
    "--allow-env",
    "check",
    "--version",
    "unittest",
    "deploy/hostinger/updates/package.test.mjs",
    "--gateway-routing",
    "scripts/hostinger-caddy-check.mjs",
    "scripts/runtime-persistence-check.mjs",
    "scripts/local-seed.mjs",
    "test:db",
    "scripts/alpha-db-tests.mjs",
    "scripts/beta-db-tests.mjs",
    "scripts/alpha-api-check.mjs",
    "scripts/beta-api-check.mjs",
    "scripts/local-invite-check.mjs",
    "chromium",
    "--grep-invert",
    "build",
    "tests/e2e/pwa.spec.ts",
  ])
    assert(contains(all, value), value);
  assert.match(all.reports.at(-1).value, /^PASS\nPhase: all\n/);
  assert.match(all.reports.at(-1).value, /Complete local acceptance/);
  assert.equal(all.locks, 1);
  assert.equal(all.released, 1);
});

test("the actual public portal test import keeps complete acceptance, including explicit all", async () => {
  const direct = await runFixture();
  for (const args of [["test"], ["test", "--phase", "all"]]) {
    const wrapped = await runFixture({
      entry: "scripts/runtime-cli.mjs",
      args,
    });
    assert.ifError(wrapped.error);
    assert.deepEqual(commands(wrapped), commands(direct));
    assert.match(wrapped.reports.at(-1).value, /^PASS\nPhase: all\n/);
    assert.equal(wrapped.locks, 1);
    assert.equal(wrapped.released, 1);
  }
  const explicitBrowser = await runFixture({
    entry: "/owned-qa/source/scripts/runtime-cli.mjs",
    args: ["test", "--phase", "browser"],
  });
  assert.ifError(explicitBrowser.error);
  assert.match(explicitBrowser.reports.at(-1).value, /^PASS\nPhase: browser\n/);
  assert(!contains(explicitBrowser, "test:db"));
});

test("entry-point normalization never drops unknown commands or trusts a matching basename outside this checkout", async () => {
  const root = "/owned-qa/source";
  for (const argv of [
    [],
    ["node"],
    ["node", "/another-checkout/scripts/runtime-cli.mjs", "test"],
    ["node", "/another-checkout/scripts/runtime-test.mjs"],
    ["node", "scripts/runtime-cli.mjs", "other-command"],
  ])
    assert.throws(() => runtimeTestArguments(argv, root), /owned test runner/);
  for (const [entry, args] of [
    ["scripts/runtime-test.mjs", ["test"]],
    ["scripts/runtime-cli.mjs", ["test", "--phase", "unknown"]],
    ["/another-checkout/scripts/runtime-cli.mjs", ["test"]],
  ]) {
    const result = await runFixture({ entry, args });
    assert(result.error);
    assert.equal(result.locks, 0);
    assert.equal(result.snapshots, 0);
    assert.equal(result.calls.length, 0);
  }
});

test("system and browser phases preserve the complete command partition, duplicating only independent real bootstrap", async () => {
  const all = await runFixture();
  const system = await runFixture({ args: ["--phase", "system"] });
  const browser = await runFixture({ args: ["--phase", "browser"] });
  for (const result of [system, browser]) assert.ifError(result.error);
  const startup = (command) =>
    command[1][0] === "scripts/runtime-cli.mjs" && command[1][1] === "start";
  const bootstrap = (command) =>
    startup(command) ||
    [
      "scripts/runtime-persistence-check.mjs",
      "scripts/local-seed.mjs",
    ].includes(command[1][0]);
  const allCommands = commands(all);
  const expectedSystem = allCommands.slice(
    0,
    allCommands.findIndex(([, args]) => args.includes("chromium")),
  );
  assert.deepEqual(commands(system), expectedSystem);
  const expectedBrowser = [
    ...allCommands.filter(bootstrap),
    ...allCommands.slice(expectedSystem.length),
  ];
  assert.deepEqual(commands(browser), expectedBrowser);
  assert.deepEqual(
    commands(system).filter((command) =>
      commands(browser).some(
        (other) => JSON.stringify(other) === JSON.stringify(command),
      ),
    ),
    allCommands.filter(bootstrap),
  );
  assert.match(system.reports.at(-1).value, /^PASS\nPhase: system\n/);
  assert.match(
    system.reports.at(-1).value,
    /Browser\/build\/PWA acceptance was not run/,
  );
  assert.match(browser.reports.at(-1).value, /^PASS\nPhase: browser\n/);
  assert.match(
    browser.reports.at(-1).value,
    /System SQL\/API\/Edge\/operational acceptance was not run/,
  );
  assert(
    !system.messages.some((message) =>
      /Alle isolierten Prüfungen/.test(message),
    ),
  );
  assert(
    !browser.messages.some((message) =>
      /Alle isolierten Prüfungen/.test(message),
    ),
  );
});

test("browser phase gets its own snapshot, retained real services and explicit owned policy before browser acceptance", async () => {
  const browser = await runFixture({ args: ["--phase", "browser"] });
  assert.ifError(browser.error);
  const relevant = browser.calls.filter(
    ({ timeoutMs }) => timeoutMs === 1200000,
  );
  assert.deepEqual(
    relevant.slice(0, 4).map(({ args }) => args[0]),
    [
      "scripts/runtime-cli.mjs",
      "scripts/runtime-persistence-check.mjs",
      "scripts/local-seed.mjs",
      "--no-install",
    ],
  );
  const seed = relevant[2];
  assert.equal(seed.env.PORTAL_TEST_MODE, "1");
  assert.match(
    seed.env.PORTAL_DB_CONTAINER,
    /^supabase_db_luminovia-portal-test-[a-f0-9]{8}$/,
  );
  assert.equal(seed.env.SUPABASE_URL, "http://127.0.0.1:55321");
  assert.equal(
    seed.env.PORTAL_DB_CONTAINER,
    relevant[1].env.PORTAL_DB_CONTAINER,
  );
  const desktop = relevant.find(
    ({ args }) => args.includes("--grep-invert") && !args.includes("--list"),
  );
  assert.equal(desktop.env.PORTAL_DB_CONTAINER, seed.env.PORTAL_DB_CONTAINER);
  assert.deepEqual(desktop.args, [
    "--no-install",
    "playwright",
    "test",
    "--grep-invert",
    "built PWA",
  ]);
  const pwa = relevant.find(({ args }) =>
    args.includes("tests/e2e/pwa.spec.ts"),
  );
  assert.equal(pwa.env.E2E_PWA, "1");
  assert.equal(pwa.env.E2E_BASE_URL, "http://127.0.0.1:4273");
  assert.equal(browser.snapshots, 1);
  assert.equal(browser.released, 1);
  assert(browser.copies.some(([path]) => path.endsWith("docs/screenshots")));
  assert(!browser.copies.some(([path]) => path.endsWith("coverage")));
  const system = await runFixture({ args: ["--phase", "system"] });
  assert.notEqual(
    system.calls.find(({ args }) => args.includes("scripts/local-seed.mjs")).env
      .PORTAL_DB_CONTAINER,
    seed.env.PORTAL_DB_CONTAINER,
  );
  assert(
    !system.copies.some(([path]) =>
      /docs\/screenshots|playwright-report|test-results/.test(path),
    ),
  );
});

test("bad CLI arguments fail before locking or allocating source/services; environment phase hints cannot shorten default acceptance", async () => {
  const invalid = await runFixture({ args: ["--phase", "unrecognized"] });
  assert.match(invalid.error?.message, /Use no arguments/);
  assert.equal(invalid.locks, 0);
  assert.equal(invalid.snapshots, 0);
  assert.deepEqual(invalid.calls, []);
  const all = await runFixture({
    inherited: {
      PORTAL_TEST_PHASE: "browser",
      CI_PHASE: "browser",
      CI_PROFILE: "docs",
    },
  });
  assert.ifError(all.error);
  assert(contains(all, "test:db"));
  assert(contains(all, "--grep-invert"));
  assert.match(all.reports.at(-1).value, /^PASS\nPhase: all\n/);
});

test("failed startup, retention or policy prevents all browser acceptance while cleanup remains owned", async () => {
  for (const stage of [
    "scripts/runtime-cli.mjs",
    "scripts/runtime-persistence-check.mjs",
    "scripts/local-seed.mjs",
  ]) {
    const result = await runFixture({
      args: ["--phase", "browser"],
      fail: ({ args }) => args[0] === stage && args[1] !== "stop",
    });
    assert.match(result.error?.message, /Fictional stage failure/);
    assert(!contains(result, "chromium"));
    assert(!contains(result, "--grep-invert"));
    assert(!result.reports.some(({ value }) => value.startsWith("PASS\n")));
    assert(result.calls.some(({ args }) => args.includes("--no-backup")));
    assert.equal(result.released, 1);
  }
});

test("system SQL/API failure and browser/PWA failure remain phase failures with checked cleanup", async () => {
  for (const [phase, stage] of [
    ["system", "test:db"],
    ["system", "scripts/alpha-api-check.mjs"],
    ["browser", "--grep-invert"],
    ["browser", "tests/e2e/pwa.spec.ts"],
  ]) {
    const result = await runFixture({
      args: ["--phase", phase],
      fail: ({ args }) => args.includes(stage),
    });
    assert.match(result.error?.message, /Fictional stage failure/);
    assert(result.reports.at(-1).value.startsWith(`FAIL\nPhase: ${phase}\n`));
    assert.equal(result.released, 1);
    assert(result.removed.includes("/owned-qa/scratch"));
    assert(result.calls.some(({ args }) => args.includes("--no-backup")));
    if (phase === "system") assert(!contains(result, "chromium"));
    if (stage === "--grep-invert")
      assert(!contains(result, "tests/e2e/pwa.spec.ts"));
  }
});

test("cancellation during cleanup cannot turn either partial phase into PASS", async () => {
  for (const phase of ["all", "system", "browser"]) {
    const result = await runFixture({
      args: ["--phase", phase],
      cancelDuringCleanup: true,
    });
    assert.match(result.error?.message, /cancelled/);
    assert(!result.reports.some(({ value }) => value.startsWith("PASS\n")));
    assert(result.calls.some(({ args }) => args.includes("--no-backup")));
    assert.equal(result.released, 1);
  }
});

test("a failed service-stop acknowledgement fails every phase while final owned disposal still runs", async () => {
  for (const phase of ["all", "system", "browser"]) {
    const result = await runFixture({
      args: ["--phase", phase],
      fail: ({ args }) =>
        args[0] === "scripts/runtime-cli.mjs" && args[1] === "stop",
    });
    assert.match(result.error?.message, /Fictional stage failure/);
    assert(!result.reports.some(({ value }) => value.startsWith("PASS\n")));
    assert(result.calls.some(({ args }) => args.includes("--no-backup")));
    assert.equal(result.released, 1);
    assert(result.removed.includes("/owned-qa/scratch"));
  }
});
