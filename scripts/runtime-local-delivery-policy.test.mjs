/**
 * Checks the real workflow boundary between automatic acceptance and deliberately
 * requested delivery. All fixtures are local: no GitHub, Docker or hosted writes.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { parsers } from "prettier/plugins/yaml";

/** Decode the pinned formatter's YAML AST without interpreting tags or aliases.
 * Keeping plain scalar strings also preserves the Actions key `on` exactly.
 */
function yamlValue(node) {
  if (!node) return null;
  if ("value" in node) return node.value;
  if (["mapping", "flowMapping"].includes(node.type)) {
    const entries = node.children.map((item) => {
      assert.equal(item.type, "mappingItem");
      return [yamlValue(item.children[0]), yamlValue(item.children[1])];
    });
    assert.equal(new Set(entries.map(([key]) => key)).size, entries.length);
    return Object.fromEntries(entries);
  }
  if (["sequence", "flowSequence"].includes(node.type))
    return node.children.map(yamlValue);
  if (node.type === "document")
    return yamlValue(
      node.children.find((child) => child.type === "documentBody"),
    );
  if (node.type === "root") {
    assert.equal(
      node.children.length,
      1,
      "One Actions YAML document is required.",
    );
    return yamlValue(node.children[0]);
  }
  assert.ok(
    [
      "documentBody",
      "mappingKey",
      "mappingValue",
      "sequenceItem",
      "flowSequenceItem",
    ].includes(node.type),
    `Unsupported YAML structure must be reviewed: ${node.type}`,
  );
  assert.ok(node.children.length <= 1);
  return yamlValue(node.children[0]);
}

/** Parse maintained workflows with the already-pinned Prettier YAML parser. */
function workflow(name) {
  return yamlValue(
    parsers.yaml.parse(
      readFileSync(
        new URL(`../.github/workflows/${name}.yml`, import.meta.url),
        "utf8",
      ),
    ),
  );
}

/** Exercise the maintained Actions condition, restricted to its primitive gate
 * variables and boolean operators rather than executing arbitrary source text.
 */
function allows(condition, github, inputs = {}, needs = {}) {
  const expression = condition
    .replace(/^\s*\$\{\{/, "")
    .replace(/\}\}\s*$/, "");
  const remaining = expression
    .replace(/'[^']*'/g, "")
    .replace(
      /\b(?:github\.(?:event_name|ref|sha)|inputs\.(?:publish_release|expected_commit)|needs\.scope\.outputs\.profile)\b/g,
      "",
    )
    .replace(/\b(?:true|false)\b/g, "")
    .replace(/\s|&&|\|\||[()=!]/g, "");
  assert.equal(
    remaining,
    "",
    "Review any newly introduced gate expression syntax.",
  );
  return Boolean(
    runInNewContext(
      expression,
      { github, inputs, needs },
      {
        timeout: 100,
        contextCodeGeneration: { strings: false, wasm: false },
      },
    ),
  );
}

test("Draft checks are bounded while ready events and main/manual retain complete acceptance", () => {
  const ci = workflow("ci");
  assert.deepEqual(Object.keys(ci.on).sort(), [
    "pull_request",
    "push",
    "workflow_dispatch",
  ]);
  assert.deepEqual(ci.on.push.branches, ["main"]);
  for (const action of [
    "opened",
    "synchronize",
    "reopened",
    "ready_for_review",
  ])
    assert.ok(ci.on.pull_request.types.includes(action));
  assert.equal(ci.permissions.contents, "read");
  assert.deepEqual(
    ci.jobs.quality.strategy.matrix.include.map((item) => item.name),
    ["Build", "Typecheck", "Lint", "Formatting", "Code quality"],
  );
  assert.ok(
    ci.jobs.coverage.steps.some((step) => step.run === "npm run test:coverage"),
  );
  assert.equal(ci.jobs.scope.steps[0].with["fetch-depth"], "2");
  assert.equal(
    ci.jobs.scope.outputs.profile,
    "${{ steps.scope.outputs.profile }}",
  );
  assert.equal(ci.jobs.verify.needs, "scope");
  assert.equal(ci.jobs.verify.if, "always() && !cancelled()");
  const application = ci.jobs.verify.steps.find(
    (step) => step.id === "application",
  );
  assert.match(
    application.run,
    /node scripts\/runtime-test\.mjs --phase system/,
  );
  assert.match(application.run, /else\s+\.\/portal test\s+fi/);
  const browserJob = ci.jobs["verify-browser"];
  assert.equal(browserJob.name, "Isolated browser acceptance");
  assert.equal(browserJob.needs, "scope");
  assert.equal(
    browserJob.if,
    "always() && !cancelled() && github.event_name == 'pull_request'",
  );
  const browser = browserJob.steps.find((step) => step.id === "browser");
  assert.equal(
    browser.name,
    "Complete isolated desktop, mobile and built-PWA acceptance",
  );
  assert.equal(browser.run, "node scripts/runtime-test.mjs --phase browser");
  assert.equal(browser.if, "needs.scope.outputs.profile == 'full'");
  const guards = ci.jobs.verify.steps.find(
    (step) => step.run === "node scripts/ci-pr-check.mjs guards",
  );
  const native = ci.jobs["verify-selfhost"].steps.find((step) =>
    step.run?.includes("selfhost-candidate-check.mjs --run"),
  );
  const sql = ci.jobs["verify-selfhost"].steps.find(
    (step) => step.run === "node scripts/ci-pr-check.mjs sql",
  );
  const baseline = ci.jobs["verify-selfhost"].steps.find((step) =>
    step.run?.includes("git archive HEAD^"),
  );
  // Ready/risky PRs/main/manual run both complete suites; proven Draft UI/docs
  // take faster paths. SQL shards still exercise the new runner on a risky PR.
  for (const [event_name, profile] of [
    ["pull_request", "docs"],
    ["pull_request", "standard"],
    ["pull_request", "full"],
    ["push", "full"],
    ["workflow_dispatch", "full"],
  ]) {
    const github = { event_name };
    const needs = { scope: { outputs: { profile } } };
    assert.equal(allows(guards.if, github, {}, needs), profile !== "full");
    assert.equal(
      allows(sql.if, github, {}, needs),
      event_name === "pull_request" && profile !== "docs",
    );
    for (const step of [application, native, baseline])
      assert.equal(allows(step.if, github, {}, needs), profile === "full");
  }
  assert.equal(ci.jobs["verify-selfhost"].needs, "scope");
  for (const job of [ci.jobs.verify, ci.jobs["verify-selfhost"]]) {
    assert.equal(job.if, "always() && !cancelled()");
    const scopeCheck = job.steps[0];
    assert.equal(scopeCheck.env.SCOPE_RESULT, "${{ needs.scope.result }}");
    assert.equal(scopeCheck.env.PROFILE, "${{ needs.scope.outputs.profile }}");
    assert.equal(scopeCheck.env.EVENT_NAME, "${{ github.event_name }}");
    assert.equal(
      scopeCheck.env.PR_DRAFT,
      "${{ github.event.pull_request.draft }}",
    );
    assert.equal(scopeCheck.env.PR_ACTION, "${{ github.event.action }}");
    assert.match(
      scopeCheck.run,
      /if test "\$EVENT_NAME" != pull_request; then test "\$PROFILE" = full; fi/,
    );
    assert.match(scopeCheck.run, /test "\$SCOPE_RESULT" = success/);
    assert.match(
      scopeCheck.run,
      /case "\$PROFILE" in docs\|standard\|full\) ;; \*\) exit 1 ;; esac/,
    );
  }
  assert.equal(
    browserJob.steps[0].env.PR_DRAFT,
    "${{ github.event.pull_request.draft }}",
  );
  assert.equal(browserJob.steps[0].env.PR_ACTION, "${{ github.event.action }}");
  assert.equal(
    ci.jobs["preview-package"].if,
    "always() && github.event_name == 'pull_request'",
  );
  const finalPreflight = ci.jobs["preview-package"].steps[0];
  assert.deepEqual(finalPreflight.env, {
    SCOPE_RESULT: "${{ needs.scope.result }}",
    QUALITY_RESULT: "${{ needs.quality.result }}",
    COVERAGE_RESULT: "${{ needs.coverage.result }}",
    APPLICATION_RESULT: "${{ needs.verify.result }}",
    NATIVE_RESULT: "${{ needs.verify-selfhost.result }}",
    BROWSER_RESULT: "${{ needs.verify-browser.result }}",
  });
  for (const name of Object.keys(finalPreflight.env))
    assert(finalPreflight.run.includes(`test "$${name}" = success`));
  // Both suites must actually pass; skipping a required job is not this design.
  assert.deepEqual(ci.jobs["preview-package"].needs, [
    "quality",
    "coverage",
    "verify",
    "verify-selfhost",
    "verify-browser",
    "scope",
  ]);

  assert.ok(
    ci.jobs["verify-selfhost"].steps.some((step) =>
      step.run?.includes("selfhost-candidate-check.mjs --run"),
    ),
  );
  const security = workflow("security");
  assert.deepEqual(Object.keys(security.on).sort(), [
    "pull_request",
    "push",
    "schedule",
    "workflow_dispatch",
  ]);
  assert.deepEqual(security.on.push.branches, ["main"]);
  assert.ok(security.jobs.codeql);
  assert.ok(security.jobs["dependency-review"]);
});

test("only an explicitly requested exact-main release passes the delivery gate", () => {
  const ci = workflow("ci");
  const release = ci.jobs["release-cms"];
  assert.equal(ci.on.workflow_dispatch.inputs.publish_release.type, "boolean");
  assert.equal(ci.on.workflow_dispatch.inputs.publish_release.default, "false");
  assert.deepEqual(release.needs, [
    "quality",
    "coverage",
    "verify",
    "verify-selfhost",
  ]);
  const sha = "a".repeat(40);
  const github = {
    event_name: "workflow_dispatch",
    ref: "refs/heads/main",
    sha,
  };
  const approved = { publish_release: true, expected_commit: sha };
  assert.equal(allows(release.if, github, approved), true);
  for (const event_name of ["push", "pull_request", "schedule", "workflow_run"])
    assert.equal(
      allows(release.if, { ...github, event_name }, approved),
      false,
      event_name,
    );
  for (const inputs of [
    {},
    { expected_commit: sha },
    { publish_release: false, expected_commit: sha },
    { publish_release: true },
    { publish_release: true, expected_commit: "" },
    { publish_release: true, expected_commit: "b".repeat(40) },
  ])
    assert.equal(
      allows(release.if, github, inputs),
      false,
      JSON.stringify(inputs),
    );
  assert.equal(
    allows(
      release.if,
      { ...github, ref: "refs/heads/feature/example" },
      approved,
    ),
    false,
  );
});

test("release shell preflight independently rejects missing or mismatched revisions", () => {
  const release = workflow("ci").jobs["release-cms"];
  const preflight = release.steps[0];
  assert.equal(preflight.env.EXPECTED_COMMIT, "${{ inputs.expected_commit }}");
  assert.equal(preflight.env.PUBLISH_RELEASE, "${{ inputs.publish_release }}");
  assert.ok(
    preflight.run,
    "Verification precedes checkout, build and publication.",
  );
  const sha = "a".repeat(40);
  const approved = {
    PATH: process.env.PATH,
    GITHUB_SHA: sha,
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/main",
    EXPECTED_COMMIT: sha,
    PUBLISH_RELEASE: "true",
  };
  for (const [overrides, success] of [
    [{}, true],
    [{ EXPECTED_COMMIT: "" }, false],
    [{ EXPECTED_COMMIT: "b".repeat(40) }, false],
    [{ PUBLISH_RELEASE: "false" }, false],
    [{ GITHUB_EVENT_NAME: "push" }, false],
    [{ GITHUB_REF: "refs/heads/feature/example" }, false],
  ]) {
    const result = spawnSync(
      "bash",
      ["-e", "-u", "-o", "pipefail", "-c", preflight.run],
      {
        env: { ...approved, ...overrides },
        encoding: "utf8",
        timeout: 1000,
      },
    );
    assert.ifError(result.error);
    assert.equal(result.status === 0, success, JSON.stringify(overrides));
  }
});

test("PR deployment metadata is manual and runs only trusted main metadata code", () => {
  const preview = workflow("pr-previews");
  assert.deepEqual(Object.keys(preview.on), ["workflow_dispatch"]);
  const inputs = preview.on.workflow_dispatch.inputs;
  assert.equal(inputs.action.type, "choice");
  assert.equal(inputs.action.default, "cleanup");
  assert.deepEqual([...inputs.action.options].sort(), ["cleanup", "publish"]);
  assert.equal(inputs.run_id.type, "string");
  assert.equal(inputs.run_attempt.type, "string");
  assert.deepEqual(preview.permissions, {
    contents: "read",
    actions: "read",
    "pull-requests": "read",
    deployments: "write",
  });
  assert.deepEqual(Object.keys(preview.jobs), ["publish"]);
  const publisher = preview.jobs.publish;
  assert.equal(
    allows(publisher.if, {
      event_name: "workflow_dispatch",
      ref: "refs/heads/main",
    }),
    true,
  );
  assert.equal(
    allows(publisher.if, {
      event_name: "workflow_dispatch",
      ref: "refs/heads/feature/example",
    }),
    false,
  );
  assert.equal(
    allows(publisher.if, {
      event_name: "workflow_run",
      ref: "refs/heads/main",
    }),
    false,
  );
  const actions = publisher.steps.filter((step) => step.uses);
  assert.equal(
    actions.length,
    1,
    "No contribution artifact/cache/dependency execution is allowed.",
  );
  assert.match(actions[0].uses, /^actions\/checkout@[a-f0-9]{40}$/);
  assert.deepEqual(actions[0].with, {
    repository: "${{ github.repository }}",
    ref: "${{ github.event.repository.default_branch }}",
    "persist-credentials": "false",
  });
  const commands = publisher.steps.filter((step) => step.run);
  assert.equal(commands.length, 1);
  assert.equal(commands[0].run, "node scripts/pr-preview-deployments.mjs");
});

// Exercise the maintained shell gate: a fast ready/main/manual classification must
// independently fail even if a future classifier regresses.
test("scope shell preflight rejects fast ready profiles and accepts only explicit Draft fast paths", () => {
  for (const job of [
    workflow("ci").jobs.verify,
    workflow("ci").jobs["verify-selfhost"],
    workflow("ci").jobs["verify-browser"],
  ]) {
    const preflight = job.steps[0].run;
    for (const [event, profile, result, draft, action, allowed] of [
      ["pull_request", "docs", "success", "true", "synchronize", true],
      ["pull_request", "standard", "success", "true", "opened", true],
      ["pull_request", "full", "success", "false", "synchronize", true],
      ["pull_request", "full", "success", "false", "ready_for_review", true],
      ["pull_request", "docs", "success", "false", "synchronize", false],
      ["pull_request", "standard", "success", "false", "synchronize", false],
      ["pull_request", "docs", "success", "true", "ready_for_review", false],
      [
        "pull_request",
        "standard",
        "success",
        "true",
        "ready_for_review",
        false,
      ],
      ["pull_request", "docs", "success", "", "synchronize", false],
      ["pull_request", "standard", "success", "TRUE", "synchronize", false],
      ["push", "full", "success", "", "", true],
      ["workflow_dispatch", "full", "success", "", "", true],
      ["push", "standard", "success", "", "", false],
      ["workflow_dispatch", "docs", "success", "", "", false],
      ["pull_request", "full", "failure", "true", "synchronize", false],
      ["pull_request", "full", "skipped", "true", "synchronize", false],
      ["pull_request", "", "success", "true", "synchronize", false],
      ["pull_request", "unknown", "success", "true", "synchronize", false],
    ]) {
      const execution = spawnSync(
        "bash",
        ["-e", "-u", "-o", "pipefail", "-c", preflight],
        {
          env: {
            PATH: process.env.PATH,
            EVENT_NAME: event,
            PROFILE: profile,
            SCOPE_RESULT: result,
            PR_DRAFT: draft,
            PR_ACTION: action,
          },
          timeout: 1000,
          encoding: "utf8",
        },
      );
      assert.ifError(execution.error);
      assert.equal(
        execution.status === 0,
        job.name === "Isolated browser acceptance" && event !== "pull_request"
          ? false
          : allowed,
        `${event}/${profile}/${result}/${draft}/${action}`,
      );
    }
  }
});

// An unrequired canceled scope must not make every required dependent check
// skipped/successful. The required package job is the fail-closed final gate.
test("preview shell preflight rejects every failed skipped canceled or missing prerequisite", () => {
  const script = workflow("ci").jobs["preview-package"].steps[0].run;
  const results = {
    SCOPE_RESULT: "success",
    QUALITY_RESULT: "success",
    COVERAGE_RESULT: "success",
    APPLICATION_RESULT: "success",
    NATIVE_RESULT: "success",
    BROWSER_RESULT: "success",
  };
  const execute = (overrides) => {
    const result = spawnSync(
      "bash",
      ["-e", "-u", "-o", "pipefail", "-c", script],
      {
        env: { PATH: process.env.PATH, ...results, ...overrides },
        timeout: 1000,
        encoding: "utf8",
      },
    );
    assert.ifError(result.error);
    return result.status === 0;
  };
  assert.equal(execute({}), true);
  for (const name of Object.keys(results))
    for (const status of ["failure", "skipped", "cancelled", ""])
      assert.equal(execute({ [name]: status }), false, `${name}/${status}`);
});

test("browser scope preflight accepts only an exact successful PR profile", () => {
  const preflight = workflow("ci").jobs["verify-browser"].steps[0].run;
  for (const [event, profile, scopeResult, allowed] of [
    ["pull_request", "docs", "success", true],
    ["pull_request", "standard", "success", true],
    ["pull_request", "full", "success", true],
    ["push", "full", "success", false],
    ["workflow_dispatch", "full", "success", false],
    ["pull_request", "full", "failure", false],
    ["pull_request", "full", "skipped", false],
    ["pull_request", "full", "cancelled", false],
    ["pull_request", "", "success", false],
    ["pull_request", "unknown", "success", false],
  ]) {
    const result = spawnSync(
      "bash",
      ["-e", "-u", "-o", "pipefail", "-c", preflight],
      {
        env: {
          PATH: process.env.PATH,
          EVENT_NAME: event,
          PROFILE: profile,
          SCOPE_RESULT: scopeResult,
        },
        timeout: 1000,
        encoding: "utf8",
      },
    );
    assert.ifError(result.error);
    assert.equal(
      result.status === 0,
      allowed,
      `${event}/${profile}/${scopeResult}`,
    );
  }
});
