/**
 * Orchestration regressions for the service-free ./portal check command.
 * Injected commands prove order, fail-fast behavior and fictional build config
 * without installing packages, starting Docker or contacting hosted services.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {root} from "./runtime-lib.mjs";
import {runLocalCheck} from "./runtime-local-check.mjs";

test("local checks await setup and each gate before starting the next", async () => {
    const calls = [];
    let setupComplete = false;
    let active = false;
    await runLocalCheck({
        ensure: async () => {
            await Promise.resolve();
            setupComplete = true;
        },
        run: async (file, args, options) => {
            assert(setupComplete, "dependency setup must finish before a gate");
            assert.equal(active, false, "gates must not execute concurrently");
            active = true;
            await Promise.resolve();
            calls.push({file, args, options});
            active = false;
        },
        report: () => {
        },
    });
    assert.deepEqual(
        calls.map(({file, args}) => [file, ...args]),
        [
            ["npm", "run", "typecheck"],
            ["npm", "run", "lint"],
            ["npm", "run", "format:check"],
            ["npx", "--no-install", "prettier", "--check", ".github"],
            [process.execPath, "scripts/code-integrity.mjs", "--exports"],
            ["npm", "run", "test:coverage"],
            ["npm", "run", "build:quality"],
        ],
    );
    for (const {options} of calls) {
        assert.equal(options.cwd, root);
        assert.equal(options.timeoutMs, 600000);
    }
});

test("a failed prerequisite or gate stops later checks and the success report", async () => {
    const failure = new Error("fictional gate failed");
    let executed = 0;
    await assert.rejects(
        runLocalCheck({
            ensure: async () => {
                throw failure;
            },
            run: async () => executed++,
            report: () => {
            },
        }),
        (error) => error === failure,
    );
    assert.equal(executed, 0);

    const reports = [];
    const calls = [];
    await assert.rejects(
        runLocalCheck({
            ensure: async () => {
            },
            run: async (_file, args) => {
                calls.push(args);
                if (args.includes("test:coverage")) throw failure;
            },
            report: (message) => reports.push(message),
        }),
        (error) => error === failure,
    );
    assert.equal(calls.length, 6);
    assert(!calls.some((args) => args.includes("build:quality")));
    assert(!reports.some((message) => message.includes("bestanden")));
});

test("backend environment is removed and the build receives only fictional public config", async () => {
    const fixture = {
        VITE_SUPABASE_URL: "https://must-not-contact.example.invalid",
        VITE_SUPABASE_PUBLISHABLE_KEY: "fictional-inherited-key",
        SUPABASE_SERVICE_ROLE_KEY: "fictional-inherited-service-key",
        DATABASE_URL: "postgresql://fictional-inherited.invalid/database",
        PORTAL_PROJECT_ID: "must-not-start",
    };
    const previous = Object.fromEntries(
        Object.keys(fixture).map((key) => [key, process.env[key]]),
    );
    Object.assign(process.env, fixture);
    const calls = [];
    try {
        await runLocalCheck({
            ensure: async () => {
            },
            run: async (_file, args, {env}) => calls.push({args, env}),
            report: () => {
            },
        });
        for (const {args, env} of calls) {
            assert.equal(env.SUPABASE_SERVICE_ROLE_KEY, undefined);
            assert.equal(env.DATABASE_URL, undefined);
            assert.equal(env.PORTAL_PROJECT_ID, undefined);
            if (args.includes("build:quality")) {
                assert.equal(
                    env.VITE_SUPABASE_URL,
                    "https://local-check.example.invalid",
                );
                assert.equal(
                    env.VITE_SUPABASE_PUBLISHABLE_KEY,
                    "sb_publishable_local_check_fictional_build_only",
                );
            } else {
                assert.equal(env.VITE_SUPABASE_URL, undefined);
                assert.equal(env.VITE_SUPABASE_PUBLISHABLE_KEY, undefined);
            }
        }
    } finally {
        for (const [key, value] of Object.entries(previous)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    }
});
