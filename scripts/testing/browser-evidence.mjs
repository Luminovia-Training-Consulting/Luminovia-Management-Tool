/** Browser acceptance/report boundaries for the canonical runner: bind every copied spec/project to execution and publish only credential-free workflow facts. */
import assert from "node:assert/strict";
import { isAbsolute, relative } from "node:path";

export const browserProjectNames = ["desktop-chromium", "mobile-chromium"];

/** Select one independently provisioned CI browser lane, or both for local acceptance. */
export function browserProjectSelection(value) {
  if (value === undefined || value === "") return [...browserProjectNames];
  assert.ok(
    browserProjectNames.includes(value),
    "Unknown isolated browser project.",
  );
  return [value];
}

/** Flatten nested suites into stable file/title/project identities, rejecting malformed or duplicate evidence. */
function cases(report, { allowErrors = false } = {}) {
  assert.ok(Array.isArray(report?.suites), "Browser report is missing suites.");
  if (!allowErrors)
    assert.deepEqual(
      report.errors,
      [],
      "Browser discovery/execution had errors.",
    );
  const found = [];
  function walk(suites, parents = []) {
    for (const suite of suites) {
      for (const spec of suite.specs ?? []) {
        const file = (
          isAbsolute(spec.file)
            ? relative(report.config.rootDir, spec.file)
            : spec.file
        ).replaceAll("\\", "/");
        for (const test of spec.tests) {
          const title = [...parents, spec.title].join(" > ");
          found.push({
            key: JSON.stringify([file, title, test.projectName]),
            file,
            title,
            project: test.projectName,
            spec,
            test,
          });
        }
      }
      walk(suite.suites ?? [], [...parents, suite.title]);
    }
  }
  walk(report.suites);
  assert.ok(found.length > 0, "No browser workflows were discovered.");
  assert.equal(
    new Set(found.map(({ key }) => key)).size,
    found.length,
    "Duplicate browser workflows cannot establish complete acceptance.",
  );
  return found;
}

/** Preserve useful failure counts and workflow identities without copying
 * errors, response bodies, environment values, stdout or private traces. */
export function browserFailure(report) {
  const executed = cases(report, { allowErrors: true });
  const workflows = executed.map(({ file, title, project, test }) => {
    const result = test.results[0];
    const passed =
      test.expectedStatus === "passed" &&
      test.status === "expected" &&
      test.results.length === 1 &&
      result?.retry === 0 &&
      result.status === "passed" &&
      result.errors?.length === 0;
    return {
      file,
      title,
      project,
      status: passed
        ? "passed"
        : test.status === "skipped"
          ? "skipped"
          : "failed",
      attempts: test.results.length,
      durationMs: test.results.reduce(
        (sum, attempt) => sum + attempt.duration,
        0,
      ),
    };
  });
  return {
    status: "failed",
    passed: workflows.filter((item) => item.status === "passed").length,
    failed: workflows.filter((item) => item.status === "failed").length,
    skipped: workflows.filter((item) => item.status === "skipped").length,
    flaky: report.stats.flaky,
    retries: executed.reduce(
      (sum, { test }) =>
        sum + test.results.filter((result) => result.retry > 0).length,
      0,
    ),
    errors: report.errors.length,
    durationMs: report.stats.duration,
    workflows,
  };
}

/** Bind a real Playwright --list report to every source spec in the selected
 * browser project lanes before mutations. This is an inventory, not a passed test. */
export function browserPlan(report, { files, projects }) {
  assert.ok(
    files.length > 0 && projects.length > 0,
    "An expected browser inventory is required.",
  );
  const discovered = cases(report);
  assert.deepEqual(
    [...new Set(discovered.map(({ project }) => project))].sort(),
    [...projects].sort(),
    "Browser projects differ from the required desktop/mobile inventory.",
  );
  for (const item of discovered) {
    assert.ok(
      files.includes(item.file),
      `Unexpected browser file: ${item.file}`,
    );
    assert.ok(
      projects.includes(item.project),
      `Unexpected browser project: ${item.project}`,
    );
    assert.equal(
      item.test.expectedStatus,
      "passed",
      `Disabled/expected-failing workflow: ${item.key}`,
    );
  }
  for (const project of projects)
    for (const file of files)
      assert.ok(
        discovered.some(
          (item) => item.project === project && item.file === file,
        ),
        `Missing discovered browser workflow: ${project}/${file}`,
      );
  return discovered.map(({ key }) => key).sort();
}

/** Exit zero is insufficient: skip/fixme/expected-failure/retry or a reduced
 * selection must fail the complete command. Return only safe summary fields;
 * raw Playwright reports/traces remain in private local artifacts. */
export function browserAcceptance(report, planned) {
  const executed = cases(report);
  assert.deepEqual(
    executed.map(({ key }) => key).sort(),
    planned,
    "Executed browser workflows differ from discovery.",
  );
  assert.equal(
    report.stats.expected,
    planned.length,
    "Not every planned workflow passed.",
  );
  for (const status of ["unexpected", "flaky", "skipped"])
    assert.equal(
      report.stats[status],
      0,
      `Browser ${status} workflows are not accepted.`,
    );
  for (const { key, spec, test } of executed) {
    assert.equal(spec.ok, true, `Failed browser spec: ${key}`);
    assert.equal(
      test.expectedStatus,
      "passed",
      `Expected-failure/disabled workflow: ${key}`,
    );
    assert.equal(
      test.status,
      "expected",
      `Incomplete browser workflow: ${key}`,
    );
    assert.equal(
      test.results.length,
      1,
      `Retried/unexecuted browser workflow: ${key}`,
    );
    const result = test.results[0];
    assert.equal(result.retry, 0, `Retried browser workflow: ${key}`);
    assert.equal(
      result.status,
      "passed",
      `Browser workflow did not pass: ${key}`,
    );
    assert.deepEqual(
      result.errors,
      [],
      `Browser workflow reported errors: ${key}`,
    );
  }
  return {
    status: "passed",
    passed: executed.length,
    skipped: 0,
    retries: 0,
    durationMs: report.stats.duration,
    workflows: executed.map(({ file, title, project, test }) => ({
      file,
      title,
      project,
      status: "passed",
      durationMs: test.results[0].duration,
    })),
  };
}
