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
function allows(condition, github, inputs = {}) {
  const expression = condition
    .replace(/^\s*\$\{\{/, "")
    .replace(/\}\}\s*$/, "");
  const remaining = expression
    .replace(/'[^']*'/g, "")
    .replace(
      /\b(?:github\.(?:event_name|ref|sha)|inputs\.(?:publish_release|expected_commit))\b/g,
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
      { github, inputs },
      {
        timeout: 100,
        contextCodeGeneration: { strings: false, wasm: false },
      },
    ),
  );
}

test("automatic quality, security and complete application gates remain in place", () => {
  const ci = workflow("ci");
  assert.deepEqual(Object.keys(ci.on).sort(), [
    "pull_request",
    "push",
    "workflow_dispatch",
  ]);
  assert.deepEqual(ci.on.push.branches, ["main"]);
  assert.equal(ci.permissions.contents, "read");
  assert.deepEqual(
    ci.jobs.quality.strategy.matrix.include.map((item) => item.name),
    ["Build", "Typecheck", "Lint", "Formatting", "Code quality"],
  );
  assert.ok(
    ci.jobs.coverage.steps.some((step) => step.run === "npm run test:coverage"),
  );
  assert.deepEqual(ci.jobs.verify.needs, ["quality", "coverage"]);
  assert.equal(ci.jobs.verify.if, undefined);
  assert.ok(ci.jobs.verify.steps.some((step) => step.run === "./portal test"));
  assert.equal(ci.jobs["verify-selfhost"].needs, "verify");
  assert.equal(ci.jobs["verify-selfhost"].if, undefined);
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
