/**
 * Real processes and listeners verify QA exclusion across checkouts.
 * Unrelated listeners survive; process exit releases the kernel lock without trusting a PID record.
 */
import assert from "node:assert/strict";
import {execFileSync, spawn} from "node:child_process";
import {once} from "node:events";
import {existsSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync,} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createServer} from "node:net";
import {setTimeout as delay} from "node:timers/promises";
import test from "node:test";
import {acquireTestLock, allocateTestServicePorts, assertTestPortsAvailable,} from "./runtime-test-lock.mjs";

test("assigns distinct loopback service ports without editing fixed app settings or comments", async () => {
    const source = [
        "port = 54321",
        "port = 54322   # database",
        "shadow_port = 54320",
        "inspector_port = 54327",
        "# port = 54324",
        'site_url = "http://127.0.0.1:5273"',
    ].join("\n");
    const config = await allocateTestServicePorts(source);
    const matches = [...config.matchAll(/^(?:port|shadow_port|inspector_port) = (\d+)/gm)];
    const ports = matches.map((match) => Number(match[1]));
    assert.equal(new Set(ports).size, 4);
    await assertTestPortsAvailable(ports);
    assert.match(config, /# database/);
    assert.match(config, /# port = 54324/);
    assert.match(config, /127\.0\.0\.1:5273/);
});

test("a legacy occupied port fails before startup and its existing listener survives", async () => {
    const listener = createServer();
    listener.listen(0, "127.0.0.1");
    await once(listener, "listening");
    const port = listener.address().port;
    try {
        await assert.rejects(
            assertTestPortsAvailable([port]),
            new RegExp(`Test port ${port}`),
        );
        assert(listener.listening, "the unrelated listener must remain running");
    } finally {
        const closed = once(listener, "close");
        listener.close();
        await closed;
    }
    await assertTestPortsAvailable([port]);
    const reused = createServer();
    reused.listen(port, "127.0.0.1");
    await once(reused, "listening");
    const closed = once(reused, "close");
    reused.close();
    await closed;
});

test("separate temporary artifact roots still resolve the same shared QA lock", () => {
    const module = new URL("./runtime-test-lock.mjs", import.meta.url).href;
    const lockFor = (tempDirectory) =>
        execFileSync(
            process.execPath,
            [
                "--input-type=module",
                "-e",
                `import {sharedTestLockDirectory} from ${JSON.stringify(module)}; process.stdout.write(sharedTestLockDirectory);`,
            ],
            {env: {...process.env, TMPDIR: tempDirectory}, encoding: "utf8"},
        );

    // Resolve the real default in each process without acquiring the outer
    // acceptance runner's lock or touching its actual test stack.
    assert.equal(lockFor("/fictional/qa-disk-one"), lockFor("/fictional/qa-disk-two"));
});

test("different checkout identities cannot hold the shared QA ports concurrently", () => {
    const directory = mkdtempSync(join(tmpdir(), "portal-shared-lock-"));
    let release;
    try {
        release = acquireTestLock({
            directory,
            checkout: "/fictional/checkout-one",
        });
        assert.throws(
            () => acquireTestLock({directory, checkout: "/fictional/checkout-two"}),
            /another checkout/,
        );
        assert.equal(statSync(directory).mode & 0o777, 0o700);
        assert.equal(statSync(join(directory, "active.lock")).mode & 0o777, 0o600);
        release();
        release();
        release = acquireTestLock({
            directory,
            checkout: "/fictional/checkout-two",
        });
        assert.equal(
            JSON.parse(readFileSync(join(directory, "active.lock"), "utf8")).checkout,
            "/fictional/checkout-two",
        );
    } finally {
        release?.();
        rmSync(directory, {recursive: true, force: true});
    }
});

test("the kernel releases a dead holder without trusting stale PID metadata", async () => {
    const directory = mkdtempSync(join(tmpdir(), "portal-dead-lock-"));
    const marker = join(directory, "ready");
    const module = new URL("./runtime-test-lock.mjs", import.meta.url).href;
    const child = spawn(
        process.execPath,
        [
            "--input-type=module",
            "-e",
            `import {acquireTestLock} from ${JSON.stringify(module)};import {writeFileSync} from 'node:fs';acquireTestLock({directory:${JSON.stringify(directory)},checkout:'/fictional/first'});writeFileSync(${JSON.stringify(marker)},'ready');setTimeout(()=>process.exit(2),5000);`,
        ],
        {stdio: "ignore"},
    );
    const exited = once(child, "close");
    let release;
    try {
        const deadline = Date.now() + 2000;
        while (!existsSync(marker) && Date.now() < deadline) await delay(10);
        assert(existsSync(marker), "the real lock holder must be ready");
        assert.throws(() => acquireTestLock({directory}), /another checkout/);
        child.kill("SIGKILL");
        await exited;
        // A reused/current PID written into old metadata cannot keep a dead lock.
        writeFileSync(
            join(directory, "active.lock"),
            JSON.stringify({pid: process.pid}),
        );
        release = acquireTestLock({directory, checkout: "/fictional/recovered"});
    } finally {
        child.kill("SIGKILL");
        await exited;
        release?.();
        rmSync(directory, {recursive: true, force: true});
    }
});

test("global QA locking refuses symlink aliases without altering their target", () => {
    const directory = mkdtempSync(join(tmpdir(), "portal-lock-links-"));
    const target = join(directory, "private-target");
    const alias = join(directory, "alias");
    writeFileSync(target, "fictional sensitive bytes");
    try {
        symlinkSync(directory, alias);
        assert.throws(() => acquireTestLock({directory: alias}), /symlinked/);
        symlinkSync(target, join(directory, "active.lock"));
        assert.throws(() => acquireTestLock({directory}));
        assert.equal(readFileSync(target, "utf8"), "fictional sensitive bytes");
    } finally {
        rmSync(directory, {recursive: true, force: true});
    }
});