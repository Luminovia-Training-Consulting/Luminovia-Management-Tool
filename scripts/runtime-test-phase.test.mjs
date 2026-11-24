/** Execute the actual orchestrator with OS/service boundaries replaced only.
 * No GitHub, child process, Docker daemon or shared port is needed here.
 */
import assert from "node:assert/strict";
import {createHash, randomBytes} from "node:crypto";
import {readFileSync} from "node:fs";
import {basename, join} from "node:path";
import test from "node:test";
import {cleanEnvironment, localEdgeOrigins} from "./runtime-lib.mjs";
import {browserAcceptance, browserFailure, browserPlan, browserProjectSelection,} from "./testing/browser-evidence.mjs";
import {runtimeTestArguments, runtimeTestPhasePlan,} from "./runtime-test-phase.mjs";
import {runBounded} from "./testing/run-bounded.mjs";

const source = readFileSync(
    new URL("./runtime-test.mjs", import.meta.url),
    "utf8",
);
const body = source.replace(/^import\s[\s\S]*?from\s"[^"\n]+";\n/gm, "");
assert.equal(/^import\s/m.test(body), false);
const AsyncFunction = Object.getPrototypeOf(async function () {
}).constructor;

/** Stable fictional source/service boundaries preserve the runner's actual
 * discovery, ordering, argument, environment and cleanup decisions.
 */
async function runFixture({
                              args = [],
                              entry = "scripts/runtime-test.mjs",
                              fail = () => false,
                              cancelDuringCleanup = false,
                              inherited = {},
                              sourceText = "export const fictionalSource = true;\n",
                              mutateBrowserReport = () => {
                              },
                          } = {}) {
    const calls = [],
        reports = [],
        copies = [],
        removed = [],
        messages = [];
    const listeners = new Map();
    let locks = 0,
        released = 0,
        snapshots = 0;
    const directory = (name) => ({name, isDirectory: () => true});
    const file = (name) => ({name, isDirectory: () => false});
    // Replace only the OS report boundary. Real inventory/acceptance validators
    // consume list reports without execution and actual-style first-pass results.
    const browserReport = (path) => {
        const discovery = path.endsWith("plan.json");
        const stage = path.includes("/pwa-webkit/") ? "pwa-webkit"
            : path.includes("/pwa/") ? "pwa" : "application";
        const name = stage === "application" ? "workflow.spec.ts" : "pwa.spec.ts";
        const browserNames = stage === "pwa-webkit" ? ["desktop-webkit"] : inherited.PORTAL_BROWSER_PROJECT
            ? [inherited.PORTAL_BROWSER_PROJECT]
            : ["desktop-chromium", "mobile-chromium"];
        const report = {
            config: {
                rootDir: "/owned-qa/run/source/tests/e2e",
                projects: browserNames.map((name) => ({
                    name,
                })),
            },
            errors: [],
            suites: [
                {
                    title: name,
                    specs: [
                        {
                            file: name,
                            title: "service-boundary workflow",
                            ok: !discovery,
                            tests: browserNames.map((projectName) => ({
                                projectName,
                                expectedStatus: "passed",
                                status: discovery ? "skipped" : "expected",
                                results: discovery
                                    ? []
                                    : [
                                        {
                                            status: "passed",
                                            retry: 0,
                                            duration: 1,
                                            errors: [],
                                            stdout: [{text: "private-browser-session-fixture"}],
                                        },
                                    ],
                            })),
                        },
                    ],
                },
            ],
            stats: {
                expected: discovery ? 0 : browserNames.length,
                unexpected: 0,
                flaky: 0,
                skipped: 0,
                duration: discovery ? 0 : browserNames.length,
            },
        };
        mutateBrowserReport(report, {stage, discovery});
        return JSON.stringify(report);
    };
    const bindings = {
        cpSync(from, to) {
            copies.push([from, to]);
            if (from === "/owned-qa/source") snapshots++;
        },
        mkdirSync() {
        },
        rmSync: (path) => removed.push(path),
        symlinkSync() {
        },
        writeFileSync() {
        },
        assertLocalQaMemory() {},
        localQaTempRoot: () => "/owned-qa",
        mkdtempSync: () => "/owned-qa/run",
        readFileSync: (path) =>
            path.endsWith("source.fixture.ts")
                ? Buffer.from(sourceText)
                : path.endsWith("config.toml")
                    ? 'project_id = "luminovia-portal"\n[api]\nport = 54321\n'
                    : path.endsWith(".env.test.local")
                        ? "SUPABASE_URL=http://127.0.0.1:55321\nSUPABASE_ANON_KEY=fictional-public-fixture\nE2E_PASSWORD=fictional-local-password\n"
                        : path.endsWith("plan.json") || path.endsWith("report.json")
                            ? browserReport(path)
                            : "",
        readdirSync(path) {
            if (path === "/owned-qa/run/source") return [file("source.fixture.ts")];
            if (path.endsWith("tests/e2e"))
                return ["workflow.spec.ts", "pwa.spec.ts"];
            if (path.endsWith("scripts"))
                return [
                    "runtime-safety.test.mjs",
                    "alpha-db-tests.mjs",
                    "alpha-api-check.mjs",
                    "beta-db-tests.mjs",
                    "beta-api-check.mjs",
                ];
            if (path.endsWith("supabase/functions")) return [directory("invites")];
            if (path.endsWith("supabase/functions/invites"))
                return [file("index.ts"), file("index_test.ts")];
            if (path.endsWith("deploy/hostinger"))
                return ["reviewed-migrations.test.mjs"];
            if (path.endsWith("deploy/hostinger/updates"))
                return ["package.test.mjs"];
            if (path.endsWith("deploy/hostinger/scanner")) return ["scan.test.mjs"];
            if (path.endsWith("deploy/hostinger/selfhost"))
                return ["compose.yml", "course-documents.test.mjs"];
            if (path.endsWith("deploy/hostinger/backups")) return ["crypto.test.mjs"];
            if (path.endsWith("deploy/hostinger/maintenance"))
                return ["candidate.test.mjs"];
            return [];
        },
        existsSync: (path) =>
            /deploy\/hostinger|deploy\/academy\/test_recovery\.py$|supabase\/functions|playwright-report$|test-results$|coverage$|\.local\/screenshots$|\.local\/browser$|\.local\/runtime\.log$/.test(
                path,
            ),
        join,
        basename,
        randomBytes,
        availableParallelism: () => 4,
        createHash,
        browserPlan,
        browserAcceptance,
        browserFailure,
        browserProjectSelection,
        root: "/owned-qa/source",
        runtimeDir: "/owned-qa/reports",
        runtimeSnapshotSource: () => true,
        runtimeTestPhasePlan,
        runBounded,
        runtimeTestArguments,
        acquireTestLock() {
            locks++;
            return () => released++;
        },
        assertTestPortsAvailable: async () => {
        },
        privateDirectory() {
        },
        privateWrite: (path, value) => reports.push({path, value}),
        cleanEnvironment,
        assertLocalDocker: async () => "unix:///var/run/docker.sock",
        command: async (file, args, options) => {
            const call = {
                file,
                args,
                env: {...options.env},
                cwd: options.cwd,
                timeoutMs: options.timeoutMs,
                signal: options.signal,
            };
            calls.push(call);
            if (
                cancelDuringCleanup &&
                args[0] === "scripts/runtime-cli.mjs" &&
                args[1] === "stop"
            )
                listeners.get("SIGTERM")?.();
            if (fail(call))
                throw new Error(`Fictional stage failure: ${args.join(" ")}`);
            return args.includes("--version") ? "v1.3.2" : "";
        },
        process: {
            argv: [process.execPath, entry, ...args],
            execPath: process.execPath,
            pid: process.pid,
            env: {CI: "true", ...inherited},
            once: (event, handler) => listeners.set(event, handler),
            removeListener: (event) => listeners.delete(event),
        },
        console: {
            log: (text) => messages.push(text), error() {
            }
        },
    };
    let error;
    try {
        await new AsyncFunction(...Object.keys(bindings), body)(
            ...Object.values(bindings),
        );
    } catch (caught) {
        error = caught;
    }
    return {
        calls,
        reports,
        copies,
        removed,
        messages,
        error,
        locks,
        released,
        snapshots,
    };
}

/** Represent actual executed commands independently of the phase planner. */
const commands = (result) =>
    result.calls
        .filter((call) => call.signal !== undefined)
        .map(({file, args}) => [file, args]);
const contains = (result, value) =>
    result.calls.some(({args}) => args.includes(value));
/** Identify native Playwright discovery/execution independently of stage labels. */
const browserCommand = (result, stage, discovery = false) =>
    result.calls.find(
        ({file, args, env}) =>
            file === "npx" &&
            args[0] === "--no-install" &&
            args[1] === "playwright" &&
            args[2] === "test" &&
            env.PORTAL_BROWSER_STAGE === stage &&
            args.includes("--list") === discovery,
    );
/** Read the final safe JSON evidence, separately from the human result text. */
const acceptance = (result) =>
    JSON.parse(
        result.reports.filter(({path}) => path.endsWith("acceptance.json")).at(-1)
            .value,
    );

test("a browser lane cannot reduce complete or system acceptance before acquiring any resource", async () => {
    for (const args of [
        [],
        ["--phase", "all"],
        ["--phase", "all", "--external-gates", "quality,coverage"],
        ["--phase", "system"],
    ]) {
        const result = await runFixture({
            args,
            inherited: {PORTAL_BROWSER_PROJECT: "desktop-chromium"},
        });
        assert.match(result.error?.message ?? "", /only.*browser phase/i);
        assert.equal(result.locks, 0);
        assert.equal(result.snapshots, 0);
        assert.equal(result.calls.length, 0);
    }
});

test("an explicit browser phase may execute one selected CI lane", async () => {
    const result = await runFixture({
        args: ["--phase", "browser"],
        inherited: {CI: "true", PORTAL_BROWSER_PROJECT: "mobile-chromium"},
    });
    assert.equal(result.error, undefined);
    assert.equal(contains(result, "deploy/hostinger/backups/test_complete_restore.mjs"), false);
    assert.equal(Boolean(browserCommand(result, "pwa-webkit")), false);
    assert.equal(contains(result, "webkit"), false);
    for (const stage of ["application", "pwa"]) {
        for (const discovery of [true, false]) {
            const call = browserCommand(result, stage, discovery);
            assert.ok(call);
            const index = call.args.indexOf("--project");
            assert.ok(index >= 0);
            assert.equal(call.args[index + 1], "mobile-chromium");
            assert.equal(call.timeoutMs, stage === "application" && !discovery ? 65 * 60_000 : 20 * 60_000);
        }
    }
});

test("CI desktop and opted-in local desktop require discovery and execution of the WebKit PWA", async () => {
    for (const [env, failingExecution] of [
        [{CI: "true", PORTAL_BROWSER_WEBKIT: "false"}, false],
        [{CI: "false", PORTAL_BROWSER_WEBKIT: "true"}, false],
        [{CI: "true"}, true],
    ]) {
        const result = await runFixture({
            args: ["--phase", "browser"],
            inherited: {...env, PORTAL_BROWSER_PROJECT: "desktop-chromium"},
            fail: ({env, args}) => failingExecution &&
                env.PORTAL_BROWSER_STAGE === "pwa-webkit" && !args.includes("--list"),
        });
        const install = result.calls.find(({args}) => args.includes("install") && args.includes("webkit"));
        const discovery = browserCommand(result, "pwa-webkit", true);
        const execution = browserCommand(result, "pwa-webkit");
        assert.ok(install && discovery && execution);
        assert.ok(result.calls.indexOf(install) < result.calls.indexOf(discovery));
        assert.ok(result.calls.indexOf(discovery) < result.calls.indexOf(execution));
        assert.equal(execution.args[execution.args.indexOf("--project") + 1], "desktop-webkit");
        assert.equal(execution.env.E2E_PWA, "1");
        assert.equal(execution.env.E2E_BASE_URL, "http://127.0.0.1:4273");
        if (failingExecution) {
            assert.match(result.error?.message, /Fictional stage failure/);
            assert.equal(acceptance(result).browsers["pwa-webkit"].status, "failed");
        } else {
            assert.equal(result.error, undefined);
            assert.equal(acceptance(result).browsers["pwa-webkit"].status, "passed");
        }
    }
});

test("local Chromium acceptance needs no WebKit system libraries by default", async () => {
    const result = await runFixture({
        args: ["--phase", "browser"],
        inherited: {CI: "false"},
    });
    assert.equal(result.error, undefined);
    assert.equal(Boolean(browserCommand(result, "pwa-webkit")), false);
    assert.equal(contains(result, "webkit"), false);
    assert.equal(acceptance(result).browsers.pwa.status, "passed");
});

test("no arguments remain complete; explicit phase arguments reject every unknown or partial option", () => {
    const expected = [
        "quality",
        "runtime",
        "coverage",
        "audit",
        "edge",
        "operational",
        "startup",
        "retention",
        "seed",
        "sql",
        "api",
        "invitation",
        "chromium",
        "browser",
        "build",
        "pwa-start",
        "pwa",
    ];
    assert.deepEqual(runtimeTestPhasePlan().stages, expected);
    assert.deepEqual(runtimeTestPhasePlan(["--phase", "all"]).stages, expected);
    const system = runtimeTestPhasePlan(["--phase", "system"]);
    const delegated = runtimeTestPhasePlan([
        "--phase",
        "system",
        "--external-gates",
        "quality,coverage",
    ]);
    const completeDelegated = runtimeTestPhasePlan([
        "--phase",
        "all",
        "--external-gates",
        "quality,coverage",
    ]);
    const browser = runtimeTestPhasePlan(["--phase", "browser"]);
    assert.equal(system.system, true);
    assert.equal(system.browser, false);
    assert.deepEqual(system.externalGates, []);
    assert.deepEqual(delegated.externalGates, ["quality", "coverage"]);
    assert.equal(delegated.stages.includes("quality"), false);
    assert.equal(delegated.stages.includes("coverage"), false);
    assert(delegated.stages.includes("runtime"));
    assert(delegated.stages.includes("sql"));
    assert(delegated.stages.includes("api"));
    assert.deepEqual(completeDelegated.externalGates, ["quality", "coverage"]);
    assert(completeDelegated.stages.includes("browser"));
    assert(completeDelegated.stages.includes("pwa"));
    assert(!completeDelegated.stages.includes("quality"));
    assert(!completeDelegated.stages.includes("coverage"));
    assert.equal(browser.system, false);
    assert.equal(browser.browser, true);
    assert.deepEqual(
        system.stages.filter((stage) => browser.stages.includes(stage)),
        ["startup", "retention", "seed"],
    );
    assert.deepEqual(
        [...new Set([...system.stages, ...browser.stages])].sort(),
        [...expected].sort(),
    );
    for (const args of [
        null,
        "system",
        ["--phase"],
        ["--phase", "unknown"],
        ["--phase=browser"],
        ["browser"],
        ["--phase", "browser", "extra"],
        ["--phase", "system", "--phase", "browser"],
        ["--phase", "browser", "--external-gates", "quality,coverage"],
        ["--phase", "system", "--external-gates", "coverage"],
    ])
        assert.throws(() => runtimeTestPhasePlan(args), /Use no arguments/);
});

test("actual default runner retains all quality, Edge, operational, SQL/API and browser/PWA commands", async () => {
    const all = await runFixture();
    const explicit = await runFixture({args: ["--phase", "all"]});
    assert.ifError(all.error);
    assert.ifError(explicit.error);
    assert.deepEqual(commands(all), commands(explicit));
    for (const value of [
        "lint",
        "typecheck",
        "format:check",
        ".github",
        "scripts/code-integrity.mjs",
        "scripts/runtime-safety.test.mjs",
        "test:coverage",
        "audit",
        "--audit-level=low",
        "--rules-exclude=no-import-prefix,no-control-regex",
        "--allow-env",
        "check",
        "--version",
        "unittest",
        "deploy/academy",
        "deploy/hostinger/updates/package.test.mjs",
        "--gateway-routing",
        "deploy/hostinger/selfhost/course-documents.test.mjs",
        "scripts/hostinger-caddy-check.mjs",
        "deploy/hostinger/backups/test_complete_restore.mjs",
        "scripts/runtime-persistence-check.mjs",
        "scripts/local-seed.mjs",
        "test:db",
        "scripts/alpha-db-tests.mjs",
        "scripts/beta-db-tests.mjs",
        "scripts/alpha-api-check.mjs",
        "scripts/beta-api-check.mjs",
        "scripts/local-invite-check.mjs",
        "chromium",
        "playwright",
        "--list",
        "--reporter=json",
        "build",
        "tests/e2e/pwa.spec.ts",
    ])
        assert(contains(all, value), value);
    assert.match(all.reports.at(-1).value, /^PASS\nPhase: all\n/);
    assert.match(all.reports.at(-1).value, /Complete local acceptance/);
    assert.equal(all.locks, 1);
    assert.equal(all.released, 1);
    assert(contains(all, "vite"));
    assert(
        !all.calls.some(
            ({file, args}) => file === "npm" && args.join(" ") === "run build",
        ),
        "The browser production build must not repeat the required TypeScript check.",
    );
});

test("system PR phase delegates only independently required quality and coverage gates", async () => {
    const result = await runFixture({
        args: ["--phase", "system", "--external-gates", "quality,coverage"],
    });
    assert.ifError(result.error);
    const evidence = acceptance(result);
    assert.deepEqual(evidence.externalGates, ["quality", "coverage"]);
    const npmCommands = result.calls
        .filter(({file}) => file === "npm")
        .map(({args}) => args.join(" "));
    assert(!npmCommands.includes("run lint"));
    assert(!npmCommands.includes("run typecheck"));
    assert(!npmCommands.includes("run format:check"));
    assert(!npmCommands.includes("run test:coverage"));
    assert(!contains(result, ".github"));
    assert(!contains(result, "scripts/code-integrity.mjs"));
    assert(contains(result, "deploy/hostinger/selfhost/course-documents.test.mjs"));
    assert(contains(result, "deploy/hostinger/backups/test_complete_restore.mjs"));
    assert(contains(result, "scripts/runtime-safety.test.mjs"));
    assert(contains(result, "--audit-level=low"));
    assert(contains(result, "test:db"));
    assert(contains(result, "scripts/alpha-api-check.mjs"));
    assert.match(
        result.reports.at(-1).value,
        /Delegated required gates: quality, coverage/,
    );
    assert.equal(result.released, 1);
});

test("failed PDF or complete backup rehearsals stop system acceptance before service startup", async () => {
    for (const path of [
        "deploy/hostinger/selfhost/course-documents.test.mjs",
        "deploy/hostinger/backups/test_complete_restore.mjs",
    ]) {
        const result = await runFixture({
            args: ["--phase", "system"],
            fail: ({args}) => args.includes(path),
        });
        assert.ok(result.error);
        assert.equal(acceptance(result).status, "failed");
        assert.equal(contains(result, "start"), false);
        assert.equal(result.released, 1);
    }
});

test("complete main CI phase keeps browser/PWA acceptance while delegating parallel quality and coverage", async () => {
    const result = await runFixture({
        args: ["--phase", "all", "--external-gates", "quality,coverage"],
    });
    assert.ifError(result.error);
    const evidence = acceptance(result);
    assert.deepEqual(evidence.externalGates, ["quality", "coverage"]);
    assert(contains(result, "test:db"));
    assert(contains(result, "scripts/alpha-api-check.mjs"));
    assert(browserCommand(result, "application"));
    assert(browserCommand(result, "pwa"));
    assert.match(result.reports.at(-1).value, /Selected phase acceptance passed/);
    assert.doesNotMatch(result.reports.at(-1).value, /Complete local acceptance/);
    assert.equal(result.released, 1);
});

test("the actual public portal test import keeps complete acceptance, including explicit all", async () => {
    const direct = await runFixture();
    for (const args of [["test"], ["test", "--phase", "all"]]) {
        const wrapped = await runFixture({
            entry: "scripts/runtime-cli.mjs",
            args,
        });
        assert.ifError(wrapped.error);
        assert.deepEqual(commands(wrapped), commands(direct));
        assert.match(wrapped.reports.at(-1).value, /^PASS\nPhase: all\n/);
        assert.equal(wrapped.locks, 1);
        assert.equal(wrapped.released, 1);
    }
    const explicitBrowser = await runFixture({
        entry: "/owned-qa/source/scripts/runtime-cli.mjs",
        args: ["test", "--phase", "browser"],
    });
    assert.ifError(explicitBrowser.error);
    assert.match(explicitBrowser.reports.at(-1).value, /^PASS\nPhase: browser\n/);
    assert(!contains(explicitBrowser, "test:db"));
});

test("entry-point normalization never drops unknown commands or trusts a matching basename outside this checkout", async () => {
    const root = "/owned-qa/source";
    for (const argv of [
        [],
        ["node"],
        ["node", "/another-checkout/scripts/runtime-cli.mjs", "test"],
        ["node", "/another-checkout/scripts/runtime-test.mjs"],
        ["node", "scripts/runtime-cli.mjs", "other-command"],
    ])
        assert.throws(() => runtimeTestArguments(argv, root), /owned test runner/);
    for (const [entry, args] of [
        ["scripts/runtime-test.mjs", ["test"]],
        ["scripts/runtime-cli.mjs", ["test", "--phase", "unknown"]],
        ["/another-checkout/scripts/runtime-cli.mjs", ["test"]],
    ]) {
        const result = await runFixture({entry, args});
        assert(result.error);
        assert.equal(result.locks, 0);
        assert.equal(result.snapshots, 0);
        assert.equal(result.calls.length, 0);
    }
});

test("system and browser phases preserve the complete command partition, duplicating only independent real bootstrap", async () => {
    const all = await runFixture();
    const system = await runFixture({args: ["--phase", "system"]});
    const browser = await runFixture({args: ["--phase", "browser"]});
    for (const result of [system, browser]) assert.ifError(result.error);
    const selfhostPdfTest = "deploy/hostinger/selfhost/course-documents.test.mjs";
    for (const result of [all, system]) {
        const releaseTests = result.calls.find(({args}) => args.includes(selfhostPdfTest));
        assert.ok(releaseTests);
        assert.equal(releaseTests.args[0], "--test");
        assert.equal(releaseTests.env.DOCKER_HOST, "unix:///var/run/docker.sock");
        assert.equal(releaseTests.env.TMPDIR, "/owned-qa/run/tmp");
        assert.equal(releaseTests.cwd, "/owned-qa/run/source");
        assert(!releaseTests.args.includes("deploy/hostinger/selfhost/compose.yml"));
    }
    assert(!contains(browser, selfhostPdfTest));
    const application = browserCommand(browser, "application");
    assert.equal(application.env.TMPDIR, "/owned-qa/run/tmp");
    assert.equal(application.cwd, "/owned-qa/run/source");
    const startup = (command) =>
        command[1][0] === "scripts/runtime-cli.mjs" && command[1][1] === "start";
    const bootstrap = (command) =>
        startup(command) ||
        [
            "scripts/runtime-persistence-check.mjs",
            "scripts/local-seed.mjs",
        ].includes(command[1][0]);
    const allCommands = commands(all);
    const expectedSystem = allCommands.slice(
        0,
        allCommands.findIndex(([, args]) => args.includes("chromium")),
    );
    assert.deepEqual(commands(system), expectedSystem);
    const expectedBrowser = [
        ...allCommands.filter(bootstrap),
        ...allCommands.slice(expectedSystem.length),
    ];
    assert.deepEqual(commands(browser), expectedBrowser);
    assert.deepEqual(
        commands(system).filter((command) =>
            commands(browser).some(
                (other) => JSON.stringify(other) === JSON.stringify(command),
            ),
        ),
        allCommands.filter(bootstrap),
    );
    assert.match(system.reports.at(-1).value, /^PASS\nPhase: system\n/);
    assert.match(
        system.reports.at(-1).value,
        /Browser\/build\/PWA acceptance was not run/,
    );
    assert.match(browser.reports.at(-1).value, /^PASS\nPhase: browser\n/);
    assert.match(
        browser.reports.at(-1).value,
        /System SQL\/API\/Edge\/operational acceptance was not run/,
    );
    assert(
        !system.messages.some((message) => /All isolated checks/.test(message)),
    );
    assert(
        !browser.messages.some((message) => /All isolated checks/.test(message)),
    );
});

test("browser phase gets its own snapshot, retained real services and explicit owned policy before browser acceptance", async () => {
    const browser = await runFixture({args: ["--phase", "browser"]});
    assert.ifError(browser.error);
    // Owned stage calls carry cancellation even when a measured aggregate has
    // a different bound; cleanup commands deliberately use separate deadlines.
    const relevant = browser.calls.filter(({signal}) => signal !== undefined);
    assert.deepEqual(
        relevant.slice(0, 4).map(({args}) => args[0]),
        [
            "scripts/runtime-cli.mjs",
            "scripts/runtime-persistence-check.mjs",
            "scripts/local-seed.mjs",
            "--no-install",
        ],
    );
    const seed = relevant[2];
    assert.equal(seed.env.PORTAL_TEST_MODE, "1");
    assert.match(
        seed.env.PORTAL_DB_CONTAINER,
        /^supabase_db_luminovia-portal-test-[a-f0-9]{8}$/,
    );
    assert.equal(seed.env.SUPABASE_URL, "http://127.0.0.1:55321");
    assert.equal(
        seed.env.PORTAL_DB_CONTAINER,
        relevant[1].env.PORTAL_DB_CONTAINER,
    );
    const discovery = browserCommand(browser, "application", true);
    const desktop = browserCommand(browser, "application");
    assert.ok(discovery, "Every application workflow must be inventoried first");
    assert.ok(
        desktop,
        "The application phase executes native Playwright after inventory",
    );
    assert.equal(desktop.env.PORTAL_DB_CONTAINER, seed.env.PORTAL_DB_CONTAINER);
    assert.equal(desktop.env.PORTAL_BROWSER_STAGE, "application");
    assert.equal(desktop.timeoutMs, 2 * 65 * 60_000);
    assert.equal(
        discovery.timeoutMs,
        1200000,
        "Discovery keeps its original deadline",
    );
    assert.equal(discovery.signal, desktop.signal);
    assert.deepEqual(desktop.args, [
        "--no-install",
        "playwright",
        "test",
        "--grep-invert",
        "built PWA",
    ]);
    assert.deepEqual(discovery.args, [
        ...desktop.args,
        "--list",
        "--reporter=json",
    ]);
    assert.equal(
        discovery.env.PLAYWRIGHT_JSON_OUTPUT_NAME,
        "/owned-qa/run/source/.local/browser/application/plan.json",
    );
    assert.ok(relevant.indexOf(discovery) < relevant.indexOf(desktop));
    const pwa = browserCommand(browser, "pwa");
    const pwaDiscovery = browserCommand(browser, "pwa", true);
    assert.ok(
        pwa && pwaDiscovery,
        "Built PWA also requires its own inventory and execution",
    );
    assert.deepEqual(pwa.args, [
        "--no-install",
        "playwright",
        "test",
        "tests/e2e/pwa.spec.ts",
    ]);
    assert.deepEqual(pwaDiscovery.args, [
        ...pwa.args,
        "--list",
        "--reporter=json",
    ]);
    assert.equal(
        pwaDiscovery.env.PLAYWRIGHT_JSON_OUTPUT_NAME,
        "/owned-qa/run/source/.local/browser/pwa/plan.json",
    );
    assert.ok(relevant.indexOf(pwaDiscovery) < relevant.indexOf(pwa));
    assert.equal(pwa.timeoutMs, 1200000);
    assert.equal(pwaDiscovery.timeoutMs, 1200000);
    assert.equal(pwa.signal, desktop.signal);
    assert.equal(pwaDiscovery.signal, desktop.signal);
    assert.equal(pwa.env.E2E_PWA, "1");
    assert.equal(pwa.env.E2E_BASE_URL, "http://127.0.0.1:4273");
    const applicationOrigin = desktop.env.E2E_BASE_URL;
    const projectId = seed.env.PORTAL_DB_CONTAINER.replace("supabase_db_", "");
    assert.deepEqual(localEdgeOrigins({id: projectId, site: applicationOrigin}), [
        applicationOrigin,
        "http://localhost:5273",
        pwa.env.E2E_BASE_URL,
    ]);
    for (const id of ["luminovia-portal", "luminovia-portal-github-123456abcdef", projectId + "-other"]) {
        assert.deepEqual(localEdgeOrigins({id, site: applicationOrigin}), [
            applicationOrigin,
            "http://localhost:5273",
        ]);
    }
    assert.deepEqual(localEdgeOrigins({id: projectId, site: "http://127.0.0.1:5173"}), [
        "http://127.0.0.1:5173",
        "http://localhost:5173",
    ]);
    assert.equal(browser.snapshots, 1);
    assert.equal(browser.released, 1);
    assert(browser.copies.some(([path]) => path.endsWith(".local/screenshots")));
    assert(!browser.copies.some(([path]) => path.endsWith("coverage")));
    const system = await runFixture({args: ["--phase", "system"]});
    assert.notEqual(
        system.calls.find(({args}) => args.includes("scripts/local-seed.mjs")).env
            .PORTAL_DB_CONTAINER,
        seed.env.PORTAL_DB_CONTAINER,
    );
    assert(
        !system.copies.some(([path]) =>
            /docs\/screenshots|playwright-report|test-results/.test(path),
        ),
    );
});

test("safe evidence binds identical source bytes to the selected phase without claiming unrun acceptance", async () => {
    const sourceText = "export const fictionalSource = true;\n";
    const bytes = Buffer.from(sourceText);
    const expectedHash = createHash("sha256")
        .update(JSON.stringify(["source.fixture.ts", bytes.length]) + "\n")
        .update(bytes)
        .digest("hex");
    for (const phase of ["all", "system", "browser"]) {
        const result = await runFixture({args: ["--phase", phase], sourceText});
        assert.ifError(result.error);
        const evidence = acceptance(result);
        assert.equal(evidence.phase, phase);
        assert.equal(evidence.status, "passed");
        assert.equal(evidence.sourceSha256, expectedHash);
        assert.deepEqual(
            evidence.stagePlan,
            runtimeTestPhasePlan(["--phase", phase]).stages,
        );
        assert.ok(evidence.stages.length > 0);
        assert.ok(evidence.stages.every((stage) => stage.status === "passed"));
        assert.ok(evidence.completedAt);
        if (phase === "system") {
            assert.deepEqual(
                evidence.browsers,
                {},
                "System acceptance cannot invent browser results",
            );
            assert.equal(browserCommand(result, "application", true), undefined);
            assert.equal(browserCommand(result, "pwa", true), undefined);
        } else {
            for (const stage of ["application", "pwa"]) {
                assert.equal(evidence.browsers[stage].status, "passed");
                assert.equal(evidence.browsers[stage].passed, 2);
                assert.equal(evidence.browsers[stage].skipped, 0);
                assert.equal(evidence.browsers[stage].retries, 0);
                assert.deepEqual(
                    evidence.browsers[stage].workflows
                        .map((workflow) => workflow.project)
                        .sort(),
                    ["desktop-chromium", "mobile-chromium"],
                );
            }
        }
        const safe = JSON.stringify(evidence);
        for (const secret of [
            "fictional-local-password",
            "fictional-public-fixture",
            "private-browser-session-fixture",
            sourceText,
        ])
            assert.equal(
                safe.includes(secret),
                false,
                "Safe phase evidence excludes raw source, environment and browser logs",
            );
        assert.equal(
            /Complete local acceptance/.test(result.reports.at(-1).value),
            phase === "all",
        );
    }
    const changed = await runFixture({
        args: ["--phase", "system"],
        sourceText: sourceText + "// changed fixture bytes\n",
    });
    assert.ifError(changed.error);
    assert.notEqual(
        acceptance(changed).sourceSha256,
        expectedHash,
        "The actual fingerprint changes when copied source bytes change",
    );
});

test("browser phase invokes real evidence validators and rejects skipped, partial, retried or erroneous results", async () => {
    const mutations = [
        {
            name: "disabled discovery",
            error: /Disabled/,
            change(report, {discovery}) {
                if (discovery)
                    report.suites[0].specs[0].tests[0].expectedStatus = "skipped";
            },
        },
        {
            name: "skipped execution",
            error: /Browser skipped/,
            change(report, {discovery}) {
                if (!discovery) {
                    report.stats.skipped = 1;
                    report.suites[0].specs[0].tests[0].status = "skipped";
                    report.suites[0].specs[0].tests[0].results = [];
                }
            },
        },
        {
            name: "missing project execution",
            error: /differ from discovery/,
            change(report, {discovery}) {
                if (!discovery) report.suites[0].specs[0].tests.pop();
            },
        },
        {
            name: "retried execution",
            error: /Retried browser workflow/,
            change(report, {discovery}) {
                if (!discovery) report.suites[0].specs[0].tests[0].results[0].retry = 1;
            },
        },
        {
            name: "private execution error",
            error: /Browser discovery\/execution had errors/,
            change(report, {discovery}) {
                if (!discovery)
                    report.errors = [{message: "private-evidence-error-token"}];
            },
        },
    ];
    for (const item of mutations) {
        const result = await runFixture({
            args: ["--phase", "browser"],
            mutateBrowserReport: (report, context) => {
                if (context.stage === "application") item.change(report, context);
            },
        });
        assert.match(result.error?.message, item.error, item.name);
        assert.equal(result.released, 1);
        assert.ok(result.removed.includes("/owned-qa/run"));
        assert.ok(result.calls.some(({args}) => args.includes("--no-backup")));
        assert.equal(
            browserCommand(result, "pwa", true),
            undefined,
            "A rejected application report cannot reach PWA acceptance",
        );
        assert.ok(!result.reports.some(({value}) => value.startsWith("PASS\n")));
        const evidence = acceptance(result);
        assert.equal(evidence.phase, "browser");
        assert.equal(evidence.status, "failed");
        assert.match(evidence.sourceSha256, /^[a-f0-9]{64}$/);
        if (item.name !== "disabled discovery")
            assert.equal(evidence.browsers.application.status, "failed");
        for (const secret of [
            "private-evidence-error-token",
            "private-browser-session-fixture",
            "fictional-local-password",
        ])
            assert.equal(JSON.stringify(evidence).includes(secret), false);
    }
});

test("bad CLI arguments fail before locking or allocating source/services; environment phase hints cannot shorten default acceptance", async () => {
    const invalid = await runFixture({args: ["--phase", "unrecognized"]});
    assert.match(invalid.error?.message, /Use no arguments/);
    assert.equal(invalid.locks, 0);
    assert.equal(invalid.snapshots, 0);
    assert.deepEqual(invalid.calls, []);
    const all = await runFixture({
        inherited: {
            PORTAL_TEST_PHASE: "browser",
            CI_PHASE: "browser",
            CI_PROFILE: "docs",
        },
    });
    assert.ifError(all.error);
    assert(contains(all, "test:db"));
    assert.ok(browserCommand(all, "application"));
    assert.ok(browserCommand(all, "pwa"));
    assert.match(all.reports.at(-1).value, /^PASS\nPhase: all\n/);
});

test("failed startup, retention or policy prevents all browser acceptance while cleanup remains owned", async () => {
    for (const stage of [
        "scripts/runtime-cli.mjs",
        "scripts/runtime-persistence-check.mjs",
        "scripts/local-seed.mjs",
    ]) {
        const result = await runFixture({
            args: ["--phase", "browser"],
            fail: ({args}) => args[0] === stage && args[1] !== "stop",
        });
        assert.match(result.error?.message, /Fictional stage failure/);
        assert(!contains(result, "chromium"));
        assert.equal(browserCommand(result, "application", true), undefined);
        assert.equal(browserCommand(result, "application"), undefined);
        assert(!result.reports.some(({value}) => value.startsWith("PASS\n")));
        assert(result.calls.some(({args}) => args.includes("--no-backup")));
        assert.equal(result.released, 1);
    }
});

test("system SQL/API failure and browser/PWA failure remain phase failures with checked cleanup", async () => {
    for (const [phase, stage] of [
        ["system", "test:db"],
        ["system", "scripts/alpha-api-check.mjs"],
        ["browser", "application-execution"],
        ["browser", "tests/e2e/pwa.spec.ts"],
    ]) {
        const result = await runFixture({
            args: ["--phase", phase],
            fail: ({args, env}) =>
                stage === "application-execution"
                    ? env.PORTAL_BROWSER_STAGE === "application" &&
                    !args.includes("--list")
                    : args.includes(stage),
        });
        assert.match(result.error?.message, /Fictional stage failure/);
        assert(result.reports.at(-1).value.startsWith(`FAIL\nPhase: ${phase}\n`));
        assert.equal(result.released, 1);
        assert(result.removed.includes("/owned-qa/run"));
        assert(result.calls.some(({args}) => args.includes("--no-backup")));
        if (phase === "system") assert(!contains(result, "chromium"));
        if (stage === "application-execution")
            assert(!contains(result, "tests/e2e/pwa.spec.ts"));
    }
});

test("cancellation during cleanup cannot turn either partial phase into PASS", async () => {
    for (const phase of ["all", "system", "browser"]) {
        const result = await runFixture({
            args: ["--phase", phase],
            cancelDuringCleanup: true,
        });
        assert.match(result.error?.message, /cancelled/);
        assert(!result.reports.some(({value}) => value.startsWith("PASS\n")));
        assert(result.calls.some(({args}) => args.includes("--no-backup")));
        assert.equal(result.released, 1);
    }
});

test("a failed service-stop acknowledgement fails every phase while final owned disposal still runs", async () => {
    for (const phase of ["all", "system", "browser"]) {
        const result = await runFixture({
            args: ["--phase", phase],
            fail: ({args}) =>
                args[0] === "scripts/runtime-cli.mjs" && args[1] === "stop",
        });
        assert.match(result.error?.message, /Fictional stage failure/);
        assert(!result.reports.some(({value}) => value.startsWith("PASS\n")));
        assert(result.calls.some(({args}) => args.includes("--no-backup")));
        assert.equal(result.released, 1);
        assert(result.removed.includes("/owned-qa/run"));
    }
});
