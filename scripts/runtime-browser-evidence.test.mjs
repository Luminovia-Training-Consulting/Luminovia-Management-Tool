import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import { browserPlan, browserAcceptance } from "./testing/browser-evidence.mjs";

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
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
