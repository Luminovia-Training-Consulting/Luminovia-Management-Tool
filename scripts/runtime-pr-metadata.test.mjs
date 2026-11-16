import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { validatePullRequestMetadata } from "./pr-metadata.mjs";

const repository = "Luminovia-Training-Consulting/Luminovia-Management-Tool";
const catalogue = JSON.parse(
  readFileSync(new URL("../.github/labels.json", import.meta.url), "utf8"),
);
const context = { eventName: "pull_request", repository };
const labels = (names) => names.map((name) => ({ name }));
function event(names = ["type:docs", "area:github", "risk:low"]) {
  return {
    number: 23,
    repository: { full_name: repository },
    pull_request: {
      number: 23,
      base: { repo: { full_name: repository } },
      head: { sha: "a".repeat(40) },
      labels: labels(names),
    },
  };
}

test("PR metadata accepts one type/risk, multiple areas and existing optional labels", () => {
  assert.deepEqual(
    validatePullRequestMetadata(
      event([
        "type:docs",
        "area:github",
        "area:devops",
        "risk:low",
        "help wanted",
      ]),
      catalogue,
      context,
    ),
    {
      number: 23,
      type: "type:docs",
      risk: "risk:low",
      areas: ["area:devops", "area:github"],
    },
  );
});

test("every missing category fails; multiple type or risk labels cannot pass", () => {
  for (const names of [
    ["area:github", "risk:low"],
    ["type:docs", "area:github"],
    ["type:docs", "risk:low"],
    ["type:docs", "type:fix", "area:github", "risk:low"],
    ["type:docs", "area:github", "risk:low", "risk:high"],
  ])
    assert.throws(() =>
      validatePullRequestMetadata(event(names), catalogue, context),
    );
});

test("unknown prefixed labels fail even beside an otherwise valid selection", () => {
  for (const name of ["type:typo", "risk:negligible", "area:unknown"])
    assert.throws(
      () =>
        validatePullRequestMetadata(
          event(["type:docs", "area:github", "risk:low", name]),
          catalogue,
          context,
        ),
      /catalogue/,
    );
});

test("current REST labels are authoritative and a changed head rejects stale events", () => {
  const snapshot = event();
  const live = structuredClone(snapshot.pull_request);
  live.labels = labels(["type:fix", "area:auth", "risk:high"]);
  assert.equal(
    validatePullRequestMetadata(snapshot, catalogue, {
      ...context,
      livePullRequest: live,
    }).type,
    "type:fix",
  );
  live.labels = labels(["type:fix", "area:auth"]);
  assert.throws(() =>
    validatePullRequestMetadata(snapshot, catalogue, {
      ...context,
      livePullRequest: live,
    }),
  );
  live.labels.push({ name: "risk:high" });
  live.head.sha = "b".repeat(40);
  assert.throws(
    () =>
      validatePullRequestMetadata(snapshot, catalogue, {
        ...context,
        livePullRequest: live,
      }),
    /has changed/,
  );
});

test("foreign, malformed and non-PR event identities fail before any remote operation", () => {
  for (const mutate of [
    (value) => {
      value.number = "23";
    },
    (value) => {
      value.number = -1;
    },
    (value) => {
      value.pull_request.number = 24;
    },
    (value) => {
      value.repository.full_name = "other/project";
    },
    (value) => {
      value.pull_request.base.repo.full_name = "other/project";
    },
    (value) => {
      value.pull_request.head.sha = "not-a-commit";
    },
    (value) => {
      delete value.pull_request;
    },
    (value) => {
      value.pull_request.labels = null;
    },
    (value) => {
      value.pull_request.labels.push({});
    },
  ]) {
    const payload = event();
    mutate(payload);
    assert.throws(() =>
      validatePullRequestMetadata(payload, catalogue, context),
    );
  }
  for (const eventName of [
    "push",
    "pull_request_target",
    "workflow_dispatch",
    undefined,
  ])
    assert.throws(() =>
      validatePullRequestMetadata(event(), catalogue, {
        ...context,
        eventName,
      }),
    );
  assert.throws(() =>
    validatePullRequestMetadata(event(), catalogue, {
      ...context,
      repository: "other/project",
    }),
  );
});

test("malformed or ambiguous catalogue/label arrays fail closed", () => {
  for (const invalid of [null, [], [{}], [...catalogue, catalogue[0]]])
    assert.throws(() => validatePullRequestMetadata(event(), invalid, context));
  for (const invalid of [
    ["type:docs"],
    [{ name: "type:docs" }, { name: "type:docs" }],
  ]) {
    const payload = event();
    payload.pull_request.labels = invalid;
    assert.throws(() =>
      validatePullRequestMetadata(payload, catalogue, context),
    );
  }
});

test("actual CLI treats hostile optional labels as data, never shell commands or output", () => {
  const directory = mkdtempSync(join(tmpdir(), "luminovia-pr-metadata-"));
  try {
    const marker = join(directory, "should-not-exist");
    const payload = event([
      "type:docs",
      "area:github",
      "risk:low",
      `$(touch ${marker})`,
    ]);
    payload.pull_request.title = `$(touch ${marker})`;
    payload.pull_request.body = `\u001b[31msecret-shaped data $(touch ${marker})`;
    const path = join(directory, "event.json");
    writeFileSync(path, JSON.stringify(payload));
    const env = {
      ...process.env,
      GITHUB_EVENT_PATH: path,
      GITHUB_EVENT_NAME: "pull_request",
      GITHUB_REPOSITORY: repository,
      GITHUB_ACTIONS: "false",
    };
    delete env.GH_TOKEN;
    delete env.GITHUB_TOKEN;
    const result = spawnSync(process.execPath, ["scripts/pr-metadata.mjs"], {
      cwd: new URL("..", import.meta.url),
      env,
      encoding: "utf8",
      timeout: 5000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /PR #23: type:docs, risk:low, area:github/);
    assert.doesNotMatch(result.stdout + result.stderr, /touch|secret-shaped/);
    assert.equal((result.stdout + result.stderr).includes("\u001b"), false);
    assert.equal(existsSync(marker), false);
    payload.pull_request.labels = labels(["type:docs", "area:github"]);
    writeFileSync(path, JSON.stringify(payload));
    assert.equal(
      spawnSync(process.execPath, ["scripts/pr-metadata.mjs"], {
        cwd: new URL("..", import.meta.url),
        env,
        encoding: "utf8",
        timeout: 5000,
      }).status,
      1,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("runtime discovery includes the PR gate and it needs no package installation", () => {
  const source = readFileSync(
    new URL("../.github/workflows/pr-metadata.yml", import.meta.url),
    "utf8",
  );
  assert.match(source, /name: PR metadata/);
  assert.match(source, /pull_request:/);
  assert.doesNotMatch(
    source,
    /pull_request_target:|npm |contents: write|pull-requests: write/,
  );
  execFileSync(process.execPath, ["--check", "scripts/pr-metadata.mjs"], {
    cwd: new URL("..", import.meta.url),
    stdio: "pipe",
  });
});
