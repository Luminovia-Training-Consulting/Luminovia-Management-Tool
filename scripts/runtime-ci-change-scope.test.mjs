/** Exercise classification and real Git argv without spawning child processes. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyChangePaths,
  detectChangeScope,
  writeChangeScope,
} from "./ci-change-scope.mjs";

const head = "a".repeat(40);
const base = "b".repeat(40);
const contribution = "c".repeat(40);

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

test("PR diff compares the verified merge first parent to the exact checked-out merge, without rename suppression", () => {
  const fixture = mergeGit();
  const result = detectChangeScope({
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
        git: () => assert.fail("non-PR events do not need Git"),
      }).profile,
      "full",
    );
  }
});

test("requested profiles, labels and supplied changed paths cannot replace the actual risky merge diff", () => {
  const fixture = mergeGit({ diff: "supabase/functions/invite/index.ts\0" });
  const result = detectChangeScope({
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
