/** Exercise draft-event provenance, path routing and real Git argv with fictional metadata and no services. */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  classifyChangePaths,
  detectChangeScope,
  writeChangeScope,
} from "./ci-change-scope.mjs";

const head = "a".repeat(40);
const base = "b".repeat(40);
const contribution = "c".repeat(40);
const repository = "Luminovia-Training-Consulting/Luminovia-Management-Tool";

/** Model the canonical runner event as public JSON data, without API requests or actual account records. */
function draftEvent({ draft = true, action = "synchronize" } = {}) {
  const payload = {
    action,
    number: 34,
    repository: { full_name: repository },
    pull_request: {
      number: 34,
      state: "open",
      draft,
      base: { sha: base, ref: "main", repo: { full_name: repository } },
      head: { sha: contribution },
    },
  };
  const reads = [];
  return {
    payload,
    reads,
    options: {
      eventPath: "/fictional/github-event.json",
      expectedRef: "refs/pull/34/merge",
      expectedRepository: repository,
      readEvent: (path) => {
        reads.push(path);
        assert.equal(path, "/fictional/github-event.json");
        return JSON.stringify(payload);
      },
    },
  };
}

test("only known documentation and contribution templates use the docs profile", () => {
  for (const path of [
    "README.md",
    "CONTRIBUTING.md",
    "SECURITY.md",
    "CHANGELOG.md",
    "ROADMAP.md",
    "LICENSE",
    "docs/WORKLOG.md",
    "docs/UNIVERSAL_MASTER_PROMPT.txt",
    "docs/screenshots/fictional-course.png",
    ".github/ISSUE_TEMPLATE/bug_report.yml",
    ".github/ISSUE_TEMPLATE/question.yaml",
    ".github/PULL_REQUEST_TEMPLATE.md",
    ".github/PULL_REQUEST_TEMPLATE/feature.md",
  ])
    assert.equal(classifyChangePaths([path]).profile, "docs", path);
});

test("ordinary frontend and static changes use standard acceptance, including mixed docs", () => {
  for (const path of [
    "src/features/dashboard/dashboard.tsx",
    "src/features/operations/schedule.test.ts",
    "src/features/help/catalog.ts",
    "src/components/ui/button.tsx",
    "src/styles.css",
    "public/brand/logo.svg",
    "public/brand/heading.woff2",
    "public/icons/app.png",
  ])
    assert.equal(
      classifyChangePaths(["docs/WORKLOG.md", path]).profile,
      "standard",
      path,
    );
});

test("backend, private access, shared state, tooling and unknown paths always require full acceptance", () => {
  for (const path of [
    "supabase/migrations/20261116120000_change.sql",
    "supabase/functions/invite/index.ts",
    "deploy/hostinger/supabase/images.lock.json",
    ".github/workflows/ci.yml",
    ".github/rulesets/checks.json",
    "scripts/ci-change-scope.mjs",
    "scripts/runtime-ci-change-scope.test.mjs",
    "scripts/testing/database.mjs",
    "tests/e2e/jobs.spec.ts",
    "data/course-building-blocks.json",
    "src/features/auth/login.tsx",
    "src/features/auth/flows.test.tsx",
    "src/features/files/files.tsx",
    "src/features/chat/messages.tsx",
    "src/lib/queries.ts",
    "src/lib/supabase.ts",
    "src/app/shell.tsx",
    "src/app/app.tsx",
    "src/main.tsx",
    "src/test/setup.ts",
    "src/features/example/query-keys.ts",
    "src/components/identity.ts",
    "package.json",
    "package-lock.json",
    ".node-version",
    "vite.config.ts",
    "tsconfig.json",
    "index.html",
    "AGENTS.md",
    ".github/copilot-instructions.md",
    "public/service-worker.js",
    "public/manifest.webmanifest",
    "docs/execute.mjs",
    "new-directory/unreviewed.ts",
    "src/new-directory/unreviewed.ts",
  ])
    assert.equal(
      classifyChangePaths(["README.md", path]).profile,
      "full",
      path,
    );
});

test("empty, invalid and ambiguous changed paths fail closed", () => {
  for (const paths of [
    undefined,
    [],
    [""],
    [null],
    ["/docs/README.md"],
    ["docs/../package.json"],
    ["docs/./README.md"],
    ["docs//README.md"],
    ["docs\\README.md"],
    ["docs/newline\nprofile=docs.md"],
    ["docs/nul\0name.md"],
  ])
    assert.equal(classifyChangePaths(paths).profile, "full");
});

/** Model only the three read-only Git commands; unexpected arguments fail the fixture. */
function mergeGit({
  checkout = head,
  parents = `${head} ${base} ${contribution}\n`,
  diff = "src/features/help/catalog.ts\0",
  failAt,
} = {}) {
  const calls = [];
  return {
    calls,
    git(args) {
      calls.push(args);
      if (calls.length === failAt) throw new Error("Fictional Git error");
      if (args[0] === "rev-parse") return `${checkout}\n`;
      if (args[0] === "rev-list") return parents;
      assert.deepEqual(args, [
        "diff",
        "--name-only",
        "--no-renames",
        "-z",
        base,
        head,
        "--",
      ]);
      return diff;
    },
  };
}

test("ready UI and documentation PRs require complete acceptance before merging", () => {
  for (const path of ["src/features/operations/courses.tsx", "README.md"]) {
    const fixture = mergeGit({ diff: path + "\0" });
    assert.equal(
      detectChangeScope({
        ...draftEvent({ draft: false }).options,
        eventName: "pull_request",
        expectedSha: head,
        git: fixture.git,
      }).profile,
      "full",
    );
    assert.deepEqual(fixture.calls, []);
  }
});

test("bound draft UI and docs events preserve the whitelist optimizations, including fork contributions", () => {
  for (const action of ["opened", "reopened", "synchronize"])
    for (const [path, profile] of [
      ["src/features/operations/courses.tsx", "standard"],
      ["README.md", "docs"],
    ]) {
      const event = draftEvent({ action });
      event.payload.pull_request.head.repo = {
        full_name: "fictional-contributor/portal-fork",
      };
      const fixture = mergeGit({ diff: path + "\0" });
      assert.equal(
        detectChangeScope({
          ...event.options,
          eventName: "pull_request",
          expectedSha: head,
          git: fixture.git,
        }).profile,
        profile,
      );
      assert.deepEqual(event.reads, ["/fictional/github-event.json"]);
      assert.equal(fixture.calls.length, 3);
    }
});

test("ready_for_review remains full even when a stale payload still claims draft true", () => {
  for (const path of ["README.md", "src/features/jobs/jobs.tsx"]) {
    const fixture = mergeGit({ diff: path + "\0" });
    assert.equal(
      detectChangeScope({
        ...draftEvent({ action: "ready_for_review" }).options,
        eventName: "pull_request",
        expectedSha: head,
        git: fixture.git,
      }).profile,
      "full",
    );
    assert.deepEqual(fixture.calls, []);
  }
});

test("missing, false or non-boolean draft state cannot enable a reduced profile", () => {
  for (const draft of [undefined, null, false, 0, 1, "true", "false", {}, []]) {
    const event = draftEvent();
    event.payload.pull_request.draft = draft;
    assert.equal(
      detectChangeScope({
        ...event.options,
        eventName: "pull_request",
        expectedSha: head,
        git: () => assert.fail("unverified draft state cannot inspect paths"),
      }).profile,
      "full",
    );
  }
});

test("wrong repositories, PR identities, actions and merge-parent snapshots fail full before path classification", () => {
  for (const change of [
    (event) => delete event.repository,
    (event) => {
      event.repository.full_name = "foreign/repository";
    },
    (event) => {
      event.pull_request.base.repo.full_name = "foreign/repository";
    },
    (event) => {
      event.pull_request.base.ref = "other-branch";
    },
    (event) => {
      event.number = 0;
    },
    (event) => {
      event.number = "34";
    },
    (event) => {
      event.number = Number.MAX_SAFE_INTEGER + 1;
    },
    (event) => {
      event.pull_request.number = 35;
    },
    (event) => {
      event.pull_request.state = "closed";
    },
    (event) => {
      event.action = "unknown";
    },
    (event) => delete event.action,
    (event) => delete event.pull_request,
    (event) => {
      event.pull_request.base.sha = contribution;
    },
    (event) => {
      event.pull_request.head.sha = base;
    },
    (event) => {
      event.pull_request.base.sha = "invalid";
    },
    (event) => {
      event.pull_request.head.sha = null;
    },
  ]) {
    const event = draftEvent();
    change(event.payload);
    const fixture = mergeGit();
    assert.equal(
      detectChangeScope({
        ...event.options,
        eventName: "pull_request",
        expectedSha: head,
        git: fixture.git,
      }).profile,
      "full",
    );
    assert(!fixture.calls.some((args) => args[0] === "diff"));
  }
});

test("invalid runner repository, PR ref, event path and unreadable or malformed event data fail full", () => {
  for (const options of [
    { expectedRepository: "foreign/repository" },
    { expectedRepository: "" },
    { expectedRef: "refs/pull/35/merge" },
    { expectedRef: "refs/pull/034/merge" },
    { expectedRef: "refs/pull/0/merge" },
    { expectedRef: "refs/pull/34/head" },
    { expectedRef: "refs/heads/main" },
    { expectedRef: "refs/pull/99999999999999999999/merge" },
    { expectedRef: "" },
    { eventPath: "" },
    { eventPath: null },
    { eventPath: "relative/event.json" },
    {
      readEvent: () => {
        throw new Error("FICTIONAL_UNREADABLE_EVENT");
      },
    },
    { readEvent: () => "FICTIONAL_MALFORMED_EVENT" },
    ...[null, [], {}, true, "fictional"].map((value) => ({
      readEvent: () => JSON.stringify(value),
    })),
  ]) {
    const result = detectChangeScope({
      ...draftEvent().options,
      ...options,
      eventName: "pull_request",
      expectedSha: head,
      git: () => assert.fail("invalid event data cannot inspect paths"),
    });
    assert.equal(result.profile, "full");
    assert.doesNotMatch(JSON.stringify(result), /FICTIONAL_|event\.json/);
  }
});

test("default runner variables read the actual event file and missing provenance remains full", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "portal-draft-scope-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const eventPath = join(directory, "event.json");
  const values = {
    GITHUB_EVENT_NAME: "pull_request",
    GITHUB_SHA: head,
    GITHUB_REPOSITORY: repository,
    GITHUB_REF: "refs/pull/34/merge",
    GITHUB_EVENT_PATH: eventPath,
  };
  const previous = Object.fromEntries(
    Object.keys(values).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, values);
  try {
    writeFileSync(eventPath, JSON.stringify(draftEvent().payload), {
      mode: 0o600,
    });
    assert.equal(
      detectChangeScope({ git: mergeGit().git }).profile,
      "standard",
    );
    writeFileSync(
      eventPath,
      JSON.stringify(draftEvent({ draft: false }).payload),
    );
    assert.equal(detectChangeScope({ git: mergeGit().git }).profile, "full");
    writeFileSync(eventPath, JSON.stringify(draftEvent().payload));
    for (const key of [
      "GITHUB_EVENT_PATH",
      "GITHUB_REF",
      "GITHUB_REPOSITORY",
    ]) {
      delete process.env[key];
      assert.equal(detectChangeScope({ git: mergeGit().git }).profile, "full");
      process.env[key] = values[key];
    }
  } finally {
    for (const [key, value] of Object.entries(previous))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  }
});

test("PR diff compares the verified merge first parent to the exact checked-out merge, without rename suppression", () => {
  const fixture = mergeGit();
  const result = detectChangeScope({
    ...draftEvent().options,
    eventName: "pull_request",
    expectedSha: head,
    git: fixture.git,
  });
  assert.equal(result.profile, "standard");
  assert.deepEqual(fixture.calls.slice(0, 2), [
    ["rev-parse", "--verify", "HEAD"],
    ["rev-list", "--parents", "-n", "1", head],
  ]);
  // A rename out of a sensitive location remains a deletion plus addition.
  const renamed = mergeGit({
    diff: "src/features/auth/login.tsx\0docs/login.md\0",
  });
  assert.equal(
    detectChangeScope({
      ...draftEvent().options,
      eventName: "pull_request",
      expectedSha: head,
      git: renamed.git,
    }).profile,
    "full",
  );
  const deleted = mergeGit({
    diff: "supabase/migrations/20261116120000_change.sql\0",
  });
  assert.equal(
    detectChangeScope({
      ...draftEvent().options,
      eventName: "pull_request",
      expectedSha: head,
      git: deleted.git,
    }).profile,
    "full",
  );
});

test("main, manual, missing events and unrecognized event types always use full without consulting Git", () => {
  for (const eventName of [
    "push",
    "workflow_dispatch",
    "schedule",
    "pull_request_target",
    "",
    undefined,
  ]) {
    assert.equal(
      detectChangeScope({
        eventName: eventName ?? "",
        expectedSha: head,
        readEvent: () => assert.fail("non-PR events do not read event files"),
        git: () => assert.fail("non-PR events do not need Git"),
      }).profile,
      "full",
    );
  }
});

test("requested profiles, labels and supplied changed paths cannot replace the actual risky merge diff", () => {
  const fixture = mergeGit({ diff: "supabase/functions/invite/index.ts\0" });
  const result = detectChangeScope({
    ...draftEvent().options,
    eventName: "pull_request",
    expectedSha: head,
    git: fixture.git,
    profile: "docs",
    labels: ["ci:skip", "docs-only"],
    changedPaths: ["README.md"],
    base: contribution,
  });
  assert.equal(result.profile, "full");
  assert.equal(fixture.calls.at(-1)[4], base);
});

test("incorrect revision, missing parents, empty diff and every Git failure require full acceptance", () => {
  for (const options of [
    { checkout: contribution },
    { parents: `${head} ${base}\n` },
    { parents: `${head}\n` },
    { parents: `${head} ${base} ${contribution} ${base}\n` },
    { parents: `${contribution} ${base} ${head}\n` },
    { parents: `${head} invalid ${contribution}\n` },
    { diff: "" },
    { diff: "README.md" },
    { failAt: 1 },
    { failAt: 2 },
    { failAt: 3 },
  ]) {
    const fixture = mergeGit(options);
    assert.equal(
      detectChangeScope({
        ...draftEvent().options,
        eventName: "pull_request",
        expectedSha: head,
        git: fixture.git,
      }).profile,
      "full",
      JSON.stringify(options),
    );
  }
  for (const expectedSha of ["", "main", undefined])
    assert.equal(
      detectChangeScope({
        eventName: "pull_request",
        expectedSha: expectedSha ?? "",
        git: () => assert.fail("invalid SHA is rejected first"),
      }).profile,
      "full",
    );
});

test("output uses the derived fixed profile and reasons without reflecting changed filenames", () => {
  const result = classifyChangePaths(["docs/[unsafe](example.invalid).md"]);
  const writes = [],
    reports = [];
  writeChangeScope(result, {
    output: "/fictional/output",
    summary: "/fictional/summary",
    append: (...args) => writes.push(args),
    report: (text) => reports.push(text),
  });
  assert.deepEqual(writes[0], ["/fictional/output", "profile=docs\n"]);
  assert.match(writes[1][1], /CI profile: docs/);
  assert.doesNotMatch(writes[1][1], /unsafe|example\.invalid/);
  assert.equal(reports[0], writes[1][1]);
});
