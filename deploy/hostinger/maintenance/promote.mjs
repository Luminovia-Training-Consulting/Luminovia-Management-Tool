/**
 * Promote only verified changes from the fixed maintenance allowlist. Compare the expected main base before creating a signed commit so a stale candidate cannot overwrite concurrent work.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ALLOWED_FILES,
  IMAGE_POLICIES,
  FILE_TYPE_SOURCE,
  JOSE_SOURCE,
  PG_POLICY,
  PG_PROOF,
  NODE_VERSION,
  REPOSITORY,
  ROOT,
  SDK_FILES,
  compareVersions,
  composeImages,
  sha,
  stableVersion,
  validatePgProof,
} from "./daily-updates.mjs";

// Limit one candidate diff to allowed files and their permitted update values.
export function validateFileChange(
  path,
  before,
  after,
  { allowPgCandidate = false } = {},
) {
  assert(ALLOWED_FILES.has(path));
  if (path === NODE_VERSION)
    assert(
      /^\d+\.\d+\.\d+\n$/.test(after) &&
        /^\d+\.\d+\.\d+\n$/.test(before) &&
        compareVersions(after.trim(), before.trim()) >= 0,
      "Node build compiler must be an exact stable version without downgrade.",
    );
  else if (path === PG_PROOF) validatePgProof(JSON.parse(after));
  else if (path === "package.json") {
    const old = JSON.parse(before),
      next = JSON.parse(after);
    for (const section of ["dependencies", "devDependencies", "overrides"]) {
      assert.deepEqual(
        Object.keys(next[section] ?? {}).sort(),
        Object.keys(old[section] ?? {}).sort(),
        "Maintenance cannot add/remove packages.",
      );
      for (const [name, version] of Object.entries(next[section] ?? {})) {
        assert(
          stableVersion(version),
          "Only exact stable npm versions may be promoted.",
        );
        assert(
          compareVersions(version, old[section][name]) >= 0,
          "Maintenance cannot downgrade an npm dependency.",
        );
      }
      delete old[section];
      delete next[section];
    }
    assert.deepEqual(
      next,
      old,
      "Maintenance cannot change npm scripts or project configuration.",
    );
  } else if (path === "package-lock.json") {
    const old = JSON.parse(before),
      next = JSON.parse(after);
    assert.equal(next.name, old.name);
    assert.equal(next.lockfileVersion, old.lockfileVersion);
    assert(next.packages && Object.keys(next.packages).length < 10000);
    for (const item of Object.values(next.packages))
      if (item.resolved)
        assert(
          item.resolved.startsWith("https://registry.npmjs.org/"),
          "Lockfile dependencies must use the official npm registry.",
        );
  } else if (path.endsWith("/compose.yml")) {
    assert.equal(
      after.replace(/^ {4}image:.*$/gm, "    image: VERIFIED_PIN"),
      before.replace(/^ {4}image:.*$/gm, "    image: VERIFIED_PIN"),
      "Maintenance may only change Compose image pins.",
    );
    const old = composeImages(before),
      next = composeImages(after);
    assert.deepEqual([...next.keys()], [...old.keys()]);
    for (const [service, pin] of next) {
      if (pin === old.get(service)) continue;
      const policy =
        service === "db" && allowPgCandidate
          ? PG_POLICY
          : IMAGE_POLICIES.find(
              (item) => item.service === service && item.file === path,
            );
      assert(
        policy &&
          (service !== "db" ||
            (allowPgCandidate &&
              /^supabase\/postgres:17\.\d+\.\d+\.\d+@sha256:[a-f0-9]{64}$/.test(
                pin,
              ))),
        "PostgreSQL needs its separate genuine restore gate.",
      );
      const publisher =
        policy.image === "library/caddy" ? "caddy" : policy.image;
      assert(
        pin.startsWith(publisher + ":"),
        "Runtime image publisher changed.",
      );
    }
  } else {
    const sdk =
      path === JOSE_SOURCE
        ? /jsr:@panva\/jose@\d+(?:\.\d+){0,2}/g
        : path === FILE_TYPE_SOURCE
          ? /npm:file-type@\d+\.\d+\.\d+/g
          : /npm:@supabase\/supabase-js@\d+\.\d+\.\d+/g;
    assert(
      (after.match(sdk) ?? []).length === 1 &&
        (before.match(sdk) ?? []).length === 1,
    );
    if (path === JOSE_SOURCE) {
      const from = before.match(sdk)[0].split("@").at(-1),
        to = after.match(sdk)[0].split("@").at(-1);
      assert(
        stableVersion(to) && compareVersions(to, from) >= 0,
        "Router JSR pin must be exact stable and cannot downgrade.",
      );
    }
    assert.equal(
      after.replace(sdk, "VERIFIED_SDK_PIN"),
      before.replace(sdk, "VERIFIED_SDK_PIN"),
      "Maintenance may only change the Edge SDK version.",
    );
  }
}
// Validate the source base, candidate structure and every change before writing to GitHub.
export function validatePatch(patch, root = ROOT) {
  assert(
    patch.schemaVersion === 1 &&
      patch.repository === REPOSITORY &&
      patch.component === "combined" &&
      patch.status === "passed" &&
      /^[a-f0-9]{40}$/.test(patch.baseCommit),
  );
  assert(
    Array.isArray(patch.files) &&
      patch.files.length > 0 &&
      patch.files.length <= ALLOWED_FILES.size,
  );
  const seen = new Set();
  const beforeFiles = new Map(),
    afterFiles = new Map();
  const hasPgProof = patch.files.some((item) => item.path === PG_PROOF);
  for (const item of patch.files) {
    assert(ALLOWED_FILES.has(item.path) && !seen.has(item.path));
    seen.add(item.path);
    assert(
      typeof item.contents === "string" &&
        item.contents.length <= 12 * 1024 * 1024,
    );
    const bytes = Buffer.from(item.contents, "base64");
    assert.equal(bytes.toString("base64"), item.contents);
    assert.equal(sha(bytes), item.sha256);
    let before;
    try {
      before = execFileSync(
        "git",
        ["show", patch.baseCommit + ":" + item.path],
        {
          cwd: root,
          stdio: ["ignore", "pipe", "pipe"],
          maxBuffer: 12 * 1024 * 1024,
        },
      );
    } catch {
      assert(
        item.path === PG_PROOF && item.baseSha256 === null,
        "Only a genuine PG proof may be a new file.",
      );
    }
    assert.equal(
      before === undefined ? null : sha(before),
      item.baseSha256,
      "Patch source differs from tested base.",
    );
    validateFileChange(
      item.path,
      before?.toString("utf8") ?? "",
      bytes.toString("utf8"),
      { allowPgCandidate: hasPgProof },
    );
    beforeFiles.set(item.path, before?.toString("utf8") ?? "");
    afterFiles.set(item.path, bytes.toString("utf8"));
  }
  const backend = "deploy/hostinger/selfhost/compose.yml";
  const oldDb = beforeFiles.has(backend)
    ? composeImages(beforeFiles.get(backend)).get("db")
    : null;
  const newDb = afterFiles.has(backend)
    ? composeImages(afterFiles.get(backend)).get("db")
    : null;
  if (oldDb !== newDb || hasPgProof) {
    assert(
      oldDb && newDb && oldDb !== newDb && hasPgProof,
      "A PostgreSQL image change and its fresh retained-data proof must be promoted together.",
    );
    const proof = JSON.parse(afterFiles.get(PG_PROOF));
    validatePgProof(proof);
    assert.equal(proof.sourceImage, oldDb);
    assert.equal(proof.targetImage, newDb);
    assert.equal(proof.sourceCommit, patch.baseCommit);
    const migrations = resolve(root, "supabase/migrations");
    const inventory = readdirSync(migrations)
      .filter((name) => /^\d{14}_[a-z0-9_]+\.sql$/.test(name))
      .sort()
      .map((name) => ({
        path: "supabase/migrations/" + name,
        sha256: sha(readFileSync(resolve(migrations, name))),
      }));
    assert(inventory.length > 0);
    assert.equal(
      proof.migrationInventorySha256,
      sha(JSON.stringify(inventory)),
      "PostgreSQL proof migration sources differ.",
    );
  }
  if (
    patch.files.some(
      (item) =>
        item.path === "package.json" ||
        SDK_FILES.includes(item.path) ||
        item.path === FILE_TYPE_SOURCE,
    )
  ) {
    const content = (path) => {
      const item = patch.files.find((entry) => entry.path === path);
      return item
        ? Buffer.from(item.contents, "base64").toString("utf8")
        : execFileSync("git", ["show", patch.baseCommit + ":" + path], {
            cwd: root,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
          });
    };
    const pkg = JSON.parse(content("package.json"));
    for (const file of SDK_FILES)
      assert(
        content(file).includes(
          "npm:@supabase/supabase-js@" +
            pkg.dependencies["@supabase/supabase-js"],
        ),
        "Edge and frontend SDK pins differ.",
      );
    assert(
      content(FILE_TYPE_SOURCE).includes(
        "npm:file-type@" + pkg.devDependencies["file-type"],
      ),
      "Edge and tested file-type pins differ.",
    );
  }
}
// Call the required GitHub API and propagate failure instead of returning apparent partial success.
export async function github(
  path,
  { method = "GET", body, allowMissing = false } = {},
) {
  assert(process.env.GH_TOKEN, "Isolated promotion token is required.");
  const response = await fetch("https://api.github.com" + path, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      Authorization: "Bearer " + process.env.GH_TOKEN,
      "X-GitHub-Api-Version": "2026-03-10",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  if (allowMissing && response.status === 404) return null;
  assert(
    response.ok,
    "GitHub promotion operation was refused; no private response printed.",
  );
  return response.status === 204 ? null : response.json();
}
// Create the signed commit on the checked base and read back signature verification.
async function createSignedCommit(branch, base, additions, headline, api) {
  const response = await api("/graphql", {
    method: "POST",
    body: {
      query:
        "mutation($input:CreateCommitOnBranchInput!){createCommitOnBranch(input:$input){commit{oid}}}",
      variables: {
        input: {
          branch: { repositoryNameWithOwner: REPOSITORY, branchName: branch },
          expectedHeadOid: base,
          message: { headline },
          fileChanges: { additions },
        },
      },
    },
  });
  assert(!response.errors, "Signed commit mutation was refused.");
  const commit = response.data?.createCommitOnBranch?.commit?.oid;
  assert(/^[a-f0-9]{40}$/.test(commit));
  const verification = await api(
    "/repos/" + REPOSITORY + "/git/commits/" + commit,
  );
  assert(
    verification.verification?.verified === true &&
      verification.verification?.reason === "valid",
    "GitHub commit signature was not verified.",
  );
  assert(
    verification.parents.length === 1 && verification.parents[0].sha === base,
    "Promotion did not retain its tested parent.",
  );
  return commit;
}
// Recheck current main and promote only a fully validated candidate whose base is still current.
// Keep the final branch update bound to the checked base; a concurrent main update wins over a stale patch.
export async function promote(patch, { root = ROOT, api = github } = {}) {
  validatePatch(patch, root);
  const branch = await api("/repos/" + REPOSITORY + "/branches/main");
  if (branch.commit?.sha !== patch.baseCommit)
    return { status: "stale_candidate_main_moved" };
  const commit = await createSignedCommit(
    "main",
    patch.baseCommit,
    patch.files.map((item) => ({ path: item.path, contents: item.contents })),
    "chore: apply verified daily stable component updates",
    api,
  );
  // The scoped App also triggers push CI. Explicit dispatch binds the exact
  // signed revision; the existing main concurrency group coalesces duplicate runs.
  await api("/repos/" + REPOSITORY + "/actions/workflows/ci.yml/dispatches", {
    method: "POST",
    body: { ref: "main", inputs: { expected_commit: commit } },
  });
  return { status: "promoted_waiting_for_exact_main_ci", commit };
}
// Test actual signing capability through the current GitHub write path on an owned probe ref.
export async function signatureProbe(api = github) {
  const main = await api("/repos/" + REPOSITORY + "/branches/main");
  const base = main.commit?.sha;
  assert(/^[a-f0-9]{40}$/.test(base));
  const branch = "codex/maintenance-signature-probe-" + randomUUID();
  let created = false;
  try {
    await api("/repos/" + REPOSITORY + "/git/refs", {
      method: "POST",
      body: { ref: "refs/heads/" + branch, sha: base },
    });
    created = true;
    const commit = await createSignedCommit(
      branch,
      base,
      [
        {
          path: "docs/MAINTENANCE_SIGNATURE_PROBE.txt",
          contents: Buffer.from(
            "Temporary signed maintenance probe; main is unchanged.\n",
          ).toString("base64"),
        },
      ],
      "chore: verify automatic maintenance signing",
      api,
    );
    return {
      status: "passed",
      commit,
      mainUnchanged: true,
      temporaryBranchCleaned: true,
    };
  } finally {
    if (created)
      await api("/repos/" + REPOSITORY + "/git/refs/heads/" + branch, {
        method: "DELETE",
      });
  }
}
// Dispatch CI only for the expected current main commit; starting a workflow does not mean it passed.
export async function retryMainChecks(api = github) {
  const branch = await api("/repos/" + REPOSITORY + "/branches/main");
  const commit = branch.commit?.sha;
  assert(/^[a-f0-9]{40}$/.test(commit));
  const release = await api(
    "/repos/" + REPOSITORY + "/releases/tags/cms-dev-" + commit,
    { allowMissing: true },
  );
  if (release?.immutable === true && !release.draft)
    return { status: "current_main_already_released", commit };
  const runs = await api(
    "/repos/" +
      REPOSITORY +
      "/actions/workflows/ci.yml/runs?branch=main&head_sha=" +
      commit +
      "&per_page=10",
  );
  if (
    runs.workflow_runs.some(
      (run) => run.head_sha === commit && run.status !== "completed",
    )
  )
    return { status: "exact_main_checks_already_running", commit };
  await api("/repos/" + REPOSITORY + "/actions/workflows/ci.yml/dispatches", {
    method: "POST",
    body: { ref: "main", inputs: { expected_commit: commit } },
  });
  return { status: "retried_unreleased_main_checks", commit };
}
// Handle only documented subcommands and propagate failures as a failed process exit.
async function cli() {
  const [operation, file] = process.argv.slice(2);
  const result =
    operation === "signature-probe"
      ? await signatureProbe()
      : operation === "retry-main"
        ? await retryMainChecks()
        : operation === "promote"
          ? await promote(JSON.parse(await readFile(file, "utf8")))
          : null;
  assert(result, "Unknown promotion operation.");
  console.log(JSON.stringify(result));
  if (process.env.GITHUB_STEP_SUMMARY)
    await writeFile(
      process.env.GITHUB_STEP_SUMMARY,
      JSON.stringify(result) + "\n",
      { flag: "a" },
    );
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  cli().catch(() => {
    console.error(
      "Daily promotion or signature probe did not pass; private response withheld.",
    );
    process.exitCode = 1;
  });
