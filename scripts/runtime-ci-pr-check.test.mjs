/** PR suite discovery and fail-closed orchestration; no real Docker or network. */
import assert from "node:assert/strict";
import {readdirSync} from "node:fs";
import {join} from "node:path";
import test from "node:test";
import {prCheckPlan, prSqlShardCount, runPrCheck, runPrSqlChecks,} from "./ci-pr-check.mjs";
import {root} from "./runtime-lib.mjs";

test("PR plans include every SQL/runtime suite and Edge entry without repeating frontend quality or coverage", () => {
    const plan = prCheckPlan();
    const scripts = readdirSync(new URL("./", import.meta.url));
    assert.deepEqual(plan.sql, [
        "scripts/db-rpc-tests.mjs",
        ...scripts
            .filter((name) => name.endsWith("-db-tests.mjs"))
            .sort()
            .map((name) => `scripts/${name}`),
    ]);
    assert.deepEqual(
        plan.guards[0][1].slice(1),
        scripts
            .filter((name) => /^runtime-.*\.test\.mjs$/.test(name))
            .sort()
            .map((name) => `scripts/${name}`),
    );
    const args = plan.guards.flatMap(([, args]) => args);
    assert(args.includes("test"));
    assert(args.includes("--allow-env"));
    assert(args.includes("check"));
    assert(args.includes("--audit-level=low"));
    for (const duplicate of [
        "typecheck",
        "build",
        "test:coverage",
        "format:check",
        "./portal test",
    ])
        assert(!args.includes(duplicate), duplicate);
});

// Generated Deno commands must have the same font-only read capability as
// canonical complete acceptance, not a blanket filesystem/network grant.
test("PR Edge tests receive only the course PDF asset read capability", () => {
    const plan = prCheckPlan();
    const denoTests = plan.guards.filter(
        ([, args]) => args.includes("test") && args.includes("--allow-env"),
    );
    assert.equal(denoTests.length, 1);
    const args = denoTests[0][1];
    assert.deepEqual(
        args.filter((argument) => argument.startsWith("--allow-read")),
        [
            `--allow-read=${join(root, "supabase/functions/course-documents/assets")}`,
        ],
    );
    for (const unrestricted of [
        "--allow-read",
        "--allow-all",
        "-A",
        "--allow-net",
    ])
        assert(!args.includes(unrestricted), unrestricted);
});

test("PR guards stop at the failing command, remove inherited backend/GitHub credentials and never start Docker", async () => {
    const calls = [];
    await assert.rejects(runPrCheck("invalid"), /Choose/);
    const previous = process.env.GH_TOKEN;
    process.env.GH_TOKEN = "fictional-token-must-not-reach-tests";
    try {
        await assert.rejects(
            runPrCheck("guards", {
                docker: () => assert.fail("guards do not need Docker"),
                run: async (file, args, options) => {
                    calls.push([file, args]);
                    assert.equal(options.env.GH_TOKEN, undefined);
                    assert.equal(options.env.SUPABASE_SERVICE_ROLE_KEY, undefined);
                    assert.equal(options.cwd, root);
                    if (calls.length === 2) throw new Error("fictional Edge failure");
                },
                report: () => assert.fail("failed checks cannot report success"),
            }),
            /fictional Edge failure/,
        );
        assert.equal(calls.length, 2);
    } finally {
        if (previous === undefined) delete process.env.GH_TOKEN;
        else process.env.GH_TOKEN = previous;
    }
});

/** Simulate Docker metadata using only the token actually supplied by the runner. */
function sqlFixture({
                        failSuite = false,
                        foreign = false,
                        cancel = false,
                        failStartup,
                    } = {}) {
    const calls = [];
    const cancellation = new AbortController();
    let token;
    let prepared = false;
    const id = "a".repeat(64);
    const run = async (file, args, options) => {
        calls.push({file, args, options});
        if (args[0] === "run") {
            token = args[args.indexOf("--label") + 1].split("=")[1];
            assert(args.includes("none"));
            assert(!args.includes("--publish") && !args.includes("-p"));
            assert(args.includes("postgres"));
            assert.match(
                args[args.indexOf("--entrypoint") + 2],
                /@sha256:[a-f0-9]{64}$/,
            );
        }
        if (args[0] === failStartup)
            throw new Error(`fictional ${failStartup} failure`);
        if (file === process.execPath) {
            assert.equal(
                options.env.PORTAL_DB_CONTAINER,
                `supabase_db_luminovia-portal-test-${token}`,
            );
            if (args[0] === "scripts/testing/prepare-database-template.mjs") {
                if (args[1] === "--drop") return "";
                prepared = true;
                if (failStartup === "template")
                    throw new Error("fictional template failure");
            } else if (
                args[0] === "scripts/db-rpc-tests.mjs" ||
                args[0]?.endsWith("-db-tests.mjs")
            ) {
                assert.equal(prepared, true);
                if (cancel) cancellation.abort();
                if (failSuite || cancel) throw new Error("fictional SQL failure");
            }
        }
        if (args[0] === "inspect") {
            assert.equal(options.signal, undefined);
            return JSON.stringify([
                {
                    Id: id,
                    Config: {
                        Labels: {"org.luminovia.pr-sql": foreign ? "foreign" : token},
                    },
                },
            ]);
        }
        if (args[0] === "rm") {
            assert.equal(options.signal, undefined);
            assert.deepEqual(args, ["rm", "--force", "--volumes", id]);
        }
        return "";
    };
    return {
        calls,
        run,
        signal: cancellation.signal,
        docker: async () => "unix:///fictional/docker.sock",
        report: () => {
        },
    };
}

test("PR SQL prepares one exact migration template, runs every suite in its owned image and cleans up", async () => {
    const fixture = sqlFixture();
    await runPrCheck("sql", fixture);
    assert.deepEqual(
        fixture.calls
            .filter(({file}) => file === process.execPath)
            .map(({args}) => args[0]),
        [
            "scripts/testing/prepare-database-template.mjs",
            ...prCheckPlan().sql,
            "scripts/testing/prepare-database-template.mjs",
        ],
    );
    assert(
        fixture.calls.some(
            ({args}) =>
                args[0] === "scripts/testing/prepare-database-template.mjs" &&
                args[1] === "--drop",
        ),
    );
    const preparation = fixture.calls.find(({args}) =>
        args[0]?.endsWith("prepare-database-template.mjs"),
    );
    assert.equal(preparation.options.env.PORTAL_TEST_MODE, "1");
    assert.match(
        preparation.options.env.PORTAL_TEST_DB_TEMPLATE,
        /^portal_test_template_[a-f0-9]{8}$/,
    );
    assert.equal(fixture.calls.filter(({args}) => args[0] === "run").length, 1);
    assert.equal(fixture.calls.at(-1).args[0], "rm");
});

// Execute the orchestration and inspect the SQL actually sent before its first
// suite. Diagnostic/LOAD tests need a local operator; public API roles must not
// inherit its login/superuser capability in these isolated raw clusters.
test("raw SQL workers bootstrap their diagnostic operator before running any suite", async () => {
    const fixture = sqlFixture();
    await runPrCheck("sql", fixture);
    const bootstrapIndex = fixture.calls.findIndex(
        ({file, args}) =>
            file === "docker" &&
            args[0] === "exec" &&
            args.includes("psql") &&
            args.at(-1).includes("create role anon"),
    );
    assert(bootstrapIndex >= 0);
    const firstSuiteIndex = fixture.calls.findIndex(
        ({file, args}) =>
            file === process.execPath && prCheckPlan().sql.includes(args[0]),
    );
    const templateIndex = fixture.calls.findIndex(({args}) =>
        args[0]?.endsWith("prepare-database-template.mjs"),
    );
    assert(templateIndex > bootstrapIndex && firstSuiteIndex > templateIndex);
    const bootstrap = fixture.calls[bootstrapIndex].args.at(-1);
    const definitions = new Map(
        bootstrap
            .split(";")
            .filter((statement) => statement.trim())
            .map((statement) => {
                const parsed = statement.trim().match(/^create role ([a-z_]+) (.+)$/i);
                assert(
                    parsed,
                    "The owned bootstrap must contain only explicit role definitions",
                );
                return [parsed[1], parsed[2].toLowerCase().split(/\s+/).sort()];
            }),
    );
    assert.equal(definitions.size, 4);
    assert.deepEqual(definitions.get("anon"), ["nologin"]);
    assert.deepEqual(definitions.get("authenticated"), ["nologin"]);
    assert.deepEqual(definitions.get("service_role"), ["bypassrls", "nologin"]);
    assert.deepEqual(definitions.get("supabase_admin"), ["login", "superuser"]);
});

test("SQL failure/cancellation stops later suites but still cleans the exact owned container", async () => {
    for (const cancel of [false, true]) {
        const fixture = sqlFixture({failSuite: true, cancel});
        await assert.rejects(runPrCheck("sql", fixture), /fictional SQL failure/);
        assert.equal(
            fixture.calls.filter(
                ({file, args}) =>
                    file === process.execPath && prCheckPlan().sql.includes(args[0]),
            ).length,
            1,
        );
        assert.equal(fixture.calls.at(-1).args[0], "rm");
    }
});

test("SQL cleanup refuses a foreign ownership label even after failed acceptance", async () => {
    const fixture = sqlFixture({failSuite: true, foreign: true});
    await assert.rejects(runPrCheck("sql", fixture), /ownership differs/);
    assert(!fixture.calls.some(({args}) => args[0] === "rm"));
});

// A failed pull owns nothing; startup/readiness/role errors still enter cleanup.
test("SQL startup failures stop assertions and retain bounded owned cleanup", async () => {
    for (const failStartup of ["pull", "run", "exec", "template"]) {
        const fixture = sqlFixture({failStartup});
        await assert.rejects(
            runPrCheck("sql", fixture),
            new RegExp(`fictional ${failStartup} failure`),
        );
        assert(
            !fixture.calls.some(
                ({file, args}) =>
                    file === process.execPath && prCheckPlan().sql.includes(args[0]),
            ),
        );
        assert.equal(
            fixture.calls.some(({args}) => args[0] === "rm"),
            failStartup !== "pull",
        );
    }
});

// All original suites must run exactly once across owned clusters.
test("SQL shards partition every suite exactly once with distinct owned clusters", async () => {
    const fixtures = Array.from({length: 4}, sqlFixture);
    await Promise.all(
        fixtures.map((fixture, sqlShard) =>
            runPrCheck("sql", {...fixture, sqlShard, sqlShards: 4}),
        ),
    );
    const suites = fixtures.map((fixture) =>
        fixture.calls
            .filter(
                ({file, args}) =>
                    file === process.execPath && prCheckPlan().sql.includes(args[0]),
            )
            .map(({args}) => args[0]),
    );
    assert.deepEqual(suites.flat().sort(), [...prCheckPlan().sql].sort());
    for (let left = 0; left < suites.length; left++)
        for (let right = left + 1; right < suites.length; right++)
            assert(!suites[left].some((suite) => suites[right].includes(suite)));
    const names = fixtures.map(
        (fixture) => fixture.calls.find(({args}) => args[0] === "run").args,
    );
    assert.notEqual(
        names[0][names[0].indexOf("--name") + 1],
        names[1][names[1].indexOf("--name") + 1],
    );
    for (const args of names) {
        assert(args.at(-1).includes("-c jit=off"));
        assert(!/fsync|synchronous_commit|max_connections/.test(args.at(-1)));
    }
    await assert.rejects(
        runPrCheck("sql", {sqlShard: 4, sqlShards: 4}),
        /valid SQL shards/,
    );
});

test("SQL workers overlap, abort peers on failure and await every cleanup path", async () => {
    const active = [];
    let peerCleaned = false;
    let releaseFirst;
    const firstStarted = new Promise((resolve) => {
        releaseFirst = resolve;
    });
    await assert.rejects(
        runPrSqlChecks({
            sqlShards: 2,
            worker: async (_mode, {sqlShard, signal, sqlShards}) => {
                assert.equal(sqlShards, 2);
                active.push(sqlShard);
                if (sqlShard === 0) {
                    releaseFirst();
                    await new Promise((resolve) =>
                        signal.addEventListener("abort", resolve, {once: true}),
                    );
                    await Promise.resolve();
                    peerCleaned = true;
                    throw new Error("peer cancelled after cleanup");
                }
                await firstStarted;
                assert.deepEqual(active.sort(), [0, 1]);
                throw new Error("fictional worker failed");
            },
        }),
        AggregateError,
    );
    assert.equal(peerCleaned, true);
});

// Cancellation cannot turn a successful-looking worker outcome into acceptance.
test("SQL worker orchestration rejects pre-existing and mid-run cancellation", async () => {
    for (const alreadyAborted of [true, false]) {
        const cancellation = new AbortController();
        if (alreadyAborted) cancellation.abort();
        let completed = 0;
        await assert.rejects(
            runPrSqlChecks({
                sqlShards: 2,
                signal: cancellation.signal,
                worker: async (_mode, {signal}) => {
                    if (alreadyAborted) assert(signal.aborted);
                    else cancellation.abort();
                    await Promise.resolve();
                    completed++;
                },
            }),
            /cancelled/,
        );
        assert.equal(completed, 2);
    }
});

test("SQL shard count scales with granted CPU but never exceeds four isolated clusters", () => {
    assert.equal(prSqlShardCount(1), 1);
    assert.equal(prSqlShardCount(2), 2);
    assert.equal(prSqlShardCount(4), 4);
    assert.equal(prSqlShardCount(16), 4);
    assert.throws(() => prSqlShardCount(0), /positive integer/);
});