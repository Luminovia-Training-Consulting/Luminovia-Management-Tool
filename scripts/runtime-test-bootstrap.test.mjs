/** Execute the real QA orchestration with only OS/service boundaries replaced.
 * This checks ordering and child environments without starting a shared stack. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, basename } from "node:path";
import { createHash, randomBytes } from "node:crypto";
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
import { runBounded } from "./testing/run-bounded.mjs";

const source = readFileSync(
  new URL("./runtime-test.mjs", import.meta.url),
  "utf8",
);
const body = source.replace(/^import\s[\s\S]*?from\s"[^"\n]+";\n/gm, "");
assert.equal(
  /^import\s/m.test(body),
  false,
  "Every runner dependency must be explicitly provided by this service-boundary fixture.",
);
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

/** Match the actual application browser process, excluding its independent
 * discovery command and the separate built-PWA execution. */
const applicationExecution = ({ file, args, env }) =>
  file === "npx" &&
  args[0] === "--no-install" &&
  args[1] === "playwright" &&
  args[2] === "test" &&
  env.PORTAL_BROWSER_STAGE === "application" &&
  !args.includes("--list");

async function runFixture({
  failPersistence = false,
  failSeed = false,
  args = [],
  failBrowser = false,
} = {}) {
  const calls = [],
    reports = [];
  // The CLI process boundary supplies virtual reports, while the real evidence
  // validators still run. Genuine Playwright parsing/execution is exercised by
  // runtime-browser-evidence.test.mjs and the canonical native browser stage.
  const browserReport = (path) => {
    const discovery = path.endsWith("plan.json");
    return JSON.stringify({
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
              ok: !discovery,
              tests: ["desktop-chromium", "mobile-chromium"].map(
                (projectName) => ({
                  projectName,
                  expectedStatus: "passed",
                  status: discovery ? "skipped" : "expected",
                  results: discovery
                    ? []
                    : [{ status: "passed", retry: 0, duration: 0, errors: [] }],
                }),
              ),
            },
          ],
        },
      ],
      stats: { expected: 2, unexpected: 0, flaky: 0, skipped: 0, duration: 0 },
    });
  };
  const bindings = {
    cpSync() {},
    mkdirSync() {},
    rmSync() {},
    symlinkSync() {},
    writeFileSync() {},
    mkdtempSync: () => "/owned-qa/scratch",
    readFileSync: (path) =>
      path.endsWith("config.toml")
        ? 'project_id = "luminovia-portal"\n[api]\nport = 54321\n'
        : path.endsWith(".env.test.local")
          ? "SUPABASE_URL=http://127.0.0.1:55321\nSUPABASE_ANON_KEY=fictional-public-fixture\n"
          : path.endsWith("plan.json") || path.endsWith("report.json")
            ? browserReport(path)
            : "",
    readdirSync: (path) =>
      path.endsWith("scripts")
        ? ["commission-api-check.mjs"]
        : path.endsWith("tests/e2e")
          ? ["workflow.spec.ts", "pwa.spec.ts"]
          : [],
    existsSync: () => false,
    join,
    basename,
    randomBytes,
    availableParallelism: () => 4,
    createHash,
    browserPlan,
    browserAcceptance,
    browserFailure,
    tmpdir: () => "/owned-qa/tmp",
    root: "/owned-qa/source",
    runtimeDir: "/owned-qa/reports",
    runtimeSnapshotSource: () => true,
    runtimeTestPhasePlan,
    runBounded,
    runtimeTestArguments,
    acquireTestLock: () => () => {},
    assertTestPortsAvailable: async () => {},
    privateDirectory() {},
    privateWrite: (path, value) => reports.push({ path, value }),
    cleanEnvironment,
    assertLocalDocker: async () => "unix:///var/run/docker.sock",
    command: async (file, args, options) => {
      calls.push({
        file,
        args,
        env: { ...options.env },
        cwd: options.cwd,
        timeoutMs: options.timeoutMs,
        signal: options.signal,
      });
      if (
        args.includes("scripts/runtime-persistence-check.mjs") &&
        failPersistence
      )
        throw new Error("Fictional retained-data failure");
      if (args.includes("scripts/local-seed.mjs") && failSeed)
        throw new Error("Fictional commercial bootstrap failure");
      if (applicationExecution({ file, args, env: options.env }) && failBrowser)
        throw new Error("Fictional browser aggregate deadline");
      return "";
    },
    process: {
      argv: [process.execPath, "scripts/runtime-test.mjs", ...args],
      execPath: process.execPath,
      pid: process.pid,
      env: {},
      once() {},
      removeListener() {},
    },
    console: { log() {}, error() {} },
  };
  let error;
  try {
    await new AsyncFunction(...Object.keys(bindings), body)(
      ...Object.values(bindings),
    );
  } catch (caught) {
    error = caught;
  }
  return { calls, reports, error };
}

test("actual QA runner seeds commercial fixtures after retention and before SQL/API with its explicit owned environment", async () => {
  // Nested normal commands must continue losing these controls by design.
  assert.equal(cleanEnvironment().PORTAL_TEST_MODE, undefined);
  assert.equal(cleanEnvironment().PORTAL_DB_CONTAINER, undefined);
  const result = await runFixture();
  assert.equal(result.error, undefined);
  const persistence = result.calls.findIndex((call) =>
    call.args.includes("scripts/runtime-persistence-check.mjs"),
  );
  const seeds = result.calls.flatMap((call, index) =>
    call.args.includes("scripts/local-seed.mjs") ? [{ call, index }] : [],
  );
  assert.equal(seeds.length, 1);
  const { call: seed, index: bootstrap } = seeds[0];
  const database = result.calls.findIndex((call) =>
    call.args.includes("test:db"),
  );
  const api = result.calls.findIndex((call) =>
    call.args.includes("scripts/commission-api-check.mjs"),
  );
  assert.ok(
    persistence >= 0 &&
      persistence < bootstrap &&
      bootstrap < database &&
      database < api,
  );
  assert.equal(seed.file, process.execPath);
  assert.equal(seed.cwd, "/owned-qa/scratch");
  assert.equal(seed.env.PORTAL_TEST_MODE, "1");
  assert.match(
    seed.env.PORTAL_DB_CONTAINER,
    /^supabase_db_luminovia-portal-test-[a-f0-9]{8}$/,
  );
  assert.equal(
    seed.env.PORTAL_DB_CONTAINER,
    result.calls[persistence].env.PORTAL_DB_CONTAINER,
  );
  assert.equal(
    seed.env.PORTAL_DB_CONTAINER,
    result.calls[api].env.PORTAL_DB_CONTAINER,
  );
  assert.equal(seed.env.SUPABASE_URL, "http://127.0.0.1:55321");
  assert.equal(
    result.reports.some((report) => report.value.startsWith("PASS\n")),
    true,
  );
  const evidence = JSON.parse(
    result.reports
      .filter((report) => report.path.endsWith("acceptance.json"))
      .at(-1).value,
  );
  assert.equal(evidence.phase, "all");
  assert.equal(evidence.status, "passed");
  assert.deepEqual(evidence.stagePlan, runtimeTestPhasePlan().stages);
  assert.match(evidence.sourceSha256, /^[a-f0-9]{64}$/);
  assert.equal(evidence.browsers.application.passed, 2);
  assert.equal(evidence.browsers.pwa.passed, 2);
});

test("failed retention prevents the explicit fixture bootstrap and every SQL/API acceptance stage", async () => {
  const result = await runFixture({ failPersistence: true });
  assert.match(result.error?.message, /retained-data failure/);
  assert.equal(
    result.calls.some((call) => call.args.includes("scripts/local-seed.mjs")),
    false,
  );
  assert.equal(
    result.calls.some((call) => call.args.includes("test:db")),
    false,
  );
  assert.equal(
    result.calls.some((call) =>
      call.args.includes("scripts/commission-api-check.mjs"),
    ),
    false,
  );
});

test("failed commercial bootstrap stops SQL/API acceptance while retaining owned cleanup", async () => {
  const result = await runFixture({ failSeed: true });
  assert.match(result.error?.message, /commercial bootstrap failure/);
  assert.equal(
    result.calls.some((call) => call.args.includes("test:db")),
    false,
  );
  assert.equal(
    result.calls.some((call) =>
      call.args.includes("scripts/commission-api-check.mjs"),
    ),
    false,
  );
  assert.equal(
    result.calls.some(
      (call) =>
        call.args.includes("--project-id") && call.args.includes("--no-backup"),
    ),
    true,
  );
  assert.equal(
    result.reports.some((report) => report.value.startsWith("PASS\n")),
    false,
  );
});

// Execute the real orchestration, verifying the child process contract rather
// than a source-text constant: this must not extend other stages or filter tests.
test("only the complete browser command receives the expanded aggregate budget", async () => {
  const result = await runFixture();
  assert.equal(result.error, undefined);
  const browser = result.calls.filter(applicationExecution);
  assert.equal(browser.length, 1);
  assert.deepEqual(browser[0].args, [
    "--no-install",
    "playwright",
    "test",
    "--grep-invert",
    "built PWA",
  ]);
  const discovery = result.calls.filter(
    (call) =>
      call.env.PORTAL_BROWSER_STAGE === "application" &&
      call.args.includes("--list"),
  );
  assert.equal(discovery.length, 1);
  assert.deepEqual(discovery[0].args, [
    ...browser[0].args,
    "--list",
    "--reporter=json",
  ]);
  assert.equal(discovery[0].timeoutMs, 1200000);
  assert.equal(discovery[0].signal, browser[0].signal);
  assert.ok(
    result.calls.indexOf(discovery[0]) < result.calls.indexOf(browser[0]),
  );
  assert.equal(browser[0].timeoutMs, 1800000);
  assert.ok(browser[0].signal instanceof AbortSignal);
  assert.equal(
    result.calls.filter((call) => call.timeoutMs === 1800000).length,
    1,
  );
  const stages = result.calls.filter(
    (call) => call.signal === browser[0].signal,
  );
  assert.ok(stages.length > 10);
  for (const stage of stages)
    assert.equal(stage.timeoutMs, stage === browser[0] ? 1800000 : 1200000);
});

test("a browser deadline still fails acceptance, skips build/PWA and performs owned cleanup", async () => {
  const result = await runFixture({ failBrowser: true });
  assert.match(result.error?.message, /browser aggregate deadline/);
  assert.equal(
    result.calls.some((call) => call.args.includes("build")),
    false,
  );
  assert.equal(
    result.calls.some((call) => call.args.includes("tests/e2e/pwa.spec.ts")),
    false,
  );
  for (const script of [
    "scripts/runtime-test-preview.mjs",
    "scripts/runtime-cli.mjs",
  ])
    assert.ok(
      result.calls.some(
        (call) => call.args.includes(script) && call.args.includes("stop"),
      ),
    );
  assert.ok(
    result.calls.some(
      (call) =>
        call.args.includes("--project-id") && call.args.includes("--no-backup"),
    ),
  );
  assert.equal(
    result.reports.some((report) => report.value.startsWith("PASS\n")),
    false,
  );
  assert.ok(result.reports.some((report) => report.value.startsWith("FAIL\n")));
  const evidence = JSON.parse(
    result.reports
      .filter((report) => report.path.endsWith("acceptance.json"))
      .at(-1).value,
  );
  assert.equal(evidence.phase, "all");
  assert.equal(evidence.status, "failed");
  assert.equal(evidence.browsers.application.status, "failed");
  assert.equal("pwa" in evidence.browsers, false);
  assert.match(evidence.sourceSha256, /^[a-f0-9]{64}$/);
});
