/** Execute the real QA orchestration with only OS/service boundaries replaced.
 * This checks ordering and child environments without starting a shared stack. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, basename } from "node:path";
import { randomBytes } from "node:crypto";
import { cleanEnvironment } from "./runtime-lib.mjs";

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

async function runFixture({ failPersistence = false, failSeed = false } = {}) {
  const calls = [],
    reports = [];
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
          : "",
    readdirSync: (path) =>
      path.endsWith("scripts") ? ["commission-api-check.mjs"] : [],
    existsSync: () => false,
    join,
    basename,
    randomBytes,
    tmpdir: () => "/owned-qa/tmp",
    root: "/owned-qa/source",
    runtimeDir: "/owned-qa/reports",
    runtimeSnapshotSource: () => true,
    acquireTestLock: () => () => {},
    assertTestPortsAvailable: async () => {},
    privateDirectory() {},
    privateWrite: (path, value) => reports.push({ path, value }),
    cleanEnvironment,
    assertLocalDocker: async () => "unix:///var/run/docker.sock",
    command: async (file, args, options) => {
      calls.push({ file, args, env: { ...options.env }, cwd: options.cwd });
      if (
        args.includes("scripts/runtime-persistence-check.mjs") &&
        failPersistence
      )
        throw new Error("Fictional retained-data failure");
      if (args.includes("scripts/local-seed.mjs") && failSeed)
        throw new Error("Fictional commercial bootstrap failure");
      return "";
    },
    process: {
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
