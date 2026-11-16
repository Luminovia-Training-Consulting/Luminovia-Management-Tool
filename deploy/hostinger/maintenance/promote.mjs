/**
 * Publish tested allowlisted maintenance changes as signed, deterministic PRs.
 * Native review/CI rules govern the final merge; no direct main write is used.
 * Verify the tested base and remote contents before resuming a partial publication.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
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
const maintenanceLabels = ["type:dependencies", "area:devops", "risk:high"];
const promotionPrefix = "/repos/" + REPOSITORY;
/** Match GitHub's Git blob ID for already validated base64 bytes. SHA-1 is
 * required by this repository's Git object format; this is not a password or
 * authenticity primitive. Parent/signature checks separately bind the commit. */
function gitBlobSha(contents) {
  const bytes = Buffer.from(contents, "base64");
  return createHash("sha1")
    .update("blob " + bytes.length + "\0")
    .update(bytes)
    .digest("hex");
}
/** Check the remote branch against the exact tested patch before publishing.
 * Reject extra parents/files, changed bytes and unverified signatures rather
 * than overwriting an existing branch that a person may have edited. */
async function verifyMaintenanceCommit(commit, patch, api) {
  assert(/^[a-f0-9]{40}$/.test(commit));
  const verification = await api(promotionPrefix + "/git/commits/" + commit);
  assert(
    verification.sha === commit &&
      verification.verification?.verified === true &&
      verification.verification?.reason === "valid" &&
      verification.parents?.length === 1 &&
      verification.parents[0].sha === patch.baseCommit,
    "Existing maintenance branch is not the signed tested candidate.",
  );
  const comparison = await api(
    promotionPrefix + "/compare/" + patch.baseCommit + "..." + commit,
  );
  assert(
    comparison.total_commits === 1 &&
      comparison.status === "ahead" &&
      Array.isArray(comparison.files) &&
      comparison.files.length === patch.files.length,
    "Maintenance branch changed files outside its tested candidate.",
  );
  const expected = new Map(
    patch.files.map((item) => [item.path, gitBlobSha(item.contents)]),
  );
  for (const file of comparison.files) {
    assert(
      expected.has(file.filename) &&
        expected.get(file.filename) === file.sha &&
        ["added", "modified"].includes(file.status),
      "Maintenance branch contents differ from the tested candidate.",
    );
    expected.delete(file.filename);
  }
  assert(expected.size === 0);
}
/** Bind every later mutation to this repository, main target, deterministic
 * branch, tested head and ownership marker. Recheck after label writes so a
 * concurrent edit cannot silently redirect the auto-merge request. */
function verifyMaintenancePr(pr, branch, commit, marker) {
  assert(
    Number.isSafeInteger(pr?.number) &&
      pr.number > 0 &&
      typeof pr.node_id === "string" &&
      pr.node_id.length > 0 &&
      pr.head?.sha === commit &&
      pr.head.ref === branch &&
      pr.head.repo?.full_name === REPOSITORY &&
      pr.base?.ref === "main" &&
      pr.base.repo?.full_name === REPOSITORY &&
      typeof pr.body === "string" &&
      pr.body.includes(marker) &&
      ["open", "closed"].includes(pr.state) &&
      Array.isArray(pr.labels),
    "Maintenance PR identity or tested candidate changed.",
  );
}
/** Add the existing catalogue labels with the App's PR permission. Existing
 * type/risk choices are checked, never silently replaced; remote readback in
 * promote confirms classification before any native merge operation. */
async function labelMaintenancePr(pr, api) {
  const labels = new Set(pr.labels.map((label) => label.name));
  assert(
    [...labels].every((name) => typeof name === "string") &&
      [...labels]
        .filter((name) => name.startsWith("type:"))
        .every((name) => name === maintenanceLabels[0]) &&
      [...labels]
        .filter((name) => name.startsWith("risk:"))
        .every((name) => name === maintenanceLabels[2]),
    "Maintenance PR classification was changed; preserve the reviewed labels.",
  );
  if (maintenanceLabels.every((name) => labels.has(name))) return;
  const [owner, name] = REPOSITORY.split("/");
  const response = await api("/graphql", {
    method: "POST",
    body: {
      query:
        'query($owner:String!,$name:String!){repository(owner:$owner,name:$name){type:label(name:"type:dependencies"){id name} area:label(name:"area:devops"){id name} risk:label(name:"risk:high"){id name}}}',
      variables: { owner, name },
    },
  });
  assert(!response.errors, "Maintenance PR label lookup failed.");
  const ids = ["type", "area", "risk"].map((key, index) => {
    const label = response.data?.repository?.[key];
    assert(
      label?.name === maintenanceLabels[index] &&
        typeof label.id === "string" &&
        label.id.length > 0,
      "A required maintenance label is unavailable.",
    );
    return label.id;
  });
  const labelled = await api("/graphql", {
    method: "POST",
    body: {
      query:
        "mutation($input:AddLabelsToLabelableInput!){addLabelsToLabelable(input:$input){labelable{... on PullRequest{id}}}}",
      variables: { input: { labelableId: pr.node_id, labelIds: ids } },
    },
  });
  assert(
    !labelled.errors &&
      labelled.data?.addLabelsToLabelable?.labelable?.id === pr.node_id,
    "Maintenance PR labels were not confirmed.",
  );
}

/** Publish the tested candidate on an isolated signed branch. Native PR
 * auto-merge enforces current reviews and CI without any branch-rule bypass.
 * A deterministic branch and exact-content verification make lost responses
 * recoverable without overwriting edits or publishing duplicate pull requests. */
export async function promote(patch, { root = ROOT, api = github } = {}) {
  validatePatch(patch, root);
  const main = await api(promotionPrefix + "/branches/main");
  assert(/^[a-f0-9]{40}$/.test(main.commit?.sha));
  if (main.commit.sha !== patch.baseCommit)
    return { status: "stale_candidate_main_moved" };
  const digest = sha(
    JSON.stringify({
      base: patch.baseCommit,
      files: [...patch.files]
        .sort((a, b) => a.path.localeCompare(b.path))
        .map(({ path, baseSha256, sha256 }) => ({ path, baseSha256, sha256 })),
    }),
  );
  const branch =
    "codex/daily-maintenance-" +
    patch.baseCommit.slice(0, 12) +
    "-" +
    digest.slice(0, 24);
  const marker = "<!-- luminovia-maintenance:" + digest + " -->";
  const open = await api(
    promotionPrefix + "/pulls?state=open&base=main&per_page=100",
  );
  assert(
    Array.isArray(open) && open.length < 100,
    "The open PR inventory is incomplete; no maintenance PR was created.",
  );
  const unresolved = open.find(
    (pr) =>
      pr.head?.repo?.full_name === REPOSITORY &&
      typeof pr.head.ref === "string" &&
      pr.head.ref.startsWith("codex/daily-maintenance-") &&
      pr.head.ref !== branch &&
      typeof pr.body === "string" &&
      pr.body.includes("<!-- luminovia-maintenance:"),
  );
  if (unresolved) {
    assert(Number.isSafeInteger(unresolved.number) && unresolved.number > 0);
    return {
      status: "maintenance_existing_pr_requires_resolution",
      pullRequest: unresolved.number,
    };
  }
  let ref = await api(promotionPrefix + "/git/ref/heads/" + branch, {
    allowMissing: true,
  });
  if (ref === null) {
    ref = await api(promotionPrefix + "/git/refs", {
      method: "POST",
      body: { ref: "refs/heads/" + branch, sha: patch.baseCommit },
    });
  }
  assert(
    ref?.ref === "refs/heads/" + branch &&
      /^[a-f0-9]{40}$/.test(ref.object?.sha),
    "Maintenance branch identity was not confirmed.",
  );
  const commit =
    ref.object.sha === patch.baseCommit
      ? await createSignedCommit(
          branch,
          patch.baseCommit,
          patch.files.map(({ path, contents }) => ({ path, contents })),
          "chore: publish verified daily stable component updates",
          api,
        )
      : ref.object.sha;
  await verifyMaintenanceCommit(commit, patch, api);
  const owner = REPOSITORY.split("/")[0];
  const matches = await api(
    promotionPrefix +
      "/pulls?state=all&head=" +
      encodeURIComponent(owner + ":" + branch) +
      "&base=main&per_page=100",
  );
  assert(
    Array.isArray(matches) && matches.length <= 1,
    "Maintenance PR lookup is ambiguous; no duplicate was created.",
  );
  if (matches[0])
    assert(
      Number.isSafeInteger(matches[0].number) && matches[0].number > 0,
      "Maintenance PR lookup returned an invalid number.",
    );
  let pr = matches[0]
    ? await api(promotionPrefix + "/pulls/" + matches[0].number)
    : null;
  if (!pr)
    pr = await api(promotionPrefix + "/pulls", {
      method: "POST",
      body: {
        title: "chore: update verified stable components",
        head: branch,
        base: "main",
        draft: false,
        body:
          marker +
          "\n\nPublishes the signed candidate after independent component and combined application/retained-data checks. All required PR CI and independent review must pass before GitHub may merge it. No direct main update or rule bypass is used.\n",
      },
    });
  verifyMaintenancePr(pr, branch, commit, marker);
  const result = { branch, commit, pullRequest: pr.number };
  if (pr.state === "closed")
    return {
      ...result,
      status:
        pr.merged === true ? "maintenance_pr_merged" : "maintenance_pr_closed",
    };
  if (pr.draft) return { ...result, status: "maintenance_pr_on_hold" };
  await labelMaintenancePr(pr, api);
  pr = await api(promotionPrefix + "/pulls/" + pr.number);
  verifyMaintenancePr(pr, branch, commit, marker);
  assert(
    maintenanceLabels.every((name) =>
      pr.labels.some((label) => label.name === name),
    ) &&
      pr.labels.every(
        ({ name }) =>
          typeof name === "string" &&
          (!name.startsWith("type:") || name === maintenanceLabels[0]) &&
          (!name.startsWith("risk:") || name === maintenanceLabels[2]),
      ),
    "Maintenance PR labels changed before auto-merge.",
  );
  if (pr.state !== "open" || pr.draft)
    return { ...result, status: "maintenance_pr_on_hold" };
  if (pr.auto_merge) {
    assert(
      pr.auto_merge.merge_method === "merge",
      "Unexpected maintenance merge method.",
    );
    return {
      ...result,
      status: "maintenance_pr_waiting_for_required_checks_and_review",
    };
  }
  if (pr.mergeable === true && pr.mergeable_state === "clean") {
    const merged = await api(
      promotionPrefix + "/pulls/" + pr.number + "/merge",
      {
        method: "PUT",
        body: { sha: commit, merge_method: "merge" },
      },
    );
    assert(
      merged?.merged === true && /^[a-f0-9]{40}$/.test(merged.sha),
      "Maintenance PR merge was not confirmed.",
    );
    return {
      ...result,
      status: "maintenance_pr_merged",
      mergeCommit: merged.sha,
    };
  }
  const queued = await api("/graphql", {
    method: "POST",
    body: {
      query:
        "mutation($input:EnablePullRequestAutoMergeInput!){enablePullRequestAutoMerge(input:$input){pullRequest{id number state headRefOid autoMergeRequest{mergeMethod}}}}",
      variables: {
        input: {
          pullRequestId: pr.node_id,
          expectedHeadOid: commit,
          mergeMethod: "MERGE",
        },
      },
    },
  });
  const observed = queued.data?.enablePullRequestAutoMerge?.pullRequest;
  assert(
    !queued.errors &&
      observed?.id === pr.node_id &&
      observed.number === pr.number &&
      observed.headRefOid === commit &&
      (observed.state === "MERGED" ||
        (observed.state === "OPEN" &&
          observed.autoMergeRequest?.mergeMethod === "MERGE")),
    "Maintenance PR auto-merge was not confirmed.",
  );
  return {
    ...result,
    status:
      observed.state === "MERGED"
        ? "maintenance_pr_merged"
        : "maintenance_pr_waiting_for_required_checks_and_review",
  };
}
// Exercise actual signing and PR permissions on an owned draft; never queue or merge it.
export async function signatureProbe(api = github) {
  const prefix = "/repos/" + REPOSITORY;
  const main = await api(prefix + "/branches/main");
  const base = main.commit?.sha;
  assert(/^[a-f0-9]{40}$/.test(base));
  const identity = randomUUID();
  const branch = "codex/maintenance-signature-probe-" + identity;
  const marker = "<!-- luminovia-maintenance-pr-probe:" + identity + " -->";
  const labels = ["type:tests", "area:github", "risk:low"];
  const refPath = prefix + "/git/ref/heads/" + branch;
  assert(
    (await api(refPath, { allowMissing: true })) === null,
    "Temporary probe ref already exists; it was left untouched.",
  );
  let createAttempted = false;
  let prCleanupIdentitySafe = true;
  let temporaryBranchCleaned = false;
  let prAttempted = false;
  let commit, probePullRequest;
  let temporaryPrClosed = false;
  const ownedDraft = (pr) =>
    Number.isSafeInteger(pr?.number) &&
    pr.number > 0 &&
    pr.draft === true &&
    ["open", "closed"].includes(pr.state) &&
    pr.head?.ref === branch &&
    pr.head.sha === commit &&
    pr.head.repo?.full_name === REPOSITORY &&
    pr.base?.ref === "main" &&
    pr.base.repo?.full_name === REPOSITORY &&
    typeof pr.body === "string" &&
    pr.body.includes(marker);
  try {
    createAttempted = true;
    await api(prefix + "/git/refs", {
      method: "POST",
      body: { ref: "refs/heads/" + branch, sha: base },
    });
    commit = await createSignedCommit(
      branch,
      base,
      [
        {
          path: "docs/MAINTENANCE_SIGNATURE_PROBE.txt",
          contents: Buffer.from(
            "Temporary signed maintenance PR probe; main is unchanged.\n",
          ).toString("base64"),
        },
      ],
      "chore: verify maintenance signing and PR permissions",
      api,
    );
    prAttempted = true;
    const pr = await api(prefix + "/pulls", {
      method: "POST",
      body: {
        title: "test: verify temporary maintenance PR capability",
        head: branch,
        base: "main",
        draft: true,
        body:
          marker +
          "\n\nTemporary signing and PR-permission diagnostic. This draft is closed and its branch removed by the diagnostic; it must never be merged.\n",
      },
    });
    assert(
      ownedDraft(pr) && pr.state === "open",
      "Temporary draft PR identity was not confirmed.",
    );
    probePullRequest = pr.number;
    await api(prefix + "/issues/" + probePullRequest + "/labels", {
      method: "POST",
      body: { labels },
    });
    const observed = await api(prefix + "/pulls/" + probePullRequest);
    assert(
      ownedDraft(observed) &&
        observed.state === "open" &&
        Array.isArray(observed.labels) &&
        labels.every((name) =>
          observed.labels.some((label) => label.name === name),
        ),
      "Temporary draft PR and required labels were not confirmed.",
    );
  } finally {
    try {
      if (prAttempted) {
        prCleanupIdentitySafe = false;
        let pr;
        if (probePullRequest) {
          pr = await api(prefix + "/pulls/" + probePullRequest);
          assert(
            ownedDraft(pr),
            "Temporary PR changed; no unrelated PR was closed.",
          );
        } else {
          // A successful create may lose its response. Recover only our exact
          // marker, signed head and draft identity before closing any PR.
          const matches = await api(
            prefix +
              "/pulls?state=all&head=" +
              encodeURIComponent(REPOSITORY.split("/")[0] + ":" + branch) +
              "&base=main&per_page=100",
          );
          assert(
            Array.isArray(matches) && matches.length < 100,
            "Temporary PR cleanup lookup was incomplete.",
          );
          const owned = matches.filter(ownedDraft);
          assert(
            owned.length <= 1,
            "Temporary PR cleanup identity was ambiguous.",
          );
          pr = owned[0];
          if (pr) probePullRequest = pr.number;
          else prCleanupIdentitySafe = matches.length === 0;
        }
        if (pr) {
          prCleanupIdentitySafe = true;
          if (pr.state === "open")
            pr = await api(prefix + "/pulls/" + pr.number, {
              method: "PATCH",
              body: { state: "closed" },
            });
          prCleanupIdentitySafe = ownedDraft(pr);
          assert(
            prCleanupIdentitySafe && pr.state === "closed",
            "Temporary draft PR closure was not confirmed.",
          );
          temporaryPrClosed = true;
        }
      }
    } finally {
      if (createAttempted) {
        const ref = await api(refPath, { allowMissing: true });
        if (ref !== null) {
          assert(
            prCleanupIdentitySafe &&
              ref?.ref === "refs/heads/" + branch &&
              (ref.object?.sha === base ||
                (commit && ref.object?.sha === commit)),
            "Temporary probe identity or head changed; preserve it for inspection.",
          );
          await api(prefix + "/git/refs/heads/" + branch, { method: "DELETE" });
        }
        temporaryBranchCleaned = true;
      }
    }
  }
  assert(
    temporaryPrClosed &&
      temporaryBranchCleaned &&
      Number.isSafeInteger(probePullRequest),
  );
  const after = await api(prefix + "/branches/main");
  assert(
    after.commit?.sha === base,
    "Main changed during the diagnostic; no probe acceptance was recorded.",
  );
  return {
    status: "passed",
    commit,
    probePullRequest,
    mainUnchanged: true,
    temporaryPrClosed: true,
    temporaryBranchCleaned: true,
  };
}
// Handle only documented subcommands and propagate failures as a failed process exit.
async function cli() {
  const [operation, file] = process.argv.slice(2);
  const result =
    operation === "signature-probe"
      ? await signatureProbe()
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
