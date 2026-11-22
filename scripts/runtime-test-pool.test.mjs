/** Checks the isolated acceptance runner's concurrency and failure handling. */
import assert from "node:assert/strict";
import test from "node:test";
import {runBounded} from "./testing/run-bounded.mjs";

test("runs every independent check within the configured concurrency", async () => {
    let active = 0;
    let maximum = 0;
    const completed = [];
    await runBounded([0, 1, 2, 3, 4, 5, 6], 3, async (item) => {
        active++;
        maximum = Math.max(maximum, active);
        await new Promise((resolve) => setTimeout(resolve, 2));
        completed.push(item);
        active--;
    });
    assert.equal(maximum, 3);
    assert.deepEqual(completed.sort(), [0, 1, 2, 3, 4, 5, 6]);
});

test("stops scheduling after a failure and waits for already running checks", async () => {
    const started = [];
    let release;
    const inFlight = new Promise((resolve) => (release = resolve));
    const run = runBounded([0, 1, 2, 3, 4], 2, async (item) => {
        started.push(item);
        if (item === 0) {
            await new Promise((resolve) => setImmediate(resolve));
            throw new Error("fixture failure");
        }
        if (item === 1) await inFlight;
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(started, [0, 1]);
    release();
    await assert.rejects(run, /fixture failure/);
    assert.deepEqual(started, [0, 1]);
});

test("rejects invalid concurrency limits", async () => {
    await assert.rejects(
        runBounded([], 0, async () => {
        }),
        /positive integer/,
    );
});

test("preserves even a deliberately thrown undefined rejection", async () => {
    await assert.rejects(
        runBounded([0], 1, async () => {
            throw undefined;
        }),
        (error) => error === undefined,
    );
});
