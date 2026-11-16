/**
 * Runs the actual controller CLI in isolated child processes with only fictional
 * credentials. A trusted preload intercepts every fetch, proves read/write token
 * routing and removes its private temporary fixtures after each process exits.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pushQuery } from "./pr-auto-merge.mjs";

const repository = "Luminovia-Training-Consulting/Luminovia-Management-Tool";
const prefix = `/repos/${repository}`;
const head = "b".repeat(40);
const readToken = "fictional-cli-reader-credential";
const writeToken = "fictional-cli-promotion-credential";
const privateError = "fictional-private-response-context";
const listPath = `${prefix}/pulls?state=open&base=main&sort=created&direction=asc&per_page=100&page=1`;
const mainRunsPath = (workflow) =>
  `${prefix}/actions/workflows/${workflow}/runs?branch=main&head_sha=${head}&per_page=100&page=1`;
const route = (path, data, options = {}) => ({
  method: "GET",
  path,
  data,
  ...options,
});
const draft = (number) => ({
  number,
  head: { sha: "a".repeat(40) },
  state: "open",
  draft: true,
  title: privateError,
});

// Constant trusted preload code: fixture paths and response data are passed as
// JSON/environment data, never interpolated into executable JavaScript. Every
// fetch is intercepted; the child cannot fall through to real network access.
const preload = String.raw`
import assert from "node:assert/strict";
import { appendFileSync, readFileSync } from "node:fs";
const fixture = JSON.parse(readFileSync(process.env.PR_MERGE_CLI_FIXTURE, "utf8"));
if (fixture.forbidPromotionEnv) process.env = new Proxy(process.env, {
  get(target, key) {
    assert.notEqual(key, "PROMOTION_TOKEN", "The probe cannot even read the writer credential.");
    return Reflect.get(target, key);
  },
});
let nativeMerged = false;
globalThis.fetch = async (url, options = {}) => {
  const parsed = new URL(url);
  assert.equal(parsed.origin, "https://api.github.com");
  assert.equal(options.redirect, "error");
  const method = options.method ?? "GET";
  const credential = options.headers.Authorization === "Bearer " + fixture.readToken
    ? "read" : options.headers.Authorization === "Bearer " + fixture.writeToken
      ? "promotion" : "unexpected";
  const path = parsed.pathname + parsed.search;
  const body = options.body ? JSON.parse(options.body) : undefined;
  appendFileSync(process.env.PR_MERGE_CLI_REQUESTS,
    JSON.stringify({ method, path, credential, ...(body ? { body } : {}) }) + "\n",
    { mode: 0o600 });
  assert.equal(credential, method === "GET" || path === "/graphql" ? "read" : "promotion");
  if (path === "/graphql") {
    assert.equal(method, "POST");
    assert.equal(body.query, fixture.pushQuery);
    assert.match(body.query, /^query\(/);
    assert.deepEqual(body.variables, {id: "CS_1000"});
  }
  const response = fixture.routes.find((item) => item.method === method && item.path === path);
  assert.ok(response, "Unexpected mock request");
  if (response.throw) throw new Error(response.throw);
  const data = nativeMerged && Object.hasOwn(response, "afterMerge") ? response.afterMerge : response.data;
  if (method === "PUT" && path.endsWith("/merge") && response.data?.merged === true) nativeMerged = true;
  const status = response.status ?? 200;
  return new Response(status === 204 ? null : (response.raw ?? JSON.stringify(data)), {
    status, headers: { "Content-Type": "application/json" },
  });
};
`;

function runCli(
  routes,
  {
    apply = false,
    args = [],
    forbidPromotionEnv = false,
    env: changes = {},
  } = {},
) {
  const directory = mkdtempSync(join(tmpdir(), "luminovia-pr-merge-cli-"));
  chmodSync(directory, 0o700);
  const preloadPath = join(directory, "trusted-preload.mjs");
  const fixturePath = join(directory, "fixture.json");
  const requestsPath = join(directory, "requests.jsonl");
  try {
    writeFileSync(preloadPath, preload, { mode: 0o600 });
    writeFileSync(
      fixturePath,
      JSON.stringify({
        routes,
        readToken,
        writeToken,
        pushQuery,
        forbidPromotionEnv,
      }),
      { mode: 0o600 },
    );
    writeFileSync(requestsPath, "", { mode: 0o600, flag: "wx" });
    // Do not inherit real credentials, NODE_OPTIONS or unrelated environment
    // state. The child receives only these explicitly fictional credentials.
    const env = {
      PATH: process.env.PATH,
      GITHUB_REPOSITORY: repository,
      GH_TOKEN: readToken,
      PROMOTION_TOKEN: writeToken,
      PR_MERGE_CLI_FIXTURE: fixturePath,
      PR_MERGE_CLI_REQUESTS: requestsPath,
      ...changes,
    };
    for (const key of Object.keys(env))
      if (env[key] === undefined) delete env[key];
    const child = spawnSync(
      process.execPath,
      [
        "--import",
        preloadPath,
        "scripts/pr-auto-merge.mjs",
        ...(apply ? ["--apply"] : []),
        ...args,
      ],
      {
        cwd: new URL("..", import.meta.url),
        env,
        encoding: "utf8",
        timeout: 8000,
        maxBuffer: 64 * 1024,
      },
    );
    assert.ifError(child.error);
    assert.equal(
      child.signal,
      null,
      "The actual CLI must exit within its fixture timeout.",
    );
    const calls = readFileSync(requestsPath, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    assert.doesNotMatch(
      child.stdout + child.stderr,
      new RegExp(`${readToken}|${writeToken}|${privateError}`),
    );
    return {
      status: child.status,
      stdout: child.stdout,
      stderr: child.stderr,
      calls,
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
function mainRun(workflow) {
  return {
    id: 100,
    head_sha: head,
    head_branch: "main",
    repository: { full_name: repository },
    path: `.github/workflows/${workflow}`,
    event: "workflow_dispatch",
    status: "queued",
  };
}
function mainRoutes({ ci = [], security = [] } = {}) {
  return [
    route(`${prefix}/git/ref/heads/main`, { object: { sha: head } }),
    route(mainRunsPath("ci.yml"), { workflow_runs: ci }),
    route(mainRunsPath("security.yml"), { workflow_runs: security }),
    route(`${prefix}/actions/workflows/ci.yml/dispatches`, null, {
      method: "POST",
      status: 204,
    }),
    route(`${prefix}/actions/workflows/security.yml/dispatches`, null, {
      method: "POST",
      status: 204,
    }),
    route(listPath, []),
  ];
}

/** Complete fictional native-merge journey for the actual CLI process. The
 * response table is input data; the trusted preload observes state changes. */
function readyRoutes() {
  const source = "a".repeat(40);
  const tested = "c".repeat(40);
  const committed = "d".repeat(40);
  const tree = "e".repeat(40);
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
  const suiteIds = {
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
  const pr = {
    number: 31,
    state: "open",
    draft: false,
    mergeable: true,
    mergeable_state: "clean",
    base: { sha: head, ref: "main", repo: { full_name: repository } },
    head: { sha: source },
    merge_commit_sha: tested,
    user: { id: 1, type: "User", login: "admin-author" },
    labels: ["type:tests", "risk:high", "area:github"].map((name) => ({
      name,
    })),
  };
  const checks = [...names, "Isolated browser acceptance"].map(
    (name, index) => ({
      id: index + 1,
      name,
      status: "completed",
      conclusion: "success",
      head_sha: source,
      app: { id: name === "CodeQL" ? 57789 : 15368 },
      check_suite: { id: suiteIds[workflowFor(name)] },
      started_at: "2026-11-16T04:00:00Z",
    }),
  );
  const rules = [
    { type: "deletion" },
    { type: "non_fast_forward" },
    { type: "required_signatures" },
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
        allowed_merge_methods: ["merge"],
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
  const gitCommit = (sha) => ({
    sha,
    tree: { sha: tree },
    parents: [{ sha: head }, { sha: source }],
    verification: { verified: true, reason: "valid" },
  });
  return [
    route(listPath, [pr]),
    route(prefix + "/pulls/31", pr, {
      afterMerge: { ...pr, merged: true, merge_commit_sha: committed },
    }),
    route(prefix + "/rules/branches/main", rules),
    route(
      prefix + "/git/ref/heads/main",
      { object: { sha: head } },
      { afterMerge: { object: { sha: committed } } },
    ),
    route(prefix + "/git/commits/" + tested, gitCommit(tested)),
    route(prefix + "/git/commits/" + committed, gitCommit(committed)),
    route(
      prefix +
        "/commits/" +
        source +
        "/check-runs?filter=all&per_page=100&page=1",
      { check_runs: checks },
    ),
    route(prefix + "/commits/" + source + "/status", {
      total_count: 0,
      statuses: [],
      state: "pending",
    }),
    ...Object.keys(suiteIds).map((workflow) =>
      route(
        prefix +
          "/actions/workflows/" +
          workflow +
          "/runs?event=pull_request&head_sha=" +
          source +
          "&per_page=100&page=1",
        {
          workflow_runs: [
            {
              id: 100,
              run_attempt: 1,
              path: ".github/workflows/" + workflow,
              check_suite_id: suiteIds[workflow],
              check_suite_node_id: "CS_" + suiteIds[workflow],
              event: "pull_request",
              head_sha: source,
              status: "completed",
              conclusion: "success",
              repository: { full_name: repository },
              actor: pr.user,
              triggering_actor: pr.user,
              pull_requests: [
                {
                  number: 31,
                  head: { sha: source },
                  base: { ref: "main", sha: head },
                },
              ],
            },
          ],
        },
      ),
    ),
    route(prefix + "/actions/runs/100/jobs?filter=all&per_page=100&page=1", {
      total_count: 3,
      jobs: [
        ["verify", "Complete isolated local verification"],
        [
          "Actual isolated selfhost image compatibility",
          "Complete isolated native selfhost verification",
        ],
        [
          "Isolated browser acceptance",
          "Complete isolated desktop, mobile and built-PWA acceptance",
        ],
      ].map(([name, step], index) => ({
        id: 7001 + index,
        run_id: 100,
        run_url: `https://api.github.com${prefix}/actions/runs/100`,
        run_attempt: 1,
        head_sha: source,
        name,
        check_run_url: `https://api.github.com${prefix}/check-runs/${checks.find((check) => check.name === name).id}`,
        status: "completed",
        conclusion: "success",
        steps: [
          { name: step, number: 7, status: "completed", conclusion: "success" },
        ],
      })),
    }),
    route(
      prefix +
        "/code-scanning/analyses?ref=refs%2Fpull%2F31%2Fmerge&per_page=100&page=1",
      ["javascript-typescript", "python", "actions"].map((language, index) => ({
        id: 300 + index,
        category: "/language:" + language,
        analysis_key: ".github/workflows/security.yml:codeql",
        commit_sha: tested,
        error: "",
        results_count: 0,
      })),
    ),
    route(
      "/graphql",
      {
        data: {
          node: {
            __typename: "CheckSuite",
            id: "CS_1000",
            databaseId: 1000,
            commit: { oid: source, repository: { nameWithOwner: repository } },
            push: {
              nextSha: source,
              previousSha: head,
              repository: { nameWithOwner: repository },
              pusher: {
                __typename: "User",
                login: "source-writer",
                databaseId: 20,
              },
            },
          },
        },
      },
      { method: "POST" },
    ),
    route(prefix + "/pulls/31/reviews?per_page=100&page=1", [
      {
        id: 1,
        state: "APPROVED",
        commit_id: source,
        user: { id: 99, login: "reviewer", type: "User" },
      },
    ]),
    route(prefix + "/collaborators/source-writer/permission", {
      permission: "write",
      role_name: "write",
      user: { id: 20, login: "source-writer", type: "User" },
    }),
    route(prefix + "/collaborators/reviewer/permission", {
      permission: "write",
      role_name: "write",
      user: { id: 99, login: "reviewer", type: "User" },
    }),
    route(prefix + "/pulls?state=open&base=main&per_page=100&page=1", [pr]),
    route(
      prefix + "/pulls/31/merge",
      { merged: true, sha: committed },
      { method: "PUT" },
    ),
    ...["ci.yml", "security.yml"].flatMap((workflow) => [
      route(mainRunsPath(workflow), { workflow_runs: [mainRun(workflow)] }),
      route(
        prefix +
          "/actions/workflows/" +
          workflow +
          "/runs?branch=main&head_sha=" +
          committed +
          "&per_page=100&page=1",
        { workflow_runs: [] },
      ),
      route(prefix + "/actions/workflows/" + workflow + "/dispatches", null, {
        method: "POST",
        status: 204,
      }),
    ]),
  ];
}

function botReadyRoutes(login = "dependabot") {
  const routes = readyRoutes();
  routes.find((item) => item.path === "/graphql").data.data.node.push.pusher = {
    __typename: "Bot",
    login,
    databaseId: 49699333,
  };
  const permission = routes.find(
    (item) => item.path === prefix + "/collaborators/source-writer/permission",
  );
  permission.path = prefix + "/collaborators/dependabot%5Bbot%5D/permission";
  permission.data = {
    permission: "none",
    user: { id: 49699333, login: "dependabot[bot]", type: "Bot" },
  };
  return routes;
}

/** Narrow network fixture for the probe: no inventory, writer or dispatch routes
 * exist. The current run is still executing and GITHUB_SHA need not be its head. */
function probeRoutes({
  bot = false,
  nullPush = false,
  event = "pull_request",
} = {}) {
  const ready = bot ? botReadyRoutes() : readyRoutes();
  const graphql = ready.find((item) => item.path === "/graphql");
  if (nullPush) graphql.data.data.node.push = null;
  return [
    route(`${prefix}/actions/runs/100`, {
      id: 100,
      head_sha: "a".repeat(40),
      repository: { full_name: repository },
      path: ".github/workflows/ci.yml",
      event,
      check_suite_id: 1000,
      check_suite_node_id: "CS_1000",
      status: "in_progress",
      conclusion: null,
    }),
    graphql,
    ...ready.filter((item) => item.path.includes("/collaborators/")),
  ];
}

test("actual probe CLI checks User, real bare Bot and null push with no writer access or PR inventory", () => {
  for (const options of [
    {},
    { bot: true, event: "push" },
    { nullPush: true, event: "workflow_dispatch" },
  ]) {
    const result = runCli(probeRoutes(options), {
      args: ["--probe-source", "100"],
      forbidPromotionEnv: true,
      env: { PROMOTION_TOKEN: undefined, GITHUB_SHA: "f".repeat(40) },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), {
      sourceProof: true,
      runId: 100,
      suiteId: 1000,
      head: "a".repeat(40),
      pusherKnown: !options.nullPush,
      ...(!options.nullPush ? { pusherId: options.bot ? 49699333 : 20 } : {}),
    });
    assert.equal(result.calls.length, options.nullPush ? 2 : 3);
    assert.ok(result.calls.every((call) => call.credential === "read"));
    assert.ok(
      result.calls.every(
        (call) => call.method === "GET" || call.path === "/graphql",
      ),
    );
  }
});

test("actual probe CLI fails closed on GraphQL, canonical identity and HTTP failures without private output", () => {
  for (const mutate of [
    (routes) => {
      routes[1].data = { errors: [{ message: privateError }] };
    },
    (routes) => {
      routes[2].data.user.id = 900;
    },
    (routes) => {
      routes[2].data.user.login = "recycled-login";
    },
    (routes) => {
      routes[2].data.user.type = "Bot";
    },
    (routes) => {
      delete routes[2].data.user.login;
    },
    (routes) => {
      routes[1].status = 403;
      routes[1].raw = privateError;
    },
  ]) {
    const routes = probeRoutes();
    mutate(routes);
    const result = runCli(routes, {
      args: ["--probe-source", "100"],
      forbidPromotionEnv: true,
    });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.ok(result.calls.length >= 2);
    assert.ok(result.calls.every((call) => call.credential === "read"));
    assert.ok(
      result.calls.every(
        (call) => call.method === "GET" || call.path === "/graphql",
      ),
    );
  }
});

test("actual probe CLI rejects invalid IDs, missing reader and mixed or unknown arguments before requests", () => {
  for (const args of [
    ["--probe-source"],
    ...[
      "0",
      "00",
      "-1",
      "1.5",
      "100/merge",
      "100?x=1",
      "9007199254740992",
      "1\n",
    ].map((id) => ["--probe-source", id]),
    ["--probe-source", "100", "--apply"],
    ["--apply", "--probe-source", "100"],
    ["--probe-source", "100", "--unknown"],
    ["--unknown"],
    ["--apply", "--apply"],
  ]) {
    const result = runCli([], { args, forbidPromotionEnv: true });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.deepEqual(result.calls, []);
  }
  for (const env of [
    { GH_TOKEN: undefined },
    { GH_TOKEN: "" },
    { GITHUB_REPOSITORY: "foreign/project" },
  ]) {
    const result = runCli([], {
      args: ["--probe-source", "100"],
      forbidPromotionEnv: true,
      env,
    });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.deepEqual(result.calls, []);
  }
});

test("actual default CLI is read-only on an empty PR list without an App credential", () => {
  const result = runCli([route(listPath, [])], {
    env: { PROMOTION_TOKEN: undefined },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
  assert.deepEqual(result.calls, [
    { method: "GET", path: listPath, credential: "read" },
  ]);
});

test("the actual ready CLI binds fixed GraphQL reads to the reader and only native merge/dispatches to the writer", () => {
  for (const apply of [false, true]) {
    const result = runCli(readyRoutes(), {
      apply,
      ...(apply ? {} : { env: { PROMOTION_TOKEN: undefined } }),
    });
    assert.equal(
      result.status,
      0,
      result.stderr + JSON.stringify(result.calls),
    );
    const observed = JSON.parse(result.stdout);
    assert.equal(observed.eligible, true);
    assert.equal(observed.nativeMerged, apply ? true : undefined);
    const graph = result.calls.filter((call) => call.path === "/graphql");
    assert.equal(graph.length, apply ? 2 : 1);
    assert.ok(
      graph.every(
        (call) => call.credential === "read" && call.method === "POST",
      ),
    );
    const writes = result.calls.filter(
      (call) => call.credential === "promotion",
    );
    assert.equal(writes.length, apply ? 3 : 0);
    if (apply) {
      assert.deepEqual(writes[0], {
        method: "PUT",
        path: prefix + "/pulls/31/merge",
        credential: "promotion",
        body: { sha: "a".repeat(40), merge_method: "merge" },
      });
      assert.equal(observed.testedMerge, "c".repeat(40));
      assert.equal(observed.commit, "d".repeat(40));
      assert.equal(observed.signatureVerified, true);
      assert.equal(observed.merged, true);
    }
    assert.ok(result.calls.every((call) => call.method !== "PATCH"));
  }
});

test("actual CLI refuses green acceptance checks whose mandatory application or native step was skipped", () => {
  for (const index of [0, 1, 2]) {
    const routes = readyRoutes();
    const jobs = routes.find((item) => item.path.includes("/jobs?filter=all"))
      .data.jobs;
    jobs[index].steps[0].conclusion = "skipped";
    const result = runCli(routes, { apply: true });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      number: 31,
      eligible: false,
      reason: "acceptance-steps",
    });
    assert.ok(
      result.calls.some((call) =>
        call.path.endsWith("/jobs?filter=all&per_page=100&page=1"),
      ),
    );
    assert.ok(result.calls.every((call) => call.credential === "read"));
  }
});

test("actual CLI preserves the legacy successful native step from a retained earlier run attempt", () => {
  const routes = readyRoutes();
  routes.find((item) =>
    item.path.includes("/workflows/ci.yml/runs?event=pull_request"),
  ).data.workflow_runs[0].run_attempt = 3;
  const jobs = routes.find((item) => item.path.includes("/jobs?filter=all"))
    .data.jobs;
  jobs[1].steps[0].name =
    'Run node deploy/hostinger/maintenance/selfhost-candidate-check.mjs --run --baseline-root "$RUNNER_TEMP/selfhost-baseline" --baseline-commit "$(git rev-parse HEAD^)" --proof-output "$RUNNER_TEMP/postgres-candidate-proof.json"';
  const result = runCli(routes, { apply: true });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).nativeMerged, true);
  assert.ok(
    result.calls
      .filter((call) => call.path.includes("/jobs?"))
      .every((call) => call.credential === "read"),
  );
});

test("actual CLI rejects a foreign-run acceptance job even when its context and step are green", () => {
  const routes = readyRoutes();
  routes.find((item) =>
    item.path.includes("/jobs?filter=all"),
  ).data.jobs[0].run_id = 999;
  const result = runCli(routes, { apply: true });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).reason, "acceptance-job-provenance");
  assert.ok(result.calls.every((call) => call.credential === "read"));
});

test("actual CLI refuses unavailable or malformed Actions job evidence without leaking its response or using the writer", () => {
  for (const response of [
    { status: 403, raw: privateError },
    { raw: "not-json-" + privateError },
    { data: { jobs: null } },
  ]) {
    const routes = readyRoutes();
    Object.assign(
      routes.find((item) => item.path.includes("/jobs?filter=all")),
      response,
    );
    const result = runCli(routes, { apply: true });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.ok(result.calls.every((call) => call.credential === "read"));
  }
});

test("actual CLI refuses incomplete, contradictory or missing Actions job cardinality before using the writer", () => {
  for (const total_count of [undefined, null, "3", -1, 1, 2, 4]) {
    const routes = readyRoutes();
    routes.find((item) =>
      item.path.includes("/jobs?filter=all"),
    ).data.total_count = total_count;
    const result = runCli(routes, { apply: true });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.ok(result.calls.every((call) => call.credential === "read"));
  }
});

test("actual CLI GraphQL errors fail closed without printing private response context or attempting a merge", () => {
  const routes = readyRoutes();
  routes.find((item) => item.path === "/graphql").data = {
    errors: [{ message: privateError }],
    data: { node: null },
  };
  const result = runCli(routes, { env: { PROMOTION_TOKEN: undefined } });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Invalid or incomplete GitHub response/);
  assert.ok(result.calls.every((call) => call.credential === "read"));
});

test("actual CLI normalizes the real bare GraphQL Bot to a suffixed REST identity using only the reader", () => {
  for (const login of ["dependabot", "dependabot[bot]"]) {
    const result = runCli(botReadyRoutes(login), { apply: true });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).nativeMerged, true);
    assert.ok(
      result.calls.some(
        (call) =>
          call.path ===
            prefix + "/collaborators/dependabot%5Bbot%5D/permission" &&
          call.credential === "read",
      ),
    );
    assert.ok(
      result.calls
        .filter((call) => call.path === "/graphql")
        .every((call) => call.credential === "read"),
    );
    assert.equal(
      result.calls.filter((call) => call.credential === "promotion").length,
      3,
    );
  }
});

test("actual CLI refuses an immutable Bot ID mismatch without any writer credential or mutation", () => {
  const routes = botReadyRoutes();
  routes.find(
    (item) =>
      item.path === prefix + "/collaborators/dependabot%5Bbot%5D/permission",
  ).data.user.id = 49699334;
  const result = runCli(routes, { env: { PROMOTION_TOKEN: undefined } });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Invalid or incomplete GitHub response/);
  assert.ok(result.calls.every((call) => call.credential === "read"));
});

test("actual default CLI reports a draft as ineligible and never reads privileged evidence or mutates", () => {
  const result = runCli(
    [route(listPath, [draft(31)]), route(`${prefix}/pulls/31`, draft(31))],
    { env: { PROMOTION_TOKEN: undefined } },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    number: 31,
    eligible: false,
    reason: "draft-or-closed",
  });
  assert.deepEqual(
    result.calls.map((call) => [call.method, call.credential]),
    [
      ["GET", "read"],
      ["GET", "read"],
    ],
  );
});

test("missing or wrong repository and missing required CLI credentials fail before any request", () => {
  for (const options of [
    { env: { GITHUB_REPOSITORY: undefined } },
    { env: { GITHUB_REPOSITORY: "other/project" } },
    { env: { GH_TOKEN: undefined } },
    { apply: true, env: { PROMOTION_TOKEN: undefined } },
  ]) {
    const result = runCli([], options);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Automatic merge inspection failed/);
    assert.deepEqual(result.calls, []);
  }
});

test("actual apply CLI independently reconciles missing main workflows using separate credentials", () => {
  const result = runCli(mainRoutes(), { apply: true });
  assert.equal(result.status, 0, result.stderr);
  const writes = result.calls.filter((call) => call.method !== "GET");
  assert.deepEqual(writes, [
    {
      method: "POST",
      path: `${prefix}/actions/workflows/ci.yml/dispatches`,
      credential: "promotion",
      body: { ref: "main", inputs: { expected_commit: head } },
    },
    {
      method: "POST",
      path: `${prefix}/actions/workflows/security.yml/dispatches`,
      credential: "promotion",
      body: { ref: "main" },
    },
  ]);
  assert.ok(
    result.calls
      .filter((call) => call.method === "GET")
      .every((call) => call.credential === "read"),
  );
  assert.equal(result.calls.at(-1).path, listPath);
  assert.equal(
    result.calls.some((call) => call.method === "PATCH"),
    false,
  );
});

test("actual apply CLI never duplicates an existing exact-main workflow dispatch", () => {
  for (const security of [[], [mainRun("security.yml")]]) {
    const result = runCli(mainRoutes({ ci: [mainRun("ci.yml")], security }), {
      apply: true,
    });
    assert.equal(result.status, 0, result.stderr);
    const writes = result.calls.filter((call) => call.method !== "GET");
    assert.deepEqual(
      writes.map((call) => call.path),
      security.length
        ? []
        : [`${prefix}/actions/workflows/security.yml/dispatches`],
    );
  }
});

test("top-level HTTP refusal, malformed JSON and network rejection exit nonzero without response leaks or writes", () => {
  for (const response of [
    route(listPath, { message: privateError }, { status: 403 }),
    route(listPath, null, { raw: privateError }),
    route(listPath, null, { throw: privateError }),
  ]) {
    const result = runCli([response]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Automatic merge inspection failed/);
    assert.equal(result.calls.length, 1);
    assert.equal(result.calls[0].method, "GET");
  }
});

test("a per-PR API refusal is reported as failure while another draft is inspected safely", () => {
  const result = runCli([
    route(listPath, [draft(31), draft(32)]),
    route(`${prefix}/pulls/31`, { message: privateError }, { status: 403 }),
    route(`${prefix}/pulls/32`, draft(32)),
  ]);
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /PR #31: GitHub refused request \(403\); no merge confirmed/,
  );
  assert.deepEqual(JSON.parse(result.stdout), {
    number: 32,
    eligible: false,
    reason: "draft-or-closed",
  });
  assert.ok(
    result.calls.every(
      (call) => call.method === "GET" && call.credential === "read",
    ),
  );
});
