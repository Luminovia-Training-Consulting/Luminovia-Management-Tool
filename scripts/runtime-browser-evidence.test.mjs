/** Regression and actual Playwright process probes for truthful complete acceptance, including skipped, focused, partial and per-project failure results. All generated fixtures are owned and temporary. */
import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import {
  browserPlan,
  browserAcceptance,
  browserFailure,
} from "./testing/browser-evidence.mjs";

const projects = ["desktop-chromium", "mobile-chromium"];
const files = ["calendar.spec.ts", "search.spec.ts"];
function report() {
  return {
    config: {
      rootDir: "/fixture/tests/e2e",
      projects: projects.map((name) => ({ name })),
    },
    suites: files.map((file) => ({
      title: file,
      file,
      specs: [
        {
          file,
          title: "persists authorized changes and denies foreign access",
          ok: true,
          tests: projects.map((projectName) => ({
            projectName,
            expectedStatus: "passed",
            status: "expected",
            results: [
              {
                status: "passed",
                retry: 0,
                duration: 12,
                errors: [],
                stdout: [{ text: "private fixture password" }],
              },
            ],
          })),
        },
      ],
    })),
    errors: [],
    stats: { expected: 4, unexpected: 0, flaky: 0, skipped: 0, duration: 48 },
  };
}

test("discovery includes nested workflows and every source file in each browser project", () => {
  const discovered = report();
  discovered.suites[0].suites = [
    {
      title: "nested",
      specs: [
        {
          ...structuredClone(discovered.suites[0].specs[0]),
          title: "another case",
        },
      ],
    },
  ];
  for (const suite of discovered.suites)
    for (const spec of suite.specs)
      spec.tests.forEach((test) => {
        test.results = [];
      });
  const plan = browserPlan(discovered, { files, projects });
  assert.equal(plan.length, 6);
  assert.throws(
    () =>
      browserPlan(discovered, {
        files: [...files, "missing.spec.ts"],
        projects,
      }),
    /Missing discovered/,
  );
  discovered.suites[0].specs[0].tests[0].expectedStatus = "skipped";
  assert.throws(() => browserPlan(discovered, { files, projects }), /Disabled/);
});

test("only first-attempt passes produce a safe summary without raw logs/configuration", () => {
  const actual = report();
  const plan = browserPlan(actual, { files, projects });
  const accepted = browserAcceptance(actual, plan);
  assert.equal(accepted.passed, 4);
  assert.equal(accepted.workflows.length, 4);
  assert.ok(!JSON.stringify(accepted).includes("private fixture password"));
});

test("failed acceptance retains actual passed/failed/skipped cases without sensitive error payloads", () => {
  const actual = report();
  actual.suites[0].specs[0].tests[0].status = "unexpected";
  actual.suites[0].specs[0].tests[0].results[0].status = "failed";
  actual.suites[0].specs[0].tests[0].results[0].errors = [
    { message: "private fixture token" },
  ];
  actual.suites[0].specs[0].tests[1].status = "skipped";
  actual.suites[0].specs[0].tests[1].results = [];
  actual.errors = [{ message: "private setup token" }];
  const outcome = browserFailure(actual);
  assert.equal(outcome.status, "failed");
  assert.equal(outcome.passed, 2);
  assert.equal(outcome.failed, 1);
  assert.equal(outcome.skipped, 1);
  assert.equal(outcome.errors, 1);
  assert.equal(outcome.workflows[0].status, "failed");
  assert.ok(!JSON.stringify(outcome).includes("private"));
});

test("a failed shared spec cannot relabel the passing browser project as failed", () => {
  const actual = report();
  const spec = actual.suites[0].specs[0];
  spec.ok = false;
  spec.tests[1].status = "unexpected";
  spec.tests[1].results[0].status = "failed";
  const outcome = browserFailure(actual);
  assert.equal(outcome.passed, 3);
  assert.equal(outcome.failed, 1);
  assert.equal(outcome.workflows[0].status, "passed");
  assert.equal(outcome.workflows[1].status, "failed");
});

test("exit-zero skipped, expected failures, retries and incomplete results fail closed", () => {
  const plan = browserPlan(report(), { files, projects });
  const mutations = [
    (r) => {
      r.stats.skipped = 1;
    },
    (r) => {
      r.stats.flaky = 1;
    },
    (r) => {
      r.stats.unexpected = 1;
    },
    (r) => {
      r.suites[0].specs[0].tests[0].status = "skipped";
    },
    (r) => {
      r.suites[0].specs[0].tests[0].expectedStatus = "failed";
    },
    (r) => {
      r.suites[0].specs[0].tests[0].results[0].status = "interrupted";
    },
    (r) => {
      r.suites[0].specs[0].tests[0].results[0].retry = 1;
    },
    (r) => {
      r.suites[0].specs[0].tests[0].results.push(
        r.suites[0].specs[0].tests[0].results[0],
      );
    },
    (r) => {
      r.suites[0].specs[0].tests[0].results = [];
    },
    (r) => {
      r.suites[0].specs[0].tests[0].results[0].errors = [
        { message: "failure" },
      ];
    },
  ];
  for (const mutate of mutations) {
    const actual = report();
    mutate(actual);
    assert.throws(() => browserAcceptance(actual, plan));
  }
});

test("a partial/empty/sharded or duplicate run cannot substitute for the discovered suite", () => {
  const plan = browserPlan(report(), { files, projects });
  for (const mutate of [
    (r) => {
      r.suites = [];
    },
    (r) => {
      r.suites.pop();
    },
    (r) => {
      r.suites[0].specs[0].tests.pop();
    },
    (r) => {
      r.suites[0].specs[0].tests.push(r.suites[0].specs[0].tests[0]);
    },
    (r) => {
      r.errors = [{ message: "worker setup failed" }];
    },
  ]) {
    const actual = report();
    mutate(actual);
    assert.throws(() => browserAcceptance(actual, plan));
  }
  assert.throws(
    () => browserPlan(report(), { files, projects: [projects[0]] }),
    /projects differ/,
  );
});

test("real Playwright exit-zero runtime skips and focused suites cannot pass acceptance", async () => {
  const directory = mkdtempSync(join(tmpdir(), "portal-browser-proof-"));
  const require = createRequire(import.meta.url);
  const cli = require.resolve("@playwright/test/cli");
  const output = join(directory, "report.json");
  const config = join(directory, "playwright.config.cjs");
  const source = join(directory, "workflow.spec.js");
  const execute = promisify(execFile);
  writeFileSync(
    config,
    `module.exports = ${JSON.stringify({
      testDir: directory,
      workers: 1,
      retries: 0,
      forbidOnly: true,
      reporter: [["json", { outputFile: output }]],
      projects: projects.map((name) => ({ name })),
    })};`,
  );
  const header = `const {test} = require(${JSON.stringify(require.resolve("@playwright/test"))});`;
  writeFileSync(
    source,
    `${header}\ntest('missing backend fixture', () => {test.skip(true, 'intentional negative probe');});`,
  );
  try {
    await execute(
      process.execPath,
      [cli, "test", "--config", config, "--list"],
      { timeout: 20000 },
    );
    const planned = browserPlan(JSON.parse(readFileSync(output, "utf8")), {
      files: ["workflow.spec.js"],
      projects,
    });
    await execute(process.execPath, [cli, "test", "--config", config], {
      timeout: 20000,
    });
    const actual = JSON.parse(readFileSync(output, "utf8"));
    assert.equal(
      actual.stats.skipped,
      2,
      "Real Playwright normally exits zero when both workflows skip.",
    );
    assert.equal(browserFailure(actual).skipped, 2);
    assert.throws(() => browserAcceptance(actual, planned));
    writeFileSync(source, `${header}\ntest.only('focused test', () => {});`);
    await assert.rejects(
      execute(process.execPath, [cli, "test", "--config", config], {
        timeout: 20000,
      }),
    );
    assert.match(
      JSON.stringify(JSON.parse(readFileSync(output, "utf8")).errors),
      /forbidOnly/,
    );
    writeFileSync(
      source,
      `${header}\ntest('one failing project', ({}, info) => { if (info.project.name === 'mobile-chromium') throw new Error('private failing-project probe'); });`,
    );
    await assert.rejects(
      execute(process.execPath, [cli, "test", "--config", config], {
        timeout: 20000,
      }),
    );
    const failed = browserFailure(JSON.parse(readFileSync(output, "utf8")));
    assert.equal(failed.passed, 1);
    assert.equal(failed.failed, 1);
    assert.ok(
      !JSON.stringify(failed).includes("private failing-project probe"),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
