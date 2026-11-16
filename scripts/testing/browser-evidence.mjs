import assert from "node:assert/strict";
import { isAbsolute, relative } from "node:path";

function cases(report) {
  assert.ok(Array.isArray(report?.suites), "Browser report is missing suites.");
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

/** Bind a real Playwright --list report to every source spec and both supported
 * browser projects before mutations. This is an inventory, not a passed test. */
export function browserPlan(report, { files, projects }) {
  assert.ok(
    files.length > 0 && projects.length > 0,
    "An expected browser inventory is required.",
  );
  assert.deepEqual(
    report.config.projects.map(({ name }) => name).sort(),
    [...projects].sort(),
    "Browser projects differ from the required desktop/mobile inventory.",
  );
  const discovered = cases(report);
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
