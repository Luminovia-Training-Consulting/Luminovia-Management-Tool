import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  evaluateChecks,
  ensureMainVerification,
  githubClient,
  inspectPullRequest,
  processPullRequest,
  repository,
  routeRequests,
} from "./pr-auto-merge.mjs";

const catalogue = JSON.parse(
  await readFile(new URL("../.github/labels.json", import.meta.url), "utf8"),
);
const prefix = `/repos/${repository}`;
const head = "a".repeat(40);
const base = "b".repeat(40);
const merge = "c".repeat(40);
const merged = "d".repeat(40);
const checkNames = [
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
  "CodeQL",
];
const started = "2026-11-16T04:00:00Z";
const suiteIds = {
  "ci.yml": 1000,
  "security.yml": 1001,
  "pr-metadata.yml": 1002,
};
function suiteFor(name) {
  return name === "PR metadata"
    ? suiteIds["pr-metadata.yml"]
    : name.startsWith("CodeQL (") || name === "Dependency review"
      ? suiteIds["security.yml"]
      : suiteIds["ci.yml"];
}
function checksFor(sha = head) {
  return checkNames.map((name, index) => ({
    id: index + 1,
    name,
    head_sha: sha,
    app: { id: name === "CodeQL" ? 57789 : 15368 },
    status: "completed",
    conclusion: "success",
    started_at: started,
    check_suite: { id: suiteFor(name) },
  }));
}
function pullRequest(overrides = {}) {
  return {
    number: 31,
    state: "open",
    draft: false,
    base: { sha: base, ref: "main", repo: { full_name: repository } },
    head: { sha: head },
    merge_commit_sha: merge,
    mergeable: true,
    mergeable_state: "clean",
    labels: ["type:tests", "area:github", "risk:high"].map((name) => ({
      name,
    })),
    user: { login: "maintainer", id: 1 },
    ...overrides,
  };
}
function workflowRun(workflow, pr, overrides = {}) {
  return {
    id: 100,
    check_suite_id: suiteIds[workflow],
    run_started_at: started,
    repository: { full_name: repository },
    path: `.github/workflows/${workflow}`,
    event: "pull_request",
    head_sha: pr.head.sha,
    status: "completed",
    conclusion: "success",
    pull_requests: [
      {
        number: pr.number,
        head: { sha: pr.head.sha },
        base: { sha: pr.base.sha, ref: "main" },
      },
    ],
    ...overrides,
  };
}

/** Model actual REST boundaries; every unrecognised path fails rather than
 * returning a permissive generic object that could conceal missing calls. */
function analysesFor(sha = merge) {
  return ["javascript-typescript", "python", "actions"].map(
    (language, index) => ({
      id: 300 + index,
      category: `/language:${language}`,
      analysis_key: ".github/workflows/security.yml:codeql",
      commit_sha: sha,
      error: "",
    }),
  );
}
function mainRun(workflow, sha, overrides = {}) {
  return {
    id: 500,
    head_sha: sha,
    head_branch: "main",
    repository: { full_name: repository },
    path: `.github/workflows/${workflow}`,
    event: "workflow_dispatch",
    status: "queued",
    ...overrides,
  };
}
function fixture(options = {}) {
  const calls = [];
  let inspection = -1;
  let active = pullRequest(options.pr);
  let didPromote = false;
  const mainRuns = structuredClone(options.mainRuns ?? {});
  const remainingDispatchFailures = { ...options.dispatchFailures };
  const currentMain = () =>
    didPromote ? (options.finalMain ?? merge) : (options.initialMain ?? base);
  const request = async (path, config = {}) => {
    const method = config.method ?? "GET";
    calls.push({ path, method, ...(config.body ? { body: config.body } : {}) });
    const url = new URL(`https://api.github.com${path}`);
    const route = url.pathname.slice(prefix.length);
    if (route === "/pulls/31" && method === "GET") {
      if (didPromote)
        return structuredClone(options.observed ?? { ...active, merged: true });
      inspection++;
      active = pullRequest(options.inspections?.[inspection] ?? options.pr);
      return structuredClone(active);
    }
    if (route === "/git/ref/heads/main")
      return { object: { sha: currentMain() } };
    if (route === `/git/commits/${active.merge_commit_sha}`)
      return structuredClone(
        options.mergeCommit ?? {
          sha: active.merge_commit_sha,
          verification: { verified: true, reason: "valid" },
          parents: [{ sha: base }, { sha: active.head.sha }],
        },
      );
    if (route === `/commits/${active.head.sha}/check-runs`) {
      assert.equal(url.searchParams.get("filter"), "all");
      const page = Number(url.searchParams.get("page"));
      const checks = options.checks ?? checksFor(active.head.sha);
      return {
        check_runs: options.checkPages
          ? options.checkPages(page, checks)
          : checks.slice((page - 1) * 100, page * 100),
      };
    }
    if (route === `/commits/${active.head.sha}/status`)
      return structuredClone(
        Object.hasOwn(options, "statuses")
          ? options.statuses
          : { total_count: 0, state: "pending", statuses: [] },
      );
    const workflow = route.match(/^\/actions\/workflows\/([^/]+)\/runs$/)?.[1];
    if (workflow) {
      assert.equal(url.searchParams.get("per_page"), "100");
      if (url.searchParams.get("branch") === "main") {
        assert.equal(url.searchParams.get("head_sha"), currentMain());
        return { workflow_runs: structuredClone(mainRuns[workflow] ?? []) };
      }
      assert.equal(url.searchParams.get("event"), "pull_request");
      assert.equal(url.searchParams.get("head_sha"), active.head.sha);
      return {
        workflow_runs: structuredClone(
          options.runs?.[workflow] ?? [workflowRun(workflow, active)],
        ),
      };
    }
    if (route === "/code-scanning/analyses") {
      assert.equal(url.searchParams.get("ref"), "refs/pull/31/merge");
      return structuredClone(
        options.analyses ?? analysesFor(active.merge_commit_sha),
      );
    }
    if (route === "/pulls/31/reviews")
      return structuredClone(options.reviews ?? []);
    const login = route.match(/^\/collaborators\/([^/]+)\/permission$/)?.[1];
    if (login)
      return {
        permission:
          options.permissions?.[decodeURIComponent(login)] ?? "maintain",
      };
    if (route === "/pulls") return structuredClone(options.open ?? [active]);
    if (route.startsWith("/compare/"))
      return { status: options.compareStatus ?? "diverged" };
    if (route === "/git/refs/heads/main" && method === "PATCH") {
      if (options.promotionError) throw options.promotionError;
      didPromote = true;
      if (options.lostPromotionResponse)
        throw new Error("Lost response after promotion");
      return (
        options.promotionResult ?? { object: { sha: active.merge_commit_sha } }
      );
    }
    const dispatchWorkflow = route.match(
      /^\/actions\/workflows\/(ci\.yml|security\.yml)\/dispatches$/,
    )?.[1];
    if (dispatchWorkflow) {
      assert.equal(method, "POST");
      if (remainingDispatchFailures[dispatchWorkflow] > 0) {
        remainingDispatchFailures[dispatchWorkflow]--;
        throw new Error("Temporary dispatch failure");
      }
      (mainRuns[dispatchWorkflow] ??= []).push(
        mainRun(dispatchWorkflow, currentMain()),
      );
      return null;
    }
    assert.fail(`Unexpected API request: ${method} ${route}`);
  };
  return {
    request,
    calls,
    writes: () => calls.filter((c) => c.method !== "GET"),
  };
}

async function expectBlocked(options, reason) {
  const source = fixture(options);
  assert.deepEqual(
    await processPullRequest(source.request, 31, catalogue, { apply: true }),
    { eligible: false, reason },
  );
  assert.deepEqual(source.writes(), []);
  return source;
}

test("complete required checks accept only current-head successful trusted Apps", () => {
  assert.deepEqual(evaluateChecks(checksFor(), head), { eligible: true });
  for (const change of [
    (checks) => checks.pop(),
    (checks) => {
      checks[0].head_sha = base;
    },
    (checks) => {
      checks[0].app.id = 999;
    },
    (checks) => {
      checks[0].status = "in_progress";
    },
    (checks) => {
      checks[0].conclusion = "neutral";
    },
    (checks) => {
      checks[0].conclusion = "skipped";
    },
    (checks) => {
      checks[0].conclusion = "failure";
    },
  ]) {
    const checks = checksFor();
    change(checks);
    assert.deepEqual(evaluateChecks(checks, head), {
      eligible: false,
      reason: "required-checks",
    });
  }
});

test("newest check attempt wins; a new failure supersedes success in any list order", () => {
  const checks = checksFor();
  const retry = { ...checks[0], id: 200 };
  checks[0].conclusion = "failure";
  assert.equal(evaluateChecks([retry, ...checks], head).eligible, true);
  retry.conclusion = "failure";
  checks[0].conclusion = "success";
  assert.equal(evaluateChecks([...checks, retry], head).eligible, false);
  assert.equal(evaluateChecks([retry, ...checks], head).eligible, false);
});

test("additional failures/pending/foreign-head checks block, including spoofed check names", () => {
  for (const extra of [
    { name: "Additional scan", conclusion: "failure" },
    { name: "Additional scan", status: "queued", conclusion: null },
    { name: "Additional scan", head_sha: base },
    { name: "Build", app: { id: 999 }, conclusion: "failure" },
    {
      name: "Publish tested CMS update",
      app: { id: 999 },
      conclusion: "skipped",
    },
  ])
    assert.deepEqual(
      evaluateChecks(
        [{ ...checksFor()[0], id: 200, ...extra }, ...checksFor()],
        head,
      ),
      { eligible: false, reason: "additional-checks" },
    );
  assert.equal(
    evaluateChecks(
      [
        ...checksFor(),
        {
          ...checksFor()[0],
          id: 200,
          name: "Publish tested CMS update",
          conclusion: "skipped",
        },
      ],
      head,
    ).eligible,
    true,
  );
});

test("malformed check input throws before making an eligibility claim", () => {
  for (const checks of [
    null,
    [{ name: "Build" }],
    [{ id: 1.2, name: "Build" }],
  ])
    assert.throws(() => evaluateChecks(checks, head));
  assert.throws(() => evaluateChecks(checksFor(), "invalid"));
});

test("inspection validates all three current workflow provenances without writes", async () => {
  const source = fixture();
  assert.deepEqual(await inspectPullRequest(source.request, 31, catalogue), {
    eligible: true,
    number: 31,
    head,
    base,
    merge,
  });
  assert.deepEqual(source.writes(), []);
  for (const workflow of ["ci.yml", "security.yml", "pr-metadata.yml"])
    assert.ok(
      source.calls.some((call) =>
        call.path.includes(`/workflows/${workflow}/runs?`),
      ),
    );
});

test("draft/closed, wrong target, hold, conflicts and missing metadata never write", async () => {
  for (const [pr, reason] of [
    [{ draft: true }, "draft-or-closed"],
    [{ state: "closed" }, "draft-or-closed"],
    [
      { base: { ref: "develop", repo: { full_name: repository } } },
      "foreign-base",
    ],
    [
      { base: { ref: "main", repo: { full_name: "other/project" } } },
      "foreign-base",
    ],
    [
      { labels: [...pullRequest().labels, { name: "merge:hold" }] },
      "maintainer-hold",
    ],
    [{ mergeable: null }, "merge-not-clean"],
    [{ mergeable_state: "dirty" }, "merge-not-clean"],
    [{ labels: [{ name: "type:tests" }] }, "labels"],
    [{ labels: [...pullRequest().labels, { name: "risk:low" }] }, "labels"],
  ])
    await expectBlocked({ pr }, reason);
});

test("stale base and synthetic merge with wrong parents are rejected", async () => {
  await expectBlocked(
    { pr: { base: { ...pullRequest().base, sha: merged } } },
    "stale-base",
  );
  await expectBlocked({ pr: { merge_commit_sha: null } }, "stale-base");
  for (const mergeCommit of [
    { sha: merged, parents: [{ sha: base }, { sha: head }] },
    { sha: merge, parents: [{ sha: head }, { sha: base }] },
    { sha: merge, parents: [{ sha: merged }, { sha: head }] },
    { sha: merge, parents: [{ sha: base }] },
  ])
    await expectBlocked(
      {
        mergeCommit: {
          verification: { verified: true, reason: "valid" },
          ...mergeCommit,
        },
      },
      "untested-merge",
    );
});

test("missing/failed/stale/unrelated workflow results cannot reuse green checks", async () => {
  const pr = pullRequest();
  for (const workflow of ["ci.yml", "security.yml", "pr-metadata.yml"]) {
    for (const overrides of [
      { conclusion: "failure" },
      { status: "in_progress" },
      { head_sha: base },
      { event: "workflow_dispatch" },
      { path: ".github/workflows/other.yml" },
      { repository: { full_name: "other/project" } },
      {
        pull_requests: [
          { number: 32, head: { sha: head }, base: { sha: base, ref: "main" } },
        ],
      },
      {
        pull_requests: [
          {
            number: 31,
            head: { sha: head },
            base: { sha: merged, ref: "main" },
          },
        ],
      },
      {
        pull_requests: [
          {
            number: 31,
            head: { sha: merged },
            base: { sha: base, ref: "main" },
          },
        ],
      },
    ])
      await expectBlocked(
        { runs: { [workflow]: [workflowRun(workflow, pr, overrides)] } },
        "workflow-provenance",
      );
    await expectBlocked({ runs: { [workflow]: [] } }, "workflow-provenance");
    await expectBlocked(
      {
        runs: {
          [workflow]: [
            workflowRun(workflow, pr),
            workflowRun(workflow, pr, { id: 101, conclusion: "failure" }),
          ],
        },
      },
      "workflow-provenance",
    );
  }
});

test("actual legacy commit-status failures are an independent merge gate", async () => {
  await expectBlocked(
    {
      statuses: {
        total_count: 1,
        state: "failure",
        statuses: [{ state: "failure" }],
      },
    },
    "commit-status",
  );
  await expectBlocked(
    {
      statuses: {
        total_count: 1,
        state: "pending",
        statuses: [{ state: "pending" }],
      },
    },
    "commit-status",
  );
  const source = fixture({
    statuses: {
      total_count: 1,
      state: "success",
      statuses: [{ state: "success" }],
    },
  });
  assert.equal(
    (await inspectPullRequest(source.request, 31, catalogue)).eligible,
    true,
  );
});

test("latest changes request blocks trusted authors; dismissal/approval supersede it", async () => {
  const changes = {
    id: 5,
    user: { login: "reviewer" },
    state: "CHANGES_REQUESTED",
    commit_id: head,
  };
  await expectBlocked({ reviews: [changes] }, "changes-requested");
  for (const state of ["DISMISSED", "APPROVED"]) {
    const source = fixture({
      reviews: [{ ...changes, id: 6, state }, changes],
    });
    assert.equal(
      (await inspectPullRequest(source.request, 31, catalogue)).eligible,
      true,
    );
  }
});

test("external authors need an independent writer approval of the exact head", async () => {
  const external = { user: { login: "external", id: 2 } };
  const approval = {
    id: 3,
    user: { login: "reviewer" },
    state: "APPROVED",
    commit_id: head,
  };
  await expectBlocked(
    { pr: external, permissions: { external: "read" } },
    "external-review",
  );
  for (const review of [
    { ...approval, commit_id: base },
    { ...approval, user: { login: "external" } },
    { ...approval, state: "COMMENTED" },
  ])
    await expectBlocked(
      { pr: external, permissions: { external: "read" }, reviews: [review] },
      "external-review",
    );
  await expectBlocked(
    {
      pr: external,
      permissions: { external: "read", reviewer: "read" },
      reviews: [approval],
    },
    "external-review",
  );
  const source = fixture({
    pr: external,
    permissions: { external: "read", reviewer: "write" },
    reviews: [approval],
  });
  assert.equal(
    (await inspectPullRequest(source.request, 31, catalogue)).eligible,
    true,
  );
});

test("Dependabot trust requires its exact account identity", async () => {
  const source = fixture({
    pr: { user: { login: "dependabot[bot]", id: 49699333 } },
  });
  assert.equal(
    (await inspectPullRequest(source.request, 31, catalogue)).eligible,
    true,
  );
  assert.equal(
    source.calls.some((call) => call.path.includes("/collaborators/")),
    false,
  );
  await expectBlocked(
    {
      pr: { user: { login: "dependabot[bot]", id: 2 } },
      permissions: { "dependabot[bot]": "read" },
    },
    "external-review",
  );
});

test("check pagination reads failures beyond the first hundred items", async () => {
  const checks = [
    ...checksFor(),
    ...Array.from({ length: 87 }, (_, index) => ({
      ...checksFor()[0],
      id: 200 + index,
      name: `Additional ${index}`,
    })),
  ];
  checks[100].conclusion = "failure";
  const source = await expectBlocked({ checks }, "additional-checks");
  assert.ok(source.calls.some((call) => call.path.endsWith("page=2")));
});

test("pagination limit refuses an incomplete check inventory without any writes", async () => {
  const source = fixture({
    checkPages: () =>
      Array.from({ length: 100 }, (_, index) => ({
        ...checksFor()[0],
        id: 1000 + index,
        name: `Unending ${index}`,
      })),
  });
  await assert.rejects(
    processPullRequest(source.request, 31, catalogue, { apply: true }),
    /pagination limit/,
  );
  assert.equal(
    source.calls.filter((call) => call.path.includes("/check-runs?")).length,
    100,
  );
  assert.deepEqual(source.writes(), []);
});

test("dry inspection cannot merge or dispatch even when every gate succeeds", async () => {
  const source = fixture();
  assert.equal(
    (await processPullRequest(source.request, 31, catalogue)).eligible,
    true,
  );
  assert.deepEqual(source.writes(), []);
});

test("a changed head/base or a new hold during the final inspection prevents writes", async () => {
  await expectBlocked(
    {
      inspections: [
        {},
        { labels: [...pullRequest().labels, { name: "merge:hold" }] },
      ],
    },
    "maintainer-hold",
  );
  await expectBlocked(
    {
      inspections: [
        {},
        { head: { sha: merged }, merge_commit_sha: "e".repeat(40) },
      ],
    },
    "changed-during-inspection",
  );
  await expectBlocked(
    { inspections: [{}, { base: { ...pullRequest().base, sha: merged } }] },
    "stale-base",
  );
});

test("apply promotes the exact signed tested merge with force:false, then dispatches both main workflows", async () => {
  const source = fixture();
  const result = await processPullRequest(source.request, 31, catalogue, {
    apply: true,
  });
  assert.equal(result.promoted, true);
  assert.equal(result.merged, true);
  assert.equal(result.commit, merge);
  assert.equal(
    source.calls.filter((call) => call.path === `${prefix}/pulls/31`).length,
    3,
  );
  assert.deepEqual(source.writes(), [
    {
      path: `${prefix}/git/refs/heads/main`,
      method: "PATCH",
      body: { sha: merge, force: false },
    },
    {
      path: `${prefix}/actions/workflows/ci.yml/dispatches`,
      method: "POST",
      body: { ref: "main", inputs: { expected_commit: merge } },
    },
    {
      path: `${prefix}/actions/workflows/security.yml/dispatches`,
      method: "POST",
      body: { ref: "main" },
    },
  ]);
});

test("post-promotion main advancement dispatches the current source and its exact commit gate", async () => {
  const next = "e".repeat(40);
  const source = fixture({ finalMain: next });
  await processPullRequest(source.request, 31, catalogue, { apply: true });
  assert.equal(source.writes()[1].body.inputs.expected_commit, next);
});

test("divergent base rejection and malformed promotion response cannot dispatch", async () => {
  for (const options of [
    {
      promotionError: new Error("GitHub refused non-fast-forward update (422)"),
    },
    { promotionResult: { object: { sha: head } } },
    { promotionResult: { object: {} } },
  ]) {
    const source = fixture(options);
    await assert.rejects(
      processPullRequest(source.request, 31, catalogue, { apply: true }),
    );
    assert.equal(source.writes().length, 1);
    assert.equal(source.writes()[0].method, "PATCH");
  }
});

test("promotion reports the tested source without claiming an asynchronously unobserved or different-head PR merge", async () => {
  for (const observed of [
    { merged: false, head: { sha: head } },
    { merged: true, head: { sha: merged } },
    { merged: true },
  ]) {
    const source = fixture({ observed });
    const result = await processPullRequest(source.request, 31, catalogue, {
      apply: true,
    });
    assert.equal(result.promoted, true);
    assert.equal(result.commit, merge);
    assert.equal(result.merged, false);
  }
});

test("an unsigned or unverified synthetic merge is never promoted", async () => {
  for (const verification of [
    undefined,
    { verified: false, reason: "valid" },
    { verified: true, reason: "unsigned" },
  ])
    await expectBlocked(
      {
        mergeCommit: {
          sha: merge,
          parents: [{ sha: base }, { sha: head }],
          verification,
        },
      },
      "untested-merge",
    );
});

test("malformed combined status responses fail closed instead of treating missing counts as zero", async () => {
  for (const statuses of [
    null,
    {},
    { total_count: -1, statuses: [] },
    { total_count: 0.5, statuses: [] },
    { total_count: "0", statuses: [] },
    { total_count: 0 },
    { total_count: 0, statuses: {} },
  ]) {
    const source = fixture({ statuses });
    await assert.rejects(
      processPullRequest(source.request, 31, catalogue, { apply: true }),
      /Invalid or incomplete GitHub response/,
    );
    assert.deepEqual(source.writes(), []);
  }
});

test("green check names from a different workflow suite cannot satisfy any required workflow", async () => {
  for (const name of [
    "Build",
    "PR metadata",
    "CodeQL (python)",
    "Dependency review",
  ]) {
    const checks = checksFor();
    checks.find((check) => check.name === name).check_suite.id = 9999;
    await expectBlocked({ checks }, "check-suite-provenance");
  }
  const source = fixture({
    runs: {
      "ci.yml": [
        workflowRun("ci.yml", pullRequest(), { check_suite_id: undefined }),
      ],
    },
  });
  await assert.rejects(
    processPullRequest(source.request, 31, catalogue, { apply: true }),
    /Invalid or incomplete GitHub response/,
  );
  assert.deepEqual(source.writes(), []);
});

test("each CodeQL analysis must match its category, owning workflow and the exact tested merge", async () => {
  for (let language = 0; language < 3; language++) {
    for (const change of [
      (analyses) => analyses.splice(language, 1),
      (analyses) => {
        analyses[language].commit_sha = head;
      },
      (analyses) => {
        analyses[language].analysis_key = ".github/workflows/other.yml:codeql";
      },
      (analyses) => {
        analyses[language].category = "/language:unknown";
      },
      (analyses) => {
        analyses[language].error = "analysis incomplete";
      },
    ]) {
      const analyses = analysesFor();
      change(analyses);
      await expectBlocked({ analyses }, "analysis-provenance");
    }
    const analyses = analysesFor();
    analyses.push({ ...analyses[language], id: 900, commit_sha: base });
    await expectBlocked({ analyses }, "analysis-provenance");
  }
});

test("a successful findings check from before the security run cannot approve a newer analysis", async () => {
  for (const started_at of [undefined, "invalid", "2026-11-16T03:59:59Z"]) {
    const checks = checksFor();
    checks.find((check) => check.name === "CodeQL").started_at = started_at;
    await expectBlocked({ checks }, "stale-findings");
  }
  await expectBlocked(
    {
      runs: {
        "security.yml": [
          workflowRun("security.yml", pullRequest(), {
            run_started_at: "invalid",
          }),
        ],
      },
    },
    "stale-findings",
  );
});

test("a combined branch cannot silently consume another open PR, including a draft", async () => {
  for (const compareStatus of ["ahead", "identical"])
    await expectBlocked(
      {
        open: [
          pullRequest(),
          { number: 32, draft: true, head: { sha: merged } },
        ],
        compareStatus,
      },
      "contains-open-pr",
    );
  for (const compareStatus of ["behind", "diverged"]) {
    const source = fixture({
      open: [pullRequest(), { number: 32, draft: true, head: { sha: merged } }],
      compareStatus,
    });
    assert.equal(
      (await processPullRequest(source.request, 31, catalogue, { apply: true }))
        .promoted,
      true,
    );
    assert.ok(
      source.calls.some(
        (call) => call.path === `${prefix}/compare/${merged}...${merge}`,
      ),
    );
  }
  for (const options of [
    { open: [{ number: 32, head: { sha: "invalid" } }] },
    { open: [{ number: 32, head: { sha: merged } }], compareStatus: "unknown" },
  ]) {
    const source = fixture(options);
    await assert.rejects(
      processPullRequest(source.request, 31, catalogue, { apply: true }),
      /Invalid or incomplete GitHub response/,
    );
    assert.deepEqual(source.writes(), []);
  }
});

test("reconciliation queues missing main CI/security exactly once and binds CI to the current SHA", async () => {
  const source = fixture({ initialMain: merged });
  assert.equal(await ensureMainVerification(source.request), merged);
  assert.deepEqual(source.writes(), [
    {
      path: `${prefix}/actions/workflows/ci.yml/dispatches`,
      method: "POST",
      body: { ref: "main", inputs: { expected_commit: merged } },
    },
    {
      path: `${prefix}/actions/workflows/security.yml/dispatches`,
      method: "POST",
      body: { ref: "main" },
    },
  ]);
  await ensureMainVerification(source.request);
  assert.equal(source.writes().length, 2);
});

test("reconciliation ignores foreign/stale/PR workflow runs and accepts an already queued exact main run", async () => {
  for (const workflow of ["ci.yml", "security.yml"]) {
    const other = workflow === "ci.yml" ? "security.yml" : "ci.yml";
    for (const overrides of [
      { head_sha: base },
      { head_branch: "feature" },
      { repository: { full_name: "other/project" } },
      { path: ".github/workflows/other.yml" },
      { event: "pull_request" },
    ]) {
      const source = fixture({
        initialMain: merged,
        mainRuns: {
          [workflow]: [mainRun(workflow, merged, overrides)],
          [other]: [mainRun(other, merged)],
        },
      });
      await ensureMainVerification(source.request);
      assert.equal(source.writes().length, 1);
      assert.equal(
        source.writes()[0].path,
        `${prefix}/actions/workflows/${workflow}/dispatches`,
      );
    }
  }
  for (const event of ["push", "workflow_dispatch"]) {
    const source = fixture({
      initialMain: merged,
      mainRuns: {
        "ci.yml": [mainRun("ci.yml", merged, { event })],
        "security.yml": [mainRun("security.yml", merged, { event })],
      },
    });
    await ensureMainVerification(source.request);
    assert.deepEqual(source.writes(), []);
  }
});

test("a failed dispatch is recovered on a later sweep without promoting again or duplicating existing CI", async () => {
  const source = fixture({ dispatchFailures: { "security.yml": 1 } });
  await assert.rejects(
    processPullRequest(source.request, 31, catalogue, { apply: true }),
    /Temporary dispatch failure/,
  );
  const beforeRecovery = source.writes().length;
  assert.equal(await ensureMainVerification(source.request), merge);
  assert.deepEqual(source.writes().slice(beforeRecovery), [
    {
      path: `${prefix}/actions/workflows/security.yml/dispatches`,
      method: "POST",
      body: { ref: "main" },
    },
  ]);
  assert.equal(
    source.writes().filter((call) => call.method === "PATCH").length,
    1,
  );
  await ensureMainVerification(source.request);
  assert.equal(source.writes().length, beforeRecovery + 1);
});

test("a lost promotion response is recoverable through main reconciliation without another promotion", async () => {
  const source = fixture({ lostPromotionResponse: true });
  await assert.rejects(
    processPullRequest(source.request, 31, catalogue, { apply: true }),
    /Lost response after promotion/,
  );
  assert.equal(source.writes().length, 1);
  assert.equal(await ensureMainVerification(source.request), merge);
  assert.equal(source.writes().length, 3);
  assert.equal(
    source.writes().filter((call) => call.method === "PATCH").length,
    1,
  );
});

test("API client uses fixed origin, bounded timeout and redirect refusal without logging token/body", async () => {
  const calls = [];
  const client = githubClient("fictional-token", async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  });
  const body = { sha: head, merge_method: "merge", text: "$(not-a-command)" };
  assert.deepEqual(
    await client(`${prefix}/pulls/31/merge`, { method: "PUT", body }),
    { ok: true },
  );
  assert.equal(calls[0].url, `https://api.github.com${prefix}/pulls/31/merge`);
  assert.equal(calls[0].options.redirect, "error");
  assert.ok(calls[0].options.signal instanceof AbortSignal);
  assert.equal(
    calls[0].options.headers.Authorization,
    "Bearer fictional-token",
  );
  assert.equal(calls[0].options.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(calls[0].options.body), body);
  for (const path of [
    "https://evil.invalid",
    "/repos/other/project/pulls/31",
    `${prefix}/../evil`,
  ])
    await assert.rejects(client(path));
  assert.equal(calls.length, 1);
});

test("API errors/redirects/invalid JSON are redacted and 204 needs no JSON body", async () => {
  for (const fetcher of [
    async () => {
      throw new Error("token=fictional-token payload=private");
    },
    async () => ({
      ok: false,
      status: 403,
      json: async () => ({ token: "fictional-token" }),
    }),
    async () => ({
      ok: false,
      status: 302,
      json: async () => ({ token: "fictional-token" }),
    }),
    async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error("private");
      },
    }),
  ]) {
    const client = githubClient("fictional-token", fetcher);
    await assert.rejects(client(`${prefix}/pulls/31`), (error) => {
      assert.match(error.message, /no merge confirmed/);
      assert.doesNotMatch(error.message, /fictional-token|private/);
      return true;
    });
  }
  const noContent = githubClient("fictional-token", async () => ({
    ok: true,
    status: 204,
    json: async () => assert.fail("204 must not parse JSON"),
  }));
  assert.equal(
    await noContent(`${prefix}/actions/workflows/ci.yml/dispatches`, {
      method: "POST",
      body: { ref: "main" },
    }),
    null,
  );
  for (const invalid of [undefined, null, ""])
    assert.throws(() => githubClient(invalid));
});

test("read evidence uses the restricted client while only allowlisted mutations use the App token", async () => {
  const sent = [];
  const fetcher = async (url, options) => {
    sent.push({
      url,
      method: options.method,
      authorization: options.headers.Authorization,
    });
    return { ok: true, status: 200, json: async () => ({ source: "fixture" }) };
  };
  const request = routeRequests(
    githubClient("fictional-read-token", fetcher),
    githubClient("fictional-app-token", fetcher),
  );
  await request(`${prefix}/pulls/31`);
  await request(`${prefix}/git/ref/heads/main`, { method: "GET" });
  await request(`${prefix}/git/refs/heads/main`, {
    method: "PATCH",
    body: { sha: merge, force: false },
  });
  for (const workflow of ["ci.yml", "security.yml"])
    await request(`${prefix}/actions/workflows/${workflow}/dispatches`, {
      method: "POST",
      body: { ref: "main" },
    });
  assert.deepEqual(
    sent.map((call) => call.authorization),
    [
      "Bearer fictional-read-token",
      "Bearer fictional-read-token",
      "Bearer fictional-app-token",
      "Bearer fictional-app-token",
      "Bearer fictional-app-token",
    ],
  );
  assert.deepEqual(
    sent.map((call) => call.method),
    ["GET", "GET", "PATCH", "POST", "POST"],
  );
});

test("token routing rejects arbitrary mutations and never falls back to the read token", () => {
  const calls = [];
  const request = routeRequests(
    (...args) => calls.push(["read", ...args]),
    (...args) => calls.push(["write", ...args]),
  );
  for (const [path, method] of [
    [`${prefix}/issues/31/comments`, "POST"],
    [`${prefix}/pulls/31/merge`, "PUT"],
    [`${prefix}/git/refs/heads/main`, "DELETE"],
    [`${prefix}/git/refs/heads/other`, "PATCH"],
    [`${prefix}/actions/workflows/other.yml/dispatches`, "POST"],
    [`${prefix}/actions/workflows/ci.yml/dispatches?extra=true`, "POST"],
  ])
    assert.throws(
      () => request(path, { method }),
      /Invalid or incomplete GitHub response/,
    );
  const readOnly = routeRequests((...args) => calls.push(["read", ...args]));
  assert.throws(
    () =>
      readOnly(`${prefix}/git/refs/heads/main`, {
        method: "PATCH",
        body: { sha: merge, force: false },
      }),
    /Invalid or incomplete GitHub response/,
  );
  assert.deepEqual(calls, []);
});

test("a dry-run needs no writer client and cannot promote or dispatch", async () => {
  const source = fixture();
  const request = routeRequests(source.request);
  assert.equal(
    (await processPullRequest(request, 31, catalogue)).eligible,
    true,
  );
  assert.deepEqual(source.writes(), []);
});

test("native review blocking can use the approved App exception only after every explicit check succeeds", async () => {
  const source = fixture({ pr: { mergeable_state: "blocked" } });
  assert.equal(
    (await processPullRequest(source.request, 31, catalogue, { apply: true }))
      .promoted,
    true,
  );
  const checks = checksFor();
  checks[0].conclusion = "failure";
  await expectBlocked(
    { pr: { mergeable_state: "blocked" }, checks },
    "required-checks",
  );
  for (const mergeable_state of ["dirty", "unknown", "unstable"])
    await expectBlocked({ pr: { mergeable_state } }, "merge-not-clean");
});

test("the HTTP client permits Git compare's three-dot delimiter and rejects normalized repository escapes", async () => {
  const calls = [];
  const client = githubClient("fictional-read-token", async (url) => {
    calls.push(url);
    return {
      ok: true,
      status: 200,
      json: async () => ({ status: "diverged" }),
    };
  });
  const path = `${prefix}/compare/${head}...${merge}`;
  assert.deepEqual(await client(path), { status: "diverged" });
  assert.deepEqual(calls, [`https://api.github.com${path}`]);
  calls.length = 0;
  for (const invalid of [
    `${prefix}/../evil/pulls/31`,
    `${prefix}/%2e%2e/evil/pulls/31`,
    `${prefix}/%2E./evil/pulls/31`,
    `${prefix}/..\\evil/pulls/31`,
    "https://evil.invalid/repos/other/project/pulls/31",
    "//evil.invalid/repos/other/project/pulls/31",
  ])
    await assert.rejects(
      client(invalid),
      /Invalid or incomplete GitHub response/,
    );
  assert.deepEqual(calls, []);
});

test("the composed router, HTTP clients and full merge process handle compares and preserve token boundaries", async () => {
  const source = fixture({
    open: [pullRequest(), { number: 32, head: { sha: merged } }],
    compareStatus: "diverged",
  });
  const sent = [];
  // Exercise the public HTTP boundary as well as domain orchestration. A direct
  // request-function fixture alone would miss URL validation/routing regressions.
  const fetcher = async (url, options) => {
    const parsed = new URL(url);
    assert.equal(parsed.origin, "https://api.github.com");
    sent.push({
      path: parsed.pathname,
      method: options.method,
      authorization: options.headers.Authorization,
    });
    const data = await source.request(parsed.pathname + parsed.search, {
      method: options.method,
      ...(options.body ? { body: JSON.parse(options.body) } : {}),
    });
    return {
      ok: true,
      status: data === null ? 204 : 200,
      json: async () => {
        assert.notEqual(data, null, "204 dispatch responses have no JSON body");
        return structuredClone(data);
      },
    };
  };
  const request = routeRequests(
    githubClient("fictional-read-token", fetcher),
    githubClient("fictional-app-token", fetcher),
  );
  const result = await processPullRequest(request, 31, catalogue, {
    apply: true,
  });
  assert.equal(result.promoted, true);
  assert.equal(result.merged, true);
  assert.equal(result.commit, merge);
  assert.ok(
    sent.some((call) => call.path === `${prefix}/compare/${merged}...${merge}`),
  );
  for (const call of sent)
    assert.equal(
      call.authorization,
      call.method === "GET"
        ? "Bearer fictional-read-token"
        : "Bearer fictional-app-token",
    );
  assert.deepEqual(
    source.writes().map(({ method }) => method),
    ["PATCH", "POST", "POST"],
  );
});
