/**
 * Automatic/manual metadata validation and actual CLI execution with fictional inputs.
 * HTTP is replaced in the manual CLI fixture; workflow checks inspect source text.
 * Hostile label text must remain data; stale automatic events and foreign identities fail.
 */
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
/** Converts fixture label names into GitHub's actual label-object format. */
const labels = (names) => names.map((name) => ({ name }));
/** Creates a controlled PR event with exact target-repository and commit identity. */
function event(names = ["type:docs", "area:github", "risk:low"]) {
  return {
    number: 23,
    repository: { full_name: repository },
    pull_request: {
      number: 23,
      base: { ref: "main", repo: { full_name: repository } },
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
      headSha: "a".repeat(40),
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

test("a review hold blocks the required metadata check even with otherwise valid labels", () => {
  const held = event(["type:docs", "area:github", "risk:low", "merge:hold"]);
  assert.throws(
    () => validatePullRequestMetadata(held, catalogue, context),
    /paused by merge:hold/,
  );
  held.pull_request.labels = labels(["type:docs", "area:github", "risk:low"]);
  assert.equal(
    validatePullRequestMetadata(held, catalogue, context).type,
    "type:docs",
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

// Reproduce the historical-catalogue failure: current labels pass, while the
// same selection fails when those catalogue entries are deliberately removed.
test("the current catalogue accepts the five areas missing from historical snapshots", () => {
  const areas = [
    "area:api",
    "area:security",
    "area:performance",
    "area:accessibility",
    "area:design",
  ];
  const snapshot = event(["type:fix", "risk:high", ...areas]);
  assert.deepEqual(
    validatePullRequestMetadata(snapshot, catalogue, context).areas,
    areas.sort(),
  );
  const obsolete = catalogue.filter((label) => !areas.includes(label.name));
  assert.throws(
    () => validatePullRequestMetadata(snapshot, obsolete, context),
    /catalogue/,
  );
});

// Manual checks constrain the workflow ref rather than the selected PR's state
// or target branch. Current API metadata must still match the requested number.
test("manual main checks validate current labels on a closed temporary-base PR", () => {
  const payload = {
    repository: { full_name: repository },
    inputs: { pull_request_number: "23" },
  };
  const live = event(["type:tests", "area:testing", "risk:low"]).pull_request;
  live.state = "closed";
  live.base.ref = "codex/owned-temporary-fixture";
  const manual = {
    ...context,
    eventName: "workflow_dispatch",
    ref: "refs/heads/main",
    livePullRequest: live,
  };
  assert.equal(
    validatePullRequestMetadata(payload, catalogue, manual).number,
    23,
  );
  for (const value of [
    "0",
    "-1",
    "1.5",
    " 23",
    "23 ",
    "023",
    "23/labels",
    "9007199254740992",
    23,
  ])
    assert.throws(() =>
      validatePullRequestMetadata(
        { ...payload, inputs: { pull_request_number: value } },
        catalogue,
        manual,
      ),
    );
  for (const ref of [undefined, "refs/heads/contributor", "refs/tags/main"])
    assert.throws(() =>
      validatePullRequestMetadata(payload, catalogue, { ...manual, ref }),
    );
  assert.throws(() =>
    validatePullRequestMetadata(payload, catalogue, {
      ...manual,
      livePullRequest: undefined,
    }),
  );
  assert.throws(() =>
    validatePullRequestMetadata(payload, catalogue, {
      ...manual,
      livePullRequest: { ...live, number: 24 },
    }),
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
      value.pull_request.base.ref = "contributor-branch";
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
  for (const eventName of ["push", "pull_request_target", undefined])
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

// Run the real CLI with a preload that records fetches and supplies fictional
// responses. This proves URL/input handling without contacting GitHub or using secrets.
test("manual CLI only fetches the canonical PR and rejects invalid inputs before fetching", () => {
  const directory = mkdtempSync(join(tmpdir(), "luminovia-pr-metadata-api-"));
  try {
    const eventPath = join(directory, "event.json");
    const responsePath = join(directory, "response.json");
    const requestPath = join(directory, "request.txt");
    const mockPath = join(directory, "fetch.mjs");
    const payload = {
      repository: { full_name: repository, url: "https://hostile.invalid" },
      inputs: { pull_request_number: "23" },
    };
    writeFileSync(eventPath, JSON.stringify(payload));
    writeFileSync(responsePath, JSON.stringify(event().pull_request));
    writeFileSync(
      mockPath,
      `import { readFileSync, writeFileSync } from "node:fs";
      globalThis.fetch = async (url, options) => {
        if (options.headers.Authorization !== "Bearer fictional-read-token")
          throw new Error("Unexpected fixture token");
        writeFileSync(process.env.METADATA_REQUEST_PATH, url);
        return { ok: true, json: async () => JSON.parse(readFileSync(process.env.METADATA_RESPONSE_PATH, "utf8")) };
      };`,
    );
    const env = {
      ...process.env,
      GH_TOKEN: "fictional-read-token",
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_EVENT_NAME: "workflow_dispatch",
      GITHUB_REPOSITORY: repository,
      GITHUB_REF: "refs/heads/main",
      GITHUB_ACTIONS: "true",
      METADATA_REQUEST_PATH: requestPath,
      METADATA_RESPONSE_PATH: responsePath,
    };
    delete env.GITHUB_TOKEN;
    const run = () =>
      spawnSync(
        process.execPath,
        ["--import", mockPath, "scripts/pr-metadata.mjs"],
        {
          cwd: new URL("..", import.meta.url),
          env,
          encoding: "utf8",
          timeout: 5000,
        },
      );
    const valid = run();
    assert.equal(valid.status, 0, valid.stderr);
    assert.equal(
      readFileSync(requestPath, "utf8"),
      `https://api.github.com/repos/${repository}/pulls/23`,
    );
    assert.match(valid.stdout, new RegExp(`Head ${"a".repeat(40)}`));
    assert.doesNotMatch(
      valid.stdout + valid.stderr,
      /fictional-read-token|hostile/,
    );
    const wrong = event().pull_request;
    wrong.number = 24;
    writeFileSync(responsePath, JSON.stringify(wrong));
    assert.equal(run().status, 1);
    // Remove the successful request marker so an invalid input must leave no
    // evidence of a later fetch, rather than reusing the earlier recorded URL.
    rmSync(requestPath);
    payload.inputs.pull_request_number = "23/../../secrets";
    writeFileSync(eventPath, JSON.stringify(payload));
    assert.equal(run().status, 1);
    assert.equal(existsSync(requestPath), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

// Inspect the checked-in workflow contract: fixed main checkout, restricted
// permissions and manual dispatch. This is not a hosted Actions execution test.
test("metadata workflow only executes trusted base code with read-only permissions", () => {
  const source = readFileSync(
    new URL("../.github/workflows/pr-metadata.yml", import.meta.url),
    "utf8",
  );
  assert.match(source, /name: PR metadata/);
  assert.match(source, /pull_request:\s+branches: \[main\]/);
  assert.match(source, /ref: refs\/heads\/main/);
  assert.match(
    source,
    /repository: Luminovia-Training-Consulting\/Luminovia-Management-Tool/,
  );
  assert.match(source, /workflow_dispatch:/);
  assert.match(source, /github\.event\.pull_request\.state == 'open'/);
  assert.match(source, /github\.ref == 'refs\/heads\/main'/);
  assert.match(source, /group:.*inputs\.pull_request_number/);
  assert.doesNotMatch(
    source,
    /pull_request_target:|npm |contents: write|pull-requests: write|secrets\.|pull_request\.head/,
  );
  execFileSync(process.execPath, ["--check", "scripts/pr-metadata.mjs"], {
    cwd: new URL("..", import.meta.url),
    stdio: "pipe",
  });
});
