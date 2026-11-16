import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validatePullRequestMetadata } from "./pr-metadata.mjs";

export const repository =
  "Luminovia-Training-Consulting/Luminovia-Management-Tool";
const shaPattern = /^[a-f0-9]{40}$/;
const workflows = ["ci.yml", "security.yml", "pr-metadata.yml"];
const requiredChecks = new Map([
  ...[
    "Build",
    "Typecheck",
    "Lint",
    "Formatting",
    "Code quality",
    "Tests and coverage",
    "verify",
    "Actual isolated selfhost image compatibility",
    "PR metadata",
    "CodeQL (javascript-typescript)",
    "CodeQL (python)",
    "CodeQL (actions)",
    "Dependency review",
  ].map((name) => [name, 15368]),
  ["CodeQL", 57789],
]);
const prefix = `/repos/${repository}`;
const blocked = (reason) => ({ eligible: false, reason });
function assert(condition) {
  if (!condition) throw new Error("Invalid or incomplete GitHub response.");
}

/** A name alone is not evidence: require the current SHA and the expected App.
 * Only the newest attempt from that App counts; old failures cannot mask retries. */
export function evaluateChecks(checks, head) {
  assert(Array.isArray(checks) && shaPattern.test(head));
  const latest = new Map();
  for (const check of checks) {
    assert(Number.isSafeInteger(check.id) && typeof check.name === "string");
    const key = `${check.app?.id}:${check.name}`;
    if (!latest.has(key) || check.id > latest.get(key).id)
      latest.set(key, check);
  }
  for (const [name, app] of requiredChecks) {
    const check = latest.get(`${app}:${name}`);
    if (
      !check ||
      check.head_sha !== head ||
      check.status !== "completed" ||
      check.conclusion !== "success"
    )
      return blocked("required-checks");
  }
  for (const check of latest.values()) {
    // The publication job is intentionally inapplicable to pull requests.
    if (
      check.app?.id === 15368 &&
      check.name === "Publish tested CMS update" &&
      check.conclusion === "skipped"
    )
      continue;
    if (
      check.head_sha !== head ||
      check.status !== "completed" ||
      check.conclusion !== "success"
    )
      return blocked("additional-checks");
  }
  return { eligible: true };
}

/** Fixed API paths and bounded pagination prevent payload URLs/token forwarding. */
export function githubClient(token, fetcher = fetch) {
  assert(typeof token === "string" && token.length > 0);
  return async (path, { method = "GET", body } = {}) => {
    assert(typeof path === "string" && path.startsWith(`${prefix}/`));
    const url = new URL(path, "https://api.github.com");
    // Git compare uses a literal three-dot delimiter. Reject actual repository
    // traversal after URL normalization rather than rejecting that delimiter.
    assert(
      url.origin === "https://api.github.com" &&
        url.pathname.startsWith(`${prefix}/`),
    );
    let response;
    try {
      response = await fetcher(url.href, {
        method,
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2026-03-10",
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new Error("GitHub request failed; no merge confirmed.");
    }
    if (!response.ok)
      throw new Error(
        `GitHub refused request (${response.status}); no merge confirmed.`,
      );
    if (response.status === 204) return null;
    try {
      return await response.json();
    } catch {
      throw new Error("GitHub returned invalid JSON; no merge confirmed.");
    }
  };
}

async function pages(request, path, key) {
  const items = [];
  for (let page = 1; page <= 100; page++) {
    const response = await request(
      `${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`,
    );
    const batch = key ? response?.[key] : response;
    assert(Array.isArray(batch));
    items.push(...batch);
    if (batch.length < 100) return items;
  }
  throw new Error("GitHub pagination limit reached; no merge confirmed.");
}

async function currentBase(request) {
  const ref = await request(`${prefix}/git/ref/heads/main`);
  assert(shaPattern.test(ref?.object?.sha));
  return ref.object.sha;
}

export async function inspectPullRequest(request, number, catalogue) {
  assert(Number.isSafeInteger(number) && number > 0);
  const pr = await request(`${prefix}/pulls/${number}`);
  assert(pr?.number === number && shaPattern.test(pr.head?.sha));
  if (pr.state !== "open" || pr.draft) return blocked("draft-or-closed");
  if (pr.base?.repo?.full_name !== repository || pr.base.ref !== "main")
    return blocked("foreign-base");
  if (pr.labels?.some((label) => label.name === "merge:hold"))
    return blocked("maintainer-hold");
  // The approved App's native review exception can leave a fully tested writer
  // PR "blocked". Our explicit review/check policy below still must all pass.
  if (
    pr.mergeable !== true ||
    !["clean", "blocked"].includes(pr.mergeable_state)
  )
    return blocked("merge-not-clean");
  try {
    validatePullRequestMetadata(
      { number, repository: { full_name: repository }, pull_request: pr },
      catalogue,
      { eventName: "pull_request", repository },
    );
  } catch {
    return blocked("labels");
  }
  const base = await currentBase(request);
  if (pr.base.sha !== base || !shaPattern.test(pr.merge_commit_sha))
    return blocked("stale-base");
  const merge = await request(`${prefix}/git/commits/${pr.merge_commit_sha}`);
  if (
    merge.sha !== pr.merge_commit_sha ||
    merge.verification?.verified !== true ||
    merge.verification?.reason !== "valid" ||
    merge.parents?.length !== 2 ||
    merge.parents[0].sha !== base ||
    merge.parents[1].sha !== pr.head.sha
  )
    return blocked("untested-merge");

  const checks = await pages(
    request,
    `${prefix}/commits/${pr.head.sha}/check-runs?filter=all`,
    "check_runs",
  );
  const checkDecision = evaluateChecks(checks, pr.head.sha);
  if (!checkDecision.eligible) return checkDecision;
  const statuses = await request(`${prefix}/commits/${pr.head.sha}/status`);
  assert(
    Number.isSafeInteger(statuses?.total_count) &&
      statuses.total_count >= 0 &&
      Array.isArray(statuses.statuses),
  );
  if (statuses.total_count > 0 && statuses.state !== "success")
    return blocked("commit-status");

  // A successful check on the same head can still belong to an old base or an
  // unrelated workflow. Bind every trusted workflow to this exact PR/base/head.
  const selectedRuns = new Map();
  for (const workflow of workflows) {
    const runs = await pages(
      request,
      `${prefix}/actions/workflows/${workflow}/runs?event=pull_request&head_sha=${pr.head.sha}`,
      "workflow_runs",
    );
    const run = runs
      .filter((item) => item.pull_requests?.some((p) => p.number === number))
      .sort((a, b) => b.id - a.id)[0];
    if (
      !run ||
      run.repository?.full_name !== repository ||
      run.path !== `.github/workflows/${workflow}` ||
      run.event !== "pull_request" ||
      run.head_sha !== pr.head.sha ||
      run.status !== "completed" ||
      run.conclusion !== "success" ||
      !run.pull_requests.some(
        (p) =>
          p.number === number &&
          p.head?.sha === pr.head.sha &&
          p.base?.sha === base &&
          p.base?.ref === "main",
      )
    )
      return blocked("workflow-provenance");
    assert(Number.isSafeInteger(run.check_suite_id));
    selectedRuns.set(workflow, run);
  }
  for (const [name, app] of requiredChecks) {
    if (app !== 15368) continue;
    const workflow =
      name === "PR metadata"
        ? "pr-metadata.yml"
        : name.startsWith("CodeQL (") || name === "Dependency review"
          ? "security.yml"
          : "ci.yml";
    const check = checks
      .filter((item) => item.name === name && item.app?.id === app)
      .sort((a, b) => b.id - a.id)[0];
    if (check.check_suite?.id !== selectedRuns.get(workflow).check_suite_id)
      return blocked("check-suite-provenance");
  }
  // Upload processing has a separate App/check. Bind actual analyses to the
  // signed merge commit as well, so an old same-head success cannot authorize it.
  const analyses = await pages(
    request,
    `${prefix}/code-scanning/analyses?ref=${encodeURIComponent(`refs/pull/${number}/merge`)}`,
  );
  for (const language of ["javascript-typescript", "python", "actions"]) {
    const analysis = analyses
      .filter(
        (item) =>
          item.category === `/language:${language}` &&
          item.analysis_key === ".github/workflows/security.yml:codeql",
      )
      .sort((a, b) => b.id - a.id)[0];
    if (
      !analysis ||
      analysis.commit_sha !== pr.merge_commit_sha ||
      analysis.error !== "" ||
      analysis.results_count !== 0
    )
      return blocked("analysis-provenance");
  }
  const findings = checks
    .filter((item) => item.name === "CodeQL" && item.app?.id === 57789)
    .sort((a, b) => b.id - a.id)[0];
  // Retrying only Dependency review changes workflow.run_started_at while
  // retaining successful CodeQL jobs. Their actual starts are authoritative.
  const codeqlStarts = ["javascript-typescript", "python", "actions"].map(
    (language) =>
      Date.parse(
        checks
          .filter(
            (item) =>
              item.name === `CodeQL (${language})` && item.app?.id === 15368,
          )
          .sort((a, b) => b.id - a.id)[0].started_at,
      ),
  );
  if (
    !Number.isFinite(Date.parse(findings.started_at)) ||
    !codeqlStarts.every(Number.isFinite) ||
    Date.parse(findings.started_at) < Math.max(...codeqlStarts)
  )
    return blocked("stale-findings");

  const reviews = await pages(request, `${prefix}/pulls/${number}/reviews`);
  const latestReviews = new Map();
  for (const review of reviews.sort((a, b) => a.id - b.id)) {
    if (["APPROVED", "CHANGES_REQUESTED", "DISMISSED"].includes(review.state))
      latestReviews.set(review.user?.login, review);
  }
  if (
    [...latestReviews.values()].some(
      (review) => review.state === "CHANGES_REQUESTED",
    )
  )
    return blocked("changes-requested");
  // Repository writers and the official Dependabot account are trusted authors.
  // Outside contributions require an actual current-head approval by a writer.
  const trusted = async (login) => {
    assert(
      typeof login === "string" && /^[a-zA-Z0-9-]+(?:\[bot\])?$/.test(login),
    );
    const permission = await request(
      `${prefix}/collaborators/${encodeURIComponent(login)}/permission`,
    );
    return ["admin", "maintain", "write"].includes(permission.permission);
  };
  const dependabot =
    pr.user?.login === "dependabot[bot]" && pr.user?.id === 49699333;
  if (!dependabot && !(await trusted(pr.user?.login))) {
    let approved = false;
    for (const review of latestReviews.values())
      if (
        review.state === "APPROVED" &&
        review.commit_id === pr.head.sha &&
        review.user?.login !== pr.user.login &&
        (await trusted(review.user?.login))
      )
        approved = true;
    if (!approved) return blocked("external-review");
  }
  return {
    eligible: true,
    number,
    head: pr.head.sha,
    base,
    merge: pr.merge_commit_sha,
  };
}

/** Promote only the exact signed, tested commit using a server fast-forward.
 * Unlike the PR merge endpoint's head-only condition, force:false rejects a
 * divergent base atomically instead of constructing an untested merge tree.
 * A successful token-driven merge does not trigger push workflows, so explicitly
 * dispatch main verification/security; no release is published by this script. */
export async function processPullRequest(
  request,
  number,
  catalogue,
  { apply = false } = {},
) {
  const decision = await inspectPullRequest(request, number, catalogue);
  if (!decision.eligible || !apply) return decision;
  const fresh = await inspectPullRequest(request, number, catalogue);
  if (!fresh.eligible) return fresh;
  if (
    fresh.head !== decision.head ||
    fresh.base !== decision.base ||
    fresh.merge !== decision.merge
  )
    return blocked("changed-during-inspection");
  // Promoting a combined branch can indirectly close other PRs, even drafts.
  // Process those independently first, rather than silently consuming them.
  const open = await pages(request, `${prefix}/pulls?state=open&base=main`);
  for (const other of open) {
    if (other.number === number) continue;
    assert(shaPattern.test(other.head?.sha));
    const comparison = await request(
      `${prefix}/compare/${other.head.sha}...${decision.merge}`,
    );
    assert(
      ["ahead", "behind", "identical", "diverged"].includes(comparison.status),
    );
    if (["ahead", "identical"].includes(comparison.status))
      return blocked("contains-open-pr");
  }
  const promoted = await request(`${prefix}/git/refs/heads/main`, {
    method: "PATCH",
    body: { sha: decision.merge, force: false },
  });
  assert(promoted?.object?.sha === decision.merge);
  await ensureMainVerification(request);
  const observed = await request(`${prefix}/pulls/${number}`);
  return {
    ...decision,
    promoted: true,
    commit: decision.merge,
    merged: observed.merged === true && observed.head?.sha === decision.head,
  };
}

/** Reconcile independently of open PRs. A lost promotion response or a failed
 * dispatch is recoverable on the next sweep without merging/publishing again. */
export async function ensureMainVerification(request) {
  const head = await currentBase(request);
  for (const workflow of ["ci.yml", "security.yml"]) {
    const runs = await pages(
      request,
      `${prefix}/actions/workflows/${workflow}/runs?branch=main&head_sha=${head}`,
      "workflow_runs",
    );
    if (
      runs.some(
        (run) =>
          run.head_sha === head &&
          run.head_branch === "main" &&
          run.repository?.full_name === repository &&
          run.path === `.github/workflows/${workflow}` &&
          ["push", "workflow_dispatch"].includes(run.event),
      )
    )
      continue;
    await request(`${prefix}/actions/workflows/${workflow}/dispatches`, {
      method: "POST",
      body: {
        ref: "main",
        ...(workflow === "ci.yml" ? { inputs: { expected_commit: head } } : {}),
      },
    });
  }
  return head;
}

/** Keep the App's branch-rule exception out of evidence reads and arbitrary API
 * mutations. The two clients never exchange credentials or response bodies. */
export function routeRequests(read, write = null) {
  return (path, options) => {
    if (!options?.method || options.method === "GET")
      return read(path, options);
    assert(
      (options.method === "PATCH" &&
        path === `${prefix}/git/refs/heads/main`) ||
        (options.method === "POST" &&
          ["ci.yml", "security.yml"].some(
            (workflow) =>
              path === `${prefix}/actions/workflows/${workflow}/dispatches`,
          )),
    );
    assert(write);
    return write(path, options);
  };
}

async function main() {
  assert(process.env.GITHUB_REPOSITORY === repository);
  const request = routeRequests(
    githubClient(process.env.GH_TOKEN),
    process.argv.includes("--apply")
      ? githubClient(process.env.PROMOTION_TOKEN)
      : null,
  );
  if (process.argv.includes("--apply")) await ensureMainVerification(request);
  const catalogue = JSON.parse(
    await readFile(new URL("../.github/labels.json", import.meta.url), "utf8"),
  );
  const pulls = await pages(
    request,
    `${prefix}/pulls?state=open&base=main&sort=created&direction=asc`,
  );
  for (const pr of pulls) {
    try {
      const result = await processPullRequest(request, pr.number, catalogue, {
        apply: process.argv.includes("--apply"),
      });
      console.log(JSON.stringify({ number: pr.number, ...result }));
      if (result.promoted) break; // Other PRs now need evidence for the new base.
    } catch (error) {
      console.error(`PR #${pr.number}: ${error.message}`);
      process.exitCode = 1;
    }
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch(() => {
    console.error(
      "Automatic merge inspection failed; inspect the trusted workflow configuration.",
    );
    process.exitCode = 1;
  });
}
