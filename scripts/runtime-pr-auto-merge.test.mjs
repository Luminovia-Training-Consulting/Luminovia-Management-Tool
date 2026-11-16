/**
 * Exercises native merge policy, exact check/push identity, independent review
 * and recovery against a stateful fictional GitHub API. Composed HTTP/token
 * clients are intercepted locally; no credential or real repository is used.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  evaluateChecks,
  evaluateNativePolicy,
  ensureMainVerification,
  githubClient,
  inspectPullRequest,
  processPullRequest,
  pushQuery,
  readSourcePusher,
  repository,
  routeRequests,
} from "./pr-auto-merge.mjs";

const catalogue = JSON.parse(
  await readFile(new URL("../.github/labels.json", import.meta.url), "utf8"),
);
const prefix = "/repos/" + repository;
const head = "a".repeat(40);
const base = "b".repeat(40);
const merge = "c".repeat(40);
const committed = "d".repeat(40);
const tree = "e".repeat(40);
const author = { login: "maintainer", id: 1, type: "User" };
const reviewer = { login: "reviewer", id: 99, type: "User" };
const pusher = { login: "source-writer", id: 20, type: "User" };
const writer = { login: "ordinary-writer", id: 30, type: "User" };
const started = "2026-11-16T04:00:00Z";
const names = [
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
  "CodeQL",
];
const suites = {
  "ci.yml": 1000,
  "security.yml": 1001,
  "pr-metadata.yml": 1002,
};
const workflowFor = (name) =>
  name === "PR metadata"
    ? "pr-metadata.yml"
    : name.startsWith("CodeQL (") || name === "Dependency review"
      ? "security.yml"
      : "ci.yml";

function nativeRules() {
  return [
    { type: "deletion", parameters: null },
    { type: "non_fast_forward", parameters: null },
    { type: "required_signatures", parameters: null },
    {
      type: "required_deployments",
      parameters: { required_deployment_environments: [] },
    },
    { type: "code_quality", parameters: { severity: "errors" } },
    {
      type: "pull_request",
      parameters: {
        required_approving_review_count: 1,
        require_last_push_approval: true,
        required_review_thread_resolution: true,
        dismiss_stale_reviews_on_push: true,
        allowed_merge_methods: ["merge", "squash", "rebase"],
      },
    },
    {
      type: "required_status_checks",
      parameters: {
        strict_required_status_checks_policy: true,
        do_not_enforce_on_create: false,
        required_status_checks: names.map((context) => ({
          context,
          integration_id: context === "CodeQL" ? 57789 : 15368,
        })),
      },
    },
  ];
}
function checksFor(sha = head) {
  return names.map((name, index) => ({
    id: index + 1,
    name,
    head_sha: sha,
    app: { id: name === "CodeQL" ? 57789 : 15368 },
    status: "completed",
    conclusion: "success",
    started_at: started,
    check_suite: { id: suites[workflowFor(name)] },
  }));
}
function pull(overrides = {}) {
  return {
    number: 31,
    state: "open",
    draft: false,
    base: { sha: base, ref: "main", repo: { full_name: repository } },
    head: { sha: head },
    merge_commit_sha: merge,
    mergeable: true,
    mergeable_state: "clean",
    user: author,
    labels: ["type:tests", "area:github", "risk:high"].map((name) => ({
      name,
    })),
    ...overrides,
  };
}
function approval(overrides = {}) {
  return {
    id: 1,
    user: reviewer,
    state: "APPROVED",
    commit_id: head,
    ...overrides,
  };
}
function run(workflow, pr = pull(), overrides = {}) {
  return {
    id: 100,
    check_suite_id: suites[workflow],
    check_suite_node_id: "CS_" + suites[workflow],
    repository: { full_name: repository },
    path: ".github/workflows/" + workflow,
    event: "pull_request",
    head_sha: pr.head.sha,
    status: "completed",
    conclusion: "success",
    actor: author,
    triggering_actor: author,
    run_started_at: started,
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
function pushResponse(overrides = {}) {
  return {
    data: {
      node: {
        __typename: "CheckSuite",
        id: "CS_1000",
        databaseId: 1000,
        commit: { oid: head, repository: { nameWithOwner: repository } },
        push: {
          nextSha: head,
          previousSha: base,
          repository: { nameWithOwner: repository },
          pusher: {
            __typename: "User",
            login: pusher.login,
            databaseId: pusher.id,
          },
        },
        ...overrides,
      },
    },
  };
}
function analysesFor(sha = merge) {
  return ["javascript-typescript", "python", "actions"].map(
    (language, index) => ({
      id: 300 + index,
      category: "/language:" + language,
      analysis_key: ".github/workflows/security.yml:codeql",
      commit_sha: sha,
      error: "",
      results_count: 0,
    }),
  );
}
function gitCommit(sha, overrides = {}) {
  return {
    sha,
    parents: [{ sha: base }, { sha: head }],
    tree: { sha: tree },
    verification: { verified: true, reason: "valid" },
    ...overrides,
  };
}
function mainRun(workflow, sha, overrides = {}) {
  return {
    id: 500,
    head_sha: sha,
    head_branch: "main",
    repository: { full_name: repository },
    path: ".github/workflows/" + workflow,
    event: "push",
    status: "queued",
    ...overrides,
  };
}

/** A fictional GitHub state machine, not a permissive generic HTTP stub.
 * Native merge changes the observed main/PR state. Lost responses preserve
 * those side effects so recovery exercises the real controller composition. */
function fixture(options = {}) {
  const calls = [];
  let inspection = -1;
  let active = pull(options.pr);
  let didMerge = false;
  const mainRuns = structuredClone(options.mainRuns ?? {});
  const failures = { ...options.dispatchFailures };
  const currentMain = () =>
    didMerge ? (options.finalMain ?? committed) : (options.initialMain ?? base);
  const request = async (path, config = {}) => {
    const method = config.method ?? "GET";
    calls.push({
      path,
      method,
      ...(config.body ? { body: structuredClone(config.body) } : {}),
    });
    const url = new URL("https://api.github.com" + path);
    if (path === "/graphql") {
      assert.equal(method, "POST");
      assert.deepEqual(config.body, {
        query: pushQuery,
        variables: { id: "CS_1000" },
      });
      return structuredClone(
        options.graphqlInspections?.[inspection] ??
          options.graphql ??
          pushResponse(),
      );
    }
    const route = url.pathname.slice(prefix.length);
    if (route === "/pulls/31" && method === "GET") {
      if (didMerge) {
        if (options.observedError)
          throw new Error("Fictional readback failure");
        return structuredClone(
          options.observed ?? {
            ...active,
            merged: true,
            merge_commit_sha: committed,
          },
        );
      }
      inspection++;
      active = pull(options.inspections?.[inspection] ?? options.pr);
      return structuredClone(active);
    }
    if (route === "/rules/branches/main")
      return structuredClone(
        options.ruleInspections?.[inspection] ?? options.rules ?? nativeRules(),
      );
    if (route === "/git/ref/heads/main")
      return { object: { sha: currentMain() } };
    if (route === "/git/commits/" + committed) {
      if (options.commitError) throw new Error("Fictional commit read failure");
      return structuredClone(options.actualCommit ?? gitCommit(committed));
    }
    if (route === "/git/commits/" + active.merge_commit_sha)
      return structuredClone(
        options.mergeCommit ?? gitCommit(active.merge_commit_sha),
      );
    if (route === "/commits/" + active.head.sha + "/check-runs") {
      const checks =
        options.checkInspections?.[inspection] ??
        options.checks ??
        checksFor(active.head.sha);
      const page = Number(url.searchParams.get("page"));
      return { check_runs: checks.slice((page - 1) * 100, page * 100) };
    }
    if (route === "/commits/" + active.head.sha + "/status")
      return structuredClone(
        options.statuses ?? { total_count: 0, state: "pending", statuses: [] },
      );
    const workflow = route.match(/^\/actions\/workflows\/([^/]+)\/runs$/)?.[1];
    if (workflow) {
      const all =
        url.searchParams.get("branch") === "main"
          ? (mainRuns[workflow] ?? [])
          : (options.runInspections?.[inspection]?.[workflow] ??
            options.runs?.[workflow] ?? [run(workflow, active)]);
      const page = Number(url.searchParams.get("page"));
      return {
        total_count: all.length,
        workflow_runs: structuredClone(all.slice((page - 1) * 100, page * 100)),
      };
    }
    if (route === "/code-scanning/analyses")
      return structuredClone(
        options.analyses ?? analysesFor(active.merge_commit_sha),
      );
    if (route === "/pulls/31/reviews")
      return structuredClone(
        options.reviewInspections?.[inspection] ??
          options.reviews ?? [approval()],
      );
    const login = route.match(/^\/collaborators\/([^/]+)\/permission$/)?.[1];
    if (login) {
      const user =
        options.identities?.[login] ??
        [author, reviewer, pusher, writer].find((user) => user.login === login);
      const role =
        options.permissionInspections?.[inspection]?.[login] ??
        options.permissions?.[login] ??
        "write";
      return typeof role === "string"
        ? {
            permission: role === "maintain" ? "write" : role,
            role_name: role,
            user: structuredClone(user),
          }
        : structuredClone({ user, ...role });
    }
    if (route === "/pulls") return structuredClone(options.open ?? [active]);
    if (route.startsWith("/compare/"))
      return { status: options.compareStatus ?? "diverged" };
    if (route === "/pulls/31/merge" && method === "PUT") {
      assert.deepEqual(config.body, {
        sha: active.head.sha,
        merge_method: "merge",
      });
      if (options.nativeError) throw new Error(options.nativeError);
      didMerge = true;
      if (options.lostMergeResponse)
        throw new Error("Fictional lost native response");
      return structuredClone(
        options.nativeResult ?? { merged: true, sha: committed },
      );
    }
    const dispatch = route.match(
      /^\/actions\/workflows\/(ci\.yml|security\.yml)\/dispatches$/,
    )?.[1];
    if (dispatch) {
      assert.equal(method, "POST");
      if (failures[dispatch] > 0) {
        failures[dispatch]--;
        throw new Error("Fictional dispatch failure");
      }
      (mainRuns[dispatch] ??= []).push(mainRun(dispatch, currentMain()));
      return null;
    }
    assert.fail("Unexpected fixture API request: " + method + " " + path);
  };
  return {
    request,
    calls,
    writes: () =>
      calls.filter((call) => call.method !== "GET" && call.path !== "/graphql"),
  };
}
function httpFixture(options = {}) {
  const source = fixture(options);
  const sent = [];
  const fetcher = async (url, config) => {
    const parsed = new URL(url);
    sent.push({
      path: parsed.pathname,
      method: config.method,
      token: config.headers.Authorization,
    });
    const data = await source.request(parsed.pathname + parsed.search, {
      method: config.method,
      ...(config.body ? { body: JSON.parse(config.body) } : {}),
    });
    return {
      ok: true,
      status: data === null ? 204 : 200,
      json: async () => structuredClone(data),
    };
  };
  return {
    ...source,
    sent,
    request: routeRequests(
      githubClient("fictional-read", fetcher),
      githubClient("fictional-promotion", fetcher),
    ),
  };
}
async function blocked(options, reason) {
  const source = fixture(options);
  assert.deepEqual(
    await processPullRequest(source.request, 31, catalogue, { apply: true }),
    { eligible: false, reason },
  );
  assert.deepEqual(source.writes(), []);
  return source;
}

test("all fifteen independently named checks and expected Apps must succeed", () => {
  assert.equal(names.length, 15);
  assert.deepEqual(evaluateChecks(checksFor(), head), { eligible: true });
  for (const name of names) {
    const checks = checksFor();
    checks.find((check) => check.name === name).conclusion = "failure";
    assert.equal(evaluateChecks(checks, head).eligible, false, name);
    assert.equal(
      evaluateChecks(
        checks.filter((check) => check.name !== name),
        head,
      ).eligible,
      false,
      name,
    );
  }
  for (const change of [
    (check) => (check.app.id = 999),
    (check) => (check.head_sha = base),
    (check) => (check.status = "queued"),
    (check) => (check.conclusion = "neutral"),
    (check) => (check.conclusion = "cancelled"),
    (check) => (check.conclusion = "skipped"),
  ]) {
    const checks = checksFor();
    change(checks[0]);
    assert.equal(evaluateChecks(checks, head).eligible, false);
  }
});
test("newest check attempts and all additional checks remain authoritative", () => {
  const checks = checksFor();
  checks[0].conclusion = "failure";
  assert.equal(
    evaluateChecks(
      [...checks, { ...checks[0], id: 100, conclusion: "success" }],
      head,
    ).eligible,
    true,
  );
  assert.equal(
    evaluateChecks([...checks, { ...checks[0], id: 100 }], head).eligible,
    false,
  );
  for (const extra of [
    { name: "Extra check", conclusion: "failure" },
    {
      name: "Build",
      app: { id: 999 },
      conclusion: "success",
      status: "queued",
    },
    {
      name: "Publish tested CMS update",
      app: { id: 999 },
      conclusion: "skipped",
    },
  ])
    assert.equal(
      evaluateChecks(
        [...checksFor(), { ...checksFor()[0], id: 100, ...extra }],
        head,
      ).eligible,
      false,
    );
  assert.equal(
    evaluateChecks(
      [
        ...checksFor(),
        {
          ...checksFor()[0],
          id: 100,
          name: "Publish tested CMS update",
          conclusion: "skipped",
        },
      ],
      head,
    ).eligible,
    true,
  );
});
test("the live strict fifteen-check signature and independent-review contract is compulsory", async () => {
  assert.equal(evaluateNativePolicy(nativeRules()).eligible, true);
  const changes = [
    (rules) => rules.pop(),
    (rules) => rules.push({ type: "new_mandatory_rule" }),
    (rules) =>
      (rules.find(
        (rule) => rule.type === "required_status_checks",
      ).parameters.strict_required_status_checks_policy = false),
    (rules) =>
      rules
        .find((rule) => rule.type === "required_status_checks")
        .parameters.required_status_checks.pop(),
    (rules) =>
      rules
        .find((rule) => rule.type === "required_status_checks")
        .parameters.required_status_checks.push({
          context: "Unknown required CI",
          integration_id: 15368,
        }),
    (rules) =>
      (rules.find(
        (rule) => rule.type === "required_status_checks",
      ).parameters.required_status_checks[0].integration_id = 999),
    (rules) =>
      (rules.find(
        (rule) => rule.type === "required_status_checks",
      ).parameters.required_status_checks[0] = null),
    (rules) =>
      (rules.find(
        (rule) => rule.type === "required_status_checks",
      ).parameters.required_status_checks[0] = {
        context: "Unknown missing integration",
      }),
    (rules) =>
      (rules.find(
        (rule) => rule.type === "pull_request",
      ).parameters.require_last_push_approval = false),
    (rules) =>
      (rules.find(
        (rule) => rule.type === "pull_request",
      ).parameters.required_approving_review_count = 0),
    (rules) =>
      (rules.find((rule) => rule.type === "code_quality").parameters.severity =
        "warnings"),
    (rules) =>
      rules
        .find((rule) => rule.type === "required_deployments")
        .parameters.required_deployment_environments.push(
          "Unknown mandatory environment",
        ),
  ];
  for (const change of changes) {
    const rules = nativeRules();
    change(rules);
    await blocked({ rules }, "native-policy");
  }
  for (const rules of [null, [], {}])
    assert.equal(evaluateNativePolicy(rules).eligible, false);
});
test("draft, hold, conflicts, stale source and malformed metadata make no write request", async () => {
  for (const [pr, reason] of [
    [{ draft: true }, "draft-or-closed"],
    [{ state: "closed" }, "draft-or-closed"],
    [{ labels: [...pull().labels, { name: "merge:hold" }] }, "maintainer-hold"],
    [{ mergeable: null }, "merge-not-clean"],
    [{ mergeable_state: "dirty" }, "merge-not-clean"],
    [{ base: { ...pull().base, ref: "elsewhere" } }, "foreign-base"],
    [{ labels: [] }, "labels"],
    [{ base: { ...pull().base, sha: committed } }, "stale-base"],
  ])
    await blocked({ pr }, reason);
});
test("synthetic merge parents, tree and signature must match the exact source under test", async () => {
  for (const override of [
    { sha: base },
    { parents: [{ sha: head }, { sha: base }] },
    { tree: undefined },
    { tree: { sha: "invalid" } },
    { verification: { verified: false, reason: "unsigned" } },
  ])
    await blocked(
      { mergeCommit: gitCommit(merge, override) },
      "untested-merge",
    );
});
test("every required check belongs to the selected workflow suite and latest exact-head run", async () => {
  for (const name of [
    "Build",
    "PR preview package",
    "PR metadata",
    "Dependency review",
  ]) {
    const checks = checksFor();
    checks.find((check) => check.name === name).check_suite.id = 999;
    await blocked({ checks }, "check-suite-provenance");
  }
  for (const workflow of Object.keys(suites))
    for (const change of [
      { status: "in_progress" },
      { conclusion: "failure" },
      { head_sha: base },
      { event: "workflow_dispatch" },
      { repository: { full_name: "other/repository" } },
      {
        pull_requests: [
          { number: 32, head: { sha: head }, base: { sha: base, ref: "main" } },
        ],
      },
    ])
      await blocked(
        { runs: { [workflow]: [run(workflow, pull(), change)] } },
        "workflow-provenance",
      );
});
test("CodeQL analyses bind exact test-merge, category, owning workflow and zero findings", async () => {
  for (let i = 0; i < 3; i++)
    for (const change of [
      (analyses) => analyses.splice(i, 1),
      (analyses) => (analyses[i].commit_sha = head),
      (analyses) => (analyses[i].analysis_key = "other-workflow"),
      (analyses) => (analyses[i].results_count = 1),
      (analyses) => (analyses[i].error = "Fictional scan error"),
    ]) {
      const analyses = analysesFor();
      change(analyses);
      await blocked({ analyses }, "analysis-provenance");
    }
});
test("finding freshness follows actual retained CodeQL jobs rather than a dependency-only rerun", async () => {
  const source = fixture({
    runs: {
      "security.yml": [
        run("security.yml", pull(), {
          run_started_at: "2026-11-16T05:00Z",
          run_attempt: 2,
        }),
      ],
    },
  });
  assert.equal(
    (await inspectPullRequest(source.request, 31, catalogue)).eligible,
    true,
  );
  const checks = checksFor();
  checks.find((check) => check.name === "CodeQL").started_at =
    "2026-11-16T03:00Z";
  await blocked({ checks }, "stale-findings");
});
test("legacy commit-status failure and hidden extra checks cannot be ignored", async () => {
  await blocked(
    {
      statuses: {
        total_count: 1,
        state: "failure",
        statuses: [{ state: "failure" }],
      },
    },
    "commit-status",
  );
  const checks = [
    ...checksFor(),
    ...Array.from({ length: 91 }, (_, i) => ({
      ...checksFor()[0],
      id: 100 + i,
      name: "Extra " + i,
    })),
  ];
  checks[100].conclusion = "failure";
  const source = await blocked({ checks }, "additional-checks");
  assert.ok(
    source.calls.some(
      (call) =>
        call.path.includes("check-runs?") && call.path.endsWith("page=2"),
    ),
  );
});

for (const [scenario, actor, earlier] of [
  ["writer", writer, false],
  ["writer then admin reopen", writer, true],
  ["cancelled writer then admin reopen", writer, "cancelled"],
  [
    "Bot then admin reopen",
    { login: "dependency-bot[bot]", id: 40, type: "Bot" },
    true,
  ],
  ["missing actor then admin reopen", undefined, true],
  [
    "unknown actor then admin reopen",
    { login: "unknown", id: 50, type: "Unknown" },
    true,
  ],
  ["initial admin-initiated run", author, false],
]) {
  test("no workflow actor exception: " + scenario, async () => {
    const current = run("ci.yml", pull(), {
      actor: earlier ? author : actor,
      triggering_actor: author,
    });
    const runs = earlier
      ? [
          run("ci.yml", pull(), {
            id: 90,
            check_suite_id: 900,
            actor,
            conclusion: earlier === "cancelled" ? "cancelled" : "success",
          }),
          current,
        ]
      : [current];
    const source = await blocked(
      { runs: { "ci.yml": runs }, reviews: [] },
      "external-review",
    );
    assert.ok(source.calls.some((call) => call.path === "/graphql"));
    const reviewed = fixture({ runs: { "ci.yml": runs } });
    assert.equal(
      (await inspectPullRequest(reviewed.request, 31, catalogue)).eligible,
      true,
    );
  });
}
test("all candidates including admin authors require independent current-head approval and native clean", async () => {
  for (const role of ["admin", "maintain", "write"])
    await blocked(
      { permissions: { maintainer: role }, reviews: [] },
      "external-review",
    );
  for (const review of [
    approval({ user: author }),
    approval({ commit_id: base }),
    approval({ state: "COMMENTED" }),
    approval({ state: "DISMISSED" }),
  ])
    await blocked({ reviews: [review] }, "external-review");
  await blocked(
    { pr: { mergeable_state: "blocked" } },
    "native-review-blocked",
  );
});
test("the actual immutable pusher cannot approve their own pushed contribution", async () => {
  await blocked({ reviews: [approval({ user: pusher })] }, "external-review");
  await blocked(
    { reviews: [approval({ user: { ...pusher, login: "SOURCE-WRITER" } })] },
    "external-review",
  );
  const bot = { __typename: "Bot", login: "dependency-bot[bot]" };
  await blocked(
    {
      graphql: pushResponse({
        push: { ...pushResponse().data.node.push, pusher: bot },
      }),
      reviews: [approval({ user: { id: 50, type: "Bot", login: bot.login } })],
    },
    "external-review",
  );
});
test("null push evidence gives no exemption while valid independent native-clean review still works", async () => {
  const graphql = pushResponse({ push: null });
  await blocked({ graphql, reviews: [] }, "external-review");
  assert.equal(
    (await inspectPullRequest(fixture({ graphql }).request, 31, catalogue))
      .eligible,
    true,
  );
  await blocked(
    { graphql, pr: { mergeable_state: "blocked" } },
    "native-review-blocked",
  );
});
test("contradictory suite, head, repository, pusher or GraphQL errors fail before mutation", async () => {
  const mutations = [
    (r) => (r.errors = [{ message: "Fictional private GraphQL error" }]),
    (r) => (r.data.node = null),
    (r) => (r.data.node.__typename = "User"),
    (r) => (r.data.node.id = "CS_other"),
    (r) => (r.data.node.databaseId = 999),
    (r) => (r.data.node.commit.oid = base),
    (r) => (r.data.node.commit.repository.nameWithOwner = "other/repository"),
    (r) => (r.data.node.push.nextSha = merge),
    (r) => (r.data.node.push.repository.nameWithOwner = "other/repository"),
    (r) => (r.data.node.push.pusher.databaseId = 0),
    (r) => (r.data.node.push.pusher = null),
  ];
  for (const change of mutations) {
    const graphql = pushResponse();
    change(graphql);
    const source = fixture({ graphql });
    await assert.rejects(
      processPullRequest(source.request, 31, catalogue, { apply: true }),
    );
    assert.deepEqual(source.writes(), []);
  }
  for (const user of [
    { ...pusher, id: 900 },
    { ...pusher, login: "recycled" },
    null,
  ]) {
    const source = fixture({
      permissions: { [pusher.login]: { permission: "write", user } },
    });
    await assert.rejects(inspectPullRequest(source.request, 31, catalogue));
  }
});
test("a current independent reviewer may be Write, Maintain or Admin, with canonical identity checks", async () => {
  for (const permission of ["write", "maintain", "admin"]) {
    const source = fixture({ permissions: { reviewer: permission } });
    assert.equal(
      (await inspectPullRequest(source.request, 31, catalogue)).eligible,
      true,
    );
  }
  for (const role of ["read", "triage", "none"])
    await blocked({ permissions: { reviewer: role } }, "external-review");
  for (const user of [
    { ...reviewer, id: 900 },
    { ...reviewer, login: "recycled" },
    null,
  ])
    await blocked(
      { permissions: { reviewer: { permission: "write", user } } },
      "external-review",
    );
});
test("approval, current reviewer permission and known pusher are rechecked before native merge", async () => {
  await blocked({ reviewInspections: [[approval()], []] }, "external-review");
  await blocked(
    { permissionInspections: [{ reviewer: "write" }, { reviewer: "read" }] },
    "external-review",
  );
  const graphql = pushResponse();
  graphql.data.node.push.pusher = {
    __typename: "User",
    login: reviewer.login,
    databaseId: reviewer.id,
  };
  await blocked(
    { graphqlInspections: [pushResponse(), graphql] },
    "external-review",
  );
  const rules = nativeRules();
  rules.pop();
  await blocked({ ruleInspections: [nativeRules(), rules] }, "native-policy");
});
test("changes requested block even administrator authors until genuinely superseded", async () => {
  const change = { ...approval(), id: 2, state: "CHANGES_REQUESTED" };
  await blocked({ reviews: [approval(), change] }, "changes-requested");
  assert.equal(
    (
      await inspectPullRequest(
        fixture({ reviews: [change, approval({ id: 3 })] }).request,
        31,
        catalogue,
      )
    ).eligible,
    true,
  );
});
test("a changed source or new hold at the final inspection stops native mutation", async () => {
  await blocked(
    { inspections: [pull(), pull({ head: { sha: committed } })] },
    "untested-merge",
  );
  await blocked(
    { inspections: [pull(), pull({ merge_commit_sha: committed })] },
    "changed-during-inspection",
  );
  await blocked(
    {
      inspections: [
        pull(),
        pull({ labels: [...pull().labels, { name: "merge:hold" }] }),
      ],
    },
    "maintainer-hold",
  );
});
test("a combined candidate cannot consume another draft or held PR", async () => {
  for (const status of ["ahead", "identical"])
    await blocked(
      {
        open: [pull(), { number: 32, draft: true, head: { sha: committed } }],
        compareStatus: status,
      },
      "contains-open-pr",
    );
});
test("native merge uses the current head condition and can return a different signed commit SHA", async () => {
  const source = httpFixture();
  const result = await processPullRequest(source.request, 31, catalogue, {
    apply: true,
  });
  assert.equal(result.nativeMerged, true);
  assert.equal(result.merged, true);
  assert.equal(result.testedMerge, merge);
  assert.equal(result.commit, committed);
  assert.equal(result.signatureVerified, true);
  assert.deepEqual(source.writes()[0], {
    method: "PUT",
    path: prefix + "/pulls/31/merge",
    body: { sha: head, merge_method: "merge" },
  });
  assert.ok(
    source.sent.every(
      (call) =>
        call.token ===
        (call.method === "GET" || call.path === "/graphql"
          ? "Bearer fictional-read"
          : "Bearer fictional-promotion"),
    ),
  );
  assert.ok(source.sent.every((call) => call.method !== "PATCH"));
});
test("native server refusal never falls back to direct refs or rule bypass", async () => {
  for (const nativeError of [
    "GitHub 403",
    "GitHub 405",
    "GitHub 409",
    "GitHub 422",
  ]) {
    const source = fixture({ nativeError });
    await assert.rejects(
      processPullRequest(source.request, 31, catalogue, { apply: true }),
      /GitHub/,
    );
    assert.equal(source.writes().length, 1);
    assert.equal(source.writes()[0].method, "PUT");
  }
});
test("native commit readback rejects contradictory parents, tree or signature and still queues main checks", async () => {
  for (const options of [
    {
      actualCommit: gitCommit(committed, {
        parents: [{ sha: head }, { sha: base }],
      }),
    },
    { actualCommit: gitCommit(committed, { tree: { sha: base } }) },
    {
      actualCommit: gitCommit(committed, {
        verification: { verified: false, reason: "unsigned" },
      }),
    },
    { actualCommit: gitCommit(committed, { verification: undefined }) },
    { commitError: true },
  ]) {
    const source = fixture(options);
    await assert.rejects(
      processPullRequest(source.request, 31, catalogue, { apply: true }),
      /Native merge confirmed; commit provenance/,
    );
    assert.equal(
      source.writes().filter((call) => call.method === "POST").length,
      2,
    );
  }
});
test("missing or stale PR readback is not misreported as an observed merge of the current head", async () => {
  for (const observed of [
    { ...pull(), merged: false },
    { ...pull(), merged: true, merge_commit_sha: base },
    {
      ...pull(),
      merged: true,
      head: { sha: base },
      merge_commit_sha: committed,
    },
  ]) {
    const source = fixture({ observed });
    const result = await processPullRequest(source.request, 31, catalogue, {
      apply: true,
    });
    assert.equal(result.nativeMerged, true);
    assert.equal(result.merged, false);
  }
  const source = fixture({ observedError: true });
  await assert.rejects(
    processPullRequest(source.request, 31, catalogue, { apply: true }),
    /Native merge confirmed; pull request readback/,
  );
});
test("lost native response and dispatch failure recover independently of now-closed PRs", async () => {
  for (const options of [
    { lostMergeResponse: true },
    { dispatchFailures: { "security.yml": 1 } },
  ]) {
    const source = fixture(options);
    await assert.rejects(
      processPullRequest(source.request, 31, catalogue, { apply: true }),
    );
    await ensureMainVerification(source.request);
    const writes = source.writes();
    assert.equal(writes.filter((call) => call.method === "PUT").length, 1);
    assert.equal(
      writes.filter(
        (call) =>
          call.method === "POST" && call.path.endsWith("ci.yml/dispatches"),
      ).length,
      1,
    );
    const previous = writes.length;
    await ensureMainVerification(source.request);
    assert.equal(source.writes().length, previous);
  }
});
test("main verification is tied to the current actual source and never silently reruns a failed run", async () => {
  const source = fixture({ initialMain: committed });
  assert.equal(await ensureMainVerification(source.request), committed);
  assert.deepEqual(source.writes()[0].body, {
    ref: "main",
    inputs: { expected_commit: committed },
  });
  await ensureMainVerification(source.request);
  assert.equal(source.writes().length, 2);
  const failed = fixture({
    mainRuns: {
      "ci.yml": [
        mainRun("ci.yml", base, { status: "completed", conclusion: "failure" }),
      ],
      "security.yml": [mainRun("security.yml", base)],
    },
  });
  await ensureMainVerification(failed.request);
  assert.deepEqual(failed.writes(), []);
});
test("dry inspection has no native or dispatch mutation even when all checks and approvals pass", async () => {
  const source = fixture();
  assert.equal(
    (await processPullRequest(source.request, 31, catalogue)).eligible,
    true,
  );
  assert.deepEqual(source.writes(), []);
});
test("only the exact fixed GraphQL read reaches the read credential; arbitrary queries and mutations are rejected", async () => {
  const source = httpFixture();
  await readSourcePusher(source.request, run("ci.yml"), head);
  assert.equal(source.sent[0].token, "Bearer fictional-read");
  assert.equal(source.sent[0].path, "/graphql");
  for (const options of [
    { method: "GET" },
    {
      method: "POST",
      body: { query: "mutation { deleteRef }", variables: { id: "CS_1000" } },
    },
    {
      method: "POST",
      body: {
        query: pushQuery + " mutation { deleteRef }",
        variables: { id: "CS_1000" },
      },
    },
    {
      method: "POST",
      body: { query: pushQuery, variables: { id: "CS_1000", other: "unsafe" } },
    },
    {
      method: "POST",
      body: {
        query: pushQuery,
        variables: { id: '" } mutation { deleteRef }' },
      },
    },
  ])
    assert.throws(() => source.request("/graphql", options));
  assert.equal(source.sent.length, 1);
});
test("promotion routing rejects main PATCH, arbitrary writes, bypass flags and mutation-capable GraphQL", () => {
  const calls = [];
  const request = routeRequests(
    (...args) => calls.push(args),
    (...args) => calls.push(args),
  );
  for (const [path, options] of [
    [
      prefix + "/git/refs/heads/main",
      { method: "PATCH", body: { sha: head, force: false } },
    ],
    [
      prefix + "/pulls/31/merge",
      {
        method: "PUT",
        body: { sha: head, merge_method: "merge", bypass_rules: true },
      },
    ],
    [
      prefix + "/pulls/31/merge",
      { method: "PUT", body: { sha: head, merge_method: "squash" } },
    ],
    [prefix + "/issues/31/comments", { method: "POST" }],
    [prefix + "/actions/workflows/other.yml/dispatches", { method: "POST" }],
  ])
    assert.throws(() => request(path, options));
  assert.deepEqual(calls, []);
});
test("HTTP errors, redirects, invalid JSON and hostile paths cannot expose tokens or private payloads", async () => {
  for (const fetcher of [
    async () => {
      throw new Error("fictional-token private-body");
    },
    async () => ({ ok: false, status: 403 }),
    async () => ({ ok: false, status: 302 }),
    async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error("private-body");
      },
    }),
  ]) {
    await assert.rejects(
      githubClient("fictional-token", fetcher)(prefix + "/pulls/31"),
      (error) => {
        assert.doesNotMatch(error.message, /fictional-token|private-body/);
        return true;
      },
    );
  }
  const sent = [];
  const client = githubClient("fictional-token", async (url, options) => {
    sent.push({ url, options });
    return { ok: true, status: 204 };
  });
  for (const path of [
    "https://evil.invalid",
    prefix + "/%2e%2e/other/pulls/31",
    prefix + "/..\\other",
  ])
    await assert.rejects(client(path));
  assert.equal(sent.length, 0);
  await client(prefix + "/actions/workflows/ci.yml/dispatches", {
    method: "POST",
    body: { ref: "main" },
  });
  assert.equal(sent[0].options.redirect, "error");
  assert.ok(sent[0].options.signal instanceof AbortSignal);
});
