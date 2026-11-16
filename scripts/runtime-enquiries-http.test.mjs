/** Executable listener-boundary regressions use owned loopback HTTP and fictional configuration, never a database. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";

const root = resolve(import.meta.dirname, "..");
const candidateProject = "luminovia-portal-test-" + "a".repeat(24);
const canonicalProject = "luminovia-portal-test-a1b2c3d4";

/** Runs the unchanged listener with a harmless runtime stub; only the adapter's guard and real Deno socket are under test. */
async function listenerFixture(t, changes = {}) {
  const directory = await mkdtemp(join(tmpdir(), "portal-enquiry-listener-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const listener = join(directory, "scripts/testing/enquiries-edge-http.ts");
  await mkdir(dirname(listener), { recursive: true });
  await mkdir(join(directory, "supabase/functions/website-enquiries"), {
    recursive: true,
  });
  await writeFile(
    listener,
    await readFile(join(root, "scripts/testing/enquiries-edge-http.ts")),
  );
  await writeFile(
    join(directory, "supabase/functions/website-enquiries/runtime.ts"),
    'export const websiteEnquiryRuntime = () => () => new Response("fictional listener");\n',
  );
  const environment = {
    PORTAL_TEST_MODE: "1",
    SUPABASE_URL: "http://127.0.0.1:55321",
    PORTAL_ENQUIRY_TEST_API_ORIGIN: "http://127.0.0.1:55321",
    PORTAL_ENQUIRY_TEST_PROJECT: canonicalProject,
    ...changes,
  };
  await writeFile(
    join(directory, "supabase/config.toml"),
    `project_id = "${environment.configProject ?? environment.PORTAL_ENQUIRY_TEST_PROJECT}"\n`,
  );
  delete environment.configProject;
  const child = spawn(
    join(root, "node_modules/deno/deno"),
    [
      "run",
      "--allow-env",
      "--allow-read=supabase/config.toml",
      "--allow-net=127.0.0.1,localhost,[::1]",
      listener,
    ],
    {
      cwd: directory,
      env: { PATH: process.env.PATH, ...environment },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const ended = once(child, "close");
  t.after(async () => {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await ended;
    }
  });
  return new Promise((resolveResult, reject) => {
    let output = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(Error("Fictional listener did not finish startup"));
    }, 10000);
    child.on("error", reject);
    child.stdout.on("data", (data) => {
      output += data;
      const match = /PORTAL_ENQUIRY_TEST_PORT=(\d+)/.exec(output);
      if (match) {
        clearTimeout(timeout);
        resolveResult({ port: Number(match[1]), output });
      }
    });
    child.stderr.resume();
    child.once("close", (code) => {
      clearTimeout(timeout);
      resolveResult({ code, output });
    });
  });
}

test("enquiry listener accepts the canonical owned test endpoint", async (t) => {
  const result = await listenerFixture(t);
  assert.ok(result.port, "Canonical listener reaches actual readiness");
  assert.equal(
    await (await fetch(`http://127.0.0.1:${result.port}`)).text(),
    "fictional listener",
  );
});

test("enquiry listener accepts the already ownership-verified native candidate endpoint", async (t) => {
  const result = await listenerFixture(t, {
    SUPABASE_URL: "https://127.0.0.1:44777",
    PORTAL_ENQUIRY_TEST_API_ORIGIN: "https://127.0.0.1:44777",
    PORTAL_ENQUIRY_TEST_PROJECT: candidateProject,
    PORTAL_CANDIDATE_OWNER: candidateProject,
    PORTAL_DB_CONTAINER: "supabase_db_" + candidateProject,
  });
  assert.ok(result.port, "Native candidate listener reaches actual readiness");
});

test("enquiry listener rejects unowned, mismatched, ordinary, remote and missing-test contexts before readiness", async (t) => {
  const native = {
    SUPABASE_URL: "https://127.0.0.1:44777",
    PORTAL_ENQUIRY_TEST_API_ORIGIN: "https://127.0.0.1:44777",
    PORTAL_ENQUIRY_TEST_PROJECT: candidateProject,
    PORTAL_CANDIDATE_OWNER: candidateProject,
    PORTAL_DB_CONTAINER: "supabase_db_" + candidateProject,
  };
  for (const [name, changes] of [
    ["missing test mode", { PORTAL_TEST_MODE: "" }],
    ["missing confirmed endpoint", { PORTAL_ENQUIRY_TEST_API_ORIGIN: "" }],
    ["ordinary project", { configProject: "luminovia-portal" }],
    ["different project", { configProject: canonicalProject + "a" }],
    ["ordinary API", { SUPABASE_URL: "http://127.0.0.1:54321" }],
    ["remote API", { SUPABASE_URL: "https://backend.example.invalid" }],
    ["unowned native", { ...native, PORTAL_CANDIDATE_OWNER: "" }],
    [
      "different native owner",
      { ...native, PORTAL_CANDIDATE_OWNER: canonicalProject },
    ],
    [
      "different native DB",
      { ...native, PORTAL_DB_CONTAINER: "supabase_db_unrelated" },
    ],
    [
      "different native API",
      { ...native, SUPABASE_URL: "https://127.0.0.1:44778" },
    ],
    [
      "insecure native API",
      {
        ...native,
        SUPABASE_URL: "http://127.0.0.1:44777",
        PORTAL_ENQUIRY_TEST_API_ORIGIN: "http://127.0.0.1:44777",
      },
    ],
  ]) {
    await t.test(name, async (subtest) => {
      const result = await listenerFixture(subtest, changes);
      assert.notEqual(result.code, 0);
      assert.equal(
        result.port,
        undefined,
        "Rejected context never starts HTTP",
      );
      assert.doesNotMatch(result.output, /PORTAL_ENQUIRY_TEST_PORT=/);
    });
  }
});
