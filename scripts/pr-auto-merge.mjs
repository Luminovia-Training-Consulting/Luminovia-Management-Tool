/**
 * Trusted-main controller for ordinary, server-protected pull request merges.
 * The hosted workflow supplies a read-only GH_TOKEN for current policy, checks,
 * identities and the fixed push query. PROMOTION_TOKEN is used only with --apply
 * for native merge requests and the two explicit main verification dispatches.
 * No PR code, artifact, title, URL or script is executed. Native rules, exact-head
 * checks and independent review remain mandatory for every author and actor.
 */
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
    "PR preview package",
    "PR metadata",
    "CodeQL (javascript-typescript)",
    "CodeQL (python)",
    "CodeQL (actions)",
    "Dependency review",
  ].map((name) => [name, 15368]),
  ["CodeQL", 57789],
]);
const prefix = `/repos/${repository}`;
const acceptanceSteps = new Map([
  ["verify", new Set(["Complete isolated local verification"])],
  [
    "Actual isolated selfhost image compatibility",
    new Set([
      "Complete isolated native selfhost verification",
      'Run node deploy/hostinger/maintenance/selfhost-candidate-check.mjs --run --baseline-root "$RUNNER_TEMP/selfhost-baseline" --baseline-commit "$(git rev-parse HEAD^)" --proof-output "$RUNNER_TEMP/postgres-candidate-proof.json"',
    ]),
  ],
]);
// Sealed read-only query: changes require a new read-only token integration
// check. The opaque suite identifier is JSON data, never executable query text.
export const pushQuery =
  "query($id: ID!) { node(id: $id) { __typename ... on CheckSuite { id databaseId commit { oid repository { nameWithOwner } } push { nextSha previousSha pusher { __typename login ... on User { databaseId } ... on Bot { databaseId } } repository { nameWithOwner } } } } }";
const blocked = (reason) => ({ eligible: false, reason });
function assert(condition) {
  if (!condition) throw new Error("Invalid or incomplete GitHub response.");
}

/** REST account identity is mandatory even when no permission is being granted. */
function knownIdentity(user) {
  return (
    Number.isSafeInteger(user?.id) &&
    user.id > 0 &&
    ["User", "Bot"].includes(user.type) &&
    typeof user.login === "string" &&
    /^[a-zA-Z0-9-]+(?:\[bot\])?$/.test(user.login)
  );
}

/** Both probe and reviewer checks bind the current canonical account to its ID. */
function currentIdentityMatches(current, expected) {
  return (
    knownIdentity(current) &&
    knownIdentity(expected) &&
    current.id === expected.id &&
    current.login.toLowerCase() === expected.login.toLowerCase() &&
    current.type === expected.type
  );
}

/** Recognize only the fixed query and its one bounded opaque data variable. */
function isPushRead(path, options) {
  return (
    path === "/graphql" &&
    options?.method === "POST" &&
    options.body?.query === pushQuery &&
    Object.keys(options.body).sort().join(",") === "query,variables" &&
    options.body.variables &&
    Object.keys(options.body.variables).join(",") === "id" &&
    typeof options.body.variables.id === "string" &&
    /^[A-Za-z0-9_=-]{1,256}$/.test(options.body.variables.id)
  );
}

/** Native rules remain authoritative. Unknown or weakened mandatory policy
 * requires a reviewed controller update instead of a permissive interpretation. */
export function evaluateNativePolicy(rules) {
  if (!Array.isArray(rules)) return blocked("native-policy");
  const known = new Set([
    "deletion",
    "non_fast_forward",
    "required_signatures",
    "required_deployments",
    "code_quality",
    "pull_request",
    "required_status_checks",
  ]);
  if (
    rules.length !== known.size ||
    new Set(rules.map((rule) => rule?.type)).size !== known.size ||
    rules.some((rule) => !known.has(rule?.type))
  )
    return blocked("native-policy");
  const parameters = (type) =>
    rules.find((rule) => rule.type === type)?.parameters;
  const checks = parameters("required_status_checks");
  const contexts = checks?.required_status_checks;
  if (
    checks?.strict_required_status_checks_policy !== true ||
    checks.do_not_enforce_on_create !== false ||
    !Array.isArray(contexts) ||
    contexts.length !== requiredChecks.size ||
    new Set(contexts.map((check) => check?.context)).size !==
      requiredChecks.size ||
    contexts.some(
      (check) =>
        !requiredChecks.has(check?.context) ||
        requiredChecks.get(check.context) !== check.integration_id,
    )
  )
    return blocked("native-policy");
  const reviews = parameters("pull_request");
  if (
    reviews?.required_approving_review_count !== 1 ||
    reviews.require_last_push_approval !== true ||
    reviews.required_review_thread_resolution !== true ||
    reviews.dismiss_stale_reviews_on_push !== true ||
    !Array.isArray(reviews.allowed_merge_methods) ||
    !reviews.allowed_merge_methods.includes("merge")
  )
    return blocked("native-policy");
  const deployments = parameters(
    "required_deployments",
  )?.required_deployment_environments;
  if (
    !Array.isArray(deployments) ||
    deployments.length ||
    parameters("code_quality")?.severity !== "errors"
  )
    return blocked("native-policy");
  return { eligible: true };
}

/** Bind the actual push, when present, to the exact validated CI suite.
 * Missing push evidence never creates an exception; contradictory evidence fails.
 * Workflow actors and retry initiators cannot substitute for the pusher. */
export async function readSourcePusher(request, run, head) {
  assert(
    shaPattern.test(head) &&
      run?.head_sha === head &&
      run.repository?.full_name === repository &&
      run.path === ".github/workflows/ci.yml" &&
      ["pull_request", "push", "workflow_dispatch"].includes(run.event) &&
      Number.isSafeInteger(run.check_suite_id) &&
      run.check_suite_id > 0 &&
      typeof run.check_suite_node_id === "string" &&
      /^[A-Za-z0-9_=-]{1,256}$/.test(run.check_suite_node_id),
  );
  const response = await request("/graphql", {
    method: "POST",
    body: { query: pushQuery, variables: { id: run.check_suite_node_id } },
  });
  assert(
    response &&
      (response.errors === undefined ||
        (Array.isArray(response.errors) && response.errors.length === 0)),
  );
  const suite = response.data?.node;
  assert(
    suite?.__typename === "CheckSuite" &&
      suite.id === run.check_suite_node_id &&
      suite.databaseId === run.check_suite_id &&
      suite.commit?.oid === head &&
      suite.commit.repository?.nameWithOwner === repository,
  );
  if (suite.push === null) return null;
  const push = suite.push;
  assert(
    push?.nextSha === head &&
      push.repository?.nameWithOwner === repository &&
      (push.previousSha === null || shaPattern.test(push.previousSha)),
  );
  const actor = push.pusher;
  assert(
    actor &&
      typeof actor.__typename === "string" &&
      typeof actor.login === "string" &&
      /^[a-zA-Z0-9-]+(?:\[bot\])?$/i.test(actor.login) &&
      ["User", "Bot"].includes(actor.__typename) &&
      Number.isSafeInteger(actor.databaseId) &&
      actor.databaseId > 0,
  );
  if (actor.__typename === "User") {
    assert(!/\[bot\]$/i.test(actor.login));
    return { id: actor.databaseId, login: actor.login, type: "User" };
  }
  // GraphQL returns a bare Bot login while REST appends [bot]. Bind the real
  // immutable Bot ID too; normalize only this API naming difference.
  return {
    id: actor.databaseId,
    login: actor.login.replace(/\[bot\]$/i, "") + "[bot]",
    type: "Bot",
  };
}

/** CI metadata-access probe only: fetch one canonical ci.yml run, reuse the
 * identical sealed suite/push query and validate its current REST identity.
 * In-progress runs and null pushes are legitimate; neither confers authority.
 * The caller supplies only a reader, so this path cannot merge or dispatch. */
export async function probeSource(request, runID) {
  assert(
    typeof runID === "string" &&
      /^[1-9][0-9]{0,15}$/.test(runID) &&
      Number.isSafeInteger(Number(runID)),
  );
  const run = await request(`${prefix}/actions/runs/${runID}`);
  assert(run?.id === Number(runID) && shaPattern.test(run.head_sha));
  const pusher = await readSourcePusher(request, run, run.head_sha);
  if (pusher) {
    const current = await request(
      `${prefix}/collaborators/${encodeURIComponent(pusher.login)}/permission`,
    );
    assert(currentIdentityMatches(current?.user, pusher));
  }
  return {
    sourceProof: true,
    runId: run.id,
    suiteId: run.check_suite_id,
    head: run.head_sha,
    pusherKnown: pusher !== null,
    ...(pusher ? { pusherId: pusher.id } : {}),
  };
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
    const pushRead = isPushRead(path, { method, body });
    assert(
      pushRead || (typeof path === "string" && path.startsWith(`${prefix}/`)),
    );
    const url = new URL(path, "https://api.github.com");
    // Git compare uses a literal three-dot delimiter. Reject actual repository
    // traversal after URL normalization rather than rejecting that delimiter.
    assert(
      url.origin === "https://api.github.com" &&
        (pushRead || url.pathname.startsWith(`${prefix}/`)),
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

/** Collect bounded API pages before making a decision; incomplete pagination
 * fails instead of allowing an early green page to hide later evidence. */
async function pages(request, path, key) {
  const items = [];
  let jobCount;
  for (let page = 1; page <= 100; page++) {
    const response = await request(
      `${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`,
    );
    const batch = key ? response?.[key] : response;
    assert(Array.isArray(batch));
    // The Actions jobs contract supplies the complete filtered cardinality.
    // A short or changing response cannot hide another matching check URL.
    if (key === "jobs") {
      assert(
        Number.isSafeInteger(response.total_count) && response.total_count >= 0,
      );
      jobCount ??= response.total_count;
      assert(response.total_count === jobCount);
    }
    items.push(...batch);
    if (jobCount !== undefined) assert(items.length <= jobCount);
    if (batch.length < 100) {
      if (jobCount !== undefined) assert(items.length === jobCount);
      return items;
    }
  }
  throw new Error("GitHub pagination limit reached; no merge confirmed.");
}

async function currentBase(request) {
  const ref = await request(`${prefix}/git/ref/heads/main`);
  assert(shaPattern.test(ref?.object?.sha));
  return ref.object.sha;
}

/** A green job context can hide a skipped acceptance step. Bind its actual
 * successful step to the current check URL, canonical CI run and source head.
 * filter=all callers retain legitimate green jobs from an earlier run attempt;
 * a job ID is not a check-run ID. This is execution evidence, not command-body
 * attestation: ordinary source review and native protection still apply. */
function evaluateAcceptanceJobs(jobs, run, head, checks) {
  if (
    !Number.isSafeInteger(run.run_attempt) ||
    run.run_attempt <= 0 ||
    new Set(jobs.map((job) => job?.id)).size !== jobs.length
  )
    return blocked("acceptance-job-provenance");
  for (const [name, names] of acceptanceSteps) {
    const check = checks
      .filter((item) => item.name === name && item.app?.id === 15368)
      .sort((a, b) => b.id - a.id)[0];
    if (!Number.isSafeInteger(check?.id) || check.id <= 0)
      return blocked("acceptance-job-provenance");
    const expectedCheck = `https://api.github.com${prefix}/check-runs/${check.id}`;
    const matches = jobs.filter((job) => job?.check_run_url === expectedCheck);
    if (matches.length !== 1) return blocked("acceptance-job-provenance");
    const job = matches[0];
    if (
      !Number.isSafeInteger(job.id) ||
      job.id <= 0 ||
      job.run_id !== run.id ||
      !Number.isSafeInteger(job.run_attempt) ||
      job.run_attempt <= 0 ||
      job.run_attempt > run.run_attempt ||
      job.run_url !==
        `https://api.github.com${prefix}/actions/runs/${run.id}` ||
      job.head_sha !== head ||
      job.name !== name ||
      job.status !== "completed" ||
      job.conclusion !== "success"
    )
      return blocked("acceptance-job-provenance");
    if (
      !Array.isArray(job.steps) ||
      job.steps.some(
        (step) =>
          typeof step?.name !== "string" ||
          !Number.isSafeInteger(step.number) ||
          step.number <= 0,
      ) ||
      new Set(job.steps.map((step) => step.number)).size !== job.steps.length
    )
      return blocked("acceptance-steps");
    const steps = job.steps.filter((step) => names.has(step.name));
    if (
      steps.length !== 1 ||
      steps[0].status !== "completed" ||
      steps[0].conclusion !== "success"
    )
      return blocked("acceptance-steps");
  }
  return { eligible: true };
}

/** Read-only candidate inspection. The apply path repeats it with fresh policy,
 * source, push, permissions and review evidence immediately before merging. */
export async function inspectPullRequest(request, number, catalogue) {
  assert(Number.isSafeInteger(number) && number > 0);
  const pr = await request(`${prefix}/pulls/${number}`);
  assert(pr?.number === number && shaPattern.test(pr.head?.sha));
  if (pr.state !== "open" || pr.draft) return blocked("draft-or-closed");
  if (pr.base?.repo?.full_name !== repository || pr.base.ref !== "main")
    return blocked("foreign-base");
  if (pr.labels?.some((label) => label.name === "merge:hold"))
    return blocked("maintainer-hold");
  // No App or author-role exception is inferred here. Native review and check
  // rules remain compulsory; every candidate reaches the clean-state gate.
  if (
    pr.mergeable !== true ||
    !["clean", "blocked"].includes(pr.mergeable_state)
  )
    return blocked("merge-not-clean");
  const native = evaluateNativePolicy(
    await request(`${prefix}/rules/branches/main`),
  );
  if (!native.eligible) return native;
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
    !shaPattern.test(merge.tree?.sha) ||
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
      !Number.isSafeInteger(run.id) ||
      run.id <= 0 ||
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
  const ciRun = selectedRuns.get("ci.yml");
  const jobs = await pages(
    request,
    `${prefix}/actions/runs/${ciRun.id}/jobs?filter=all`,
    "jobs",
  );
  const acceptance = evaluateAcceptanceJobs(jobs, ciRun, pr.head.sha, checks);
  if (!acceptance.eligible) return acceptance;
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

  const pusher = await readSourcePusher(
    request,
    selectedRuns.get("ci.yml"),
    pr.head.sha,
  );

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
  // Reuse only the same immutable identity within this inspection. The final
  // inspection creates a fresh map and must observe current roles again.
  const permissions = new Map();
  const permissionFor = async (user) => {
    if (!knownIdentity(user)) return null;
    if (!permissions.has(user.id))
      permissions.set(
        user.id,
        await request(
          `${prefix}/collaborators/${encodeURIComponent(user.login)}/permission`,
        ),
      );
    const permission = permissions.get(user.id);
    const current = permission?.user;
    // A retained login must not transfer an old actor/reviewer's authority to
    // another account. Require the current canonical ID, login and account type.
    if (!currentIdentityMatches(current, user)) return null;
    return permission;
  };
  assert(knownIdentity(pr.user));
  // Every human/Bot pusher must still resolve to that immutable REST identity.
  // Current permissions confer reviewer authority only, never an author bypass.
  if (pusher) assert(await permissionFor(pusher));
  const sameIdentity = (a, b) =>
    b &&
    (a?.id === b.id ||
      (typeof a?.login === "string" &&
        a.login.toLowerCase() === b.login.toLowerCase()));
  let approved = false;
  for (const review of latestReviews.values())
    if (
      review.state === "APPROVED" &&
      review.commit_id === pr.head.sha &&
      !sameIdentity(review.user, pr.user) &&
      !sameIdentity(review.user, pusher) &&
      ["admin", "write"].includes(
        (await permissionFor(review.user))?.permission,
      )
    )
      approved = true;
  if (!approved) return blocked("external-review");
  if (pr.mergeable_state !== "clean") return blocked("native-review-blocked");
  return {
    eligible: true,
    number,
    head: pr.head.sha,
    base,
    merge: pr.merge_commit_sha,
    tree: merge.tree.sha,
  };
}

/** Request an ordinary native merge with a head condition and no rule bypass.
 * Strict server checks/review/signature policy controls the final operation.
 * GitHub can generate a different commit SHA; inspect its actual parents/tree
 * instead of describing it as promotion of the synthetic test-merge commit. */
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
    fresh.merge !== decision.merge ||
    fresh.tree !== decision.tree
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
  const result = await request(`${prefix}/pulls/${number}/merge`, {
    method: "PUT",
    body: { sha: decision.head, merge_method: "merge" },
  });
  assert(result?.merged === true && shaPattern.test(result.sha));
  let verification;
  let pending;
  try {
    const actual = await request(`${prefix}/git/commits/${result.sha}`);
    assert(
      actual?.sha === result.sha &&
        actual.parents?.length === 2 &&
        actual.parents[0].sha === decision.base &&
        actual.parents[1].sha === decision.head &&
        actual.tree?.sha === decision.tree,
    );
    assert(
      actual.verification?.verified === true &&
        actual.verification.reason === "valid",
    );
    verification = true;
  } catch {
    pending = "commit provenance could not be confirmed";
  }
  // A lost post-merge read or dispatch cannot be recovered by enumerating only
  // open PRs. Reconcile main even when this observation fails, and on each sweep.
  try {
    await ensureMainVerification(request);
  } catch {
    pending ??= "main verification dispatch is pending";
  }
  if (pending) throw new Error(`Native merge confirmed; ${pending}.`);
  let observed;
  try {
    observed = await request(`${prefix}/pulls/${number}`);
  } catch {
    throw new Error(
      "Native merge confirmed; pull request readback is pending.",
    );
  }
  const { merge: testedMerge, ...evidence } = decision;
  return {
    ...evidence,
    testedMerge,
    nativeMerged: true,
    commit: result.sha,
    signatureVerified: verification,
    merged:
      observed.merged === true &&
      observed.head?.sha === decision.head &&
      observed.merge_commit_sha === result.sha,
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

/** Evidence uses only the read token, including the one fixed GraphQL query.
 * The separate writer can request native merges and two exact workflow dispatches
 * only. No direct main-ref update, GraphQL mutation or rule bypass is available. */
export function routeRequests(read, write = null) {
  return (path, options) => {
    if (path === "/graphql") {
      assert(isPushRead(path, options));
      return read(path, options);
    }
    if (!options?.method || options.method === "GET")
      return read(path, options);
    assert(
      (options.method === "PUT" &&
        new RegExp(`^${prefix}/pulls/[1-9][0-9]*/merge$`).test(path) &&
        shaPattern.test(options.body?.sha) &&
        options.body.merge_method === "merge" &&
        Object.keys(options.body).sort().join(",") === "merge_method,sha") ||
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

/** CLI/workflow entry point: dry-run by default; print bounded decision fields
 * only. Independent main reconciliation recovers lost post-merge responses. */
async function main() {
  assert(process.env.GITHUB_REPOSITORY === repository);
  const args = process.argv.slice(2);
  // Resolve the isolated mode before constructing or reading any writer token.
  // Unknown or mixed arguments fail before even the first metadata request.
  if (args.includes("--probe-source")) {
    assert(args.length === 2 && args[0] === "--probe-source");
    const reader = routeRequests(githubClient(process.env.GH_TOKEN));
    console.log(JSON.stringify(await probeSource(reader, args[1])));
    return;
  }
  assert(args.length === 0 || (args.length === 1 && args[0] === "--apply"));
  const apply = args[0] === "--apply";
  const request = routeRequests(
    githubClient(process.env.GH_TOKEN),
    apply ? githubClient(process.env.PROMOTION_TOKEN) : null,
  );
  if (apply) await ensureMainVerification(request);
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
        apply,
      });
      console.log(JSON.stringify({ number: pr.number, ...result }));
      if (result.nativeMerged) break; // Other PRs now need evidence for the new base.
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
